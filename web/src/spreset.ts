/**
 * 内置 SPreset 协议执行器（按预设自身携带的 SPresetSettings / extensions.SPreset 数据驱动）。
 *
 * 铁律三合规声明：本模块只认 SPreset 协议公开字段（ChatSquash / ToolBindings /
 * MessageInjections / FinalRequestProcessing / OutputPreprocessing），不硬编码任何预设名、
 * 工具名或作者措辞。
 */

import {
	extractSPresetConfig,
	type SPresetChatSquashConfig,
	type SPresetConfig,
	type SPresetToolBindingItem,
} from "../../src/spreset-config.ts";

export {
	extractSPresetConfig,
	type SPresetChatSquashConfig,
	type SPresetConfig,
	type SPresetToolBindingItem,
};

export interface SPresetOpenAiMessage {
	role: "system" | "user" | "assistant" | "tool" | "model";
	content: string | Array<Record<string, unknown>>;
	identifier?: string;
	name?: string;
	[key: string]: unknown;
}

export interface SPresetOpenAiToolCall {
	id?: string;
	index?: number;
	type?: string;
	name?: string;
	function?: {
		name?: string;
		arguments?: string | Record<string, unknown>;
	};
	arguments?: string | Record<string, unknown>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

const substSimpleMacros = (text: string, charName: string, userName: string): string =>
	text.replace(/\{\{\s*char\s*\}\}/gi, charName).replace(/\{\{\s*user\s*\}\}/gi, userName);

const msgContentStr = (content: unknown): string => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return content == null ? "" : String(content);
	return content
		.map((p) => (typeof p === "string" ? p : p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
		.join("\n");
};

function compileFn<T extends (...args: never[]) => unknown>(code: string, wrapReturn = false): T | null {
	const src = String(code || "").trim();
	if (!src) return null;
	try {
		const expr = wrapReturn ? src : `const __fn = ${src}\n; return __fn;`;
		const factory = new Function(expr);
		const fn = factory();
		return typeof fn === "function" ? (fn as T) : null;
	} catch {
		if (!wrapReturn) {
			try {
				const fn = new Function(src);
				return typeof fn === "function" ? (fn as T) : null;
			} catch {
				return null;
			}
		}
		return null;
	}
}

/** 1. ChatSquash：按预设配置压平消息并执行 squashed_post_script */
export function runSPresetChatSquash(
	messages: SPresetOpenAiMessage[],
	spConfig: SPresetConfig | null,
	macro: { charName: string; userName: string },
): SPresetOpenAiMessage[] {
	const cs = spConfig?.ChatSquash;
	if (!cs || cs.enabled !== true || messages.length === 0) return messages;

	const condTag = typeof cs.conditional_tag === "string" ? cs.conditional_tag : "";
	if (cs.conditional_enabled && condTag) {
		const hasTag = messages.some((m) => msgContentStr(m.content).includes(condTag));
		if (!hasTag) return messages;
	}

	const userPrefix = cs.user_prefix ? substSimpleMacros(cs.user_prefix, macro.charName, macro.userName) : "";
	const userSuffix = cs.user_suffix ? substSimpleMacros(cs.user_suffix, macro.charName, macro.userName) : "";
	const charPrefix = cs.char_prefix ? substSimpleMacros(cs.char_prefix, macro.charName, macro.userName) : "";
	const charSuffix = cs.char_suffix ? substSimpleMacros(cs.char_suffix, macro.charName, macro.userName) : "";
	const sysPrefix = cs.prefix_system ? substSimpleMacros(cs.prefix_system, macro.charName, macro.userName) : "";
	const sysSuffix = cs.suffix_system ? substSimpleMacros(cs.suffix_system, macro.charName, macro.userName) : "";

	const stripTag = (s: string) => (condTag ? s.replaceAll(condTag, "") : s);
	const sep = cs.enable_squashed_separator !== false && typeof cs.squashed_separator_string === "string"
		? cs.squashed_separator_string
		: "\n\n";

	const targetList: SPresetOpenAiMessage[] = [];
	const preservedTail: SPresetOpenAiMessage[] = [];
	if (cs.separate_chat_history) {
		const lastUserIdx = [...messages].reverse().findIndex((m) => m.role === "user");
		const cut = lastUserIdx >= 0 ? messages.length - 1 - lastUserIdx : messages.length;
		targetList.push(...messages.slice(0, cut));
		preservedTail.push(...messages.slice(cut));
	} else {
		targetList.push(...messages);
	}

	const formattedParts = targetList
		.map((m) => {
			const txt = stripTag(msgContentStr(m.content));
			if (!txt.trim()) return "";
			if (m.role === "user") return `${userPrefix}${txt}${userSuffix}`;
			if (m.role === "assistant" || m.role === "model") return `${charPrefix}${txt}${charSuffix}`;
			return `${sysPrefix}${txt}${sysSuffix}`;
		})
		.filter(Boolean);

	let squashed = formattedParts.join(sep);
	if (cs.squashed_post_script_enable && cs.squashed_post_script) {
		const fn = compileFn<(content: string) => unknown>(cs.squashed_post_script);
		if (fn) {
			try {
				const out = fn(squashed);
				if (typeof out === "string") squashed = out;
			} catch (err) {
				console.error("[liyuan SPreset ChatSquash post_script]", err);
			}
		}
	}

	return [
		{ role: cs.role || "system", content: squashed },
		...preservedTail,
	];
}

/** 2. ToolBindings & MessageInjections：向 OpenAI request 注入工具定义与伪消息块 */
export function applySPresetToolsAndInjections(
	payload: Record<string, unknown>,
	spConfig: SPresetConfig | null,
): Record<string, unknown> {
	if (!spConfig) return payload;
	const existingTools = Array.isArray(payload.tools) ? [...(payload.tools as Array<Record<string, unknown>>)] : [];

	if (spConfig.ToolBindings && typeof spConfig.ToolBindings === "object") {
		for (const item of Object.values(spConfig.ToolBindings)) {
			if (!item || item.enabled !== true) continue;
			let def: Record<string, unknown> | null = null;
			if (typeof item.code === "string" && item.code.trim()) {
				try {
					const fn = new Function(item.code);
					const res = fn();
					if (isObj(res) && typeof res.name === "string" && res.name.trim()) {
						def = res;
					}
				} catch (err) {
					console.error("[liyuan SPreset ToolBinding eval]", err);
				}
			}
			if (!def && item.form && typeof item.form.name === "string" && item.form.name.trim()) {
				const props: Record<string, unknown> = {};
				const req: string[] = [];
				for (const p of item.form.parameters ?? []) {
					if (!p?.name) continue;
					props[p.name] = { type: p.type || "string", description: p.description || "" };
					if (p.required) req.push(p.name);
				}
				def = {
					name: item.form.name.trim(),
					description: item.form.description || "",
					parameters: { type: "object", properties: props, ...(req.length > 0 ? { required: req } : {}) },
				};
			}
			if (def) {
				const name = String(def.name);
				const toolObj = {
					type: "function",
					function: {
						name,
						description: String(def.description ?? ""),
						parameters: isObj(def.parameters) ? def.parameters : { type: "object", properties: {} },
					},
				};
				const idx = existingTools.findIndex((t) => {
					const fn = (t.function as { name?: string } | undefined) ?? (t as { name?: string });
					return fn?.name === name;
				});
				if (idx >= 0) existingTools[idx] = toolObj;
				else existingTools.push(toolObj);
			}
		}
	}
	if (existingTools.length > 0) {
		payload.tools = existingTools;
	}

	if (spConfig.MessageInjections && typeof spConfig.MessageInjections === "object") {
		const msgs = Array.isArray(payload.messages) ? [...(payload.messages as Array<Record<string, unknown>>)] : [];
		for (const inj of Object.values(spConfig.MessageInjections)) {
			if (!inj || inj.enabled !== true) continue;
			if (Array.isArray(inj.toolCalls) && inj.toolCalls.length > 0) {
				msgs.push({
					role: "assistant",
					content: inj.reasoning || "",
					...(inj.signature ? { thoughtSignature: inj.signature } : {}),
					tool_calls: inj.toolCalls.map((tc, i) => ({
						id: String(tc.id ?? `call_inj_${i}`),
						type: "function",
						function: {
							name: String(tc.name ?? ""),
							arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments ?? {}),
						},
						...(tc.signature ? { signature: tc.signature } : {}),
					})),
				});
			}
			if (Array.isArray(inj.toolResults) && inj.toolResults.length > 0) {
				for (const tr of inj.toolResults) {
					msgs.push({
						role: "tool",
						tool_call_id: String(tr.id ?? tr.tool_call_id ?? "call_inj_0"),
						name: String(tr.name ?? ""),
						content: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content ?? ""),
					});
				}
			}
		}
		payload.messages = msgs;
	}
	return payload;
}

/** 3. FinalRequestProcessing：执行预设最终请求改写脚本 */
export async function runSPresetFinalRequestProcessing(
	payload: Record<string, unknown>,
	spConfig: SPresetConfig | null,
): Promise<Record<string, unknown>> {
	const frp = spConfig?.FinalRequestProcessing;
	if (!frp || frp.enabled !== true || typeof frp.script !== "string" || !frp.script.trim()) {
		return payload;
	}
	const fn = compileFn<(ctx: { request: Record<string, unknown> }) => unknown>(frp.script);
	if (!fn) return payload;
	try {
		const result = await fn({ request: payload });
		return isObj(result) ? result : payload;
	} catch (err) {
		console.error("[liyuan SPreset FinalRequestProcessing]", err);
		return payload;
	}
}

/** 4. OutputPreprocessing：将模型吐出的 tool_calls 参数实时格式化为显示正文（含半截 JSON 流式解析） */
export function runSPresetOutputPreprocessing(
	toolCalls: SPresetOpenAiToolCall[],
	rawText: string,
	spConfig: SPresetConfig | null,
	stateRef: { current: Record<string, unknown> },
	isFinal: boolean,
): { text: string; consumedToolCalls: boolean } {
	const op = spConfig?.OutputPreprocessing;
	if (!op || op.enabled !== true) {
		return { text: rawText, consumedToolCalls: false };
	}

	let out = rawText;
	let consumedToolCalls = false;

	if (toolCalls.length > 0 && op.consumeToolCalls && op.toolCallFormatter?.enabled && op.toolCallFormatter.script) {
		const fmtFn = compileFn<(ctx: { calls: SPresetOpenAiToolCall[]; defaultText: string }) => unknown>(
			op.toolCallFormatter.script,
		);
		if (fmtFn) {
			try {
				const normalizedCalls = toolCalls.map((c) => {
					const fnName = c.name ?? c.function?.name ?? "";
					const fnArgs = c.arguments ?? c.function?.arguments ?? "";
					return {
						...c,
						name: fnName,
						arguments: fnArgs,
						function: c.function ?? { name: fnName, arguments: fnArgs },
					};
				});
				const formatted = fmtFn({ calls: normalizedCalls, defaultText: rawText });
				if (typeof formatted === "string") {
					out = formatted;
					consumedToolCalls = true;
				}
			} catch (err) {
				console.error("[liyuan SPreset toolCallFormatter]", err);
			}
		}
	}

	if (typeof op.script === "string" && op.script.trim()) {
		const opFn = compileFn<(ctx: { buffer: string; final: boolean; state: Record<string, unknown> }) => unknown>(op.script);
		if (opFn) {
			try {
				const res = opFn({ buffer: out, final: isFinal, state: stateRef.current });
				if (isObj(res)) {
					if (typeof res.output === "string") out = res.output;
					if (isObj(res.state)) stateRef.current = res.state;
				}
			} catch (err) {
				console.error("[liyuan SPreset OutputPreprocessing]", err);
			}
		}
	}

	return { text: out, consumedToolCalls };
}
