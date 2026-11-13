/**
 * 酒馆浏览器透传共用流式管线（供 pureTavernRunner 与 liyuanRelay 共用）。
 *
 * 职责：
 * - 采样参数装配；
 * - ToolManager 已注册工具收集（带 shouldRegister 校验）；
 * - 标准 OpenAI SSE 流式解析与非流式 JSON 回落；
 * - SPreset.OutputPreprocessing 与通用 tool_output_bridge 假工具（如 publish_story）实时半截 JSON 拆包。
 */

import { runSPresetOutputPreprocessing, type SPresetConfig, type SPresetOpenAiToolCall } from "./spreset.ts";

/** 从流式半截或完整 JSON 中按属性名抽出字符串字面值（处理转义字符） */
export function extractPartialJsonStringField(rawJson: string, key: string): string | null {
	const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const m = new RegExp(`"${escapedKey}"\\s*:\\s*"`).exec(rawJson);
	if (!m) return null;
	let out = "";
	for (let i = m.index + m[0].length; i < rawJson.length; i++) {
		const ch = rawJson[i]!;
		if (ch === '"') break;
		if (ch === "\\") {
			if (i + 1 >= rawJson.length) break;
			const next = rawJson[i + 1]!;
			i++;
			if (next === "n") out += "\n";
			else if (next === "r") out += "\r";
			else if (next === "t") out += "\t";
			else if (next === "u" && i + 4 < rawJson.length) {
				const hex = rawJson.slice(i + 1, i + 5);
				if (/^[0-9a-fA-F]{4}$/.test(hex)) {
					out += String.fromCharCode(Number.parseInt(hex, 16));
					i += 4;
				}
			} else {
				out += next;
			}
		} else {
			out += ch;
		}
	}
	return out;
}

export function applySamplersToOpenAiPayload(
	payload: Record<string, unknown>,
	samplers: Record<string, unknown>,
	presetRaw: Record<string, unknown> | null,
): void {
	const num = (k: string): number | undefined => {
		const raw = samplers[k] ?? (presetRaw ? presetRaw[k] : undefined);
		return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
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

export async function collectRegisteredStTools(): Promise<Array<Record<string, unknown>>> {
	const stCtx = (
		window as unknown as {
			SillyTavern?: {
				getContext?: () => {
					ToolManager?: {
						tools?: Array<{
							shouldRegister?: () => boolean | Promise<boolean>;
							toFunctionOpenAI?: () => Record<string, unknown>;
							name?: string;
							description?: string;
							parameters?: Record<string, unknown>;
						}>;
					};
				};
			};
		}
	).SillyTavern?.getContext?.();
	const registeredTools = stCtx?.ToolManager?.tools;
	if (!Array.isArray(registeredTools) || registeredTools.length === 0) return [];
	const out: Array<Record<string, unknown>> = [];
	for (const tool of registeredTools) {
		try {
			if (typeof tool.shouldRegister === "function" && !(await tool.shouldRegister())) continue;
			const fnDef =
				typeof tool.toFunctionOpenAI === "function"
					? tool.toFunctionOpenAI()
					: tool.name
						? {
								type: "function",
								function: {
									name: String(tool.name),
									description: String(tool.description ?? ""),
									parameters: tool.parameters ?? { type: "object", properties: {} },
								},
							}
						: null;
			if (fnDef) out.push(fnDef);
		} catch {
			/* ignore failing tool condition */
		}
	}
	return out;
}

interface ToolOutputRule {
	name: string;
	outputPaths: string[];
	separator: string;
}

/** 从预设自身的 extensions.tool_output_bridge 与脚本 data 中提取声明式输出字段映射（零硬编码） */
export function extractToolOutputRules(presetRaw: Record<string, unknown> | null): ToolOutputRule[] {
	if (!presetRaw || typeof presetRaw !== "object") return [];
	const configs: Array<Record<string, unknown>> = [];
	const ext = presetRaw.extensions as Record<string, unknown> | undefined;
	if (ext?.tool_output_bridge && typeof ext.tool_output_bridge === "object") {
		configs.push(ext.tool_output_bridge as Record<string, unknown>);
	}
	const th = ext?.tavern_helper as Record<string, unknown> | undefined;
	const scripts = Array.isArray(th?.scripts) ? (th.scripts as Array<Record<string, unknown>>) : [];
	for (const s of scripts) {
		const bridge = (s?.data as Record<string, unknown> | undefined)?.tool_output_bridge;
		if (bridge && typeof bridge === "object") configs.push(bridge as Record<string, unknown>);
	}

	const rules: ToolOutputRule[] = [];
	for (const cfg of configs) {
		const sep = typeof cfg.separator === "string" ? cfg.separator : "\n\n";
		const tools = Array.isArray(cfg.tools) ? (cfg.tools as Array<Record<string, unknown>>) : [];
		for (const t of tools) {
			if (!t || typeof t.name !== "string") continue;
			const paths: string[] = [];
			if (Array.isArray(t.outputPaths)) {
				for (const p of t.outputPaths) if (typeof p === "string" && p.trim()) paths.push(p.trim());
			} else if (typeof t.outputPath === "string" && t.outputPath.trim()) {
				paths.push(t.outputPath.trim());
			}
			if (paths.length === 0) {
				const props = (t.parameters as { properties?: Record<string, unknown> } | undefined)?.properties;
				if (props && typeof props === "object") paths.push(...Object.keys(props));
			}
			if (paths.length > 0) rules.push({ name: t.name, outputPaths: paths, separator: sep });
		}
	}
	return rules;
}

/** 从假工具 arguments 半截/完整 JSON 字符串中实时抽出文本，兼容 tool_output_bridge 与未知单发假工具 */
export function extractToolBridgeOutputText(
	calls: SPresetOpenAiToolCall[],
	presetRaw: Record<string, unknown> | null,
	payloadTools?: Array<Record<string, unknown>>,
): string | null {
	if (!Array.isArray(calls) || calls.length === 0) return null;
	const rules = extractToolOutputRules(presetRaw);
	const parts: string[] = [];

	for (const c of calls) {
		const name = String(c.function?.name || c.name || "");
		const rawArgs = typeof c.function?.arguments === "string" ? c.function.arguments : typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments ?? "");
		if (!rawArgs.trim()) continue;

		const rule = rules.find((r) => r.name === name);
		let paths = rule?.outputPaths ?? [];
		const sep = rule?.separator ?? "\n\n";

		if (paths.length === 0 && Array.isArray(payloadTools)) {
			const matchTool = payloadTools.find((t) => ((t.function as { name?: string } | undefined)?.name ?? t.name) === name);
			const props = ((matchTool?.function as { parameters?: { properties?: Record<string, unknown> } } | undefined)?.parameters ?? (matchTool as { parameters?: { properties?: Record<string, unknown> } } | undefined)?.parameters)?.properties;
			if (props && typeof props === "object") paths = Object.keys(props);
		}

		// 若已完整 JSON 解析，直接按键序取全部字符串值
		try {
			const parsed = JSON.parse(rawArgs) as Record<string, unknown>;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				const keys = paths.length > 0 ? paths : Object.keys(parsed);
				const extracted = keys
					.map((k) => parsed[k])
					.filter((v): v is string => typeof v === "string" && v.length > 0);
				if (extracted.length > 0) {
					parts.push(extracted.join(sep));
					continue;
				}
			}
		} catch {
			/* 半截 JSON 走流式字段抽出 */
		}

		if (paths.length > 0) {
			const segs: string[] = [];
			for (const key of paths) {
				const val = extractPartialJsonStringField(rawArgs, key);
				if (val) segs.push(val);
			}
			if (segs.length > 0) parts.push(segs.join(sep));
		} else {
			// 从半截 JSON 提取任意已出现的字符串键值对内容
			const firstKey = /"([A-Za-z0-9_.-]+)"\s*:\s*"/.exec(rawArgs)?.[1];
			if (firstKey) {
				const val = extractPartialJsonStringField(rawArgs, firstKey);
				if (val) parts.push(val);
			}
		}
	}

	return parts.length > 0 ? parts.join("\n\n") : null;
}

export interface StreamExecutionResult {
	displayText: string;
	rawThinking: string;
	toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
	aborted: boolean;
	errorMessage?: string;
	usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number };
}

export async function executeOpenAiFetchAndConsumeStream(opts: {
	payload: Record<string, unknown>;
	spConfig: SPresetConfig | null;
	presetRaw: Record<string, unknown> | null;
	/** true = 只流式/返回原生文本与工具调用（explore 阶段）；false = 假工具允许流式拆包还原成正文（compose / pure） */
	preserveNativeToolCalls: boolean;
	signal: AbortSignal;
	onDelta: (fullText: string, fullThinking: string) => void;
}): Promise<StreamExecutionResult> {
	let rawText = "";
	let rawThinking = "";
	let displayText = "";
	const toolCallAcc = new Map<number, SPresetOpenAiToolCall>();
	let aborted = false;
	let errMsg: string | undefined;
	let usage: StreamExecutionResult["usage"] | undefined;

	const payloadTools = Array.isArray(opts.payload.tools) ? (opts.payload.tools as Array<Record<string, unknown>>) : undefined;

	const opStateRef: { current: Record<string, unknown> } = { current: {} };

	const applyDisplayTransform = (isFinal: boolean) => {
		const calls = [...toolCallAcc.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]);
		if (opts.preserveNativeToolCalls) {
			displayText = rawText;
			return;
		}
		if (opts.spConfig && opts.spConfig.OutputPreprocessing?.enabled) {
			const res = runSPresetOutputPreprocessing(calls, rawText, opts.spConfig, opStateRef, isFinal);
			if (res.consumedToolCalls || res.text !== rawText) {
				displayText = res.text;
				return;
			}
		}
		if (calls.length > 0) {
			const bridged = extractToolBridgeOutputText(calls, opts.presetRaw, payloadTools);
			if (bridged) {
				displayText = rawText && !bridged.includes(rawText) ? `${rawText}\n\n${bridged}` : bridged;
				return;
			}
		}
		displayText = rawText;
	};

	try {
		const genRes = await window.fetch("/api/backends/chat-completions/generate", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(opts.payload),
			signal: opts.signal,
		});
		if (!genRes.ok) {
			const errBody = await genRes.text().catch(() => "");
			throw new Error(errBody || `Upstream HTTP ${genRes.status}`);
		}
		const contentType = genRes.headers.get("content-type") || "";
		if (contentType.includes("text/event-stream") && genRes.body) {
			const reader = genRes.body.getReader();
			const decoder = new TextDecoder();
			let buf = "";
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				let nl: number;
				while ((nl = buf.indexOf("\n")) >= 0) {
					const line = buf.slice(0, nl).trim();
					buf = buf.slice(nl + 1);
					if (!line.startsWith("data:")) continue;
					const payloadStr = line.slice(5).trim();
					if (!payloadStr || payloadStr === "[DONE]") continue;
					try {
						const json = JSON.parse(payloadStr) as {
							usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
							choices?: Array<{
								delta?: {
									content?: string;
									reasoning_content?: string;
									reasoning?: string;
									tool_calls?: Array<{ index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
								};
							}>;
						};
						if (json.usage) {
							usage = {
								input: json.usage.prompt_tokens,
								output: json.usage.completion_tokens,
								totalTokens: json.usage.total_tokens,
							};
						}
						const delta = json.choices?.[0]?.delta;
						if (!delta) continue;
						let changed = false;
						if (typeof delta.content === "string" && delta.content) {
							rawText += delta.content;
							changed = true;
						}
						const rDelta = delta.reasoning_content ?? delta.reasoning;
						if (typeof rDelta === "string" && rDelta) {
							rawThinking += rDelta;
							changed = true;
						}
						if (Array.isArray(delta.tool_calls)) {
							for (const tc of delta.tool_calls) {
								const idx = typeof tc.index === "number" ? tc.index : 0;
								const cur = toolCallAcc.get(idx) ?? {
									id: tc.id || `call_${idx}`,
									type: tc.type || "function",
									name: "",
									arguments: "",
								};
								if (tc.id) cur.id = tc.id;
								if (tc.function?.name) {
									if (!cur.function) cur.function = { name: "", arguments: "" };
									cur.function.name = (cur.function.name || "") + tc.function.name;
									cur.name = cur.function.name;
								}
								if (typeof tc.function?.arguments === "string") {
									if (!cur.function) cur.function = { name: cur.name || "", arguments: "" };
									cur.function.arguments = (typeof cur.function.arguments === "string" ? cur.function.arguments : "") + tc.function.arguments;
									cur.arguments = cur.function.arguments;
								}
								toolCallAcc.set(idx, cur);
								changed = true;
							}
						}
						if (changed) {
							applyDisplayTransform(false);
							opts.onDelta(displayText, rawThinking);
						}
					} catch {
						/* ignore partial chunk */
					}
				}
			}
			applyDisplayTransform(true);
			opts.onDelta(displayText, rawThinking);
		} else {
			const jsonText = await genRes.text();
			try {
				const data = JSON.parse(jsonText) as {
					usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
					choices?: Array<{
						message?: {
							content?: string;
							reasoning_content?: string;
							tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
						};
					}>;
				};
				if (data.usage) {
					usage = {
						input: data.usage.prompt_tokens,
						output: data.usage.completion_tokens,
						totalTokens: data.usage.total_tokens,
					};
				}
				const msg = data.choices?.[0]?.message;
				if (msg) {
					if (typeof msg.content === "string") rawText = msg.content;
					if (typeof msg.reasoning_content === "string") rawThinking = msg.reasoning_content;
					if (Array.isArray(msg.tool_calls)) {
						msg.tool_calls.forEach((tc, idx) => {
							const argsStr = typeof tc.function?.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function?.arguments ?? "");
							toolCallAcc.set(idx, {
								id: tc.id || `call_${idx}`,
								type: tc.type || "function",
								name: tc.function?.name || "",
								function: { name: tc.function?.name || "", arguments: argsStr },
								arguments: argsStr,
							});
						});
					}
					applyDisplayTransform(true);
					opts.onDelta(displayText, rawThinking);
				}
			} catch {
				rawText = jsonText;
				displayText = jsonText;
				opts.onDelta(displayText, rawThinking);
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

	const finalCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
	if (opts.preserveNativeToolCalls) {
		for (const [, tc] of [...toolCallAcc.entries()].sort((a, b) => a[0] - b[0])) {
			const name = String(tc.function?.name || tc.name || "").trim();
			if (!name) continue;
			const rawArgs = typeof tc.function?.arguments === "string" ? tc.function.arguments : typeof tc.arguments === "string" ? tc.arguments : "{}";
			let parsedArgs: Record<string, unknown> = {};
			try {
				const obj = JSON.parse(rawArgs);
				if (obj && typeof obj === "object" && !Array.isArray(obj)) parsedArgs = obj as Record<string, unknown>;
			} catch {
				/* keep empty */
			}
			finalCalls.push({ id: String(tc.id || `call_${finalCalls.length}`), name, arguments: parsedArgs });
		}
	}

	return {
		displayText,
		rawThinking,
		toolCalls: finalCalls,
		aborted,
		...(errMsg ? { errorMessage: errMsg } : {}),
		...(usage ? { usage } : {}),
	};
}
