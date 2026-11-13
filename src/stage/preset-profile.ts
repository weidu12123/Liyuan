/**
 * 预设破限需求画像器（纯确定性结构检测，零 AI 判断，严守铁律三）。
 *
 * 将当前预设的物理兼容需求分成三档：
 * - "direct"：无请求级脚本、无末尾预填、无消息压平——100% 走梨园原生 Node `pi` 直连（零影响）；
 * - "channel-proxy"：仅需要消息压平或非工具型请求参数/头修改——保持单阶段工具循环，只启用轻量协议增强；
 * - "two-phase-bridge"：存在 SPreset 强破限、假工具脚本、Partial/Assistant 末尾预填——启用「Phase 1 探索取证 → Phase 2 浏览器中转交稿」两段模式。
 */

import { normalizeRpPreset } from "../preset.ts";
import { rpEntries, stEntries, type AssemblyEntry } from "../preset-assemble.ts";
import type { PresetDoc } from "../preset-doc.ts";
import { extractSPresetConfig } from "../spreset-config.ts";
import type { RpConfig } from "../types.ts";

export type LiyuanExecutionProfile = "direct" | "channel-proxy" | "two-phase-bridge";

export interface PresetBreakthroughProfile {
	mode: LiyuanExecutionProfile;
	reasons: string[];
	squashSystemMessages: boolean;
	hasAssistantPrefill: boolean;
	hasSPreset: boolean;
	hasToolSpoofScript: boolean;
	hasRequestHookScript: boolean;
}

function detectTrailingAssistantPrefill(entries: AssemblyEntry[], raw: Record<string, unknown>): boolean {
	if (typeof raw.assistant_prefill === "string" && raw.assistant_prefill.trim().length > 0) {
		return true;
	}
	let afterHistory = false;
	const afterRoles: Array<"system" | "user" | "assistant"> = [];
	for (const e of entries) {
		if (!e.enabled || e.missing || e.identifier === "SPresetSettings") continue;
		if (e.marker || e.identifier === "chatHistory") {
			if (e.identifier === "chatHistory") afterHistory = true;
			continue;
		}
		if (!afterHistory || e.injectionPosition === 1) continue;
		if (!e.content.trim()) continue;
		afterRoles.push(e.role);
	}
	return afterRoles.length > 0 && afterRoles[afterRoles.length - 1] === "assistant";
}

function hasEnabledSPresetBreakthrough(raw: Record<string, unknown>): boolean {
	const sp = extractSPresetConfig(raw);
	if (!sp) return false;
	if (sp.ChatSquash?.enabled) return true;
	if (sp.FinalRequestProcessing?.enabled) return true;
	if (sp.OutputPreprocessing?.enabled) return true;
	if (sp.ToolBindings && Object.values(sp.ToolBindings).some((t) => t && t.enabled !== false)) return true;
	if (sp.MessageInjections && Object.values(sp.MessageInjections).some((m) => m && m.enabled !== false)) return true;
	return false;
}

export function detectPresetBreakthroughProfile(
	presetDoc: PresetDoc | null,
	config?: Pick<RpConfig, "breakthroughRelay">,
): PresetBreakthroughProfile {
	const override = config?.breakthroughRelay ?? "auto";
	const empty: PresetBreakthroughProfile = {
		mode: override === "always" ? "two-phase-bridge" : "direct",
		reasons: override === "always" ? ["user-forced-always"] : [],
		squashSystemMessages: false,
		hasAssistantPrefill: false,
		hasSPreset: false,
		hasToolSpoofScript: false,
		hasRequestHookScript: false,
	};
	if (!presetDoc || override === "off") {
		if (override === "off") empty.reasons = ["user-forced-off"];
		return empty;
	}

	const raw = (presetDoc.raw ?? {}) as Record<string, unknown>;
	const entries = presetDoc.kind === "st" ? stEntries(raw) : rpEntries(normalizeRpPreset(raw));

	const squashSystemMessages = raw.squash_system_messages === true;
	const hasAssistantPrefill = detectTrailingAssistantPrefill(entries, raw);
	const hasSPreset = hasEnabledSPresetBreakthrough(raw);

	const ext = raw.extensions as Record<string, unknown> | undefined;
	const th = ext?.tavern_helper as Record<string, unknown> | undefined;
	const scripts = Array.isArray(th?.scripts) ? (th.scripts as Array<Record<string, unknown>>) : [];

	let hasToolSpoofScript = false;
	let hasRequestHookScript = false;
	for (const s of scripts) {
		if (!s || typeof s !== "object" || s.enabled === false || typeof s.content !== "string") continue;
		const src = s.content;
		if (/registerFunctionTool|tool_choice|forcedTool|\.partial\s*=/.test(src)) {
			hasToolSpoofScript = true;
		}
		if (/window\.fetch|globalThis\.fetch|CHAT_COMPLETION_SETTINGS_READY|CHAT_COMPLETION_PROMPT_READY/.test(src)) {
			hasRequestHookScript = true;
		}
	}

	const reasons: string[] = [];
	if (hasSPreset) reasons.push("spreset");
	if (hasToolSpoofScript) reasons.push("tool-spoof-or-partial-script");
	if (hasAssistantPrefill) reasons.push("assistant-prefill");
	if (hasRequestHookScript) reasons.push("request-hook-script");
	if (squashSystemMessages) reasons.push("squash-system-messages");
	if (override === "always") reasons.push("user-forced-always");

	let mode: LiyuanExecutionProfile = "direct";
	if (override === "always" || hasSPreset || hasToolSpoofScript || hasAssistantPrefill) {
		mode = "two-phase-bridge";
	} else if (hasRequestHookScript || squashSystemMessages) {
		mode = "channel-proxy";
	}

	return {
		mode,
		reasons,
		squashSystemMessages,
		hasAssistantPrefill,
		hasSPreset,
		hasToolSpoofScript,
		hasRequestHookScript,
	};
}
