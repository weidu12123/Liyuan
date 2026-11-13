/**
 * 一档卡皮肤:在显示文本上应用卡作者的美化正则(spec §7 P1)。
 * 纯函数、无 DOM——server wire 与 web 显示管线共用。
 * 只跑显示层——送模历史在 cleanAssistantText 路径，不经此处。
 * 单条规则失败静默跳过:显示层宁可少化妆,不能白屏。
 */

import type { DisplayRule } from "./cardfront.ts";

const escapeReg = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 超过此长度视为「整页/程序卡」替换串：`$` 一律按字面，只认 {{match}} */
const LITERAL_REPLACE_THRESHOLD = 8_000;

function substMacros(text: string, macros: { charName: string; userName: string }, forRegex: boolean): string {
	const char = forRegex ? escapeReg(macros.charName) : macros.charName;
	const user = forRegex ? escapeReg(macros.userName) : macros.userName;
	// 名字必须按字面代入：走替换**函数**而非替换串，否则名字里的 `$&`/`$'`/`` $` ``/`$$`
	// 会被 String.replace 当替换模式解释（与 expandSkinReplacement 防的是同一件事）。
	return text.replace(/\{\{\s*char\s*\}\}/gi, () => char).replace(/\{\{\s*user\s*\}\}/gi, () => user);
}

/**
 * 展开捕获组 / {{match}}（短模板与长程序卡共用）。
 *
 * **不可**把模板直接交给 `String.replace(re, template)`：
 * JS 会把 `$'`（后文）、`$``（前文）当特殊序列。
 * 某程序卡的 replaceString 里有字面量 `'$'`，会被吃坏。
 *
 * 规则：
 * - 始终展开：`$$` → `$`；`$1`…`$n`（n ≤ 实际捕获组数）→ 对应捕获
 * - 长模板（≥8KB 程序卡 HTML）**不**展开 `$&`：卡内常有字面 `\$&` 片段，展开会毁掉 JS
 * - 短模板展开 `$&` → 整段命中
 * - **永不**展开 `$'` / `$``（本函数不匹配它们）
 *
 * 某卡的状态栏模板 >8KB 且依赖 `rawData = \`$2\``——若长串一律不展开 $n，
 * 会变成字面 `$2` → 状态栏空、源码泄漏。故长串也必须展开有效 $n。
 *
 * `trim`（ST trimStrings）只作用于**代入的捕获组/整段命中**，不动模板里的字面文本——
 * 与 ST `filterString`（engine.js:457，逐条 replaceAll 删除）同义。
 */
export function expandSkinReplacement(
	template: string,
	match: string,
	captures: Array<string | undefined>,
	trim?: string[],
): string {
	const cut = (s: string): string => {
		if (!trim || trim.length === 0) return s;
		let out = s;
		for (const t of trim) out = out.split(t).join("");
		return out;
	};
	const withMatch = template.replace(/\{\{\s*match\s*\}\}/gi, () => cut(match));
	const isLong = template.length >= LITERAL_REPLACE_THRESHOLD;
	return withMatch.replace(/\$(\$|&|\d{1,2})/g, (whole, kind: string) => {
		if (kind === "$") return "$";
		if (kind === "&") {
			// 长程序卡：保留字面 $&；短模板：整段命中
			return isLong ? whole : cut(match);
		}
		const n = Number(kind);
		// 仅当本规则真有该捕获组时才展开；否则保留字面 $1（程序卡内可能出现）
		if (n >= 1 && n <= captures.length) {
			return cut(captures[n - 1] ?? "");
		}
		return whole;
	});
}

/**
 * 从正则源里提取**必须出现的字面串**（找不到就 null）。用于运行前预筛：
 * 文本里没有这个串 ⇒ 这条规则**不可能匹配** ⇒ 整条跳过，不必让引擎去扫。
 *
 * 为什么必须有（8/19 实测）：作者的 CoT 隐藏成语 `([\s\S]*?)</think_fox~>` 配 `/g`，
 * 在**不含**该闭合标签的消息上是灾难性回溯——懒惰量词从每个起点一路试到文末，O(n²)。
 * 实测单条消息 43K 字 = 379 ms、87K 字 = 1539 ms、177K 字 = 8 秒；而一屏消息里
 * 开场白/整页 HTML 卡/旧楼大多**不含**思维链标签，于是「随便打开一个对话都极卡」。
 * 预筛把这类规则的成本降到一次 indexOf。
 *
 * 判据是**语法**（这个字面量是不是匹配的必要条件），不认标签名、不认作者措辞。
 * 拿不准就返回 null（照旧全跑）——宁可不优化，不可改变匹配语义：
 * - 有 `|` 分支：字面量可能只属于其中一支 ⇒ 不筛
 * - 有 `(?!` / `(?<!` 否定断言：里面的字面量是「必须不出现」⇒ 不筛
 * - 有 `(?=` / `(?<=` 断言：断言里的字与断言外的字**不连续**（`a(?=xy)b` 不要求 "xyb"）⇒ 不筛
 * - 有 `)?` / `)*` / `){0` 可选组：组内字面量非必需 ⇒ 不筛
 */
export function requiredLiteral(source: string): string | null {
	if (source.includes("|") || source.includes("(?!") || source.includes("(?<!")) return null;
	if (source.includes("(?=") || source.includes("(?<=")) return null;
	if (/\)[?*]|\)\{0/.test(source)) return null;
	let best = "";
	let run = "";
	const flush = () => {
		if (run.length > best.length) best = run;
		run = "";
	};
	for (let i = 0; i < source.length; i++) {
		const c = source[i]!;
		let lit: string | null = null;
		/** 中性且**不打断**字面串：普通分组的括号。`<\/(think_?fox~?)>` 的必要字面量是
		 * `</think`——若在 `(` 处断开就只剩 `think`，而卡的 HTML/JS 里满是 think 字样，
		 * 预筛就会放行这条贪婪正则、继续 O(n²) 空扫（8/19 CPU profile 实测 11 秒）。
		 * 能这么拼是因为上面已排除 `|`、否定断言、可选组——组边界不改变「必须出现」。 */
		let neutral = false;
		let width = 1;
		if (c === "\\") {
			const n = source[i + 1];
			width = 2;
			// \d \s \w \b \n \u… 是类/断言/转义序列，不是字面量；\< \/ \. 这类是
			lit = n && !/[dDsSwWbBnrtvfkpPxu0-9]/.test(n) ? n : null;
		} else if (c === "[") {
			// 字符类整体跳过（类里任一字符都不是「必须出现的那一个」）
			let j = i + 1;
			while (j < source.length && source[j] !== "]") j += source[j] === "\\" ? 2 : 1;
			width = j - i + 1;
		} else if (c === "(") {
			const m = /^\((\?<[^>]*>|\?[:=])?/.exec(source.slice(i));
			width = m?.[0]?.length ?? 1;
			// 普通分组（`(` `(?:` `(?<name>`）不打断；前瞻 `(?=` 打断（它匹配的是位置，不是本串的一段）
			neutral = m?.[1] !== "?=";
		} else if (c === ")") {
			neutral = true;
		} else if (c === "." || c === "^" || c === "$" || c === "?" || c === "*" || c === "+" || c === "{") {
			lit = null;
		} else {
			lit = c;
		}
		// 紧跟的量词让这个 token 变可选（? * {0,…}）⇒ 它不是必须出现的
		const next = source.slice(i + width);
		const optional = /^(?:\?|\*|\{0\s*[,}])/.test(next);
		if (lit !== null && !optional) run += lit;
		else if (!neutral || optional) flush();
		i += width - 1;
	}
	flush();
	return best.length >= 3 ? best : null;
}

/** 一块内容值得守护的最小可见字数（更短的判不出「删没了」与「本就没有」） */
const PIECE_MIN_VISIBLE = 16;
const PIECE_CHUNK = 16;

/**
 * 宽松结构扫描（**本功能私有**，不动策略引擎的 TAG_NAME）。
 *
 * 为什么另起一套：策略引擎的合法标签名不含 `~`，于是 `<think_fox~>` 在 scanTaggedBlocks
 * 眼里根本不是标签（8/19 探针实测）。这里只要求「字母/中文/下划线起头 + 不含空白与斜杠」，
 * 作者爱用的 `~` `2` 全收得住。判据是**语法**（这是不是一个成对块），不是**名字**。
 */
const LOOSE_OPEN_RE = /<([A-Za-z_一-鿿][^\s<>/]*)(\s[^<>]*)?(\/)?>/g;
const FENCE_SPAN_RE = /```[\s\S]*?```/g;

/**
 * 把全文切成**无遗漏、无重叠**的片段序列：成对标签块 / ``` 围栏 / 块之间的裸文本。
 * 拼回 pieces 得到的就是原文（守恒重建靠这一点）。
 */
function structurePieces(text: string): string[] {
	const spans: Array<{ start: number; end: number }> = [];
	const fences: Array<{ start: number; end: number }> = [];
	FENCE_SPAN_RE.lastIndex = 0;
	for (let m = FENCE_SPAN_RE.exec(text); m; m = FENCE_SPAN_RE.exec(text)) {
		fences.push({ start: m.index, end: m.index + m[0].length });
	}
	spans.push(...fences);
	let cursor = 0;
	LOOSE_OPEN_RE.lastIndex = 0;
	for (let m = LOOSE_OPEN_RE.exec(text); m; m = LOOSE_OPEN_RE.exec(text)) {
		const start = m.index;
		if (start < cursor) continue;
		if (fences.some((f) => start >= f.start && start < f.end)) continue;
		const openEnd = start + m[0].length;
		if (m[3]) {
			// 自闭合（`<StatusPlaceHolderImpl/>`）＝块就是标签本身
			spans.push({ start, end: openEnd });
			cursor = openEnd;
			continue;
		}
		const cm = new RegExp(`</${escapeReg(m[1]!)}\\s*>`, "i").exec(text.slice(openEnd));
		// 无闭合：**只跳过这个标签本身**，不像 scanTaggedBlocks 那样吃到文末——吃到文末会把
		// 后面的内容一并算进这一块，连坐判定就失准（宁可多切几片，不可把正文并进别人）
		const end = cm ? openEnd + cm.index + cm[0].length : openEnd;
		spans.push({ start, end });
		cursor = end;
	}
	spans.sort((a, b) => a.start - b.start || a.end - b.end);
	const pieces: string[] = [];
	let at = 0;
	for (const sp of spans) {
		if (sp.start < at) continue; // 被前一块覆盖（嵌套/重叠）
		if (sp.start > at) pieces.push(text.slice(at, sp.start));
		pieces.push(text.slice(sp.start, sp.end));
		at = sp.end;
	}
	if (at < text.length) pieces.push(text.slice(at));
	return pieces;
}

/** 可见字符（剥注释/脚本/样式/标签再去空白）——只用于比对「内容还在不在」，不做渲染 */
function visibleOf(text: string): string {
	return text
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
		.replace(/<style\b[\s\S]*?<\/style\s*>/gi, "")
		.replace(/<[^>]*>/g, "")
		.replace(/\s+/g, "");
}

/**
 * needle 的可见内容是否还在 haystack 里（分块取样）。
 * 作者可以给内容套标签、上色、加装饰——那些都不减字；只有「删」才会让字消失。
 */
function visibleSurvives(needleVisible: string, haystackVisible: string): boolean {
	if (needleVisible.length < PIECE_CHUNK) return true;
	for (let i = 0; i + PIECE_CHUNK <= needleVisible.length; i += PIECE_CHUNK) {
		if (haystackVisible.includes(needleVisible.slice(i, i + PIECE_CHUNK))) return true;
	}
	return false;
}

/**
 * **显示层的正文守恒**：作者正则照跑（输出形式全归作者，梨园不抢），但**不许连坐**。
 *
 * 由来（8/19）：作者的 CoT 隐藏正则成语是 `([\s\S]*?)</思维链标签>` + `/g` + 替空，
 * 即「从消息开头删到思维链闭合标签」。这在酒馆里永远精确——一条消息＝一次输出＝恰好
 * 一个思维链且在最前，删掉的正好是思维链。梨园的形态一旦让一条消息里出现第二个闭合
 * 标签（多轮产物合并、模型走 text 通道又写一遍思考），懒惰匹配在 /g 下就等于「从头删到
 * 最后一个闭合标签」，中间的正文**连坐**（三张预设同一成语，是生态级形状，不可用名单修）。
 *
 * 判据（**不认标签名、不认哪段是正文**，故不违铁律三）：
 * 把消息切成结构片段，同一套作者规则**单独**作用于某一片时删不掉它、它却在整条消息的
 * 产物里消失了 ⇒ 那不是作者要删它，是跨块连坐 ⇒ 梨园按片重跑一遍，把它带回来。
 * 作者真想删的（思维链块：规则单独作用于它时照样删空；depth 到点后作者主动收起的狐策）
 * 一律照删——它们「单独跑也没了」，判据放它们过去。
 *
 * 健康态（单思维链在最前，酒馆形态）零影响：无片段丢失，直接返回整条产物。
 * 兜底态的代价：规则改为逐片作用，**跨块生效的规则**（若有）在那一条消息上不生效——
 * 符合本层既有取舍（cardSkin.ts：宁可少化妆，不能白屏）。
 */
export function applySkinKeepingBody(
	text: string,
	rules: DisplayRule[],
	macros: { charName: string; userName: string },
): string {
	const styled = applyCardSkin(text, rules, macros);
	const pieces = structurePieces(text);
	if (pieces.length < 2) return styled;
	const styledVisible = visibleOf(styled);
	let lost = false;
	for (const p of pieces) {
		const v = visibleOf(p);
		if (v.length < PIECE_MIN_VISIBLE) continue; // 没有实质内容，不值得守
		if (visibleSurvives(v, styledVisible)) continue; // 还在产物里 → 没被删，最常见的路径
		// 这一片在整条产物里没了：只有到这一步才需要额外跑一次（健康态每条消息通常只有
		// 思维链那一片会走到这里），故整体开销≈裸跑作者正则，不为守恒付全片重跑的钱。
		if (visibleOf(applyCardSkin(p, rules, macros)).length >= PIECE_MIN_VISIBLE) {
			lost = true; // 单独跑删不掉它 ⇒ 不是作者要删它，是跨块连坐
			break;
		}
	}
	if (!lost) return styled;
	return pieces.map((p) => applyCardSkin(p, rules, macros)).join("");
}

export function applyCardSkin(
	text: string,
	rules: DisplayRule[],
	macros: { charName: string; userName: string },
): string {
	let out = text;
	let lower: string | null = null;
	for (const r of rules) {
		try {
			const source = substMacros(r.source, macros, r.substituteRegex !== 1);
			// 预筛：必须出现的字面串不在文本里 ⇒ 这条规则不可能匹配，别让引擎白扫（见 requiredLiteral）
			const lit = requiredLiteral(source);
			if (lit) {
				if (r.flags.includes("i")) {
					if (lower === null) lower = out.toLowerCase();
					if (!lower.includes(lit.toLowerCase())) continue;
				} else if (!out.includes(lit)) {
					continue;
				}
			}
			const re = new RegExp(source, r.flags);
			const template = substMacros(r.replace, macros, false);
			const before = out;
			out = out.replace(re, (match, ...args) => {
				// args: g1, g2, …, offset, input[, groupsObj]
				const last = args[args.length - 1];
				const hasNamed = typeof last === "object" && last !== null;
				const captEnd = hasNamed ? args.length - 3 : args.length - 2;
				const captures = args.slice(0, Math.max(0, captEnd)) as Array<string | undefined>;
				return expandSkinReplacement(template, match, captures, r.trim);
			});
			if (out !== before) lower = null; // 文本变了，小写缓存作废
		} catch {
			// 单条坏规则不拖累整条管线
		}
	}
	return out;
}
