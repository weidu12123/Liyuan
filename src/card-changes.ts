/**
 * 卡创作工程的结构账本：非字符串槽位的改动（元数据、新增、删除、封面）。
 *
 * 字符串槽位走 sources/，这里只管 JSON 结构。账本是数据：待删项留在原位只做标记，
 * 追加项按追加时的位置回放，元数据按类型白名单浅覆盖。资源 ID 由路径派生，因此在整个
 * 稿件周期内保持稳定；索引移位只在应用时发生一次，应用后 sources 按新基线整体重写。
 * 白名单只认公开卡格式与生态发行的协议字段，不按作者措辞推断；不在白名单的字段留在原包。
 */
import { randomUUID } from "node:crypto";

type R = Record<string, unknown>;
export const record = (v: unknown): R | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as R : null;
export const pathKey = (path: string[]) => JSON.stringify(path);

export interface CardChanges {
	version: 1;
	/** 待删项的路径（JSON 串），构建时才真正剔除 */
	removed: string[];
	/** 路径 → 高层字段覆盖；字段含义由路径形状决定的类型解释 */
	meta: Record<string, Record<string, unknown>>;
	/** 追加项：path 是草稿视图里的位置，payload 是 spec 形状的完整节点 */
	added: Array<{ path: string[]; payload: unknown }>;
	/** 待换封面：`snapshots/<hash>.cover` 的摘要；仅 PNG 卡 */
	cover?: string;
}
export const emptyChanges = (): CardChanges => ({ version: 1, removed: [], meta: {}, added: [] });
export const hasStructuralChanges = (c: CardChanges) => c.removed.length > 0 || c.added.length > 0 || Object.keys(c.meta).length > 0 || Boolean(c.cover);

/** 节点类型只由路径形状决定 */
type NodeKind = "lore" | "regex" | "script" | "greeting" | "variables" | "depth-prompt" | "card" | "book";
export function nodeKind(path: string[]): NodeKind | null {
	const p = path.join("/");
	if (/(^|\/)character_book\/entries\/[^/]+$/.test(p)) return "lore";
	if (/(^|\/)extensions\/regex_scripts\/\d+$/.test(p)) return "regex";
	if (/(^|\/)extensions\/(TavernHelper|tavern_helper)\/scripts\/\d+$/.test(p)) return "script";
	if (/(^|\/)extensions\/(TavernHelper|tavern_helper)\/variables$/.test(p)) return "variables";
	if (/(^|\/)(alternate_greetings|group_only_greetings)\/\d+$/.test(p)) return "greeting";
	if (/(^|\/)extensions\/depth_prompt$/.test(p)) return "depth-prompt";
	if (/(^|\/)character_book$/.test(p)) return "book";
	if (p === "" || p === "data") return "card";
	return null;
}
/** 可整项删除的类型 */
export const REMOVABLE: ReadonlySet<NodeKind> = new Set(["lore", "regex", "script", "greeting"]);

const LORE_POSITIONS = ["before_char", "after_char", "an_top", "an_bottom", "at_depth", "em_top", "em_bottom"] as const;

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string");
const isNumberArray = (v: unknown): v is number[] => Array.isArray(v) && v.every(x => typeof x === "number" && Number.isFinite(x));
const bool = (v: unknown) => typeof v === "boolean";
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const strv = (v: unknown) => typeof v === "string";
const numOrNull = (v: unknown) => v === null || num(v);

type Check = (v: unknown) => boolean;
const META_FIELDS: Record<NodeKind, Record<string, Check>> = {
	lore: {
		comment: strv, keys: isStringArray, secondary_keys: isStringArray, constant: bool, enabled: bool, selective: bool,
		insertion_order: num, depth: num, role: num, probability: num,
		position: v => (typeof v === "string" && (LORE_POSITIONS as readonly string[]).includes(v)) || (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < LORE_POSITIONS.length),
	},
	regex: {
		scriptName: strv, placement: isNumberArray, disabled: bool, markdownOnly: bool, promptOnly: bool,
		minDepth: numOrNull, maxDepth: numOrNull, trimStrings: isStringArray, substituteRegex: num, runOnEdit: bool,
	},
	script: { name: strv, enabled: bool },
	greeting: {},
	variables: { value: v => record(v) !== null },
	"depth-prompt": { prompt: strv, depth: num, role: strv },
	card: { tags: isStringArray },
	book: { name: strv, description: strv, scan_depth: num, token_budget: num, recursive_scanning: bool },
};

/** 校验并规范一批元数据字段；未知字段或类型不对直接拒绝，不静默丢弃。 */
export function validateMeta(kind: NodeKind, fields: Record<string, unknown>): Record<string, unknown> {
	const allowed = META_FIELDS[kind];
	const out: Record<string, unknown> = {};
	for (const [field, value] of Object.entries(fields)) {
		const check = allowed[field];
		if (!check) throw new Error(`「${kind}」不支持字段 ${field}；可用：${Object.keys(allowed).join(" / ") || "无"}`);
		if (!check(value)) throw new Error(`字段 ${field} 的值不合法`);
		out[field] = value;
	}
	return out;
}

/** 把高层字段写进节点。v3 条目的位置写 `extensions.position` 数字并镜像 v2 字符串。 */
export function applyMeta(kind: NodeKind, node: R, fields: Record<string, unknown>): void {
	const ext = () => {
		const e = record(node.extensions);
		if (e) return e;
		node.extensions = {};
		return node.extensions as R;
	};
	for (const [field, value] of Object.entries(fields)) {
		if (kind === "lore" && (field === "depth" || field === "role" || field === "probability")) { ext()[field] = value; continue; }
		if (kind === "lore" && field === "position") {
			const index = typeof value === "number" ? value : LORE_POSITIONS.indexOf(value as typeof LORE_POSITIONS[number]);
			ext().position = index;
			node.position = LORE_POSITIONS[index];
			continue;
		}
		if (kind === "variables") { for (const k of Object.keys(node)) delete node[k]; Object.assign(node, structuredClone(value)); continue; }
		node[field] = structuredClone(value);
	}
}

export type AddKind = "lore" | "greeting" | "regex" | "script";

function maxNumeric(values: unknown[]): number {
	let max = -1;
	for (const v of values) {
		const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
		if (Number.isFinite(n) && n > max) max = n;
	}
	return max;
}

/**
 * 新增项的默认载荷与落点（在草稿视图上计算）。载荷是公开格式的最小完整形状，
 * 字段覆盖走同一套元数据白名单；正文由 sources 通道编辑。
 */
export function newNode(draft: R, kind: AddKind, fields: Record<string, unknown>): { path: string[]; payload: unknown; meta: Record<string, unknown> } {
	const data = record(draft.data) ?? draft;
	const prefix = data === draft ? [] : ["data"];
	const { content, group, ...rest } = fields;
	if (content !== undefined && typeof content !== "string") throw new Error("content 必须是字符串");
	if (kind === "greeting") {
		if (Object.keys(rest).length) throw new Error("开场白没有元数据字段");
		const field = group === true ? "group_only_greetings" : "alternate_greetings";
		const list = Array.isArray(data[field]) ? data[field] as unknown[] : [];
		return { path: [...prefix, field, String(list.length)], payload: typeof content === "string" ? content : "", meta: {} };
	}
	if (kind === "lore") {
		const meta = validateMeta("lore", rest);
		const book = record(data.character_book);
		const entries = book?.entries;
		const list = Array.isArray(entries) ? entries : record(entries) ? Object.values(entries as R) : [];
		const id = maxNumeric(list.map(e => record(e)?.id)) + 1;
		const key = Array.isArray(entries) || !record(entries) ? String(list.length) : String(maxNumeric(Object.keys(entries as R)) + 1);
		const payload: R = {
			id, keys: [], secondary_keys: [], comment: "", content: typeof content === "string" ? content : "",
			constant: false, selective: false, insertion_order: 100, enabled: true, position: "after_char",
			extensions: { position: 1, depth: 4, role: 0, probability: 100 },
		};
		applyMeta("lore", payload, meta);
		return { path: [...prefix, "character_book", "entries", key], payload, meta: {} };
	}
	const extensions = record(data.extensions) ?? {};
	if (kind === "regex") {
		const meta = validateMeta("regex", rest);
		if (content !== undefined) throw new Error("正则的匹配与替换请在新增后用资源通道编辑");
		const list = Array.isArray(extensions.regex_scripts) ? extensions.regex_scripts : [];
		const payload: R = {
			id: randomUUID(), scriptName: "", findRegex: "", replaceString: "", trimStrings: [], placement: [2],
			disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null,
		};
		applyMeta("regex", payload, meta);
		return { path: [...prefix, "extensions", "regex_scripts", String(list.length)], payload, meta: {} };
	}
	const meta = validateMeta("script", rest);
	const ns = record(extensions.TavernHelper) ? "TavernHelper" : "tavern_helper";
	const helper = record(extensions[ns]);
	const list = Array.isArray(helper?.scripts) ? helper.scripts : [];
	const payload: R = { id: randomUUID(), name: "", content: typeof content === "string" ? content : "", info: "", enabled: true, button: { enabled: false, buttons: [] }, data: {} };
	applyMeta("script", payload, meta);
	return { path: [...prefix, "extensions", ns, "scripts", String(list.length)], payload, meta: {} };
}

function getAt(root: unknown, path: string[]): unknown {
	let v = root;
	for (const key of path) {
		if (v === null || typeof v !== "object" || !Object.hasOwn(v, key)) return undefined;
		v = (v as R)[key];
	}
	return v;
}

/** 缺失的容器按下一段是否为数字下标建数组或对象（只在追加时用） */
function ensureParent(root: R, path: string[]): unknown {
	let v: unknown = root;
	for (let i = 0; i < path.length - 1; i++) {
		const key = path[i];
		const next = path[i + 1];
		const holder = v as R | unknown[];
		let child = Array.isArray(holder) ? holder[Number(key)] : (holder as R)[key];
		if (child === null || typeof child !== "object") {
			child = /^\d+$/.test(next) ? [] : {};
			if (Array.isArray(holder)) holder[Number(key)] = child; else (holder as R)[key] = child;
		}
		v = child;
	}
	return v;
}

export interface DraftView {
	raw: R;
	removed: Set<string>;
	added: Set<string>;
	/** 账本里已经对不上当前基线的项（基线被重新同步过或被外部改动） */
	stale: string[];
}

/** 草稿视图：基线 ＋ 追加 ＋ 元数据覆盖；待删项留在原位。 */
export function draftView(base: R, changes: CardChanges): DraftView {
	const raw = structuredClone(base);
	const stale: string[] = [];
	const added = new Set<string>();
	for (const item of changes.added) {
		const parent = ensureParent(raw, item.path);
		const last = item.path[item.path.length - 1];
		if (Array.isArray(parent)) {
			if (String(parent.length) !== last) { stale.push(pathKey(item.path)); continue; }
			parent.push(structuredClone(item.payload));
		} else if (record(parent)) {
			if (Object.hasOwn(parent as R, last)) { stale.push(pathKey(item.path)); continue; }
			(parent as R)[last] = structuredClone(item.payload);
		} else { stale.push(pathKey(item.path)); continue; }
		added.add(pathKey(item.path));
	}
	for (const [key, fields] of Object.entries(changes.meta)) {
		const path = JSON.parse(key) as string[];
		const kind = nodeKind(path);
		const node = getAt(raw, path);
		if (!kind || !record(node)) { stale.push(key); continue; }
		applyMeta(kind, node as R, fields);
	}
	const removed = new Set<string>();
	for (const key of changes.removed) {
		if (getAt(raw, JSON.parse(key) as string[]) === undefined) { stale.push(key); continue; }
		removed.add(key);
	}
	return { raw, removed, added, stale };
}

/** 路径是否落在某个标记路径之下（含自身） */
export function underAny(path: string[], marks: Set<string>): boolean {
	for (let i = path.length; i >= 1; i--) if (marks.has(pathKey(path.slice(0, i)))) return true;
	return false;
}

/** 构建末尾真正剔除待删项：同一父节点的数组下标倒序 splice，对象直接删键。 */
export function pruneRemoved(raw: R, removed: Set<string>): void {
	const paths = [...removed].map(k => JSON.parse(k) as string[]);
	const byParent = new Map<string, string[][]>();
	for (const p of paths) {
		const parentKey = pathKey(p.slice(0, -1));
		byParent.set(parentKey, [...(byParent.get(parentKey) ?? []), p]);
	}
	for (const [parentKey, group] of byParent) {
		const parent = getAt(raw, JSON.parse(parentKey) as string[]);
		if (Array.isArray(parent)) {
			const indices = [...new Set(group.map(p => Number(p[p.length - 1])))].sort((a, b) => b - a);
			for (const i of indices) if (Number.isInteger(i) && i < parent.length) parent.splice(i, 1);
		} else if (record(parent)) {
			for (const p of group) delete (parent as R)[p[p.length - 1]];
		}
	}
}

/** 重新同步时按新基线重排追加项的下标；父容器不存在的按空数组算。 */
export function reindexAdded(base: R, added: CardChanges["added"]): CardChanges["added"] {
	const counters = new Map<string, number>();
	return added.map(item => {
		const parentPath = item.path.slice(0, -1);
		const last = item.path[item.path.length - 1];
		if (!/^\d+$/.test(last)) return item; // 对象键：位置不随基线移动
		const parent = getAt(base, parentPath);
		const length = Array.isArray(parent) ? parent.length : 0;
		const key = pathKey(parentPath);
		const offset = counters.get(key) ?? 0;
		counters.set(key, offset + 1);
		return { ...item, path: [...parentPath, String(length + offset)] };
	});
}
