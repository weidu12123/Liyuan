/**
 * agent 模式的轮（docs/PLAN-AGENT-CODING.md §六）：送模内容只有四条通道——system、项目状态块（与扮演同一份数据，
 * 多带稿子目录，不带正文）、讨论历史（agentHistory 回放）、本轮工具回执。在此声明为闭合集合；任何「在 X 时机再塞一段」
 * 都不在这里发生。
 *
 * system 的槽位与扮演同构，只换一格：SYSTEM.md（环境底座，roleplay 扩展垫在最前）→ 全局追加（扮演读 APPEND_SYSTEM.md，
 * agent 读 AGENT_APPEND_SYSTEM.md，二选一）→ 卡 APPEND_SYSTEM.md → 卡 AGENTS.md → 工作区事实。
 */
import { readFileSync } from "node:fs";

import { applyMacros } from "../card.ts";
import { formatState } from "../state.ts";
import type { MacroContext, WorldState } from "../types.ts";
import type { UserRules } from "../user-rules.ts";
import { formatStoryIndex, type StoryFile } from "./story-history.ts";
import type { StageTool } from "./tools.ts";

/** 用户槽位空缺（删了或清空）时退回随包默认值——与 SYSTEM.md 缺席退随包骨架同一规则 */
const shippedAgentRules = (): string => readFileSync(new URL("../../assets/AGENT_APPEND_SYSTEM.md", import.meta.url), "utf8");

export function agentSystemPrompt(o: { cwd: string; cardPath: string; storyDir: string; userRules?: UserRules; cardAgents?: string; macro: MacroContext }): string {
	const sections = [(o.userRules?.agent?.trim() || shippedAgentRules()).trim()];
	if (o.userRules?.card?.trim()) sections.push(o.userRules.card.trim());
	if (o.cardAgents?.trim()) sections.push(applyMacros(o.cardAgents.trim(), o.macro));
	sections.push(`工作目录：${o.cwd}\n当前角色卡：${o.cardPath}\n稿子目录：${o.storyDir}`);
	return sections.join("\n\n");
}

/** 项目状态块：前情（最早）→ 账本 → 名录 → 稿子目录（紧邻用户这轮的话）。全是数据块，语义在 AGENT_APPEND_SYSTEM.md 一次说清。 */
export function buildAgentStateBlock(o: { state: WorldState; rosterIndex?: string; summary?: string; residentSummary?: string; files: StoryFile[] }): string {
	const blocks: string[] = [];
	const past = [o.summary, o.residentSummary].filter(Boolean);
	if (past.length) blocks.push(`【前情提要】以下是更早剧情的接力摘要，是既定事实：\n\n${past.join("\n\n")}`);
	blocks.push(`【世界状态】\n${formatState(o.state)}`);
	if (o.rosterIndex) blocks.push(`【登场名录】${o.rosterIndex}`);
	blocks.push(formatStoryIndex(o.files));
	return blocks.join("\n\n");
}

/** 讨论区的 ask：没有拍、没有稿件版本，只是把选择交给用户。 */
export const AGENT_ASK_TOOL: StageTool = {
	name: "ask", mode: "read",
	description: "把该由用户拍板的选择交给用户：一句话说清局面，给 2~4 个具体、彼此不同的选项，用户作答后继续。用户点了停止＝本轮就此结束。",
	parameters: {
		type: "object",
		properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } } },
		required: ["question", "options"],
	},
};
