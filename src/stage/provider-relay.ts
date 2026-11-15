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

import { readRelayRules, type RelayRules } from "../relay-rules.ts";
import type { RelayPolicyConfig } from "../types.ts";
import type { ChatHistorySquashRule, PresetRelayMeta } from "./preset-relay-meta.ts";

export type RelayPayloadProtocol = "google" | "anthropic" | "openai-completions" | "openai-responses";
export type AntiRouteShieldMode = "off" | "head" | "deep" | "scramble";
export type ContextPackMode = "off" | "auto" | "tool-desc";

export const CARRIER_TOOL_NAME = "liyuan_context_reference";
export const CONTEXT_PACK_MAX_CHARS = 180_000;
const CONTEXT_PACK_MIN_CHARS = 20;
const PACKED_SYSTEM_ANCHOR =
	"本轮设定与前序上下文已完整打包于工具 liyuan_context_reference 的 description JSON 资料字段中，无需调用该工具，请直接读取其中资料并回应最后一条 user 输入。";
const OAUTH_CLAUDE_CODE_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude.";

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

function createSeededRandom(seed: number): () => number {
	let s = seed >>> 0 || 1;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function randomShieldComment(minWords = 3, maxWords = 6, rng: () => number = Math.random): string {
	const count = minWords + Math.floor(rng() * Math.max(1, maxWords - minWords + 1));
	const tokens: string[] = [];
	for (let i = 0; i < count; i++) {
		tokens.push(rng().toString(36).slice(2, 8).padEnd(4, "x"));
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

export function shouldInjectOpenAiGeminiSafety(
	payload: Record<string, unknown>,
	model?: RelayModelLike,
	policy?: RelayPolicyConfig,
	disableOpenAiSafetyField = false,
): boolean {
	if (disableOpenAiSafetyField) return false;
	if (policy?.googleSafetyOnOpenAi !== true) return false;
	if (!Array.isArray(payload.messages)) return false;
	return lower(model?.id).includes("gemini");
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

const PROTECTED_SLICE_RE =
	/(<system-reminder>[\s\S]*?<\/system-reminder>|<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|```[\s\S]*?```|`[^`\n]+`|\{\{[\s\S]*?\}\}|<\/?[A-Za-z][A-Za-z0-9_:-]*(?:\s+[^<>]*?)?\/?>|https?:\/\/[^\s<>"{}|\\^`]+|[A-Za-z]:\\[^\s"'`<>|*?]+|(?:^|(?<=[\s"'(：:]))\/(?:[^\s"'`<>|*?\/]+\/)+[^\s"'`<>|*?]*|[^\s\\/:*?"<>|，。、；：！？（）【】《》“”‘’]+\.(?:md|json|png|jpg|jpeg|webp|txt|ts|js|mjs|jsonl))/g;

const CJK_RUN_RE = /[一-鿿㐀-䶿]{4,}/g;
const LATIN_WORD_RE = /(?<![A-Za-z0-9_./:-])[A-Za-z]{6,}(?![A-Za-z0-9_./:-])/g;
const ZWSP = String.fromCharCode(0x200b);

function isWholeProtectedBlock(text: string): boolean {
	const t = text.trim();
	if (!t) return true;
	if (t.startsWith("<system-reminder>") && t.endsWith("</system-reminder>")) return true;
	if (text.includes(PROTECTED_PROMPT_MARKER)) return true;
	return false;
}

function randomMarkdownSlipComment(rng: () => number = Math.random): string {
	const tok = rng().toString(36).slice(2, 8).padEnd(4, "x");
	const num = 100 + Math.floor(rng() * 899);
	return `[//]: # (r_${num}_${tok})`;
}

function applyDeepJitterToProseSlice(slice: string, rng: () => number = Math.random): string {
	const lines = slice.split("\n");
	if (slice.length < 180 && lines.length < 4) return slice;
	const nextStride = () => 3 + Math.floor(rng() * 4);
	let countdown = nextStride();
	const outLines: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i]!;
		if (lines.length >= 3 && line.trim().length > 0 && !line.trimStart().startsWith("#") && rng() < 0.45) {
			const pad = " ".repeat(1 + Math.floor(rng() * 3));
			line = `${line}${pad}`;
		}
		outLines.push(line);
		countdown--;
		if (countdown <= 0 && i < lines.length - 1 && line.trim() === "") {
			outLines.push(randomMarkdownSlipComment(rng));
			countdown = nextStride();
		}
	}
	return outLines.join("\n");
}

function insertZwspEveryN(run: string, stride = 3): string {
	const chars = [...run];
	if (chars.length <= stride) return run;
	const out: string[] = [];
	for (let i = 0; i < chars.length; i++) {
		out.push(chars[i]!);
		if ((i + 1) % stride === 0 && i < chars.length - 1) {
			out.push(ZWSP);
		}
	}
	return out.join("");
}

function applyRulesAndScrambleToProseSlice(slice: string, rules?: RelayRules, stride = 3): string {
	let out = slice;
	if (rules) {
		for (const rep of rules.replacements) {
			if (rep.from && out.includes(rep.from)) {
				out = out.split(rep.from).join(rep.to);
			}
		}
		for (const word of rules.splits) {
			if (word.length >= 2 && out.includes(word)) {
				const chars = [...word];
				const broken = `${chars[0]!}${ZWSP}${chars.slice(1).join("")}`;
				out = out.split(word).join(broken);
			}
		}
	}
	out = out.replace(CJK_RUN_RE, (run) => insertZwspEveryN(run, stride));
	out = out.replace(LATIN_WORD_RE, (word) => {
		const mid = Math.floor(word.length / 2);
		return `${word.slice(0, mid)}${ZWSP}${word.slice(mid)}`;
	});
	return out;
}

/**
 * 对单段文本施加非结构破坏型散文变换（跳过 XML/HTML 标签、代码围栏、行内代码与 {{macro}}）。
 */
export function applyInputScrambleToString(
	text: string,
	rules?: RelayRules,
	opts: { deep?: boolean; scramble?: boolean; stride?: number; rng?: () => number } = {},
): string {
	if (!text.trim() || isWholeProtectedBlock(text) || text.trim() === PACKED_SYSTEM_ANCHOR) return text;
	const doDeep = opts.deep === true || opts.scramble === true;
	const doScramble = opts.scramble === true;
	if (!doDeep && !doScramble) return text;
	const stride = opts.stride ?? 3;
	const rng = opts.rng ?? Math.random;

	const parts = text.split(PROTECTED_SLICE_RE);
	let changed = false;
	const rebuilt = parts.map((part, idx) => {
		// 正则带捕获组 split：奇数索引为受保护原样切片，偶数索引为普通散文切片
		if (idx % 2 === 1 || !part) return part;
		let next = part;
		if (doDeep) next = applyDeepJitterToProseSlice(next, rng);
		if (doScramble) next = applyRulesAndScrambleToProseSlice(next, rules, stride);
		if (next !== part) changed = true;
		return next;
	});
	return changed ? rebuilt.join("") : text;
}

function injectCommentIntoString(text: string, withSuffix = false, rng: () => number = Math.random): string {
	if (!text.trim() || isProtectedTextBlock(text)) return text;
	const prefix = randomShieldComment(3, 6, rng);
	if (!withSuffix) return `${prefix}\n${text}`;
	const suffix = randomShieldComment(3, 6, rng);
	return `${prefix}\n${text}\n${suffix}`;
}

function transformAndShieldString(
	text: string,
	withSuffix: boolean,
	mode: AntiRouteShieldMode,
	rules?: RelayRules,
	rng: () => number = Math.random,
): string {
	if (!text.trim() || isWholeProtectedBlock(text)) return text;
	let next = text;
	if (mode === "deep" || mode === "scramble") {
		next = applyInputScrambleToString(next, rules, {
			deep: true,
			scramble: mode === "scramble",
			rng,
		});
	}
	return injectCommentIntoString(next, withSuffix, rng);
}

function shieldContentField(
	content: unknown,
	withSuffix: boolean,
	mode: AntiRouteShieldMode,
	rules?: RelayRules,
	rng: () => number = Math.random,
): unknown {
	if (typeof content === "string") {
		return transformAndShieldString(content, withSuffix, mode, rules, rng);
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
			const nextTxt = transformAndShieldString(txt, withSuffix && idx === content.length - 1, mode, rules, rng);
			if (nextTxt !== txt) {
				changed = true;
				return { ...part, text: nextTxt };
			}
		} else if (
			part &&
			typeof part === "object" &&
			((part as { type?: unknown }).type === "input_text" || (part as { type?: unknown }).type === "output_text") &&
			typeof (part as { text?: unknown }).text === "string"
		) {
			const txt = (part as { text: string }).text;
			const nextTxt = transformAndShieldString(txt, withSuffix && idx === content.length - 1, mode, rules, rng);
			if (nextTxt !== txt) {
				changed = true;
				return { ...part, text: nextTxt };
			}
		}
		return part;
	});
	return changed ? mapped : content;
}

function anthropicHasToolBlock(m: Record<string, unknown>): boolean {
	if (!Array.isArray(m.content)) return false;
	return (m.content as Array<Record<string, unknown>>).some(
		(b) => b && (b.type === "tool_use" || b.type === "tool_result"),
	);
}

/**
 * 防路由随机注释与散文无损打断混淆（仅改发送副本）：
 * - "head"：只处理开头 system 与最后一条非工具文本消息；
 * - "deep"：覆盖全部非工具、非受保护块文本，并加段落滑窗与行尾空格抖动；
 * - "scramble"：deep 全套 + 外置规则表 RELAY_RULES.txt + 无词表字间 U+200B 打断。
 */
export function applyAntiRouteShield(
	payload: Record<string, unknown>,
	protocol: RelayPayloadProtocol,
	mode: AntiRouteShieldMode,
	opts: { relayRules?: RelayRules; shieldSeed?: number } = {},
): Record<string, unknown> {
	if (mode === "off") return payload;
	const rules = mode === "scramble" ? (opts.relayRules ?? readRelayRules()) : undefined;
	const rng = opts.shieldSeed !== undefined ? createSeededRandom(opts.shieldSeed ^ 0x9e3779b9) : Math.random;
	const out: Record<string, unknown> = { ...payload };

	if (protocol === "google") {
		if ((mode === "deep" || mode === "scramble") && out.config && typeof out.config === "object" && !Array.isArray(out.config)) {
			const cfg = { ...(out.config as Record<string, unknown>) };
			if (typeof cfg.systemInstruction === "string") {
				cfg.systemInstruction = transformAndShieldString(cfg.systemInstruction, false, mode, rules, rng);
				out.config = cfg;
			}
		}
		if (Array.isArray(out.contents)) {
			const contents = out.contents as Array<Record<string, unknown>>;
			const lastIdx = contents.length - 1;
			out.contents = contents.map((item, idx) => {
				if (!item || !Array.isArray(item.parts)) return item;
				const hasToolPart = (item.parts as Array<Record<string, unknown>>).some(
					(p) => p && ("functionCall" in p || "functionResponse" in p),
				);
				if (hasToolPart) return item;
				if (mode === "head" && idx !== 0 && idx !== lastIdx) return item;
				const nextParts = (item.parts as Array<Record<string, unknown>>).map((p) => {
					if (p && typeof p.text === "string" && p.thought !== true) {
						return {
							...p,
							text: transformAndShieldString(
								p.text,
								(mode === "deep" || mode === "scramble") && idx === lastIdx,
								mode,
								rules,
								rng,
							),
						};
					}
					return p;
				});
				return { ...item, parts: nextParts };
			});
		}
		return out;
	}

	if (protocol === "anthropic") {
		if (typeof out.system === "string") {
			out.system = transformAndShieldString(out.system, false, mode, rules, rng);
		} else if (Array.isArray(out.system)) {
			let hitSys = false;
			out.system = (out.system as Array<Record<string, unknown>>).map((blk) => {
				if (!blk || blk.type !== "text" || typeof blk.text !== "string") return blk;
				if (blk.text.startsWith(OAUTH_CLAUDE_CODE_PREFIX) || isWholeProtectedBlock(blk.text)) return blk;
				if (mode === "head" && hitSys) return blk;
				hitSys = true;
				return { ...blk, text: transformAndShieldString(blk.text, false, mode, rules, rng) };
			});
		}
		if (Array.isArray(out.messages)) {
			const msgs = out.messages as Array<Record<string, unknown>>;
			const lastAllowedIdx = msgs.length - 1;
			out.messages = msgs.map((m, idx) => {
				if (!m || typeof m !== "object") return m;
				if (anthropicHasToolBlock(m)) return m;
				if (mode === "head" && idx !== lastAllowedIdx) return m;
				return { ...m, content: shieldContentField(m.content, idx === lastAllowedIdx, mode, rules, rng) };
			});
		}
		return out;
	}

	if (protocol === "openai-responses") {
		if (typeof out.instructions === "string") {
			out.instructions = transformAndShieldString(out.instructions, false, mode, rules, rng);
		}
		if (Array.isArray(out.input)) {
			const items = out.input as Array<Record<string, unknown>>;
			const lastAllowedIdx = items.length - 1;
			let hitSystem = false;
			out.input = items.map((item, idx) => {
				if (!item || typeof item !== "object") return item;
				const typ = String(item.type ?? "");
				if (typ === "function_call" || typ === "function_call_output" || typ === "custom_tool_call" || typ === "reasoning") {
					return item;
				}
				const role = String(item.role ?? "");
				if (!role) return item;
				if (mode === "head") {
					const isSys = (role === "system" || role === "developer") && !hitSystem;
					if (isSys) hitSystem = true;
					const isTail = idx === lastAllowedIdx;
					if (!isSys && !isTail) return item;
					return { ...item, content: shieldContentField(item.content, isTail, mode, rules, rng) };
				}
				return { ...item, content: shieldContentField(item.content, idx === lastAllowedIdx, mode, rules, rng) };
			});
		}
		return out;
	}

	if (Array.isArray(out.messages)) {
		const msgs = out.messages as Array<Record<string, unknown>>;
		const lastAllowedIdx = msgs.length - 1;
		let hitSystem = false;
		out.messages = msgs.map((m, idx) => {
			if (!m || typeof m !== "object") return m;
			const role = String(m.role ?? "");
			if (role === "tool" || role === "toolResult" || Array.isArray(m.tool_calls)) return m;

			if (mode === "head") {
				const isFirstSystem = role === "system" && !hitSystem;
				if (isFirstSystem) hitSystem = true;
				const isTargetTail = idx === lastAllowedIdx;
				if (!isFirstSystem && !isTargetTail) return m;
				return { ...m, content: shieldContentField(m.content, isTargetTail, mode, rules, rng) };
			}
			return { ...m, content: shieldContentField(m.content, idx === lastAllowedIdx, mode, rules, rng) };
		});
	}

	return out;
}

interface PackedHistoryEntry {
	role: string;
	content: string;
}

function buildPackedContextDescription(
	packedSystem: string,
	packedHistory: PackedHistoryEntry[],
	opts: { stateContext?: string; deep?: boolean; scramble?: boolean; relayRules?: RelayRules; maxChars?: number; rng?: () => number },
): { description: string; overflowCount: number } {
	const maxChars = opts.maxChars ?? CONTEXT_PACK_MAX_CHARS;
	const rng = opts.rng ?? Math.random;
	// 工具描述已迁出 messages[] 正文，背景资料改用 stride=6 放宽滑窗，大幅压低冗余 BPE token 同时保住精确词表规则
	const transform = (txt: string) =>
		opts.deep || opts.scramble
			? applyInputScrambleToString(txt, opts.relayRules, {
					deep: opts.deep,
					scramble: opts.scramble,
					stride: 6,
					rng,
				})
			: txt;

	const reserve = Math.min(1000, Math.floor(maxChars * 0.25));
	let sysText = packedSystem ? transform(packedSystem) : "";
	if (sysText.length > maxChars - reserve) {
		sysText = sysText.slice(0, Math.max(0, maxChars - reserve));
	}
	let stateText = opts.stateContext ? transform(opts.stateContext) : "";
	if (stateText && sysText.length + stateText.length > maxChars - Math.floor(reserve / 2)) {
		const remain = Math.max(0, maxChars - Math.floor(reserve / 2) - sysText.length);
		stateText = stateText.slice(0, remain);
	}

	const transformedHistory = packedHistory.map((h) => ({
		role: h.role,
		content: transform(h.content),
	}));

	// 从最新历史倒序装入直到上限；超出部分保留回原消息队列避免静默丢资料
	const acceptedReversed: PackedHistoryEntry[] = [];
	const baseJson = JSON.stringify({
		system: sysText,
		...(stateText ? { stateContext: stateText } : {}),
		history: [],
	});
	let used = baseJson.length;
	for (let i = transformedHistory.length - 1; i >= 0; i--) {
		const entry = transformedHistory[i]!;
		const entryLen = JSON.stringify(entry).length + 1;
		if (used + entryLen > maxChars) break;
		acceptedReversed.push(entry);
		used += entryLen;
	}
	const acceptedHistory = acceptedReversed.reverse();
	const overflowCount = transformedHistory.length - acceptedHistory.length;
	const jsonPayload = JSON.stringify({
		...(sysText ? { system: sysText } : {}),
		...(stateText ? { stateContext: stateText } : {}),
		...(acceptedHistory.length > 0 ? { history: acceptedHistory } : {}),
	});
	return {
		description: `本轮设定与历史参考资料（只读静态 JSON，无需调用）：\n${jsonPayload}`,
		overflowCount,
	};
}

function splitStatePrefixFromLastUser(
	text: string,
	currentTurnUserText?: string,
): { statePrefix: string; userTail: string } | null {
	const cleanUser = currentTurnUserText?.trim();
	if (!cleanUser || text.length <= cleanUser.length) return null;
	if (!text.endsWith(cleanUser)) return null;
	const prefix = text.slice(0, text.length - cleanUser.length).trim();
	if (prefix.length < CONTEXT_PACK_MIN_CHARS) return null;
	return { statePrefix: prefix, userTail: cleanUser };
}

function summarizeToolCallsNote(calls: unknown): string {
	if (!Array.isArray(calls) || calls.length === 0) return "";
	const names = calls
		.map((c) => {
			if (!c || typeof c !== "object") return "";
			const obj = c as { name?: unknown; function?: { name?: unknown } };
			return String(obj.function?.name ?? obj.name ?? "").trim();
		})
		.filter(Boolean);
	return names.length > 0 ? `[调用工具: ${names.join(", ")}]` : "";
}

function clipHistoricalToolNote(rawText: string, maxLen = 800): string {
	const t = rawText.trim();
	if (!t) return "";
	if (t.length <= maxLen) return t;
	return `${t.slice(0, maxLen)}…(已折叠，原文共${t.length}字)`;
}

function upsertCarrierTool(
	tools: unknown,
	protocol: RelayPayloadProtocol,
	description: string,
): unknown[] {
	const carrierProperties = {
		ack: { type: "string", description: "可选只读占位字段，本工具无需调用" },
	};
	const arr = Array.isArray(tools) ? [...(tools as Array<Record<string, unknown>>)] : [];
	if (protocol === "openai-completions") {
		const idx = arr.findIndex((t) => (t?.function as { name?: unknown } | undefined)?.name === CARRIER_TOOL_NAME);
		const def = {
			type: "function",
			function: {
				name: CARRIER_TOOL_NAME,
				description,
				parameters: { type: "object", properties: carrierProperties },
			},
		};
		if (idx >= 0) arr[idx] = def;
		else arr.unshift(def);
		return arr;
	}
	if (protocol === "openai-responses") {
		const idx = arr.findIndex((t) => t?.name === CARRIER_TOOL_NAME);
		const def = {
			type: "function",
			name: CARRIER_TOOL_NAME,
			description,
			parameters: { type: "object", properties: carrierProperties },
		};
		if (idx >= 0) arr[idx] = def;
		else arr.unshift(def);
		return arr;
	}
	if (protocol === "anthropic") {
		const idx = arr.findIndex((t) => t?.name === CARRIER_TOOL_NAME);
		const def = {
			name: CARRIER_TOOL_NAME,
			description,
			input_schema: { type: "object", properties: carrierProperties },
		};
		if (idx >= 0) arr[idx] = def;
		else arr.unshift(def);
		return arr;
	}
	// google: cfg.tools = [{ functionDeclarations: [...] }]
	const groups = arr.map((g) => ({ ...g }));
	let existingIdx = -1;
	let groupIdx = -1;
	let useLegacyParams = false;
	for (let gi = 0; gi < groups.length; gi++) {
		const fds = groups[gi]?.functionDeclarations;
		if (!Array.isArray(fds)) continue;
		const first = fds[0] as Record<string, unknown> | undefined;
		if (first && "parameters" in first && !("parametersJsonSchema" in first)) {
			useLegacyParams = true;
		}
		const found = (fds as Array<Record<string, unknown>>).findIndex((fd) => fd?.name === CARRIER_TOOL_NAME);
		if (found >= 0) {
			groupIdx = gi;
			existingIdx = found;
			break;
		}
		if (groupIdx < 0) groupIdx = gi;
	}
	const decl = {
		name: CARRIER_TOOL_NAME,
		description,
		...(useLegacyParams
			? { parameters: { type: "object", properties: carrierProperties } }
			: { parametersJsonSchema: { type: "object", properties: carrierProperties } }),
	};
	if (groupIdx >= 0) {
		const grp = { ...groups[groupIdx]! };
		const nextFds = Array.isArray(grp.functionDeclarations)
			? [...(grp.functionDeclarations as Array<Record<string, unknown>>)]
			: [];
		if (existingIdx >= 0) nextFds[existingIdx] = decl;
		else nextFds.unshift(decl);
		grp.functionDeclarations = nextFds;
		groups[groupIdx] = grp;
		return groups;
	}
	return [{ functionDeclarations: [decl] }];
}

function responsesItemPlainText(item: Record<string, unknown>): string {
	if (typeof item.content === "string") return item.content;
	if (!Array.isArray(item.content)) return "";
	return (item.content as Array<Record<string, unknown>>)
		.map((b) => (b && typeof b.text === "string" ? b.text : ""))
		.join("\n");
}

/**
 * 将 system 正文与早于本拍的纯文本历史打包搬运进虚拟工具 liyuan_context_reference 的 description JSON，
 * 原位仅留极简读取引导句，完整保留末条 user 输入与当前拍工具链。
 */
export function packContextIntoToolDescription(
	payload: Record<string, unknown>,
	protocol: RelayPayloadProtocol,
	opts: {
		deep?: boolean;
		scramble?: boolean;
		relayRules?: RelayRules;
		maxChars?: number;
		currentTurnUserText?: string;
		shieldSeed?: number;
	} = {},
): { payload: Record<string, unknown>; packed: boolean } {
	const rules = opts.scramble ? (opts.relayRules ?? readRelayRules()) : undefined;
	const rng = opts.shieldSeed !== undefined ? createSeededRandom(opts.shieldSeed ^ 0x517cc1b7) : Math.random;
	const out: Record<string, unknown> = { ...payload };

	if (protocol === "openai-completions" && Array.isArray(out.messages)) {
		const msgs = out.messages as Array<Record<string, unknown>>;
		let lastUserIdx = -1;
		for (let i = msgs.length - 1; i >= 0; i--) {
			if (msgs[i]?.role === "user") {
				lastUserIdx = i;
				break;
			}
		}
		if (lastUserIdx < 0) return { payload, packed: false };

		const packedSystemParts: string[] = [];
		const keptSystemReminders: Array<Record<string, unknown>> = [];
		const candidateHistory: Array<{ idx: number; role: string; text: string; isPlain: boolean }> = [];
		const keptPrefixIndices = new Set<number>();

		for (let i = 0; i < lastUserIdx; i++) {
			const m = msgs[i]!;
			const role = String(m.role ?? "");
			const txt = contentToPlainText(m.content).trim();
			if (role === "system" || role === "developer") {
				if (!txt || txt === PACKED_SYSTEM_ANCHOR) continue;
				if (isProtectedTextBlock(txt)) {
					keptSystemReminders.push(m);
				} else {
					packedSystemParts.push(txt);
				}
				continue;
			}
			if (isProtectedTextBlock(txt)) {
				keptPrefixIndices.add(i);
				continue;
			}
			if (role === "tool" || role === "toolResult") {
				if (m.isError !== true) {
					const clipped = clipHistoricalToolNote(txt);
					if (clipped) candidateHistory.push({ idx: i, role: "tool_note", text: clipped, isPlain: false });
				}
				continue;
			}
			if (role === "assistant" && Array.isArray(m.tool_calls)) {
				const note = [txt, summarizeToolCallsNote(m.tool_calls)].filter(Boolean).join("\n");
				if (note) candidateHistory.push({ idx: i, role: "assistant", text: note, isPlain: false });
				continue;
			}
			if (txt && (role === "user" || role === "assistant")) {
				candidateHistory.push({ idx: i, role, text: txt, isPlain: true });
			}
		}

		const tailSlice = msgs.slice(lastUserIdx).map((m) => ({ ...m }));
		let stateContext = "";
		if (opts.currentTurnUserText && tailSlice[0]) {
			const lastText = contentToPlainText(tailSlice[0].content);
			const split = splitStatePrefixFromLastUser(lastText, opts.currentTurnUserText);
			if (split) {
				stateContext = split.statePrefix;
				if (Array.isArray(tailSlice[0].content)) {
					const nonText = (tailSlice[0].content as Array<Record<string, unknown>>).filter((p) => p?.type !== "text");
					tailSlice[0] = {
						...tailSlice[0],
						content: [...nonText, { type: "text", text: split.userTail }],
					};
				} else {
					tailSlice[0] = { ...tailSlice[0], content: split.userTail };
				}
			}
		}

		const packedSystem = packedSystemParts.join("\n\n").trim();
		const totalChars =
			packedSystem.length + stateContext.length + candidateHistory.reduce((n, h) => n + h.text.length, 0);
		if (totalChars < CONTEXT_PACK_MIN_CHARS && candidateHistory.length === 0) {
			return { payload, packed: false };
		}

		const { description, overflowCount } = buildPackedContextDescription(
			packedSystem,
			candidateHistory.map((h) => ({ role: h.role, content: h.text })),
			{
				...(stateContext ? { stateContext } : {}),
				deep: opts.deep,
				scramble: opts.scramble,
				relayRules: rules,
				maxChars: opts.maxChars,
				rng,
			},
		);

		const overflowIndices = new Set(
			candidateHistory
				.slice(0, overflowCount)
				.filter((h) => h.isPlain)
				.map((h) => h.idx),
		);
		const nextMessages: Array<Record<string, unknown>> = [];
		nextMessages.push({ role: "system", content: PACKED_SYSTEM_ANCHOR });
		nextMessages.push(...keptSystemReminders);
		for (let i = 0; i < lastUserIdx; i++) {
			if (keptPrefixIndices.has(i) || overflowIndices.has(i)) {
				nextMessages.push(msgs[i]!);
			}
		}
		nextMessages.push(...tailSlice);
		out.messages = nextMessages;
		out.tools = upsertCarrierTool(out.tools, "openai-completions", description);
		return { payload: out, packed: true };
	}

	if (protocol === "anthropic" && Array.isArray(out.messages)) {
		const msgs = out.messages as Array<Record<string, unknown>>;
		let lastUserIdx = -1;
		for (let i = msgs.length - 1; i >= 0; i--) {
			const m = msgs[i]!;
			if (m?.role === "user" && !anthropicHasToolBlock(m)) {
				lastUserIdx = i;
				break;
			}
		}
		if (lastUserIdx < 0) return { payload, packed: false };

		const packedSystemParts: string[] = [];
		let nextSystem: unknown = out.system;
		if (typeof out.system === "string" && out.system.trim() && out.system.trim() !== PACKED_SYSTEM_ANCHOR) {
			packedSystemParts.push(out.system.trim());
			nextSystem = PACKED_SYSTEM_ANCHOR;
		} else if (Array.isArray(out.system)) {
			const keptBlocks: Array<Record<string, unknown>> = [];
			let addedAnchor = false;
			for (const blk of out.system as Array<Record<string, unknown>>) {
				if (!blk || blk.type !== "text" || typeof blk.text !== "string") {
					keptBlocks.push(blk);
					continue;
				}
				const txt = blk.text.trim();
				if (txt.startsWith(OAUTH_CLAUDE_CODE_PREFIX) || isProtectedTextBlock(txt)) {
					keptBlocks.push(blk);
					continue;
				}
				if (txt && txt !== PACKED_SYSTEM_ANCHOR) {
					packedSystemParts.push(txt);
				}
				if (!addedAnchor) {
					keptBlocks.push({ type: "text", text: PACKED_SYSTEM_ANCHOR });
					addedAnchor = true;
				}
			}
			nextSystem = keptBlocks;
		}

		const candidateHistory: Array<{ idx: number; role: string; text: string; isPlain: boolean }> = [];
		const keptPrefixIndices = new Set<number>();
		for (let i = 0; i < lastUserIdx; i++) {
			const m = msgs[i]!;
			const role = String(m.role ?? "");
			const txt = contentToPlainText(m.content).trim();
			if (isProtectedTextBlock(txt)) {
				keptPrefixIndices.add(i);
				continue;
			}
			if (anthropicHasToolBlock(m)) {
				const blocks = Array.isArray(m.content) ? (m.content as Array<Record<string, unknown>>) : [];
				const toolUseNames = blocks.filter((b) => b?.type === "tool_use").map((b) => String(b.name ?? "")).filter(Boolean);
				const toolResText = blocks
					.filter((b) => b?.type === "tool_result" && b.is_error !== true)
					.map((b) => clipHistoricalToolNote(contentToPlainText(b.content)))
					.filter(Boolean)
					.join("\n");
				const combined = [txt, toolUseNames.length ? `[调用工具: ${toolUseNames.join(", ")}]` : "", toolResText]
					.filter(Boolean)
					.join("\n");
				if (combined) {
					candidateHistory.push({ idx: i, role: role === "user" ? "tool_note" : "assistant", text: combined, isPlain: false });
				}
				continue;
			}
			if (txt && (role === "user" || role === "assistant")) {
				candidateHistory.push({ idx: i, role, text: txt, isPlain: true });
			}
		}

		const tailSlice = msgs.slice(lastUserIdx).map((m) => ({ ...m }));
		let stateContext = "";
		if (opts.currentTurnUserText && tailSlice[0]) {
			const lastText = contentToPlainText(tailSlice[0].content);
			const split = splitStatePrefixFromLastUser(lastText, opts.currentTurnUserText);
			if (split) {
				stateContext = split.statePrefix;
				if (Array.isArray(tailSlice[0].content)) {
					const nonText = (tailSlice[0].content as Array<Record<string, unknown>>).filter((p) => p?.type !== "text");
					tailSlice[0] = { ...tailSlice[0], content: [...nonText, { type: "text", text: split.userTail }] };
				} else {
					tailSlice[0] = { ...tailSlice[0], content: split.userTail };
				}
			}
		}

		const packedSystem = packedSystemParts.join("\n\n").trim();
		const totalChars =
			packedSystem.length + stateContext.length + candidateHistory.reduce((n, h) => n + h.text.length, 0);
		if (totalChars < CONTEXT_PACK_MIN_CHARS && candidateHistory.length === 0) {
			return { payload, packed: false };
		}

		const { description, overflowCount } = buildPackedContextDescription(
			packedSystem,
			candidateHistory.map((h) => ({ role: h.role, content: h.text })),
			{
				...(stateContext ? { stateContext } : {}),
				deep: opts.deep,
				scramble: opts.scramble,
				relayRules: rules,
				maxChars: opts.maxChars,
				rng,
			},
		);
		const overflowIndices = new Set(
			candidateHistory
				.slice(0, overflowCount)
				.filter((h) => h.isPlain)
				.map((h) => h.idx),
		);
		const nextMessages: Array<Record<string, unknown>> = [];
		for (let i = 0; i < lastUserIdx; i++) {
			if (keptPrefixIndices.has(i) || overflowIndices.has(i)) {
				nextMessages.push(msgs[i]!);
			}
		}
		nextMessages.push(...tailSlice);
		out.system = nextSystem ?? [{ type: "text", text: PACKED_SYSTEM_ANCHOR }];
		out.messages = nextMessages;
		out.tools = upsertCarrierTool(out.tools, "anthropic", description);
		return { payload: out, packed: true };
	}

	if (protocol === "google" && Array.isArray(out.contents)) {
		const contents = out.contents as Array<Record<string, unknown>>;
		let lastUserIdx = -1;
		for (let i = contents.length - 1; i >= 0; i--) {
			const item = contents[i];
			if (!item || item.role !== "user") continue;
			const parts = Array.isArray(item.parts) ? (item.parts as Array<Record<string, unknown>>) : [];
			const isFuncResp = parts.some((p) => p && "functionResponse" in p);
			if (!isFuncResp) {
				lastUserIdx = i;
				break;
			}
		}
		if (lastUserIdx < 0) return { payload, packed: false };

		const cfg =
			out.config && typeof out.config === "object" && !Array.isArray(out.config)
				? { ...(out.config as Record<string, unknown>) }
				: {};
		let packedSystem = "";
		if (typeof cfg.systemInstruction === "string" && cfg.systemInstruction.trim() !== PACKED_SYSTEM_ANCHOR) {
			packedSystem = cfg.systemInstruction.trim();
		} else if (cfg.systemInstruction && typeof cfg.systemInstruction === "object") {
			const si = cfg.systemInstruction as { parts?: Array<{ text?: unknown }>; text?: unknown };
			if (Array.isArray(si.parts)) {
				packedSystem = si.parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("\n").trim();
			} else if (typeof si.text === "string") {
				packedSystem = si.text.trim();
			}
		}

		const candidateHistory: Array<{ idx: number; role: string; text: string; isPlain: boolean }> = [];
		const keptPrefixIndices = new Set<number>();
		for (let i = 0; i < lastUserIdx; i++) {
			const item = contents[i]!;
			const parts = Array.isArray(item.parts) ? (item.parts as Array<Record<string, unknown>>) : [];
			const hasTool = parts.some((p) => p && ("functionCall" in p || "functionResponse" in p));
			const txt = parts
				.filter((p) => p && typeof p.text === "string" && p.thought !== true)
				.map((p) => String(p.text))
				.join("\n")
				.trim();
			if (isProtectedTextBlock(txt)) {
				keptPrefixIndices.add(i);
				continue;
			}
			if (hasTool) {
				const fcNames = parts
					.map((p) => (p?.functionCall as { name?: unknown } | undefined)?.name)
					.filter((n): n is string => typeof n === "string" && Boolean(n));
				const frText = parts
					.map((p) => {
						const fr = p?.functionResponse as { response?: unknown } | undefined;
						if (!fr) return "";
						return clipHistoricalToolNote(typeof fr.response === "string" ? fr.response : JSON.stringify(fr.response ?? ""));
					})
					.filter(Boolean)
					.join("\n");
				const combined = [txt, fcNames.length ? `[调用工具: ${fcNames.join(", ")}]` : "", frText]
					.filter(Boolean)
					.join("\n");
				if (combined) {
					candidateHistory.push({
						idx: i,
						role: item.role === "model" ? "assistant" : "tool_note",
						text: combined,
						isPlain: false,
					});
				}
				continue;
			}
			if (txt) {
				candidateHistory.push({
					idx: i,
					role: item.role === "model" ? "assistant" : "user",
					text: txt,
					isPlain: true,
				});
			}
		}

		const tailSlice = contents.slice(lastUserIdx).map((c) => ({ ...c }));
		let stateContext = "";
		if (opts.currentTurnUserText && tailSlice[0] && Array.isArray(tailSlice[0].parts)) {
			const parts = tailSlice[0].parts as Array<Record<string, unknown>>;
			const lastText = parts
				.filter((p) => p && typeof p.text === "string" && p.thought !== true)
				.map((p) => String(p.text))
				.join("\n");
			const split = splitStatePrefixFromLastUser(lastText, opts.currentTurnUserText);
			if (split) {
				stateContext = split.statePrefix;
				const nonText = parts.filter((p) => !(p && typeof p.text === "string" && p.thought !== true));
				tailSlice[0] = { ...tailSlice[0], parts: [...nonText, { text: split.userTail }] };
			}
		}

		const totalChars =
			packedSystem.length + stateContext.length + candidateHistory.reduce((n, h) => n + h.text.length, 0);
		if (totalChars < CONTEXT_PACK_MIN_CHARS && candidateHistory.length === 0) {
			return { payload, packed: false };
		}

		const { description, overflowCount } = buildPackedContextDescription(
			packedSystem,
			candidateHistory.map((h) => ({ role: h.role, content: h.text })),
			{
				...(stateContext ? { stateContext } : {}),
				deep: opts.deep,
				scramble: opts.scramble,
				relayRules: rules,
				maxChars: opts.maxChars,
				rng,
			},
		);
		const overflowIndices = new Set(
			candidateHistory
				.slice(0, overflowCount)
				.filter((h) => h.isPlain)
				.map((h) => h.idx),
		);
		const nextContents: Array<Record<string, unknown>> = [];
		for (let i = 0; i < lastUserIdx; i++) {
			if (keptPrefixIndices.has(i) || overflowIndices.has(i)) {
				nextContents.push(contents[i]!);
			}
		}
		nextContents.push(...tailSlice);
		cfg.systemInstruction = PACKED_SYSTEM_ANCHOR;
		cfg.tools = upsertCarrierTool(cfg.tools, "google", description);
		out.config = cfg;
		out.contents = nextContents;
		return { payload: out, packed: true };
	}

	if (protocol === "openai-responses" && Array.isArray(out.input)) {
		const items = out.input as Array<Record<string, unknown>>;
		let lastUserIdx = -1;
		for (let i = items.length - 1; i >= 0; i--) {
			const it = items[i]!;
			if (it?.role === "user" && it?.type !== "function_call_output") {
				lastUserIdx = i;
				break;
			}
		}
		if (lastUserIdx < 0) return { payload, packed: false };

		const packedSystemParts: string[] = [];
		let replacedInstructions = false;
		if (typeof out.instructions === "string" && out.instructions.trim() && out.instructions.trim() !== PACKED_SYSTEM_ANCHOR) {
			packedSystemParts.push(out.instructions.trim());
			replacedInstructions = true;
		}

		const candidateHistory: Array<{ idx: number; role: string; text: string; isPlain: boolean }> = [];
		const keptPrefixIndices = new Set<number>();
		const packedSysItemIndices = new Set<number>();
		let replacedFirstSysItem = false;

		for (let i = 0; i < lastUserIdx; i++) {
			const it = items[i]!;
			const typ = String(it.type ?? "");
			const role = String(it.role ?? "");
			if (typ === "reasoning") continue;
			if (typ === "function_call" || typ === "custom_tool_call") {
				const nm = String(it.name ?? "");
				if (nm) candidateHistory.push({ idx: i, role: "assistant", text: `[调用工具: ${nm}]`, isPlain: false });
				continue;
			}
			if (typ === "function_call_output") {
				const outTxt = clipHistoricalToolNote(typeof it.output === "string" ? it.output : JSON.stringify(it.output ?? ""));
				if (outTxt) candidateHistory.push({ idx: i, role: "tool_note", text: outTxt, isPlain: false });
				continue;
			}
			const txt = responsesItemPlainText(it).trim();
			if (role === "system" || role === "developer") {
				if (!txt || txt === PACKED_SYSTEM_ANCHOR) continue;
				if (isProtectedTextBlock(txt)) {
					keptPrefixIndices.add(i);
				} else {
					packedSystemParts.push(txt);
					packedSysItemIndices.add(i);
				}
				continue;
			}
			if (isProtectedTextBlock(txt)) {
				keptPrefixIndices.add(i);
				continue;
			}
			if (txt && (role === "user" || role === "assistant")) {
				candidateHistory.push({ idx: i, role, text: txt, isPlain: true });
			}
		}

		const tailSlice = items.slice(lastUserIdx).map((it) => ({ ...it }));
		let stateContext = "";
		if (opts.currentTurnUserText && tailSlice[0]) {
			const lastText = responsesItemPlainText(tailSlice[0]);
			const split = splitStatePrefixFromLastUser(lastText, opts.currentTurnUserText);
			if (split) {
				stateContext = split.statePrefix;
				if (Array.isArray(tailSlice[0].content)) {
					const nonText = (tailSlice[0].content as Array<Record<string, unknown>>).filter(
						(p) => p?.type !== "text" && p?.type !== "input_text",
					);
					tailSlice[0] = {
						...tailSlice[0],
						content: [...nonText, { type: "input_text", text: split.userTail }],
					};
				} else {
					tailSlice[0] = { ...tailSlice[0], content: split.userTail };
				}
			}
		}

		const packedSystem = packedSystemParts.join("\n\n").trim();
		const totalChars =
			packedSystem.length + stateContext.length + candidateHistory.reduce((n, h) => n + h.text.length, 0);
		if (totalChars < CONTEXT_PACK_MIN_CHARS && candidateHistory.length === 0) {
			return { payload, packed: false };
		}

		const { description, overflowCount } = buildPackedContextDescription(
			packedSystem,
			candidateHistory.map((h) => ({ role: h.role, content: h.text })),
			{
				...(stateContext ? { stateContext } : {}),
				deep: opts.deep,
				scramble: opts.scramble,
				relayRules: rules,
				maxChars: opts.maxChars,
				rng,
			},
		);
		const overflowIndices = new Set(
			candidateHistory
				.slice(0, overflowCount)
				.filter((h) => h.isPlain)
				.map((h) => h.idx),
		);
		const nextInput: Array<Record<string, unknown>> = [];
		for (let i = 0; i < lastUserIdx; i++) {
			if (packedSysItemIndices.has(i)) {
				if (!replacedFirstSysItem && !replacedInstructions) {
					nextInput.push({ role: items[i]!.role, content: PACKED_SYSTEM_ANCHOR });
					replacedFirstSysItem = true;
				}
				continue;
			}
			if (keptPrefixIndices.has(i) || overflowIndices.has(i)) {
				nextInput.push(items[i]!);
			}
		}
		nextInput.push(...tailSlice);
		if (replacedInstructions) {
			out.instructions = PACKED_SYSTEM_ANCHOR;
		} else if (!replacedFirstSysItem) {
			nextInput.unshift({ role: "system", content: PACKED_SYSTEM_ANCHOR });
		}
		out.input = nextInput;
		out.tools = upsertCarrierTool(out.tools, "openai-responses", description);
		return { payload: out, packed: true };
	}

	return { payload, packed: false };
}

function jitterFloat(val: number, min: number, max: number, rng: () => number = Math.random): number {
	const raw = val + (rng() * 0.004 - 0.002);
	let next = Number(Math.max(min, Math.min(max, raw)).toFixed(4));
	if (next === val) {
		next = Number((val + 0.001 <= max ? val + 0.001 : Math.max(min, val - 0.001)).toFixed(4));
	}
	return next;
}

/**
 * 采样微扰与防回退（仅作用于已有有限采样参数，绝不给禁用温度的模型强塞温度字段）。
 */
export function applySamplingJitter(
	payload: Record<string, unknown>,
	protocol: RelayPayloadProtocol,
	rng: () => number = Math.random,
): { payload: Record<string, unknown>; changed: boolean } {
	const out: Record<string, unknown> = { ...payload };
	let changed = false;

	if (Object.prototype.hasOwnProperty.call(out, "openrouter_allow_fallbacks") && out.openrouter_allow_fallbacks !== false) {
		out.openrouter_allow_fallbacks = false;
		changed = true;
	}
	if (Object.prototype.hasOwnProperty.call(out, "openrouter_use_fallback") && out.openrouter_use_fallback !== false) {
		out.openrouter_use_fallback = false;
		changed = true;
	}

	// Anthropic 启用 extended thinking 时温度不可动
	const anthropicThinking = protocol === "anthropic" && out.thinking !== undefined;
	if (!anthropicThinking) {
		if (typeof out.temperature === "number" && Number.isFinite(out.temperature)) {
			out.temperature = jitterFloat(out.temperature, 0.05, 2.0, rng);
			changed = true;
		}
		if (typeof out.top_p === "number" && Number.isFinite(out.top_p)) {
			out.top_p = jitterFloat(out.top_p, 0.05, 1.0, rng);
			changed = true;
		}
	}

	if (protocol === "google" && out.config && typeof out.config === "object" && !Array.isArray(out.config)) {
		const cfg = { ...(out.config as Record<string, unknown>) };
		let cfgChanged = false;
		if (typeof cfg.temperature === "number" && Number.isFinite(cfg.temperature)) {
			cfg.temperature = jitterFloat(cfg.temperature, 0.05, 2.0, rng);
			cfgChanged = true;
		}
		if (typeof cfg.topP === "number" && Number.isFinite(cfg.topP)) {
			cfg.topP = jitterFloat(cfg.topP, 0.05, 1.0, rng);
			cfgChanged = true;
		}
		if (cfgChanged) {
			out.config = cfg;
			changed = true;
		}
	}

	return { payload: out, changed };
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

export type ForcedToolChoice = { kind: "required" } | { kind: "tool"; name: string };

export interface ApplyRelayPayloadOptions {
	policy?: RelayPolicyConfig;
	presetMeta?: PresetRelayMeta;
	/** 当前这跳是否强制要求走工具参数交稿（"required" 或指定工具如 "draft_write"） */
	forcedToolChoice?: ForcedToolChoice;
	/** 本跳临时强制的混淆档位（供拒答降级重试使用） */
	overrideShieldMode?: AntiRouteShieldMode;
	/** 本跳临时强制的上下文打包档位（供输入外审重试使用） */
	overrideContextPackMode?: "off" | "tool-desc";
	/** 当严格网关拒绝 safety_settings 时本跳临时剥除 */
	disableOpenAiSafetyField?: boolean;
	/** 本轮原始用户输入（用于在工具打包时顺带将前置状态块/正文目录一并迁出 messages） */
	currentTurnUserText?: string;
	/** 同拍固定种子（避免多轮工具调用之间反复刷新随机注释击穿 Prefix Cache） */
	shieldSeed?: number;
	/** 测试用：显式传入脱敏规则覆盖磁盘文件 */
	relayRules?: RelayRules;
	/** 条目级额外 body 字段 */
	extraIncludeBody?: Record<string, unknown>;
	extraExcludeBody?: string[];
}

function toolNameOf(t: unknown): string {
	if (!t || typeof t !== "object") return "";
	const obj = t as { name?: unknown; function?: { name?: unknown } };
	if (typeof obj.name === "string") return obj.name;
	if (obj.function && typeof obj.function.name === "string") return obj.function.name;
	return "";
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

	// 2. 工具参数交稿破限（强制 tool_choice：仅在存在非载体真实工具时启用）
	let strippedClaudeThinking = false;
	if (opts.forcedToolChoice) {
		const choice = opts.forcedToolChoice;
		if (protocol === "openai-completions" || protocol === "openai-responses") {
			const toolsArr = Array.isArray(next.tools) ? (next.tools as Array<Record<string, unknown>>) : [];
			const hasRealTools = toolsArr.some((t) => toolNameOf(t) !== CARRIER_TOOL_NAME);
			if (hasRealTools) {
				let appliedChoice = false;
				if (choice.kind === "tool") {
					const hasTarget = toolsArr.some((t) => toolNameOf(t) === choice.name);
					if (hasTarget) {
						next.tool_choice =
							protocol === "openai-responses"
								? { type: "function", name: choice.name }
								: { type: "function", function: { name: choice.name } };
						appliedChoice = true;
					}
				} else {
					next.tool_choice = "required";
					appliedChoice = true;
				}
				if (appliedChoice) {
					mutated = true;
					const mId = lower(model?.id);
					if (mId.includes("claude") || (next.thinking && typeof next.thinking === "object")) {
						if ("thinking" in next) delete next.thinking;
						if ("reasoning_effort" in next && mId.includes("claude")) {
							delete next.reasoning_effort;
							strippedClaudeThinking = true;
						}
					}
				}
			}
		} else if (protocol === "anthropic") {
			const toolsArr = Array.isArray(next.tools) ? (next.tools as Array<Record<string, unknown>>) : [];
			const hasRealTools = toolsArr.some((t) => toolNameOf(t) !== CARRIER_TOOL_NAME);
			if (hasRealTools) {
				let appliedChoice = false;
				if (choice.kind === "tool") {
					if (toolsArr.some((t) => t?.name === choice.name)) {
						next.tool_choice = { type: "tool", name: choice.name };
						appliedChoice = true;
					}
				} else {
					next.tool_choice = { type: "any" };
					appliedChoice = true;
				}
				if (appliedChoice) {
					delete next.thinking;
					delete next.output_config;
					strippedClaudeThinking = true;
					mutated = true;
				}
			}
		} else if (protocol === "google") {
			const cfg =
				next.config && typeof next.config === "object" && !Array.isArray(next.config)
					? { ...(next.config as Record<string, unknown>) }
					: {};
			const gTools = Array.isArray(cfg.tools) ? (cfg.tools as Array<Record<string, unknown>>) : [];
			const hasRealTools = gTools.some(
				(grp) =>
					Array.isArray(grp?.functionDeclarations) &&
					(grp.functionDeclarations as Array<Record<string, unknown>>).some((fd) => fd?.name !== CARRIER_TOOL_NAME),
			);
			if (hasRealTools) {
				if (choice.kind === "tool") {
					const hasTarget = gTools.some(
						(grp) =>
							Array.isArray(grp?.functionDeclarations) &&
							(grp.functionDeclarations as Array<Record<string, unknown>>).some((fd) => fd?.name === choice.name),
					);
					if (hasTarget) {
						cfg.toolConfig = {
							functionCallingConfig: { mode: "ANY", allowedFunctionNames: [choice.name] },
						};
						next.config = cfg;
						mutated = true;
					}
				} else {
					cfg.toolConfig = { functionCallingConfig: { mode: "ANY" } };
					next.config = cfg;
					mutated = true;
				}
			}
		}
	}

	// 3. Google 原生 BLOCK_NONE 注入 + OpenAI 兼容端点 Gemini safety_settings 按需透传
	if (shouldInjectGoogleSafety(next, model, policy)) {
		const cfg =
			next.config && typeof next.config === "object" && !Array.isArray(next.config)
				? { ...(next.config as Record<string, unknown>) }
				: {};
		cfg.safetySettings = GEMINI_SAFETY_SETTINGS.map((x) => ({ ...x }));
		next.config = cfg;
		mutated = true;
	} else if (shouldInjectOpenAiGeminiSafety(next, model, policy, opts.disableOpenAiSafetyField)) {
		if (next.safety_settings === undefined) {
			next.safety_settings = GEMINI_SAFETY_SETTINGS.map((x) => ({ ...x }));
			mutated = true;
		}
	}

	const shieldMode: AntiRouteShieldMode = opts.overrideShieldMode ?? policy?.antiRouteShield ?? "off";
	const effectivePackMode =
		opts.overrideContextPackMode ?? (policy?.contextPackMode === "tool-desc" ? "tool-desc" : "off");
	const rules = shieldMode === "scramble" ? (opts.relayRules ?? readRelayRules()) : undefined;

	// 3.5 上下文搬运进虚拟工具描述（启用时执行）
	if (effectivePackMode === "tool-desc") {
		const packedRes = packContextIntoToolDescription(next, protocol, {
			deep: shieldMode === "deep" || shieldMode === "scramble",
			scramble: shieldMode === "scramble",
			relayRules: rules,
			currentTurnUserText: opts.currentTurnUserText,
			shieldSeed: opts.shieldSeed,
		});
		if (packedRes.packed) {
			next = packedRes.payload;
			mutated = true;
		}
	}

	// 4. 防路由注释与词内打断混淆（优先使用临时降级档位）
	if (shieldMode !== "off") {
		next = applyAntiRouteShield(next, protocol, shieldMode, {
			relayRules: rules,
			shieldSeed: opts.shieldSeed,
		});
		mutated = true;
	}

	// 4.5 采样微扰与防回退（deep/scramble 自动启用，或显式开启 jitterSampling）
	if (policy?.jitterSampling === true || shieldMode === "deep" || shieldMode === "scramble") {
		const jitterRng = opts.shieldSeed !== undefined ? createSeededRandom(opts.shieldSeed ^ 0x243f6a88) : Math.random;
		const jittered = applySamplingJitter(next, protocol, jitterRng);
		if (jittered.changed) {
			next = jittered.payload;
			mutated = true;
		}
	}

	// 5. 推理预算透传（若模型与请求尚未显式设定；且未因强制 tool_choice 被清理）
	if (
		!strippedClaudeThinking &&
		presetMeta?.reasoningEffort &&
		protocol === "openai-completions" &&
		next.reasoning_effort === undefined &&
		model?.reasoning
	) {
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
