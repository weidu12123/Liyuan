/**
 * 设置面板：外观（昼夜）+ 世界书扫描 + agent 行为。
 * 主题立刻生效、只存本机 localStorage，不写 rp.config。
 */

import { useEffect, useState } from "react";
import { apiGet, apiPut, type RpConfigView } from "../api.ts";
import { getTheme, setTheme, type ThemeMode } from "../theme.ts";
import { PanelStatus, SliderField, Toggle, useAction, usePanelData } from "./kit.tsx";

export function SettingsPanel({ toast }: { toast: (level: "info" | "warning" | "error", text: string) => void }) {
	const { data, error, loading, reload } = usePanelData(() => apiGet<{ config: RpConfigView }>("/api/config"), { cacheKey: "/api/config" });
	const { busy, run } = useAction(toast);

	const [scanDepth, setScanDepth] = useState(4);
	const [maxLore, setMaxLore] = useState(3);
	const [backendControl, setBackendControl] = useState(true);
	const [askMode, setAskMode] = useState(false);
	const [dirty, setDirty] = useState(false);
	const [dark, setDark] = useState(() => getTheme() === "dark");

	useEffect(() => {
		if (data) {
			setScanDepth(data.config.scanDepth);
			setMaxLore(data.config.maxLoreInjections);
			setBackendControl(data.config.backendControl !== false);
			setAskMode(data.config.creationMode === "ask");
			setDirty(false);
		}
	}, [data]);

	const touch = () => setDirty(true);

	const onTheme = (on: boolean) => {
		const mode: ThemeMode = on ? "dark" : "light";
		setDark(on);
		setTheme(mode);
		toast("info", on ? "已切换到黑夜模式" : "已切换到白昼模式");
	};

	const save = () =>
		run(async () => {
			// 只改本面板可见项；不碰 lorebook / importStripTags（由别处或默认处理）
			await apiPut("/api/config", {
				greeting: true,
				scanDepth,
				maxLoreInjections: maxLore,
				backendControl,
				creationMode: askMode ? "ask" : "silent",
			});
			reload();
		}, "已保存并重载会话");

	return (
		<div className="panel-body panel-body-sticky">
			<PanelStatus loading={loading} error={error} hasData={!!data} />
			<section className="sp-section">
				<h4>外观</h4>
				<div className="toggle-row">
					<span>黑夜模式</span>
					<Toggle checked={dark} onChange={onTheme} />
				</div>
				<div className="field-hint">白昼 / 黑夜立刻切换，偏好记在本机浏览器，与会话配置无关。</div>
			</section>
			{data && (
				<>
					<section className="sp-section">
						<h4>世界书</h4>
						<SliderField
							label="关键词扫描深度"
							hint="被动触发回看最近几条消息"
							value={scanDepth}
							min={1}
							max={20}
							onChange={(v) => {
								setScanDepth(v);
								touch();
							}}
						/>
						<SliderField
							label="每轮注入条目上限"
							hint="0 = 关闭被动注入（常驻条目不受影响）"
							value={maxLore}
							min={0}
							max={10}
							onChange={(v) => {
								setMaxLore(v);
								touch();
							}}
						/>
					</section>

					<section className="sp-section">
						<h4>agent 行为</h4>
						<div className="toggle-row">
							<span>后端操控（bash / 文件等通用工具）</span>
							<Toggle
								checked={backendControl}
								onChange={(v) => {
									setBackendControl(v);
									touch();
								}}
							/>
						</div>
						<div className="field-hint">
							开启后 agent 能操作本机（调用你的其他项目、查资料）；全部调用都会显示在过程条。仅在自己的设备上开启。
						</div>
						<div className="toggle-row">
							<span>决策门禁（重大剧情决策先询问）</span>
							<Toggle
								checked={askMode}
								onChange={(v) => {
									setAskMode(v);
									touch();
								}}
							/>
						</div>
						<div className="field-hint">
							开=询问档：新重要角色定型、关键设定定死、重大转折前 agent 停笔弹选择卡问你。关=静默档：agent 自行推进。
						</div>
					</section>

					<div className="sticky-save">
						<button className="drawer-btn save-btn" disabled={busy || !dirty} onClick={save}>
							{dirty ? "保存并重载会话" : "已保存"}
						</button>
					</div>
				</>
			)}
		</div>
	);
}
