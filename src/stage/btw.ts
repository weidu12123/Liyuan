/**
 * 扮演模式的旁路助手（/btw）：与写作模式（src/stage/agent.ts）同构的闭合四通道装配——
 * system、台前只读视野块（前情 + 世界状态 + 登场名录 + 干净剧情）、本槽内存多轮历史、本轮工具回执。
 *
 * system 槽位（回到旧版副编剧的取舍）：SYSTEM.md（环境底座）→ 卡级 APPEND_SYSTEM.md（身份/破限站）
 * → 项目局部守则 APPEND_SYSTEM.md → 剧目简介（名字/简介/性格/场景/用户人设）→ 项目记忆索引 MEMORY.md
 * → 工作区事实 → 助手身份 BTW_APPEND_SYSTEM.md（空缺退随包默认，排最后紧贴对话）。
 * 不装：卡档案 AGENTS.md（台前写作块）、全局 APPEND_SYSTEM.md、预设 after/深度段、作者正则。
 */
import { applyMacros } from "../card.ts";
import { getUiLocale, type UiLocale } from "../i18n/index.ts";
import { formatState } from "../state.ts";
import type { BtwPersonaTemplate, MacroContext, RpConfig, WorldState } from "../types.ts";
import { shippedSlotPrompt, type UserRules } from "../user-rules.ts";

const shippedBtwRules = (): string => shippedSlotPrompt("BTW_APPEND_SYSTEM.md");

/** 旁路助手默认性格设定（中文正本，当 config.btwPersona 留空时在中文界面生效） */
export const DEFAULT_BTW_PERSONA = `你是用户的看戏搭子与幕后共创朋友，和用户站在同一边聊戏。
眼光敏锐、直率真诚，有一说一，不端着架子也不说客服套话。
用自然直接的聊天口吻交流，不用括号或星号演动作旁白；闲聊吐槽时简短利落，拆解剧情或查改设定时条理清晰、直奔重点。`;

/** 旁路助手默认性格设定（英文正本） */
export const DEFAULT_BTW_PERSONA_EN = `You are the user's backstage co-creator and fellow story enthusiast, chatting on the same side of the curtain.
You are sharp-eyed, candid, and grounded — speak plainly without putting on airs or customer-support clichés.
Use a natural, direct conversational tone without bracketed or asterisked stage actions; keep banter crisp, and stay structured and to the point when breaking down plot points or editing lore.`;

export function defaultBtwPersona(locale: UiLocale = getUiLocale()): string {
	return locale === "en" ? DEFAULT_BTW_PERSONA_EN : DEFAULT_BTW_PERSONA;
}

/** 旁路助手初始内置性格模板（中文种子列表） */
export const DEFAULT_BTW_PERSONA_TEMPLATES: BtwPersonaTemplate[] = [
	{
		id: "sharp",
		name: "犀利搭子",
		content: DEFAULT_BTW_PERSONA,
	},
	{
		id: "gentle",
		name: "温柔共创",
		content:
			"你是陪伴用户沉浸看戏与共创故事的贴心搭子，温柔真诚、善解人意。\n无论用户想吐槽剧情、放飞脑洞还是微调设定，都会温和接住并捕捉其中的闪光点往下推演。\n用自然亲切的聊天口吻交流，不用括号或星号演动作旁白，聊起天来轻松温暖、细致周到。",
	},
	{
		id: "scholar",
		name: "严谨考据",
		content:
			"你是本局故事的幕后设定顾问与世界观考据搭档，逻辑严密、实事求是。\n对时间线冲突、人物弧光与设定前后一致性极其敏锐；说话干脆利落不讲废话，擅长把零散灵感整理成结构严密的设定与大纲。",
	},
];

/** 旁路助手初始内置性格模板（英文种子列表） */
export const DEFAULT_BTW_PERSONA_TEMPLATES_EN: BtwPersonaTemplate[] = [
	{
		id: "sharp",
		name: "Sharp Co-Creator",
		content: DEFAULT_BTW_PERSONA_EN,
	},
	{
		id: "gentle",
		name: "Warm Co-Writer",
		content:
			"You are a warm, attentive backstage co-writer enjoying and shaping the story alongside the user.\nWhether the user wants to vent about a scene, brainstorm wild ideas, or tweak lore, receive it gently, spot what shines, and build on it.\nKeep a natural, friendly conversational tone without bracketed or asterisked stage actions — relaxed, warm, and thoughtful.",
	},
	{
		id: "scholar",
		name: "Strict Lore Keeper",
		content:
			"You are the backstage lore advisor and continuity partner for this run — analytical, rigorous, and grounded in facts.\nYou have a keen eye for timeline conflicts, character arcs, and worldbuilding consistency; speak concisely without fluff, and turn scattered ideas into well-structured lore and outlines.",
	},
];

const BUILTIN_PERSONA_ZH_TO_EN = new Map<string, string>(
	DEFAULT_BTW_PERSONA_TEMPLATES.map((zh, i) => [zh.content.replace(/\r\n/g, "\n").trim(), DEFAULT_BTW_PERSONA_TEMPLATES_EN[i]!.content]),
);
const BUILTIN_PERSONA_EN_TO_ZH = new Map<string, string>(
	DEFAULT_BTW_PERSONA_TEMPLATES_EN.map((en, i) => [en.content.replace(/\r\n/g, "\n").trim(), DEFAULT_BTW_PERSONA_TEMPLATES[i]!.content]),
);

/** 解析当前生效的助手性格模板列表（undefined 回落初始内置列表，已自定义则按用户列表返回，允许删空） */
export function resolveBtwPersonaTemplates(
	config?: Pick<RpConfig, "btwPersonaTemplates"> | null,
	locale: UiLocale = getUiLocale(),
): BtwPersonaTemplate[] {
	if (Array.isArray(config?.btwPersonaTemplates)) {
		return config.btwPersonaTemplates.map((t) => ({ id: t.id, name: t.name, content: t.content }));
	}
	const src = locale === "en" ? DEFAULT_BTW_PERSONA_TEMPLATES_EN : DEFAULT_BTW_PERSONA_TEMPLATES;
	return src.map((t) => ({ ...t }));
}

export function btwSystemPrompt(o: {
	cwd: string;
	cardPath: string;
	cardDir?: string | null;
	chatDir?: string | null;
	userRules?: UserRules;
	chatMemoryIndex?: string;
	cardBrief?: string;
	btwPersona?: string;
	macro: MacroContext;
}): string {
	const en = getUiLocale() === "en";
	const sections: string[] = [];
	if (o.userRules?.card?.trim()) sections.push(applyMacros(o.userRules.card.trim(), o.macro));
	if (o.userRules?.chat?.trim()) sections.push(applyMacros(o.userRules.chat.trim(), o.macro));
	if (o.cardBrief?.trim()) sections.push(o.cardBrief.trim());
	if (o.chatMemoryIndex?.trim()) sections.push(applyMacros(o.chatMemoryIndex.trim(), o.macro));
	const envLines = o.chatDir
		? [en ? `Current project asset directory (working directory): ${o.chatDir}` : `当前项目资产目录（工作目录）：${o.chatDir}`]
		: [en ? `Working directory: ${o.cwd}` : `工作目录：${o.cwd}`];
	sections.push(envLines.join("\n"));
	sections.push(applyMacros((o.userRules?.btw?.trim() || shippedBtwRules()).trim(), o.macro));
	const rawPersona = o.btwPersona?.replace(/\r\n/g, "\n").trim() ?? "";
	const persona = rawPersona
		? (en ? BUILTIN_PERSONA_ZH_TO_EN.get(rawPersona) : BUILTIN_PERSONA_EN_TO_ZH.get(rawPersona)) ?? rawPersona
		: defaultBtwPersona();
	sections.push(`${en ? "# Assistant Persona" : "# 助手性格设定"}\n\n${applyMacros(persona, o.macro)}`);
	return sections.join("\n\n");
}

/** 当前剧目与用户角色的静态背景：只取名字、简介、性格、场景与用户人设，不带台前拍法、文风与状态栏规范。 */
export function buildBtwCardBrief(o: {
	card: { name: string; description?: string; personality?: string; scenario?: string };
	userName: string;
	userPersona?: string;
	macro: MacroContext;
}): string {
	const en = getUiLocale() === "en";
	const m = (s: string) => applyMacros(s, o.macro);
	const lines: string[] = [
		en
			? `# Current Story: ${o.card.name} (User plays: ${o.userName})`
			: `# 当前剧目：${o.card.name}（用户扮演：${o.userName}）`,
	];
	if (o.userPersona?.trim()) {
		lines.push(`${en ? `## User Character (${o.userName})` : `## 用户角色设定（${o.userName}）`}\n${m(o.userPersona.trim())}`);
	}
	const parts: string[] = [];
	if (o.card.description?.trim()) parts.push(m(o.card.description.trim()));
	if (o.card.personality?.trim()) parts.push(`${en ? "### Personality" : "### 性格"}\n${m(o.card.personality.trim())}`);
	if (o.card.scenario?.trim()) parts.push(`${en ? "### Scenario" : "### 场景"}\n${m(o.card.scenario.trim())}`);
	if (parts.length > 0) {
		lines.push(`${en ? `## Character Card (${o.card.name})` : `## 角色卡设定（${o.card.name}）`}\n${parts.join("\n\n")}`);
	}
	return lines.join("\n\n");
}

export function buildBtwStageBlock(o: {
	state: WorldState;
	rosterIndex?: string;
	summary?: string;
	history: Array<{ role: "user" | "assistant"; text: string }>;
	charName: string;
	userName: string;
}): string {
	const en = getUiLocale() === "en";
	const blocks: string[] = [];
	if (o.summary?.trim()) {
		blocks.push(
			en
				? `[Recap] Continuity summary of earlier story beats (established fact):\n\n${o.summary.trim()}`
				: `【前情提要】以下是更早剧情的接力摘要，是既定事实：\n\n${o.summary.trim()}`,
		);
	}
	blocks.push(`${en ? "[World State]" : "【世界状态】"}\n${formatState(o.state)}`);
	if (o.rosterIndex) blocks.push(en ? `[Roster] ${o.rosterIndex}` : `【登场名录】${o.rosterIndex}`);
	if (o.history.length > 0) {
		const userLabel = o.userName.trim() || (en ? "User" : "用户");
		const charLabel = o.charName.trim() || (en ? "Character" : "角色");
		const transcript = o.history
			.map((m) => `[${m.role === "user" ? userLabel : charLabel}]\n${m.text}`)
			.join("\n\n---\n\n");
		blocks.push(`${en ? "[Current On-Stage Story]" : "【当前台前剧情】"}\n${transcript}`);
	} else {
		blocks.push(en ? "[Current On-Stage Story]\n(Not started yet)" : "【当前台前剧情】\n（尚未开演）");
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
