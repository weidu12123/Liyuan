/**
 * Agent 自建面板（PLAN-PHASE4 柱 2）：agent 按剧情需要现场发明的元信息面板
 * （地图、装备库、线索板……），kind 三档 markdown / svg / html。
 * D10 合规：面板是舞台美术/元信息层，绝不承载剧情正文。
 *
 * 持久化与 rp-state 同构：.rp-artifacts/<sessionId>.json 只是最新位置的缓存，
 * 真身是会话树里的 rp-panels 快照——随剧情分支走（rewind 后面板同步回退）。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readJsonFile } from "./jsonio.ts";
import { formatMvuTree } from "./mvu.ts";

// 模板填充是纯函数、前端也要用，独立成模块（本文件带 node:fs，进不了浏览器 bundle）
export { fillPanelTemplate } from "./panelTemplate.ts";

export type PanelKind = "markdown" | "svg" | "html";
const PANEL_KINDS: readonly PanelKind[] = ["markdown", "svg", "html"];

export interface RpPanel {
	/** 稳定名（页签标题，同名写入即更新） */
	name: string;
	kind: PanelKind;
	content: string;
	updatedAt: number;
	/** 已归档（panel_close）：不出现在前端页签；盘上保留，同名重写即重开 */
	archived?: boolean;
}

/** name → panel；插入序即页签序（JSON 往返保序） */
export type PanelMap = Record<string, RpPanel>;

/** 软上限（2026-07-10 用户定调）：超过时工具返回值提醒 agent 收拾——是纪律不是门禁，不硬拦 */
export const PANEL_SOFT_LIMIT = 6;
/** 单面板内容上限（字符）：SVG 地图/HTML 面板绰绰有余，防失控巨帧 */
export const PANEL_MAX_CHARS = 120_000;

export function loadPanels(file: string): PanelMap {
	try {
		const raw = readJsonFile(file);
		return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as PanelMap) : {};
	} catch {
		return {};
	}
}

export function savePanels(file: string, panels: PanelMap): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(panels, null, 2), "utf8");
}

/** 未归档面板（页签展示序） */
export function activePanels(panels: PanelMap): RpPanel[] {
	return Object.values(panels).filter((p) => !p.archived);
}

type PanelWriteResult =
	| {
			ok: true;
			panels: PanelMap;
			/** created=新建；reopened=归档面板被同名重写唤回 */
			created: boolean;
			reopened: boolean;
			activeCount: number;
			/** 活跃面板超软上限：调用方把提醒并入工具返回文本 */
			overLimit: boolean;
	  }
	| { ok: false; error: string };

export function writePanel(
	panels: PanelMap,
	input: { name: string; kind: string; content: string },
): PanelWriteResult {
	const name = input.name.trim();
	if (!name) return { ok: false, error: "面板名不能为空" };
	if (!PANEL_KINDS.includes(input.kind as PanelKind)) {
		return { ok: false, error: `kind 必须是 ${PANEL_KINDS.join(" / ")} 之一，收到「${input.kind}」` };
	}
	const content = input.content;
	if (!content.trim()) return { ok: false, error: "content 不能为空（收起面板请用 panel_close）" };
	if (content.length > PANEL_MAX_CHARS) {
		return { ok: false, error: `content 过大（${content.length} 字符，上限 ${PANEL_MAX_CHARS}），请精简` };
	}
	const prev = panels[name];
	const next: PanelMap = {
		...panels,
		[name]: { name, kind: input.kind as PanelKind, content, updatedAt: Date.now() },
	};
	const activeCount = activePanels(next).length;
	return {
		ok: true,
		panels: next,
		created: !prev,
		reopened: prev?.archived === true,
		activeCount,
		overLimit: activeCount > PANEL_SOFT_LIMIT,
	};
}

type PanelCloseResult = { ok: true; panels: PanelMap } | { ok: false; error: string };

export function closePanel(panels: PanelMap, rawName: string): PanelCloseResult {
	const name = rawName.trim();
	const prev = panels[name];
	if (!prev) {
		const known = activePanels(panels).map((p) => p.name);
		return { ok: false, error: `没有名为「${name}」的面板${known.length ? `（现有：${known.join("、")}）` : ""}` };
	}
	if (prev.archived) return { ok: false, error: `面板「${name}」已是归档状态` };
	return { ok: true, panels: { ...panels, [name]: { ...prev, archived: true, updatedAt: Date.now() } } };
}

/** 末端注入用的一行活跃面板速览；无活跃面板返回 null */
export function formatPanelIndex(panels: PanelMap): string | null {
	const active = activePanels(panels);
	if (active.length === 0) return null;
	return active.map((p) => `${p.name}(${p.kind})`).join("、");
}

/** 单面板注入正文上限（字符）；超长截断并提示 panel_read */
const PANEL_INJECT_MAX_PER = 8_000;
/** 全部活跃面板注入总上限 */
const PANEL_INJECT_MAX_TOTAL = 24_000;

/**
 * 末端注入用的活跃面板快照。
 *
 * **有数据的面板喂数据，没数据的照旧喂内容。** 面板拆成两层之后（外观在这儿、数据在
 * `WorldState.panelData`），注入侧要的是事实不是标签——实测 agent 写的 HTML 面板动辄
 * 四千字，每拍把整份标签原样喂给模型，它要的却只是里面那几十个字。markdown 面板没有
 * 这个问题（内容本身就是事实），故不带数据的面板逐字保持旧行为。
 *
 * 超长按面板/总量截断，完整内容仍可用 panel_read。
 */
export function formatPanelSnapshot(
	panels: PanelMap,
	opts?: { maxPerPanel?: number; maxTotal?: number; data?: Record<string, Record<string, unknown>> },
): string | null {
	const maxPer = opts?.maxPerPanel ?? PANEL_INJECT_MAX_PER;
	const maxTotal = opts?.maxTotal ?? PANEL_INJECT_MAX_TOTAL;
	const active = activePanels(panels);
	if (active.length === 0) return null;

	const parts: string[] = [];
	let used = 0;
	for (const p of active) {
		const tree = opts?.data?.[p.name];
		const hasData = tree && typeof tree === "object" && Object.keys(tree).length > 0;
		let body = hasData ? formatMvuTree(tree) : p.content;
		let clipped = false;
		if (body.length > maxPer) {
			body = `${body.slice(0, maxPer)}\n…（已截断，完整内容用 panel_read）`;
			clipped = true;
		}
		const head = `### ${p.name}（${hasData ? "当前数据" : p.kind}${clipped ? "，截断" : ""}）`;
		const block = `${head}\n${body}`;
		if (used + block.length > maxTotal) {
			parts.push(`### ${p.name}（${p.kind}）\n…（注入篇幅已满，用 panel_read 查看全文）`);
			break;
		}
		parts.push(block);
		used += block.length;
	}
	return parts.join("\n\n");
}
