/**
 * 稿纸（draft）——RP agent 化的正文修订层（与 coding agent 的 Edit-on-workspace 同构）。
 *
 * 动机（2026-08-02 实测）：模型输出流不可逆，"打磨"只能发生在 thinking 里——改一处
 * 就得把全稿在脑内重誊一遍（25k 字 thinking 里正文出现 2 遍）。本模块把稿子交给
 * harness 持有：
 * - 草稿即正文本身：模型照常流式输出，不经工具参数，不牺牲流式体验；
 * - draft_edit 以「精确替换」补丁修订已写文字——补丁存为 rp-draft-op 隐藏消息，
 *   会话树只追加不改写，可回放、随变体分支走；
 * - 显示层（server/wire toWireHistory）与送模层（roleplay context 钩子）各自套用
 *   同一份补丁函数——两侧看到同一份定稿，原始草稿仅存于会话文件。
 *
 * 本文件零 pi 依赖，纯函数可单测。
 */

import { scanTaggedBlocks } from "./postprocess.ts";

/** 补丁隐藏消息的 customType（sendMessage display:false；wire 跳过、送模前移除） */
export const DRAFT_OP_TYPE = "rp-draft-op";

/**
 * 稿纸工件消息的 customType（v2 工件化，2026-08-02）：draft_write 把整份正文写进
 * 该消息——正文从此不再是"模型的回复"，而是后端工件；wire 把它渲染为叙事气泡，
 * 送模前转成 assistant 文本（模型在历史里看到的仍是自己的话）。
 */
export const DRAFT_DOC_TYPE = "rp-draft";

export interface DraftOp {
	old: string;
	new: string;
}

/** 追加式补丁（M2）：把缺失的整块模块（如状态栏）补到稿末 */
interface DraftAppendOp {
	append: string;
}

type AnyDraftOp = DraftOp | DraftAppendOp;

/** 补丁消息 content（JSON 字符串）→ 补丁；不合法返回 null */
export function parseDraftOp(content: unknown): AnyDraftOp | null {
	if (typeof content !== "string") return null;
	try {
		const o = JSON.parse(content) as { old?: unknown; new?: unknown; append?: unknown };
		if (typeof o.old === "string" && o.old.length > 0 && typeof o.new === "string") {
			return { old: o.old, new: o.new };
		}
		if (typeof o.append === "string" && o.append.trim().length > 0) {
			return { append: o.append };
		}
	} catch {
		// 非补丁 JSON：忽略
	}
	return null;
}

/** wire MsgLike 与 context message 的公共子集（够用即可，不引它们的类型） */
export interface DraftMsgLike {
	role?: string;
	customType?: string;
	content?: unknown;
}

const textOfParts = (content: unknown): string => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((p) =>
			p && typeof p === "object" && (p as { type?: unknown }).type === "text"
				? String((p as { text?: unknown }).text ?? "")
				: "",
		)
		.join("");
};

/** 在消息 content 里替换第一处 old（string 与 parts 两种形态）；未命中返回 null */
function replaceInContent(content: unknown, op: DraftOp): unknown | null {
	// 新文本按字面代入：走替换**函数**而非替换串，否则 op.new 里的 `$&`/`$'`/`` $` ``/`$$`
	// 会被 String.replace 当替换模式解释（正文含代码片段时真会踩到）。语义不变：仍只替第一处。
	const literal = () => op.new;
	if (typeof content === "string") {
		if (!content.includes(op.old)) return null;
		return content.replace(op.old, literal);
	}
	if (!Array.isArray(content)) return null;
	for (let i = 0; i < content.length; i++) {
		const p = content[i] as { type?: unknown; text?: unknown };
		if (p && typeof p === "object" && p.type === "text" && typeof p.text === "string" && p.text.includes(op.old)) {
			const parts = content.slice();
			parts[i] = { ...(p as object), text: (p.text as string).replace(op.old, literal) };
			return parts;
		}
	}
	return null;
}

/** 追加到消息文本末尾（string 或最后一个 text part）；无处可追返回 null */
function appendToContent(content: unknown, text: string): unknown | null {
	if (typeof content === "string") {
		return `${content}\n\n${text}`;
	}
	if (!Array.isArray(content)) return null;
	for (let i = content.length - 1; i >= 0; i--) {
		const p = content[i] as { type?: unknown; text?: unknown };
		if (p && typeof p === "object" && p.type === "text" && typeof p.text === "string") {
			const parts = content.slice();
			parts[i] = { ...(p as object), text: `${p.text}\n\n${text}` };
			return parts;
		}
	}
	return null;
}

/** 补丁可作用的目标：assistant 文本消息，或稿纸工件消息 */
function isDraftOpTarget(m: DraftMsgLike): boolean {
	if (m?.role === "assistant") return true;
	return m?.role === "custom" && m.customType === DRAFT_DOC_TYPE;
}

/**
 * 顺序应用补丁流：遇到 rp-draft-op 时，向前找最近一条含 old 的目标消息
 * （assistant 文本或 rp-draft 稿纸），替换第一处；补丁消息本身从结果中移除。
 * 非破坏（浅克隆被改的消息）。
 */
export function applyDraftOps<T extends DraftMsgLike>(messages: T[]): { messages: T[]; applied: number } {
	const out: T[] = [];
	let applied = 0;
	for (const m of messages) {
		if (m?.role === "custom" && m.customType === DRAFT_OP_TYPE) {
			const op = parseDraftOp(m.content);
			if (op) {
				for (let i = out.length - 1; i >= 0; i--) {
					const prev = out[i];
					if (!isDraftOpTarget(prev)) continue;
					if ("append" in op) {
						// 追加式：补到最近一条目标消息末尾
						const next = appendToContent(prev.content, op.append);
						if (next !== null) {
							out[i] = { ...prev, content: next };
							applied++;
						}
						break;
					}
					const next = replaceInContent(prev.content, op);
					if (next !== null) {
						out[i] = { ...prev, content: next };
						applied++;
						break;
					}
				}
			}
			continue; // 补丁条目不进入结果流
		}
		out.push(m);
	}
	return { messages: out, applied };
}

/**
 * 末端实质消息的角色——跳过稿纸工件（rp-draft / rp-draft-op）。
 * 工件直落树后可能贴在消息流末尾；续轮判定若拿"末条"当信号，末条=工件会被
 * 误判成新回合 → 全量脚手架重注 → 模型当成新拍开写（2026-08-02 实测事故）。
 */
export function lastSubstantiveRole(messages: DraftMsgLike[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m?.role === "custom" && (m.customType === DRAFT_DOC_TYPE || m.customType === DRAFT_OP_TYPE)) continue;
		return m?.role;
	}
	return undefined;
}

/**
 * 当前回合（最后一条 user 之后）的有效草稿——先套补丁再取文。
 * 有稿纸工件（rp-draft）时以**最后一份稿纸**为准（draft_write 重写即换稿）；
 * 没有稿纸时回落到 assistant 文本拼接（模型不配合工件化时的 v1 行为）。
 */
export function draftTurnText(messages: DraftMsgLike[]): string {
	const { messages: patched } = applyDraftOps(messages);
	let lastUser = -1;
	for (let i = patched.length - 1; i >= 0; i--) {
		if (patched[i]?.role === "user") {
			lastUser = i;
			break;
		}
	}
	const asstParts: string[] = [];
	let lastDraft: string | null = null;
	for (let i = lastUser + 1; i < patched.length; i++) {
		const m = patched[i];
		if (m?.role === "custom" && m.customType === DRAFT_DOC_TYPE) {
			const t = textOfParts(m.content).trim();
			if (t) lastDraft = t;
			continue;
		}
		if (m?.role !== "assistant") continue;
		const t = textOfParts(m.content).trim();
		if (t) asstParts.push(t);
	}
	return lastDraft ?? asstParts.join("\n\n");
}

/** draft_edit 定位校验（对给定草稿文本）：old 必须恰好出现一次 */
function resolveDraftEditText(turn: string, old: string): { ok: true } | { ok: false; error: string } {
	if (!old || !old.trim()) return { ok: false, error: "old 不能为空。" };
	if (!turn) return { ok: false, error: "本回合还没有可修订的正文——先把草稿写出来。" };
	let count = 0;
	let idx = turn.indexOf(old);
	while (idx !== -1 && count < 3) {
		count++;
		idx = turn.indexOf(old, idx + Math.max(1, old.length));
	}
	if (count === 0) {
		return { ok: false, error: "old 在本回合已写文本中找不到——必须与原文逐字一致（含标点空白）。请重新精确引用。" };
	}
	if (count > 1) {
		return { ok: false, error: "old 在本回合文本中出现多处——请扩大引用范围使其唯一。" };
	}
	return { ok: true };
}

/** draft_edit 落笔前的定位校验：old 在当前回合文本中必须恰好出现一次 */
export function resolveDraftEdit(messages: DraftMsgLike[], old: string): { ok: true } | { ok: false; error: string } {
	return resolveDraftEditText(draftTurnText(messages), old);
}

// ---------------- draft_edit 定位阶梯与批量套用（M-B） ----------------

/**
 * 中文标点归一：直角/弯引号、破折号、省略号、全半角空格统一。
 * 中文正文里模型引用原文时最常见的失配就是引号变体——放宽格式噪声，绝不放宽内容差异
 * （对标 Codex seek_sequence.rs 的模糊阶梯，但我们把命中级别回报给模型，它不报）。
 *
 * ⚠ 每条规则必须**逐字符一对一**（不合并、不增删）——归一后的下标要直接用回原文取子串，
 * 长度一变下标就会错位。故省略号只做 ⋯→… 的等长替换，不做 `+` 合并。
 */
function normalizePunct(s: string): string {
	return s
		.replace(/[“”„‟]/g, '"')
		.replace(/[‘’‚‛]/g, "'")
		.replace(/[「」『』]/g, '"')
		.replace(/[—－–―]/g, "—")
		.replace(/[⋯]/g, "…")
		.replace(/[ 　  ]/g, " ");
}

/** 定位命中级别——非精确命中要在 toolResult 里说明，模型才知道自己引得不准 */
type EditMatchLevel = "exact" | "trimmed" | "punct";

interface EditLocation {
	start: number;
	end: number;
	level: EditMatchLevel;
}

/** 在 text 中按阶梯定位 old 的唯一出现：精确 → 首尾 trim → 标点归一 */
export function locateEdit(text: string, old: string): { ok: true; at: EditLocation } | { ok: false; error: string } {
	if (!old || !old.trim()) return { ok: false, error: "old 不能为空。" };
	if (!text.trim()) return { ok: false, error: "工作区还没有稿件——先用 draft_write 提交初稿。" };

	const findAll = (hay: string, needle: string): number[] => {
		const hits: number[] = [];
		if (!needle) return hits;
		let i = hay.indexOf(needle);
		while (i !== -1 && hits.length <= 8) {
			hits.push(i);
			i = hay.indexOf(needle, i + 1);
		}
		return hits;
	};

	// 一级：精确
	let hits = findAll(text, old);
	if (hits.length === 1) return { ok: true, at: { start: hits[0]!, end: hits[0]! + old.length, level: "exact" } };
	if (hits.length > 1) {
		return { ok: false, error: `old 在现稿中出现 ${hits.length} 处——请扩大引用范围（前后多带一句）使其唯一。` };
	}

	// 二级：首尾 trim（模型常多带或少带首尾空白）
	const trimmed = old.trim();
	if (trimmed !== old) {
		hits = findAll(text, trimmed);
		if (hits.length === 1) {
			return { ok: true, at: { start: hits[0]!, end: hits[0]! + trimmed.length, level: "trimmed" } };
		}
		if (hits.length > 1) {
			return { ok: false, error: `old（忽略首尾空白后）在现稿中出现 ${hits.length} 处——请扩大引用范围使其唯一。` };
		}
	}

	// 三级：标点归一（引号/破折号/省略号变体）
	const normText = normalizePunct(text);
	const normOld = normalizePunct(trimmed);
	hits = findAll(normText, normOld);
	if (hits.length === 1) {
		// 归一不改变长度（全部一对一替换），下标可直接用回原文
		return { ok: true, at: { start: hits[0]!, end: hits[0]! + normOld.length, level: "punct" } };
	}
	if (hits.length > 1) {
		return { ok: false, error: `old（标点归一后）在现稿中出现 ${hits.length} 处——请扩大引用范围使其唯一。` };
	}

	return {
		ok: false,
		// 回显模型自己声称的 old（对标 Codex lib.rs:790）——让它自己看出幻觉
		error:
			`old 在现稿中找不到。你引用的是：\n「${trimmed.slice(0, 80)}${trimmed.length > 80 ? "…" : ""}」\n` +
			`须与现稿逐字一致。用 draft_search 取回精确原文，或 draft_read 通读现稿后重试。`,
	};
}

export interface DraftEditItem {
	old: string;
	new: string;
}

interface DraftEditResult {
	ok: boolean;
	/** 成功时的新全文（失败时不产出——批量原子性） */
	text?: string;
	/** 每处的结果说明（成功含命中级别，失败含原因） */
	details: string[];
}

/**
 * 批量定点替换：**先全部定位、全绿才落笔**（对标 Codex 的 verify-then-apply，
 * 任一处失败则整批不改，避免半套用的稿子）。区间重叠也判失败。
 */
export function applyDraftEdits(text: string, edits: DraftEditItem[]): DraftEditResult {
	if (edits.length === 0) return { ok: false, details: ["edits 为空——至少给一处修改。"] };

	const located: Array<{ at: EditLocation; item: DraftEditItem; idx: number }> = [];
	const details: string[] = [];
	let failed = false;

	for (let i = 0; i < edits.length; i++) {
		const it = edits[i]!;
		if (typeof it?.old !== "string" || typeof it?.new !== "string") {
			details.push(`第 ${i + 1} 处：old/new 都必须是字符串。`);
			failed = true;
			continue;
		}
		const r = locateEdit(text, it.old);
		if (!r.ok) {
			details.push(`第 ${i + 1} 处：${r.error}`);
			failed = true;
			continue;
		}
		located.push({ at: r.at, item: it, idx: i });
	}

	if (!failed) {
		// 重叠检测：按起点排序后相邻区间不得交叉
		const sorted = [...located].sort((a, b) => a.at.start - b.at.start);
		for (let i = 1; i < sorted.length; i++) {
			if (sorted[i]!.at.start < sorted[i - 1]!.at.end) {
				details.push(
					`第 ${sorted[i - 1]!.idx + 1} 处与第 ${sorted[i]!.idx + 1} 处的引用区间重叠——` +
						`请合并成一处，或缩小引用范围。`,
				);
				failed = true;
				break;
			}
		}
	}

	if (failed) {
		details.push("**整批未套用**（任一处定位失败则全部不改）——修正后重新提交整批。");
		return { ok: false, details };
	}

	// 从后往前替换，前面的下标不受影响
	const sorted = [...located].sort((a, b) => b.at.start - a.at.start);
	let out = text;
	for (const { at, item } of sorted) {
		out = out.slice(0, at.start) + item.new + out.slice(at.end);
	}

	for (const { at, item, idx } of located) {
		const lvl =
			at.level === "exact" ? "" : at.level === "trimmed" ? "（按忽略首尾空白匹配）" : "（按标点归一匹配）";
		const from = item.old.trim();
		details.push(
			`第 ${idx + 1} 处${lvl}：${from.slice(0, 24)}${from.length > 24 ? "…" : ""} → ` +
				`${item.new.slice(0, 24)}${item.new.length > 24 ? "…" : ""}`,
		);
	}
	return { ok: true, text: out, details };
}

/** Exact source substring; no ellipses or whitespace normalization inside an editable quote. */
const ctxQuote = (text: string, idx: number, len: number, pad = 8): string => {
	const from = Math.max(0, idx - pad);
	const to = Math.min(text.length, idx + len + pad);
	return text.slice(from, to);
};

/** draft_search：在现稿中定位文字，返回 ±24 字上下文引用（供 draft_edit 取精确原文） */
export function searchDraft(text: string, query: string, limit = 8): { hits: string[]; total: number } {
	if (!query.trim() || !text) return { hits: [], total: 0 };
	const hits: string[] = [];
	let total = 0;
	let i = text.indexOf(query);
	while (i !== -1) {
		total++;
		if (hits.length < limit) hits.push(ctxQuote(text, i, query.length, 24));
		i = text.indexOf(query, i + query.length);
	}
	return { hits, total };
}

// ---------------- 字数目标提取（数据投影，非检测） ----------------

export interface DraftRules {
	/** 正文字数区间（不含标签模块）——目标数据，模型经预设原文持有；harness 不回传测量 */
	wordRange?: { min: number; max: number };
}

export function emptyDraftRules(): DraftRules {
	return {};
}

	/**
 * 「成文纪律」块判定（四阶段供料，2026-08-02 用户定案）：禁词表、禁八股、比喻原则、
 * 句式禁令等——全是对"已存在文字"做手术的规则。这类块**不进写作上下文**：
 * 初稿阶段只见文风/人称/字数/剧情类要求（写顺为先），纪律块全文随 draft_write
 * 的核验报告一起返还，作为精修阶段的靶子。写作时看不到细则=脑内验算无从发生；
 * 精修时才见=目标单一。带字数要求的块永远不算纪律块（写作时必须知道目标篇幅）。
 */
export function isPoliceBlock(content: string): boolean {
	if (!content) return false;
	if (/字数|response_length|word_count/i.test(content)) return false;
	// 供给特征优先：语料/词库类块（给写作供词的）即便夹带禁用词小节也留在写作台上——
	// 扣走词库=先用错词再挨个补（2026-08-02 某预设瑟瑟语料实测误伤）
	if (/(语料|词库|多种表达|称呼：|称呼:)/.test(content)) return false;
	if (/(禁用词|词汇黑名单|厌恶的词汇|禁词表)/.test(content)) return true;
	// 英文键名的纪律块（某预设「Claude 禁词表」形态：Forbidden_Expressions /
	// Writing_Proscription / Forbidden_Syntax_Styles）——2026-08-03 分桶审查发现漏网
	if (/(forbidden_(?:expressions?|syntax|words?)|writing_proscription|banned_(?:words?|phrases?))/i.test(content)) {
		return true;
	}
	if (/比喻/.test(content) && /(频率|段落内|宁缺毋滥|比喻词不重复|只允许使用1次)/.test(content)) return true;
	if (/(不是[…….]{1,3}是|先否定[再后]?肯定)/.test(content)) return true;
	if (/(禁八股|anti.?clich)/i.test(content) && /(禁止|黑名单|自检|改写)/.test(content)) return true;
	return false;
}

/**
 * 验算指令的句级特征（M4.5 慢因 B 残余，2026-08-03）。
 *
 * 块级分流（isPoliceBlock）只能整块留或整块撤，可**留在写作台上的文风块里仍夹带
 * 「每段写完自检 X」这类指令**——它们是脑内验算的直接燃料：模型会为每一条在思考里
 * 把正文逐句过一遍。这类验算无论谁做都是白烧墙钟
 *（8/10 起 harness 的程序化验收也整体退役——落笔之后 harness 不对稿件说话）。
 *
 * 判定对象是**单句/单行**，只摘「写完回头查」，留「怎么写」：
 *   摘：「每段写完后自检是否出现禁用句式」「输出前逐条核对上述要求」「检查完再输出」
 *   留：「以直接对白为主」「用具体感官细节」「段落之间联系紧密」
 */
const AUDIT_VERBS = /(自检|自查|检查|核对|复核|检视|校验|排雷|审查|确认(?:一遍|无误|是否)|回头看|回读|重读|逐条|逐句|逐段)/;
/**
 * 只认「已有文字再回头动手」这一类时机。**动笔前的一次性读题不算**——
 * 「每次回复前梳理要点写进 <draft_notes>」是预设自己的规划区，一轮一次，
 * 正是 harness 要的形态；摘掉它等于砸预设的规划结构（2026-08-03 语料实测）。
 * 贵的是粒度：逐句、逐段、写完再审，一轮里反复起草-复查。
 */
const AUDIT_TIMING =
	/(写完|写好|输出后|完成后|结束后|回复后|每段|每一段|每句|每一句|收笔|定稿|再输出|然后输出|才能输出|才可输出|方可输出|才能结束)/;

/**
 * 「读题遵循」不算验算：`$(检查并遵循<user_def>内的要求)`、`确保输出语言为…` 这类是
 * **动笔前**的读题与合规声明，摘掉等于把预设的要求本身撕了（2026-08-03 语料实测：
 * 某预设的 draft_notes 清单大半是这个形态）。验算的定义是「对已写出的文字回头做手术」。
 */
const COMPLY_NOT_AUDIT = /(并遵循|遵循<|要求\)|确保遵循|检查开启|是否开启|开启了冲突)/;

/**
 * 单行是否为「验算指令」。要求同时命中「审查动作」与「事后时机」——
 * 只有动词（「检查设定是否冲突」属剧情理解）或只有时机（「每段聚焦一个角色」属写法）都不摘，
 * 宁可漏摘不可误伤（摘掉文风指令＝正文变差，比慢更糟）。
 */
export function isAuditLine(line: string): boolean {
	const t = line.trim();
	if (!t) return false;
	// 结构行（标签、分隔线、变量赋值）不参与判定
	if (/^[<{[]/.test(t) || /^[-=━─—\s]+$/.test(t)) return false;
	if (COMPLY_NOT_AUDIT.test(t)) return false;
	return AUDIT_VERBS.test(t) && AUDIT_TIMING.test(t);
}

/**
 * 块内句级过滤：摘掉验算指令行，保留其余原文。
 * 逐行处理（预设块几乎都是分行列点），不改动缩进与标签结构。
 * 返回 { text, dropped }——dropped 为被摘行数，0 表示原文照旧。
 */
export function stripAuditLines(content: string): { text: string; dropped: number } {
	if (!content) return { text: content, dropped: 0 };
	const lines = content.split("\n");
	const kept: string[] = [];
	let dropped = 0;
	for (const line of lines) {
		if (isAuditLine(line)) {
			dropped++;
			continue;
		}
		kept.push(line);
	}
	if (dropped === 0) return { text: content, dropped: 0 };
	// 摘行可能留下连续空行，收敛一下（不改非空行本身）
	const text = kept.join("\n").replace(/\n{3,}/g, "\n\n");
	return { text, dropped };
}

/**
 * 从预设启用块原文提取字数目标（数据，供末端注入的字数事实一行；不做任何检测）。
 *
 * 8/10 验收整体退役：禁词/比喻/句式的匹配统计连同 checkDraft 全部删除——
 * 「匹配到 N 个词」不是验收，落笔之后 harness 不再对稿件说任何话。
 */
export function extractDraftRules(blockContents: string[]): DraftRules {
	const rules = emptyDraftRules();

	for (const text of blockContents) {
		if (!text) continue;
		// 字数区间：限定在明确谈正文字数的块里（含 摘要 的 200-300 等不取）
		if (!rules.wordRange && /(正文|response_length|字数限制|字数设定|word_count)/.test(text)) {
			const m =
				/(\d{2,4})\s*(?:[-–—~～]|到|至)\s*(\d{2,4})\s*字/.exec(text) ??
				/[大]于\s*(\d{2,4})\D{0,14}?[小]于\s*(\d{2,4})/.exec(text);
			if (m) {
				const min = Number(m[1]);
				const max = Number(m[2]);
				if (Number.isFinite(min) && Number.isFinite(max) && min < max && min >= 50) {
					rules.wordRange = { min, max };
				}
			}
		}
	}

	return rules;
}


/** 剥掉全部顶层标签块与 HTML 注释后的正文 */
export function extractDraftBody(turnText: string): string {
	let t = turnText.replace(/<!--[\s\S]*?-->/g, "");
	// 顶层标签块整块剥除（状态栏/w2g/catsay/draft_notes/details 等都不算正文）
	for (let pass = 0; pass < 4; pass++) {
		const blocks = scanTaggedBlocks(t);
		if (blocks.length === 0) break;
		let out = "";
		let cursor = 0;
		for (const b of blocks) {
			if (b.start > cursor) out += t.slice(cursor, b.start);
			cursor = b.end;
		}
		if (cursor < t.length) out += t.slice(cursor);
		if (out === t) break;
		t = out;
	}
	// 残留的孤立开闭标签行
	t = t.replace(/^\s*<\/?[A-Za-z_一-鿿][\w一-鿿.-]*(\s[^>]*)?>\s*$/gm, "");
	return t.trim();
}

