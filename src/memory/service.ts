/**
 * 记忆服务门面：
 *  - 剧情库 narrative：仅 agent 合并入库
 *  - 额外库 external：导入 + 手动向量化（条目可删）
 * 读写一律带 MemoryScope（角色卡 + 会话）
 */

import { memoryScopeId, loadMemoryConfig, patchMemoryConfig, publicMemoryConfig, saveMemoryConfig } from "./config.ts";
import type { EmbedContext } from "./embed.ts";
import {
	clearStore,
	countChunks,
	deleteChunkById,
	deleteStoreFiles,
	listChunks,
	mergeNarrativeText,
	reembedStore,
	searchStore,
	splitTextChunks,
	upsertTexts,
} from "./store.ts";
import type {
	MemoryChunkListItem,
	MemoryChunkMeta,
	MemoryConfig,
	MemoryScope,
	MemorySearchHit,
	MemoryStoreConfig,
	MemoryStoreStats,
} from "./types.ts";
import { memoryTextVersion } from "../card-memory-tools.ts";
import type { MemoryDocument, MemorySearchResult } from "../tools/memory.ts";

function embedCtxFrom(cfg: MemoryConfig): EmbedContext {
	return { mode: cfg.embedMode, cloud: cfg.cloudEmbed };
}

function normalizeScope(scope: MemoryScope | undefined): MemoryScope {
	return {
		sessionId: (scope?.sessionId || "_default").trim() || "_default",
		card: scope?.card?.trim() || undefined,
	};
}

function assertExtraStore(storeId: string): void {
	if (storeId === "narrative") {
		throw new Error("剧情数据库仅由 agent 自动合并写入，不能手动导入/添加");
	}
}

/**
 * 分支隔离（8/29）：剧情库此前只按 {卡, 会话} 存，没有分支这一维。
 * 重roll / rewind 丢弃的那一拍照样入库，下一拍又被【剧情记忆】召回，模型于是把废弃分支
 * 当「上一拍」续写（实测：13 次重roll 中第 5、10 拍入库，第 11 拍起开始写「承接上一拍」）。
 * 树、账本、面板本来都是 f(分支)，这里把同一坐标补齐。
 *
 * 判据是**数据**（chunk 自带 nodeId）不是启发式。三处一律**放行**——
 * 隔离漏一点，好过让用户的记忆整体消失：
 *  1. 没给 branchIds 或取树失败（空集）
 *  2. 非剧情库条目（导入/手动的资料与剧情分支无关）
 *  3. 老条目没有 nodeId（本次改动之前入的库）
 */
function onCurrentBranch(meta: MemoryChunkMeta, branchIds?: ReadonlySet<string>): boolean {
	if (!branchIds) return true;
	if (meta.source !== "narrative") return true;
	if (!meta.nodeId) return true;
	return branchIds.has(meta.nodeId);
}

export function getMemoryStatus(
	cwd: string,
	scope?: MemoryScope,
): {
	config: ReturnType<typeof publicMemoryConfig>;
	stores: MemoryStoreStats[];
	/** 当前作用域（设置面板展示：本对话的库） */
	scope: { sessionId: string; card?: string; scopeId: string };
} {
	const sc = normalizeScope(scope);
	const config = loadMemoryConfig(cwd);
	const stores: MemoryStoreStats[] = config.stores.map((s) => ({
		id: s.id,
		name: s.name,
		kind: s.kind,
		enabled: s.enabled,
		everyNTurns: s.everyNTurns,
		chunkCount: countChunks(cwd, sc, s.id),
		maxChunks: s.maxChunks,
	}));
	return {
		config: publicMemoryConfig(config),
		stores,
		scope: {
			sessionId: sc.sessionId,
			card: sc.card,
			scopeId: memoryScopeId(sc),
		},
	};
}

export function updateMemoryConfig(cwd: string, patch: Partial<MemoryConfig>): MemoryConfig {
	// apiKey 若前端回传掩码则不覆盖
	if (patch.cloudEmbed?.apiKey === "••••••••" || patch.cloudEmbed?.apiKey === "********") {
		const cur = loadMemoryConfig(cwd);
		patch = {
			...patch,
			cloudEmbed: { ...patch.cloudEmbed, apiKey: cur.cloudEmbed.apiKey },
		};
	}
	return patchMemoryConfig(cwd, patch);
}

export function updateStoreConfig(
	cwd: string,
	storeId: string,
	patch: Partial<MemoryStoreConfig>,
): MemoryConfig {
	const cfg = loadMemoryConfig(cwd);
	const stores = cfg.stores.map((s) => (s.id === storeId ? { ...s, ...patch, id: s.id } : s));
	return saveMemoryConfig(cwd, { ...cfg, stores });
}

export async function memorySearch(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
	query: string,
	topK?: number,
	/** 当前分支节点 id 集合；给了就滤掉废弃分支的剧情记忆（见 onCurrentBranch） */
	branchIds?: ReadonlySet<string>,
): Promise<MemorySearchHit[]> {
	const cfg = loadMemoryConfig(cwd);
	if (!cfg.enabled) return [];
	const store = cfg.stores.find((s) => s.id === storeId);
	if (!store?.enabled) return [];
	const sc = normalizeScope(scope);
	const hits = await searchStore(cwd, sc, storeId, query, topK ?? cfg.searchTopK, embedCtxFrom(cfg));
	return hits.filter((h) => onCurrentBranch(h.meta, branchIds));
}

/** 列出条目（无 embedding），供管理 UI */
export function memoryListChunks(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
	branchIds?: ReadonlySet<string>,
): MemoryChunkListItem[] {
	const cfg = loadMemoryConfig(cwd);
	const store = cfg.stores.find((s) => s.id === storeId);
	if (!store) throw new Error(`库不存在：${storeId}`);
	return listChunks(cwd, normalizeScope(scope), storeId).filter((c) => onCurrentBranch(c.meta, branchIds));
}

export async function memorySearchReport(cwd: string, scope: MemoryScope, query: string, branchIds: ReadonlySet<string>): Promise<MemorySearchResult> {
	const cfg = loadMemoryConfig(cwd);
	const results = await Promise.all(["narrative", "external"].map(async (store) => {
		if (!cfg.enabled || !cfg.stores.find((s) => s.id === store)?.enabled) return { hits: [], source: { scope: `session:${store}`, status: "disabled" as const } };
		try {
			const hits = await memorySearch(cwd, scope, store, query, undefined, branchIds);
			return { hits: hits.map((h) => ({ ...h, ref: `session:${store}:${h.id}`, meta: { ...h.meta, scope: h.meta.nodeId ? "current-branch" : "session" } })), source: { scope: `session:${store}`, status: "ok" as const } };
		} catch (e) { return { hits: [], source: { scope: `session:${store}`, status: "error" as const, error: e instanceof Error ? e.message : String(e) } }; }
	}));
	return { hits: results.flatMap((r) => r.hits).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 6), sources: results.map((r) => r.source) };
}

export function memoryReadChunk(cwd: string, scope: MemoryScope, ref: string, branchIds: ReadonlySet<string>): MemoryDocument | undefined {
	const match = /^session:(external|narrative):(.+)$/.exec(ref);
	if (!match) return undefined;
	const cfg = loadMemoryConfig(cwd);
	if (!cfg.enabled || !cfg.stores.find((s) => s.id === match[1])?.enabled) throw new Error("该会话记忆库已停用。");
	const chunk = memoryListChunks(cwd, scope, match[1], branchIds).find((c) => c.id === match[2]);
	return chunk ? { ref, text: chunk.text, version: memoryTextVersion(chunk.text), meta: { ...chunk.meta, scope: chunk.meta.nodeId ? "current-branch" : "session" } } : undefined;
}

/** 删除单条 */
export function memoryDeleteChunk(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
	chunkId: string,
): boolean {
	const cfg = loadMemoryConfig(cwd);
	const store = cfg.stores.find((s) => s.id === storeId);
	if (!store) throw new Error(`库不存在：${storeId}`);
	return deleteChunkById(cwd, normalizeScope(scope), storeId, chunkId);
}

/**
 * 额外库：手动向量化一条（不切碎长文以外的特殊逻辑；过长按块切，每块一条）。
 * 禁止写入剧情库。
 */
export async function memoryManualAdd(
	cwd: string,
	scope: MemoryScope,
	text: string,
	opts?: { title?: string; storeId?: string },
): Promise<{ added: number; total: number; chunks: number }> {
	const storeId = (opts?.storeId || "external").trim() || "external";
	assertExtraStore(storeId);
	const cfg = loadMemoryConfig(cwd);
	if (!cfg.enabled) throw new Error("请先启用向量记忆");
	const store = cfg.stores.find((s) => s.id === storeId);
	if (!store?.enabled) throw new Error(`库未启用：${store.name || storeId}`);
	const sc = normalizeScope(scope);
	const raw = text.trim();
	if (raw.length < 8) throw new Error("内容太短（至少约 8 字）");
	// 短文整条；长文切块，每块一个条目
	const parts = raw.length <= 800 ? [raw.slice(0, 4000)] : splitTextChunks(raw, 600);
	const r = await upsertTexts(
		cwd,
		sc,
		storeId,
		parts,
		{
			source: "manual",
			title: opts?.title?.trim() || undefined,
		},
		store.maxChunks,
		embedCtxFrom(cfg),
	);
	return { ...r, chunks: parts.length };
}

export async function memoryImportText(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
	text: string,
	fileName?: string,
): Promise<{ added: number; total: number; chunks: number }> {
	assertExtraStore(storeId);
	const cfg = loadMemoryConfig(cwd);
	if (!cfg.enabled) return { added: 0, total: 0, chunks: 0 };
	const store = cfg.stores.find((s) => s.id === storeId);
	if (!store?.enabled) return { added: 0, total: 0, chunks: 0 };
	const sc = normalizeScope(scope);
	const parts = splitTextChunks(text, 600);
	const r = await upsertTexts(
		cwd,
		sc,
		storeId,
		parts,
		{ source: "import", fileName, title: fileName },
		store.maxChunks,
		embedCtxFrom(cfg),
	);
	return { ...r, chunks: parts.length };
}

export function memoryClearStore(cwd: string, scope: MemoryScope, storeId: string): void {
	clearStore(cwd, normalizeScope(scope), storeId);
}

/** 删除自定义库配置 + 文件；内置 narrative/external 仅清空当前作用域 */
export function memoryRemoveStore(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
): MemoryConfig {
	const cfg = loadMemoryConfig(cwd);
	const store = cfg.stores.find((s) => s.id === storeId);
	if (!store) return cfg;
	const sc = normalizeScope(scope);
	if (store.kind === "narrative" || store.kind === "external") {
		clearStore(cwd, sc, storeId);
		return cfg;
	}
	deleteStoreFiles(cwd, sc, storeId);
	return saveMemoryConfig(cwd, {
		...cfg,
		stores: cfg.stores.filter((s) => s.id !== storeId),
	});
}

/**
 * 叙事轮结束：按 everyNTurns **合并**写入剧情库（仅 agent 路径）。
 * `tree` 给出本拍在会话树上的坐标——入库的条目带上 nodeId，此后只在该节点仍属当前分支时
 * 可见（见 onCurrentBranch）；不给则退回旧的「不分支」行为。
 */
export async function onNarrativeTurnEnd(
	cwd: string,
	scope: MemoryScope,
	assistantText: string,
	tree?: { nodeId?: string; branchIds?: ReadonlySet<string> },
): Promise<{
	stored: boolean;
	merged?: boolean;
	counter: number;
	added?: number;
	error?: string;
	noop?: boolean;
}> {
	const cfg = loadMemoryConfig(cwd);
	if (!cfg.enabled) return { stored: false, counter: 0 };
	const store = cfg.stores.find((s) => s.id === "narrative" && s.enabled);
	if (!store || store.everyNTurns <= 0) return { stored: false, counter: 0 };

	const sc = normalizeScope(scope);
	const key = memoryScopeId(sc);
	const counters = { ...(cfg.turnCounters ?? {}) };
	const next = (counters[key] ?? 0) + 1;
	counters[key] = next;
	saveMemoryConfig(cwd, { ...cfg, turnCounters: counters });

	if (next % store.everyNTurns !== 0) {
		return { stored: false, counter: next };
	}
	const text = assistantText.trim();
	if (text.length < 20) return { stored: false, counter: next };

	const summary = text.length > 1200 ? `${text.slice(0, 600)}\n…\n${text.slice(-400)}` : text;
	try {
		const r = await mergeNarrativeText(
			cwd,
			sc,
			summary,
			{
				source: "narrative",
				sessionId: sc.sessionId,
				card: sc.card,
				...(tree?.nodeId ? { nodeId: tree.nodeId } : {}),
			},
			store.maxChunks,
			embedCtxFrom(cfg),
			undefined,
			tree?.branchIds,
		);
		if (r.noop) return { stored: false, counter: next, noop: true, merged: r.merged };
		return {
			stored: true,
			merged: r.merged,
			counter: next,
			added: r.added,
		};
	} catch (e) {
		return { stored: false, counter: next, error: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * 压缩归档：被上下文压缩裁掉的早期正文**完整**入剧情库（source=archive）。
 * 与 onNarrativeTurnEnd 的滚动摘要互补——接力摘要管剧情连续性，归档管细节召回：
 * 正文被压掉后，具体对白/细节仍可被 memoryRecallForTurn 按相关性捞回。
 * 由压缩接线层 fire-and-forget 调用；失败只丢召回能力，不影响压缩本身。
 */
export async function memoryArchiveCompacted(
	cwd: string,
	scope: MemoryScope,
	text: string,
): Promise<{ archived: boolean; added?: number; chunks?: number; reason?: string }> {
	const cfg = loadMemoryConfig(cwd);
	if (!cfg.enabled) return { archived: false, reason: "memory disabled" };
	const store = cfg.stores.find((s) => s.id === "narrative" && s.enabled);
	if (!store) return { archived: false, reason: "narrative store disabled" };
	const raw = text.trim();
	if (raw.length < 20) return { archived: false, reason: "text too short" };

	const sc = normalizeScope(scope);
	const parts = splitTextChunks(raw, 600);
	const r = await upsertTexts(
		cwd,
		sc,
		"narrative",
		parts,
		{ source: "archive", title: "早期剧情归档", sessionId: sc.sessionId, card: sc.card },
		store.maxChunks,
		embedCtxFrom(cfg),
	);
	return { archived: r.added > 0, added: r.added, chunks: parts.length };
}

/**
 * 剧情回合检索：仅搜**当前卡+当前对话**已启用库，供 buildTurnInjection 注入。
 */
export async function memoryRecallForTurn(
	cwd: string,
	scope: MemoryScope,
	query: string,
	/** 当前分支节点 id 集合；给了就滤掉废弃分支的剧情记忆（见 onCurrentBranch） */
	branchIds?: ReadonlySet<string>,
): Promise<MemorySearchHit[]> {
	const cfg = loadMemoryConfig(cwd);
	if (!cfg.enabled || !cfg.injectOnTurn) return [];
	const q = query.trim();
	if (q.length < 2) return [];
	const sc = normalizeScope(scope);
	const ctx = embedCtxFrom(cfg);
	const merged: MemorySearchHit[] = [];
	for (const s of cfg.stores) {
		if (!s.enabled) continue;
		try {
			const hits = await searchStore(cwd, sc, s.id, q, cfg.searchTopK, ctx);
			for (const h of hits) {
				if (!onCurrentBranch(h.meta, branchIds)) continue;
				merged.push({
					...h,
					meta: { ...h.meta, title: h.meta.title || s.name },
				});
			}
		} catch (e) {
			console.warn("[memory] search store failed", s.id, e);
		}
	}
	merged.sort((a, b) => b.score - a.score);
	const out: MemorySearchHit[] = [];
	for (const h of merged) {
		if (out.some((x) => x.text.slice(0, 80) === h.text.slice(0, 80))) continue;
		out.push(h);
		if (out.length >= cfg.searchTopK) break;
	}
	return out;
}

/** 探测云端 embedding 是否可用 */
export async function probeCloudEmbed(cwd: string): Promise<{ ok: boolean; dim?: number; error?: string }> {
	const cfg = loadMemoryConfig(cwd);
	try {
		const { embedTextsCloud } = await import("./embed.ts");
		const vecs = await embedTextsCloud(["梨园记忆探测"], cfg.cloudEmbed);
		return { ok: true, dim: vecs[0]?.length };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

type MemoryReembedResult = {
	mode: "local" | "cloud";
	model: string;
	stores: Array<{ storeId: string; name: string; total: number; updated: number; skipped: number }>;
	totalUpdated: number;
	totalChunks: number;
};

/**
 * 用**当前** embed 模式，对本对话全部（或指定）库的已有正文重算向量。
 * 不删文本、不调聊天模型；云端只花 embedding 费用。
 */
export async function memoryReembedScope(
	cwd: string,
	scope: MemoryScope,
	opts?: { storeId?: string },
): Promise<MemoryReembedResult> {
	const cfg = loadMemoryConfig(cwd);
	if (!cfg.enabled) throw new Error("请先启用向量记忆");
	const sc = normalizeScope(scope);
	const ctx = embedCtxFrom(cfg);
	const model = ctx.mode === "cloud" ? ctx.cloud.model || "cloud" : "local-hash-v1";
	if (ctx.mode === "cloud") {
		const base = (ctx.cloud.baseUrl || "").trim();
		const key = (ctx.cloud.apiKey || "").trim();
		const m = (ctx.cloud.model || "").trim();
		if (!base || !key || !m) throw new Error("云端 embedding 未配置完整（Base URL / API Key / 模型）");
	}

	const targets = opts?.storeId
		? cfg.stores.filter((s) => s.id === opts.storeId)
		: cfg.stores;
	if (!targets.length) throw new Error(opts?.storeId ? `库不存在：${opts.storeId}` : "无可用库");

	const stores: MemoryReembedResult["stores"] = [];
	let totalUpdated = 0;
	let totalChunks = 0;
	for (const s of targets) {
		const r = await reembedStore(cwd, sc, s.id, ctx);
		stores.push({
			storeId: s.id,
			name: s.name,
			total: r.total,
			updated: r.updated,
			skipped: r.skipped,
		});
		totalUpdated += r.updated;
		totalChunks += r.total;
	}
	return { mode: ctx.mode, model, stores, totalUpdated, totalChunks };
}
