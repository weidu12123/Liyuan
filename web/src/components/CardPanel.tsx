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
import { CardAuthoring } from "./CardAuthoring.tsx";
import { t } from "../i18n/index.ts";

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
	if (!text.trim() && !editing) {
		return (
			<button
				type="button"
				className="card-empty-field-btn"
				onClick={() => {
					setDraft("");
					setEditing(true);
				}}
				title={t("填写{title}", { title })}
			>
				{t("＋ {title}", { title })}
			</button>
		);
	}
	return (
		<details className="legacy-group" open={open || editing}>
			<summary>
				{title}
				{text ? t("（{n} 字）", { n: text.length }) : t("（空）")}
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
							{t("保存")}
						</button>
						<button className="drawer-btn" onClick={() => setEditing(false)}>
							{t("取消")}
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
							{t("编辑")}
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

	const preview = text.trim() || t("（空）");
	const lines = preview.split("\n");
	const previewBlock = lines.slice(0, 3).join("\n") + (lines.length > 3 || preview.length > 180 ? "…" : "");
	const canUp = index > 0;
	const canDown = index < total - 1;

	return (
		<div className={`greeting-card ${selected ? "current" : ""} ${open ? "open" : ""}`}>
			<div className="greeting-card-head">
				<button type="button" className="greeting-pick" disabled={busy} onClick={onSelect} title={t("选为新会话开场白")}>
					<span className={`radio ${selected ? "on" : ""}`} />
					<span className="greeting-label">{label}</span>
					{selected && <span className="chip chip-cap">{t("选用")}</span>}
				</button>
				<span className="greeting-card-acts">
					<button
						type="button"
						className="act"
						disabled={busy || !canUp}
						title={t("上移")}
						aria-label={t("上移开场白")}
						onClick={() => onMove(-1)}
					>
						↑
					</button>
					<button
						type="button"
						className="act"
						disabled={busy || !canDown}
						title={t("下移")}
						aria-label={t("下移开场白")}
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
						{open ? t("收起") : t("展开")}
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
						{t("编辑")}
					</button>
					{canDelete && (
						<ConfirmButton className="act" disabled={busy} confirmText={t("确认删除")} onConfirm={onDelete}>
							{t("删除")}
						</ConfirmButton>
					)}
				</span>
			</div>
			{!open && (
				<pre className="greeting-preview" onClick={() => setOpen(true)} title={t("点击展开")}>
					{previewBlock}
				</pre>
			)}
			{open && !editing && (
				<div className="greeting-body">
					<pre className="greeting-full">{text || t("（空）")}</pre>
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
							{t("保存")}
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
							{t("取消")}
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

type CardFrontInfo = {
	enabled: boolean;
	hasSkin: boolean;
	rules: unknown[];
	charName: string;
	userName: string;
};

function CardDetail({
	toast,
	onBack,
	libItem,
	onDelete,
	onFrontChange,
}: {
	toast: (level: "info" | "warning" | "error", text: string) => void;
	onBack: () => void;
	libItem: CardLibItem | undefined;
	onDelete: () => void;
	onFrontChange?: () => void;
}) {
	const { data, error, loading, reload } = usePanelData(() => apiGet<CardResponse>("/api/card"), { cacheKey: "/api/card" });
	const { busy, run } = useAction(toast);
	// 简介等字段：JSON 与 PNG（tEXt 回写）均可改
	const fieldEditable = true;
	const [front, setFront] = useState<CardFrontInfo | null>(null);
	/**
	 * 卡皮肤详情随当前卡变，但 URL 里没有卡 —— 原先靠 bypassCache 保证不吃上一张卡的 hasSkin，
	 * 代价是每次打开面板都重传一遍（真实卡实测 140KB）。改成把卡路径挂成 query：
	 * 服务端路由只看去掉 query 的路径（rest.ts `url.split("?")[0]`），这个参数它不读，
	 * 纯粹给前端缓存分桶 ⇒ 不同卡各占一格，**结构上**不可能串卡，重复打开则命中缓存。
	 */
	const frontPath = data?.path ? `/api/cardfront?card=${encodeURIComponent(data.path)}` : null;

	useEffect(() => {
		if (!frontPath) {
			setFront(null);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const r = await apiGet<CardFrontInfo>(frontPath);
				if (!cancelled) setFront(r);
			} catch {
				if (!cancelled) setFront(null);
			}
		})();
		return () => {
			cancelled = true;
		};
		// 改名也重跑：写操作已清掉 /api/cardfront 前缀的缓存，这里会拉到新的
	}, [frontPath, data?.name]);

	const toggleFront = (enabled: boolean) =>
		run(async () => {
			await apiPut<{ ok: boolean; enabled: boolean }>("/api/cardfront", { enabled });
			setFront((f) => (f ? { ...f, enabled } : f));
			onFrontChange?.();
		}, enabled ? t("已开启原卡界面美化") : t("已关闭原卡界面美化"));

	const saveField = (patch: Record<string, string>) =>
		run(async () => {
			await apiPut("/api/card", patch);
			reload();
		}, t("已保存并重载会话"));

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
		toast("info", format === "png" ? t("正在导出 PNG 角色卡…") : t("正在导出 JSON 角色卡…"));
	};

	const pickGreeting = (index: number) =>
		run(async () => {
			// apply: 未开聊时即时替换对话开场白；已开聊则只记配置
			await apiPost("/api/greeting", { index, apply: true });
			reload();
		}, t("开场白已更新"));

	const saveGreeting = (index: number, text: string) =>
		run(async () => {
			await apiPut("/api/card/greetings", { index, text });
			reload();
		}, t("开场白已保存"));

	const addGreeting = () =>
		run(async () => {
			await apiPost("/api/card/greetings", { text: "" });
			reload();
		}, t("已新建开场白"));

	const deleteGreeting = (index: number) =>
		run(async () => {
			await apiDelete(`/api/card/greetings?index=${index}`);
			reload();
		}, t("已删除开场白"));

	const moveGreeting = (index: number, delta: -1 | 1) =>
		run(async () => {
			await apiPost("/api/card/greetings/move", { index, delta });
			reload();
		});

	return (
		<div className="card-detail-scroll">
			<button type="button" className="act back-btn" onClick={onBack}>
				<IconBack size={14} /> {t("返回卡库")}
			</button>
			<PanelStatus loading={loading} error={error} hasData={!!data} />
			{data && (
				<>
					<section className="sp-section">
						<div className="card-hero">
							{(libItem?.isPng || libItem?.hasCover) && (
								<img className="card-hero-img" src={cardImgUrl(libItem.path)} alt={data.name} />
							)}
							<div className="card-hero-info">
								<div className="model-current">{data.name}</div>
								{data.displayName && <div className="field-hint">{t("显示名：{name}", { name: data.displayName })}</div>}
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
						<div className="panel-row card-actions-row" style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
							<div className="card-export-group" style={{ display: "inline-flex", gap: 6 }}>
								<button type="button" className="drawer-btn" disabled={busy} onClick={() => doExport("json")}>
									{t("导出 JSON")}
								</button>
								<button type="button" className="drawer-btn" disabled={busy} onClick={() => doExport("png")}>
									{t("导出 PNG")}
								</button>
							</div>
							<button type="button" className="drawer-btn card-delete-btn" disabled={busy} onClick={onDelete} title={t("删除角色卡")}>
								{t("删除")}
							</button>
						</div>
						{front?.hasSkin && (
							<label className="cardfront-toggle field-hint" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
								<input
									type="checkbox"
									checked={front.enabled}
									disabled={busy}
									onChange={(e) => void toggleFront(e.target.checked)}
								/>
								{t("原卡界面美化（卡作者的状态栏/界面样式）")}
							</label>
						)}
						<div className="field-hint">
							{t("导出含当前卡字段 + 活跃世界书（挂载书、本卡补充设定、原内嵌书合并去重）。PNG 保留立绘；纯 JSON 卡导出 PNG 时用占位图。")}
						</div>
						<EditableSection title={t("简介")} text={data.description} editable={fieldEditable} onSave={(v) => saveField({ description: v })} />
						<EditableSection title={t("性格")} text={data.personality} editable={fieldEditable} onSave={(v) => saveField({ personality: v })} />
						<EditableSection title={t("场景")} text={data.scenario} editable={fieldEditable} onSave={(v) => saveField({ scenario: v })} />
						<EditableSection title={t("作者注")} text={data.creatorNotes} editable={fieldEditable} onSave={(v) => saveField({ creatorNotes: v })} />
					</section>

					<CardAuthoring key={data.path} card={data.path} onApplied={() => { reload(); onFrontChange?.(); }} />
					<section className="sp-section">
						<div className="greeting-sec-head">
							<h4>{t("开场白（{n}）", { n: data.greetings.length })}</h4>
							<button type="button" className="drawer-btn" disabled={busy} onClick={() => void addGreeting()}>
								{t("＋ 新建开场白")}
							</button>
						</div>
						<div className="field-hint">
							{t("点左侧圆点选用：若当前会话还没开聊会立刻换掉对话里的开场白；已开聊则记入下次新会话。↑↓ 调整顺序；可展开编辑。")}
						</div>
						{data.greetings.map((g) => (
							<GreetingCard
								key={`${g.index}-${g.text.slice(0, 24)}`}
								index={g.index}
								label={g.index === 0 ? t("默认开场白") : t("备选 {n}", { n: g.index })}
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
				title={current ? t("当前使用中（点击进详情）") : t("切换到「{name}」并打开详情", { name: c.name })}
				onClick={() => onPick(c)}
			>
				{c.isPng || c.hasCover ? (
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
				title={c.fav ? t("取消收藏") : t("收藏（排序可选「收藏」查看）")}
				aria-label={c.fav ? t("取消收藏") : t("收藏")}
				onClick={() => onFav(c)}
			>
				<IconStar size={14} filled={c.fav} />
			</button>
			{!current && (
				<button
					type="button"
					className="card-fav card-del"
					disabled={busy}
					title={t("删除这张卡…")}
					aria-label={t("删除角色卡「{name}」", { name: c.name })}
					onClick={() => onDelete(c)}
				>
					<IconClose size={13} />
				</button>
			)}
		</div>
	);
}

/** 配套世界书导入询问（ST 式） */
interface LorePromptItem {
	cardName: string;
	cardPath: string;
	entryCount: number;
	isCurrent?: boolean;
}

interface LorePrompt {
	items: LorePromptItem[];
}

export function CardPanel({
	toast,
	/** 点卡/换卡后离开主页进入对话（学 ST） */
	onEnterChat,
	/** 删除当前使用中的卡后回主页 */
	onGoHome,
	/** 侧栏是否正在显示本面板；每次重新打开时若有当前卡则进详情 */
	active = true,
	/** 卡皮肤开关变更后通知 App 重拉显示规则 */
	onFrontChange,
}: {
	toast: (level: "info" | "warning" | "error", text: string) => void;
	onEnterChat?: () => void;
	onGoHome?: () => void;
	active?: boolean;
	onFrontChange?: () => void;
}) {
	const lib = usePanelData(() => apiGet<CardsResponse>("/api/cards"), { cacheKey: "/api/cards" });
	const { busy, run } = useAction(toast);
	const [detail, setDetail] = useState(true);
	const [lorePrompt, setLorePrompt] = useState<LorePrompt | null>(null);
	const [importLore, setImportLore] = useState(true);

	const openLorePrompt = (items: LorePromptItem[]) => {
		setImportLore(true);
		setLorePrompt({ items });
	};
	/** 删除确认弹窗：目标卡 + 两个勾选 */
	const [deletePrompt, setDeletePrompt] = useState<CardLibItem | null>(null);
	const [delLore, setDelLore] = useState(false);
	const [delData, setDelData] = useState(false);
	/** 本地「当前卡」覆盖：换卡后不立刻 reload 整库（避免封面重刷） */
	const [currentPath, setCurrentPath] = useState<string | null>(null);
	const wasActive = useRef(active);

	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<CardSort>(() => (localStorage.getItem("liyuan.cards.sort") as CardSort) || "recent");
	const [view, setView] = useState<CardView>(() => (localStorage.getItem("liyuan.cards.view") as CardView) || "list");
	const [tagFilter, setTagFilter] = useState<string | null>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const [importing, setImporting] = useState(false);
	const [pathInput, setPathInput] = useState("");
	// 用户自己新建一张卡（8/29：此前只能导入酒馆卡，不能创作）
	const [creating, setCreating] = useState(false);
	const [newCardName, setNewCardName] = useState("");
	const [newFirstMes, setNewFirstMes] = useState("");
	const [newDesc, setNewDesc] = useState("");
	/** 卡名 + 开场白是硬底线：没有开场白的卡开不了场（服务端同样拒） */
	const canCreateCard = newCardName.trim().length > 0 && newFirstMes.trim().length > 0;

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
			openLorePrompt([
				{
					cardName: info.name,
					cardPath: info.path,
					entryCount: info.embeddedLoreCount,
					isCurrent: true,
				},
			]);
		} else {
			if (info.embeddedLoreCount === 0) clearLorePending(info.path);
			setDetail(true);
		}
	};

	const skipLoreImport = () => {
		if (lorePrompt) {
			for (const it of lorePrompt.items) {
				clearLorePending(it.cardPath);
			}
		}
		setLorePrompt(null);
		setDetail(true);
		onEnterChat?.();
	};

	const confirmLoreImport = (mountCurrent: boolean) =>
		run(async () => {
			if (!lorePrompt || lorePrompt.items.length === 0) return;
			const items = lorePrompt.items;
			const r = await apiPost<{
				ok: true;
				results?: Array<{ path: string; entryCount: number; name: string; mounted: boolean }>;
			}>("/api/card/import-embedded-lore", {
				cards: items.map((it) => ({
					card: it.cardPath,
					mount: mountCurrent && (it.isCurrent || items.length === 1),
				})),
			});
			for (const it of items) {
				clearLorePending(it.cardPath);
			}
			setLorePrompt(null);
			setDetail(true);
			onEnterChat?.();
			bumpWatchPanels();
			const mountedItem = r.results?.find((x) => x.mounted);
			if (mountedItem?.path) {
				try {
					sessionStorage.setItem("liyuan.lore.focus", mountedItem.path);
				} catch {
					/* ignore */
				}
			}
		}, mountCurrent ? t("配套世界书已导入并加入挂载") : t("配套世界书已导入（未挂载）"));

	// ST 交互：点卡即切换并进对话；同卡再点也进对话（不重复 switch）
	const pick = (c: CardLibItem) => {
		if (c.path === effectiveCurrent) {
			onEnterChat?.();
			setDetail(true);
			return;
		}
		void run(async () => {
			const r = await apiPost<{ name: string; path: string; embeddedLoreCount: number; promoted?: boolean }>("/api/card/switch", {
				card: c.path,
			});
			// 暂存卡升格后路径已变（旧条目失效）：重拉一次；普通切换不重拉，避免封面重下
			if (r.promoted) lib.reload();
			afterCardReady({
				name: r.name,
				path: r.path ?? c.path,
				embeddedLoreCount: r.embeddedLoreCount ?? 0,
			});
		});
	};

	const switchByPath = (p: string) =>
		run(async () => {
			const r = await apiPost<{ name: string; path: string; embeddedLoreCount: number; promoted?: boolean }>("/api/card/switch", {
				card: p,
			});
			if (r.promoted) lib.reload();
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
		}, delData ? t("已删除「{name}」", { name: deletePrompt?.name ?? "" }) : t("已删除「{name}」（数据保留，重新导入可续玩）", { name: deletePrompt?.name ?? "" }));

	/**
	 * 新建一张空白角色卡（8/29）：与「导入卡」并列的另一条入口——用户自己创作，不必先有酒馆卡。
	 * 只要卡名 + 开场白（开场白是硬底线，没有它卡开不了场）；描述选填。
	 * 其余字段（性格/场景/对白示例/备选开场白）留给现成的详情编辑界面。
	 * 建完**不切当前卡**，卡出现在库里由用户自己点开——与 agent 的 card_create 同一语义。
	 */
	const doCreateCard = () =>
		run(async () => {
			const name = newCardName.trim();
			const firstMes = newFirstMes.trim();
			if (!name) throw new Error(t("请先填卡名"));
			if (!firstMes) throw new Error(t("请写开场白——新会话的首条消息"));
			await apiPost<{ name: string; path: string }>("/api/cards", {
				name,
				firstMes,
				...(newDesc.trim() ? { description: newDesc.trim() } : {}),
			});
			setCreating(false);
			setNewCardName("");
			setNewFirstMes("");
			setNewDesc("");
			lib.reload();
			bumpWatchPanels();
		});

	const doImport = async (files: FileList | File[]) => {
		setImporting(true);
		try {
			let last: { name: string; path: string; embeddedLoreCount: number } | null = null;
			const withLore: LorePromptItem[] = [];
			for (const f of Array.from(files)) {
				try {
					const r = await importCard(f);
					toast("info", t("已导入「{name}」", { name: r.name }));
					if ((r.embeddedLoreCount ?? 0) > 0) {
						markLorePending(r.path);
						withLore.push({
							cardName: r.name,
							cardPath: r.path,
							entryCount: r.embeddedLoreCount!,
						});
					}
					last = {
						name: r.name,
						path: r.path,
						embeddedLoreCount: r.embeddedLoreCount ?? 0,
					};
				} catch (e) {
					toast("error", t("「{name}」导入失败：{err}", { name: f.name, err: e instanceof Error ? e.message : String(e) }));
				}
			}
			lib.reload();
			// 导入后自动切换到最后一张；有内嵌书且 pending 则询问配套世界书
			if (last) {
				void run(async () => {
					const r = await apiPost<{ name: string; path: string; embeddedLoreCount: number; promoted?: boolean }>("/api/card/switch", {
						card: last!.path,
					});
					if (r.promoted) lib.reload();
					const path = r.path ?? last!.path;
					markLorePending(path);
					if (path !== last!.path) markLorePending(last!.path);
					setCurrentPath(path);
					onEnterChat?.();
					if (withLore.length > 0) {
						openLorePrompt(
							withLore.map((it) => ({
								...it,
								isCurrent: it.cardPath === path || it.cardPath === last!.path,
							})),
						);
					} else {
						setDetail(true);
					}
				});
			}
		} finally {
			setImporting(false);
			if (fileRef.current) fileRef.current.value = "";
		}
	};

	const loreModal = lorePrompt && lorePrompt.items.length > 0 && (() => {
		const items = lorePrompt.items;
		const totalEntries = items.reduce((sum, it) => sum + it.entryCount, 0);
		const currentItem = items.find((it) => it.isCurrent) ?? items[items.length - 1];

		return (
			<div className="card-lore-modal" role="dialog" aria-modal="true" aria-labelledby="card-lore-title">
				<div className="card-lore-dialog">
					<button
						type="button"
						className="icon-btn card-lore-x"
						title={t("关闭")}
						aria-label={t("关闭")}
						onClick={skipLoreImport}
					>
						<IconClose size={18} />
					</button>
					<h3 id="card-lore-title">{t("配套世界书")}</h3>
					{items.length === 1 ? (
						<p>
							{t("角色卡「{name}」打包了配套世界书 {n} 条。", { name: items[0].cardName, n: items[0].entryCount })}
							<br />
							{t("世界书导入后可在世界书面板管理，也可随时挂载到对话。")}
						</p>
					) : (
						<p>
							{t("本次导入有 {cards} 张角色卡包含配套世界书（共 {entries} 条）：", { cards: items.length, entries: totalEntries })}
							<br />
							<span style={{ fontSize: "12.5px", color: "var(--text-soft)" }}>
								{items.map((it) => t("「{name}」（{n} 条）", { name: it.cardName, n: it.entryCount })).join(t("、"))}
							</span>
						</p>
					)}

					<label className="card-del-opt" style={{ margin: "14px 0 16px" }}>
						<input
							type="checkbox"
							checked={importLore}
							onChange={(e) => setImportLore(e.target.checked)}
						/>
						<span>{items.length > 1 ? t("导入配套世界书（{books} 本，共 {entries} 条）", { books: items.length, entries: totalEntries }) : t("导入配套世界书")}</span>
					</label>

					<div className="panel-row card-lore-actions">
						{importLore ? (
							<>
								<button
									type="button"
									className="drawer-btn save-btn"
									disabled={busy}
									onClick={() => void confirmLoreImport(true)}
								>
									{items.length > 1
										? t("全部导入，并挂载「{name}」", { name: currentItem.cardName })
										: t("导入并挂载")}
								</button>
								<button
									type="button"
									className="drawer-btn"
									disabled={busy}
									onClick={() => void confirmLoreImport(false)}
								>
									{t("导入但暂不挂载")}
								</button>
							</>
						) : (
							<button
								type="button"
								className="drawer-btn"
								disabled={busy}
								onClick={skipLoreImport}
							>
								{t("不导入世界书")}
							</button>
						)}
					</div>
				</div>
			</div>
		);
	})();

	const deleteModal = deletePrompt && (
		<div className="card-lore-modal" role="dialog" aria-modal="true" aria-labelledby="card-del-title">
			<div className="card-lore-dialog">
				<button type="button" className="icon-btn card-lore-x" title={t("取消")} aria-label={t("关闭")} onClick={() => setDeletePrompt(null)}>
					<IconClose size={18} />
				</button>
				<h3 id="card-del-title">{t("删除角色卡「{name}」？", { name: deletePrompt.name })}</h3>
				<p>
					{deletePrompt.path === effectiveCurrent ? t("卡片文件将从卡库移除；这是当前对话中的卡，删除后将回到主页。") : t("卡片文件将从卡库移除。")}
				</p>
				<label className="card-del-opt">
					<input type="checkbox" checked={delLore} onChange={(e) => setDelLore(e.target.checked)} />
					{t("同时删除配套世界书（以这张卡命名导入的书）")}
				</label>
				<label className="card-del-opt">
					<input type="checkbox" checked={delData} onChange={(e) => setDelData(e.target.checked)} />
					{t("同时删除相关数据（该卡全部会话记录与补充设定）")}
				</label>
				<p className="field-hint">{t("不勾「相关数据」时数据保留在本机：日后重新导入同一张卡，会话与设定无缝衔接。")}</p>
				<div className="panel-row card-lore-actions">
					<button type="button" className="drawer-btn save-btn" disabled={busy} onClick={() => void confirmDelete()}>
						{t("删除")}
					</button>
					<button type="button" className="drawer-btn" disabled={busy} onClick={() => setDeletePrompt(null)}>
						{t("取消")}
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
								title={t("打开当前卡详情并进入对话")}
							>
								{currentLibItem.isPng || currentLibItem.hasCover ? (
									<img className="card-thumb" src={cardImgUrl(currentLibItem.path)} alt={currentLibItem.name} />
								) : (
									<span className="card-thumb card-thumb-json">JSON</span>
								)}
								<span className="current-card-info">
									<span className="current-card-label">{t("当前使用")}</span>
									<span className="current-card-name">{currentLibItem.name}</span>
								</span>
								<span className="act">{t("详情 ›")}</span>
							</button>
						)}

						<SearchInput value={query} onChange={setQuery} placeholder={t("搜索卡名 / 标签…")} />
						<div className="panel-row list-toolbar">
							<select className="panel-search" value={sort} onChange={(e) => setSortP(e.target.value as CardSort)} aria-label={t("排序方式")}>
								<option value="recent">{t("最近修改")}</option>
								<option value="name">{t("按名字")}</option>
								<option value="fav">{t("收藏")}</option>
							</select>
							<button
								className="drawer-btn"
								title={view === "grid" ? t("切换到列表视图") : t("切换到网格视图")}
								aria-label={t("切换视图")}
								onClick={() => setViewP(view === "grid" ? "list" : "grid")}
							>
								{view === "grid" ? <IconList size={14} /> : <IconGrid size={14} />}
							</button>
							<button
								className="drawer-btn"
								title={t("自己新建一张角色卡（不必先有酒馆卡）")}
								onClick={() => setCreating((v) => !v)}
							>
								{t("＋ 新建卡")}
							</button>
							<button className="drawer-btn" disabled={importing} onClick={() => fileRef.current?.click()}>
								<IconUploads size={13} /> {importing ? t("导入中…") : t("导入卡")}
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
						{creating && (
							<div className="lore-edit" onClick={(ev) => ev.stopPropagation()}>
								<Field label={t("卡名")} hint={t("也是文件名；建完不会自动切换，去库里点开")}>
									<input
										className="panel-search"
										autoFocus
										value={newCardName}
										placeholder={t("例：青梧")}
										onChange={(ev) => setNewCardName(ev.target.value)}
										onKeyDown={(ev) => {
											if (ev.key === "Escape") setCreating(false);
										}}
									/>
								</Field>
								<Field label={t("开场白")} hint={t("必填——新会话的首条消息，没有它开不了场")}>
									<textarea
										className="panel-search"
										rows={3}
										value={newFirstMes}
										placeholder={t("她抬头看了你一眼，把茶碗往你那边推了推。")}
										onChange={(ev) => setNewFirstMes(ev.target.value)}
									/>
								</Field>
								<Field label={t("描述（选填）")} hint={t("性格/场景/对白示例等建完在详情里补")}>
									<textarea
										className="panel-search"
										rows={2}
										value={newDesc}
										placeholder={t("外貌、身份、背景…")}
										onChange={(ev) => setNewDesc(ev.target.value)}
									/>
								</Field>
								<div className="panel-row" style={{ marginTop: 6 }}>
									<button className="drawer-btn" disabled={busy || !canCreateCard} onClick={() => void doCreateCard()}>
										{t("新建")}
									</button>
									<button className="drawer-btn" onClick={() => setCreating(false)}>
										{t("取消")}
									</button>
								</div>
							</div>
						)}
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
						{shown.length === 0 && <div className="sp-empty">{t("没有匹配的卡。把 PNG/JSON 角色卡拖进面板即可导入。")}</div>}
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
						<div className="field-hint">{t("点卡即切换会话、进入对话，并在侧栏打开详情。返回卡库时封面不重载。")}</div>

						<details className="legacy-group">
							<summary>{t("按路径换卡（卡库扫不到的位置）")}</summary>
							<Field label={t("角色卡路径（.png / .json，相对 app/ 或绝对路径）")}>
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
								{t("切换角色卡")}
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
						onFrontChange={onFrontChange}
					/>
				</div>
			)}
		</div>
	);
}
