/**
 * 会话面板（左栏，刀5 像素级对齐 Codex 设计语言）：
 *
 * 1. 顶栏操作项（新建项目 / 世界线 / 存档 / 压缩上下文）：纯文字+细线图标行，30px 行高，克制悬停底色。
 * 2. 沉浸式微型搜索框：无硬边框，融入背景。
 * 3. 分类标签栏：「项目」小灰字 + 右侧微型「多选」入口。
 * 4. 项目树（父强子弱）：
 *    - 项目行：空心文件夹 + 加粗主文本（13px，weight 600），hover 平滑浮现「＋」(新建对话) 与重命名。
 *    - 对话行：严格缩进 28px，纯单行次级灰（12.5px，weight 400），尾部省略截断，彻底移除挤占空间的时间戳标签。
 *    - 激活项目：浮动微透圆角块（仿 Codex 选中块），当前对话行文字加深加粗。
 * 5. 底部辅助区：独立置底的极简「导入聊天记录」，不与会话树混杂。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPostFile, type CardResponse, type SessionSearchHit } from "../api.ts";
import type { WireChatInfo, WireSessionInfo, WireStats } from "../wire.ts";
import {
	IconDownload,
	IconFolder,
	IconList,
	IconPencil,
	IconPin,
	IconPlus,
	IconTrash,
	IconUploads,
	IconWorldline,
} from "./icons.tsx";
import { ConfirmButton, Field, SearchInput, useAction } from "./kit.tsx";
import { fmtDateTime, t } from "../i18n/index.ts";

function timeAgo(ms: number): string {
	const diff = Date.now() - ms;
	if (diff < 90_000) return t("刚刚");
	if (diff < 3_600_000) return t("{n} 分钟前", { n: Math.round(diff / 60_000) });
	if (diff < 86_400_000) return t("{n} 小时前", { n: Math.round(diff / 3_600_000) });
	if (diff < 30 * 86_400_000) return t("{n} 天前", { n: Math.round(diff / 86_400_000) });
	return fmtDateTime(ms, { year: "numeric", month: "numeric", day: "numeric" });
}

/** 子项目显示名：用户起的名优先，缺省按建立时间生成 */
function chatLabel(c: WireChatInfo): string {
	if (c.name) return c.name;
	const ts = Date.parse(c.createdAt);
	if (Number.isNaN(ts)) return t("未命名项目");
	const d = new Date(ts);
	const pad = (n: number) => String(n).padStart(2, "0");
	return t("{month}月{day}日 {time}", { month: d.getMonth() + 1, day: d.getDate(), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` });
}

/** 新建项目弹窗的默认名：已有「新建对话（N）」取最大 N＋1，否则从（1）起 */
export function nextProjectName(chats: WireChatInfo[]): string {
	let max = 0;
	// 按当前语言的模板反推序号：模板里的 {n} 位置换成数字捕获
	const tmpl = t("新建对话（{n}）", { n: "\u0000" });
	const re = new RegExp(`^${tmpl.split("\u0000").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(\\d+)")}$`);
	for (const c of chats) {
		const m = re.exec(c.name ?? "");
		if (m) max = Math.max(max, Number(m[1]));
	}
	return t("新建对话（{n}）", { n: max + 1 });
}

/** 每个项目默认露出的对话数（当前项目永远全展开）；超出折叠进「展开显示」 */
const CHAT_PREVIEW_COUNT = 5;

export interface SessionsPanelProps {
	sessions: WireSessionInfo[] | null;
	/** 两层布局的子项目清单（null＝老布局/未下发 ⇒ 扁平列表） */
	chats?: WireChatInfo[] | null;
	stats: WireStats | null;
	onOpen: (path: string) => void;
	/** 新建：两层布局经弹窗起名后带 name（新建项目）与形态（缺省扮演 / agent）；老布局无参直接建会话 */
	onNew: (name?: string, mode?: "agent", greeting?: number) => void;
	/** 在指定子项目里再开一个会话（项目行右边的「＋」） */
	onNewInChat?: (chatId: string) => void;
	onCompact: () => void;
	/** 打开世界线时间线面板 */
	onWorldline?: () => void;
	/** 打开存档命名弹窗 */
	onStore?: () => void;
	/** 重命名/删除后重拉列表（ws sessions 请求） */
	onRefresh: () => void;
	toast: (level: "info" | "warning" | "error", text: string) => void;
	/** 是否在欢迎主页（用于当前会话点击提示：进对话 / 回主页） */
	atHome?: boolean;
}

function sessionTitle(s: { name?: string; firstMessage: string }): string {
	return s.name || s.firstMessage.slice(0, 40) || t("暂无聊天");
}

function RenameBox({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
	const [value, setValue] = useState(initial);
	const ref = useRef<HTMLInputElement>(null);
	useEffect(() => ref.current?.select(), []);
	return (
		<input
			ref={ref}
			className="panel-search rename-input"
			value={value}
			onChange={(e) => setValue(e.target.value)}
			onKeyDown={(e) => {
				if (e.key === "Enter") onDone(value.trim() || null);
				if (e.key === "Escape") onDone(null);
			}}
			onBlur={() => onDone(null)}
		/>
	);
}

/** 新建项目弹窗（顶栏「新建项目」也用它，App.tsx 引用）：起名 ＋ 选形态（扮演 / agent，建项目时定，之后不切换） */
export function NewProjectBox({ initial, busy, onDone }: { initial: string; busy: boolean; onDone: (name: string | null, mode?: "agent", greeting?: number) => void }) {
	const [value, setValue] = useState(initial);
	const [mode, setMode] = useState<"roleplay" | "agent">("roleplay");
	// agent 形态：卡的开场白可选一条落成稿子第一个文件（素材进稿子是用户的动作）；-1＝不落
	const [greetings, setGreetings] = useState<CardResponse["greetings"] | null>(null);
	const [greeting, setGreeting] = useState(-1);
	const ref = useRef<HTMLInputElement>(null);
	useEffect(() => {
		ref.current?.select();
		ref.current?.focus();
	}, []);
	useEffect(() => {
		if (mode !== "agent" || greetings) return;
		let live = true;
		void apiGet<CardResponse>("/api/card").then((r) => { if (live) setGreetings((r.greetings ?? []).filter((g) => (g.text ?? "").trim())); }).catch(() => { if (live) setGreetings([]); });
		return () => { live = false; };
	}, [mode, greetings]);
	const done = (name: string | null) => onDone(name, mode === "agent" ? "agent" : undefined, mode === "agent" && greeting >= 0 ? greeting : undefined);
	return (
		<div
			className="spv2-modal-mask"
			onClick={(e) => {
				if (e.target === e.currentTarget) onDone(null);
			}}
		>
			<div className="spv2-modal">
				<div className="spv2-modal-title">{t("新建项目")}</div>
				<input
					ref={ref}
					className="panel-search spv2-modal-input"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") done(value.trim() || null);
						if (e.key === "Escape") onDone(null);
					}}
				/>
				<div className="spv2-modal-modes" role="radiogroup" aria-label={t("项目形态")}>
					{([["roleplay", t("扮演"), t("你是故事里的人，回复就是正文")], ["agent", "agent", t("正文是稿子里的章，对话是讨论；agent 用工具写入")]] as const).map(([m, label, hint]) => (
						<button key={m} type="button" role="radio" aria-checked={mode === m} className={`spv2-modal-mode ${mode === m ? "on" : ""}`} onClick={() => setMode(m)}>
							<span className="spv2-modal-mode-label">{label}</span>
							<span className="spv2-modal-mode-hint">{hint}</span>
						</button>
					))}
				</div>
				{mode === "agent" && greetings && greetings.length > 0 && (
					<div className="spv2-modal-greetings" role="radiogroup" aria-label={t("开场白")}>
						<div className="spv2-modal-greetings-title">{t("开场白落成稿子的第一个文件（000-开场.md）")}</div>
						{[{ index: -1, label: t("不落，空稿子开始"), text: "" }, ...greetings].map((g) => (
							<button key={g.index} type="button" role="radio" aria-checked={greeting === g.index} className={`spv2-modal-greeting ${greeting === g.index ? "on" : ""}`} onClick={() => setGreeting(g.index)}>
								<span className="spv2-modal-greeting-label">{g.label}</span>
								{g.text && <span className="spv2-modal-greeting-hint">{g.text.replace(/\s+/g, " ").slice(0, 60)}</span>}
							</button>
						))}
					</div>
				)}
				<div className="spv2-modal-row">
					<button type="button" className="drawer-btn" onClick={() => onDone(null)}>
						{t("取消")}
					</button>
					<button type="button" className="drawer-btn spv2-modal-ok" disabled={busy} onClick={() => done(value.trim() || null)}>
						{t("创建")}
					</button>
				</div>
			</div>
		</div>
	);
}

/** 对话行（叶子节点）：纯单行文本截断，绝不混入时间戳挤占空间 */
function Leaf({
	s,
	busy,
	onOpen,
	onRename,
	onDelete,
	currentHint,
	picking = false,
	selected = false,
	onToggleSelect,
}: {
	s: WireSessionInfo;
	busy: boolean;
	onOpen: (path: string) => void;
	onRename: (path: string, name: string) => void;
	onDelete: (path: string) => void;
	currentHint?: string;
	picking?: boolean;
	selected?: boolean;
	onToggleSelect?: (path: string) => void;
}) {
	const [renaming, setRenaming] = useState(false);
	const hint = `${sessionTitle(s)}${s.preview ? `\n${s.preview}` : ""}\n(${timeAgo(s.modified)} · ${t("{n} 条", { n: s.messageCount })})${s.current && currentHint ? `\n${currentHint}` : ""}`;

	return (
		<div className={`spv2-leafrow ${s.current ? "cur" : ""} ${picking && selected ? "picked" : ""}`}>
			{picking && (
				<input
					type="checkbox"
					className="session-pick"
					checked={selected}
					aria-label={t("选择「{name}」", { name: sessionTitle(s) })}
					onChange={() => onToggleSelect?.(s.path)}
				/>
			)}
			{renaming ? (
				<RenameBox
					initial={s.name ?? ""}
					onDone={(name) => {
						setRenaming(false);
						if (name) onRename(s.path, name);
					}}
				/>
			) : (
				<button
					type="button"
					className="spv2-leaf"
					title={picking ? undefined : hint}
					onClick={() => (picking ? onToggleSelect?.(s.path) : onOpen(s.path))}
				>
					<span className="spv2-leaf-title">{sessionTitle(s)}</span>
				</button>
			)}
			{!picking && (
				<span className="spv2-leaf-acts">
					<button
						className="spv2-icon-btn"
						title={t("重命名")}
						aria-label={t("重命名对话")}
						onClick={(e) => {
							e.stopPropagation();
							setRenaming(true);
						}}
					>
						<IconPencil size={14} />
					</button>
					{!s.current && (
						<ConfirmButton
							className="spv2-icon-btn spv2-del-btn"
							disabled={busy}
							title={t("删除对话（不可恢复）")}
							aria-label={t("删除对话")}
							confirmText={t("删除")}
							onConfirm={() => onDelete(s.path)}
						>
							<IconTrash size={14} />
						</ConfirmButton>
					)}
				</span>
			)}
		</div>
	);
}

/** 项目组（父级树节点）：空心文件夹 + 醒目文字 + 右侧悬浮新建/改名 */
function ChatGroup({
	chat,
	list,
	isCurrent,
	busy,
	onOpen,
	onSessionRename,
	onSessionDelete,
	onRename,
	onNewIn,
	onDeleteChat,
	currentHint,
	picking,
	isPicked,
	onToggleSelect,
}: {
	chat: WireChatInfo;
	list: WireSessionInfo[];
	isCurrent: boolean;
	busy: boolean;
	onOpen: (path: string) => void;
	onSessionRename: (path: string, name: string) => void;
	onSessionDelete: (path: string) => void;
	onRename: (chatId: string, name: string) => void;
	onNewIn: (chatId: string) => void;
	onDeleteChat: (chatId: string) => void;
	currentHint?: string;
	picking: boolean;
	isPicked: (path: string) => boolean;
	onToggleSelect: (path: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const visible = isCurrent || expanded ? list : list.slice(0, CHAT_PREVIEW_COUNT);
	const hidden = list.length - visible.length;

	const openLatest = () => {
		if (list[0]) onOpen(list[0].path);
	};

	return (
		<div className={`spv2-chat ${isCurrent ? "on" : ""}`}>
			<div className="spv2-chatrow">
				{renaming ? (
					<RenameBox
						initial={chat.name ?? chatLabel(chat)}
						onDone={(name) => {
							setRenaming(false);
							if (name) onRename(chat.id, name);
						}}
					/>
				) : (
					<button type="button" className="spv2-chatname" onClick={openLatest} disabled={list.length === 0}>
						<IconFolder size={15} />
						<span className="spv2-chatname-text">{chatLabel(chat)}</span>
						{chat.mode === "agent" && <span className="spv2-chat-mode" title={t("agent 模式：正文是稿子里的章")}>agent</span>}
					</button>
				)}
				{!renaming && (
					<span className="spv2-chat-acts">
						<button
							className="spv2-icon-btn"
							type="button"
							title={t("新建对话")}
							aria-label={t("在这个项目里新建对话")}
							onClick={() => onNewIn(chat.id)}
						>
							<IconPlus size={15} />
						</button>
						<button className="spv2-icon-btn" type="button" title={t("重命名项目")} aria-label={t("重命名项目")} onClick={() => setRenaming(true)}>
							<IconPencil size={14} />
						</button>
						<a
							className="spv2-icon-btn"
							href={`/api/chats/export?chatId=${encodeURIComponent(chat.id)}`}
							download
							title={t("导出项目（zip，含全部对话）")}
							aria-label={t("导出项目")}
						>
							<IconDownload size={14} />
						</a>
						{!isCurrent && (
							<ConfirmButton
								disabled={busy}
								className="spv2-icon-btn spv2-del-btn"
								title={t("删除整个项目（含全部对话与世界状态，不可恢复）")}
								aria-label={t("删除项目")}
								confirmText={t("删除")}
								onConfirm={() => onDeleteChat(chat.id)}
							>
								<IconTrash size={14} />
							</ConfirmButton>
						)}
					</span>
				)}
			</div>
			<div className="spv2-kids">
				{list.length === 0 && <div className="spv2-empty">{t("暂无聊天")}</div>}
				{visible.map((s) => (
					<Leaf
						key={s.path}
						s={s}
						busy={busy}
						onOpen={onOpen}
						onRename={onSessionRename}
						onDelete={onSessionDelete}
						currentHint={currentHint}
						picking={picking}
						selected={isPicked(s.path)}
						onToggleSelect={onToggleSelect}
					/>
				))}
				{hidden > 0 && (
					<button type="button" className="spv2-more" onClick={() => setExpanded(true)}>
						{t("展开显示")}
					</button>
				)}
			</div>
		</div>
	);
}

export function SessionsPanel({
	sessions,
	chats = null,
	onOpen,
	onNew,
	onNewInChat,
	onCompact,
	onWorldline,
	onStore,
	onRefresh,
	toast,
	atHome = false,
}: SessionsPanelProps) {
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<SessionSearchHit[] | null>(null);
	const [searching, setSearching] = useState(false);
	const { busy, run } = useAction(toast);
	const [naming, setNaming] = useState(false);

	const [, setTick] = useState(0);
	useEffect(() => {
		const t = setInterval(() => setTick((n) => n + 1), 60_000);
		return () => clearInterval(t);
	}, []);

	const matched = useMemo(() => {
		const q = query.trim().toLowerCase();
		const filter = (s: WireSessionInfo) =>
			!q || (s.name ?? "").toLowerCase().includes(q) || s.firstMessage.toLowerCase().includes(q);
		return (sessions ?? []).filter(filter);
	}, [sessions, query]);

	const others = useMemo(() => {
		const cur = sessions?.find((s) => s.current);
		if (!cur) return matched;
		return matched.filter((s) => s.path !== cur.path && s.id !== cur.id);
	}, [matched, sessions]);

	const grouped = useMemo(() => {
		if (!chats) return null;
		const byChat = new Map<string, WireSessionInfo[]>();
		const rest: WireSessionInfo[] = [];
		for (const s of matched) {
			if (s.chatId && chats.some((c) => c.id === s.chatId)) {
				const arr = byChat.get(s.chatId);
				if (arr) arr.push(s);
				else byChat.set(s.chatId, [s]);
			} else {
				rest.push(s);
			}
		}
		return { groups: chats.map((c) => ({ chat: c, list: byChat.get(c.id) ?? [] })), rest };
	}, [chats, matched]);

	const currentChatId = sessions?.find((s) => s.current)?.chatId;
	const currentHint = atHome ? t("点击进入当前对话") : t("再次点击回到主页");

	const doSearch = async () => {
		const q = query.trim();
		if (!q) {
			setHits(null);
			return;
		}
		setSearching(true);
		try {
			const r = await apiGet<{ hits: SessionSearchHit[] }>(`/api/sessions/search?q=${encodeURIComponent(q)}`);
			setHits(r.hits);
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setSearching(false);
		}
	};

	const rename = (path: string, name: string) =>
		run(async () => {
			await apiPost("/api/sessions/rename", { path, name });
			onRefresh();
		}, t("已重命名"));

	const remove = (path: string) =>
		run(async () => {
			await apiDelete(`/api/sessions?path=${encodeURIComponent(path)}`);
			onRefresh();
		});

	const renameChat = (chatId: string, name: string) =>
		run(async () => {
			await apiPost("/api/chats/rename", { chatId, name });
			onRefresh();
		}, t("已重命名"));

	const removeChat = (chatId: string) =>
		run(async () => {
			await apiDelete(`/api/chats?chatId=${encodeURIComponent(chatId)}`);
			onRefresh();
		}, t("已删除项目"));

	const [picking, setPicking] = useState(false);
	const [picked, setPicked] = useState<string[]>([]);
	useEffect(() => {
		if (!sessions) return;
		setPicked((ps) => {
			const alive = ps.filter((p) => sessions.some((s) => s.path === p && !s.current));
			return alive.length === ps.length ? ps : alive;
		});
	}, [sessions]);

	const togglePick = (path: string) =>
		setPicked((ps) => (ps.includes(path) ? ps.filter((p) => p !== path) : [...ps, path]));

	const allPicked = others.length > 0 && picked.length === others.length;
	const exitPicking = () => {
		setPicking(false);
		setPicked([]);
	};

	const removePicked = () =>
		run(async () => {
			const qs = picked.map((p) => `path=${encodeURIComponent(p)}`).join("&");
			await apiDelete(`/api/sessions?${qs}`);
			exitPicking();
			onRefresh();
		});

	const [importOpen, setImportOpen] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);
	const [importTag, setImportTag] = useState("");
	const [importing, setImporting] = useState(false);
	// 导入项目包（zip）
	const zipRef = useRef<HTMLInputElement>(null);
	const [importingChat, setImportingChat] = useState(false);

	const doImportChat = async (file: File) => {
		setImportingChat(true);
		try {
			const r = await apiPostFile<{ chatId: string; fileCount: number }>("/api/chats/import", file);
			toast("info", t("已导入项目（{n} 个会话文件）", { n: r.fileCount }));
			onRefresh();
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setImportingChat(false);
			if (zipRef.current) zipRef.current.value = "";
		}
	};

	const doImport = async (file: File) => {
		setImporting(true);
		try {
			const content = await file.text();
			await apiPost("/api/import", { content, tag: importTag.trim() });
			toast("info", t("导入完成（前情块已注入会话）"));
			onRefresh();
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setImporting(false);
			if (fileRef.current) fileRef.current.value = "";
		}
	};

	return (
		<div className="panel-body spv2">
			{/* 顶部纯文字+图标动作条（仿 Codex 顶部入口） */}
			<div className="spv2-actions">
				<button type="button" className="spv2-action" onClick={() => (chats ? setNaming(true) : onNew())}>
					<IconPlus size={15} />
					<span>{chats ? t("新建项目") : t("新建会话")}</span>
				</button>
				{onWorldline && (
					<button type="button" className="spv2-action" onClick={onWorldline} title={t("查看世界线时间线")}>
						<IconWorldline size={15} />
						<span>{t("世界线")}</span>
					</button>
				)}
				{onStore && (
					<button type="button" className="spv2-action" onClick={onStore} title={t("在当前剧情点钉存档")}>
						<IconPin size={15} />
						<span>{t("存档")}</span>
					</button>
				)}
				<button type="button" className="spv2-action" onClick={onCompact} title={t("压缩较早对话")}>
					<IconList size={15} />
					<span>{t("压缩上下文")}</span>
				</button>
			</div>

			{/* 搜索栏 */}
			<div className="spv2-search">
				<SearchInput
					value={query}
					onChange={(v) => {
						setQuery(v);
						if (!v.trim()) setHits(null);
					}}
					placeholder={t("搜索...")}
					onEnter={() => void doSearch()}
				/>
			</div>

			{/* 多选工具行 */}
			{picking && (
				<div className="panel-row list-toolbar session-pick-bar">
					<button className="drawer-btn" onClick={() => setPicked(allPicked ? [] : others.map((s) => s.path))}>
						{allPicked ? t("全不选") : t("全选 {n}", { n: others.length })}
					</button>
					<ConfirmButton
						className="drawer-btn preset-del-btn"
						disabled={busy || picked.length === 0}
						confirmText={t("删除 {n} 个", { n: picked.length })}
						title={t("删除所选对话（不可恢复）")}
						onConfirm={removePicked}
					>
						{t("删除所选 {n}", { n: picked.length })}
					</ConfirmButton>
					<button className="drawer-btn" onClick={exitPicking}>
						{t("取消")}
					</button>
				</div>
			)}

			{/* 分组标题栏 */}
			<div className="spv2-label">
				<span>{chats ? t("项目") : t("会话")}</span>
				{!picking && others.length > 0 && (
					<button type="button" className="spv2-label-act" onClick={() => setPicking(true)}>
						{t("多选")}
					</button>
				)}
			</div>

			{searching && <div className="sp-empty">{t("搜索中…")}</div>}

			{/* 搜索命中列表 */}
			{hits !== null && !searching && (
				<div className="spv2-tree">
					<div className="field-hint" style={{ padding: "0 8px 6px" }}>{t("命中 {n} 个对话", { n: hits.length })}</div>
					{hits.map((h) => (
						<button
							key={h.path}
							type="button"
							className={`spv2-hit ${h.current ? "cur" : ""}`}
							title={h.current ? currentHint : undefined}
							onClick={() => onOpen(h.path)}
						>
							<div className="spv2-hit-title">{sessionTitle(h)}</div>
							<div className="spv2-hit-snippet">{h.snippet}</div>
						</button>
					))}
				</div>
			)}

			{/* 主树形列表 */}
			{hits === null && (
				<div className="spv2-tree">
					{sessions === null && <div className="info-line">{t("读取中…")}</div>}
					{sessions !== null && matched.length === 0 && <div className="info-line">{chats ? t("暂无项目") : t("暂无会话")}</div>}
					{grouped
						? grouped.groups.map(({ chat, list }) => (
								<ChatGroup
									key={chat.id}
									chat={chat}
									list={list}
									isCurrent={chat.id === currentChatId}
									busy={busy}
									onOpen={onOpen}
									onSessionRename={rename}
									onSessionDelete={remove}
									onRename={renameChat}
									onNewIn={(id) => onNewInChat?.(id)}
									onDeleteChat={removeChat}
									currentHint={currentHint}
									picking={picking}
									isPicked={(p) => picked.includes(p)}
									onToggleSelect={togglePick}
								/>
							))
						: matched.map((s) => (
								<Leaf
									key={s.path}
									s={s}
									busy={busy}
									onOpen={onOpen}
									onRename={rename}
									onDelete={remove}
									currentHint={currentHint}
									picking={picking}
									selected={picked.includes(s.path)}
									onToggleSelect={togglePick}
								/>
							))}
					{grouped && grouped.rest.length > 0 && (
						<div className="spv2-tree-rest">
							{grouped.rest.map((s) => (
								<Leaf
									key={s.path}
									s={s}
									busy={busy}
									onOpen={onOpen}
									onRename={rename}
									onDelete={remove}
									currentHint={currentHint}
									picking={picking}
									selected={picked.includes(s.path)}
									onToggleSelect={togglePick}
								/>
							))}
						</div>
					)}
				</div>
			)}

			{/* 底部极简导入入口 */}
			<div className="spv2-bottom">
				<input
					ref={zipRef}
					type="file"
					accept=".zip,application/zip"
					hidden
					onChange={(e) => {
						const f = e.target.files?.[0];
						if (f) void doImportChat(f);
					}}
				/>
				<button
					type="button"
					className="spv2-bottom-link"
					disabled={importingChat}
					onClick={() => zipRef.current?.click()}
					title={t("把导出的项目包（zip）导回本卡，落成新项目，不覆盖现有")}
				>
					<IconFolder size={13} />
					<span>{importingChat ? t("导入中…") : t("导入项目")}</span>
				</button>
				<button type="button" className="spv2-bottom-link" onClick={() => setImportOpen((v) => !v)}>
					<IconUploads size={13} />
					<span>{t("导入聊天记录")}</span>
				</button>
				{importOpen && (
					<div className="spv2-import-body">
						<div className="field-hint">
							{t("选择 SillyTavern 导出的 .jsonl 文件，自动提取历史剧情与世界状态。")}
						</div>
						<Field label={t("正文标签名（可选）")}>
							<input
								className="panel-search"
								placeholder="content"
								value={importTag}
								onChange={(e) => setImportTag(e.target.value)}
							/>
						</Field>
						<input
							ref={fileRef}
							type="file"
							accept=".jsonl,.json,application/json"
							hidden
							onChange={(e) => {
								const f = e.target.files?.[0];
								if (f) void doImport(f);
							}}
						/>
						<button className="drawer-btn" disabled={importing} onClick={() => fileRef.current?.click()}>
							{importing ? t("正在导入…") : t("选择文件导入")}
						</button>
					</div>
				)}
			</div>

			{/* 新建项目弹窗 */}
			{naming && chats && (
				<NewProjectBox
					initial={nextProjectName(chats)}
					busy={busy}
					onDone={(name, mode, greeting) => {
						setNaming(false);
						if (name) onNew(name, mode, greeting);
					}}
				/>
			)}
		</div>
	);
}
