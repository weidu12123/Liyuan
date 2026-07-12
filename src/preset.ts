/**
 * ST 预设转换器（纯函数，零 pi 依赖）。
 *
 * 转换哲学（PLAN §2.1 / 2026-07-08 设计讨论）：ST 预设 = 内容块 + 装配逻辑的混合体。
 * 装配逻辑（marker 槽位）在本架构中就是 director 代码，一个不搬；
 * 内容块的「行为」只有一个——它在 prompt_order 里相对 chatHistory 的位置，
 * 把这个位置翻译成我们的通道（system 区 / 末端注入），文字内容原样搬运。
 *
 * 分工红线（PLAN §7）：内容原样搬运、不经 AI 润色、不做分诊删改——
 * 分诊判断交给用户（转换报告列明每块去向与长度，内容不外显）。
 */

export interface PresetBlock {
	/** ST identifier（保留以便追溯） */
	id: string;
	name: string;
	/** 递送通道：system prompt 区 / 每轮末端注入区（post-history） */
	channel: "system" | "postHistory";
	role: "system" | "user" | "assistant";
	content: string;
	enabled: boolean;
	/** in-chat 深度注入的原始 depth（v0 仅作末端排序参考） */
	depth?: number;
}

export interface RpPreset {
	name: string;
	/** 采样参数（原样搬运，键与 OpenAI 兼容体一致） */
	samplers: Record<string, number>;
	blocks: PresetBlock[];
}

export interface ReportItem {
	identifier: string;
	name: string;
	action: "system" | "postHistory" | "marker（槽位，弃）" | "禁用（保留可开启）" | "缺失定义";
	contentChars: number;
}

const SAMPLER_KEYS = [
	"temperature",
	"top_p",
	"top_k",
	"frequency_penalty",
	"presence_penalty",
	"repetition_penalty",
] as const;

/** ST 内置 marker 槽位（marker 标志缺失时的兜底名单） */
const KNOWN_MARKERS = new Set([
	"chatHistory",
	"charDescription",
	"charPersonality",
	"scenario",
	"dialogueExamples",
	"worldInfoBefore",
	"worldInfoAfter",
	"personaDescription",
]);

const asRole = (v: unknown): PresetBlock["role"] =>
	v === "user" || v === "assistant" ? v : "system";

export function convertStPreset(
	raw: Record<string, unknown>,
	presetName = "imported-preset",
): { preset: RpPreset; report: ReportItem[] } {
	const prompts = Array.isArray(raw.prompts)
		? (raw.prompts as Record<string, unknown>[]).filter((p) => p && typeof p === "object")
		: [];
	const byId = new Map<string, Record<string, unknown>>();
	for (const p of prompts) {
		if (typeof p.identifier === "string") byId.set(p.identifier, p);
	}

	// prompt_order：取默认角色（character_id 100001）的序，否则第一份
	let order: Array<{ identifier: string; enabled: boolean }> = [];
	if (Array.isArray(raw.prompt_order)) {
		const entries = raw.prompt_order as Array<Record<string, unknown>>;
		const chosen = entries.find((e) => e.character_id === 100001) ?? entries[0];
		if (chosen && Array.isArray(chosen.order)) {
			order = (chosen.order as Array<Record<string, unknown>>)
				.filter((o) => typeof o.identifier === "string")
				.map((o) => ({ identifier: o.identifier as string, enabled: o.enabled !== false }));
		}
	}
	// 无 prompt_order 时按 prompts 原序
	if (order.length === 0) {
		order = prompts
			.filter((p) => typeof p.identifier === "string")
			.map((p) => ({ identifier: p.identifier as string, enabled: true }));
	}

	const blocks: PresetBlock[] = [];
	const report: ReportItem[] = [];
	let afterChatHistory = false;

	for (const item of order) {
		const def = byId.get(item.identifier);
		if (!def) {
			report.push({ identifier: item.identifier, name: "", action: "缺失定义", contentChars: 0 });
			continue;
		}
		const name = typeof def.name === "string" ? def.name : item.identifier;
		const isMarker = def.marker === true || KNOWN_MARKERS.has(item.identifier);
		if (isMarker) {
			if (item.identifier === "chatHistory") afterChatHistory = true;
			report.push({ identifier: item.identifier, name, action: "marker（槽位，弃）", contentChars: 0 });
			continue;
		}
		const content = typeof def.content === "string" ? def.content : "";
		// in-chat 深度注入（injection_position=1）一律归末端通道
		const isDepthInjection = def.injection_position === 1;
		const channel: PresetBlock["channel"] = afterChatHistory || isDepthInjection ? "postHistory" : "system";
		const block: PresetBlock = {
			id: item.identifier,
			name,
			channel,
			role: asRole(def.role),
			content,
			enabled: item.enabled,
			...(isDepthInjection && typeof def.injection_depth === "number" ? { depth: def.injection_depth } : {}),
		};
		blocks.push(block);
		report.push({
			identifier: item.identifier,
			name,
			action: item.enabled ? channel : "禁用（保留可开启）",
			contentChars: content.length,
		});
	}

	const samplers: Record<string, number> = {};
	for (const key of SAMPLER_KEYS) {
		const v = raw[key];
		if (typeof v === "number" && Number.isFinite(v)) samplers[key] = v;
	}

	return { preset: { name: presetName, samplers, blocks }, report };
}

/** 载入我们自己的 rp-preset.json（宽容解析） */
export function normalizeRpPreset(raw: unknown): RpPreset {
	const obj = (raw ?? {}) as Partial<RpPreset>;
	const blocks = Array.isArray(obj.blocks)
		? obj.blocks.filter(
				(b): b is PresetBlock =>
					!!b && typeof b === "object" && typeof (b as PresetBlock).content === "string",
			)
		: [];
	const samplers: Record<string, number> = {};
	if (obj.samplers && typeof obj.samplers === "object") {
		for (const [k, v] of Object.entries(obj.samplers)) {
			if (typeof v === "number" && Number.isFinite(v)) samplers[k] = v;
		}
	}
	return { name: typeof obj.name === "string" ? obj.name : "preset", samplers, blocks };
}

export const enabledBlocks = (preset: RpPreset, channel: PresetBlock["channel"]): PresetBlock[] =>
	preset.blocks.filter((b) => b.enabled && b.channel === channel);
