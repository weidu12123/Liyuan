/**
 * 知识库（PLAN-PHASE4 柱 3）：用户可命名、可跨对话挂载的自定义设定数据库。
 *
 * 与补充设定集（.liyuan-lore/，按卡分文件、跟卡走）的本质区别：知识库独立于角色卡全局存在
 * （.liyuan-codex/<名>.json），任何会话都可挂载——跑得越多越厚的私人世界书。
 * 条目复用 LorebookEntry 归一化（loadLorebookFile 可直接读），天然可导出为 ST 兼容世界书。
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { readJsonFile } from "./jsonio.ts";
import { loreFingerprint, normalizeEntries } from "./lorebook.ts";
import { dir } from "./paths.ts";
import type { LorebookEntry } from "./types.ts";

/** 知识库条目 uid 起点：避开世界书常见 uid 空间与补充设定集的 9000 段（别名缓存按 uid 键控） */
const CODEX_UID_BASE = 20000;

/** 库名长度上限（做文件名，也做页签/速览显示） */
export const CODEX_NAME_MAX = 40;

export interface CodexMeta {
	name: string;
	description: string;
	entryCount: number;
	file: string;
}

export function codexDir(cwd: string): string {
	return dir(cwd, "codex");
}

export function codexPathFor(cwd: string, name: string): string {
	return join(codexDir(cwd), `${name.replace(/[\\/:*?"<>|]/g, "_")}.json`);
}

/** 库名校验：非空、不超长、不含路径分隔符以外也会被替换的字符倒无妨，但拒绝纯替换后为空 */
export function validateCodexName(name: string): string | null {
	const n = name.trim();
	if (!n) return "库名不能为空。";
	if (n.length > CODEX_NAME_MAX) return `库名过长（上限 ${CODEX_NAME_MAX} 字符）。`;
	if (!n.replace(/[\\/:*?"<>|]/g, "").trim()) return "库名不能全由特殊字符组成。";
	return null;
}

interface CodexFile {
	format?: string;
	version?: number;
	name?: string;
	description?: string;
	entries?: unknown;
}

function readCodexFile(path: string): CodexFile | null {
	if (!existsSync(path)) return null;
	const json = readJsonFile(path);
	return json && typeof json === "object" ? (json as CodexFile) : null;
}

function writeCodexFile(path: string, file: CodexFile): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(file, null, "\t") + "\n", "utf8");
}

/** 列出全部知识库（目录不存在返回空表） */
export function listCodexes(cwd: string): CodexMeta[] {
	const dir = codexDir(cwd);
	if (!existsSync(dir)) return [];
	const metas: CodexMeta[] = [];
	for (const f of readdirSync(dir)) {
		if (!f.endsWith(".json")) continue;
		try {
			const file = readCodexFile(join(dir, f));
			if (!file) continue;
			const entries = Array.isArray(file.entries) ? file.entries : [];
			metas.push({
				name: typeof file.name === "string" && file.name ? file.name : f.replace(/\.json$/, ""),
				description: typeof file.description === "string" ? file.description : "",
				entryCount: entries.length,
				file: join(dir, f),
			});
		} catch {
			// 坏文件跳过，不影响其余库
		}
	}
	return metas.sort((a, b) => a.name.localeCompare(b.name));
}

/** 按名找库（大小写不敏感、忽略首尾空白） */
export function findCodex(cwd: string, name: string): CodexMeta | null {
	const n = name.trim().toLowerCase();
	return listCodexes(cwd).find((c) => c.name.toLowerCase() === n) ?? null;
}

export type CreateCodexResult = { ok: true; meta: CodexMeta } | { ok: false; error: string };

/** 创建一个空知识库；同名（含大小写不同）已存在则报错 */
export function createCodex(cwd: string, name: string, description = ""): CreateCodexResult {
	const err = validateCodexName(name);
	if (err) return { ok: false, error: err };
	const n = name.trim();
	const existing = findCodex(cwd, n);
	if (existing) return { ok: false, error: `知识库「${existing.name}」已存在（${existing.entryCount} 条），可直接 codex_mount 挂载。` };
	const path = codexPathFor(cwd, n);
	writeCodexFile(path, { format: "liyuan-codex", version: 1, name: n, description: description.trim(), entries: [] });
	return { ok: true, meta: { name: n, description: description.trim(), entryCount: 0, file: path } };
}

/** 装载一个库的归一化条目；库不存在返回 null */
export function loadCodexEntries(cwd: string, name: string): LorebookEntry[] | null {
	const meta = findCodex(cwd, name);
	if (!meta) return null;
	const file = readCodexFile(meta.file);
	if (!file) return null;
	return normalizeEntries(file.entries);
}

export interface CodexEntryInput {
	title: string;
	keys: string[];
	content: string;
	constant?: boolean;
}

/**
 * 用户面板简易输入（名字 + 信息）→ 标准条目字段。
 * AI 的 codex_write 也走同一套：title=名字、content=信息；keys 可由模型给，用户侧从名字自动派生。
 */
export function userEntryToCodexInput(name: string, info: string, keys?: string[]): CodexEntryInput {
	const title = name.trim();
	const content = info.replace(/\r\n/g, "\n").trim();
	const autoKeys = keysFromTitle(title);
	const extra = (keys ?? []).map((k) => k.trim()).filter(Boolean);
	const merged: string[] = [];
	for (const k of [...autoKeys, ...extra]) {
		if (!merged.some((x) => x.toLowerCase() === k.toLowerCase())) merged.push(k);
	}
	return { title, keys: merged, content, constant: false };
}

/** 从条目标题派生检索关键词（整名 + 按分隔符切开的片段） */
export function keysFromTitle(title: string): string[] {
	const t = title.trim();
	if (!t) return [];
	const parts = t
		.split(/[\s·•,，、/|｜\-—_]+/)
		.map((s) => s.trim())
		.filter((s) => s.length >= 1);
	const out: string[] = [t];
	for (const p of parts) {
		if (p !== t && !out.some((x) => x.toLowerCase() === p.toLowerCase())) out.push(p);
	}
	return out.slice(0, 8);
}

export type AppendCodexResult =
	| { ok: true; entry: LorebookEntry }
	| { ok: true; entry: null } // 内容重复，未写入
	| { ok: false; error: string };

/** 向知识库追加一条条目（内容指纹去重，同 appendOverlayEntry 语义） */
export function appendCodexEntry(cwd: string, name: string, input: CodexEntryInput): AppendCodexResult {
	const meta = findCodex(cwd, name);
	if (!meta) return { ok: false, error: `没有名为「${name.trim()}」的知识库。` };
	if (!input.title.trim()) return { ok: false, error: "条目标题不能为空。" };
	if (!input.content.trim()) return { ok: false, error: "条目内容不能为空。" };
	const file = readCodexFile(meta.file) ?? { format: "liyuan-codex", version: 1, name: meta.name, entries: [] };
	const existing = Array.isArray(file.entries)
		? (file.entries as unknown[]).filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
		: [];
	const content = input.content.replace(/\r\n/g, "\n").trim();
	const fp = loreFingerprint(content);
	for (const e of existing) {
		if (typeof e.content === "string" && loreFingerprint(e.content) === fp) return { ok: true, entry: null };
	}
	// 无 keys 时用标题派生，保证可被 lorebook_search / 关键词扫描命中
	const keys =
		input.keys.map((k) => k.trim()).filter(Boolean).length > 0
			? input.keys.map((k) => k.trim()).filter(Boolean)
			: keysFromTitle(input.title);
	const raw = {
		uid: CODEX_UID_BASE + existing.length,
		keys,
		secondary_keys: [],
		comment: input.title.trim(),
		content,
		constant: input.constant === true,
		enabled: true,
		insertion_order: 100,
	};
	writeCodexFile(meta.file, { ...file, entries: [...existing, raw] });
	return { ok: true, entry: normalizeEntries([raw])[0] };
}

export type DeleteCodexResult = { ok: true; removed: boolean } | { ok: false; error: string };

/** 按内容指纹删除一条；找不到则 removed=false */
export function deleteCodexEntry(cwd: string, name: string, fingerprint: string): DeleteCodexResult {
	const meta = findCodex(cwd, name);
	if (!meta) return { ok: false, error: `没有名为「${name.trim()}」的知识库。` };
	const fp = fingerprint.trim();
	if (!fp) return { ok: false, error: "缺少条目标识。" };
	const file = readCodexFile(meta.file);
	if (!file) return { ok: false, error: "知识库文件不可读。" };
	const existing = Array.isArray(file.entries)
		? (file.entries as unknown[]).filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
		: [];
	const next = existing.filter((e) => !(typeof e.content === "string" && loreFingerprint(e.content) === fp));
	if (next.length === existing.length) return { ok: true, removed: false };
	writeCodexFile(meta.file, { ...file, entries: next });
	return { ok: true, removed: true };
}

/** 挂载库速览（每轮末端注入用），如「九州风物志(12 条)、奇物图鉴(3 条)」；空表返回 null */
export function formatCodexIndex(mounted: Array<{ name: string; entryCount: number }>): string | null {
	if (mounted.length === 0) return null;
	return mounted.map((c) => `${c.name}(${c.entryCount} 条)`).join("、");
}
