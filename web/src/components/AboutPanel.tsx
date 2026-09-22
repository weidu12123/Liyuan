/**
 * 关于面板：应用定位、版本信息、在线更新状态、开源协议与仓库链接。
 */

import { useState } from "react";
import { apiPost } from "../api.ts";
import type { UpdateWire } from "../wire.ts";
import { BrandLogo } from "./BrandLogo.tsx";
import { IconCheck, IconGithub, IconRefresh } from "./icons.tsx";
import { t } from "../i18n/index.ts";

export interface AboutPanelProps {
	/** 在线更新状态 */
	update?: UpdateWire | null;
	/** 触发打开更新详情弹窗 */
	onOpenUpdate?: () => void;
	toast: (level: "info" | "warning" | "error", text: string) => void;
}

const GITHUB_REPO_URL = "https://github.com/weidu12123/Liyuan";

export function AboutPanel({ update, onOpenUpdate, toast }: AboutPanelProps) {
	const [checking, setChecking] = useState(false);

	const currentVersion = update?.currentVersion || "1.6.0";
	const hasNewVersion =
		update?.latestVersion &&
		update.latestVersion !== currentVersion &&
		update.phase !== "none";

	const deployEnv = update?.desktopDeploy
		? t("桌面应用 (Electron)")
		: update?.dockerDeploy
			? t("Docker 容器")
			: t("Web 本地服务");

	const checkUpdate = async () => {
		setChecking(true);
		try {
			await apiPost("/api/update/check", {});
			toast("info", t("已触发检查更新"));
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setChecking(false);
		}
	};

	return (
		<div className="panel-body about-panel-body">
			{/* 品牌标牌 */}
			<div className="about-hero">
				<BrandLogo size={56} className="about-hero-logo" />
				<div className="about-hero-text">
					<h3 className="about-hero-title">{t("梨园 Liyuan")}</h3>
					<div className="about-hero-tagline">
						{t("基于 pi 构建的 RP Agent · 将 Coding Agent 能力全面 RP 化")}
					</div>
				</div>
			</div>

			{/* 版本与运行状态 */}
			<section className="sp-section">
				<h4>{t("版本与状态")}</h4>
				<div className="about-status-grid">
					<div className="about-status-row">
						<span className="about-label">{t("当前版本")}</span>
						<span className="about-val about-ver-tag">v{currentVersion}</span>
					</div>
					<div className="about-status-row">
						<span className="about-label">{t("运行环境")}</span>
						<span className="about-val">{deployEnv}</span>
					</div>
				</div>

				<div className="about-update-box">
					{hasNewVersion ? (
						<div className="about-update-alert">
							<span className="about-update-msg">
								{t("发现新版本")} <b>v{update.latestVersion}</b>
								{update.publishedAt ? ` (${update.publishedAt.slice(0, 10)})` : ""}
							</span>
							{onOpenUpdate && (
								<button
									type="button"
									className="drawer-btn save-btn"
									onClick={onOpenUpdate}
									style={{ padding: "4px 12px", fontSize: 13 }}
								>
									{t("查看更新")}
								</button>
							)}
						</div>
					) : (
						<div className="about-update-latest">
							<IconCheck size={14} className="about-check-icon" />
							<span>{t("当前已是最新版本")}</span>
						</div>
					)}
					<div className="access-actions" style={{ marginTop: 8 }}>
						<button
							type="button"
							className="drawer-btn"
							disabled={checking}
							onClick={() => void checkUpdate()}
						>
							<IconRefresh size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
							{checking ? t("检查中…") : t("检查更新")}
						</button>
					</div>
				</div>
			</section>

			{/* 许可证与开源声明 */}
			<section className="sp-section">
				<h4>{t("开源协议")}</h4>
				<div className="about-license-block">
					<div className="about-license-item">
						<strong>{t("主项目许可")}</strong>{t("：")}
						<span>{t("PolyForm Noncommercial 1.0.0（个人与非商业用途自由使用、修改与分发）")}</span>
					</div>
					<div className="about-license-item" style={{ marginTop: 6 }}>
						<strong>{t("内核架构")}</strong>{t("：")}
						<span>{t("基于")} <a href="https://github.com/earendil-works/pi" target="_blank" rel="noreferrer">pi</a>{t("（MIT 许可）二次开发，保留原版权声明")}</span>
					</div>
				</div>
			</section>

			{/* 源码仓库 */}
			<section className="sp-section">
				<h4>{t("项目主页")}</h4>
				<div className="about-links-row">
					<a
						href={GITHUB_REPO_URL}
						target="_blank"
						rel="noreferrer"
						className="drawer-btn about-link-btn"
					>
						<IconGithub size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
						{t("GitHub 源码仓库")}
					</a>
				</div>
			</section>
		</div>
	);
}
