/**
 * 世界线：真正的树状分叉图（SVG）。
 * 时间从左到右；从存档点分出的线画成 Y 型枝干；点节点回档/删除。
 */

import { useCallback, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api.ts";
import { useAction, usePanelData } from "./kit.tsx";

export interface WorldlineViewDto {
	lines: Array<{
		id: string;
		name: string;
		forkFromSaveId?: string;
		saves: Array<{
			id: string;
			name: string;
			entryId: string;
			createdAt: number;
			parentSaveId?: string;
			onCurrentBranch: boolean;
			worldlineId: string;
		}>;
	}>;
	currentSaveId: string | null;
	leafEntryId: string | null;
}

interface GraphNode {
	id: string;
	name: string;
	createdAt: number;
	parentSaveId?: string;
	onCurrentBranch: boolean;
	worldlineId: string;
	worldlineName: string;
	/** layout */
	col: number;
	row: number;
	x: number;
	y: number;
}

interface Props {
	toast: (level: "info" | "warning" | "error", text: string) => void;
	runCommand: (text: string) => void;
	onStore: () => void;
}

const COL_W = 112;
const ROW_H = 72;
const PAD_X = 36;
const PAD_Y = 40;
const R = 11;

/** 从 lines 扁平成树节点，并做「列=深度、行=分支轨」布局 */
function layoutGraph(data: WorldlineViewDto): {
	nodes: GraphNode[];
	edges: Array<{ from: string; to: string; onBranch: boolean }>;
	width: number;
	height: number;
	lineLabels: Array<{ worldlineId: string; name: string; x: number; y: number }>;
} {
	const lineName = new Map(data.lines.map((l) => [l.id, l.name]));
	const byId = new Map<string, GraphNode>();

	for (const line of data.lines) {
		for (const s of line.saves) {
			byId.set(s.id, {
				id: s.id,
				name: s.name,
				createdAt: s.createdAt,
				parentSaveId: s.parentSaveId,
				onCurrentBranch: s.onCurrentBranch,
				worldlineId: s.worldlineId,
				worldlineName: lineName.get(s.worldlineId) ?? line.name,
				col: 0,
				row: 0,
				x: 0,
				y: 0,
			});
		}
	}

	// 校验 parent 存在；丢弃指向已删节点的边
	for (const n of byId.values()) {
		if (n.parentSaveId && !byId.has(n.parentSaveId)) {
			n.parentSaveId = undefined;
		}
	}

	const children = new Map<string, string[]>();
	const roots: string[] = [];
	for (const n of byId.values()) {
		if (!n.parentSaveId) {
			roots.push(n.id);
		} else {
			const list = children.get(n.parentSaveId) ?? [];
			list.push(n.id);
			children.set(n.parentSaveId, list);
		}
	}

	// 子节点排序：当前分支优先，再按时间
	for (const [pid, kids] of children) {
		kids.sort((a, b) => {
			const na = byId.get(a)!;
			const nb = byId.get(b)!;
			if (na.onCurrentBranch !== nb.onCurrentBranch) return na.onCurrentBranch ? -1 : 1;
			return na.createdAt - nb.createdAt;
		});
		children.set(pid, kids);
	}
	roots.sort((a, b) => {
		const na = byId.get(a)!;
		const nb = byId.get(b)!;
		if (na.onCurrentBranch !== nb.onCurrentBranch) return na.onCurrentBranch ? -1 : 1;
		return na.createdAt - nb.createdAt;
	});

	// 深度（列）
	const depthOf = (id: string, guard = new Set<string>()): number => {
		if (guard.has(id)) return 0;
		guard.add(id);
		const n = byId.get(id);
		if (!n?.parentSaveId || !byId.has(n.parentSaveId)) return 0;
		return 1 + depthOf(n.parentSaveId, guard);
	};
	for (const n of byId.values()) n.col = depthOf(n.id);

	// 行：按子树叶宽分配连续行轨（经典 Reingold–Tilford 简化版）
	let nextRow = 0;
	const assignRow = (id: string): { min: number; max: number } => {
		const kids = children.get(id) ?? [];
		if (kids.length === 0) {
			const r = nextRow++;
			byId.get(id)!.row = r;
			return { min: r, max: r };
		}
		const ranges = kids.map(assignRow);
		const min = ranges[0].min;
		const max = ranges[ranges.length - 1].max;
		byId.get(id)!.row = (min + max) / 2;
		return { min, max };
	};
	for (const r of roots) assignRow(r);

	// 若多棵根，上下排列（少见）
	// assignRow 已顺序推进 nextRow

	const nodes = [...byId.values()];
	let maxCol = 0;
	let maxRow = 0;
	for (const n of nodes) {
		n.x = PAD_X + n.col * COL_W;
		n.y = PAD_Y + n.row * ROW_H;
		maxCol = Math.max(maxCol, n.col);
		maxRow = Math.max(maxRow, n.row);
	}

	const edges: Array<{ from: string; to: string; onBranch: boolean }> = [];
	for (const n of nodes) {
		if (!n.parentSaveId || !byId.has(n.parentSaveId)) continue;
		const parent = byId.get(n.parentSaveId)!;
		edges.push({
			from: n.parentSaveId,
			to: n.id,
			onBranch: parent.onCurrentBranch && n.onCurrentBranch,
		});
	}

	// 线名标签：放在该线最右存档旁
	const lineLabels: Array<{ worldlineId: string; name: string; x: number; y: number }> = [];
	for (const line of data.lines) {
		const lineNodes = nodes.filter((n) => n.worldlineId === line.id);
		if (lineNodes.length === 0) continue;
		const tip = lineNodes.reduce((a, b) => (a.col >= b.col ? a : b));
		lineLabels.push({
			worldlineId: line.id,
			name: line.name,
			x: tip.x + 18,
			y: tip.y - 18,
		});
	}

	const width = PAD_X * 2 + maxCol * COL_W + 120;
	const height = PAD_Y * 2 + Math.max(maxRow, 0) * ROW_H + 48;

	return { nodes, edges, width: Math.max(width, 280), height: Math.max(height, 120), lineLabels };
}

/** 直角分叉折线：父 → 水平中点 → 垂直到子行 → 水平到子 */
function edgePath(
	from: { x: number; y: number },
	to: { x: number; y: number },
): string {
	const midX = from.x + (to.x - from.x) * 0.45;
	if (Math.abs(from.y - to.y) < 0.5) {
		// 同行：直线
		return `M ${from.x + R} ${from.y} L ${to.x - R} ${to.y}`;
	}
	// 分叉：先水平离开父，再竖到子行，再水平进子
	return `M ${from.x + R} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x - R} ${to.y}`;
}

const fmtTime = (ts: number) => {
	const d = new Date(ts);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function WorldlinePanel({ toast, runCommand, onStore }: Props) {
	const load = useCallback(() => apiGet<WorldlineViewDto>("/api/worldline"), []);
	const { data, error, loading, reload } = usePanelData(load, { watchAgent: true });
	const { busy, run } = useAction(toast);
	const [menu, setMenu] = useState<{ saveId: string; name: string } | null>(null);

	const graph = useMemo(() => (data && data.lines.length > 0 ? layoutGraph(data) : null), [data]);

	const backTo = (name: string) => {
		setMenu(null);
		runCommand(`/back ${name}`);
		toast("info", `回档到「${name}」…`);
		setTimeout(reload, 600);
	};

	const remove = (saveId: string, name: string) => {
		setMenu(null);
		void run(async () => {
			await apiPost("/api/worldline/delete-save", { saveId });
			reload();
		}, `已删除存档「${name}」`);
	};

	const renameLine = (worldlineId: string, current: string) => {
		const name = window.prompt("世界线名称", current);
		if (!name?.trim() || name.trim() === current) return;
		void run(async () => {
			await apiPost("/api/worldline/rename", { worldlineId, name: name.trim() });
			reload();
		}, "世界线已改名");
	};

	const nodeById = useMemo(() => {
		const m = new Map<string, GraphNode>();
		if (graph) for (const n of graph.nodes) m.set(n.id, n);
		return m;
	}, [graph]);

	return (
		<div className="panel-body worldline-panel">
			<div className="panel-row" style={{ marginBottom: 10 }}>
				<button type="button" className="drawer-btn primary" onClick={onStore} disabled={busy}>
					＋ 存档
				</button>
				<button type="button" className="drawer-btn" onClick={reload} disabled={loading}>
					刷新
				</button>
			</div>
			<p className="field-hint" style={{ marginBottom: 12 }}>
				从左到右是时间。回档后走出不同剧情再存档，会从该节点画出分叉。点击节点可回档或删除。
			</p>
			{loading && !data && <div className="panel-empty">加载中…</div>}
			{error && <div className="panel-error">{error}</div>}
			{data && data.lines.length === 0 && (
				<div className="panel-empty">尚无存档。点「存档」或输入 /store 钉一个节点。</div>
			)}

			{graph && (
				<div className="wl-canvas-wrap">
					<svg
						className="wl-tree"
						viewBox={`0 0 ${graph.width} ${graph.height}`}
						width={graph.width}
						height={graph.height}
						role="img"
						aria-label="世界线分叉图"
					>
						{/* 边：先画非当前，再画当前（当前更醒目） */}
						{graph.edges
							.slice()
							.sort((a, b) => Number(a.onBranch) - Number(b.onBranch))
							.map((e) => {
								const a = nodeById.get(e.from)!;
								const b = nodeById.get(e.to)!;
								return (
									<path
										key={`${e.from}-${e.to}`}
										className={`wl-edge ${e.onBranch ? "on-branch" : ""}`}
										d={edgePath(a, b)}
										fill="none"
									/>
								);
							})}

						{/* 线名（可点改名） */}
						{graph.lineLabels.map((lb) => (
							<text
								key={lb.worldlineId}
								className="wl-svg-label"
								x={lb.x}
								y={lb.y}
								onClick={() => renameLine(lb.worldlineId, lb.name)}
								style={{ cursor: "pointer" }}
							>
								{lb.name}
							</text>
						))}

						{/* 节点 */}
						{graph.nodes.map((n) => {
							const isCur = n.id === data?.currentSaveId;
							return (
								<g
									key={n.id}
									className={`wl-node ${n.onCurrentBranch ? "on-branch" : ""} ${isCur ? "current" : ""}`}
									transform={`translate(${n.x}, ${n.y})`}
									onClick={() => setMenu({ saveId: n.id, name: n.name })}
									style={{ cursor: "pointer" }}
									role="button"
									tabIndex={0}
									onKeyDown={(ev) => {
										if (ev.key === "Enter" || ev.key === " ") {
											ev.preventDefault();
											setMenu({ saveId: n.id, name: n.name });
										}
									}}
								>
									{/* 命中扩大 */}
									<circle r={R + 8} className="wl-hit" />
									<circle r={R} className="wl-disk" />
									{isCur && <circle r={R + 4} className="wl-ring" />}
									<text className="wl-node-name" y={R + 14} textAnchor="middle">
										{n.name.length > 8 ? `${n.name.slice(0, 7)}…` : n.name}
									</text>
									<title>{`${n.name}\n${fmtTime(n.createdAt)}\n${n.worldlineName}`}</title>
								</g>
							);
						})}
					</svg>
				</div>
			)}

			{/* 图例 */}
			{graph && graph.nodes.length > 0 && (
				<div className="wl-legend">
					<span>
						<span className="wl-leg-dot current" /> 当前
					</span>
					<span>
						<span className="wl-leg-dot on" /> 本线
					</span>
					<span>
						<span className="wl-leg-dot off" /> 其他线
					</span>
				</div>
			)}

			{menu && (
				<div className="wl-menu-backdrop" role="presentation" onClick={() => setMenu(null)}>
					<div
						className="wl-menu"
						role="dialog"
						aria-modal="true"
						aria-label={`存档 ${menu.name}`}
						onClick={(e) => e.stopPropagation()}
					>
						<h4>{menu.name}</h4>
						<button type="button" className="drawer-btn primary" onClick={() => backTo(menu.name)} disabled={busy}>
							回到此节点
						</button>
						<button type="button" className="drawer-btn danger" onClick={() => remove(menu.saveId, menu.name)} disabled={busy}>
							删除节点
						</button>
						<button type="button" className="drawer-btn" onClick={() => setMenu(null)}>
							取消
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

/** 存档命名弹窗 */
export function StoreModal({
	defaultName,
	onCancel,
	onConfirm,
}: {
	defaultName: string;
	onCancel: () => void;
	onConfirm: (name: string) => void;
}) {
	const [name, setName] = useState(defaultName);
	return (
		<div className="wl-menu-backdrop" role="presentation" onClick={onCancel}>
			<div
				className="wl-menu store-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="store-modal-title"
				onClick={(e) => e.stopPropagation()}
			>
				<h4 id="store-modal-title">存档</h4>
				<p className="field-hint">给这个剧情点起个名字，会出现在世界线分叉图上。</p>
				<input
					className="field-input"
					value={name}
					onChange={(e) => setName(e.target.value)}
					autoFocus
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							onConfirm(name.trim() || defaultName);
						}
						if (e.key === "Escape") onCancel();
					}}
				/>
				<div className="panel-row" style={{ marginTop: 12 }}>
					<button type="button" className="drawer-btn primary" onClick={() => onConfirm(name.trim() || defaultName)}>
						保存
					</button>
					<button type="button" className="drawer-btn" onClick={onCancel}>
						取消
					</button>
				</div>
			</div>
		</div>
	);
}
