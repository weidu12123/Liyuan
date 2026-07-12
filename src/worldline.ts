/**
 * 世界线 / 存档点（纯函数，零 pi 依赖）。
 *
 * 语义（产品定稿）：
 * - 存档（/store）= 当前世界线上的节点；一条线上可有多个存档。
 * - 仅当「回到旧存档后走出与既有后续不同的路」再 /store 时，才产生新世界线。
 * - 世界线名默认自动生成，可被 meta 覆盖；用户必交互的是存档名。
 *
 * 树内存：customType === "rp-save" 的会话条目。
 * 旁路 meta：.liyuan-worldline/<sessionId>.json（软删除、线名覆盖）——避免 tombstone 污染 leaf。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { readJsonFile } from "./jsonio.ts";

export const RP_SAVE_TYPE = "rp-save";

export interface SaveData {
	/** 稳定 id（软删除与查找用，不等于树 entry id） */
	id: string;
	name: string;
	worldlineId: string;
	worldlineName: string;
	/** 同线上一个存档的 save id */
	parentSaveId?: string;
	/** 若本线从某存档分叉，记录分叉源 save id */
	forkFromSaveId?: string;
	createdAt: number;
}

/** 树条目上的存档（带 entryId） */
export interface SaveOnTree extends SaveData {
	entryId: string;
	/** 树父节点 id（会话 entry 的 parentId） */
	treeParentId: string | null;
	timestamp?: string;
}

export interface WorldlineMeta {
	deletedSaveIds: string[];
	/** worldlineId → 用户自定义线名 */
	worldlineNames: Record<string, string>;
}

export interface WorldlineSaveNode {
	id: string;
	name: string;
	entryId: string;
	createdAt: number;
	/** 同线上一个存档；分叉首存则为分叉源存档 id */
	parentSaveId?: string;
	/** 当前叶所在分支是否经过此存档 */
	onCurrentBranch: boolean;
	worldlineId: string;
}

export interface WorldlineLine {
	id: string;
	name: string;
	/** 分叉源存档 id（主线无） */
	forkFromSaveId?: string;
	saves: WorldlineSaveNode[];
}

export interface WorldlineView {
	lines: WorldlineLine[];
	/** 当前分支上最近的存档 id */
	currentSaveId: string | null;
	leafEntryId: string | null;
}

export interface TreeEntryLite {
	id: string;
	parentId: string | null;
	type: string;
	customType?: string;
	data?: unknown;
	timestamp?: string;
}

const newId = () => randomBytes(8).toString("hex");

export function emptyMeta(): WorldlineMeta {
	return { deletedSaveIds: [], worldlineNames: {} };
}

export function metaPath(cwd: string, sessionId: string): string {
	return join(cwd, ".liyuan-worldline", `${sessionId}.json`);
}

export function loadWorldlineMeta(file: string): WorldlineMeta {
	try {
		const raw = readJsonFile(file) as Partial<WorldlineMeta>;
		return {
			deletedSaveIds: Array.isArray(raw.deletedSaveIds)
				? raw.deletedSaveIds.filter((x): x is string => typeof x === "string")
				: [],
			worldlineNames:
				raw.worldlineNames && typeof raw.worldlineNames === "object" && !Array.isArray(raw.worldlineNames)
					? Object.fromEntries(
							Object.entries(raw.worldlineNames).filter(
								(kv): kv is [string, string] => typeof kv[0] === "string" && typeof kv[1] === "string",
							),
						)
					: {},
		};
	} catch {
		return emptyMeta();
	}
}

export function saveWorldlineMeta(file: string, meta: WorldlineMeta): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(meta, null, "\t"), "utf8");
}

export function softDeleteSave(meta: WorldlineMeta, saveId: string): WorldlineMeta {
	if (meta.deletedSaveIds.includes(saveId)) return meta;
	return { ...meta, deletedSaveIds: [...meta.deletedSaveIds, saveId] };
}

export function renameWorldline(meta: WorldlineMeta, worldlineId: string, name: string): WorldlineMeta {
	const n = name.trim();
	if (!n) return meta;
	return { ...meta, worldlineNames: { ...meta.worldlineNames, [worldlineId]: n } };
}

/** 从会话 entries 抽出存档（不含已软删） */
export function extractSaves(entries: TreeEntryLite[], meta: WorldlineMeta = emptyMeta()): SaveOnTree[] {
	const deleted = new Set(meta.deletedSaveIds);
	const out: SaveOnTree[] = [];
	for (const e of entries) {
		if (e.type !== "custom" || e.customType !== RP_SAVE_TYPE) continue;
		const d = parseSaveData(e.data);
		if (!d || deleted.has(d.id)) continue;
		out.push({
			...d,
			entryId: e.id,
			treeParentId: e.parentId,
			timestamp: e.timestamp,
		});
	}
	return out;
}

export function parseSaveData(raw: unknown): SaveData | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	if (typeof o.id !== "string" || typeof o.name !== "string") return null;
	if (typeof o.worldlineId !== "string" || typeof o.worldlineName !== "string") return null;
	if (typeof o.createdAt !== "number") return null;
	return {
		id: o.id,
		name: o.name,
		worldlineId: o.worldlineId,
		worldlineName: o.worldlineName,
		...(typeof o.parentSaveId === "string" ? { parentSaveId: o.parentSaveId } : {}),
		...(typeof o.forkFromSaveId === "string" ? { forkFromSaveId: o.forkFromSaveId } : {}),
		createdAt: o.createdAt,
	};
}

/** 默认存档名 */
export function defaultSaveName(now = Date.now()): string {
	const d = new Date(now);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `存档 ${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 规划新存档的世界线归属。
 *
 * @param branchEntryIds 当前叶→根路径上的 entry id（任意序；内部会用 set）
 * @param allSaves 全树存档（已滤软删）
 * @param prevOnBranch 当前分支上最近的存档（不含将写入的新点）
 */
export function planNewSave(opts: {
	name: string;
	prevOnBranch: SaveOnTree | null;
	/** 当前分支 entry id 集合 */
	branchEntryIds: Set<string>;
	allSaves: SaveOnTree[];
	/** entryId → 祖先 id 链（含自身），用于判断「某存档是否在 prev 分叉的其他后继上」 */
	ancestorsOf: (entryId: string) => Set<string>;
	now?: number;
}): SaveData {
	const now = opts.now ?? Date.now();
	const name = opts.name.trim() || defaultSaveName(now);
	const id = newId();
	const prev = opts.prevOnBranch;

	if (!prev) {
		return {
			id,
			name,
			worldlineId: newId(),
			worldlineName: "主线",
			createdAt: now,
		};
	}

	// prev 之后是否存在「不在当前分支上」的存档 → 曾走出过另一条后续；本次若是分叉后首存则开新线。
	// 调用方应传入 latestSaveOnBranch 作为 prev（当前线上最近钉），故不会再有「prev 之后的同线存档」。
	const divergent = opts.allSaves.filter((s) => {
		if (s.id === prev.id) return false;
		if (opts.branchEntryIds.has(s.entryId)) return false;
		return opts.ancestorsOf(s.entryId).has(prev.entryId);
	});

	if (divergent.length > 0) {
		const forkCount = new Set(
			opts.allSaves.filter((s) => s.forkFromSaveId === prev.id).map((s) => s.worldlineId),
		).size;
		return {
			id,
			name,
			worldlineId: newId(),
			worldlineName: `从「${prev.name}」分出 · 线${forkCount + 2}`,
			parentSaveId: prev.id,
			forkFromSaveId: prev.id,
			createdAt: now,
		};
	}

	// 同线延长
	return {
		id,
		name,
		worldlineId: prev.worldlineId,
		worldlineName: prev.worldlineName,
		parentSaveId: prev.id,
		...(prev.forkFromSaveId ? { forkFromSaveId: prev.forkFromSaveId } : {}),
		createdAt: now,
	};
}

/** 当前分支上最近的存档 */
export function latestSaveOnBranch(saves: SaveOnTree[], branchEntryIds: Set<string>): SaveOnTree | null {
	const on = saves.filter((s) => branchEntryIds.has(s.entryId));
	if (on.length === 0) return null;
	on.sort((a, b) => b.createdAt - a.createdAt);
	return on[0];
}

/** 按名或 id 查找（精确名优先，其次唯一前缀） */
export function findSave(saves: SaveOnTree[], query: string): SaveOnTree | null {
	const q = query.trim();
	if (!q) return null;
	const byId = saves.find((s) => s.id === q || s.entryId === q);
	if (byId) return byId;
	const exact = saves.filter((s) => s.name === q);
	if (exact.length === 1) return exact[0];
	if (exact.length > 1) return exact.sort((a, b) => b.createdAt - a.createdAt)[0];
	const pref = saves.filter((s) => s.name.startsWith(q));
	if (pref.length === 1) return pref[0];
	return null;
}

/** 组装前端/命令展示用视图 */
export function buildWorldlineView(
	saves: SaveOnTree[],
	meta: WorldlineMeta,
	branchEntryIds: Set<string>,
	leafEntryId: string | null,
): WorldlineView {
	const byLine = new Map<string, SaveOnTree[]>();
	for (const s of saves) {
		const list = byLine.get(s.worldlineId) ?? [];
		list.push(s);
		byLine.set(s.worldlineId, list);
	}

	const lines: WorldlineLine[] = [];
	for (const [id, list] of byLine) {
		list.sort((a, b) => a.createdAt - b.createdAt);
		const sample = list[0];
		const name = meta.worldlineNames[id] || sample.worldlineName || "世界线";
		lines.push({
			id,
			name,
			...(sample.forkFromSaveId ? { forkFromSaveId: sample.forkFromSaveId } : {}),
			saves: list.map((s, i) => {
				// 同线首存：若从别的节点分叉，父 = 分叉源；否则无父（根）
				// 同线后续：父 = 同线前一个存档（parentSaveId 或按序前驱）
				const parentSaveId =
					s.parentSaveId ??
					(i === 0 ? sample.forkFromSaveId : list[i - 1]?.id);
				return {
					id: s.id,
					name: s.name,
					entryId: s.entryId,
					createdAt: s.createdAt,
					...(parentSaveId ? { parentSaveId } : {}),
					onCurrentBranch: branchEntryIds.has(s.entryId),
					worldlineId: id,
				};
			}),
		});
	}

	// 主线（无 fork）在前，其余按首存时间
	lines.sort((a, b) => {
		const af = a.forkFromSaveId ? 1 : 0;
		const bf = b.forkFromSaveId ? 1 : 0;
		if (af !== bf) return af - bf;
		const at = a.saves[0]?.createdAt ?? 0;
		const bt = b.saves[0]?.createdAt ?? 0;
		return at - bt;
	});

	const current = latestSaveOnBranch(saves, branchEntryIds);

	return {
		lines,
		currentSaveId: current?.id ?? null,
		leafEntryId,
	};
}

/**
 * 从扁平 entries 建 parent→children 与 ancestors 查询。
 * 供扩展/ host 注入 planNewSave。
 */
export function buildAncestryIndex(entries: TreeEntryLite[]): {
	ancestorsOf: (entryId: string) => Set<string>;
	branchIdsFromLeaf: (leafId: string | null) => Set<string>;
} {
	const parent = new Map<string, string | null>();
	for (const e of entries) parent.set(e.id, e.parentId);

	const cache = new Map<string, Set<string>>();
	const ancestorsOf = (entryId: string): Set<string> => {
		const hit = cache.get(entryId);
		if (hit) return hit;
		const set = new Set<string>();
		let cur: string | null | undefined = entryId;
		const guard = new Set<string>();
		while (cur && !guard.has(cur)) {
			guard.add(cur);
			set.add(cur);
			cur = parent.has(cur) ? parent.get(cur)! : null;
		}
		cache.set(entryId, set);
		return set;
	};

	const branchIdsFromLeaf = (leafId: string | null): Set<string> => {
		if (!leafId) return new Set();
		return ancestorsOf(leafId);
	};

	return { ancestorsOf, branchIdsFromLeaf };
}

/** TUI / 通知用的纯文本时间线 */
export function formatWorldlineText(view: WorldlineView): string {
	if (view.lines.length === 0) return "尚无存档。用 /store 在当前剧情点钉一个存档。";
	const lines: string[] = ["世界线：", ""];
	for (const line of view.lines) {
		lines.push(`◆ ${line.name}`);
		for (const s of line.saves) {
			const mark = s.onCurrentBranch ? (s.id === view.currentSaveId ? "●" : "○") : "·";
			const cur = s.id === view.currentSaveId ? " ← 当前" : s.onCurrentBranch ? "" : "";
			lines.push(`  ${mark} ${s.name}${cur}`);
		}
		lines.push("");
	}
	lines.push("提示：/back <存档名> 回档；/store [名] 存档。");
	return lines.join("\n").trimEnd();
}
