/**
 * 欢迎区 / 主页（学 ST welcome-screen，嵌在聊天流内，非独立页）。
 * 顶栏 / 侧栏 / 输入框照常可用。
 */

import { UpdateChip } from "./UpdateFlow.tsx";
import { useEffect, useMemo, useState } from "react";
import type { WireSessionInfo } from "../wire.ts";
import { BrandLogo } from "./BrandLogo.tsx";
import {
	IconGithub,
	IconSessions,
} from "./icons.tsx";
import { fmtDateTime, t } from "../i18n/index.ts";

const COLLAPSED = 5;
/** 项目仓库（主页顶栏图标入口） */
const GITHUB_URL = "https://github.com/weidu12123/Liyuan";

function timeAgo(ms: number): string {
	const diff = Date.now() - ms;
	if (diff < 90_000) return t("刚刚");
	if (diff < 3_600_000) return t("{n} 分钟前", { n: Math.round(diff / 60_000) });
	if (diff < 86_400_000) return t("{n} 小时前", { n: Math.round(diff / 3_600_000) });
	if (diff < 30 * 86_400_000) return t("{n} 天前", { n: Math.round(diff / 86_400_000) });
	return fmtDateTime(ms, { year: "numeric", month: "numeric", day: "numeric" });
}

function sessionTitle(s: { name?: string; firstMessage: string }): string {
	return s.name || s.firstMessage.slice(0, 48) || t("（空会话）");
}

export interface WelcomePanelProps {
	/** 在线更新状态（有新版/就绪时 GitHub 徽标旁出 chip） */
	update?: import("../wire.ts").UpdateWire | null;
	onUpdateClick?: () => void;
	sessions: WireSessionInfo[] | null;
	conn: string;
	charName: string;
	userName?: string;
	/** 当前角色卡立绘（有则用） */
	charAvatarUrl?: string | null;
	onOpen: (path: string) => void;
	onNew: () => void;
	onBrowseAll: () => void;
	onOpenPanel: (id: "connect" | "card" | "powers" | "sessions" | "lorebook" | "preset" | "persona") => void;
}

export function WelcomePanel({
	update,
	onUpdateClick,
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
		const [, setTick] = useState(0);
	useEffect(() => {
		const t = setInterval(() => setTick((n) => n + 1), 60_000);
		return () => clearInterval(t);
	}, []);

	const list = useMemo(() => sessions ?? [], [sessions]);
	/** 真聊过的会话（有 user/assistant 对话预览）。配置了卡就会自动开一个只含开场白的空壳会话进列表（main.ts 会话兜底），它没有 preview——首页空态靠这个判据成立 */
	const hasHistory = list.some((s) => s.preview);
	const shown = list.slice(0, COLLAPSED);
		const ready = conn === "open";
	const current = list.find((s) => s.current) ?? list[0] ?? null;
	const totalMsgs = list.reduce((n, s) => n + (s.messageCount || 0), 0);

	const hour = new Date().getHours();
	const greet =
		hour < 5 ? t("夜深了") : hour < 11 ? t("早上好") : hour < 14 ? t("中午好") : hour < 18 ? t("下午好") : t("晚上好");

	return (
		<div className="welcome">
			{/* ── 品牌英雄区 ── */}
			<header className="welcome-hero">
				<div className="welcome-hero-mark" aria-hidden="true">
					<BrandLogo className="welcome-hero-logo" size={88} />
				</div>
				<div className="welcome-hero-copy">
					<p className="welcome-greet">
						{userName ? t("{greet}，{userName}", { greet, userName }) : greet}
					</p>
					<div className="welcome-hero-title-row">
						<h1 className="welcome-hero-title">{t("梨园")}</h1>
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
						<UpdateChip update={update ?? null} onClick={() => onUpdateClick?.()} />
					</div>
					<p className="welcome-hero-tag">{t("角色扮演 Agent · 开源")}</p>
					{charName && (
						<button type="button" className="welcome-char-chip" onClick={() => onOpenPanel("card")} title={t("打开角色卡")}>
							{charAvatarUrl ? (
								<img className="welcome-char-avatar" src={charAvatarUrl} alt="" width={22} height={22} />
							) : (
								<span className="welcome-char-avatar fallback" aria-hidden="true">
									{charName.slice(0, 1)}
								</span>
							)}
							<span className="welcome-char-label">{t("当前角色")}</span>
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
						{hasHistory ? t("继续当前对话") : t("开始对话")}
					</button>
					<button type="button" className="welcome-cta welcome-cta-ghost" disabled={!ready} onClick={onNew}>
						{t("新建会话")}
					</button>
				</div>
			</header>

			{/* ── 统一会话大卡片：有会话记录时展示，无会话时完全留白让输入框居中 ── */}
			{ready && hasHistory && (
				<section className="welcome-recent-card" aria-label={t("最近会话")}>
					<div className="welcome-recent-head">
						<div className="welcome-recent-title-group">
							<span className="welcome-section-title">{t("最近会话")}</span>
							<span className="welcome-recent-meta-pill">
								{t("{sessions} 会话 · {messages} 消息", { sessions: list.length, messages: totalMsgs })}
							</span>
						</div>
						<div className="welcome-recent-actions">
							<span className={`welcome-stat-dot dot-${conn}`} title={conn} />
							<button type="button" className="welcome-link" disabled={!ready} onClick={onBrowseAll}>
								<IconSessions size={13} />
								{t("全部会话")}
							</button>
						</div>
					</div>

					<ul className="welcome-chat-list">
							{shown.map((s) => (
								<li key={s.path}>
									<button
										type="button"
										className={`welcome-chat-row ${s.current ? "current" : ""}`}
										title={s.current ? t("点击进入当前对话") : t("打开此会话")}
										onClick={() => onOpen(s.path)}
									>
										<span className="welcome-chat-avatar" aria-hidden="true">
											{(s.cardName === charName || !s.cardName) && charAvatarUrl ? (
												<img src={charAvatarUrl} alt="" />
											) : s.card ? (
												<img
													src={`/api/cards/image?path=${encodeURIComponent(s.card)}`}
													alt=""
													onError={(e) => {
														e.currentTarget.style.display = "none";
													}}
												/>
											) : (
												<span>{(s.cardName || charName || t("话")).slice(0, 1)}</span>
											)}
										</span>
										<span className="welcome-chat-body">
											<span className="welcome-chat-title">
												<strong className="welcome-chat-char">{s.cardName || charName || t("会话")}</strong>
												<span className="welcome-chat-sep">·</span>
												<span className="welcome-chat-name">{sessionTitle(s)}</span>
												{s.current ? <span className="session-current-badge">{t("当前")}</span> : null}
											</span>
											{s.preview && <span className="welcome-chat-preview">{s.preview}</span>}
										</span>
										<span className="welcome-chat-side">
											<span className="welcome-chat-time">{timeAgo(s.modified)}</span>
											<span className="welcome-chat-count">{t("{n} 条", { n: s.messageCount })}</span>
										</span>
									</button>
								</li>
							))}
					</ul>
				</section>
			)}
		</div>
	);
}

/** @deprecated 旧名 */
export const HomePage = WelcomePanel;
