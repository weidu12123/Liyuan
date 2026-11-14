/**
 * 纯后端 pi 流式探测、静默拒答恢复与工具后无损折算预填（Stage 3）。
 *
 * 职责：
 * 1. 识别上游隐蔽拦截/空回（HTTP 200 空回、SAFETY/PROHIBITED、开头 300 字拒答话术、非正常空流）；
 * 2. 在单跳流输出跨过安全阈值（>=360 正文字符 或 出现 toolcall_start 或 思考>=1200 字）后转入零延迟直通；
 * 3. 若阈值前命中拦截，丢弃本次无效事件并在内部按策略级联恢复：
 *    - 策略 1：未开混淆时追加防路由注释混淆（antiRouteShield: "head"）重发当前跳；
 *    - 策略 2：若预设带末尾预填且目标模型/协议支持，折算本拍已查工具结果为纯文本、撤工具并附加末尾 assistant 预填重发；
 * 4. 超过 1200 字正常正文后的尾部截断不判为整轮拒答，原样交还 agent-session 断点续写。
 */

import type { RelayPolicyConfig } from "../types.ts";
import type { PresetRelayMeta } from "./preset-relay-meta.ts";
import { supportsTrailingPrefill, type RelayModelLike } from "./provider-relay.ts";
import type { AssistantMsgLike, StageModelLike, StageStreamEvent, StageStreamFn } from "./engine.ts";

const PROBE_TEXT_CHARS = 360;
const PROBE_THINKING_CHARS = 1200;
const REFUSAL_TEXT_MAX_CHARS = 1200;

const REFUSAL_HEAD_MARKERS = [
	"blocked by gemini",
	"cannot help",
	"i cannot",
	"i can't",
	"i'm unable",
	"i am unable",
	"as an ai",
	"as a language model",
	"抱歉，我",
	"很抱歉",
	"我不能",
	"我无法",
	"无法提供",
	"无法协助",
	"作为ai",
	"作为人工智能",
];

const ERROR_FILTER_RE =
	/content_filter|prohibited|safety|blocked|Stream ended without finish_reason|Google stream ended without a finish reason|empty/i;

export interface RelayFailureClassification {
	isRefusal: boolean;
	reason?: string;
}

export function extractAssistantTextAndThinking(msg: AssistantMsgLike | null | undefined): {
	text: string;
	thinking: string;
	hasToolCalls: boolean;
} {
	if (!msg || !Array.isArray(msg.content)) {
		return { text: "", thinking: "", hasToolCalls: false };
	}
	let text = "";
	let thinking = "";
	let hasToolCalls = false;
	for (const block of msg.content) {
		if (!block || typeof block !== "object") continue;
		if (block.type === "text" && typeof block.text === "string") text += block.text;
		else if (block.type === "thinking" && typeof block.thinking === "string") thinking += block.thinking;
		else if (block.type === "toolCall") hasToolCalls = true;
	}
	return { text, thinking, hasToolCalls };
}

export function classifyRelayFailure(msg: AssistantMsgLike | null | undefined): RelayFailureClassification {
	if (!msg) return { isRefusal: true, reason: "empty-response" };
	if (msg.stopReason === "aborted") return { isRefusal: false };

	const { text, thinking, hasToolCalls } = extractAssistantTextAndThinking(msg);
	if (hasToolCalls) return { isRefusal: false };

	const trimmedText = text.trim();
	const trimmedThinking = thinking.trim();

	if (msg.stopReason === "error") {
		if (trimmedText.length > 0) {
			return { isRefusal: false };
		}
		const err = String(msg.errorMessage ?? "");
		if (ERROR_FILTER_RE.test(err)) {
			return { isRefusal: true, reason: `error:${err.slice(0, 80)}` };
		}
		return { isRefusal: false };
	}

	if (!trimmedText && !trimmedThinking) {
		return { isRefusal: true, reason: "silent-empty" };
	}

	if (!trimmedText && trimmedThinking) {
		// 仅输出思考而正文为空，常见于思考后被策略拦截丢弃正文
		return { isRefusal: true, reason: "thinking-only-no-text" };
	}

	if (trimmedText.length <= REFUSAL_TEXT_MAX_CHARS) {
		const head = trimmedText.slice(0, 300).toLowerCase();
		for (const marker of REFUSAL_HEAD_MARKERS) {
			if (head.includes(marker)) {
				return { isRefusal: true, reason: `refusal-marker:${marker}` };
			}
		}
	}

	return { isRefusal: false };
}

function textFromAnyContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return content == null ? "" : String(content);
	return content
		.map((part) => {
			if (typeof part === "string") return part;
			if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
				return (part as { text: string }).text;
			}
			return "";
		})
		.join("");
}

/**
 * 将含 toolCall / toolResult 的上下文副本折算为纯文本资料块、清空 tools，
 * 并在末尾追加标准 assistant 预填消息（绝不改动原会话消息树）。
 */
export function flattenContextForPrefill(
	context: { systemPrompt?: string; messages: unknown[]; tools?: unknown[] },
	prefillText: string,
	model?: StageModelLike,
): { systemPrompt?: string; messages: unknown[]; tools?: undefined } {
	const findings: string[] = [];
	const cleaned: Array<Record<string, unknown>> = [];

	for (const raw of context.messages ?? []) {
		if (!raw || typeof raw !== "object") continue;
		const msg = raw as Record<string, unknown>;
		const role = String(msg.role ?? "");

		if (role === "toolResult" || role === "tool") {
			const toolName = typeof msg.toolName === "string" && msg.toolName ? msg.toolName : typeof msg.name === "string" ? msg.name : "tool";
			const txt = textFromAnyContent(msg.content).trim();
			if (txt && msg.isError !== true) {
				const clipped = txt.length > 4000 ? `${txt.slice(0, 4000)}…` : txt;
				findings.push(`- 【${toolName}】${clipped}`);
			}
			continue;
		}

		if (role === "assistant") {
			const contentArr = Array.isArray(msg.content) ? (msg.content as Array<Record<string, unknown>>) : [];
			const hasToolCall = contentArr.some((b) => b && b.type === "toolCall") || Array.isArray(msg.tool_calls);
			if (hasToolCall) {
				// 丢弃中间工具轮 assistant 块，避免残余 tool_calls 引起 400 或禁用 partial
				continue;
			}
			const plain = textFromAnyContent(msg.content).trim();
			if (!plain) continue;
			const prev = cleaned[cleaned.length - 1];
			if (prev && prev.role === "assistant") {
				const prevTxt = textFromAnyContent(prev.content).trim();
				prev.content = [{ type: "text", text: `${prevTxt}\n\n${plain}` }];
			} else {
				cleaned.push({ ...msg, content: [{ type: "text", text: plain }] });
			}
			continue;
		}

		if (role === "user") {
			const plain = textFromAnyContent(msg.content).trim();
			if (!plain) continue;
			const prev = cleaned[cleaned.length - 1];
			if (prev && prev.role === "user") {
				const prevTxt = textFromAnyContent(prev.content).trim();
				prev.content = [{ type: "text", text: `${prevTxt}\n\n${plain}` }];
			} else {
				cleaned.push({ ...msg, content: [{ type: "text", text: plain }] });
			}
		}
	}

	if (findings.length > 0) {
		const block = `【本拍已核查资料】\n${findings.join("\n")}`;
		let lastUserIdx = -1;
		for (let i = cleaned.length - 1; i >= 0; i--) {
			if (cleaned[i]!.role === "user") {
				lastUserIdx = i;
				break;
			}
		}
		if (lastUserIdx >= 0) {
			const u = cleaned[lastUserIdx]!;
			const cur = textFromAnyContent(u.content).trim();
			u.content = [{ type: "text", text: cur ? `${block}\n\n${cur}` : block }];
		} else {
			cleaned.push({ role: "user", content: [{ type: "text", text: block }], timestamp: Date.now() });
		}
	}

	const trimmedPrefill = prefillText.trim();
	if (trimmedPrefill) {
		const prev = cleaned[cleaned.length - 1];
		if (prev && prev.role === "assistant") {
			const prevTxt = textFromAnyContent(prev.content).trim();
			prev.content = [{ type: "text", text: prevTxt ? `${prevTxt}\n\n${trimmedPrefill}` : trimmedPrefill }];
		} else {
			cleaned.push({
				role: "assistant",
				content: [{ type: "text", text: trimmedPrefill }],
				api: model?.api ?? "openai-completions",
				provider: model?.provider ?? "prefill",
				model: model?.id ?? "prefill",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: Date.now(),
			});
		}
	}

	return {
		...(context.systemPrompt !== undefined ? { systemPrompt: context.systemPrompt } : {}),
		messages: cleaned,
		tools: undefined,
	};
}

function createManagedRelayStream(): {
	stream: ReturnType<StageStreamFn>;
	push: (ev: StageStreamEvent) => void;
	finish: (msg: AssistantMsgLike, isError?: boolean) => void;
} {
	const queue: StageStreamEvent[] = [];
	const waiters: Array<(r: IteratorResult<StageStreamEvent>) => void> = [];
	let closed = false;
	let resolveFinal!: (m: AssistantMsgLike) => void;
	const finalPromise = new Promise<AssistantMsgLike>((r) => {
		resolveFinal = r;
	});

	const push = (ev: StageStreamEvent) => {
		if (closed) return;
		const w = waiters.shift();
		if (w) w({ value: ev, done: false });
		else queue.push(ev);
	};

	const finish = (msg: AssistantMsgLike, isError = false) => {
		if (closed) return;
		push({
			type: isError ? "error" : "done",
			...(isError ? { error: msg } : { message: msg }),
		});
		closed = true;
		resolveFinal(msg);
		while (waiters.length > 0) {
			waiters.shift()!({ value: undefined as never, done: true });
		}
	};

	const stream: ReturnType<StageStreamFn> = {
		[Symbol.asyncIterator]() {
			return {
				next() {
					if (queue.length > 0) return Promise.resolve({ value: queue.shift()!, done: false });
					if (closed) return Promise.resolve({ value: undefined as never, done: true });
					return new Promise<IteratorResult<StageStreamEvent>>((resolve) => waiters.push(resolve));
				},
			};
		},
		result: () => finalPromise,
	};

	return { stream, push, finish };
}

export interface AttemptRelayOverlay {
	trailingPrefillActive: boolean;
	overrideShieldMode?: "off" | "head" | "deep";
}

export interface RelayStreamWrapperConfig {
	policy?: RelayPolicyConfig;
	presetMeta?: PresetRelayMeta;
	hasActivePreset?: boolean;
	trailingPrefillText?: string;
	hasThinking?: boolean;
	/** 每次发送尝试前更新，供 before_provider_request 同步本跳特殊状态 */
	setAttemptOverlay: (overlay: AttemptRelayOverlay) => void;
	/** 当探测到拦截准备透明重发时通知进度条 */
	onRecoveryActivity?: (detail: string) => void;
}

interface ProbeStrategy {
	label: string;
	usePrefill: boolean;
	overrideShield?: "head" | "deep";
}

function hasDraftToolResultInTurn(messages: unknown[]): boolean {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as { role?: unknown; toolName?: unknown } | undefined;
		if (!m || typeof m !== "object") continue;
		if (m.role === "user") break;
		if (m.role === "toolResult" && typeof m.toolName === "string" && m.toolName.startsWith("draft_")) {
			return true;
		}
	}
	return false;
}

function buildProbeStrategies(
	context: { messages?: unknown[]; tools?: unknown[] },
	model: StageModelLike,
	cfg: RelayStreamWrapperConfig,
): ProbeStrategy[] {
	const policy = cfg.policy ?? {};
	const prefillMode = policy.prefillMode ?? "auto";
	const refusalRetry =
		policy.refusalRetry === true
			? true
			: policy.refusalRetry === false
				? false
				: Boolean(cfg.hasActivePreset || (policy.antiRouteShield && policy.antiRouteShield !== "off") || prefillMode === "on");
	const prefillText = cfg.trailingPrefillText?.trim() ?? "";
	const hasToolsInCtx = Array.isArray(context.tools) && context.tools.length > 0;
	const cap = supportsTrailingPrefill(model as RelayModelLike, { hasThinking: cfg.hasThinking });
	const canPrefill = Boolean(prefillText) && prefillMode !== "off" && cap.supported;

	// 主动预填模式：当本跳本身无工具（如已到末跳撤工具，或未挂工具）时直接起手预填
	if (prefillMode === "on" && canPrefill && !hasToolsInCtx) {
		return [{ label: "prefill-direct", usePrefill: true }];
	}

	const list: ProbeStrategy[] = [{ label: "normal", usePrefill: false }];
	if (!refusalRetry) return list;
	if (Array.isArray(context.messages) && hasDraftToolResultInTurn(context.messages)) {
		return list;
	}

	const currentShield = policy.antiRouteShield ?? "off";
	if (currentShield === "off") {
		list.push({ label: "shield-head", usePrefill: false, overrideShield: "head" });
	}
	if (canPrefill) {
		list.push({
			label: "flatten-prefill",
			usePrefill: true,
			...(currentShield === "off" ? { overrideShield: "head" } : {}),
		});
	}
	return list;
}

/**
 * 包装 StageEngine 的底层 streamFn：实现首段流探针、静默拦截透明恢复与无损折算预填。
 */
export function wrapRelayStreamFn(origStreamFn: StageStreamFn, cfg: RelayStreamWrapperConfig): StageStreamFn {
	return (model, context, options) => {
		const ctxTyped = context as { systemPrompt?: string; messages: unknown[]; tools?: unknown[] };
		const strategies = buildProbeStrategies(ctxTyped, model, cfg);

		// 仅有一条正常路径且不涉及主动预填时，依然走轻量透传
		if (strategies.length === 1 && !strategies[0]!.usePrefill) {
			cfg.setAttemptOverlay({ trailingPrefillActive: false });
			return origStreamFn(model, context, options);
		}

		const { stream, push, finish } = createManagedRelayStream();

		void (async () => {
			let lastMsg: AssistantMsgLike | null = null;
			let lastIsError = false;

			try {
				for (let i = 0; i < strategies.length; i++) {
					const strat = strategies[i]!;
					if (options?.signal && (options.signal as AbortSignal).aborted) {
						finish(
							lastMsg ?? { role: "assistant", content: [], stopReason: "aborted" },
							true,
						);
						return;
					}

					const attemptCtx =
						strat.usePrefill && cfg.trailingPrefillText
							? flattenContextForPrefill(ctxTyped, cfg.trailingPrefillText, model)
							: context;

					cfg.setAttemptOverlay({
						trailingPrefillActive: strat.usePrefill,
						...(strat.overrideShield ? { overrideShieldMode: strat.overrideShield } : {}),
					});

					const inner = await Promise.resolve(origStreamFn(model, attemptCtx, options));
					const buffered: StageStreamEvent[] = [];
					let passedThrough = false;
					let seenTextChars = 0;
					let seenThinkingChars = 0;
					let sawToolCall = false;

					for await (const ev of inner) {
						if (ev.type === "done" || ev.type === "error") continue;
						if (passedThrough) {
							push(ev);
							continue;
						}
						buffered.push(ev);
						if (ev.type === "toolcall_start" || ev.type === "toolcall_delta") {
							sawToolCall = true;
						} else if (ev.type === "text_delta" && typeof ev.delta === "string") {
							seenTextChars += ev.delta.length;
						} else if (ev.type === "thinking_delta" && typeof ev.delta === "string") {
							seenThinkingChars += ev.delta.length;
						}

						if (
							sawToolCall ||
							seenTextChars >= PROBE_TEXT_CHARS ||
							seenThinkingChars >= PROBE_THINKING_CHARS
						) {
							passedThrough = true;
							for (const b of buffered) push(b);
							buffered.length = 0;
						}
					}

					const finalMsg = await inner.result();
					lastMsg = finalMsg;
					lastIsError = finalMsg.stopReason === "error" || finalMsg.stopReason === "aborted";

					if (passedThrough || finalMsg.stopReason === "aborted") {
						if (!passedThrough) {
							for (const b of buffered) push(b);
						}
						finish(finalMsg, lastIsError);
						return;
					}

					const verdict = classifyRelayFailure(finalMsg);
					const hasNext = i + 1 < strategies.length;
					if (!verdict.isRefusal || !hasNext) {
						for (const b of buffered) push(b);
						finish(finalMsg, lastIsError);
						return;
					}

					const nextStrat = strategies[i + 1]!;
					cfg.onRecoveryActivity?.(
						`检测到拦截（${verdict.reason ?? "empty"}），切换「${nextStrat.label}」自动恢复…`,
					);
				}

				finish(
					lastMsg ?? { role: "assistant", content: [], stopReason: "error", errorMessage: "Relay retries exhausted" },
					lastIsError,
				);
			} catch (err) {
				finish(
					{
						role: "assistant",
						content: [],
						stopReason: (options?.signal as AbortSignal | undefined)?.aborted ? "aborted" : "error",
						errorMessage: err instanceof Error ? err.message : String(err),
					},
					true,
				);
			} finally {
				cfg.setAttemptOverlay({ trailingPrefillActive: false });
			}
		})();

		return stream;
	};
}
