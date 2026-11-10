/**
 * 会话面板（左栏两层会话树 + 项目级 .md 资产区，对齐 WorkBuddy 分层骨架与梨园白瓷朱砂风格）：
 *
 * 第一层（外层：项目列表）：
 *   - 顶部「扮演模式 / 写作模式」胶囊切签；
 *   - 纯净项目列表（不再把项目与子会话混排成父子树），支持重命名、导出、删除；
 *   - 点击任意项目即进入该项目的内层空间（非当前项目时同步打开其最新会话）。
 *
 * 第二层（内层：项目空间 = 上半区会话列表 + 下半区项目资产）：
 *   - 顶部项目导航栏：左侧「← 返回项目列表（显示当前项目名）」，右侧「＋ 新建会话」；
 *   - 上半区：当前项目的全部会话列表（跨会话共享同一项目状态与记忆）；
 *   - 下半区：项目资产区（仅列 .md：局部守则 APPEND_SYSTEM.md、记忆索引 记忆/MEMORY.md、前情提要.md 及 记忆/*.md），
 *     点击任意资产在右侧主工作区查看或编辑。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	apiDelete,
	apiGet,
	apiGetCacheClear,
	apiPost,
	apiPostFile,
	apiPut,
	type CardResponse,
	type SessionSearchHit,
} from "../api.ts";
import type { WireChatInfo, WireSessionInfo, WireStats } from "../wire.ts";
import {
	IconBack,
	IconChevronRight,
	IconClose,
	IconDoc,
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
import { renderMarkdown } from "./ArtifactPanel.tsx";
import { fmtDateTime, t } from "../i18n/index.ts";

export interface ChatMarkdownAsset {
	relPath: string;
	name: string;
	category: "rules" | "summary" | "memory" | "file";
	size: number;
	modified: number;
}

export interface ChatAssetTarget {
	chatId: string;
	chatName: string;
	relPath: string;
}

const CHAT_DOCS_MEMORY_DIR = "记忆"; // i18n-ignore：磁盘固定目录名
const CHAT_MEMORY_INDEX_FILE = "MEMORY.md";
const CHAT_SUMMARY_FILE = "前情提要.md"; // i18n-ignore：磁盘固定文件名
const MEMORY_INDEX_REL = `${CHAT_DOCS_MEMORY_DIR}/${CHAT_MEMORY_INDEX_FILE}`;
const MEMORY_DIR_PREFIX = `${CHAT_DOCS_MEMORY_DIR}/`;

const BUILTIN_ASSET_SLOTS: Array<{
	relPath: string;
	category: "rules" | "summary" | "memory";
	title: () => string;
	sub: () => string;
}> = [
	{ relPath: "APPEND_SYSTEM.md", category: "rules", title: () => t("局部守则"), sub: () => t("本项目专属提示词") },
	{ relPath: MEMORY_INDEX_REL, category: "memory", title: () => t("记忆索引"), sub: () => t("常驻上下文目录") },
	{ relPath: CHAT_SUMMARY_FILE, category: "summary", title: () => t("前情提要"), sub: () => t("跨会话剧情摘要") },
];

export function chatAssetTitle(relPath: string): string {
	if (relPath === "APPEND_SYSTEM.md") return t("局部守则");
	if (relPath === MEMORY_INDEX_REL) return t("记忆索引");
	if (relPath === CHAT_SUMMARY_FILE) return t("前情提要");
	if (relPath.startsWith(MEMORY_DIR_PREFIX)) {
		const base = relPath.slice(MEMORY_DIR_PREFIX.length);
		return base.replace(/\.md$/i, "") || base;
	}
	return relPath;
}

function formatAssetSize(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
	if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
	return `${bytes}B`;
}

function chatAssetHint(relPath: string): string {
	if (relPath === "APPEND_SYSTEM.md") {
		return t("项目级局部守则：排在全局与角色卡守则之后，仅对本项目生效；留空则不注入。");
	}
	if (relPath === MEMORY_INDEX_REL) {
		return t("项目级记忆总索引：非空时常驻本项目上下文，每行登记一份记忆文档（如 - [标题](文件名.md) — 一句话说明），供 agent 按需调取。");
	}
	if (relPath === CHAT_SUMMARY_FILE) {
		return t("项目级跨会话前情提要：会话压缩时自动同步更新；在同一项目下新建会话时自动读取本文件接续前情。");
	}
	return t("项目级记忆与设定文档：按需读取，不常驻占用上下文，agent 可通过记忆工具读写本文件。");
}

function isBuiltinAssetSlot(relPath: string): boolean {
	return BUILTIN_ASSET_SLOTS.some((s) => s.relPath === relPath);
}

/** 右侧主工作区的项目 .md 资产查看/编辑器（默认 Markdown 渲染视图，右上角点击「修改」进入源码编辑） */
export function ChatAssetCenter({
	asset,
	onClose,
	onChanged,
	onSelectAsset,
	toast,
}: {
	asset: ChatAssetTarget;
	onClose: () => void;
	onChanged?: () => void;
	onSelectAsset?: (relPath: string) => void;
	toast: (level: "info" | "warning" | "error", text: string) => void;
}) {
	const [text, setText] = useState("");
	const [draft, setDraft] = useState("");
	const [editing, setEditing] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const [truncated, setTruncated] = useState(false);
	const [dirty, setDirty] = useState(false);
	const { busy, run } = useAction(toast);

	useEffect(() => {
		let cancelled = false;
		setLoaded(false);
		setTruncated(false);
		setDirty(false);
		setEditing(false);
		apiGetCacheClear("/api/chats/asset");
		void apiGet<{ ok: boolean; content: string; truncated?: boolean }>(
			`/api/chats/asset?chatId=${encodeURIComponent(asset.chatId)}&path=${encodeURIComponent(asset.relPath)}`,
		)
			.then((r) => {
				if (cancelled) return;
				const content = r.content ?? "";
				setText(content);
				setDraft(content);
				setTruncated(r.truncated === true);
				setLoaded(true);
			})
			.catch((err) => {
				if (cancelled) return;
				toast("error", err instanceof Error ? err.message : String(err));
			});
		return () => {
			cancelled = true;
		};
	}, [asset.chatId, asset.relPath]);

	const startEdit = () => {
		setDraft(text);
		setDirty(false);
		setEditing(true);
	};

	const cancelEdit = () => {
		setDraft(text);
		setDirty(false);
		setEditing(false);
	};

	const save = useCallback(
		() =>
			run(async () => {
				await apiPut("/api/chats/asset", {
					chatId: asset.chatId,
					path: asset.relPath,
					content: draft,
				});
				setText(draft);
				setDirty(false);
				setEditing(false);
				onChanged?.();
			}, t("已保存")),
		[asset.chatId, asset.relPath, draft, run, onChanged],
	);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (editing && !dirty) {
					setEditing(false);
				} else if (!editing) {
					onClose();
				}
			} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
				if (editing && loaded && !busy) {
					e.preventDefault();
					save();
				}
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose, save, editing, loaded, dirty, busy]);

	const removeDoc = () =>
		run(async () => {
			await apiDelete(
				`/api/chats/asset?chatId=${encodeURIComponent(asset.chatId)}&path=${encodeURIComponent(asset.relPath)}`,
			);
			onChanged?.();
			if (isBuiltinAssetSlot(asset.relPath)) {
				setText("");
				setDraft("");
				setDirty(false);
				setEditing(false);
			} else {
				onClose();
			}
		}, isBuiltinAssetSlot(asset.relPath) ? t("已清空") : t("已删除文档"));

	const handleLinkClick = useCallback(
		(href: string) => {
			const clean = href.trim().replace(/^\.\//, "");
			if (!clean.toLowerCase().endsWith(".md") || /^https?:\/\//i.test(clean)) return;
			const targetRel =
				clean === "APPEND_SYSTEM.md" || clean === CHAT_SUMMARY_FILE || clean.startsWith(MEMORY_DIR_PREFIX)
					? clean
					: `${MEMORY_DIR_PREFIX}${clean}`;
			onSelectAsset?.(targetRel);
		},
		[onSelectAsset],
	);

	const builtin = isBuiltinAssetSlot(asset.relPath);
	const title = chatAssetTitle(asset.relPath);
	const charCount = editing ? draft.length : text.length;

	return (
		<div className="lore-center-overlay chat-asset-center" role="dialog" aria-modal="true" aria-label={title}>
			<div className="lore-center-card">
				<div className="lore-center-head">
					<div className="lore-center-title-group">
						<div className="lore-center-title-texts">
							<span className="lore-center-book-tag">
								{asset.chatName} · {asset.relPath}
							</span>
							<h3 className="lore-center-title">{title}</h3>
						</div>
						<span className="lore-center-chars-tag">{t("{n}字", { n: charCount })}</span>
					</div>
					<div className="lore-center-actions">
						{editing ? (
							<>
								<button type="button" className="drawer-btn" disabled={busy} onClick={cancelEdit}>
									{t("取消")}
								</button>
								<button
									type="button"
									className="drawer-btn save-btn"
									disabled={busy || !loaded}
									onClick={save}
								>
									{dirty ? t("保存 *") : t("保存")}
								</button>
							</>
						) : (
							<>
								{(!builtin || text.trim().length > 0) && (
									<ConfirmButton
										className="drawer-btn preset-del-btn"
										disabled={busy || !loaded}
										confirmText={builtin ? t("确认清空") : t("删除")}
										title={builtin ? t("清空此文件内容") : t("删除此记忆文档（不可恢复）")}
										onConfirm={removeDoc}
									>
										{builtin ? t("清空") : t("删除")}
									</ConfirmButton>
								)}
								{!truncated && (
									<button
										type="button"
										className="drawer-btn save-btn chat-asset-edit-btn"
										disabled={busy || !loaded}
										onClick={startEdit}
									>
										<IconPencil size={13} />
										<span>{t("修改")}</span>
									</button>
								)}
							</>
						)}
						<button
							type="button"
							className="icon-btn lore-center-close"
							onClick={onClose}
							title={t("关闭（Esc）")}
							aria-label={t("关闭")}
						>
							<IconClose size={18} />
						</button>
					</div>
				</div>

				<div className="lore-center-body">
					<div className="lore-center-editor chat-asset-body">
						<div className="field-hint chat-asset-hint">{chatAssetHint(asset.relPath)}</div>
						{editing ? (
							<textarea
								className="panel-search lore-center-textarea"
								rows={22}
								spellCheck={false}
								autoFocus
								placeholder={t("在此输入 Markdown 内容…")}
								value={draft}
								disabled={busy || !loaded}
								onChange={(e) => {
									setDraft(e.target.value);
									setDirty(true);
								}}
							/>
						) : !loaded ? (
							<div className="chat-asset-empty">{t("读取中…")}</div>
						) : text.trim().length > 0 ? (
							<article className="chat-asset-readme artifact-md">
								{asset.relPath.toLowerCase().endsWith(".md") ? (
										renderMarkdown(text, handleLinkClick)
									) : (
										<pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "var(--mono)" }}>{text}</pre>
									)}
							</article>
						) : (
							<div className="chat-asset-empty">{t("暂无内容")}</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

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
	return t("{month}月{day}日 {time}", {
		month: d.getMonth() + 1,
		day: d.getDate(),
		time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
	});
}

/** 新建项目弹窗的默认名：已有「新建项目（N）」或旧「新建对话（N）」取最大 N＋1，否则从（1）起 */
export function nextProjectName(chats: WireChatInfo[]): string {
	let max = 0;
	for (const tmpl of [t("新建项目（{n}）", { n: "\u0000" }), t("新建对话（{n}）", { n: "\u0000" })]) {
		const re = new RegExp(
			`^${tmpl
				.split("\u0000")
				.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
				.join("(\\d+)")}$`,
		);
		for (const c of chats) {
			const m = re.exec(c.name ?? "");
			if (m) max = Math.max(max, Number(m[1]));
		}
	}
	return t("新建项目（{n}）", { n: max + 1 });
}

export interface SessionsPanelProps {
	sessions: WireSessionInfo[] | null;
	/** 两层布局的子项目清单（null＝老布局/未下发 ⇒ 扁平列表） */
	chats?: WireChatInfo[] | null;
	stats: WireStats | null;
	onOpen: (path: string) => void;
	/** 新建：两层布局经弹窗起名后带 name（新建项目）与形态（缺省扮演 / agent）；老布局无参直接建会话 */
	onNew: (name?: string, mode?: "agent", greeting?: number) => void;
	/** 在指定子项目里再开一个会话 */
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
	/** 嵌在左栏下半区常驻展示 */
	compactSidebar?: boolean;
	/** 当前在右侧主工作区打开的项目 .md 资产 */
	activeAsset?: ChatAssetTarget | null;
	/** 点击项目 .md 资产在右侧主工作区查看/编辑（传 null 关闭） */
	onOpenAsset?: (asset: ChatAssetTarget | null) => void;
	/** 外部触发资产列表刷新计数 */
	assetTick?: number;
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
export function NewProjectBox({
	initial,
	defaultMode = "roleplay",
	busy,
	onDone,
}: {
	initial: string;
	defaultMode?: "roleplay" | "agent";
	busy: boolean;
	onDone: (name: string | null, mode?: "agent", greeting?: number) => void;
}) {
	const [value, setValue] = useState(initial);
	const [mode, setMode] = useState<"roleplay" | "agent">(defaultMode);
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
		void apiGet<CardResponse>("/api/card")
			.then((r) => {
				if (live) setGreetings((r.greetings ?? []).filter((g) => (g.text ?? "").trim()));
			})
			.catch(() => {
				if (live) setGreetings([]);
			});
		return () => {
			live = false;
		};
	}, [mode, greetings]);
	const done = (name: string | null) =>
		onDone(name, mode === "agent" ? "agent" : undefined, mode === "agent" && greeting >= 0 ? greeting : undefined);
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
					{(
						[
							["roleplay", t("扮演模式"), t("你是故事里的人，回复就是正文")],
							["agent", t("写作模式"), t("正文是独立文件，对话是讨论；agent 用工具写入")],
						] as const
					).map(([m, label, hint]) => (
						<button
							key={m}
							type="button"
							role="radio"
							aria-checked={mode === m}
							className={`spv2-modal-mode ${mode === m ? "on" : ""}`}
							onClick={() => setMode(m)}
						>
							<span className="spv2-modal-mode-label">{label}</span>
							<span className="spv2-modal-mode-hint">{hint}</span>
						</button>
					))}
				</div>
				{mode === "agent" && greetings && greetings.length > 0 && (
					<div className="spv2-modal-greetings" role="radiogroup" aria-label={t("开场白")}>
						<div className="spv2-modal-greetings-title">{t("开场白落成正文的第一个文件（000-开场.md）")}</div>
						{[{ index: -1, label: t("不落，从空白正文开始"), text: "" }, ...greetings].map((g) => (
							<button
								key={g.index}
								type="button"
								role="radio"
								aria-checked={greeting === g.index}
								className={`spv2-modal-greeting ${greeting === g.index ? "on" : ""}`}
								onClick={() => setGreeting(g.index)}
							>
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
					<button
						type="button"
						className="drawer-btn spv2-modal-ok"
						disabled={busy}
						onClick={() => done(value.trim() || null)}
					>
						{t("创建")}
					</button>
				</div>
			</div>
		</div>
	);
}

/** 对话行（叶子节点）：左侧标题 + 右侧时间与条数（悬停切换为重命名/删除） */
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
					{!picking && (
						<span className="spv2-leaf-meta">
							{s.modified > 0 && <span className="spv2-leaf-time">{timeAgo(s.modified)}</span>}
							<span className="spv2-leaf-count">{t("{n} 条", { n: s.messageCount })}</span>
						</span>
					)}
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

/** 第一层（外层）项目卡片行：双行高信息密度展示（顶行：项目名 + 上次活跃时间；底行：最新对话摘要/首句 + 消息与会话数） */
function ProjectRow({
	chat,
	sessions,
	isCurrent,
	busy,
	onEnter,
	onRename,
	onDeleteChat,
}: {
	chat: WireChatInfo;
	sessions: WireSessionInfo[];
	isCurrent: boolean;
	busy: boolean;
	onEnter: () => void;
	onRename: (chatId: string, name: string) => void;
	onDeleteChat: (chatId: string) => void;
}) {
	const [renaming, setRenaming] = useState(false);

	const sessionCount = sessions.length;
	const totalMessages = useMemo(
		() => sessions.reduce((acc, s) => acc + (s.messageCount || 0), 0),
		[sessions],
	);
	const lastModified = useMemo(() => {
		let max = chat.modified || 0;
		for (const s of sessions) {
			if (s.modified > max) max = s.modified;
		}
		if (max === 0 && chat.createdAt) {
			const ts = Date.parse(chat.createdAt);
			if (!Number.isNaN(ts)) max = ts;
		}
		return max;
	}, [chat.modified, chat.createdAt, sessions]);

	const snippet = useMemo(() => {
		for (const s of sessions) {
			const text = (s.preview || s.firstMessage || "").replace(/\s+/g, " ").trim();
			if (text) return text;
		}
		return "";
	}, [sessions]);

	const timeLabel = lastModified > 0 ? timeAgo(lastModified) : "";

	return (
		<div className={`spv2-chat spv2-proj-item ${isCurrent ? "on" : ""}`}>
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
					<button
						type="button"
						className="spv2-chatname spv2-proj-btn"
						onClick={onEnter}
						title={`${chatLabel(chat)}${timeLabel ? ` · ${timeLabel}` : ""}\n${snippet || t("暂无聊天")}\n(${t("{n} 个会话", { n: sessionCount })} · ${t("{n} 条", { n: totalMessages })})`}
					>
						<div className="spv2-proj-top">
							<IconFolder size={14} className="spv2-proj-ico" />
							<span className="spv2-chatname-text">{chatLabel(chat)}</span>
							{timeLabel && <span className="spv2-proj-time">{timeLabel}</span>}
							<IconChevronRight size={13} className="spv2-proj-arrow" />
						</div>
						<div className="spv2-proj-sub">
							<span className={`spv2-proj-snippet ${snippet ? "" : "empty"}`}>
								{snippet || t("暂无聊天")}
							</span>
							<span className="spv2-proj-badges">
								{sessionCount > 1 && (
									<span className="spv2-proj-count" title={t("{n} 个会话", { n: sessionCount })}>
										{t("{n} 个会话", { n: sessionCount })}
									</span>
								)}
								<span className="spv2-proj-count">{t("{n} 条", { n: totalMessages })}</span>
							</span>
						</div>
					</button>
				)}
				{!renaming && (
					<span className="spv2-chat-acts">
						<button
							className="spv2-icon-btn"
							type="button"
							title={t("重命名项目")}
							aria-label={t("重命名项目")}
							onClick={(e) => {
								e.stopPropagation();
								setRenaming(true);
							}}
						>
							<IconPencil size={14} />
						</button>
						<a
							className="spv2-icon-btn"
							href={`/api/chats/export?chatId=${encodeURIComponent(chat.id)}`}
							download
							title={t("导出项目（zip，含全部对话）")}
							aria-label={t("导出项目")}
							onClick={(e) => e.stopPropagation()}
						>
							<IconDownload size={14} />
						</a>
						<ConfirmButton
							disabled={busy}
							className="spv2-icon-btn spv2-del-btn"
							title={
								isCurrent
									? t("删除当前项目（自动切至其它项目，不可恢复）")
									: t("删除整个项目（含全部对话与世界状态，不可恢复）")
							}
							aria-label={t("删除项目")}
							confirmText={t("删除")}
							onConfirm={() => onDeleteChat(chat.id)}
						>
							<IconTrash size={14} />
						</ConfirmButton>
					</span>
				)}
			</div>
		</div>
	);
}

export function SessionsPanel({
	sessions,
	chats = null,
	stats,
	onOpen,
	onNew,
	onNewInChat,
	onCompact,
	onWorldline,
	onStore,
	onRefresh,
	toast,
	atHome = false,
	compactSidebar = false,
	activeAsset = null,
	onOpenAsset,
	assetTick = 0,
}: SessionsPanelProps) {
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<SessionSearchHit[] | null>(null);
	const [searching, setSearching] = useState(false);
	const { busy, run } = useAction(toast);
	const [naming, setNaming] = useState(false);

	// 第二层（内层）当前点入的项目 ID；null 表示在第一层（外层项目列表）
	const [enteredChatId, setEnteredChatId] = useState<string | null>(null);
	const [renamingEntered, setRenamingEntered] = useState(false);

	// 项目级 .md 资产列表
	const [assets, setAssets] = useState<ChatMarkdownAsset[]>([]);
	const [creatingDoc, setCreatingDoc] = useState(false);
	const [newDocName, setNewDocName] = useState("");
	const newDocInputRef = useRef<HTMLInputElement>(null);

	const [, setTick] = useState(0);
	useEffect(() => {
		const timer = setInterval(() => setTick((n) => n + 1), 60_000);
		return () => clearInterval(timer);
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

	const currentChat = useMemo(() => {
		const curSession = sessions?.find((s) => s.current);
		if (!curSession?.chatId || !chats) return null;
		return chats.find((c) => c.id === curSession.chatId) ?? null;
	}, [sessions, chats]);

	const [filterMode, setFilterMode] = useState<"roleplay" | "agent">(() =>
		currentChat?.mode === "agent" ? "agent" : "roleplay",
	);

	const prevChatIdRef = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (currentChat && currentChat.id !== prevChatIdRef.current) {
			prevChatIdRef.current = currentChat.id;
			setFilterMode(currentChat.mode === "agent" ? "agent" : "roleplay");
		}
	}, [currentChat]);

	// 如果已点入的项目被删除或换卡后不存在，退回第一层项目列表
	useEffect(() => {
		if (enteredChatId && chats && !chats.some((c) => c.id === enteredChatId)) {
			setEnteredChatId(null);
			setRenamingEntered(false);
		}
	}, [enteredChatId, chats]);

	const enteredChat = useMemo(
		() => (enteredChatId && chats ? chats.find((c) => c.id === enteredChatId) ?? null : null),
		[enteredChatId, chats],
	);

	// 拉取当前进入项目的 .md 资产清单（当进入项目、会话/状态更新或外部 assetTick 变化时自动刷新）
	const loadAssets = useCallback((chatId: string) => {
		apiGetCacheClear("/api/chats/assets");
		void apiGet<{ ok: boolean; assets: ChatMarkdownAsset[] }>(
			`/api/chats/assets?chatId=${encodeURIComponent(chatId)}`,
		)
			.then((r) => {
				setAssets(r.assets ?? []);
			})
			.catch(() => {
				setAssets([]);
			});
	}, []);

	useEffect(() => {
		if (!enteredChat) {
			setAssets([]);
			setCreatingDoc(false);
			setNewDocName("");
			return;
		}
		loadAssets(enteredChat.id);
	}, [enteredChat?.id, sessions, stats?.totalTokens, assetTick, loadAssets]);

	useEffect(() => {
		if (creatingDoc) {
			newDocInputRef.current?.focus();
		}
	}, [creatingDoc]);

	const roleplayChats = useMemo(() => (chats ?? []).filter((c) => c.mode !== "agent"), [chats]);
	const agentChats = useMemo(() => (chats ?? []).filter((c) => c.mode === "agent"), [chats]);
	const activeChats = filterMode === "agent" ? agentChats : roleplayChats;

	const chatsSig = useMemo(() => (chats ?? []).map((c) => c.id).join(","), [chats]);
	const prevChatsSigRef = useRef(chatsSig);
	useEffect(() => {
		if (chatsSig === prevChatsSigRef.current) return;
		prevChatsSigRef.current = chatsSig;
		if (!currentChat) {
			if (filterMode === "roleplay" && roleplayChats.length === 0 && agentChats.length > 0) {
				setFilterMode("agent");
			} else if (filterMode === "agent" && agentChats.length === 0 && roleplayChats.length > 0) {
				setFilterMode("roleplay");
			}
		}
	}, [chatsSig, currentChat, filterMode, roleplayChats.length, agentChats.length]);

	const grouped = useMemo(() => {
		if (!chats) return null;
		const byChat = new Map<string, WireSessionInfo[]>();
		const rest: WireSessionInfo[] = [];
		for (const s of matched) {
			if (s.chatId) {
				const arr = byChat.get(s.chatId);
				if (arr) arr.push(s);
				else byChat.set(s.chatId, [s]);
			} else if (filterMode === "roleplay") {
				rest.push(s);
			}
		}
		return {
			byChat,
			groups: activeChats.map((c) => ({ chat: c, list: byChat.get(c.id) ?? [] })),
			rest,
		};
	}, [chats, matched, activeChats, filterMode]);

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
			if (activeAsset?.chatId === chatId) onOpenAsset?.(null);
			onRefresh();
		}, t("已删除项目"));

	const enterProject = (chat: WireChatInfo, list: WireSessionInfo[]) => {
		setEnteredChatId(chat.id);
		setRenamingEntered(false);
		if (chat.id !== currentChatId) {
			onOpenAsset?.(null);
			if (list[0]) onOpen(list[0].path);
			else onNewInChat?.(chat.id);
		}
	};

	const handleOpenSession = (path: string) => {
		onOpenAsset?.(null);
		onOpen(path);
	};

	const handleToggleAsset = (chat: WireChatInfo, relPath: string) => {
		if (!onOpenAsset) return;
		if (activeAsset && activeAsset.chatId === chat.id && activeAsset.relPath === relPath) {
			onOpenAsset(null);
		} else {
			onOpenAsset({ chatId: chat.id, chatName: chatLabel(chat), relPath });
		}
	};

	const handleCreateDoc = (chat: WireChatInfo) => {
		const raw = newDocName.trim().replace(/[\\/:"*?<>|]/g, "");
		setCreatingDoc(false);
		setNewDocName("");
		if (!raw) return;
		const fileName = raw.toLowerCase().endsWith(".md") ? raw : `${raw}.md`;
		const relPath = `${MEMORY_DIR_PREFIX}${fileName}`;
		void run(async () => {
			if (!assets.some((a) => a.relPath === relPath)) {
				await apiPut("/api/chats/asset", { chatId: chat.id, path: relPath, content: `# ${fileName.replace(/\.md$/i, "")}\n\n` });
				loadAssets(chat.id);
			}
			onOpenAsset?.({ chatId: chat.id, chatName: chatLabel(chat), relPath });
		});
	};

	const handleDeleteAssetDoc = (chat: WireChatInfo, relPath: string) =>
		run(async () => {
			await apiDelete(`/api/chats/asset?chatId=${encodeURIComponent(chat.id)}&path=${encodeURIComponent(relPath)}`);
			if (activeAsset?.chatId === chat.id && activeAsset?.relPath === relPath) {
				onOpenAsset?.(null);
			}
			loadAssets(chat.id);
		}, t("已删除文档"));

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

	// 当前进入项目的动态记忆文档（除三个内置槽位外的全部 .md）
	const customAssets = useMemo(
		() => assets.filter((a) => !isBuiltinAssetSlot(a.relPath)),
		[assets],
	);

	// 渲染第二层（内层）：项目内部空间（上：会话列表 + 下：项目 .md 资产区）
	const renderEnteredProjectView = (chat: WireChatInfo) => {
		const list = grouped?.byChat.get(chat.id) ?? [];
		return (
			<div className="spv2-proj-inside">
				{/* 顶部项目导航栏：返回项目列表 + 新建会话 */}
				<div className="spv2-proj-nav">
					{renamingEntered ? (
						<RenameBox
							initial={chat.name ?? chatLabel(chat)}
							onDone={(name) => {
								setRenamingEntered(false);
								if (name) renameChat(chat.id, name);
							}}
						/>
					) : (
						<>
							<button
								type="button"
								className="spv2-proj-back"
								onClick={() => setEnteredChatId(null)}
								title={t("返回项目列表")}
							>
								<IconBack size={14} />
								<span className="spv2-proj-back-name">{chatLabel(chat)}</span>
							</button>
							<div className="spv2-proj-nav-acts">
								<button
									type="button"
									className="spv2-icon-btn"
									title={t("重命名项目")}
									aria-label={t("重命名项目")}
									onClick={() => setRenamingEntered(true)}
								>
									<IconPencil size={13} />
								</button>
								<button
									type="button"
									className="spv2-proj-new-btn"
									title={t("在这个项目里新建对话")}
									onClick={() => {
										onOpenAsset?.(null);
										onNewInChat?.(chat.id);
									}}
								>
									<IconPlus size={13} />
									<span>{t("新建会话")}</span>
								</button>
							</div>
						</>
					)}
				</div>

				{/* 上半区：当前项目的会话列表 */}
				<div className="spv2-proj-sec spv2-proj-sessions">
					<div className="spv2-sec-head">
						<span className="spv2-sec-title">{t("会话列表")}</span>
						<span className="spv2-sec-count">{list.length}</span>
					</div>
					<div className="spv2-proj-session-list">
						{list.length === 0 && <div className="info-line">{t("暂无聊天")}</div>}
						{list.map((s) => (
							<Leaf
								key={s.path}
								s={s}
								busy={busy}
								onOpen={handleOpenSession}
								onRename={rename}
								onDelete={remove}
								currentHint={currentHint}
							/>
						))}
					</div>
				</div>

				{/* 下半区：项目资产区（仅列 .md） */}
				<div className="spv2-proj-sec spv2-proj-assets">
					<div className="spv2-sec-head">
						<span className="spv2-sec-title">{t("项目资产")}</span>
						<button
							type="button"
							className="spv2-sec-add"
							onClick={() => setCreatingDoc((v) => !v)}
							title={t("在项目记忆目录下新建 Markdown 文档")}
						>
							<IconPlus size={12} />
							<span>{t("新建文档")}</span>
						</button>
					</div>

					{creatingDoc && (
						<div className="spv2-asset-create">
							<input
								ref={newDocInputRef}
								className="panel-search rename-input"
								placeholder={t("输入文档名（如：人物小传）…")}
								value={newDocName}
								onChange={(e) => setNewDocName(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleCreateDoc(chat);
									if (e.key === "Escape") {
										setCreatingDoc(false);
										setNewDocName("");
									}
								}}
								onBlur={() => {
									if (newDocName.trim()) handleCreateDoc(chat);
									else setCreatingDoc(false);
								}}
							/>
						</div>
					)}

					<div className="spv2-asset-list">
						{BUILTIN_ASSET_SLOTS.map((slot) => {
							const found = assets.find((a) => a.relPath === slot.relPath);
							const hasContent = Boolean(found && found.size > 0);
							const isActive = activeAsset?.chatId === chat.id && activeAsset?.relPath === slot.relPath;
							return (
								<div key={slot.relPath} className={`spv2-asset-row ${isActive ? "cur" : ""}`}>
									<button
										type="button"
										className="spv2-asset-btn"
										onClick={() => handleToggleAsset(chat, slot.relPath)}
										title={`${slot.title()}（${slot.relPath}）\n${slot.sub()}`}
									>
										<IconDoc size={14} />
										<span className="spv2-asset-name">{slot.title()}</span>
										<span className={`spv2-asset-meta ${hasContent ? "filled" : ""}`}>
											{hasContent ? t("已配置") : t("未填写")}
										</span>
									</button>
								</div>
							);
						})}

						{customAssets.map((doc) => {
							const isActive = activeAsset?.chatId === chat.id && activeAsset?.relPath === doc.relPath;
							const label = chatAssetTitle(doc.relPath);
							return (
								<div key={doc.relPath} className={`spv2-asset-row ${isActive ? "cur" : ""}`}>
									<button
										type="button"
										className="spv2-asset-btn"
										onClick={() => handleToggleAsset(chat, doc.relPath)}
										title={`${doc.relPath}\n(${timeAgo(doc.modified)})`}
									>
										<IconDoc size={14} />
										<span className="spv2-asset-name">{label}</span>
										<span className="spv2-asset-meta">{formatAssetSize(doc.size)}</span>
									</button>
									<span className="spv2-leaf-acts">
										<ConfirmButton
											className="spv2-icon-btn spv2-del-btn"
											disabled={busy}
											title={t("删除此记忆文档（不可恢复）")}
											aria-label={t("删除文档")}
											confirmText={t("删除")}
											onConfirm={() => handleDeleteAssetDoc(chat, doc.relPath)}
										>
											<IconTrash size={13} />
										</ConfirmButton>
									</span>
								</div>
							);
						})}
					</div>
				</div>
			</div>
		);
	};

	if (compactSidebar) {
		return (
			<div className="panel-body spv2 spv2-compact">
				{enteredChat ? (
					renderEnteredProjectView(enteredChat)
				) : (
					<>
						<button
							type="button"
							className="spv2-top-new-btn"
							disabled={busy}
							onClick={() => {
								onOpenAsset?.(null);
								if (chats) setNaming(true);
								else onNew();
							}}
						>
							<IconPlus size={15} />
							<span>{chats ? t("新建项目") : t("新建会话")}</span>
						</button>
						{chats && (
							<div className="spv2-mode-tabs" role="tablist">
								<button
									type="button"
									role="tab"
									aria-selected={filterMode === "roleplay"}
									className={`spv2-mode-tab ${filterMode === "roleplay" ? "active" : ""}`}
									onClick={() => setFilterMode("roleplay")}
								>
									<span>{t("扮演模式")}</span>
									<span className="spv2-mode-count">{roleplayChats.length}</span>
								</button>
								<button
									type="button"
									role="tab"
									aria-selected={filterMode === "agent"}
									className={`spv2-mode-tab ${filterMode === "agent" ? "active" : ""}`}
									onClick={() => setFilterMode("agent")}
								>
									<span>{t("写作模式")}</span>
									<span className="spv2-mode-count">{agentChats.length}</span>
								</button>
							</div>
						)}
						<div className="spv2-tree">
							{sessions === null && <div className="info-line">{t("读取中…")}</div>}
							{sessions !== null &&
								(grouped ? grouped.groups.length === 0 && grouped.rest.length === 0 : matched.length === 0) && (
									<div className="info-line">{chats ? t("暂无项目") : t("暂无会话")}</div>
								)}
							{grouped
								? grouped.groups.map(({ chat, list }) => (
										<ProjectRow
											key={chat.id}
											chat={chat}
											sessions={list}
											isCurrent={chat.id === currentChatId}
											busy={busy}
											onEnter={() => enterProject(chat, list)}
											onRename={renameChat}
											onDeleteChat={removeChat}
										/>
									))
								: matched.map((s) => (
										<Leaf
											key={s.path}
											s={s}
											busy={busy}
											onOpen={handleOpenSession}
											onRename={rename}
											onDelete={remove}
											currentHint={currentHint}
										/>
									))}
							{grouped && grouped.rest.length > 0 && (
								<div className="spv2-tree-rest">
									{grouped.rest.map((s) => (
										<Leaf
											key={s.path}
											s={s}
											busy={busy}
											onOpen={handleOpenSession}
											onRename={rename}
											onDelete={remove}
											currentHint={currentHint}
										/>
									))}
								</div>
							)}
						</div>
					</>
				)}
				{naming && chats && (
					<NewProjectBox
						initial={nextProjectName(chats)}
						defaultMode={filterMode}
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

	return (
		<div className="panel-body spv2">
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

			{enteredChat ? (
				renderEnteredProjectView(enteredChat)
			) : (
				<>
					{chats && (
						<div className="spv2-mode-tabs" role="tablist">
							<button
								type="button"
								role="tab"
								aria-selected={filterMode === "roleplay"}
								className={`spv2-mode-tab ${filterMode === "roleplay" ? "active" : ""}`}
								onClick={() => setFilterMode("roleplay")}
							>
								<span>{t("扮演模式")}</span>
								<span className="spv2-mode-count">{roleplayChats.length}</span>
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={filterMode === "agent"}
								className={`spv2-mode-tab ${filterMode === "agent" ? "active" : ""}`}
								onClick={() => setFilterMode("agent")}
							>
								<span>{t("写作模式")}</span>
								<span className="spv2-mode-count">{agentChats.length}</span>
							</button>
						</div>
					)}

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

					<div className="spv2-label">
						<span>{chats ? t("项目") : t("会话")}</span>
						{!picking && !chats && others.length > 0 && (
							<button type="button" className="spv2-label-act" onClick={() => setPicking(true)}>
								{t("多选")}
							</button>
						)}
					</div>

					{searching && <div className="sp-empty">{t("搜索中…")}</div>}

					{hits !== null && !searching && (
						<div className="spv2-tree">
							<div className="field-hint" style={{ padding: "0 8px 6px" }}>
								{t("命中 {n} 个对话", { n: hits.length })}
							</div>
							{hits.map((h) => (
								<button
									key={h.path}
									type="button"
									className={`spv2-hit ${h.current ? "cur" : ""}`}
									title={h.current ? currentHint : undefined}
									onClick={() => handleOpenSession(h.path)}
								>
									<div className="spv2-hit-title">{sessionTitle(h)}</div>
									<div className="spv2-hit-snippet">{h.snippet}</div>
								</button>
							))}
						</div>
					)}

					{hits === null && (
						<div className="spv2-tree">
							{sessions === null && <div className="info-line">{t("读取中…")}</div>}
							{sessions !== null && matched.length === 0 && (
								<div className="info-line">{chats ? t("暂无项目") : t("暂无会话")}</div>
							)}
							{grouped
								? grouped.groups.map(({ chat, list }) => (
										<ProjectRow
											key={chat.id}
											chat={chat}
											sessions={list}
											isCurrent={chat.id === currentChatId}
											busy={busy}
											onEnter={() => enterProject(chat, list)}
											onRename={renameChat}
											onDeleteChat={removeChat}
										/>
									))
								: matched.map((s) => (
										<Leaf
											key={s.path}
											s={s}
											busy={busy}
											onOpen={handleOpenSession}
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
											onOpen={handleOpenSession}
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
				</>
			)}

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

			{naming && chats && (
				<NewProjectBox
					initial={nextProjectName(chats)}
					defaultMode={filterMode}
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
