/**
 * 预设窄拆声明（docs/PLAN-PRESET-HARNESS-STRIP.md）：编译后全文 → 模型一次性声明站点
 * → 用户过目 → 按声明分流转译（身份→卡级 APPEND_SYSTEM.md，写作规则→卡档案 AGENTS.md，
 * 机制模拟段落成关闭条目，材料包装跳过）。
 *
 * 管线位置（2026-09-12 用户定序）：导入 JSON 原样复现 → 在预设块编辑器里拨开关（人称/基调/
 * 文风等选项就是块的 enabled）→ 保存 → 引擎 `assemble()` 按开关编译成一份提示词 → 本模块
 * 二次处理。选项在上游由引擎带开关重跑取得，本模块**不读未启用块、不手搓宏求值**。
 *
 * 三条规矩（窄拆法既定）：
 * - 判断权在模型（声明一次）＋用户（过目可改），落成看得见的数据；不建块名名单（铁律三）。
 * - 拿不准一律留（→ writing，进卡档案）；破限/身份一律 identity（不停用）。
 * - 末尾连续 assistant＝酒馆预填位，丢弃（8/23 定案；engine 同规则），不经声明。
 *
 * 纯函数 + 零模块级可变状态（jiti 二象性红线），可单测。
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { extractAuthorScriptVariables } from "./authorScripts.ts";
import { createEjsContext, evalEjsTemplate, hasPromptTemplateSyntax } from "./ejs-engine.ts";
import { getUiLocale } from "./i18n/index.ts";
import { assemble, type AssembledPiece, type AssembleReportItem, type AssembleResult, type DepthPiece } from "./preset-assemble.ts";
import { createMacroEnv, evalPresetMacros } from "./preset-macro.ts";
import type { PresetDoc } from "./preset-doc.ts";
import { PRESET_SOURCE_SUFFIX, formatEntry, stripEntriesWhere, uniqueEntryName } from "./prompt-entries.ts";

/** 站点闭集：每个站点带标签与去向（数据表，UI 与报告共用） */
export type DeclareStation = "identity" | "writing" | "thinking" | "draft" | "output" | "memory" | "wrapper";

const STATION_META: Record<DeclareStation, { label: string; dest: string }> = {
	identity: { label: "身份/破限", dest: "APPEND_SYSTEM.md" },
	writing: { label: "写作规则", dest: "卡档案 AGENTS.md" },
	thinking: { label: "思考协议", dest: "停用（原生思考＋agent 循环）" },
	draft: { label: "草稿协议", dest: "停用（稿纸工具）" },
	output: { label: "输出合约", dest: "停用（输出通道／MVU／面板）" },
	memory: { label: "记忆记账", dest: "停用（场记＋世界状态）" },
	wrapper: { label: "材料包装", dest: "跳过（装配器本职）" },
};

const STATION_META_EN: Record<DeclareStation, { label: string; dest: string }> = {
	identity: { label: "Identity / Jailbreak", dest: "APPEND_SYSTEM.md" },
	writing: { label: "Writing Rules", dest: "Card AGENTS.md" },
	thinking: { label: "Thinking Protocol", dest: "Disabled (native thinking + agent loop)" },
	draft: { label: "Draft Protocol", dest: "Disabled (draft tools)" },
	output: { label: "Output Contract", dest: "Disabled (output channel / MVU / panels)" },
	memory: { label: "Memory Bookkeeping", dest: "Disabled (scribe + world state)" },
	wrapper: { label: "Material Wrapper", dest: "Skipped (handled by assembler)" },
};

const STATIONS = Object.keys(STATION_META) as DeclareStation[];

export const isDeclareStation = (v: unknown): v is DeclareStation =>
	typeof v === "string" && (STATIONS as string[]).includes(v);

export interface DeclareEntry {
	identifier: string;
	name: string;
	role: "system" | "user" | "assistant";
	where: "before" | "after" | "depth";
	chars: number;
	station: DeclareStation;
	/** 用户在局部提示词中手动拨动的启停状态（覆盖站点默认启停） */
	enabled?: boolean;
	/** 编译片段指纹；只有实际声明且内容未变的条目才能复用 */
	sourceHash?: string;
	/** 模型给的一句理由（过目用，≤30 字） */
	note?: string;
}

export const presetDeclarationSlug = (name: string): string =>
	name.trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "preset";

export const presetDeclarationPath = (cwd: string, presetName: string): string =>
	join(cwd, "assets", "presets", ".liyuan", `预设声明-${presetDeclarationSlug(presetName)}.json`); // i18n-ignore：文件名协议

export interface PresetDeclaration {
	version: 1;
	preset: string;
	createdAt: string;
	/** 声明用的模型（留档；重声明会覆盖） */
	model?: string;
	entries: DeclareEntry[];
}

/** 装配结果里可声明的片段（非 marker；after 尾部连续 assistant 预填位除外） */
export interface DeclarePiece extends AssembledPiece {
	where: "before" | "after" | "depth";
}

/** 取可声明片段（编译文档序：历史前 → 历史后 → 深度注入） */
export function declarePieces(r: AssembleResult): DeclarePiece[] {
	let end = r.after.length;
	while (end > 0 && r.after[end - 1].role === "assistant") end--;
	return [
		...r.before.map((p) => ({ ...p, where: "before" as const })),
		...r.after.slice(0, end).map((p) => ({ ...p, where: "after" as const })),
		...r.depth.map((p) => ({ ...p, where: "depth" as const })),
	];
}

/** 声明与转译共用的装配入口（同一 AssembleResult，不另造规则） */
export const assembleForDeclare = (
	doc: PresetDoc,
	opts: { charName: string; userName: string },
): AssembleResult => assemble(doc.entries, opts);

const LAST_USER_MACRO_RE = /\{\{\s*lastusermessage\s*\}\}/i;

/**
 * 带 EJS 模板与脚本默认变量的异步装配（用于服务端/运行时声明与转译）：
 * 若预设不含 EJS 语法且无脚本默认变量，则直接走同步 `assemble`，输出逐字节一致。
 */
export async function assembleForDeclareWithEjs(
	doc: PresetDoc,
	opts: { charName: string; userName: string },
): Promise<AssembleResult> {
	const scriptVars = doc.raw ? extractAuthorScriptVariables(doc.raw) : {};
	const hasScriptVars = Object.keys(scriptVars).length > 0;
	const hasEjs = doc.entries.some((e) => e.enabled && !e.marker && hasPromptTemplateSyntax(e.content));
	if (!hasScriptVars && !hasEjs) {
		return assemble(doc.entries, opts);
	}

	const chatVars: Record<string, unknown> = { ...scriptVars };
	const globalVars: Record<string, unknown> = {};
	const rawPrompts =
		doc.raw && Array.isArray(doc.raw.prompts)
			? (doc.raw.prompts as Array<Record<string, unknown>>)
					.filter((p) => typeof p?.name === "string" && typeof p?.content === "string")
					.map((p) => ({ name: p.name as string, content: p.content as string }))
			: [];
	const ejsContext = createEjsContext({
		chatVars,
		globalVars,
		presetPrompts: rawPrompts,
		charName: opts.charName,
		userName: opts.userName,
		messages: [],
		runType: "generate",
	});
	const env = createMacroEnv({
		charName: opts.charName,
		userName: opts.userName,
		vars: chatVars,
		globalVars,
	});

	const syncToEjs = () => {
		for (const [k, v] of env.vars.entries()) chatVars[k] = v;
		for (const [k, v] of env.globalVars.entries()) globalVars[k] = v;
	};
	const syncFromEjs = () => {
		for (const [k, v] of Object.entries(chatVars)) {
			env.vars.set(k, typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
		}
		for (const [k, v] of Object.entries(globalVars)) {
			env.globalVars.set(k, typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
		}
	};

	const before: AssembledPiece[] = [];
	const after: AssembledPiece[] = [];
	const depth: DepthPiece[] = [];
	const markers: AssembleResult["markers"] = [];
	const report: AssembleReportItem[] = [];
	const unsupported = new Set<string>();
	const usesLastUserMessage: string[] = [];
	let afterHistory = false;

	for (const e of doc.entries) {
		if (e.missing) {
			report.push({ identifier: e.identifier, name: e.name, action: "缺失定义", chars: 0 });
			continue;
		}
		if (!e.enabled) {
			report.push({ identifier: e.identifier, name: e.name, action: "关闭", chars: e.content.length });
			continue;
		}
		if (e.marker) {
			if (e.identifier === "chatHistory") {
				afterHistory = true;
				markers.push({ id: e.identifier, enabled: true, filled: true });
			} else {
				markers.push({ id: e.identifier, enabled: true, filled: false });
			}
			report.push({
				identifier: e.identifier,
				name: e.name,
				action: e.identifier === "chatHistory" ? "marker 槽位" : "marker 无料",
				chars: 0,
			});
			continue;
		}

		if (LAST_USER_MACRO_RE.test(e.content)) usesLastUserMessage.push(e.identifier);
		syncFromEjs();
		const evaled = evalPresetMacros(e.content, env);
		for (const name of evaled.unsupported) unsupported.add(name);
		syncToEjs();

		let text = evaled.text;
		if (hasPromptTemplateSyntax(text)) {
			try {
				text = await evalEjsTemplate(text, ejsContext);
				syncFromEjs();
			} catch {
				/* EJS 异常不中断其余预设块声明 */
			}
		}

		if (text.trim().length === 0) {
			report.push({ identifier: e.identifier, name: e.name, action: "零字", chars: 0 });
			continue;
		}

		const piece: AssembledPiece = {
			source: "block",
			id: e.identifier,
			name: e.name,
			role: e.role,
			text,
		};
		if (e.injectionPosition === 1) {
			depth.push({ ...piece, depth: e.injectionDepth, order: e.injectionOrder });
			report.push({
				identifier: e.identifier,
				name: e.name,
				action: "深度注入",
				chars: text.length,
				depth: e.injectionDepth,
			});
			continue;
		}
		(afterHistory ? after : before).push(piece);
		report.push({
			identifier: e.identifier,
			name: e.name,
			action: afterHistory ? "历史后" : "历史前",
			chars: text.length,
		});
	}

	depth.sort((a, b) => a.depth - b.depth || a.order - b.order);
	return {
		before,
		after,
		depth,
		markers,
		unsupported: [...unsupported],
		vars: env.vars,
		globalVars: env.globalVars,
		dirtyLocal: [...(env.dirtyLocal ?? [])],
		dirtyGlobal: [...(env.dirtyGlobal ?? [])],
		usesLastUserMessage,
		report,
	};
}

/** 异步编译预设（含 EJS 与脚本变量求值，保留 {{char}}/{{user}} 占位供全局声明复用） */
export async function compilePresetWithEjs(doc: PresetDoc): Promise<AssembleResult> {
	return assembleForDeclareWithEjs(doc, { charName: CHAR_PLACEHOLDER, userName: USER_PLACEHOLDER });
}

// ---------------- 声明提示词（数据加工通道，非 RP 送模面） ----------------

const STATION_DEFINITIONS: Record<DeclareStation, string> = {
	identity:
		"设定「你是谁」：身份/人格/作家扮演、模型卡、破限信件/越狱声明、内容边界共识、反审查声明。只要包含身份或破限声明，即使混有思考步骤或标签规范，一律归入 identity 保留",
	writing:
		"正文写作与排版规则：文风、描写边界、禁词表、对白与转述、nsfw 准则、字数、剧情思考分析方法，以及正文/状态栏/选项/留言等展示格式。只要指导创作或读者可见排版，即使混有思考步骤或标签格式，一律归入 writing 保留",
	thinking:
		"仅限与多轮工具循环硬互斥的单轮禁令：强迫「只许思考或输出一次 / 严禁分轮或调用工具」的协议。常规思考步骤、剧情分析与思考引导保留为 writing 或 identity，绝不归此类",
	draft: "仅限强迫每自然段前插内联改稿仪式/禁止使用交稿工具的纯冲突指令；常规续写/正文引导归 writing",
	output:
		"仅限强迫调用虚构函数工具（如必须通过某假工具参数输出、严禁直接输出文本）或前端运行时接管协议；正常的正文包裹标签、选项、留言等排版规范保留归 writing",
	memory: "仅限要求每拍输出外部同步脚本命令或占用后台自动记账的纯冲突指令；其余归 writing",
	wrapper: "纯材料包装：跳过卡/历史槽位后仅剩的孤立开闭标签、分节标题、加载演出（如 [World Loading...]）",
};

const STATION_DEFINITIONS_EN: Record<DeclareStation, string> = {
	identity:
		"Defines who you are: identity/persona/author roleplay, model card, jailbreak letters/declarations, content boundary agreements, and anti-censorship framing. If a segment contains identity or jailbreak declarations, keep it as identity even if it mixes in thinking steps or tag specs.",
	writing:
		"Story prose and presentation rules: prose style, description guidelines, banned words, dialogue rules, NSFW guidelines, length, plot analysis/thinking guidance, and visible formatting (prose/status bars/choices/notes). Keep as writing even if it mixes in thinking steps or tag formats.",
	thinking:
		"Strictly single-turn prohibitions incompatible with a multi-turn tool loop: protocols that forbid multi-step reasoning or tool calls ('think/output only once'). Normal thinking steps, plot analysis, and thinking guidance stay in writing or identity.",
	draft:
		"Strictly conflicting directives forcing inline paragraph-by-paragraph drafting rituals or forbidding draft delivery tools; normal continuation/prose guidance stays in writing.",
	output:
		"Strictly directives forcing fake tool calls (e.g. must output via a fictional function argument and never output text) or frontend runtime takeover protocols; normal prose wrapper tags, choices, and formatting specs stay in writing.",
	memory:
		"Strictly conflicting directives requiring external sync script commands every turn or hijacking background bookkeeping; everything else stays in writing.",
	wrapper:
		"Pure structural wrappers left after removing card/history slots: orphan open/close tags, section headings, or loading theatrics (e.g. [World Loading...]).",
};

export function buildDeclarePrompt(
	pieces: DeclarePiece[],
	meta: { preset: string },
): { systemPrompt: string; userText: string } {
	const en = getUiLocale() === "en";
	const whereLabel = (w: DeclarePiece["where"]) =>
		en
			? (w === "before" ? "pre-history" : w === "after" ? "post-history" : "depth")
			: (w === "before" ? "历史前" : w === "after" ? "历史后" : "深度注入");
	const segments = pieces
		.map((p, i) => `⟦${i + 1}｜${p.role}｜${whereLabel(p.where)}｜${p.name}⟧\n${p.text}`)
		.join("\n\n");

	const systemPrompt = en
		? [
				"You analyze the structure of a roleplay preset. The input is the compiled sequence of prompt segments, each headed by ⟦index｜role｜position｜blockName⟧.",
				"",
				"Assign one station category to each segment using these criteria:",
				...STATIONS.map((s) => `- ${s}: ${STATION_DEFINITIONS_EN[s]} (destination: ${STATION_META_EN[s].dest})`),
				"",
				"Rules:",
				"- Jailbreaks, model cards, and identity declarations always go to identity (even if mixed with thinking steps or tag specs); do not trim or omit.",
				"- Story writing rules, normal thinking guidance, and visible formatting always go to writing; when in doubt, default to writing (conservative retention).",
				"- Only hard-conflicting single-turn / anti-tool / fake-tool takeover directives or pure empty structural wrappers should be disabled or skipped; never disable a segment merely for containing thinking guidance, model cards, or display tags.",
				"- Classify only; do not critique or rewrite segment content.",
				"",
				"Output a JSON array with one item per segment, where id is the integer segment index:",
				'[{"id":1,"station":"<category>","note":"<reason under 12 words>"}]',
			].join("\n")
		: [
				"你分析角色扮演预设的结构。输入是引擎编译后的分段提示词，每段头部为 ⟦编号｜角色｜位置｜块名⟧。",
				"",
				"给每个分段声明一个站点类别，判据：",
				...STATIONS.map((s) => `- ${s}：${STATION_DEFINITIONS[s]}（去向：${STATION_META[s].dest}）`),
				"",
				"规则：",
				"- 破限、模型卡与身份声明一律 identity（即使混有思考规划或标签说明也必须保留），不做取舍。",
				"- 正文写作规则、正常思考引导与展示排版格式一律 writing；拿不准的分段一律 writing（保守保留）。",
				"- 只有与多轮工具循环硬互斥的单轮/禁工具/假工具接管指令，或纯材料空包装才停用或跳过；绝不因分段包含思考引导、模型卡或展示标签而停用。",
				"- 只分类，不评价、不改写分段内容。",
				"",
				"输出 JSON 数组，id 为段头编号（整数），逐段一项：",
				'[{"id":1,"station":"<类别>","note":"<不超过20字的理由>"}]',
			].join("\n");

	const userText = en
		? [
				`Preset "${meta.preset}". Segments follow (⟦…⟧ header lines are delimiters, not part of segment text):`,
				"",
				`Total ${pieces.length} segments — output one entry per segment from 1 to ${pieces.length} without omitting any:`,
				"",
				segments,
			].join("\n")
		: [
				`预设「${meta.preset}」。分段内容如下（⟦…⟧ 标记行是分度信息，不属于分段正文）：`,
				"",
				`输入共 ${pieces.length} 个分段，请逐段输出，从 1 到 ${pieces.length}，不要遗漏：`,
				"",
				segments,
			].join("\n");

	return { systemPrompt, userText };
}

// ---------------- 响应解析（宽容；拿不准落 writing） ----------------

interface ParseDeclareResult {
	entries: DeclareEntry[];
	/** 模型实际声明了几个（对齐 pieces 后） */
	declared: number;
	/** 没被有效声明、按保守规则落 writing 的标识符 */
	defaulted: string[];
	/** 响应协议错误；不能当作成功声明留档 */
	errors: string[];
}

const extractJsonArray = (text: string): unknown[] | null => {
	const stripped = text.replace(/```(?:json)?/gi, "");
	const start = stripped.indexOf("[");
	const end = stripped.lastIndexOf("]");
	if (start < 0 || end <= start) return null;
	try {
		const v = JSON.parse(stripped.slice(start, end + 1));
		return Array.isArray(v) ? v : null;
	} catch {
		return null;
	}
};

export function declarePieceHash(piece: DeclarePiece): string {
	return createHash("sha256")
		.update(JSON.stringify(["block-v1", piece.id, piece.name, piece.role, piece.where, piece.text]))
		.digest("hex");
}

export function parseDeclareResponse(text: string, pieces: DeclarePiece[]): ParseDeclareResult {
	const raw = extractJsonArray(text);
	const errors: string[] = raw ? [] : ["响应不是有效 JSON 数组"];
	const expected = new Set(pieces.map((p) => p.id));
	const byId = new Map<string, { station: DeclareStation; note?: string; enabled?: boolean }>();
	const seen = new Set<string>();

	for (const item of raw ?? []) {
		if (!item || typeof item !== "object") {
			errors.push("声明项不是对象");
			continue;
		}
		const o = item as Record<string, unknown>;
		// 鲁棒 ID 解析：支持整数 1..N、字符串 "片段N" / "N"、以及原 UUID/标识符
		let id: string | undefined;
		if (typeof o.id === "number" && Number.isInteger(o.id) && o.id >= 1 && o.id <= pieces.length) {
			id = pieces[o.id - 1]?.id;
		} else if (typeof o.id === "string") {
			const m = o.id.trim().match(/^(?:片段\s*)?(\d+)$/);
			if (m) {
				const idx = parseInt(m[1], 10);
				if (idx >= 1 && idx <= pieces.length) id = pieces[idx - 1]?.id;
			} else if (expected.has(o.id)) {
				id = o.id;
			}
		} else if (typeof o.identifier === "string" && expected.has(o.identifier)) {
			id = o.identifier;
		}

		if (!id || !expected.has(id)) {
			errors.push(`未知声明编号：${String(o.id ?? o.identifier)}`);
			continue;
		}
		if (seen.has(id)) {
			byId.delete(id);
			errors.push(`重复声明：${id}`);
			continue;
		}
		seen.add(id);
		if (!isDeclareStation(o.station)) {
			errors.push(`无效站点：${id}`);
			continue;
		}
		byId.set(id, {
			station: o.station,
			note: typeof o.note === "string" ? o.note.slice(0, 60) : undefined,
			...(typeof o.enabled === "boolean" ? { enabled: o.enabled } : {}),
		});
	}

	const entries: DeclareEntry[] = [];
	const defaulted: string[] = [];
	for (const p of pieces) {
		const hit = byId.get(p.id);
		if (!hit) defaulted.push(p.id);
		entries.push({
			identifier: p.id,
			name: p.name,
			role: p.role,
			where: p.where,
			chars: p.text.length,
			station: hit?.station ?? "writing",
			note: hit?.note,
			...(typeof hit?.enabled === "boolean" ? { enabled: hit.enabled } : {}),
			...(hit ? { sourceHash: declarePieceHash(p) } : {}),
		});
	}
	return { entries, declared: entries.length - defaulted.length, defaulted, errors };
}

interface DeclareAttempt {
	ids: string[];
	response?: string;
	error?: string;
	declared: number;
	defaulted: string[];
	errors: string[];
}

type DeclareText = (
	systemPrompt: string,
	userText: string,
	opts: { maxTokens: number; reasoning: "off"; signal: AbortSignal },
) => Promise<string | { error: string }>;

/** 一次声明；协议缺项只补问一次。只返回模型有效声明，保守兜底绝不进入成功缓存。 */
export async function runPresetDeclaration(
	pieces: DeclarePiece[],
	meta: { preset: string },
	runText: DeclareText,
): Promise<{ entries: DeclareEntry[]; pending: string[]; attempts: DeclareAttempt[]; error?: string }> {
	const known = new Map<string, DeclareEntry>();
	const attempts: DeclareAttempt[] = [];
	const signal = AbortSignal.timeout(600_000);
	let error: string | undefined;

	for (let n = 0; n < 2; n++) {
		const missing = pieces.filter((p) => !known.has(p.id));
		if (!missing.length) break;
		const prompt = buildDeclarePrompt(missing, meta);
		let response: string | { error: string };
		try {
			response = await runText(prompt.systemPrompt, prompt.userText, { maxTokens: 16384, reasoning: "off", signal });
		} catch (e) {
			response = { error: e instanceof Error ? e.message : String(e) };
		}
		if (typeof response !== "string") {
			error = response.error;
			attempts.push({ ids: missing.map((p) => p.id), error, declared: 0, defaulted: missing.map((p) => p.id), errors: [] });
			break; // 网络/额度错误交回既有退避，不立即重烧一次。
		}
		const parsed = parseDeclareResponse(response, missing);
		attempts.push({ ids: missing.map((p) => p.id), response, declared: parsed.declared, defaulted: parsed.defaulted, errors: parsed.errors });
		if (!parsed.errors.length) {
			for (const e of parsed.entries) if (e.sourceHash) known.set(e.identifier, e);
		}
		error = parsed.errors.join("；") || (parsed.defaulted.length ? `缺少 ${parsed.defaulted.length} 段有效声明` : undefined);
	}
	const pending = pieces.filter((p) => !known.has(p.id)).map((p) => p.id);
	return { entries: [...known.values()], pending, attempts, ...(pending.length ? { error: error ?? "声明未完成" } : {}) };
}

/** 用户过目后的声明同样走这里归一（改错的站别落 writing，多余的条目忽略） */
export function normalizeDeclaration(
	declaration: PresetDeclaration,
	pieces: DeclarePiece[],
): PresetDeclaration {
	const parsed = parseDeclareResponse(JSON.stringify(declaration.entries), pieces);
	return { ...declaration, version: 1, entries: parsed.entries };
}

// ---------------- 按声明分流转译 ----------------

/**
 * 转译产物形态：**逐块条目，不合并**——每个编译后片段一条 `## 块名（预设）` 条目
 * （标题后缀＝来源标注，见 prompt-entries.ts；条目视图剥掉显示、挂徽标）。
 * - 身份块 → 卡级 APPEND_SYSTEM.md（`# 预设提示词` 下，活动条目）
 * - 写作块 → 卡档案 AGENTS.md（平级活动条目，不设伞形板块）
 * - 停用的机制块（思考/草稿/输出/记忆）→ AGENTS.md 里 **HTML 注释包裹的关闭条目**——
 *   送模零成本，条目视图里看得见、想要哪段拨开即可——停用是可见可逆的数据，不是消失
 * - 材料包装 → 跳过
 */
interface DeclareLineItem {
	identifier: string;
	name: string;
	chars: number;
	action:
		| "append"
		| "agents"
		| "disabled"
		| "wrapper"
		| "skipped-marker"
		| "skipped-disabled"
		| "skipped-empty"
		| "dropped-prefill";
	station?: DeclareStation;
	note?: string;
}

interface DeclareTranslateResult {
	/** 卡级 APPEND_SYSTEM.md 追加段（`# 预设提示词` ＋ 身份条目；无身份块则空串） */
	appendMarkdown: string;
	/** 卡档案 AGENTS.md 追加段（写作条目＋关闭的机制条目；无则空串） */
	agentsSection: string;
	lines: DeclareLineItem[];
	samplers: Record<string, number>;
	usesLastUserMessage: string[];
	unsupportedMacros: string[];
}

export function translatePresetWithDeclaration(
	doc: PresetDoc,
	declaration: PresetDeclaration,
	opts: { charName: string; userName: string },
): DeclareTranslateResult {
	const r = assemble(doc.entries, { charName: opts.charName, userName: opts.userName });
	return translateFromAssembled(doc, r, declaration);
}

export async function translatePresetWithDeclarationAsync(
	doc: PresetDoc,
	declaration: PresetDeclaration,
	opts: { charName: string; userName: string },
): Promise<DeclareTranslateResult> {
	const r = await assembleForDeclareWithEjs(doc, { charName: opts.charName, userName: opts.userName });
	return translateFromAssembled(doc, r, declaration);
}

function translateFromAssembled(
	doc: PresetDoc,
	r: AssembleResult,
	declaration: PresetDeclaration,
): DeclareTranslateResult {
	const pieces = declarePieces(r);
	const norm = normalizeDeclaration(declaration, pieces);
	const stationOf = new Map(norm.entries.map((e) => [e.identifier, e]));

	const appendNames = new Set<string>();
	const agentsNames = new Set<string>();
	const appendEntries: string[] = [];
	const agentsEntries: string[] = [];
	const lines: DeclareLineItem[] = [];

	for (const p of pieces) {
		const e = stationOf.get(p.id);
		const station = e?.station ?? "writing";
		const item: DeclareLineItem = {
			identifier: p.id,
			name: p.name,
			chars: p.text.length,
			action: "agents",
			station,
			note: e?.note,
		};
		if (station === "wrapper") {
			item.action = "wrapper";
		} else if (station === "identity") {
			const enabled = e?.enabled ?? true;
			appendEntries.push(formatEntry(uniqueEntryName(p.name, PRESET_SOURCE_SUFFIX, appendNames), p.text, enabled));
			item.action = enabled ? "append" : "disabled";
		} else if (station === "writing") {
			const enabled = e?.enabled ?? true;
			agentsEntries.push(formatEntry(uniqueEntryName(p.name, PRESET_SOURCE_SUFFIX, agentsNames), p.text, enabled));
			item.action = enabled ? "agents" : "disabled";
		} else {
			const enabled = e?.enabled ?? false;
			agentsEntries.push(formatEntry(uniqueEntryName(p.name, PRESET_SOURCE_SUFFIX, agentsNames), p.text, enabled));
			item.action = enabled ? "agents" : "disabled";
		}
		lines.push(item);
	}

	// 预填位丢弃
	let end = r.after.length;
	while (end > 0 && r.after[end - 1].role === "assistant") end--;
	for (const p of r.after.slice(end)) {
		lines.push({ identifier: p.id, name: p.name, chars: p.text.length, action: "dropped-prefill" });
	}
	// 非片段去向（marker / 关闭 / 零字 / 缺失）——关闭的块是上游开关的结果，只入账不取内容
	for (const item of r.report) {
		if (pieces.some((p) => p.id === item.identifier)) continue;
		if (item.action === "marker 槽位" || item.action === "marker 无料") {
			if (item.identifier === "chatHistory") continue;
			lines.push({ identifier: item.identifier, name: item.name, chars: item.chars, action: "skipped-marker" });
		} else if (item.action === "关闭") {
			lines.push({ identifier: item.identifier, name: item.name, chars: item.chars, action: "skipped-disabled" });
		} else if (item.action === "零字" || item.action === "缺失定义") {
			lines.push({ identifier: item.identifier, name: item.name, chars: item.chars, action: "skipped-empty" });
		}
	}

	// 产物只有条目，不夹备注行：来源在标题后缀里、去向在转译报告里；
	// 单行 <!-- --> 不是条目引擎认的块注释，会混进上一条正文送模，重转译也剥不掉。
	const appendMarkdown =
		appendEntries.length === 0
			? ""
			: [`# 预设提示词${PRESET_SOURCE_SUFFIX}`, ``, ...appendEntries].join("\n");

	const agentsSection = agentsEntries.length === 0 ? "" : agentsEntries.join("\n");

	return {
		appendMarkdown,
		agentsSection,
		lines,
		samplers: { ...doc.samplers },
		usesLastUserMessage: r.usesLastUserMessage,
		unsupportedMacros: r.unsupported,
	};
}

/** 从现有全文剥掉所有预设来源条目（含关闭态）——重转译幂等的前半步；没有可剥的原样返回 */
export function stripPresetEntries(md: string): string {
	return stripEntriesWhere(md, (e) => e.source?.kind === "preset");
}

// ---------------- 报告 ----------------

const DECLARE_ACTION_LABEL: Record<DeclareLineItem["action"], string> = {
	append: "收入 APPEND_SYSTEM.md（身份/破限，活动条目）",
	agents: "收入卡档案（写作规则，活动条目）",
	disabled: "停用（卡档案里的关闭条目，可拨开）",
	wrapper: "跳过（装配器本职）",
	"skipped-marker": "跳过（槽位）",
	"skipped-disabled": "未启用（预设开关关着）",
	"skipped-empty": "无正文",
	"dropped-prefill": "丢弃（预填位，8/23 定案）",
};

const DECLARE_ACTION_LABEL_EN: Record<DeclareLineItem["action"], string> = {
	append: "Added to APPEND_SYSTEM.md (identity/jailbreak, active entry)",
	agents: "Added to card AGENTS.md (writing rules, active entry)",
	disabled: "Disabled (toggled-off entry in AGENTS.md; can be re-enabled)",
	wrapper: "Skipped (handled by assembler)",
	"skipped-marker": "Skipped (marker slot)",
	"skipped-disabled": "Disabled in preset",
	"skipped-empty": "Empty content",
	"dropped-prefill": "Dropped (prefill slot)",
};

export function declareTranslateReport(
	doc: PresetDoc,
	r: DeclareTranslateResult,
	declaration: PresetDeclaration,
	sourceFile: string,
): string {
	const en = getUiLocale() === "en";
	const count = (a: DeclareLineItem["action"]) => r.lines.filter((l) => l.action === a).length;
	if (en) {
		const head = [
			`# Translation Report: ${doc.name} (Narrow Split)`,
			``,
			`- Source: \`${sourceFile}\` (untouched; can be re-translated)`,
			`- Date: ${declaration.createdAt}${declaration.model ? `; Declaration model: ${declaration.model}` : ""}`,
			`- Output 1: Card APPEND_SYSTEM.md (${count("append")} identity entries, ${r.appendMarkdown.length.toLocaleString()} chars)`,
			`- Output 2: Card AGENTS.md (${count("agents")} writing entries + ${count("disabled")} disabled protocol entries, ${r.agentsSection.length.toLocaleString()} chars total; disabled entries are excluded from prompts)`,
			`- Disabled preset blocks: ${count("skipped-disabled")} (toggle them on in the preset editor, save, and re-translate to include)`,
			`- Sampler parameters: ${Object.keys(r.samplers).length} migrated to config.samplers`,
		];
		if (r.usesLastUserMessage.length > 0) {
			head.push(`- ⚠ Blocks referencing {{lastusermessage}} (per-turn macro, evaluated as empty during translation): ${r.usesLastUserMessage.join(", ")}`);
		}
		if (r.unsupportedMacros.length > 0) {
			head.push(`- ⚠ Unsupported macros (kept verbatim): ${r.unsupportedMacros.join(", ")}`);
		}
		head.push(``, `## Block Routing`, ``);
		const rows = r.lines.map((l) => {
			const station = l.station ? ` (${STATION_META_EN[l.station].label})` : "";
			const note = l.note ? ` — ${l.note}` : "";
			return `- ${l.name || l.identifier} · ${l.chars.toLocaleString()} chars: ${DECLARE_ACTION_LABEL_EN[l.action]}${station}${note}`;
		});
		const tail = [
			``,
			`## Known Trade-Offs`,
			``,
			`- Multi-role jailbreak letter pairs are flattened into file quotes after translation, preserving meaning while softening turn-role framing.`,
			`- Disabling conflicting output contracts stops preset-driven status bars/choices where Liyuan handles them via MVU/panels/ask; card-native output formats remain unaffected.`,
			`- Declaration cache: assets/presets/.liyuan/预设声明-*.json (shared globally; editable before re-translating).`,
		];
		return [...head, ...rows, ...tail, ""].join("\n");
	}
	const head = [
		`# 转译报告：${doc.name}（窄拆）`,
		``,
		`- 原文：\`${sourceFile}\`（未改动，可重新转译）`,
		`- 日期：${declaration.createdAt}${declaration.model ? `；声明模型：${declaration.model}` : ""}`,
		`- 产物一：本卡 APPEND_SYSTEM.md（${count("append")} 条身份条目，${r.appendMarkdown.length.toLocaleString()} 字）`,
		`- 产物二：本卡 AGENTS.md（写作条目 ${count("agents")} 条＋关闭的机制条目 ${count("disabled")} 条，共 ${r.agentsSection.length.toLocaleString()} 字；关闭条目不进送模）`,
		`- 预设开关关着的块：${count("skipped-disabled")} 块（要它们就在预设编辑器里打开、保存、重新转译）`,
		`- 采样参数：${Object.keys(r.samplers).length} 项 → 已迁入 config.samplers`,
	];
	if (r.usesLastUserMessage.length > 0) {
		head.push(`- ⚠ 引用 {{lastusermessage}} 的块（逐拍宏，转译按空串求值）：${r.usesLastUserMessage.join("、")}`);
	}
	if (r.unsupportedMacros.length > 0) {
		head.push(`- ⚠ 清单外宏（原样保留在文本里）：${r.unsupportedMacros.join("、")}`);
	}
	head.push(``, `## 逐块去向`, ``);
	const rows = r.lines.map((l) => {
		const station = l.station ? `（${STATION_META[l.station].label}）` : "";
		const note = l.note ? `——${l.note}` : "";
		return `- ${l.name || l.identifier} · ${l.chars.toLocaleString()} 字：${DECLARE_ACTION_LABEL[l.action]}${station}${note}`;
	});
	const tail = [
		``,
		`## 已知代价（窄拆既定，不当 bug 查）`,
		``,
		`- 破限信件对原是带角色的消息（模型见「自己已答应」），转译后拍平为文件内引文，结构弱化、语义保留。`,
		`- 停输出合约后，靠预设教模型吐状态栏/选项的卡会停止吐——梨园里这是预期行为（MVU/面板/ask 接管）；卡自带的输出格式不受影响。`,
		`- 声明草稿留档：assets/presets/.liyuan/预设声明-*.json（全局一份，可改后重新转译）。`,
	];
	return [...head, ...rows, ...tail, ""].join("\n");
}

// ================================================================================
// 机制二：模型处理（2026-09-14 用户定案——与声明机制并存、按预设自选，大预设专用）
//
// 与声明机制的差别：模型不只发站名小标签，而是读整份拼接后的酒馆提示词，把有效内容
// **合并重组**成两份正文（身份实质不丢、写作合并去重），机制段丢弃报账。代价：分钟级
// （输出几千字）vs 声明的 30 秒。产物两条固定名条目，无逐块形态。
// ================================================================================

/** 拼接时 char/user 以占位符身份代入：引擎同一条求值路径，产物自然保留占位符（落盘再按卡求值） */
const CHAR_PLACEHOLDER = "{{char}}";
const USER_PLACEHOLDER = "{{user}}";

/** 引擎按开关编译整份预设（setvar/getvar 照常解，char/user 留占位） */
export function compilePreset(doc: PresetDoc): AssembleResult {
	return assemble(doc.entries, { charName: CHAR_PLACEHOLDER, userName: USER_PLACEHOLDER });
}

/** 编译结果里交给处理模型的片段（非 marker；after 尾部连续 assistant＝预填位除外，8/23 定案） */
interface CompiledPiece extends AssembledPiece {
	where: "before" | "after" | "depth";
}

export function compiledPieces(r: AssembleResult): CompiledPiece[] {
	let end = r.after.length;
	while (end > 0 && r.after[end - 1].role === "assistant") end--;
	return [
		...r.before.map((p) => ({ ...p, where: "before" as const })),
		...r.after.slice(0, end).map((p) => ({ ...p, where: "after" as const })),
		...r.depth.map((p) => ({ ...p, where: "depth" as const })),
	];
}

interface DroppedItem {
	name: string;
	reason: string;
}

/** 原文指纹：名字＋整份 raw（开关、内容、顺序任何变化都会变） */
export function presetFingerprint(doc: PresetDoc): string {
	return createHash("sha1").update(JSON.stringify({ name: doc.name, raw: doc.raw })).digest("hex");
}

/** 处理提示词（数据加工通道，非 RP 送模面）。正文走标签段——长中文正文塞 JSON 字符串必撞不转义引号/裸换行（实弹两连败坐实）。 */
export function buildProcessPrompt(
	pieces: CompiledPiece[],
	meta: { preset: string },
): { systemPrompt: string; userText: string } {
	const en = getUiLocale() === "en";
	const whereLabel = (w: CompiledPiece["where"]) =>
		en
			? (w === "before" ? "pre-history" : w === "after" ? "post-history" : "depth")
			: (w === "before" ? "历史前" : w === "after" ? "历史后" : "深度注入");
	const segments = pieces
		.map(
			(p, i) =>
				`⟦${en ? `Segment ${i + 1}` : `片段${i + 1}`}｜${p.id}｜${p.role}｜${whereLabel(p.where)}｜${p.name}⟧\n${p.text}`,
		)
		.join("\n\n");

	const systemPrompt = en
		? [
				"You process a roleplay preset. The input is the linear prompt compiled by the engine with the user's toggles, split into source blocks headed by ⟦segment｜id｜role｜position｜blockName⟧.",
				"",
				"Compile the effective content into two outputs:",
				"- identity: identity and persona setup, author roleplay, jailbreak letters, content boundary agreements. Keep **every substantive detail intact**: you may deduplicate and smooth transitions, but never summarize, abridge, or soften. Preserve request/reply structure for letter pairs.",
				"- writing: prose writing rules (style, description boundaries, banned words, dialogue/narration rules, NSFW guidelines, length targets). Merge and reorganize into a coherent rule set without cross-block duplicates.",
				"",
				"Drop directly (exclude from outputs, but account for in dropped):",
				"- Thinking protocols (thinking templates, reasoning-length quotas, self-checklists, chain-of-thought rituals)",
				"- Drafting protocols (paragraph-by-paragraph drafting, rehearsal notes, inline edit rituals)",
				"- Output contracts (forced block ordering, wrapper tags, per-turn status-bar/choice/summary appendages)",
				"- Memory bookkeeping (custom memory systems asking for per-turn summary/key-fact output)",
				"- Structural wrappers (open/close tags around content slots, section dividers, loading theatrics)",
				"- Clauses contradicted or excluded by selected toggles",
				"",
				"Rules:",
				"- Use only material present in the input; do not invent new rules or requirements.",
				"- Keep {{char}} and {{user}} placeholders verbatim.",
				"- Omit an output section entirely if nothing belongs in it.",
				"",
				"Output the following three tagged sections with tag lines on their own lines and no commentary outside the tags:",
				"",
				"<identity>",
				"(Identity & jailbreak text, normal line breaks)",
				"</identity>",
				"",
				"<writing>",
				"(Writing rules text, normal line breaks)",
				"</writing>",
				"",
				"<dropped>",
				"- Segment name or brief description — reason under 12 words",
				"</dropped>",
			].join("\n")
		: [
				"你处理一份角色扮演预设。输入是它经引擎按用户选项编译后的线性提示词，已按来源块切成分段，每段头部带 ⟨标识符｜角色｜位置｜块名⟩ 标记行。",
				"",
				"把有效内容加工成两份产物：",
				"- identity：身份与人格设定、作家扮演、破限信件、内容边界共识。此类内容**实质一字不丢**：可合并重复、调整衔接，不可摘要、不可删减、不可软化。信件对保留「来信—回信」的结构。",
				"- writing：指导写正文的规则：文风、描写边界、禁词表、对白与转述规则、nsfw 准则、字数要求。合并重组为一段连贯的规则，去掉段与段之间重复的条目。",
				"",
				"直接丢弃，不进产物，但要列入 dropped 报账：",
				"- 思考协议（思考模板、思考量要求、自检清单、思维链仪式）",
				"- 草稿协议（分段草稿、排练注释、改稿仪式）",
				"- 输出合约（格式模块顺序、正文包裹标签、状态栏/选项/摘要等每拍附加输出规格）",
				"- 记忆记账（要求每拍输出摘要/关键记忆供留存的自建记忆系统）",
				"- 材料包装（包裹内容槽位的开闭标签、分节标题、加载演出）",
				"- 与已选选项相斥或被排除的内容",
				"",
				"规矩：",
				"- 原料只用输入里的内容，不发明新规则、不添加新要求。",
				"- {{char}}/{{user}} 保持占位符原样，不代入具体名字。",
				"- 某份产物没有可归入的内容就整段省略。",
				"",
				"输出以下三段，标签行独占一行，标签外不要任何说明文字：",
				"",
				"<identity>",
				"（身份与破限正文，正常分行书写）",
				"</identity>",
				"",
				"<writing>",
				"（写作规则正文，正常分行书写）",
				"</writing>",
				"",
				"<dropped>",
				"- 分段名或内容简述——不超过20字的理由",
				"</dropped>",
			].join("\n");

	const userText = en
		? [
				`Preset "${meta.preset}". Segments follow (⟦…⟧ header lines are delimiters, not part of segment text):`,
				"",
				segments,
			].join("\n")
		: [
				`预设「${meta.preset}」。分段内容如下（⟦…⟧ 标记行是分度信息，不属于分段正文）：`,
				"",
				segments,
			].join("\n");

	return { systemPrompt, userText };
}

interface ParsedProcess {
	identity: string;
	writing: string;
	dropped: DroppedItem[];
}

/**
 * 模型输出的 JSON 高频病（2026-09-14 实弹坐实）：① 多行正文直接裸换行写进字符串字面量；
 * ② 字符串内裸双引号不转义（如 `爱用"～""呢"`）。③ 尾逗号（`[…,]`）一并修掉。
 * 按字符扫描一遍同修：字符串内的裸控制字符转义；引号用**结构前瞻**判定——后随（跳过空白）
 * `,` `}` `]` `:` 或到末尾才是字符串终点，否则是内嵌引号、转义掉。其余字节原样。
 */
function repairJsonStringLiterals(s: string): string {
	const isStructural = (c: string | undefined): boolean =>
		c === "," || c === "}" || c === "]" || c === ":" || c === undefined;
	const isWs = (c: string | undefined): boolean => c === " " || c === "\n" || c === "\r" || c === "\t";
	let out = "";
	let inStr = false;
	let pending = ""; // 字符串外挂起的 `,` 与其后空白——真正落笔前先看下一字符是不是 }/]（尾逗号）
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (inStr) {
			if (c === "\\") {
				out += c + (s[i + 1] ?? "");
				i++;
				continue;
			}
			if (c === '"') {
				let j = i + 1;
				while (j < s.length && isWs(s[j])) j++;
				if (isStructural(s[j])) {
					inStr = false;
					out += c;
				} else {
					out += '\\"';
				}
				continue;
			}
			const code = s.charCodeAt(i);
			if (code < 0x20) {
				out += code === 10 ? "\\n" : code === 13 ? "\\r" : code === 9 ? "\\t" : `\\u${code.toString(16).padStart(4, "0")}`;
				continue;
			}
			out += c;
		} else {
			if (pending) {
				if (c === ",") continue; // 连续逗号按一枚
				if (isWs(c)) {
					pending += c;
					continue;
				}
				if (c !== "}" && c !== "]") out += pending; // 不是尾逗号：原样落笔
				pending = "";
			}
			if (c === ",") {
				pending = c;
				continue;
			}
			if (c === '"') inStr = true;
			out += c;
		}
	}
	return out + pending;
}

/**
 * 解析＋错误文案（失败留档用）。契约：标签段优先（正文按行取原文，无转义可坏）；
 * 模型仍回 JSON（旧习惯）时走修复解析兜底。
 */
export function parseProcessResponseWithError(text: string): { value: ParsedProcess | null; parseError?: string } {
	const section = (tag: string): string => {
		const m = text.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i"));
		return m ? m[1].trim() : "";
	};
	const identity = section("identity");
	const writing = section("writing");
	const droppedRaw = section("dropped");
	if (identity || writing || droppedRaw || /<\/?(?:identity|writing|dropped)>/i.test(text)) {
		const dropped: DroppedItem[] = droppedRaw
			.split("\n")
			.map((l) => l.replace(/^\s*[-*·•]\s*/, "").trim())
			.filter(Boolean)
			.map((l) => {
				const m = l.split(/——|—/);
				const name = (m[0] ?? "").trim().slice(0, 120);
				const reason = (m.slice(1).join("——") || "").trim().slice(0, 60);
				return { name: name || "未名分段", reason };
			});
		return { value: { identity, writing, dropped } };
	}

	const stripped = text.replace(/```(?:json)?/gi, "");
	const start = stripped.indexOf("{");
	const end = stripped.lastIndexOf("}");
	if (start < 0 || end <= start) return { value: null, parseError: "响应里既没有标签段也不是 JSON" };
	const raw = stripped.slice(start, end + 1);
	const errors: string[] = [];
	for (const candidate of [raw, repairJsonStringLiterals(raw)]) {
		try {
			const v = JSON.parse(candidate);
			if (v && typeof v === "object") {
				const o = v as Record<string, unknown>;
				const str = (x: unknown): string => (typeof x === "string" ? x : "");
				const dropped: DroppedItem[] = Array.isArray(o.dropped)
					? (o.dropped as unknown[])
							.filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
							.map((d) => ({
								name: str(d.name).slice(0, 120) || "未名分段",
								reason: str(d.reason).slice(0, 60),
							}))
					: [];
				return { value: { identity: str(o.identity).trim(), writing: str(o.writing).trim(), dropped } };
			}
		} catch (e) {
			errors.push(e instanceof Error ? e.message : String(e));
		}
	}
	return { value: null, parseError: errors.join("；修复后 ") };
}

export function parseProcessResponse(text: string): ParsedProcess | null {
	return parseProcessResponseWithError(text).value;
}

interface ProcessedEntries {
	/** 卡级 APPEND_SYSTEM.md 追加段（一条「预设提示词（预设）」；无身份产物则空串） */
	appendMarkdown: string;
	/** 卡档案 AGENTS.md 追加段（一条「预设写作规则（预设）」；无则空串） */
	agentsSection: string;
	identityChars: number;
	writingChars: number;
	/** 产物里清单外的宏（原样保留在文本里，交上层上报） */
	unsupportedMacros: string[];
}

/** 处理产物 → 两条条目：{{char}}/{{user}} 占位按卡求值，正文防标题割裂转义 */
export function processIntoEntries(
	processed: { identity: string; writing: string },
	opts: { charName: string; userName: string },
): ProcessedEntries {
	const env = createMacroEnv({ charName: opts.charName, userName: opts.userName });
	const unsupported = new Set<string>();
	const evalIt = (s: string): string => {
		if (!s.trim()) return "";
		const r = evalPresetMacros(s, env);
		for (const u of r.unsupported) unsupported.add(u);
		return r.text;
	};
	const identity = evalIt(processed.identity);
	const writing = evalIt(processed.writing);
	return {
		appendMarkdown: identity ? formatEntry(`预设提示词${PRESET_SOURCE_SUFFIX}`, identity) : "",
		agentsSection: writing ? formatEntry(`预设写作规则${PRESET_SOURCE_SUFFIX}`, writing) : "",
		identityChars: identity.length,
		writingChars: writing.length,
		unsupportedMacros: [...unsupported],
	};
}

