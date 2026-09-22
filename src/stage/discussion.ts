/**
 * agent 模式的讨论层（docs/PLAN-AGENT-CODING.md §六）。讨论不是真相——正文在文件里，讨论历史可以像 coding agent
 * 的会话一样压缩。pi 自带的阈值压缩看不见梨园写进树的 liyuan-process 条目（它只数 message 条目），所以压缩权
 * 跟着装配权走：谁回放讨论历史，谁压缩它。判据照抄 pi（估算 token 超过 上下文窗口 − 预留 就压，保留最近约
 * keepRecentTokens 的整轮），摘要落 liyuan-discussion-summary 条目，回放从 firstKeptEntryId 起。
 */
import { authoringHistory, contextText, type ConversationEntry, type ContextMessage } from "../conversation-mode.ts";

export const DISCUSSION_SUMMARY_TYPE = "liyuan-discussion-summary";

export interface DiscussionSummaryData {
	summary: string;
	/** 从这条起的条目照常回放（与 pi compaction 同名同义） */
	firstKeptEntryId: string;
	tokensBefore?: number;
}

/** 与 pi estimateTokens 同一把尺：字符数 / 4 */
export function estimateMessageTokens(m: ContextMessage): number {
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
export function liveDiscussion<T extends ConversationEntry>(branch: T[]): { live: T[]; summary?: string } {
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

export interface DiscussionCompactPlan {
	firstKeptEntryId: string;
	/** 待摘要的讨论（已序列化） */
	conversationText: string;
	previousSummary?: string;
	tokensBefore: number;
	turns: number;
}

/**
 * 判定与切点（纯函数）。活着的讨论估算 token > contextWindow − reserveTokens 才压；从末尾按整轮（user 条目为界）
 * 往前保留到 ≥ keepRecentTokens，其余摘要。至少保留最近一轮；至少摘掉一轮，否则不压。
 */
export function planDiscussionCompaction(branch: ConversationEntry[], o: { contextWindow: number; reserveTokens?: number; keepRecentTokens?: number }): DiscussionCompactPlan | null {
	if (!(o.contextWindow > 0)) return null;
	const reserve = o.reserveTokens ?? 16384;
	const keepRecent = o.keepRecentTokens ?? 20000;
	const { live, summary } = liveDiscussion(branch);
	const messages = authoringHistory(live);
	const tokensBefore = messages.reduce((n, m) => n + estimateMessageTokens(m), 0) + Math.ceil((summary?.length ?? 0) / 4);
	if (tokensBefore <= o.contextWindow - reserve) return null;

	const turnStarts = live.map((e, i) => (e.type === "message" && (e.message as ContextMessage | undefined)?.role === "user" && e.id ? i : -1)).filter((i) => i >= 0);
	if (turnStarts.length < 2) return null;
	let cut = turnStarts.length - 1;
	let kept = 0;
	for (; cut > 0; cut--) {
		const start = turnStarts[cut]!, end = cut + 1 < turnStarts.length ? turnStarts[cut + 1]! : live.length;
		kept += authoringHistory(live.slice(start, end)).reduce((n, m) => n + estimateMessageTokens(m), 0);
		if (kept >= keepRecent) break;
	}
	if (cut <= 0) cut = 1;
	const firstKeptEntryId = live[turnStarts[cut]!]!.id!;
	const covered = authoringHistory(live.slice(0, turnStarts[cut]!));
	if (!covered.length) return null;
	return { firstKeptEntryId, conversationText: serializeDiscussion(covered), ...(summary ? { previousSummary: summary } : {}), tokensBefore, turns: cut };
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
