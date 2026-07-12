import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./app.css";
import { initTheme } from "./theme.ts";

initTheme();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

// 注册轻量 SW：预缓存品牌图标与壳，弱网/再开快捷方式不糊、不裂图
if (import.meta.env.PROD && "serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js").catch(() => {
			/* 无 SW 不挡主流程 */
		});
	});
}
