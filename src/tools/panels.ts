/**
 * 面板族工具（PLAN-RP-TOOLING M-D5）。
 *
 * 合一前扩展 3 件（panel_write/read/close）+ 助手 1 件（panel_write，typebox）+ 台上 0 件。
 * 此处三件合一：一份实现，三面共用。
 *
 * 面板是 agent 自建的展示 UI（地图/装备库/线索板……），kind 三档 markdown|svg|html。
 * 持久化与 rp-state 同构：盘上 `.rp-artifacts/<sessionId>.json` 是缓存，真身是树里的
 * `rp-panels` 快照——随分支走，rewind 自动回退。
 *
 * ## 门禁
 *
 * 面板**不挂门禁**。理由：
 *   - 它是 agent 自己的 UI（不是用户持久资料），可 close/reopen/随树回退；
 *   - 不像 memory_add 会造成「我永远记住了」的假象；
 *   - 现有扩展实现本就没门禁，保持一致。
 * 软上限 PANEL_SOFT_LIMIT=6 是纪律不是硬挡——工具回执会提醒，但不拒写。
 */

import { errText, strArg, type ToolResult, type ToolSpec } from "./registry.ts";

/** 面板结构子集（不依赖 RpPanel 全形，便于离线单测） */
interface PanelLike {
	name: string;
	kind: "markdown" | "svg" | "html";
	content: string;
	archived?: boolean;
}

type PanelWriteOutput = {
	ok: true;
	created: boolean;
	reopened: boolean;
	activeCount: number;
	overLimit: boolean;
} | { ok: false; error: string };

export interface PanelDeps {
	/** 取全部面板（含已归档）；返回 name→panel */
	loadPanels: () => Record<string, PanelLike>;
	/** 写/更新一面板。返回写结果（调用方负责把 panels 持久化） */
	writePanel: (input: { name: string; kind: string; content: string; data?: Record<string, unknown> }) => PanelWriteOutput;
	/** 归档一面板。返回是否成功（调用方负责持久化） */
	closePanel: (name: string) => { ok: boolean; error?: string };
}

/** 活跃面板速览行 */
const panelSummary = (panels: Record<string, PanelLike>): string => {
	const active = Object.values(panels).filter((p) => !p.archived);
	if (active.length === 0) return "（当前无活跃面板）";
	return active.map((p) => `${p.name}(${p.kind})`).join("、");
};

/**
 * 调用情境：剧情需要记录元信息（地图布局、装备清单、线索关系图……）——
 * 正文之外的、可追踪可更新的结构化/可视化信息。同名重写即更新。
 */
export const panelWrite: ToolSpec<PanelDeps> = {
	name: "panel_write",
	domain: "panel",
	mode: "write",
	surfaces: ["stage", "extension"],
	label: "写/更新面板",
	description: () =>
		"写/更新一个元信息面板（地图、装备库、线索板、关系图等），同名重写即更新。" +
		`最多 ${6} 个活跃面板（超限仍可写，但会被提醒收拾）。` +
		"面板不是正文——长内容、结构化信息放面板，正文里自然引用即可。" +
		"面板上会变的数值（数量、进度、状态……）用 data 单独给一份，" +
		"外观里写 {{路径}} 占位（如 {{体力}}），显示时会换成当前值；" +
		"之后每拍由记账自动推进这些值，你不必再为了改几个数重写整个面板。" +
		"收起面板用 panel_close。",
	parameters: () => ({
		type: "object",
		properties: {
			name: { type: "string", description: "面板名（页签标题，同名写入即更新）" },
			kind: { type: "string", enum: ["markdown", "svg", "html"], description: "markdown / svg / html" },
			content: { type: "string", description: "面板内容（markdown 文本 / SVG 源码 / HTML 片段）" },
			data: {
				type: "object",
				description:
					"可选：这个面板上会随剧情变化的数值，任意嵌套的对象（如 {\"体力\":8,\"位置\":\"北岭\",\"补给\":{\"干粮\":3}}）。" +
					"外观里用 {{体力}}、{{补给.干粮}} 这样的占位符引用——路径是这棵树里的路径，不必再写面板名。" +
					"给了 data 之后，每拍记账会自动更新这些值；正文侧看到的也是这份数据而不是面板源码。",
			},
		},
		required: ["name", "kind", "content"],
	}),
	async run(args, deps): Promise<ToolResult> {
		const name = strArg(args, "name") || strArg(args, "title"); // 兼容旧扩展用 title
		if (!name) return { text: "缺少 name 参数（面板名 / 页签标题）。" };
		const kind = strArg(args, "kind");
		if (!["markdown", "svg", "html"].includes(kind)) {
			return { text: `kind 必须是 markdown / svg / html 之一，收到「${kind}」。` };
		}
		const content = strArg(args, "content");
		if (!content) return { text: "缺少 content 参数（面板内容）。收起面板请用 panel_close。" };
		// data 可选；只认对象（数组/标量当没给——树的根必须是对象才谈得上「路径」）
		const rawData = (args as Record<string, unknown>).data;
		const data =
			rawData && typeof rawData === "object" && !Array.isArray(rawData)
				? (rawData as Record<string, unknown>)
				: undefined;

		let r: PanelWriteOutput;
		try {
			r = deps.writePanel({ name, kind, content, ...(data ? { data } : {}) });
		} catch (err) {
			return { text: `写面板失败：${errText(err)}` };
		}
		if (!r.ok) return { text: r.error };

		const verb = r.reopened ? "已重开" : r.created ? "已创建" : "已更新";
		const limit = r.overLimit ? ` ⚠ 活跃面板 ${r.activeCount} 个（超软上限），请考虑用 panel_close 收拾不再需要的。` : "";
		return {
			text: `面板「${name}」${verb}（${r.activeCount} 个活跃）。${limit}`,
			activity: `${r.created ? "创建" : r.reopened ? "重开" : "更新"}面板「${name}」`,
			details: { name, kind, created: r.created, activeCount: r.activeCount },
		};
	},
};

/**
 * 调用情境：拿不准某个面板的当前内容（被压缩出上下文了），或增量更新前要先读回原文。
 */
const panelRead: ToolSpec<PanelDeps> = {
	name: "panel_read",
	domain: "panel",
	mode: "read",
	surfaces: ["stage", "extension"],
	label: "读取面板",
	description: () =>
		"读取一面板或全部活跃面板的当前内容。" +
		"用于增量更新前取回原文、或被压缩出上下文后重新看一眼。",
	parameters: () => ({
		type: "object",
		properties: {
			name: { type: "string", description: "面板名（缺省列出全部活跃面板的摘要）" },
		},
		required: [],
	}),
	async run(args, deps): Promise<ToolResult> {
		let panels: Record<string, PanelLike>;
		try {
			panels = deps.loadPanels();
		} catch (err) {
			return { text: `读面板失败：${errText(err)}` };
		}

		const name = strArg(args, "name") || strArg(args, "title");
		if (!name) {
			// 无参数 = 列出全部活跃面板摘要
			const active = Object.values(panels).filter((p) => !p.archived);
			if (active.length === 0) return { text: panelSummary(panels), activity: "读面板 · 0 个活跃" };

			const lines = active.map(
				(p) => `- **${p.name}** (${p.kind})：${p.content.slice(0, 200)}${p.content.length > 200 ? "…" : ""}`,
			);
			return {
				text: `${lines.join("\n")}\n\n读具体内容传 name；收起不用请 panel_close。`,
				activity: `读面板 · ${active.length} 个活跃`,
				details: { names: active.map((p) => p.name) },
			};
		}

		const p = panels[name];
		if (!p || p.archived) {
			const active = Object.values(panels).filter((p) => !p.archived).map((p) => p.name);
			return {
				text: active.length
					? `没有名为「${name}」的活跃面板。现有：${active.join("、")}`
					: `没有名为「${name}」的面板（当前无活跃面板）。`,
				activity: `读面板「${name}」· 未命中`,
			};
		}

		return {
			text: `【面板·${p.name}】(kind=${p.kind})\n${p.content}`,
			activity: `读面板「${name}」· ${p.content.length} 字`,
			details: { name: p.name, kind: p.kind },
		};
	},
};

/**
 * 调用情境：某个面板不再需要（剧情推进后该场景/装备已过时）。
 */
const panelClose: ToolSpec<PanelDeps> = {
	name: "panel_close",
	domain: "panel",
	mode: "write",
	surfaces: ["stage", "extension"],
	label: "收起面板",
	description: () =>
		"归档（收起）一个不再需要的面板。归档后在页签中消失，但盘上保留——" +
		"同名重写即可重开。软上限提醒时可用来清理过期面板。",
	parameters: () => ({
		type: "object",
		properties: {
			name: { type: "string", description: "要收起的面板名" },
		},
		required: ["name"],
	}),
	async run(args, deps): Promise<ToolResult> {
		const name = strArg(args, "name") || strArg(args, "title");
		if (!name) return { text: "缺少 name 参数（要收起的面板名）。" };

		let r: { ok: boolean; error?: string };
		try {
			r = deps.closePanel(name);
		} catch (err) {
			return { text: `收起面板失败：${errText(err)}` };
		}
		if (!r.ok) return { text: r.error ?? `收起面板「${name}」失败。` };

		const active = Object.values(deps.loadPanels()).filter((p) => !p.archived).length;
		return {
			text: `面板「${name}」已归档（${active} 个活跃）。`,
			activity: `收起面板「${name}」`,
			details: { name, activeCount: active },
		};
	},
};

/** 面板族全部工具（M-D5：三件合一） */
export const panelTools: ToolSpec<PanelDeps>[] = [panelWrite, panelRead, panelClose];
