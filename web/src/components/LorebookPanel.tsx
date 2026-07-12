/**
 * 世界书面板（右栏）：
 * - 绿灯=常驻 constant、蓝灯=关键词触发、灰=停用；order 优先级；selective 次要词
 * - 启停开关（disabledLore 覆盖）与绿/蓝类型正交
 * - 可编辑：constant / order / keys / secondaryKeys / selective / comment / content（写回源文件）
 * - 导入/导出标准世界书 JSON（与酒馆互通的公开格式，产品文案不写 ST）
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
	apiDelete,
	apiGet,
	apiPost,
	apiPut,
	downloadJson,
	normalizeActiveLorebooks,
	type LorebookResponse,
	type LorebooksResponse,
	type LoreEntryPatchBody,
	type LoreEntryView,
	type LoreSearchHit,
} from "../api.ts";
import { ConfirmButton, Field, PanelStatus, SearchInput, Toggle, useAction, usePanelData } from "./kit.tsx";

const SOURCE_LABEL: Record<LoreEntryView["source"], string> = {
	card: "卡内嵌",
	file: "独立文件",
	agent: "agent 补充",
};

type LoreSort = "book" | "name" | "chars" | "order";

function parseKeyLine(s: string): string[] {
	return s
		.split(/[,，、\n]+/)
		.map((k) => k.trim())
		.filter(Boolean);
}

/** ST 式状态灯：绿=常驻 · 蓝=关键词 · 灰=停用 */
function LoreLight({
	constant,
	enabled,
	onClick,
	disabled,
}: {
	constant: boolean;
	enabled: boolean;
	onClick?: () => void;
	disabled?: boolean;
}) {
	const kind = !enabled ? "off" : constant ? "green" : "blue";
	const title = !enabled
		? "已停用（开关打开后：绿灯=常驻 / 蓝灯=关键词）"
		: constant
			? "绿灯 · 常驻（每轮注入，点击改为蓝灯关键词）"
			: "蓝灯 · 关键词触发（命中 key 才注入，点击改为绿灯常驻）";
	return (
		<button
			type="button"
			className={`lore-light lore-light-${kind}`}
			title={title}
			aria-label={title}
			disabled={disabled || !onClick}
			onClick={(ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				onClick?.();
			}}
		/>
	);
}

function EntryRow({
	e,
	busy,
	expandTick,
	expanded,
	onToggle,
	onPatch,
}: {
	e: LoreEntryView;
	busy: boolean;
	expandTick: number;
	expanded: boolean;
	onToggle: (fingerprint: string, enabled: boolean) => void;
	onPatch: (body: LoreEntryPatchBody, doneText?: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [editing, setEditing] = useState(false);
	const [full, setFull] = useState<string | null>(null);
	const [draftComment, setDraftComment] = useState(e.comment);
	const [draftOrder, setDraftOrder] = useState(String(e.order));
	const [draftConstant, setDraftConstant] = useState(e.constant);
	const [draftSelective, setDraftSelective] = useState(e.selective);
	const [draftKeys, setDraftKeys] = useState(e.keys.join("、"));
	const [draftSec, setDraftSec] = useState(e.secondaryKeys.join("、"));
	const [draftContent, setDraftContent] = useState("");

	useEffect(() => setOpen(expanded), [expandTick, expanded]);

	// 外部数据刷新时同步草稿（非编辑中）
	useEffect(() => {
		if (editing) return;
		setDraftComment(e.comment);
		setDraftOrder(String(e.order));
		setDraftConstant(e.constant);
		setDraftSelective(e.selective);
		setDraftKeys(e.keys.join("、"));
		setDraftSec(e.secondaryKeys.join("、"));
	}, [e, editing]);

	const loadFull = async () => {
		if (full !== null) return full;
		try {
			const r = await apiGet<{ content: string }>(`/api/lorebook/entry?fp=${encodeURIComponent(e.fingerprint)}`);
			setFull(r.content);
			return r.content;
		} catch {
			setFull(e.preview);
			return e.preview;
		}
	};

	useEffect(() => {
		if (open) void loadFull();
		// eslint-disable-next-line react-hooks/exhaustive-deps -- 展开时惰性取全文
	}, [open]);

	const startEdit = async () => {
		const content = await loadFull();
		setDraftContent(content);
		setDraftComment(e.comment);
		setDraftOrder(String(e.order));
		setDraftConstant(e.constant);
		setDraftSelective(e.selective);
		setDraftKeys(e.keys.join("、"));
		setDraftSec(e.secondaryKeys.join("、"));
		setEditing(true);
		setOpen(true);
	};

	const saveEdit = () => {
		const order = Number.parseInt(draftOrder, 10);
		const keys = parseKeyLine(draftKeys);
		const secondaryKeys = parseKeyLine(draftSec);
		if (!draftConstant && keys.length === 0) {
			// 蓝灯无关键词会永远不触发，仍允许保存（用户可能稍后补）
		}
		onPatch(
			{
				fingerprint: e.fingerprint,
				comment: draftComment,
				order: Number.isFinite(order) ? order : e.order,
				constant: draftConstant,
				selective: draftSelective && secondaryKeys.length > 0,
				keys,
				secondaryKeys,
				content: draftContent,
			},
			"条目已保存",
		);
		setEditing(false);
		setFull(draftContent);
	};

	const flipLight = () => {
		if (!e.enabled) return;
		onPatch(
			{ fingerprint: e.fingerprint, constant: !e.constant },
			e.constant ? "已改为蓝灯（关键词触发）" : "已改为绿灯（常驻）",
		);
	};

	return (
		<div className={`lore-item ${e.enabled ? "" : "off"}`}>
			<div className="lore-head">
				<LoreLight constant={e.constant} enabled={e.enabled} disabled={busy} onClick={e.enabled ? flipLight : undefined} />
				<details open={open} onToggle={(ev) => setOpen((ev.target as HTMLDetailsElement).open)}>
					<summary>
						<span className="lore-title">{e.comment || e.keys[0] || "（未命名）"}</span>
						<span className="lore-order" title="插入优先级 order（越小越靠前）">
							#{e.order}
						</span>
						{e.selective && e.secondaryKeys.length > 0 && (
							<span className="chip chip-selective" title="次要关键词也需命中（selective）">
								AND
							</span>
						)}
						<span className={`chip chip-src chip-src-${e.source}`}>{SOURCE_LABEL[e.source]}</span>
						<span className="lore-meta">{e.chars} 字</span>
					</summary>

					{!editing && (
						<>
							{e.keys.length > 0 && <div className="lore-keys">关键词：{e.keys.join("、")}</div>}
							{e.secondaryKeys.length > 0 && <div className="lore-keys">次要：{e.secondaryKeys.join("、")}</div>}
							{e.constant && <div className="lore-keys">类型：绿灯常驻（不扫关键词）</div>}
							{!e.constant && <div className="lore-keys">类型：蓝灯关键词{e.keys.length === 0 ? "（无 key，不会触发）" : ""}</div>}
							<div className="longtext">{full ?? e.preview}</div>
							<div className="panel-row" style={{ marginTop: 6 }}>
								<button type="button" className="drawer-btn" disabled={busy} onClick={() => void startEdit()}>
									编辑
								</button>
							</div>
						</>
					)}

					{editing && (
						<div className="lore-edit" onClick={(ev) => ev.stopPropagation()}>
							<Field label="标题（comment）">
								<input className="panel-search" value={draftComment} onChange={(ev) => setDraftComment(ev.target.value)} />
							</Field>
							<div className="panel-row lore-edit-row">
								<Field label="优先级 order" hint="越小越靠前">
									<input
										className="panel-search lore-order-input"
										type="number"
										min={0}
										max={9999}
										value={draftOrder}
										onChange={(ev) => setDraftOrder(ev.target.value)}
									/>
								</Field>
								<Field label="类型">
									<select
										className="panel-search"
										value={draftConstant ? "constant" : "keyed"}
										onChange={(ev) => setDraftConstant(ev.target.value === "constant")}
									>
										<option value="constant">绿灯 · 常驻</option>
										<option value="keyed">蓝灯 · 关键词</option>
									</select>
								</Field>
							</div>
							{!draftConstant && (
								<>
									<Field label="主关键词" hint="逗号 / 顿号分隔">
										<input className="panel-search" value={draftKeys} onChange={(ev) => setDraftKeys(ev.target.value)} placeholder="如：南京、吴雯妮" />
									</Field>
									<Field label="次要关键词" hint="可选；勾选 AND 后需同时命中">
										<input className="panel-search" value={draftSec} onChange={(ev) => setDraftSec(ev.target.value)} />
									</Field>
									<label className="lore-check">
										<input
											type="checkbox"
											checked={draftSelective}
											onChange={(ev) => setDraftSelective(ev.target.checked)}
											disabled={parseKeyLine(draftSec).length === 0}
										/>
										次要也要命中（selective / AND）
									</label>
								</>
							)}
							{draftConstant && (
								<div className="field-hint">常驻条目不依赖关键词；仍可保留 key 供检索测试与 lorebook_search。</div>
							)}
							{draftConstant && (
								<Field label="关键词（可选，供检索）">
									<input className="panel-search" value={draftKeys} onChange={(ev) => setDraftKeys(ev.target.value)} />
								</Field>
							)}
							<Field label="正文">
								<textarea className="panel-search lore-content-edit" rows={8} value={draftContent} onChange={(ev) => setDraftContent(ev.target.value)} />
							</Field>
							<div className="panel-row">
								<button type="button" className="drawer-btn save-btn" disabled={busy} onClick={saveEdit}>
									保存
								</button>
								<button
									type="button"
									className="drawer-btn"
									disabled={busy}
									onClick={() => {
										setEditing(false);
									}}
								>
									取消
								</button>
							</div>
						</div>
					)}
				</details>
				<Toggle
					checked={e.enabled}
					disabled={busy}
					title={e.enabled ? "停用该条目" : "启用该条目"}
					onChange={(v) => onToggle(e.fingerprint, v)}
				/>
			</div>
		</div>
	);
}

/** 浏览目标：某一本文件，或 agent 补充设定 */
type ViewTarget = { kind: "file"; path: string } | { kind: "agent" };

/** 书管理区：勾选=挂载进会话；点书名=下方只显示该本条目（不合并）。 */
function BooksSection({
	toast,
	view,
	onView,
	onMountChanged,
}: {
	toast: (level: "info" | "warning" | "error", text: string) => void;
	view: ViewTarget | null;
	onView: (v: ViewTarget) => void;
	onMountChanged: () => void;
}) {
	const { data, error, loading, reload } = usePanelData(() => apiGet<LorebooksResponse>("/api/lorebooks"), { cacheKey: "/api/lorebooks" });
	const { busy, run } = useAction(toast);
	const [importing, setImporting] = useState(false);

	const active = useMemo(() => normalizeActiveLorebooks(data?.active ?? null), [data?.active]);
	const activeSet = useMemo(() => new Set(active), [active]);

	useEffect(() => {
		if (view) return;
		if (!data?.books.length) return;
		onView({ kind: "file", path: data.books[0].path });
	}, [data, view, onView]);

	const toggleMount = (path: string, e: React.MouseEvent) => {
		e.stopPropagation();
		run(async () => {
			await apiPost("/api/lorebooks/select", { path });
			reload();
			onMountChanged();
		});
	};

	const clearAll = () =>
		run(async () => {
			await apiPost("/api/lorebooks/select", { paths: [] });
			reload();
			onMountChanged();
		}, "已卸下全部世界书");

	const remove = (path: string) =>
		run(async () => {
			await apiDelete(`/api/lorebooks?path=${encodeURIComponent(path)}`);
			reload();
			onMountChanged();
			if (view?.kind === "file" && view.path === path && data) {
				const rest = data.books.filter((b) => b.path !== path);
				if (rest[0]) onView({ kind: "file", path: rest[0].path });
			}
		}, "已删除");

	const exportBook = async (path: string) => {
		try {
			const r = await apiGet<{ name: string; json: unknown }>(`/api/lorebook/export?path=${encodeURIComponent(path)}`);
			downloadJson(`${r.name}.json`, r.json);
			toast("info", `已导出「${r.name}」`);
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		}
	};

	const exportMerged = async () => {
		try {
			const r = await apiGet<{ name: string; json: unknown }>("/api/lorebook/export");
			downloadJson(`${r.name}.json`, r.json);
			toast("info", "已导出会话合并世界书（全部挂载书 + agent 补充）");
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		}
	};

	const doImport = async (file: File) => {
		setImporting(true);
		try {
			const json = JSON.parse(await file.text()) as unknown;
			const r = await apiPost<{ path: string; entryCount: number }>(
				`/api/lorebooks/import?name=${encodeURIComponent(file.name.replace(/\.json$/i, ""))}`,
				json,
			);
			toast("info", `已导入（${r.entryCount} 条）——点书名看条目，勾选才挂进会话`);
			reload();
			onView({ kind: "file", path: r.path });
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setImporting(false);
		}
	};

	const viewingFile = view?.kind === "file" ? view.path : null;
	const viewingAgent = view?.kind === "agent";

	return (
		<section className="sp-section">
			<h4>世界书</h4>
			<div className="field-hint">
				<strong>勾选</strong>＝挂进会话（可多本）· <strong>点书名</strong>＝下方只显示该本条目（不合并其它书）。
			</div>
			<PanelStatus loading={loading} error={error} hasData={!!data} />
			{data && (
				<>
					<div className="book-row book-toolbar">
						<span className="lore-meta">会话已挂 {active.length} 本</span>
						{active.length > 0 && (
							<button type="button" className="act" disabled={busy} onClick={() => clearAll()}>
								全部卸下
							</button>
						)}
					</div>
					{data.books.map((b) => {
						const mounted = activeSet.has(b.path);
						const viewing = viewingFile === b.path;
						return (
							<div key={b.path} className={`book-row ${viewing ? "current" : ""}`}>
								<button
									type="button"
									className="book-check"
									disabled={busy}
									title={mounted ? "卸下（不进会话）" : "挂载（进会话）"}
									onClick={(ev) => toggleMount(b.path, ev)}
								>
									<span className={`check ${mounted ? "on" : ""}`} aria-checked={mounted} role="checkbox" />
								</button>
								<button
									type="button"
									className="book-pick"
									title={`查看条目：${b.path}`}
									onClick={() => onView({ kind: "file", path: b.path })}
								>
									<span className="book-name">{b.name}</span>
									<span className="lore-meta">{b.entryCount} 条</span>
									{mounted && <span className="lore-meta book-mounted-tag">已挂</span>}
								</button>
								<span className="book-acts">
									<button type="button" className="act" onClick={() => void exportBook(b.path)}>
										导出
									</button>
									{b.path.startsWith("assets/lorebooks/") && (
										<ConfirmButton disabled={busy} confirmText="确认删除" onConfirm={() => remove(b.path)}>
											删除
										</ConfirmButton>
									)}
								</span>
							</div>
						);
					})}
					<div className={`book-row ${viewingAgent ? "current" : ""}`}>
						<button type="button" className="book-pick book-pick-full" onClick={() => onView({ kind: "agent" })}>
							<span className="book-name">agent 补充设定</span>
							<span className="lore-meta">按卡自动</span>
						</button>
					</div>
					{data.books.length === 0 && <div className="sp-empty">还没有世界书，可导入 JSON</div>}
					<div className="panel-row book-io">
						<label className="drawer-btn book-import">
							{importing ? "导入中…" : "导入世界书 JSON"}
							<input
								type="file"
								accept=".json,application/json"
								hidden
								onChange={(e) => {
									const f = e.target.files?.[0];
									if (f) void doImport(f);
									e.target.value = "";
								}}
							/>
						</label>
						<button type="button" className="drawer-btn" title="导出会话里全部挂载书+补充" onClick={() => void exportMerged()}>
							导出合并
						</button>
					</div>
				</>
			)}
		</section>
	);
}

export function LorebookPanel({ toast }: { toast: (level: "info" | "warning" | "error", text: string) => void }) {
	const [view, setView] = useState<ViewTarget | null>(null);
	const viewKey = view?.kind === "file" ? `file:${view.path}` : view?.kind === "agent" ? "agent" : "none";

	const loadEntries = useCallback((): Promise<LorebookResponse> => {
		if (view?.kind === "file") {
			return apiGet<LorebookResponse>(`/api/lorebook?path=${encodeURIComponent(view.path)}`);
		}
		if (view?.kind === "agent") {
			return apiGet<LorebookResponse>("/api/lorebook?source=agent");
		}
		return Promise.resolve({
			lorebookPath: null,
			lorebookPaths: [],
			viewPath: null,
			viewSource: null,
			viewName: null,
			total: 0,
			entries: [],
		});
	}, [view]);

	const { data, error, loading, reload } = usePanelData(loadEntries, { watchAgent: true });
	useEffect(() => {
		reload();
		setLimit(40);
		setQuery("");
		setHits(null);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随 viewKey 切换
	}, [viewKey]);

	const { busy, run } = useAction(toast);
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<LoreSearchHit[] | null>(null);
	const [searching, setSearching] = useState(false);
	const [sort, setSort] = useState<LoreSort>("order");
	const [expandTick, setExpandTick] = useState(0);
	const [expanded, setExpanded] = useState(false);
	const [limit, setLimit] = useState(40);

	const doSearch = async () => {
		const q = query.trim();
		if (!q) {
			setHits(null);
			return;
		}
		setSearching(true);
		try {
			const r = await apiGet<{ hits: LoreSearchHit[] }>(`/api/lorebook/search?q=${encodeURIComponent(q)}`);
			setHits(r.hits);
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setSearching(false);
		}
	};

	const toggle = (fingerprint: string, enabled: boolean) =>
		run(async () => {
			await apiPost("/api/lorebook/toggle", { fingerprint, enabled });
			reload();
		});

	const patch = (body: LoreEntryPatchBody, doneText?: string) =>
		run(async () => {
			await apiPut("/api/lorebook/entry", body);
			reload();
		}, doneText);

	const filtered = useMemo(() => {
		const list = data?.entries ?? [];
		const q = query.trim().toLowerCase();
		const out = list.filter(
			(e) =>
				!q ||
				e.comment.toLowerCase().includes(q) ||
				e.keys.some((k) => k.toLowerCase().includes(q)) ||
				e.preview.toLowerCase().includes(q),
		);
		if (sort === "name") out.sort((a, b) => (a.comment || a.keys[0] || "").localeCompare(b.comment || b.keys[0] || ""));
		else if (sort === "chars") out.sort((a, b) => b.chars - a.chars);
		else if (sort === "order") out.sort((a, b) => a.order - b.order || (a.comment || "").localeCompare(b.comment || ""));
		return out;
	}, [data, query, sort]);

	const titleName =
		data?.viewName ?? (view?.kind === "agent" ? "agent 补充设定" : view?.kind === "file" ? "…" : "未选择");

	return (
		<div className="panel-body">
			<BooksSection toast={toast} view={view} onView={setView} onMountChanged={reload} />
			<PanelStatus loading={loading} error={error} hasData={!!data && !!view} />
			{!view && <div className="sp-empty">点上方书名查看该本条目</div>}
			{view && data && (
				<>
					<section className="sp-section">
						<h4>检索测试</h4>
						<div className="field-hint">回车测的是会话已挂载书的合并检索；下方列表始终只显示当前点开的书。</div>
						<SearchInput
							value={query}
							onChange={(v) => {
								setQuery(v);
								if (!v.trim()) setHits(null);
							}}
							placeholder="过滤当前书条目 / 回车测会话检索…"
							onEnter={() => void doSearch()}
						/>
						{searching && <div className="sp-empty">检索中…</div>}
						{hits !== null && !searching && (
							<div className="lore-hits">
								{hits.length === 0 && <div className="sp-empty">无命中——这个说法模型也检索不到。</div>}
								{hits.map((h, i) => (
									<details key={i} className="lore-hit">
										<summary>
											{h.comment || h.keys[0]}
											<span className="lore-meta">score {h.score}</span>
										</summary>
										<div className="longtext">{h.preview}</div>
									</details>
								))}
							</div>
						)}
					</section>

					<section className="sp-section">
						<h4>
							条目 · {titleName}
							<span className="lore-meta" style={{ marginLeft: 8, fontWeight: 400 }}>
								{filtered.length === data.total ? `共 ${data.total} 条` : `筛选 ${filtered.length} / ${data.total}`}
							</span>
						</h4>
						<div className="field-hint">
							仅当前书，不合并其它挂载。
							<span className="lore-light lore-light-green lore-light-inline" /> 绿灯常驻 ·{" "}
							<span className="lore-light lore-light-blue lore-light-inline" /> 蓝灯关键词
						</div>
						<div className="panel-row list-toolbar">
							<select className="panel-search" value={sort} onChange={(e) => setSort(e.target.value as LoreSort)} aria-label="排序">
								<option value="order">优先级 order</option>
								<option value="book">书内顺序</option>
								<option value="name">按标题</option>
								<option value="chars">按字数</option>
							</select>
							<button
								className="drawer-btn"
								onClick={() => {
									setExpanded((v) => !v);
									setExpandTick((t) => t + 1);
								}}
							>
								{expanded ? "全部收起" : "全部展开"}
							</button>
						</div>
						{filtered.length === 0 && <div className="sp-empty">此书无匹配条目。</div>}
						{filtered.slice(0, limit).map((e) => (
							<EntryRow
								key={e.fingerprint}
								e={e}
								busy={busy}
								expandTick={expandTick}
								expanded={expanded}
								onToggle={toggle}
								onPatch={patch}
							/>
						))}
						{filtered.length > limit && (
							<button className="drawer-btn" onClick={() => setLimit((n) => n + 40)}>
								显示更多（还有 {filtered.length - limit} 条）
							</button>
						)}
					</section>
				</>
			)}
		</div>
	);
}
