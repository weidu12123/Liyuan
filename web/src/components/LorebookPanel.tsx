/**
 * 世界书面板（右栏）：
 * - 蓝灯=常驻 constant、绿灯=关键词触发、灰=停用；order 优先级；selective 次要词
 * - 启停开关（disabledLore 覆盖）与蓝/绿类型正交
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
import { bumpWatchPanels, ConfirmButton, Field, PanelStatus, SearchInput, Toggle, useAction, usePanelData } from "./kit.tsx";
import { t } from "../i18n/index.ts";

const SOURCE_LABEL: Record<LoreEntryView["source"], string> = {
	card: "卡内嵌", // i18n-ignore：用时 t(SOURCE_LABEL[k])
	file: "独立文件", // i18n-ignore
	agent: "agent 补充", // i18n-ignore
};

type LoreSort = "book" | "name" | "chars" | "order";

function parseKeyLine(s: string): string[] {
	return s
		.split(/[,，、\n]+/)
		.map((k) => k.trim())
		.filter(Boolean);
}

/** 状态灯（照酒馆约定）：蓝=常驻 · 绿=关键词 · 灰=停用 */
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
	const kind = !enabled ? "off" : constant ? "blue" : "green";
	const title = !enabled
		? t("已停用（开关打开后：蓝灯=常驻 / 绿灯=关键词）")
		: constant
			? t("蓝灯 · 常驻（每轮注入，点击改为绿灯关键词）")
			: t("绿灯 · 关键词触发（命中 key 才注入，点击改为蓝灯常驻）");
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
	onDelete,
}: {
	e: LoreEntryView;
	busy: boolean;
	expandTick: number;
	expanded: boolean;
	onToggle: (fingerprint: string, enabled: boolean) => void;
	onPatch: (body: LoreEntryPatchBody, doneText?: string) => void;
	onDelete: (fingerprint: string) => void;
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
			// 绿灯无关键词会永远不触发，仍允许保存（用户可能稍后补）
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
			t("条目已保存"),
		);
		setEditing(false);
		setFull(draftContent);
	};

	const flipLight = () => {
		if (!e.enabled) return;
		onPatch(
			{ fingerprint: e.fingerprint, constant: !e.constant },
			e.constant ? t("已改为绿灯（关键词触发）") : t("已改为蓝灯（常驻）"),
		);
	};

	return (
		<div className={`lore-item ${e.enabled ? "" : "off"}`}>
			<div className="lore-head">
				<LoreLight constant={e.constant} enabled={e.enabled} disabled={busy} onClick={e.enabled ? flipLight : undefined} />
				<details open={open} onToggle={(ev) => setOpen((ev.target as HTMLDetailsElement).open)}>
					<summary>
						<span className="lore-title">{e.comment || e.keys[0] || t("（未命名）")}</span>
						<span className="lore-order" title={t("插入优先级 order（越小越靠前）")}>
							#{e.order}
						</span>
						{e.selective && e.secondaryKeys.length > 0 && (
							<span className="chip chip-selective" title={t("次要关键词也需命中（selective）")}>
								AND
							</span>
						)}
						<span className={`chip chip-src chip-src-${e.source}`}>{t(SOURCE_LABEL[e.source])}</span>
						<span className="lore-meta">{t("{n} 字", { n: e.chars })}</span>
					</summary>

					{!editing && (
						<>
							{e.keys.length > 0 && <div className="lore-keys">{t("关键词：{keys}", { keys: e.keys.join(t("、")) })}</div>}
							{e.secondaryKeys.length > 0 && <div className="lore-keys">{t("次要：{keys}", { keys: e.secondaryKeys.join(t("、")) })}</div>}
							{e.constant && <div className="lore-keys">{t("类型：蓝灯常驻（不扫关键词）")}</div>}
							{!e.constant && <div className="lore-keys">{t("类型：绿灯关键词")}{e.keys.length === 0 ? t("（无 key，不会触发）") : ""}</div>}
							<div className="longtext">{full ?? e.preview}</div>
							<div className="panel-row" style={{ marginTop: 6 }}>
								<button type="button" className="drawer-btn" disabled={busy} onClick={() => void startEdit()}>
									{t("编辑")}
								</button>
								<ConfirmButton disabled={busy} confirmText={t("确认删除")} onConfirm={() => onDelete(e.fingerprint)}>
									{t("删除")}
								</ConfirmButton>
							</div>
						</>
					)}

					{editing && (
						<div className="lore-edit" onClick={(ev) => ev.stopPropagation()}>
							<Field label={t("标题（comment）")}>
								<input className="panel-search" value={draftComment} onChange={(ev) => setDraftComment(ev.target.value)} />
							</Field>
							<div className="panel-row lore-edit-row">
								<Field label={t("优先级 order")} hint={t("越小越靠前")}>
									<input
										className="panel-search lore-order-input"
										type="number"
										min={0}
										max={9999}
										value={draftOrder}
										onChange={(ev) => setDraftOrder(ev.target.value)}
									/>
								</Field>
								<Field label={t("类型")}>
									<select
										className="panel-search"
										value={draftConstant ? "constant" : "keyed"}
										onChange={(ev) => setDraftConstant(ev.target.value === "constant")}
									>
										<option value="constant">{t("蓝灯 · 常驻")}</option>
										<option value="keyed">{t("绿灯 · 关键词")}</option>
									</select>
								</Field>
							</div>
							{!draftConstant && (
								<>
									<Field label={t("主关键词")} hint={t("逗号 / 顿号分隔")}>
										<input className="panel-search" value={draftKeys} onChange={(ev) => setDraftKeys(ev.target.value)} placeholder={t("如：南京、某角色")} />
									</Field>
									<Field label={t("次要关键词")} hint={t("可选；勾选 AND 后需同时命中")}>
										<input className="panel-search" value={draftSec} onChange={(ev) => setDraftSec(ev.target.value)} />
									</Field>
									<label className="lore-check">
										<input
											type="checkbox"
											checked={draftSelective}
											onChange={(ev) => setDraftSelective(ev.target.checked)}
											disabled={parseKeyLine(draftSec).length === 0}
										/>
										{t("次要也要命中（selective / AND）")}
									</label>
								</>
							)}
							{draftConstant && (
								<div className="field-hint">{t("常驻条目不依赖关键词；仍可保留 key 供检索测试与 lorebook_search。")}</div>
							)}
							{draftConstant && (
								<Field label={t("关键词（可选，供检索）")}>
									<input className="panel-search" value={draftKeys} onChange={(ev) => setDraftKeys(ev.target.value)} />
								</Field>
							)}
							<Field label={t("正文")}>
								<textarea className="panel-search lore-content-edit" rows={8} value={draftContent} onChange={(ev) => setDraftContent(ev.target.value)} />
							</Field>
							<div className="panel-row">
								<button type="button" className="drawer-btn save-btn" disabled={busy} onClick={saveEdit}>
									{t("保存")}
								</button>
								<button
									type="button"
									className="drawer-btn"
									disabled={busy}
									onClick={() => {
										setEditing(false);
									}}
								>
									{t("取消")}
								</button>
							</div>
						</div>
					)}
				</details>
				<Toggle
					checked={e.enabled}
					disabled={busy}
					title={e.enabled ? t("停用该条目") : t("启用该条目")}
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
	// watchAgent：配套世界书导入 / agent 写书后由 bumpWatchPanels·agentTick 自动重拉书单
	const { data, error, loading, reload } = usePanelData(() => apiGet<LorebooksResponse>("/api/lorebooks"), {
		cacheKey: "/api/lorebooks",
		watchAgent: true,
	});
	const { busy, run } = useAction(toast);
	const [importing, setImporting] = useState(false);
	// 用户手动新建一本世界书（8/29：此前只能导入酒馆 JSON，不能自己创作）
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState("");
	const [newMount, setNewMount] = useState(true);
	const [newFirstTitle, setNewFirstTitle] = useState("");
	const [newFirstContent, setNewFirstContent] = useState("");
	/** 书名 + 首条正文都齐了才能建：空书挂不上、也不出现在书单里（服务端注释有据） */
	const canCreate = newName.trim().length > 0 && newFirstContent.trim().length > 0;

	const active = useMemo(() => normalizeActiveLorebooks(data?.active ?? null), [data?.active]);
	const activeSet = useMemo(() => new Set(active), [active]);

	// 配套导入后 focus 到新书；否则无选中时默认第一本
	useEffect(() => {
		if (!data?.books.length) return;
		let focus: string | null = null;
		try {
			focus = sessionStorage.getItem("liyuan.lore.focus");
			if (focus) sessionStorage.removeItem("liyuan.lore.focus");
		} catch {
			/* ignore */
		}
		if (focus && data.books.some((b) => b.path === focus)) {
			onView({ kind: "file", path: focus });
			return;
		}
		if (view) return;
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
		}, t("已卸下全部世界书"));

	const remove = (path: string) =>
		run(async () => {
			await apiDelete(`/api/lorebooks?path=${encodeURIComponent(path)}`);
			reload();
			onMountChanged();
			if (view?.kind === "file" && view.path === path && data) {
				const rest = data.books.filter((b) => b.path !== path);
				if (rest[0]) onView({ kind: "file", path: rest[0].path });
			}
		}, t("已删除"));

	const exportBook = async (path: string) => {
		try {
			const r = await apiGet<{ name: string; json: unknown }>(`/api/lorebook/export?path=${encodeURIComponent(path)}`);
			downloadJson(`${r.name}.json`, r.json);
			toast("info", t("已导出「{name}」", { name: r.name }));
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		}
	};

	const exportMerged = async () => {
		try {
			const r = await apiGet<{ name: string; json: unknown }>("/api/lorebook/export");
			downloadJson(`${r.name}.json`, r.json);
			toast("info", t("已导出会话合并世界书（全部挂载书 + agent 补充）"));
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		}
	};

	/**
	 * 新建一本世界书（8/29）：与「导入」并列的另一条入口——用户自己创作，不必先有酒馆 JSON。
	 * 书名 + 第一条正文都必填（空书挂不上、也列不出来，见服务端 createLorebookWithEntry 注释）。
	 * 建完直接跳进这本书，用户接着按「＋ 新增条目」继续写。
	 */
	const doCreate = () =>
		run(async () => {
			const name = newName.trim();
			const content = newFirstContent.trim();
			if (!name) throw new Error(t("请先填书名"));
			if (!content) throw new Error(t("请写第一条条目的正文"));
			const r = await apiPost<{ path: string; didMount: boolean }>("/api/lorebooks", {
				name,
				mount: newMount,
				first: { title: newFirstTitle.trim() || name, content },
			});
			setCreating(false);
			setNewName("");
			setNewFirstTitle("");
			setNewFirstContent("");
			reload();
			onView({ kind: "file", path: r.path });
			if (r.didMount) onMountChanged();
			bumpWatchPanels();
		});

	const doImport = async (file: File) => {
		setImporting(true);
		try {
			const json = JSON.parse(await file.text()) as unknown;
			const r = await apiPost<{ path: string; entryCount: number }>(
				`/api/lorebooks/import?name=${encodeURIComponent(file.name.replace(/\.json$/i, ""))}`,
				json,
			);
			toast("info", t("已导入（{n} 条）——点书名看条目，勾选才挂进会话", { n: r.entryCount }));
			reload();
			onView({ kind: "file", path: r.path });
			// 条目区等其它 watch 订阅一并刷新
			bumpWatchPanels();
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
			<h4>{t("世界书")}</h4>
			<div className="field-hint">
				<strong>{t("勾选")}</strong>{t("＝挂进会话（可多本）·")} <strong>{t("点书名")}</strong>{t("＝下方只显示该本条目（不合并其它书）。")}
			</div>
			<PanelStatus loading={loading} error={error} hasData={!!data} />
			{data && (
				<>
					<div className="book-row book-toolbar">
						<span className="lore-meta">{t("会话已挂 {n} 本", { n: active.length })}</span>
						{active.length > 0 && (
							<button type="button" className="act" disabled={busy} onClick={() => clearAll()}>
								{t("全部卸下")}
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
									title={mounted ? t("卸下（不进会话）") : t("挂载（进会话）")}
									onClick={(ev) => toggleMount(b.path, ev)}
								>
									<span className={`check ${mounted ? "on" : ""}`} aria-checked={mounted} role="checkbox" />
								</button>
								<button
									type="button"
									className="book-pick"
									title={t("查看条目：{path}", { path: b.path })}
									onClick={() => onView({ kind: "file", path: b.path })}
								>
									<span className="book-name">{b.name}</span>
									<span className="lore-meta">{t("{n} 条条目", { n: b.entryCount })}</span>
									{mounted && <span className="lore-meta book-mounted-tag">{t("已挂")}</span>}
								</button>
								<span className="book-acts">
									<button type="button" className="act" onClick={() => void exportBook(b.path)}>
										{t("导出")}
									</button>
									{b.path.startsWith("assets/lorebooks/") && (
										<ConfirmButton disabled={busy} confirmText={t("确认删除")} onConfirm={() => remove(b.path)}>
											{t("删除")}
										</ConfirmButton>
									)}
								</span>
							</div>
						);
					})}
					<div className={`book-row ${viewingAgent ? "current" : ""}`}>
						<button type="button" className="book-pick book-pick-full" onClick={() => onView({ kind: "agent" })}>
							<span className="book-name">{t("agent 补充设定")}</span>
							<span className="lore-meta">{t("按卡自动")}</span>
						</button>
					</div>
					{data.books.length === 0 && <div className="sp-empty">{t("还没有世界书——可以「＋ 新建」自己写，也可以导入 JSON")}</div>}
					{creating && (
						<div className="lore-edit" onClick={(ev) => ev.stopPropagation()}>
							<Field label={t("书名")} hint={t("文件名同名；建完可直接加条目")}>
								<input
									className="panel-search"
									autoFocus
									value={newName}
									placeholder={t("例：主世界设定")}
									onChange={(ev) => setNewName(ev.target.value)}
									onKeyDown={(ev) => {
										if (ev.key === "Enter") void doCreate();
										if (ev.key === "Escape") setCreating(false);
									}}
								/>
							</Field>
							<label className="lore-check">
								<input type="checkbox" checked={newMount} onChange={(ev) => setNewMount(ev.target.checked)} />
								{t("建完挂进本会话")}
							</label>
							<Field label={t("第一条条目")} hint={t("必填——空书挂不上，也不会出现在书单里")}>
								<input
									className="panel-search"
									value={newFirstTitle}
									placeholder={t("标题，留空用书名")}
									onChange={(ev) => setNewFirstTitle(ev.target.value)}
								/>
							</Field>
							<textarea
								className="panel-search lore-content-edit"
								rows={3}
								value={newFirstContent}
								placeholder={t("第一条的正文内容（必填）")}
								onChange={(ev) => setNewFirstContent(ev.target.value)}
							/>
							<div className="panel-row" style={{ marginTop: 6 }}>
								<button type="button" className="drawer-btn" disabled={busy || !canCreate} onClick={() => void doCreate()}>
									{t("新建")}
								</button>
								<button type="button" className="drawer-btn" onClick={() => setCreating(false)}>
									{t("取消")}
								</button>
							</div>
						</div>
					)}
					<div className="panel-row book-io">
						<button
							type="button"
							className="drawer-btn"
							title={t("自己新建一本世界书（不必先有酒馆 JSON）")}
							onClick={() => setCreating((v) => !v)}
						>
							{t("＋ 新建世界书")}
						</button>
						<label className="drawer-btn book-import">
							{importing ? t("导入中…") : t("导入世界书 JSON")}
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
						<button type="button" className="drawer-btn" title={t("导出会话里全部挂载书+补充")} onClick={() => void exportMerged()}>
							{t("导出合并")}
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

	/** 当前视图的 GET 路径：loader 与 cacheKey 共用同一个来源，防两处写法漂移 */
	const entriesPath =
		view?.kind === "file"
			? `/api/lorebook?path=${encodeURIComponent(view.path)}`
			: view?.kind === "agent"
				? "/api/lorebook?source=agent"
				: null;

	const loadEntries = useCallback((): Promise<LorebookResponse> => {
		if (entriesPath) return apiGet<LorebookResponse>(entriesPath);
		return Promise.resolve({
			lorebookPath: null,
			lorebookPaths: [],
			viewPath: null,
			viewSource: null,
			viewName: null,
			total: 0,
			entries: [],
		});
	}, [entriesPath]);

	const { data, error, loading, reload } = usePanelData(loadEntries, {
		watchAgent: true,
		cacheKey: entriesPath ?? undefined,
	});
	useEffect(() => {
		// 换书的重拉由 cacheKey 变化驱动（看过的书再点回来命中缓存＝秒开），这里只重置视图态
		setLimit(40);
		setQuery("");
		setHits(null);
		// 换书必须关掉新增表单：它按当前书投递，留着会写错本
		setAdding(false);
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
	// 新增条目表单
	const [adding, setAdding] = useState(false);
	const [newComment, setNewComment] = useState("");
	const [newKeys, setNewKeys] = useState("");
	const [newContent, setNewContent] = useState("");
	const [newConstant, setNewConstant] = useState(false);
	const [newOrder, setNewOrder] = useState("100");

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

	/** 当前浏览的书（写操作都限定在它身上；agent = 本卡补充设定） */
	const scopePath = view?.kind === "file" ? view.path : "agent";

	// 删除限定当前浏览的书，防多本书同指纹时误删别本
	const removeEntry = (fingerprint: string) =>
		run(async () => {
			await apiDelete(`/api/lorebook/entry?fp=${encodeURIComponent(fingerprint)}&path=${encodeURIComponent(scopePath)}`);
			reload();
		}, t("条目已删除"));

	const resetAddForm = () => {
		setAdding(false);
		setNewComment("");
		setNewKeys("");
		setNewContent("");
		setNewConstant(false);
		setNewOrder("100");
	};

	const addEntry = () =>
		run(async () => {
			const order = Number.parseInt(newOrder, 10);
			const r = await apiPost<{ duplicate?: boolean }>("/api/lorebook/entry", {
				path: scopePath,
				comment: newComment.trim(),
				content: newContent,
				keys: parseKeyLine(newKeys),
				constant: newConstant,
				order: Number.isFinite(order) ? order : 100,
			});
			resetAddForm();
			reload();
			if (r.duplicate) toast("warning", t("正文与本书已有条目重复，未重复写入"));
		}, t("条目已添加"));

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
		data?.viewName ?? (view?.kind === "agent" ? t("agent 补充设定") : view?.kind === "file" ? "…" : t("未选择"));

	return (
		<div className="panel-body">
			<BooksSection toast={toast} view={view} onView={setView} onMountChanged={reload} />
			<PanelStatus loading={loading} error={error} hasData={!!data && !!view} />
			{!view && <div className="sp-empty">{t("点上方书名查看该本条目")}</div>}
			{view && data && (
				<>
					<section className="sp-section">
						<h4>{t("检索测试")}</h4>
						<div className="field-hint">{t("回车测的是会话已挂载书的合并检索；下方列表始终只显示当前点开的书。")}</div>
						<SearchInput
							value={query}
							onChange={(v) => {
								setQuery(v);
								if (!v.trim()) setHits(null);
							}}
							placeholder={t("过滤当前书条目 / 回车测会话检索…")}
							onEnter={() => void doSearch()}
						/>
						{searching && <div className="sp-empty">{t("检索中…")}</div>}
						{hits !== null && !searching && (
							<div className="lore-hits">
								{hits.length === 0 && <div className="sp-empty">{t("无命中——这个说法模型也检索不到。")}</div>}
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
							{t("条目 · {name}", { name: titleName })}
							<span className="lore-meta" style={{ marginLeft: 8, fontWeight: 400 }}>
								{filtered.length === data.total ? t("共 {n} 条", { n: data.total }) : t("筛选 {shown} / {total}", { shown: filtered.length, total: data.total })}
							</span>
						</h4>
						<div className="field-hint">
							{t("仅当前书，不合并其它挂载。")}
							<span className="lore-light lore-light-blue lore-light-inline" /> {t("蓝灯常驻 ·")}{" "}
							<span className="lore-light lore-light-green lore-light-inline" /> {t("绿灯关键词")}
						</div>
						<div className="panel-row list-toolbar">
							<select className="panel-search" value={sort} onChange={(e) => setSort(e.target.value as LoreSort)} aria-label={t("排序")}>
								<option value="order">{t("优先级 order")}</option>
								<option value="book">{t("书内顺序")}</option>
								<option value="name">{t("按标题")}</option>
								<option value="chars">{t("按字数")}</option>
							</select>
							<button
								className="drawer-btn"
								onClick={() => {
									setExpanded((v) => !v);
									setExpandTick((t) => t + 1);
								}}
							>
								{expanded ? t("全部收起") : t("全部展开")}
							</button>
						</div>
						{!adding ? (
							<button className="drawer-btn" disabled={busy} onClick={() => setAdding(true)}>
								{t("＋ 新增条目")}
							</button>
						) : (
							<div className="lore-edit lore-add-form">
								<div className="field-hint">{t("写进「{name}」。关键词留空会自动按标题生成。", { name: titleName })}</div>
								<Field label={t("标题")}>
									<input
										className="panel-search"
										placeholder={t("如：南阳城 · 宵禁")}
										value={newComment}
										autoFocus
										onChange={(ev) => setNewComment(ev.target.value)}
									/>
								</Field>
								<div className="panel-row lore-edit-row">
									<Field label={t("类型")}>
										<select
											className="panel-search"
											value={newConstant ? "constant" : "keyed"}
											onChange={(ev) => setNewConstant(ev.target.value === "constant")}
										>
											<option value="keyed">{t("绿灯 · 关键词")}</option>
											<option value="constant">{t("蓝灯 · 常驻")}</option>
										</select>
									</Field>
									<Field label={t("优先级 order")} hint={t("越小越靠前")}>
										<input
											className="panel-search lore-order-input"
											type="number"
											min={0}
											max={9999}
											value={newOrder}
											onChange={(ev) => setNewOrder(ev.target.value)}
										/>
									</Field>
								</div>
								<Field label={t("关键词")} hint={newConstant ? t("常驻条目不靠关键词触发；填了可供检索") : t("逗号 / 顿号分隔；留空则按标题生成")}>
									<input className="panel-search" value={newKeys} onChange={(ev) => setNewKeys(ev.target.value)} placeholder={t("如：南阳、宵禁")} />
								</Field>
								<Field label={t("正文")}>
									<textarea
										className="panel-search lore-content-edit"
										rows={8}
										placeholder={t("这条设定的具体内容…")}
										value={newContent}
										onChange={(ev) => setNewContent(ev.target.value)}
									/>
								</Field>
								<div className="panel-row">
									<button
										type="button"
										className="drawer-btn save-btn"
										disabled={busy || !newComment.trim() || !newContent.trim()}
										onClick={addEntry}
									>
										{t("添加")}
									</button>
									<button type="button" className="drawer-btn" disabled={busy} onClick={resetAddForm}>
										{t("取消")}
									</button>
								</div>
							</div>
						)}
						{filtered.length === 0 && <div className="sp-empty">{t("此书无匹配条目。")}</div>}
						{filtered.slice(0, limit).map((e) => (
							<EntryRow
								key={e.fingerprint}
								e={e}
								busy={busy}
								expandTick={expandTick}
								expanded={expanded}
								onToggle={toggle}
								onPatch={patch}
								onDelete={removeEntry}
							/>
						))}
						{filtered.length > limit && (
							<button className="drawer-btn" onClick={() => setLimit((n) => n + 40)}>
								{t("显示更多（还有 {n} 条）", { n: filtered.length - limit })}
							</button>
						)}
					</section>
				</>
			)}
		</div>
	);
}
