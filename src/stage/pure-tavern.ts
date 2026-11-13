/**
 * 纯酒馆每轮动态提示词拼接器（第 3 步：1:1 复刻 SillyTavern 1.19.0 拼接流）。
 *
 * 设计原则：
 * - 不写任何磁盘 .md 文件，不注入任何梨园自有提示词（SYSTEM.md / APPEND_SYSTEM.md / AGENTS.md /
 *   【世界状态】【登场名录】【设定集索引】等均不参与）；
 * - 完整实现：世界书（卡内嵌 + 已挂载，不经梨园协议剥离）→ ST-Prompt-Template（@@preprocessing /
 *   @@if / getwi / activewi / EJS）→ 关键词扫描 → position 分桶（before / after / @D / EM / outlet）→
 *   8 个 marker 槽位与预设格式包装 → prompt_order 跨块宏求值（含持久 chat/global/preset 变量）→
 *   before 开头连续 system 与历史前消息切分 → 深度注入与 after 收尾。
 * - 纯函数、零 pi 依赖，供 StageEngine 与 CLI preset.preview 共用。
 */

import { applyCardSkin } from "../cardSkin.ts";
import type { DisplayRule } from "../cardfront.ts";
import { applyMacros } from "../card-macros.ts";
import { extractAuthorScriptVariables } from "../authorScripts.ts";
import {
	createEjsContext,
	evalEjsTemplate,
	evaluateDecoratorIf,
	hasPromptTemplateSyntax,
	parseWorldInfoDecorators,
	type EjsExecutionContext,
} from "../ejs-engine.ts";
import { constantEntries, scanEntries } from "../lorebook.ts";
import { findInitVar } from "../mvu.ts";
import { assemble, rpEntries, stEntries, type AssembledPiece, type AssembleResult } from "../preset-assemble.ts";
import type { PresetDoc } from "../preset-doc.ts";
import { createMacroEnv, evalPresetMacros, type MacroEnv } from "../preset-macro.ts";
import { normalizeRpPreset } from "../preset.ts";
import type { CharacterCard, LorebookEntry } from "../types.ts";
import { applyHistoryInjections, type HistoryInjectionMessage, type PromptFragment } from "./assemble.ts";

export interface PureTavernInput {
	card: CharacterCard;
	presetDoc: PresetDoc | null;
	/** 已合并且已应用 disabledLore 的世界书全集（含卡内嵌书 + 已挂载书，未经梨园剥离） */
	loreEntries: LorebookEntry[];
	/** 全部原始世界书条目池（含 enabled:false，供 EJS getwi/activewi 与 initvar 使用） */
	allLoreEntries?: LorebookEntry[];
	userName: string;
	userPersona: string;
	/** 经过 AI_OUTPUT promptOnly 正则清洗后的历史消息流（从旧到新） */
	history: Array<{ role: "user" | "assistant"; text: string }>;
	/** 本拍用户输入原文（无则空串） */
	userText: string;
	scanDepth: number;
	maxLoreInjections: number;
	chatId?: string;
	model?: string;
	chatVars?: Record<string, unknown>;
	globalVars?: Record<string, unknown>;
	characterVars?: Record<string, unknown>;
	presetVars?: Record<string, unknown>;
	initialVars?: Record<string, unknown>;
	/** 运行期临时片段（对应酒馆 setExtensionPrompt） */
	extensionPrompts?: PromptFragment[];
	/** 世界书送模正则（placement=5）与用户输入正则（placement=1） */
	worldInfoRegexRules?: DisplayRule[];
	userInputRegexRules?: DisplayRule[];
}

export interface PureTavernOpenAiMessage {
	role: "system" | "user" | "assistant";
	content: string;
	identifier?: string;
	name?: string;
}

export interface PureTavernResult {
	systemPrompt: string;
	messages: HistoryInjectionMessage[];
	/** 与酒馆 CHAT_COMPLETION_PROMPT_READY 完全同构的逐块消息数组（保留每块独立 role 与末尾预填） */
	rawOpenAiMessages: PureTavernOpenAiMessage[];
	samplers?: Record<string, number>;
	markers: AssembleResult["markers"];
	report: AssembleResult["report"];
	activatedLore: Array<{ uid: number; comment: string; position: number; chars: number }>;
	droppedPrefills: Array<{ id: string; name: string; chars: number }>;
	unsupportedMacros: string[];
	dirtyLocal: Record<string, string>;
	dirtyGlobal: Record<string, string>;
}

const formatWithPlaceholder = (template: string, value: string, placeholder: string): string => {
	if (!value.trim()) return "";
	if (!template.trim()) return value;
	return template.includes(placeholder) ? template.replaceAll(placeholder, value) : value;
};

async function evalTextWithEjsAndMacro(
	rawText: string,
	ejsContext: EjsExecutionContext,
	macroEnv: MacroEnv,
): Promise<string> {
	if (!rawText) return "";
	let text = rawText;
	if (hasPromptTemplateSyntax(text)) {
		try {
			text = await evalEjsTemplate(text, ejsContext);
		} catch {
			/* EJS 报错保留原文，不拖垮整拍拼接 */
		}
	}
	if (text.includes("{{")) {
		text = evalPresetMacros(text, macroEnv).text;
	}
	return text;
}

function resolveInjectedPlaceholder(text: string, ejsContext: EjsExecutionContext): string {
	if (!text.includes("outletPromptsInjected")) return text;
	return text.replace(/\{\{\s*outletPromptsInjected:([^}\s]+)\s*\}\}/gi, (_m, key: string) =>
		typeof ejsContext.getPromptsInjected === "function"
			? String((ejsContext.getPromptsInjected as (k: string) => string)(key) ?? "")
			: "",
	);
}

export async function assemblePureTavern(input: PureTavernInput): Promise<PureTavernResult> {
	const { card, presetDoc, userName, userPersona } = input;
	const allPool = input.allLoreEntries && input.allLoreEntries.length > 0 ? input.allLoreEntries : input.loreEntries;
	const extractedPresetVars = presetDoc?.raw ? extractAuthorScriptVariables(presetDoc.raw) : {};
	const effectivePresetVars = { ...extractedPresetVars, ...(input.presetVars ?? {}) };
	const effectiveInitialVars = { ...(findInitVar(allPool) ?? {}), ...(input.initialVars ?? {}) };
	const mergedChatVars: Record<string, unknown> = { ...effectivePresetVars, ...(input.chatVars ?? {}) };
	const globalVars: Record<string, unknown> = { ...(input.globalVars ?? {}) };

	const userInputRules = input.userInputRegexRules ?? [];
	const macroCtx = { charName: card.name, userName };
	const cleanedHistory = input.history.map((m) =>
		m.role === "user" && userInputRules.length > 0
			? { role: m.role, text: applyCardSkin(m.text, userInputRules, macroCtx) }
			: m,
	);
	const effectiveUserText =
		input.userText && userInputRules.length > 0
			? applyCardSkin(input.userText, userInputRules, macroCtx)
			: input.userText;

	const rawPrompts =
		presetDoc?.raw && Array.isArray(presetDoc.raw.prompts)
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
		messages: cleanedHistory.map((m) => ({ role: m.role, content: m.text })),
		runType: "generate",
	});

	const lastMessage = cleanedHistory.length > 0 ? cleanedHistory[cleanedHistory.length - 1]!.text : "";
	let lastCharMessage = "";
	for (let i = cleanedHistory.length - 1; i >= 0; i--) {
		if (cleanedHistory[i]!.role === "assistant") {
			lastCharMessage = cleanedHistory[i]!.text;
			break;
		}
	}

	// 1. 世界书预处理（@@preprocessing）与候选过滤（@@if / @@activate / @@dont_activate / 特殊条目）
	const preprocessedChunks: string[] = [];
	const precomputedLore = new Map<number, string>();
	for (let i = 0; i < input.loreEntries.length; i++) {
		const e = input.loreEntries[i]!;
		if (!e.enabled) continue;
		const dec = parseWorldInfoDecorators(e);
		if (!dec.isPreprocessing) continue;
		if (!(await evaluateDecoratorIf(dec.ifConditions, ejsContext))) {
			precomputedLore.set(i, "__SKIP__");
			continue;
		}
		try {
			const body = applyMacros(dec.cleanContent, macroCtx);
			const wrapped = dec.isPrivate ? `<% await (async()=>{ %>${body}<% })(); %>` : body;
			const out = (await evalEjsTemplate(wrapped, ejsContext)).trim();
			precomputedLore.set(i, out);
			if (out) preprocessedChunks.push(out);
		} catch {
			precomputedLore.set(i, dec.cleanContent);
		}
	}

	const effectiveLore: LorebookEntry[] = [];
	const precomputedByRef = new Map<LorebookEntry, string>();
	for (let i = 0; i < input.loreEntries.length; i++) {
		const e = input.loreEntries[i]!;
		const pre = precomputedLore.get(i);
		if (pre === "__SKIP__") continue;
		const dec = parseWorldInfoDecorators(e);
		if (dec.isSpecialEntry) continue;
		if (pre === undefined && !(await evaluateDecoratorIf(dec.ifConditions, ejsContext))) continue;
		const patched: LorebookEntry = {
			...e,
			...(dec.isForceActivate ? { constant: true, enabled: true } : {}),
			...(dec.isForceDeactivate ? { enabled: false } : {}),
		};
		effectiveLore.push(patched);
		if (pre !== undefined) precomputedByRef.set(patched, pre);
	}

	// 2. 合并常驻 + 绿灯扫描 + activewi 强制激活（按 order 升序）
	const baseWindowText = cleanedHistory
		.slice(-Math.max(1, input.scanDepth))
		.map((m) => m.text)
		.join("\n");
	const windowText = preprocessedChunks.length > 0 ? `${baseWindowText}\n${preprocessedChunks.join("\n")}` : baseWindowText;
	const constantList = constantEntries(effectiveLore);
	const greenList = scanEntries(effectiveLore, windowText, input.maxLoreInjections);
	const forceList = ejsContext.__forceActivatedEntries;
	const seenKey = new Set<string>();
	const activatedRaw: LorebookEntry[] = [];
	for (const e of [...constantList, ...greenList, ...forceList]) {
		const key = `${e.uid}:${e.content.trim()}`;
		if (seenKey.has(key)) continue;
		seenKey.add(key);
		activatedRaw.push(e);
	}
	activatedRaw.sort((a, b) => a.order - b.order);

	const loreMacroEnv = createMacroEnv({
		charName: card.name,
		userName,
		userText: effectiveUserText,
		lastMessage,
		lastCharMessage,
		vars: mergedChatVars,
		globalVars,
	});

	// 3. 编译世界书正文并按 ST position 分桶
	const wiBefore: string[] = [];
	const wiAfter: string[] = [];
	const wiAnTop: string[] = [];
	const wiAnBottom: string[] = [];
	const emTop: string[] = [];
	const emBottom: string[] = [];
	const wiDepthFragments: PromptFragment[] = [];
	const outletsMap = new Map<string, string>();
	const activatedLoreReport: PureTavernResult["activatedLore"] = [];
	const wiRegex = input.worldInfoRegexRules ?? [];

	for (const e of activatedRaw) {
		const dec = parseWorldInfoDecorators(e);
		let content = precomputedByRef.get(e);
		if (content === undefined) {
			const baseBody = applyMacros(dec.cleanContent, macroCtx);
			if (hasPromptTemplateSyntax(baseBody)) {
				try {
					const wrapped = dec.isPrivate ? `<% await (async()=>{ %>${baseBody}<% })(); %>` : baseBody;
					content = (await evalEjsTemplate(wrapped, ejsContext)).trim();
				} catch {
					content = dec.cleanContent;
				}
			} else {
				content = dec.cleanContent;
			}
		}
		if (content.includes("{{")) {
			content = evalPresetMacros(content, loreMacroEnv).text;
		}
		if (wiRegex.length > 0 && content) {
			content = applyCardSkin(content, wiRegex, macroCtx);
		}
		content = content.trim();
		if (!content) continue;

		const pos = typeof e.position === "number" ? e.position : 0;
		activatedLoreReport.push({ uid: e.uid, comment: e.comment, position: pos, chars: content.length });

		switch (pos) {
			case 0:
				wiBefore.push(content);
				break;
			case 1:
				wiAfter.push(content);
				break;
			case 2:
				wiAnTop.push(content);
				break;
			case 3:
				wiAnBottom.push(content);
				break;
			case 4:
				wiDepthFragments.push({
					id: `wi-depth-${e.uid}`,
					placement: "depth",
					role: e.role ?? "system",
					text: content,
					depth: Math.max(0, Math.trunc(e.depth ?? 4)),
					order: e.order ?? 100,
				});
				break;
			case 5:
				emTop.push(content);
				break;
			case 6:
				emBottom.push(content);
				break;
			case 7:
				if (e.outletName) {
					const prev = outletsMap.get(e.outletName);
					outletsMap.set(e.outletName, prev ? `${prev}\n${content}` : content);
				}
				break;
			default:
				wiAfter.push(content);
				break;
		}
	}

	// 4. 组装 8 个 marker 槽位（对齐 ST openai.js:1368-1380）
	const rawPreset = (presetDoc?.raw ?? {}) as Record<string, unknown>;
	const wiFormat = typeof rawPreset.wi_format === "string" ? rawPreset.wi_format : "{0}";
	const scenarioFormat = typeof rawPreset.scenario_format === "string" ? rawPreset.scenario_format : "";
	const personalityFormat = typeof rawPreset.personality_format === "string" ? rawPreset.personality_format : "";
	const newExampleChatPrompt =
		typeof rawPreset.new_example_chat_prompt === "string" ? rawPreset.new_example_chat_prompt : "[Example Chat]";

	const formatWi = (entriesText: string): string => {
		if (!entriesText.trim()) return "";
		const formatted = wiFormat.trim() ? formatWithPlaceholder(wiFormat, entriesText, "{0}") : entriesText;
		return formatted.includes("{{") ? evalPresetMacros(formatted, loreMacroEnv).text : formatted;
	};

	const worldInfoBefore = formatWi(wiBefore.join("\n"));
	const worldInfoAfter = formatWi([...wiAnTop, ...wiAfter, ...wiAnBottom].filter(Boolean).join("\n"));
	const charDescription = await evalTextWithEjsAndMacro(card.description, ejsContext, loreMacroEnv);
	const rawPersonality = await evalTextWithEjsAndMacro(card.personality, ejsContext, loreMacroEnv);
	const charPersonality = rawPersonality.trim()
		? await evalTextWithEjsAndMacro(
				formatWithPlaceholder(personalityFormat, rawPersonality, "{{personality}}"),
				ejsContext,
				loreMacroEnv,
			)
		: "";
	const rawScenario = await evalTextWithEjsAndMacro(card.scenario, ejsContext, loreMacroEnv);
	const scenario = rawScenario.trim()
		? await evalTextWithEjsAndMacro(
				formatWithPlaceholder(scenarioFormat, rawScenario, "{{scenario}}"),
				ejsContext,
				loreMacroEnv,
			)
		: "";
	const personaDescription = await evalTextWithEjsAndMacro(userPersona, ejsContext, loreMacroEnv);

	const rawMesExample = card.mesExample.trim()
		? card.mesExample.replace(/<START>/gi, newExampleChatPrompt).trim()
		: "";
	const dialogueExampleJoined = [...emTop, rawMesExample, ...emBottom].filter(Boolean).join("\n\n");
	const dialogueExamples = dialogueExampleJoined
		? await evalTextWithEjsAndMacro(dialogueExampleJoined, ejsContext, loreMacroEnv)
		: "";

	// 5. 运行预设装配（有预设跑 PromptManager 顺序与宏；无预设用 ST 默认顺序）
	let beforePieces: AssembledPiece[] = [];
	let afterPieces: AssembledPiece[] = [];
	let depthPieces: Array<AssembledPiece & { depth: number; order: number }> = [];
	let markers: AssembleResult["markers"] = [];
	let report: AssembleResult["report"] = [];
	const unsupportedSet = new Set<string>();
	const dirtyLocalRecord: Record<string, string> = {};
	const dirtyGlobalRecord: Record<string, string> = {};

	if (presetDoc) {
		const rawEntries =
			presetDoc.kind === "st" ? stEntries(presetDoc.raw) : rpEntries(normalizeRpPreset(presetDoc.raw));
		// SPresetSettings 是 SPreset 扩展配置容器，绝不当文本送给模型
		const entries = rawEntries.filter((e) => e.identifier !== "SPresetSettings");
		const hasEnabledJailbreak = entries.some(
			(e) => e.enabled && !e.marker && !e.missing && e.identifier === "jailbreak" && !e.forbidOverrides,
		);
		const assembled = assemble(entries, {
			materials: {
				worldInfoBefore,
				charDescription,
				charPersonality,
				scenario,
				worldInfoAfter,
				personaDescription,
				dialogueExamples,
			},
			charName: card.name,
			userName,
			userText: effectiveUserText,
			lastMessage,
			lastCharMessage,
			chatVars: loreMacroEnv.vars,
			globalVars: loreMacroEnv.globalVars,
			outlets: outletsMap,
			overrides: {
				...(card.systemPrompt.trim() ? { main: card.systemPrompt } : {}),
				...(card.postHistoryInstructions.trim() ? { jailbreak: card.postHistoryInstructions } : {}),
			},
		});

		const evalPieceText = async (text: string): Promise<string> => {
			let out = resolveInjectedPlaceholder(text, ejsContext);
			if (hasPromptTemplateSyntax(out)) {
				try {
					out = await evalEjsTemplate(out, ejsContext);
				} catch {
					/* keep macro result */
				}
			}
			return out;
		};

		beforePieces = await Promise.all(
			assembled.before.map(async (p) => ({
				...p,
				text: p.source === "block" ? await evalPieceText(p.text) : p.text,
			})),
		);
		afterPieces = await Promise.all(
			assembled.after.map(async (p) => ({
				...p,
				text: p.source === "block" ? await evalPieceText(p.text) : p.text,
			})),
		);
		depthPieces = await Promise.all(
			assembled.depth.map(async (p) => ({
				...p,
				text: p.source === "block" ? await evalPieceText(p.text) : p.text,
			})),
		);

		if (card.postHistoryInstructions.trim() && !hasEnabledJailbreak) {
			const phiText = await evalTextWithEjsAndMacro(card.postHistoryInstructions, ejsContext, loreMacroEnv);
			if (phiText.trim()) {
				afterPieces.unshift({
					source: "block",
					id: "card-post-history",
					name: "Post-History Instructions",
					role: "system",
					text: phiText,
				});
			}
		}

		markers = assembled.markers;
		report = assembled.report;
		for (const u of assembled.unsupported) unsupportedSet.add(u);
		for (const k of loreMacroEnv.dirtyLocal ?? []) {
			const v = assembled.vars.get(k);
			if (v !== undefined) dirtyLocalRecord[k] = v;
		}
		for (const k of assembled.dirtyLocal) {
			const v = assembled.vars.get(k);
			if (v !== undefined) dirtyLocalRecord[k] = v;
		}
		for (const k of loreMacroEnv.dirtyGlobal ?? []) {
			const v = assembled.globalVars.get(k);
			if (v !== undefined) dirtyGlobalRecord[k] = v;
		}
		for (const k of assembled.dirtyGlobal) {
			const v = assembled.globalVars.get(k);
			if (v !== undefined) dirtyGlobalRecord[k] = v;
		}
	} else {
		const pushIf = (id: string, name: string, text: string) => {
			if (text.trim()) beforePieces.push({ source: "marker", id, name, role: "system", text });
		};
		if (card.systemPrompt.trim()) {
			pushIf("main", "Main Prompt", await evalTextWithEjsAndMacro(card.systemPrompt, ejsContext, loreMacroEnv));
		}
		pushIf("worldInfoBefore", "World Info (before)", worldInfoBefore);
		pushIf("charDescription", "Char Description", charDescription);
		pushIf("charPersonality", "Char Personality", charPersonality);
		pushIf("scenario", "Scenario", scenario);
		pushIf("worldInfoAfter", "World Info (after)", worldInfoAfter);
		pushIf("personaDescription", "Persona Description", personaDescription);
		pushIf("dialogueExamples", "Chat Examples", dialogueExamples);
		if (card.postHistoryInstructions.trim()) {
			const phiText = await evalTextWithEjsAndMacro(card.postHistoryInstructions, ejsContext, loreMacroEnv);
			if (phiText.trim()) {
				afterPieces.push({
					source: "block",
					id: "card-post-history",
					name: "Post-History Instructions",
					role: "system",
					text: phiText,
				});
			}
		}
	}

	// 6. 拆分 before：开头连续 system 进 systemPrompt；首个非 system 及其之后落入历史最前方
	const systemParts: string[] = [];
	const preHistoryMessages: HistoryInjectionMessage[] = [];
	let hitNonSystem = false;
	for (const p of beforePieces) {
		const t = p.text.trim();
		if (!t) continue;
		if (!hitNonSystem && p.role === "system") {
			systemParts.push(t);
		} else {
			hitNonSystem = true;
			const mappedRole: "user" | "assistant" = p.role === "assistant" ? "assistant" : "user";
			const prev = preHistoryMessages[preHistoryMessages.length - 1];
			if (prev && prev.role === mappedRole) prev.text = `${prev.text}\n\n${t}`;
			else preHistoryMessages.push({ role: mappedRole, text: t });
		}
	}

	const extFrags = input.extensionPrompts ?? [];
	for (const f of extFrags) {
		if (f.placement === "system" && f.text.trim()) {
			systemParts.push(f.text.trim());
		}
	}

	// 7. 组装历史 + depth + after（无任何梨园包装块）
	const endsWithUser = cleanedHistory.length > 0 && cleanedHistory[cleanedHistory.length - 1]!.role === "user";
	const past = endsWithUser ? cleanedHistory.slice(0, -1) : cleanedHistory;
	const tailText = endsWithUser ? cleanedHistory[cleanedHistory.length - 1]!.text : "";

	const allFragments: PromptFragment[] = [
		...depthPieces.map((d) => ({
			id: d.id,
			placement: "depth" as const,
			role: d.role,
			text: d.text,
			depth: d.depth,
			order: d.order,
		})),
		...wiDepthFragments,
		...afterPieces.map((a) => ({
			id: a.id,
			placement: "after" as const,
			role: a.role,
			text: a.text,
		})),
		...extFrags.filter((f) => f.placement !== "system"),
	];

	// 观测记录末尾连续 assistant 预填（applyHistoryInjections 会安全丢弃以兼容推理模型）
	const droppedPrefills: PureTavernResult["droppedPrefills"] = [];
	const tailSequence: Array<{ id: string; name: string; role: "system" | "user" | "assistant"; text: string }> = [];
	if (tailText.trim()) {
		tailSequence.push({ id: "user-input", name: "User Input", role: "user", text: tailText });
	}
	for (const f of allFragments) {
		if (f.placement === "depth" && Math.max(0, Math.trunc(f.depth ?? 0)) === 0 && f.text.trim()) {
			tailSequence.push({ id: f.id, name: f.id, role: f.role, text: f.text });
		}
	}
	for (const f of allFragments) {
		if (f.placement === "after" && f.text.trim()) {
			tailSequence.push({ id: f.id, name: f.id, role: f.role, text: f.text });
		}
	}
	for (let i = tailSequence.length - 1; i >= 0; i--) {
		const item = tailSequence[i]!;
		if (item.role !== "assistant") break;
		droppedPrefills.unshift({ id: item.id, name: item.name, chars: item.text.length });
	}

	const timeline = applyHistoryInjections(past, tailText, allFragments, { tailHasUserMessage: endsWithUser });
	const messages: HistoryInjectionMessage[] = [];
	for (const msg of [...preHistoryMessages, ...timeline]) {
		const prev = messages[messages.length - 1];
		if (prev && prev.role === msg.role && !prev.isTail && !msg.isTail) {
			prev.text = `${prev.text}\n\n${msg.text}`;
		} else {
			messages.push({ ...msg });
		}
	}

	// 构造与酒馆原生 PromptManager 完全同构的逐块消息序列（保留原始 role 与末尾 assistant 预填，供浏览器管道与 SPreset 消费）
	const rawOpenAiMessages: PureTavernOpenAiMessage[] = [];
	for (const p of beforePieces) {
		const t = p.text.trim();
		if (t) rawOpenAiMessages.push({ role: p.role, content: t, identifier: p.id });
	}
	for (const f of extFrags) {
		if (f.placement === "system" && f.text.trim()) {
			rawOpenAiMessages.push({ role: f.role, content: f.text.trim(), identifier: f.id });
		}
	}
	// 历史 + depth 按酒馆倒数偏移插入（保持原始 role，同 depth/order 组按 assistant -> user -> system）
	const allDepth = allFragments.filter((f) => f.placement === "depth" && f.text.trim());
	const depthBySlot = new Map<number, Map<number, PromptFragment[]>>();
	const depthZeroRaw: PromptFragment[] = [];
	for (const f of allDepth) {
		const d = Math.max(0, Math.trunc(f.depth ?? 0));
		if (d === 0) {
			depthZeroRaw.push(f);
			continue;
		}
		const offset = endsWithUser ? d - 1 : d;
		const slot = Math.max(0, past.length - offset);
		const byDepth = depthBySlot.get(slot) ?? new Map<number, PromptFragment[]>();
		const list = byDepth.get(d) ?? [];
		list.push(f);
		byDepth.set(d, list);
		depthBySlot.set(slot, byDepth);
	}
	const pushRawDepthGroup = (items: PromptFragment[]) => {
		const orderMap = new Map<number, PromptFragment[]>();
		for (const item of items) {
			const ord = typeof item.order === "number" && Number.isFinite(item.order) ? item.order : 100;
			const bucket = orderMap.get(ord) ?? [];
			bucket.push(item);
			orderMap.set(ord, bucket);
		}
		const sortedOrders = [...orderMap.keys()].sort((a, b) => a - b);
		for (const ord of sortedOrders) {
			const group = orderMap.get(ord)!;
			for (const role of ["assistant", "user", "system"] as const) {
				const joined = group
					.filter((x) => x.role === role)
					.map((x) => x.text.trim())
					.filter(Boolean)
					.join("\n");
				if (joined) rawOpenAiMessages.push({ role, content: joined });
			}
		}
	};
	const pushRawSlot = (slot: number) => {
		const byDepth = depthBySlot.get(slot);
		if (!byDepth) return;
		for (const d of [...byDepth.keys()].sort((a, b) => b - a)) {
			pushRawDepthGroup(byDepth.get(d)!);
		}
	};
	for (let i = 0; i < past.length; i++) {
		pushRawSlot(i);
		rawOpenAiMessages.push({ role: past[i]!.role, content: past[i]!.text, name: past[i]!.role === "user" ? userName : card.name });
	}
	pushRawSlot(past.length);
	if (tailText.trim()) {
		rawOpenAiMessages.push({ role: "user", content: tailText, name: userName });
	}
	if (depthZeroRaw.length > 0) {
		pushRawDepthGroup(depthZeroRaw);
	}
	for (const f of allFragments) {
		if (f.placement === "after" && f.text.trim()) {
			rawOpenAiMessages.push({ role: f.role, content: f.text.trim(), identifier: f.id });
		}
	}

	return {
		systemPrompt: systemParts.join("\n\n"),
		messages,
		rawOpenAiMessages,
		samplers: presetDoc?.samplers,
		markers,
		report,
		activatedLore: activatedLoreReport,
		droppedPrefills,
		unsupportedMacros: [...unsupportedSet],
		dirtyLocal: dirtyLocalRecord,
		dirtyGlobal: dirtyGlobalRecord,
	};
}
