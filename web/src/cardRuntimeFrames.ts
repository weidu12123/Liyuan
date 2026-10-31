/** 只有正式卡消息帧与脚本宿主接入剧情桥；创作预览拥有自己的桥和测试变量。 */
export function cardRuntimeFrames(): HTMLIFrameElement[] {
	return typeof document === "undefined" ? [] : Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe[data-liyuan-card-runtime]"));
}

export function isCardRuntimeSource(source: MessageEventSource | null): source is Window {
	return source !== null && cardRuntimeFrames().some(frame => frame.contentWindow === source);
}

/** 推送当前变量并响应正式帧的启动握手，返回 effect 清理函数。 */
export function syncCardRuntimeVariables(variables: Record<string, unknown>): () => void {
	const wrapped = { stat_data: variables };
	if (typeof window !== "undefined") {
		(window as Window & { __liyuanVariables?: { stat_data: Record<string, unknown> } }).__liyuanVariables = wrapped;
	}
	const payload = { liyuanVariables: wrapped };
	const post = (win: Window | null) => {
		try { win?.postMessage(payload, "*"); } catch { /* 帧已卸载 */ }
	};
	for (const frame of cardRuntimeFrames()) post(frame.contentWindow);
	const onReady = (e: MessageEvent) => {
		if (e.data && typeof e.data === "object" && "liyuanVariablesReady" in e.data && isCardRuntimeSource(e.source)) post(e.source);
	};
	window.addEventListener("message", onReady);
	return () => window.removeEventListener("message", onReady);
}
