import { NATIVE_TOOL_ACCESS } from "../sandbox.ts";
import { cardTools, type CardDeps } from "../tools/card.ts";
import type { ToolContext } from "../tools/registry.ts";
import type { StageTool } from "./tools.ts";

/** agent 模式开放的 pi 原生工具＝沙箱认得的那几个（docs/PLAN-SANDBOX.md）；一份清单两处用 */
export const AUTHORING_NATIVE_TOOLS: string[] = Object.keys(NATIVE_TOOL_ACCESS);
/** card 族某件在当前依赖下可不可用 */
const cardToolAvailable = (name: string, deps: CardDeps) => {
	if (name === "card_project") return !!deps.project;
	if (name === "card_create") return !!deps.createCard;
	if (name === "card_list") return !!deps.listCards;
	return name === "card_read";
};
const context = (language: string): ToolContext => ({ surface: "authoring", language });
export function authoringTools(language: string, deps: CardDeps): StageTool[] {
	return cardTools.filter((s) => s.surfaces.includes("authoring") && cardToolAvailable(s.name, deps))
		.map((s) => ({ name: s.name, mode: s.mode, description: s.description(context(language)), parameters: s.parameters(context(language)) }));
}
export async function runAuthoringTool(name: string, args: Record<string, unknown>, language: string, deps: CardDeps) {
	const spec = cardTools.find((s) => s.name === name && s.surfaces.includes("authoring") && cardToolAvailable(s.name, deps));
	return spec?.run(args, deps, context(language));
}
