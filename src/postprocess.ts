/**
 * 输出后处理——**策略引擎**，不靠无穷标签白名单。
 *
 * 对照酒馆源码(SillyTavern public/script.js:1753 messageFormatting + chats.js)：
 * - 酒馆**没有**任何标签名单。sanitize config 全文只有 `MESSAGE_SANITIZE` 与
 *   `ADD_TAGS:['custom-style']`（它给自己搬 CSS 的内部管道），无 ALLOWED_TAGS。
 * - 自定义标签（`<state1>` `<catsay>` `<状态面板>`）经 DOMPurify 默认白名单**必被剥、
 *   内容保留**——custom-element 逃生门要求标签名含短横线且配 tagNameCheck，两条都不满足。
 *   `chats.js:1943` 那个 `HTMLUnknownElement → <br>` hook 正是「标签马上要被剥、先救换行」的证据。
 * - 状态栏之所以是界面，全靠**作者写的 markdownOnly 正则**把自定义标签换成标准 HTML
 *   （`script.js:1809`）。作者不写正则，`<state1>` 在酒馆里永远是裸文字。
 *
 * 所以梨园对齐酒馆的做法是：**未知标签一律 unwrap**（剥壳留内容），渲染交给作者的正则
 * （src/cardfront.ts 读卡与预设的 regex_scripts → src/cardSkin.ts 执行）。
 *
 * | 策略 | 显示 | 送模历史 | 判定 |
 * |------|------|----------|------|
 * | **fold** | 进思维链折叠，正文去掉 | 整块删除 | 名称像思考/草稿/分析，或预设自动发现 |
 * | **strip** | 标签+内容都隐去 | 整块删除 | 名称像 jailbreak/仪式回显 |
 * | **unwrap** | 去掉标签、**内容当正文渲染** | 去掉标签留内容 | **默认**——所有未识别标签 |
 *
 * 8/15：**panel 策略整体退场**。它原本把「名字像状态栏」的标签留给前端画梨园自制灰框——
 * 那是酒馆从来不做的事，而它存在的唯一原因是梨园没读预设自带的 regex_scripts（导入期
 * 连 extensions 一起丢了），只好拿名单猜自己扔掉的数据。实测：双人成行+TGbreak 共 53 条
 * 作者正则里，提到 status/state1/catsay/options 的有 **0 条**——名单猜的名字作者没写过。
 *
 * **所有上屏通道**必须走 prepareDisplayText（先皮肤正则，再策略）：
 * 禁止 unwrap 先于作者正则，否则 <stateN> 等标记被拆掉，正则永远打空。
 */

import type { DisplayRule } from "./cardfront.ts";
import { hasDepthLimits, rulesAtDepth } from "./cardfront.ts";
import { applySkinKeepingBody } from "./cardSkin.ts";
import { fencedBlockHoldsMarkup } from "./htmlMarkup.ts";
import { mountMvuPanel } from "./mvu.ts";

type TagPolicy = "fold" | "strip" | "unwrap" | "keep";

/**
 * 「内容不是正文文字」的 HTML 元素——对它们做 unwrap **在语义上就是错的**。
 *
 * unwrap 的含义是「标签不是显示标记，但它的内容是正文」。这个前提对未知标签成立
 * （`<state1>血量80</state1>` → 血量80，正是浏览器对未知元素的原生行为，酒馆就靠它，
 * 所以酒馆零标签名单）；但对下面这些元素**按 HTML 规范就不成立**：`<style>` 的内容是
 * 样式表、`<script>` 的内容是代码，浏览器绝不会把它们当文字显示出来。
 *
 * 8/25 实锤：作者界面被 unwrap 剥壳后，CSS 与 JS 当散文印进了故事
 * （16376 字界面 → 13725 字裸文本）。根因就是把一个前提不成立的变换照做了。
 *
 * 这不是「名单」那类物（铁律三）：这些名字不是卡作者/预设作者发明的措辞，而是 HTML 规范里的
 * 元素名——一个封闭、稳定、梨园既不发明也不必追的外部协议（浏览器判定同名的这一套叫
 * HTMLUnknownElement，判据完全一致）。没见过的卡不需要往里加任何一行就是对的。
 */
const HTML_NON_PROSE_TAGS = new Set([
	"html",
	"head",
	"body",
	"style",
	"script",
	"title",
	"meta",
	"link",
	"base",
	"template",
	"noscript",
]);

/** 是不是「内容不是正文文字」的 HTML 元素（见 HTML_NON_PROSE_TAGS） */
function isHtmlNonProseTag(tag: string): boolean {
	return HTML_NON_PROSE_TAGS.has(tag.trim().toLowerCase());
}

/** 标签名：字母/中文起头，允许数字 _ - . 与中文（兼容 <haurki准则> <draft_notes>） */
const TAG_NAME = String.raw`[A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff.\-]*`;

/** 开标签（非闭合、非注释、非 DOCTYPE） */
const OPEN_TAG_RE = new RegExp(`<(${TAG_NAME})(\\s[^>]*)?>`, "g");

// —— 名称模式（类，不是枚举每一个标签）——
/** 思考 / 草稿 / 分析 → 折叠 */
const FOLD_NAME_RE =
	/^(?:thinking|think|thoughts?|draft(?:_?notes)?|reasoning|reason(?:ing)?|analysis|analy[sz]e|descriptive_?analysis|cot|chain_?of_?thought|scaffold|memo|notes?|推演|思考|思维|草稿|分析|笔记|备忘|内心推演)$/i;
/** 仪式/越狱回显 → 整块扔掉 */
const STRIP_NAME_RE = /^(?:haurki|haurki准则|jailbreak|system_?prompt|oai_?system|anti_?reject)$/i;

/**
 * 运行时额外 fold 标签（小写）。由预设扫描写入——预设写了「必须先输出 <foo>」就把 foo 当思维链。
 */
const extraFold = new Set<string>();
/**
 * 「只在送模历史整块剥、显示层照常」的标签（小写）。
 *
 * 预设格式栈（w2g/catsay/UpdateVariable…）是**用户要看的产出**，
 * 但留在历史里会成为往拍模仿源。两个需求方向相反，故与 extraFold 分开：
 * extraFold 影响显示（折进思维链），本 Set 只影响 cleanAssistantText。
 * 曾经混用一个 Set，导致模型写出的咪咪点评被显示层连内容删掉（8/05 实锤）。
 *
 * 内置基线 + 运行时追加：内置项不随 resetDisplayTagExtras 清空——
 * 扩展与 server 各持一份模块实例（jiti 二象性），靠注册会漏在其中一侧。
 */
const HISTORY_STRIP_BUILTIN = ["w2g", "catsay", "updatevariable", "jsonpatch", "analysis", "draftnotes", "wfeeling"];
const historyOnlyStrip = new Set<string>(HISTORY_STRIP_BUILTIN);

export function resetDisplayTagExtras(): void {
	extraFold.clear();
	// 内置格式栈保底，只清运行时追加项
	historyOnlyStrip.clear();
	for (const t of HISTORY_STRIP_BUILTIN) historyOnlyStrip.add(t);
}

export function addFoldTags(tags: Iterable<string>): void {
	for (const t of tags) {
		const n = normalizeTagName(t);
		if (n) extraFold.add(n);
	}
}

/** 注册「历史剥、显示留」标签——不进 extraFold，不影响 classifyTag 的显示判定 */
export function addHistoryStripTags(tags: Iterable<string>): void {
	for (const t of tags) {
		const n = normalizeTagName(t);
		if (n) historyOnlyStrip.add(n);
	}
}

/** 该标签是否「只在历史剥」 */
function isHistoryStripTag(tag: string): boolean {
	const raw = tag.trim();
	const norm = normalizeTagName(raw);
	return historyOnlyStrip.has(norm) || historyOnlyStrip.has(raw.toLowerCase());
}

function normalizeTagName(tag: string): string {
	return tag.trim().toLowerCase().replace(/_/g, "");
}

/** 名称 → 策略（先 extra，再模式，默认 unwrap） */
export function classifyTag(tag: string): TagPolicy {
	const raw = tag.trim();
	const norm = normalizeTagName(raw);
	if (!norm) return "unwrap";
	// HTML 规范里「内容不是正文」的元素：原样留着交给浏览器，绝不剥壳（见 HTML_NON_PROSE_TAGS）
	if (isHtmlNonProseTag(raw)) return "keep";
	if (extraFold.has(norm) || extraFold.has(raw.toLowerCase())) return "fold";
	// 模式匹配用「去下划线」与原文各试一次
	if (FOLD_NAME_RE.test(raw) || FOLD_NAME_RE.test(norm)) return "fold";
	if (STRIP_NAME_RE.test(raw) || STRIP_NAME_RE.test(norm)) return "strip";
	return "unwrap";
}

export interface TaggedBlock {
	tag: string;
	policy: TagPolicy;
	body: string;
	/** 含开闭标签的原文切片 */
	raw: string;
	start: number;
	end: number;
	/** 无闭合、吃到文末 */
	hanging: boolean;
}

/**
 * 从预设/指令正文里发现「应折叠」的标签：模型被要求先输出的成对标签。
 * 不追求完美 NLP——宁可少发现，漏网的仍可被名称模式兜住。
 */
export function discoverFoldTagsFromTexts(texts: string[]): string[] {
	const found = new Set<string>();
	const cue =
		/(?:思考过程|思维链|思考格式|draft_notes|thinking|先(?:必须)?输出|必须输出|输出以下|最先必须|按下列格式|格式必须)/i;
	for (const text of texts) {
		if (!text) continue;
		// 线索附近出现的开标签 → 视为脚手架
		let idx = 0;
		while (idx < text.length) {
			const slice = text.slice(idx);
			const m = cue.exec(slice);
			if (!m) break;
			const from = idx + m.index;
			const window = text.slice(from, from + 240);
			const openRe = new RegExp(`<(${TAG_NAME})(?:\\s[^>]*)?>`, "g");
			let om: RegExpExecArray | null;
			while ((om = openRe.exec(window)) !== null) {
				found.add(om[1]);
			}
			idx = from + Math.max(m[0].length, 1);
		}
		// 指令里直接示范的成对思考标签（即便没有「思考」二字的邻接）
		const pairRe = new RegExp(`<(${TAG_NAME})(?:\\s[^>]*)?>[\\s\\S]*?</\\1>`, "gi");
		let pm: RegExpExecArray | null;
		while ((pm = pairRe.exec(text)) !== null) {
			const tag = pm[1];
			const body = pm[0];
			// 短示范块 + 名称像 meta，或出现在「格式」语境
			if (FOLD_NAME_RE.test(tag) || /思考|思维|draft|分析|推演/i.test(body.slice(0, 80))) {
				found.add(tag);
			}
		}
	}
	return [...found];
}

/** 扫描全文顶层成对/悬挂标签（不解析嵌套树，按出现顺序） */
export function scanTaggedBlocks(text: string): TaggedBlock[] {
	const blocks: TaggedBlock[] = [];
	if (!text) return blocks;
	OPEN_TAG_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	const opens: Array<{ tag: string; openStart: number; openEnd: number }> = [];
	while ((m = OPEN_TAG_RE.exec(text)) !== null) {
		// 跳过闭合误匹配（OPEN 已不含 /）
		opens.push({ tag: m[1], openStart: m.index, openEnd: m.index + m[0].length });
	}
	// 贪心：每个开标签找其后第一个同名闭合；已被前块覆盖的跳过
	let cursor = 0;
	for (const o of opens) {
		if (o.openStart < cursor) continue;
		const closeRe = new RegExp(`</${escapeReg(o.tag)}\\s*>`, "i");
		const rest = text.slice(o.openEnd);
		const cm = closeRe.exec(rest);
		if (cm && cm.index >= 0) {
			const body = rest.slice(0, cm.index);
			const end = o.openEnd + cm.index + cm[0].length;
			blocks.push({
				tag: o.tag,
				policy: classifyTag(o.tag),
				body,
				raw: text.slice(o.openStart, end),
				start: o.openStart,
				end,
				hanging: false,
			});
			cursor = end;
		} else {
			// 悬挂：从开标签吃到文末（仅当这是最后一个未覆盖开标签）
			blocks.push({
				tag: o.tag,
				policy: classifyTag(o.tag),
				body: text.slice(o.openEnd),
				raw: text.slice(o.openStart),
				start: o.openStart,
				end: text.length,
				hanging: true,
			});
			cursor = text.length;
			break;
		}
	}
	return blocks;
}

const escapeReg = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function tidyWhitespace(text: string): string {
	return text
		.replace(/[ \t]+$/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * 按策略改写全文（多轮至稳定，处理「外壳 unwrap 后内层 thinking 才暴露」）。
 * - fold/strip：删除整块（fold 的 body 另收集）
 * - unwrap：只留 body
 */
function applyPolicies(
	text: string,
	opts: { collectFold: boolean; stripHistoryOnly?: boolean },
): { text: string; foldParts: string[] } {
	const foldParts: string[] = [];
	/** keep 块的暂存：占位后续轮次不再扫描作者产物（见下方 changed 处的说明） */
	const kept: string[] = [];
	const keepToken = (i: number) => `${i}`;
	let t = text;
	for (let pass = 0; pass < 8; pass++) {
		const blocks = scanTaggedBlocks(t);
		if (blocks.length === 0) break;
		let out = "";
		let cursor = 0;
		let changed = false;
		for (const b of blocks) {
			if (b.start > cursor) out += t.slice(cursor, b.start);
			// 「历史剥、显示留」：只在历史路径整块扔，显示路径按原策略走
			const policy = opts.stripHistoryOnly && isHistoryStripTag(b.tag) ? "strip" : b.policy;
			if (policy === "keep") {
				// 显示侧：原样交给浏览器（不剥壳、不进内层扫描——里面是作者的东西）。
				// **换成占位符**而不是直接回填原文：作者界面动辄十几 KB，且 JS 字符串里满是
				// `<div …>` 字样会被当成开标签，留在文本里会让后续每一轮重扫一遍
				// （实测整套测试 2.2s → 55s）。占位后下一轮就没有块可扫，当轮即收敛。
				// 送模侧沿用旧行为（本刀只改显示侧，不动 token 账）。
				if (opts.stripHistoryOnly) {
					out += b.body;
				} else {
					out += keepToken(kept.length);
					kept.push(b.raw);
				}
				changed = true;
			} else if (policy === "fold") {
				const body = b.body.trim();
				if (opts.collectFold && body) foldParts.push(body);
				changed = true;
			} else if (policy === "strip") {
				changed = true;
			} else {
				// unwrap：内容进正文（内层标签下轮再处理）
				out += b.body;
				changed = true;
			}
			cursor = b.end;
		}
		if (cursor < t.length) out += t.slice(cursor);
		t = out;
		if (!changed) break;
	}
	// 还原 keep 块（占位符互不嵌套；倒序只为与 stash 顺序一致）
	for (let i = kept.length - 1; i >= 0; i--) {
		t = t.split(keepToken(i)).join(kept[i]!);
	}
	return { text: t, foldParts };
}

/** 历史送模：fold/strip 整块扔；unwrap 拆包留内容；格式栈标签（catsay 等）另行整块剥 */
export function cleanAssistantText(text: string): string {
	let t = applyPolicies(text, { collectFold: false, stripHistoryOnly: true }).text;
	// HTML 注释（导演旁注）
	t = t.replace(/<!--[\s\S]*?-->/g, "");
	return tidyWhitespace(t);
}

/**
 * 显示层：fold→思维链另抽；strip 扔；其余 unwrap。
 * 另：HTML 注释、单独成行的「### 正文」类分隔。
 *
 * 标签 unwrap 后留下的 ```…``` 围栏**故意保留**：前端 markdown 渲染成代码块，
 * 与正文区分（Options 卡等）；不在服务端剥掉。
 *
 * **注意**：卡显示正则（stateN→HTML 等）必须在本函数**之前**应用
 * （见 prepareDisplayText），否则 unwrap 会先拆掉正则要匹配的标记。
 */
export function displayAssistantText(text: string): string {
	let t = applyPolicies(text, { collectFold: false }).text;
	t = t.replace(/<!--[\s\S]*?-->/g, "");
	t = t.replace(/^\s*#{1,6}\s*正文\s*$/gim, "");
	t = t.replace(/^\s*#{1,6}\s*(thinking|draft|notes?|思维|草稿)\s*$/gim, "");
	// 残留空标签行（作者正则更早一步已跑过；到这里还剩的就是没人认领的裸标签，剥掉）。
	// **例外**：HTML 规范里内容不是正文的元素（`<head>`/`<style>`/`<script>`…）。它们单独成行
	// 是界面的常态，删掉这一行就等于把 CSS/JS 的壳拆了、内容裸奔上屏——8/25 的第二刀。
	// `/?>`：自闭合写法也算残留标签。原先 `<foo />`（有空格）被清掉、`<foo/>`（无空格）却当文字
	// 印上屏，这个区别毫无道理——浏览器对未知元素两种都渲染成空（酒馆零标签名单就是靠这个）。
	// 8/26 实证：depth 限定把面板规则筛掉后，开场白里作者手写的 `<StatusPlaceHolderImpl/>`
	// 就这么以源码形态出现在屏幕上（`<br/>` 同病，而 `<br>` 早就被清）。
	t = t.replace(new RegExp(`^\\s*</?(${TAG_NAME})(\\s[^>]*)?/?>\\s*$`, "gim"), (m, tag: string) =>
		isHtmlNonProseTag(tag) ? m : "",
	);
	return tidyWhitespace(t);
}

/** wire / 显示管线注入的一档皮肤 */
export type DisplaySkin = {
	rules: DisplayRule[];
	charName: string;
	userName: string;
	/**
	 * 梨园已接管本卡的 MVU 树，**且本条是最新一条**——显示侧据此补挂面板挂载点
	 * （见 src/mvu.ts 的 mountMvuPanel：MVU 插件干的那一步在梨园没有主人）。
	 * 由调用方置位（server/main.ts 看 state.mvu），并由 skinAtDepth 在非最新的深度上清掉。
	 */
	mvu?: boolean;
};

/**
 * 皮肤按消息深度收窄(酒馆 depth：0＝最新)。
 * 没有深度限定 / 没有 skin 时原样返回同一个对象——不制造无谓的新引用。
 *
 * 顺带把 `mvu` 收窄到 depth 0：面板读的是**当前**那棵树，画到历史消息上就是对历史撒谎
 * （酒馆的 MVU 每条消息各存一份快照，梨园只持有当前一棵）。
 */
export function skinAtDepth(skin: DisplaySkin | null | undefined, depth: number): DisplaySkin | null {
	if (!skin?.rules?.length) return skin ?? null;
	const rules = hasDepthLimits(skin.rules) ? rulesAtDepth(skin.rules, depth) : skin.rules;
	const mvu = skin.mvu === true && depth === 0;
	if (rules === skin.rules && mvu === (skin.mvu === true)) return skin;
	return { ...skin, rules, mvu };
}

/**
 * 皮肤产物是否已是 HTML 界面载荷——此后禁止再跑标签 unwrap（会撕碎 div/script）。
 */
export function isHtmlDisplayPayload(text: string): boolean {
	if (!text) return false;
	if (isFullPageHtmlPayload(text)) return true;
	// 皮肤包的大块 styled div（部分社区皮肤包的状态栏等）
	if (/<div\b[^>]*\bstyle\s*=/i.test(text) && /<\/div>/i.test(text) && text.length > 60) return true;
	return false;
}

/** 整页 HTML（doctype/html 整文档或围栏整页）——只有这种才允许跳过全部显示层策略 */
function isFullPageHtmlPayload(text: string): boolean {
	if (!text) return false;
	const t = text.trim();
	// 围栏整页（可带开场前缀）：围栏内是标记语言即算界面——**不问**有没有 doctype/html 外壳。
	// 原先三条判据分别要求 doctype、`<html>`、或 ` ```html ` 语言标记，于是「根标签 <head>、
	// 收尾只到 </body>、裸围栏」的作者界面全部落空 → 放行 unwrap → 壳被剥、CSS/JS 当正文
	// 上屏（实卡开场白实测）。判据统一到 src/htmlMarkup.ts，见那里的由来。
	for (const block of text.match(/```[^\n`]*\r?\n[\s\S]*?\r?\n```/g) ?? []) {
		if (fencedBlockHoldsMarkup(block) && block.length > 80) return true;
	}
	// 裸整页
	const head = t.slice(0, 80).toLowerCase();
	if (head.startsWith("<!doctype html") || head.startsWith("<html")) return true;
	// 裸整页 + 短前言：上面围栏判据都容忍前缀，裸整页这条却要求
	// 文档落在第 0 位——而**梨园自己**给开场白加了「【开场 · 卡名】\n」（greeting.ts:16）。
	// 于是「裸整份文档」的开场白被判成不是整页，走通用 unwrap：`<style>` 壳被剥、CSS 当正文
	// 上屏、容器标签也被剥。同一份原文去掉前缀或补上围栏都正常，实证只差这个前缀。
	if (/(?:^|\n)[ \t]*(?:<!doctype\s+html|<html[\s>])/i.test(text) && /<\/html\s*>/i.test(text)) return true;
	return false;
}

/** 占位符：私用区字符包裹序号，正常文本不可能撞车 */
const skinDivToken = (i: number) => `${i}`;

/**
 * 把皮肤产出的 styled div 块（含嵌套）换成占位符暂存，避免被标签策略撕碎；
 * 过滤完成后按占位符原样还原。不成对的残块原样留下不保护。
 */
function protectSkinDivs(text: string): { text: string; stash: string[] } {
	const stash: string[] = [];
	const startRe = /<div\b[^>]*\bstyle\s*=/gi;
	let out = "";
	let i = 0;
	for (;;) {
		startRe.lastIndex = i;
		const m = startRe.exec(text);
		if (!m) {
			out += text.slice(i);
			break;
		}
		out += text.slice(i, m.index);
		const tokenRe = /<div\b|<\/div\s*>/gi;
		tokenRe.lastIndex = m.index + 1;
		let depth = 1;
		let end = -1;
		let tk: RegExpExecArray | null;
		while ((tk = tokenRe.exec(text))) {
			if (tk[0].toLowerCase().startsWith("</")) {
				depth--;
				if (depth === 0) {
					end = tokenRe.lastIndex;
					break;
				}
			} else {
				depth++;
			}
		}
		if (end < 0) {
			out += text.slice(m.index);
			break;
		}
		out += skinDivToken(stash.length);
		stash.push(text.slice(m.index, end));
		i = end;
	}
	return { text: out, stash };
}

/**
 * 上屏正文唯一入口（wire narrative/greeting/import）：
 * 1) **先** apply 卡显示正则（标记仍在）
 * 2) **纯**整页 HTML 载荷（前后无叙事）→ 原样交出（前端 HtmlFrame）
 * 3) 整页 HTML 与叙事混排 → HTML 段占位保护后照常过滤，再还原
 * 4) 皮肤 div 与叙事混排 → div 占位保护后照常过滤（thinking/注释不得因皮肤漏网），再还原
 * 5) 其余 displayAssistantText（fold/strip/unwrap）
 */
export function prepareDisplayText(text: string, skin?: DisplaySkin | null): string {
	if (!text) return "";
	let t = text;
	if (skin?.rules?.length) {
		// MVU 面板挂载点：卡声明了它、正文里没有、且本卡的树归梨园管（最新一条）→ 补一个。
		// 必须在皮肤正则**之前**，它就是给正则吃的。
		if (skin.mvu) t = mountMvuPanel(t, skin.rules);
		t = applySkinKeepingBody(t, skin.rules, { charName: skin.charName, userName: skin.userName });
	}
	// 整段就是界面（前后无叙事）：原样交出，不拆
	if (isFullPageHtmlPayload(t) && isBareFullPagePayload(t)) {
		return t;
	}
	// 整页 HTML 与叙事混排（卡状态栏占位替换成 ```html 整页 + 正文 + catsay 尾巴）：
	// 旧逻辑在此整段 return，导致 <catsay> 等标签的 unwrap 从未执行——
	// 「状态栏出现」反而成了「catsay 标签暴露」的原因（8/05 实锤）。故占位保护后照常过滤。
	if (isFullPageHtmlPayload(t)) {
		const { text: protectedText, stash } = protectFullPageBlocks(t);
		let cleaned = displayAssistantText(protectedText);
		for (let i = 0; i < stash.length; i++) {
			cleaned = cleaned.split(skinDivToken(i)).join(stash[i]);
		}
		return cleaned;
	}
	if (/<div\b[^>]*\bstyle\s*=/i.test(t) && /<\/div>/i.test(t)) {
		const { text: protectedText, stash } = protectSkinDivs(t);
		let cleaned = displayAssistantText(protectedText);
		for (let i = 0; i < stash.length; i++) {
			cleaned = cleaned.split(skinDivToken(i)).join(stash[i]);
		}
		return cleaned;
	}
	return displayAssistantText(t);
}

/** 整段（trim 后）恰好就是整页 HTML / 围栏整页，前后无叙事——才允许跳过全部策略 */
function isBareFullPagePayload(text: string): boolean {
	const t = text.trim();
	const head = t.slice(0, 80).toLowerCase();
	// 裸整页：doctype/html 开头且 </html> 收尾
	if ((head.startsWith("<!doctype html") || head.startsWith("<html")) && /<\/html\s*>\s*$/i.test(t)) return true;
	// 围栏整页：``` 开头 ``` 收尾，且中间只有一份文档
	if (/^```/.test(t) && /```$/.test(t)) {
		const fences = t.match(/^```/gm);
		if (fences && fences.length === 2) return true;
	}
	return false;
}

/**
 * 把「围栏整页 HTML」块换成占位符暂存，避免被标签策略撕碎；过滤后按占位符还原。
 * 与 protectSkinDivs 同机制，保护对象是 ```html…``` / doctype 整页段。
 */
function protectFullPageBlocks(text: string): { text: string; stash: string[] } {
	const stash: string[] = [];
	let out = text;
	// 围栏块整段占位：围栏内是标记语言就保护（**不问** doctype/html 外壳——
	// 检测侧 isFullPageHtmlPayload 已同源放宽，两边必须用同一条判据，否则
	// 「判成界面却没保护」＝照旧被 unwrap 剥壳，等于没修）
	out = out.replace(/```[^\n`]*\r?\n[\s\S]*?\r?\n```/g, (m) => {
		if (!fencedBlockHoldsMarkup(m)) return m;
		const token = skinDivToken(stash.length);
		stash.push(m);
		return token;
	});
	// 裸整页段（无围栏）：<!doctype …</html>
	out = out.replace(/<!doctype\s+html[\s\S]*?<\/html\s*>/gi, (m) => {
		const token = skinDivToken(stash.length);
		stash.push(m);
		return token;
	});
	// 裸整页段：直接 `<html>` 开头、没写 doctype（社区卡很常见，本仓库实测的那张开场白就是）。
	// 上一条只认 doctype 打头，这种整份文档过不了保护、被标签策略撕碎。
	// 顺序在后：doctype 打头的那种已被上一条换成占位符，不会重复命中。
	out = out.replace(/<html[\s>][\s\S]*?<\/html\s*>/gi, (m) => {
		const token = skinDivToken(stash.length);
		stash.push(m);
		return token;
	});
	return { text: out, stash };
}

/**
 * 抽出应进 UI「思维链」折叠的内容（fold 策略块）。
 */
export function extractScaffoldThinking(text: string): string {
	const { foldParts } = applyPolicies(text, { collectFold: true });
	return foldParts
		.join("\n\n---\n\n")
		.replace(new RegExp(`^\\s*</?(${TAG_NAME})(\\s[^>]*)?>\\s*$`, "gim"), "")
		.trim();
}

