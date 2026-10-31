/**
 * 世界书：导入（ST world info 格式 + 卡内嵌 character_book 格式）、
 * constant 常驻、关键词被动激活（兜底）、主动检索（lorebook_search 工具后端）。
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { readJsonFile } from "./jsonio.ts";
import { resolveCardSpace } from "./cardspace.ts";
import { CARD_OVERLAY_FILE, dir, nameSafe } from "./paths.ts";
import type { LorebookEntry } from "./types.ts";

/**
 * 条目内容指纹：用户级启停（config.disabledLore）的持久键。
 * 不用 uid——卡内嵌书与独立世界书合并后 uid 可能冲突，内容才是稳定身份
 * （与 mergeEntries 的去重语义一致）。
 */
export function loreFingerprint(content: string): string {
	return createHash("md5").update(content.trim()).digest("hex").slice(0, 12);
}

/**
 * 标题派生检索关键词：没给 keys 的条目至少能被标题及其分词命中，
 * 否则写进去就永远检索不到。整串标题恒为第一个关键词，最多 8 个。
 * （原住 src/codex.ts；知识库退役后搬来世界书族——它本就是世界书条目的助手函数。）
 */
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

/** 应用用户停用清单：命中指纹的条目 enabled 置 false（不修改原数组） */
export function applyDisabledLore(entries: LorebookEntry[], disabled: string[] | undefined): LorebookEntry[] {
	if (!disabled || disabled.length === 0) return entries;
	const off = new Set(disabled);
	return entries.map((e) => (off.has(loreFingerprint(e.content)) ? { ...e, enabled: false } : e));
}

/**
 * 增删停用清单（`lorebook_toggle` 与 REST `/api/lorebook/toggle` 共用同一套语义）。
 * 返回**去重后的新清单**；空清单由调用方决定是否从 config 里删键。
 *
 * ⚠ 这是 M-C2 协议禁用所用的同一条通道（TOOLING M-D2 明示不得另起一套）——
 * 指纹是内容 md5，故条目改内容＝换身份，旧指纹自然失效（迁移见 rest.ts:3176）。
 */
export function toggleDisabledLore(
	disabled: string[] | undefined,
	fingerprints: string[],
	enabled: boolean,
): string[] {
	const off = new Set(disabled ?? []);
	for (const fp of fingerprints) {
		if (enabled) off.delete(fp);
		else off.add(fp);
	}
	return [...off];
}

function asStringArray(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

/**
 * 归一化一组条目。兼容两种字段命名：
 * - ST world info: key / keysecondary / disable / order，entries 是 uid→entry 的对象
 * - 卡内嵌 book (V2/V3): keys / secondary_keys / enabled / insertion_order，entries 是数组
 */
export function normalizeEntries(entries: unknown): LorebookEntry[] {
	let list: Record<string, unknown>[] = [];
	if (Array.isArray(entries)) {
		list = entries.filter((e): e is Record<string, unknown> => !!e && typeof e === "object");
	} else if (entries && typeof entries === "object") {
		list = Object.values(entries).filter((e): e is Record<string, unknown> => !!e && typeof e === "object");
	}
	return list.map((e, i) => {
		const keys = asStringArray(e.keys).length ? asStringArray(e.keys) : asStringArray(e.key);
		const secondary = asStringArray(e.secondary_keys).length
			? asStringArray(e.secondary_keys)
			: asStringArray(e.keysecondary);
		const enabled = e.enabled === false ? false : e.disable === true ? false : true;
		const order =
			typeof e.insertion_order === "number" ? e.insertion_order : typeof e.order === "number" ? e.order : 100;
		const uid = typeof e.uid === "number" ? e.uid : typeof e.id === "number" ? e.id : i;
		const content = typeof e.content === "string" ? e.content.replace(/\r\n/g, "\n") : "";
		const comment = typeof e.comment === "string" && e.comment ? e.comment : typeof e.name === "string" ? e.name : "";
		return {
			uid,
			keys,
			secondaryKeys: secondary,
			comment,
			content,
			constant: e.constant === true,
			enabled,
			selective: e.selective === true,
			order,
		};
	});
}

/** 从 ST 世界书 JSON 文件加载（{ entries: { uid: {...} } }） */
export function loadLorebookFile(path: string): LorebookEntry[] {
	const json = readJsonFile(path) as Record<string, unknown>;
	return normalizeEntries(json.entries);
}

/**
 * 已挂载世界书路径（多选）。兼容旧字段 `lorebook: string`。
 * 返回去重后的正斜杠相对路径；空数组 = 一本都不挂。
 */
export function mountedLorebookPaths(config: { lorebook?: string; lorebooks?: string[] }): string[] {
	const fromArr = Array.isArray(config.lorebooks)
		? config.lorebooks.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
		: [];
	if (fromArr.length > 0) {
		return [...new Set(fromArr.map((p) => p.replace(/\\/g, "/")))];
	}
	if (typeof config.lorebook === "string" && config.lorebook.trim()) {
		return [config.lorebook.replace(/\\/g, "/")];
	}
	return [];
}

/** 写回配置时统一成 lorebooks 数组，并去掉废弃的单本 lorebook 字段 */
export function setMountedLorebooks<T extends { lorebook?: string; lorebooks?: string[] }>(
	config: T,
	paths: string[],
): T {
	const next = { ...config } as T & { lorebook?: string; lorebooks?: string[] };
	const clean = [...new Set(paths.map((p) => p.replace(/\\/g, "/")).filter(Boolean))];
	if (clean.length > 0) next.lorebooks = clean;
	else delete next.lorebooks;
	delete next.lorebook;
	return next;
}

/**
 * 书的标签＝文件名去扩展名——条目来源标注 `（世界书·书名）` 里写的就是它，
 * 与世界书面板列出的名字同一个字串。
 */
function bookLabelOf(path: string): string {
	return path.replace(/\\/g, "/").split("/").pop()!.replace(/\.json$/i, "");
}

/**
 * 条目 → 所属挂载书的标签。合并后的条目不带书的身份，这里按内容指纹回查各书
 * （与 mergeEntries 的去重语义一致：同内容多书并存时归第一本）。补充设定与卡内嵌书的条目
 * 不在任何挂载书里 ⇒ undefined（它们没有「卸载」这个生命周期，不标）。
 */
export function bookOfEntries(
	mountedAbsPaths: string[],
	load: (abs: string) => LorebookEntry[] = loadLorebookFile,
): (entry: LorebookEntry) => string | undefined {
	const byFingerprint = new Map<string, string>();
	for (const abs of mountedAbsPaths) {
		if (!existsSync(abs)) continue;
		const label = bookLabelOf(abs);
		for (const e of load(abs)) {
			const fp = e.content.trim();
			if (fp && !byFingerprint.has(fp)) byFingerprint.set(fp, label);
		}
	}
	return (entry) => byFingerprint.get(entry.content.trim());
}

/** 可写回源文件的字段（enabled 仍优先走 config.disabledLore 用户覆盖） */
export interface LoreEntryPatch {
	constant?: boolean;
	order?: number;
	keys?: string[];
	secondaryKeys?: string[];
	selective?: boolean;
	comment?: string;
	content?: string;
	/** 写入源文件的 disable/enabled；与 disabledLore 覆盖层独立 */
	enabled?: boolean;
}

/**
 * 按内容指纹在世界书 JSON 内原地改一条（保留未知 ST 字段）。
 * 兼容 ST 对象 entries 与卡内嵌/补充设定数组 entries。
 */
export function patchLorebookFileEntry(
	path: string,
	fingerprint: string,
	patch: LoreEntryPatch,
): { entry: LorebookEntry; newFingerprint: string } | null {
	const json = readJsonFile(path) as Record<string, unknown>;
	const raw = json.entries;
	if (raw == null) return null;

	const applyToRaw = (e: Record<string, unknown>): Record<string, unknown> | null => {
		const content = typeof e.content === "string" ? e.content : "";
		if (loreFingerprint(content) !== fingerprint) return null;
		const next = { ...e };
		if (patch.constant !== undefined) next.constant = patch.constant;
		if (patch.order !== undefined) {
			const order = Math.round(patch.order);
			next.order = order;
			next.insertion_order = order;
		}
		if (patch.keys !== undefined) {
			const keys = patch.keys.map((k) => k.trim()).filter(Boolean);
			next.key = keys;
			next.keys = keys;
		}
		if (patch.secondaryKeys !== undefined) {
			const sec = patch.secondaryKeys.map((k) => k.trim()).filter(Boolean);
			next.keysecondary = sec;
			next.secondary_keys = sec;
		}
		if (patch.selective !== undefined) next.selective = patch.selective;
		if (patch.comment !== undefined) {
			next.comment = patch.comment;
			next.name = patch.comment;
		}
		if (patch.content !== undefined) next.content = patch.content.replace(/\r\n/g, "\n");
		if (patch.enabled !== undefined) {
			next.enabled = patch.enabled;
			next.disable = !patch.enabled;
		}
		// selective 无次要词时关掉，避免脏状态
		const secAfter = asStringArray(next.secondary_keys).length
			? asStringArray(next.secondary_keys)
			: asStringArray(next.keysecondary);
		if (next.selective === true && secAfter.length === 0) next.selective = false;
		return next;
	};

	let found: LorebookEntry | null = null;
	let newFp = fingerprint;

	if (Array.isArray(raw)) {
		const list = raw.map((item) => {
			if (!item || typeof item !== "object") return item;
			const patched = applyToRaw(item as Record<string, unknown>);
			if (!patched) return item;
			const norm = normalizeEntries([patched])[0];
			found = norm;
			newFp = loreFingerprint(norm.content);
			return patched;
		});
		if (!found) return null;
		json.entries = list;
	} else if (raw && typeof raw === "object") {
		const obj = { ...(raw as Record<string, unknown>) };
		let hit = false;
		for (const k of Object.keys(obj)) {
			const item = obj[k];
			if (!item || typeof item !== "object") continue;
			const patched = applyToRaw(item as Record<string, unknown>);
			if (!patched) continue;
			obj[k] = patched;
			const norm = normalizeEntries([patched])[0];
			found = norm;
			newFp = loreFingerprint(norm.content);
			hit = true;
			break;
		}
		if (!hit || !found) return null;
		json.entries = obj;
	} else {
		return null;
	}

	writeFileSync(path, `${JSON.stringify(json, null, "\t")}\n`, "utf8");
	return { entry: found, newFingerprint: newFp };
}

/**
 * 按内容指纹从世界书 JSON 里删除一条（其余条目原样保留，含未知 ST 字段）。
 * 兼容 ST 对象 entries（uid→条目）与卡内嵌/补充设定数组 entries。
 * 返回被删条目的归一化视图；未命中返回 null（文件不写）。
 */
export function deleteLorebookFileEntry(path: string, fingerprint: string): LorebookEntry | null {
	const json = readJsonFile(path) as Record<string, unknown>;
	const raw = json.entries;
	if (raw == null) return null;

	const matches = (e: unknown): e is Record<string, unknown> =>
		!!e &&
		typeof e === "object" &&
		typeof (e as Record<string, unknown>).content === "string" &&
		loreFingerprint((e as Record<string, unknown>).content as string) === fingerprint;

	let removed: LorebookEntry | null = null;

	if (Array.isArray(raw)) {
		const idx = raw.findIndex(matches);
		if (idx < 0) return null;
		removed = normalizeEntries([raw[idx]])[0];
		json.entries = [...raw.slice(0, idx), ...raw.slice(idx + 1)];
	} else if (raw && typeof raw === "object") {
		const obj = { ...(raw as Record<string, unknown>) };
		const key = Object.keys(obj).find((k) => matches(obj[k]));
		if (key === undefined) return null;
		removed = normalizeEntries([obj[key]])[0];
		delete obj[key];
		json.entries = obj;
	} else {
		return null;
	}

	writeFileSync(path, `${JSON.stringify(json, null, "\t")}\n`, "utf8");
	return removed;
}

/** 新增条目的输入（面板「加一条」与 agent 写书共用） */
export interface NewLoreEntryInput {
	comment: string;
	keys: string[];
	content: string;
	secondaryKeys?: string[];
	constant?: boolean;
	selective?: boolean;
	order?: number;
}

/**
 * 向世界书文件追加一条条目——**保持文件原有 entries 形态**与其它顶层字段（name 等）。
 * - 对象 entries（ST 格式）：新键取空闲 uid 的字符串
 * - 数组 entries（卡内嵌 / 补充设定）：追加到末尾
 * - 文件不存在：按数组格式新建（同 appendOverlayEntry）
 *
 * 两套字段名同写（key/keys、order/insertion_order、disable/enabled），导回酒馆与再读都认。
 * 内容指纹与既有条目重复时返回 null，且不写文件。
 */
export function appendLorebookFileEntry(path: string, input: NewLoreEntryInput): LorebookEntry | null {
	let json: Record<string, unknown> = {};
	let existing: Record<string, unknown>[] = [];
	let obj: Record<string, unknown> | null = null;
	if (existsSync(path)) {
		json = readJsonFile(path) as Record<string, unknown>;
		const raw = json.entries;
		if (Array.isArray(raw)) {
			existing = raw.filter((e): e is Record<string, unknown> => !!e && typeof e === "object");
		} else if (raw && typeof raw === "object") {
			obj = { ...(raw as Record<string, unknown>) };
			existing = Object.values(obj).filter((e): e is Record<string, unknown> => !!e && typeof e === "object");
		}
	}

	const content = input.content.replace(/\r\n/g, "\n").trim();
	const comment = input.comment.trim();
	if (!content) return null;
	const fp = loreFingerprint(content);
	for (const e of existing) {
		if (typeof e.content === "string" && loreFingerprint(e.content) === fp) return null;
	}

	// 新 uid = 现有最大值 +1；对象 entries 再避开已占用的键
	let uid = 0;
	for (const e of existing) {
		const u = typeof e.uid === "number" ? e.uid : typeof e.id === "number" ? e.id : Number.NaN;
		if (Number.isFinite(u) && u >= uid) uid = u + 1;
	}
	if (obj) {
		while (Object.hasOwn(obj, String(uid))) uid++;
	}

	const keys = input.keys.map((k) => k.trim()).filter(Boolean);
	const sec = (input.secondaryKeys ?? []).map((k) => k.trim()).filter(Boolean);
	const order =
		typeof input.order === "number" && Number.isFinite(input.order)
			? Math.max(0, Math.min(9999, Math.round(input.order)))
			: 100;

	const raw: Record<string, unknown> = {
		uid,
		key: keys,
		keys,
		keysecondary: sec,
		secondary_keys: sec,
		comment,
		name: comment,
		content,
		constant: input.constant === true,
		selective: input.selective === true && sec.length > 0,
		disable: false,
		enabled: true,
		order,
		insertion_order: order,
		addMemo: true,
	};

	if (obj) {
		obj[String(uid)] = raw;
		json.entries = obj;
	} else {
		json.entries = [...existing, raw];
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(json, null, "\t")}\n`, "utf8");
	return normalizeEntries([raw])[0];
}

/**
 * 归一化条目 → 标准世界书 JSON（entries 为 uid→条目对象，key/keysecondary/disable/order…）。
 * 与酒馆世界信息公开格式兼容，可导回酒馆或再导入梨园。
 * 只写梨园真实承载的字段；对端未写字段走其默认值（粘滞/冷却等扩展不往返）。
 */
export function exportStLorebook(name: string, entries: LorebookEntry[]): Record<string, unknown> {
	const out: Record<string, Record<string, unknown>> = {};
	entries.forEach((e, i) => {
		out[String(i)] = {
			uid: i,
			key: e.keys,
			keysecondary: e.secondaryKeys,
			comment: e.comment,
			content: e.content,
			constant: e.constant,
			selective: e.selective === true && e.secondaryKeys.length > 0,
			disable: !e.enabled,
			order: e.order,
			addMemo: true,
		};
	});
	return { name, entries: out };
}

// ---------- 补充设定集（agent 经 lorebook_write 固化的新正典；缺省落点，非唯一落点） ----------
//
// 8/22：原注写的是「用户原始世界书永远只读」——那条纪律已被用户推翻（agent 现在改得了、
// 删得了用户自己的书，寻址见 server/rest.ts 的 loreWriteTargets）。overlay 仍是**缺省**落点：
// 没指定 book 的写入落这里，与用户的原书分开存放，便于分辨哪些是 agent 写的。

/** 补充设定集条目的 uid 起点（避开常见世界书的 uid 空间，别名缓存按 uid 键控） */
const OVERLAY_UID_BASE = 9000;

/**
 * 补充设定集文件路径（按卡分文件；扩展与 server 面板共用此推导）。
 * 两层布局：先认卡文件夹里的 `补充设定集.json`（迁移落点）；没有再回落
 * `.liyuan-lore/<卡名>.json`（迁移前/还没迁移的项目，行为不变）。
 */
export function overlayPathFor(cwd: string, cardName: string, configCard?: string): string {
	const legacy = join(dir(cwd, "lore"), `${nameSafe(cardName)}.json`);
	if (!configCard) return legacy;
	const space = resolveCardSpace(cwd, configCard);
	if (space && !existsSync(join(space.dir, CARD_OVERLAY_FILE))) return legacy;
	return space ? join(space.dir, CARD_OVERLAY_FILE) : legacy;
}

interface OverlayEntryInput {
	title: string;
	keys: string[];
	content: string;
	constant?: boolean;
}

/**
 * 向补充设定集文件追加一条条目（文件不存在则创建；卡内嵌数组格式，loadLorebookFile 可直接读）。
 * 返回归一化后的新条目；与文件内既有条目内容重复（指纹一致）时返回 null。
 */
export function appendOverlayEntry(path: string, input: OverlayEntryInput): LorebookEntry | null {
	let existing: Record<string, unknown>[] = [];
	if (existsSync(path)) {
		const json = readJsonFile(path) as Record<string, unknown>;
		if (Array.isArray(json.entries)) {
			existing = json.entries.filter((e): e is Record<string, unknown> => !!e && typeof e === "object");
		}
	}
	const fp = loreFingerprint(input.content);
	for (const e of existing) {
		if (typeof e.content === "string" && loreFingerprint(e.content) === fp) return null;
	}
	const raw = {
		uid: OVERLAY_UID_BASE + existing.length,
		keys: input.keys.map((k) => k.trim()).filter(Boolean),
		secondary_keys: [],
		comment: input.title.trim(),
		content: input.content,
		constant: input.constant === true,
		enabled: true,
		insertion_order: 100,
	};
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify({ entries: [...existing, raw] }, null, "\t") + "\n", "utf8");
	return normalizeEntries([raw])[0];
}

/** 合并多来源条目，按 content 去重（卡内嵌书与独立世界书常常内容相同） */
export function mergeEntries(...sources: LorebookEntry[][]): LorebookEntry[] {
	const seen = new Set<string>();
	const merged: LorebookEntry[] = [];
	for (const source of sources) {
		for (const entry of source) {
			const fingerprint = entry.content.trim();
			if (!fingerprint || seen.has(fingerprint)) continue;
			seen.add(fingerprint);
			merged.push(entry);
		}
	}
	return merged;
}

/** 常驻条目（constant && enabled），按 order 排序 */
export function constantEntries(entries: LorebookEntry[]): LorebookEntry[] {
	return entries.filter((e) => e.enabled && e.constant).sort((a, b) => a.order - b.order);
}

/** 合并检索别名（scribe 生成的中文别名等）到条目关键词，去重、不修改原数组 */
export function withAliases(entries: LorebookEntry[], aliases: Map<number, string[]>): LorebookEntry[] {
	return entries.map((e) => {
		const extra = aliases.get(e.uid);
		if (!extra || extra.length === 0) return e;
		const keys = [...e.keys];
		for (const a of extra) {
			if (!keys.some((k) => k.toLowerCase() === a.toLowerCase())) keys.push(a);
		}
		return { ...e, keys };
	});
}

function keyMatches(key: string, textLower: string): boolean {
	const k = key.toLowerCase().trim();
	if (!k) return false;
	if (k.length <= 2) {
		// 极短关键词用词边界匹配，避免误触发
		return new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(textLower);
	}
	return textLower.includes(k);
}

/**
 * ST 式被动激活兜底：在最近的对话文本窗口中做关键词匹配。
 * v0 语义：主关键词任一命中；selective 且有次要关键词时，次要关键词也需任一命中（AND_ANY）。
 */
export function scanEntries(entries: LorebookEntry[], windowText: string, limit: number): LorebookEntry[] {
	const textLower = windowText.toLowerCase();
	const activated = entries.filter((e) => {
		if (!e.enabled || e.constant || e.keys.length === 0) return false;
		if (!e.keys.some((k) => keyMatches(k, textLower))) return false;
		if (e.selective && e.secondaryKeys.length > 0) {
			return e.secondaryKeys.some((k) => keyMatches(k, textLower));
		}
		return true;
	});
	return activated.sort((a, b) => a.order - b.order).slice(0, limit);
}

export interface SearchHit {
	entry: LorebookEntry;
	score: number;
}

/**
 * 主动检索（lorebook_search 工具后端）：
 * 词条打分 = 关键词命中 ×5 + 标题命中 ×3 + 正文出现次数（封顶 3）×1
 */
export function searchEntries(entries: LorebookEntry[], query: string, limit = 3): SearchHit[] {
	const terms = query
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((t) => t.length >= 2);
	if (terms.length === 0) return [];

	const hits: SearchHit[] = [];
	for (const entry of entries) {
		if (!entry.enabled) continue;
		let score = 0;
		const keysLower = entry.keys.concat(entry.secondaryKeys).map((k) => k.toLowerCase());
		const commentLower = entry.comment.toLowerCase();
		const contentLower = entry.content.toLowerCase();
		for (const term of terms) {
			if (keysLower.some((k) => k.includes(term) || term.includes(k))) score += 5;
			if (commentLower.includes(term)) score += 3;
			let count = 0;
			let idx = contentLower.indexOf(term);
			while (idx !== -1 && count < 3) {
				count++;
				idx = contentLower.indexOf(term, idx + term.length);
			}
			score += count;
		}
		if (score > 0) hits.push({ entry, score });
	}
	return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
