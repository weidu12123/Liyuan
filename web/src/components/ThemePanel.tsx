/**
 * 外观主题面板：实时预览窗口、主题色盘选择、自定义壁纸与自定义 CSS（复刻 WorkBuddy 视觉体验）
 */

import { useRef, useState } from "react";
import {
	THEME_LIST,
	getActiveThemeId,
	applyThemeById,
	getWallpaperConfig,
	applyWallpaper,
	getCustomCss,
	applyCustomCss,
	type ThemeDef,
	type WallpaperConfig,
	type CustomCssState,
} from "../themes.ts";
import { uploadFile } from "../api.ts";
import { attachmentUrl, toAttachmentView } from "../attachments.ts";
import { Toggle } from "./kit.tsx";
import { IconAttach, IconCheck, IconTrash } from "./icons.tsx";
import { t, useLocale } from "../i18n/index.ts";

export interface ThemePanelProps {
	toast: (level: "info" | "warning" | "error", text: string) => void;
}

const SAMPLE_WALLPAPERS = [
	{
		id: "shanshui",
		name: "水墨远山", // i18n-ignore
		url: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='800' viewBox='0 0 1200 800'><defs><linearGradient id='sky' x1='0' y1='0' x2='0' y2='1'><stop offset='0%' stop-color='%23e0ebe5'/><stop offset='60%' stop-color='%23f2f6f4'/><stop offset='100%' stop-color='%23e2ebe6'/></linearGradient><linearGradient id='m1' x1='0' y1='0' x2='0' y2='1'><stop offset='0%' stop-color='%23324d42' stop-opacity='0.4'/><stop offset='100%' stop-color='%23192923' stop-opacity='0.85'/></linearGradient><linearGradient id='m2' x1='0' y1='0' x2='0' y2='1'><stop offset='0%' stop-color='%23486b5d' stop-opacity='0.25'/><stop offset='100%' stop-color='%23223830' stop-opacity='0.7'/></linearGradient></defs><rect width='100%' height='100%' fill='url(%23sky)'/><path d='M0 500 Q 250 280, 500 480 T 1000 420 Q 1120 460, 1200 490 L 1200 800 L 0 800 Z' fill='url(%23m2)'/><path d='M0 560 Q 200 420, 420 540 T 880 500 Q 1060 520, 1200 580 L 1200 800 L 0 800 Z' fill='url(%23m1)'/></svg>",
	},
	{
		id: "xinghe",
		name: "璀璨星河", // i18n-ignore
		url: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='800' viewBox='0 0 1200 800'><defs><radialGradient id='g1' cx='30%' cy='20%' r='70%'><stop offset='0%' stop-color='%232e1065'/><stop offset='50%' stop-color='%230f172a'/><stop offset='100%' stop-color='%23030712'/></radialGradient><radialGradient id='g2' cx='80%' cy='40%' r='50%'><stop offset='0%' stop-color='%2338bdf8' stop-opacity='0.25'/><stop offset='100%' stop-color='%23030712' stop-opacity='0'/></radialGradient></defs><rect width='100%' height='100%' fill='url(%23g1)'/><rect width='100%' height='100%' fill='url(%23g2)'/><circle cx='180' cy='120' r='1.5' fill='%23fff' opacity='0.8'/><circle cx='340' cy='280' r='2' fill='%23fff' opacity='0.9'/><circle cx='720' cy='160' r='1.5' fill='%23fff' opacity='0.7'/><circle cx='890' cy='240' r='2.5' fill='%23fff' opacity='0.85'/><circle cx='540' cy='90' r='1' fill='%23fff' opacity='0.6'/><circle cx='1020' cy='110' r='2' fill='%23fff' opacity='0.8'/></svg>",
	},
	{
		id: "yingyu",
		name: "樱雨落霞", // i18n-ignore
		url: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='800' viewBox='0 0 1200 800'><defs><linearGradient id='sakura' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='%23fdf2f8'/><stop offset='40%' stop-color='%23fce7f3'/><stop offset='100%' stop-color='%23fae8ff'/></linearGradient><radialGradient id='sun' cx='85%' cy='15%' r='40%'><stop offset='0%' stop-color='%23f43f5e' stop-opacity='0.18'/><stop offset='100%' stop-color='%23fff' stop-opacity='0'/></radialGradient></defs><rect width='100%' height='100%' fill='url(%23sakura)'/><rect width='100%' height='100%' fill='url(%23sun)'/></svg>",
	},
];

export function ThemePanel({ toast }: ThemePanelProps) {
	useLocale();
	const [activeId, setActiveId] = useState<string>(() => getActiveThemeId());
	const activeTheme = THEME_LIST.find((t) => t.id === activeId) || THEME_LIST[0];

	// 背景壁纸状态
	const [wallpaper, setWallpaper] = useState<WallpaperConfig | null>(() => getWallpaperConfig());
	const [uploading, setUploading] = useState(false);
	const [isDragOver, setIsDragOver] = useState(false);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const cssInputRef = useRef<HTMLInputElement | null>(null);

	// 自定义 CSS 状态
	const [customCss, setCustomCssState] = useState<CustomCssState>(() => getCustomCss());

	const handleSelect = (theme: ThemeDef) => {
		setActiveId(theme.id);
		applyThemeById(theme.id);
		toast("info", t("已切换到「{name}」主题", { name: t(theme.name) }));
	};

	const handleUploadWallpaper = async (file: File) => {
		setUploading(true);
		try {
			const r = await uploadFile(file);
			const url = attachmentUrl(toAttachmentView(r.file));
			const newCfg: WallpaperConfig = {
				url,
				opacity: wallpaper?.opacity ?? 1.0,
				blur: wallpaper?.blur ?? 0,
			};
			setWallpaper(newCfg);
			applyWallpaper(newCfg);
			toast("info", t("已设置背景壁纸"));
		} catch (err) {
			toast("error", t("上传壁纸失败：{err}", { err: err instanceof Error ? err.message : String(err) }));
		} finally {
			setUploading(false);
		}
	};

	const handleSelectSample = (sampleUrl: string) => {
		const newCfg: WallpaperConfig = {
			url: sampleUrl,
			opacity: wallpaper?.opacity ?? 1.0,
			blur: wallpaper?.blur ?? 0,
		};
		setWallpaper(newCfg);
		applyWallpaper(newCfg);
		toast("info", t("已设置背景壁纸"));
	};

	const handleUpdateWallpaperParam = (key: "opacity" | "blur", val: number) => {
		if (!wallpaper) return;
		const next: WallpaperConfig = { ...wallpaper, [key]: val };
		setWallpaper(next);
		applyWallpaper(next);
	};

	const handleRemoveWallpaper = () => {
		setWallpaper(null);
		applyWallpaper(null);
		toast("info", t("已移除背景壁纸"));
	};

	const handleToggleCustomCss = (enabled: boolean) => {
		const next = { ...customCss, enabled };
		setCustomCssState(next);
		applyCustomCss(next);
		toast("info", enabled ? t("已启用自定义样式") : t("已停用自定义样式"));
	};

	const handleApplyCustomCssCode = () => {
		applyCustomCss(customCss);
		toast("info", t("自定义样式已保存并生效"));
	};

	const handleUploadCssFile = (file: File) => {
		const reader = new FileReader();
		reader.onload = (e) => {
			const code = String(e.target?.result || "");
			const next = { ...customCss, code, enabled: true };
			setCustomCssState(next);
			applyCustomCss(next);
			toast("info", t("已加载并应用 CSS 文件"));
		};
		reader.readAsText(file);
	};

	return (
		<div className="panel-body theme-panel-body">
			{/* 上部：大视窗主界面实时缩略图预览（Live Preview） */}
			<section className="theme-preview-section">
				<div className="theme-preview-header">
					<span className="theme-section-title">{t("实时预览")}</span>
					<span className="theme-preview-badge">
						<IconCheck size={13} /> {t("正在使用")}
					</span>
				</div>
				<div
					className="theme-preview-window"
					style={{
						background: activeTheme.previewGrad,
						position: "relative",
					}}
				>
					{/* 模拟背景壁纸叠加 */}
					{wallpaper && (
						<div
							style={{
								position: "absolute",
								inset: 0,
								backgroundImage: `url("${wallpaper.url}")`,
								backgroundSize: "cover",
								backgroundPosition: "center",
								opacity: wallpaper.opacity,
								filter: `blur(${wallpaper.blur}px)`,
								pointerEvents: "none",
							}}
						/>
					)}

					{/* 模拟窗口顶栏 */}
					<div className="theme-preview-topbar" style={{ position: "relative", zIndex: 1 }}>
						<div className="preview-window-dots">
							<span className="dot dot-red" />
							<span className="dot dot-yellow" />
							<span className="dot dot-green" />
						</div>
						<div className="preview-window-title">
							<span>{t("梨园")} · {t("听雨轩")}</span>
						</div>
					</div>

					{/* 模拟窗口内部主体 */}
					<div className="theme-preview-content" style={{ position: "relative", zIndex: 1 }}>
						{/* 模拟左侧微轨 */}
						<div className="preview-rail">
							<span className="preview-rail-icon" style={{ background: activeTheme.accent }} />
							<span className="preview-rail-icon" />
							<span className="preview-rail-icon" />
						</div>

						{/* 模拟聊天区域 */}
						<div className="preview-chat-flow">
							{/* 模拟角色回复 */}
							<div
								className="preview-bubble preview-bubble-char"
								style={{
									background: wallpaper ? `color-mix(in srgb, ${activeTheme.surface} 85%, transparent)` : activeTheme.surface,
									color: activeTheme.textColor,
									backdropFilter: wallpaper ? "blur(4px)" : "none",
								}}
							>
								<div className="preview-bubble-head">
									<span className="preview-avatar" style={{ background: activeTheme.accent }} />
									<span className="preview-char-name" style={{ color: activeTheme.accent }}>{t("怀瑾")}</span>
								</div>
								<div className="preview-bubble-text">
									{t("「雨势渐大，不如且在轩中煮茗片刻，听完这一折戏。」")}
								</div>
							</div>

							{/* 模拟用户消息 */}
							<div
								className="preview-bubble preview-bubble-user"
								style={{
									background: wallpaper ? `color-mix(in srgb, ${activeTheme.surface} 85%, transparent)` : activeTheme.surface,
									color: activeTheme.textColor,
									backdropFilter: wallpaper ? "blur(4px)" : "none",
								}}
							>
								<div className="preview-bubble-text">
									{t("「先生所言极是，便依先生之意。」")}
								</div>
							</div>

							{/* 模拟底部输入框 */}
							<div
								className="preview-composer"
								style={{
									background: wallpaper ? `color-mix(in srgb, ${activeTheme.surface} 90%, transparent)` : activeTheme.surface,
									backdropFilter: wallpaper ? "blur(4px)" : "none",
								}}
							>
								<span className="preview-input-placeholder">{t("输入消息…")}</span>
								<span className="preview-send-btn" style={{ background: activeTheme.accent }} />
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* 中部：全部主题卡片宫格 */}
			<section className="theme-grid-section">
				<div className="theme-grid-header">
					<span className="theme-section-title">{t("预设主题")}</span>
					<span className="theme-section-hint">{t("点击即时换肤")}</span>
				</div>
				<div className="theme-cards-grid">
					{THEME_LIST.map((theme) => {
						const isSelected = theme.id === activeId;
						return (
							<button
								key={theme.id}
								type="button"
								className={`theme-card ${isSelected ? "selected" : ""}`}
								onClick={() => handleSelect(theme)}
							>
								{/* 缩略色盘展示区 */}
								<div className="theme-card-thumb" style={{ background: theme.previewGrad }}>
									<div className="theme-card-decor">
										<span className="theme-mini-bubble" style={{ background: theme.surface }} />
										<span className="theme-accent-badge" style={{ background: theme.accent }} />
									</div>
									{isSelected && (
										<span className="theme-check-overlay">
											<IconCheck size={16} />
										</span>
									)}
								</div>

								{/* 主题名称与副标 */}
								<div className="theme-card-info">
									<div className="theme-card-title-row">
										<span className="theme-card-name">{t(theme.name)}</span>
										{theme.isDark && <span className="theme-tag-dark">{t("暗色")}</span>}
									</div>
									<span className="theme-card-desc">{t(theme.subtitle)}</span>
								</div>
							</button>
						);
					})}
				</div>
			</section>

			{/* 下部：个性化自定义区（自定义壁纸与自定义 CSS） */}
			<section className="theme-custom-section">
				{/* 1. 自定义背景壁纸 */}
				<div
					className={`theme-custom-card ${isDragOver ? "drag-over" : ""}`}
					onDragOver={(e) => {
						e.preventDefault();
						setIsDragOver(true);
					}}
					onDragLeave={() => setIsDragOver(false)}
					onDrop={(e) => {
						e.preventDefault();
						setIsDragOver(false);
						const f = e.dataTransfer.files?.[0];
						if (f && (f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(f.name))) {
							void handleUploadWallpaper(f);
						}
					}}
				>
					<div className="theme-custom-head">
						<span className="theme-custom-title">{t("自定义背景壁纸")}</span>
						{wallpaper && (
							<button type="button" className="act" onClick={handleRemoveWallpaper}>
								<IconTrash size={13} /> {t("移除壁纸")}
							</button>
						)}
					</div>

					{wallpaper ? (
						<>
							<div className="theme-wallpaper-preview-row">
								<img src={wallpaper.url} alt={t("壁纸缩略图")} className="theme-wallpaper-thumb" />
								<div className="theme-wallpaper-meta">
									<button
										type="button"
										className="drawer-btn"
										disabled={uploading}
										onClick={() => fileInputRef.current?.click()}
									>
										<IconAttach size={14} /> {uploading ? t("上传中…") : t("更换图片")}
									</button>
								</div>
							</div>

							<div className="theme-slider-row">
								<span>{t("壁纸清晰度")}</span>
								<input
									type="range"
									min="0.1"
									max="1.0"
									step="0.05"
									className="theme-slider"
									value={wallpaper.opacity}
									onChange={(e) => handleUpdateWallpaperParam("opacity", parseFloat(e.target.value))}
								/>
								<span className="theme-slider-val">{Math.round(wallpaper.opacity * 100)}%</span>
							</div>

							<div className="theme-slider-row">
								<span>{t("背景模糊度")}</span>
								<input
									type="range"
									min="0"
									max="20"
									step="1"
									className="theme-slider"
									value={wallpaper.blur}
									onChange={(e) => handleUpdateWallpaperParam("blur", parseInt(e.target.value, 10))}
								/>
								<span className="theme-slider-val">{wallpaper.blur}px</span>
							</div>

							<div className="theme-sample-wallpapers">
								<span className="theme-sample-label">{t("精选推荐：")}</span>
								{SAMPLE_WALLPAPERS.map((s) => (
									<button
										key={s.id}
										type="button"
										className={`theme-sample-btn ${wallpaper.url === s.url ? "active" : ""}`}
										onClick={() => handleSelectSample(s.url)}
									>
										{t(s.name)}
									</button>
								))}
							</div>
						</>
					) : (
						<>
							<button
								type="button"
								className="drawer-btn"
								disabled={uploading}
								onClick={() => fileInputRef.current?.click()}
							>
								<IconAttach size={14} /> {uploading ? t("上传中…") : t("上传背景图片（JPG/PNG/WebP）")}
							</button>
							<div className="theme-sample-wallpapers">
								<span className="theme-sample-label">{t("精选推荐：")}</span>
								{SAMPLE_WALLPAPERS.map((s) => (
									<button
										key={s.id}
										type="button"
										className="theme-sample-btn"
										onClick={() => handleSelectSample(s.url)}
									>
										{t(s.name)}
									</button>
								))}
							</div>
						</>
					)}
					<input
						ref={fileInputRef}
						type="file"
						accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp"
						hidden
						onChange={(e) => {
							const f = e.target.files?.[0];
							if (f) void handleUploadWallpaper(f);
							e.target.value = "";
						}}
					/>
				</div>

				{/* 2. 自定义 CSS 样式 */}
				<div className="theme-custom-card">
					<div className="theme-custom-head">
						<span className="theme-custom-title">{t("自定义 CSS 样式")}</span>
						<Toggle
							checked={customCss.enabled}
							onChange={handleToggleCustomCss}
							title={customCss.enabled ? t("已启用") : t("已停用")}
						/>
					</div>
					<textarea
						className="theme-css-textarea"
						placeholder={t("在此编写 CSS 规则（如 body { font-family: ... }）…")}
						value={customCss.code}
						spellCheck={false}
						onChange={(e) => setCustomCssState({ ...customCss, code: e.target.value })}
					/>
					<div className="theme-actions-row">
						<button
							type="button"
							className="act"
							onClick={() => cssInputRef.current?.click()}
							title={t("导入 .css 样式文件")}
						>
							{t("导入文件")}
						</button>
						<button
							type="button"
							className="act"
							onClick={handleApplyCustomCssCode}
							title={t("应用并保存 CSS 代码")}
						>
							{t("保存样式")}
						</button>
					</div>
					<input
						ref={cssInputRef}
						type="file"
						accept=".css,text/css"
						hidden
						onChange={(e) => {
							const f = e.target.files?.[0];
							if (f) handleUploadCssFile(f);
							e.target.value = "";
						}}
					/>
				</div>
			</section>
		</div>
	);
}
