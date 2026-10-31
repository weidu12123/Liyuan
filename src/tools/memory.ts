/**
 * 向量库族工具（PLAN-RP-TOOLING M-D3）。
 *
 * 服务层 `src/memory/service.ts` 有 17 个导出，合一前**只有 `memory_search` 一件只读工具**
 * （台上 `src/stage/tools.ts` 与扩展 `roleplay.ts:619` 各写一份，助手侧一件也没有）——
 * 全盘工具化里缺口最大的一族。
 *
 * ## 作用域语义（2026-08-04 用户拍板，契约点名的硬前置）
 *
 * `MemoryScope = {sessionId, card}` **对模型完全不可见**，由宿主从「当前对话 + 当前卡」派生。
 * 这是本族最容易被说谎的地方：向量记忆按 `cardHash__sessionId` 隔离，
 * **写进去的东西不跨会话**。故 `memory_add` 的描述必须把这条钉死，
 * 否则模型会拿它当长期记忆用，让用户以为「它记住了」而换个对话就没了。
 *
 * `store` 只在 `memory_list` 上暴露（两库性质不同，纵览时要能分）：
 *   - 写侧**不给 store 参数**——服务层 `assertExtraStore` 对 `narrative` 硬抛
 *     （探针实证），合法值只剩 `external` 一个；只有一个合法值就不该让模型选，
 *     否则等于把一个必然失败的选项摆在它面前。
 *   - `memory_search` 沿用现状（合并两库取前 N），不按库拆——检索时模型不关心
 *     一条记忆当初是从哪个通道进来的。
 *   - `memory_delete` 不给 store 参数：id 自带归属，由 `memory_list` 回传。
 *
 * ## 工具粒度（D-T3）
 *
 * 契约候选四件里 **`memory_import` 并入 `memory_add`**：对模型而言两者是同一个情境
 * （「把这段文字存进记忆」），差别只在 metadata 与切块策略，那是 UI 与服务层的事。
 * 多一个工具只会让模型多做一次「这算 add 还是 import」的无谓判断。
 */

import { checkWriteGate } from "./gate.ts";
import { errText, intArg, strArg, type ToolResult, type ToolSpec } from "./registry.ts";

/** 命中条目的结构子集（与 stage 的 MemoryHitLike 同形，便于离线单测） */
export interface MemoryHitLike {
	text: string;
	ref?: string;
	version?: string;
	score?: number;
	meta?: { title?: string; fileName?: string; source?: string; scope?: string; nodeId?: string; chatId?: string };
}

export interface MemorySearchResult {
	hits: MemoryHitLike[];
	sources: Array<{ scope: string; status: "ok" | "disabled" | "unavailable" | "error"; error?: string }>;
}
export interface MemoryDocument extends MemoryHitLike { ref: string; version: string; relatedRefs?: string[]; note?: string }

/** 列表条目的结构子集 */
export interface MemoryChunkLike {
	id: string;
	ref?: string;
	text: string;
	textLen?: number;
	createdAt?: string;
	meta?: { title?: string; fileName?: string; source?: string };
}

export interface MemoryDeps {
	/** 检索本对话记忆（合并两库，宿主已按 scope 绑定）；未注入＝台上无 memory_search */
	searchMemory: (query: string) => Promise<MemoryHitLike[] | MemorySearchResult>;
	readMemory?: (ref: string) => MemoryDocument | undefined;
	updateMemory?: (ref: string, version: string, content: string) => MemoryDocument;

	// ---- 以下为 M-D3 新增；未注入则该工具不上清单（依赖缺失的工具不上清单，见 adapters/stage.ts） ----

	/** 写一段文字进额外库（恒 external，服务层禁写 narrative）；回落盘条数 */
	addMemory?: (input: { text: string; title?: string }) => Promise<{ added: number; total: number; chunks: number }>;
	/** 列举某库条目（不含向量）；storeId 缺省 external */
	listMemory?: (storeId: string) => MemoryChunkLike[];
	/** 按 id 删除；返回是否删到 */
	deleteMemory?: (storeId: string, id: string, version?: string) => boolean;
	/** 本拍用户原文 + 门禁档位（写侧门禁判定用，见 gate.ts） */
	gate?: () => { lastUserText: string; creationMode?: "ask" | "silent" };
}

/** 两个内置库的对外名字（服务层 id → 模型可读标签） */
const STORE_LABEL: Record<string, string> = { narrative: "剧情库", external: "额外库", card: "项目记忆", chat: "项目记忆" };

/** 列举默认/最大条数：目录太长会挤爆上下文，且模型只是要个纵览 */
const LIST_LIMIT = 20;
const LIST_MAX = 60;
/** 列举时每条正文的预览长度（只给目录不给正文，取细节走 memory_search） */
const PREVIEW_CHARS = 40;

const previewOf = (text: string): string => {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
};

/** 来源标签：manual/import 是人写的，narrative/archive 是演出来的——纵览时要能分 */
const SOURCE_LABEL: Record<string, string> = {
	manual: "手动录入",
	import: "导入资料",
	narrative: "剧情摘要",
	archive: "早期归档",
};

/**
 * 调用情境（D-T3）：模型要回忆「早先发生过什么」——被压缩出上下文的正文、往期摘要、导入资料。
 *
 * 合一前三份实现（台上 / 扩展 / 无助手）文案各不相同但语义一致，此处取台上那版
 * （无命中话术最完整：明确禁止臆造并给出「模糊化处理」的出路）。
 */
export const memorySearch: ToolSpec<MemoryDeps> = {
	name: "memory_search",
	domain: "memory",
	mode: "read",
	surfaces: ["stage", "extension"],
	label: "检索剧情记忆",
	description: (ctx) =>
		ctx.surface === "stage"
			? `检索当前分支的会话记忆，以及当前卡的 Markdown 手册、常驻摘要与各局复盘。每条带来源与 ref；往局复盘不等于本局已发生的事实。` +
				`重新带回【登场名录】里那些你已记不清细节的人物/物品/剧情线之前，必须先查——不得臆造早先已确立的事实。` +
				`用${ctx.language}检索。`
			: `检索当前剧情对话的记忆库（剧情摘要、早期归档正文、导入资料），用于诊断「模型记得什么」。` +
				`记忆按对话隔离，此处搜的是**当前**剧情会话的库。`,
	parameters: () => ({
		type: "object",
		properties: {
			query: { type: "string", description: "关键词或一句话问题（关于过去发生的事）" },
		},
		required: ["query"],
	}),
	async run(args, deps, ctx): Promise<ToolResult> {
		const stage = ctx.surface === "stage";
		const query = strArg(args, "query");
		if (!query) return { text: "缺少 query 参数。" };

		let hits: MemoryHitLike[] = [];
		let sourceReport: MemorySearchResult["sources"] = [];
		try {
			const result = await deps.searchMemory(query);
			hits = Array.isArray(result) ? result : result.hits;
			if (!Array.isArray(result)) sourceReport = result.sources;
		} catch (err) {
			return {
				isError: true,
				text: stage
					? `剧情库检索失败：${errText(err)}。按已知事实继续写。`
					: `剧情库检索失败：${errText(err)}`,
			};
		}

		if (hits.length === 0) {
			if (sourceReport.length) return {
				text: JSON.stringify({ hits: [], sources: sourceReport }),
				isError: sourceReport.every((s) => s.status === "error" || s.status === "unavailable"),
				activity: `查记忆「${query}」· 无命中`,
			};
			return {
				text: stage
					? "剧情库无命中（可能未启用向量记忆，或该内容未被归档）。不要臆造当年的具体细节——" +
						"正文里模糊化处理（角色可以「记不太清」），或沿用【世界状态】【登场名录】里已有的事实。"
					: `（记忆库未命中「${query}」；也可能是向量记忆未启用，或该内容尚未入库。）`,
				activity: `查剧情库「${query}」· 无命中`,
			};
		}

		const text = hits
			.map((h, i) => {
				const tag = h.meta?.title || h.meta?.fileName || h.meta?.source || "记忆";
				return `${i + 1}. 〔${tag}〕${h.ref ? ` ref: ${h.ref}` : ""}${h.meta?.scope ? ` 来源范围: ${h.meta.scope}` : ""}${h.meta?.chatId ? ` 局: ${h.meta.chatId}` : ""}${h.meta?.nodeId ? ` 节点: ${h.meta.nodeId}` : ""}\n${h.text}`;
			})
			.join("\n\n");
		return {
			text: (sourceReport.length ? JSON.stringify({ sources: sourceReport }) + "\n\n" : "") + text,
			activity: `查剧情库「${query}」· ${hits.length} 条`,
			details: { count: hits.length },
		};
	},
};

/**
 * 调用情境（D-T3）：用户说「记住这个设定/这段前情」，或给了一大段资料让模型日后能查。
 *
 * 本工具写向量库，**只活在当前对话**，靠语义检索取回，适合长资料/前情/小传。
 * 模型最容易犯的错是拿它当长期记忆用，然后告诉用户「我永远记住了」。
 */
export const memoryAdd: ToolSpec<MemoryDeps> = {
	name: "memory_add",
	domain: "memory",
	mode: "write",
	surfaces: ["stage"],
	label: "写入剧情记忆",
	description: () =>
		"把用户明确要求记住的长文字存进**本对话的**记忆库（前情梗概、人物小传、大段参考资料），此后 memory_search 可按语义检索到。" +
		"**仅在用户明确要求记住时调用**——不要自作主张写，也不要反问「要不要记下来」。" +
		"⚠ 记忆按对话隔离：写进去的内容**不跨会话**，换一个对话就查不到了——本工具只收本局用得上的长文字。" +
		"不要往这里灌自己刚写的正文（下一拍会被当成既定事实捞回来）——剧情进展自有去处，不归这里。",
	parameters: () => ({
		type: "object",
		properties: {
			text: { type: "string", description: "要记住的正文（至少约 8 字；过长会自动切块入库）" },
			title: { type: "string", description: "条目标题，便于日后辨认来源（如「主角前世经历」）" },
		},
		required: ["text"],
	}),
	async run(args, deps): Promise<ToolResult> {
		if (!deps.addMemory) return { text: "本环境不支持写入记忆库。" };

		const text = strArg(args, "text");
		if (!text) return { text: "缺少 text 参数。" };

		// 写入门禁（D-T4）：仅在用户本轮明确要求时放行
		const g = deps.gate?.();
		if (g) {
			const verdict = checkWriteGate({
				toolName: "memory_add",
				lastUserText: g.lastUserText,
				creationMode: g.creationMode,
			});
			if (!verdict.allow) return { text: verdict.reason, activity: "写记忆 · 门禁拦下" };
		}

		const title = strArg(args, "title");
		let r: { added: number; total: number; chunks: number };
		try {
			r = await deps.addMemory({ text, ...(title ? { title } : {}) });
		} catch (err) {
			// 服务层会因「未启用向量记忆」「库未启用」「内容太短」抛，原文回给模型即可
			return { text: `写入记忆库失败：${errText(err)}` };
		}

		if (r.added === 0) {
			return { text: "内容已在记忆库中（无新增）。", activity: "写记忆 · 重复跳过" };
		}
		return {
			text:
				`已存入本对话的记忆库${title ? `：【${title}】` : ""}（${r.added} 条，库中共 ${r.total} 条）。` +
				`此后 memory_search 可检索到。注意这条记忆**只在当前对话有效**。`,
			activity: `写记忆${title ? `「${title}」` : ""}· ${r.added} 条`,
			details: { added: r.added, total: r.total },
		};
	},
};

/**
 * 调用情境（D-T3）：模型要答「我记住过什么」——检索靠语义命中，
 * 答不了「库里都有哪些条目」；也是 `memory_delete` 取 id 的**唯一**入口。
 */
export const memoryList: ToolSpec<MemoryDeps> = {
	name: "memory_list",
	domain: "memory",
	mode: "read",
	surfaces: ["stage"],
	label: "列举记忆条目",
	description: () =>
		"列举本对话记忆库的条目目录（编号、开头几十字、来源）。用于纵览「记过些什么」，" +
		"或为 memory_delete 取条目编号。要看某条的完整内容请用 memory_search——本工具只给目录不给正文。",
	parameters: () => ({
		type: "object",
		properties: {
			store: {
				type: "string",
				enum: ["external", "narrative", "card", "chat"],
				description: "chat/card＝当前项目的 Markdown 记忆文档（记忆/*.md 与局部守则）；external＝手动录入与导入的资料（缺省）；narrative＝自动生成的剧情摘要与早期归档",
			},
			keyword: { type: "string", description: "只列正文或标题含此字样的条目（缺省列全部）" },
			limit: { type: "number", description: `最多列几条（默认 ${LIST_LIMIT}，上限 ${LIST_MAX}）` },
		},
		required: [],
	}),
	async run(args, deps): Promise<ToolResult> {
		if (!deps.listMemory) return { text: "本环境不支持列举记忆条目。" };

		const store = ["narrative", "card", "chat"].includes(strArg(args, "store")) ? (strArg(args, "store") === "chat" ? "card" : strArg(args, "store")) : "external";
		const label = STORE_LABEL[store] ?? store;

		let all: MemoryChunkLike[];
		try {
			all = deps.listMemory(store);
		} catch (err) {
			return { text: `列举${label}失败：${errText(err)}` };
		}

		const kw = strArg(args, "keyword").toLowerCase();
		const matched = kw
			? all.filter(
					(c) =>
						c.text.toLowerCase().includes(kw) || (c.meta?.title ?? "").toLowerCase().includes(kw),
				)
			: all;

		if (matched.length === 0) {
			return {
				text: kw
					? `${label}共 ${all.length} 条，无含「${kw}」的条目。`
					: `${label}是空的（尚无条目）。`,
				activity: `列记忆${kw ? `「${kw}」` : ""}· 0 条`,
			};
		}

		const limit = intArg(args, "limit", LIST_LIMIT, 1, LIST_MAX);
		const shown = matched.slice(0, limit);
		const lines = shown.map((c) => {
			const src = c.meta?.source ? SOURCE_LABEL[c.meta.source] ?? c.meta.source : "";
			const tag = c.meta?.title || c.meta?.fileName || "";
			const marks = [tag, src, `${c.textLen ?? c.text.length} 字`].filter(Boolean).join("·");
			return `- [${c.id}] ref: ${c.ref ?? `session:${store}:${c.id}`} ${previewOf(c.text)}${marks ? `｜${marks}` : ""}`;
		});
		// 截断必须说出来：只报 shown 会让模型以为库里就这些（"no silent caps"）
		const head =
			`${label}${kw ? `含「${kw}」的条目` : ""} ${shown.length}/${matched.length} 条` +
			`${matched.length > shown.length ? `（其余 ${matched.length - shown.length} 条未列出，可加 keyword 缩小范围）` : ""}：`;
		return {
			text: `${head}\n${lines.join("\n")}`,
			activity: `列记忆${kw ? `「${kw}」` : ""}· ${shown.length} 条`,
			details: { store, total: matched.length, shown: shown.length },
		};
	},
};

/**
 * 调用情境（D-T3）：用户指出某条记忆记错了、或要求把某件事忘掉。
 *
 * ⚠ 门禁走的是 `DELETE_REQUEST_RE` 而非写入信号（gate.ts）——用户说「把那条忘掉」
 * 不含任何写入词，用写入信号判会被错拦。
 */
export const memoryDelete: ToolSpec<MemoryDeps> = {
	name: "memory_delete",
	domain: "memory",
	mode: "write",
	surfaces: ["stage"],
	label: "删除记忆条目",
	description: () =>
		"删除本对话记忆库里的某条条目（编号从 memory_list 取）。" +
		"用于用户指出某条记忆记错了、或明确要求忘掉某件事。" +
		"**仅在用户明确要求删除时调用**——删除不可逆，且用户不易察觉少了哪条；" +
		"你自己觉得某条记忆不对，就在正文里绕开它，不要删。",
	parameters: () => ({
		type: "object",
		properties: {
			id: { type: "string", description: "条目编号（从 memory_list 的 [编号] 取）" },
			version: { type: "string", description: "删除卡级文档必填，取自 memory_read。" },
			store: {
				type: "string",
				enum: ["external", "narrative", "card", "chat"],
				description: "该条目所在的库（与 memory_list 时用的一致；缺省 external）",
			},
		},
		required: ["id"],
	}),
	async run(args, deps): Promise<ToolResult> {
		if (!deps.deleteMemory) return { text: "本环境不支持删除记忆条目。" };

		const id = strArg(args, "id");
		if (!id) return { text: "缺少 id 参数（条目编号从 memory_list 取）。" };

		// 门禁：删除认删除信号，不认写入信号（见 gate.ts signalFor）
		const g = deps.gate?.();
		if (g) {
			const verdict = checkWriteGate({
				toolName: "memory_delete",
				lastUserText: g.lastUserText,
				creationMode: g.creationMode,
			});
			if (!verdict.allow) return { text: verdict.reason, activity: "删记忆 · 门禁拦下" };
		}

		const store = ["narrative", "card", "chat"].includes(strArg(args, "store")) ? (strArg(args, "store") === "chat" ? "card" : strArg(args, "store")) : "external";
		const label = STORE_LABEL[store] ?? store;
		let ok: boolean;
		try {
			ok = deps.deleteMemory(store, id, strArg(args, "version") || undefined);
		} catch (err) {
			return { text: `删除记忆失败：${errText(err)}` };
		}
		if (!ok) {
			return {
				text: `${label}中没有编号 ${id} 的条目（可能已删除，或编号来自另一个库）。先用 memory_list 取准确编号。`,
				activity: "删记忆 · 未命中",
			};
		}
		return {
			text: `已从${label}删除条目 ${id}（不可恢复）。`,
			activity: `删记忆 · 1 条`,
			details: { store, id },
		};
	},
};

/** 向量库族全部工具（M-D3；memory_search 由本族接管，原台上/扩展两份实现合一） */
export const memoryRead: ToolSpec<MemoryDeps> = {
	name: "memory_read", domain: "memory", mode: "read", surfaces: ["stage"], label: "读取记忆原文",
	description: () => "按 memory_search/list 的 ref 精确读取记忆及内容版本。保留来源、局与分支范围；start/end 为字符偏移，end 不含。",
	parameters: () => ({ type: "object", properties: { ref: { type: "string" }, start: { type: "integer", minimum: 0 }, end: { type: "integer", minimum: 0 } }, required: ["ref"] }),
	async run(args, deps) {
		try {
			if (!deps.readMemory) throw new Error("记忆读取不可用");
			const doc = deps.readMemory(strArg(args, "ref"));
			if (!doc) throw new Error("引用已失效或不在当前允许的记忆范围");
			const start = args.start === undefined ? 0 : Number(args.start), end = args.end === undefined ? doc.text.length : Number(args.end);
			if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > doc.text.length) throw new Error("读取范围无效");
			return { text: JSON.stringify({ ...doc, text: doc.text.slice(start, end), start, end, total: doc.text.length }), activity: "读记忆原文" };
		} catch (e) { return { text: errText(e), isError: true }; }
	},
};

const memoryUpdate: ToolSpec<MemoryDeps> = {
	name: "memory_update", domain: "memory", mode: "write", surfaces: ["stage"], label: "更正项目记忆",
	description: () => "按 ref（如 chat:MEMORY、chat:大纲、chat:APPEND_SYSTEM）与可选版本号更新当前项目的 Markdown 记忆或局部守则文档，并自动同步 MEMORY.md 索引。",
	parameters: () => ({ type: "object", properties: { ref: { type: "string" }, version: { type: "string" }, content: { type: "string" } }, required: ["ref", "content"] }),
	async run(args, deps) {
		try {
			const g = deps.gate?.();
			if (g) { const verdict = checkWriteGate({ toolName: "memory_update", ...g }); if (!verdict.allow) throw new Error(verdict.reason); }
			if (!deps.updateMemory) throw new Error("项目记忆修改不可用");
			if (typeof args.content !== "string" || !args.content.trim()) throw new Error("content 为空；遗忘文档请用 memory_delete");
			const doc = deps.updateMemory(strArg(args, "ref"), strArg(args, "version"), args.content);
			return { text: JSON.stringify(doc), activity: "已更正项目记忆" };
		} catch (e) { return { text: errText(e), isError: true }; }
	},
};

export const memoryTools: ToolSpec<MemoryDeps>[] = [memorySearch, memoryRead, memoryUpdate, memoryAdd, memoryList, memoryDelete];
