/**
 * 昼夜主题：localStorage 持久化，html[data-theme] 驱动 CSS 变量。
 */

export type ThemeMode = "light" | "dark";

const KEY = "liyuan.theme";

export function getTheme(): ThemeMode {
	try {
		const v = localStorage.getItem(KEY);
		if (v === "dark" || v === "light") return v;
	} catch {
		// ignore
	}
	return "light";
}

export function applyTheme(mode: ThemeMode): void {
	document.documentElement.setAttribute("data-theme", mode);
	// 移动端状态栏色
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) meta.setAttribute("content", mode === "dark" ? "#1a1614" : "#f7f4f0");
	try {
		localStorage.setItem(KEY, mode);
	} catch {
		// ignore
	}
}

export function setTheme(mode: ThemeMode): void {
	applyTheme(mode);
}

/** 启动时尽早调用，避免白闪 */
export function initTheme(): ThemeMode {
	const mode = getTheme();
	applyTheme(mode);
	return mode;
}
