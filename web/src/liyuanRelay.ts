/**
 * 梨园模式浏览器单轮中转桥客户端（刀 3）。
 *
 * 接收服务端 WS 下发的 `relay_request`：
 * - phase === "explore"（探索轮）：严格保住梨园真工具表与工具选择自由，仅放行防路由/安全参数/自定义请求头与消息压平脚本；
 * - phase === "compose"（交稿一发）：已撤全部梨园真工具，放开完整 SPreset / 假工具 / 末尾预填 / 实时解包；
 * 实时把文本/思考增量与最终状态通过 HTTP POST 推回后端 StageEngine。
 */

import { emitCardRuntimeEventAsync } from "./cardRuntimeFrames.ts";
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

export interface LiyuanRelayRequestPayload {
	relayId: string;
	phase: "explore" | "compose";
	model: { id: string; provider?: string; api?: string };
	presetMeta: {
		name: string | null;
		raw: Record<string, unknown> | null;
		charName: string;
		userName: string;
		squashSystemMessages?: boolean;
	};
	messages: Array<Record<string, unknown>>;
	tools?: Array<Record<string, unknown>>;
	samplers: Record<string, unknown>;
}

const activeRelays = new Map<string, AbortController>();

export function abortLiyuanBrowserRelay(relayId?: string): void {
	if (relayId) {
		const ac = activeRelays.get(relayId);
		if (ac) ac.abort();
		return;
	}
	for (const ac of activeRelays.values()) ac.abort();
}

export async function runLiyuanBrowserRelay(req: LiyuanRelayRequestPayload): Promise<void> {
	const ac = new AbortController();
	activeRelays.set(req.relayId, ac);

	try {
		await window.fetch("/api/liyuan-relay/ack", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ relayId: req.relayId }),
		}).catch(() => {});

		const spConfig = req.phase === "compose" ? extractSPresetConfig(req.presetMeta.raw) : null;
		let messages = req.messages.map((m) => ({ ...m }));
		if (req.phase === "compose" && spConfig) {
			messages = runSPresetChatSquash(messages as unknown as SPresetOpenAiMessage[], spConfig, {
				charName: req.presetMeta.charName,
				userName: req.presetMeta.userName,
			}) as unknown as Array<Record<string, unknown>>;
		}

		const promptEventData = { chat: messages, dryRun: false };
		await emitCardRuntimeEventAsync(tavern_events.CHAT_COMPLETION_PROMPT_READY, promptEventData);

		const inferredSource =
			req.model.api === "google-generative-ai"
				? "makersuite"
				: req.model.api === "anthropic-messages"
					? "claude"
					: "custom";

		let payload: Record<string, unknown> = {
			model: req.model.id,
			messages: promptEventData.chat,
			stream: true,
			chat_completion_source: inferredSource,
			type: "normal",
			...(req.presetMeta.squashSystemMessages ? { squash_system_messages: true } : {}),
		};
		applySamplersToOpenAiPayload(payload, req.samplers ?? {}, req.presetMeta.raw);

		const nativeTools = Array.isArray(req.tools) ? req.tools.map((t) => ({ ...t })) : [];
		if (req.phase === "explore" && nativeTools.length > 0) {
			payload.tools = nativeTools;
		} else if (req.phase === "compose") {
			const collectedTools = await collectRegisteredStTools();
			if (collectedTools.length > 0) {
				payload.tools = collectedTools;
			}
			if (spConfig) {
				payload = applySPresetToolsAndInjections(payload, spConfig);
			}
		}

		await emitCardRuntimeEventAsync(tavern_events.CHAT_COMPLETION_SETTINGS_READY, payload);

		if (req.phase === "explore" && nativeTools.length > 0) {
			// 保护红线：探索轮绝不允许脚本删光梨园真工具或强锁 tool_choice 到非梨园工具
			const allowedNames = new Set(
				nativeTools.map((t) => ((t.function as { name?: string } | undefined)?.name ?? t.name ?? "")).filter(Boolean),
			);
			payload.tools = nativeTools;
			if (
				payload.tool_choice &&
				typeof payload.tool_choice === "object" &&
				!allowedNames.has(String((payload.tool_choice as { function?: { name?: string } }).function?.name || ""))
			) {
				delete payload.tool_choice;
			} else if (payload.tool_choice === "none") {
				delete payload.tool_choice;
			}
		} else if (req.phase === "compose" && spConfig) {
			payload = await runSPresetFinalRequestProcessing(payload, spConfig);
		}

		let pushedTextLen = 0;
		let pushedThinkingLen = 0;
		let chunkSeq = 0;
		let chunkChain: Promise<unknown> = Promise.resolve();
		const pushDelta = (kind: "text" | "thinking", delta: string) => {
			if (!delta) return;
			const seq = ++chunkSeq;
			chunkChain = chunkChain
				.then(() =>
					window.fetch("/api/liyuan-relay/chunk", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ relayId: req.relayId, seq, kind, delta }),
					}),
				)
				.catch(() => {});
		};

		const streamRes = await executeOpenAiFetchAndConsumeStream({
			payload,
			spConfig,
			presetRaw: req.presetMeta.raw,
			preserveNativeToolCalls: req.phase === "explore",
			signal: ac.signal,
			onDelta: (fullText, fullThinking) => {
				if (fullThinking.length > pushedThinkingLen) {
					const dt = fullThinking.slice(pushedThinkingLen);
					pushedThinkingLen = fullThinking.length;
					pushDelta("thinking", dt);
				}
				if (fullText.length > pushedTextLen) {
					const dt = fullText.slice(pushedTextLen);
					pushedTextLen = fullText.length;
					pushDelta("text", dt);
				}
			},
		});

		await chunkChain;
		const stopReason = streamRes.aborted
			? "aborted"
			: streamRes.errorMessage
				? "error"
				: streamRes.toolCalls.length > 0
					? "toolUse"
					: "stop";

		await window.fetch("/api/liyuan-relay/finish", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				relayId: req.relayId,
				text: streamRes.displayText,
				thinking: streamRes.rawThinking,
				stopReason,
				toolCalls: streamRes.toolCalls,
				...(streamRes.usage ? { usage: streamRes.usage } : {}),
				...(streamRes.errorMessage ? { errorMessage: streamRes.errorMessage } : {}),
			}),
		});
	} catch (err) {
		await window.fetch("/api/liyuan-relay/finish", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				relayId: req.relayId,
				text: "",
				thinking: "",
				stopReason: ac.signal.aborted ? "aborted" : "error",
				errorMessage: err instanceof Error ? err.message : String(err),
			}),
		}).catch(() => {});
	} finally {
		activeRelays.delete(req.relayId);
	}
}
