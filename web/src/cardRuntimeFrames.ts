/** 只有正式卡消息帧与脚本宿主接入剧情桥；创作预览拥有自己的桥和测试变量。 */
export function cardRuntimeFrames(): HTMLIFrameElement[] {
	return typeof document === "undefined" ? [] : Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe[data-liyuan-card-runtime]"));
}

export function isCardRuntimeSource(source: MessageEventSource | null): source is Window {
	return source !== null && cardRuntimeFrames().some(frame => frame.contentWindow === source);
}

export interface LiyuanRuntimeMessageLite {
	message_id: number;
	index: number;
	role: "user" | "assistant" | "system";
	channel: string;
	name: string;
	message: string;
	mes: string;
	text: string;
	is_hidden?: boolean;
	swipe_id?: number;
	swipes?: string[];
	data?: Record<string, unknown>;
	extra?: Record<string, unknown>;
}

export interface LiyuanRuntimeRegexRule {
	id?: string;
	name?: string;
	pattern: string;
	flags: string;
	replace: string;
	enabled?: boolean;
}

export interface LiyuanRuntimeContextSnapshot {
	card?: string;
	charName: string;
	userName: string;
	chatId: string | null;
	sessionId: string;
	mode: "roleplay" | "agent";
	streaming: boolean;
	messages: LiyuanRuntimeMessageLite[];
	presetName?: string;
	worldbooks?: string[];
	displayRules?: LiyuanRuntimeRegexRule[];
	promptRules?: LiyuanRuntimeRegexRule[];
	scriptVars?: {
		chat?: Record<string, unknown>;
		character?: Record<string, unknown>;
		preset?: Record<string, unknown>;
		global?: Record<string, unknown>;
		messages?: Record<string, Record<string, unknown>>;
	};
}

/** 向父窗口及所有正式卡运行时子帧广播酒馆助手事件（tavern_events / iframe_events） */
export function emitCardRuntimeEvent(eventType: string, ...args: unknown[]): void {
	if (typeof window === "undefined") return;
	const w = window as Window & {
		eventEmit?: (name: string, ...a: unknown[]) => unknown;
		__liyuanStickyEvents?: Record<string, unknown[]>;
	};
	if (eventType === "app_ready" || eventType === "APP_READY") {
		if (!w.__liyuanStickyEvents) w.__liyuanStickyEvents = {};
		w.__liyuanStickyEvents.app_ready = args;
	}
	try {
		w.eventEmit?.(eventType, ...args);
	} catch (e) {
		console.error("[liyuan emitCardRuntimeEvent]", eventType, e);
	}
	const payload = { liyuanTavernEvent: { type: eventType, args } };
	for (const frame of cardRuntimeFrames()) {
		try {
			frame.contentWindow?.postMessage(payload, "*");
		} catch {
			/* 帧已卸载 */
		}
	}
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

/** 推送当前梨园运行时上下文与真实消息投影（供 Liyuan SDK 及 getChatMessages/getLastMessageId/substitudeMacros 同步读取）。 */
export function syncCardRuntimeContext(context: LiyuanRuntimeContextSnapshot): () => void {
	if (typeof window !== "undefined") {
		(window as Window & { __liyuanRuntimeContext?: LiyuanRuntimeContextSnapshot }).__liyuanRuntimeContext = context;
	}
	const payload = { liyuanRuntimeContext: context };
	const post = (win: Window | null) => {
		try { win?.postMessage(payload, "*"); } catch { /* 帧已卸载 */ }
	};
	for (const frame of cardRuntimeFrames()) post(frame.contentWindow);
	const onReady = (e: MessageEvent) => {
		if (e.data && typeof e.data === "object" && "liyuanContextReady" in e.data && isCardRuntimeSource(e.source)) post(e.source);
	};
	if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
		window.addEventListener("message", onReady);
		return () => window.removeEventListener("message", onReady);
	}
	return () => {};
}

