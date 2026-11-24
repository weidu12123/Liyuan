/** Exact Markdown memory access. Manual sources win over asynchronous recap/consolidation. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { loadManifest, memoryPaths, saveManifest, type MemoryManifest } from "./card-memory.ts";
import { getUiLocale } from "./i18n/index.ts";
import { CHAT_DOCS_MEMORY_DIR, CHAT_MEMORY_INDEX_FILE, chatMemoryDocsDirOf, chatMemoryIndexPath, nameSafe } from "./paths.ts";
import type { MemoryDocument, MemoryHitLike } from "./tools/memory.ts";
import { USER_RULES_FILE, chatRulesPath } from "./user-rules.ts";

export const memoryTextVersion = (text: string): string => createHash("sha256").update(text).digest("hex");
const raw = (file: string) => {
	try { return readFileSync(file, "utf8"); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
};
function documents(cardDir: string): Array<{ ref: string; path: string; chatId?: string }> {
	const p = memoryPaths(cardDir);
	const recaps = existsSync(p.recapsDir) ? readdirSync(p.recapsDir).filter((n) => /^[a-zA-Z0-9_-]+\.md$/.test(n)) : [];
	return [{ ref: "card:handbook", path: p.handbook }, { ref: "card:resident", path: p.resident },
		...recaps.map((n) => ({ ref: `card:recap:${n.slice(0, -3)}`, path: join(p.recapsDir, n), chatId: n.slice(0, -3) }))];
}

export function listCardMemory(cardDir: string, currentChatId?: string): MemoryDocument[] {
	const manifest = loadManifest(cardDir);
	return documents(cardDir).flatMap((doc) => {
		const text = raw(doc.path);
		if (text === undefined) return [];
		const version = memoryTextVersion(text);
		if (doc.chatId && (manifest.manual?.forgottenChats.includes(doc.chatId) || manifest.manual?.supersededRecaps[doc.chatId] === version)) return [];
		if (doc.chatId && currentChatId && doc.chatId !== currentChatId) return [];
		return [{ ref: doc.ref, version, text, meta: { title: basename(doc.path), fileName: basename(doc.path), source: "card-markdown", scope: doc.chatId ? "card-chat-recap" : "card", ...(doc.chatId ? { chatId: doc.chatId } : {}) },
			...(manifest.manual?.protectedRefs.includes(doc.ref) ? { note: getUiLocale() === "en" ? "Manual memory; auto-sync will not overwrite it." : "手工记忆，自动同步不会覆盖。" } : {}) }];
	});
}

export function readCardMemory(cardDir: string, ref: string, currentChatId?: string): MemoryDocument | undefined {
	const docs = listCardMemory(cardDir, currentChatId);
	const doc = docs.find((d) => d.ref === ref);
	return doc ? { ...doc, relatedRefs: docs.filter((d) => d.ref !== ref).map((d) => d.ref) } : undefined;
}

export function searchCardMemory(cardDir: string, query: string, limit = 6, currentChatId?: string): MemoryHitLike[] {
	const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	return listCardMemory(cardDir, currentChatId).flatMap((doc) => {
		const lower = doc.text.toLocaleLowerCase();
		const matches = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0);
		if (!matches.length) return [];
		const from = Math.max(0, Math.min(...matches) - 160);
		return [{ ...doc, text: doc.text.slice(from, Math.min(doc.text.length, from + 1200)), score: matches.length / words.length }];
	}).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, limit);
}

function manual(manifest: MemoryManifest): NonNullable<MemoryManifest["manual"]> {
	return manifest.manual ??= { protectedRefs: [], forgottenChats: [], supersededRecaps: {}, aggregatePinned: false, epoch: 0 };
}
function backup(cardDir: string, file: string): void {
	const text = raw(file);
	if (text === undefined) return;
	const root = join(memoryPaths(cardDir).root, ".history");
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, `${Date.now()}-${randomUUID()}-${basename(file)}`), text, "utf8");
}

/** One synchronous source transaction. Manifest is written first so a crash fails closed for regeneration. */
export function changeCardMemory(cardDir: string, ref: string, version: string, content?: string): MemoryDocument | undefined {
	const en = getUiLocale() === "en";
	const doc = readCardMemory(cardDir, ref);
	if (!doc || !version || doc.version !== version) {
		throw new Error(en ? "Memory version conflict or stale reference; re-run memory_read." : "记忆版本冲突或引用已失效；请重新 memory_read。");
	}
	const target = documents(cardDir).find((d) => d.ref === ref)!;
	const p = memoryPaths(cardDir), manifest = loadManifest(cardDir), control = manual(manifest);
	const protect = (key: string) => { if (!control.protectedRefs.includes(key)) control.protectedRefs.push(key); };
	protect(ref); control.epoch++;
	if (target.chatId) {
		if (content === undefined && !control.forgottenChats.includes(target.chatId)) control.forgottenChats.push(target.chatId);
	} else {
		control.aggregatePinned = true;
		for (const d of listCardMemory(cardDir)) if (d.meta?.chatId) control.supersededRecaps[d.meta.chatId] = d.version;
	}
	// Invalid derived summaries must not continue feeding the next beat. Preserve user-owned documents.
	const invalidate = ["card:handbook", "card:resident"].filter((key) => key !== ref && !control.protectedRefs.includes(key));
	for (const record of Object.values(manifest.recaps)) delete record.mergedHash;
	backup(cardDir, target.path);
	for (const key of invalidate) backup(cardDir, key === "card:handbook" ? p.handbook : p.resident);
	saveManifest(cardDir, manifest);
	if (content === undefined) unlinkSync(target.path);
	else {
		const temp = `${target.path}.${randomUUID()}.tmp`;
		writeFileSync(temp, content, "utf8"); renameSync(temp, target.path);
	}
	for (const key of invalidate) {
		const path = key === "card:handbook" ? p.handbook : p.resident;
		if (existsSync(path)) unlinkSync(path);
	}
	const updated = readCardMemory(cardDir, ref);
	if (updated) {
		updated.note = target.chatId
			? (en
				? "Source recap pinned as manual draft; stale auto-summaries invalidated and will rebuild from active recaps on next sync."
				: "源复盘已固定为手工稿；旧自动汇总已失效，下一次同步从现存复盘重建。")
			: (en
				? "Manual summary saved; auto-consolidation paused and already-merged recaps are no longer searched. New recaps from other runs remain independently readable."
				: "手工汇总已保存；自动合并暂停，已参与旧汇总的复盘不再被检索。其他局的新复盘仍可独立读取。");
	}
	return updated;
}

// ---------------- 项目级 Markdown 记忆与局部守则（对话/<chatId>/记忆/*.md & APPEND_SYSTEM.md） ----------------

function chatDocuments(chatDir: string): Array<{ ref: string; path: string; title: string; fileName: string; scope: "chat" | "chat-rules" }> {
	const out: Array<{ ref: string; path: string; title: string; fileName: string; scope: "chat" | "chat-rules" }> = [];
	const rulesFile = chatRulesPath(chatDir);
	if (existsSync(rulesFile)) {
		out.push({
			ref: `chat:${USER_RULES_FILE.replace(/\.md$/i, "")}`,
			path: rulesFile,
			title: USER_RULES_FILE,
			fileName: USER_RULES_FILE,
			scope: "chat-rules",
		});
	}
	const memDir = chatMemoryDocsDirOf(chatDir);
	if (existsSync(memDir)) {
		const files = readdirSync(memDir)
			.filter((n) => n.toLowerCase().endsWith(".md"))
			.sort((a, b) => (a === CHAT_MEMORY_INDEX_FILE ? -1 : b === CHAT_MEMORY_INDEX_FILE ? 1 : a.localeCompare(b, "zh-CN")));
		for (const f of files) {
			const stem = f.replace(/\.md$/i, "");
			out.push({
				ref: `chat:${stem}`,
				path: join(memDir, f),
				title: stem,
				fileName: `${CHAT_DOCS_MEMORY_DIR}/${f}`,
				scope: "chat",
			});
		}
	}
	return out;
}

function normalizeChatRef(ref: string): string {
	const trimmed = ref.trim().replace(/^chat:/i, "").replace(/^记忆[\\/]/, "").replace(/\.md$/i, "");
	return `chat:${trimmed}`;
}

export function listChatMemory(chatDir: string): MemoryDocument[] {
	const chatId = basename(chatDir);
	return chatDocuments(chatDir).flatMap((doc) => {
		const text = raw(doc.path);
		if (text === undefined) return [];
		const version = memoryTextVersion(text);
		return [{
			ref: doc.ref,
			version,
			text,
			meta: {
				title: doc.title,
				fileName: doc.fileName,
				source: "chat-markdown",
				scope: doc.scope,
				chatId,
			},
		}];
	});
}

export function readChatMemory(chatDir: string, ref: string): MemoryDocument | undefined {
	const targetRef = normalizeChatRef(ref);
	const docs = listChatMemory(chatDir);
	const doc = docs.find((d) => d.ref.toLowerCase() === targetRef.toLowerCase());
	return doc ? { ...doc, relatedRefs: docs.filter((d) => d.ref !== doc.ref).map((d) => d.ref) } : undefined;
}

export function searchChatMemory(chatDir: string, query: string, limit = 6): MemoryHitLike[] {
	const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	return listChatMemory(chatDir)
		.flatMap((doc) => {
			const lower = `${doc.meta?.title ?? ""}\n${doc.text}`.toLocaleLowerCase();
			const matches = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0);
			if (!matches.length) return [];
			const textLower = doc.text.toLocaleLowerCase();
			const textHits = words.map((w) => textLower.indexOf(w)).filter((i) => i >= 0);
			const from = textHits.length ? Math.max(0, Math.min(...textHits) - 160) : 0;
			return [{ ...doc, text: doc.text.slice(from, Math.min(doc.text.length, from + 1200)), score: matches.length / words.length }];
		})
		.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
		.slice(0, limit);
}

function summarizeHook(text: string): string {
	for (const line of text.split(/\r?\n/)) {
		const cleaned = line.replace(/^#+\s*/, "").replace(/^[-*>]\s*/, "").trim();
		if (cleaned) return cleaned.length > 72 ? `${cleaned.slice(0, 72)}…` : cleaned;
	}
	return getUiLocale() === "en" ? "Project memory document" : "项目记忆文档";
}

function syncMemoryIndexEntry(chatDir: string, fileName: string, title: string, hook?: string): void {
	if (fileName.toLowerCase() === CHAT_MEMORY_INDEX_FILE.toLowerCase()) return;
	const idxPath = chatMemoryIndexPath(chatDir);
	mkdirSync(chatMemoryDocsDirOf(chatDir), { recursive: true });
	const existing = raw(idxPath) ?? "";
	const lines = existing ? existing.split(/\r?\n/) : [getUiLocale() === "en" ? "# Project Memory Index" : "# 项目记忆索引", ""];
	const linkToken = `(${fileName})`;
	const filtered = lines.filter((l) => !l.includes(linkToken));
	if (hook !== undefined) {
		const entryLine = `- [${title}](${fileName}) — ${hook}`;
		const updated = existing && lines.some((l) => l.includes(linkToken))
			? lines.map((l) => (l.includes(linkToken) ? entryLine : l))
			: [...lines.filter((l, i, arr) => !(i === arr.length - 1 && l === "")), entryLine];
		writeFileSync(idxPath, `${updated.join("\n").trim()}\n`, "utf8");
	} else if (existing) {
		writeFileSync(idxPath, `${filtered.join("\n").trim()}\n`, "utf8");
	}
}

/** 新增或覆盖一篇项目级 Markdown 记忆文档（`<子项目>/记忆/<title>.md`），并自动同步 `记忆/MEMORY.md` 索引 */
export function writeChatMemoryDoc(chatDir: string, input: { text: string; title?: string }): MemoryDocument {
	const defaultTitle = getUiLocale() === "en" ? "memory-note" : "记忆笔记";
	const rawTitle = (input.title ?? "").trim() || defaultTitle;
	const safeStem = nameSafe(rawTitle.replace(/\.md$/i, "")).trim() || defaultTitle;
	const isRules = safeStem.toUpperCase() === USER_RULES_FILE.replace(/\.md$/i, "");
	const fileName = `${safeStem}.md`;
	const targetPath = isRules ? chatRulesPath(chatDir) : join(chatMemoryDocsDirOf(chatDir), fileName);
	mkdirSync(isRules ? chatDir : chatMemoryDocsDirOf(chatDir), { recursive: true });
	const normalized = `${input.text.trim()}\n`;
	writeFileSync(targetPath, normalized, "utf8");
	if (!isRules && fileName.toUpperCase() !== CHAT_MEMORY_INDEX_FILE) {
		syncMemoryIndexEntry(chatDir, fileName, safeStem, summarizeHook(input.text));
	}
	return readChatMemory(chatDir, `chat:${safeStem}`)!;
}

/** 按 ref 与可选版本号更新或删除项目级 Markdown 记忆文档（content 为 undefined 时删除） */
export function changeChatMemory(chatDir: string, ref: string, version?: string, content?: string): MemoryDocument | undefined {
	const en = getUiLocale() === "en";
	const conflictErr = en ? "Memory version conflict or stale reference; re-run memory_read." : "记忆版本冲突或引用已失效；请重新 memory_read。";
	const normRef = normalizeChatRef(ref);
	const existing = readChatMemory(chatDir, normRef);
	if (content === undefined) {
		if (!existing) return undefined;
		if (version && existing.version !== version) throw new Error(conflictErr);
		const docEntry = chatDocuments(chatDir).find((d) => d.ref.toLowerCase() === normRef.toLowerCase());
		if (!docEntry) return undefined;
		if (existsSync(docEntry.path)) unlinkSync(docEntry.path);
		if (docEntry.scope === "chat") {
			syncMemoryIndexEntry(chatDir, `${docEntry.title}.md`, docEntry.title, undefined);
		}
		return undefined;
	}
	if (existing && version && existing.version !== version) {
		throw new Error(conflictErr);
	}
	const stem = normRef.slice("chat:".length);
	return writeChatMemoryDoc(chatDir, { title: stem, text: content });
}

