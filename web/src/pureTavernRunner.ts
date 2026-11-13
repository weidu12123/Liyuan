/**
 * 纯酒馆浏览器透传生成执行器（第 3 步全兼容闭环）：
 * 1. /api/pure-tavern/prepare 取得后端按酒馆规则拼接的消息流与参数；
 * 2. 合并浏览器中动态注册的 injectPrompts / setExtensionPrompt；
 * 3. 执行 SPreset (ChatSquash / ToolBindings / MessageInjections)；
 * 4. 派发 CHAT_COMPLETION_PROMPT_READY 与 CHAT_COMPLETION_SETTINGS_READY（原地可改）；
 * 5. 执行 SPreset.FinalRequestProcessing；
 * 6. 走全局 window.fetch('/api/backends/chat-completions/generate')（触发所有 fetch 劫持脚本）；
 * 7. 解析标准 SSE（含 tool_calls 实时流式消费与 SPreset.OutputPreprocessing 解包）；
 * 8. /api/pure-tavern/commit 落树并按酒馆生命周期派发 MESSAGE_RECEIVED / GENERATION_ENDED。
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
	runSPresetOutputPreprocessing,
	type SPresetOpenAiMessage,
	type SPresetOpenAiToolCall,
} from "./spreset.ts";
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

function applySamplersToOpenAiPayload(payload: Record<string, unknown>, samplers: Record<string, number>, presetRaw: Record<string, unknown> | null) {
	const num = (k: string): number | undefined => {
		const v = samplers[k] ?? (presetRaw ? presetRaw[k] : undefined);
		return typeof v === "number" && Number.isFinite(v) ? v : undefined;
	};
	const temp = num("temperature") ?? num("temp_openai");
	if (temp !== undefined) payload.temperature = temp;
	const topP = num("top_p") ?? num("top_p_openai");
	if (topP !== undefined) payload.top_p = topP;
	const freq = num("frequency_penalty") ?? num("freq_pen_openai");
	if (freq !== undefined) payload.frequency_penalty = freq;
	const pres = num("presence_penalty") ?? num("pres_pen_openai");
	if (pres !== undefined) payload.presence_penalty = pres;
	const maxTok = num("openai_max_tokens") ?? num("max_tokens");
	if (maxTok !== undefined && maxTok > 0) payload.max_tokens = Math.trunc(maxTok);
	const seed = num("seed");
	if (seed !== undefined && seed >= 0) payload.seed = Math.trunc(seed);
	if (presetRaw && typeof presetRaw.reasoning_effort === "string" && presetRaw.reasoning_effort !== "auto") {
		payload.reasoning_effort = presetRaw.reasoning_effort;
	}
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
	};
	applySamplersToOpenAiPayload(payload, prep.samplers, prep.presetRaw);
	// 汇入脚本通过 SillyTavern.getContext().registerFunctionTool 注册的工具（如《我即浪潮》wave_context_reference）
	const stCtx = (window as unknown as { SillyTavern?: { getContext?: () => { ToolManager?: { tools?: Array<{ shouldRegister?: () => boolean | Promise<boolean>; toFunctionOpenAI?: () => Record<string, unknown>; name?: string; description?: string; parameters?: Record<string, unknown> }> } } } }).SillyTavern?.getContext?.();
	const registeredTools = stCtx?.ToolManager?.tools;
	if (Array.isArray(registeredTools) && registeredTools.length > 0) {
		const collectedTools = Array.isArray(payload.tools) ? [...(payload.tools as Array<Record<string, unknown>>)] : [];
		for (const tool of registeredTools) {
			if (!tool) continue;
			if (typeof tool.shouldRegister === "function") {
				try {
					if (!(await tool.shouldRegister())) continue;
				} catch {
					continue;
				}
			}
			const fnObj =
				typeof tool.toFunctionOpenAI === "function"
					? tool.toFunctionOpenAI()
					: tool.name
						? { type: "function", function: { name: tool.name, description: tool.description ?? "", parameters: tool.parameters ?? { type: "object", properties: {} } } }
						: null;
			if (fnObj) collectedTools.push(fnObj);
		}
		if (collectedTools.length > 0) payload.tools = collectedTools;
	}
	if (spConfig) {
		payload = applySPresetToolsAndInjections(payload, spConfig);
	}

	await emitCardRuntimeEventAsync(tavern_events.CHAT_COMPLETION_SETTINGS_READY, payload);
	if (spConfig) {
		payload = await runSPresetFinalRequestProcessing(payload, spConfig);
	}

	let rawText = "";
	let rawThinking = "";
	const toolCallAcc = new Map<number, { id: string; type: string; name: string; arguments: string }>();
	const spOutState = { current: {} as Record<string, unknown> };
	let displayText = "";
	let aborted = false;
	let errMsg: string | undefined;

	const currentToolCalls = (): SPresetOpenAiToolCall[] =>
		[...toolCallAcc.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([, tc]) => ({
				id: tc.id,
				type: tc.type,
				name: tc.name,
				arguments: tc.arguments,
				function: { name: tc.name, arguments: tc.arguments },
			}));

	const applyDisplayTransform = (isFinal: boolean) => {
		const calls = currentToolCalls();
		if (spConfig?.OutputPreprocessing?.enabled) {
			const res = runSPresetOutputPreprocessing(calls, rawText, spConfig, spOutState, isFinal);
			displayText = res.text;
		} else if (!rawText.trim() && calls.length > 0) {
			// 无 OutputPreprocessing 时兜底提取单字段正文，避免静默吞掉工具回复
			displayText = calls
				.map((c) => {
					const rawArgs = typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments ?? "");
					try {
						const obj = JSON.parse(rawArgs) as Record<string, unknown>;
						return typeof obj.content === "string" ? obj.content : typeof obj.story === "string" ? obj.story : rawArgs;
					} catch {
						return rawArgs;
					}
				})
				.join("\n\n");
		} else {
			displayText = rawText;
		}
	};

	try {
		const genRes = await window.fetch("/api/backends/chat-completions/generate", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
			signal: opts.signal,
		});
		if (!genRes.ok) {
			const errBody = await genRes.text().catch(() => "");
			let parsedErr = errBody;
			try {
				const ej = JSON.parse(errBody) as { error?: { message?: string } | string; message?: string };
				parsedErr =
					typeof ej.error === "string"
						? ej.error
						: ej.error?.message || ej.message || errBody;
			} catch {
				/* keep raw text */
			}
			errMsg = parsedErr || `Upstream model error (${genRes.status})`;
		} else if (genRes.body && (genRes.headers.get("content-type") || "").includes("text/event-stream")) {
			const reader = genRes.body.getReader();
			const decoder = new TextDecoder();
			let buf = "";
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				let nl: number;
				while ((nl = buf.indexOf("\n")) >= 0) {
					const line = buf.slice(0, nl).replace(/\r$/, "");
					buf = buf.slice(nl + 1);
					if (!line.startsWith("data:")) continue;
					const dataStr = line.slice(5).trim();
					if (!dataStr || dataStr === "[DONE]") continue;
					try {
						const chunk = JSON.parse(dataStr) as {
							choices?: Array<{
								delta?: {
									content?: string;
									reasoning_content?: string;
									reasoning?: string;
									tool_calls?: Array<{
										index?: number;
										id?: string;
										type?: string;
										function?: { name?: string; arguments?: string };
									}>;
								};
								message?: {
									content?: string;
									reasoning_content?: string;
									tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
								};
							}>;
						};
						const choice = chunk.choices?.[0];
						const delta = choice?.delta ?? choice?.message;
						if (!delta) continue;
						let changed = false;
						if (typeof delta.content === "string" && delta.content) {
							rawText += delta.content;
							changed = true;
							emitCardRuntimeEvent(tavern_events.STREAM_TOKEN_RECEIVED, delta.content);
						}
						const thinkDelta = delta.reasoning_content ?? (delta as { reasoning?: string }).reasoning;
						if (typeof thinkDelta === "string" && thinkDelta) {
							rawThinking += thinkDelta;
							changed = true;
						}
						if (Array.isArray(delta.tool_calls)) {
							for (const tc of delta.tool_calls) {
								const idx = typeof tc.index === "number" ? tc.index : 0;
								const cur = toolCallAcc.get(idx) ?? { id: tc.id || `call_${idx}`, type: tc.type || "function", name: "", arguments: "" };
								if (tc.id) cur.id = tc.id;
								if (tc.function?.name) cur.name += tc.function.name;
								if (typeof tc.function?.arguments === "string") cur.arguments += tc.function.arguments;
								toolCallAcc.set(idx, cur);
								changed = true;
							}
						}
						if (changed) {
							applyDisplayTransform(false);
							opts.onStreamDelta(displayText, rawThinking);
						}
					} catch {
						/* ignore partial chunk */
					}
				}
			}
			applyDisplayTransform(true);
			opts.onStreamDelta(displayText, rawThinking);
		} else {
			const jsonText = await genRes.text();
			try {
				const data = JSON.parse(jsonText) as {
					choices?: Array<{
						message?: {
							content?: string;
							reasoning_content?: string;
							tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
						};
					}>;
				};
				const msg = data.choices?.[0]?.message;
				if (msg) {
					if (typeof msg.content === "string") rawText = msg.content;
					if (typeof msg.reasoning_content === "string") rawThinking = msg.reasoning_content;
					if (Array.isArray(msg.tool_calls)) {
						msg.tool_calls.forEach((tc, idx) => {
							toolCallAcc.set(idx, {
								id: tc.id || `call_${idx}`,
								type: tc.type || "function",
								name: tc.function?.name || "",
								arguments: typeof tc.function?.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function?.arguments ?? ""),
							});
						});
					}
					applyDisplayTransform(true);
					opts.onStreamDelta(displayText, rawThinking);
				}
			} catch {
				rawText = jsonText;
				displayText = jsonText;
				opts.onStreamDelta(displayText, rawThinking);
			}
		}
	} catch (err) {
		if (opts.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
			aborted = true;
			applyDisplayTransform(true);
		} else {
			errMsg = err instanceof Error ? err.message : String(err);
			applyDisplayTransform(true);
		}
	}

	if (!displayText.trim() && !rawThinking.trim()) {
		if (aborted) {
			emitCardRuntimeEvent(tavern_events.GENERATION_STOPPED);
			return { ok: false, aborted: true };
		}
		emitCardRuntimeEvent(tavern_events.GENERATION_ENDED);
		return { ok: false, error: errMsg || "Model returned empty response" };
	}

	const commitRes = await window.fetch("/api/pure-tavern/commit", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			userText: opts.userText,
			assistantText: displayText,
			thinking: rawThinking,
			aborted,
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
	if (aborted) {
		emitCardRuntimeEvent(tavern_events.GENERATION_STOPPED);
	} else {
		await emitCardRuntimeEventAsync(tavern_events.MESSAGE_RECEIVED, lastIdx, "normal");
		await emitCardRuntimeEventAsync(tavern_events.CHARACTER_MESSAGE_RENDERED, lastIdx, "normal");
		await emitCardRuntimeEventAsync(tavern_events.GENERATION_ENDED);
	}

	return {
		ok: !errMsg,
		aborted,
		entryId: commitJson.entryId ?? null,
		replyText: displayText,
		totalMessages: commitJson.totalMessages,
		...(errMsg ? { error: errMsg } : {}),
	};
}
