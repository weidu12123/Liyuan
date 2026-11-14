/**
 * 纯后端 pi 发包中转处理器（Stage 2）。
 *
 * 职责（全部只读作用于单次 HTTP 发送副本，绝不修改内存分支或磁盘记录）：
 * 1. HTTP Headers 合并（before_provider_headers）；
 * 2. 跨协议门控：仅向原生 Google/Vertex 载荷（contents）注入 BLOCK_NONE，避免 OpenAI 中转 400；
 * 3. 系统消息合并（squash_system_messages）与声明式 chat_history 压平（script.data）；
 * 4. 防路由随机注释混淆（antiRouteShield: head / deep），避开 tool/tool_calls 与结尾预填；
 * 5. 自定义 body 字段增删（customIncludeBody / customExcludeBody）与预填协议兼容标记（partial / prefix）。
 */

import type { RelayPolicyConfig } from "../types.ts";
import type { ChatHistorySquashRule, PresetRelayMeta } from "./preset-relay-meta.ts";

export type RelayPayloadProtocol = "google" | "anthropic" | "openai-completions" | "openai-responses";

export interface RelayModelLike {
	id: string;
	provider?: string;
	api?: unknown;
	baseUrl?: string;
	reasoning?: boolean;
	headers?: Record<string, string>;
}

export const GEMINI_SAFETY_SETTINGS = [
	{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
	{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
	{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
	{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
	{ category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
] as const;

const PROTECTED_PROMPT_MARKER = "【梨园引擎输出协议｜最高优先级】";

function lower(s: unknown): string {
	return typeof s === "string" ? s.trim().toLowerCase() : "";
}

function randomShieldComment(minWords = 3, maxWords = 6): string {
	const count = minWords + Math.floor(Math.random() * Math.max(1, maxWords - minWords + 1));
	const tokens: string[] = [];
	for (let i = 0; i < count; i++) {
		tokens.push(Math.random().toString(36).slice(2, 8));
	}
	return `<!-- ${tokens.join(" ")} -->`;
}

function isProtectedTextBlock(text: string): boolean {
	const t = text.trimStart();
	return (
		t.startsWith("<system-reminder>") ||
		t.startsWith("<!-- ") ||
		text.includes(PROTECTED_PROMPT_MARKER)
	);
}

export function detectPayloadProtocol(payload: Record<string, unknown>, model?: RelayModelLike): RelayPayloadProtocol {
	if (Array.isArray(payload.contents)) return "google";
	if (Array.isArray(payload.input)) return "openai-responses";
	const api = lower(model?.api);
	if (api === "anthropic-messages") return "anthropic";
	if (api === "google-generative-ai" || api === "google-vertex") return "google";
	if (api === "openai-responses" || api === "azure-openai-responses" || api === "openai-codex-responses") {
		return "openai-responses";
	}
	return "openai-completions";
}

export function shouldInjectGoogleSafety(
	payload: Record<string, unknown>,
	model?: RelayModelLike,
	policy?: RelayPolicyConfig,
): boolean {
	if (policy?.googleSafetyOff === false) return false;
	if (Array.isArray(payload.messages)) return false;
	if (Array.isArray(payload.contents)) return true;
	const api = lower(model?.api);
	return api === "google-generative-ai" || api === "google-vertex";
}

export interface PrefillCapability {
	supported: boolean;
	reason?: string;
	applyPartialFlag?: boolean;
}

/**
 * 判定当前模型与渠道在「无工具、无历史 tool 残余」下是否合法支持末尾 assistant 预填。
 */
export function supportsTrailingPrefill(
	model?: RelayModelLike,
	opts: { hasThinking?: boolean } = {},
): PrefillCapability {
	const api = lower(model?.api) || "openai-completions";
	const provider = lower(model?.provider);
	const modelId = lower(model?.id);
	const base = lower(model?.baseUrl);

	if (api === "openai-responses" || api === "azure-openai-responses" || api === "openai-codex-responses") {
		return { supported: false, reason: "responses-api-no-prefill" };
	}

	if (api === "anthropic-messages") {
		if (opts.hasThinking) {
			return { supported: false, reason: "anthropic-thinking-incompatible" };
		}
		// Claude 4.6+ 官方及兼容端点已废除末尾 assistant prefill
		if (/claude-(?:opus|sonnet|haiku)-4-(?:[6-9]|\d{2})/.test(modelId) || /claude-4\.[6-9]/.test(modelId)) {
			return { supported: false, reason: "claude-4.6+-prefill-removed" };
		}
		return { supported: true };
	}

	if (api === "google-generative-ai" || api === "google-vertex") {
		return { supported: true };
	}

	// OpenAI 官方端点（GPT/o 系列）不把末尾 assistant 当续写起笔
	const isOfficialOpenAi =
		(provider === "openai" || base.includes("api.openai.com")) &&
		!modelId.includes("deepseek") &&
		!modelId.includes("kimi") &&
		!modelId.includes("claude") &&
		!modelId.includes("gemini");
	if (isOfficialOpenAi || /(^|\/)(gpt-|o1|o3|o4)/.test(modelId)) {
		return { supported: false, reason: "openai-gpt-no-prefill" };
	}

	// DeepSeek / Moonshot / Kimi 需要显式 partial: true（部分代理亦认 prefix: true）
	const needsPartial =
		provider.includes("deepseek") ||
		provider.includes("moonshot") ||
		provider.includes("kimi") ||
		base.includes("deepseek") ||
		base.includes("moonshot") ||
		base.includes("kimi") ||
		modelId.includes("deepseek") ||
		modelId.includes("kimi") ||
		modelId.includes("moonshot");

	return { supported: true, applyPartialFlag: needsPartial };
}

function contentToPlainText(content: unknown): string {
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

export function squashSystemMessagesInArray<T extends Record<string, unknown>>(messages: T[]): T[] {
	const out: T[] = [];
	for (const m of messages) {
		const prev = out[out.length - 1];
		if (m && prev && m.role === "system" && prev.role === "system") {
			const merged = [contentToPlainText(prev.content).trim(), contentToPlainText(m.content).trim()]
				.filter(Boolean)
				.join("\n\n");
			out[out.length - 1] = { ...prev, content: merged };
		} else {
			out.push({ ...m });
		}
	}
	return out;
}

/** 按预设 script.data.chat_history.squash_into_one 合并纯文本历史（避开 tool 轮与末条 user/assistant 预填） */
export function applyChatHistorySquashInArray(
	messages: Array<Record<string, unknown>>,
	rule: ChatHistorySquashRule,
): Array<Record<string, unknown>> {
	if (messages.length <= 2) return messages;
	// 存在任意 tool/tool_calls 轮次时，仅合并最后一次工具交互之前的安全前缀，保留工具链结构完整
	let lastToolIdx = -1;
	for (let i = 0; i < messages.length; i++) {
		const m = messages[i]!;
		if (m.role === "tool" || m.role === "toolResult" || Array.isArray(m.tool_calls)) {
			lastToolIdx = i;
		}
	}
	// 末尾保留最后 1 条（当前用户提问或末尾预填）不压入合并块
	const tailCut = messages.length - 1;
	const startIdx = lastToolIdx >= 0 ? lastToolIdx + 1 : 0;
	if (tailCut - startIdx < 2) return messages;

	const head = messages.slice(0, startIdx);
	const middle = messages.slice(startIdx, tailCut);
	const tail = messages.slice(tailCut);

	const parts: string[] = [];
	let floor = 0;
	for (const m of middle) {
		const txt = contentToPlainText(m.content).trim();
		if (!txt) continue;
		const role = String(m.role ?? "user");
		const repFloor = (tpl: string) => tpl.replaceAll("${floor}", String(floor));
		if (role === "assistant" || role === "model") {
			parts.push(`${repFloor(rule.assistantPrefix)}${txt}${repFloor(rule.assistantSuffix)}`);
			floor++;
		} else if (role === "system") {
			parts.push(`${repFloor(rule.systemPrefix)}${txt}${repFloor(rule.systemSuffix)}`);
		} else {
			parts.push(`${repFloor(rule.userPrefix)}${txt}${repFloor(rule.userSuffix)}`);
			floor++;
		}
	}
	if (parts.length === 0) return messages;
	return [
		...head,
		{ role: rule.squashRole, content: parts.join(rule.delimiter) },
		...tail,
	];
}

function injectCommentIntoString(text: string, withSuffix = false): string {
	if (!text.trim() || isProtectedTextBlock(text)) return text;
	const prefix = randomShieldComment(3, 6);
	if (!withSuffix) return `${prefix}\n${text}`;
	const suffix = randomShieldComment(3, 6);
	return `${prefix}\n${text}\n${suffix}`;
}

function shieldContentField(content: unknown, withSuffix: boolean): unknown {
	if (typeof content === "string") {
		return injectCommentIntoString(content, withSuffix);
	}
	if (!Array.isArray(content)) return content;
	let changed = false;
	const mapped = content.map((part, idx) => {
		if (
			part &&
			typeof part === "object" &&
			(part as { type?: unknown }).type === "text" &&
			typeof (part as { text?: unknown }).text === "string"
		) {
			const txt = (part as { text: string }).text;
			const nextTxt = injectCommentIntoString(txt, withSuffix && idx === content.length - 1);
			if (nextTxt !== txt) {
				changed = true;
				return { ...part, text: nextTxt };
			}
		}
		return part;
	});
	return changed ? mapped : content;
}

/**
 * 防路由随机注释混淆（仅改发送副本）：
 * - "head"：只处理开头 system 与最后一条非工具/非预填 user 消息；
 * - "deep"：覆盖所有非工具、非预填、非受保护前缀的文本消息。
 */
export function applyAntiRouteShield(
	payload: Record<string, unknown>,
	protocol: RelayPayloadProtocol,
	mode: "off" | "head" | "deep",
	opts: { hasTrailingPrefill?: boolean } = {},
): Record<string, unknown> {
	if (mode === "off") return payload;
	const out: Record<string, unknown> = { ...payload };

	if (protocol === "google" && Array.isArray(out.contents)) {
		const contents = out.contents as Array<Record<string, unknown>>;
		const lastIdx = opts.hasTrailingPrefill ? contents.length - 2 : contents.length - 1;
		out.contents = contents.map((item, idx) => {
			if (!item || !Array.isArray(item.parts)) return item;
			const hasToolPart = (item.parts as Array<Record<string, unknown>>).some(
				(p) => p && ("functionCall" in p || "functionResponse" in p),
			);
			if (hasToolPart) return item;
			if (mode === "head" && idx !== 0 && idx !== lastIdx) return item;
			const nextParts = (item.parts as Array<Record<string, unknown>>).map((p) => {
				if (p && typeof p.text === "string" && p.thought !== true) {
					return { ...p, text: injectCommentIntoString(p.text, mode === "deep" && idx === lastIdx) };
				}
				return p;
			});
			return { ...item, parts: nextParts };
		});
		return out;
	}

	if (Array.isArray(out.messages)) {
		const msgs = out.messages as Array<Record<string, unknown>>;
		const lastAllowedIdx = opts.hasTrailingPrefill ? msgs.length - 2 : msgs.length - 1;
		let hitSystem = false;
		out.messages = msgs.map((m, idx) => {
			if (!m || typeof m !== "object") return m;
			const role = String(m.role ?? "");
			if (role === "tool" || role === "toolResult" || Array.isArray(m.tool_calls)) return m;
			if (opts.hasTrailingPrefill && idx === msgs.length - 1 && role === "assistant") return m;

			if (mode === "head") {
				const isFirstSystem = role === "system" && !hitSystem;
				if (isFirstSystem) hitSystem = true;
				const isTargetTail = idx === lastAllowedIdx;
				if (!isFirstSystem && !isTargetTail) return m;
				return { ...m, content: shieldContentField(m.content, isTargetTail) };
			}
			return { ...m, content: shieldContentField(m.content, idx === lastAllowedIdx) };
		});
	}

	return out;
}

function deletePath(obj: Record<string, unknown>, pathExpr: string): void {
	const parts = pathExpr.split(".").map((p) => p.trim()).filter(Boolean);
	if (parts.length === 0) return;
	let cur: unknown = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		if (!cur || typeof cur !== "object" || Array.isArray(cur)) return;
		cur = (cur as Record<string, unknown>)[parts[i]!];
	}
	if (cur && typeof cur === "object" && !Array.isArray(cur)) {
		delete (cur as Record<string, unknown>)[parts[parts.length - 1]!];
	}
}

export function applyRelayHeaders(
	headers: Record<string, string>,
	policy?: RelayPolicyConfig,
	extraHeaders?: Record<string, string>,
): void {
	for (const src of [policy?.customIncludeHeaders, extraHeaders]) {
		if (!src || typeof src !== "object") continue;
		for (const [k, v] of Object.entries(src)) {
			const key = k.trim();
			if (key && typeof v === "string") {
				headers[key] = v;
			}
		}
	}
}

export interface ApplyRelayPayloadOptions {
	policy?: RelayPolicyConfig;
	presetMeta?: PresetRelayMeta;
	/** 当前这跳是否处于「无工具且末尾附加了 assistant 预填」的状态 */
	trailingPrefillActive?: boolean;
	/** 本跳临时强制的混淆档位（供拒答降级重试使用） */
	overrideShieldMode?: "off" | "head" | "deep";
	/** 条目级额外 body 字段 */
	extraIncludeBody?: Record<string, unknown>;
	extraExcludeBody?: string[];
}

/**
 * 在 before_provider_request（onPayload）阶段对已按目标协议序列化后的请求体执行中转变换。
 * 返回 undefined 表示无需修改；返回对象时替换送往上游的请求体。
 */
export function applyRelayPayload(
	payload: unknown,
	model?: RelayModelLike,
	opts: ApplyRelayPayloadOptions = {},
): Record<string, unknown> | undefined {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	const policy = opts.policy;
	const presetMeta = opts.presetMeta;
	const protocol = detectPayloadProtocol(payload as Record<string, unknown>, model);

	let next: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
	let mutated = false;

	// 1. 系统消息合并与声明式 chat_history 压平（仅 OpenAI messages 形态需要）
	if (protocol === "openai-completions" && Array.isArray(next.messages)) {
		const shouldSquash = policy?.squashSystemMessages ?? presetMeta?.squashSystemMessages ?? false;
		if (shouldSquash) {
			const squashed = squashSystemMessagesInArray(next.messages as Array<Record<string, unknown>>);
			next.messages = squashed;
			mutated = true;
		}
		if (presetMeta?.chatHistorySquash) {
			next.messages = applyChatHistorySquashInArray(
				next.messages as Array<Record<string, unknown>>,
				presetMeta.chatHistorySquash,
			);
			mutated = true;
		}
	}

	// 2. 无工具末尾预填标记（partial / prefix）
	if (opts.trailingPrefillActive && protocol === "openai-completions" && Array.isArray(next.messages)) {
		const cap = supportsTrailingPrefill(model);
		const msgs = [...(next.messages as Array<Record<string, unknown>>)];
		const last = msgs[msgs.length - 1];
		const hasAnyTools = (Array.isArray(next.tools) && next.tools.length > 0) || msgs.some((m) => m.role === "tool");
		if (cap.supported && !hasAnyTools && last && last.role === "assistant") {
			const patchedLast = { ...last };
			if (cap.applyPartialFlag) {
				patchedLast.partial = true;
				patchedLast.prefix = true;
			}
			msgs[msgs.length - 1] = patchedLast;
			next.messages = msgs;
			mutated = true;
		}
	}

	// 3. Google 原生端点 BLOCK_NONE 注入（挂于 params.config.safetySettings）
	if (shouldInjectGoogleSafety(next, model, policy)) {
		const cfg =
			next.config && typeof next.config === "object" && !Array.isArray(next.config)
				? { ...(next.config as Record<string, unknown>) }
				: {};
		cfg.safetySettings = GEMINI_SAFETY_SETTINGS.map((x) => ({ ...x }));
		next.config = cfg;
		mutated = true;
	}

	// 4. 防路由注释混淆（优先使用临时降级档位）
	const shieldMode = opts.overrideShieldMode ?? policy?.antiRouteShield ?? "off";
	if (shieldMode !== "off") {
		next = applyAntiRouteShield(next, protocol, shieldMode, {
			hasTrailingPrefill: opts.trailingPrefillActive,
		});
		mutated = true;
	}

	// 5. 推理预算透传（若模型与请求尚未显式设定）
	if (presetMeta?.reasoningEffort && protocol === "openai-completions" && next.reasoning_effort === undefined && model?.reasoning) {
		next.reasoning_effort = presetMeta.reasoningEffort;
		mutated = true;
	}

	// 6. 自定义请求体字段合并与剔除
	const includes = { ...(policy?.customIncludeBody ?? {}), ...(opts.extraIncludeBody ?? {}) };
	for (const [k, v] of Object.entries(includes)) {
		if (next[k] === undefined && v !== undefined) {
			next[k] = v;
			mutated = true;
		}
	}
	const excludes = [...(policy?.customExcludeBody ?? []), ...(opts.extraExcludeBody ?? [])];
	for (const pathExpr of excludes) {
		deletePath(next, pathExpr);
		mutated = true;
	}

	return mutated ? next : undefined;
}
