/**
 * MCP 台上适配器：把 hub 里已连接的 MCP 工具接进 StageEngine。
 *
 * 背景（8/06 诊断）：MCP 全套接线原本挂在 `.liyuan/extensions/roleplay.ts`
 * （`pi.registerTool` + `pi.setActiveTools`），由 `src/director.ts` 把索引拼进系统提示词。
 * 009e22e 换引擎时 director.ts 删除、叙事回合改走 StageEngine（绕开 pi 会话），
 * 于是**工具清单与提示词索引双双断链**——hub 连得上，模型看不见。
 * 本文件是重新接上的那根线，形状对齐 `src/tools/adapters/stage.ts`（薄适配器，无业务逻辑）。
 *
 * 三条设计约束：
 * 1. **不 import runtime/pi**（PLAN.md D3 领域层纪律）——只依赖 src/mcp.ts。
 * 2. **启用集自己从会话树读**，不跨 jiti 边界找扩展要（[[liyuan-jiti-module-duality]]：
 *    扩展与 server 各持一份模块实例，闭包变量互不可见）。树是唯一可靠信源，
 *    且天然随 rewind/fork 走——比问扩展更干净。
 * 3. **hub 不由本模块创建**：宿主注入，避免引擎持有第二个 hub 实例（单例已挂 globalThis）。
 */

import {
	parseQualifiedMcpTool,
	parametersFromMcpSchema,
	sanitizeServerId,
	type McpToolDescriptor,
} from "../mcp.ts";

/** StageTool 同形（裸 JSON Schema 直接进 Context.tools，不经 typebox） */
export interface McpStageTool {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

/** 工具执行结果（与 tools.ts 的返回同形：text 进对话，activity 进过程条） */
interface McpStageResult {
	text: string;
	activity?: string;
	isError?: boolean;
}

/** 台上 MCP 依赖：宿主注入 hub 的两个能力（未注入 = 台上无 MCP 工具） */
export interface McpStageDeps {
	/** 本会话已连接的 MCP 工具（hub.listActiveTools 直传） */
	listTools: () => McpToolDescriptor[];
	/** 调用一次 MCP 工具（hub.callTool 直传） */
	callTool: (
		serverId: string,
		toolName: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean; details: unknown }>;
}

/** 会话树条目（只用到判定 MCP 快照所需的字段） */
interface BranchEntryLike {
	type?: string;
	customType?: string;
	data?: unknown;
}

/**
 * 从会话树读回本对话的 MCP 启用集（扩展侧 `snapshotMcpEnabled` 写的 rp-mcp 快照）。
 *
 * 取**最近一条**快照：启用集随分支走，rewind 到旧节点就该看到当时的启用集。
 * 无快照返回 null（区别于空数组「显式全关」）——调用方据此回落到 defaults。
 */
export function mcpEnabledFromBranch(branch: unknown[], mcpType: string): string[] | null {
	for (let i = branch.length - 1; i >= 0; i--) {
		const e = branch[i] as BranchEntryLike;
		if (!e || typeof e !== "object") continue;
		if (e.type !== "custom" || e.customType !== mcpType) continue;
		const data = e.data;
		if (!data || typeof data !== "object") continue;
		const enabled = (data as { enabled?: unknown }).enabled;
		if (!Array.isArray(enabled)) continue;
		return enabled.map((x) => sanitizeServerId(String(x))).filter(Boolean);
	}
	return null;
}

/**
 * 装配成 StageTool[]（纯数据）。
 *
 * 描述前缀 `[MCP:<server>]` 与旧扩展路径一致：模型据此知道这是外部服务器的工具，
 * 失败时该报错而不是换个工具重试。
 */
export function mcpStageTools(deps?: McpStageDeps): McpStageTool[] {
	if (!deps) return [];
	let tools: McpToolDescriptor[];
	try {
		tools = deps.listTools();
	} catch {
		// hub 异常不该拖垮整拍装配——没有 MCP 工具而已
		return [];
	}
	return tools.map((t) => ({
		name: t.qualifiedName,
		description: `[MCP:${t.serverId}] ${t.description || t.name}`.slice(0, 1024),
		parameters: parametersFromMcpSchema(t.inputSchema) as unknown as Record<string, unknown>,
	}));
}

/** 台上可见的 MCP 工具名集合（引擎据此路由；`mcp__` 前缀不足以判定——未连接的不在集内） */
export function mcpStageToolNames(deps?: McpStageDeps): Set<string> {
	return new Set(mcpStageTools(deps).map((t) => t.name));
}

/**
 * 执行一次 MCP 工具调用。工具名不是合法 MCP 限定名时返回 null（调用方回落其他派发）。
 *
 * 限定名可能被 hub 去重改写过（`mcp__srv__tool_2`），故**优先按 qualifiedName 反查**
 * 描述符拿真实工具名，查不到才退回解析前缀——直接把解析结果当工具名会调错。
 */
export async function runMcpStageTool(
	deps: McpStageDeps,
	name: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<McpStageResult | null> {
	const parsed = parseQualifiedMcpTool(name);
	if (!parsed) return null;

	let desc: McpToolDescriptor | undefined;
	try {
		desc = deps.listTools().find((t) => t.qualifiedName === name);
	} catch {
		desc = undefined;
	}
	const serverId = desc?.serverId ?? parsed.serverId;
	const toolName = desc?.name ?? parsed.toolName;

	try {
		const r = await deps.callTool(serverId, toolName, args ?? {}, signal);
		const text = r.content
			.map((c) => c.text)
			.join("\n")
			.trim();
		return {
			text: text || (r.isError ? "工具返回错误（无文本内容）" : "（无输出）"),
			activity: `MCP ${serverId} · ${toolName}`,
			...(r.isError ? { isError: true } : {}),
		};
	} catch (e) {
		// 抛异常也要回成工具结果：让模型看到失败原因并自己决定改道，而不是整拍崩掉
		return {
			text: `MCP 调用失败：${e instanceof Error ? e.message : String(e)}`,
			activity: `MCP ${serverId} · ${toolName}（失败）`,
			isError: true,
		};
	}
}
