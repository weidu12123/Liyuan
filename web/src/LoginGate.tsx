/**
 * 登录门：仅当服务端已设置访问密码且当前未登录时挡在 App 前。
 * 未设置密码（首次使用）直接放行，零门槛。
 */

import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { BrandLogo } from "./components/BrandLogo.tsx";

type Gate = "checking" | "open" | "locked";

export function LoginGate({ children }: { children: React.ReactNode }) {
	const [gate, setGate] = useState<Gate>("checking");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	const check = () =>
		api<{ required: boolean; ok: boolean }>("/api/access/status")
			.then((r) => setGate(!r.required || r.ok ? "open" : "locked"))
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
			setError((e as Error).message || "登录失败");
		} finally {
			setBusy(false);
		}
	};

	if (gate === "checking") return <div className="login-gate login-gate-blank" />;
	if (gate === "open") return <>{children}</>;

	return (
		<div className="login-gate">
			<form
				className="login-card"
				onSubmit={(e) => {
					e.preventDefault();
					void login();
				}}
			>
				<BrandLogo size={56} className="login-logo" alt="梨园" />
				<div className="login-title">梨园</div>
				<div className="login-sub">请输入访问密码</div>
				<input
					className="field-input login-input"
					type="password"
					placeholder="访问密码"
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
					{busy ? "登录中…" : "进入"}
				</button>
			</form>
		</div>
	);
}
