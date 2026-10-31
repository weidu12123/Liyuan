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
	searchLore: (query: string, limit: number) => LoreHitLike[];
	/** 语料规模（助手诊断话术要报「共 N 条」）；未注入则不报 */
	loreSize?: () => number;

	// ---- 以下未注入则该工具不可用（各面按能力注册） ----

	/** 列举全部条目（含停用的——列举的意义正是让 agent 看见能启停什么） */
	listLore?: () => LoreEntryLike[];
	/** 书单 + 当前挂载状态（`lorebook_files`） */
	listBooks?: () => { books: Array<{ path: string; name: string; entryCount: number }>; mounted: string[] };
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
	return hits
		.map((h) => {
			const title = h.entry.comment || h.entry.keys?.[0] || "条目";
			const keys = h.entry.keys?.length ? `（关键词：${h.entry.keys.join("、")}）` : "";
			const ref = deps.fingerprint ? `lore:${deps.fingerprint(h.entry.content ?? "")}` : undefined;
			return `### ${title}${keys}${ref ? `\nref: ${ref}` : ""}${h.entry.source ? `\n来源：${h.entry.source}` : ""}\n${h.entry.content ?? ""}`;
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
		ctx.surface === "stage"
			? `检索设定集（世界书与补充设定集）：地点、族群、历史、人物、法术等设定细节。` +
				`正文将涉及你没有十足把握的世界细节时，先查再写——查不到才是「未被写下」。` +
				`用设定原文的语言检索（多为${ctx.language}或英文）。`
			: `检索本项目的世界书与补充设定集，用于诊断设定内容（含被台上按外部插件协议剥离的条目）。` +
				`用设定原文的语言检索（多为${ctx.language}或英文）。`,
	parameters: (ctx) => {
		const query = {
			type: "string",
			description:
				ctx.surface === "stage" ? "关键词（空格分隔），非整句问题" : "检索词（用世界书原文语言），关键词而非整句",
		};
		// 台上不开 limit：一拍检索配额有限，条数固定才好控上下文预算；助手是诊断面，放开。
		if (ctx.surface === "stage") {
			return { type: "object", properties: { query }, required: ["query"] };
		}
		return {
			type: "object",
			properties: {
				query,
				limit: { type: "number", description: `命中上限（默认 ${ASSISTANT_LIMIT}，最多 20）` },
			},
			required: ["query"],
		};
	},
	async run(args, deps, ctx): Promise<ToolResult> {
		const stage = ctx.surface === "stage";
		const query = strArg(args, "query");
		if (!query) return { text: "缺少 query 参数。" };

		const limit = stage ? STAGE_LIMIT : intArg(args, "limit", ASSISTANT_LIMIT, 1, 20);
		let hits: LoreHitLike[] = [];
		try {
			hits = deps.searchLore(query, limit);
		} catch (err) {
			// 不抛：告诉模型怎么往下走（台上继续演，助手报障）
			return {
				text: stage
					? `设定集检索失败：${errText(err)}。按已知事实继续写。`
					: `设定集检索失败：${errText(err)}`,
			};
		}

		if (hits.length === 0) {
			if (stage) {
				return {
					// 无命中是**具体二值事实**，正是「这东西由谁定」该被想一次的时刻。旧话术
					// 「可自行创造」在那个岔口上直接给了结论，模型读完就跳过思考（8/23 实测：
					// 模型查一个人物没查到，当场推出「设定集里没有他 → 那就是新的 → 我可以创造」）。
					// 这里只把问题摆回去，不说「该问用户」——诱导思考，不诱导调用（铁律一：不加催告）。
					text: "设定集无命中——该细节尚未被写下。它由谁定：你自行创造，还是交给用户；须与既有事实一致（重要的创造会由场记记进账本）。",
					activity: `查设定「${query}」· 无命中`,
				};
			}
			const size = deps.loreSize?.();
			return {
				text: `（世界书${typeof size === "number" ? `共 ${size} 条，` : ""}未命中「${query}」）`,
				activity: `查设定「${query}」· 无命中`,
			};
		}

		return {
			text: formatHits(hits, deps),
			activity: `查设定「${query}」· ${hits.length} 条`,
			details: { hits: hits.map((h) => ({ uid: h.entry.uid, score: h.score })) },
		};
	},
};

export const lorebookRead: ToolSpec<LoreDeps> = {
	name: "lorebook_read", domain: "lore", mode: "read", surfaces: ["stage"], label: "读取世界书条目",
	description: () => "按 lorebook_search/list 给出的 ref 或内容指纹读取条目原文与来源。start/end 为从 0 开始的字符偏移，end 不含；省略即全文。",
	parameters: () => ({ type: "object", properties: { ref: { type: "string" }, start: { type: "integer", minimum: 0 }, end: { type: "integer", minimum: 0 } }, required: ["ref"] }),
	async run(args, deps) {
		if (!deps.listLore || !deps.fingerprint) return { text: "本环境未提供世界书读取。", isError: true };
		const ref = strArg(args, "ref").replace(/^lore:/, "");
		try {
			const found = deps.listLore().filter((e) => deps.fingerprint!(e.content ?? "") === ref);
			if (!found.length) return { text: "引用已失效或不在当前设定集中。", isError: true };
			const text = found[0].content ?? "";
			const start = args.start === undefined ? 0 : Number(args.start), end = args.end === undefined ? text.length : Number(args.end);
			if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) return { text: "读取范围无效。", isError: true };
			return { text: JSON.stringify({ ref: `lore:${ref}`, start, end, total: text.length, content: text.slice(start, end), sources: found.map((e) => ({ title: e.comment, uid: e.uid, source: e.source, enabled: e.enabled !== false })) }), activity: "读设定原文" };
		} catch (e) { return { text: `读取世界书失败：${errText(e)}`, isError: true }; }
	},
};

// ---------------- 列举 + 启停 ----------------

/**
 * 调用情境（D-T3）：模型想知道「这个世界里都写了些什么」——检索靠关键词命中，
 * 列举才答得了「有哪些条目」「哪些被停用了」。也是 lorebook_toggle 取指纹的入口。
 */
export const lorebookList: ToolSpec<LoreDeps> = {
	name: "lorebook_list",
	domain: "lore",
	mode: "read",
	surfaces: ["stage"],
	label: "列举世界书条目",
	description: () =>
		"列举设定集的全部条目（标题/关键词/是否常驻/是否已停用/指纹），用于纵览有哪些设定、" +
		"或为 lorebook_toggle 取指纹。要查具体内容用 lorebook_search——本工具只给目录不给正文。",
	parameters: () => ({
		type: "object",
		properties: {
			keyword: { type: "string", description: "只列标题或关键词含此字样的条目（缺省列全部）" },
		},
		required: [],
	}),
	async run(args, deps): Promise<ToolResult> {
		if (!deps.listLore || !deps.fingerprint) return { text: "本环境不支持列举世界书条目。" };

		let all: LoreEntryLike[];
		try {
			all = deps.listLore();
		} catch (err) {
			return { text: `列举设定集失败：${errText(err)}` };
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
				text: kw ? `设定集共 ${all.length} 条，无标题/关键词含「${kw}」的条目。` : "设定集是空的。",
				activity: `列设定${kw ? `「${kw}」` : ""}· 0 条`,
			};
		}

		const fp = deps.fingerprint;
		const lines = list.map((e) => {
			// 「补充」= agent 自己写下的。**标少数**：用户的书动辄上百条，给每行挂个「用户的」是纯噪声。
			const marks = [e.constant ? "常驻" : "", e.enabled === false ? "**已停用**" : "", e.agentWritten ? "补充" : ""]
				.filter(Boolean)
				.join("·");
			const keys = e.keys?.length ? `关键词 ${e.keys.join("、")}` : "无关键词";
			return `- ${e.comment || e.keys?.[0] || "条目"}｜${keys}${marks ? `｜${marks}` : ""}｜指纹 ${fp(e.content ?? "")}`;
		});
		const head = kw ? `设定集含「${kw}」的条目 ${list.length}/${all.length} 条：` : `设定集共 ${list.length} 条：`;
		return {
			text: `${head}\n${lines.join("\n")}`,
			activity: `列设定${kw ? `「${kw}」` : ""}· ${list.length} 条`,
		};
	},
};

/**
 * 调用情境（D-T3）：某条设定与当前剧情/预设冲突，或用户说「别再用那条设定了」。
 *
 * ⚠ 复用 `config.disabledLore` 指纹通道——与 M-C2 的外部插件协议禁用是**同一机制**
 * （TOOLING M-D2 明示不得另起一套）。停用是**用户级**的：跨会话、跨卡保留。
 */
export const lorebookToggle: ToolSpec<LoreDeps> = {
	name: "lorebook_toggle",
	domain: "lore",
	mode: "write",
	surfaces: ["stage"],
	label: "启停世界书条目",
	description: () =>
		"启用/停用设定集条目（按指纹，指纹从 lorebook_list 取）。停用后该条不再注入上下文、检索也不命中。" +
		"用于某条设定与当前剧情冲突、或用户要求弃用某条设定时。" +
		"**这是用户级的持久开关**（跨会话保留），不是本拍的临时忽略——拿不准就先问用户。",
	parameters: () => ({
		type: "object",
		properties: {
			fingerprints: {
				type: "array",
				items: { type: "string" },
				description: "要启停的条目指纹（从 lorebook_list 取），可多条",
			},
			enabled: { type: "boolean", description: "true = 启用，false = 停用" },
		},
		required: ["fingerprints", "enabled"],
	}),
	async run(args, deps): Promise<ToolResult> {
		if (!deps.toggleLore) return { text: "本环境不支持启停世界书条目。" };

		const fps = Array.isArray(args.fingerprints)
			? args.fingerprints.filter((f): f is string => typeof f === "string" && f.trim().length > 0).map((f) => f.trim())
			: [];
		if (fps.length === 0) return { text: "缺少 fingerprints 参数（指纹从 lorebook_list 取）。" };
		if (typeof args.enabled !== "boolean") return { text: "缺少 enabled 参数（true = 启用，false = 停用）。" };

		const enabled = args.enabled;
		let count: number;
		try {
			count = deps.toggleLore(fps, enabled);
		} catch (err) {
			return { text: `启停失败：${errText(err)}` };
		}
		const verb = enabled ? "启用" : "停用";
		return {
			text: `已${verb} ${count} 条设定（用户级持久开关，跨会话保留）。${enabled ? "" : "停用的条目不再注入上下文，检索也不会命中。"}`,
			activity: `${verb}设定 · ${count} 条`,
		};
	},
};

// ---------------- M-D7：书一级（列 / 建 / 挂载）----------------
//
// 此前整族只有「条目」一级——agent 能往补充设定集里塞条目，却看不见项目里有哪些书、
// 建不了新书、也换不了挂载。用户 2026-08-22 定案：「agent 竟然连新建世界书的权限都没有，
// 这根本是工具化失败了」。以下三件补齐书一级。

/**
 * 调用情境：动书之前先看有什么书——建书前查重名、挂载前取路径、
 * 用户问「我这儿都有哪些世界书 / 现在挂了哪几本」。
 */
const lorebookFiles: ToolSpec<LoreDeps> = {
	name: "lorebook_files",
	domain: "lore",
	mode: "read",
	surfaces: ["stage"],
	label: "列世界书文件",
	description: () =>
		"列出项目里的全部世界书文件（路径/书名/条目数）并标出当前挂载了哪几本。" +
		"挂载的书才会进上下文与检索。要看条目用 lorebook_list，要看内容用 lorebook_search。",
	parameters: () => ({ type: "object", properties: {}, required: [] }),
	async run(_args, deps): Promise<ToolResult> {
		if (!deps.listBooks) return { text: "本环境不支持列举世界书文件。" };

		let shelf: { books: Array<{ path: string; name: string; entryCount: number }>; mounted: string[] };
		try {
			shelf = deps.listBooks();
		} catch (err) {
			return { text: `列举世界书失败：${errText(err)}` };
		}
		if (shelf.books.length === 0) {
			return { text: "项目里还没有世界书文件。", activity: "列世界书 · 0 本" };
		}
		const on = new Set(shelf.mounted);
		const lines = shelf.books.map(
			(b) => `- ${b.name}｜${b.entryCount} 条｜${on.has(b.path) ? "**已挂载**" : "未挂载"}｜${b.path}`,
		);
		return {
			text: `共 ${shelf.books.length} 本世界书（挂载 ${shelf.mounted.length} 本）：\n${lines.join("\n")}`,
			activity: `列世界书 · ${shelf.books.length} 本`,
			details: { mounted: shelf.mounted },
		};
	},
};

/**
 * 调用情境：用户说「把那本书挂上／取下来」，或新建的书写完第一条之后要生效。
 *
 * 与 `lorebook_toggle` 的分工：toggle 管**单条**，mount 管**整本**。
 * 二者都是用户级持久开关——拿不准就先问用户，别自作主张换语料。
 */
const lorebookMount: ToolSpec<LoreDeps> = {
	name: "lorebook_mount",
	domain: "lore",
	mode: "write",
	surfaces: ["stage"],
	label: "挂载/卸载世界书",
	description: () =>
		"挂载或卸载一本世界书（路径从 lorebook_files 取）。挂载的书才进上下文与检索。" +
		"**这是用户级的持久开关**（跨会话保留），换的是整局的语料——拿不准就先问用户。" +
		"单条的启停用 lorebook_toggle。",
	parameters: () => ({
		type: "object",
		properties: {
			path: { type: "string", description: "世界书路径（从 lorebook_files 取）" },
			mounted: { type: "boolean", description: "true = 挂上，false = 卸下" },
		},
		required: ["path", "mounted"],
	}),
	async run(args, deps): Promise<ToolResult> {
		if (!deps.mountBook) return { text: "本环境不支持挂载世界书。" };

		const path = strArg(args, "path");
		if (!path) return { text: "缺少 path 参数（路径从 lorebook_files 取）。" };
		if (typeof args.mounted !== "boolean") return { text: "缺少 mounted 参数（true = 挂上，false = 卸下）。" };

		const mounted = args.mounted;
		let list: string[];
		try {
			list = deps.mountBook(path, mounted);
		} catch (err) {
			return { text: `${mounted ? "挂载" : "卸载"}失败：${errText(err)}` };
		}
		return {
			text: `已${mounted ? "挂载" : "卸载"}${path}。当前挂载 ${list.length} 本${list.length ? `：${list.join("、")}` : ""}。下一拍起生效。`,
			activity: `${mounted ? "挂载" : "卸载"}世界书`,
			details: { mounted: list },
		};
	},
};

/** 世界书族全部工具（检索 / 列 / 启停 / 书一级列挂） */
export const loreTools: ToolSpec<LoreDeps>[] = [
	lorebookSearch,
	lorebookRead,
	lorebookList,
	lorebookToggle,
	lorebookFiles,
	lorebookMount,
];
