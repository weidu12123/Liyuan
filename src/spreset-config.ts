/**
 * SPreset 配置结构提取（纯数据解析，前后端共用，零浏览器依赖）。
 */

export interface SPresetChatSquashConfig {
	enabled?: boolean;
	conditional_enabled?: boolean;
	conditional_tag?: string;
	separate_chat_history?: boolean;
	user_role_system?: boolean;
	role?: "system" | "user" | "assistant";
	user_prefix?: string;
	user_suffix?: string;
	char_prefix?: string;
	char_suffix?: string;
	prefix_system?: string;
	suffix_system?: string;
	enable_squashed_separator?: boolean;
	squashed_separator_regex?: boolean;
	squashed_separator_string?: string;
	squashed_post_script_enable?: boolean;
	squashed_post_script?: string;
}

export interface SPresetToolBindingItem {
	enabled?: boolean;
	code?: string;
	form?: {
		name?: string;
		description?: string;
		parameters?: Array<{ name: string; type?: string; description?: string; required?: boolean }>;
	};
}

export interface SPresetConfig {
	ChatSquash?: SPresetChatSquashConfig;
	ToolBindings?: Record<string, SPresetToolBindingItem>;
	MessageInjections?: Record<string, {
		enabled?: boolean;
		reasoning?: string;
		signature?: string;
		toolCalls?: Array<Record<string, unknown>>;
		toolResults?: Array<Record<string, unknown>>;
	}>;
	FinalRequestProcessing?: {
		enabled?: boolean;
		script?: string;
	};
	OutputPreprocessing?: {
		enabled?: boolean;
		script?: string;
		consumeToolCalls?: boolean;
		toolCallFormatter?: {
			enabled?: boolean;
			script?: string;
		};
	};
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** 从预设原文提取并合并 SPreset 配置（优先 extensions.SPreset，辅以 SPresetSettings 条目） */
export function extractSPresetConfig(presetRaw: Record<string, unknown> | null | undefined): SPresetConfig | null {
	if (!presetRaw || typeof presetRaw !== "object") return null;
	let fromPrompt: Record<string, unknown> | null = null;
	if (Array.isArray(presetRaw.prompts)) {
		const spEntry = (presetRaw.prompts as Array<Record<string, unknown>>).find(
			(p) => p && typeof p === "object" && p.identifier === "SPresetSettings",
		);
		if (spEntry && typeof spEntry.content === "string" && spEntry.content.trim().startsWith("{")) {
			try {
				const parsed = JSON.parse(spEntry.content);
				if (isObj(parsed)) fromPrompt = parsed;
			} catch {
				/* ignore bad json */
			}
		}
	}
	const ext = isObj(presetRaw.extensions) ? (presetRaw.extensions as Record<string, unknown>) : null;
	const fromExt = ext && isObj(ext.SPreset) ? (ext.SPreset as Record<string, unknown>) : null;
	if (!fromPrompt && !fromExt) return null;
	return {
		...(fromPrompt ?? {}),
		...(fromExt ?? {}),
	} as SPresetConfig;
}
