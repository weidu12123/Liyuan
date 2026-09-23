/**
 * 台上领域逻辑与真实 pi 扩展的连接。这里只定义结构接口，不装载 pi。
 * roleplay 由 jiti 装载，server 由原生 ESM 装载：连接表必须跨模块实例共享。
 * 每个连接归一个会话，换会话/reload 由扩展生命周期替换或撤销。
 */
import type { StageModelLike, StageStreamEvent } from "./engine.ts";
import type { StageTool } from "./tools.ts";
import type { GateInput } from "../tools/gate.ts";
import type { ConversationMode } from "../conversation-mode.ts";

export interface StageToolResult {
	content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
	details?: unknown;
	isError?: boolean;
	terminate?: boolean;
}

export interface StageHooks {
	mode?: ConversationMode;
	systemPrompt: string;
	toolNames: string[];
	context(messages: unknown[]): unknown[];
	providerPayload(payload: unknown, model?: StageModelLike): unknown;
	update(event: StageStreamEvent): void;
	messageEnd(message: { role: string; [key: string]: unknown }): { persist: false } | undefined;
	/** 可 await：工作模式沙箱在此停下来等用户批准卡外访问（docs/PLAN-SANDBOX.md） */
	toolCall(name: string, input: Record<string, unknown>): (GateInput & { blockReason?: string }) | Promise<GateInput & { blockReason?: string }>;
	toolResult(name: string, content: Array<{ type: string; text?: string }>): void;
	turnEnd(withdrawTools: () => void): void;
	end(): Promise<void>;
	execute(name: string, id: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<StageToolResult>;
}

export interface StageConnection {
	activate(hooks: StageHooks, tools: StageTool[]): () => void;
}

const shared = globalThis as typeof globalThis & {
	__liyuanStageConnections?: Map<string, StageConnection>;
};
const connections = shared.__liyuanStageConnections ??= new Map<string, StageConnection>();

export function publishStageConnection(sessionId: string, connection: StageConnection): () => void {
	connections.set(sessionId, connection);
	return () => {
		if (connections.get(sessionId) === connection) connections.delete(sessionId);
	};
}

export function getStageConnection(sessionId: string): StageConnection | undefined {
	return connections.get(sessionId);
}
