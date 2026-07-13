/**
 * 角色卡面板（右栏）：卡库与详情一体。
 * 点卡即切换并进详情；若卡含内嵌世界书，弹窗询问是否另存为独立世界书并挂载（ST 式配套导入）。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
	apiDelete,
	apiGet,
	apiPost,
	apiPut,
	importCard,
	type CardLibItem,
	type CardResponse,
	type CardsResponse,
} from "../api.ts";
import { IconBack, IconClose, IconGrid, IconList, IconStar, IconUploads } from "./icons.tsx";
import { bumpWatchPanels, ConfirmButton, Field, PanelStatus, SearchInput, useAction, usePanelData } from "./kit.tsx";

type CardSort = "recent" | "name" | "fav";
type CardView = "grid" | "list";

const cardImgUrl = (path: string) => `/api/cards/image?path=${encodeURIComponent(path)}`;

/** 刚导入、尚未回答「是否挂载内嵌世界书」的卡路径（再导入会重新标记） */
const LORE_PENDING_KEY = "liyuan.cards.lorePending";

function getLorePending(): Set<string> {
	try {
		const raw = JSON.parse(localStorage.getItem(LORE_PENDING_KEY) || "[]") as unknown;
		return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
	} catch {
		return new Set();
	}
}

function setLorePending(paths: Set<string>) {
	localStorage.setItem(LORE_PENDING_KEY, JSON.stringify([...paths]));
}

function markLorePending(path: string) {
	const s = getLorePending();
	s.add(path);
	setLorePending(s);
}

function clearLorePending(path: string) {
	const s = getLorePending();
	if (!s.has(path)) return;
	s.delete(path);
	setLorePending(s);
}

function isLorePending(path: string) {
	return getLorePending().has(path);
}

// ---------- 详情视图：可编辑字段 ----------

function EditableSection({
	title,
	text,
	editable,
	onSave,
	open,
}: {
	title: string;
	text: string;
	editable: boolean;
	onSave: (v: string) => void;
	open?: boolean;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	if (!text.trim() && !editable) return null;
	return (
		<details className="legacy-group" open={open || editing}>
			<summary>
				{title}
				{text ? `（${text.length} 字）` : "（空）"}
			</summary>
			{editing ? (
				<div className="skill-edit">
					<textarea className="panel-search ta" rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} />
					<div className="panel-row">
						<button
							className="drawer-btn"
							onClick={() => {
								onSave(draft);
								setEditing(false);
							}}
						>
							保存
						</button>
						<button className="drawer-btn" onClick={() => setEditing(false)}>
							取消
						</button>
					</div>
				</div>
			) : (
				<>
					{text.trim() && <div className="longtext">{text}</div>}
					{editable && (
						<button
							className="act"
							onClick={() => {
								setDraft(text);
								setEditing(true);
							}}
						>
							编辑
						</button>
					)}
				</>
			)}
		</details>
	);
}

function GreetingCard({
	index,
	label,
	text,
	selected,
	busy,
	total,
	onSelect,
	onSave,
	onDelete,
	onMove,
	canDelete,
}: {
	index: number;
	label: string;
	text: string;
	selected: boolean;
	busy: boolean;
	total: number;
	onSelect: () => void;
	onSave: (text: string) => void;
	onDelete: () => void;
	onMove: (delta: -1 | 1) => void;
	canDelete: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(text);
	useEffect(() => {
		if (!editing) setDraft(text);
	}, [text, editing]);

	const preview = text.trim() || "（空）";
	const lines = preview.split("\n");
	const previewBlock = lines.slice(0, 3).join("\n") + (lines.length > 3 || preview.length > 180 ? "…" : "");
	const canUp = index > 0;
	const canDown = index < total - 1;

	return (
		<div className={`greeting-card ${selected ? "current" : ""} ${open ? "open" : ""}`}>
			<div className="greeting-card-head">
				<button type="button" className="greeting-pick" disabled={busy} onClick={onSelect} title="选为新会话开场白">
					<span className={`radio ${selected ? "on" : ""}`} />
					<span className="greeting-label">{label}</span>
					{selected && <span className="chip chip-cap">选用</span>}
				</button>
				<span className="greeting-card-acts">
					<button
						type="button"
						className="act"
						disabled={busy || !canUp}
						title="上移"
						aria-label="上移开场白"
						onClick={() => onMove(-1)}
					>
						↑
					</button>
					<button
						type="button"
						className="act"
						disabled={busy || !canDown}
						title="下移"
						aria-label="下移开场白"
						onClick={() => onMove(1)}
					>
						↓
					</button>
					<button
						type="button"
						className="act"
						disabled={busy}
						onClick={() => {
							setOpen((v) => !v);
							setEditing(false);
						}}
					>
						{open ? "收起" : "展开"}
					</button>
					<button
						type="button"
						className="act"
						disabled={busy}
						onClick={() => {
							setOpen(true);
							setEditing(true);
							setDraft(text);
						}}
					>
						编辑
					</button>
					{canDelete && (
						<ConfirmButton className="act" disabled={busy} confirmText="确认删除" onConfirm={onDelete}>
							删除
						</ConfirmButton>
					)}
				</span>
			</div>
			{!open && (
				<pre className="greeting-preview" onClick={() => setOpen(true)} title="点击展开">
					{previewBlock}
				</pre>
			)}
			{open && !editing && (
				<div className="greeting-body">
					<pre className="greeting-full">{text || "（空）"}</pre>
				</div>
			)}
			{open && editing && (
				<div className="greeting-body">
					<textarea
						className="panel-search ta greeting-ta"
						rows={8}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						spellCheck={false}
					/>
					<div className="panel-row">
						<button
							type="button"
							className="drawer-btn save-btn"
							disabled={busy}
							onClick={() => {
								onSave(draft);
								setEditing(false);
							}}
						>
							保存
						</button>
						<button
							type="button"
							className="drawer-btn"
							disabled={busy}
							onClick={() => {
								setDraft(text);
								setEditing(false);
							}}
						>
							取消
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

function CardDetail({
	toast,
	onBack,
	libItem,
	onDelete,
}: {
	toast: (level: "info" | "warning" | "error", text: string) => void;
	onBack: () => void;
	libItem: CardLibItem | undefined;
	onDelete: () => void;
}) {
	const { data, error, loading, reload } = usePanelData(() => apiGet<CardResponse>("/api/card"), { cacheKey: "/api/card" });
	const { busy, run } = useAction(toast);
	// 简介等字段：JSON 与 PNG（tEXt 回写）均可改
	const fieldEditable = true;

	const saveField = (patch: Record<string, string>) =>
		run(async () => {
			await apiPut("/api/card", patch);
			reload();
		}, "已保存并重载会话");

	/** 导出当前卡（默认并入活跃世界书：挂载书+补充设定+原内嵌） */
	const doExport = (format: "json" | "png") => {
		const url = `/api/card/export?format=${format}&lore=active`;
		// 用隐藏 a 触发下载（带 cookie/同源）
		const a = document.createElement("a");
		a.href = url;
		a.download = "";
		a.rel = "noopener";
		document.body.appendChild(a);
		a.click();
		a.remove();
		toast("info", format === "png" ? "正在导出 PNG 角色卡…" : "正在导出 JSON 角色卡…");
	};

	const pickGreeting = (index: number) =>
		run(async () => {
			// apply: 未开聊时即时替换对话开场白；已开聊则只记配置
			await apiPost("/api/greeting", { index, apply: true });
			reload();
		}, "开场白已更新");

	const saveGreeting = (index: number, text: string) =>
		run(async () => {
			await apiPut("/api/card/greetings", { index, text });
			reload();
		}, "开场白已保存");

	const addGreeting = () =>
		run(async () => {
			await apiPost("/api/card/greetings", { text: "" });
			reload();
		}, "已新建开场白");

	const deleteGreeting = (index: number) =>
		run(async () => {
			await apiDelete(`/api/card/greetings?index=${index}`);
			reload();
		}, "已删除开场白");

	const moveGreeting = (index: number, delta: -1 | 1) =>
		run(async () => {
			await apiPost("/api/card/greetings/move", { index, delta });
			reload();
		});

	return (
		<div className="card-detail-scroll">
			<button type="button" className="act back-btn" onClick={onBack}>
				<IconBack size={14} /> 返回卡库
			</button>
			<PanelStatus loading={loading} error={error} hasData={!!data} />
			{data && (
				<>
					<section className="sp-section">
						<div className="card-hero">
							{libItem?.isPng && <img className="card-hero-img" src={cardImgUrl(libItem.path)} alt={data.name} />}
							<div className="card-hero-info">
								<div className="model-current">{data.name}</div>
								{data.displayName && <div className="field-hint">显示名：{data.displayName}</div>}
								<div className="field-hint">{data.path}</div>
								{data.tags.length > 0 && (
									<div className="tag-row">
										{data.tags.map((t) => (
											<span key={t} className="chip">
												{t}
											</span>
										))}
									</div>
								)}
							</div>
						</div>
						<div className="panel-row" style={{ marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
							<button type="button" className="drawer-btn" disabled={busy} onClick={() => doExport("json")}>
								导出 JSON
							</button>
							<button type="button" className="drawer-btn" disabled={busy} onClick={() => doExport("png")}>
								导出 PNG
							</button>
							<button type="button" className="drawer-btn card-delete-btn" disabled={busy} onClick={onDelete}>
								删除角色卡
							</button>
						</div>
						<div className="field-hint">
							导出含当前卡字段 + 活跃世界书（挂载书、本卡补充设定、原内嵌书合并去重）。PNG 保留立绘；纯 JSON 卡导出 PNG 时用占位图。
						</div>
						<EditableSection title="简介" text={data.description} editable={fieldEditable} onSave={(v) => saveField({ description: v })} />
						<EditableSection title="性格" text={data.personality} editable={fieldEditable} onSave={(v) => saveField({ personality: v })} />
						<EditableSection title="场景" text={data.scenario} editable={fieldEditable} onSave={(v) => saveField({ scenario: v })} />
						<EditableSection title="作者注" text={data.creatorNotes} editable={fieldEditable} onSave={(v) => saveField({ creatorNotes: v })} />
					</section>

					<section className="sp-section">
						<div className="greeting-sec-head">
							<h4>开场白（{data.greetings.length}）</h4>
							<button type="button" className="drawer-btn" disabled={busy} onClick={() => void addGreeting()}>
								＋ 新建开场白
							</button>
						</div>
						<div className="field-hint">
							点左侧圆点选用：若当前会话还没开聊会立刻换掉对话里的开场白；已开聊则记入下次新会话。↑↓ 调整顺序；可展开编辑。
						</div>
						{data.greetings.map((g) => (
							<GreetingCard
								key={`${g.index}-${g.text.slice(0, 24)}`}
								index={g.index}
								label={g.index === 0 ? "默认开场白" : `备选 ${g.index}`}
								text={g.text}
								selected={data.greetingIndex === g.index}
								busy={busy}
								total={data.greetings.length}
								onSelect={() => void pickGreeting(g.index)}
								onSave={(t) => void saveGreeting(g.index, t)}
								onDelete={() => void deleteGreeting(g.index)}
								onMove={(delta) => void moveGreeting(g.index, delta)}
								canDelete={data.greetings.length > 1}
							/>
						))}
					</section>
				</>
			)}
		</div>
	);
}

// ---------- 卡库视图 ----------

function CardItem({
	c,
	current,
	view,
	busy,
	onPick,
	onFav,
	onDelete,
}: {
	c: CardLibItem;
	current: boolean;
	view: CardView;
	busy: boolean;
	onPick: (c: CardLibItem) => void;
	onFav: (c: CardLibItem) => void;
	onDelete: (c: CardLibItem) => void;
}) {
	return (
		<div className={`card-item card-item-${view} ${current ? "current" : ""}`}>
			<button
				className="card-pick"
				disabled={busy}
				title={current ? "当前使用中（点击进详情）" : `切换到「${c.name}」并打开详情`}
				onClick={() => onPick(c)}
			>
				{c.isPng ? (
					<img className="card-thumb" src={cardImgUrl(c.path)} alt={c.name} loading="lazy" />
				) : (
					<span className="card-thumb card-thumb-json">JSON</span>
				)}
				<span className="card-name" title={c.name}>
					{c.name}
				</span>
				{view === "list" && c.tags.length > 0 && (
					<span className="card-tags">
						{c.tags.slice(0, 3).map((t) => (
							<span key={t} className="chip">
								{t}
							</span>
						))}
					</span>
				)}
			</button>
			<button
				className={`card-fav ${c.fav ? "on" : ""}`}
				title={c.fav ? "取消收藏" : "收藏（排序可选「收藏」查看）"}
				aria-label={c.fav ? "取消收藏" : "收藏"}
				onClick={() => onFav(c)}
			>
				<IconStar size={14} filled={c.fav} />
			</button>
			{!current && (
				<button
					type="button"
					className="card-fav card-del"
					disabled={busy}
					title="删除这张卡…"
					aria-label={`删除角色卡「${c.name}」`}
					onClick={() => onDelete(c)}
				>
					<IconClose size={13} />
				</button>
			)}
		</div>
	);
}

/** 配套世界书导入询问（ST 式） */
interface LorePrompt {
	cardName: string;
	cardPath: string;
	entryCount: number;
}

export function CardPanel({
	toast,
	/** 点卡/换卡后离开主页进入对话（学 ST） */
	onEnterChat,
	/** 删除当前使用中的卡后回主页 */
	onGoHome,
	/** 侧栏是否正在显示本面板；每次重新打开时若有当前卡则进详情 */
	active = true,
}: {
	toast: (level: "info" | "warning" | "error", text: string) => void;
	onEnterChat?: () => void;
	onGoHome?: () => void;
	active?: boolean;
}) {
	const lib = usePanelData(() => apiGet<CardsResponse>("/api/cards"), { cacheKey: "/api/cards" });
	const { busy, run } = useAction(toast);
	const [detail, setDetail] = useState(true);
	const [lorePrompt, setLorePrompt] = useState<LorePrompt | null>(null);
	/** 删除确认弹窗：目标卡 + 两个勾选 */
	const [deletePrompt, setDeletePrompt] = useState<CardLibItem | null>(null);
	const [delLore, setDelLore] = useState(false);
	const [delData, setDelData] = useState(false);
	/** 本地「当前卡」覆盖：换卡后不立刻 reload 整库（避免封面重刷） */
	const [currentPath, setCurrentPath] = useState<string | null>(null);
	const wasActive = useRef(active);

	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<CardSort>(() => (localStorage.getItem("liyuan.cards.sort") as CardSort) || "recent");
	const [view, setView] = useState<CardView>(() => (localStorage.getItem("liyuan.cards.view") as CardView) || "grid");
	const [tagFilter, setTagFilter] = useState<string | null>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const [importing, setImporting] = useState(false);
	const [pathInput, setPathInput] = useState("");

	useEffect(() => {
		if (lib.data?.current) setCurrentPath(lib.data.current);
	}, [lib.data?.current]);

	// 侧栏从收起→打开：有当前卡则直接进详情（修手机端「再进又是仓库」）
	useEffect(() => {
		const opened = active && !wasActive.current;
		wasActive.current = active;
		if (!opened) return;
		const cur = currentPath ?? lib.data?.current;
		if (cur) setDetail(true);
	}, [active, currentPath, lib.data?.current]);

	const setSortP = (s: CardSort) => {
		setSort(s);
		localStorage.setItem("liyuan.cards.sort", s);
	};
	const setViewP = (v: CardView) => {
		setView(v);
		localStorage.setItem("liyuan.cards.view", v);
	};

	const topTags = useMemo(() => {
		const count = new Map<string, number>();
		for (const c of lib.data?.cards ?? []) for (const t of c.tags) count.set(t, (count.get(t) ?? 0) + 1);
		return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);
	}, [lib.data]);

	const shown = useMemo(() => {
		const q = query.trim().toLowerCase();
		let list = (lib.data?.cards ?? []).filter(
			(c) =>
				(!q || c.name.toLowerCase().includes(q) || c.tags.some((t) => t.toLowerCase().includes(q))) &&
				(!tagFilter || c.tags.includes(tagFilter)),
		);
		list = [...list].sort((a, b) => {
			if (sort === "fav") {
				// 收藏在前，同组按最近修改
				if (a.fav !== b.fav) return a.fav ? -1 : 1;
				return b.mtimeMs - a.mtimeMs;
			}
			if (sort === "name") return a.name.localeCompare(b.name);
			return b.mtimeMs - a.mtimeMs; // recent
		});
		return list;
	}, [lib.data, query, sort, tagFilter]);

	const effectiveCurrent = currentPath ?? lib.data?.current ?? null;
	const currentLibItem = lib.data?.cards.find((c) => c.path === effectiveCurrent);

	/**
	 * 换卡就绪：进对话 + 侧栏详情；不 reload 卡库（避免封面整页重下）。
	 * 仅「本次导入后尚未回答过」且含内嵌世界书时弹窗。
	 */
	const afterCardReady = (info: { name: string; path: string; embeddedLoreCount: number }) => {
		setCurrentPath(info.path);
		// 离开主页，进入该卡会话对话（switch 已由调用方完成）
		onEnterChat?.();
		if (info.embeddedLoreCount > 0 && isLorePending(info.path)) {
			setLorePrompt({
				cardName: info.name,
				cardPath: info.path,
				entryCount: info.embeddedLoreCount,
			});
		} else {
			if (info.embeddedLoreCount === 0) clearLorePending(info.path);
			setDetail(true);
		}
	};

	const skipLoreImport = () => {
		if (lorePrompt) clearLorePending(lorePrompt.cardPath);
		setLorePrompt(null);
		setDetail(true);
		onEnterChat?.();
	};

	const confirmLoreImport = () =>
		run(async () => {
			if (!lorePrompt) return;
			const path = lorePrompt.cardPath;
			const r = await apiPost<{ path?: string; entryCount?: number; name?: string }>("/api/card/import-embedded-lore", {
				card: path,
			});
			clearLorePending(path);
			setLorePrompt(null);
			setDetail(true);
			onEnterChat?.();
			// 世界书面板多半已保活挂载：清缓存（api 层）后主动 bump，避免必须整页刷新
			bumpWatchPanels();
			if (r.path) {
				try {
					sessionStorage.setItem("liyuan.lore.focus", r.path);
				} catch {
					/* ignore */
				}
			}
		}, "配套世界书已导入并加入挂载（可与其它书并存）");

	// ST 交互：点卡即切换并进对话；同卡再点也进对话（不重复 switch）
	const pick = (c: CardLibItem) => {
		if (c.path === effectiveCurrent) {
			onEnterChat?.();
			setDetail(true);
			return;
		}
		void run(async () => {
			const r = await apiPost<{ name: string; path: string; embeddedLoreCount: number }>("/api/card/switch", {
				card: c.path,
			});
			afterCardReady({
				name: r.name,
				path: r.path ?? c.path,
				embeddedLoreCount: r.embeddedLoreCount ?? 0,
			});
		});
	};

	const switchByPath = (p: string) =>
		run(async () => {
			const r = await apiPost<{ name: string; path: string; embeddedLoreCount: number }>("/api/card/switch", {
				card: p,
			});
			afterCardReady({
				name: r.name,
				path: r.path ?? p,
				embeddedLoreCount: r.embeddedLoreCount ?? 0,
			});
		});

	const fav = (c: CardLibItem) =>
		run(async () => {
			await apiPost("/api/cards/fav", { path: c.path, fav: !c.fav });
			lib.reload();
		});

	const del = (c: CardLibItem) => {
		setDelLore(false);
		setDelData(false);
		setDeletePrompt(c);
	};

	const confirmDelete = () =>
		run(async () => {
			if (!deletePrompt) return;
			const c = deletePrompt;
			const wasCurrent = c.path === effectiveCurrent;
			const qs = `path=${encodeURIComponent(c.path)}${delLore ? "&lore=1" : ""}${delData ? "&data=1" : ""}`;
			const r = await apiDelete<{ ok: boolean; switchedTo: string | null }>(`/api/cards?${qs}`);
			setDeletePrompt(null);
			clearLorePending(c.path);
			if (wasCurrent) {
				// 删的是正在对话的卡：回主页（后端已自动切到剩余卡）
				setCurrentPath(r.switchedTo ?? null);
				setDetail(false);
				onGoHome?.();
			}
			lib.reload();
			bumpWatchPanels();
		}, `已删除「${deletePrompt?.name ?? ""}」${delData ? "" : "（数据保留，重新导入可续玩）"}`);

	const doImport = async (files: FileList | File[]) => {
		setImporting(true);
		try {
			let last: { name: string; path: string; embeddedLoreCount: number } | null = null;
			for (const f of Array.from(files)) {
				try {
					const r = await importCard(f);
					toast("info", `已导入「${r.name}」`);
					// 再次导入同一路径也会重新标记，下次进详情会再问一次世界书
					markLorePending(r.path);
					last = {
						name: r.name,
						path: r.path,
						embeddedLoreCount: r.embeddedLoreCount ?? 0,
					};
				} catch (e) {
					toast("error", `「${f.name}」导入失败：${e instanceof Error ? e.message : String(e)}`);
				}
			}
			lib.reload();
			// 导入后自动切换到最后一张；有内嵌书且 pending 则询问配套世界书
			if (last) {
				void run(async () => {
					const r = await apiPost<{ name: string; path: string; embeddedLoreCount: number }>("/api/card/switch", {
						card: last!.path,
					});
					const path = r.path ?? last!.path;
					// switch 返回路径可能规范化，与 import 路径对齐后再记 pending
					markLorePending(path);
					if (path !== last!.path) markLorePending(last!.path);
					afterCardReady({
						name: r.name,
						path,
						embeddedLoreCount: r.embeddedLoreCount ?? last!.embeddedLoreCount,
					});
				});
			}
		} finally {
			setImporting(false);
			if (fileRef.current) fileRef.current.value = "";
		}
	};

	const loreModal = lorePrompt && (
		<div className="card-lore-modal" role="dialog" aria-modal="true" aria-labelledby="card-lore-title">
			<div className="card-lore-dialog">
				<button type="button" className="icon-btn card-lore-x" title="不挂载" aria-label="关闭" onClick={skipLoreImport}>
					<IconClose size={18} />
				</button>
				<h3 id="card-lore-title">挂载世界书？</h3>
				<p>
					「{lorePrompt.cardName}」打包了世界书 <strong>{lorePrompt.entryCount}</strong> 条。
					<br />
					世界书与角色卡分开挂载：选<strong>导入并挂载</strong>后才会进本会话；选<strong>不挂载</strong>则只用角色卡，不带世界书。
				</p>
				<div className="panel-row card-lore-actions">
					<button type="button" className="drawer-btn save-btn" disabled={busy} onClick={() => void confirmLoreImport()}>
						导入并挂载
					</button>
					<button type="button" className="drawer-btn" disabled={busy} onClick={skipLoreImport}>
						不挂载
					</button>
				</div>
			</div>
		</div>
	);

	const deleteModal = deletePrompt && (
		<div className="card-lore-modal" role="dialog" aria-modal="true" aria-labelledby="card-del-title">
			<div className="card-lore-dialog">
				<button type="button" className="icon-btn card-lore-x" title="取消" aria-label="关闭" onClick={() => setDeletePrompt(null)}>
					<IconClose size={18} />
				</button>
				<h3 id="card-del-title">删除角色卡「{deletePrompt.name}」？</h3>
				<p>
					卡片文件将从卡库移除
					{deletePrompt.path === effectiveCurrent ? "；这是当前对话中的卡，删除后将回到主页" : ""}。
				</p>
				<label className="card-del-opt">
					<input type="checkbox" checked={delLore} onChange={(e) => setDelLore(e.target.checked)} />
					同时删除配套世界书（以这张卡命名导入的书）
				</label>
				<label className="card-del-opt">
					<input type="checkbox" checked={delData} onChange={(e) => setDelData(e.target.checked)} />
					同时删除相关数据（该卡全部会话记录与补充设定）
				</label>
				<p className="field-hint">不勾「相关数据」时数据保留在本机：日后重新导入同一张卡，会话与设定无缝衔接。</p>
				<div className="panel-row card-lore-actions">
					<button type="button" className="drawer-btn save-btn" disabled={busy} onClick={() => void confirmDelete()}>
						删除
					</button>
					<button type="button" className="drawer-btn" disabled={busy} onClick={() => setDeletePrompt(null)}>
						取消
					</button>
				</div>
			</div>
		</div>
	);

	// 卡库与详情同挂载：返回仓库时不卸载封面 DOM，避免重新请求图片
	return (
		<div
			className="panel-body"
			onDragOver={(e) => e.preventDefault()}
			onDrop={(e) => {
				e.preventDefault();
				if (e.dataTransfer.files.length > 0) void doImport(e.dataTransfer.files);
			}}
		>
			{loreModal}
			{deleteModal}
			<div className="card-lib-pane" hidden={detail} style={detail ? { display: "none" } : undefined}>
				<PanelStatus loading={lib.loading} error={lib.error} hasData={!!lib.data} />
				{lib.data && (
					<section className="sp-section">
						{currentLibItem && (
							<button
								type="button"
								className="current-card-banner"
								onClick={() => {
									onEnterChat?.();
									setDetail(true);
								}}
								title="打开当前卡详情并进入对话"
							>
								{currentLibItem.isPng ? (
									<img className="card-thumb" src={cardImgUrl(currentLibItem.path)} alt={currentLibItem.name} />
								) : (
									<span className="card-thumb card-thumb-json">JSON</span>
								)}
								<span className="current-card-info">
									<span className="current-card-label">当前使用</span>
									<span className="current-card-name">{currentLibItem.name}</span>
								</span>
								<span className="act">详情 ›</span>
							</button>
						)}

						<SearchInput value={query} onChange={setQuery} placeholder="搜索卡名 / 标签…" />
						<div className="panel-row list-toolbar">
							<select className="panel-search" value={sort} onChange={(e) => setSortP(e.target.value as CardSort)} aria-label="排序方式">
								<option value="recent">最近修改</option>
								<option value="name">按名字</option>
								<option value="fav">收藏</option>
							</select>
							<button
								className="drawer-btn"
								title={view === "grid" ? "切换到列表视图" : "切换到网格视图"}
								aria-label="切换视图"
								onClick={() => setViewP(view === "grid" ? "list" : "grid")}
							>
								{view === "grid" ? <IconList size={14} /> : <IconGrid size={14} />}
							</button>
							<button className="drawer-btn" disabled={importing} onClick={() => fileRef.current?.click()}>
								<IconUploads size={13} /> {importing ? "导入中…" : "导入卡"}
							</button>
							<input
								ref={fileRef}
								type="file"
								accept=".png,.json"
								multiple
								hidden
								onChange={(e) => {
									if (e.target.files?.length) void doImport(e.target.files);
								}}
							/>
						</div>
						{topTags.length > 0 && (
							<div className="tag-row">
								{topTags.map((t) => (
									<button
										key={t}
										className={`chip chip-btn ${tagFilter === t ? "chip-active" : ""}`}
										onClick={() => setTagFilter(tagFilter === t ? null : t)}
									>
										{t}
									</button>
								))}
							</div>
						)}
						{shown.length === 0 && <div className="sp-empty">没有匹配的卡。把 PNG/JSON 角色卡拖进面板即可导入。</div>}
						<div className={view === "grid" ? "card-grid" : "card-list"}>
							{shown.map((c) => (
								<CardItem
									key={c.path}
									c={c}
									current={c.path === effectiveCurrent}
									view={view}
									busy={busy}
									onPick={pick}
									onFav={fav}
									onDelete={del}
								/>
							))}
						</div>
						<div className="field-hint">点卡即切换会话、进入对话，并在侧栏打开详情。返回卡库时封面不重载。</div>

						<details className="legacy-group">
							<summary>按路径换卡（卡库扫不到的位置）</summary>
							<Field label="角色卡路径（.png / .json，相对 app/ 或绝对路径）">
								<input
									className="panel-search"
									placeholder="assets/cards/xxx.png"
									value={pathInput}
									onChange={(e) => setPathInput(e.target.value)}
								/>
							</Field>
							<button
								className="drawer-btn"
								disabled={busy || !pathInput.trim()}
								onClick={() => {
									void switchByPath(pathInput.trim());
									setPathInput("");
								}}
							>
								切换角色卡
							</button>
						</details>
					</section>
				)}
			</div>
			{detail && (
				<div className="card-detail-pane">
					<CardDetail
						toast={toast}
						onBack={() => setDetail(false)}
						libItem={currentLibItem}
						onDelete={() => {
							if (currentLibItem) del(currentLibItem);
						}}
					/>
				</div>
			)}
		</div>
	);
}
