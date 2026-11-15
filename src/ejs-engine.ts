/**
 * 提示词模板（ST-Prompt-Template）兼容内核：
 * 1. 异步 EJS 编译器（支持 <% / <%_ / <%= / <%- / <%# / -%> / _%> / <%% / %%>、嵌套 > 保护、<#escape-ejs> 范围转义）
 * 2. 世界书首行 @@ 装饰器解析器与 @@if 条件求值器（16 项标准装饰器 + @@endif 剥离）
 * 3. 模板执行上下文构建器（variables、getvar/setvar/incvar/decvar/delvar/insvar、getwi/activewi、
 *    define、injectPrompt/getPromptsInjected、getChatMessage(s)、matchChatMessages、activateRegex、
 *    parseJSON/jsonPatch、Lodash _ 子集等）
 *
 * 纯 TypeScript 零 node:fs / 零外部依赖，服务端送模管线（src/stage/）与浏览器（web/src/）共用。
 */

import { applyMacros } from "./card.ts";
import { findInitVar } from "./mvu.ts";
import { parsePromptEntries } from "./prompt-entries.ts";
import type { LorebookEntry, WorldState } from "./types.ts";

// ---------------- 1. 已知世界书首行 @@ 装饰器 ----------------

export const KNOWN_WI_DECORATORS = new Set([
	"@@activate",
	"@@dont_activate",
	"@@dont_deactivate",
	"@@message_formatting",
	"@@generate_before",
	"@@generate_after",
	"@@render_before",
	"@@render_after",
	"@@dont_preload",
	"@@initial_variables",
	"@@always_enabled",
	"@@only_preload",
	"@@preload",
	"@@iframe",
	"@@preprocessing",
	"@@if",
	"@@private",
]);

export interface WorldInfoDecoratorInfo {
	/** 识别出的装饰器名（如 ['@@if', '@@private']） */
	decorators: string[];
	/** 与 decorators 一一对应的参数字符串 */
	args: string[];
	/** 剥离首行连续 @@ 装饰器及尾部 @@endif 后的干净正文 */
	cleanContent: string;
	/** 是否为不直接作为普通世界书设定送模的特殊条目 */
	isSpecialEntry: boolean;
	/** 是否为 @@preprocessing 或标题含 [Preprocessing] */
	isPreprocessing: boolean;
	/** 是否带有 @@activate */
	isForceActivate: boolean;
	/** 是否带有 @@dont_activate */
	isForceDeactivate: boolean;
	/** 是否带有 @@private */
	isPrivate: boolean;
	/** 若含 @@if 则返回其条件表达式数组（支持多条 @@if 叠加） */
	ifConditions: string[];
}

/**
 * 解析世界书条目首行连续的 @@ 装饰器（对齐 ST-Prompt-Template src/function/worldinfo.ts:901-958）
 * 同时剥离正文末尾遗留的 `@@endif` 行（兼容多段条件卡片写法）。
 */
export function parseDecoratorsFromText(content: string): { decorators: string[]; args: string[]; cleanContent: string } {
	const normalized = typeof content === "string" ? content : "";
	if (!normalized.startsWith("@@")) {
		const cleanedTail = normalized.replace(/(?:^|\r?\n)[ \t]*@@endif[ \t]*(?=\r?\n|$)/g, "");
		return { decorators: [], args: [], cleanContent: cleanedTail };
	}

	const decorators: string[] = [];
	const args: string[] = [];
	let lineStart = 0;
	let fallbacked = false;

	while (lineStart < normalized.length) {
		if (!normalized.startsWith("@@", lineStart)) {
			break;
		}
		let lineEnd = normalized.indexOf("\n", lineStart);
		if (lineEnd === -1) {
			lineEnd = normalized.length;
		}
		let line = normalized.substring(lineStart, lineEnd);
		if (line.endsWith("\r")) {
			line = line.slice(0, -1);
		}

		const isEscaped = line.startsWith("@@@");
		if (isEscaped && !fallbacked) {
			// @@@转义首行：还原为 @@ 并作为正文起点保留
			const unescapedFirst = line.substring(1);
			const rest = lineEnd < normalized.length ? normalized.slice(lineEnd) : "";
			const body = (unescapedFirst + rest).replace(/(?:^|\r?\n)[ \t]*@@endif[ \t]*(?=\r?\n|$)/g, "");
			return { decorators, args, cleanContent: body };
		}

		const candidate = isEscaped ? line.substring(1) : line;
		const spaceIdx = candidate.indexOf(" ");
		const base = spaceIdx !== -1 ? candidate.substring(0, spaceIdx).trim() : candidate.trim();
		const arg = spaceIdx !== -1 ? candidate.substring(spaceIdx + 1).trim() : "";

		if (KNOWN_WI_DECORATORS.has(base)) {
			decorators.push(base);
			args.push(arg);
			fallbacked = false;
		} else {
			// 未识别的 @@xxx 行按原版语义直接丢弃（如 @@endif 等）
			fallbacked = true;
		}

		if (lineEnd === normalized.length) {
			lineStart = normalized.length;
			break;
		}
		lineStart = lineEnd + 1;
	}

	const cleanContent = normalized
		.slice(lineStart)
		.replace(/(?:^|\r?\n)[ \t]*@@endif[ \t]*(?=\r?\n|$)/g, "");
	return { decorators, args, cleanContent };
}

export function parseWorldInfoDecorators(entry: { comment?: string; content?: string }): WorldInfoDecoratorInfo {
	const comment = entry.comment ?? "";
	const content = entry.content ?? "";
	const { decorators, args, cleanContent } = parseDecoratorsFromText(content);

	const has = (d: string) => decorators.includes(d);
	const isSpecialEntry =
		has("@@initial_variables") ||
		comment.includes("[InitialVariables]") ||
		comment.includes("@INJECT") ||
		has("@@only_preload") ||
		comment.includes("[GENERATE:") ||
		comment.includes("[RENDER:") ||
		has("@@generate_after") ||
		has("@@generate_before") ||
		has("@@render_after") ||
		has("@@render_before");

	const isPreprocessing = comment.includes("[Preprocessing]") || has("@@preprocessing");
	const isForceActivate = !has("@@dont_activate") && has("@@activate");
	const isForceDeactivate = has("@@dont_activate") || has("@@dont_deactivate");
	const isPrivate = has("@@private");

	const ifConditions: string[] = [];
	for (let i = 0; i < decorators.length; i++) {
		if (decorators[i] === "@@if" && args[i]) {
			ifConditions.push(args[i]!);
		}
	}

	return {
		decorators,
		args,
		cleanContent,
		isSpecialEntry,
		isPreprocessing,
		isForceActivate,
		isForceDeactivate,
		isPrivate,
		ifConditions,
	};
}

// ---------------- 2. Lodash 兼容工具集（纯 TS 内置，免外部依赖） ----------------

function parsePath(path: string | number | Array<string | number> | null | undefined): string[] {
	if (path == null) return [];
	if (Array.isArray(path)) return path.map(String);
	if (typeof path === "number") return [String(path)];
	const s = String(path).trim();
	if (!s) return [];
	const parts: string[] = [];
	const re = /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(s)) !== null) {
		if (m[1] !== undefined) parts.push(m[1]);
		else if (m[3] !== undefined) parts.push(m[3].replace(/\\(.)/g, "$1"));
		else parts.push(m[0]);
	}
	return parts.filter((p) => p !== "");
}

export function lodashGet(obj: unknown, path: string | number | Array<string | number> | null | undefined, defaultValue?: unknown): unknown {
	if (path == null || path === "") return obj === undefined ? defaultValue : obj;
	const parts = parsePath(path);
	if (parts.length === 0) return obj === undefined ? defaultValue : obj;
	let cur: unknown = obj;
	for (const p of parts) {
		if (cur == null || typeof cur !== "object") return defaultValue;
		cur = (cur as Record<string, unknown>)[p];
		if (cur === undefined) return defaultValue;
	}
	return cur === undefined ? defaultValue : cur;
}

export function lodashHas(obj: unknown, path: string | number | Array<string | number> | null | undefined): boolean {
	if (obj == null || typeof obj !== "object") return false;
	if (path == null || path === "") return Object.keys(obj as object).length > 0;
	const parts = parsePath(path);
	if (parts.length === 0) return false;
	let cur: unknown = obj;
	for (const p of parts) {
		if (cur == null || typeof cur !== "object" || !(p in (cur as object))) return false;
		cur = (cur as Record<string, unknown>)[p];
	}
	return true;
}

export function lodashSet<T extends Record<string, unknown>>(
	obj: T,
	path: string | number | Array<string | number> | null | undefined,
	value: unknown,
): T {
	if (obj == null || typeof obj !== "object") return obj;
	if (path == null || path === "") {
		if (value && typeof value === "object" && !Array.isArray(value)) {
			for (const k of Object.keys(obj)) delete obj[k];
			Object.assign(obj, value);
		}
		return obj;
	}
	const parts = parsePath(path);
	if (parts.length === 0) return obj;
	let cur: Record<string, unknown> = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		const key = parts[i]!;
		const nextKey = parts[i + 1]!;
		const existing = cur[key];
		if (existing == null || typeof existing !== "object") {
			cur[key] = /^\d+$/.test(nextKey) ? [] : {};
		}
		cur = cur[key] as Record<string, unknown>;
	}
	const last = parts[parts.length - 1]!;
	cur[last] = value;
	return obj;
}

export function lodashUnset(obj: unknown, path: string | number | Array<string | number> | null | undefined): boolean {
	if (obj == null || typeof obj !== "object") return false;
	if (path == null || path === "") {
		for (const k of Object.keys(obj as Record<string, unknown>)) {
			delete (obj as Record<string, unknown>)[k];
		}
		return true;
	}
	const parts = parsePath(path);
	if (parts.length === 0) return false;
	let cur: unknown = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		if (cur == null || typeof cur !== "object") return false;
		cur = (cur as Record<string, unknown>)[parts[i]!];
	}
	if (cur == null || typeof cur !== "object") return false;
	const last = parts[parts.length - 1]!;
	if (Array.isArray(cur) && /^\d+$/.test(last)) {
		const idx = Number(last);
		if (idx >= 0 && idx < cur.length) {
			cur.splice(idx, 1);
			return true;
		}
		return false;
	}
	delete (cur as Record<string, unknown>)[last];
	return true;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
	if (!v || typeof v !== "object" || Array.isArray(v)) return false;
	const proto = Object.getPrototypeOf(v);
	return proto === null || proto === Object.prototype;
}

export function cloneDeep<T>(val: T): T {
	if (val === null || typeof val !== "object") return val;
	if (typeof val === "function") return val;
	if (val instanceof RegExp) return new RegExp(val.source, val.flags) as unknown as T;
	if (val instanceof Date) return new Date(val.getTime()) as unknown as T;
	if (Array.isArray(val)) return val.map((item) => cloneDeep(item)) as unknown as T;
	if (isPlainObject(val)) {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(val)) {
			out[k] = cloneDeep(v);
		}
		return out as T;
	}
	return val;
}

export function mergeWithArraysReplaced(
	target: Record<string, unknown>,
	...sources: Array<Record<string, unknown> | undefined | null>
): Record<string, unknown> {
	for (const src of sources) {
		if (!src || typeof src !== "object") continue;
		for (const [k, v] of Object.entries(src)) {
			if (v === undefined) continue;
			if (Array.isArray(v)) {
				target[k] = cloneDeep(v);
			} else if (isPlainObject(v) && isPlainObject(target[k])) {
				mergeWithArraysReplaced(target[k] as Record<string, unknown>, v);
			} else if (isPlainObject(v)) {
				target[k] = mergeWithArraysReplaced({}, v);
			} else {
				target[k] = v;
			}
		}
	}
	return target;
}

export function buildBuiltinLodash() {
	const _: Record<string, unknown> = {
		get: lodashGet,
		set: lodashSet,
		has: lodashHas,
		unset: lodashUnset,
		cloneDeep,
		clone: cloneDeep,
		isPlainObject,
		isArray: Array.isArray,
		isObject: (v: unknown) => v !== null && typeof v === "object",
		isString: (v: unknown) => typeof v === "string",
		isNumber: (v: unknown) => typeof v === "number" && !Number.isNaN(v),
		isBoolean: (v: unknown) => typeof v === "boolean",
		isFunction: (v: unknown) => typeof v === "function",
		isNil: (v: unknown) => v === null || v === undefined,
		isUndefined: (v: unknown) => v === undefined,
		isNull: (v: unknown) => v === null,
		isEmpty: (v: unknown) => {
			if (v == null) return true;
			if (typeof v === "string" || Array.isArray(v)) return v.length === 0;
			if (typeof v === "object") return Object.keys(v as object).length === 0;
			return false;
		},
		isEqual: (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b),
		merge: (target: Record<string, unknown>, ...sources: Record<string, unknown>[]) =>
			mergeWithArraysReplaced(target ?? {}, ...sources),
		mergeWith: (
			target: Record<string, unknown>,
			src: Record<string, unknown>,
			customizer?: (objVal: unknown, srcVal: unknown) => unknown,
		) => {
			if (!target || typeof target !== "object") return target;
			if (!src || typeof src !== "object") return target;
			const walk = (dst: Record<string, unknown>, s: Record<string, unknown>) => {
				for (const [k, sv] of Object.entries(s)) {
					const dv = dst[k];
					const custom = customizer ? customizer(dv, sv) : undefined;
					if (custom !== undefined) {
						dst[k] = custom;
					} else if (isPlainObject(dv) && isPlainObject(sv)) {
						walk(dv, sv);
					} else if (isPlainObject(sv)) {
						dst[k] = walk({}, sv);
					} else {
						dst[k] = cloneDeep(sv);
					}
				}
				return dst;
			};
			return walk(target, src);
		},
		assign: Object.assign,
		defaults: (target: Record<string, unknown>, ...sources: Record<string, unknown>[]) => {
			if (!target || typeof target !== "object") return target;
			for (const src of sources) {
				if (!src || typeof src !== "object") continue;
				for (const [k, v] of Object.entries(src)) {
					if (target[k] === undefined) target[k] = v;
				}
			}
			return target;
		},
		keys: (o: unknown) => (o && typeof o === "object" ? Object.keys(o as object) : []),
		values: (o: unknown) => (o && typeof o === "object" ? Object.values(o as object) : []),
		entries: (o: unknown) => (o && typeof o === "object" ? Object.entries(o as object) : []),
		fromEntries: Object.fromEntries,
		clamp: (n: number, lower: number, upper?: number) => {
			if (upper === undefined) return Math.min(n, lower);
			return Math.min(Math.max(n, lower), upper);
		},
		inRange: (n: number, start: number, end?: number) => {
			const s = end === undefined ? 0 : start;
			const e = end === undefined ? start : end;
			return n >= Math.min(s, e) && n < Math.max(s, e);
		},
		random: (min = 0, max = 1) => Math.floor(Math.random() * (max - min + 1)) + min,
		sum: (arr: unknown[]) => (Array.isArray(arr) ? arr.reduce<number>((a, b) => a + (Number(b) || 0), 0) : 0),
		uniq: (arr: unknown[]) => (Array.isArray(arr) ? [...new Set(arr)] : []),
		compact: (arr: unknown[]) => (Array.isArray(arr) ? arr.filter(Boolean) : []),
		flatten: (arr: unknown[]) => (Array.isArray(arr) ? arr.flat() : []),
		castArray: (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]),
		pick: (obj: Record<string, unknown>, keys: string[]) => {
			const out: Record<string, unknown> = {};
			if (!obj || typeof obj !== "object") return out;
			for (const k of keys) if (k in obj) out[k] = obj[k];
			return out;
		},
		omit: (obj: Record<string, unknown>, keys: string[]) => {
			if (!obj || typeof obj !== "object") return {};
			const drop = new Set(keys);
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(obj)) if (!drop.has(k)) out[k] = v;
			return out;
		},
		escapeRegExp: (s: string) => String(s ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
		unescape: (s: string) =>
			String(s ?? "")
				.replace(/&amp;/g, "&")
				.replace(/&lt;/g, "<")
				.replace(/&gt;/g, ">")
				.replace(/&quot;/g, '"')
				.replace(/&#39;/g, "'"),
		noop: () => {},
		identity: <T>(x: T) => x,
	};
	return _;
}

const BUILTIN_LODASH = buildBuiltinLodash();

// ---------------- 3. JSON Patch (RFC 6902) 与宽松 parseJSON ----------------

export interface JsonPatchOp {
	op: "add" | "remove" | "replace" | "move" | "copy" | "test" | "set" | "assign";
	path: string;
	from?: string;
	value?: unknown;
}

function pointerToSegments(pointer: string): string[] {
	if (typeof pointer !== "string") return [];
	if (pointer === "") return [];
	const clean = pointer.startsWith("/") ? pointer.slice(1) : pointer;
	return clean.split("/").map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function applyJsonPatch(doc: unknown, patches: JsonPatchOp[]): unknown {
	if (!doc || typeof doc !== "object") return doc;
	const next = cloneDeep(doc) as Record<string, unknown>;
	if (!Array.isArray(patches)) return next;

	for (const p of patches) {
		if (!p || typeof p !== "object") continue;
		const segs = pointerToSegments(p.path);
		const fromSegs = p.from ? pointerToSegments(p.from) : [];
		switch (p.op) {
			case "set":
			case "assign":
			case "add":
			case "replace": {
				const last = segs[segs.length - 1];
				if (last === "-") {
					const parent = lodashGet(next, segs.slice(0, -1));
					if (Array.isArray(parent)) parent.push(cloneDeep(p.value));
				} else {
					lodashSet(next, segs, cloneDeep(p.value));
				}
				break;
			}
			case "remove": {
				lodashUnset(next, segs);
				break;
			}
			case "move": {
				const val = lodashGet(next, fromSegs);
				if (val !== undefined) {
					lodashUnset(next, fromSegs);
					lodashSet(next, segs, cloneDeep(val));
				}
				break;
			}
			case "copy": {
				const val = lodashGet(next, fromSegs);
				if (val !== undefined) {
					lodashSet(next, segs, cloneDeep(val));
				}
				break;
			}
			case "test": {
				const cur = lodashGet(next, segs);
				if (JSON.stringify(cur) !== JSON.stringify(p.value)) return doc;
				break;
			}
		}
	}
	return next;
}

export function parseLooseJson(text: string): unknown {
	const raw = String(text ?? "").trim();
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		// 剥除代码块围栏、尾随逗号与单行注释后再试
		const stripped = raw
			.replace(/^```(?:json)?\s*/i, "")
			.replace(/\s*```$/i, "")
			.replace(/,\s*([}\]])/g, "$1");
		return JSON.parse(stripped);
	}
}

// ---------------- 4. 定制版异步 EJS 编译器（对齐 ST-Prompt-Template src/3rdparty/ejs.js） ----------------

export interface EjsCompileOptions {
	openDelimiter?: string;
	closeDelimiter?: string;
	delimiter?: string;
	outputFunctionName?: string;
	localsName?: string;
	_with?: boolean;
	rmWhitespace?: boolean;
	async?: boolean;
	escape?: (markup: string) => string;
}

const DEFAULT_ESCAPE = (markup: string): string => (markup == null ? "" : String(markup));

function escapeRegExpChars(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 处理 <#escape-ejs>...<#/escape-ejs> 范围转义（将内部的 <% 与 %> 转为 <%% 与 %%>）
 */
export function applyEscapeEjsBlocks(input: string): string {
	if (!input.includes("<#escape-ejs>")) return input;
	return input.replace(/<#escape-ejs>([\s\S]*?)<#\/escape-ejs>/g, (_m, inner: string) => {
		return inner.replace(/<%/g, "<%%").replace(/%>/g, "%%>");
	});
}

function tokenizeEjs(text: string, o = "<", c = ">", d = "%"): string[] {
	const regStr = `(${escapeRegExpChars(o)}${escapeRegExpChars(d)}${escapeRegExpChars(d)}|${escapeRegExpChars(d)}${escapeRegExpChars(d)}${escapeRegExpChars(c)}|${escapeRegExpChars(o)}${escapeRegExpChars(d)}=|${escapeRegExpChars(o)}${escapeRegExpChars(d)}-|${escapeRegExpChars(o)}${escapeRegExpChars(d)}_|${escapeRegExpChars(o)}${escapeRegExpChars(d)}#|${escapeRegExpChars(o)}${escapeRegExpChars(d)}|${escapeRegExpChars(d)}${escapeRegExpChars(c)}|-${escapeRegExpChars(d)}${escapeRegExpChars(c)}|_${escapeRegExpChars(d)}${escapeRegExpChars(c)})`;
	const pat = new RegExp(regStr);
	let str = text;
	const rawTokens: string[] = [];
	let match = pat.exec(str);
	while (match) {
		const pos = match.index;
		if (pos !== 0) {
			rawTokens.push(str.substring(0, pos));
			str = str.slice(pos);
		}
		rawTokens.push(match[0]);
		str = str.slice(match[0].length);
		match = pat.exec(str);
	}
	if (str) rawTokens.push(str);

	// 配平嵌套开闭标签（对齐 ST-Prompt-Template ejs.js:744-786）
	const processed: string[] = [];
	let i = 0;
	const openPrefix = o + d;
	const literalOpen = o + d + d;
	const closeSuffix = d + c;
	const literalClose = d + d + c;

	while (i < rawTokens.length) {
		const token = rawTokens[i]!;
		if (token.startsWith(openPrefix) && token !== literalOpen) {
			let nesting = 1;
			const buf: string[] = [];
			let j = i + 1;
			while (j < rawTokens.length) {
				const inner = rawTokens[j]!;
				if (inner.startsWith(openPrefix) && inner !== literalOpen) {
					nesting++;
				} else if (inner.endsWith(closeSuffix) && inner !== literalClose) {
					nesting--;
					if (nesting === 0) {
						processed.push(token, buf.join(""), inner);
						i = j;
						break;
					}
				}
				buf.push(inner);
				j++;
			}
			if (nesting !== 0) {
				throw new SyntaxError(`Could not find matching close tag for "${token}".`);
			}
		} else {
			processed.push(token);
		}
		i++;
	}
	return processed;
}

export function compileEjsSource(templateText: string, opts: EjsCompileOptions = {}): string {
	const o = opts.openDelimiter ?? "<";
	const c = opts.closeDelimiter ?? ">";
	const d = opts.delimiter ?? "%";
	const localsName = opts.localsName ?? "locals";
	const outputFnName = opts.outputFunctionName ?? "print";
	const useWith = opts._with !== false;

	let text = applyEscapeEjsBlocks(templateText);
	if (opts.rmWhitespace) {
		text = text.replace(/[\r\n]+/g, "\n").replace(/^\s+|\s+$/gm, "");
	}
	// <%_ 吞噬同行前导水平空白，_%> 吞噬同行尾随空白與一个换行
	text = text.replace(/[ \t]*<%_/gm, "<%_").replace(/_%>[ \t]*/gm, "_%>");

	const tokens = tokenizeEjs(text, o, c, d);
	let mode: "eval" | "escaped" | "raw" | "comment" | "literal" | null = null;
	let truncate: "dash" | "underscore" | false = false;
	let source = "";

	const addOutput = (line: string) => {
		let s = line;
		if (truncate) {
			s = s.replace(/^(?:\r\n|\r|\n)/, "");
			truncate = false;
		}
		if (!s) return;
		const escaped = s
			.replace(/\\/g, "\\\\")
			.replace(/\n/g, "\\n")
			.replace(/\r/g, "\\r")
			.replace(/"/g, '\\"');
		source += `    ; __append("${escaped}")\n`;
	};

	for (const line of tokens) {
		switch (line) {
			case `${o}${d}`:
			case `${o}${d}_`:
				mode = "eval";
				break;
			case `${o}${d}=`:
				mode = "escaped";
				break;
			case `${o}${d}-`:
				mode = "raw";
				break;
			case `${o}${d}#`:
				mode = "comment";
				break;
			case `${o}${d}${d}`:
				mode = "literal";
				source += `    ; __append("${o}${d}")\n`;
				break;
			case `${d}${d}${c}`:
				mode = "literal";
				source += `    ; __append("${d}${c}")\n`;
				break;
			case `${d}${c}`:
			case `-${d}${c}`:
			case `_${d}${c}`:
				if (mode === "literal") {
					addOutput(line);
				}
				mode = null;
				if (line.startsWith("-")) truncate = "dash";
				else if (line.startsWith("_")) truncate = "underscore";
				break;
			default:
				if (mode) {
					switch (mode) {
						case "eval":
							source += `    ; ${line}\n`;
							break;
						case "escaped":
							source += `    ; __append(escapeFn(${line.replace(/;\s*$/, "")}))\n`;
							break;
						case "raw":
							source += `    ; __append(${line.replace(/;\s*$/, "")})\n`;
							break;
						case "comment":
							break;
						case "literal":
							addOutput(line);
							break;
					}
				} else {
					addOutput(line);
				}
		}
	}

	let body = `  var __output = "";\n`;
	body += `  function __append(...args) { args.filter(x => x !== undefined && x !== null).forEach(s => __output += s); }\n`;
	if (outputFnName) {
		body += `  const ${outputFnName} = __append;\n`;
	}
	if (useWith) {
		body += `  with (${localsName} || {}) {\n${source}  }\n`;
	} else {
		body += `  {\n${source}  }\n`;
	}
	body += `  return __output;\n`;
	return body;
}

const AsyncFunctionCtor = Object.getPrototypeOf(async function () {}).constructor as new (
	...args: string[]
) => (
	this: unknown,
	locals: Record<string, unknown>,
	escapeFn: (markup: string) => string,
) => Promise<string>;

export function compileEjs(
	templateText: string,
	opts: EjsCompileOptions = {},
): (data?: Record<string, unknown>) => Promise<string> {
	const localsName = opts.localsName ?? "locals";
	const escapeFn = opts.escape ?? DEFAULT_ESCAPE;
	const src = compileEjsSource(templateText, opts);
	const fn = new AsyncFunctionCtor(localsName, "escapeFn", src);
	return async function (this: unknown, data: Record<string, unknown> = {}) {
		const ctx = (this && typeof this === "object" ? this : data) as Record<string, unknown>;
		return await fn.call(ctx, data, escapeFn);
	};
}

export async function evalEjsTemplate(
	content: string,
	context: Record<string, unknown> = {},
	opts: EjsCompileOptions = {},
): Promise<string> {
	if (typeof content !== "string" || !content) return content ?? "";
	const o = opts.openDelimiter ?? "<";
	const d = opts.delimiter ?? "%";
	if (!content.includes(`${o}${d}`) && !content.includes("<#escape-ejs>")) {
		return content;
	}
	const compiled = compileEjs(content, opts);
	return await compiled.call(context, context);
}

/**
 * 语法检查器（对应 EjsTemplate.getSyntaxErrorInfo）
 */
export function getEjsSyntaxErrorInfo(code: string, maxLines = 4): string {
	try {
		compileEjs(code);
		return "";
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		const lines = code.split("\n");
		const preview = lines.slice(0, Math.max(1, maxLines * 2)).join("\n");
		return `${msg}\n${preview}`;
	}
}

// ---------------- 5. 模板执行上下文构建器（prepareContext） ----------------

export type VarScopeType = "global" | "local" | "message" | "cache" | "initial";
export type VarFlagType = "nx" | "xx" | "n" | "nxs" | "xxs";
export type VarResultType = "old" | "new" | "fullcache";

export interface SetVarOptions {
	index?: number | string;
	scope?: VarScopeType;
	inscope?: VarScopeType;
	outscope?: VarScopeType;
	flags?: VarFlagType;
	results?: VarResultType;
	merge?: boolean;
	dryRun?: boolean;
	noCache?: boolean;
	defaults?: unknown;
	min?: number;
	max?: number;
	clone?: boolean;
}

type SimpleVarOption = VarFlagType | VarScopeType | VarResultType | boolean;

function normalizeVarOptions(opt?: SetVarOptions | SimpleVarOption): SetVarOptions {
	if (typeof opt === "string") {
		if (opt === "old" || opt === "new" || opt === "fullcache") return { results: opt };
		if (opt === "nx" || opt === "xx" || opt === "n" || opt === "nxs" || opt === "xxs") return { flags: opt };
		if (opt === "cache" || opt === "global" || opt === "local" || opt === "message" || opt === "initial") {
			return { scope: opt, inscope: opt, outscope: opt };
		}
	}
	if (typeof opt === "boolean") return { dryRun: opt };
	return opt && typeof opt === "object" ? opt : {};
}

export interface EjsEvalEnvInput {
	state?: WorldState;
	chatVars?: Record<string, unknown>;
	globalVars?: Record<string, unknown>;
	characterVars?: Record<string, unknown>;
	initialVars?: Record<string, unknown>;
	allLoreEntries?: LorebookEntry[];
	presetPrompts?: Array<{ name: string; content: string }>;
	charName?: string;
	userName?: string;
	charDescription?: string;
	charPersonality?: string;
	charScenario?: string;
	charMesExample?: string;
	chatId?: string;
	model?: string;
	messages?: Array<{ role: "user" | "assistant" | "system"; content: string; name?: string }>;
	runType?: "generate" | "preparation" | "render" | "render_permanent";
	isDryRun?: boolean;
	sharedDefines?: Record<string, unknown>;
	extra?: Record<string, unknown>;
}

export interface EjsExecutionContext extends Record<string, unknown> {
	variables: Record<string, unknown>;
	__inlinedLoreUids: Set<number>;
	__inlinedLoreComments: Set<string>;
	__forceActivatedEntries: LorebookEntry[];
	__promptInjected: Map<string, Array<{ order: number; prompt: string; uid: string }>>;
	__sharedDefines: Record<string, unknown>;
	__modified: boolean;
}

export function createEjsContext(input: EjsEvalEnvInput = {}): EjsExecutionContext {
	const globalStore: Record<string, unknown> = input.globalVars ? cloneDeep(input.globalVars) : {};
	const initialStore: Record<string, unknown> = input.initialVars ? cloneDeep(input.initialVars) : {};
	const localStore: Record<string, unknown> = input.chatVars ? cloneDeep(input.chatVars) : {};
	const mvuTree: Record<string, unknown> =
		input.state?.mvu && isPlainObject(input.state.mvu)
			? cloneDeep(input.state.mvu)
			: isPlainObject(localStore.stat_data)
				? cloneDeep(localStore.stat_data as Record<string, unknown>)
				: {};

	// 合并出统一的 variables 视图（优先级：global -> initial -> character -> local -> message/stat_data）
	const cacheVars: Record<string, unknown> = {};
	mergeWithArraysReplaced(
		cacheVars,
		globalStore,
		initialStore,
		input.characterVars ?? {},
		localStore,
		input.state
			? {
					time: input.state.time,
					location: input.state.location,
					characters: input.state.characters,
					inventory: input.state.inventory,
					flags: input.state.flags,
					plot_threads: input.state.plot_threads,
				}
			: {},
		{ stat_data: mvuTree },
	);

	// 保持 state.mvu 引用同步：当模板改写 variables.stat_data 或 setvar('stat_data.xxx') 时同步写回 input.state.mvu
	const syncBackMvu = () => {
		if (input.state && isPlainObject(cacheVars.stat_data)) {
			input.state.mvu = cloneDeep(cacheVars.stat_data as Record<string, unknown>);
		}
	};

	const inlinedLoreUids = new Set<number>();
	const inlinedLoreComments = new Set<string>();
	const forceActivatedEntries: LorebookEntry[] = [];
	const promptInjected = new Map<string, Array<{ order: number; prompt: string; uid: string }>>();
	const sharedDefines: Record<string, unknown> = input.sharedDefines ?? {};
	const allLore = input.allLoreEntries ?? [];
	const msgs = input.messages ?? [];
	const charName = input.charName ?? "Assistant";
	const userName = input.userName ?? "User";
	const macroCtx = { charName, userName };

	let wiRecursionDepth = 0;

	const getStoreForScope = (scope: VarScopeType = "cache"): Record<string, unknown> => {
		switch (scope) {
			case "global":
				return globalStore;
			case "initial":
				return initialStore;
			case "local":
				return localStore;
			case "message":
			case "cache":
			default:
				return cacheVars;
		}
	};

	const getvar = function (key: string | null | undefined, rawOpts?: SetVarOptions | SimpleVarOption): unknown {
		const opts = normalizeVarOptions(rawOpts);
		const store = getStoreForScope(opts.scope ?? "cache");
		if (key == null || key === "") {
			return opts.clone ? cloneDeep(store) : store;
		}
		if (opts.index != null) {
			const rawStr = lodashGet(store, key, "{}");
			try {
				const parsed = typeof rawStr === "string" ? JSON.parse(rawStr) : rawStr;
				const idx = Number.isNaN(Number(opts.index)) ? opts.index : Number(opts.index);
				const val = lodashGet(parsed, idx, opts.defaults);
				return opts.clone ? cloneDeep(val) : val;
			} catch {
				return opts.defaults;
			}
		}
		const val = lodashGet(store, key, opts.defaults);
		return opts.clone ? cloneDeep(val) : val;
	};

	const setvar = function (
		key: string | null | undefined,
		value: unknown,
		rawOpts?: SetVarOptions | SimpleVarOption,
	): unknown {
		const opts = normalizeVarOptions(rawOpts);
		const scope = opts.scope ?? "message";
		const targetStore = getStoreForScope(scope);

		if (opts.flags === "nx" && lodashHas(cacheVars, key)) return undefined;
		if (opts.flags === "xx" && !lodashHas(cacheVars, key)) return undefined;
		if (opts.flags === "nxs" && getvar(key, opts) !== undefined) return undefined;
		if (opts.flags === "xxs" && getvar(key, opts) === undefined) return undefined;

		const oldValue = opts.results === "old" || opts.merge ? lodashGet(cacheVars, key, undefined) : undefined;
		let newValue = value;
		if (opts.merge) {
			if ((oldValue === undefined || Array.isArray(oldValue)) && Array.isArray(value)) {
				newValue = [...(oldValue ?? []), ...value];
			} else if (isPlainObject(oldValue) && isPlainObject(value)) {
				newValue = mergeWithArraysReplaced(cloneDeep(oldValue), value);
			}
		}

		if (opts.index != null) {
			const rawStr = lodashGet(cacheVars, key, "{}");
			let data: Record<string, unknown> = {};
			try {
				data = typeof rawStr === "string" ? JSON.parse(rawStr || "{}") : isPlainObject(rawStr) ? cloneDeep(rawStr) : {};
			} catch {
				data = {};
			}
			const idx = Number.isNaN(Number(opts.index)) ? opts.index : Number(opts.index);
			if (newValue === undefined) lodashUnset(data, idx);
			else lodashSet(data, idx, newValue);
			const serialized = JSON.stringify(data);
			lodashSet(cacheVars, key, serialized);
			if (targetStore !== cacheVars) lodashSet(targetStore, key, serialized);
		} else {
			if (newValue === undefined) {
				lodashUnset(cacheVars, key);
				if (targetStore !== cacheVars) lodashUnset(targetStore, key);
			} else {
				lodashSet(cacheVars, key, newValue);
				if (targetStore !== cacheVars) lodashSet(targetStore, key, newValue);
			}
		}

		ctx.__modified = true;
		syncBackMvu();

		if (opts.results === "old") return oldValue;
		if (opts.results === "fullcache") return cacheVars;
		return newValue;
	};

	const incvar = function (key: string, value = 1, rawOpts?: SetVarOptions | SimpleVarOption): unknown {
		const opts = normalizeVarOptions(rawOpts);
		const inscope = opts.inscope ?? opts.scope ?? "cache";
		const outscope = opts.outscope ?? opts.scope ?? "message";
		if (
			(opts.flags === "nx" && lodashHas(cacheVars, key)) ||
			(opts.flags === "xx" && !lodashHas(cacheVars, key)) ||
			(opts.flags === "nxs" && getvar(key, { ...opts, scope: inscope }) !== undefined) ||
			(opts.flags === "xxs" && getvar(key, { ...opts, scope: inscope }) === undefined)
		) {
			return undefined;
		}
		const base = Number(getvar(key, { ...opts, scope: inscope, defaults: opts.defaults ?? 0 })) || 0;
		let next = base + Number(value);
		if (opts.min != null) next = Math.max(next, opts.min);
		if (opts.max != null) next = Math.min(next, opts.max);
		return setvar(key, next, { ...opts, scope: outscope, flags: "n" });
	};

	const decvar = function (key: string, value = 1, rawOpts?: SetVarOptions | SimpleVarOption): unknown {
		return incvar(key, -Number(value), rawOpts);
	};

	const delvar = function (key: string, index?: string | number, rawOpts?: SetVarOptions | SimpleVarOption): unknown {
		if (index == null) {
			return setvar(key, undefined, rawOpts);
		}
		const cur = getvar(key, rawOpts);
		if (Array.isArray(cur)) {
			const clone = [...cur];
			const idx = clone.indexOf(index);
			if (idx !== -1) {
				clone.splice(idx, 1);
				return setvar(key, clone, rawOpts);
			}
		} else if (isPlainObject(cur)) {
			const clone = { ...cur };
			delete clone[String(index)];
			return setvar(key, clone, rawOpts);
		} else if (typeof cur === "string" && typeof index === "string") {
			return setvar(key, cur.replace(index, ""), rawOpts);
		}
		return undefined;
	};

	const insvar = function (
		key: string,
		value: unknown,
		index?: string | number,
		rawOpts?: SetVarOptions | SimpleVarOption,
	): unknown {
		const opts = normalizeVarOptions(rawOpts);
		const cur = getvar(key, opts);
		if (Array.isArray(cur)) {
			const clone = [...cur];
			if (index == null) clone.push(value);
			else {
				const i = Number(index) < 0 ? Math.max(0, clone.length + Number(index)) : Number(index);
				clone.splice(i, 0, value);
			}
			return setvar(key, clone, opts);
		}
		if (isPlainObject(cur) && index != null) {
			const k = String(index);
			const exists = Object.prototype.hasOwnProperty.call(cur, k);
			if (opts.flags?.includes("nx") && exists) return undefined;
			if (opts.flags?.includes("xx") && !exists) return undefined;
			return setvar(key, { ...cur, [k]: value }, opts);
		}
		if (typeof cur === "string") {
			if (index == null) return setvar(key, cur + String(value), opts);
			const i = Number(index) < 0 ? Math.max(0, cur.length + Number(index)) : Number(index);
			if (!Number.isNaN(i)) {
				return setvar(key, cur.slice(0, i) + String(value) + cur.slice(i), opts);
			}
		}
		return undefined;
	};

	const findLoreEntry = (
		worldOrTitle: string | RegExp | number | null | undefined,
		maybeTitle?: string | RegExp | number | Record<string, unknown>,
	): { entry: LorebookEntry | null; data: Record<string, unknown> } => {
		let targetTitle: string | RegExp | number;
		let extraData: Record<string, unknown> = {};
		if (maybeTitle === undefined || isPlainObject(maybeTitle)) {
			targetTitle = worldOrTitle ?? "";
			if (isPlainObject(maybeTitle)) extraData = maybeTitle;
		} else {
			targetTitle = maybeTitle;
		}
		for (const e of allLore) {
			const comment = e.comment ?? "";
			if (typeof targetTitle === "number") {
				if (e.uid === targetTitle) return { entry: e, data: extraData };
			} else if (targetTitle instanceof RegExp) {
				if (targetTitle.test(comment)) return { entry: e, data: extraData };
			} else if (typeof targetTitle === "string" && targetTitle) {
				if (comment === targetTitle || String(e.uid) === targetTitle) {
					return { entry: e, data: extraData };
				}
			}
		}
		// 模糊/正则回退（对齐 ST-Prompt-Template worldinfo.ts:275 `data.comment.match(title)`）
		if (typeof targetTitle === "string" && targetTitle) {
			for (const e of allLore) {
				const comment = e.comment ?? "";
				if (comment.includes(targetTitle)) return { entry: e, data: extraData };
				try {
					if (new RegExp(targetTitle).test(comment)) return { entry: e, data: extraData };
				} catch {
					/* ignore invalid regex */
				}
			}
		}
		return { entry: null, data: extraData };
	};

	const getwi = async function (
		worldOrTitle: string | RegExp | number | null | undefined,
		entryOrData?: string | RegExp | number | Record<string, unknown>,
		data: Record<string, unknown> = {},
	): Promise<string> {
		if (wiRecursionDepth >= 8) return "";
		const found = findLoreEntry(worldOrTitle, entryOrData);
		if (!found.entry) return "";
		const mergedData = isPlainObject(entryOrData) ? found.data : data;
		if (typeof found.entry.uid === "number") inlinedLoreUids.add(found.entry.uid);
		if (found.entry.comment) inlinedLoreComments.add(found.entry.comment);

		const dec = parseWorldInfoDecorators(found.entry);
		const substituted = applyMacros(dec.cleanContent, macroCtx);
		wiRecursionDepth++;
		try {
			const subCtx = Object.assign(ctx, mergedData, { world_info: found.entry });
			return await evalEjsTemplate(substituted, subCtx);
		} finally {
			wiRecursionDepth--;
		}
	};

	const activewi = async function (
		worldOrTitle: string | RegExp | number | null | undefined,
		titleOrForce?: string | RegExp | number | boolean,
		_force?: boolean,
	): Promise<LorebookEntry | null> {
		const target = typeof titleOrForce === "boolean" ? undefined : titleOrForce;
		const found = findLoreEntry(worldOrTitle, target);
		if (found.entry) {
			const activated = { ...found.entry, enabled: true, constant: true };
			if (!forceActivatedEntries.some((x) => x.uid === activated.uid && x.comment === activated.comment)) {
				forceActivatedEntries.push(activated);
			}
			return activated;
		}
		return null;
	};

	const define = function (name: string, value: unknown, merge = false): unknown {
		const oldVal = lodashGet(sharedDefines, name, undefined);
		let nextVal = value;
		if (merge) {
			if ((oldVal === undefined || Array.isArray(oldVal)) && Array.isArray(value)) {
				nextVal = [...(oldVal ?? []), ...value];
			} else if ((oldVal === undefined || isPlainObject(oldVal)) && isPlainObject(value)) {
				nextVal = mergeWithArraysReplaced(cloneDeep((oldVal as Record<string, unknown>) ?? {}), value);
			}
		}
		lodashSet(sharedDefines, name, nextVal);
		lodashSet(ctx, name, typeof nextVal === "function" ? (nextVal as Function).bind(ctx) : nextVal);
		return oldVal;
	};

	const injectPrompt = function (key: string, prompt: string, order = 100, _sticky = 0, uid = ""): void {
		const list = promptInjected.get(key) ?? [];
		const id = uid || `${key}_${list.length}`;
		const existingIdx = list.findIndex((x) => x.uid === id);
		if (existingIdx >= 0) list[existingIdx] = { order, prompt, uid: id };
		else list.push({ order, prompt, uid: id });
		promptInjected.set(key, list);
	};

	const getPromptsInjected = function (
		key: string,
		postprocess: Array<{ search: string | RegExp; replace: string }> = [],
	): string {
		const list = promptInjected.get(key);
		if (!list || list.length === 0) return "";
		let combined = [...list]
			.sort((a, b) => a.order - b.order)
			.map((x) => x.prompt)
			.join("\n");
		for (const pp of postprocess) {
			if (pp && pp.search != null) {
				combined = combined.replace(pp.search, pp.replace ?? "");
			}
		}
		return combined;
	};

	const hasPromptsInjected = (key: string): boolean => {
		const list = promptInjected.get(key);
		return !!list && list.length > 0;
	};

	const getChatMessage = (idx: number, role?: "user" | "assistant" | "system"): string => {
		const filtered = role ? msgs.filter((m) => m.role === role) : msgs;
		const pos = idx >= 0 ? idx : filtered.length + idx;
		return filtered[pos]?.content ?? "";
	};

	const getChatMessages = (
		startOrCount: number = msgs.length,
		endOrRole?: number | "user" | "assistant" | "system",
		role?: "user" | "assistant" | "system",
	): string[] => {
		const filterByRole = (r?: string) => (r ? msgs.filter((m) => m.role === r) : msgs);
		if (endOrRole == null) {
			const list = msgs;
			const slice = startOrCount >= 0 ? list.slice(0, startOrCount) : list.slice(startOrCount);
			return slice.map((m) => m.content);
		}
		if (typeof endOrRole === "string") {
			const list = filterByRole(endOrRole);
			const slice = startOrCount >= 0 ? list.slice(0, startOrCount) : list.slice(startOrCount);
			return slice.map((m) => m.content);
		}
		const list = filterByRole(role);
		return list.slice(startOrCount, endOrRole).map((m) => m.content);
	};

	const matchChatMessages = (
		pattern: string | RegExp | Array<string | RegExp>,
		options: { start?: number; end?: number; role?: "user" | "assistant" | "system"; and?: boolean } = {},
	): boolean => {
		const targetMsgs = getChatMessages(options.start ?? -2, options.end ?? msgs.length, options.role);
		const patterns = Array.isArray(pattern) ? pattern : [pattern];
		return targetMsgs.some((text) =>
			options.and
				? patterns.every((p) => (p instanceof RegExp ? p.test(text) : text.includes(String(p))))
				: patterns.some((p) => (p instanceof RegExp ? p.test(text) : text.includes(String(p)))),
		);
	};

	const lastUserIdx = (() => {
		for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i]?.role === "user") return i;
		return undefined;
	})();
	const lastCharIdx = (() => {
		for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i]?.role === "assistant") return i;
		return undefined;
	})();

	const ctx: EjsExecutionContext = {
		_: BUILTIN_LODASH,
		console,
		variables: cacheVars,
		userName,
		charName,
		assistantName: charName,
		chatId: input.chatId ?? "",
		characterId: 0,
		groupId: null,
		groups: [],
		charAvatar: "",
		userAvatar: "",
		charLoreBook: undefined,
		userLoreBook: undefined,
		chatLoreBook: undefined,
		model: input.model ?? "",
		runType: input.runType ?? "generate",
		generateType: "normal",
		isDryRun: input.isDryRun ?? false,
		lastMessageId: msgs.length > 0 ? msgs.length - 1 : -1,
		lastUserMessageId: lastUserIdx,
		lastCharMessageId: lastCharIdx,
		lastUserMessage: lastUserIdx !== undefined ? (msgs[lastUserIdx]?.content ?? "") : "",
		lastCharMessage: lastCharIdx !== undefined ? (msgs[lastCharIdx]?.content ?? "") : "",

		// 变量读写函数族
		getvar,
		getLocalVar: (k: string, o: SetVarOptions = {}) => getvar(k, { ...o, scope: "local" }),
		getGlobalVar: (k: string, o: SetVarOptions = {}) => getvar(k, { ...o, scope: "global" }),
		getMessageVar: (k: string, o: SetVarOptions = {}) => getvar(k, { ...o, scope: "message" }),
		setvar,
		setLocalVar: (k: string, v: unknown, o: SetVarOptions = {}) => setvar(k, v, { ...o, scope: "local" }),
		setGlobalVar: (k: string, v: unknown, o: SetVarOptions = {}) => setvar(k, v, { ...o, scope: "global" }),
		setMessageVar: (k: string, v: unknown, o: SetVarOptions = {}) => setvar(k, v, { ...o, scope: "message" }),
		incvar,
		incLocalVar: (k: string, v = 1, o: SetVarOptions = {}) => incvar(k, v, { ...o, outscope: "local" }),
		incGlobalVar: (k: string, v = 1, o: SetVarOptions = {}) => incvar(k, v, { ...o, outscope: "global" }),
		incMessageVar: (k: string, v = 1, o: SetVarOptions = {}) => incvar(k, v, { ...o, outscope: "message" }),
		decvar,
		decLocalVar: (k: string, v = 1, o: SetVarOptions = {}) => decvar(k, v, { ...o, outscope: "local" }),
		decGlobalVar: (k: string, v = 1, o: SetVarOptions = {}) => decvar(k, v, { ...o, outscope: "global" }),
		decMessageVar: (k: string, v = 1, o: SetVarOptions = {}) => decvar(k, v, { ...o, outscope: "message" }),
		delvar,
		delLocalVar: (k: string, idx?: string | number, o: SetVarOptions = {}) => delvar(k, idx, { ...o, scope: "local" }),
		delGlobalVar: (k: string, idx?: string | number, o: SetVarOptions = {}) => delvar(k, idx, { ...o, scope: "global" }),
		delMessageVar: (k: string, idx?: string | number, o: SetVarOptions = {}) => delvar(k, idx, { ...o, scope: "message" }),
		insvar,
		insertLocalVar: (k: string, v: unknown, idx?: string | number, o: SetVarOptions = {}) =>
			insvar(k, v, idx, { ...o, scope: "local" }),
		insertGlobalVar: (k: string, v: unknown, idx?: string | number, o: SetVarOptions = {}) =>
			insvar(k, v, idx, { ...o, scope: "global" }),
		insertMessageVar: (k: string, v: unknown, idx?: string | number, o: SetVarOptions = {}) =>
			insvar(k, v, idx, { ...o, scope: "message" }),
		findVariables: (key?: string) => (key ? getvar(key) : cacheVars),
		patchVariables: (key: string | null, change: JsonPatchOp[] | string, o: SetVarOptions = {}) => {
			const doc = getvar(key, o);
			const ops = (typeof change === "string" ? parseLooseJson(change) : change) as JsonPatchOp[];
			const patched = applyJsonPatch(doc, ops);
			return setvar(key, patched, o);
		},
		jsonPatch: applyJsonPatch,
		parseJSON: parseLooseJson,
		setVariableSchema: () => {},

		// 世界书与角色/预设读取函数族
		getwi,
		getWorldInfo: getwi,
		activewi,
		activateWorldInfo: activewi,
		activateWorldInfoByKeywords: async (keywords: string | string[]) => {
			const text = Array.isArray(keywords) ? keywords.join("\n") : String(keywords ?? "");
			const hits = allLore.filter((e) => e.keys?.some((k) => k && text.includes(k)));
			for (const h of hits) await activewi(null, h.uid, true);
			return hits;
		},
		getWorldInfoData: async () => allLore,
		getEnabledWorldInfoEntries: async () => allLore,
		getEnabledLoreBooks: () => [],
		selectActivatedEntries: (entries: LorebookEntry[], keywords: string | string[]) => {
			const text = Array.isArray(keywords) ? keywords.join("\n") : String(keywords ?? "");
			return (entries ?? []).filter((e) => e.constant || e.keys?.some((k) => k && text.includes(k)));
		},
		getchar: async () => input.charDescription ?? "",
		getChara: async () => input.charDescription ?? "",
		getchr: async () => input.charDescription ?? "",
		getCharData: async () => ({
			name: charName,
			description: input.charDescription ?? "",
			personality: input.charPersonality ?? "",
			scenario: input.charScenario ?? "",
			mes_example: input.charMesExample ?? "",
		}),
		getCharaData: async () => ({
			name: charName,
			description: input.charDescription ?? "",
			personality: input.charPersonality ?? "",
			scenario: input.charScenario ?? "",
			mes_example: input.charMesExample ?? "",
		}),
		getpreset: async (name: string | RegExp) => {
			const hit = (input.presetPrompts ?? []).find((p) =>
				name instanceof RegExp ? name.test(p.name) : p.name === name,
			);
			if (!hit) return "";
			return await evalEjsTemplate(applyMacros(hit.content, macroCtx), ctx);
		},
		getPresetPrompt: async (name: string | RegExp) => {
			const hit = (input.presetPrompts ?? []).find((p) =>
				name instanceof RegExp ? name.test(p.name) : p.name === name,
			);
			if (!hit) return "";
			return await evalEjsTemplate(applyMacros(hit.content, macroCtx), ctx);
		},
		getprp: async (name: string | RegExp) => {
			const hit = (input.presetPrompts ?? []).find((p) =>
				name instanceof RegExp ? name.test(p.name) : p.name === name,
			);
			if (!hit) return "";
			return await evalEjsTemplate(applyMacros(hit.content, macroCtx), ctx);
		},
		getqr: async () => "",
		getQuickReply: async () => "",
		getQuickReplyData: () => null,

		// 聊天消息与辅助函数
		getChatMessage,
		getChatMessages,
		matchChatMessages,
		define,
		injectPrompt,
		getPromptsInjected,
		hasPromptsInjected,
		activateRegex: () => {},
		execute: async () => "",
		evalTemplate: async (content: string, data: Record<string, unknown> = {}, options: EjsCompileOptions = {}) => {
			return await evalEjsTemplate(content, Object.assign(ctx, data), options);
		},

		// 内部状态追踪
		__inlinedLoreUids: inlinedLoreUids,
		__inlinedLoreComments: inlinedLoreComments,
		__forceActivatedEntries: forceActivatedEntries,
		__promptInjected: promptInjected,
		__sharedDefines: sharedDefines,
		__modified: false,
	};

	// 挂载已有的 sharedDefines
	for (const [k, v] of Object.entries(sharedDefines)) {
		ctx[k] = typeof v === "function" ? (v as Function).bind(ctx) : cloneDeep(v);
	}
	if (input.extra) {
		Object.assign(ctx, input.extra);
	}

	return ctx;
}

/**
 * 求值 @@if <expr> 条件装饰器（对齐 ST-Prompt-Template worldinfo.ts:846-864）
 * 返回 true 表示条件满足（保留条目），返回 false 表示条件不满足（剔除条目）。
 */
export async function evaluateDecoratorIf(
	ifConditions: string[],
	context: EjsExecutionContext,
): Promise<boolean> {
	if (!ifConditions || ifConditions.length === 0) return true;
	for (const expr of ifConditions) {
		const trimmed = expr.trim();
		if (!trimmed) continue;
		try {
			const out = await evalEjsTemplate(`<%- !!(${trimmed}) %>`, context);
			if (out.trim() === "false") return false;
		} catch {
			// 若条件表达式引用了尚未初始化的全局标记（如 globalThis._fanrenSeg 未命中），按 false 排除
			return false;
		}
	}
	return true;
}

// ---------------- 6. 梨园送模管线与检索管线集成入口 ----------------

const FAST_CHECK_RE =
	/<%|@@(?:if|generate|render|preload|initial_variables|activate|dont_activate|preprocessing|private|iframe|endif)\b|\[(?:GENERATE|RENDER|InitialVariables|Preprocessing)|<#escape-ejs>/;

export function hasPromptTemplateSyntax(text: string): boolean {
	return FAST_CHECK_RE.test(text);
}

export interface StagePromptTemplateInput {
	cardAgentsRaw: string;
	cardAgentsRendered: string;
	entries: LorebookEntry[];
	allLoreEntries?: LorebookEntry[];
	state: WorldState;
	chatVars?: Record<string, unknown>;
	globalVars?: Record<string, unknown>;
	characterVars?: Record<string, unknown>;
	charName: string;
	userName: string;
	chatId?: string;
	messages?: Array<{ role: "user" | "assistant" | "system"; content: string; name?: string }>;
}

export interface StagePromptTemplateOutput {
	cardAgents: string;
	entries: LorebookEntry[];
	preprocessedWindowText: string;
	ejsContext: EjsExecutionContext;
}

/**
 * 单条世界书条目正文编译（供绿灯被动注入与 lorebook_search 检索命中返回使用）
 */
export async function evalLoreEntryContent(
	entry: { comment?: string; content?: string },
	ejsContext: EjsExecutionContext,
	macroCtx: { charName: string; userName: string },
): Promise<string> {
	const raw = entry.content ?? "";
	if (!hasPromptTemplateSyntax(raw)) return raw;
	const dec = parseWorldInfoDecorators(entry);
	const body = applyMacros(dec.cleanContent, macroCtx);
	try {
		const wrapped = dec.isPrivate ? `<% await (async()=>{ %>${body}<% })(); %>` : body;
		return (await evalEjsTemplate(wrapped, ejsContext)).trim();
	} catch {
		return dec.cleanContent;
	}
}

/**
 * 梨园每拍送模前的提示词模板 4 步编译管线：
 * 1. 执行 @@preprocessing 条目/小节（设置跨条目状态并产出附加绿灯扫描词）；
 * 2. 对 AGENTS.md 各小节执行 @@if 过滤与 <% ... %> / getwi() 编译；
 * 3. 对世界书 entries 执行特殊条目剥离、@@if 过滤、getwi 已内联条目去重及常驻条目编译；
 * 4. 返回干净的 cardAgents、过滤后的 entries、附加扫描文本与本拍 ejsContext（供 lorebook_search 复用）。
 */
export async function compileStagePromptTemplates(
	input: StagePromptTemplateInput,
): Promise<StagePromptTemplateOutput> {
	const allPool = input.allLoreEntries && input.allLoreEntries.length > 0 ? input.allLoreEntries : input.entries;
	const initialVars = findInitVar(allPool) ?? {};
	const ejsContext = createEjsContext({
		state: input.state,
		chatVars: input.chatVars,
		globalVars: input.globalVars,
		characterVars: input.characterVars,
		initialVars,
		allLoreEntries: allPool,
		charName: input.charName,
		userName: input.userName,
		chatId: input.chatId,
		messages: input.messages,
		runType: "generate",
	});

	const hasAnyTemplate =
		hasPromptTemplateSyntax(input.cardAgentsRaw) ||
		input.entries.some((e) => hasPromptTemplateSyntax(e.content) || hasPromptTemplateSyntax(e.comment ?? ""));

	if (!hasAnyTemplate) {
		return {
			cardAgents: input.cardAgentsRendered,
			entries: input.entries,
			preprocessedWindowText: "",
			ejsContext,
		};
	}

	const macroCtx = { charName: input.charName, userName: input.userName };
	const preprocessedChunks: string[] = [];

	// 解析 AGENTS.md 的条目列表
	const agentSections = input.cardAgentsRaw.trim() ? parsePromptEntries(input.cardAgentsRaw) : [];
	const precomputedAgentSections = new Map<number, string>();
	const precomputedLoreEntries = new Map<number, string>();

	// 第 1 步：先行执行所有 @@preprocessing 小节与世界书条目
	for (let i = 0; i < agentSections.length; i++) {
		const sec = agentSections[i]!;
		if (!sec.enabled) continue;
		const dec = parseWorldInfoDecorators({ comment: sec.title, content: sec.content });
		if (!dec.isPreprocessing) continue;
		if (!(await evaluateDecoratorIf(dec.ifConditions, ejsContext))) {
			precomputedAgentSections.set(i, "__SKIP__");
			continue;
		}
		try {
			const body = applyMacros(dec.cleanContent, macroCtx);
			const wrapped = dec.isPrivate ? `<% await (async()=>{ %>${body}<% })(); %>` : body;
			const out = (await evalEjsTemplate(wrapped, ejsContext)).trim();
			precomputedAgentSections.set(i, out);
			if (out) preprocessedChunks.push(out);
		} catch {
			precomputedAgentSections.set(i, dec.cleanContent);
		}
	}

	for (let i = 0; i < input.entries.length; i++) {
		const e = input.entries[i]!;
		if (!e.enabled) continue;
		const dec = parseWorldInfoDecorators(e);
		if (!dec.isPreprocessing) continue;
		if (!(await evaluateDecoratorIf(dec.ifConditions, ejsContext))) {
			precomputedLoreEntries.set(i, "__SKIP__");
			continue;
		}
		try {
			const body = applyMacros(dec.cleanContent, macroCtx);
			const wrapped = dec.isPrivate ? `<% await (async()=>{ %>${body}<% })(); %>` : body;
			const out = (await evalEjsTemplate(wrapped, ejsContext)).trim();
			precomputedLoreEntries.set(i, out);
			if (out) preprocessedChunks.push(out);
		} catch {
			precomputedLoreEntries.set(i, dec.cleanContent);
		}
	}

	// 第 2 步：编译 AGENTS.md 的各个开启小节（剔除 @@if 为 false 的小节，编译 <% ... %> 与 getwi）
	let compiledCardAgents = input.cardAgentsRendered;
	if (agentSections.length > 0) {
		const outSections: string[] = [];
		for (let i = 0; i < agentSections.length; i++) {
			const sec = agentSections[i]!;
			if (!sec.enabled) continue;
			if (precomputedAgentSections.has(i)) {
				const pre = precomputedAgentSections.get(i)!;
				if (pre === "__SKIP__") continue;
				const heading = sec.name ? `${"#".repeat(sec.level)} ${sec.name}` : "";
				if (pre || sec.level === 1) {
					outSections.push([heading, pre].filter((s) => s.trim()).join("\n"));
				}
				continue;
			}

			const dec = parseWorldInfoDecorators({ comment: sec.title, content: sec.content });
			if (dec.isSpecialEntry && !dec.decorators.includes("@@generate_before") && !dec.decorators.includes("@@generate_after")) {
				continue;
			}
			if (dec.isForceDeactivate) continue;
			if (!(await evaluateDecoratorIf(dec.ifConditions, ejsContext))) {
				continue;
			}

			let body = dec.cleanContent;
			if (hasPromptTemplateSyntax(body)) {
				try {
					const macroApplied = applyMacros(body, macroCtx);
					const wrapped = dec.isPrivate ? `<% await (async()=>{ %>${macroApplied}<% })(); %>` : macroApplied;
					body = (await evalEjsTemplate(wrapped, ejsContext)).trim();
				} catch {
					body = dec.cleanContent.trim();
				}
			}
			const heading = sec.name ? `${"#".repeat(sec.level)} ${sec.name}` : "";
			outSections.push([heading, body].filter((s) => s.trim()).join("\n"));
		}
		compiledCardAgents = outSections.join("\n\n").trim();
	}

	// 第 3 步：过滤与编译世界书 entries
	const compiledEntries: LorebookEntry[] = [];
	const combinedEntries = [...input.entries];
	for (const forced of ejsContext.__forceActivatedEntries) {
		if (!combinedEntries.some((x) => x.uid === forced.uid && x.comment === forced.comment)) {
			combinedEntries.push(forced);
		}
	}

	for (let i = 0; i < combinedEntries.length; i++) {
		const e = combinedEntries[i]!;
		// 若该条目已被常驻开关通过 getwi() 内联展开，则不再作为独立待检索绿灯/常驻重复出现
		if (
			(typeof e.uid === "number" && ejsContext.__inlinedLoreUids.has(e.uid) && !e.enabled) ||
			(e.comment && ejsContext.__inlinedLoreComments.has(e.comment))
		) {
			compiledEntries.push({ ...e, enabled: false });
			continue;
		}
		if (!e.enabled) {
			compiledEntries.push(e);
			continue;
		}

		if (precomputedLoreEntries.has(i)) {
			const pre = precomputedLoreEntries.get(i)!;
			if (pre === "__SKIP__") {
				compiledEntries.push({ ...e, enabled: false });
			} else {
				compiledEntries.push({ ...e, content: pre });
			}
			continue;
		}

		const dec = parseWorldInfoDecorators(e);
		if (dec.isSpecialEntry || dec.isForceDeactivate) {
			compiledEntries.push({ ...e, enabled: false });
			continue;
		}
		if (!(await evaluateDecoratorIf(dec.ifConditions, ejsContext))) {
			compiledEntries.push({ ...e, enabled: false });
			continue;
		}

		let nextContent = dec.cleanContent;
		const isConstant = e.constant || dec.isForceActivate;
		// 常驻条目直接在此编译正文；绿灯非常驻条目保留干净模板待激活或检索时按需编译
		if (isConstant && hasPromptTemplateSyntax(nextContent)) {
			try {
				const macroApplied = applyMacros(nextContent, macroCtx);
				const wrapped = dec.isPrivate ? `<% await (async()=>{ %>${macroApplied}<% })(); %>` : macroApplied;
				nextContent = (await evalEjsTemplate(wrapped, ejsContext)).trim();
			} catch {
				nextContent = dec.cleanContent;
			}
		}

		compiledEntries.push({
			...e,
			constant: isConstant,
			content: nextContent,
		});
	}

	return {
		cardAgents: compiledCardAgents,
		entries: compiledEntries,
		preprocessedWindowText: preprocessedChunks.join("\n"),
		ejsContext,
	};
}

