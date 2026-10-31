/**
 * 台上适配器（PLAN-RP-TOOLING §2.1）：统一工具层 → StageTool[] + 派发。
 *
 * 薄——只做形状转换与依赖装配，不含业务逻辑。台上工具的裸 JSON Schema 直接进
 * Context.tools，无需 typebox（D-T1）。
 */

import { findTool, toolsFor, type ToolContext, type ToolResult, type ToolSpec } from "../registry.ts";
import { loreTools, type LoreDeps } from "../lore.ts";
import { memoryTools, type MemoryDeps } from "../memory.ts";
import { cardTools, type CardDeps } from "../card.ts";
import { worldlineTools, type WorldlineDeps } from "../worldline.ts";
import { panelTools, type PanelDeps } from "../panels.ts";

/** @liyuan/ai Tool 的结构子集（与 src/stage/tools.ts 的 StageTool 同形） */
interface StageToolShape {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	mode: "read" | "write";
}

/** 台上统一层依赖（各族依赖包的并集；随里程碑推进逐族扩充） */
export type UnifiedStageDeps = LoreDeps & MemoryDeps & CardDeps & WorldlineDeps & Partial<PanelDeps>;

/** 台上可见的统一层工具（世界书族 + 向量库族 + 角色库族 + 世界线族 + 面板族） */
const ALL_TOOLS = [...loreTools, ...memoryTools, ...cardTools, ...worldlineTools, ...panelTools] as ToolSpec<UnifiedStageDeps>[];
const STAGE_SPECS: ToolSpec<UnifiedStageDeps>[] = toolsFor(ALL_TOOLS, "stage");

const ctxFor = (language: string): ToolContext => ({ surface: "stage", language });

/**
 * 依赖缺失的工具不该出现在清单里——工具存在却恒回「本环境不支持」
 * 是最糟的形态（模型会反复试）。故按注入情况过滤。
 */
function availableSpecs(deps: UnifiedStageDeps): ToolSpec<UnifiedStageDeps>[] {
	return STAGE_SPECS.filter((s) => {
		if (s.name === "lorebook_list" || s.name === "lorebook_read") return typeof deps.listLore === "function" && typeof deps.fingerprint === "function";
		if (s.name === "lorebook_toggle") return typeof deps.toggleLore === "function";
		if (s.name === "lorebook_files") return typeof deps.listBooks === "function";
		if (s.name === "lorebook_mount") return typeof deps.mountBook === "function";
		if (s.name === "memory_add") return typeof deps.addMemory === "function";
		if (s.name === "memory_list") return typeof deps.listMemory === "function";
		if (s.name === "memory_read") return typeof deps.readMemory === "function";
		if (s.name === "memory_update") return typeof deps.updateMemory === "function";
		if (s.name === "memory_delete") return typeof deps.deleteMemory === "function";
		if (s.name === "card_read") return typeof deps.readCard === "function";
		if (s.name === "worldline_list") return typeof deps.loadWorldline === "function";
		if (s.name === "worldline_store") return typeof deps.storeSave === "function";
		if (s.name === "panel_write") return typeof deps.writePanel === "function";
		if (s.name === "panel_read") return typeof deps.loadPanels === "function";
		if (s.name === "panel_close") return typeof deps.closePanel === "function";
		return true;
	});
}

/** 统一层里台上可见的工具名（引擎据此判断该走统一层还是旧派发） */
export function unifiedStageToolNames(deps: UnifiedStageDeps): Set<string> {
	return new Set(availableSpecs(deps).map((s) => s.name));
}

/** 装配成 StageTool[]（纯数据，进 Context.tools） */
export function unifiedStageTools(language: string, deps?: UnifiedStageDeps): StageToolShape[] {
	const ctx = ctxFor(language);
	const specs = deps ? availableSpecs(deps) : STAGE_SPECS;
	return specs.map((s) => ({
			name: s.name,
			mode: s.mode,
		description: s.description(ctx),
		parameters: s.parameters(ctx),
	}));
}

/** 执行一次统一层工具调用；工具名不属本层返回 null（调用方回落旧派发） */
export async function runUnifiedStageTool(
	deps: UnifiedStageDeps,
	name: string,
	args: Record<string, unknown>,
	language: string,
): Promise<ToolResult | null> {
	const spec = findTool(STAGE_SPECS, name);
	if (!spec) return null;
	return spec.run(args, deps, ctxFor(language));
}
