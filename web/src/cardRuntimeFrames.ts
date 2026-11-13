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
	presetMode?: "liyuan" | "pure";
	model?: string;
	streaming: boolean;
	messages: LiyuanRuntimeMessageLite[];
	presetName?: string;
	presetNames?: string[];
	presetRaw?: Record<string, unknown> | null;
	presetDirty?: boolean;
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

/** 向父窗口及所有正式卡运行时子帧同步/异步广播事件（同源子帧传递活对象引用，允许脚本原地修改 payload） */
export async function emitCardRuntimeEventAsync(eventType: string, ...args: unknown[]): Promise<void> {
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
		await w.eventEmit?.(eventType, ...args);
	} catch (e) {
		console.error("[liyuan emitCardRuntimeEventAsync]", eventType, e);
	}
	for (const frame of cardRuntimeFrames()) {
		try {
			const cw = frame.contentWindow as (Window & { eventEmit?: (name: string, ...a: unknown[]) => unknown }) | null;
			if (cw && typeof cw.eventEmit === "function") {
				await cw.eventEmit(eventType, ...args);
			} else {
				cw?.postMessage({ liyuanTavernEvent: { type: eventType, args } }, "*");
			}
		} catch (e) {
			console.error("[liyuan emitCardRuntimeEventAsync frame]", eventType, e);
		}
	}
}

export interface RuntimeInjectedPromptItem {
	id: string;
	role: "system" | "user" | "assistant";
	position: "in_chat" | "before_prompt" | "in_prompt" | "none";
	depth: number;
	order: number;
	content: string;
}

/** 汇总父页及全部同源子帧中通过 injectPrompts / setExtensionPrompt 登记的运行时提示词片段 */
export function collectRuntimeInjectedPrompts(): RuntimeInjectedPromptItem[] {
	if (typeof window === "undefined") return [];
	const out: RuntimeInjectedPromptItem[] = [];
	const seen = new Set<string>();
	const wins: Window[] = [window];
	for (const f of cardRuntimeFrames()) {
		try {
			if (f.contentWindow) wins.push(f.contentWindow);
		} catch {
			/* ignore */
		}
	}
	const roleMap = (r: unknown): "system" | "user" | "assistant" => {
		if (r === 1 || r === "user") return "user";
		if (r === 2 || r === "assistant") return "assistant";
		return "system";
	};
	for (const win of wins) {
		const bag = win as unknown as {
			__liyuanInjectedPrompts?: Map<string, Record<string, unknown>>;
			__liyuanExtensionPrompts?: Record<string, Record<string, unknown>>;
		};
		if (bag.__liyuanInjectedPrompts && typeof bag.__liyuanInjectedPrompts.forEach === "function") {
			bag.__liyuanInjectedPrompts.forEach((p, key) => {
				if (!p || typeof p !== "object") return;
				const content = typeof p.content === "string" ? p.content.trim() : "";
				if (!content) return;
				const id = String(p.id ?? key);
				if (seen.has(`inj:${id}`)) return;
				seen.add(`inj:${id}`);
				const pos = p.position === "before_prompt" || p.position === "in_prompt" || p.position === "none" ? p.position : "in_chat";
				out.push({
					id,
					role: roleMap(p.role),
					position: pos,
					depth: typeof p.depth === "number" && Number.isFinite(p.depth) ? Math.max(0, Math.trunc(p.depth)) : 0,
					order: typeof p.order === "number" && Number.isFinite(p.order) ? p.order : 100,
					content,
				});
			});
		}
		if (bag.__liyuanExtensionPrompts && typeof bag.__liyuanExtensionPrompts === "object") {
			for (const [key, ep] of Object.entries(bag.__liyuanExtensionPrompts)) {
				if (!ep || typeof ep !== "object") continue;
				const content = typeof ep.value === "string" ? ep.value.trim() : "";
				if (!content) continue;
				const id = String(ep.identifier ?? key);
				if (seen.has(`ext:${id}`)) continue;
				seen.add(`ext:${id}`);
				const rawPos = ep.position;
				const position = rawPos === 0 ? "before_prompt" : rawPos === 2 ? "in_prompt" : "in_chat";
				out.push({
					id,
					role: roleMap(ep.role),
					position,
					depth: typeof ep.depth === "number" && Number.isFinite(ep.depth) ? Math.max(0, Math.trunc(ep.depth)) : 4,
					order: 100,
					content,
				});
			}
		}
	}
	return out;
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
		const w = window as Window & {
			__liyuanRuntimeContext?: LiyuanRuntimeContextSnapshot;
			__liyuanOnRuntimeContextUpdated?: (ctx: LiyuanRuntimeContextSnapshot) => void;
		};
		w.__liyuanRuntimeContext = context;
		try {
			w.__liyuanOnRuntimeContextUpdated?.(context);
		} catch (err) {
			console.error("[liyuan syncCardRuntimeContext]", err);
		}
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

