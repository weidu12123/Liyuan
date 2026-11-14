/**
 * 从预设 JSON 中提取纯声明式发包中转元数据（零作者词表、零前端 JS 执行）。
 *
 * 读取协议级字段：
 * - `squash_system_messages`（合并相邻 system 消息）
 * - `reasoning_effort`（思考配额透传）
 * - `assistant_prefill`（顶层末尾预填文本）
 * - `extensions.tavern_helper.scripts[].data.chat_history`（数据驱动的消息压平配置）
 */

import type { PresetDoc } from "../preset-doc.ts";

export interface ChatHistorySquashRule {
	type: "squash_into_one";
	squashRole: "system" | "user" | "assistant";
	userPrefix: string;
	userSuffix: string;
	assistantPrefix: string;
	assistantSuffix: string;
	systemPrefix: string;
	systemSuffix: string;
	delimiter: string;
}

export interface PresetRelayMeta {
	squashSystemMessages: boolean;
	reasoningEffort?: string;
	rawAssistantPrefill?: string;
	chatHistorySquash?: ChatHistorySquashRule;
}

const VALID_ROLES = new Set(["system", "user", "assistant"]);

function parseChatHistorySquash(raw: Record<string, unknown>): ChatHistorySquashRule | undefined {
	const ext = raw.extensions as Record<string, unknown> | undefined;
	const th = ext?.tavern_helper as Record<string, unknown> | undefined;
	const scripts = Array.isArray(th?.scripts) ? (th.scripts as Array<Record<string, unknown>>) : [];
	for (const s of scripts) {
		if (!s || typeof s !== "object" || s.enabled === false) continue;
		const data = s.data as Record<string, unknown> | undefined;
		if (!data || typeof data !== "object") continue;
		const ch = data.chat_history as Record<string, unknown> | undefined;
		if (!ch || typeof ch !== "object" || ch.type !== "squash_into_one") continue;
		const delimRaw = (data.delimiter as { value?: unknown } | undefined)?.value;
		const squashRole = typeof ch.squash_role === "string" && VALID_ROLES.has(ch.squash_role)
			? (ch.squash_role as "system" | "user" | "assistant")
			: "user";
		return {
			type: "squash_into_one",
			squashRole,
			userPrefix: typeof ch.user_prefix === "string" ? ch.user_prefix : "",
			userSuffix: typeof ch.user_suffix === "string" ? ch.user_suffix : "",
			assistantPrefix: typeof ch.assistant_prefix === "string" ? ch.assistant_prefix : "",
			assistantSuffix: typeof ch.assistant_suffix === "string" ? ch.assistant_suffix : "",
			systemPrefix: typeof ch.system_prefix === "string" ? ch.system_prefix : "",
			systemSuffix: typeof ch.system_suffix === "string" ? ch.system_suffix : "",
			delimiter: typeof delimRaw === "string" && delimRaw.length > 0 ? delimRaw : "\n\n",
		};
	}
	return undefined;
}

export function extractPresetRelayMeta(presetDoc: PresetDoc | null): PresetRelayMeta {
	if (!presetDoc || !presetDoc.raw || typeof presetDoc.raw !== "object") {
		return { squashSystemMessages: false };
	}
	const raw = presetDoc.raw as Record<string, unknown>;
	const squashSystemMessages = raw.squash_system_messages === true;
	const rawEffort = typeof raw.reasoning_effort === "string" ? raw.reasoning_effort.trim() : "";
	const reasoningEffort = rawEffort && rawEffort.toLowerCase() !== "auto" ? rawEffort : undefined;
	const prefillRaw = typeof raw.assistant_prefill === "string" ? raw.assistant_prefill.trim() : "";
	const chatHistorySquash = parseChatHistorySquash(raw);

	return {
		squashSystemMessages,
		...(reasoningEffort ? { reasoningEffort } : {}),
		...(prefillRaw ? { rawAssistantPrefill: prefillRaw } : {}),
		...(chatHistorySquash ? { chatHistorySquash } : {}),
	};
}
