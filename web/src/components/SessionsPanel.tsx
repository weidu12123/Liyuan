/**
 * 会话面板（左栏，PLAN-PANELS §2.1）：
 * 「当前会话」卡（改名/上下文占用/压缩）＋会话列表（末条预览、重命名/导出/删除）
 * ＋全文搜索（回车搜会话内容，借鉴 ST）＋ST 聊天记录导入（从设置面板迁入）。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { apiDelete, apiGet, apiPost, type SessionSearchHit } from "../api.ts";
import type { WireSessionInfo, WireStats } from "../wire.ts";
import { IconDownload, IconPencil, IconTrash } from "./icons.tsx";
import { ConfirmButton, Field, SearchInput, useAction } from "./kit.tsx";

function timeAgo(ms: number): string {
	const diff = Date.now() - ms;
	if (diff < 90_000) return "刚刚";
	if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
	if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`;
	if (diff < 30 * 86_400_000) return `${Math.round(diff / 86_400_000)} 天前`;
	return new Date(ms).toLocaleDateString();
}

export interface SessionsPanelProps {
	sessions: WireSessionInfo[] | null;
	stats: WireStats | null;
	onOpen: (path: string) => void;
	onNew: () => void;
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

const exportUrl = (path: string) => `/api/sessions/export?path=${encodeURIComponent(path)}`;

function sessionTitle(s: { name?: string; firstMessage: string }): string {
	return s.name || s.firstMessage.slice(0, 40) || "（空会话）";
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

function Item({
	s,
	busy,
	onOpen,
	onRename,
	onDelete,
	/** 当前会话再点：回主页 / 进对话，由父组件决定 */
	currentHint,
}: {
	s: WireSessionInfo;
	busy: boolean;
	onOpen: (path: string) => void;
	onRename: (path: string, name: string) => void;
	onDelete: (path: string) => void;
	currentHint?: string;
}) {
	const [renaming, setRenaming] = useState(false);
	return (
		<div className={`session-row ${s.current ? "current" : ""}`}>
			{renaming ? (
				<div className="session-item">
					<RenameBox
						initial={s.name ?? ""}
						onDone={(name) => {
							setRenaming(false);
							if (name) onRename(s.path, name);
						}}
					/>
					<span className="session-meta">回车确认，Esc 取消</span>
				</div>
			) : (
				<button
					className="session-item"
					type="button"
					title={s.current ? currentHint : undefined}
					onClick={() => onOpen(s.path)}
				>
					<span className="session-title">{sessionTitle(s)}</span>
					{s.preview && <span className="session-preview">{s.preview}</span>}
					<span className="session-meta">
						{timeAgo(s.modified)} · {s.messageCount} 条
						{s.current ? <span className="session-current-badge">当前</span> : ""}
					</span>
				</button>
			)}
			<span className="session-acts">
				<button
					className="act"
					title="重命名"
					aria-label="重命名会话"
					onClick={(e) => {
						e.stopPropagation();
						setRenaming(true);
					}}
				>
					<IconPencil size={13} />
				</button>
				<a className="act" href={exportUrl(s.path)} download title="导出 .jsonl" aria-label="导出会话">
					<IconDownload size={13} />
				</a>
				{!s.current && (
					<ConfirmButton
						disabled={busy}
						title="删除会话（含其全部分支，不可恢复）"
						aria-label="删除会话"
						confirmText="确认删除"
						onConfirm={() => onDelete(s.path)}
					>
						<IconTrash size={13} />
					</ConfirmButton>
				)}
			</span>
		</div>
	);
}

export function SessionsPanel({
	sessions,
	stats,
	onOpen,
	onNew,
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
	// 相对时间不冻结：分钟级心跳重渲染
	const [, setTick] = useState(0);
	useEffect(() => {
		const t = setInterval(() => setTick((n) => n + 1), 60_000);
		return () => clearInterval(t);
	}, []);

	/** 服务端只下发当前卡会话；优先 current 标记，否则取列表首条（避免顶栏「当前会话」空白） */
	const current = useMemo(() => {
		if (!sessions?.length) return null;
		return sessions.find((s) => s.current) ?? sessions[0] ?? null;
	}, [sessions]);

	/** 服务端只下发当前卡会话；全部按卡绑定，无「未标记」分组 */
	const matched = useMemo(() => {
		const q = query.trim().toLowerCase();
		const filter = (s: WireSessionInfo) =>
			!q || (s.name ?? "").toLowerCase().includes(q) || s.firstMessage.toLowerCase().includes(q);
		return (sessions ?? []).filter(filter);
	}, [sessions, query]);

	const others = useMemo(() => {
		if (!current) return matched;
		return matched.filter((s) => s.path !== current.path && s.id !== current.id);
	}, [matched, current]);

	const currentHint = atHome ? "点击进入当前对话" : "再次点击回到主页";

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
		}, "已重命名");

	const remove = (path: string) =>
		run(async () => {
			await apiDelete(`/api/sessions?path=${encodeURIComponent(path)}`);
			onRefresh();
		});

	// ---- 导入 ST 聊天记录（从设置面板迁入：它产出的是一个会话） ----
	const fileRef = useRef<HTMLInputElement>(null);
	const [importTag, setImportTag] = useState("");
	const [importing, setImporting] = useState(false);

	const doImport = async (file: File) => {
		setImporting(true);
		try {
			const content = await file.text();
			await apiPost("/api/import", { content, tag: importTag.trim() });
			toast("info", "导入完成（前情块已注入会话）");
			onRefresh();
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setImporting(false);
			if (fileRef.current) fileRef.current.value = "";
		}
	};

	return (
		<div className="panel-body">
			{current && (
				<section className="sp-section">
					<h4>当前会话</h4>
					<div className="current-session-card" title={currentHint}>
						<Item s={current} busy={busy} onOpen={onOpen} onRename={rename} onDelete={remove} currentHint={currentHint} />
						{stats?.contextPercent !== null && stats !== null && (
							<div className="ctx-bar-row" title={`上下文占用 ${Math.round(stats.contextPercent)}%`}>
								<div className="ctx-bar">
									<div
										className={`ctx-bar-fill ${stats.contextPercent >= 85 ? "danger" : stats.contextPercent >= 65 ? "warn" : ""}`}
										style={{ width: `${Math.min(100, Math.round(stats.contextPercent))}%` }}
									/>
								</div>
								<span className="ctx-bar-num">{Math.round(stats.contextPercent)}%</span>
							</div>
						)}
						<div className="panel-row">
							<button className="drawer-btn" onClick={onNew}>
								＋ 新建会话
							</button>
							<button className="drawer-btn" onClick={onCompact} title="把较早的对话压缩成摘要，腾出上下文空间">
								压缩上下文
							</button>
						</div>
						<div className="panel-row">
							{onStore && (
								<button className="drawer-btn" onClick={onStore} title="在当前剧情点钉存档（世界线节点）">
									存档
								</button>
							)}
							{onWorldline && (
								<button className="drawer-btn" onClick={onWorldline} title="查看世界线时间线">
									世界线
								</button>
							)}
						</div>
					</div>
				</section>
			)}
			{!current && (
				<div className="panel-row">
					<button className="drawer-btn" onClick={onNew}>
						＋ 新建会话
					</button>
				</div>
			)}

			<section className="sp-section">
				<h4>会话列表</h4>
				<SearchInput
					value={query}
					onChange={(v) => {
						setQuery(v);
						if (!v.trim()) setHits(null);
					}}
					placeholder="过滤标题；回车搜全文…"
					onEnter={() => void doSearch()}
				/>
				{searching && <div className="sp-empty">全文搜索中…</div>}
				{hits !== null && !searching && (
					<div className="session-list">
						<div className="field-hint">全文命中 {hits.length} 个会话（清空搜索框恢复列表）</div>
						{hits.map((h) => (
							<button
								key={h.path}
								type="button"
								className={`session-item ${h.current ? "current" : ""}`}
								title={h.current ? currentHint : undefined}
								onClick={() => onOpen(h.path)}
							>
								<span className="session-title">{sessionTitle(h)}</span>
								<span className="session-preview">{h.snippet}</span>
								<span className="session-meta">
									{timeAgo(h.modified)} · {h.messageCount} 条
									{h.current ? <span className="session-current-badge">当前</span> : ""}
								</span>
							</button>
						))}
					</div>
				)}
				{hits === null && (
					<div className="session-list">
						{sessions === null && <div className="info-line">读取中…</div>}
						{sessions !== null && matched.length === 0 && <div className="info-line">暂无会话</div>}
						{others.map((s) => (
							<Item key={s.path} s={s} busy={busy} onOpen={onOpen} onRename={rename} onDelete={remove} currentHint={currentHint} />
						))}
					</div>
				)}
			</section>

			<section className="sp-section">
				<h4>导入 ST 聊天记录</h4>
				<div className="field-hint">
					选择 SillyTavern 导出的聊天 .jsonl：旧剧情自动摘要、世界状态自动建账，然后从断点继续。建议先新建会话再导入。
				</div>
				<Field label="正文标签名（可选）" hint="预设约定正文包在如 <content> 标签内时填 content；留空按默认规则剥离">
					<input className="panel-search" placeholder="content" value={importTag} onChange={(e) => setImportTag(e.target.value)} />
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
					{importing ? "导入中（解析→摘要→建账）…" : "选择 .jsonl 文件导入"}
				</button>
			</section>
		</div>
	);
}
