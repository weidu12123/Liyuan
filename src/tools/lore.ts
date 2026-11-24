/**
 * 世界书族工具（PLAN-RP-TOOLING M-D1 垂直切片）。
 *
 * 合一前 `lorebook_search` 有三份实现（stage / agent / roleplay），底层都调同一个
 * `searchEntries`，**差的是语料与话术**。没有一份是另外两份的超集。
 *
 * 合一取法（2026-08-04 用户裁定）：
 *   - **语料差异归依赖注入**——`LoreDeps.entries()` 由各面自己提供。
 *     台上注入「世界书 + overlay + 外部插件协议剥离」；
 *     助手注入**原始**世界书（**不剥协议**——助手是诊断面，用户问「我的卡为什么带
 *     UpdateVariable」时它必须看得见那些条目；协议剥离是台上生成的需要，不是检索的需要）。
 *   - 中文别名增强（扩展侧 withAliases）依赖 LLM 侧生成+缓存，留后续里程碑。
 *   - **话术按面裁剪**：台上要「查不到＝未被写下」这条事实与记账去向——**但不替模型决定
 *     查不到之后怎么办**（8/23：旧话术「可自行创造」把「这东西由谁定」这一问直接答掉了，
 *     模型读完就跳过思考，ask 从此零触发）；助手要语料规模与命中回声（诊断口径）。
 *     助手要语料规模与命中回声（诊断口径）。二者住同一文件，不会再各自漂移。
 */

import { getUiLocale, t } from "../i18n/index.ts";
import { errText, intArg, strArg, type ToolResult, type ToolSpec } from "./registry.ts";

/** 命中条目的结构子集（不依赖 LorebookEntry 全形，便于离线单测） */
interface LoreEntryLike {
	uid?: number;
	comment?: string;
	keys?: string[];
	content?: string;
	/** 常驻注入（列举/写入回执要报） */
	constant?: boolean;
	/** 是否启用；false = 被 disabledLore 停用（列举要标出来） */
	enabled?: boolean;
	/**
	 * 这条是 agent 自己写下的（住在补充设定集里）。缺省/false = 用户自己的世界书。
	 * 列举据此标「补充」——**标少数不标多数**：用户的书通常几十上百条，
	 * 给每一行挂个「用户的」等于纯噪声。
	 *
	 * agent 对两者都有改/删权限（2026-08-22 用户定案：「agent 就是应该有这些权限」）；
	 * 这个标记不是权限边界，是**份量提示**——删自己写的便签与删用户的原稿不是一回事。
	 */
	agentWritten?: boolean;
	source?: string;
}

export interface LoreHitLike {
	entry: LoreEntryLike;
	score?: number;
}

export interface LoreDeps {
	/**
	 * 本面的检索语料 → 命中。limit 由工具传入（各面默认值不同，见 schema）。
	 * 语料范围是各面注入时的决定（见文件头），工具本身不关心条目从哪来。
	 */
	searchLore: (query: string, limit: number) => LoreHitLike[] | Promise<LoreHitLike[]>;
	/** 语料规模（助手诊断话术要报「共 N 条」）；未注入则不报 */
	loreSize?: () => number;

	// ---- 以下未注入则该工具不可用（各面按能力注册） ----

	/** 写一条世界书条目；book 给出则写进那本世界书，缺省写当前已挂载的世界书。返回 null＝内容重复未写入 */
	writeLore?: (input: {
		title: string;
		keys: string[];
		content: string;
		constant?: boolean;
		book?: string;
	}) => LoreEntryLike | null;
	/** 改一条条目（按指纹，寻址范围＝书单全部世界书）；null = 哪本里都没这条 */
	updateLore?: (
		fingerprint: string,
		patch: { title?: string; keys?: string[]; content?: string; constant?: boolean },
	) => { entry: LoreEntryLike; newFingerprint: string; path?: string } | null;
	/** 删一条条目（按指纹，同一寻址范围）；null = 未命中 */
	deleteLore?: (fingerprint: string) => { entry: LoreEntryLike; path?: string } | null;
	/** 列举全部条目（含停用的——列举的意义正是让 agent 看见能启停什么） */
	listLore?: () => LoreEntryLike[];
	/** 书单 + 当前挂载状态（`lorebook_files`） */
	listBooks?: () => { books: Array<{ path: string; name: string; entryCount: number }>; mounted: string[] };
	/** 新建一本世界书（连第一条一起写，写完直接挂载）；返回 null＝同名已存在 */
	createBook?: (
		name: string,
		first: { title: string; keys: string[]; content: string; constant?: boolean },
	) => { path: string; mounted: string[] } | null;
	/** 挂载/卸载一本；返回挂载后的完整列表；抛错 = 路径不是有效世界书 */
	mountBook?: (path: string, mounted: boolean) => string[];
	/** 按内容指纹启停；返回实际生效的条数 */
	toggleLore?: (fingerprints: string[], enabled: boolean) => number;
	/** 条目内容 → 指纹（启停的持久键；由调用方注入避免 src/tools 依赖 crypto） */
	fingerprint?: (content: string) => string;
}

/** 台上默认命中数（一拍封顶 3 次检索，每次 3 条：控上下文预算） */
const STAGE_LIMIT = 3;
/** 助手默认命中数（诊断面要看得广，可调到 20） */
const ASSISTANT_LIMIT = 5;

/**
 * 命中格式化：`### 标题（关键词：…）\n正文`。
 *
 * 合一前三份的括号/分隔符各不相同（全角「（关键词：…）」/ 全角「（keys: …）」/ 半角「 (keys: …)」）。
 * 统一取台上那版：全角中文标签、顿号分隔、**无关键词时整段省略**（不留空括号）。
 */
function formatHits(hits: LoreHitLike[], deps: LoreDeps): string {
	const en = getUiLocale() === "en";
	return hits
		.map((h) => {
			const title = h.entry.comment || h.entry.keys?.[0] || (en ? "Entry" : "条目");
			const keys = h.entry.keys?.length
				? en
					? ` (keys: ${h.entry.keys.join(", ")})`
					: `（关键词：${h.entry.keys.join("、")}）`
				: "";
			const ref = deps.fingerprint ? `lore:${deps.fingerprint(h.entry.content ?? "")}` : undefined;
			const srcLine = h.entry.source ? (en ? `\nsource: ${h.entry.source}` : `\n来源：${h.entry.source}`) : "";
			return `### ${title}${keys}${ref ? `\nref: ${ref}` : ""}${srcLine}\n${h.entry.content ?? ""}`;
		})
		.join("\n\n");
}

export const lorebookSearch: ToolSpec<LoreDeps> = {
	name: "lorebook_search",
	domain: "lore",
	mode: "read",
	surfaces: ["stage", "extension"],
	label: "检索世界书",
	description: (ctx) =>
		getUiLocale() === "en"
			? ctx.surface === "stage"
				? "Search lorebooks (mounted books and supplementary lore) for places, factions, history, characters, magic/arts, and other setting details. Look up before writing whenever unsure — only a miss means a detail is unestablished. Query in the lore's original language."
				: "Search the project's lorebooks and supplementary lore for inspection (including entries stripped on-stage by external protocol filters). Query in the lore's original language."
			: ctx.surface === "stage"
				? `检索设定集（世界书与补充设定集）：地点、族群、历史、人物、法术等设定细节。` +
					`正文将涉及你没有十足把握的世界细节时，先查再写——查不到才是「未被写下」。` +
					`用设定原文的语言检索。`
				: `检索本项目的世界书与补充设定集，用于诊断设定内容（含被台上按外部插件协议剥离的条目）。` +
					`用设定原文的语言检索。`,
	parameters: (ctx) => {
		const en = getUiLocale() === "en";
		const query = {
			type: "string",
			description: en
				? ctx.surface === "stage"
					? "Space-separated keywords (not a full sentence question)"
					: "Search keywords in the lorebook's language (keywords rather than a full sentence)"
				: ctx.surface === "stage"
					? "关键词（空格分隔），非整句问题"
					: "检索词（用世界书原文语言），关键词而非整句",
		};
		if (ctx.surface === "stage") {
			return { type: "object", properties: { query }, required: ["query"] };
		}
		return {
			type: "object",
			properties: {
				query,
				limit: {
					type: "number",
					description: en ? `Max results (default ${ASSISTANT_LIMIT}, max 20)` : `命中上限（默认 ${ASSISTANT_LIMIT}，最多 20）`,
				},
			},
			required: ["query"],
		};
	},
	async run(args, deps, ctx): Promise<ToolResult> {
		const en = getUiLocale() === "en";
		const stage = ctx.surface === "stage";
		const query = strArg(args, "query");
		if (!query) return { text: en ? "Missing required parameter: query." : "缺少 query 参数。" };

		const limit = stage ? STAGE_LIMIT : intArg(args, "limit", ASSISTANT_LIMIT, 1, 20);
		let hits: LoreHitLike[] = [];
		try {
			hits = await deps.searchLore(query, limit);
		} catch (err) {
			return {
				text: en
					? stage
						? `Lorebook search failed: ${errText(err)}. Continue writing from established facts.`
						: `Lorebook search failed: ${errText(err)}`
					: stage
						? `设定集检索失败：${errText(err)}。按已知事实继续写。`
						: `设定集检索失败：${errText(err)}`,
			};
		}

		if (hits.length === 0) {
			if (stage) {
				return {
					text: en
						? "No lorebook hits — this detail has not been written down yet. Decide whether you should invent it or hand the choice to the user; stay consistent with established facts (major inventions will be recorded in the ledger by the scribe)."
						: "设定集无命中——该细节尚未被写下。它由谁定：你自行创造，还是交给用户；须与既有事实一致（重要的创造会由场记记进账本）。",
					activity: t("查设定「{q}」· 无命中", { q: query }),
				};
			}
			const size = deps.loreSize?.();
			return {
				text: en
					? `(No hits for "${query}" in lorebook${typeof size === "number" ? ` (${size} entries total)` : ""})`
					: `（世界书${typeof size === "number" ? `共 ${size} 条，` : ""}未命中「${query}」）`,
				activity: t("查设定「{q}」· 无命中", { q: query }),
			};
		}

		return {
			text: formatHits(hits, deps),
			activity: t("查设定「{q}」· {n} 条", { q: query, n: hits.length }),
			details: { hits: hits.map((h) => ({ uid: h.entry.uid, score: h.score })) },
		};
	},
};

export const lorebookRead: ToolSpec<LoreDeps> = {
	name: "lorebook_read", domain: "lore", mode: "read", surfaces: ["stage"], label: "读取世界书条目",
	description: () =>
		getUiLocale() === "en"
			? "Read a lorebook entry's full text and source by ref or content fingerprint from lorebook_search/list. start/end are 0-based character offsets (end exclusive); omit for full text."
			: "按 lorebook_search/list 给出的 ref 或内容指纹读取条目原文与来源。start/end 为从 0 开始的字符偏移，end 不含；省略即全文。",
	parameters: () => ({ type: "object", properties: { ref: { type: "string" }, start: { type: "integer", minimum: 0 }, end: { type: "integer", minimum: 0 } }, required: ["ref"] }),
	async run(args, deps) {
		const en = getUiLocale() === "en";
		if (!deps.listLore || !deps.fingerprint) return { text: en ? "Reading lorebook entries is not available in this environment." : "本环境未提供世界书读取。", isError: true };
		const ref = strArg(args, "ref").replace(/^lore:/, "");
		try {
			const found = deps.listLore().filter((e) => deps.fingerprint!(e.content ?? "") === ref);
			if (!found.length) return { text: en ? "Reference is stale or not in the current lorebooks." : "引用已失效或不在当前设定集中。", isError: true };
			const text = found[0].content ?? "";
			const start = args.start === undefined ? 0 : Number(args.start), end = args.end === undefined ? text.length : Number(args.end);
			if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) {
				return { text: en ? "Invalid read range." : "读取范围无效。", isError: true };
			}
			return { text: JSON.stringify({ ref: `lore:${ref}`, start, end, total: text.length, content: text.slice(start, end), sources: found.map((e) => ({ title: e.comment, uid: e.uid, source: e.source, enabled: e.enabled !== false })) }), activity: t("读设定原文") };
		} catch (e) { return { text: en ? `Failed to read lorebook: ${errText(e)}` : `读取世界书失败：${errText(e)}`, isError: true }; }
	},
};

export const lorebookList: ToolSpec<LoreDeps> = {
	name: "lorebook_list",
	domain: "lore",
	mode: "read",
	surfaces: ["stage"],
	label: "列举世界书条目",
	description: () =>
		getUiLocale() === "en"
			? "List all lorebook entries (title / keywords / constant / disabled / fingerprint) for an overview or to obtain fingerprints for lorebook_toggle/update/delete. Use lorebook_search for full entry text."
			: "列举设定集的全部条目（标题/关键词/是否常驻/是否已停用/指纹），用于纵览有哪些设定、" +
				"或为 lorebook_toggle 取指纹。要查具体内容用 lorebook_search——本工具只给目录不给正文。",
	parameters: () => ({
		type: "object",
		properties: {
			keyword: {
				type: "string",
				description: getUiLocale() === "en"
					? "Only list entries whose title or keywords contain this string (omit for all)"
					: "只列标题或关键词含此字样的条目（缺省列全部）",
			},
		},
		required: [],
	}),
	async run(args, deps): Promise<ToolResult> {
		const en = getUiLocale() === "en";
		if (!deps.listLore || !deps.fingerprint) return { text: en ? "Listing lorebook entries is not supported in this environment." : "本环境不支持列举世界书条目。" };

		let all: LoreEntryLike[];
		try {
			all = deps.listLore();
		} catch (err) {
			return { text: en ? `Failed to list lorebook entries: ${errText(err)}` : `列举设定集失败：${errText(err)}` };
		}

		const kw = strArg(args, "keyword").toLowerCase();
		const list = kw
			? all.filter(
					(e) =>
						(e.comment ?? "").toLowerCase().includes(kw) ||
						(e.keys ?? []).some((k) => k.toLowerCase().includes(kw)),
				)
			: all;

		if (list.length === 0) {
			return {
				text: en
					? kw
						? `${all.length} lore entry(ies) total; none matched "${kw}".`
						: "The lorebook is empty."
					: kw
						? `设定集共 ${all.length} 条，无标题/关键词含「${kw}」的条目。`
						: "设定集是空的。",
				activity: kw ? t("列设定「{kw}」· {n} 条", { kw, n: 0 }) : t("列设定 · {n} 条", { n: 0 }),
			};
		}

		const fp = deps.fingerprint;
		const lines = list.map((e) => {
			const marks = [
				e.constant ? (en ? "constant" : "常驻") : "",
				e.enabled === false ? (en ? "**disabled**" : "**已停用**") : "",
				e.agentWritten ? (en ? "extra" : "补充") : "",
			].filter(Boolean).join("·");
			const keys = e.keys?.length
				? (en ? `keys: ${e.keys.join(", ")}` : `关键词 ${e.keys.join("、")}`)
				: (en ? "no keys" : "无关键词");
			return `- ${e.comment || e.keys?.[0] || (en ? "Entry" : "条目")}｜${keys}${marks ? `｜${marks}` : ""}｜${en ? "fp" : "指纹"} ${fp(e.content ?? "")}`;
		});
		const head = en
			? kw
				? `Lorebook entries matching "${kw}" (${list.length}/${all.length}):`
				: `Lorebook entries (${list.length}):`
			: kw
				? `设定集含「${kw}」的条目 ${list.length}/${all.length} 条：`
				: `设定集共 ${list.length} 条：`;
		return {
			text: `${head}\n${lines.join("\n")}`,
			activity: kw ? t("列设定「{kw}」· {n} 条", { kw, n: list.length }) : t("列设定 · {n} 条", { n: list.length }),
		};
	},
};

export const lorebookToggle: ToolSpec<LoreDeps> = {
	name: "lorebook_toggle",
	domain: "lore",
	mode: "write",
	surfaces: ["stage"],
	label: "启停世界书条目",
	description: () =>
		getUiLocale() === "en"
			? "Enable or disable lorebook entries by fingerprint (from lorebook_list). Disabled entries are neither injected nor matched by search. **This is a persistent user-level toggle** (persists across sessions) — ask the user first if unsure."
			: "启用/停用设定集条目（按指纹，指纹从 lorebook_list 取）。停用后该条不再注入上下文、检索也不命中。" +
				"用于某条设定与当前剧情冲突、或用户要求弃用某条设定时。" +
				"**这是用户级的持久开关**（跨会话保留），不是本拍的临时忽略——拿不准就先问用户。",
	parameters: () => {
		const en = getUiLocale() === "en";
		return {
			type: "object",
			properties: {
				fingerprints: {
					type: "array",
					items: { type: "string" },
					description: en ? "Entry fingerprint(s) from lorebook_list" : "要启停的条目指纹（从 lorebook_list 取），可多条",
				},
				enabled: { type: "boolean", description: en ? "true = enable, false = disable" : "true = 启用，false = 停用" },
			},
			required: ["fingerprints", "enabled"],
		};
	},
	async run(args, deps): Promise<ToolResult> {
		const en = getUiLocale() === "en";
		if (!deps.toggleLore) return { text: en ? "Toggling lorebook entries is not supported in this environment." : "本环境不支持启停世界书条目。" };

		const fps = Array.isArray(args.fingerprints)
			? args.fingerprints.filter((f): f is string => typeof f === "string" && f.trim().length > 0).map((f) => f.trim())
			: [];
		if (fps.length === 0) return { text: en ? "Missing fingerprints parameter (get fingerprints from lorebook_list)." : "缺少 fingerprints 参数（指纹从 lorebook_list 取）。" };
		if (typeof args.enabled !== "boolean") return { text: en ? "Missing enabled parameter (true = enable, false = disable)." : "缺少 enabled 参数（true = 启用，false = 停用）。" };

		const enabled = args.enabled;
		let count: number;
		try {
			count = deps.toggleLore(fps, enabled);
		} catch (err) {
			return { text: en ? `Toggle failed: ${errText(err)}` : `启停失败：${errText(err)}` };
		}
		const verb = enabled ? "启用" : "停用";
		return {
			text: en
				? `${enabled ? "Enabled" : "Disabled"} ${count} lore entry(ies) (persistent user-level toggle).${enabled ? "" : " Disabled entries will no longer be injected or matched by search."}`
				: `已${verb} ${count} 条设定（用户级持久开关，跨会话保留）。${enabled ? "" : "停用的条目不再注入上下文，检索也不会命中。"}`,
			activity: enabled ? t("启用设定 · {n} 条", { n: count }) : t("停用设定 · {n} 条", { n: count }),
		};
	},
};

const lorebookFiles: ToolSpec<LoreDeps> = {
	name: "lorebook_files",
	domain: "lore",
	mode: "read",
	surfaces: ["stage"],
	label: "列世界书文件",
	description: () =>
		getUiLocale() === "en"
			? "List all lorebook files in the project (path / name / entry count) and show which ones are currently mounted. Only mounted books enter context and search. Use lorebook_list for entries and lorebook_search for text."
			: "列出项目里的全部世界书文件（路径/书名/条目数）并标出当前挂载了哪几本。" +
				"挂载的书才会进上下文与检索。要看条目用 lorebook_list，要看内容用 lorebook_search。",
	parameters: () => ({ type: "object", properties: {}, required: [] }),
	async run(_args, deps): Promise<ToolResult> {
		const en = getUiLocale() === "en";
		if (!deps.listBooks) return { text: en ? "Listing lorebook files is not supported in this environment." : "本环境不支持列举世界书文件。" };

		let shelf: { books: Array<{ path: string; name: string; entryCount: number }>; mounted: string[] };
		try {
			shelf = deps.listBooks();
		} catch (err) {
			return { text: en ? `Failed to list lorebooks: ${errText(err)}` : `列举世界书失败：${errText(err)}` };
		}
		if (shelf.books.length === 0) {
			return { text: en ? "There are no lorebook files in this project yet." : "项目里还没有世界书文件。", activity: t("列世界书 · {n} 本", { n: 0 }) };
		}
		const on = new Set(shelf.mounted);
		const lines = shelf.books.map((b) =>
			en
				? `- ${b.name}｜${b.entryCount} entries｜${on.has(b.path) ? "**mounted**" : "unmounted"}｜${b.path}`
				: `- ${b.name}｜${b.entryCount} 条｜${on.has(b.path) ? "**已挂载**" : "未挂载"}｜${b.path}`,
		);
		return {
			text: en
				? `${shelf.books.length} lorebook(s) total (${shelf.mounted.length} mounted):\n${lines.join("\n")}`
				: `共 ${shelf.books.length} 本世界书（挂载 ${shelf.mounted.length} 本）：\n${lines.join("\n")}`,
			activity: t("列世界书 · {n} 本", { n: shelf.books.length }),
			details: { mounted: shelf.mounted },
		};
	},
};

const lorebookMount: ToolSpec<LoreDeps> = {
	name: "lorebook_mount",
	domain: "lore",
	mode: "write",
	surfaces: ["stage"],
	label: "挂载/卸载世界书",
	description: () =>
		getUiLocale() === "en"
			? "Mount or unmount a lorebook (get paths from lorebook_files). Only mounted books enter context and search. **This is a persistent user-level toggle** (persists across sessions) — ask the user first if unsure. Use lorebook_toggle for individual entries."
			: "挂载或卸载一本世界书（路径从 lorebook_files 取）。挂载的书才进上下文与检索。" +
				"**这是用户级的持久开关**（跨会话保留），换的是整局的语料——拿不准就先问用户。" +
				"单条的启停用 lorebook_toggle。",
	parameters: () => {
		const en = getUiLocale() === "en";
		return {
			type: "object",
			properties: {
				path: { type: "string", description: en ? "Lorebook path (from lorebook_files)" : "世界书路径（从 lorebook_files 取）" },
				mounted: { type: "boolean", description: en ? "true = mount, false = unmount" : "true = 挂上，false = 卸下" },
			},
			required: ["path", "mounted"],
		};
	},
	async run(args, deps): Promise<ToolResult> {
		const en = getUiLocale() === "en";
		if (!deps.mountBook) return { text: en ? "Mounting lorebooks is not supported in this environment." : "本环境不支持挂载世界书。" };

		const path = strArg(args, "path");
		if (!path) return { text: en ? "Missing path parameter (get path from lorebook_files)." : "缺少 path 参数（路径从 lorebook_files 取）。" };
		if (typeof args.mounted !== "boolean") return { text: en ? "Missing mounted parameter (true = mount, false = unmount)." : "缺少 mounted 参数（true = 挂上，false = 卸下）。" };

		const mounted = args.mounted;
		let list: string[];
		try {
			list = deps.mountBook(path, mounted);
		} catch (err) {
			return { text: en ? `${mounted ? "Mount" : "Unmount"} failed: ${errText(err)}` : `${mounted ? "挂载" : "卸载"}失败：${errText(err)}` };
		}
		return {
			text: en
				? `${mounted ? "Mounted" : "Unmounted"} ${path}. Currently mounted (${list.length})${list.length ? `: ${list.join(", ")}` : ""}. Takes effect on the next beat.`
				: `已${mounted ? "挂载" : "卸载"}${path}。当前挂载 ${list.length} 本${list.length ? `：${list.join("、")}` : ""}。下一拍起生效。`,
			activity: mounted ? t("挂载世界书") : t("卸载世界书"),
			details: { mounted: list },
		};
	},
};

export const lorebookCreate: ToolSpec<LoreDeps> = {
	name: "lorebook_create",
	domain: "lore",
	mode: "write",
	surfaces: ["stage"],
	label: "新建世界书",
	description: () =>
		getUiLocale() === "en"
			? "Create a new standalone lorebook with its first entry and mount it immediately. Add subsequent entries with lorebook_write passing book. Refuses duplicate names."
			: "新建一本独立世界书并写入第一条设定，建好即自动挂载生效。此后往这本里加条目用 lorebook_write 传 book。同名已存在会被拒绝。",
	parameters: () => {
		const en = getUiLocale() === "en";
		return {
			type: "object",
			properties: {
				name: { type: "string", description: en ? "Book name (becomes the filename)" : "书名，如「青云志」（会成为文件名）" },
				title: { type: "string", description: en ? "Title of the first entry" : "第一条的标题" },
				keys: { type: "array", items: { type: "string" }, description: en ? "Search keywords for the first entry" : "第一条的检索关键词" },
				content: { type: "string", description: en ? "Body text of the first entry" : "第一条的正文" },
				constant: { type: "boolean", description: en ? "Whether the first entry is constantly injected" : "第一条是否常驻注入" },
			},
			required: ["name", "title", "keys", "content"],
		};
	},
	async run(args, deps): Promise<ToolResult> {
		const en = getUiLocale() === "en";
		if (!deps.createBook) return { text: en ? "Creating lorebooks is not supported in this environment." : "本环境不支持新建世界书。" };

		const name = strArg(args, "name");
		const title = strArg(args, "title");
		const content = strArg(args, "content");
		if (!name) return { text: en ? "Missing name parameter (book name)." : "缺少 name 参数（书名）。" };
		if (!title || !content) return { text: en ? "Missing title or content (a new book must include its first entry)." : "缺少 title 或 content（新书要连第一条一起建）。" };
		const keys = Array.isArray(args.keys)
			? args.keys.filter((k): k is string => typeof k === "string" && k.trim().length > 0).map((k) => k.trim())
			: [];

		let r: { path: string; mounted: string[] } | null;
		try {
			r = deps.createBook(name, { title, keys, content, constant: args.constant === true });
		} catch (err) {
			return { text: en ? `Failed to create lorebook: ${errText(err)}` : `新建世界书失败：${errText(err)}` };
		}
		if (!r) {
			return {
				text: en ? `A lorebook named "${name}" already exists; not created.` : `已有同名世界书「${name}」，未新建。`,
				activity: t("建世界书 · 重名跳过"),
			};
		}

		return {
			text: en
				? `Created and mounted lorebook "${name}" (${r.path}) with initial entry [${title}]. Add more entries via lorebook_write with book="${r.path}".`
				: `已新建世界书「${name}」（${r.path}）并挂载，首条【${title}】已写入。往这本里再加条目：lorebook_write 传 book="${r.path}"。`,
			activity: t("建世界书「{name}」", { name }),
			details: { path: r.path, mounted: r.mounted },
		};
	},
};

export const lorebookWrite: ToolSpec<LoreDeps> = {
	name: "lorebook_write",
	domain: "lore",
	mode: "write",
	surfaces: ["stage", "extension"],
	label: "写入世界书条目",
	description: () =>
		getUiLocale() === "en"
			? "Write an entry into a standalone lorebook (title / keywords / content / constant); immediately visible to lorebook_search and lorebook_list. Specify target book via `book` (path from lorebook_files or lorebook_create; may omit if only one book is mounted). Call lorebook_create first if no lorebook exists."
			: "向独立世界书写入一条设定（标题/检索关键词/正文/是否常驻）：写入后 lorebook_search 与 lorebook_list 可见。" +
				"通过 book 指定写入哪本世界书（路径从 lorebook_files 或 lorebook_create 取；若只挂载了一本世界书可省略 book）。还没有世界书时先调 lorebook_create。",
	parameters: () => {
		const en = getUiLocale() === "en";
		return {
			type: "object",
			properties: {
				title: { type: "string", description: en ? "Entry title" : "条目标题，如「青云宗门规」" },
				keys: {
					type: "array",
					items: { type: "string" },
					description: en ? "Keywords for triggering and search matching" : "检索关键词（供触发与检索命中）",
				},
				content: { type: "string", description: en ? "Lore entry body text" : "设定正文" },
				constant: { type: "boolean", description: en ? "true = always inject (global critical lore only)" : "true = 常驻注入（仅限全局关键设定）" },
				book: { type: "string", description: en ? "Target lorebook path (from lorebook_files; defaults to the currently mounted book)" : "写进哪本世界书（路径从 lorebook_files 取；缺省写入当前已挂载的世界书）" },
			},
			required: ["title", "keys", "content"],
		};
	},
	async run(args, deps): Promise<ToolResult> {
		const en = getUiLocale() === "en";
		if (!deps.writeLore) return { text: en ? "Writing lorebook entries is not supported in this environment." : "本环境不支持写入世界书条目。" };

		const title = strArg(args, "title");
		const content = strArg(args, "content");
		if (!title || !content) return { text: en ? "Missing title or content parameter." : "缺少 title 或 content 参数。" };
		const keys = Array.isArray(args.keys)
			? args.keys.filter((k): k is string => typeof k === "string" && k.trim().length > 0).map((k) => k.trim())
			: [];
		const book = strArg(args, "book");

		let entry: LoreEntryLike | null;
		try {
			entry = deps.writeLore({ title, keys, content, constant: args.constant === true, ...(book ? { book } : {}) });
		} catch (err) {
			return { text: en ? `Failed to write lorebook entry: ${errText(err)}` : `写入世界书条目失败：${errText(err)}` };
		}
		if (!entry) return { text: en ? "Duplicate of an existing entry; not written." : "内容与已有条目重复，未写入。", activity: t("写设定 · 重复跳过") };

		return {
			text: en
				? `Wrote lorebook entry: [${entry.comment}] keys: ${entry.keys?.join(", ") || "(none)"}${entry.constant ? " (constant)" : ""}${book ? ` in ${book}` : ""}.`
				: `已写入世界书条目：【${entry.comment}】关键词 ${entry.keys?.join("、") || "（无）"}${entry.constant ? "（常驻注入）" : ""}${book ? `，写在 ${book}` : ""}。`,
			activity: t("写设定「{title}」", { title: entry.comment }),
			details: { uid: entry.uid },
		};
	},
};

export const lorebookUpdate: ToolSpec<LoreDeps> = {
	name: "lorebook_update",
	domain: "lore",
	mode: "write",
	surfaces: ["stage"],
	label: "修改世界书条目",
	description: () =>
		getUiLocale() === "en"
			? "Update a lorebook entry by fingerprint (from lorebook_list): pass only fields to change (title/keys/content/constant); omitted fields stay unchanged."
			: "按指纹修改一条世界书条目（指纹从 lorebook_list 取）：标题/关键词/正文/常驻，只传要改的字段，没传的原样保留。",
	parameters: () => {
		const en = getUiLocale() === "en";
		return {
			type: "object",
			properties: {
				fingerprint: { type: "string", description: en ? "Target entry fingerprint (from lorebook_list)" : "要改的条目指纹（从 lorebook_list 取）" },
				title: { type: "string", description: en ? "New title" : "新标题" },
				keys: { type: "array", items: { type: "string" }, description: en ? "New search keywords (replaces the full list)" : "新检索关键词（整组替换）" },
				content: { type: "string", description: en ? "New entry body text (replaces the full text)" : "新设定正文（整段替换）" },
				constant: { type: "boolean", description: en ? "Whether constantly injected" : "是否常驻注入" },
			},
			required: ["fingerprint"],
		};
	},
	async run(args, deps): Promise<ToolResult> {
		const en = getUiLocale() === "en";
		if (!deps.updateLore) return { text: en ? "Updating lorebook entries is not supported in this environment." : "本环境不支持修改世界书条目。" };

		const fingerprint = strArg(args, "fingerprint").replace(/^lore:/, "");
		if (!fingerprint) return { text: en ? "Missing fingerprint parameter (from lorebook_list)." : "缺少 fingerprint 参数（指纹从 lorebook_list 取）。" };

		const patch: { title?: string; keys?: string[]; content?: string; constant?: boolean } = {};
		const title = strArg(args, "title");
		if (title) patch.title = title;
		const content = strArg(args, "content");
		if (content) patch.content = content;
		if (Array.isArray(args.keys)) {
			patch.keys = args.keys.filter((k): k is string => typeof k === "string" && k.trim().length > 0).map((k) => k.trim());
		}
		if (typeof args.constant === "boolean") patch.constant = args.constant;
		if (Object.keys(patch).length === 0) {
			return { text: en ? "No fields to update (provide at least one of title/keys/content/constant)." : "没有要改的字段（title/keys/content/constant 至少给一个）。" };
		}

		let r: { entry: LoreEntryLike; newFingerprint: string; path?: string } | null;
		try {
			r = deps.updateLore(fingerprint, patch);
		} catch (err) {
			return { text: en ? `Failed to update lorebook entry: ${errText(err)}` : `修改世界书条目失败：${errText(err)}` };
		}
		if (!r) {
			return {
				text: en
					? "Fingerprint not found in any lorebook (the entry may have changed — fingerprints depend on content; re-run lorebook_list)."
					: "哪本世界书里都没有这个指纹（条目可能已被改过——指纹随正文变，重新 lorebook_list 取一次）。",
				activity: t("改设定 · 未命中"),
			};
		}

		return {
			text: en
				? `Updated [${r.entry.comment}]${r.path ? ` (${r.path})` : ""}${patch.content ? `, content updated, new fingerprint ${r.newFingerprint}` : ""}.`
				: `已修改【${r.entry.comment}】${r.path ? `（${r.path}）` : ""}${patch.content ? `，正文已更新，新指纹 ${r.newFingerprint}` : ""}。`,
			activity: t("改设定「{title}」", { title: r.entry.comment }),
			details: { fingerprint: r.newFingerprint, path: r.path },
		};
	},
};

export const lorebookDelete: ToolSpec<LoreDeps> = {
	name: "lorebook_delete",
	domain: "lore",
	mode: "write",
	surfaces: ["stage"],
	label: "删除世界书条目",
	description: () =>
		getUiLocale() === "en"
			? "Delete a lorebook entry by fingerprint (from lorebook_list). Use lorebook_toggle to disable instead if unsure about permanent deletion."
			: "按指纹删除一条世界书条目（指纹从 lorebook_list 取）。拿不准是否要永久删除时用 lorebook_toggle 停用。",
	parameters: () => ({
		type: "object",
		properties: {
			fingerprint: {
				type: "string",
				description: getUiLocale() === "en" ? "Target entry fingerprint (from lorebook_list)" : "要删的条目指纹（从 lorebook_list 取）",
			},
		},
		required: ["fingerprint"],
	}),
	async run(args, deps): Promise<ToolResult> {
		const en = getUiLocale() === "en";
		if (!deps.deleteLore) return { text: en ? "Deleting lorebook entries is not supported in this environment." : "本环境不支持删除世界书条目。" };

		const fingerprint = strArg(args, "fingerprint").replace(/^lore:/, "");
		if (!fingerprint) return { text: en ? "Missing fingerprint parameter (from lorebook_list)." : "缺少 fingerprint 参数（指纹从 lorebook_list 取）。" };

		let r: { entry: LoreEntryLike; path?: string } | null;
		try {
			r = deps.deleteLore(fingerprint);
		} catch (err) {
			return { text: en ? `Failed to delete lorebook entry: ${errText(err)}` : `删除世界书条目失败：${errText(err)}` };
		}
		if (!r) {
			return {
				text: en
					? "Fingerprint not found in any lorebook (the entry may have changed — re-run lorebook_list)."
					: "哪本世界书里都没有这个指纹（条目可能已被改过——指纹随正文变，重新 lorebook_list 取一次）。",
				activity: t("删设定 · 未命中"),
			};
		}

		return {
			text: en
				? `Deleted [${r.entry.comment}]${r.path ? ` (${r.path})` : ""}; it will no longer match searches.`
				: `已删除【${r.entry.comment}】${r.path ? `（${r.path}）` : ""}，此后检索不再命中。`,
			activity: t("删设定「{title}」", { title: r.entry.comment }),
			details: { path: r.path },
		};
	},
};

/** 世界书族全部工具（检索 / 列 / 启停 / 书一级列建挂 / 条目增改删） */
export const loreTools: ToolSpec<LoreDeps>[] = [
	lorebookSearch,
	lorebookRead,
	lorebookList,
	lorebookToggle,
	lorebookFiles,
	lorebookCreate,
	lorebookMount,
	lorebookWrite,
	lorebookUpdate,
	lorebookDelete,
];
