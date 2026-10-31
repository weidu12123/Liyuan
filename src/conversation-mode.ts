/**
 * One session tree; modes select views of it, never separate conversations.
 * `agent`（docs/PLAN-AGENT-MODE.md）是子项目属性而非树上开关：正文住章文件，树上只有讨论与数据条目。
 */
export type ConversationMode = "roleplay" | "authoring" | "agent";
export const CONVERSATION_MODE_TYPE = "liyuan-mode";
export const CONVERSATION_PROCESS_TYPE = "liyuan-process";

export interface ConversationEntry {
	id?: string;
	type?: string;
	customType?: string;
	message?: unknown;
	content?: unknown;
	details?: unknown;
	data?: unknown;
	display?: boolean;
}
export interface ContextMessage {
	role: string;
	content?: unknown;
	details?: Record<string, unknown>;
	[key: string]: unknown;
}
interface ProcessRecord {
	requestId: string;
	mode: ConversationMode;
	message: ContextMessage;
}

function isConversationMode(value: unknown): value is ConversationMode {
	return value === "roleplay" || value === "authoring" || value === "agent";
}

export function conversationMode(branch: ConversationEntry[]): ConversationMode {
	for (let i = branch.length - 1; i >= 0; i--) {
		const e = branch[i];
		if (e.type !== "custom" || e.customType !== CONVERSATION_MODE_TYPE) continue;
		const mode = (e.data as { mode?: unknown } | undefined)?.mode;
		if (isConversationMode(mode)) return mode;
	}
	return "roleplay";
}

export function messageMode(message: unknown): ConversationMode {
	const mode = (message as ContextMessage | undefined)?.details?.liyuanMode;
	return mode === "authoring" || mode === "agent" ? mode : "roleplay";
}

/** Entering authoring also claims the request that caused the switch, retroactively. */
export function authoringRequestIds(branch: ConversationEntry[]): Set<string> {
	const ids = new Set<string>();
	for (const e of branch) {
		if (e.type === "message" && e.id && (e.message as ContextMessage)?.role === "user" && messageMode(e.message) === "authoring") ids.add(e.id);
		if (e.type === "custom" && e.customType === CONVERSATION_MODE_TYPE) {
			const d = e.data as { requestId?: unknown } | undefined;
			if (typeof d?.requestId === "string") ids.add(d.requestId);
		}
	}
	return ids;
}

/** Common source for story context, summaries, memory, scribe and story navigation. */
export function storyBranch<T extends ConversationEntry>(branch: T[]): T[] {
	const hidden = authoringRequestIds(branch);
	let authoring = false;
	return branch.filter((e) => {
		if (e.type === "message" && (e.message as ContextMessage)?.role === "user") authoring = hidden.has(e.id ?? "") || messageMode(e.message) === "authoring";
		if (e.type === "custom" && (e.customType === CONVERSATION_MODE_TYPE || e.customType === CONVERSATION_PROCESS_TYPE)) return false;
		// agent 讨论逐条不进 story 流，但不开维护段：章条目/账本/摘要等数据条目仍属剧情侧。
		return !authoring && messageMode(e.message) === "roleplay";
	});
}

/**
 * 工作模式已退场。树上**遗留**的 authoring 条目照旧认得（旧会话要读得回来，story 流照旧滤掉它们），
 * 但不再有新条目产生，维护段也不再进台前上下文。
 */
function processRecord(entry: ConversationEntry): ProcessRecord | undefined {
	if (entry.type !== "custom" || entry.customType !== CONVERSATION_PROCESS_TYPE) return undefined;
	const d = entry.data as ProcessRecord | undefined;
	return d && typeof d.requestId === "string" && isConversationMode(d.mode) && typeof d.message?.role === "string" ? d : undefined;
}

export function contextText(content: unknown): string {
	return typeof content === "string" ? content : Array.isArray(content)
		? content.filter((p) => p?.type === "text").map((p) => p.text ?? "").join("") : "";
}

const asUser = (text: string): ContextMessage => ({ role: "user", content: [{ type: "text", text }], timestamp: 0 });
const asAssistant = (text: string): ContextMessage => ({
	role: "assistant", content: [{ type: "text", text }], timestamp: 0, stopReason: "stop",
	api: "openai-completions", provider: "history", model: "history",
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});

/**
 * 原始过程回放：native 调用/回执成对重放＋原文本，不过 RP 清洗、不过作者正则。
 *
 * 名字里的 authoring 是工作模式留下的旧名（刀 2 后工作模式已退场）：**今天的唯一消费者是
 * agent 模式的讨论层**（src/stage/discussion.ts 的 agentHistory／讨论压缩，engine 的 agent 轮装配）。
 * 它回放的是「树上的原始过程」，与「谁在写卡」无关——故刀 2 留，不随工作模式删。
 */
export function authoringHistory(branch: ConversationEntry[]): ContextMessage[] {
	const messages: ContextMessage[] = [];
	let rawFinal: ContextMessage | undefined;
	let hasRecords = false;
	const results = new Set<string>();
	for (const e of branch) {
		const record = processRecord(e);
		if (record) {
			hasRecords = true;
			messages.push(structuredClone(record.message));
			if (record.message.role === "assistant") rawFinal = record.message;
			if (record.message.role === "toolResult") results.add(String(record.message.toolCallId));
			continue;
		}
		if (e.type === "message" && e.message) {
			const m = e.message as ContextMessage;
			if (m.role === "user") { rawFinal = undefined; hasRecords = false; results.clear(); }
			// Display receipts aggregate the same exchanges; replay them only once.
			if (m.details?.liyuanAuthoringReply) continue;
			if (m.role === "assistant" && rawFinal && contextText(m.content) === contextText(rawFinal.content)) continue;
			if (m.role === "toolResult" && results.has(String(m.toolCallId))) continue;
			if (["user", "assistant", "toolResult"].includes(m.role)) messages.push(structuredClone(m));
			continue;
		}
		if (e.type === "custom_message") {
			if (e.customType === "rp-greeting" || e.customType === "rp-edited-reply") messages.push(asAssistant(contextText(e.content)));
			else if (e.customType === "rp-import") messages.push(asUser(contextText(e.content)));
		}
		// Old diagnostics are textual records, not fabricated native tool exchanges.
		if (!hasRecords && e.type === "custom" && e.customType === "rp-text-debug") {
			const rows = (e.data as { beatLog?: Array<{ ev?: string; data?: string }> } | undefined)?.beatLog;
			const logs = rows?.filter((r) => (r.ev === "tool_call" || r.ev === "tool_result") && typeof r.data === "string");
			if (logs?.length) messages.push(asUser(`【旧会话操作记录】\n${logs.map((r) => `${r.ev}: ${r.data}`).join("\n")}`));
		}
	}
	return messages;
}

/** Annotates a display view without changing canonical user messages. */
export function displayConversationBranch<T extends ConversationEntry>(branch: T[]): T[] {
	const hidden = authoringRequestIds(branch);
	let authoring = false;
	return branch.map((e) => {
		const m = e.type === "message" ? e.message as ContextMessage | undefined : undefined;
		if (m?.role === "user") authoring = hidden.has(e.id ?? "") || messageMode(m) === "authoring";
		return m && authoring ? { ...e, message: { ...m, details: { ...m.details, liyuanMode: "authoring" } } } : e;
	});
}
