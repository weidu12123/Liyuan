/**
 * 卡前端(一档皮肤):从**卡与预设**的原始 JSON 提取 ST regex_scripts,筛出「显示向美化规则」。
 *
 * 酒馆的正则有三个来源(public/scripts/extensions/regex/engine.js:108-133),按
 * GLOBAL → PRESET → SCOPED 顺序链式跑。梨园没有 GLOBAL(那是用户全局设置),
 * 故本模块产出 **预设规则在前、卡规则在后**——顺序要紧,后一条吃的是前一条的产物。
 *
 * 8/15 修正:此前只读卡的 regex_scripts,预设自带的那份从未读过(导入期连 extensions
 * 一起丢了)。于是「预设的状态栏怎么渲染」没有负责人,只好由 PANEL_NAME_RE 这类
 * 名字名单去猜——猜的正是被扔掉的这份数据。翻译文件归作者,harness 只管死板执行。
 *
 * 筛选逻辑(spec §7 P1):!disabled && placement 含 2(AI 输出) && !(promptOnly && !markdownOnly)。
 * 清理向(纯 promptOnly)规则不进显示层——它们归 promptRules,挂在送模侧历史上。
 * v1 不支持 substituteRegex:遇到整条跳过,宁缺毋错(显示错样式比没样式糟)。
 * trimStrings 已实现(随规则带下去,在 applyCardSkin 里对代入的捕获组生效,与 ST filterString 同义)。
 * minDepth/maxDepth 已实现(随规则带下去,由**遍历消息序列的调用方**用 rulesAtDepth 筛——
 * 只有它知道当前是第几条;规则应用点 applyCardSkin 拿不到位置,故筛在进它之前)。
 * 页面级 `<style>`/`<script>`:显示向规则的替换串在此包成围栏整份文档(framePageScopedStyles),
 * 走现成的 iframe 通道——梨园不放开页面作用域,靠 iframe 隔离顶掉酒馆的 `.mes_text` 前缀那套。
 *
 * 载荷纪律:hello 与 GET /api/cardfront 必须同源(buildCardFrontSnapshot),避免「REST 有规则、对话流无规则」。
 */

import { buildAuthorScripts, type AuthorScript } from "./authorScripts.ts";
import type { RpConfig } from "./types.ts";

export interface DisplayRule {
	name: string;
	/** 正则源文本(不含定界斜杠) */
	source: string;
	flags: string;
	replace: string;
	/** ST trimStrings:代入替换串的捕获组里,这些子串要先删掉(engine.js:457 filterString) */
	trim?: string[];
	/** ST minDepth:只对第 N 条往前(更旧)的消息生效;无限定则不带此字段 */
	minDepth?: number;
	/** ST maxDepth:只对第 N 条往后(更新)的消息生效;无限定则不带此字段 */
	maxDepth?: number;
	/** ST substituteRegex: 0=不替换, 1=RAW(原样代入宏), 2=ESCAPED(转义正则元字符代入宏) */
	substituteRegex?: number;
}

/** 一档皮肤快照:wire hello / REST 共用,前端据此注入显示管线 */
export interface CardFrontSnapshot {
	enabled: boolean;
	hasSkin: boolean;
	rules: DisplayRule[];
	charName: string;
	userName: string;
	/**
	 * 作者运行时脚本（页面级，见 authorScripts.ts）。与 rules 同车不同命：
	 * rules 是「怎么画这条消息」，scripts 是「页面上常驻什么」，前端各走各的通道。
	 *
	 * ⚠ **正文只走 REST，不进 hello 帧**：单份脚本实测可达 3.58MB，而 hello 走 WebSocket
	 * 不压缩、每次重放/回退都重发。规则必须与消息同帧（否则首屏回落统一面板），脚本没有
	 * 这个时序要求——它是页面级的，晚一个往返出现无影响。见 server/main.ts 的 helloFrame。
	 */
	scripts: AuthorScript[];
}

/**
 * 从已读 raw 组装快照(纯函数,不读盘)。
 * raw=null 表示坏卡/读失败 → 无皮肤但仍返回结构,前端可清空。
 * presetRaw=预设原文(任务一之后落盘即原文,`extensions.regex_scripts` 保真);
 * 预设规则排在卡规则**之前**,与酒馆 PRESET → SCOPED 的链式顺序一致。
 */
export function buildCardFrontSnapshot(
	config: { card: string; cardSkinOff?: string[]; userName: string },
	raw: Record<string, unknown> | null,
	charName: string,
	presetRaw?: Record<string, unknown> | null,
): CardFrontSnapshot {
	const presetRules = presetRaw ? displayRules(extractRegexScripts(presetRaw)) : [];
	const cardRules = raw ? displayRules(extractRegexScripts(raw)) : [];
	const rules = [...presetRules, ...cardRules];
	return {
		enabled: isSkinEnabled(config, config.card),
		hasSkin: rules.length > 0,
		rules,
		charName,
		userName: config.userName,
		// **只跑卡自带的脚本，不跑预设自带的**（8/29 用户定案）。
		// 预设侧那条通道实测两条声明都是负担而非功能：其一悬浮球占着屏幕但在梨园里
		// 用不了，其二每次切预设就弹「您的正则未正确更新…」——都是为酒馆助手宿主写的，
		// 换到梨园的宿主帧里既无处可依附又误报。预设的 regex_scripts（上面 presetRules）照旧生效，
		// 那条是真在工作的；被切掉的只有运行时 JS 这一路。
		scripts: buildAuthorScripts(raw, presetRaw),
	};
}

/** ST 卡的 regex_scripts 数组(data.extensions 优先,顶层 extensions 兜底——预设走的就是顶层) */
export function extractRegexScripts(raw: Record<string, unknown>): unknown[] {
	const data = raw.data && typeof raw.data === "object" ? (raw.data as Record<string, unknown>) : raw;
	const ext = data.extensions && typeof data.extensions === "object" ? (data.extensions as Record<string, unknown>) : {};
	return Array.isArray(ext.regex_scripts) ? ext.regex_scripts : [];
}

/** "/pattern/flags" → {source, flags};裸串按字面源、默认 g */
function parseFindRegex(find: string): { source: string; flags: string } | null {
	const m = /^\/([\s\S]+)\/([a-z]*)$/.exec(find.trim());
	const source = m ? m[1] : find;
	const flags = m?.[2] || "g";
	try {
		new RegExp(source, flags);
	} catch {
		return null;
	}
	return { source, flags };
}

/**
 * ST 的深度字段有效性(engine.js:363-371 的守卫):minDepth ≥ -1、maxDepth ≥ 0 才算限定,
 * null / 非数 / 越界一律当「无限定」——与酒馆同判,故越界的直接不带字段。
 */
function depthField(v: unknown, floor: number): number | undefined {
	const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
	return Number.isFinite(n) && n >= floor ? n : undefined;
}

/**
 * 一条 ST regex_script → DisplayRule(两侧共用:显示向与送模向只在**筛选条件**上分家,
 * 解析口径必须一份——否则同一条规则在两条链上会长出两种样子)。
 * 坏条目返回 null 并 warn(side 只进 warn 文案)。
 */
function parseRuleShape(r: Record<string, unknown>, side: string): DisplayRule | null {
	const label = String(r.scriptName ?? "?");
	const subMode = typeof r.substituteRegex === "number" && r.substituteRegex > 0 ? r.substituteRegex : undefined;
	const find = typeof r.findRegex === "string" ? r.findRegex : "";
	if (!find.trim()) return null;
	const parsed = parseFindRegex(find);
	if (!parsed) {
		console.warn(`[cardfront] 规则「${label}」正则无法解析,跳过${side}`);
		return null;
	}
	const trim = Array.isArray(r.trimStrings) ? r.trimStrings.filter((t): t is string => typeof t === "string" && t !== "") : [];
	const minDepth = depthField(r.minDepth, -1);
	const maxDepth = depthField(r.maxDepth, 0);
	return {
		name: typeof r.scriptName === "string" ? r.scriptName : "",
		source: parsed.source,
		flags: parsed.flags,
		replace: typeof r.replaceString === "string" ? r.replaceString : "",
		...(trim.length > 0 ? { trim } : {}),
		...(minDepth !== undefined ? { minDepth } : {}),
		...(maxDepth !== undefined ? { maxDepth } : {}),
		...(subMode !== undefined ? { substituteRegex: subMode } : {}),
	};
}

/**
 * 按消息深度筛规则(ST engine.js:363-371 逐条件复刻)。
 * **depth 语义**:从最新往回数,0 = 最新那条消息。
 * `depth === undefined` = 调用方不知道自己在处理第几条 → 不筛(等同没有深度限定),
 * 这样「不遍历序列」的调用点(REST 快照、整楼界面判定)行为不变。
 */
export function rulesAtDepth(rules: DisplayRule[], depth?: number): DisplayRule[] {
	if (depth === undefined) return rules;
	return rules.filter(
		(r) => !(r.minDepth !== undefined && depth < r.minDepth) && !(r.maxDepth !== undefined && depth > r.maxDepth),
	);
}

/** 规则集里有没有深度限定——没有就不必为算 depth 多走一遍(绝大多数卡走这条快路) */
export function hasDepthLimits(rules: DisplayRule[]): boolean {
	return rules.some((r) => r.minDepth !== undefined || r.maxDepth !== undefined);
}

/** 粘性正则：一律靠 lastIndex 定位，不 slice（替换串可达 MB 级，逐位置拷串就是 O(n²)） */
const OPEN_TAG_STICKY = /<([a-zA-Z][\w-]*)(?:\s[^>]*)?>/y;
const WS_STICKY = /\s*/y;

/** 从 pos 起若正好是一个闭合完整的元素,返回结束位置与标签名(同名深度配平,容忍嵌套) */
function elementAt(text: string, pos: number): { end: number; tag: string } | null {
	OPEN_TAG_STICKY.lastIndex = pos;
	const m = OPEN_TAG_STICKY.exec(text);
	if (!m) return null;
	const tag = m[1];
	const re = new RegExp(`<(/?)${tag}(?:\\s[^>]*)?>`, "gi");
	re.lastIndex = pos;
	let depth = 0;
	let t: RegExpExecArray | null;
	while ((t = re.exec(text)) !== null) {
		depth += t[1] ? -1 : 1;
		if (depth === 0) return { end: t.index + t[0].length, tag: tag.toLowerCase() };
	}
	return null; // 未闭合:不是完整元素
}

/** 越过空白与 HTML 注释,返回下一个实质字符的位置 */
function skipGap(text: string, from: number): number {
	let j = from;
	for (;;) {
		WS_STICKY.lastIndex = j;
		WS_STICKY.exec(text);
		j = WS_STICKY.lastIndex;
		if (!text.startsWith("<!--", j)) return j;
		const close = text.indexOf("-->", j + 4);
		if (close < 0) return j;
		j = close + 3;
	}
}

/** 替换串的**顶层**节点里有没有 `<style>`(嵌在某个元素内部的不算——那是它自己的事) */
function hasTopLevelStyle(replace: string): boolean {
	const text = replace.trim();
	let i = skipGap(text, 0);
	for (;;) {
		const el = elementAt(text, i);
		if (!el) return false;
		if (el.tag === "style") return true;
		i = skipGap(text, el.end);
		if (i >= text.length) return false;
	}
}

/**
 * 页面级 `<style>` → 把替换串包成一份围栏完整文档,交给现成的围栏→iframe 通道。
 *
 * 酒馆的做法是把 `<style>` percent-encode 成 `<custom-style>` 偷渡过 sanitize,再给每条
 * selector 加 `.mes_text ` 前缀、class 改名 `custom-*`(script.js:1907 encodeStyleTags)——
 * 干的正是「别让作者 CSS 漏到宿主界面上」。梨园不放开页面作用域,改用更强的隔离:
 * 连同它要装扮的 HTML 一起进 iframe,作用域天然只到框里,预设 CSS 碰不到梨园界面。
 *
 * 不包的后果实测过(某张卡的`[美化]状态栏`规则):`<style>` 被显示层的 unwrap 剥掉 →
 * 737 字 CSS 源码当正文上屏,容器 div 一起没了,只剩裸数值。
 *
 * 判据认形态不认名字:**替换串的顶层节点里出现 `<style>`,且它还不是围栏/整份文档**。
 * - 内联 `style=` 属性不是 `<style>` 元素 → 不受影响(15 条内联规则原样走老路)
 * - 已是围栏整份文档的(11 条)本来就能渲染 → 原样不动
 * - 合成的文档不带自己的基线 CSS:透明底/零边距/自动量高由 frameDoc 的 seamless 注入,
 *   样式主权留给作者(那 6 条都自带完整样式,连 `white-space:pre-line` 都写了)
 * - 前后补空行:围栏必须落在行首(findFencedHtmlDocument 要求 `^|\n`),而替换点可能在句中
 *
 * ⚠ **合成的帧必须是静态的**——这不是洁癖,是不越权:
 * `HtmlFrame` 在 seamless + 有脚本时给的 sandbox 含 `allow-same-origin`(同源脚本可读父页 DOM)。
 * 而本机制要解的是「CSS 渲染」,不是「让作者 JS 开始执行」。实测 6 条里 5 条压根没有脚本;
 * 唯一带 `<script>` 的(双人成行 `CoT-简约美化-YO`)脚本内容正是 `window.parent` + MutationObserver。
 * 那些脚本在今天也不执行(被 unwrap 成裸文本),不该因为一次 CSS 修复就获得页面级权限。故:
 * - `<script>` 元素一律不进合成文档(顺带也不再当裸 JS 上屏)
 * - 残留内联 `on*=` 事件的整条不接,原样留给老路径(宁可维持现状,不悄悄发权限)
 *
 * ⚠ 边界:包装约 110 字,若某条替换串正好在 cardSkin 的 8000 字「整页卡」阈值边缘,
 * 会把 `$&` 的展开口径推过界。实测 6 条最长 6195 字,离阈值尚远。
 */
function framePageScopedStyles(replace: string): string {
	if (!replace || !/<\s*style\b/i.test(replace)) return replace;
	// 已经是围栏 / 裸整份文档 → 现成通道已认领,别插手
	if (/(?:^|\n)```/.test(replace)) return replace;
	const t = replace.trim();
	const head = t.slice(0, 80).toLowerCase();
	if (head.startsWith("<!doctype html") || head.startsWith("<html")) return replace;
	if (!hasTopLevelStyle(t)) return replace;
	const inert = t.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "").trim();
	if (/\bon[a-z]+\s*=/i.test(inert)) return replace; // 想要交互的部件本机制不接
	return `\n\n\`\`\`html\n<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8" /></head>\n<body>\n${inert}\n</body>\n</html>\n\`\`\`\n`;
}

export function displayRules(scripts: unknown[]): DisplayRule[] {
	const out: DisplayRule[] = [];
	for (const s of scripts) {
		if (!s || typeof s !== "object") continue;
		const r = s as Record<string, unknown>;
		if (r.disabled === true) continue;
		const placement = Array.isArray(r.placement) ? r.placement : [];
		if (!placement.includes(2)) continue; // 2 = AI 输出
		if (r.promptOnly === true && r.markdownOnly !== true) continue; // 纯送模侧,见 promptRules
		const rule = parseRuleShape(r, "");
		if (!rule) continue;
		// 页面级 CSS 只在显示侧成立;promptRules 不做这一步(送模历史里不该出现围栏文档)
		out.push({ ...rule, replace: framePageScopedStyles(rule.replace) });
	}
	return out;
}

/**
 * 送模侧规则（对齐酒馆 promptOnly 语义，engine.js:352）：
 * - `promptOnly`（含纯 promptOnly）＝只改发送给模型的内容，不改聊天记录——剥 VariableCheck/w2g 等
 * - 两个 only 都没勾（破坏性）＝酒馆在 cleanUpMessage 落盘时改原文，梨园没有「原文」概念，
 *   统一归到送模侧：它们改的也是「别让模型看到」的内容
 * - `markdownOnly`（纯显示）排除——那是 displayRules 的活
 * 翻译器与显示层同一套（applyCardSkin：$1/{{match}}/trim 展开），只是规则集不同、挂在历史路径。
 */
export function placementPromptRules(scripts: unknown[], targetPlacement: number): DisplayRule[] {
	const out: DisplayRule[] = [];
	for (const s of scripts) {
		if (!s || typeof s !== "object") continue;
		const r = s as Record<string, unknown>;
		if (r.disabled === true) continue;
		const placement = Array.isArray(r.placement) ? r.placement : [];
		if (!placement.includes(targetPlacement)) continue;
		const mdOnly = r.markdownOnly === true;
		const prOnly = r.promptOnly === true;
		if (mdOnly && !prOnly) continue;
		const rule = parseRuleShape(r, "（送模侧）");
		if (rule) out.push(rule);
	}
	return out;
}

export function promptRules(scripts: unknown[]): DisplayRule[] {
	return placementPromptRules(scripts, 2);
}

/** 皮肤开关:默认开;关过的卡记在 config.cardSkinOff(路径列表,同 disabledLore 模式) */
export function isSkinEnabled(config: { card: string; cardSkinOff?: string[] }, cardPath: string): boolean {
	return !(config.cardSkinOff ?? []).includes(cardPath);
}

export function setSkinEnabled(config: RpConfig, cardPath: string, enabled: boolean): RpConfig {
	const cur = config.cardSkinOff ?? [];
	const next = enabled ? cur.filter((p) => p !== cardPath) : cur.includes(cardPath) ? cur : [...cur, cardPath];
	return { ...config, cardSkinOff: next };
}
