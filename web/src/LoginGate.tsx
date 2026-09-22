/**
 * 登录门：仅当服务端已设置访问密码且当前未登录时挡在 App 前。
 * 未设置密码（首次使用）直接放行，零门槛。
 * 顺带把服务端配置的界面语言（/api/access/status 带 uiLanguage）对齐到前端——这是配置到达前端的第一站。
 */

import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { BrandLogo } from "./components/BrandLogo.tsx";
import { LocaleSwitch } from "./components/LocaleSwitch.tsx";
import { syncLocaleFromConfig, t, useLocale } from "./i18n/index.ts";

type Gate = "checking" | "open" | "locked";

export function LoginGate({ children }: { children: React.ReactNode }) {
	useLocale();
	const [gate, setGate] = useState<Gate>("checking");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	const check = () =>
		api<{ required: boolean; ok: boolean; uiLanguage?: string | null }>("/api/access/status")
			.then((r) => {
				syncLocaleFromConfig(r.uiLanguage);
				setGate(!r.required || r.ok ? "open" : "locked");
			})
			.catch(() => setGate("open")); // 状态查不到不误锁死；受保护接口各自会再拦

	useEffect(() => {
		void check();
	}, []);

	const login = async () => {
		if (!password || busy) return;
		setBusy(true);
		setError("");
		try {
			await api("/api/access/login", { method: "POST", body: JSON.stringify({ password }) });
			setPassword("");
			setGate("open");
		} catch (e) {
			setError((e as Error).message || t("登录失败"));
		} finally {
			setBusy(false);
		}
	};

	if (gate === "checking") return <div className="login-gate login-gate-blank" />;
	if (gate === "open") return <>{children}</>;

	return (
		<div className="login-gate">
			<div className="login-locale">
				<LocaleSwitch persist={false} />
			</div>
			<form
				className="login-card"
				onSubmit={(e) => {
					e.preventDefault();
					void login();
				}}
			>
				<BrandLogo size={56} className="login-logo" alt={t("梨园")} />
				<div className="login-title">{t("梨园")}</div>
				<div className="login-sub">{t("请输入访问密码")}</div>
				<input
					className="field-input login-input"
					type="password"
					placeholder={t("访问密码")}
					value={password}
					autoFocus
					autoComplete="current-password"
					onChange={(e) => {
						setPassword(e.target.value);
						setError("");
					}}
				/>
				{error && <div className="login-error">{error}</div>}
				<button className="drawer-btn save-btn login-btn" type="submit" disabled={busy || !password}>
					{busy ? t("登录中…") : t("进入")}
				</button>
			</form>
		</div>
	);
}
