/**
 * agent 模式的讨论层（docs/PLAN-AGENT-CODING.md §六）。讨论不是真相——正文在文件里，讨论历史可以像 coding agent
 * 的会话一样压缩。pi 自带的阈值压缩看不见梨园写进树的 liyuan-process 条目（它只数 message 条目），所以压缩权
 * 跟着装配权走：谁回放讨论历史，谁压缩它。判据照抄 pi（估算 token 超过 上下文窗口 − 预留 就压，保留最近约
 * keepRecentTokens 的整轮），摘要落 liyuan-discussion-summary 条目，回放从 firstKeptEntryId 起。
 */
import { authoringHistory, contextText, type ConversationEntry, type ContextMessage } from "../conversation-mode.ts";

export const DISCUSSION_SUMMARY_TYPE = "liyuan-discussion-summary";

/**
 * 手动压缩的地板（估算 token）：可压部分低于它不值得烧一次旁路调用。
 * 与文件压缩的 MANUAL_MIN_COMPACT_CHARS 同一精神——用户明确点了压缩，就不该拿「攒得还不够」挡回去，
 * 但仍留一个下限：几百 token 的讨论压了等于没压。
 */
export const MANUAL_MIN_DISCUSSION_TOKENS = 2000;

interface DiscussionSummaryData {
	summary: string;
	/** 从这条起的条目照常回放（与 pi compaction 同名同义） */
	firstKeptEntryId: string;
	tokensBefore?: number;
	/** 覆盖的讨论轮数（卡片显示用；老条目缺省） */
	turns?: number;
	/** 被压掉的原文规模（字；卡片显示用；老条目缺省） */
	chars?: number;
}

/** 与 pi estimateTokens 同一把尺：字符数 / 4 */
function estimateMessageTokens(m: ContextMessage): number {
	let chars = 0;
	if (m.role === "assistant" && Array.isArray(m.content)) {
		for (const b of m.content as Array<{ type?: string; text?: string; thinking?: string; name?: string; arguments?: unknown }>) {
			if (b.type === "text") chars += b.text?.length ?? 0;
			else if (b.type === "thinking") chars += b.thinking?.length ?? 0;
			else if (b.type === "toolCall") chars += (b.name?.length ?? 0) + JSON.stringify(b.arguments ?? {}).length;
		}
	} else chars = contextText(m.content).length;
	return Math.ceil(chars / 4);
}

interface UsageLike { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number }

/** prompt 侧占用（与 pi calculateContextTokens 同一口径） */
function promptTokensOf(u: UsageLike): number {
	const prompt = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
	if (prompt > 0) return prompt;
	return Math.max(0, (u.totalTokens ?? 0) - (u.output ?? 0));
}

const estimateOf = (messages: ContextMessage[], summary?: string): number =>
	messages.reduce((n, m) => n + estimateMessageTokens(m), 0) + Math.ceil((summary?.length ?? 0) / 4);

/** 讨论侧的估算占用（含摘要）——压缩前后各取一次，比值即「压掉了多少份额」 */
export function discussionTokens(branch: ConversationEntry[]): number {
	const { live, summary } = liveDiscussion(branch);
	return estimateOf(authoringHistory(live), summary);
}

/**
 * 从「送模消息流」取最近一次真实占用：最近一条带 usage 的 assistant 的 prompt 侧 token，其后消息用估算补齐
 * （与 pi estimateContextTokens 同法）。判据必须用它——估算尺子（字符/4）对中文低估近一倍，
 * 只看估算，「窗口 − 预留」这个阈值会落在真实溢出之后，压缩永远不触发（2026-10-16 实测坐实：
 * 讨论估算 28 万 token 时真实 prompt 已到 54.9 万，一次没压过）。
 * 讨论压缩与扮演压缩共用——两者的消息流来源不同（讨论走 authoringHistory(liveDiscussion)，扮演走
 * authoringHistory(branch)），但取用量的方法是同一条。
 */
export function promptTokensOfMessages(messages: ContextMessage[]): number | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]!;
		if (m.role !== "assistant") continue;
		const usage = m.usage as UsageLike | undefined;
		if (!usage) continue;
		const stop = m.stopReason as string | undefined;
		if (stop === "aborted" || stop === "error") continue;
		const tokens = promptTokensOf(usage);
		if (tokens <= 0) continue;
		let trailing = 0;
		for (let j = i + 1; j < messages.length; j++) trailing += estimateMessageTokens(messages[j]!);
		return tokens + trailing;
	}
	return null;
}

export function livePromptTokens(branch: ConversationEntry[]): number | null {
	const { live } = liveDiscussion(branch);
	return promptTokensOfMessages(authoringHistory(live));
}

const latestSummary = (branch: ConversationEntry[]): { at: number; data: DiscussionSummaryData } | null => {
	for (let i = branch.length - 1; i >= 0; i--) {
		const e = branch[i]!;
		if (e.type !== "custom" || e.customType !== DISCUSSION_SUMMARY_TYPE) continue;
		const d = e.data as Partial<DiscussionSummaryData> | undefined;
		if (d && typeof d.summary === "string" && typeof d.firstKeptEntryId === "string") return { at: i, data: d as DiscussionSummaryData };
	}
	return null;
};

/** 摘要之后仍活着的条目（无摘要＝整条分支） */
function liveDiscussion<T extends ConversationEntry>(branch: T[]): { live: T[]; summary?: string } {
	const s = latestSummary(branch);
	if (!s) return { live: branch };
	const kept = branch.findIndex((e) => e.id === s.data.firstKeptEntryId);
	return { live: branch.slice(kept >= 0 ? kept : s.at + 1), summary: s.data.summary };
}

/** agent 轮的讨论历史：摘要作首条 user，其后原样回放（authoringHistory 那条路） */
export function agentHistory(branch: ConversationEntry[]): ContextMessage[] {
	const { live, summary } = liveDiscussion(branch);
	const messages = authoringHistory(live);
	if (summary) messages.unshift({ role: "user", content: [{ type: "text", text: `【讨论摘要】以下是更早讨论的摘要：\n\n${summary}` }], timestamp: 0 });
	return messages;
}

interface DiscussionCompactPlan {
	firstKeptEntryId: string;
	/** 待摘要的讨论（已序列化） */
	conversationText: string;
	previousSummary?: string;
	/** 触发基准：真实占用（最近一次请求的 prompt 侧 usage），无 usage 时退估算 */
	tokensBefore: number;
	/** 压缩前的纯估算（字符/4）——压缩后指示器按「压掉的估算份额」折算真实占用 */
	estimatedTokens: number;
	turns: number;
}

interface DiscussionCompactOptions {
	contextWindow: number;
	reserveTokens?: number;
	keepRecentTokens?: number;
	/** 手动压缩：不等阈值，有可压的轮次就压 */
	force?: boolean;
	/** 手动压缩的地板（估算 token）：可压部分低于它不值得烧一次旁路调用 */
	minCoveredTokens?: number;
}

/**
 * 判定与切点（纯函数）。活着的讨论真实占用 > contextWindow − reserveTokens 才压；从末尾按整轮（user 条目为界）
 * 往前保留到 ≥ keepRecentTokens，其余摘要。至少保留最近一轮；至少摘掉一轮，否则不压。
 * 触发基准是真实 usage 而非估算——估算对中文低估近一倍，只看估算阈值永远落在溢出之后。
 */
export function planDiscussionCompaction(branch: ConversationEntry[], o: DiscussionCompactOptions): DiscussionCompactPlan | null {
	if (!(o.contextWindow > 0)) return null;
	const reserve = o.reserveTokens ?? 16384;
	const keepRecent = o.keepRecentTokens ?? 20000;
	const { live, summary } = liveDiscussion(branch);
	const messages = authoringHistory(live);
	const estimatedTokens = estimateOf(messages, summary);
	const real = livePromptTokens(branch);
	const tokensBefore = real ?? estimatedTokens;
	if (!o.force && tokensBefore <= o.contextWindow - reserve) return null;
	/**
	 * 保留窗口与阈值同一把尺：估算（字符/4）对中文低估近一倍，不折算就等于「保留 40k 真实 token」——
	 * 64k 窗口下压完仍在阈值之上，每拍都触发一次压缩却压不下去。
	 */
	const ratio = real !== null && estimatedTokens > 0 ? real / estimatedTokens : 1;
	const keepTarget = ratio > 0 ? Math.max(1, Math.round(keepRecent / ratio)) : keepRecent;

	const turnStarts = live.map((e, i) => (e.type === "message" && (e.message as ContextMessage | undefined)?.role === "user" && e.id ? i : -1)).filter((i) => i >= 0);
	if (turnStarts.length < 2) return null;
	let cut = turnStarts.length - 1;
	let kept = 0;
	for (; cut > 0; cut--) {
		const start = turnStarts[cut]!, end = cut + 1 < turnStarts.length ? turnStarts[cut + 1]! : live.length;
		kept += authoringHistory(live.slice(start, end)).reduce((n, m) => n + estimateMessageTokens(m), 0);
		if (kept >= keepTarget) break;
	}
	if (cut <= 0) cut = 1;
	const firstKeptEntryId = live[turnStarts[cut]!]!.id!;
	const covered = authoringHistory(live.slice(0, turnStarts[cut]!));
	if (!covered.length) return null;
	if (o.minCoveredTokens !== undefined && estimateOf(covered) < o.minCoveredTokens) return null;
	return { firstKeptEntryId, conversationText: serializeDiscussion(covered), ...(summary ? { previousSummary: summary } : {}), tokensBefore, estimatedTokens, turns: cut };
}

/** 讨论序列化：user / assistant 文本原样，工具调用与回执各压成一行（回执截 400 字） */
export function serializeDiscussion(messages: ContextMessage[]): string {
	const lines: string[] = [];
	for (const m of messages) {
		if (m.role === "user") lines.push(`用户：${contextText(m.content)}`);
		else if (m.role === "assistant" && Array.isArray(m.content)) {
			for (const b of m.content as Array<{ type?: string; text?: string; name?: string; arguments?: unknown }>) {
				if (b.type === "text" && b.text?.trim()) lines.push(`助手：${b.text}`);
				else if (b.type === "toolCall") lines.push(`[调用 ${b.name} ${JSON.stringify(b.arguments ?? {}).slice(0, 400)}]`);
			}
		} else if (m.role === "toolResult") {
			const t = contextText(m.content);
			lines.push(`[回执 ${String(m.toolName ?? "")}：${t.length > 400 ? `${t.slice(0, 400)}…` : t}]`);
		}
	}
	return lines.join("\n\n");
}

/** 摘要提示词：给旁路模型的唯一一段，不进主上下文 */
export function buildDiscussionSummaryPrompt(o: { conversationText: string; previousSummary?: string }): { systemPrompt: string; userText: string } {
	const systemPrompt = "把一段创作讨论压成接力摘要，供另一个模型接着讨论。保留：用户提出的要求与偏好、已经定下的剧情决定、尚未决定的问题、已改动过的稿子文件与改了什么。去掉：客套、重复、过程细节。用原文的语言，条目式，事实优先。";
	const userText = [
		o.previousSummary ? `<previous-summary>\n${o.previousSummary}\n</previous-summary>\n\n（上面是更早的摘要，把下面的新讨论并进去，输出合并后的完整摘要。）` : "",
		`<conversation>\n${o.conversationText}\n</conversation>`,
	].filter(Boolean).join("\n\n");
	return { systemPrompt, userText };
}
