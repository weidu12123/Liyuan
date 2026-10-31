/**
 * 酒馆预设装配器 —— 模拟酒馆引擎按开关拼一次，产出静态提示词材料。
 *
 * 设计（docs/PLAN-PRESET-PIPELINES.md §四）：酒馆靠 `prompt_order` 定序、`marker` 定位、
 * `setvar`/`getvar` 每轮重拼；梨园提示词是静态的，**开关一动重拼一次**即可。
 *
 * 铁律三：本模块只认酒馆自己发行的协议字段（`identifier` / `marker` / `prompt_order` /
 * `injection_*`），不认卡作者与预设作者的措辞——**没有、也不许有任何"块名名单"**。
 * 唯一的常量表 `MARKER_SLOTS` 是酒馆内置槽位的闭合集（ST schema 自带的固定 identifier），
 * 用途是"哪个槽填哪份梨园材料"的映射，不是用来猜作者写了什么。
 *
 * 语义要点（与酒馆对齐）：
 * - **权威开关在 `prompt_order[].enabled`**，不是 `prompts[].enabled`；不在 order 里的块根本不参与。
 * - 关闭块**不求值**：它的 `setvar` 副作用在酒馆里也不会发生。
 * - `setvar` 块自己不吐字（求值后为空），值由后面别的块的 `getvar` 在另一个位置吐出来——
 *   所以必须"跑一遍装配拿成品"，不能"逐块展开"。
 * - 求值后零字的片段一律丢弃（判据：字没到模型＝死）；但**副作用已经发生**，不影响后续 getvar。
 * - marker 填的是梨园自己的材料，**不过宏求值**（它们不是预设作者的字，已在各自通道处理过）。
 */

import { createMacroEnv, evalPresetMacros } from "./preset-macro.ts";
import type { RpPreset } from "./preset.ts";

/** 酒馆内置 marker 槽位：identifier → 填什么材料。`chatHistory` 只标位置，不填料。 */
const MARKER_SLOTS = {
	worldInfoBefore: "worldInfoBefore",
	charDescription: "charDescription",
	charPersonality: "charPersonality",
	scenario: "scenario",
	worldInfoAfter: "worldInfoAfter",
	personaDescription: "personaDescription",
	dialogueExamples: "dialogueExamples",
	chatHistory: "chatHistory",
} as const;

type MarkerId = keyof typeof MARKER_SLOTS;

/** 梨园侧材料：按酒馆的槽位交货，位置由预设作者的 prompt_order 决定 */
export type MarkerMaterials = Partial<Record<Exclude<MarkerId, "chatHistory">, string>>;

export type PieceRole = "system" | "user" | "assistant";

export interface AssembledPiece {
	/** 来源：预设块本身 / marker 槽位填入的梨园材料 */
	source: "block" | "marker";
	id: string;
	name: string;
	role: PieceRole;
	/** 预设块＝宏求值后的文本；marker＝梨园材料原文 */
	text: string;
}

export interface DepthPiece extends AssembledPiece {
	/** in-chat 注入深度（酒馆 injection_depth） */
	depth: number;
	/**
	 * 同深度内的排序键（酒馆 injection_order）。
	 * ⚠ 排序方向尚未用酒馆黄金对照验证，本模块只忠实记录并按升序稳定排列；
	 * 深度注入的真实消费在后续里程碑接入（PLAN §七 任务一「消费分步」）。
	 */
	order: number;
}

type AssembleAction =
	| "历史前"
	| "历史后"
	| "深度注入"
	| "marker 槽位"
	| "marker 无料"
	| "关闭"
	| "缺失定义"
	| "零字";

export interface AssembleReportItem {
	identifier: string;
	name: string;
	action: AssembleAction;
	/** 只记长度，不外显内容（沿用 src/preset.ts 的分工红线） */
	chars: number;
	depth?: number;
}

export interface AssembleResult {
	/** chatHistory 槽位之前的片段（按 prompt_order 原序） */
	before: AssembledPiece[];
	/** chatHistory 槽位之后的片段（按 prompt_order 原序） */
	after: AssembledPiece[];
	/** injection_position=1 的深度注入片段（按 depth、order 稳定排序） */
	depth: DepthPiece[];
	/** 装配中遇到的 marker 槽位（按序），含启用但没料的 */
	markers: Array<{ id: string; enabled: boolean; filled: boolean }>;
	/** 清单外宏名（去重），交调用方上报降级 */
	unsupported: string[];
	/** 装配结束时的变量表快照 */
	vars: Map<string, string>;
	/**
	 * 用到 `{{lastusermessage}}` 的块 identifier。
	 * 这是"拼一次即静态"的唯一破口：命中则该次装配结果与本轮用户原话绑定，调用方自行决定
	 * 是重拼还是承认它在 agent 架构下无意义（PLAN §四之二）。
	 */
	usesLastUserMessage: string[];
	report: AssembleReportItem[];
}

/** 装配前的归一条目：酒馆原始格式与旧梨园格式都先转成它，装配核心只认这一种 */
export interface AssemblyEntry {
	identifier: string;
	name: string;
	enabled: boolean;
	role: PieceRole;
	content: string;
	marker: boolean;
	/** 0＝相对定位（按 order 位置）；1＝in-chat 深度注入 */
	injectionPosition: number;
	injectionDepth: number;
	injectionOrder: number;
	/** order 里点了名、prompts 里没有定义 */
	missing?: boolean;
}

interface AssembleOptions {
	materials?: MarkerMaterials;
	charName?: string;
	userName?: string;
	/** 本轮用户原话（`{{lastusermessage}}`）；不给＝空串 */
	userText?: string;
}

const asRole = (v: unknown): PieceRole => (v === "user" || v === "assistant" ? v : "system");

const asNumber = (v: unknown, fallback: number): number =>
	typeof v === "number" && Number.isFinite(v) ? v : fallback;

const asString = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

const isMarkerId = (id: string): id is MarkerId => Object.hasOwn(MARKER_SLOTS, id);

/**
 * 选中要用的 `prompt_order` 条目下标：默认角色（character_id 100001）优先，否则第一份。
 * 返回 -1＝没有可用的 order（装配退回 prompts 原序，写回也落到 prompts 上）。
 * 装配与写回必须用同一条规则选序，否则开关会写到另一份序里。
 */
export function pickPromptOrderIndex(raw: Record<string, unknown>): number {
	if (!Array.isArray(raw.prompt_order)) return -1;
	const entries = raw.prompt_order as unknown[];
	let first = -1;
	for (let i = 0; i < entries.length; i++) {
		const e = entries[i];
		if (!e || typeof e !== "object") continue;
		const rec = e as Record<string, unknown>;
		if (!Array.isArray(rec.order)) continue;
		if (first < 0) first = i;
		if (rec.character_id === 100001) return i;
	}
	return first;
}

/** 酒馆原始预设 JSON → 归一条目（权威开关取 prompt_order） */
export function stEntries(raw: Record<string, unknown>): AssemblyEntry[] {
	const prompts = Array.isArray(raw.prompts)
		? (raw.prompts as unknown[]).filter(
				(p): p is Record<string, unknown> => !!p && typeof p === "object",
			)
		: [];
	const byId = new Map<string, Record<string, unknown>>();
	for (const p of prompts) {
		const id = p.identifier;
		if (typeof id === "string") byId.set(id, p);
	}

	// prompt_order：默认角色（character_id 100001）优先，否则第一份；都没有才退回 prompts 原序
	let order: Array<{ identifier: string; enabled: boolean }> = [];
	const orderIdx = pickPromptOrderIndex(raw);
	if (orderIdx >= 0) {
		const chosen = (raw.prompt_order as Record<string, unknown>[])[orderIdx];
		order = ((chosen?.order ?? []) as unknown[])
			.filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
			.filter((o) => typeof o.identifier === "string")
			.map((o) => ({ identifier: o.identifier as string, enabled: o.enabled !== false }));
	}
	if (order.length === 0) {
		order = prompts
			.filter((p) => typeof p.identifier === "string")
			.map((p) => ({ identifier: p.identifier as string, enabled: p.enabled !== false }));
	}

	return order.map(({ identifier, enabled }) => {
		const def = byId.get(identifier);
		if (!def) {
			return {
				identifier,
				name: "",
				enabled,
				role: "system" as const,
				content: "",
				marker: false,
				injectionPosition: 0,
				injectionDepth: 0,
				injectionOrder: 0,
				missing: true,
			};
		}
		return {
			identifier,
			name: asString(def.name, identifier),
			enabled,
			role: asRole(def.role),
			content: asString(def.content),
			// 结构判定优先；identifier 兜底是给缺 marker 字段的老预设用的
			marker: def.marker === true || isMarkerId(identifier),
			injectionPosition: asNumber(def.injection_position, 0),
			injectionDepth: asNumber(def.injection_depth, 0),
			injectionOrder: asNumber(def.injection_order, 0),
		};
	});
}

/**
 * 旧梨园格式（v1.4.1 及以前导入的 `{name, samplers, blocks}`）→ 归一条目。
 * 原始格式里的 marker 在那次有损转换中已经丢了，无从恢复：这里只按 channel 补一个
 * 合成的 chatHistory 槽位标位置，**marker 归位对旧文件不可用**（重新导入原始预设即可恢复）。
 */
export function rpEntries(preset: RpPreset): AssemblyEntry[] {
	const entries: AssemblyEntry[] = [];
	let historyPlaced = false;
	const placeHistory = () => {
		historyPlaced = true;
		entries.push({
			identifier: "chatHistory",
			name: "Chat History",
			enabled: true,
			role: "system",
			content: "",
			marker: true,
			injectionPosition: 0,
			injectionDepth: 0,
			injectionOrder: 0,
		});
	};

	for (const b of preset.blocks) {
		if (b.channel === "postHistory" && !historyPlaced) placeHistory();
		entries.push({
			identifier: b.id,
			name: b.name,
			enabled: b.enabled,
			role: asRole(b.role),
			content: b.content,
			marker: false,
			injectionPosition: typeof b.depth === "number" ? 1 : 0,
			injectionDepth: b.depth ?? 0,
			injectionOrder: 0,
		});
	}
	if (!historyPlaced) placeHistory();
	return entries;
}

const LAST_USER_MESSAGE = /\{\{\s*lastusermessage\s*\}\}/i;

/** 装配核心：按序走一遍，marker 归位、宏跨块求值、深度注入单列 */
export function assemble(entries: AssemblyEntry[], opts: AssembleOptions = {}): AssembleResult {
	const materials = opts.materials ?? {};
	const env = createMacroEnv({
		charName: opts.charName ?? "",
		userName: opts.userName ?? "",
		userText: opts.userText,
	});

	const before: AssembledPiece[] = [];
	const after: AssembledPiece[] = [];
	const depth: DepthPiece[] = [];
	const markers: AssembleResult["markers"] = [];
	const report: AssembleReportItem[] = [];
	const unsupported = new Set<string>();
	const usesLastUserMessage: string[] = [];
	let afterHistory = false;

	for (const e of entries) {
		if (e.missing) {
			report.push({ identifier: e.identifier, name: e.name, action: "缺失定义", chars: 0 });
			continue;
		}
		// 关闭块在酒馆里根本不进请求：不求值，setvar 副作用也不该发生
		if (!e.enabled) {
			report.push({ identifier: e.identifier, name: e.name, action: "关闭", chars: e.content.length });
			continue;
		}

		if (e.marker) {
			if (e.identifier === "chatHistory") {
				afterHistory = true;
				markers.push({ id: e.identifier, enabled: true, filled: true });
				report.push({ identifier: e.identifier, name: e.name, action: "marker 槽位", chars: 0 });
				continue;
			}
			const text = isMarkerId(e.identifier)
				? (materials[e.identifier as Exclude<MarkerId, "chatHistory">] ?? "")
				: "";
			const filled = text.trim().length > 0;
			markers.push({ id: e.identifier, enabled: true, filled });
			report.push({
				identifier: e.identifier,
				name: e.name,
				action: filled ? "marker 槽位" : "marker 无料",
				chars: text.length,
			});
			if (!filled) continue;
			(afterHistory ? after : before).push({
				source: "marker",
				id: e.identifier,
				name: e.name,
				role: "system",
				text,
			});
			continue;
		}

		if (LAST_USER_MESSAGE.test(e.content)) usesLastUserMessage.push(e.identifier);

		// 求值必须发生在丢弃判断之前：setvar 块自己不吐字，但值要留给后面的 getvar
		const evaled = evalPresetMacros(e.content, env);
		for (const name of evaled.unsupported) unsupported.add(name);
		const text = evaled.text;

		if (text.trim().length === 0) {
			report.push({ identifier: e.identifier, name: e.name, action: "零字", chars: 0 });
			continue;
		}

		const piece: AssembledPiece = {
			source: "block",
			id: e.identifier,
			name: e.name,
			role: e.role,
			text,
		};

		if (e.injectionPosition === 1) {
			depth.push({ ...piece, depth: e.injectionDepth, order: e.injectionOrder });
			report.push({
				identifier: e.identifier,
				name: e.name,
				action: "深度注入",
				chars: text.length,
				depth: e.injectionDepth,
			});
			continue;
		}

		(afterHistory ? after : before).push(piece);
		report.push({
			identifier: e.identifier,
			name: e.name,
			action: afterHistory ? "历史后" : "历史前",
			chars: text.length,
		});
	}

	depth.sort((a, b) => a.depth - b.depth || a.order - b.order);

	return {
		before,
		after,
		depth,
		markers,
		unsupported: [...unsupported],
		vars: env.vars,
		usesLastUserMessage,
		report,
	};
}

/** 便捷入口：酒馆原始预设 JSON 直接装配 */
export const assembleStPreset = (raw: Record<string, unknown>, opts?: AssembleOptions): AssembleResult =>
	assemble(stEntries(raw), opts);

/** 便捷入口：旧梨园格式装配（marker 归位不可用，见 rpEntries） */
export const assembleRpPreset = (preset: RpPreset, opts?: AssembleOptions): AssembleResult =>
	assemble(rpEntries(preset), opts);
