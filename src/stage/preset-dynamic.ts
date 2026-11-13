/**
 * 标准梨园模式（presetMode === "liyuan"）下的每轮预设动态投影器。
 *
 * 定位与原则：
 * - 不落盘写任何 .md 文件，只在内存中按当前开关、变量与宏实时投影预设内容；
 * - 角色卡设定与世界书全部走梨园 AGENTS.md / buildStageSystemPrompt / buildStageInjection，
 *   因此 7 个非对话历史 marker 槽位一律跳过不填，也不执行卡字段 overrides（防双份）；
 * - 严格遵守铁律三：不硬编码预设作者块名、标签名或中文禁用句词表；假工具名与搬运界标
 *   直接从预设自身的 SPreset JSON 与 tavern_helper.scripts 动态读取，空壳块通过跨 marker
 *   结构配对消融。
 */

import { extractAuthorScriptVariables } from "../authorScripts.ts";
import { createEjsContext, evalEjsTemplate, hasPromptTemplateSyntax, type EjsExecutionContext } from "../ejs-engine.ts";
import { findInitVar } from "../mvu.ts";
import { normalizeRpPreset } from "../preset.ts";
import { rpEntries, stEntries, type AssemblyEntry, type PieceRole } from "../preset-assemble.ts";
import type { PresetDoc } from "../preset-doc.ts";
import { createMacroEnv, evalPresetMacros } from "../preset-macro.ts";
import { extractSPresetConfig } from "../spreset-config.ts";
import type { CharacterCard, LorebookEntry } from "../types.ts";
import { buildLiyuanOutputOverrideFragment, type PromptFragment } from "./assemble.ts";

const LAST_USER_SENTINEL = "__LIYUAN_LAST_USER_SENTINEL__";

/** 第三方扩展记忆/表格插件的外部占位宏（在梨园模式由梨园原生状态/记忆通道承担） */
const EXTERNAL_PLUGIN_MACRO_RE =
	/\{\{\s*(?:压缩相邻消息::[^}]*|MEMORY_TABLE_[^}]*|MEMORY_SUMMARY|VECTOR_MEMORY|MEMORY_PROMPT|xbgetvar::[^}]*)\s*\}\}/gi;

const MARKER_SKIP_SET = new Set([
	"worldInfoBefore",
	"charDescription",
	"charPersonality",
	"scenario",
	"worldInfoAfter",
	"personaDescription",
	"dialogueExamples",
	"chatHistory",
]);

export interface LiyuanPresetDynamicInput {
	card: CharacterCard;
	presetDoc: PresetDoc | null;
	allLoreEntries?: LorebookEntry[];
	userName: string;
	history: Array<{ role: "user" | "assistant"; text: string }>;
	userText: string;
	chatId?: string;
	model?: string;
	chatVars?: Record<string, unknown>;
	globalVars?: Record<string, unknown>;
	characterVars?: Record<string, unknown>;
	presetVars?: Record<string, unknown>;
	initialVars?: Record<string, unknown>;
	/** 运行期浏览器/插件临时片段（如 injectPrompts / setExtensionPrompt） */
	extensionPrompts?: PromptFragment[];
}

export interface LiyuanPresetDynamicResult {
	fragments: PromptFragment[];
	dirtyLocal: Record<string, string>;
	dirtyGlobal: Record<string, string>;
	stats: {
		totalEnabled: number;
		skippedMarkers: number;
		skippedEmptyShells: number;
		skippedLastUserOnly: number;
		strippedFakeToolBlocks: number;
		emittedFragments: number;
	};
}

interface DynamicProtocolHints {
	isSPreset: boolean;
	fakeToolNames: string[];
	delimiters: string[];
}

function escapeReg(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 从预设自身的 SPreset 字段与自带脚本声明中提取假工具名和协议定界符 */
function extractProtocolHints(presetRaw: Record<string, unknown> | undefined): DynamicProtocolHints {
	if (!presetRaw || typeof presetRaw !== "object") {
		return { isSPreset: false, fakeToolNames: [], delimiters: [] };
	}
	const spreset = extractSPresetConfig(presetRaw);
	const fakeToolNames = new Set<string>();
	const delimiters = new Set<string>();

	if (spreset?.ToolBindings && typeof spreset.ToolBindings === "object") {
		for (const [key, item] of Object.entries(spreset.ToolBindings)) {
			if (!item || typeof item !== "object") continue;
			const name = typeof item.form?.name === "string" && item.form.name.trim() ? item.form.name.trim() : key.trim();
			if (name) fakeToolNames.add(name);
		}
	}

	const ext = presetRaw.extensions as Record<string, unknown> | undefined;
	const th = ext?.tavern_helper as Record<string, unknown> | undefined;
	const scripts = Array.isArray(th?.scripts) ? (th.scripts as Array<Record<string, unknown>>) : [];
	for (const s of scripts) {
		if (!s || typeof s !== "object" || s.enabled === false || typeof s.content !== "string") continue;
		const src = s.content;
		const mBegin = /\bBEGIN\s*=\s*['"]([^'"]+)['"]/.exec(src);
		const mEnd = /\bEND\s*=\s*['"]([^'"]+)['"]/.exec(src);
		const mTool = /\bTOOL_NAME\s*=\s*['"]([^'"]+)['"]/.exec(src);
		if (mBegin?.[1]) delimiters.add(mBegin[1]);
		if (mEnd?.[1]) delimiters.add(mEnd[1]);
		if (mTool?.[1]) fakeToolNames.add(mTool[1]);
		for (const m of src.matchAll(/registerFunctionTool\s*\(\s*\{[\s\S]{0,400}?\bname\s*:\s*['"]([A-Za-z0-9_.-]+)['"]/g)) {
			if (m[1]) fakeToolNames.add(m[1]);
		}
	}

	return {
		isSPreset: !!spreset,
		fakeToolNames: [...fakeToolNames],
		delimiters: [...delimiters],
	};
}

/** 剥除空白标签与无内容的纯装饰外壳 */
function stripEmptyTagPairs(text: string): string {
	let cur = text;
	for (let i = 0; i < 6; i++) {
		const next = cur.replace(/<([A-Za-z_一-鿿][\w一-鿿.\-]*)(?:\s[^>]*)?>\s*<\/\1>/g, "");
		if (next === cur) break;
		cur = next;
	}
	return cur;
}

/** 剥去标签、分隔线与空白后的纯文字有效内容 */
function visibleProse(text: string): string {
	return text
		.replace(/<[^>]+>/g, "")
		.replace(/^[-=_*~#\s]+$/gm, "")
		.trim();
}

/** 清理单个求值后块里的假工具协议暗号、第三方记忆空占位和重复用户输入 */
function sanitizeSinglePiece(
	rawText: string,
	hints: DynamicProtocolHints,
): { text: string; skippedReason?: "delimiter" | "fake-tool-only" | "last-user-only" | "empty-shell" } {
	let text = rawText.trim();
	if (!text) return { text: "", skippedReason: "empty-shell" };

	// 1. 脚本动态声明的搬运定界符整块跳过
	for (const d of hints.delimiters) {
		if (text === d || visibleProse(text) === d) {
			return { text: "", skippedReason: "delimiter" };
		}
		if (text.includes(d)) {
			text = text.replaceAll(d, "").trim();
		}
	}

	// 2. SPreset 协议控制标记清理
	let touchedFakeTool = false;
	if (hints.isSPreset) {
		if (text.includes("<<<|catgodml|")) {
			text = text.replace(/<<<\|catgodml\|[\s\S]*?>>>/g, "");
			touchedFakeTool = true;
		}
		if (/<\|sep\|>|<\|merge\|>|<run_tool_replacement>/i.test(text)) {
			// 在 SPreset <run_tool_replacement> 协议句内去除关于 reply 工具的诱导子句，保留思考要求
			text = text
				.replace(/<\|sep\|>|<\|merge\|>|<run_tool_replacement>/gi, "")
				.replace(/[^。\n；;]*?\breply\s*工具[^，,。\n；;]*[，,。]?/gi, "")
				.trim();
			touchedFakeTool = true;
		}
	}

	// 3. 剥除显式点名假工具（如 soliumbra_reply / wave_context_reference / publish_story）的整句
	for (const toolName of hints.fakeToolNames) {
		if (!text.includes(toolName)) continue;
		touchedFakeTool = true;
		const reTool = escapeReg(toolName);
		text = text
			.replace(new RegExp(`[^。！？\\n]*?(?:\`?${reTool}\`?)[^。！？\\n]*[。！？\\n]?`, "gi"), "")
			.trim();
	}
	if (touchedFakeTool) {
		text = stripEmptyTagPairs(text).trim();
		if (!visibleProse(text)) {
			return { text: "", skippedReason: "fake-tool-only" };
		}
	}

	// 4. 第三方扩展记忆/表格占位宏在梨园模式无宿主对接时清零，若只剩空说明壳则跳过
	if (EXTERNAL_PLUGIN_MACRO_RE.test(text)) {
		EXTERNAL_PLUGIN_MACRO_RE.lastIndex = 0;
		const stripped = stripEmptyTagPairs(text.replace(EXTERNAL_PLUGIN_MACRO_RE, "")).trim();
		if (!visibleProse(stripped) || !stripped) {
			return { text: "", skippedReason: "empty-shell" };
		}
		// 如果剥去占位宏与标题后只剩面向占位符的短只读引语（没有具体写作或剧情规则），同样视作空壳跳过
		const withoutHeaders = stripped
			.replace(/^\s*#{1,6}\s+.*$/gm, "")
			.replace(/<[^>]+>/g, "")
			.trim();
		if (withoutHeaders.length <= 160) {
			return { text: "", skippedReason: "empty-shell" };
		}
		text = stripped;
	}

	// 5. {{lastUserMessage}} 去重：避免与梨园 tailText 的本轮用户原文重发两遍
	if (text.includes(LAST_USER_SENTINEL)) {
		// 先尝试摘除紧裹哨兵的标签容器（如 <dreamer_input>\n__LIYUAN_LAST_USER_SENTINEL__\n</dreamer_input>）
		let cleaned = text.replace(
			new RegExp(
				`(?:^|\\n)\\s*(?:【[^】]{1,20}】\\s*\\n)?\\s*<([A-Za-z_][\\w-]*)[^>]*>[\\s\\S]{0,80}?${LAST_USER_SENTINEL}\\s*</\\1>`,
				"g",
			),
			"",
		);
		cleaned = cleaned.replaceAll(LAST_USER_SENTINEL, "（见本轮用户输入原文）").trim();
		cleaned = stripEmptyTagPairs(cleaned).trim();
		const leftoverProse = visibleProse(cleaned)
			.replace(/Here is the user's latest request\s*:?/gi, "")
			.replace(/（见本轮用户输入原文）/g, "")
			.trim();
		if (leftoverProse.length < 20) {
			return { text: "", skippedReason: "last-user-only" };
		}
		text = cleaned;
	}

	return { text: text.trim() };
}

type SeqNode =
	| { kind: "skipped-marker"; id: string }
	| { kind: "piece"; source: "before" | "after"; id: string; name: string; role: PieceRole; text: string };

/** 提取片段末尾未闭合的 `<Tag>`（可带前面 1 行引语） */
function extractTrailingOpenShell(text: string): { tag: string; prefixWithoutShell: string } | null {
	const m = /(?:^|\n)([^\n]*[:：]?\s*\n)?<([A-Za-z_一-鿿][\w一-鿿.\-]*)(?:\s[^>]*)?>\s*(?:[^\n<]{0,40}[:：])?\s*$/i.exec(text);
	if (!m) return null;
	const tag = m[2]!;
	// 若文本内部已有对应的闭合标签，说明不是未闭合的跨越外壳
	const openCount = (text.match(new RegExp(`<${escapeReg(tag)}(?:\\s[^>]*)?>`, "gi")) ?? []).length;
	const closeCount = (text.match(new RegExp(`</${escapeReg(tag)}\\s*>`, "gi")) ?? []).length;
	if (openCount <= closeCount) return null;
	// 仅当尾部这句简短引语前面没有其它复杂结构时裁去引导行，否则只裁标签与它自己的冒号短语
	const cutAt = m.index + (text[m.index] === "\n" ? 1 : 0);
	const beforeCut = text.slice(0, cutAt).trimEnd();
	const leadLine = m[1]?.trim() ?? "";
	// 若前置行不是仅作开壳铺垫的短句，保留前置行
	const keepLead = leadLine && leadLine.length > 48 ? `${beforeCut}${beforeCut ? "\n" : ""}${leadLine}` : beforeCut;
	return { tag, prefixWithoutShell: keepLead.trim() };
}

/** 提取片段开头的闭合 `</Tag>` */
function extractLeadingCloseShell(text: string, tag: string): string | null {
	const re = new RegExp(`^\\s*</${escapeReg(tag)}\\s*>\\s*`, "i");
	const m = re.exec(text);
	if (!m) return null;
	return text.slice(m[0].length).trim();
}

/** 消除跨越空 marker 占位符的配对空标签外壳（如 <dream_setting> ... [markers] ... </dream_setting>） */
function collapseEmptyMarkerShells(nodes: SeqNode[]): { nodes: SeqNode[]; collapsedCount: number } {
	const list = nodes.map((n) => ({ ...n }));
	let collapsedCount = 0;

	for (let pass = 0; pass < 8; pass++) {
		let changed = false;
		for (let i = 0; i < list.length; i++) {
			const cur = list[i]!;
			if (cur.kind !== "piece") continue;
			const openShell = extractTrailingOpenShell(cur.text);
			if (!openShell) continue;

			// 向后跨越 0 个或多个连续 skipped-marker 找下一个紧邻 piece
			let j = i + 1;
			while (j < list.length && list[j]!.kind === "skipped-marker") {
				j++;
			}
			if (j >= list.length) continue;
			const nextNode = list[j]!;
			if (nextNode.kind !== "piece" || nextNode.source !== cur.source) continue;

			const restAfterClose = extractLeadingCloseShell(nextNode.text, openShell.tag);
			if (restAfterClose === null) continue;

			cur.text = openShell.prefixWithoutShell;
			nextNode.text = restAfterClose;
			changed = true;
			collapsedCount++;
		}

		if (!changed) break;
		for (let k = list.length - 1; k >= 0; k--) {
			const n = list[k]!;
			if (n.kind === "piece" && !n.text.trim()) {
				list.splice(k, 1);
			}
		}
	}

	return { nodes: list, collapsedCount };
}

function resolveInjectedPlaceholder(text: string, ejsContext: EjsExecutionContext): string {
	if (!text.includes("outletPromptsInjected")) return text;
	return text.replace(/\{\{\s*outletPromptsInjected:([^}\s]+)\s*\}\}/gi, (_m, key: string) =>
		typeof ejsContext.getPromptsInjected === "function"
			? String((ejsContext.getPromptsInjected as (k: string) => string)(key) ?? "")
			: "",
	);
}

/**
 * 在标准梨园模式（`presetMode === "liyuan"`）下计算预设动态投影片段：
 * - 不填 7 个卡/世界书 marker；
 * - 跳过跨空 marker 壳与重复用户输入块；
 * - 剥除假工具协议暗号；
 * - 返回可传给 `buildStageSystemPrompt` 与 `applyHistoryInjections` 的 `PromptFragment[]`。
 */
export async function assembleLiyuanPresetDynamic(input: LiyuanPresetDynamicInput): Promise<LiyuanPresetDynamicResult> {
	const emptyResult = (fragments: PromptFragment[] = []): LiyuanPresetDynamicResult => ({
		fragments,
		dirtyLocal: {},
		dirtyGlobal: {},
		stats: {
			totalEnabled: 0,
			skippedMarkers: 0,
			skippedEmptyShells: 0,
			skippedLastUserOnly: 0,
			strippedFakeToolBlocks: 0,
			emittedFragments: fragments.length,
		},
	});

	const extFragments: PromptFragment[] = (input.extensionPrompts ?? []).filter((f) => f.text.trim().length > 0);
	const { presetDoc, card, userName } = input;
	if (!presetDoc) {
		return emptyResult(extFragments);
	}

	const allPool = input.allLoreEntries ?? [];
	const extractedPresetVars = presetDoc.raw ? extractAuthorScriptVariables(presetDoc.raw) : {};
	const effectivePresetVars = { ...extractedPresetVars, ...(input.presetVars ?? {}) };
	const effectiveInitialVars = { ...(findInitVar(allPool) ?? {}), ...(input.initialVars ?? {}) };
	const mergedChatVars: Record<string, unknown> = { ...effectivePresetVars, ...(input.chatVars ?? {}) };
	const globalVars: Record<string, unknown> = { ...(input.globalVars ?? {}) };

	const rawPrompts =
		presetDoc.raw && Array.isArray(presetDoc.raw.prompts)
			? (presetDoc.raw.prompts as Array<Record<string, unknown>>)
					.filter((p) => typeof p?.name === "string" && typeof p?.content === "string")
					.map((p) => ({ name: p.name as string, content: p.content as string }))
			: [];

	const ejsContext = createEjsContext({
		chatVars: mergedChatVars,
		globalVars,
		characterVars: input.characterVars,
		initialVars: effectiveInitialVars,
		allLoreEntries: allPool,
		presetPrompts: rawPrompts,
		charName: card.name,
		userName,
		charDescription: card.description,
		charPersonality: card.personality,
		charScenario: card.scenario,
		charMesExample: card.mesExample,
		chatId: input.chatId,
		model: input.model,
		messages: input.history.map((m) => ({ role: m.role, content: m.text })),
		runType: "generate",
	});

	const lastMessage = input.history.length > 0 ? input.history[input.history.length - 1]!.text : "";
	let lastCharMessage = "";
	for (let i = input.history.length - 1; i >= 0; i--) {
		if (input.history[i]!.role === "assistant") {
			lastCharMessage = input.history[i]!.text;
			break;
		}
	}

	const env = createMacroEnv({
		charName: card.name,
		userName,
		userText: LAST_USER_SENTINEL,
		lastMessage,
		lastCharMessage,
		vars: mergedChatVars,
		globalVars,
	});

	const entries: AssemblyEntry[] =
		presetDoc.kind === "st" ? stEntries(presetDoc.raw) : rpEntries(normalizeRpPreset(presetDoc.raw));
	const hints = extractProtocolHints(presetDoc.raw);

	let totalEnabled = 0;
	let skippedMarkers = 0;
	let skippedEmptyShells = 0;
	let skippedLastUserOnly = 0;
	let strippedFakeToolBlocks = 0;

	const seqNodes: SeqNode[] = [];
	const depthFrags: PromptFragment[] = [];
	let afterHistory = false;

	for (const e of entries) {
		if (!e.enabled || e.missing || e.identifier === "SPresetSettings") continue;
		totalEnabled++;

		if (e.marker || MARKER_SKIP_SET.has(e.identifier)) {
			if (e.identifier === "chatHistory") {
				afterHistory = true;
			} else {
				skippedMarkers++;
				seqNodes.push({ kind: "skipped-marker", id: e.identifier });
			}
			continue;
		}

		// 依次执行标准宏与 EJS 求值（不传卡 overrides，防止与 AGENTS.md / 卡注入重复）
		let text = evalPresetMacros(e.content, env).text;
		text = resolveInjectedPlaceholder(text, ejsContext);
		if (hasPromptTemplateSyntax(text)) {
			try {
				text = await evalEjsTemplate(text, ejsContext);
			} catch {
				/* EJS 异常不拖垮整拍 */
			}
		}

		if (!text.trim()) continue;

		const sanitized = sanitizeSinglePiece(text, hints);
		if (!sanitized.text) {
			if (sanitized.skippedReason === "last-user-only") skippedLastUserOnly++;
			else if (sanitized.skippedReason === "fake-tool-only" || sanitized.skippedReason === "delimiter") strippedFakeToolBlocks++;
			else skippedEmptyShells++;
			continue;
		}
		if (sanitized.text !== text.trim()) strippedFakeToolBlocks++;

		if (e.injectionPosition === 1) {
			depthFrags.push({
				id: e.identifier,
				placement: "depth",
				role: e.role,
				text: sanitized.text,
				depth: e.injectionDepth,
				order: e.injectionOrder,
			});
			continue;
		}

		seqNodes.push({
			kind: "piece",
			source: afterHistory ? "after" : "before",
			id: e.identifier,
			name: e.name,
			role: e.role,
			text: sanitized.text,
		});
	}

	const collapsed = collapseEmptyMarkerShells(seqNodes);
	skippedEmptyShells += collapsed.collapsedCount;

	const beforePieces = collapsed.nodes.filter((n): n is Extract<SeqNode, { kind: "piece" }> => n.kind === "piece" && n.source === "before");
	const afterPieces = collapsed.nodes.filter((n): n is Extract<SeqNode, { kind: "piece" }> => n.kind === "piece" && n.source === "after");

	const fragments: PromptFragment[] = [];
	let hitNonSystem = false;
	for (const p of beforePieces) {
		if (!hitNonSystem && p.role === "system") {
			fragments.push({
				id: p.id,
				placement: "system",
				role: "system",
				text: p.text,
			});
		} else {
			hitNonSystem = true;
			fragments.push({
				id: p.id,
				placement: "preHistory",
				role: p.role,
				text: p.text,
			});
		}
	}

	fragments.push(...depthFrags);

	for (let i = 0; i < afterPieces.length; i++) {
		const p = afterPieces[i]!;
		fragments.push({
			id: p.id,
			placement: "after",
			role: p.role,
			text: p.text,
			order: 1000 + i,
		});
	}

	for (const ef of extFragments) {
		fragments.push(ef);
	}

	// 只要本次投出了任何预设或扩展片段，就在 after 最末尾追加梨园最高优先级覆盖协议
	if (fragments.length > 0) {
		fragments.push(buildLiyuanOutputOverrideFragment());
	}

	const dirtyLocal: Record<string, string> = {};
	for (const k of env.dirtyLocal ?? []) {
		const v = env.vars.get(k);
		if (v !== undefined) dirtyLocal[k] = v;
	}
	const dirtyGlobal: Record<string, string> = {};
	for (const k of env.dirtyGlobal ?? []) {
		const v = env.globalVars.get(k);
		if (v !== undefined) dirtyGlobal[k] = v;
	}

	return {
		fragments,
		dirtyLocal,
		dirtyGlobal,
		stats: {
			totalEnabled,
			skippedMarkers,
			skippedEmptyShells,
			skippedLastUserOnly,
			strippedFakeToolBlocks,
			emittedFragments: fragments.length,
		},
	};
}
