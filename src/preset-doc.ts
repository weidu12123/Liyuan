/**
 * 预设文档层 —— 磁盘上存什么、UI 看到什么、开关写回哪里。
 *
 * 定案（docs/PLAN-PRESET-PIPELINES.md §四之一）：**落盘即原文**。用户从酒馆导出的那份
 * JSON 原样存进 `assets/presets/`，导入不转换、不分拣、不判断。要什么信息，读的时候投影。
 *
 * 三条规矩：
 * 1. **原文只增删被点名的字节**：改开关只动 `prompt_order[].enabled`，改内容只动
 *    `prompts[].content`，其余键原样透传——包括梨园根本不认识的键。
 * 2. **预设名＝文件名**。酒馆预设本身没有 `name` 字段（45 个顶层键里没有），
 *    名字在酒馆就是文件名；梨园不往原文里塞私有键，重命名＝重命名文件。
 * 3. **旧梨园格式继续能读**（v1.4.1 及以前导入的 `{name, samplers, blocks}`）：
 *    走降级路径，marker 归位不可用——重新导入原始预设即可恢复。
 */

import {
	type AssemblyEntry,
	type PieceRole,
	pickPromptOrderIndex,
	rpEntries,
	stEntries,
} from "./preset-assemble.ts";
import { normalizeRpPreset, SAMPLER_KEYS } from "./preset.ts";

type PresetKind = "st" | "rp";

export interface PresetDoc {
	kind: PresetKind;
	/** 预设名＝文件名（不来自文件内容） */
	name: string;
	samplers: Record<string, number>;
	/** 原始文件内容，原样持有；写回基于它改 */
	raw: Record<string, unknown>;
	/** 装配用归一条目（含 marker），顺序即 prompt_order */
	entries: AssemblyEntry[];
}

/** 给 UI / 助手工具看的块视图。`channel` 是**派生只读值**，不是可选属性 */
export interface PresetBlockView {
	id: string;
	name: string;
	role: PieceRole;
	enabled: boolean;
	/** 酒馆内置槽位（Chat History / Char Description …）：占位，不可编辑内容 */
	marker: boolean;
	/** 派生：相对 chatHistory 槽位的前后（酒馆里这是位置，不是属性） */
	channel: "system" | "postHistory";
	/** in-chat 深度注入才有 */
	depth?: number;
	chars: number;
	content?: string;
}

export interface PresetBlockPatch {
	id: string;
	enabled?: boolean;
	name?: string;
	content?: string;
	/** 从预设里整块移除（prompts 与 prompt_order 同时摘掉）——8/12 用户点名保留的能力 */
	remove?: boolean;
}

export interface PresetPatch {
	samplers?: Record<string, number>;
	blocks?: PresetBlockPatch[];
	/** 新增块（8/23：预设**创作**——此前只能改已有块，作者用梨园写预设时加不了新块） */
	add?: NewPresetBlock[];
}

/**
 * 新增一个提示词块。
 *
 * 位置就是语义：ST 里「在 chatHistory 之前」= 进 system，「之后」= postHistory，
 * 所以 `before`/`after` 不是排版偏好，是**这块什么时候送达**。缺省追加到末尾。
 * 给了 `depth` 则落成 in-chat 深度注入（`injection_position: 1`），位置改由深度决定。
 */
interface NewPresetBlock {
	/** 块 id；缺省自动生成（与既有 id 冲突时报错，不静默覆盖别人的块） */
	id?: string;
	name: string;
	content: string;
	/** 缺省 system */
	role?: PieceRole;
	/** 缺省 true */
	enabled?: boolean;
	/** 插在这个块之前（id） */
	before?: string;
	/** 插在这个块之后（id） */
	after?: string;
	/** in-chat 深度注入（0=最新一条之后）；给了它就不看 before/after */
	depth?: number;
}

const isStRaw = (raw: Record<string, unknown>): boolean =>
	Array.isArray(raw.prompts) || Array.isArray(raw.prompt_order);

/** 新块 id：可读前缀 + 随机尾巴，肉眼能认出是梨园写的 */
function newBlockId(): string {
	return `ly-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 把 `patch.add` 的新块插进 ST 原文：`prompts[]` 落定义，`prompt_order[].order` 落位置与开关。
 * **两处都要落**——只落 prompts 的块在有 prompt_order 的预设里根本不会被装配（stEntries 以 order 为准）。
 */
function addStBlocks(next: Record<string, unknown>, add: NewPresetBlock[]): string[] {
	const prompts = (Array.isArray(next.prompts) ? next.prompts : []) as Record<string, unknown>[];
	const taken = new Set(prompts.map((p) => (typeof p.identifier === "string" ? p.identifier : "")));
	const orderIdx = pickPromptOrderIndex(next);
	const chosen = orderIdx >= 0 ? (next.prompt_order as Record<string, unknown>[])[orderIdx] : null;
	const order = (chosen?.order ?? []) as Record<string, unknown>[];
	const created: string[] = [];

	for (const b of add) {
		const id = (b.id ?? "").trim() || newBlockId();
		if (taken.has(id)) throw new Error(`预设里已有 id 为 ${id} 的块——改它用 blocks，别用 add`);
		taken.add(id);
		const inChat = typeof b.depth === "number" && Number.isFinite(b.depth);
		prompts.push({
			identifier: id,
			name: b.name.trim() || id,
			role: b.role ?? "system",
			content: b.content,
			system_prompt: false,
			marker: false,
			injection_position: inChat ? 1 : 0,
			injection_depth: inChat ? Math.max(0, Math.trunc(b.depth as number)) : 0,
		});
		const enabled = b.enabled !== false;
		if (chosen) {
			// 位置＝语义（chatHistory 前后决定 system / postHistory），故按 id 定位而非索引
			const at = b.before
				? order.findIndex((o) => o.identifier === b.before)
				: b.after
					? order.findIndex((o) => o.identifier === b.after) + 1
					: -1;
			if (at >= 0) order.splice(at, 0, { identifier: id, enabled });
			else order.push({ identifier: id, enabled });
		}
		created.push(id);
	}

	next.prompts = prompts;
	if (chosen) chosen.order = order;
	return created;
}

function stSamplers(raw: Record<string, unknown>): Record<string, number> {
	const out: Record<string, number> = {};
	for (const key of SAMPLER_KEYS) {
		const v = raw[key];
		if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
	}
	return out;
}

/** 读一份预设文件：原文持有 + 归一条目投影。`name` 由调用方按文件名给 */
export function loadPresetDoc(raw: unknown, name: string): PresetDoc {
	const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
	if (isStRaw(obj)) {
		return { kind: "st", name, samplers: stSamplers(obj), raw: obj, entries: stEntries(obj) };
	}
	const rp = normalizeRpPreset(obj);
	return { kind: "rp", name, samplers: rp.samplers, raw: obj, entries: rpEntries(rp) };
}

/** 归一条目 → UI 视图（channel 由 chatHistory 槽位现场派生） */
export function presetDocView(doc: PresetDoc, opts: { full?: boolean } = {}): PresetBlockView[] {
	const out: PresetBlockView[] = [];
	let afterHistory = false;
	for (const e of doc.entries) {
		if (e.marker && e.identifier === "chatHistory") {
			// chatHistory 本身也列出来：它在酒馆里是可见可拖动的条目，是"历史插在哪"的声明
			out.push({
				id: e.identifier,
				name: e.name,
				role: e.role,
				enabled: e.enabled,
				marker: true,
				channel: afterHistory ? "postHistory" : "system",
				chars: 0,
				...(opts.full ? { content: "" } : {}),
			});
			afterHistory = true;
			continue;
		}
		out.push({
			id: e.identifier,
			name: e.name,
			role: e.role,
			enabled: e.enabled,
			marker: e.marker,
			channel: afterHistory ? "postHistory" : "system",
			...(e.injectionPosition === 1 ? { depth: e.injectionDepth } : {}),
			chars: e.content.length,
			...(opts.full ? { content: e.content } : {}),
		});
	}
	return out;
}

/**
 * 把补丁写回**原文**，返回新的原始 JSON（不改入参）。
 * 只动被点名的字段：开关落 `prompt_order[].enabled`，名字/内容落 `prompts[]`，其余原样。
 */
export function patchPresetRaw(doc: PresetDoc, patch: PresetPatch): Record<string, unknown> {
	const next = structuredClone(doc.raw) as Record<string, unknown>;
	const byId = new Map((patch.blocks ?? []).map((p) => [p.id, p]));
	const removed = new Set((patch.blocks ?? []).filter((p) => p.remove).map((p) => p.id));

	if (doc.kind === "st") {
		// 开关：写进装配时选中的那一份 order（选序规则与 stEntries 同源）
		const orderIdx = pickPromptOrderIndex(next);
		if (orderIdx >= 0) {
			const chosen = (next.prompt_order as Record<string, unknown>[])[orderIdx];
			const order = (chosen?.order ?? []) as Record<string, unknown>[];
			for (const o of order) {
				const p = typeof o.identifier === "string" ? byId.get(o.identifier) : undefined;
				if (p && typeof p.enabled === "boolean") o.enabled = p.enabled;
			}
			if (removed.size > 0 && chosen) {
				chosen.order = order.filter((o) => !(typeof o.identifier === "string" && removed.has(o.identifier)));
			}
		}
		const prompts = (Array.isArray(next.prompts) ? next.prompts : []) as Record<string, unknown>[];
		for (const def of prompts) {
			const p = typeof def.identifier === "string" ? byId.get(def.identifier) : undefined;
			if (!p) continue;
			if (typeof p.name === "string" && p.name.trim()) def.name = p.name.trim();
			if (typeof p.content === "string") def.content = p.content;
			// 没有 prompt_order 时，开关只能落在 prompts[].enabled 上
			if (orderIdx < 0 && typeof p.enabled === "boolean") def.enabled = p.enabled;
		}
		if (removed.size > 0) {
			next.prompts = prompts.filter((d) => !(typeof d.identifier === "string" && removed.has(d.identifier)));
		}
		if (patch.samplers) {
			for (const key of SAMPLER_KEYS) {
				const v = patch.samplers[key];
				if (typeof v === "number" && Number.isFinite(v)) next[key] = v;
			}
		}
		if (patch.add?.length) addStBlocks(next, patch.add);
		return next;
	}

	// 旧梨园格式：原样落回 blocks
	const blocks = (Array.isArray(next.blocks) ? next.blocks : []) as Record<string, unknown>[];
	for (const b of blocks) {
		const p = typeof b.id === "string" ? byId.get(b.id) : undefined;
		if (!p) continue;
		if (typeof p.enabled === "boolean") b.enabled = p.enabled;
		if (typeof p.name === "string" && p.name.trim()) b.name = p.name.trim();
		if (typeof p.content === "string") b.content = p.content;
	}
	let out = removed.size > 0 ? blocks.filter((b) => !(typeof b.id === "string" && removed.has(b.id))) : blocks;
	for (const b of patch.add ?? []) {
		const id = (b.id ?? "").trim() || newBlockId();
		if (out.some((x) => x.id === id)) throw new Error(`预设里已有 id 为 ${id} 的块——改它用 blocks，别用 add`);
		const rec = { id, name: b.name.trim() || id, role: b.role ?? "system", content: b.content, enabled: b.enabled !== false };
		const at = b.before
			? out.findIndex((x) => x.id === b.before)
			: b.after
				? out.findIndex((x) => x.id === b.after) + 1
				: -1;
		if (at >= 0) out = [...out.slice(0, at), rec, ...out.slice(at)];
		else out = [...out, rec];
	}
	next.blocks = out;
	if (patch.samplers) {
		const s: Record<string, number> = {};
		for (const [k, v] of Object.entries(patch.samplers)) {
			if (typeof v === "number" && Number.isFinite(v)) s[k] = v;
		}
		next.samplers = s;
	}
	return next;
}

/** 取单块全文（含 marker 槽位——它没有内容，返回空串） */
export function presetDocBlock(doc: PresetDoc, id: string): PresetBlockView | null {
	return presetDocView(doc, { full: true }).find((b) => b.id === id) ?? null;
}
