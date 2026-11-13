/**
 * 纯酒馆浏览器透传生成执行器（第 3 步全兼容闭环）：
 * 复用 tavernStreamPipeline 提供的采样装配、ToolManager 工具汇入、SSE 解包（含 SPreset 与 tool_output_bridge）。
 */

import {
	collectRuntimeInjectedPrompts,
	emitCardRuntimeEvent,
	emitCardRuntimeEventAsync,
	type RuntimeInjectedPromptItem,
} from "./cardRuntimeFrames.ts";
import {
	applySPresetToolsAndInjections,
	extractSPresetConfig,
	runSPresetChatSquash,
	runSPresetFinalRequestProcessing,
	type SPresetOpenAiMessage,
} from "./spreset.ts";
import {
	applySamplersToOpenAiPayload,
	collectRegisteredStTools,
	executeOpenAiFetchAndConsumeStream,
} from "./tavernStreamPipeline.ts";
import { tavern_events } from "./tavernShim.ts";

interface PrepareResponse {
	ok: boolean;
	error?: string;
	model: { id: string; provider?: string; api?: string };
	messages: SPresetOpenAiMessage[];
	samplers: Record<string, number>;
	presetName: string | null;
	presetRaw: Record<string, unknown> | null;
	charName: string;
	userName: string;
}

function mergeRuntimeInjectedMessages(
	base: SPresetOpenAiMessage[],
	injected: RuntimeInjectedPromptItem[],
): SPresetOpenAiMessage[] {
	if (injected.length === 0) return base;
	const beforeItems = injected.filter((x) => x.position === "before_prompt");
	const inPromptItems = injected.filter((x) => x.position === "in_prompt");
	const inChatItems = injected.filter((x) => x.position === "in_chat");

	const result: SPresetOpenAiMessage[] = [
		...beforeItems.map((x) => ({ role: x.role, content: x.content, identifier: x.id })),
		...base,
		...inPromptItems.map((x) => ({ role: x.role, content: x.content, identifier: x.id })),
	];

	if (inChatItems.length > 0) {
		const sorted = [...inChatItems].sort((a, b) => b.depth - a.depth || a.order - b.order);
		for (const item of sorted) {
			const idx = Math.max(0, result.length - item.depth);
			result.splice(idx, 0, { role: item.role, content: item.content, identifier: item.id });
		}
	}
	return result;
}

export async function runPureTavernBrowserTurn(opts: {
	userText: string;
	reuseUserMessage?: boolean;
	reroll?: boolean;
	editUserText?: string;
	notes?: string[];
	signal: AbortSignal;
	onStreamDelta: (fullText: string, fullThinking: string) => void;
}): Promise<{ ok: boolean; aborted?: boolean; entryId?: string | null; error?: string; replyText?: string; totalMessages?: number }> {
	const prepRes = await window.fetch("/api/pure-tavern/prepare", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			userText: opts.userText,
			reuseUserMessage: opts.reuseUserMessage === true,
			...(opts.reroll ? { reroll: true } : {}),
			...(opts.editUserText ? { editUserText: opts.editUserText } : {}),
		}),
		signal: opts.signal,
	});
	const prep = (await prepRes.json()) as PrepareResponse;
	if (!prepRes.ok || !prep.ok) {
		return { ok: false, error: prep.error || `Pure tavern prepare failed (${prepRes.status})` };
	}

	await emitCardRuntimeEventAsync(tavern_events.GENERATION_STARTED, "normal", {}, false);

	const spConfig = extractSPresetConfig(prep.presetRaw);
	const injected = collectRuntimeInjectedPrompts();
	let messages = mergeRuntimeInjectedMessages(prep.messages, injected);
	if (spConfig) {
		messages = runSPresetChatSquash(messages, spConfig, { charName: prep.charName, userName: prep.userName });
	}

	const promptEventData = { chat: messages, dryRun: false };
	await emitCardRuntimeEventAsync(tavern_events.CHAT_COMPLETION_PROMPT_READY, promptEventData);

	const inferredSource =
		prep.model.api === "google-generative-ai"
			? "makersuite"
			: prep.model.api === "anthropic-messages"
				? "claude"
				: "custom";
	let payload: Record<string, unknown> = {
		model: prep.model.id,
		messages: promptEventData.chat,
		stream: true,
		chat_completion_source: inferredSource,
		type: "normal",
		...(prep.presetRaw?.squash_system_messages === true ? { squash_system_messages: true } : {}),
	};
	applySamplersToOpenAiPayload(payload, prep.samplers, prep.presetRaw);

	const collectedTools = await collectRegisteredStTools();
	if (collectedTools.length > 0) {
		payload.tools = [...(Array.isArray(payload.tools) ? (payload.tools as Array<Record<string, unknown>>) : []), ...collectedTools];
	}
	if (spConfig) {
		payload = applySPresetToolsAndInjections(payload, spConfig);
	}

	await emitCardRuntimeEventAsync(tavern_events.CHAT_COMPLETION_SETTINGS_READY, payload);
	if (spConfig) {
		payload = await runSPresetFinalRequestProcessing(payload, spConfig);
	}

	const streamRes = await executeOpenAiFetchAndConsumeStream({
		payload,
		spConfig,
		presetRaw: prep.presetRaw,
		preserveNativeToolCalls: false,
		signal: opts.signal,
		onDelta: opts.onStreamDelta,
	});

	if (!streamRes.displayText.trim() && !streamRes.rawThinking.trim()) {
		if (streamRes.aborted) {
			emitCardRuntimeEvent(tavern_events.GENERATION_STOPPED);
			return { ok: false, aborted: true };
		}
		emitCardRuntimeEvent(tavern_events.GENERATION_ENDED);
		return { ok: false, error: streamRes.errorMessage || "Model returned empty response" };
	}

	const commitRes = await window.fetch("/api/pure-tavern/commit", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			userText: opts.userText,
			assistantText: streamRes.displayText,
			thinking: streamRes.rawThinking,
			aborted: streamRes.aborted,
			reuseUserMessage: opts.reuseUserMessage === true,
			...(opts.reroll ? { reroll: true } : {}),
			...(opts.editUserText ? { editUserText: opts.editUserText } : {}),
			notes: opts.notes,
			model: prep.model,
		}),
	});
	const commitJson = (await commitRes.json().catch(() => ({}))) as {
		ok?: boolean;
		entryId?: string | null;
		totalMessages?: number;
	};
	const lastIdx = Math.max(0, (commitJson.totalMessages ?? 1) - 1);
	if (streamRes.aborted) {
		emitCardRuntimeEvent(tavern_events.GENERATION_STOPPED);
	} else {
		await emitCardRuntimeEventAsync(tavern_events.MESSAGE_RECEIVED, lastIdx, "normal");
		await emitCardRuntimeEventAsync(tavern_events.CHARACTER_MESSAGE_RENDERED, lastIdx, "normal");
		await emitCardRuntimeEventAsync(tavern_events.GENERATION_ENDED);
	}

	return {
		ok: !streamRes.errorMessage,
		aborted: streamRes.aborted,
		entryId: commitJson.entryId ?? null,
		replyText: streamRes.displayText,
		totalMessages: commitJson.totalMessages,
		...(streamRes.errorMessage ? { error: streamRes.errorMessage } : {}),
	};
}
