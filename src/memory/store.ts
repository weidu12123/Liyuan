/**
 * 单库落盘：JSONL chunks + 简易暴力余弦检索
 * 路径：`.liyuan-memory/scopes/<card+session>/stores/<storeId>/chunks.jsonl`
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { memoryScopeRoot } from "./config.ts";
import { cosine, type EmbedContext, embedMany, embedOne } from "./embed.ts";
import type {
	MemoryChunk,
	MemoryChunkListItem,
	MemoryChunkMeta,
	MemoryScope,
	MemorySearchHit,
} from "./types.ts";
import { NARRATIVE_MERGE_MAX_CHARS } from "./types.ts";

function storeDir(cwd: string, scope: MemoryScope, storeId: string): string {
	return join(memoryScopeRoot(cwd, scope), "stores", storeId);
}

function chunksPath(cwd: string, scope: MemoryScope, storeId: string): string {
	return join(storeDir(cwd, scope, storeId), "chunks.jsonl");
}

function ensureStoreDir(cwd: string, scope: MemoryScope, storeId: string): void {
	const d = storeDir(cwd, scope, storeId);
	if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

export function loadChunks(cwd: string, scope: MemoryScope, storeId: string): MemoryChunk[] {
	const p = chunksPath(cwd, scope, storeId);
	if (!existsSync(p)) return [];
	const lines = readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean);
	const out: MemoryChunk[] = [];
	for (const line of lines) {
		try {
			const c = JSON.parse(line) as MemoryChunk;
			if (c?.id && c.text && Array.isArray(c.embedding)) out.push(c);
		} catch {
			/* skip bad line */
		}
	}
	return out;
}

function persistChunks(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
	chunks: MemoryChunk[],
): void {
	ensureStoreDir(cwd, scope, storeId);
	const body = chunks.map((c) => JSON.stringify(c)).join("\n") + (chunks.length ? "\n" : "");
	writeFileSync(chunksPath(cwd, scope, storeId), body, "utf8");
}

export function countChunks(cwd: string, scope: MemoryScope, storeId: string): number {
	const p = chunksPath(cwd, scope, storeId);
	if (!existsSync(p)) return 0;
	return readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean).length;
}

export function clearStore(cwd: string, scope: MemoryScope, storeId: string): void {
	const d = storeDir(cwd, scope, storeId);
	if (existsSync(d)) rmSync(d, { recursive: true, force: true });
}

export function deleteStoreFiles(cwd: string, scope: MemoryScope, storeId: string): void {
	clearStore(cwd, scope, storeId);
}

/** 切块：按段落/长度 */
export function splitTextChunks(text: string, maxLen = 480): string[] {
	const t = text.replace(/\r\n/g, "\n").trim();
	if (!t) return [];
	const paras = t
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter(Boolean);
	const out: string[] = [];
	let buf = "";
	const flush = () => {
		if (buf.trim()) out.push(buf.trim());
		buf = "";
	};
	for (const p of paras.length ? paras : [t]) {
		if (p.length <= maxLen) {
			if ((buf + "\n\n" + p).length > maxLen) {
				flush();
				buf = p;
			} else {
				buf = buf ? `${buf}\n\n${p}` : p;
			}
			continue;
		}
		flush();
		for (let i = 0; i < p.length; i += maxLen) out.push(p.slice(i, i + maxLen));
	}
	flush();
	return out;
}

export async function upsertTexts(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
	texts: string[],
	meta: MemoryChunkMeta,
	maxChunks: number,
	embedCtx: EmbedContext,
): Promise<{ added: number; total: number }> {
	const chunks = loadChunks(cwd, scope, storeId);
	const now = new Date().toISOString();
	const fresh = texts.map((t) => t.trim()).filter((t) => t.length >= 8);
	const toAdd: string[] = [];
	for (const trimmed of fresh) {
		if (chunks.some((c) => c.text === trimmed)) continue;
		toAdd.push(trimmed.slice(0, 4000));
	}
	if (!toAdd.length) return { added: 0, total: chunks.length };

	const vectors = await embedMany(toAdd, embedCtx);
	const mode = embedCtx.mode;
	const model = mode === "cloud" ? embedCtx.cloud.model : "local-hash-v1";
	for (let i = 0; i < toAdd.length; i++) {
		chunks.push({
			id: randomBytes(8).toString("hex"),
			text: toAdd[i]!,
			embedding: vectors[i]!,
			meta: {
				...meta,
				sessionId: scope.sessionId,
				card: scope.card,
				embedMode: mode,
				embedModel: model,
			},
			createdAt: now,
		});
	}
	while (chunks.length > maxChunks) chunks.shift();
	persistChunks(cwd, scope, storeId, chunks);
	return { added: toAdd.length, total: chunks.length };
}

/** 列表条目（不含 embedding） */
export function listChunks(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
): MemoryChunkListItem[] {
	return loadChunks(cwd, scope, storeId).map((c) => ({
		id: c.id,
		text: c.text,
		textLen: c.text.length,
		meta: c.meta,
		createdAt: c.createdAt,
	}));
}

/** 按 id 删除单条；返回是否删到 */
export function deleteChunkById(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
	chunkId: string,
): boolean {
	const id = chunkId.trim();
	if (!id) return false;
	const chunks = loadChunks(cwd, scope, storeId);
	const next = chunks.filter((c) => c.id !== id);
	if (next.length === chunks.length) return false;
	if (next.length === 0) {
		clearStore(cwd, scope, storeId);
		return true;
	}
	persistChunks(cwd, scope, storeId, next);
	return true;
}

/**
 * 剧情库合并入库：优先并入**最后一条**（未超字数上限则合并并重 embed）；
 * 否则新开一条。禁止产生「每轮一条」的爆炸条数。
 */
export async function mergeNarrativeText(
	cwd: string,
	scope: MemoryScope,
	text: string,
	meta: MemoryChunkMeta,
	maxChunks: number,
	embedCtx: EmbedContext,
	maxEntryChars = NARRATIVE_MERGE_MAX_CHARS,
	/** 当前分支的节点 id 集合；给了就只续写本分支的条目（空集/省略 = 不判，旧行为） */
	branchIds?: ReadonlySet<string>,
): Promise<{ merged: boolean; added: number; total: number; id: string; noop?: boolean }> {
	const summary = text.trim();
	if (summary.length < 8) {
		return { merged: false, added: 0, total: countChunks(cwd, scope, "narrative"), id: "", noop: true };
	}
	const body = summary.slice(0, 4000);
	const chunks = loadChunks(cwd, scope, "narrative");
	const now = new Date().toISOString();
	const mode = embedCtx.mode;
	const model = mode === "cloud" ? embedCtx.cloud.model : "local-hash-v1";
	const last = chunks.length ? chunks[chunks.length - 1]! : null;

	// 完全相同则跳过
	if (last && last.text === body) {
		return { merged: true, added: 0, total: chunks.length, id: last.id, noop: true };
	}
	// 已包含本次摘要开头 → 视为重复
	if (last && body.length >= 24 && last.text.includes(body.slice(0, Math.min(80, body.length)))) {
		return { merged: true, added: 0, total: chunks.length, id: last.id, noop: true };
	}

	const canMerge =
		!!last &&
		last.meta.source === "narrative" &&
		// 只续写**本分支**的条目：合并进废弃分支那条，会把它的正文连同新 nodeId 一起「复活」，
		// 分支隔离当场失效。判不了（没给 branchIds / 老条目无 nodeId）就新开一条，宁可多一条。
		(!branchIds || branchIds.size === 0 || (!!last.meta.nodeId && branchIds.has(last.meta.nodeId))) &&
		`${last.text}\n\n${body}`.length <= Math.max(400, maxEntryChars);

	if (canMerge && last) {
		const mergedText = `${last.text}\n\n${body}`;
		const emb = await embedOne(mergedText, embedCtx);
		last.text = mergedText;
		last.embedding = emb;
		last.meta = {
			...last.meta,
			...meta,
			sessionId: scope.sessionId,
			card: scope.card,
			source: "narrative",
			embedMode: mode,
			embedModel: model,
			mergeCount: (last.meta.mergeCount ?? 1) + 1,
			updatedAt: now,
		};
		persistChunks(cwd, scope, "narrative", chunks);
		return { merged: true, added: 0, total: chunks.length, id: last.id };
	}

	const emb = await embedOne(body, embedCtx);
	const id = randomBytes(8).toString("hex");
	chunks.push({
		id,
		text: body,
		embedding: emb,
		meta: {
			...meta,
			sessionId: scope.sessionId,
			card: scope.card,
			source: "narrative",
			embedMode: mode,
			embedModel: model,
			mergeCount: 1,
			updatedAt: now,
		},
		createdAt: now,
	});
	while (chunks.length > maxChunks) chunks.shift();
	persistChunks(cwd, scope, "narrative", chunks);
	return { merged: false, added: 1, total: chunks.length, id };
}

/**
 * 保留原文，用当前 embed 模式重算本库全部向量（换 local/cloud 时用，不重写剧情）。
 * 云端按 batchSize 分批调用 embeddings。
 */
export async function reembedStore(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
	embedCtx: EmbedContext,
	batchSize = 32,
): Promise<{ total: number; updated: number; skipped: number }> {
	const chunks = loadChunks(cwd, scope, storeId);
	if (!chunks.length) return { total: 0, updated: 0, skipped: 0 };

	const mode = embedCtx.mode;
	const model = mode === "cloud" ? embedCtx.cloud.model : "local-hash-v1";
	const size = Math.max(1, Math.min(64, Math.floor(batchSize) || 32));
	let updated = 0;
	let skipped = 0;

	for (let i = 0; i < chunks.length; i += size) {
		const batch = chunks.slice(i, i + size);
		const texts = batch.map((c) => c.text);
		const vectors = await embedMany(texts, embedCtx);
		for (let j = 0; j < batch.length; j++) {
			const c = batch[j]!;
			const v = vectors[j];
			if (!v?.length) {
				skipped++;
				continue;
			}
			c.embedding = v;
			c.meta = { ...c.meta, embedMode: mode, embedModel: model };
			updated++;
		}
	}
	persistChunks(cwd, scope, storeId, chunks);
	return { total: chunks.length, updated, skipped };
}

export async function searchStore(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
	query: string,
	topK: number,
	embedCtx: EmbedContext,
): Promise<MemorySearchHit[]> {
	const q = query.trim();
	if (!q) return [];
	const [qe] = await embedMany([q], embedCtx);
	if (!qe) return [];
	const chunks = loadChunks(cwd, scope, storeId);
	// 过滤与当前模式维度明显不兼容的旧块（长度差太大）
	const dim = qe.length;
	const scored = chunks
		.filter((c) => Math.abs(c.embedding.length - dim) <= 8 || c.embedding.length === dim)
		.map((c) => ({
			id: c.id,
			text: c.text,
			score: cosine(qe, c.embedding),
			meta: c.meta,
			createdAt: c.createdAt,
		}))
		.filter((h) => h.score > 0.05)
		.sort((a, b) => b.score - a.score)
		.slice(0, Math.max(1, topK));
	return scored;
}

