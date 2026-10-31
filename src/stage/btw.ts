/**
 * 扮演模式的旁路助手（/btw）：与写作模式（src/stage/agent.ts）同构的闭合四通道装配——
 * system、台前只读视野块（前情 + 世界状态 + 登场名录 + 干净剧情）、本槽内存多轮历史、本轮工具回执。
 *
 * system 槽位：SYSTEM.md（环境底座）→ 全局追加 BTW_APPEND_SYSTEM.md（空缺退随包默认）
 * → 项目局部守则 APPEND_SYSTEM.md → 项目记忆索引 MEMORY.md → 卡档案 AGENTS.md → 工作区事实。
 * 不拼卡级 APPEND_SYSTEM.md（其中常驻转译后的酒馆文风与状态栏预设，属台前演出规范而非旁路说话方式）。
 */
import { readFileSync } from "node:fs";

import { applyMacros } from "../card.ts";
import { formatState } from "../state.ts";
import type { MacroContext, WorldState } from "../types.ts";
import type { UserRules } from "../user-rules.ts";

const shippedBtwRules = (): string => readFileSync(new URL("../../assets/BTW_APPEND_SYSTEM.md", import.meta.url), "utf8");

export function btwSystemPrompt(o: {
	cwd: string;
	cardPath: string;
	cardDir?: string | null;
	chatDir?: string | null;
	userRules?: UserRules;
	chatMemoryIndex?: string;
	cardAgents?: string;
	macro: MacroContext;
}): string {
	const sections = [(o.userRules?.btw?.trim() || shippedBtwRules()).trim()];
	if (o.userRules?.chat?.trim()) sections.push(o.userRules.chat.trim());
	if (o.chatMemoryIndex?.trim()) sections.push(applyMacros(o.chatMemoryIndex.trim(), o.macro));
	if (o.cardAgents?.trim()) sections.push(applyMacros(o.cardAgents.trim(), o.macro));
	const envLines = [`工作目录：${o.cwd}`, `当前角色卡：${o.cardPath}`];
	if (o.cardDir) envLines.push(`当前卡目录：${o.cardDir}`);
	if (o.chatDir) envLines.push(`当前项目目录：${o.chatDir}`);
	sections.push(envLines.join("\n"));
	return sections.join("\n\n");
}

export function buildBtwStageBlock(o: {
	state: WorldState;
	rosterIndex?: string;
	summary?: string;
	history: Array<{ role: "user" | "assistant"; text: string }>;
	charName: string;
	userName: string;
}): string {
	const blocks: string[] = [];
	if (o.summary?.trim()) {
		blocks.push(`【前情提要】以下是更早剧情的接力摘要，是既定事实：\n\n${o.summary.trim()}`);
	}
	blocks.push(`【世界状态】\n${formatState(o.state)}`);
	if (o.rosterIndex) blocks.push(`【登场名录】${o.rosterIndex}`);
	if (o.history.length > 0) {
		const userLabel = o.userName.trim() || "用户";
		const charLabel = o.charName.trim() || "角色";
		const transcript = o.history
			.map((m) => `[${m.role === "user" ? userLabel : charLabel}]\n${m.text}`)
			.join("\n\n---\n\n");
		blocks.push(`【当前台前剧情】\n${transcript}`);
	} else {
		blocks.push("【当前台前剧情】\n（尚未开演）");
	}
	return blocks.join("\n\n");
}

/**
 * 将台前只读视野块浅拷贝前置到首条 user 消息之前：
 * - 不修改 pi 内存会话里的原消息对象（避免后续轮次重复叠加）；
 * - 第 1 轮用户问题仍位于整条消息最末尾；
 * - 同一拍内连续多轮追问或工具调用时，首条消息字节恒定，100% 命中前缀缓存。
 */
export function prependToFirstUser<T>(messages: T[], block: string): T[] {
	if (!block) return messages;
	const out = messages.slice();
	for (let i = 0; i < out.length; i++) {
		const raw = out[i] as unknown as { role?: string; content?: unknown } | undefined;
		if (!raw || raw.role !== "user") continue;
		if (typeof raw.content === "string") {
			out[i] = { ...raw, content: `${block}\n\n${raw.content}` } as unknown as T;
		} else if (Array.isArray(raw.content)) {
			const parts = raw.content.map((p) => (p && typeof p === "object" ? { ...(p as Record<string, unknown>) } : p));
			const firstText = parts.find((p) => p && typeof p === "object" && (p as { type?: unknown }).type === "text") as
				| { type: "text"; text?: string }
				| undefined;
			if (firstText) firstText.text = `${block}\n\n${firstText.text ?? ""}`;
			else parts.unshift({ type: "text", text: block });
			out[i] = { ...raw, content: parts } as unknown as T;
		} else {
			out[i] = { ...raw, content: [{ type: "text", text: block }] } as unknown as T;
		}
		break;
	}
	return out;
}
