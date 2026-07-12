/**
 * 欢迎区 / 主页（学 ST welcome-screen，嵌在聊天流内，非独立页）。
 * 顶栏 / 侧栏 / 输入框照常可用。
 */

import { useEffect, useMemo, useState } from "react";
import type { WireSessionInfo } from "../wire.ts";
import { BrandLogo } from "./BrandLogo.tsx";
import {
	IconApi,
	IconCard,
	IconCodex,
	IconGithub,
	IconLorebook,
	IconPersona,
	IconPreset,
	IconPuzzle,
	IconSessions,
} from "./icons.tsx";

const COLLAPSED = 4;
/** 项目仓库（主页顶栏图标入口） */
const GITHUB_URL = "https://github.com/weidu12123/Liyuan";

function timeAgo(ms: number): string {
	const diff = Date.now() - ms;
	if (diff < 90_000) return "刚刚";
	if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
	if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`;
	if (diff < 30 * 86_400_000) return `${Math.round(diff / 86_400_000)} 天前`;
	return new Date(ms).toLocaleDateString();
}

function sessionTitle(s: { name?: string; firstMessage: string }): string {
	return s.name || s.firstMessage.slice(0, 48) || "（空会话）";
}

export interface WelcomePanelProps {
	sessions: WireSessionInfo[] | null;
	conn: string;
	charName: string;
	userName?: string;
	/** 当前角色卡立绘（有则用） */
	charAvatarUrl?: string | null;
	onOpen: (path: string) => void;
	onNew: () => void;
	onBrowseAll: () => void;
	onOpenPanel: (id: "connect" | "card" | "powers" | "sessions" | "lorebook" | "preset" | "persona" | "codex") => void;
}

export function WelcomePanel({
	sessions,
	conn,
	charName,
	userName,
	charAvatarUrl,
	onOpen,
	onNew,
	onBrowseAll,
	onOpenPanel,
}: WelcomePanelProps) {
	const [expanded, setExpanded] = useState(false);
	const [, setTick] = useState(0);
	useEffect(() => {
		const t = setInterval(() => setTick((n) => n + 1), 60_000);
		return () => clearInterval(t);
	}, []);

	const list = useMemo(() => sessions ?? [], [sessions]);
	const shown = expanded ? list.slice(0, 12) : list.slice(0, COLLAPSED);
	const hasMore = list.length > COLLAPSED;
	const ready = conn === "open";
	const current = list.find((s) => s.current) ?? list[0] ?? null;
	const totalMsgs = list.reduce((n, s) => n + (s.messageCount || 0), 0);

	const hour = new Date().getHours();
	const greet =
		hour < 5 ? "夜深了" : hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";

	return (
		<div className="welcome">
			{/* ── 品牌英雄区 ── */}
			<header className="welcome-hero">
				<div className="welcome-hero-mark" aria-hidden="true">
					<BrandLogo className="welcome-hero-logo" size={88} />
				</div>
				<div className="welcome-hero-copy">
					<p className="welcome-greet">
						{greet}
						{userName ? `，${userName}` : ""}
					</p>
					<div className="welcome-hero-title-row">
						<h1 className="welcome-hero-title">梨园</h1>
						<a
							className="welcome-github"
							href={GITHUB_URL}
							target="_blank"
							rel="noopener noreferrer"
							title="GitHub · weidu12123/Liyuan"
						>
							<IconGithub size={18} />
							<span>GitHub</span>
						</a>
					</div>
					<p className="welcome-hero-tag">角色扮演 Agent · 开源</p>
					{charName && (
						<button type="button" className="welcome-char-chip" onClick={() => onOpenPanel("card")} title="打开角色卡">
							{charAvatarUrl ? (
								<img className="welcome-char-avatar" src={charAvatarUrl} alt="" width={22} height={22} />
							) : (
								<span className="welcome-char-avatar fallback" aria-hidden="true">
									{charName.slice(0, 1)}
								</span>
							)}
							<span className="welcome-char-label">当前角色</span>
							<span className="welcome-char-name">{charName}</span>
						</button>
					)}
				</div>
				<div className="welcome-hero-actions">
					<button
						type="button"
						className="welcome-cta welcome-cta-primary"
						disabled={!ready}
						onClick={() => (current ? onOpen(current.path) : onNew())}
					>
						{current ? "继续当前对话" : "开始对话"}
					</button>
					<button type="button" className="welcome-cta welcome-cta-ghost" disabled={!ready} onClick={onNew}>
						新建会话
					</button>
				</div>
			</header>

			{/* ── 轻量概况 ── */}
			<div className="welcome-stats" aria-label="概况">
				<div className="welcome-stat">
					<span className="welcome-stat-num">{ready ? list.length : "—"}</span>
					<span className="welcome-stat-label">本卡会话</span>
				</div>
				<div className="welcome-stat-div" aria-hidden="true" />
				<div className="welcome-stat">
					<span className="welcome-stat-num">{ready ? totalMsgs : "—"}</span>
					<span className="welcome-stat-label">消息条数</span>
				</div>
				<div className="welcome-stat-div" aria-hidden="true" />
				<div className="welcome-stat">
					<span className={`welcome-stat-dot dot-${conn}`} title={conn} />
					<span className="welcome-stat-label">{ready ? "已连接" : conn === "connecting" ? "连接中" : "未连接"}</span>
				</div>
			</div>

			{/* ── 最近的聊天 ── */}
			<section className="welcome-recent" aria-label="最近的聊天">
				<div className="welcome-section-head">
					<span className="welcome-section-title">最近的聊天</span>
					<button type="button" className="welcome-link" disabled={!ready} onClick={onBrowseAll}>
						<IconSessions size={13} />
						全部会话
					</button>
				</div>

				{!ready && <div className="welcome-hint-line">连接后台中…</div>}
				{ready && sessions === null && <div className="welcome-hint-line">读取会话…</div>}
				{ready && sessions !== null && list.length === 0 && (
					<div className="welcome-empty-chats">
						<BrandLogo size={40} className="welcome-empty-logo" />
						<p>还没有会话</p>
						<button type="button" className="welcome-cta welcome-cta-primary" onClick={onNew}>
							新建第一场戏
						</button>
					</div>
				)}

				{ready && shown.length > 0 && (
					<ul className="welcome-chat-list">
						{shown.map((s) => (
							<li key={s.path}>
								<button
									type="button"
									className={`welcome-chat-row ${s.current ? "current" : ""}`}
									title={s.current ? "点击进入当前对话" : "打开此会话"}
									onClick={() => onOpen(s.path)}
								>
									<span className="welcome-chat-avatar" aria-hidden="true">
										{s.current && charAvatarUrl ? (
											<img src={charAvatarUrl} alt="" />
										) : (
											<span>{(s.cardName || charName || "话").slice(0, 1)}</span>
										)}
									</span>
									<span className="welcome-chat-body">
										<span className="welcome-chat-title">
											<strong className="welcome-chat-char">{s.cardName || charName || "会话"}</strong>
											<span className="welcome-chat-sep">·</span>
											<span className="welcome-chat-name">{sessionTitle(s)}</span>
											{s.current ? <span className="session-current-badge">当前</span> : null}
										</span>
										{s.preview && <span className="welcome-chat-preview">{s.preview}</span>}
									</span>
									<span className="welcome-chat-side">
										<span className="welcome-chat-time">{timeAgo(s.modified)}</span>
										<span className="welcome-chat-count">{s.messageCount} 条</span>
									</span>
								</button>
							</li>
						))}
					</ul>
				)}

				{hasMore && (
					<button type="button" className="welcome-expand" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
						{expanded ? "收起" : `展开更多（${list.length - COLLAPSED}）`}
					</button>
				)}
			</section>

			{/* ── 欢迎气泡（学 ST 助手欢迎句） ── */}
			<article className="welcome-assistant">
				<div className="welcome-assistant-head">
					<BrandLogo className="welcome-assistant-logo" size={44} />
					<div className="welcome-assistant-id">
						<div className="welcome-assistant-name">梨园</div>
						<div className="welcome-assistant-meta">欢迎 · #{0}</div>
					</div>
					<span className="welcome-assistant-floor" aria-hidden="true">
						#0
					</span>
				</div>
				<div className="welcome-assistant-body">
					<p className="welcome-assistant-text">
						{ready
							? current
								? `台上已备好「${charName}」。点上方橙标会话继续，或在下方直接开口——侧栏连接、角色卡、世界书与对话同屏。`
								: `欢迎入园。先在「角色卡」选定人物，再「新建会话」开场；也可点下方快捷入口检查连接与扩展。`
							: "正在连接后台，请稍候…"}
					</p>
					<ul className="welcome-tips">
						<li>
							<strong>继续</strong>：点橙标「当前」进入对话；在对话里再点一次回到主页
						</li>
						<li>
							<strong>新建</strong>：右上角或主按钮开一场新戏（绑定当前角色卡）
						</li>
						<li>
							<strong>面板</strong>：顶栏图标与下方快捷入口打开连接 / 角色 / 世界书等
						</li>
					</ul>
				</div>
			</article>

			{/* ── 快捷入口 ── */}
			<nav className="welcome-quick" aria-label="快捷入口">
				<button type="button" className="welcome-quick-btn" onClick={() => onOpenPanel("connect")}>
					<IconApi size={15} />
					连接
				</button>
				<button type="button" className="welcome-quick-btn" onClick={() => onOpenPanel("card")}>
					<IconCard size={15} />
					角色卡
				</button>
				<button type="button" className="welcome-quick-btn" onClick={() => onOpenPanel("lorebook")}>
					<IconLorebook size={15} />
					世界书
				</button>
				<button type="button" className="welcome-quick-btn" onClick={() => onOpenPanel("preset")}>
					<IconPreset size={15} />
					预设
				</button>
				<button type="button" className="welcome-quick-btn" onClick={() => onOpenPanel("persona")}>
					<IconPersona size={15} />
					用户角色
				</button>
				<button type="button" className="welcome-quick-btn" onClick={() => onOpenPanel("codex")}>
					<IconCodex size={15} />
					知识库
				</button>
				<button type="button" className="welcome-quick-btn" onClick={() => onOpenPanel("powers")}>
					<IconPuzzle size={15} />
					扩展
				</button>
				<button type="button" className="welcome-quick-btn" onClick={onBrowseAll}>
					<IconSessions size={15} />
					会话
				</button>
			</nav>
		</div>
	);
}

/** @deprecated 旧名 */
export const HomePage = WelcomePanel;
