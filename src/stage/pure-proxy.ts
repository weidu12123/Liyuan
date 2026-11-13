/**
 * 纯酒馆浏览器透传管道辅助模块（/api/backends/chat-completions/generate 后端代理核心）。
 *
 * 职责：
 * - 对于 `openai-completions` / `openai-responses` 及通用中转站：原封不动保留前端脚本/SPreset
 *   修改后的全部 JSON 字段（messages / tools / tool_choice / toolConfig / extra_content /
 *   thoughtSignature / safety_settings 等），仅贴上服务端保存的 API Key 与目标 URL 透传；
 * - 对于直连 `anthropic-messages` 或 `google-generative-ai` 官方端点：做双向协议转换，
 *   将上游 SSE 流统一转为标准 OpenAI ChatCompletion SSE chunk 返回给前端消费。
 */

export interface ProxyModelTarget {
	id: string;
	provider?: string;
	api?: string;
	baseUrl?: string;
	headers?: Record<string, string>;
}

export interface ProxyAuthInfo {
	apiKey?: string;
	headers?: Record<string, string | null>;
}

export interface PreparedUpstreamFetch {
	protocol: "openai-passthrough" | "anthropic" | "google";
	url: string;
	headers: Record<string, string>;
	body: Record<string, unknown>;
	isStream: boolean;
}

const stripTrailingSlashes = (s: string): string => s.replace(/\/+$/, "");

function cleanHeaders(raw: Array<Record<string, string | null | undefined> | undefined>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const src of raw) {
		if (!src) continue;
		for (const [k, v] of Object.entries(src)) {
			if (typeof v === "string") out[k] = v;
		}
	}
	return out;
}

function parseCustomIncludeBody(raw: unknown): Record<string, unknown> {
	if (!raw || typeof raw !== "string" || !raw.trim()) return {};
	const t = raw.trim();
	if (t.startsWith("{")) {
		try {
			const obj = JSON.parse(t);
			return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {};
		} catch {
			return {};
		}
	}
	const out: Record<string, unknown> = {};
	for (const line of t.split(/\r?\n/)) {
		const m = /^\s*([A-Za-z0-9_.-]+)\s*:\s*(.+?)\s*$/.exec(line);
		if (!m) continue;
		const valRaw = m[2]!;
		if (valRaw === "true") out[m[1]!] = true;
		else if (valRaw === "false") out[m[1]!] = false;
		else if (/^-?\d+(?:\.\d+)?$/.test(valRaw)) out[m[1]!] = Number(valRaw);
		else out[m[1]!] = valRaw.replace(/^['"]|['"]$/g, "");
	}
	return out;
}

function contentToText(content: unknown): string {
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
		.join("\n");
}

function safeJsonParse(s: unknown): Record<string, unknown> {
	if (s && typeof s === "object" && !Array.isArray(s)) return s as Record<string, unknown>;
	if (typeof s !== "string") return {};
	try {
		const obj = JSON.parse(s);
		return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

export function openaiToAnthropicBody(payload: Record<string, unknown>, modelId: string): Record<string, unknown> {
	const msgs = Array.isArray(payload.messages) ? (payload.messages as Array<Record<string, unknown>>) : [];
	const systemParts: string[] = [];
	const outMsgs: Array<{ role: "user" | "assistant"; content: unknown }> = [];

	for (const m of msgs) {
		const role = String(m.role ?? "user");
		if (role === "system") {
			const txt = contentToText(m.content).trim();
			if (txt) systemParts.push(txt);
			continue;
		}
		if (role === "tool") {
			const block = {
				type: "tool_result",
				tool_use_id: String(m.tool_call_id ?? "call_0"),
				content: contentToText(m.content),
			};
			const prev = outMsgs[outMsgs.length - 1];
			if (prev && prev.role === "user" && Array.isArray(prev.content)) {
				(prev.content as unknown[]).push(block);
			} else {
				outMsgs.push({ role: "user", content: [block] });
			}
			continue;
		}
		if (role === "assistant" || role === "model") {
			const blocks: unknown[] = [];
			const txt = contentToText(m.content);
			if (txt) blocks.push({ type: "text", text: txt });
			if (Array.isArray(m.tool_calls)) {
				for (const tc of m.tool_calls as Array<Record<string, unknown>>) {
					const fn = (tc.function as Record<string, unknown> | undefined) ?? tc;
					blocks.push({
						type: "tool_use",
						id: String(tc.id ?? "call_0"),
						name: String(fn.name ?? "tool"),
						input: safeJsonParse(fn.arguments),
					});
				}
			}
			if (blocks.length > 0) {
				outMsgs.push({ role: "assistant", content: blocks.length === 1 && !Array.isArray(m.tool_calls) ? txt : blocks });
			}
			continue;
		}
		const txt = contentToText(m.content);
		const prev = outMsgs[outMsgs.length - 1];
		if (prev && prev.role === "user") {
			if (Array.isArray(prev.content)) (prev.content as unknown[]).push({ type: "text", text: txt });
			else prev.content = `${String(prev.content)}\n\n${txt}`;
		} else {
			outMsgs.push({ role: "user", content: txt });
		}
	}

	const body: Record<string, unknown> = {
		model: typeof payload.model === "string" && payload.model.trim() ? payload.model : modelId,
		messages: outMsgs,
		max_tokens: typeof payload.max_tokens === "number" ? payload.max_tokens : 4096,
		stream: payload.stream !== false,
	};
	if (systemParts.length > 0) body.system = systemParts.join("\n\n");
	if (typeof payload.temperature === "number") body.temperature = payload.temperature;
	if (typeof payload.top_p === "number") body.top_p = payload.top_p;
	if (typeof payload.top_k === "number" && payload.top_k > 0) body.top_k = payload.top_k;
	if (Array.isArray(payload.stop)) body.stop_sequences = payload.stop;
	if (Array.isArray(payload.tools) && payload.tools.length > 0) {
		body.tools = (payload.tools as Array<Record<string, unknown>>).map((t) => {
			const fn = (t.function as Record<string, unknown> | undefined) ?? t;
			return {
				name: String(fn.name ?? ""),
				description: String(fn.description ?? ""),
				input_schema: fn.parameters ?? { type: "object", properties: {} },
			};
		});
		if (payload.tool_choice === "required") body.tool_choice = { type: "any" };
		else if (payload.tool_choice === "auto") body.tool_choice = { type: "auto" };
		else if (payload.tool_choice && typeof payload.tool_choice === "object") {
			const fnName = (payload.tool_choice as { function?: { name?: string } }).function?.name;
			if (fnName) body.tool_choice = { type: "tool", name: fnName };
		}
	}
	return body;
}

export function openaiToGeminiBody(payload: Record<string, unknown>): Record<string, unknown> {
	const msgs = Array.isArray(payload.messages) ? (payload.messages as Array<Record<string, unknown>>) : [];
	const systemParts: string[] = [];
	const contents: Array<{ role: "user" | "model"; parts: unknown[] }> = [];

	for (const m of msgs) {
		const role = String(m.role ?? "user");
		if (role === "system") {
			const txt = contentToText(m.content).trim();
			if (txt) systemParts.push(txt);
			continue;
		}
		if (role === "tool") {
			const part = {
				functionResponse: {
					name: String(m.name ?? "tool"),
					response: { result: contentToText(m.content) },
				},
			};
			const prev = contents[contents.length - 1];
			if (prev && prev.role === "user") prev.parts.push(part);
			else contents.push({ role: "user", parts: [part] });
			continue;
		}
		if (role === "assistant" || role === "model") {
			const parts: unknown[] = [];
			const txt = contentToText(m.content);
			const topSig =
				typeof m.thoughtSignature === "string"
					? m.thoughtSignature
					: (m.extra_content as { google?: { thoughtSignature?: string } } | undefined)?.google?.thoughtSignature;
			if (txt) {
				parts.push({ text: txt, ...(topSig ? { thoughtSignature: topSig } : {}) });
			}
			if (Array.isArray(m.tool_calls)) {
				for (const tc of m.tool_calls as Array<Record<string, unknown>>) {
					const fn = (tc.function as Record<string, unknown> | undefined) ?? tc;
					const sig =
						typeof tc.signature === "string"
							? tc.signature
							: (tc.extra_content as { google?: { thoughtSignature?: string } } | undefined)?.google?.thoughtSignature ??
								topSig;
					parts.push({
						functionCall: {
							name: String(fn.name ?? "tool"),
							args: safeJsonParse(fn.arguments),
						},
						...(sig ? { thoughtSignature: sig } : {}),
					});
				}
			}
			if (parts.length > 0) contents.push({ role: "model", parts });
			continue;
		}
		const txt = contentToText(m.content);
		const prev = contents[contents.length - 1];
		if (prev && prev.role === "user") prev.parts.push({ text: txt });
		else contents.push({ role: "user", parts: [{ text: txt }] });
	}

	const genConfig: Record<string, unknown> = {};
	if (typeof payload.temperature === "number") genConfig.temperature = payload.temperature;
	if (typeof payload.top_p === "number") genConfig.topP = payload.top_p;
	if (typeof payload.top_k === "number" && payload.top_k > 0) genConfig.topK = payload.top_k;
	if (typeof payload.max_tokens === "number") genConfig.maxOutputTokens = payload.max_tokens;
	if (Array.isArray(payload.stop)) genConfig.stopSequences = payload.stop;

	const body: Record<string, unknown> = {
		contents,
		generationConfig: genConfig,
	};
	if (systemParts.length > 0) {
		body.systemInstruction = { parts: [{ text: systemParts.join("\n\n") }] };
	}
	if (Array.isArray(payload.tools) && payload.tools.length > 0) {
		body.tools = [
			{
				functionDeclarations: (payload.tools as Array<Record<string, unknown>>).map((t) => {
					const fn = (t.function as Record<string, unknown> | undefined) ?? t;
					return {
						name: String(fn.name ?? ""),
						description: String(fn.description ?? ""),
						parameters: fn.parameters ?? { type: "object", properties: {} },
					};
				}),
			},
		];
	}
	if (payload.toolConfig) {
		body.toolConfig = payload.toolConfig;
	} else if (payload.tool_choice === "required") {
		body.toolConfig = { functionCallingConfig: { mode: "ANY" } };
	}
	if (Array.isArray(payload.safety_settings)) {
		body.safetySettings = payload.safety_settings;
	}
	return body;
}

export function resolveUpstreamRequest(
	model: ProxyModelTarget,
	auth: ProxyAuthInfo,
	incomingPayload: Record<string, unknown>,
): PreparedUpstreamFetch {
	const payload: Record<string, unknown> = { ...incomingPayload };
	const extraInclude = parseCustomIncludeBody(payload.custom_include_body);
	delete payload.custom_include_body;
	delete payload.chat_completion_source;
	delete payload.type;
	delete payload.dry_run;
	delete payload.dryRun;
	for (const [k, v] of Object.entries(extraInclude)) {
		if (payload[k] === undefined) payload[k] = v;
	}

	const isStream = payload.stream !== false;
	const api = String(model.api || "openai-completions");
	const base = stripTrailingSlashes(String(model.baseUrl || "https://api.openai.com/v1"));

	if (api === "anthropic-messages") {
		const url = /\/messages$/i.test(base) ? base : /\/v1$/i.test(base) ? `${base}/messages` : `${base}/v1/messages`;
		const headers = cleanHeaders([
			{ "content-type": "application/json", "anthropic-version": "2023-06-01" },
			model.headers,
			auth.headers,
			auth.apiKey ? { "x-api-key": auth.apiKey } : undefined,
		]);
		return {
			protocol: "anthropic",
			url,
			headers,
			body: openaiToAnthropicBody(payload, model.id),
			isStream,
		};
	}

	if (api === "google-generative-ai") {
		const gBase = stripTrailingSlashes(base || "https://generativelanguage.googleapis.com/v1beta");
		const method = isStream ? "streamGenerateContent?alt=sse" : "generateContent";
		const url = `${gBase}/models/${encodeURIComponent(model.id)}:${method}`;
		const headers = cleanHeaders([
			{ "content-type": "application/json" },
			model.headers,
			auth.headers,
			auth.apiKey ? { "x-goog-api-key": auth.apiKey } : undefined,
		]);
		return {
			protocol: "google",
			url,
			headers,
			body: openaiToGeminiBody(payload),
			isStream,
		};
	}

	if (typeof payload.model !== "string" || !payload.model.trim()) {
		payload.model = model.id;
	}
	const url = /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
	const headers = cleanHeaders([
		{ "content-type": "application/json" },
		model.headers,
		auth.headers,
	]);
	if (auth.apiKey && !headers.authorization && !headers.Authorization) {
		headers.authorization = `Bearer ${auth.apiKey}`;
	}
	return {
		protocol: "openai-passthrough",
		url,
		headers,
		body: payload,
		isStream,
	};
}

/** 将 Anthropic SSE 事件行转为标准 OpenAI SSE 文本块 */
export function translateAnthropicSseEvent(eventName: string, dataJson: Record<string, unknown>): string | null {
	if (eventName === "content_block_start") {
		const cb = dataJson.content_block as { type?: string; id?: string; name?: string } | undefined;
		if (cb?.type === "tool_use") {
			const idx = typeof dataJson.index === "number" ? dataJson.index : 0;
			return `data: ${JSON.stringify({
				id: "chatcmpl-anthropic",
				object: "chat.completion.chunk",
				choices: [{ index: 0, delta: { tool_calls: [{ index: idx, id: cb.id ?? `call_${idx}`, type: "function", function: { name: cb.name ?? "", arguments: "" } }] } }],
			})}\n\n`;
		}
		return null;
	}
	if (eventName === "content_block_delta") {
		const delta = dataJson.delta as { type?: string; text?: string; thinking?: string; partial_json?: string } | undefined;
		if (!delta) return null;
		const idx = typeof dataJson.index === "number" ? dataJson.index : 0;
		if (delta.type === "text_delta" && typeof delta.text === "string") {
			return `data: ${JSON.stringify({
				id: "chatcmpl-anthropic",
				object: "chat.completion.chunk",
				choices: [{ index: 0, delta: { content: delta.text } }],
			})}\n\n`;
		}
		if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
			return `data: ${JSON.stringify({
				id: "chatcmpl-anthropic",
				object: "chat.completion.chunk",
				choices: [{ index: 0, delta: { reasoning_content: delta.thinking } }],
			})}\n\n`;
		}
		if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
			return `data: ${JSON.stringify({
				id: "chatcmpl-anthropic",
				object: "chat.completion.chunk",
				choices: [{ index: 0, delta: { tool_calls: [{ index: idx, function: { arguments: delta.partial_json } }] } }],
			})}\n\n`;
		}
		return null;
	}
	if (eventName === "message_stop") {
		return "data: [DONE]\n\n";
	}
	return null;
}

/** 将 Gemini SSE JSON data 转为标准 OpenAI SSE 文本块 */
export function translateGeminiSseData(dataJson: Record<string, unknown>): string | null {
	const candidates = Array.isArray(dataJson.candidates) ? (dataJson.candidates as Array<Record<string, unknown>>) : [];
	const first = candidates[0];
	const parts = Array.isArray((first?.content as { parts?: unknown[] } | undefined)?.parts)
		? ((first!.content as { parts: Array<Record<string, unknown>> }).parts)
		: [];
	const outChunks: string[] = [];
	let tcIdx = 0;
	for (const p of parts) {
		if (p.thought === true && typeof p.text === "string") {
			outChunks.push(
				`data: ${JSON.stringify({
					id: "chatcmpl-gemini",
					object: "chat.completion.chunk",
					choices: [{ index: 0, delta: { reasoning_content: p.text } }],
				})}\n\n`,
			);
		} else if (typeof p.text === "string") {
			outChunks.push(
				`data: ${JSON.stringify({
					id: "chatcmpl-gemini",
					object: "chat.completion.chunk",
					choices: [{ index: 0, delta: { content: p.text } }],
				})}\n\n`,
			);
		} else if (p.functionCall && typeof p.functionCall === "object") {
			const fc = p.functionCall as { name?: string; args?: unknown };
			outChunks.push(
				`data: ${JSON.stringify({
					id: "chatcmpl-gemini",
					object: "chat.completion.chunk",
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{
										index: tcIdx,
										id: `call_gemini_${tcIdx}`,
										type: "function",
										function: { name: String(fc.name ?? "tool"), arguments: JSON.stringify(fc.args ?? {}) },
									},
								],
							},
						},
					],
				})}\n\n`,
			);
			tcIdx++;
		}
	}
	if (first?.finishReason) {
		outChunks.push(
			`data: ${JSON.stringify({
				id: "chatcmpl-gemini",
				object: "chat.completion.chunk",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			})}\n\n`,
		);
	}
	return outChunks.length > 0 ? outChunks.join("") : null;
}
