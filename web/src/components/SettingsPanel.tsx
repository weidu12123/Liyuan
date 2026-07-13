/**
 * 设置面板：外观（昼夜）+ 世界书扫描 + agent 行为。
 * 主题立刻生效、只存本机 localStorage，不写 rp.config。
 */

import { useEffect, useState } from "react";
import { api, apiGet, apiPut, type RpConfigView } from "../api.ts";
import { getTheme, setTheme, type ThemeMode } from "../theme.ts";
import { PanelStatus, SliderField, Toggle, useAction, usePanelData } from "./kit.tsx";

/** 访问密码区：未设置=开放（首次零门槛），设置后全端登录才可用 */
function AccessSection({ toast }: { toast: (level: "info" | "warning" | "error", text: string) => void }) {
	const [required, setRequired] = useState<boolean | null>(null);
	const [oldPw, setOldPw] = useState("");
	const [newPw, setNewPw] = useState("");
	const [newPw2, setNewPw2] = useState("");
	const { busy, run } = useAction(toast);

	useEffect(() => {
		void api<{ required: boolean }>("/api/access/status")
			.then((r) => setRequired(r.required))
			.catch(() => setRequired(false));
	}, []);

	const submit = (turningOff: boolean) =>
		run(async () => {
			if (!turningOff) {
				if (newPw.length < 4) throw new Error("新密码至少 4 位");
				if (newPw !== newPw2) throw new Error("两次输入的新密码不一致");
			}
			const r = await api<{ required: boolean }>("/api/access/set", {
				method: "POST",
				body: JSON.stringify({ oldPassword: oldPw, newPassword: turningOff ? "" : newPw }),
			});
			setRequired(r.required);
			setOldPw("");
			setNewPw("");
			setNewPw2("");
		}, turningOff ? "已关闭访问密码" : "已设置访问密码（其他设备需重新登录）");

	return (
		<section className="sp-section">
			<h4>访问密码</h4>
			<div className="field-hint">
				{required
					? "已开启：所有设备访问本站都需输入密码。修改或关闭需先验证当前密码。"
					: "未开启：任何能连到本站的人都可直接使用。部署到公网 / 局域网共享时建议设置。"}
			</div>
			{required === null ? null : (
				<>
					{required && (
						<input
							className="field-input"
							type="password"
							placeholder="当前密码"
							value={oldPw}
							autoComplete="current-password"
							onChange={(e) => setOldPw(e.target.value)}
						/>
					)}
					<input
						className="field-input"
						type="password"
						placeholder={required ? "新密码（至少 4 位）" : "设置密码（至少 4 位）"}
						value={newPw}
						autoComplete="new-password"
						onChange={(e) => setNewPw(e.target.value)}
					/>
					<input
						className="field-input"
						type="password"
						placeholder="再输一次新密码"
						value={newPw2}
						autoComplete="new-password"
						onChange={(e) => setNewPw2(e.target.value)}
					/>
					<div className="access-actions">
						<button className="drawer-btn save-btn" disabled={busy || !newPw} onClick={() => submit(false)}>
							{required ? "修改密码" : "设置密码"}
						</button>
						{required && (
							<button className="drawer-btn" disabled={busy || !oldPw} onClick={() => submit(true)}>
								关闭密码
							</button>
						)}
					</div>
				</>
			)}
		</section>
	);
}

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
			<AccessSection toast={toast} />
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
							<span>决策门禁（戏内选择卡）</span>
							<Toggle
								checked={askMode}
								onChange={(v) => {
									setAskMode(v);
									touch();
								}}
							/>
						</div>
						<div className="field-hint">
							开=询问档：剧情相关（含「我该怎么办」）一律戏内，用选择卡共创；关=静默档自行推进。戏外只办系统事，不处理剧情。
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
