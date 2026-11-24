/**
 * 纯后端 pi 流式探测与输入/拒答透明恢复（Stage 3）。
 *
 * 职责：
 * 1. 识别上游隐蔽拦截/空回（HTTP 200 空回、400/403 审核拒绝、SAFETY/PROHIBITED、开头 300 字拒答话术、非正常空流）；
 * 2. 在单跳流输出跨过安全阈值（>=360 正文字符 或 出现 toolcall_start）后转入零延迟直通，避免长思考后拒答漏网；
 * 3. 若阈值前命中拦截，丢弃本次无效事件并在内部按策略级联恢复：
 *    - 策略 1：未开混淆时追加防路由注释混淆（antiRouteShield: "head"）重发当前跳；
 *    - 策略 2：将上下文搬运进载体工具描述并开启强混淆（context-pack-scramble）；
 *    - 策略 3：若挂有 draft_write，锁定 tool_choice 经真实工具参数写入正文（force-draft-write）；
 * 4. 超过 1200 字正常正文后的尾部截断不判为整轮拒答，原样交还 agent-session 断点续写。
 */

import { t } from "../i18n/index.ts";
import type { RelayPolicyConfig } from "../types.ts";
import type { PresetRelayMeta } from "./preset-relay-meta.ts";
import {
	applyRelayHeaders,
	applyRelayPayload,
	type AntiRouteShieldMode,
	type ForcedToolChoice,
	type RelayModelLike,
} from "./provider-relay.ts";
import type { AssistantMsgLike, StageModelLike, StageStreamEvent, StageStreamFn } from "./engine.ts";

const PROBE_TEXT_CHARS = 360;
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
	/content_filter|prohibited|safety|blocked|blocklist|moderation|flagged|inappropriate|policy_violation|content.?policy|usage.?policy|harm_category|no.?candidates|unsafe|sexual|sensitive|violat|refused|recitation|spii|400.*safety|Stream ended without finish_reason|Google stream ended without a finish reason|empty|过滤|违规|敏感|审核|拒绝/i;

const SAFETY_FIELD_REJECT_RE = /safety_settings/i;
const UNKNOWN_FIELD_RE = /unknown|unrecognized|unsupported|invalid|extra|unexpected|not allowed|additional properties/i;

export function isOpenAiSafetyFieldRejected(errMsg: unknown): boolean {
	if (typeof errMsg !== "string" || !errMsg) return false;
	return SAFETY_FIELD_REJECT_RE.test(errMsg) && UNKNOWN_FIELD_RE.test(errMsg);
}

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
		if (isOpenAiSafetyFieldRejected(err)) {
			return { isRefusal: false };
		}
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
	forcedToolChoice?: ForcedToolChoice;
	overrideShieldMode?: AntiRouteShieldMode;
	overrideContextPackMode?: "off" | "tool-desc";
	disableOpenAiSafetyField?: boolean;
	shieldSeed?: number;
}

export interface RelayStreamWrapperConfig {
	policy?: RelayPolicyConfig;
	presetMeta?: PresetRelayMeta;
	hasActivePreset?: boolean;
	/** 写作/讨论模式：不触发 draft_write 强锁，保留输入搬运、强混淆与拒答恢复 */
	isAgentTurn?: boolean;
	/** 本拍基础随机种子（供跨工具轮维持一致前缀缓存，遇级联策略切换时步进换种） */
	turnShieldSeed?: number;
	/** 每次发送尝试前更新，供 before_provider_request 同步本跳特殊状态 */
	setAttemptOverlay: (overlay: AttemptRelayOverlay) => void;
	/** 当探测到拦截准备透明重发时通知进度条 */
	onRecoveryActivity?: (detail: string) => void;
}

interface ProbeStrategy {
	label: string;
	forcedToolChoice?: ForcedToolChoice;
	overrideShield?: AntiRouteShieldMode;
	overrideContextPack?: "off" | "tool-desc";
}

function hasTurnWriteOrContinuation(messages: unknown[]): boolean {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as { role?: unknown; toolName?: unknown; details?: Record<string, unknown> } | undefined;
		if (!m || typeof m !== "object") continue;
		if (m.details?.liyuanPartialContinuation === true || m.details?.liyuanContinueRetry === true) {
			return true;
		}
		if (m.role === "user") break;
		if (
			m.role === "toolResult" &&
			typeof m.toolName === "string" &&
			(m.toolName.startsWith("draft_") ||
				m.toolName === "story_write" ||
				m.toolName === "story_edit" ||
				m.toolName === "write" ||
				m.toolName === "edit")
		) {
			return true;
		}
	}
	return false;
}

function hasDraftWriteTool(tools: unknown[] | undefined): boolean {
	if (!Array.isArray(tools)) return false;
	return tools.some((t) => !!t && typeof t === "object" && (t as { name?: unknown }).name === "draft_write");
}

function buildProbeStrategies(
	context: { messages?: unknown[]; tools?: unknown[] },
	cfg: RelayStreamWrapperConfig,
): { strategies: ProbeStrategy[]; hasExplicitRetryPolicy: boolean; contextPackMode: "off" | "auto" | "tool-desc" } {
	const policy = cfg.policy ?? {};
	const isAgentTurn = cfg.isAgentTurn === true;
	const toolOutputMode = isAgentTurn ? "off" : (policy.toolOutputMode ?? "auto");
	const contextPackMode = policy.contextPackMode ?? "auto";
	const hasExplicitRetryPolicy =
		policy.refusalRetry === true
			? true
			: policy.refusalRetry === false
				? false
				: Boolean(
						isAgentTurn ||
							cfg.hasActivePreset ||
							(policy.antiRouteShield && policy.antiRouteShield !== "off") ||
							toolOutputMode === "on" ||
							policy.contextPackMode === "tool-desc",
					);
	const turnWrittenOrContinuing = Array.isArray(context.messages) && hasTurnWriteOrContinuation(context.messages);
	const canForceDraftWrite = !isAgentTurn && toolOutputMode !== "off" && hasDraftWriteTool(context.tools) && !turnWrittenOrContinuing;
	const currentShield = policy.antiRouteShield ?? "off";

	const appendPackFallback = (list: ProbeStrategy[]) => {
		if (contextPackMode === "auto") {
			list.push({
				label: "context-pack-scramble",
				overrideContextPack: "tool-desc",
				overrideShield: "scramble",
			});
		} else if (contextPackMode === "tool-desc") {
			if (currentShield !== "scramble") {
				list.push({
					label: "scramble-only",
					overrideShield: "scramble",
				});
			}
			list.push({
				label: "scramble-direct",
				overrideContextPack: "off",
				overrideShield: "scramble",
			});
		}
	};

	// 主动工具交稿模式：尚未落稿时第一发即要求必须调用工具（允许先查资料再写 draft_write），遇拒答推进搬运/直锁 draft_write
	if (toolOutputMode === "on" && canForceDraftWrite) {
		const forcedList: ProbeStrategy[] = [
			{ label: "tool-required", forcedToolChoice: { kind: "required" } },
		];
		if (hasExplicitRetryPolicy) {
			appendPackFallback(forcedList);
			forcedList.push({
				label: "force-draft-write",
				forcedToolChoice: { kind: "tool", name: "draft_write" },
				...(contextPackMode !== "off" ? { overrideContextPack: "tool-desc" as const } : {}),
				...(currentShield === "off" ? { overrideShield: contextPackMode !== "off" ? "scramble" : "head" } : {}),
			});
		}
		return { strategies: forcedList, hasExplicitRetryPolicy, contextPackMode };
	}

	const list: ProbeStrategy[] = [{ label: "normal" }];
	if (turnWrittenOrContinuing || policy.refusalRetry === false) {
		return { strategies: list, hasExplicitRetryPolicy, contextPackMode };
	}

	// 若未开通用拒答重试，仅当遭遇显式输入侧审核报错时允许单跳 context-pack-scramble 自救（不改变普通空回行为）
	if (!hasExplicitRetryPolicy) {
		if (contextPackMode !== "off") {
			list.push({
				label: "context-pack-scramble",
				overrideContextPack: "tool-desc",
				overrideShield: "scramble",
			});
		}
		return { strategies: list, hasExplicitRetryPolicy, contextPackMode };
	}

	if (currentShield === "off") {
		list.push({ label: "shield-head", overrideShield: "head" });
	}
	appendPackFallback(list);
	if (canForceDraftWrite) {
		list.push({
			label: "force-draft-write",
			forcedToolChoice: { kind: "tool", name: "draft_write" },
			...(contextPackMode !== "off" ? { overrideContextPack: "tool-desc" as const } : {}),
			...(currentShield === "off" ? { overrideShield: contextPackMode !== "off" ? "scramble" : "head" } : {}),
		});
	}
	return { strategies: list, hasExplicitRetryPolicy, contextPackMode };
}

/**
 * 包装 StageEngine 的底层 streamFn：实现首段流探针与输入/拒答拦截透明恢复。
 */
export function wrapRelayStreamFn(origStreamFn: StageStreamFn, cfg: RelayStreamWrapperConfig): StageStreamFn {
	const baseTurnSeed = cfg.turnShieldSeed ?? ((Math.floor(Math.random() * 0x7fffffff) + 1) >>> 0);
	let recoveryEpoch = 0;

	return (model, context, options) => {
		const ctxTyped = context as { systemPrompt?: string; messages: unknown[]; tools?: unknown[] };
		const { strategies, hasExplicitRetryPolicy } = buildProbeStrategies(ctxTyped, cfg);
		const allowSafetyAutoStrip = cfg.policy?.googleSafetyOnOpenAi === true;

		// 仅有一条正常路径且无需拦截/字段降级包装时，走零开销直通（保留同拍种子以稳定前缀缓存）
		if (strategies.length === 1 && !strategies[0]!.forcedToolChoice && !allowSafetyAutoStrip) {
			cfg.setAttemptOverlay({ shieldSeed: baseTurnSeed });
			return origStreamFn(model, context, options);
		}

		const { stream, push, finish } = createManagedRelayStream();

		void (async () => {
			let lastMsg: AssistantMsgLike | null = null;
			let lastIsError = false;
			let disableOpenAiSafetyField = false;

			try {
				for (let i = 0; i < strategies.length; i++) {
					const strat = strategies[i]!;
					const attemptSeed = (baseTurnSeed + recoveryEpoch * 2654435761) >>> 0;
					if (options?.signal && (options.signal as AbortSignal).aborted) {
						finish(
							lastMsg ?? { role: "assistant", content: [], stopReason: "aborted" },
							true,
						);
						return;
					}

					cfg.setAttemptOverlay({
						shieldSeed: attemptSeed,
						...(strat.forcedToolChoice ? { forcedToolChoice: strat.forcedToolChoice } : {}),
						...(strat.overrideShield ? { overrideShieldMode: strat.overrideShield } : {}),
						...(strat.overrideContextPack ? { overrideContextPackMode: strat.overrideContextPack } : {}),
						...(disableOpenAiSafetyField ? { disableOpenAiSafetyField: true } : {}),
					});

					const inner = await Promise.resolve(origStreamFn(model, context, options));
					const buffered: StageStreamEvent[] = [];
					let passedThrough = false;
					let seenTextChars = 0;
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
						}

						if (sawToolCall || seenTextChars >= PROBE_TEXT_CHARS) {
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

					// 严格兼容网关拒绝未知字段 safety_settings：自动剥除并在当前同策略重发一次
					if (
						!disableOpenAiSafetyField &&
						finalMsg.stopReason === "error" &&
						isOpenAiSafetyFieldRejected(finalMsg.errorMessage)
					) {
						disableOpenAiSafetyField = true;
						cfg.onRecoveryActivity?.(t("网关不支持 safety_settings，已自动剥除并重发…"));
						i--;
						continue;
					}

					const verdict = classifyRelayFailure(finalMsg);
					const isExplicitModerationOrRefusal =
						cfg.policy?.refusalRetry !== false &&
						verdict.isRefusal &&
						(finalMsg.stopReason === "error" ||
							Boolean(verdict.reason?.startsWith("refusal-marker:")) ||
							verdict.reason === "thinking-only-no-text");
					const isExplicitInputModerationError =
						finalMsg.stopReason === "error" &&
						verdict.isRefusal &&
						!isOpenAiSafetyFieldRejected(finalMsg.errorMessage);

					if (!hasExplicitRetryPolicy && !isExplicitModerationOrRefusal) {
						for (const b of buffered) push(b);
						finish(finalMsg, lastIsError);
						return;
					}

					const forcedToolErrored =
						Boolean(strat.forcedToolChoice) &&
						finalMsg.stopReason === "error" &&
						extractAssistantTextAndThinking(finalMsg).text.trim().length === 0;
					const hasNext = i + 1 < strategies.length;
					if ((!verdict.isRefusal && !forcedToolErrored) || !hasNext) {
						for (const b of buffered) push(b);
						finish(finalMsg, lastIsError);
						return;
					}

					// 遇明确输入侧审核报错且后面有 context-pack-scramble 时，直接跨过 shield-head 避免无效往返
					if (isExplicitInputModerationError) {
						const packIdx = strategies.findIndex(
							(s, idx) => idx > i && s.label === "context-pack-scramble",
						);
						if (packIdx > i + 1) {
							i = packIdx - 1;
						}
					}

					const nextStrat = strategies[i + 1]!;
					recoveryEpoch += 1;
					cfg.onRecoveryActivity?.(
						t("检测到拦截（{reason}），切换「{strategy}」自动恢复…", {
							reason: verdict.reason ?? (forcedToolErrored ? "forced-tool-rejected" : "empty"),
							strategy: nextStrat.label,
						}),
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
				cfg.setAttemptOverlay({});
			}
		})();

			return stream;
		};
	}

export interface SideRelayStreamConfig {
	getPolicy: () => RelayPolicyConfig | undefined;
	onRecoveryActivity?: (detail: string) => void;
}

/**
 * 包装一次性无工具旁路流（场记、压缩、预设声明、脚本单发生成等）：
 * 1. 自动通过 options.headers / options.onPayload 施加防路由混淆、RELAY_RULES.txt、采样微扰与安全放行；
 * 2. 保持 overrideContextPackMode: "off" 不插入虚拟工具，避免破坏结构化 JSON 输出；
 * 3. 遇 safety_settings 400 自动剥除重发；遇明确输入/拒答拦截自动升档 scramble 强混淆重试一跳。
 */
export function wrapSideRelayStreamFn(origStreamFn: StageStreamFn, cfg: SideRelayStreamConfig): StageStreamFn {
	return (model, context, options) => {
		const policy = cfg.getPolicy();
		const { stream, push, finish } = createManagedRelayStream();
		const baseSeed = (Math.floor(Math.random() * 0x7fffffff) + 1) >>> 0;

		void (async () => {
			let lastMsg: AssistantMsgLike | null = null;
			let lastIsError = false;
			let disableOpenAiSafetyField = false;
			let overrideShield: AntiRouteShieldMode | undefined;
			let seedEpoch = 0;

			try {
				for (let attempt = 0; attempt < 3; attempt++) {
					if (options?.signal && (options.signal as AbortSignal).aborted) {
						finish(
							lastMsg ?? { role: "assistant", content: [], stopReason: "aborted" },
							true,
						);
						return;
					}

					const optsRecord = (options ?? {}) as Record<string, unknown>;
					const mergedHeaders: Record<string, string> = {};
					if (optsRecord.headers && typeof optsRecord.headers === "object") {
						for (const [k, v] of Object.entries(optsRecord.headers as Record<string, unknown>)) {
							if (typeof v === "string") mergedHeaders[k] = v;
						}
					}
					applyRelayHeaders(mergedHeaders, policy);

					const prevOnPayload = typeof optsRecord.onPayload === "function"
						? (optsRecord.onPayload as (payload: unknown, m?: unknown) => unknown | Promise<unknown>)
						: undefined;
					const attemptSeed = (baseSeed + seedEpoch * 2654435761) >>> 0;
					const attemptOptions: Record<string, unknown> = {
						...optsRecord,
						...(Object.keys(mergedHeaders).length > 0 ? { headers: mergedHeaders } : {}),
						onPayload: async (payload: unknown, reqModel?: unknown) => {
							const cur = prevOnPayload ? await prevOnPayload(payload, reqModel) : payload;
							const relayed = applyRelayPayload(cur ?? payload, (reqModel ?? model) as RelayModelLike, {
								policy,
								overrideContextPackMode: "off",
								...(overrideShield ? { overrideShieldMode: overrideShield } : {}),
								...(disableOpenAiSafetyField ? { disableOpenAiSafetyField: true } : {}),
								shieldSeed: attemptSeed,
							});
							return relayed !== undefined ? relayed : (cur ?? payload);
						},
					};

					const inner = await Promise.resolve(origStreamFn(model, context, attemptOptions));
					const buffered: StageStreamEvent[] = [];
					let passedThrough = false;
					let seenTextChars = 0;

					for await (const ev of inner) {
						if (ev.type === "done" || ev.type === "error") continue;
						if (passedThrough) {
							push(ev);
							continue;
						}
						buffered.push(ev);
						if (ev.type === "text_delta" && typeof ev.delta === "string") {
							seenTextChars += ev.delta.length;
						}
						if (seenTextChars >= PROBE_TEXT_CHARS) {
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

					if (
						!disableOpenAiSafetyField &&
						finalMsg.stopReason === "error" &&
						isOpenAiSafetyFieldRejected(finalMsg.errorMessage)
					) {
						disableOpenAiSafetyField = true;
						cfg.onRecoveryActivity?.(t("旁路通道：网关不支持 safety_settings，已自动剥除重发…"));
						continue;
					}

					const verdict = classifyRelayFailure(finalMsg);
					const canRetryModeration =
						policy?.refusalRetry !== false &&
						overrideShield !== "scramble" &&
						verdict.isRefusal &&
						(finalMsg.stopReason === "error" ||
							Boolean(verdict.reason?.startsWith("refusal-marker:")) ||
							verdict.reason === "thinking-only-no-text");

					if (!canRetryModeration) {
						for (const b of buffered) push(b);
						finish(finalMsg, lastIsError);
						return;
					}

					overrideShield = "scramble";
					seedEpoch += 1;
					cfg.onRecoveryActivity?.(t("旁路通道检测到拦截（{reason}），切换强混淆重试…", { reason: verdict.reason ?? "refusal" }));
				}

				finish(
					lastMsg ?? { role: "assistant", content: [], stopReason: "error", errorMessage: "Side relay retries exhausted" },
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
			}
		})();

		return stream;
	};
}
