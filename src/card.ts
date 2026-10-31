/**
 * 角色卡解析：PNG（tEXt chunk 内嵌 chara/ccv3）与裸 JSON 两种来源。
 *
 * PNG 提取按公开的 Character Card V2/V3 规范自行实现（PLAN.md D5：不参考 ST 实现代码）：
 * - PNG = 8 字节签名 + 一串 chunk；chunk = 4B 大端长度 + 4B 类型 + data + 4B CRC
 * - tEXt chunk 的 data = keyword + 0x00 + text（latin1）
 * - 角色卡存放在 keyword 为 "ccv3"（V3）或 "chara"（V2/V1）的 tEXt 中，text 为 base64(JSON)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { CharacterCard, LorebookEntry } from "./types.ts";
import { normalizeEntries } from "./lorebook.ts";
export { applyMacros } from "./card-macros.ts";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * JSON 卡的侧挂封面路径：卡本体同目录同名 `.png`（裸图，不含卡数据）。
 * 这是 JSON 卡封面的唯一寻址规则（工坊应用落盘、图片端点回落、导出当壳、删卡清理共用）。
 * 不进卡库：裸图解析不出卡名，`listCardLibrary` 按「非角色卡」跳过；卡文件夹内
 * `cardFileIn` 字典序 `.json` 先于 `.png`，卡本体身份不受影响。
 */
export const coverSidecarOf = (cardPath: string): string => cardPath.replace(/\.json$/i, ".png");

/** 从 PNG buffer 中提取全部 tEXt 键值对 */
function extractPngTextChunks(buf: Buffer): Record<string, string> {
	if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
		throw new Error("不是有效的 PNG 文件（签名不匹配）");
	}
	const result: Record<string, string> = {};
	let offset = 8;
	while (offset + 12 <= buf.length) {
		const length = buf.readUInt32BE(offset);
		const type = buf.toString("ascii", offset + 4, offset + 8);
		const dataStart = offset + 8;
		const dataEnd = dataStart + length;
		if (dataEnd + 4 > buf.length) break; // 损坏的尾部，停止
		if (type === "tEXt") {
			const data = buf.subarray(dataStart, dataEnd);
			const sep = data.indexOf(0x00);
			if (sep > 0) {
				const keyword = data.toString("latin1", 0, sep);
				const text = data.toString("latin1", sep + 1);
				result[keyword] = text;
			}
		}
		if (type === "IEND") break;
		offset = dataEnd + 4; // 跳过 CRC
	}
	return result;
}

/** 从 PNG 文件读取角色卡 JSON（优先 ccv3，回退 chara） */
export function readCardJsonFromPng(buf: Buffer): unknown {
	const chunks = extractPngTextChunks(buf);
	const raw = chunks["ccv3"] ?? chunks["chara"];
	if (!raw) {
		throw new Error("PNG 中没有找到角色卡数据（无 ccv3/chara tEXt chunk）");
	}
	const json = Buffer.from(raw, "base64").toString("utf8");
	return JSON.parse(json);
}

function str(v: unknown): string {
	return typeof v === "string" ? v.replace(/\r\n/g, "\n") : "";
}

function strArray(v: unknown): string[] {
	return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * 归一化任意来源的角色卡 JSON。
 * 兼容：V3/V2（字段在 .data）、V1 与 ST 旧导出（字段在顶层）。
 * 顶层与 data 同时存在时以 data 为准。
 */
export function normalizeCard(input: unknown): CharacterCard {
	if (!input || typeof input !== "object") {
		throw new Error("角色卡 JSON 不是对象");
	}
	const top = input as Record<string, unknown>;
	const data = (top.data && typeof top.data === "object" ? top.data : {}) as Record<string, unknown>;
	const pick = (field: string): unknown => (field in data ? data[field] : top[field]);

	const name = str(pick("name"));
	if (!name) {
		throw new Error("角色卡缺少 name 字段");
	}

	let book: LorebookEntry[] = [];
	const rawBook = pick("character_book");
	if (rawBook && typeof rawBook === "object") {
		const entries = (rawBook as Record<string, unknown>).entries;
		book = normalizeEntries(entries);
	}

	return {
		name,
		description: str(pick("description")),
		personality: str(pick("personality")),
		scenario: str(pick("scenario")),
		firstMes: str(pick("first_mes")),
		mesExample: str(pick("mes_example")),
		systemPrompt: str(pick("system_prompt")),
		postHistoryInstructions: str(pick("post_history_instructions")),
		creatorNotes: str(pick("creator_notes")) || str(top.creatorcomment),
		alternateGreetings: strArray(pick("alternate_greetings")),
		tags: strArray(pick("tags")),
		book,
	};
}

/** 从文件加载角色卡（按魔数区分 PNG / JSON，不依赖扩展名） */
export function loadCardFile(path: string): CharacterCard {
	const buf = readFileSync(path);
	if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
		return normalizeCard(readCardJsonFromPng(buf));
	}
	return normalizeCard(JSON.parse(buf.toString("utf8")));
}

// ---------- 卡字段写回（PLAN-PANELS-V2 §2.2：JSON 与 PNG tEXt 均可） ----------

export interface CardFieldPatch {
	name?: string;
	description?: string;
	personality?: string;
	scenario?: string;
	creatorNotes?: string;
	firstMes?: string;
	/** mes_example / system_prompt / post_history_instructions / tags 等按需扩展 */
	mesExample?: string;
	systemPrompt?: string;
	postHistoryInstructions?: string;
	tags?: string[];
}

/**
 * 把字段补丁写回卡文件（V2/V3 写 .data，V1 写顶层；JSON 与 PNG 均支持）。
 * PNG = 改 tEXt 内嵌 JSON，立绘像素不动。
 */
export function updateCardFields(path: string, patch: CardFieldPatch): void {
	const { isPng, raw } = readCardRawJson(path);
	const target = cardDataTarget(raw);
	if (patch.name !== undefined) {
		if (!patch.name.trim()) throw new Error("卡名不能为空");
		target.name = patch.name.trim();
	}
	if (patch.description !== undefined) target.description = patch.description;
	if (patch.personality !== undefined) target.personality = patch.personality;
	if (patch.scenario !== undefined) target.scenario = patch.scenario;
	if (patch.firstMes !== undefined) target.first_mes = patch.firstMes;
	if (patch.creatorNotes !== undefined) target.creator_notes = patch.creatorNotes;
	if (patch.mesExample !== undefined) target.mes_example = patch.mesExample;
	if (patch.systemPrompt !== undefined) target.system_prompt = patch.systemPrompt;
	if (patch.postHistoryInstructions !== undefined) target.post_history_instructions = patch.postHistoryInstructions;
	if (patch.tags !== undefined) target.tags = patch.tags;
	// 规范外壳：无 spec 的裸对象补成 V2，便于 ST 生态互通
	if (!raw.spec && !isPng) {
		// 保持原结构；PNG 内 JSON 若已是 V2/V3 不动
	}
	if (raw.spec === undefined && raw.data && typeof raw.data === "object") {
		// already nested
	} else if (raw.spec === undefined && !raw.data) {
		// V1 顶层卡：不强制升 V2，避免破坏用户习惯
	}
	writeCardRaw(path, isPng, raw);
}

// ---------- PNG tEXt 回写 + 开场白 CRUD ----------

/** PNG CRC（IEEE，与 PNG 规范一致） */
function pngCrc32(buf: Buffer): number {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		c ^= buf[i];
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
	}
	return (c ^ 0xffffffff) >>> 0;
}

function buildPngChunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const typeBuf = Buffer.from(type, "ascii");
	const crcBuf = Buffer.alloc(4);
	crcBuf.writeUInt32BE(pngCrc32(Buffer.concat([typeBuf, data])), 0);
	return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * 把角色卡 JSON 写回 PNG 的 chara/ccv3 tEXt（优先改已有 keyword；都没有则在 IEND 前插入 chara）。
 */
export function writeCardJsonToPng(buf: Buffer, json: unknown): Buffer {
	if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
		throw new Error("不是有效的 PNG 文件");
	}
	const chunks = extractPngTextChunks(buf);
	const keyword = chunks["ccv3"] !== undefined ? "ccv3" : "chara";
	const b64 = Buffer.from(JSON.stringify(json), "utf8").toString("base64");
	const textData = Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0]), Buffer.from(b64, "latin1")]);

	const out: Buffer[] = [buf.subarray(0, 8)];
	let offset = 8;
	let replaced = false;
	while (offset + 12 <= buf.length) {
		const length = buf.readUInt32BE(offset);
		const type = buf.toString("ascii", offset + 4, offset + 8);
		const dataStart = offset + 8;
		const dataEnd = dataStart + length;
		if (dataEnd + 4 > buf.length) break;
		const whole = buf.subarray(offset, dataEnd + 4);
		if (type === "tEXt") {
			const data = buf.subarray(dataStart, dataEnd);
			const sep = data.indexOf(0x00);
			const kw = sep > 0 ? data.toString("latin1", 0, sep) : "";
			if (kw === keyword) {
				out.push(buildPngChunk("tEXt", textData));
				replaced = true;
			} else {
				out.push(whole);
			}
		} else if (type === "IEND") {
			if (!replaced) out.push(buildPngChunk("tEXt", textData));
			out.push(whole);
			break;
		} else {
			out.push(whole);
		}
		offset = dataEnd + 4;
	}
	return Buffer.concat(out);
}

/** 读卡原始 JSON 对象（编辑用，保留 data 结构） */
export function readCardRawJson(path: string): { isPng: boolean; raw: Record<string, unknown> } {
	return readCardRawBuffer(readFileSync(path));
}

/** 与磁盘读取共用，保证快照按同一份字节解析。 */
export function readCardRawBuffer(buf: Buffer): { isPng: boolean; raw: Record<string, unknown> } {
	const isPng = buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
	if (isPng) {
		const j = readCardJsonFromPng(buf);
		if (!j || typeof j !== "object") throw new Error("角色卡 JSON 无效");
		return { isPng: true, raw: j as Record<string, unknown> };
	}
	const j = JSON.parse(buf.toString("utf8")) as unknown;
	if (!j || typeof j !== "object") throw new Error("角色卡 JSON 无效");
	return { isPng: false, raw: j as Record<string, unknown> };
}

function cardDataTarget(raw: Record<string, unknown>): Record<string, unknown> {
	return (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
}

function writeCardRaw(path: string, isPng: boolean, raw: Record<string, unknown>): void {
	if (isPng) {
		const buf = readFileSync(path);
		writeFileSync(path, writeCardJsonToPng(buf, raw));
	} else {
		writeFileSync(path, `${JSON.stringify(raw, null, "\t")}\n`, "utf8");
	}
}

/**
 * 写入整表开场白：greetings[0]=first_mes，其余=alternate_greetings。
 * 至少保留 1 条；支持 JSON 与 PNG 卡。
 */
export function setCardGreetings(path: string, greetings: string[]): void {
	const list = greetings.map((g) => g.replace(/\r\n/g, "\n"));
	if (list.length === 0) throw new Error("至少保留一条开场白");
	const { isPng, raw } = readCardRawJson(path);
	const target = cardDataTarget(raw);
	target.first_mes = list[0];
	target.alternate_greetings = list.slice(1);
	writeCardRaw(path, isPng, raw);
}

/** 更新单条开场白（index 0=first_mes） */
export function updateCardGreeting(path: string, index: number, text: string): void {
	const card = loadCardFile(path);
	const pool = [card.firstMes, ...card.alternateGreetings];
	if (index < 0 || index >= pool.length) throw new Error(`开场白序号越界：${index}`);
	pool[index] = text.replace(/\r\n/g, "\n");
	setCardGreetings(path, pool);
}

/** 追加一条备选开场白 */
export function addCardGreeting(path: string, text = ""): number {
	const card = loadCardFile(path);
	const pool = [card.firstMes, ...card.alternateGreetings, text.replace(/\r\n/g, "\n")];
	setCardGreetings(path, pool);
	return pool.length - 1;
}

/** 删除一条开场白（不能删光） */
export function deleteCardGreeting(path: string, index: number): void {
	const card = loadCardFile(path);
	const pool = [card.firstMes, ...card.alternateGreetings];
	if (pool.length <= 1) throw new Error("至少保留一条开场白");
	if (index < 0 || index >= pool.length) throw new Error(`开场白序号越界：${index}`);
	pool.splice(index, 1);
	setCardGreetings(path, pool);
}

/**
 * 开场白上下移动（index 0=默认 first_mes，可与备选互换）。
 * delta: -1 上移 / +1 下移。返回新位置。
 */
export function moveCardGreeting(path: string, index: number, delta: number): number {
	const card = loadCardFile(path);
	const pool = [card.firstMes, ...card.alternateGreetings];
	if (pool.length <= 1) throw new Error("只有一条开场白，无法移动");
	if (index < 0 || index >= pool.length) throw new Error(`开场白序号越界：${index}`);
	const to = index + delta;
	if (to < 0 || to >= pool.length) throw new Error(delta < 0 ? "已是第一条" : "已是最后一条");
	const [item] = pool.splice(index, 1);
	pool.splice(to, 0, item);
	setCardGreetings(path, pool);
	return to;
}

/** greetingIndex 在移动 index→to 后的新值 */
export function remapGreetingIndexAfterMove(gi: number, from: number, to: number): number {
	if (gi === from) return to;
	if (from < to && gi > from && gi <= to) return gi - 1;
	if (from > to && gi >= to && gi < from) return gi + 1;
	return gi;
}

// ---------- 导出（JSON / PNG；可并入活跃世界书） ----------

export type CardExportLoreMode = "none" | "embedded" | "active";

/** 只在导出路径携带原始条目，不进入演出上下文。 */
export interface CardExportEntry extends LorebookEntry {
	raw?: Record<string, unknown>;
	worldbookSource?: boolean;
}

export function loreEntriesForExport(entries: unknown, worldbookSource = false): CardExportEntry[] {
	const list = (Array.isArray(entries) ? entries : entries && typeof entries === "object" ? Object.values(entries) : [])
		.filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && !Array.isArray(e));
	return normalizeEntries(list).map((e, i) => ({ ...e, raw: list[i], worldbookSource }));
}

const EXPORT_ENTRY_FIELDS: Array<[keyof LorebookEntry, string, string?]> = [
	["uid", "id", "uid"], ["keys", "keys", "key"], ["secondaryKeys", "secondary_keys", "keysecondary"],
	["comment", "comment", "name"], ["content", "content"], ["constant", "constant"],
	["selective", "selective"], ["enabled", "enabled"], ["order", "insertion_order", "order"],
];

/** 活跃书沿用内容去重优先级；匹配原条目时保留其身份，其余重复原条目不丢。 */
export function mergeExportLore(embedded: CardExportEntry[], active: CardExportEntry[]): CardExportEntry[] {
	const combined = [...embedded];
	for (const entry of active) {
		const matches = (e: CardExportEntry) => e.content.trim() === entry.content.trim();
		let index = embedded.findIndex(e => matches(e) && e.uid === entry.uid);
		if (index < 0) index = embedded.findIndex(matches);
		if (index < 0) { combined.push(entry); continue; }
		const original = embedded[index];
		const base = original.raw ?? (entriesToCharacterBook([original]).entries as Record<string, unknown>[])[0];
		const current = (entriesToCharacterBook([entry]).entries as Record<string, unknown>[])[0];
		const raw: Record<string, unknown> = {
			...base, ...current,
			extensions: { ...(base.extensions as object ?? {}), ...(current.extensions as object ?? {}) },
		};
		for (const key of ["id", "uid"]) {
			if (Object.hasOwn(base, key)) raw[key] = base[key];
			else delete raw[key];
		}
		if (!Object.hasOwn(entry.raw ?? {}, "position") && Object.hasOwn(base, "position")) raw.position = base.position;
		for (const [field, , alias] of EXPORT_ENTRY_FIELDS) {
			if (field !== "uid" && alias && Object.hasOwn(raw, alias)) raw[alias] = entry[field];
		}
		if (Object.hasOwn(raw, "disable")) raw.disable = !entry.enabled;
		combined[index] = { ...entry, uid: original.uid, raw, worldbookSource: false };
	}
	return combined;
}

/**
 * 导出时在原条目上回写变化，保留书级、条目级和插件扩展。
 * 只有没有原始来源的新条目才创建标准外壳。
 */
function entriesToCharacterBook(entries: CardExportEntry[], original?: unknown): Record<string, unknown> {
	const book = original && typeof original === "object" ? original as Record<string, unknown> : {};
	const candidates = loreEntriesForExport(book.entries);
	const used = new Set<number>();
	const result = entries.map(e => {
		const index = candidates.findIndex((c, i) => !used.has(i) && c.uid === e.uid && c.content === e.content);
		if (index >= 0) used.add(index);
		const source = e.raw ?? candidates[index]?.raw;
		const out: Record<string, unknown> = source ? JSON.parse(JSON.stringify(source)) : { position: "before_char", extensions: {} };
		const before = source ? normalizeEntries([source])[0] : undefined;
		for (const [field, canonical, alias] of EXPORT_ENTRY_FIELDS) {
			if (field === "uid" && source && !e.worldbookSource && !Object.hasOwn(source, "id") && !Object.hasOwn(source, "uid")) continue;
			if (!before || e.worldbookSource || JSON.stringify(e[field]) !== JSON.stringify(before[field])) {
				const key = !e.worldbookSource && alias && Object.hasOwn(out, alias) && !Object.hasOwn(out, canonical) ? alias : canonical;
				// uid=0 也是有效身份，不能用 || 序号替代。
				out[key] = e[field];
				if (alias && alias !== key && Object.hasOwn(out, alias)) out[alias] = e[field];
			}
		}
		if (source && before?.enabled !== e.enabled && Object.hasOwn(source, "disable")) out.disable = !e.enabled;
		if (e.worldbookSource) {
			const ext = source?.extensions && typeof source.extensions === "object" ? { ...source.extensions as object } : {};
			if (typeof source?.position === "number") {
				Object.assign(ext, { position: source.position });
				out.position = source.position === 1 ? "after_char" : "before_char";
			} else if (out.position === undefined) out.position = "before_char";
			for (const key of ["depth", "role", "probability", "useProbability", "selectiveLogic", "excludeRecursion", "preventRecursion", "delayUntilRecursion", "sticky", "cooldown", "delay"]) {
				if (source && Object.hasOwn(source, key)) Object.assign(ext, { [key]: source[key] });
			}
			out.extensions = ext;
		}
		return out;
	});
	// 无变更时连对象式 entries 的键和非条目数据也原样保留。
	if (Object.hasOwn(book, "entries") && result.length === candidates.length &&
		result.every((e, i) => JSON.stringify(e) === JSON.stringify(candidates[i].raw))) {
		return JSON.parse(JSON.stringify(book));
	}
	return { ...JSON.parse(JSON.stringify(book)), entries: result };
}

/**
 * 组装导出用原始卡 JSON（保留 V2/V3 外壳；可替换 character_book）。
 * @param bookEntries 若提供则写入/覆盖 data.character_book；null=去掉内嵌书；undefined=保留磁盘上的原书
 */
function buildExportCardJson(
	path: string,
	bookEntries?: CardExportEntry[] | null,
): Record<string, unknown> {
	const { raw } = readCardRawJson(path);
	// 深拷贝，避免改内存里的磁盘对象引用
	const out = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
	// 升格为 chara_card_v2 外壳（无 spec 的 V1 也能被 ST 认）
	if (!out.spec) {
		const data = cardDataTarget(out);
		const wrapped: Record<string, unknown> = {
			spec: "chara_card_v2",
			spec_version: "2.0",
			data: { ...data },
		};
		if (bookEntries !== undefined) {
			if (bookEntries === null) delete (wrapped.data as Record<string, unknown>).character_book;
			else if (bookEntries.length || data.character_book !== undefined) (wrapped.data as Record<string, unknown>).character_book = entriesToCharacterBook(bookEntries, data.character_book);
		}
		return wrapped;
	}
	const data = cardDataTarget(out);
	if (bookEntries !== undefined) {
		if (bookEntries === null) delete data.character_book;
		else if (bookEntries.length || data.character_book !== undefined) data.character_book = entriesToCharacterBook(bookEntries, data.character_book);
	}
	return out;
}

/**
 * 最小合法 PNG（1×1 灰像素），供「仅 JSON 卡 → 导出 PNG」当底图。
 * 公共域构造；立绘可后续用用户图替换。
 */
export function minimalPngBuffer(): Buffer {
	// 预计算好的 1x1 灰色 PNG（68 bytes）
	return Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
		"base64",
	);
}

interface CardExportResult {
	/** 建议文件名（不含路径） */
	filename: string;
	mime: string;
	/** utf8 JSON 文本，或 PNG 二进制 */
	body: Buffer;
	format: "json" | "png";
	loreMode: CardExportLoreMode;
	loreCount: number;
}

/**
 * 导出角色卡。
 * - format=json：chara_card_v2 JSON
 * - format=png：底图=原 PNG 立绘，若源是 JSON 则用 1×1 占位图 + tEXt
 * - loreMode=active 时由调用方传入已合并的 bookEntries（挂载书+补充设定±原内嵌）
 */
export function exportCardFile(
	path: string,
	opts: {
		format: "json" | "png";
		loreMode: CardExportLoreMode;
		/** active 可传活跃世界书；省略则保留卡内原书。 */
		bookEntries?: CardExportEntry[];
	},
): CardExportResult {
	const card = loadCardFile(path);
	const safeName = card.name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "character";

	let bookEntries: CardExportEntry[] | null | undefined;
	let loreCount = 0;
	if (opts.loreMode === "none") {
		bookEntries = null;
	} else if (opts.loreMode === "embedded") {
		// 保留原书，包括重复内容、同名条目、禁用条目与未知字段。
		bookEntries = undefined;
		loreCount = card.book.length;
	} else {
		bookEntries = opts.bookEntries;
		loreCount = bookEntries?.length ?? card.book.length;
	}

	const json = buildExportCardJson(path, bookEntries);

	if (opts.format === "json") {
		return {
			filename: `${safeName}.json`,
			mime: "application/json; charset=utf-8",
			body: Buffer.from(`${JSON.stringify(json, null, "\t")}\n`, "utf8"),
			format: "json",
			loreMode: opts.loreMode,
			loreCount,
		};
	}

	const buf = readFileSync(path);
	const isPng = buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
	// JSON 卡导出 PNG：有侧挂封面就拿它当壳（替掉占位图），封面跟着导出走
	let base: Buffer;
	if (isPng) base = buf;
	else {
		const sidecar = coverSidecarOf(path);
		base = existsSync(sidecar) ? readFileSync(sidecar) : minimalPngBuffer();
	}
	const png = writeCardJsonToPng(base, json);
	return {
		filename: `${safeName}.png`,
		mime: "image/png",
		body: png,
		format: "png",
		loreMode: opts.loreMode,
		loreCount,
	};
}
