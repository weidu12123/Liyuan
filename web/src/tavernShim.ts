/**
 * 三档程序卡与作者脚本运行时宿主适配层（完整承接酒馆助手 JS-Slash-Runner 4.12.1 公开调用面 + SillyTavern 1.19.0 最小上下文投影）。
 *
 * 核心原则（06 / 07 / 08 文档）：
 * 1. 以梨园 `ScriptApiService` (`/api/script`) 与 `window.Liyuan` 为唯一真实业务底座，不另建平行数据库，
 *    不改任何送模文案、不新增送模注入点、不建作者措辞识别名单（严守梨园铁律一、二、三）。
 * 2. 事件总线打通父页与所有正式卡运行时子帧，完整导出 `tavern_events`（68 项）与 `iframe_events`（9 项），
 *    所有监听注册函数统一返回 `{ stop: () => void }`。
 * 3. 变量系统打通 7 类作用域（`chat` / `message` / `script` / `character` / `preset` / `global` / `extension`），
 *    支持同步深拷贝读取、同步/异步 `updateVariablesWith`、深合并 `insertOrAssignVariables`，并自动持久化到服务端 `<chatDir>/脚本数据` 与 `WorldState`。
 * 4. `TavernHelper.generate` 默认走后台带上下文独立生成（`generation.contextual`），绝不将后台分析提示词误当作主聊天气泡发进对话流。
 * 5. `getChatMessages` 完整支持数字、负索引与宏范围字符串（如 `"0-{{lastMessageId}}"`、`"-1"`）。
 */

import {
	emitCardRuntimeEvent,
	isCardRuntimeSource,
	isPresetScriptSource,
	type LiyuanRuntimeContextSnapshot,
} from "./cardRuntimeFrames.ts";
import { JQUERY_MIN } from "./vendor/jquery-min.ts";
import { LODASH_MIN, VUE_MIN, ZOD_YAML_MIN } from "./vendor/tavern-libs-min.ts";

export { emitCardRuntimeEvent };

export const iframe_events = {
	MESSAGE_IFRAME_RENDER_STARTED: "message_iframe_render_started",
	MESSAGE_IFRAME_RENDER_ENDED: "message_iframe_render_ended",
	GENERATION_REQUESTED: "js_generation_requested",
	GENERATION_STARTED: "js_generation_started",
	STREAM_TOKEN_RECEIVED_FULLY: "js_stream_token_received_fully",
	STREAM_TOKEN_RECEIVED_INCREMENTALLY: "js_stream_token_received_incrementally",
	REASONING_TOKEN_RECEIVED_FULLY: "js_reasoning_token_received_fully",
	REASONING_TOKEN_RECEIVED_INCREMENTALLY: "js_reasoning_token_received_incrementally",
	GENERATION_ENDED: "js_generation_ended",
} as const;

export const tavern_events = {
	APP_READY: "app_ready",
	EXTRAS_CONNECTED: "extras_connected",
	MESSAGE_SWIPED: "message_swiped",
	MESSAGE_SENT: "message_sent",
	MESSAGE_RECEIVED: "message_received",
	MESSAGE_EDITED: "message_edited",
	MESSAGE_DELETED: "message_deleted",
	MESSAGE_UPDATED: "message_updated",
	MESSAGE_FILE_EMBEDDED: "message_file_embedded",
	MESSAGE_REASONING_EDITED: "message_reasoning_edited",
	MESSAGE_REASONING_DELETED: "message_reasoning_deleted",
	MESSAGE_SWIPE_DELETED: "message_swipe_deleted",
	MORE_MESSAGES_LOADED: "more_messages_loaded",
	IMPERSONATE_READY: "impersonate_ready",
	CHAT_CHANGED: "chat_id_changed",
	GENERATION_AFTER_COMMANDS: "GENERATION_AFTER_COMMANDS",
	GENERATION_STARTED: "generation_started",
	GENERATION_STOPPED: "generation_stopped",
	GENERATION_ENDED: "generation_ended",
	SD_PROMPT_PROCESSING: "sd_prompt_processing",
	EXTENSIONS_FIRST_LOAD: "extensions_first_load",
	EXTENSION_SETTINGS_LOADED: "extension_settings_loaded",
	SETTINGS_LOADED: "settings_loaded",
	SETTINGS_UPDATED: "settings_updated",
	MOVABLE_PANELS_RESET: "movable_panels_reset",
	SETTINGS_LOADED_BEFORE: "settings_loaded_before",
	SETTINGS_LOADED_AFTER: "settings_loaded_after",
	CHATCOMPLETION_SOURCE_CHANGED: "chatcompletion_source_changed",
	CHATCOMPLETION_MODEL_CHANGED: "chatcompletion_model_changed",
	OAI_PRESET_CHANGED_BEFORE: "oai_preset_changed_before",
	OAI_PRESET_CHANGED_AFTER: "oai_preset_changed_after",
	OAI_PRESET_EXPORT_READY: "oai_preset_export_ready",
	OAI_PRESET_IMPORT_READY: "oai_preset_import_ready",
	WORLDINFO_SETTINGS_UPDATED: "worldinfo_settings_updated",
	WORLDINFO_UPDATED: "worldinfo_updated",
	CHARACTER_EDITOR_OPENED: "character_editor_opened",
	CHARACTER_EDITED: "character_edited",
	CHARACTER_PAGE_LOADED: "character_page_loaded",
	USER_MESSAGE_RENDERED: "user_message_rendered",
	CHARACTER_MESSAGE_RENDERED: "character_message_rendered",
	FORCE_SET_BACKGROUND: "force_set_background",
	CHAT_DELETED: "chat_deleted",
	CHAT_CREATED: "chat_created",
	GENERATE_BEFORE_COMBINE_PROMPTS: "generate_before_combine_prompts",
	GENERATE_AFTER_COMBINE_PROMPTS: "generate_after_combine_prompts",
	GENERATE_AFTER_DATA: "generate_after_data",
	WORLD_INFO_ACTIVATED: "world_info_activated",
	TEXT_COMPLETION_SETTINGS_READY: "text_completion_settings_ready",
	CHAT_COMPLETION_SETTINGS_READY: "chat_completion_settings_ready",
	CHAT_COMPLETION_PROMPT_READY: "chat_completion_prompt_ready",
	CHARACTER_FIRST_MESSAGE_SELECTED: "character_first_message_selected",
	CHARACTER_DELETED: "characterDeleted",
	CHARACTER_DUPLICATED: "character_duplicated",
	CHARACTER_RENAMED: "character_renamed",
	CHARACTER_RENAMED_IN_PAST_CHAT: "character_renamed_in_past_chat",
	SMOOTH_STREAM_TOKEN_RECEIVED: "stream_token_received",
	STREAM_TOKEN_RECEIVED: "stream_token_received",
	STREAM_REASONING_DONE: "stream_reasoning_done",
	FILE_ATTACHMENT_DELETED: "file_attachment_deleted",
	WORLDINFO_FORCE_ACTIVATE: "worldinfo_force_activate",
	OPEN_CHARACTER_LIBRARY: "open_character_library",
	ONLINE_STATUS_CHANGED: "online_status_changed",
	IMAGE_SWIPED: "image_swiped",
	CONNECTION_PROFILE_LOADED: "connection_profile_loaded",
	CONNECTION_PROFILE_CREATED: "connection_profile_created",
	CONNECTION_PROFILE_DELETED: "connection_profile_deleted",
	CONNECTION_PROFILE_UPDATED: "connection_profile_updated",
	TOOL_CALLS_PERFORMED: "tool_calls_performed",
	TOOL_CALLS_RENDERED: "tool_calls_rendered",
	CHARACTER_MANAGEMENT_DROPDOWN: "charManagementDropdown",
	SECRET_WRITTEN: "secret_written",
	SECRET_DELETED: "secret_deleted",
	SECRET_ROTATED: "secret_rotated",
	SECRET_EDITED: "secret_edited",
	PRESET_CHANGED: "preset_changed",
	PRESET_DELETED: "preset_deleted",
	PRESET_RENAMED: "preset_renamed",
	PRESET_RENAMED_BEFORE: "preset_renamed_before",
	MAIN_API_CHANGED: "main_api_changed",
	WORLDINFO_ENTRIES_LOADED: "worldinfo_entries_loaded",
	WORLDINFO_SCAN_DONE: "worldinfo_scan_done",
	MEDIA_ATTACHMENT_DELETED: "media_attachment_deleted",
} as const;

export type TavernGenerateParams = {
	generation_id?: string;
	user_input?: string;
	prompt?: string;
	systemPrompt?: string;
	messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
	ordered_prompts?: Array<unknown>;
	injects?: Array<unknown>;
	overrides?: Record<string, unknown>;
	max_chat_history?: "all" | number;
	should_stream?: boolean;
	should_silence?: boolean;
	should_return_reasoning?: boolean;
	use_preset?: boolean;
	preset_name?: string;
	disable_extras?: boolean;
	mode?: "chat" | "contextual" | "explicit";
	[k: string]: unknown;
};

export interface LiyuanScriptCallOptions {
	target?: {
		card?: string;
		chatId?: string | null;
		sessionId?: string;
		leafId?: string | null;
	};
	scriptId?: string;
	requestId?: string;
}

export interface LiyuanScriptEnvelope<T = unknown> {
	ok: boolean;
	action: string;
	requestId: string;
	status?: "accepted" | "completed" | "committed" | "refreshed";
	target?: {
		card: string;
		cardName: string;
		charName: string;
		userName: string;
		chatId: string | null;
		sessionId: string;
		leafId: string | null;
		mode: "roleplay" | "agent";
		streaming: boolean;
	};
	result?: T;
	error?: {
		code: string;
		message: string;
	};
}

type ScriptApiTransport = (
	action: string,
	params?: Record<string, unknown>,
	opts?: LiyuanScriptCallOptions,
) => Promise<LiyuanScriptEnvelope>;

let customScriptTransport: ScriptApiTransport | null = null;

/** 供测试或宿主显式注入脚本 API 传输函数；默认走同源 POST /api/script */
export function registerLiyuanScriptTransport(fn: ScriptApiTransport | null): void {
	customScriptTransport = fn;
}

export async function callLiyuanScriptApi<T = unknown>(
	action: string,
	params: Record<string, unknown> = {},
	opts: LiyuanScriptCallOptions = {},
): Promise<LiyuanScriptEnvelope<T>> {
	if (customScriptTransport) {
		return (await customScriptTransport(action, params, opts)) as LiyuanScriptEnvelope<T>;
	}
	if (typeof fetch !== "function") {
		return {
			ok: false,
			action,
			requestId: opts.requestId ?? "offline",
			error: { code: "execution_failed", message: "当前环境不支持 fetch" },
		};
	}
	try {
		const res = await fetch("/api/script", {
			method: "POST",
			credentials: "same-origin",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				action,
				params,
				...(opts.target ? { target: opts.target } : {}),
				...(opts.scriptId ? { scriptId: opts.scriptId } : {}),
				...(opts.requestId ? { requestId: opts.requestId } : {}),
			}),
		});
		const data = (await res.json()) as LiyuanScriptEnvelope<T>;
		return data;
	} catch (err) {
		return {
			ok: false,
			action,
			requestId: opts.requestId ?? "error",
			error: {
				code: "execution_failed",
				message: err instanceof Error ? err.message : String(err),
			},
		};
	}
}

/** App 注册：把卡侧 slash / generate 接到输入框与 WS prompt */
export type TavernChatBridge = {
	/** 只填输入框，不发送 */
	setInput: (text: string) => void;
	/** 作为用户消息发送并触发生成（空串 = 发送当前输入框内容） */
	sendPrompt: (text: string) => void;
	/** 可选：执行梨园斜杠命令原文（如 /rewind） */
	runCommand?: (text: string) => void;
};

type ListenerFn = (...args: unknown[]) => unknown;
type BusMap = Map<string, Set<ListenerFn>>;

let chatBridge: TavernChatBridge | null = null;

export function registerTavernChatBridge(bridge: TavernChatBridge | null): void {
	chatBridge = bridge;
}

export type LiyuanToastLevel = "info" | "warning" | "error";

export function registerLiyuanToast(fn: ((level: LiyuanToastLevel, text: string) => void) | null): void {
	if (typeof window === "undefined") return;
	const w = window as Window & { __liyuanToast?: (level: LiyuanToastLevel, text: string) => void };
	if (fn) w.__liyuanToast = fn;
	else delete w.__liyuanToast;
}

const MESSAGE_ID_NORMALIZE_EVENTS = new Set<string>([
	tavern_events.MESSAGE_SWIPED,
	tavern_events.MESSAGE_SENT,
	tavern_events.MESSAGE_RECEIVED,
	tavern_events.MESSAGE_EDITED,
	tavern_events.MESSAGE_UPDATED,
	tavern_events.USER_MESSAGE_RENDERED,
	tavern_events.CHARACTER_MESSAGE_RENDERED,
]);

function getBus(target: object): BusMap {
	const w = target as { __liyuanEventBus?: BusMap };
	if (!w.__liyuanEventBus) w.__liyuanEventBus = new Map();
	return w.__liyuanEventBus;
}

export type EventOnReturn = {
	stop: () => void;
};

/** 挂完整酒馆助手事件函数族与 tavern_events / iframe_events（每个函数均返回 { stop }） */
export function installEventBus(target: object = typeof window !== "undefined" ? window : {}): void {
	const t = target as {
		eventOn?: (name: string, cb: ListenerFn) => EventOnReturn;
		eventOnce?: (name: string, cb: ListenerFn) => EventOnReturn;
		eventMakeFirst?: (name: string, cb: ListenerFn) => EventOnReturn;
		eventMakeLast?: (name: string, cb: ListenerFn) => EventOnReturn;
		eventOnButton?: (name: string, cb: ListenerFn) => EventOnReturn;
		eventEmit?: (name: string, ...args: unknown[]) => Promise<void>;
		eventEmitAndWait?: (name: string, ...args: unknown[]) => void;
		eventRemoveListener?: (name: string, cb: ListenerFn) => void;
		eventClearEvent?: (name: string) => void;
		eventClearListener?: (cb: ListenerFn) => void;
		eventClearAll?: () => void;
		tavern_events?: typeof tavern_events;
		iframe_events?: typeof iframe_events;
		__liyuanWrapperMap?: Map<string, Map<ListenerFn, ListenerFn>>;
		__liyuanStickyEvents?: Record<string, unknown[]>;
	};
	t.tavern_events = tavern_events;
	t.iframe_events = iframe_events;

	const bus = getBus(target);
	if (!t.__liyuanWrapperMap) t.__liyuanWrapperMap = new Map();
	const wrapperMap = t.__liyuanWrapperMap;

	const removeListener = (name: string, cb: ListenerFn) => {
		const set = bus.get(name);
		const mapForEvent = wrapperMap.get(name);
		const wrapped = mapForEvent?.get(cb) ?? cb;
		mapForEvent?.delete(cb);
		set?.delete(wrapped);
		set?.delete(cb);
	};

	const wrapListener = (name: string, cb: ListenerFn, once = false): ListenerFn => {
		let mapForEvent = wrapperMap.get(name);
		if (!mapForEvent) {
			mapForEvent = new Map();
			wrapperMap.set(name, mapForEvent);
		}
		const existing = mapForEvent.get(cb);
		if (existing) return existing;
		const wrapped: ListenerFn = (...rawArgs: unknown[]) => {
			const args = [...rawArgs];
			if (MESSAGE_ID_NORMALIZE_EVENTS.has(name) && args.length > 0) {
				const parsed = Number.parseInt(String(args[0]), 10);
				if (Number.isNaN(parsed)) return undefined;
				args[0] = parsed;
			}
			try {
				return cb(...args);
			} finally {
				if (once) {
					removeListener(name, cb);
				}
			}
		};
		mapForEvent.set(cb, wrapped);
		return wrapped;
	};

	t.eventOn = (name, cb) => {
		const wrapped = wrapListener(name, cb, false);
		if (!bus.has(name)) bus.set(name, new Set());
		bus.get(name)!.add(wrapped);
		if ((name === tavern_events.APP_READY || name === "APP_READY") && t.__liyuanStickyEvents?.app_ready) {
			const stickyArgs = t.__liyuanStickyEvents.app_ready;
			Promise.resolve().then(() => {
				try {
					wrapped(...stickyArgs);
				} catch (e) {
					console.error("[liyuan APP_READY]", e);
				}
			});
		}
		return { stop: () => removeListener(name, cb) };
	};

	t.eventOnce = (name, cb) => {
		const wrapped = wrapListener(name, cb, true);
		if (!bus.has(name)) bus.set(name, new Set());
		bus.get(name)!.add(wrapped);
		return { stop: () => removeListener(name, cb) };
	};

	t.eventMakeFirst = (name, cb) => {
		const wrapped = wrapListener(name, cb, false);
		const cur = bus.get(name);
		if (!cur || cur.size === 0) {
			bus.set(name, new Set([wrapped]));
		} else {
			const next = new Set<ListenerFn>([wrapped]);
			for (const item of cur) {
				if (item !== wrapped) next.add(item);
			}
			bus.set(name, next);
		}
		return { stop: () => removeListener(name, cb) };
	};

	t.eventMakeLast = (name, cb) => {
		const wrapped = wrapListener(name, cb, false);
		if (!bus.has(name)) bus.set(name, new Set());
		const set = bus.get(name)!;
		set.delete(wrapped);
		set.add(wrapped);
		return { stop: () => removeListener(name, cb) };
	};

	t.eventOnButton = (btnName, cb) => {
		return t.eventOn!(btnName, cb);
	};

	t.eventRemoveListener = removeListener;

	t.eventClearEvent = (name) => {
		bus.delete(name);
		wrapperMap.delete(name);
	};

	t.eventClearListener = (cb) => {
		for (const name of bus.keys()) {
			removeListener(name, cb);
		}
	};

	t.eventClearAll = () => {
		bus.clear();
		wrapperMap.clear();
	};

	t.eventEmit = async (name, ...args) => {
		const set = bus.get(name);
		if (!set) return;
		for (const cb of [...set]) {
			try {
				await cb(...args);
			} catch (e) {
				console.error("[liyuan eventEmit]", name, e);
			}
		}
	};

	t.eventEmitAndWait = (name, ...args) => {
		const set = bus.get(name);
		if (!set) return;
		for (const cb of [...set]) {
			try {
				cb(...args);
			} catch (e) {
				console.error("[liyuan eventEmitAndWait]", name, e);
			}
		}
	};
}

/**
 * 解析酒馆式管道斜杠：`/send 文本|/trigger`
 * 分段以 `|` 分隔（ST STscript 同款）。
 */
export function parseSlashPipeline(raw: string): string[] {
	return String(raw ?? "")
		.split("|")
		.map((s) => s.trim())
		.filter(Boolean);
}

export type SlashExecResult = {
	ok: boolean;
	/** 已填入输入框或已发送的正文 */
	text?: string;
	/** 是否触发了生成 */
	triggered?: boolean;
	/** 仅填入输入框未发送 */
	filledOnly?: boolean;
	error?: string;
};

/**
 * 执行 triggerSlash 命令串（纯逻辑，可测）。
 * 支持：/send、/trigger、/setvar、/getvar，以及管道组合。
 */
export function executeTriggerSlash(
	raw: string,
	bridge: TavernChatBridge | null,
): SlashExecResult {
	if (!bridge) {
		return { ok: false, error: "聊天桥未就绪（App 未注册 TavernChatBridge）" };
	}
	const parts = parseSlashPipeline(raw);
	if (!parts.length) return { ok: false, error: "空命令" };

	let pendingSend = "";
	let wantTrigger = false;
	let filledOnly = false;

	for (const part of parts) {
		const cmd = part.startsWith("/") ? part : `/${part}`;
		const mName = /^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/.exec(cmd);
		if (mName && typeof window !== "undefined") {
			const cname = mName[1];
			const cargs = (mName[2] ?? "").trim();
			const st = (window as unknown as { SillyTavern?: { SlashCommandParser?: { commands?: Record<string, { callback?: (named: Record<string, unknown>, unnamed: string) => unknown }> } } }).SillyTavern;
			const regCmd = st?.SlashCommandParser?.commands?.[cname];
			if (regCmd && typeof regCmd.callback === "function") {
				try {
					const out = regCmd.callback({}, cargs);
					return { ok: true, text: typeof out === "string" ? out : "" };
				} catch (e) {
					return { ok: false, error: e instanceof Error ? e.message : String(e) };
				}
			}
		}
		const mSend = cmd.match(/^\/send(?:as)?(?:\s+name=[^\s]+)?\s*([\s\S]*)$/i);
		if (mSend) {
			pendingSend = (mSend[1] ?? "").trim();
			continue;
		}
		if (/^\/trigger\b/i.test(cmd)) {
			wantTrigger = true;
			continue;
		}
		// 其它斜杠：尽量当梨园命令
		if (cmd.startsWith("/") && bridge.runCommand) {
			try {
				bridge.runCommand(cmd);
			} catch (e) {
				console.warn("[liyuan triggerSlash] runCommand", cmd, e);
			}
			continue;
		}
		console.warn("[liyuan triggerSlash] 未识别命令", cmd);
	}

	if (wantTrigger) {
		const text = pendingSend;
		try {
			bridge.sendPrompt(text);
			return { ok: true, text, triggered: true };
		} catch (e) {
			return { ok: false, error: e instanceof Error ? e.message : String(e) };
		}
	}

	if (pendingSend) {
		try {
			bridge.setInput(pendingSend);
			filledOnly = true;
			return { ok: true, text: pendingSend, filledOnly };
		} catch (e) {
			return { ok: false, error: e instanceof Error ? e.message : String(e) };
		}
	}

	return { ok: true };
}

/** 父页全局 triggerSlash（iframe 通过 parent 或 postMessage 调用） */
export async function triggerSlash(raw: string): Promise<string> {
	const r = executeTriggerSlash(raw, chatBridge);
	if (!r.ok) {
		console.warn("[liyuan triggerSlash]", r.error, raw?.slice?.(0, 80));
		return r.error || "";
	}
	return r.text || "";
}

/** 父页安装：卡脚本通过 window.parent.Liyuan / TavernHelper / SillyTavern / TheaterAPI / triggerSlash 访问 */
export function installParentTavernShim(): void {
	if (typeof window === "undefined") return;
	const w = window as unknown as Window & {
		__liyuanTavernShimInstalled?: boolean;
		__liyuanRuntimeContext?: LiyuanRuntimeContextSnapshot;
		Liyuan?: Record<string, unknown>;
		TavernHelper?: Record<string, unknown>;
		SillyTavern?: Record<string, unknown>;
		TheaterAPI?: { call: (method: string, ...args: unknown[]) => Promise<unknown> };
		handleTheaterAction?: (msg: unknown) => void;
		triggerSlash?: (cmd: string) => Promise<string> | string;
		triggerSlashWithResult?: (cmd: string) => Promise<string> | string;
	};
	if (w.__liyuanTavernShimInstalled) return;
	w.__liyuanTavernShimInstalled = true;

	try {
		const wg = w as unknown as Record<string, unknown>;
		if (typeof wg._ !== "function") {
			new Function(LODASH_MIN).call(w);
		}
		if (!wg.z || !wg.YAML) {
			new Function(ZOD_YAML_MIN).call(w);
		}
		if (!wg.Vue) {
			new Function(`${VUE_MIN};if(typeof Vue!=="undefined")this.Vue=Vue;`).call(w);
		}
	} catch (err) {
		console.error("[liyuan tavern-libs init]", err);
	}

	installEventBus(w);

	const canCallServer = (): boolean => {
		if (customScriptTransport) return true;
		const loc = (w as unknown as { location?: { origin?: string; protocol?: string } }).location;
		return !!loc && typeof loc.origin === "string" && /^https?:/i.test(loc.origin);
	};

	const invoke = (
		action: string,
		params: Record<string, unknown> = {},
		opts: LiyuanScriptCallOptions = {},
	) => callLiyuanScriptApi(action, params, opts);

	w.Liyuan = {
		version: "1.0.0",
		call: invoke,
		getSnapshot: () => w.__liyuanRuntimeContext ?? null,
		context: {
			read: (opts?: LiyuanScriptCallOptions) => invoke("context.read", {}, opts),
			capabilities: (opts?: LiyuanScriptCallOptions) => invoke("capabilities.read", {}, opts),
		},
		messages: {
			list: (params?: Record<string, unknown>, opts?: LiyuanScriptCallOptions) => invoke("messages.list", params ?? {}, opts),
			get: (params?: Record<string, unknown>, opts?: LiyuanScriptCallOptions) => invoke("messages.get", params ?? {}, opts),
			updateReply: (text: string, opts?: LiyuanScriptCallOptions) => invoke("messages.updateReply", { text }, opts),
			dropLast: (opts?: LiyuanScriptCallOptions) => invoke("messages.dropLast", {}, opts),
		},
		state: {
			read: (opts?: LiyuanScriptCallOptions) => invoke("state.read", {}, opts),
			commit: (patch: Record<string, unknown>, opts?: LiyuanScriptCallOptions) => invoke("state.commit", { patch }, opts),
		},
		data: {
			read: (params?: Record<string, unknown>, opts?: LiyuanScriptCallOptions) => invoke("data.read", params ?? {}, opts),
			write: (params: Record<string, unknown>, opts?: LiyuanScriptCallOptions) => invoke("data.write", params, opts),
			remove: (params?: Record<string, unknown>, opts?: LiyuanScriptCallOptions) => invoke("data.remove", params ?? {}, opts),
		},
		chat: {
			submit: (params: { text: string; directorNote?: string; wait?: boolean } | string, opts?: LiyuanScriptCallOptions) =>
				invoke("chat.submit", typeof params === "string" ? { text: params } : params, opts),
			regenerate: (params?: { text?: string; directorNote?: string; wait?: boolean }, opts?: LiyuanScriptCallOptions) =>
				invoke("chat.regenerate", params ?? {}, opts),
			abort: (opts?: LiyuanScriptCallOptions) => invoke("requests.cancel", { includeMainChat: true }, opts),
		},
		generation: {
			explicit: (params: Record<string, unknown>, opts?: LiyuanScriptCallOptions) => invoke("generation.explicit", params, opts),
			contextual: (params: Record<string, unknown>, opts?: LiyuanScriptCallOptions) => invoke("generation.contextual", params, opts),
		},
		requests: {
			cancel: (targetRequestId?: string, opts?: LiyuanScriptCallOptions) =>
				invoke("requests.cancel", targetRequestId ? { targetRequestId } : {}, opts),
			observe: (targetRequestId?: string, opts?: LiyuanScriptCallOptions) =>
				invoke("requests.observe", targetRequestId ? { targetRequestId } : {}, opts),
		},
		lorebooks: {
			list: (opts?: LiyuanScriptCallOptions) => invoke("lorebooks.list", {}, opts),
			read: (params?: Record<string, unknown>, opts?: LiyuanScriptCallOptions) => invoke("lorebooks.read", params ?? {}, opts),
			createEntry: (params: Record<string, unknown>, opts?: LiyuanScriptCallOptions) => invoke("lorebooks.createEntry", params, opts),
			updateEntry: (params: Record<string, unknown>, opts?: LiyuanScriptCallOptions) => invoke("lorebooks.updateEntry", params, opts),
			removeEntry: (fingerprint: string, opts?: LiyuanScriptCallOptions) => invoke("lorebooks.removeEntry", { fingerprint }, opts),
			mount: (path: string, mounted = true, opts?: LiyuanScriptCallOptions) => invoke("lorebooks.mount", { path, mounted }, opts),
		},
		preset: {
			list: (opts?: LiyuanScriptCallOptions) => invoke("preset.list", {}, opts),
			get: (params?: { name?: string; includeRaw?: boolean } | string, opts?: LiyuanScriptCallOptions) =>
				invoke("preset.get", typeof params === "string" ? { name: params } : (params ?? {}), opts),
			update: (params: Record<string, unknown>, opts?: LiyuanScriptCallOptions) => invoke("preset.update", params, opts),
		},
		project: {
			files: {
				list: (opts?: LiyuanScriptCallOptions) => invoke("project.files.list", {}, opts),
				read: (path: string, opts?: LiyuanScriptCallOptions) => invoke("project.files.read", { path }, opts),
				write: (path: string, content: string, opts?: LiyuanScriptCallOptions) => invoke("project.files.write", { path, content }, opts),
				remove: (path: string, opts?: LiyuanScriptCallOptions) => invoke("project.files.remove", { path }, opts),
			},
		},
		panels: {
			list: (opts?: LiyuanScriptCallOptions) => invoke("panels.list", {}, opts),
			write: (params: Record<string, unknown>, opts?: LiyuanScriptCallOptions) => invoke("panels.write", params, opts),
			close: (name: string, opts?: LiyuanScriptCallOptions) => invoke("panels.close", { name }, opts),
		},
		story: {
			list: (opts?: LiyuanScriptCallOptions) => invoke("story.list", {}, opts),
			read: (name?: string, opts?: LiyuanScriptCallOptions) => invoke("story.read", name ? { name } : {}, opts),
			write: (name: string, text: string | null, opts?: LiyuanScriptCallOptions) => invoke("story.write", { name, text }, opts),
		},
		worldline: {
			list: (opts?: LiyuanScriptCallOptions) => invoke("worldline.list", {}, opts),
		},
		models: {
			list: (opts?: LiyuanScriptCallOptions) => invoke("models.list", {}, opts),
		},
		text: {
			macros: (text: string, vars?: Record<string, unknown>, opts?: LiyuanScriptCallOptions) =>
				invoke("text.macros", { text, ...(vars ? { vars } : {}) }, opts),
			transform: (text: string, mode: "display" | "prompt" = "display", rules?: unknown[], opts?: LiyuanScriptCallOptions) =>
				invoke("text.transform", { text, mode, ...(rules ? { rules } : {}) }, opts),
			ejs: (code: string, context?: Record<string, unknown>, opts?: LiyuanScriptCallOptions) =>
				invoke("text.ejs", { code, ...(context ? { context } : {}) }, opts),
		},
		ui: {
			notify: (level: LiyuanToastLevel, text: string, opts?: LiyuanScriptCallOptions) =>
				invoke("ui.notify", { level, text }, opts),
		},
	};

	w.triggerSlash = (cmd: string) => triggerSlash(cmd);
	w.triggerSlashWithResult = w.triggerSlash;

	if (typeof window.addEventListener === "function") {
		window.addEventListener("message", (ev: MessageEvent) => {
			const d = ev.data as {
				liyuanTriggerSlash?: unknown;
				liyuanScriptRpc?: {
					id?: unknown;
					action?: unknown;
					params?: unknown;
					opts?: unknown;
				};
				liyuanGlobalInit?: {
					name?: unknown;
				};
			} | null;
			if (!d || typeof d !== "object" || !isCardRuntimeSource(ev.source)) return;
			const isPresetSrc = isPresetScriptSource(ev.source);
			if (typeof d.liyuanTriggerSlash === "string") {
				if (
					isPresetSrc &&
					/(?:^|\|)\s*\/(?:del|delete|drop|hide|unhide|cut|editreply|send|sendas|trigger|reroll|swipe|continue|regenerate)(?:\b|\s|$)/i.test(
						d.liyuanTriggerSlash,
					)
				) {
					return;
				}
				void triggerSlash(d.liyuanTriggerSlash);
				return;
			}
			if (d.liyuanGlobalInit && typeof d.liyuanGlobalInit.name === "string") {
				emitCardRuntimeEvent(`global_${d.liyuanGlobalInit.name}_initialized`);
				return;
			}
			if (d.liyuanScriptRpc && typeof d.liyuanScriptRpc === "object") {
				const rpc = d.liyuanScriptRpc;
				const id = String(rpc.id ?? "");
				const action = String(rpc.action ?? "");
				const params = rpc.params && typeof rpc.params === "object" ? (rpc.params as Record<string, unknown>) : {};
				const opts = rpc.opts && typeof rpc.opts === "object" ? (rpc.opts as LiyuanScriptCallOptions) : {};
				if (
					isPresetSrc &&
					(action === "preset.update" ||
						action === "lorebooks.createEntry" ||
						action === "lorebooks.updateEntry" ||
						action === "lorebooks.removeEntry" ||
						action === "lorebooks.mount" ||
						action === "messages.updateReply" ||
						action === "messages.dropLast" ||
						action === "chat.submit" ||
						action === "chat.regenerate" ||
						action === "generation.explicit" ||
						action === "generation.contextual")
				) {
					const deniedMsg =
						action === "preset.update"
							? "梨园预设仅允许通过梨园预设面板修改，预设脚本无权修改预设"
							: action.startsWith("lorebooks.")
								? "梨园世界书归用户与角色卡管理，预设脚本无权修改世界书"
								: action.startsWith("messages.")
									? "梨园已保护对话历史，预设脚本无权删改消息正文"
									: "预设脚本无权触发对话发送或后台独立生成";
					try {
						(ev.source as Window).postMessage(
							{
								liyuanScriptRpcResult: {
									id,
									envelope: {
										ok: false,
										action,
										requestId: id || "protected",
										error: { code: "permission_denied", message: deniedMsg },
									},
								},
							},
							"*",
						);
					} catch {
						/* ignore */
					}
					return;
				}
				void invoke(action, params, opts).then((envelope) => {
					try {
						(ev.source as Window).postMessage({ liyuanScriptRpcResult: { id, envelope } }, "*");
					} catch {
						/* ignore */
					}
				});
			}
		});
	}

	let genSeq = 0;

	const runHelperGenerate = async (params: TavernGenerateParams | undefined, forceRaw: boolean): Promise<string> => {
		const cfg = (params ?? {}) as TavernGenerateParams;
		const genId = typeof cfg.generation_id === "string" && cfg.generation_id.trim()
			? cfg.generation_id.trim()
			: `thgen_${Date.now()}_${++genSeq}`;
		const input = String(cfg.user_input ?? cfg.prompt ?? "").trim();

		if (canCallServer()) {
			emitCardRuntimeEvent(iframe_events.GENERATION_REQUESTED, genId, forceRaw ? "generateRaw" : "generate", cfg);
			emitCardRuntimeEvent(iframe_events.GENERATION_STARTED, genId);
			// 酒馆助手的 generate 是带上下文的后台独立生成（不追加主聊天气泡）；
			// 仅当调用方显式指定 mode === "chat" 时才走 chat.submit。
			const action =
				cfg.mode === "chat"
					? "chat.submit"
					: forceRaw || cfg.mode === "explicit" || cfg.use_preset === false || Array.isArray(cfg.messages) || Array.isArray(cfg.ordered_prompts)
						? "generation.explicit"
						: "generation.contextual";
			const env = await invoke(
				action,
				{
					...cfg,
					prompt: cfg.prompt ?? cfg.user_input ?? "",
				},
				{ requestId: genId },
			);
			if (env.ok && env.result && typeof (env.result as { text?: unknown }).text === "string") {
				const outText = (env.result as { text: string; thinking?: string }).text;
				const outThinking = (env.result as { thinking?: string }).thinking ?? "";
				if (cfg.should_stream) {
					if (outThinking) {
						emitCardRuntimeEvent(iframe_events.REASONING_TOKEN_RECEIVED_INCREMENTALLY, outThinking, genId);
						emitCardRuntimeEvent(iframe_events.REASONING_TOKEN_RECEIVED_FULLY, outThinking, genId);
					}
					emitCardRuntimeEvent(iframe_events.STREAM_TOKEN_RECEIVED_INCREMENTALLY, outText, genId);
					emitCardRuntimeEvent(iframe_events.STREAM_TOKEN_RECEIVED_FULLY, outText, genId);
				}
				emitCardRuntimeEvent(iframe_events.GENERATION_ENDED, outText, genId, outThinking || undefined);
				return outText;
			}
			if (!env.ok && env.error) {
				throw new Error(env.error.message);
			}
		}

		if (!forceRaw && chatBridge && input) {
			try {
				chatBridge.sendPrompt(input);
				return input;
			} catch (e) {
				console.warn("[liyuan TavernHelper.generate]", e);
			}
		}
		console.warn("[liyuan TavernHelper.generate] 无服务端或空输入", {
			len: input.length,
			stream: cfg.should_stream,
		});
		return `（梨园：界面内 AI 生成未接入聊天桥。输入：${input.slice(0, 80) || "（空）"}）`;
	};

	w.TavernHelper = {
		tavern_events,
		iframe_events,
		generate: (params?: TavernGenerateParams) => runHelperGenerate(params, false),
		generateRaw: (params?: TavernGenerateParams) => runHelperGenerate(params, true),
		stopGenerationById: (generationId: string) => {
			if (canCallServer() && generationId) {
				void invoke("requests.cancel", { targetRequestId: generationId });
				emitCardRuntimeEvent(tavern_events.GENERATION_STOPPED, generationId);
			}
		},
		stopAllGeneration() {
			if (canCallServer()) {
				void invoke("requests.cancel", { includeMainChat: true });
				emitCardRuntimeEvent(tavern_events.GENERATION_STOPPED);
				return;
			}
			console.warn("[liyuan TavernHelper.stopAllGeneration] no-op");
		},
		triggerSlash: (cmd: string) => triggerSlash(cmd),
		triggerSlashWithResult: (cmd: string) => triggerSlash(cmd),
		getTavernHelperVersion: () => "4.12.1",
		getFrontendVersion: () => "4.12.1",
		getTavernVersion: () => "1.19.0",
	};

	w.TheaterAPI = {
		async call(method, ...args) {
			const first = args[0];
			const params =
				first && typeof first === "object" && !Array.isArray(first)
					? (first as Record<string, unknown>)
					: args.length > 0
						? { value: first, args }
						: {};
			const opts = args[1] && typeof args[1] === "object" ? (args[1] as LiyuanScriptCallOptions) : {};
			if (canCallServer()) {
				return await invoke(method, params, opts);
			}
			console.warn("[liyuan TheaterAPI.call]", method, args?.length ?? 0);
			return null;
		},
	};

	w.handleTheaterAction = (msg) => {
		if (msg && typeof msg === "object" && typeof (msg as { action?: unknown }).action === "string" && canCallServer()) {
			const m = msg as { action: string; params?: Record<string, unknown>; opts?: LiyuanScriptCallOptions };
			void invoke(m.action, m.params ?? {}, m.opts ?? {});
			return;
		}
		console.warn("[liyuan handleTheaterAction]", msg);
	};

	try {
		const rawGlobals = IFRAME_TAVERN_GLOBALS_SNIPPET.replace(/^<script>|<\/script>$/g, "");
		new Function(rawGlobals).call(w);
	} catch (err) {
		console.error("[liyuan parent globals init]", err);
	}
}

/**
 * 注入到脚本帧 head 最前：同源下挂 Liyuan + TavernHelper + TheaterAPI + triggerSlash + 事件总线；
 * 并尽量镜像 parent（双保险）；跨域则 postMessage RPC。
 */
export const IFRAME_TAVERN_BRIDGE_SNIPPET = `<script>(function(){
try{
  var g=typeof window!=="undefined"?window:null;if(!g)return;
  var TAVERN_EVENTS=${JSON.stringify(tavern_events)};
  var IFRAME_EVENTS=${JSON.stringify(iframe_events)};
  g.tavern_events=TAVERN_EVENTS;
  g.iframe_events=IFRAME_EVENTS;
  function readCtxQuick(){
    var c=g.__liyuanRuntimeContext;
    if(!c){try{var pw=g.parent&&g.parent!==g?g.parent:null;if(pw&&pw.__liyuanRuntimeContext)c=pw.__liyuanRuntimeContext;}catch(e){}}
    return (c&&typeof c==="object")?c:null;
  }
  function isPresetScriptFrame(){
    var n="";
    try{if(g.frameElement&&(g.frameElement.id||g.frameElement.name))n=String(g.frameElement.id||g.frameElement.name);}catch(e){}
    if(!n)n=String(g.__TH_IFRAME_ID||g.name||"");
    return /^TH-script--preset--/.test(n);
  }
  function isBlockedPresetSlash(cmd){
    return /(?:^|\\|)\\s*\\/(?:del|delete|drop|hide|unhide|cut|editreply|send|sendas|trigger|reroll|swipe|continue|regenerate)(?:\\b|\\s|$)/i.test(String(cmd||""));
  }
  g.__liyuanIsPresetScriptFrame=isPresetScriptFrame;
  var MSG_ID_EVENTS={"message_swiped":1,"message_sent":1,"message_received":1,"message_edited":1,"message_updated":1,"user_message_rendered":1,"character_message_rendered":1};
  function bus(){if(!g.__liyuanEventBus)g.__liyuanEventBus=new Map();return g.__liyuanEventBus;}
  function wmap(){if(!g.__liyuanWrapperMap)g.__liyuanWrapperMap=new Map();return g.__liyuanWrapperMap;}
  function rmListener(name,cb){
    var b=bus(),m=wmap().get(name),w=m?m.get(cb):null;
    if(m)m.delete(cb);
    var s=b.get(name);
    if(s){if(w)s.delete(w);s.delete(cb);}
  }
  function wrapFn(name,cb,once){
    var m=wmap();
    if(!m.has(name))m.set(name,new Map());
    var em=m.get(name);
    if(em.has(cb))return em.get(cb);
    var ownerSid=g.__liyuanCurrentScriptId;
    var w=function(){
      var args=[].slice.call(arguments);
      if(MSG_ID_EVENTS[name]&&args.length>0){
        var n=parseInt(args[0],10);
        if(isNaN(n))return;
        args[0]=n;
      }
      var prevSid=g.__liyuanCurrentScriptId;
      if(ownerSid)g.__liyuanCurrentScriptId=ownerSid;
      try{return cb.apply(g,args);}finally{if(ownerSid)g.__liyuanCurrentScriptId=prevSid;if(once)rmListener(name,cb);}
    };
    em.set(cb,w);
    return w;
  }
  g.eventOn=function(name,cb){
    var w=wrapFn(name,cb,false),b=bus();
    if(!b.has(name))b.set(name,new Set());
    b.get(name).add(w);
    if(name===TAVERN_EVENTS.APP_READY||name==="APP_READY"){
      setTimeout(function(){try{w();}catch(e){console.error(e);}},0);
    }
    return {stop:function(){rmListener(name,cb);}};
  };
  g.eventOnce=function(name,cb){
    var w=wrapFn(name,cb,true),b=bus();
    if(!b.has(name))b.set(name,new Set());
    b.get(name).add(w);
    return {stop:function(){rmListener(name,cb);}};
  };
  g.eventMakeFirst=function(name,cb){
    var w=wrapFn(name,cb,false),b=bus(),cur=b.get(name);
    if(!cur||cur.size===0){b.set(name,new Set([w]));}
    else{var nxt=new Set([w]);cur.forEach(function(x){if(x!==w)nxt.add(x);});b.set(name,nxt);}
    return {stop:function(){rmListener(name,cb);}};
  };
  g.eventMakeLast=function(name,cb){
    var w=wrapFn(name,cb,false),b=bus();
    if(!b.has(name))b.set(name,new Set());
    var s=b.get(name);s.delete(w);s.add(w);
    return {stop:function(){rmListener(name,cb);}};
  };
  g.eventOnButton=function(name,cb){return g.eventOn(name,cb);};
  g.eventRemoveListener=rmListener;
  g.eventClearEvent=function(name){bus().delete(name);wmap().delete(name);};
  g.eventClearListener=function(cb){bus().forEach(function(_s,k){rmListener(k,cb);});};
  g.eventClearAll=function(){bus().clear();wmap().clear();};
  g.eventEmit=function(name){
    var args=[].slice.call(arguments,1),b=bus(),s=b.get(name);
    if(!s)return Promise.resolve();
    var list=Array.from(s);
    return list.reduce(function(p,cb){
      return p.then(function(){try{return cb.apply(g,args);}catch(e){console.error(e);}});
    },Promise.resolve());
  };
  g.eventEmitAndWait=function(name){
    var args=[].slice.call(arguments,1),b=bus(),s=b.get(name);
    if(!s)return;
    Array.from(s).forEach(function(cb){try{cb.apply(g,args);}catch(e){console.error(e);}});
  };
  function parentWin(){try{return g.parent&&g.parent!==g?g.parent:null;}catch(e){return null;}}
  function parentTH(){var p=parentWin();return p&&p.TavernHelper?p.TavernHelper:null;}
  var rpcSeq=0,rpcPending=new Map();
  if(typeof g.addEventListener==="function"){
    g.addEventListener("message",function(ev){
      var d=ev&&ev.data;
      if(!d||typeof d!=="object")return;
      if(d.liyuanScriptRpcResult&&typeof d.liyuanScriptRpcResult==="object"){
        var r=d.liyuanScriptRpcResult,cb=rpcPending.get(String(r.id||""));
        if(cb){rpcPending.delete(String(r.id||""));cb(r.envelope);}
      }
      if(d.liyuanTavernEvent&&typeof d.liyuanTavernEvent==="object"){
        var tev=d.liyuanTavernEvent;
        if(typeof tev.type==="string"){
          var eargs=Array.isArray(tev.args)?tev.args:[];
          g.eventEmit.apply(g,[tev.type].concat(eargs));
        }
      }
    });
  }
  function rpcCall(action,params,opts){
    var p=parentWin();
    try{
      if(p&&p.Liyuan&&typeof p.Liyuan.call==="function"){
        return p.Liyuan.call(action,params||{},opts||{});
      }
    }catch(e){}
    if(p&&typeof p.postMessage==="function"){
      return new Promise(function(resolve){
        var id="irpc_"+(++rpcSeq)+"_"+Date.now();
        rpcPending.set(id,resolve);
        try{p.postMessage({liyuanScriptRpc:{id:id,action:action,params:params||{},opts:opts||{}}},"*");}
        catch(e2){rpcPending.delete(id);resolve({ok:false,action:action,requestId:id,error:{code:"execution_failed",message:String(e2)}});}
      });
    }
    return Promise.resolve({ok:false,action:action,requestId:"offline",error:{code:"execution_failed",message:"未连接父窗口"}});
  }
  function guardedRpcCall(action,params,opts){
    if(isPresetScriptFrame()){
      if(action==="preset.update"){
        return Promise.resolve({ok:false,action:action,requestId:"protected",error:{code:"permission_denied",message:"梨园预设仅允许通过梨园预设面板修改，预设脚本无权修改预设"}});
      }
      if(action==="lorebooks.createEntry"||action==="lorebooks.updateEntry"||action==="lorebooks.removeEntry"||action==="lorebooks.mount"){
        return Promise.resolve({ok:false,action:action,requestId:"protected",error:{code:"permission_denied",message:"梨园世界书归用户与角色卡管理，预设脚本无权修改世界书"}});
      }
      if(action==="messages.updateReply"||action==="messages.dropLast"){
        return Promise.resolve({ok:false,action:action,requestId:"protected",error:{code:"permission_denied",message:"梨园已保护对话历史，预设脚本无权删改消息正文"}});
      }
      if(action==="chat.submit"||action==="chat.regenerate"||action==="generation.explicit"||action==="generation.contextual"){
        return Promise.resolve({ok:false,action:action,requestId:"protected",error:{code:"permission_denied",message:"预设脚本无权触发对话发送或后台独立生成"}});
      }
    }
    return rpcCall(action,params,opts);
  }
  if(!g.Liyuan){
    var pw=parentWin();
    var pLiyuan=(pw&&pw.Liyuan)?pw.Liyuan:null;
    g.Liyuan={
      version:"1.0.0",
      call:guardedRpcCall,
      getSnapshot:function(){return pLiyuan&&typeof pLiyuan.getSnapshot==="function"?pLiyuan.getSnapshot():readCtxQuick();},
      context:{read:function(o){return guardedRpcCall("context.read",{},o);},capabilities:function(o){return guardedRpcCall("capabilities.read",{},o);}},
      messages:{
        list:function(p,o){return guardedRpcCall("messages.list",p||{},o);},
        get:function(p,o){return guardedRpcCall("messages.get",p||{},o);},
        updateReply:function(t,o){return guardedRpcCall("messages.updateReply",{text:t},o);},
        dropLast:function(o){return guardedRpcCall("messages.dropLast",{},o);}
      },
      state:{read:function(o){return guardedRpcCall("state.read",{},o);},commit:function(patch,o){return guardedRpcCall("state.commit",{patch:patch},o);}},
      data:{
        read:function(p,o){return guardedRpcCall("data.read",p||{},o);},
        write:function(p,o){return guardedRpcCall("data.write",p||{},o);},
        remove:function(p,o){return guardedRpcCall("data.remove",p||{},o);}
      },
      chat:{
        submit:function(p,o){return guardedRpcCall("chat.submit",typeof p==="string"?{text:p}:(p||{}),o);},
        regenerate:function(p,o){return guardedRpcCall("chat.regenerate",p||{},o);},
        abort:function(o){return guardedRpcCall("requests.cancel",{includeMainChat:true},o);}
      },
      generation:{
        explicit:function(p,o){return guardedRpcCall("generation.explicit",p||{},o);},
        contextual:function(p,o){return guardedRpcCall("generation.contextual",p||{},o);}
      },
      requests:{
        cancel:function(id,o){return guardedRpcCall("requests.cancel",id?{targetRequestId:id}:{},o);},
        observe:function(id,o){return guardedRpcCall("requests.observe",id?{targetRequestId:id}:{},o);}
      },
      lorebooks:{
        list:function(o){return guardedRpcCall("lorebooks.list",{},o);},
        read:function(p,o){return guardedRpcCall("lorebooks.read",p||{},o);},
        createEntry:function(p,o){return guardedRpcCall("lorebooks.createEntry",p||{},o);},
        updateEntry:function(p,o){return guardedRpcCall("lorebooks.updateEntry",p||{},o);},
        removeEntry:function(fp,o){return guardedRpcCall("lorebooks.removeEntry",{fingerprint:fp},o);},
        mount:function(path,m,o){return guardedRpcCall("lorebooks.mount",{path:path,mounted:m!==false},o);}
      },
      preset:{
        list:function(o){return guardedRpcCall("preset.list",{},o);},
        get:function(p,o){return guardedRpcCall("preset.get",typeof p==="string"?{name:p}:(p||{}),o);},
        update:function(p,o){return guardedRpcCall("preset.update",p||{},o);}
      },
      project:{
        files:{
          list:function(o){return guardedRpcCall("project.files.list",{},o);},
          read:function(path,o){return guardedRpcCall("project.files.read",{path:path},o);},
          write:function(path,c,o){return guardedRpcCall("project.files.write",{path:path,content:c},o);},
          remove:function(path,o){return guardedRpcCall("project.files.remove",{path:path},o);}
        }
      },
      panels:{
        list:function(o){return guardedRpcCall("panels.list",{},o);},
        write:function(p,o){return guardedRpcCall("panels.write",p||{},o);},
        close:function(n,o){return guardedRpcCall("panels.close",{name:n},o);}
      }
    };
  }
  if(typeof g.triggerSlash!=="function"){
    g.triggerSlash=function(cmd){
      if(isPresetScriptFrame()&&isBlockedPresetSlash(cmd))return Promise.resolve("");
      var p=parentWin();
      try{
        if(p&&typeof p.triggerSlash==="function"){
          var r=p.triggerSlash(cmd);
          return r&&typeof r.then==="function"?r:Promise.resolve(r);
        }
      }catch(e){}
      try{if(p)p.postMessage({liyuanTriggerSlash:String(cmd||"")},"*");}catch(e2){}
      return Promise.resolve("");
    };
    g.triggerSlashWithResult=g.triggerSlash;
  }
  if(!g.TavernHelper){
    g.TavernHelper={
      tavern_events:TAVERN_EVENTS,
      iframe_events:IFRAME_EVENTS,
      generate:function(params){
        if(isPresetScriptFrame())return Promise.resolve("");
        var p=parentTH();
        if(p&&typeof p.generate==="function")return p.generate(params);
        var cfg=Object.assign({},params||{});
        if(!cfg.prompt&&cfg.user_input)cfg.prompt=cfg.user_input;
        var act=(cfg.mode==="chat")?"chat.submit":(cfg.mode==="explicit"||cfg.use_preset===false||Array.isArray(cfg.messages)||Array.isArray(cfg.ordered_prompts))?"generation.explicit":"generation.contextual";
        return guardedRpcCall(act,cfg).then(function(env){
          if(env&&env.ok&&env.result&&typeof env.result.text==="string")return env.result.text;
          var u=cfg.user_input||cfg.prompt||"";
          return "（梨园：界面内 AI 生成尚未接入）"+String(u).slice(0,80);
        });
      },
      generateRaw:function(params){
        if(isPresetScriptFrame())return Promise.resolve("");
        var p=parentTH();
        if(p&&typeof p.generateRaw==="function")return p.generateRaw(params);
        return guardedRpcCall("generation.explicit",params||{}).then(function(env){
          return (env&&env.ok&&env.result&&typeof env.result.text==="string")?env.result.text:"";
        });
      },
      stopGenerationById:function(id){
        var p=parentTH();
        if(p&&typeof p.stopGenerationById==="function")return p.stopGenerationById(id);
        return guardedRpcCall("requests.cancel",{targetRequestId:id});
      },
      stopAllGeneration:function(){
        var p=parentTH();
        if(p&&typeof p.stopAllGeneration==="function")return p.stopAllGeneration();
        return guardedRpcCall("requests.cancel",{includeMainChat:true});
      }
    };
  }
  try{
    if(g.parent&&g.parent.TheaterAPI)g.TheaterAPI=g.parent.TheaterAPI;
    else if(!g.TheaterAPI)g.TheaterAPI={call:function(m,p,o){return rpcCall(m,p||{},o||{});}};
  }catch(e){}
  try{
    if(g.parent&&typeof g.parent.handleTheaterAction==="function"){
      g.handleTheaterAction=function(m){return g.parent.handleTheaterAction(m);};
    }
  }catch(e){}
}catch(e){console.error("[liyuan bridge]",e);}
})();</script>`;

/**
 * 酒馆助手 4.12.1 + SillyTavern 1.19.0 全局适配面（脚本帧与消息帧专用，注入在 bridge 之后、卡脚本之前）。
 */
export const IFRAME_TAVERN_GLOBALS_SNIPPET = `<script>(function(){
var g=typeof window!=="undefined"?window:null;if(!g)return;
try{
  function parentWin(){try{return (g.parent&&g.parent!==g)?g.parent:null;}catch(e){return null;}}
  var pw0=parentWin();
  var isScriptHostFrame=(function(){
    try{
      if(g.frameElement&&typeof g.frameElement.getAttribute==="function"&&g.frameElement.getAttribute("data-liyuan-card-runtime")==="script")return true;
    }catch(e){}
    return String(g.name||"").indexOf("TH-script--")===0;
  })();
  function isPresetFrameNow(){
    if(typeof g.__liyuanIsPresetScriptFrame==="function")return g.__liyuanIsPresetScriptFrame();
    var n=String(g.__TH_IFRAME_ID||g.name||"");
    try{if(g.frameElement&&(g.frameElement.id||g.frameElement.name))n=String(g.frameElement.id||g.frameElement.name);}catch(e){}
    return /^TH-script--preset--/.test(n);
  }
  // 仅角色卡脚本宿主帧共享父页 jQuery；预设脚本帧强制使用自身 0×0 子帧内的隔离 jQuery，
  // 使其挂载的控制面板 UI 自然落回不可见子帧而不污染梨园界面。
  if(isScriptHostFrame&&!isPresetFrameNow()&&pw0&&typeof pw0.jQuery==="function"){
    try{g.jQuery=pw0.jQuery;g.$=pw0.$||pw0.jQuery;}catch(jqShareErr){}
  }
  if(typeof g.jQuery!=="function"&&g.document){
    try{${JQUERY_MIN}}catch(jqErr){}
  }
  if(pw0){
    try{
      if(!isScriptHostFrame&&typeof g.jQuery==="function"&&typeof pw0.jQuery!=="function"){pw0.jQuery=g.jQuery;pw0.$=g.jQuery;}
      if(typeof g._!=="function"&&typeof pw0._==="function")g._=pw0._;
      if(!g.z&&pw0.z)g.z=pw0.z;
      if(!g.YAML&&pw0.YAML)g.YAML=pw0.YAML;
      if(!g.Vue&&pw0.Vue)g.Vue=pw0.Vue;
    }catch(e0){}
  }
  if(typeof g._!=="function"){
    try{new Function(${JSON.stringify(LODASH_MIN)}).call(g);}catch(ldErr){console.error("[liyuan lodash init]",ldErr);}
  }
  if(!g.z||!g.YAML){
    try{new Function(${JSON.stringify(ZOD_YAML_MIN)}).call(g);}catch(zyErr){console.error("[liyuan zod/yaml init]",zyErr);}
  }
  if(!g.Vue){
    try{new Function(${JSON.stringify(`${VUE_MIN};if(typeof Vue!=="undefined")this.Vue=Vue;`)}).call(g);}catch(vueErr){console.error("[liyuan vue init]",vueErr);}
  }
  if(pw0){
    try{
      if(typeof pw0._!=="function"&&typeof g._==="function")pw0._=g._;
      if(!pw0.z&&g.z)pw0.z=g.z;
      if(!pw0.YAML&&g.YAML)pw0.YAML=g.YAML;
      if(!pw0.Vue&&g.Vue)pw0.Vue=g.Vue;
    }catch(e1){}
  }
  g.__VUE_PROD_DEVTOOLS__=true;
  g.__VUE_OPTIONS_API__=true;
  g.__VUE_PROD_HYDRATION_MISMATCH_DETAILS__=false;
  function toPath(p){
    if(g._&&typeof g._.toPath==="function")return g._.toPath(p);
    if(Array.isArray(p))return p.map(String);
    if(p==null||p==="")return [];
    return String(p).replace(/\\[(\\d+)\\]/g,".$1").split(".").filter(Boolean);
  }
  function lp(obj,path){
    if(path==null||path==="")return obj;
    var parts=toPath(path),o=obj;
    for(var i=0;i<parts.length;i++){if(o==null)return undefined;o=o[parts[i]];}
    return o;
  }
  function deepClone(v){
    if(v==null||typeof v!=="object")return v;
    if(Array.isArray(v))return v.map(deepClone);
    var out={};
    for(var k in v){if(Object.prototype.hasOwnProperty.call(v,k))out[k]=deepClone(v[k]);}
    return out;
  }
  function isPlainObj(v){
    if(!v||typeof v!=="object"||Array.isArray(v))return false;
    return Object.prototype.toString.call(v)==="[object Object]";
  }
  function baseMerge(target,source,customizer){
    if(!target||typeof target!=="object")target={};
    if(!source||typeof source!=="object")return target;
    for(var k in source){
      if(!Object.prototype.hasOwnProperty.call(source,k))continue;
      var srcVal=source[k],objVal=target[k];
      var custom=typeof customizer==="function"?customizer(objVal,srcVal,k,target,source):undefined;
      if(custom!==undefined){target[k]=custom;continue;}
      if(Array.isArray(srcVal)){target[k]=deepClone(srcVal);}
      else if(isPlainObj(srcVal)){target[k]=baseMerge(isPlainObj(objVal)?objVal:{},srcVal,customizer);}
      else if(srcVal!==undefined){target[k]=srcVal;}
    }
    return target;
  }
  g.klona=deepClone;
  if(!g.showdown){
    var SdConverter=function(){};
    SdConverter.prototype.makeHtml=function(md){return String(md==null?"":md);};
    SdConverter.prototype.setOption=function(){};
    SdConverter.prototype.setFlavor=function(){};
    g.showdown={Converter:SdConverter,setOption:function(){},setFlavor:function(){}};
  }
  if(!g.EjsTemplate||!g.EjsTemplate.__liyuanFullEjs){
    var ejsDefaultFeatures={
      enabled:true,
      generate_enabled:true,
      generate_loader_enabled:true,
      inject_loader_enabled:true,
      render_enabled:true,
      render_loader_enabled:true,
      code_blocks_enabled:false,
      raw_message_evaluation_enabled:false,
      filter_message_enabled:false,
      depth_limit:-1,
      autosave_enabled:false,
      preload_worldinfo_enabled:true,
      with_context_disabled:false,
      debug_enabled:false,
      invert_enabled:false,
      compile_workers:false,
      sandbox:false,
      cache_enabled:0,
      cache_size:100,
      cache_hasher:"h32ToString"
    };
    var ejsFeatures=Object.assign({},ejsDefaultFeatures);
    var ejsDefines=(pw0&&pw0.__liyuanEjsDefines)?pw0.__liyuanEjsDefines:{};
    if(pw0&&!pw0.__liyuanEjsDefines)pw0.__liyuanEjsDefines=ejsDefines;
    var ejsInitialVars=(pw0&&pw0.__liyuanEjsInitialVars)?pw0.__liyuanEjsInitialVars:{};
    if(pw0&&!pw0.__liyuanEjsInitialVars)pw0.__liyuanEjsInitialVars=ejsInitialVars;
    var AsyncFnCtor=Object.getPrototypeOf(async function(){}).constructor;

    function ejsCompileSource(tplText,opts){
      var o=(opts&&opts.openDelimiter)||"<";
      var c=(opts&&opts.closeDelimiter)||">";
      var d=(opts&&opts.delimiter)||"%";
      var localsName=(opts&&opts.localsName)||"locals";
      var outFnName=(opts&&opts.outputFunctionName)||"print";
      var useWith=!opts||opts._with!==false;
      var text=String(tplText==null?"":tplText);
      if(text.indexOf("<#escape-ejs>")>=0){
        text=text.replace(/<#escape-ejs>([\\s\\S]*?)<#\\/escape-ejs>/g,function(_m,inner){
          return String(inner).replace(/<%/g,"<%%").replace(/%>/g,"%%>");
        });
      }
      text=text.replace(/[ \\t]*<%_/gm,"<%_").replace(/_%>[ \\t]*/gm,"_%>");
      var escRe=function(s){return g._&&g._.escapeRegExp?g._.escapeRegExp(String(s)):String(s);};
      var regStr="("+escRe(o)+escRe(d)+escRe(d)+"|"+escRe(d)+escRe(d)+escRe(c)+"|"+escRe(o)+escRe(d)+"=|"+escRe(o)+escRe(d)+"-|"+escRe(o)+escRe(d)+"_|"+escRe(o)+escRe(d)+"#|"+escRe(o)+escRe(d)+"|"+escRe(d)+escRe(c)+"|-"+escRe(d)+escRe(c)+"|_"+escRe(d)+escRe(c)+")";
      var pat=new RegExp(regStr);
      var str=text;
      var rawTokens=[];
      var m=pat.exec(str);
      while(m){
        if(m.index!==0){rawTokens.push(str.substring(0,m.index));str=str.slice(m.index);}
        rawTokens.push(m[0]);
        str=str.slice(m[0].length);
        m=pat.exec(str);
      }
      if(str)rawTokens.push(str);
      var tokens=[];
      var openPref=o+d,litOpen=o+d+d,closeSuf=d+c,litClose=d+d+c;
      for(var ti=0;ti<rawTokens.length;ti++){
        var tk=rawTokens[ti];
        if(tk.indexOf(openPref)===0&&tk!==litOpen){
          var nest=1,buf=[],tj=ti+1;
          while(tj<rawTokens.length){
            var inner=rawTokens[tj];
            if(inner.indexOf(openPref)===0&&inner!==litOpen)nest++;
            else if(inner.slice(-closeSuf.length)===closeSuf&&inner!==litClose){
              nest--;
              if(nest===0){tokens.push(tk,buf.join(""),inner);ti=tj;break;}
            }
            buf.push(inner);
            tj++;
          }
          if(nest!==0)throw new SyntaxError('Could not find matching close tag for "'+tk+'".');
        }else{
          tokens.push(tk);
        }
      }
      var mode=null,truncate=false,src="";
      function addOut(line){
        var s=line;
        if(truncate){s=s.replace(/^(?:\\r\\n|\\r|\\n)/,"");truncate=false;}
        if(!s)return;
        var esc=s.replace(/\\\\/g,"\\\\\\\\").replace(/\\n/g,"\\\\n").replace(/\\r/g,"\\\\r").replace(/"/g,'\\\\"');
        src+='    ; __append("'+esc+'")\\n';
      }
      for(var k=0;k<tokens.length;k++){
        var seg=tokens[k];
        if(seg===o+d||seg===o+d+"_")mode="eval";
        else if(seg===o+d+"=")mode="escaped";
        else if(seg===o+d+"-")mode="raw";
        else if(seg===o+d+"#")mode="comment";
        else if(seg===litOpen){mode="literal";src+='    ; __append("'+o+d+'")\\n';}
        else if(seg===litClose){mode="literal";src+='    ; __append("'+d+c+'")\\n';}
        else if(seg===closeSuf||seg==="-"+closeSuf||seg==="_"+closeSuf){
          if(mode==="literal")addOut(seg);
          mode=null;
          if(seg.charAt(0)==="-"||seg.charAt(0)==="_")truncate=true;
        }else if(mode){
          if(mode==="eval")src+="    ; "+seg+"\\n";
          else if(mode==="escaped")src+="    ; __append(escapeFn("+seg.replace(/;\\s*$/,"")+"))\\n";
          else if(mode==="raw")src+="    ; __append("+seg.replace(/;\\s*$/,"")+")\\n";
          else if(mode==="literal")addOut(seg);
        }else{
          addOut(seg);
        }
      }
      var body='  var __output = "";\\n  function __append(...args){args.filter(function(x){return x!==undefined&&x!==null;}).forEach(function(s){__output+=s;});}\\n';
      if(outFnName)body+="  const "+outFnName+" = __append;\\n";
      if(useWith)body+="  with ("+localsName+" || {}) {\\n"+src+"  }\\n";
      else body+="  {\\n"+src+"  }\\n";
      body+="  return __output;\\n";
      return body;
    }

    function ejsParseJSON(txt){
      var raw=String(txt==null?"":txt).trim();
      if(!raw)return null;
      try{return JSON.parse(raw);}catch(e){
        var s=raw.replace(/^\\x60\\x60\\x60(?:json)?\\s*/i,"").replace(/\\s*\\x60\\x60\\x60$/i,"").replace(/,\\s*([}\\]])/g,"\\$1");
        return JSON.parse(s);
      }
    }

    function ejsJsonPatch(doc,patches){
      if(!doc||typeof doc!=="object")return doc;
      var next=deepClone(doc);
      if(!Array.isArray(patches)||!g._)return next;
      for(var i=0;i<patches.length;i++){
        var p=patches[i];
        if(!p||typeof p.path!=="string")continue;
        var segs=p.path===""?[]:p.path.replace(/^\\//,"").split("/").map(function(s){return s.replace(/~1/g,"/").replace(/~0/g,"~");});
        var fromSegs=p.from?p.from.replace(/^\\//,"").split("/").map(function(s){return s.replace(/~1/g,"/").replace(/~0/g,"~");}):[];
        if(p.op==="add"||p.op==="replace"||p.op==="set"||p.op==="assign"){
          if(segs[segs.length-1]==="-"){
            var arr=g._.get(next,segs.slice(0,-1));
            if(Array.isArray(arr))arr.push(deepClone(p.value));
          }else{
            g._.set(next,segs,deepClone(p.value));
          }
        }else if(p.op==="remove"){
          g._.unset(next,segs);
        }else if(p.op==="move"){
          var mv=g._.get(next,fromSegs);
          if(mv!==undefined){g._.unset(next,fromSegs);g._.set(next,segs,deepClone(mv));}
        }else if(p.op==="copy"){
          var cp=g._.get(next,fromSegs);
          if(cp!==undefined)g._.set(next,segs,deepClone(cp));
        }
      }
      return next;
    }

    function ejsAllVariables(_end){
      var all=typeof g.getAllVariables==="function"?g.getAllVariables():{};
      return Object.assign({},ejsInitialVars,all);
    }

    function ejsPrepareContext(additionalCtx,_lastMsgId){
      var vars=ejsAllVariables(_lastMsgId);
      var rctx=readRuntimeCtx()||{};
      var msgs=Array.isArray(rctx.messages)?rctx.messages:[];
      var lastUserIdx=-1,lastCharIdx=-1;
      for(var i=msgs.length-1;i>=0;i--){
        if(lastUserIdx<0&&msgs[i]&&msgs[i].role==="user")lastUserIdx=i;
        if(lastCharIdx<0&&msgs[i]&&msgs[i].role==="assistant")lastCharIdx=i;
      }
      var getvarFn=function(key,opts){
        var defVal=(opts&&typeof opts==="object")?opts.defaults:undefined;
        if(key==null||key==="")return vars;
        return g._?g._.get(vars,key,defVal):defVal;
      };
      var setvarFn=function(key,val,opts){
        var o=(opts&&typeof opts==="object")?opts:(typeof opts==="string"?{flags:opts}:{});
        if(o.flags==="nx"&&g._&&g._.has(vars,key))return undefined;
        if(o.flags==="xx"&&g._&&!g._.has(vars,key))return undefined;
        var oldVal=g._?g._.get(vars,key):undefined;
        if(g._){
          if(val===undefined)g._.unset(vars,key);
          else g._.set(vars,key,val);
        }
        try{
          if(typeof g.__liyuanAuthorVarsWrite==="function"){
            var scope=o.scope==="global"?"global":"chat";
            g.__liyuanAuthorVarsWrite(scope,vars,"assign");
          }
        }catch(e){}
        if(o.results==="old")return oldVal;
        if(o.results==="fullcache")return vars;
        return val;
      };
      var incvarFn=function(key,val,opts){
        var delta=val===undefined?1:Number(val);
        var o=(opts&&typeof opts==="object")?opts:{};
        var cur=Number(getvarFn(key,{defaults:o.defaults||0}))||0;
        var next=cur+delta;
        if(o.min!=null)next=Math.max(next,o.min);
        if(o.max!=null)next=Math.min(next,o.max);
        return setvarFn(key,next,opts);
      };
      var decvarFn=function(key,val,opts){
        return incvarFn(key,-(val===undefined?1:Number(val)),opts);
      };
      var delvarFn=function(key,idx,opts){
        if(idx==null)return setvarFn(key,undefined,opts);
        var cur=getvarFn(key,opts);
        if(Array.isArray(cur)){
          var pos=cur.indexOf(idx);
          if(pos>=0){cur.splice(pos,1);return setvarFn(key,cur,opts);}
        }else if(cur&&typeof cur==="object"){
          delete cur[String(idx)];
          return setvarFn(key,cur,opts);
        }
        return undefined;
      };
      var insvarFn=function(key,val,idx,opts){
        var cur=getvarFn(key,opts);
        if(Array.isArray(cur)){
          if(idx==null)cur.push(val);
          else cur.splice(Number(idx)<0?Math.max(0,cur.length+Number(idx)):Number(idx),0,val);
          return setvarFn(key,cur,opts);
        }else if(cur&&typeof cur==="object"&&idx!=null){
          cur[String(idx)]=val;
          return setvarFn(key,cur,opts);
        }
        return undefined;
      };
      var getwiFn=async function(bookOrTitle,entryOrData,data){
        var targetTitle=(entryOrData===undefined||(entryOrData&&typeof entryOrData==="object"&&!(entryOrData instanceof RegExp)))?bookOrTitle:entryOrData;
        var extra=(entryOrData&&typeof entryOrData==="object"&&!(entryOrData instanceof RegExp))?entryOrData:(data||{});
        try{
          var entries=typeof g.getWorldbook==="function"?await g.getWorldbook(typeof bookOrTitle==="string"?bookOrTitle:""):[];
          var hit=null;
          for(var j=0;j<entries.length;j++){
            var e=entries[j];
            if(!e)continue;
            if(e.name===targetTitle||e.comment===targetTitle||e.uid===targetTitle||(targetTitle instanceof RegExp&&targetTitle.test(e.name||e.comment||""))){
              hit=e;break;
            }
          }
          if(!hit)return "";
          var subCtx=Object.assign({},ctxObj,extra,{world_info:hit});
          return await ejsEvalTemplate(hit.content||"",subCtx);
        }catch(e){return "";}
      };
      var defineFn=function(name,val,merge){
        if(merge&&g._&&g._.isPlainObject(ejsDefines[name])&&g._.isPlainObject(val)){
          ejsDefines[name]=g._.merge({},ejsDefines[name],val);
        }else{
          ejsDefines[name]=val;
        }
        ctxObj[name]=typeof ejsDefines[name]==="function"?ejsDefines[name].bind(ctxObj):ejsDefines[name];
        return ejsDefines[name];
      };
      var ctxObj=Object.assign({
        _:g._,
        $:g.$,
        z:g.z,
        YAML:g.YAML,
        toastr:g.toastr,
        console:console,
        variables:vars,
        get SillyTavern(){return g.SillyTavern&&typeof g.SillyTavern.getContext==="function"?g.SillyTavern.getContext():g.SillyTavern;},
        userName:rctx.userName||"User",
        charName:rctx.charName||"Assistant",
        assistantName:rctx.charName||"Assistant",
        chatId:rctx.chatId||rctx.sessionId||"",
        characterId:0,
        groupId:null,
        groups:[],
        runType:"generate",
        generateType:"",
        lastMessageId:msgs.length>0?msgs.length-1:-1,
        lastUserMessageId:lastUserIdx>=0?lastUserIdx:0,
        lastCharMessageId:lastCharIdx>=0?lastCharIdx:0,
        lastUserMessage:lastUserIdx>=0?(msgs[lastUserIdx].message||msgs[lastUserIdx].text||""):"",
        lastCharMessage:lastCharIdx>=0?(msgs[lastCharIdx].message||msgs[lastCharIdx].text||""):"",
        getvar:getvarFn,
        getLocalVar:getvarFn,
        getGlobalVar:function(k,o){return getvarFn(k,Object.assign({},o,{scope:"global"}));},
        getMessageVar:getvarFn,
        setvar:setvarFn,
        setLocalVar:setvarFn,
        setGlobalVar:function(k,v,o){return setvarFn(k,v,Object.assign({},o,{scope:"global"}));},
        setMessageVar:setvarFn,
        incvar:incvarFn,
        incLocalVar:incvarFn,
        incGlobalVar:incvarFn,
        incMessageVar:incvarFn,
        decvar:decvarFn,
        decLocalVar:decvarFn,
        decGlobalVar:decvarFn,
        decMessageVar:decvarFn,
        delvar:delvarFn,
        delLocalVar:delvarFn,
        delGlobalVar:delvarFn,
        delMessageVar:delvarFn,
        insvar:insvarFn,
        insertLocalVar:insvarFn,
        insertGlobalVar:insvarFn,
        insertMessageVar:insvarFn,
        patchVariables:function(key,change,o){
          var doc=getvarFn(key,o);
          var ops=typeof change==="string"?ejsParseJSON(change):change;
          return setvarFn(key,ejsJsonPatch(doc,ops),o);
        },
        parseJSON:ejsParseJSON,
        jsonPatch:ejsJsonPatch,
        getwi:getwiFn,
        getWorldInfo:getwiFn,
        activewi:getwiFn,
        activateWorldInfo:getwiFn,
        define:defineFn,
        evalTemplate:function(c,d,o){return ejsEvalTemplate(c,Object.assign({},ctxObj,d||{}),o);},
        getChatMessage:function(idx){
          var arr=typeof g.getChatMessages==="function"?g.getChatMessages(idx):[];
          return (arr&&arr[0]&&arr[0].message)||"";
        },
        getChatMessages:function(cnt){
          var arr=typeof g.getChatMessages==="function"?g.getChatMessages(cnt):[];
          return Array.isArray(arr)?arr.map(function(m){return m.message||"";}):[];
        }
      },ejsDefines,additionalCtx||{});
      return Promise.resolve(ctxObj);
    }

    async function ejsCompileTemplate(code,options,thisData){
      var opts=(options&&options.options)?options.options:(options||{});
      var esc=(options&&typeof options.escaper==="function")?options.escaper:((opts&&typeof opts.escape==="function")?opts.escape:function(m){return m==null?"":String(m);});
      var src=ejsCompileSource(code,opts);
      var fn=new AsyncFnCtor((opts&&opts.localsName)||"locals","escapeFn",src);
      return async function(data){
        var ctx=data||thisData||{};
        return await fn.call(thisData||ctx,ctx,esc);
      };
    }

    async function ejsEvalTemplate(code,context,options){
      var str=String(code==null?"":code);
      var opts=(options&&options.options)?options.options:(options||{});
      var o=(opts&&opts.openDelimiter)||"<";
      var d=(opts&&opts.delimiter)||"%";
      if(str.indexOf(o+d)<0&&str.indexOf("<#escape-ejs>")<0)return str;
      var env=context||await ejsPrepareContext();
      var compiled=await ejsCompileTemplate(str,options,env);
      return await compiled(env);
    }

    function ejsGetSyntaxErrorInfo(code){
      try{
        var src=ejsCompileSource(String(code==null?"":code),{});
        new AsyncFnCtor("locals","escapeFn",src);
        return Promise.resolve("");
      }catch(err){
        return Promise.resolve(String(err&&err.message?err.message:err));
      }
    }

    g.EjsTemplate={
      __liyuanFullEjs:true,
      evalTemplate:ejsEvalTemplate,
      evaltemplate:ejsEvalTemplate,
      prepareContext:ejsPrepareContext,
      compileTemplate:ejsCompileTemplate,
      getSyntaxErrorInfo:ejsGetSyntaxErrorInfo,
      allVariables:ejsAllVariables,
      saveVariables:function(){return Promise.resolve();},
      refreshWorldInfo:function(){return Promise.resolve();},
      getFeatures:function(){return Object.assign({},ejsFeatures);},
      setFeatures:function(f){if(f&&typeof f==="object")Object.assign(ejsFeatures,f);},
      resetFeatures:function(){ejsFeatures=Object.assign({},ejsDefaultFeatures);},
      get defines(){return ejsDefines;},
      get initialVariables(){return ejsInitialVars;},
      parseJSON:ejsParseJSON,
      jsonPatch:ejsJsonPatch,
      render:function(tpl,ctx){return ejsEvalTemplate(tpl,ctx);}
    };
  }
  function readRuntimeCtx(){
    var c=g.__liyuanRuntimeContext||null;
    if(!c){
      var p=parentWin();
      if(p&&p.__liyuanRuntimeContext&&typeof p.__liyuanRuntimeContext==="object"){
        c=p.__liyuanRuntimeContext;
        g.__liyuanRuntimeContext=c;
      }
    }
    return c;
  }
  // 帧与脚本身份协议（刀2：getIframeName / getScriptId / getMessageId / getCurrentMessageId）
  g.getIframeName=function(){
    try{
      if(g.frameElement&&g.frameElement.id)return String(g.frameElement.id);
    }catch(e){}
    if(g.__TH_IFRAME_ID)return String(g.__TH_IFRAME_ID);
    if(g.name)return String(g.name);
    var sid=g.__liyuanCurrentScriptId||g.__liyuanDefaultScriptId||"default";
    return "TH-script--card--"+sid;
  };
  g.getScriptId=function(){
    if(g.__liyuanCurrentScriptId)return String(g.__liyuanCurrentScriptId);
    var n=g.getIframeName();
    var m=/^TH-script--[^-]+--(.+)$/.exec(n);
    if(m&&m[1])return m[1];
    if(g.__liyuanDefaultScriptId)return String(g.__liyuanDefaultScriptId);
    return "default";
  };
  g.getMessageId=function(iframeName){
    var target=String(iframeName||g.getIframeName());
    var m=/^TH-message--(\\d+)--/.exec(target);
    if(m&&m[1]!=null)return parseInt(m[1],10);
    try{
      if(g.frameElement&&g.frameElement.getAttribute){
        var attr=g.frameElement.getAttribute("data-liyuan-message-id");
        if(attr!=null&&attr!=="")return parseInt(attr,10);
      }
    }catch(e){}
    return g.getLastMessageId();
  };
  g.getLastMessageId=function(){
    var c=readRuntimeCtx();
    var list=c&&Array.isArray(c.messages)?c.messages:null;
    return (list&&list.length>0)?(list.length-1):0;
  };
  g.getCurrentMessageId=function(){
    var n=g.getIframeName();
    if(/^TH-message--\\d+--/.test(n))return g.getMessageId(n);
    try{
      if(g.frameElement&&g.frameElement.getAttribute){
        var attr=g.frameElement.getAttribute("data-liyuan-message-id");
        if(attr!=null&&attr!=="")return parseInt(attr,10);
      }
    }catch(e){}
    return g.getLastMessageId();
  };
  g.reloadIframe=function(){try{g.location.reload();}catch(e){}};

  // 变量系统全作用域（刀3：chat / message / script / character / preset / global / extension）
  if(!g.__liyuanScopedVars){
    var pwScoped=pw0&&pw0.__liyuanScopedVars;
    g.__liyuanScopedVars=pwScoped||{chat:{},message:{},script:{},character:{},preset:{},global:{},extension:{}};
  }
  g.__liyuanSeedScriptVars=function(sid,initData){
    if(!sid||!initData||typeof initData!=="object")return;
    var cur=g.__liyuanAuthorVarsRead("script",sid);
    var merged=baseMerge(deepClone(initData),cur);
    g.__liyuanScopedVars.script[sid]=merged;
  };
  function rawMvuTree(){
    var v=g.__liyuanVariables||null;
    if(!v){
      var p=parentWin();
      if(p&&p.__liyuanVariables&&typeof p.__liyuanVariables==="object"){
        v=p.__liyuanVariables;
        g.__liyuanVariables=v;
      }
    }
    return v&&typeof v==="object"?v:{stat_data:{}};
  }
  if(typeof g.getAllVariables!=="function"){
    g.getAllVariables=function(){
      var mvu=deepClone(rawMvuTree());
      var globalVars=g.__liyuanAuthorVarsRead("global");
      var charVars=g.__liyuanAuthorVarsRead("character");
      var scriptVars=g.__liyuanAuthorVarsRead("script",g.getScriptId());
      var chatVars=g.__liyuanAuthorVarsRead("chat");
      var merged=baseMerge({},globalVars);
      baseMerge(merged,charVars);
      if(!/^TH-message--/.test(g.getIframeName()))baseMerge(merged,scriptVars);
      baseMerge(merged,mvu);
      baseMerge(merged,chatVars);
      if(!merged.stat_data||typeof merged.stat_data!=="object")merged.stat_data=deepClone(mvu.stat_data||{});
      return merged;
    };
  }
  if(typeof g.__liyuanAuthorVarsRead!=="function"){
    var AV_KEY=function(t,subId){
      var scope=String(t||"chat").toLowerCase();
      if(scope==="script")return "liyuan.authorVars.script."+(subId||g.getScriptId()||"default");
      if(scope==="extension")return "liyuan.authorVars.ext."+(subId||"default");
      return "liyuan.authorVars."+(scope==="script"?"script":scope==="global"?"global":scope);
    };
    g.__liyuanAuthorVarsRead=function(t,subId){
      var scope=String(t||"chat").toLowerCase();
      var ctx=readRuntimeCtx();
      try{
        if(scope==="chat"){
          var base=deepClone(rawMvuTree());
          if(ctx&&ctx.scriptVars&&ctx.scriptVars.chat)baseMerge(base,ctx.scriptVars.chat);
          if(g.__liyuanScopedVars.chat)baseMerge(base,g.__liyuanScopedVars.chat);
          var rawChat=g.localStorage&&g.localStorage.getItem(AV_KEY("chat"));
          if(rawChat)baseMerge(base,JSON.parse(rawChat));
          return base;
        }
        if(scope==="message"){
          var mid=subId===undefined||subId==="latest"?g.getLastMessageId():(Number(subId)<0?Math.max(0,g.getLastMessageId()+1+Number(subId)):Number(subId));
          var msgBase=deepClone(rawMvuTree());
          if(ctx&&ctx.scriptVars&&ctx.scriptVars.messages&&ctx.scriptVars.messages[String(mid)]){
            baseMerge(msgBase,ctx.scriptVars.messages[String(mid)]);
          }
          if(g.__liyuanScopedVars.message&&g.__liyuanScopedVars.message[String(mid)]){
            baseMerge(msgBase,g.__liyuanScopedVars.message[String(mid)]);
          }
          return msgBase;
        }
        if(scope==="script"){
          var sid=subId||g.getScriptId()||"default";
          var regInit=(g.__liyuanScriptRegistry&&g.__liyuanScriptRegistry[sid]&&g.__liyuanScriptRegistry[sid].data)?g.__liyuanScriptRegistry[sid].data:{};
          var sBase=deepClone(regInit);
          var rawS=g.localStorage&&g.localStorage.getItem(AV_KEY("script",sid));
          if(!rawS)rawS=g.localStorage&&g.localStorage.getItem("liyuan.authorVars.script");
          if(rawS)baseMerge(sBase,JSON.parse(rawS));
          if(g.__liyuanScopedVars.script&&g.__liyuanScopedVars.script[sid])baseMerge(sBase,g.__liyuanScopedVars.script[sid]);
          return sBase;
        }
        if(scope==="global"||scope==="preset"||scope==="character"){
          var scBase={};
          if(scope==="preset"&&ctx&&ctx.presetRaw&&ctx.presetRaw.extensions){
            var pTh=ctx.presetRaw.extensions.tavern_helper||ctx.presetRaw.extensions.TavernHelper;
            if(pTh&&pTh.variables&&typeof pTh.variables==="object")baseMerge(scBase,pTh.variables);
          }
          if(ctx&&ctx.scriptVars&&ctx.scriptVars[scope]&&typeof ctx.scriptVars[scope]==="object"){
            baseMerge(scBase,ctx.scriptVars[scope]);
          }
          var rawScoped=g.localStorage&&g.localStorage.getItem(AV_KEY(scope,subId));
          if(rawScoped)baseMerge(scBase,JSON.parse(rawScoped));
          if(g.__liyuanScopedVars&&g.__liyuanScopedVars[scope])baseMerge(scBase,g.__liyuanScopedVars[scope]);
          return scBase;
        }
        var raw=g.localStorage&&g.localStorage.getItem(AV_KEY(scope,subId));
        var v=raw?JSON.parse(raw):null;
        return v&&typeof v==="object"?deepClone(v):{};
      }catch(e){return {};}
    };
    g.__liyuanAuthorVarsWrite=function(t,patch,mode,subId){
      var scope=String(t||"chat").toLowerCase();
      try{
        var cur=mode==="replace"?{}:g.__liyuanAuthorVarsRead(scope,subId);
        var next=mode==="replace"?deepClone(patch||{}):baseMerge(cur,patch||{},function(_l,r){return Array.isArray(r)?deepClone(r):undefined;});
        if(scope==="chat"){
          g.__liyuanScopedVars.chat=deepClone(next);
          if(next.stat_data&&typeof next.stat_data==="object"){
            g.__liyuanVariables={stat_data:deepClone(next.stat_data)};
            var pw=parentWin();
            if(pw)pw.__liyuanVariables=g.__liyuanVariables;
          }
        }else if(scope==="message"){
          var mid=subId===undefined||subId==="latest"?g.getLastMessageId():(Number(subId)<0?Math.max(0,g.getLastMessageId()+1+Number(subId)):Number(subId));
          g.__liyuanScopedVars.message[String(mid)]=deepClone(next);
          if(next.stat_data&&typeof next.stat_data==="object"){
            g.__liyuanVariables={stat_data:deepClone(next.stat_data)};
            var pw2=parentWin();
            if(pw2)pw2.__liyuanVariables=g.__liyuanVariables;
          }
        }else if(scope==="script"){
          var sid=subId||g.getScriptId()||"default";
          g.__liyuanScopedVars.script[sid]=deepClone(next);
          if(g.localStorage)g.localStorage.setItem("liyuan.authorVars.script",JSON.stringify(next));
        }else if(scope==="global"||scope==="preset"||scope==="character"){
          g.__liyuanScopedVars[scope]=deepClone(next);
        }
        if(g.localStorage)g.localStorage.setItem(AV_KEY(scope,subId),JSON.stringify(next));
        if(g.Liyuan&&typeof g.Liyuan.call==="function"){
          try{
            var writeParams={scope:scope,mode:mode==="replace"?"replace":"merge",data:next};
            if(scope==="extension"&&subId)writeParams.extension_id=String(subId);
            if(scope==="message")writeParams={scope:"message",mode:"merge",key:String(mid),value:next};
            g.Liyuan.call("data.write",writeParams,{scriptId:scope==="script"?String(subId||g.getScriptId()):undefined});
            if((scope==="chat"||scope==="message")&&next.stat_data&&typeof next.stat_data==="object"){
              g.Liyuan.call("state.commit",{patch:next.stat_data});
            }
          }catch(e2){}
        }
        return deepClone(next);
      }catch(e){return {};}
    };
    function resolveSubId(opts){
      if(!opts||typeof opts!=="object")return undefined;
      if(opts.type==="script")return opts.script_id||g.getScriptId();
      if(opts.type==="message")return opts.message_id!==undefined?opts.message_id:"latest";
      if(opts.type==="extension")return opts.extension_id||"default";
      return undefined;
    }
    g.getVariables=function(opts){
      var t=(opts&&opts.type)||"chat";
      if(t!=="chat")return g.__liyuanAuthorVarsRead(t,resolveSubId(opts));
      var r=g.__liyuanAuthorVarsRead("chat");
      return Object.keys(r).length?r:g.getAllVariables();
    };
    g.replaceVariables=function(variables,opts){
      var t=(opts&&opts.type)||"chat";
      var subId=resolveSubId(opts);
      return g.__liyuanAuthorVarsWrite(t,variables||{},"replace",subId);
    };
    g.updateVariablesWith=function(updater,opts){
      var t=(opts&&opts.type)||"chat";
      var subId=resolveSubId(opts);
      var current=g.getVariables(opts||{type:t});
      if(typeof updater!=="function"){
        if(updater&&typeof updater==="object")return g.__liyuanAuthorVarsWrite(t,updater,"assign",subId);
        return current;
      }
      var res=updater(deepClone(current));
      if(res&&typeof res.then==="function"){
        return res.then(function(resolved){
          return g.__liyuanAuthorVarsWrite(t,resolved||{},"replace",subId);
        });
      }
      return g.__liyuanAuthorVarsWrite(t,res||{},"replace",subId);
    };
    g.insertOrAssignVariables=function(variables,opts){
      var t=(opts&&opts.type)||"chat";
      var subId=resolveSubId(opts);
      if(typeof variables==="function")return g.updateVariablesWith(variables,opts);
      return g.__liyuanAuthorVarsWrite(t,variables||{},"assign",subId);
    };
    g.insertVariables=function(variables,opts){
      return g.updateVariablesWith(function(oldVars){
        return baseMerge(deepClone(variables||{}),oldVars,function(_l,r){return Array.isArray(r)?deepClone(r):undefined;});
      },opts||{type:"chat"});
    };
    g.deleteVariable=function(variable_path,opts){
      var t=(opts&&opts.type)||"chat";
      var current=g.getVariables(opts||{type:t});
      var occurred=g._.unset(current,variable_path);
      var saved=g.replaceVariables(current,opts||{type:t});
      return {variables:saved,delete_occurred:Boolean(occurred)};
    };
    g.registerVariableSchema=function(schema,opts){
      if(!g.__liyuanVariableSchemas)g.__liyuanVariableSchemas={};
      var t=(opts&&opts.type)||"chat";
      g.__liyuanVariableSchemas[t]=schema;
    };
  }
  if(typeof g.addEventListener==="function"){
    g.addEventListener("message",function(ev){
      var d=ev&&ev.data;
      if(!d||typeof d!=="object")return;
      if("liyuanRuntimeContext" in d){
        var c=d.liyuanRuntimeContext;
        if(c&&typeof c==="object"){
          g.__liyuanRuntimeContext=c;
          if(typeof g.__liyuanSyncPresetFromCtx==="function"){
            try{g.__liyuanSyncPresetFromCtx(c);}catch(eSync){}
          }
        }
      }
      if(!("liyuanVariables" in d))return;
      var oldV=deepClone(g.__liyuanVariables||{stat_data:{}});
      var v=d.liyuanVariables;
      g.__liyuanVariables=(v&&typeof v==="object")?v:{stat_data:{}};
      if(typeof g.__liyuanApplyMvuSchemas==="function"){
        try{g.__liyuanApplyMvuSchemas(g.__liyuanVariables);}catch(e0){}
      }
      if(g.Mvu&&g.Mvu.events&&typeof g.eventEmit==="function"){
        try{
          g.eventEmit(g.Mvu.events.VARIABLE_UPDATE_ENDED,g.__liyuanVariables,oldV);
          if(g.Mvu.events.VARIABLE_UPDATE_ENDED!=="VARIABLE_UPDATE_ENDED"){
            g.eventEmit("VARIABLE_UPDATE_ENDED",g.__liyuanVariables,oldV);
          }
        }catch(e){}
      }
    });
    try{
      var pv=parentWin();
      if(pv){
        pv.postMessage({liyuanVariablesReady:g.name||1},"*");
        pv.postMessage({liyuanContextReady:g.name||1},"*");
      }
    }catch(e){}
  }
  if(typeof g.errorCatched!=="function"){
    g.errorCatched=function(fn){
      if(typeof fn!=="function")return fn;
      return function(){
        try{
          var r=fn.apply(this,arguments);
          if(r&&typeof r.then==="function"){
            return r.then(undefined,function(err){console.error("[liyuan card async]",err);});
          }
          return r;
        }catch(e){console.error("[liyuan card]",e);}
      };
    };
  }
  if(!g.toastr){
    var toast=function(level){
      return function(msg,title){
        var text=String(title?title+"：":"")+String(msg==null?"":msg);
        try{
          var p=parentWin();
          if(p&&typeof p.__liyuanToast==="function"){p.__liyuanToast(level,text);return;}
        }catch(e){}
        console.log("[liyuan toastr:"+level+"]",text);
      };
    };
    g.toastr={success:toast("info"),info:toast("info"),warning:toast("warning"),error:toast("error"),clear:function(){},remove:function(){}};
  }
  // 宏与自定义宏（刀5：substitudeMacros / registerMacroLike / unregisterMacroLike）
  if(!g.__liyuanCustomMacros)g.__liyuanCustomMacros=new Map();
  g.registerMacroLike=function(regex,replace){
    if(regex instanceof RegExp&&typeof replace==="function"){
      g.__liyuanCustomMacros.set(String(regex),{regex:regex,replace:replace});
    }
    return {stop:function(){if(regex)g.__liyuanCustomMacros.delete(String(regex));}};
  };
  g.unregisterMacroLike=function(regex){
    if(regex)g.__liyuanCustomMacros.delete(String(regex));
  };
  g.substitudeMacros=function(text){
    var s=text==null?"":String(text);
    var c=readRuntimeCtx();
    var list=(c&&Array.isArray(c.messages))?c.messages:[];
    var lastIdx=list.length>0?(list.length-1):0;
    var lastMsg=list.length>0?String(list[list.length-1].message||list[list.length-1].text||""):"";
    var lastUserMsg="";
    var lastCharMsg="";
    for(var mi=list.length-1;mi>=0;mi--){
      var rm=list[mi];
      if(!rm)continue;
      var mt=String(rm.message!=null?rm.message:(rm.text||""));
      if(!lastUserMsg&&rm.role==="user")lastUserMsg=mt;
      if(!lastCharMsg&&rm.role!=="user")lastCharMsg=mt;
      if(lastUserMsg&&lastCharMsg)break;
    }
    var charName=c?String(c.charName||""):"";
    var userName=c?String(c.userName||""):"";
    var commentRe=/\\{\\{\\s*\\/\\/[\\s\\S]*?\\}\\}/g;
    var trimRe=/\\s*\\{\\{\\s*trim\\s*\\}\\}\\s*/gi;
    var tokenRe=/\\{\\{(?:(?!\\{\\{)[\\s\\S])*?\\}\\}/g;
    function readScopedVar(scope,k){
      var key=String(k||"").trim();
      if(!key)return undefined;
      var bag=g.getVariables({type:scope});
      if(bag&&Object.prototype.hasOwnProperty.call(bag,key))return bag[key];
      return g._.get(bag,key);
    }
    function writeScopedVar(scope,k,val){
      var key=String(k||"").trim();
      if(!key)return;
      var patch={};
      patch[key]=val;
      g.insertOrAssignVariables(patch,{type:scope});
    }
    function addScopedVar(scope,k,val){
      var key=String(k||"").trim();
      if(!key)return;
      var cur=readScopedVar(scope,key);
      var vt=String(val==null?"":val).trim();
      var vn=Number(vt);
      if(cur===undefined||cur===null){
        writeScopedVar(scope,key,(vt!==""&&isFinite(vn))?String(vn):String(val||""));
        return;
      }
      var ct=String(cur).trim();
      var cn=Number(ct);
      if(ct!==""&&vt!==""&&isFinite(cn)&&isFinite(vn))writeScopedVar(scope,key,String(cn+vn));
      else writeScopedVar(scope,key,String(cur)+String(val||""));
    }
    function stepScopedVar(scope,k,delta){
      var key=String(k||"").trim();
      if(!key)return "";
      var cur=readScopedVar(scope,key);
      var ct=cur==null?"":String(cur).trim();
      var n=(ct!==""&&isFinite(Number(ct)))?Number(ct):0;
      var next=String(n+delta);
      writeScopedVar(scope,key,next);
      return next;
    }
    function evalMacroToken(token){
      var body=token.slice(2,-2);
      var nmMatch=body.match(/^\\s*([^:\\s{}]+)/);
      var name=(nmMatch&&nmMatch[1]?nmMatch[1]:"").toLowerCase();
      var rest=body.slice(nmMatch?nmMatch[0].length:0).replace(/^(::|:)/,"");
      if(name==="char"||name==="charifnotgroup")return charName;
      if(name==="user")return userName;
      if(name==="lastmessageid")return String(lastIdx);
      if(name==="lastmessage")return lastMsg;
      if(name==="lastusermessage")return lastUserMsg;
      if(name==="lastcharmessage")return lastCharMsg;
      if(name==="space"){
        var sn=Math.max(1,Math.min(200,Math.trunc(Number(rest.trim())||1)));
        return new Array(sn+1).join(" ");
      }
      if(name==="newline"){
        var nn=Math.max(1,Math.min(50,Math.trunc(Number(rest.trim())||1)));
        return new Array(nn+1).join("\\n");
      }
      if(name==="noop")return "";
      if(name==="setvar"){
        var sp=rest.split("::");
        if(sp[0]&&sp[0].trim())writeScopedVar("chat",sp[0],sp.slice(1).join("::"));
        return "";
      }
      if(name==="addvar"){
        var ap=rest.split("::");
        if(ap[0]&&ap[0].trim())addScopedVar("chat",ap[0],ap.slice(1).join("::"));
        return "";
      }
      if(name==="incvar")return stepScopedVar("chat",rest.split("::")[0],1);
      if(name==="decvar")return stepScopedVar("chat",rest.split("::")[0],-1);
      if(name==="getvar"){
        var gv=readScopedVar("chat",rest.split("::")[0]);
        return gv==null?"":String(gv);
      }
      if(name==="hasvar"||name==="varexists")return readScopedVar("chat",rest.split("::")[0])!==undefined?"true":"false";
      if(name==="deletevar"||name==="flushvar"){
        var dk=String(rest.split("::")[0]||"").trim();
        if(dk)g.deleteVariable(dk,{type:"chat"});
        return "";
      }
      if(name==="setglobalvar"){
        var sgp=rest.split("::");
        if(sgp[0]&&sgp[0].trim())writeScopedVar("global",sgp[0],sgp.slice(1).join("::"));
        return "";
      }
      if(name==="addglobalvar"){
        var agp=rest.split("::");
        if(agp[0]&&agp[0].trim())addScopedVar("global",agp[0],agp.slice(1).join("::"));
        return "";
      }
      if(name==="incglobalvar")return stepScopedVar("global",rest.split("::")[0],1);
      if(name==="decglobalvar")return stepScopedVar("global",rest.split("::")[0],-1);
      if(name==="getglobalvar"){
        var ggv=readScopedVar("global",rest.split("::")[0]);
        return ggv==null?"":String(ggv);
      }
      if(name==="random"){
        var rargs=rest.indexOf("::")>=0?rest.split("::"):rest.split(",");
        var rh=0;
        for(var ri=0;ri<rest.length;ri++)rh=(rh*31+rest.charCodeAt(ri))|0;
        return rargs[Math.abs(rh)%rargs.length]||"";
      }
      if(name==="roll"){
        var expr=rest.trim();
        var dice=/^(\\d*)d(\\d+)([+-]\\d+)?$/i.exec(expr);
        var faces=dice?Number(dice[2]):0;
        if(!dice||!isFinite(faces)||faces<1)return token;
        var count=Math.min(Math.max(dice[1]?Number(dice[1]):1,1),100);
        var dh=0;
        for(var di=0;di<expr.length;di++)dh=(dh*31+expr.charCodeAt(di))|0;
        var sum=0;
        for(var dj=0;dj<count;dj++){
          dh=(dh*1103515245+12345)|0;
          sum+=(Math.abs(dh)%faces)+1;
        }
        return String(sum+(dice[3]?Number(dice[3]):0));
      }
      return token;
    }
    for(var pass=0;pass<16;pass++){
      var before=s;
      s=s.replace(commentRe,"").replace(trimRe,"").replace(tokenRe,evalMacroToken);
      if(s===before)break;
    }
    s=s.replace(commentRe,"").replace(trimRe,"");
    if(g.__liyuanCustomMacros&&g.__liyuanCustomMacros.size>0){
      g.__liyuanCustomMacros.forEach(function(item){
        try{s=s.replace(item.regex,function(){var a=[].slice.call(arguments);return item.replace.apply(g,[{role:"assistant",message_id:lastIdx}].concat(a));});}catch(e){}
      });
    }
    return s;
  };

  // 聊天消息读写族（刀5：getChatMessages 支持数字、负索引与 "0-{{lastMessageId}}" 范围字符串）
  function parseMessageRange(input,min,max){
    if(max<min)return null;
    var clamp=function(v){var n=Number(v);var adj=n<0?(max+n+1):n;return Math.min(Math.max(adj,min),max);};
    var str=String(input==null?"0-"+max:input).trim();
    var m1=/^(-?\\d+)$/.exec(str);
    if(m1){var idx=clamp(Number(m1[1]));return isNaN(idx)?null:{start:idx,end:idx};}
    var m2=/^(-?\\d+)\\s*-\\s*(-?\\d+)$/.exec(str);
    if(m2){
      var a=clamp(Number(m2[1])),b=clamp(Number(m2[2]));
      if(isNaN(a)||isNaN(b))return null;
      return {start:Math.min(a,b),end:Math.max(a,b)};
    }
    return null;
  }
  g.getChatMessages=function(range,opts){
    var d=g.getAllVariables();
    var c=readRuntimeCtx();
    var list=c&&Array.isArray(c.messages)?c.messages:null;
    if(!list||!list.length){
      return [{message_id:0,name:"",role:"assistant",is_hidden:false,message:"",mes:"",data:d,extra:{},variables:d,swipe_id:0,swipes:[""],swipes_data:[d],swipes_info:[{}]}];
    }
    var mapped=list.map(function(m,idx){
      var txt=String((m&&(m.message!=null?m.message:m.text))||"");
      var msgVars=(g.__liyuanScopedVars&&g.__liyuanScopedVars.message&&g.__liyuanScopedVars.message[String(idx)])||m.data||d;
      var role=m.role||"assistant";
      var hidden=Boolean(m.is_hidden);
      var item={
        message_id:typeof m.message_id==="number"?m.message_id:idx,
        name:m.name||"",
        role:role,
        is_hidden:hidden,
        message:txt,
        mes:txt,
        data:msgVars,
        extra:m.extra||{},
        variables:msgVars,
        swipe_id:m.swipe_id||0,
        swipes:Array.isArray(m.swipes)?m.swipes:[txt],
        swipes_data:[msgVars],
        swipes_info:[m.extra||{}]
      };
      return item;
    });
    var roleFilter=(opts&&opts.role)||"all";
    var hideFilter=(opts&&opts.hide_state)||"all";
    var selected=mapped;
    if(range!==undefined&&range!==null&&range!==""){
      var demacro=g.substitudeMacros(String(range));
      var r=parseMessageRange(demacro,0,mapped.length-1);
      if(!r)return [];
      selected=mapped.slice(r.start,r.end+1);
    }
    return selected.filter(function(item){
      if(roleFilter!=="all"&&item.role!==roleFilter)return false;
      if(hideFilter!=="all"&&(hideFilter==="hidden")!==Boolean(item.is_hidden))return false;
      return true;
    });
  };
  g.setChatMessages=function(chat_messages,_opts){
    if(!Array.isArray(chat_messages))return Promise.resolve();
    var protectText=isPresetFrameNow();
    var c=readRuntimeCtx();
    var list=c&&Array.isArray(c.messages)?c.messages:[];
    chat_messages.forEach(function(patch){
      if(!patch||typeof patch!=="object")return;
      var rawId=Number(patch.message_id);
      var idx=rawId<0?(list.length+rawId):rawId;
      if(patch.data&&typeof patch.data==="object"){
        g.__liyuanAuthorVarsWrite("message",patch.data,"replace",idx);
      }
      if(protectText)return;
      var newText=typeof patch.message==="string"?patch.message:(Array.isArray(patch.swipes)&&typeof patch.swipes[patch.swipe_id||0]==="string"?patch.swipes[patch.swipe_id||0]:undefined);
      var nextSwipeId=typeof patch.swipe_id==="number"?patch.swipe_id:undefined;
      if(typeof newText==="string"||nextSwipeId!==undefined){
        if(list[idx]){
          if(typeof newText==="string"){list[idx].message=newText;list[idx].mes=newText;list[idx].text=newText;}
          if(nextSwipeId!==undefined)list[idx].swipe_id=nextSwipeId;
        }
        if((idx===0||idx===list.length-1)&&g.Liyuan&&typeof g.Liyuan.call==="function"){
          try{g.Liyuan.call("messages.updateReply",{message_id:idx,swipe_id:nextSwipeId,text:typeof newText==="string"?newText:""});}catch(e){}
        }
      }
    });
    return Promise.resolve();
  };
  g.setChatMessage=function(field_values,message_id,opts){
    var text=typeof field_values==="string"?field_values:(field_values&&typeof field_values.message==="string"?field_values.message:undefined);
    var data=(field_values&&typeof field_values==="object"&&field_values.data)?field_values.data:undefined;
    var swipeId=(opts&&typeof opts.swipe_id==="number")?opts.swipe_id:(field_values&&typeof field_values==="object"&&typeof field_values.swipe_id==="number"?field_values.swipe_id:undefined);
    return g.setChatMessages([{message_id:message_id===undefined?g.getLastMessageId():message_id,message:text,data:data,swipe_id:swipeId}],opts);
  };
  g.createChatMessages=function(msgs){
    if(isPresetFrameNow())return Promise.resolve();
    if(!Array.isArray(msgs)||!msgs.length)return Promise.resolve();
    var last=msgs[msgs.length-1];
    if(last&&last.role==="user"&&typeof last.message==="string"&&g.Liyuan&&typeof g.Liyuan.call==="function"){
      return g.Liyuan.call("chat.submit",{text:last.message,wait:false});
    }
    return Promise.resolve();
  };
  g.deleteChatMessages=function(ids){
    if(isPresetFrameNow())return Promise.resolve();
    var c=readRuntimeCtx();
    var list=c&&Array.isArray(c.messages)?c.messages:[];
    var lastIdx=list.length-1;
    if(Array.isArray(ids)&&(ids.indexOf(lastIdx)>=0||ids.indexOf(-1)>=0)&&g.Liyuan&&typeof g.Liyuan.call==="function"){
      return g.Liyuan.call("messages.dropLast",{});
    }
    return Promise.resolve();
  };
  g.rotateChatMessages=function(){return Promise.resolve();};
  g.refreshOneMessage=function(){return Promise.resolve();};
  g.formatAsDisplayedMessage=function(text){
    return g.formatAsTavernRegexedString(String(text==null?"":text),"ai_output","display");
  };
  g.retrieveDisplayedMessage=function(message_id){
    var c=readRuntimeCtx();
    var list=c&&Array.isArray(c.messages)?c.messages:[];
    var rawId=message_id===undefined||message_id==="last"?g.getLastMessageId():Number(message_id);
    var idx=rawId<0?Math.max(0,list.length+rawId):rawId;
    var pw=parentWin();
    var pdoc=(pw&&pw.document)||g.document;
    var jq=g.jQuery||g.$||(pw&&(pw.jQuery||pw.$));
    if(jq&&pdoc){
      try{
        var $mes=jq('.mes[mesid="'+idx+'"], .msg[data-mesid="'+idx+'"], .msg[data-message-id="'+idx+'"]',pdoc);
        if($mes.length>0){
          var $txt=$mes.find("div.mes_text");
          if($txt.length>0)return $txt;
          return $mes;
        }
        var $iframes=jq('iframe[data-liyuan-message-id="'+idx+'"], iframe[id^="TH-message--'+idx+'--"], iframe[name^="TH-message--'+idx+'--"]',pdoc);
        if($iframes.length>0){
          return $iframes.parent();
        }
        var m=g.getChatMessages(idx)[0];
        var html=g.formatAsDisplayedMessage(m?m.message:"");
        return jq('<div class="mes_text"></div>').html(html);
      }catch(e){}
    }
    var m2=g.getChatMessages(idx)[0];
    var fallbackHtml=g.formatAsDisplayedMessage(m2?m2.message:"");
    return {
      length:1,
      html:function(){return fallbackHtml;},
      text:function(){return fallbackHtml;},
      find:function(){return {length:0,toArray:function(){return [];}};}
    };
  };

  // 正则格式化（刀5：formatAsTavernRegexedString / getTavernRegexes）
  g.formatAsTavernRegexedString=function(text,source,destination,opts){
    var s=g.substitudeMacros(String(text==null?"":text));
    var c=readRuntimeCtx();
    var dest=(destination==="prompt"||(opts&&opts.isPrompt))?"prompt":"display";
    var srcMap={user_input:1,ai_output:2,slash_command:3,world_info:5,reasoning:6};
    var targetPlace=typeof source==="number"?source:(srcMap[String(source||"ai_output")]||2);
    var depth=(opts&&typeof opts.depth==="number"&&isFinite(opts.depth))?opts.depth:undefined;
    function escapeRegexChars(v){return String(v||"").replace(/[.*+?^\${}()|[\\]\\\\]/g,"\\\\$&");}
    function splitRegexLiteral(raw){
      var str=String(raw||"");
      if(str.charAt(0)==="/"){
        for(var i=str.length-1;i>0;i--){
          if(str.charAt(i)==="/"){
            var bs=0;
            for(var j=i-1;j>=0&&str.charAt(j)==="\\\\";j--)bs++;
            if(bs%2===0){
              return {pattern:str.slice(1,i),flags:str.slice(i+1)||"g"};
            }
          }
        }
      }
      return {pattern:str,flags:"g"};
    }
    function expandRepl(tpl,match,captures,trims){
      function cut(v){
        var out=String(v==null?"":v);
        if(Array.isArray(trims)){
          for(var ti=0;ti<trims.length;ti++){
            if(trims[ti])out=out.split(String(trims[ti])).join("");
          }
        }
        return out;
      }
      var wMatch=String(tpl||"").replace(/\\{\\{\\s*match\\s*\\}\\}/gi,function(){return cut(match);});
      var isLong=wMatch.length>=8000;
      return wMatch.replace(/\\$(\\$|&|\\d{1,2})/g,function(whole,kind){
        if(kind==="$")return "$";
        if(kind==="&")return isLong?whole:cut(match);
        var n=Number(kind);
        if(n>=1&&n<=captures.length)return cut(captures[n-1]||"");
        return whole;
      });
    }
    var baseList=dest==="prompt"?(c&&c.promptRules):(c&&c.displayRules);
    var collected=[];
    var seenKeys={};
    function pushNormalized(r,fromRawPreset){
      if(!r||typeof r!=="object"||r.enabled===false||r.disabled===true)return;
      if(fromRawPreset){
        var md=Boolean(r.markdownOnly);
        var pr=Boolean(r.promptOnly);
        if(dest==="prompt"){if(md&&!pr)return;}
        else{if(pr&&!md)return;}
      }
      var pls=Array.isArray(r.placement)?r.placement:null;
      if(pls&&pls.indexOf(targetPlace)<0)return;
      if(!pls&&targetPlace!==2)return;
      var minD=typeof r.minDepth==="number"?r.minDepth:(typeof r.min_depth==="number"?r.min_depth:null);
      var maxD=typeof r.maxDepth==="number"?r.maxDepth:(typeof r.max_depth==="number"?r.max_depth:null);
      if(depth!==undefined){
        if(minD!==null&&depth<minD)return;
        if(maxD!==null&&depth>maxD)return;
      }
      var rawPat=r.pattern||r.source||r.findRegex||r.find_regex;
      if(!rawPat)return;
      var parsed=r.pattern?{pattern:String(r.pattern),flags:String(r.flags||"g")}:splitRegexLiteral(rawPat);
      if(!parsed.pattern)return;
      var rep=r.replace!==undefined?String(r.replace):(r.replaceString!==undefined?String(r.replaceString):String(r.replace_string||""));
      var trims=Array.isArray(r.trim)?r.trim:(Array.isArray(r.trimStrings)?r.trimStrings:(Array.isArray(r.trim_strings)?r.trim_strings:[]));
      var subMode=typeof r.substituteRegex==="number"?r.substituteRegex:0;
      var dedupKey=parsed.pattern+"\\u0000"+parsed.flags+"\\u0000"+rep;
      if(seenKeys[dedupKey])return;
      seenKeys[dedupKey]=true;
      collected.push({pattern:parsed.pattern,flags:parsed.flags,replace:rep,trim:trims,substituteRegex:subMode});
    }
    if(Array.isArray(baseList)){
      for(var bi=0;bi<baseList.length;bi++)pushNormalized(baseList[bi],false);
    }
    var rawPresetRegex=(c&&c.presetRaw&&c.presetRaw.extensions&&Array.isArray(c.presetRaw.extensions.regex_scripts))?c.presetRaw.extensions.regex_scripts:[];
    for(var pi=0;pi<rawPresetRegex.length;pi++)pushNormalized(rawPresetRegex[pi],true);
    for(var i=0;i<collected.length;i++){
      var r=collected[i];
      try{
        var pat=r.pattern;
        if(r.substituteRegex===1)pat=g.substitudeMacros(pat);
        else if(r.substituteRegex===2){
          pat=pat.replace(/\\{\\{(?:(?!\\{\\{)[\\s\\S])*?\\}\\}/g,function(tok){return escapeRegexChars(g.substitudeMacros(tok));});
        }
        var re=new RegExp(pat,r.flags||"g");
        var tpl=g.substitudeMacros(r.replace);
        s=s.replace(re,function(match){
          var args=[].slice.call(arguments,1);
          var last=args[args.length-1];
          var hasGroups=typeof last==="object"&&last!==null;
          var capEnd=hasGroups?args.length-3:args.length-2;
          var caps=args.slice(0,Math.max(0,capEnd));
          return expandRepl(tpl,match,caps,r.trim);
        });
      }catch(e){}
    }
    return s;
  };
  g.isCharacterTavernRegexesEnabled=function(){return true;};
  function toTavernRegex(r){
    if(!r||typeof r!=="object")return null;
    if(r.source&&r.destination&&typeof r.script_name==="string")return deepClone(r);
    var pl=Array.isArray(r.placement)?r.placement:[];
    return {
      id:String(r.id||""),
      script_name:String(r.scriptName||r.name||""),
      enabled:r.disabled!==true&&r.enabled!==false,
      find_regex:String(r.findRegex||r.pattern||""),
      trim_strings:Array.isArray(r.trimStrings)?r.trimStrings.slice():[],
      replace_string:String(r.replaceString||r.replace||""),
      source:{
        user_input:pl.indexOf(1)>=0,
        ai_output:pl.indexOf(2)>=0,
        slash_command:pl.indexOf(3)>=0,
        world_info:pl.indexOf(5)>=0,
        reasoning:pl.indexOf(6)>=0
      },
      destination:{
        display:Boolean(r.markdownOnly),
        prompt:Boolean(r.promptOnly)
      },
      run_on_edit:Boolean(r.runOnEdit),
      min_depth:typeof r.minDepth==="number"?r.minDepth:null,
      max_depth:typeof r.maxDepth==="number"?r.maxDepth:null
    };
  }
  function fromTavernRegex(tr,orig){
    if(!tr||typeof tr!=="object")return null;
    var pl=[];
    var src=tr.source||{};
    if(src.user_input)pl.push(1);
    if(src.ai_output)pl.push(2);
    if(src.slash_command)pl.push(3);
    if(src.world_info)pl.push(5);
    if(src.reasoning)pl.push(6);
    var dst=tr.destination||{};
    return {
      id:String(tr.id||""),
      scriptName:String(tr.script_name||""),
      disabled:!tr.enabled,
      runOnEdit:Boolean(tr.run_on_edit),
      findRegex:String(tr.find_regex||""),
      trimStrings:Array.isArray(tr.trim_strings)?tr.trim_strings.slice():[],
      replaceString:String(tr.replace_string||""),
      placement:pl,
      substituteRegex:(orig&&typeof orig.substituteRegex==="number")?orig.substituteRegex:0,
      minDepth:tr.min_depth!==undefined?tr.min_depth:null,
      maxDepth:tr.max_depth!==undefined?tr.max_depth:null,
      markdownOnly:Boolean(dst.display),
      promptOnly:Boolean(dst.prompt)
    };
  }
  g.getTavernRegexes=function(option){
    var opt=option&&typeof option==="object"?option:null;
    if(opt&&opt.type==="preset"){
      var sRaw=(typeof g.__liyuanGetSharedPresetRaw==="function")?g.__liyuanGetSharedPresetRaw():null;
      var scripts=(sRaw&&sRaw.extensions&&Array.isArray(sRaw.extensions.regex_scripts))?sRaw.extensions.regex_scripts:[];
      var out=[];
      for(var i=0;i<scripts.length;i++){
        var conv=toTavernRegex(scripts[i]);
        if(conv)out.push(conv);
      }
      return out;
    }
    var c=readRuntimeCtx();
    return (c&&Array.isArray(c.displayRules))?deepClone(c.displayRules):[];
  };
  g.replaceTavernRegexes=function(regexes,option){
    var opt=option&&typeof option==="object"?option:null;
    if(opt&&opt.type==="preset"&&isPresetFrameNow())return Promise.resolve();
    if(opt&&opt.type==="preset"&&Array.isArray(regexes)){
      var sRaw=(typeof g.__liyuanGetSharedPresetRaw==="function")?g.__liyuanGetSharedPresetRaw():null;
      if(sRaw){
        if(!sRaw.extensions||typeof sRaw.extensions!=="object")sRaw.extensions={};
        var prevList=Array.isArray(sRaw.extensions.regex_scripts)?sRaw.extensions.regex_scripts:[];
        var nextList=regexes.map(function(tr){
          var orig=prevList.find(function(x){return x&&x.id&&tr&&x.id===tr.id;});
          return fromTavernRegex(tr,orig);
        }).filter(Boolean);
        sRaw.extensions.regex_scripts=nextList;
        if(typeof g.__liyuanCommitPresetPatch==="function"){
          return g.__liyuanCommitPresetPatch({extensionsPatch:{regex_scripts:nextList}});
        }
      }
    }
    return Promise.resolve();
  };
  g.updateTavernRegexesWith=function(updater,option){
    var cur=g.getTavernRegexes(option);
    var res=typeof updater==="function"?updater(cur):cur;
    if(res&&typeof res.then==="function"){
      return res.then(function(next){
        return Promise.resolve(g.replaceTavernRegexes(next,option)).then(function(){return next;});
      });
    }
    return Promise.resolve(g.replaceTavernRegexes(res,option)).then(function(){return res;});
  };

  // 世界书函数族（刀5：worldbook 与 lorebook 双命名族）
  function toWorldbookEntry(e,idx){
    var keys=Array.isArray(e.keys)?e.keys:[];
    return {
      uid:typeof e.uid==="number"?e.uid:(typeof e.id==="number"?e.id:idx),
      name:String(e.comment||e.title||e.name||("条目-"+idx)),
      comment:String(e.comment||e.title||e.name||""),
      enabled:e.enabled!==false&&e.disable!==true,
      disable:e.enabled===false||e.disable===true,
      constant:Boolean(e.constant),
      keys:keys,
      key:keys,
      content:String(e.content||""),
      strategy:{
        type:e.constant?"constant":"selective",
        keys:keys,
        keys_secondary:{logic:"and_any",keys:[]},
        scan_depth:"same_as_global"
      },
      position:{
        type:e.position||"before_character_definition",
        role:"system",
        depth:typeof e.depth==="number"?e.depth:4,
        order:typeof e.insertion_order==="number"?e.insertion_order:100
      },
      probability:100,
      recursion:{prevent_incoming:false,prevent_outgoing:false,delay_until:null},
      effect:{sticky:null,cooldown:null,delay:null},
      extra:{fingerprint:e.fingerprint}
    };
  }
  g.getWorldbookNames=function(){
    var c=readRuntimeCtx();
    if(c&&Array.isArray(c.worldbooks)&&c.worldbooks.length>0)return c.worldbooks.slice();
    var cn=c&&c.charName?String(c.charName).trim():"";
    return cn?[cn+"·世界书",cn,"default"]:["default"];
  };
  g.getLorebooks=g.getWorldbookNames;
  g.getLorebookNames=g.getWorldbookNames;
  g.getGlobalWorldbookNames=g.getWorldbookNames;
  g.rebindGlobalWorldbooks=function(names){
    if(isPresetFrameNow())return Promise.resolve();
    if(Array.isArray(names)&&g.Liyuan&&typeof g.Liyuan.call==="function"){
      names.forEach(function(n){try{g.Liyuan.call("lorebooks.mount",{path:n,mounted:true});}catch(e){}});
    }
    return Promise.resolve();
  };
  g.getCharWorldbookNames=function(){
    var names=g.getWorldbookNames();
    return {primary:names[0]||null,additional:names.slice(1)};
  };
  g.getCharLorebooks=g.getCharWorldbookNames;
  g.getCurrentCharPrimaryLorebook=function(){return g.getCharWorldbookNames().primary;};
  g.rebindCharWorldbooks=function(){return Promise.resolve();};
  g.setCurrentCharLorebooks=g.rebindCharWorldbooks;
  g.getChatWorldbookName=function(){return g.getCurrentCharPrimaryLorebook();};
  g.getChatLorebook=g.getChatWorldbookName;
  g.rebindChatWorldbook=function(chatName,bookName){
    if(isPresetFrameNow())return Promise.resolve();
    var target=bookName||chatName;
    if(typeof target==="string"&&g.Liyuan&&typeof g.Liyuan.call==="function"){
      return g.Liyuan.call("lorebooks.mount",{path:target,mounted:true}).then(function(){});
    }
    return Promise.resolve();
  };
  g.setChatLorebook=g.rebindChatWorldbook;
  g.getOrCreateChatWorldbook=function(_chatName,bookName){
    var name=bookName||g.getCurrentCharPrimaryLorebook()||"chat-lorebook";
    return Promise.resolve(name);
  };
  g.getOrCreateChatLorebook=g.getOrCreateChatWorldbook;
  g.createWorldbook=function(name,entries){
    if(isPresetFrameNow())return Promise.resolve(false);
    if(Array.isArray(entries)&&entries.length&&g.Liyuan&&typeof g.Liyuan.call==="function"){
      return g.createWorldbookEntries(name,entries).then(function(){return true;});
    }
    return Promise.resolve(true);
  };
  g.createLorebook=g.createWorldbook;
  g.createOrReplaceWorldbook=g.createWorldbook;
  g.deleteWorldbook=function(){return Promise.resolve(!isPresetFrameNow());};
  g.deleteLorebook=g.deleteWorldbook;
  g.getWorldbook=function(name){
    if(!g.Liyuan||typeof g.Liyuan.call!=="function")return Promise.resolve([]);
    var req=typeof name==="string"&&name.trim()?{book:name.trim()}:{};
    return g.Liyuan.call("lorebooks.read",req).then(function(env){
      var raw=(env&&env.ok&&env.result&&Array.isArray(env.result.entries))?env.result.entries:[];
      return raw.map(toWorldbookEntry);
    });
  };
  g.getLorebookEntries=g.getWorldbook;
  g.createWorldbookEntries=function(bookName,newEntries){
    if(isPresetFrameNow())return Promise.resolve({worldbook:[],new_entries:[]});
    var list=Array.isArray(newEntries)?newEntries:(newEntries?[newEntries]:[]);
    if(!g.Liyuan||typeof g.Liyuan.call!=="function")return Promise.resolve({worldbook:[],new_entries:[]});
    var tasks=list.map(function(item){
      var title=String(item.name||item.comment||item.title||"新条目");
      var keys=Array.isArray(item.keys)?item.keys:(item.strategy&&Array.isArray(item.strategy.keys)?item.strategy.keys:(Array.isArray(item.key)?item.key:[title]));
      var constant=Boolean(item.constant||(item.strategy&&item.strategy.type==="constant"));
      var content=String(item.content||"");
      return g.Liyuan.call("lorebooks.createEntry",{title:title,keys:keys,content:content,constant:constant,book:bookName});
    });
    return Promise.all(tasks).then(function(){
      return g.getWorldbook(bookName).then(function(wb){return {worldbook:wb,new_entries:wb.slice(-list.length)};});
    });
  };
  g.createLorebookEntries=g.createWorldbookEntries;
  g.createLorebookEntry=function(bookName,entry){
    if(isPresetFrameNow())return Promise.resolve(null);
    return g.createWorldbookEntries(bookName,[entry]).then(function(r){return r.new_entries[0]||null;});
  };
  g.replaceWorldbook=function(bookName,entries){
    if(isPresetFrameNow())return Promise.resolve();
    if(!Array.isArray(entries)||!g.Liyuan||typeof g.Liyuan.call!=="function")return Promise.resolve();
    return g.Liyuan.call("lorebooks.read",typeof bookName==="string"&&bookName.trim()?{book:bookName.trim()}:{}).then(function(env){
      var existing=(env&&env.ok&&env.result&&Array.isArray(env.result.entries))?env.result.entries:[];
      var tasks=entries.map(function(item,idx){
        var fp=(item.extra&&item.extra.fingerprint)||(existing[idx]&&existing[idx].fingerprint);
        var title=String(item.name||item.comment||item.title||("条目-"+idx));
        var keys=Array.isArray(item.keys)?item.keys:(item.strategy&&Array.isArray(item.strategy.keys)?item.strategy.keys:[]);
        var constant=Boolean(item.constant||(item.strategy&&item.strategy.type==="constant"));
        var content=String(item.content||"");
        if(fp)return g.Liyuan.call("lorebooks.updateEntry",{fingerprint:fp,title:title,keys:keys,content:content,constant:constant});
        if(content.trim())return g.Liyuan.call("lorebooks.createEntry",{title:title,keys:keys,content:content,constant:constant,book:bookName});
        return Promise.resolve();
      });
      return Promise.all(tasks).then(function(){});
    });
  };
  g.replaceLorebookEntries=g.replaceWorldbook;
  g.setLorebookEntries=g.replaceWorldbook;
  g.updateWorldbookWith=function(bookName,updater){
    if(isPresetFrameNow())return g.getWorldbook(bookName);
    return g.getWorldbook(bookName).then(function(entries){
      var res=typeof updater==="function"?updater(deepClone(entries)):entries;
      return Promise.resolve(res).then(function(nextEntries){
        return g.replaceWorldbook(bookName,nextEntries).then(function(){return nextEntries;});
      });
    });
  };
  g.updateLorebookEntriesWith=g.updateWorldbookWith;
  g.deleteWorldbookEntries=function(bookName,predicate){
    if(isPresetFrameNow())return Promise.resolve({worldbook:[],deleted_entries:[]});
    return g.Liyuan.call("lorebooks.read",typeof bookName==="string"&&bookName.trim()?{book:bookName.trim()}:{}).then(function(env){
      var existing=(env&&env.ok&&env.result&&Array.isArray(env.result.entries))?env.result.entries:[];
      var mapped=existing.map(toWorldbookEntry);
      var toDelete=[];
      mapped.forEach(function(entry,idx){
        var match=typeof predicate==="function"?predicate(entry):(Array.isArray(predicate)?predicate.indexOf(entry.uid)>=0:predicate===entry.uid);
        if(match&&existing[idx]&&existing[idx].fingerprint)toDelete.push(existing[idx].fingerprint);
      });
      return Promise.all(toDelete.map(function(fp){return g.Liyuan.call("lorebooks.removeEntry",{fingerprint:fp});})).then(function(){
        return g.getWorldbook(bookName).then(function(wb){return {worldbook:wb,deleted_entries:[]};});
      });
    });
  };
  g.deleteLorebookEntries=g.deleteWorldbookEntries;
  g.deleteLorebookEntry=function(bookName,uid){return g.deleteWorldbookEntries(bookName,[uid]);};
  g.getLorebookSettings=function(){return {scan_depth:4,context_percentage:25,budget_cap:0,min_activations:0,max_depth:0,max_recursion_steps:2};};
  g.setLorebookSettings=function(){};

  // 角色、用户、预设、音频、文件、扩展、内建、脚本管理与提示词注入全集（对齐 JS-Slash-Runner 4.12.1 src/function/index.ts）
  g.getCurrentCharacterName=function(){var c=readRuntimeCtx();return c?String(c.charName||""):"";};
  g.getCurrentCharacterId=function(){var c=readRuntimeCtx();return (c&&c.card)||"0.png";};
  g.getCharacterNames=function(){var n=g.getCurrentCharacterName();return n?[n]:[];};
  g.getCharacterIds=function(){return [g.getCurrentCharacterId()];};
  function buildCharRecord(){
    var n=g.getCurrentCharacterName()||"Character";
    var avatar=g.getCurrentCharacterId()||(n+".png");
    return {
      name:n,
      avatar:avatar,
      version:"",
      creator:"",
      creator_notes:"",
      worldbook:g.getCurrentCharPrimaryLorebook(),
      description:"",
      personality:"",
      scenario:"",
      first_mes:"",
      first_messages:[""],
      data:{
        name:n,
        description:"",
        personality:"",
        scenario:"",
        first_mes:"",
        alternate_greetings:[],
        character_version:"",
        creator:"",
        creator_notes:"",
        extensions:{
          regex_scripts:g.getTavernRegexes(),
          tavern_helper:{scripts:[],variables:g.getVariables({type:"character"})}
        }
      },
      extensions:{
        regex_scripts:g.getTavernRegexes(),
        tavern_helper:{scripts:[],variables:g.getVariables({type:"character"})}
      }
    };
  }
  g.getCharacter=function(){return Promise.resolve(deepClone(buildCharRecord()));};
  g.createCharacter=function(){return Promise.resolve(true);};
  g.createOrReplaceCharacter=function(){return Promise.resolve(true);};
  g.deleteCharacter=function(){return Promise.resolve(true);};
  g.replaceCharacter=function(){return Promise.resolve();};
  g.updateCharacterWith=function(_name,updater){
    return g.getCharacter(_name).then(function(ch){
      return Promise.resolve(typeof updater==="function"?updater(ch):ch);
    });
  };
  var RawCharClass=function(charData){this.character_data=charData||buildCharRecord();};
  RawCharClass.find=function(){return buildCharRecord();};
  RawCharClass.findIndex=function(){return 0;};
  RawCharClass.getChatsFromFiles=function(){return Promise.resolve({});};
  RawCharClass.prototype.getCardData=function(){return this.character_data;};
  RawCharClass.prototype.getAvatarId=function(){return this.character_data.avatar||"0.png";};
  RawCharClass.prototype.getRegexScripts=function(){return g.getTavernRegexes();};
  RawCharClass.prototype.getCharacterBook=function(){return null;};
  RawCharClass.prototype.getWorldName=function(){return g.getCurrentCharPrimaryLorebook()||"";};
  g.RawCharacter=RawCharClass;
  g.getCharData=function(){return buildCharRecord();};
  g.getCharAvatarPath=function(){var c=readRuntimeCtx();return "/api/cards/image?path="+encodeURIComponent((c&&c.card)||"");};
  g.getChatHistoryBrief=function(){return Promise.resolve([]);};
  g.getChatHistoryDetail=function(){return Promise.resolve({});};

  g.getCurrentPersonaName=function(){var c=readRuntimeCtx();return c?String(c.userName||""):"";};
  g.getCurrentPersonaId=function(){return "default.png";};
  g.getPersonaNames=function(){var n=g.getCurrentPersonaName();return n?[n]:[];};
  g.getPersonaIds=function(){return [g.getCurrentPersonaId()];};
  g.getPersonaAvatarPath=function(){return "./User Avatars/default.png";};
  g.getPersona=function(){
    var n=g.getCurrentPersonaName()||"User";
    return {avatar_id:"default.png",avatar:"default.png",name:n,title:"",description:"",position:0,depth:2,role:0,lorebook:"",connections:[],is_default:true};
  };
  g.createPersona=function(){return Promise.resolve(true);};
  g.createOrReplacePersona=function(){return Promise.resolve(true);};
  g.deletePersona=function(){return Promise.resolve(true);};
  g.replacePersona=function(){return Promise.resolve();};
  g.updatePersonaWith=function(_id,updater){
    var p=g.getPersona(_id);
    return Promise.resolve(typeof updater==="function"?updater(p):p);
  };

  var DEFAULT_SETTINGS_SNAPSHOT={
    max_context:2000000,max_completion_tokens:4096,reply_count:1,should_stream:true,
    temperature:1,frequency_penalty:0,presence_penalty:0,repetition_penalty:1,
    top_p:1,min_p:0,top_k:0,top_a:0,seed:-1,squash_system_messages:false,
    reasoning_effort:"auto",request_thoughts:false,request_images:false,
    enable_function_calling:false,enable_web_search:false,
    allow_sending_images:"disabled",allow_sending_videos:false,
    character_name_prefix:"none",wrap_user_messages_in_quotes:false
  };
  g.default_preset={
    settings:deepClone(DEFAULT_SETTINGS_SNAPSHOT),
    prompts:[
      {id:"worldInfoBefore",name:"World Info (before)",enabled:true,position:{type:"relative"},role:"system"},
      {id:"personaDescription",name:"Persona Description",enabled:true,position:{type:"relative"},role:"system"},
      {id:"charDescription",name:"Char Description",enabled:true,position:{type:"relative"},role:"system"},
      {id:"charPersonality",name:"Char Personality",enabled:true,position:{type:"relative"},role:"system"},
      {id:"scenario",name:"Scenario",enabled:true,position:{type:"relative"},role:"system"},
      {id:"worldInfoAfter",name:"World Info (after)",enabled:true,position:{type:"relative"},role:"system"},
      {id:"dialogueExamples",name:"Chat Examples",enabled:true,position:{type:"relative"},role:"system"},
      {id:"chatHistory",name:"Chat History",enabled:true,position:{type:"relative"},role:"system"}
    ],
    prompts_unused:[],
    extensions:{tavern_helper:{scripts:[],variables:{}}}
  };
  g.isPresetSystemPrompt=function(p){return Boolean(p&&["main","nsfw","jailbreak","enhanceDefinitions"].indexOf(p.id)>=0);};
  g.isPresetPlaceholderPrompt=function(p){return Boolean(p&&["worldInfoBefore","personaDescription","charDescription","charPersonality","scenario","worldInfoAfter","dialogueExamples","chatHistory"].indexOf(p.id)>=0);};
  g.isPresetNormalPrompt=function(p){return !g.isPresetSystemPrompt(p)&&!g.isPresetPlaceholderPrompt(p);};

  // ---- 预设三通道统一共享底座（通道 A / B / C 共享同一引用与父页 DOM 镜像） ----
  var presetHost=pw0||g;
  function makeEmptyOriginalPreset(){
    return {
      max_context_unlocked:true,openai_max_context:2000000,openai_max_tokens:4096,n:1,stream_openai:true,
      temperature:1,frequency_penalty:0,presence_penalty:0,top_p:1,repetition_penalty:1,min_p:0,top_k:0,top_a:0,
      temp_openai:1,freq_pen_openai:0,pres_pen_openai:0,top_p_openai:1,repetition_penalty_openai:1,min_p_openai:0,top_k_openai:0,top_a_openai:0,
      seed:-1,squash_system_messages:false,reasoning_effort:"auto",show_thoughts:false,request_images:false,
      function_calling:false,enable_web_search:false,image_inlining:false,inline_image_quality:"auto",
      video_inlining:false,names_behavior:-1,wrap_in_quotes:false,
      prompts:[],
      prompt_order:[{character_id:100001,order:[]}],
      extensions:{regex_scripts:[],tavern_helper:{scripts:[],variables:{}}}
    };
  }
  function mutateObjectInPlace(target,src){
    if(!target||typeof target!=="object"||!src||typeof src!=="object")return target;
    var k;
    for(k in target){
      if(Object.prototype.hasOwnProperty.call(target,k)&&!Object.prototype.hasOwnProperty.call(src,k)){
        delete target[k];
      }
    }
    for(k in src){
      if(Object.prototype.hasOwnProperty.call(src,k)){
        target[k]=deepClone(src[k]);
      }
    }
    return target;
  }
  function normalizeOriginalPresetObj(raw){
    var base=makeEmptyOriginalPreset();
    if(raw&&typeof raw==="object"){
      for(var k in raw){
        if(Object.prototype.hasOwnProperty.call(raw,k)){
          base[k]=deepClone(raw[k]);
        }
      }
    }
    if(!Array.isArray(base.prompts))base.prompts=[];
    if(!Array.isArray(base.prompt_order))base.prompt_order=[{character_id:100001,order:[]}];
    if(!base.extensions||typeof base.extensions!=="object")base.extensions={};
    if(!Array.isArray(base.extensions.regex_scripts))base.extensions.regex_scripts=[];
    if(!base.extensions.tavern_helper||typeof base.extensions.tavern_helper!=="object")base.extensions.tavern_helper={scripts:[],variables:{}};
    // 同步 *_openai 运行态镜像键，兼容只带 temperature 或只带 temp_openai 的预设原文
    var mPairs=[["temperature","temp_openai"],["frequency_penalty","freq_pen_openai"],["presence_penalty","pres_pen_openai"],["top_p","top_p_openai"],["repetition_penalty","repetition_penalty_openai"],["min_p","min_p_openai"],["top_k","top_k_openai"],["top_a","top_a_openai"]];
    for(var pi=0;pi<mPairs.length;pi++){
      var fk=mPairs[pi][0],uk=mPairs[pi][1];
      var hasF=raw&&typeof raw[fk]==="number";
      var hasU=raw&&typeof raw[uk]==="number";
      if(hasF&&!hasU)base[uk]=raw[fk];
      else if(hasU&&!hasF)base[fk]=raw[uk];
    }
    return base;
  }
  function pickOrderObj(raw){
    if(!raw||!Array.isArray(raw.prompt_order))return null;
    var first=null;
    for(var i=0;i<raw.prompt_order.length;i++){
      var item=raw.prompt_order[i];
      if(!item||typeof item!=="object"||!Array.isArray(item.order))continue;
      if(!first)first=item;
      if(item.character_id===100001)return item;
    }
    return first;
  }
  function snapshotPresetBaseline(raw){
    var orderObj=pickOrderObj(raw);
    var pMap={};
    var prompts=Array.isArray(raw&&raw.prompts)?raw.prompts:[];
    for(var i=0;i<prompts.length;i++){
      var p=prompts[i];
      if(p&&typeof p.identifier==="string")pMap[p.identifier]=JSON.stringify(p);
    }
    var ext=raw&&raw.extensions&&typeof raw.extensions==="object"?raw.extensions:{};
    var thVars=(ext.tavern_helper&&typeof ext.tavern_helper==="object")?ext.tavern_helper.variables:undefined;
    return {
      prompts:pMap,
      orderStr:JSON.stringify(orderObj?orderObj.order:[]),
      regexStr:JSON.stringify(Array.isArray(ext.regex_scripts)?ext.regex_scripts:[]),
      thVarsStr:JSON.stringify(thVars||{}),
      samplersStr:JSON.stringify({
        temperature:raw.temperature,top_p:raw.top_p,top_k:raw.top_k,min_p:raw.min_p,top_a:raw.top_a,
        frequency_penalty:raw.frequency_penalty,presence_penalty:raw.presence_penalty,repetition_penalty:raw.repetition_penalty,
        openai_max_tokens:raw.openai_max_tokens,openai_max_context:raw.openai_max_context,seed:raw.seed,n:raw.n
      })
    };
  }
  function buildMinimalPresetPatch(raw,baseline){
    var patch={};
    var hasChange=false;
    var orderObj=pickOrderObj(raw);
    var curOrder=orderObj?orderObj.order:[];
    var curOrderStr=JSON.stringify(curOrder);
    if(!baseline||curOrderStr!==baseline.orderStr){
      patch.order=curOrder.map(function(o){return {identifier:String(o.identifier),enabled:o.enabled!==false};});
      hasChange=true;
    }
    var prompts=Array.isArray(raw&&raw.prompts)?raw.prompts:[];
    var changedPrompts=[];
    var seenIds={};
    for(var i=0;i<prompts.length;i++){
      var p=prompts[i];
      if(!p||typeof p.identifier!=="string")continue;
      seenIds[p.identifier]=true;
      var pStr=JSON.stringify(p);
      if(!baseline||baseline.prompts[p.identifier]!==pStr){
        changedPrompts.push(deepClone(p));
      }
    }
    if(changedPrompts.length>0){
      patch.prompts=changedPrompts;
      hasChange=true;
    }
    if(baseline&&baseline.prompts){
      var removedBlocks=[];
      for(var bid in baseline.prompts){
        if(Object.prototype.hasOwnProperty.call(baseline.prompts,bid)&&!seenIds[bid]){
          removedBlocks.push({id:bid,remove:true});
        }
      }
      if(removedBlocks.length>0){
        patch.blocks=removedBlocks;
        hasChange=true;
      }
    }
    var samplerKeys=["temperature","top_p","top_k","min_p","top_a","frequency_penalty","presence_penalty","repetition_penalty","openai_max_tokens","openai_max_context","seed","n"];
    var curSamplers={};
    for(var si=0;si<samplerKeys.length;si++){
      var sk=samplerKeys[si];
      if(typeof raw[sk]==="number"&&isFinite(raw[sk]))curSamplers[sk]=raw[sk];
    }
    if(!baseline||JSON.stringify(curSamplers)!==baseline.samplersStr){
      if(Object.keys(curSamplers).length>0){
        patch.samplers=curSamplers;
        hasChange=true;
      }
    }
    var ext=raw&&raw.extensions&&typeof raw.extensions==="object"?raw.extensions:{};
    var extPatch={};
    var curRegexStr=JSON.stringify(Array.isArray(ext.regex_scripts)?ext.regex_scripts:[]);
    if(!baseline||curRegexStr!==baseline.regexStr){
      extPatch.regex_scripts=deepClone(Array.isArray(ext.regex_scripts)?ext.regex_scripts:[]);
    }
    var curThVars=(ext.tavern_helper&&typeof ext.tavern_helper==="object")?ext.tavern_helper.variables:undefined;
    if(curThVars!==undefined&&(!baseline||JSON.stringify(curThVars||{})!==baseline.thVarsStr)){
      extPatch.tavern_helper={variables:deepClone(curThVars)};
    }
    if(Object.keys(extPatch).length>0){
      patch.extensionsPatch=extPatch;
      hasChange=true;
    }
    return hasChange?patch:null;
  }
  function getSharedPresetRaw(){
    if(!presetHost.__liyuanChatCompletionSettings){
      var c=readRuntimeCtx();
      var initRaw=(c&&c.presetRaw&&typeof c.presetRaw==="object")?normalizeOriginalPresetObj(c.presetRaw):makeEmptyOriginalPreset();
      presetHost.__liyuanChatCompletionSettings=initRaw;
      presetHost.__liyuanActivePresetName=(c&&typeof c.presetName==="string"&&c.presetName)?c.presetName:"in_use";
      presetHost.__liyuanPresetBaseline=snapshotPresetBaseline(initRaw);
    }
    return presetHost.__liyuanChatCompletionSettings;
  }
  g.__liyuanGetSharedPresetRaw=getSharedPresetRaw;

  function getPresetRawForCurrentContext(){
    if(!isPresetFrameNow())return getSharedPresetRaw();
    if(!g.__liyuanIsolatedPresetRaw)g.__liyuanIsolatedPresetRaw=deepClone(getSharedPresetRaw());
    return g.__liyuanIsolatedPresetRaw;
  }

  // 已移除父页隐藏通道 C（#completion_prompt_manager_list）假 DOM 注入：保留空同步函数以保持内部调用签名稳定
  function syncPromptManagerDom(_rawOpt){}
  if(!pw0){
    presetHost.__liyuanSyncPromptManagerDom=syncPromptManagerDom;
  }

  function commitPresetPatch(patch){
    if(isPresetFrameNow()){
      return Promise.resolve({ok:false,error:{code:"permission_denied",message:"梨园预设仅允许通过梨园预设面板修改，预设脚本无权修改预设"}});
    }
    if(pw0&&typeof pw0.__liyuanCommitPresetPatch==="function"){
      return pw0.__liyuanCommitPresetPatch(patch);
    }
    if(!patch||typeof patch!=="object")return Promise.resolve({ok:true});
    presetHost.__liyuanPresetLocalDirtyUntil=Date.now()+1500;
    var caller=(presetHost.Liyuan&&typeof presetHost.Liyuan.call==="function")?presetHost.Liyuan.call:(g.Liyuan&&typeof g.Liyuan.call==="function"?g.Liyuan.call:null);
    if(caller){
      return caller("preset.update",{patch:patch}).then(function(env){
        presetHost.__liyuanPresetBaseline=snapshotPresetBaseline(getSharedPresetRaw());
        try{g.eventEmit(g.tavern_events.SETTINGS_UPDATED);}catch(e){}
        try{g.eventEmit(g.tavern_events.OAI_PRESET_CHANGED_AFTER);}catch(e2){}
        return env;
      });
    }
    presetHost.__liyuanPresetBaseline=snapshotPresetBaseline(getSharedPresetRaw());
    return Promise.resolve({ok:true});
  }
  g.__liyuanCommitPresetPatch=commitPresetPatch;
  if(!pw0)presetHost.__liyuanCommitPresetPatch=commitPresetPatch;

  function commitPresetFromSharedState(){
    var raw=getSharedPresetRaw();
    var patch=buildMinimalPresetPatch(raw,presetHost.__liyuanPresetBaseline);
    if(!patch)return Promise.resolve({ok:true});
    return commitPresetPatch(patch);
  }
  function scheduleCommitPresetFromSettings(){
    if(pw0&&typeof pw0.__liyuanSchedulePresetCommit==="function"){
      return pw0.__liyuanSchedulePresetCommit();
    }
    presetHost.__liyuanPresetLocalDirtyUntil=Date.now()+1500;
    if(presetHost.__liyuanPresetSaveTimer)clearTimeout(presetHost.__liyuanPresetSaveTimer);
    presetHost.__liyuanPresetSaveTimer=setTimeout(function(){
      presetHost.__liyuanPresetSaveTimer=null;
      void commitPresetFromSharedState();
    },60);
  }
  if(!pw0)presetHost.__liyuanSchedulePresetCommit=scheduleCommitPresetFromSettings;

  function syncSharedPresetFromCtx(ctx){
    if(!ctx||typeof ctx!=="object")return;
    var nextName=typeof ctx.presetName==="string"&&ctx.presetName?ctx.presetName:"";
    var hasRaw=Boolean(ctx.presetRaw&&typeof ctx.presetRaw==="object");
    var curName=presetHost.__liyuanActivePresetName||"";
    var presetChanged=Boolean(nextName&&curName&&nextName!==curName);
    // 同名预设在本地写回保护窗口内，跳过服务端旧快照倒灌
    if(!presetChanged&&presetHost.__liyuanPresetLocalDirtyUntil&&Date.now()<presetHost.__liyuanPresetLocalDirtyUntil){
      if(nextName)presetHost.__liyuanActivePresetName=nextName;
      return;
    }
    // 子帧初始化时若父页已维护着同预设实时内存状态，不覆写父页
    if(pw0&&pw0.__liyuanChatCompletionSettings&&!presetChanged&&presetHost.__liyuanPresetInitialized){
      return;
    }
    if(hasRaw){
      var normalized=normalizeOriginalPresetObj(ctx.presetRaw);
      var target=getSharedPresetRaw();
      mutateObjectInPlace(target,normalized);
      presetHost.__liyuanActivePresetName=nextName||curName||"in_use";
      presetHost.__liyuanPresetBaseline=snapshotPresetBaseline(target);
      presetHost.__liyuanPresetInitialized=true;
      if(g.__liyuanIsolatedPresetRaw)g.__liyuanIsolatedPresetRaw=deepClone(target);
      syncPromptManagerDom(target);
    }else if(nextName){
      presetHost.__liyuanActivePresetName=nextName;
    }
  }
  g.__liyuanSyncPresetFromCtx=syncSharedPresetFromCtx;
  if(!pw0){
    presetHost.__liyuanOnRuntimeContextUpdated=function(c){
      syncSharedPresetFromCtx(c);
    };
  }
  (function initPresetMirrorNow(){
    var c=readRuntimeCtx();
    if(c)syncSharedPresetFromCtx(c);
  })();

  function toPresetPrompt(prompt,orderArr){
    var isNormal=prompt.system_prompt===false&&(prompt.marker===undefined||prompt.marker===false);
    var isSystem=prompt.system_prompt===true&&(prompt.marker===undefined||prompt.marker===false);
    var isPlaceholder=prompt.marker===true;
    var orderItem=null;
    for(var oi=0;oi<orderArr.length;oi++){
      if(orderArr[oi]&&orderArr[oi].identifier===prompt.identifier){orderItem=orderArr[oi];break;}
    }
    var out={
      id:String(prompt.identifier||makeUuid()),
      name:String(prompt.name||"unnamed"),
      enabled:orderItem?(orderItem.enabled!==false):(prompt.enabled!==false),
      role:prompt.role||"system"
    };
    if(isNormal||isPlaceholder){
      var isInChat=prompt.injection_position===1;
      out.position=isInChat
        ? {type:"in_chat",depth:typeof prompt.injection_depth==="number"?prompt.injection_depth:4,order:typeof prompt.injection_order==="number"?prompt.injection_order:100}
        : {type:"relative"};
    }
    if(isNormal||isSystem){
      out.content=typeof prompt.content==="string"?prompt.content:"";
    }
    if(prompt.extra&&typeof prompt.extra==="object"){
      out.extra=deepClone(prompt.extra);
    }
    return out;
  }
  function fromPresetPrompt(prompt,origDef){
    var isNormal=g.isPresetNormalPrompt(prompt);
    var isSystem=g.isPresetSystemPrompt(prompt);
    var isPlaceholder=g.isPresetPlaceholderPrompt(prompt);
    var out=origDef?deepClone(origDef):{};
    out.identifier=String(prompt.id||out.identifier||makeUuid());
    out.name=String(prompt.name||out.name||"unnamed");
    out.enabled=prompt.enabled!==false;
    if((isNormal||isPlaceholder)&&["dialogueExamples","chatHistory"].indexOf(out.identifier)<0){
      var isInChat=prompt.position&&prompt.position.type==="in_chat";
      out.injection_position=isInChat?1:0;
      out.injection_depth=isInChat&&typeof prompt.position.depth==="number"?prompt.position.depth:(typeof out.injection_depth==="number"?out.injection_depth:4);
      out.injection_order=isInChat&&typeof prompt.position.order==="number"?prompt.position.order:(typeof out.injection_order==="number"?out.injection_order:100);
    }
    out.role=prompt.role||out.role||"system";
    if(isNormal||isSystem){
      out.content=typeof prompt.content==="string"?prompt.content:"";
    }
    out.system_prompt=isSystem||isPlaceholder;
    out.marker=isPlaceholder;
    if(prompt.extra!==undefined)out.extra=deepClone(prompt.extra);
    if(out.forbid_overrides===undefined)out.forbid_overrides=false;
    return out;
  }
  function toPreset(raw,opts){
    var inUse=Boolean(opts&&opts.in_use);
    var orderObj=pickOrderObj(raw);
    var orderArr=orderObj?orderObj.order:[];
    var rawPrompts=Array.isArray(raw.prompts)?raw.prompts:[];
    var allPrompts=rawPrompts.map(function(p){return toPresetPrompt(p,orderArr);});
    var orderIds=orderArr.map(function(o){return o.identifier;});
    var usedMap={};
    var promptsUnused=[];
    for(var i=0;i<allPrompts.length;i++){
      var ap=allPrompts[i];
      if(orderIds.indexOf(ap.id)>=0){
        if(!usedMap[ap.id])usedMap[ap.id]=ap;
      }else{
        promptsUnused.push(ap);
      }
    }
    var prompts=[];
    for(var oi=0;oi<orderIds.length;oi++){
      var found=usedMap[orderIds[oi]];
      if(found)prompts.push(found);
    }
    var ext=deepClone((raw&&raw.extensions)||{});
    if(Array.isArray(ext.regex_scripts)){
      ext.regex_scripts=ext.regex_scripts.map(toTavernRegex).filter(Boolean);
    }
    if(!ext.tavern_helper||typeof ext.tavern_helper!=="object")ext.tavern_helper={scripts:[],variables:{}};
    var nbMap={"-1":"none","0":"default","2":"content","1":"completion"};
    var num=function(v,d){var n=Number(v);return isFinite(n)?n:d;};
    return {
      settings:{
        max_context:num(raw.openai_max_context,2000000),
        max_completion_tokens:num(raw.openai_max_tokens,4096),
        reply_count:num(raw.n,1),
        should_stream:raw.stream_openai!==undefined?Boolean(raw.stream_openai):true,
        temperature:num(inUse&&raw.temp_openai!==undefined?raw.temp_openai:raw.temperature,1),
        frequency_penalty:num(inUse&&raw.freq_pen_openai!==undefined?raw.freq_pen_openai:raw.frequency_penalty,0),
        presence_penalty:num(inUse&&raw.pres_pen_openai!==undefined?raw.pres_pen_openai:raw.presence_penalty,0),
        top_p:num(inUse&&raw.top_p_openai!==undefined?raw.top_p_openai:raw.top_p,1),
        repetition_penalty:num(inUse&&raw.repetition_penalty_openai!==undefined?raw.repetition_penalty_openai:raw.repetition_penalty,1),
        min_p:num(inUse&&raw.min_p_openai!==undefined?raw.min_p_openai:raw.min_p,0),
        top_k:num(inUse&&raw.top_k_openai!==undefined?raw.top_k_openai:raw.top_k,0),
        top_a:num(inUse&&raw.top_a_openai!==undefined?raw.top_a_openai:raw.top_a,0),
        seed:num(raw.seed,-1),
        squash_system_messages:Boolean(raw.squash_system_messages),
        reasoning_effort:raw.reasoning_effort||"auto",
        request_thoughts:Boolean(raw.show_thoughts),
        request_images:Boolean(raw.request_images),
        enable_function_calling:Boolean(raw.function_calling),
        enable_web_search:Boolean(raw.enable_web_search),
        allow_sending_images:raw.image_inlining===false?"disabled":(raw.inline_image_quality||"auto"),
        allow_sending_videos:Boolean(raw.video_inlining),
        character_name_prefix:nbMap[String(raw.names_behavior!==undefined?raw.names_behavior:-1)]||"none",
        wrap_user_messages_in_quotes:Boolean(raw.wrap_in_quotes)
      },
      prompts:prompts,
      prompts_unused:promptsUnused,
      extensions:ext
    };
  }
  function fromPreset(preset,baseRaw){
    var next=baseRaw?deepClone(baseRaw):makeEmptyOriginalPreset();
    var s=(preset&&preset.settings)||{};
    var usedIds={};
    var prevById={};
    var prevPrompts=Array.isArray(next.prompts)?next.prompts:[];
    for(var pi=0;pi<prevPrompts.length;pi++){
      if(prevPrompts[pi]&&typeof prevPrompts[pi].identifier==="string"){
        prevById[prevPrompts[pi].identifier]=prevPrompts[pi];
      }
    }
    var uncollision=function(list){
      return (Array.isArray(list)?list:[]).map(function(pr){
        var id=String(pr.id||makeUuid());
        if(usedIds[id]){
          if(!g.isPresetNormalPrompt(pr))throw Error("修改的预设中存在重复的系统/占位提示词 '"+id+"'");
          id=makeUuid();
        }
        usedIds[id]=true;
        return Object.assign({},pr,{id:id});
      });
    };
    var usedList=uncollision(preset&&preset.prompts);
    var unusedList=uncollision(preset&&preset.prompts_unused);
    var origUsed=usedList.map(function(pr){return fromPresetPrompt(pr,prevById[pr.id]);});
    var origUnused=unusedList.map(function(pr){return fromPresetPrompt(pr,prevById[pr.id]);});
    next.prompts=origUsed.concat(origUnused);
    var nextOrder=origUsed.map(function(pr){return {identifier:pr.identifier,enabled:pr.enabled!==false};});
    var orderObj=pickOrderObj(next);
    if(orderObj){
      orderObj.order=nextOrder;
    }else{
      if(!Array.isArray(next.prompt_order))next.prompt_order=[];
      next.prompt_order.push({character_id:100001,order:nextOrder});
    }
    var ext=deepClone((preset&&preset.extensions)||next.extensions||{});
    var origRegex=Array.isArray(next.extensions&&next.extensions.regex_scripts)?next.extensions.regex_scripts:[];
    if(Array.isArray(ext.regex_scripts)&&ext.regex_scripts.length>0&&ext.regex_scripts[0]&&ext.regex_scripts[0].source){
      ext.regex_scripts=ext.regex_scripts.map(function(tr){
        var o=origRegex.find(function(x){return x&&x.id&&tr&&x.id===tr.id;});
        return fromTavernRegex(tr,o);
      }).filter(Boolean);
    }
    next.extensions=ext;
    if(s.max_context!==undefined)next.openai_max_context=s.max_context;
    if(s.max_completion_tokens!==undefined)next.openai_max_tokens=s.max_completion_tokens;
    if(s.reply_count!==undefined)next.n=s.reply_count;
    if(s.should_stream!==undefined)next.stream_openai=s.should_stream;
    var pairAssign=function(sk,fk,uk){
      if(s[sk]!==undefined){next[fk]=s[sk];next[uk]=s[sk];}
    };
    pairAssign("temperature","temperature","temp_openai");
    pairAssign("frequency_penalty","frequency_penalty","freq_pen_openai");
    pairAssign("presence_penalty","presence_penalty","pres_pen_openai");
    pairAssign("top_p","top_p","top_p_openai");
    pairAssign("repetition_penalty","repetition_penalty","repetition_penalty_openai");
    pairAssign("min_p","min_p","min_p_openai");
    pairAssign("top_k","top_k","top_k_openai");
    pairAssign("top_a","top_a","top_a_openai");
    if(s.seed!==undefined)next.seed=s.seed;
    if(s.squash_system_messages!==undefined)next.squash_system_messages=s.squash_system_messages;
    if(s.reasoning_effort!==undefined)next.reasoning_effort=s.reasoning_effort;
    if(s.request_thoughts!==undefined)next.show_thoughts=s.request_thoughts;
    if(s.request_images!==undefined)next.request_images=s.request_images;
    if(s.enable_function_calling!==undefined)next.function_calling=s.enable_function_calling;
    if(s.enable_web_search!==undefined)next.enable_web_search=s.enable_web_search;
    if(s.allow_sending_images!==undefined){
      next.image_inlining=s.allow_sending_images!=="disabled";
      next.inline_image_quality=s.allow_sending_images==="disabled"?"auto":s.allow_sending_images;
    }
    if(s.allow_sending_videos!==undefined)next.video_inlining=s.allow_sending_videos;
    if(s.character_name_prefix!==undefined){
      var nbRev={none:-1,default:0,content:2,completion:1};
      if(nbRev[s.character_name_prefix]!==undefined)next.names_behavior=nbRev[s.character_name_prefix];
    }
    if(s.wrap_user_messages_in_quotes!==undefined)next.wrap_in_quotes=s.wrap_user_messages_in_quotes;
    return next;
  }

  g.getLoadedPresetName=function(){
    var n=presetHost.__liyuanActivePresetName;
    if(n&&n!=="in_use")return n;
    var c=readRuntimeCtx();
    return (c&&c.presetName)||"in_use";
  };
  g.getPresetNames=function(){
    var c=readRuntimeCtx();
    var out=["in_use"];
    var cur=g.getLoadedPresetName();
    if(c&&Array.isArray(c.presetNames)){
      for(var i=0;i<c.presetNames.length;i++){
        var nm=String(c.presetNames[i]||"").trim();
        if(nm&&out.indexOf(nm)<0)out.push(nm);
      }
    }
    if(cur&&cur!=="in_use"&&out.indexOf(cur)<0)out.push(cur);
    if(out.length===1)out.push("default");
    return out;
  };
  function apiFetchJson(url,init){
    var f=(g.fetch)||(presetHost&&presetHost.fetch);
    if(typeof f!=="function")return Promise.resolve(null);
    return f(url,init).then(function(r){return r.ok?r.json().catch(function(){return null;}):null;}).catch(function(){return null;});
  }
  g.loadPreset=function(name){
    if(isPresetFrameNow())return Promise.resolve(false);
    var nm=String(name||"").trim();
    if(!nm)return Promise.resolve(false);
    return apiFetchJson("/api/presets").then(function(data){
      var list=(data&&Array.isArray(data.presets))?data.presets:[];
      var hit=list.find(function(x){return x&&(x.name===nm||x.file===nm);});
      if(!hit)return false;
      return apiFetchJson("/api/presets/select",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({file:hit.file})}).then(function(res){return Boolean(res&&res.ok);});
    });
  };
  g.getPreset=function(name){
    var target=(!name||name==="in_use"||name===g.getLoadedPresetName())?"in_use":String(name);
    var raw=getSharedPresetRaw();
    if(target==="in_use"){
      return deepClone(toPreset(raw,{in_use:true}));
    }
    return deepClone(g.default_preset);
  };
  g.createPreset=function(name,preset){
    if(isPresetFrameNow())return Promise.resolve(false);
    if(g.getPresetNames().indexOf(name)>=0)return Promise.resolve(false);
    return g.createOrReplacePreset(name,preset);
  };
  g.createOrReplacePreset=function(name,preset,opts){
    if(isPresetFrameNow())return Promise.resolve(false);
    var target=(!name||name==="in_use"||name===g.getLoadedPresetName())?"in_use":String(name);
    var shared=getSharedPresetRaw();
    if(target==="in_use"){
      var nextOrig=fromPreset(preset||g.default_preset,shared);
      mutateObjectInPlace(shared,nextOrig);
      if(!opts||opts.render!=="none")syncPromptManagerDom(shared);
      return commitPresetFromSharedState().then(function(){return true;});
    }
    var rawToSave=fromPreset(preset||g.default_preset,{});
    return apiFetchJson("/api/presets/saveas",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:String(name),raw:rawToSave})}).then(function(r){return r?Boolean(r.ok!==false):true;});
  };
  g.deletePreset=function(name){
    if(isPresetFrameNow())return Promise.resolve(false);
    var nm=String(name||"").trim();
    if(!nm)return Promise.resolve(true);
    return apiFetchJson("/api/presets").then(function(data){
      var list=(data&&Array.isArray(data.presets))?data.presets:[];
      var hit=list.find(function(x){return x&&(x.name===nm||x.file===nm);});
      if(!hit)return true;
      return apiFetchJson("/api/presets?file="+encodeURIComponent(hit.file),{method:"DELETE"}).then(function(r){return r?Boolean(r.ok!==false):true;});
    });
  };
  g.renamePreset=function(oldName,newName){
    if(isPresetFrameNow())return Promise.resolve(false);
    var o=String(oldName||"").trim();
    var n=String(newName||"").trim();
    if(!o||!n)return Promise.resolve(false);
    return apiFetchJson("/api/presets").then(function(data){
      var list=(data&&Array.isArray(data.presets))?data.presets:[];
      var hit=list.find(function(x){return x&&(x.name===o||x.file===o);});
      if(!hit)return false;
      return apiFetchJson("/api/presets/rename",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({file:hit.file,name:n})}).then(function(r){return r?Boolean(r.ok!==false):true;});
    });
  };
  g.replacePreset=function(name,preset,opts){
    if(isPresetFrameNow())return Promise.resolve();
    var target=(!name||name==="in_use"||name===g.getLoadedPresetName())?"in_use":String(name);
    if(target!=="in_use")return Promise.resolve();
    var shared=getSharedPresetRaw();
    var nextOrig=fromPreset(preset||g.default_preset,shared);
    mutateObjectInPlace(shared,nextOrig);
    if(!opts||opts.render!=="none")syncPromptManagerDom(shared);
    return commitPresetFromSharedState().then(function(){});
  };
  g.updatePresetWith=function(name,updater,opts){
    if(isPresetFrameNow())return Promise.resolve(g.getPreset(name));
    var cur=g.getPreset(name);
    var res=typeof updater==="function"?updater(cur):cur;
    if(res&&typeof res.then==="function"){
      return res.then(function(nextPreset){
        return g.replacePreset(name,nextPreset,opts).then(function(){return g.getPreset(name);});
      });
    }
    return g.replacePreset(name,res,opts).then(function(){return g.getPreset(name);});
  };
  g.setPreset=function(name,patch,opts){
    if(isPresetFrameNow())return Promise.resolve(g.getPreset(name));
    return g.updatePresetWith(name,function(cur){
      return baseMerge(cur,patch||{},function(_l,r){return Array.isArray(r)?deepClone(r):undefined;});
    },opts);
  };

  // Audio 模块
  if(!g.__liyuanAudioStores){
    g.__liyuanAudioStores={
      bgm:{playlist:[],src:"",playing:false,progress:0,enabled:true,mode:"repeat",muted:false,volume:80},
      ambient:{playlist:[],src:"",playing:false,progress:0,enabled:true,mode:"repeat",muted:false,volume:80}
    };
  }
  function getAudioStore(type){return g.__liyuanAudioStores[type==="ambient"?"ambient":"bgm"];}
  function urlToTitle(url){var s=String(url||"");var last=s.split("/").pop()||s;return last.split(".")[0]||s;}
  g.playAudio=function(type,audio){
    if(!audio||typeof audio!=="object")return;
    var st=getAudioStore(type),title=audio.title||urlToTitle(audio.url);
    var ex=st.playlist.find(function(x){return x.title===title||x.url===audio.url;});
    if(!ex)st.playlist.push({title:title,url:String(audio.url||"")});
    else{ex.title=title;ex.url=String(audio.url||"");}
    st.src=String(audio.url||"");st.progress=0;st.playing=true;
  };
  g.pauseAudio=function(type){getAudioStore(type).playing=false;};
  g.getAudioList=function(type){return deepClone(getAudioStore(type).playlist);};
  g.replaceAudioList=function(type,list){
    if(!Array.isArray(list))return;
    getAudioStore(type).playlist=list.map(function(x){return {title:x.title||urlToTitle(x.url),url:String(x.url||"")};});
  };
  g.appendAudioList=function(type,list){
    if(!Array.isArray(list))return;
    var st=getAudioStore(type);
    list.forEach(function(x){st.playlist.push({title:x.title||urlToTitle(x.url),url:String(x.url||"")});});
  };
  g.getAudioSettings=function(type){
    var st=getAudioStore(type);
    return {enabled:st.enabled,mode:st.mode,muted:st.muted,volume:st.volume};
  };
  g.setAudioSettings=function(type,settings){
    if(!settings||typeof settings!=="object")return;
    var st=getAudioStore(type);
    if(settings.enabled!==undefined)st.enabled=Boolean(settings.enabled);
    if(settings.mode!==undefined)st.mode=String(settings.mode);
    if(settings.muted!==undefined)st.muted=Boolean(settings.muted);
    if(settings.volume!==undefined)st.volume=Math.min(100,Math.max(0,Number(settings.volume)||0));
  };
  g.getCurrentAudio=function(type){
    var st=getAudioStore(type);
    var cur=st.playlist.find(function(x){return x.url===st.src;});
    return {src:st.src,title:(cur&&cur.title)||"",playing:st.playing,progress:st.progress};
  };
  g.audioEnable=function(_args,state){g.setAudioSettings("bgm",{enabled:String(state)!=="false"});return "";};
  g.audioImport=function(_args,url){if(url)g.appendAudioList("bgm",[{url:String(url)}]);return "";};
  g.audioMode=function(_args,mode){if(mode)g.setAudioSettings("bgm",{mode:String(mode)});return "";};
  g.audioPlay=function(_args,url){if(url)g.playAudio("bgm",{url:String(url)});else getAudioStore("bgm").playing=true;return "";};
  g.audioSelect=function(_args,url){if(url)getAudioStore("bgm").src=String(url);return "";};

  // Extension / File / ImportRaw / Version / Builtin 模块
  g.isAdmin=function(){return false;};
  g.getTavernHelperExtensionId=function(){return "JS-Slash-Runner";};
  g.getExtensionType=function(id){return (id==="JS-Slash-Runner"||id==="TavernHelper")?"system":null;};
  g.getExtensionInstallationInfo=function(){
    return Promise.resolve({current_branch_name:"master",current_commit_hash:"b156676",is_up_to_date:true,remote_url:""});
  };
  g.getExtensionStatus=g.getExtensionInstallationInfo;
  g.isInstalledExtension=function(id){return g.getExtensionType(id)!==null;};
  g.installExtension=function(){return Promise.resolve(new Response(JSON.stringify({ok:false,message:"unsupported"}),{status:403}));};
  g.uninstallExtension=g.installExtension;
  g.reinstallExtension=g.installExtension;
  g.updateExtension=g.installExtension;

  g.getTavernFile=function(path){
    if(g.Liyuan&&g.Liyuan.project&&g.Liyuan.project.files){
      return g.Liyuan.project.files.read(String(path||"")).then(function(env){
        var txt=(env&&env.ok&&env.result&&typeof env.result.content==="string")?env.result.content:"";
        return new Response(txt,{status:(env&&env.ok)?200:404});
      });
    }
    return Promise.resolve(new Response("",{status:404}));
  };
  g.uploadTavernFile=function(filename,base64){
    if(g.Liyuan&&g.Liyuan.project&&g.Liyuan.project.files){
      var decoded=String(base64||"");
      try{if(typeof atob==="function")decoded=atob(decoded);}catch(e){}
      return g.Liyuan.project.files.write(String(filename||"file.txt"),decoded).then(function(){return String(filename||"file.txt");});
    }
    return Promise.resolve(String(filename||""));
  };
  g.deleteTavernFile=function(filename){
    if(g.Liyuan&&g.Liyuan.project&&g.Liyuan.project.files){
      return g.Liyuan.project.files.remove(String(filename||"")).then(function(env){return Boolean(env&&env.ok);});
    }
    return Promise.resolve(false);
  };

  g.importRawCharacter=function(){return Promise.resolve(new Response("{}",{status:200}));};
  g.importRawChat=function(){return Promise.resolve(new Response("{}",{status:200}));};
  g.importRawPreset=function(){return Promise.resolve(true);};
  g.importRawWorldbook=function(){return Promise.resolve(true);};
  g.importRawTavernRegex=function(){return true;};

  g.getTavernHelperVersion=function(){return "4.12.1";};
  g.getFrontendVersion=g.getTavernHelperVersion;
  g.updateTavernHelper=function(){return Promise.resolve(true);};
  g.updateFrontendVersion=g.updateTavernHelper;
  g.getTavernVersion=function(){return "1.19.0";};

  function makeUuid(){
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(c){
      var r=(Math.random()*16)|0,v=c==="x"?r:(r&0x3)|0x8;
      return v.toString(16);
    });
  }
  var promptMgrRenderDebouncedTimer=null;
  var promptMgrStub={
    render:function(_afterAction){
      if(isPresetFrameNow())return;
      syncPromptManagerDom();
    },
    renderDebounced:function(){
      if(isPresetFrameNow())return;
      if(promptMgrRenderDebouncedTimer)clearTimeout(promptMgrRenderDebouncedTimer);
      promptMgrRenderDebouncedTimer=setTimeout(function(){
        promptMgrRenderDebouncedTimer=null;
        syncPromptManagerDom();
      },30);
    },
    getPromptOrderEntry:function(promptOrId){
      var id=typeof promptOrId==="string"?promptOrId:(promptOrId&&promptOrId.identifier?String(promptOrId.identifier):"");
      if(!id)return null;
      var ord=pickOrderObj(getPresetRawForCurrentContext());
      if(!ord)return null;
      for(var i=0;i<ord.order.length;i++){
        if(ord.order[i]&&ord.order[i].identifier===id)return ord.order[i];
      }
      return null;
    },
    get serviceSettings(){return getPresetRawForCurrentContext();}
  };
  g.promptManager=promptMgrStub;
  g.builtin={
    addOneMessage:function(){},
    copyText:function(txt){
      try{if(g.navigator&&g.navigator.clipboard)return g.navigator.clipboard.writeText(String(txt||""));}catch(e){}
      return Promise.resolve();
    },
    duringGenerating:function(){var c=readRuntimeCtx();return Boolean(c&&c.streaming);},
    getImageTokenCost:function(){return Promise.resolve(85);},
    getVideoTokenCost:function(){return Promise.resolve(256);},
    parseRegexFromString:function(str){
      var m=new RegExp("^/(.*)/([a-z]*)$","i").exec(String(str||""));
      try{return m?new RegExp(m[1],m[2]):new RegExp(String(str||""));}catch(e){return null;}
    },
    promptManager:promptMgrStub,
    reloadAndRenderChatWithoutEvents:function(){return Promise.resolve();},
    reloadChatWithoutEvents:function(){return Promise.resolve();},
    reloadEditor:function(){},
    reloadEditorDebounced:function(){},
    renderMarkdown:function(txt){return String(txt==null?"":txt);},
    renderPromptManager:promptMgrStub.render,
    renderPromptManagerDebounced:promptMgrStub.renderDebounced,
    saveSettings:function(){
      if(isPresetFrameNow())return Promise.resolve();
      return commitPresetFromSharedState().then(function(){});
    },
    uuidv4:makeUuid
  };
  g.placeholder_prompt_default_order=["world_info_before","persona_description","char_description","char_personality","scenario","world_info_after","dialogue_examples","chat_history"];
  g.builtin_prompt_default_order=g.placeholder_prompt_default_order;

  // 脚本按钮与元信息（刀5）
  function curScriptEntry(){
    var sid=g.getScriptId();
    if(!g.__liyuanScriptRegistry)g.__liyuanScriptRegistry={};
    if(!g.__liyuanScriptRegistry[sid]){
      g.__liyuanScriptRegistry[sid]={id:sid,name:sid,info:"",source:"card",data:{},button:{enabled:true,buttons:[]}};
    }
    return g.__liyuanScriptRegistry[sid];
  }
  function notifyParentButtons(){
    if(isPresetFrameNow())return;
    var pw=parentWin();
    if(!pw||!g.__liyuanScriptRegistry)return;
    var flat=[];
    var seen={};
    for(var sid in g.__liyuanScriptRegistry){
      var e=g.__liyuanScriptRegistry[sid];
      if(e&&e.button&&e.button.enabled!==false&&Array.isArray(e.button.buttons)){
        e.button.buttons.forEach(function(b){
          if(b&&b.name&&b.visible!==false&&!seen[b.name]){
            seen[b.name]=1;
            flat.push({scriptId:sid,name:String(b.name),eventId:"th_btn_"+sid+"_"+String(b.name)});
          }
        });
      }
    }
    try{pw.postMessage({liyuanScriptButtons:flat,liyuanScriptOwner:g.getScriptId()},"*");}catch(err){}
  }
  g.getButtonEvent=function(btnName){
    var name=String(btnName||"");
    if(isPresetFrameNow())return "th_btn_"+g.getScriptId()+"_"+name;
    var entry=curScriptEntry();
    if(name&&entry&&entry.button&&Array.isArray(entry.button.buttons)){
      if(!entry.button.buttons.some(function(x){return x&&x.name===name;})){
        entry.button.buttons.push({name:name,visible:true});
        notifyParentButtons();
      }
    }
    return "th_btn_"+g.getScriptId()+"_"+name;
  };
  g.getScriptButtons=function(){
    if(isPresetFrameNow())return [];
    return deepClone(curScriptEntry().button.buttons||[]);
  };
  g.replaceScriptButtons=function(a,b){
    if(isPresetFrameNow())return;
    var btns=Array.isArray(a)?a:(Array.isArray(b)?b:[]);
    curScriptEntry().button.buttons=deepClone(btns);
    notifyParentButtons();
  };
  g.updateScriptButtonsWith=function(updater){
    if(isPresetFrameNow())return [];
    var cur=g.getScriptButtons();
    var res=typeof updater==="function"?updater(cur):cur;
    if(res&&typeof res.then==="function"){
      return res.then(function(r){g.replaceScriptButtons(r);return r;});
    }
    g.replaceScriptButtons(res);
    return res;
  };
  g.appendInexistentScriptButtons=function(a,b){
    var nextBtns=Array.isArray(a)?a:(Array.isArray(b)?b:[]);
    return g.updateScriptButtonsWith(function(cur){
      var out=cur.slice();
      nextBtns.forEach(function(btn){
        if(btn&&btn.name&&!out.some(function(x){return x.name===btn.name;}))out.push(btn);
      });
      return out;
    });
  };
  g.getAllEnabledScriptButtons=function(){
    var out={};
    if(g.__liyuanScriptRegistry){
      for(var sid in g.__liyuanScriptRegistry){
        var e=g.__liyuanScriptRegistry[sid];
        if(e&&e.button&&e.button.enabled&&Array.isArray(e.button.buttons)){
          out[sid]=e.button.buttons.filter(function(b){return b.visible!==false;}).map(function(b){
            return {button_id:"th_btn_"+sid+"_"+b.name,button_name:b.name};
          });
        }
      }
    }
    return out;
  };
  g.getScriptName=function(){return curScriptEntry().name||"";};
  g.getScriptInfo=function(){return curScriptEntry().info||"";};
  g.replaceScriptInfo=function(info){curScriptEntry().info=String(info||"");};
  g.getScriptTrees=function(){return [];};
  g.replaceScriptTrees=function(){};
  g.updateScriptTreesWith=function(u){return typeof u==="function"?u([]):[];};
  g.injectPrompts=function(prompts,opts){
    if(!g.__liyuanInjectedPrompts)g.__liyuanInjectedPrompts=new Map();
    var ids=[];
    if(Array.isArray(prompts)){
      prompts.forEach(function(p,i){
        if(p&&typeof p==="object"){
          var pid=String(p.id||("inj_"+i+"_"+Date.now()));
          ids.push(pid);
          g.__liyuanInjectedPrompts.set(pid,p);
        }
      });
    }
    var deleted=false;
    var uninject=function(){
      if(deleted)return;
      deleted=true;
      g.uninjectPrompts(ids);
    };
    if(opts&&opts.once&&typeof g.eventOnce==="function"){
      g.eventOnce(g.iframe_events.GENERATION_ENDED,uninject);
      g.eventOnce(g.tavern_events.GENERATION_ENDED,uninject);
      g.eventOnce(g.tavern_events.GENERATION_STOPPED,uninject);
    }
    return {uninject:uninject};
  };
  g.uninjectPrompts=function(ids){
    if(!g.__liyuanInjectedPrompts||!Array.isArray(ids))return;
    ids.forEach(function(id){g.__liyuanInjectedPrompts.delete(String(id));});
  };
  g.getModelList=function(){
    if(g.Liyuan&&g.Liyuan.models)return g.Liyuan.models.list().then(function(e){return (e&&e.ok&&e.result&&Array.isArray(e.result.models))?e.result.models.map(function(m){return m.id;}):[];});
    return Promise.resolve([]);
  };
  g.getProxyPresetNames=function(){return Promise.resolve(["default"]);};

  // 原版 MagVarUpdate (Mvu) + tavern_resource (registerMvuSchema) 完整实现（对齐 MagVarUpdate bundle.js & mvu_zod.js）
  if(!g.__liyuanMvuSchemas)g.__liyuanMvuSchemas=[];
  g.__liyuanApplyMvuSchemas=function(targetTree){
    var tree=targetTree||g.__liyuanVariables;
    if(!tree||typeof tree!=="object")return tree;
    if(!tree.stat_data||typeof tree.stat_data!=="object")tree.stat_data={};
    if(Array.isArray(g.__liyuanMvuSchemas)&&g.__liyuanMvuSchemas.length>0){
      for(var i=0;i<g.__liyuanMvuSchemas.length;i++){
        var resolveSchema=g.__liyuanMvuSchemas[i];
        try{
          var sObj=typeof resolveSchema==="function"?resolveSchema():resolveSchema;
          if(sObj&&typeof sObj.safeParse==="function"){
            var parsed=sObj.safeParse(tree.stat_data,{reportInput:true});
            if(parsed&&parsed.success&&parsed.data&&typeof parsed.data==="object"){
              tree.stat_data=baseMerge(deepClone(tree.stat_data),parsed.data);
            }
          }
        }catch(e){}
      }
    }
    return tree;
  };
  g.registerMvuSchema=function(schemaOrFn){
    var getActiveSchema=function(){
      var raw=typeof schemaOrFn==="function"?schemaOrFn():schemaOrFn;
      var zRef=g.z&&g.z.z?g.z.z:g.z;
      var effective=(zRef&&zRef.ZodObject&&raw instanceof zRef.ZodObject&&typeof zRef.looseObject==="function")?zRef.looseObject(raw.shape):raw;
      if(typeof g.registerVariableSchema==="function"&&zRef&&typeof zRef.object==="function"&&effective){
        try{g.registerVariableSchema(zRef.object({stat_data:effective}),{type:"message"});}catch(e){}
      }
      return effective;
    };
    g.__liyuanMvuSchemas.push(getActiveSchema);
    try{
      var curTree=rawMvuTree();
      g.__liyuanApplyMvuSchemas(curTree);
      if(curTree&&curTree.stat_data){
        g.__liyuanVariables=curTree;
        g.__liyuanAuthorVarsWrite("message",{stat_data:curTree.stat_data},"assign","latest");
      }
    }catch(e){}
    g.eventOn("mag_variable_initialized",function(mvuObj){
      var s=getActiveSchema();
      if(!s||typeof s.safeParse!=="function"||!mvuObj)return;
      try{
        var r=s.safeParse(g._.get(mvuObj,"stat_data",{}),{reportInput:true});
        if(r&&r.success){
          mvuObj.stat_data=baseMerge(deepClone(mvuObj.stat_data||{}),r.data);
        }
      }catch(e){}
    });
    g.eventOn("mag_variable_update_ended_for_zod",function(mvuObj){
      if(!mvuObj||typeof mvuObj!=="object")return;
      g._.set(mvuObj,"schema","没有用别管这个");
      g._.unset(mvuObj,"display_data");
      g._.unset(mvuObj,"delta_data");
    });
  };
  if(!g.Mvu){
    var mvuEvents={
      VARIABLE_INITIALIZED:"mag_variable_initialized",
      VARIABLE_UPDATE_STARTED:"mag_variable_update_started",
      COMMAND_PARSED:"mag_command_parsed",
      VARIABLE_UPDATE_ENDED:"mag_variable_update_ended",
      BEFORE_MESSAGE_UPDATE:"mag_before_message_update",
      SINGLE_VARIABLE_UPDATED:"mag_variable_updated",
      VARIABLE_UPDATE_FAILED:"VARIABLE_UPDATE_FAILED"
    };
    g.Mvu={
      isMvuEnabled:true,
      events:mvuEvents,
      state:{},
      isDuringExtraAnalysis:function(){return false;},
      getMvuData:function(opts){return g.getVariables(opts||{type:"message",message_id:"latest"});},
      replaceMvuData:function(data,opts){
        var targetOpts=opts||{type:"message",message_id:"latest"};
        if(data&&typeof data==="object"){
          g.__liyuanVariables=data;
          var saved=g.replaceVariables(data,targetOpts);
          if(targetOpts.type!=="chat")g.__liyuanAuthorVarsWrite("chat",data,"assign");
          return Promise.resolve(saved);
        }
        return Promise.resolve(data);
      },
      getCurrentMvuData:function(){
        return g.getVariables({type:"message",message_id:g.getCurrentMessageId()});
      },
      replaceCurrentMvuData:function(data){
        return g.Mvu.replaceMvuData(data,{type:"message",message_id:g.getCurrentMessageId()});
      },
      setMvuVariable:function(mvuData,path,val,_opts){
        try{
          if(mvuData&&mvuData.stat_data&&g._)g._.set(mvuData.stat_data,path,val);
          var patch={stat_data:(mvuData&&mvuData.stat_data)?mvuData.stat_data:{}};
          g.__liyuanAuthorVarsWrite("chat",patch,"assign");
        }catch(e){}
        return Promise.resolve(true);
      },
      getMvuVariable:function(mvuData,path,opts){
        var cat=(opts&&opts.category)||"stat";
        var defVal=opts?opts.default_value:undefined;
        var root=cat==="display"?(mvuData&&mvuData.display_data):(cat==="delta"?(mvuData&&mvuData.delta_data):(mvuData&&mvuData.stat_data));
        var v=g._?g._.get(root,path,defVal):defVal;
        return (Array.isArray(v)&&v.length===2&&typeof v[1]==="string")?v[0]:v;
      },
      getRecordFromMvuData:function(mvuData,category){
        if(!mvuData)return undefined;
        if(category==="display")return mvuData.display_data;
        if(category==="delta")return mvuData.delta_data;
        return mvuData.stat_data;
      },
      reloadInitVar:function(mvuData){
        var target=mvuData||g.Mvu.getMvuData();
        g.__liyuanApplyMvuSchemas(target);
        return Promise.resolve(true);
      },
      parseMessage:function(rawCmd,oldData){
        var base=oldData?deepClone(oldData):g.getAllVariables();
        if(!base||typeof base!=="object")base={stat_data:{}};
        if(!base.stat_data||typeof base.stat_data!=="object")base.stat_data={};
        var txt=String(rawCmd==null?"":rawCmd);
        var blockMatch=/<(?:UpdateVariable|JSONPatch)>([\\s\\S]*?)<\\/(?:UpdateVariable|JSONPatch)>/i.exec(txt);
        var body=blockMatch?blockMatch[1].trim():txt.trim();
        if(body&&g._){
          try{
            var jsonStart=body.indexOf("[");
            var jsonEnd=body.lastIndexOf("]");
            if(jsonStart>=0&&jsonEnd>jsonStart){
              try{
                var patches=JSON.parse(body.slice(jsonStart,jsonEnd+1));
                if(Array.isArray(patches)){
                  for(var pi=0;pi<patches.length;pi++){
                    var opItem=patches[pi];
                    if(!opItem||typeof opItem.path!=="string")continue;
                    var dotPath=opItem.path.replace(/^\\//,"").split("/").map(function(s){return s.replace(/~1/g,"/").replace(/~0/g,"~");}).filter(Boolean).join(".");
                    if(!dotPath)continue;
                    if(opItem.op==="replace"||opItem.op==="add"){
                      g._.set(base.stat_data,dotPath,opItem.value);
                    }else if(opItem.op==="delta"){
                      var curNum=Number(g._.get(base.stat_data,dotPath,0))||0;
                      g._.set(base.stat_data,dotPath,curNum+(Number(opItem.value)||0));
                    }else if(opItem.op==="remove"){
                      g._.unset(base.stat_data,dotPath);
                    }
                  }
                }
              }catch(eJson){}
            }
            var cmdRe=/_\\.(set|add|insert|remove|unset|assign)\\s*\\(([\\s\\S]*?)\\)\\s*;?/g;
            var cm;
            while((cm=cmdRe.exec(body))!==null){
              var fnName=cm[1];
              var argsRaw="["+cm[2]+"]";
              var parsedArgs=null;
              try{parsedArgs=(new Function("return "+argsRaw))();}catch(eArg){}
              if(!Array.isArray(parsedArgs)||parsedArgs.length<1)continue;
              var p=String(parsedArgs[0]||"").replace(/^stat_data\\./,"");
              if(!p)continue;
              if(fnName==="set"){
                var newVal=parsedArgs.length>=3?parsedArgs[2]:parsedArgs[1];
                var existing=g._.get(base.stat_data,p);
                if(Array.isArray(existing)&&existing.length===2&&typeof existing[1]==="string"&&!Array.isArray(newVal)&&(newVal===null||typeof newVal!=="object")){
                  g._.set(base.stat_data,p,[newVal,existing[1]]);
                }else{
                  g._.set(base.stat_data,p,newVal);
                }
              }else if(fnName==="add"){
                var delta=Number(parsedArgs[1])||0;
                var cur=g._.get(base.stat_data,p);
                if(Array.isArray(cur)&&cur.length===2&&typeof cur[0]==="number"){
                  g._.set(base.stat_data,p,[cur[0]+delta,cur[1]]);
                }else{
                  g._.set(base.stat_data,p,(Number(cur)||0)+delta);
                }
              }else if(fnName==="unset"){
                g._.unset(base.stat_data,p);
              }else if(fnName==="remove"){
                var targetArr=g._.get(base.stat_data,p);
                if(Array.isArray(targetArr)){
                  var remTarget=parsedArgs[1];
                  g._.set(base.stat_data,p,targetArr.filter(function(item,idx){return item!==remTarget&&idx!==remTarget;}));
                }else if(targetArr&&typeof targetArr==="object"&&parsedArgs[1]!=null){
                  g._.unset(targetArr,String(parsedArgs[1]));
                }else{
                  g._.unset(base.stat_data,p);
                }
              }else if(fnName==="insert"){
                var dest=g._.get(base.stat_data,p);
                if(Array.isArray(dest)){
                  dest.push(parsedArgs.length>=3?parsedArgs[2]:parsedArgs[1]);
                }else if(dest&&typeof dest==="object"&&parsedArgs.length>=3){
                  dest[String(parsedArgs[1])]=parsedArgs[2];
                }
              }else if(fnName==="assign"){
                var destObj=g._.get(base.stat_data,p);
                if(destObj&&typeof destObj==="object"&&!Array.isArray(destObj)){
                  if(parsedArgs.length>=3){
                    destObj[String(parsedArgs[1])]=parsedArgs[2];
                  }else if(parsedArgs[1]&&typeof parsedArgs[1]==="object"){
                    Object.assign(destObj,parsedArgs[1]);
                  }
                }
              }
            }
          }catch(eParse){}
        }
        g.__liyuanApplyMvuSchemas(base);
        return Promise.resolve(base);
      }
    };
  }

  // 跨帧全局对象共享（刀2：initializeGlobal / waitGlobalInitialized）
  g.initializeGlobal=function(name,value){
    if(!name)return;
    g[name]=value;
    var pw=parentWin();
    if(pw){
      try{
        if(!pw.__liyuanSharedGlobals)pw.__liyuanSharedGlobals={};
        pw.__liyuanSharedGlobals[name]=value;
        pw[name]=value;
        pw.postMessage({liyuanGlobalInit:{name:String(name)}},"*");
      }catch(e){}
    }
    if(typeof g.eventEmit==="function")g.eventEmit("global_"+name+"_initialized");
  };
  g.waitGlobalInitialized=function(name,timeoutMs){
    return new Promise(function(res){
      var t0=Date.now(),lim=timeoutMs||5000;
      function check(){
        try{
          if(g[name])return g[name];
          var pw=parentWin();
          if(pw){
            var shared=(pw.__liyuanSharedGlobals&&pw.__liyuanSharedGlobals[name])||pw[name];
            if(shared){
              g[name]=shared;
              return shared;
            }
          }
        }catch(e){}
        return null;
      }
      var hit=check();
      if(hit)return res(hit);
      var stopObj=null;
      if(typeof g.eventOnce==="function"){
        stopObj=g.eventOnce("global_"+name+"_initialized",function(){
          var v=check()||true;
          res(v);
        });
      }
      (function poll(){
        var v=check();
        if(v){if(stopObj&&stopObj.stop)stopObj.stop();return res(v);}
        if(Date.now()-t0>lim){if(stopObj&&stopObj.stop)stopObj.stop();return res(false);}
        setTimeout(poll,50);
      })();
    });
  };
  // 默认将 Mvu 共享到父页以唤醒 waitGlobalInitialized('Mvu')
  try{if(g.Mvu)g.initializeGlobal("Mvu",g.Mvu);}catch(eMvu){}

  // 将所有函数与对象完整挂入 window.TavernHelper（严格对齐 JS-Slash-Runner 4.12.1 src/function/index.ts & predefine.js）
  if(g.TavernHelper&&typeof g.TavernHelper==="object"){
    g.TavernHelper._th_impl={
      _init:function(){},
      _log:function(){},
      _clearLog:function(){},
      writeExtensionField:function(){return Promise.resolve();}
    };
    g.TavernHelper._bind={
      _eventOn:g.eventOn,
      _eventOnButton:g.eventOnButton,
      _eventMakeLast:g.eventMakeLast,
      _eventMakeFirst:g.eventMakeFirst,
      _eventOnce:g.eventOnce,
      _eventEmit:g.eventEmit,
      _eventEmitAndWait:g.eventEmitAndWait,
      _eventRemoveListener:g.eventRemoveListener,
      _eventClearEvent:g.eventClearEvent,
      _eventClearListener:g.eventClearListener,
      _eventClearAll:g.eventClearAll,
      _initializeGlobal:g.initializeGlobal,
      _waitGlobalInitialized:g.waitGlobalInitialized,
      _registerMacroLike:g.registerMacroLike,
      _getButtonEvent:g.getButtonEvent,
      _getScriptButtons:g.getScriptButtons,
      _replaceScriptButtons:g.replaceScriptButtons,
      _updateScriptButtonsWith:g.updateScriptButtonsWith,
      _appendInexistentScriptButtons:g.appendInexistentScriptButtons,
      _getScriptName:g.getScriptName,
      _getScriptInfo:g.getScriptInfo,
      _replaceScriptInfo:g.replaceScriptInfo,
      _getVariables:g.getVariables,
      _getAllVariables:g.getAllVariables,
      _replaceVariables:g.replaceVariables,
      _updateVariablesWith:g.updateVariablesWith,
      _insertOrAssignVariables:g.insertOrAssignVariables,
      _insertVariables:g.insertVariables,
      _deleteVariable:g.deleteVariable,
      _reloadIframe:g.reloadIframe,
      _errorCatched:g.errorCatched,
      _getIframeName:g.getIframeName,
      _getScriptId:g.getScriptId,
      _getCurrentMessageId:g.getCurrentMessageId
    };
    var thKeys=["audioEnable","audioImport","audioMode","audioPlay","audioSelect","playAudio","pauseAudio","getAudioList","replaceAudioList","appendAudioList","getAudioSettings","setAudioSettings","getCurrentAudio","builtin","getCharacterNames","getCharacterIds","getCurrentCharacterName","getCurrentCharacterId","createCharacter","createOrReplaceCharacter","deleteCharacter","getCharacter","replaceCharacter","updateCharacterWith","getChatMessages","setChatMessages","setChatMessage","createChatMessages","deleteChatMessages","rotateChatMessages","formatAsDisplayedMessage","retrieveDisplayedMessage","refreshOneMessage","tavern_events","iframe_events","isAdmin","getTavernHelperExtensionId","getExtensionType","getExtensionStatus","getExtensionInstallationInfo","isInstalledExtension","installExtension","uninstallExtension","reinstallExtension","updateExtension","getTavernFile","uploadTavernFile","deleteTavernFile","importRawCharacter","importRawPreset","importRawChat","importRawWorldbook","importRawTavernRegex","injectPrompts","uninjectPrompts","builtin_prompt_default_order","placeholder_prompt_default_order","getModelList","getProxyPresetNames","initializeGlobal","waitGlobalInitialized","getLorebookEntries","replaceLorebookEntries","updateLorebookEntriesWith","setLorebookEntries","createLorebookEntries","createLorebookEntry","deleteLorebookEntries","deleteLorebookEntry","getLorebookSettings","setLorebookSettings","getCharLorebooks","setCurrentCharLorebooks","getLorebooks","deleteLorebook","createLorebook","getCurrentCharPrimaryLorebook","getChatLorebook","setChatLorebook","getOrCreateChatLorebook","isPresetNormalPrompt","isPresetSystemPrompt","isPresetPlaceholderPrompt","default_preset","getPresetNames","getLoadedPresetName","loadPreset","createPreset","createOrReplacePreset","deletePreset","renamePreset","getPreset","replacePreset","updatePresetWith","setPreset","getPersonaNames","getPersonaIds","getCurrentPersonaName","getCurrentPersonaId","getPersonaAvatarPath","createPersona","createOrReplacePersona","deletePersona","getPersona","replacePersona","updatePersonaWith","RawCharacter","getCharData","getCharAvatarPath","getChatHistoryBrief","getChatHistoryDetail","registerMacroLike","unregisterMacroLike","getAllEnabledScriptButtons","getScriptTrees","replaceScriptTrees","updateScriptTreesWith","triggerSlash","triggerSlashWithResult","formatAsTavernRegexedString","isCharacterTavernRegexesEnabled","getTavernRegexes","replaceTavernRegexes","updateTavernRegexesWith","substitudeMacros","getLastMessageId","errorCatched","getMessageId","registerVariableSchema","getVariables","getAllVariables","replaceVariables","updateVariablesWith","insertOrAssignVariables","deleteVariable","insertVariables","getTavernHelperVersion","getFrontendVersion","updateTavernHelper","updateFrontendVersion","getTavernVersion","getWorldbookNames","getGlobalWorldbookNames","rebindGlobalWorldbooks","getCharWorldbookNames","rebindCharWorldbooks","getChatWorldbookName","rebindChatWorldbook","getOrCreateChatWorldbook","createWorldbook","createOrReplaceWorldbook","deleteWorldbook","getWorldbook","replaceWorldbook","updateWorldbookWith","createWorldbookEntries","deleteWorldbookEntries","getButtonEvent","getScriptButtons","replaceScriptButtons","updateScriptButtonsWith","appendInexistentScriptButtons","getScriptName","getScriptInfo","replaceScriptInfo","getIframeName","getScriptId","getCurrentMessageId","reloadIframe","eventOn","eventOnce","eventMakeFirst","eventMakeLast","eventOnButton","eventEmit","eventEmitAndWait","eventRemoveListener","eventClearEvent","eventClearListener","eventClearAll","registerMvuSchema"];
    for(var ti=0;ti<thKeys.length;ti++){
      var tk=thKeys[ti];
      if(g[tk]!==undefined&&g.TavernHelper[tk]===undefined)g.TavernHelper[tk]=g[tk];
    }
    if(typeof g.TavernHelper.generate==="function"&&typeof g.generate!=="function")g.generate=g.TavernHelper.generate;
    if(typeof g.TavernHelper.generateRaw==="function"&&typeof g.generateRaw!=="function")g.generateRaw=g.TavernHelper.generateRaw;
    if(typeof g.TavernHelper.stopGenerationById==="function"&&typeof g.stopGenerationById!=="function")g.stopGenerationById=g.TavernHelper.stopGenerationById;
    if(typeof g.TavernHelper.stopAllGeneration==="function"&&typeof g.stopAllGeneration!=="function")g.stopAllGeneration=g.TavernHelper.stopAllGeneration;
  }

  // SillyTavern.getContext() 第一层完整投影（刀2）
  var eventSourceAdapter={
    on:function(e,cb){return g.eventOn(e,cb);},
    once:function(e,cb){return g.eventOnce(e,cb);},
    makeFirst:function(e,cb){return g.eventMakeFirst(e,cb);},
    makeLast:function(e,cb){return g.eventMakeLast(e,cb);},
    emit:function(){return g.eventEmit.apply(g,arguments);},
    emitAndWait:function(){return g.eventEmitAndWait.apply(g,arguments);},
    removeListener:function(e,cb){return g.eventRemoveListener(e,cb);}
  };
  if(!g.__liyuanExtensionPrompts)g.__liyuanExtensionPrompts={};
  if(!g.__liyuanSlashCommands){
    var pwCmd=(pw0&&pw0.__liyuanSlashCommands)?pw0.__liyuanSlashCommands:{};
    g.__liyuanSlashCommands=pwCmd;
    if(pw0&&!pw0.__liyuanSlashCommands)pw0.__liyuanSlashCommands=pwCmd;
  }
  var slashParserAdapter={
    commands:g.__liyuanSlashCommands,
    addCommandObject:function(cmdObj){
      if(!cmdObj||typeof cmdObj!=="object"||!cmdObj.name)return;
      var name=String(cmdObj.name);
      g.__liyuanSlashCommands[name]=cmdObj;
      if(Array.isArray(cmdObj.aliases)){
        cmdObj.aliases.forEach(function(a){if(a)g.__liyuanSlashCommands[String(a)]=cmdObj;});
      }
    }
  };
  var slashCommandClass={
    fromProps:function(props){
      if(!props||typeof props!=="object")return null;
      return Object.assign({aliases:[],returns:"",namedArgumentList:[],unnamedArgumentList:[]},props);
    }
  };
  var presetManagerAdapter={
    apiId:"openai",
    getSelectedPresetName:function(){return g.getLoadedPresetName();},
    getAllPresets:function(){return g.getPresetNames();},
    findPreset:function(n){
      var list=g.getPresetNames();
      if(!n)return g.getLoadedPresetName();
      return list.indexOf(n)>=0?n:undefined;
    },
    selectPreset:function(name){return isPresetFrameNow()?Promise.resolve(false):g.loadPreset(name);},
    savePreset:function(){return isPresetFrameNow()?Promise.resolve(false):commitPresetFromSharedState().then(function(){return true;});},
    deletePreset:function(name){return isPresetFrameNow()?Promise.resolve(false):g.deletePreset(name);},
    getPresetList:function(){
      var names=g.getPresetNames();
      var map={};
      for(var i=0;i<names.length;i++)map[names[i]]=i;
      return {presets:[getPresetRawForCurrentContext()],preset_names:map};
    },
    readPresetExtensionField:function(opts){
      var p=opts&&opts.path?String(opts.path):"";
      if(!p)return undefined;
      var sRaw=getSharedPresetRaw();
      var ext=(sRaw&&sRaw.extensions&&typeof sRaw.extensions==="object")?sRaw.extensions:{};
      return lp(ext,p);
    }
  };
  var reasoningPresetManagerAdapter={
    apiId:"reasoning",
    getSelectedPresetName:function(){return "Default";},
    getAllPresets:function(){return ["Default"];},
    findPreset:function(n){return n||"Default";},
    selectPreset:function(){return true;},
    savePreset:function(){return Promise.resolve(true);},
    deletePreset:function(){return Promise.resolve(true);},
    getPresetList:function(){return {presets:[{name:"Default"}],preset_names:{"Default":0}};},
    readPresetExtensionField:function(){return undefined;}
  };
  if(!presetHost.__liyuanStTools)presetHost.__liyuanStTools=[];
  var toolManagerAdapter={
    get tools(){return presetHost.__liyuanStTools;},
    registerFunctionTool:function(def){
      if(!def||typeof def!=="object"||!def.name)return;
      var name=String(def.name);
      var wrapped=Object.assign({},def,{
        toFunctionOpenAI:typeof def.toFunctionOpenAI==="function"?def.toFunctionOpenAI:function(){
          return {
            type:"function",
            function:{
              name:name,
              description:String(def.description||""),
              parameters:def.parameters||{type:"object",properties:{}}
            }
          };
        }
      });
      var list=presetHost.__liyuanStTools;
      var idx=-1;
      for(var i=0;i<list.length;i++){
        var fn=list[i]&&typeof list[i].toFunctionOpenAI==="function"?list[i].toFunctionOpenAI():null;
        var nm=(fn&&fn.function&&fn.function.name)||(list[i]&&list[i].name);
        if(nm===name){idx=i;break;}
      }
      if(idx>=0)list[idx]=wrapped;
      else list.push(wrapped);
    },
    unregisterFunctionTool:function(name){
      var list=presetHost.__liyuanStTools;
      for(var i=list.length-1;i>=0;i--){
        var fn=list[i]&&typeof list[i].toFunctionOpenAI==="function"?list[i].toFunctionOpenAI():null;
        var nm=(fn&&fn.function&&fn.function.name)||(list[i]&&list[i].name);
        if(nm===name)list.splice(i,1);
      }
    },
    isToolCallingSupported:function(){
      return false;
    },
    canPerformToolCalls:function(){
      return false;
    }
  };
  function buildStContext(){
    var c=readRuntimeCtx();
    var charName=c?String(c.charName||""):"";
    var userName=c?String(c.userName||""):"";
    var rawMsgs=(c&&Array.isArray(c.messages))?c.messages:[];
    var stChat=rawMsgs.map(function(m,idx){
      var txt=String((m&&(m.message!=null?m.message:m.text))||"");
      var mVars=(g.__liyuanScopedVars&&g.__liyuanScopedVars.message&&g.__liyuanScopedVars.message[String(idx)])||m.data||g.getAllVariables();
      return {
        name:m.name||(m.role==="user"?userName:charName),
        is_user:m.role==="user",
        is_system:Boolean(m.is_hidden),
        mes:txt,
        swipe_id:m.swipe_id||0,
        swipes:Array.isArray(m.swipes)?m.swipes:[txt],
        variables:[mVars],
        extra:m.extra||{},
        send_date:Date.now()
      };
    });
    var charRecord=buildCharRecord();
    var avatarId=charRecord.avatar||"0.png";
    if(!g.__liyuanStChatMeta)g.__liyuanStChatMeta={};
    g.__liyuanStChatMeta.variables=g.getVariables({type:"chat"});
    var chatMeta=g.__liyuanStChatMeta;
    if(!g.__liyuanStExtSettings){
      g.__liyuanStExtSettings={
        variables:{global:g.getVariables({type:"global"})},
        disabledExtensions:[],
        character_allowed_regex:[avatarId],
        preset_allowed_regex:{openai:["in_use","default"]},
        regex:[],
        tavern_helper:{
          script:{
            enabled:{global:true,characters:[avatarId],presets:["in_use","default"]},
            scripts:[]
          }
        }
      };
    }else{
      g.__liyuanStExtSettings.variables={global:g.getVariables({type:"global"})};
      g.__liyuanStExtSettings.character_allowed_regex=[avatarId];
      if(g.__liyuanStExtSettings.tavern_helper&&g.__liyuanStExtSettings.tavern_helper.script&&g.__liyuanStExtSettings.tavern_helper.script.enabled){
        g.__liyuanStExtSettings.tavern_helper.script.enabled.characters=[avatarId];
      }
    }
    var extSettings=g.__liyuanStExtSettings;
    var chars=[charRecord];
    return {
      chat:stChat,
      characters:chars,
      characterId:0,
      this_chid:0,
      groupId:null,
      chatId:(c&&(c.chatId||c.sessionId))||"default",
      name1:userName,
      name2:charName,
      chatMetadata:chatMeta,
      chat_metadata:chatMeta,
      extensionSettings:extSettings,
      extension_settings:extSettings,
      extensionPrompts:g.__liyuanExtensionPrompts,
      extension_prompts:g.__liyuanExtensionPrompts,
      setExtensionPrompt:function(key,val,pos,depth,scan,role){
        g.__liyuanExtensionPrompts[String(key)]={identifier:String(key),value:String(val||""),position:pos,depth:depth,scan:Boolean(scan),role:role};
      },
      SlashCommandParser:slashParserAdapter,
      SlashCommand:slashCommandClass,
      ToolManager:toolManagerAdapter,
      registerFunctionTool:toolManagerAdapter.registerFunctionTool,
      unregisterFunctionTool:toolManagerAdapter.unregisterFunctionTool,
      isToolCallingSupported:toolManagerAdapter.isToolCallingSupported,
      canPerformToolCalls:toolManagerAdapter.canPerformToolCalls,
      mainApi:"openai",
      uuidv4:makeUuid,
      isMobile:function(){return typeof g.innerWidth==="number"?g.innerWidth<=768:false;},
      powerUserSettings:g.__liyuanPowerUserSettings||(g.__liyuanPowerUserSettings={persona_description:"",persona_description_position:0,pin_examples:false}),
      getWorldInfoNames:function(){return g.getWorldbookNames();},
      variables:{
        local:{
          get:function(k){return lp(g.getVariables({type:"chat"}),k);},
          set:function(k,v){var p={};g._.set(p,String(k),v);g.insertOrAssignVariables(p,{type:"chat"});return v;},
          del:function(k){return g.deleteVariable(String(k),{type:"chat"});},
          add:function(k,v){var cur=lp(g.getVariables({type:"chat"}),k);var nxt=(typeof cur==="number"&&typeof v==="number")?(cur+v):(String(cur==null?"":cur)+String(v));var p={};g._.set(p,String(k),nxt);g.insertOrAssignVariables(p,{type:"chat"});return nxt;},
          inc:function(k){var cur=Number(lp(g.getVariables({type:"chat"}),k)||0)+1;var p={};g._.set(p,String(k),cur);g.insertOrAssignVariables(p,{type:"chat"});return String(cur);},
          dec:function(k){var cur=Number(lp(g.getVariables({type:"chat"}),k)||0)-1;var p={};g._.set(p,String(k),cur);g.insertOrAssignVariables(p,{type:"chat"});return String(cur);},
          has:function(k){return lp(g.getVariables({type:"chat"}),k)!==undefined;}
        },
        global:{
          get:function(k){return lp(g.getVariables({type:"global"}),k);},
          set:function(k,v){var p={};g._.set(p,String(k),v);g.insertOrAssignVariables(p,{type:"global"});return v;},
          del:function(k){return g.deleteVariable(String(k),{type:"global"});},
          add:function(k,v){var cur=lp(g.getVariables({type:"global"}),k);var nxt=(typeof cur==="number"&&typeof v==="number")?(cur+v):(String(cur==null?"":cur)+String(v));var p={};g._.set(p,String(k),nxt);g.insertOrAssignVariables(p,{type:"global"});return nxt;},
          inc:function(k){var cur=Number(lp(g.getVariables({type:"global"}),k)||0)+1;var p={};g._.set(p,String(k),cur);g.insertOrAssignVariables(p,{type:"global"});return String(cur);},
          dec:function(k){var cur=Number(lp(g.getVariables({type:"global"}),k)||0)-1;var p={};g._.set(p,String(k),cur);g.insertOrAssignVariables(p,{type:"global"});return String(cur);},
          has:function(k){return lp(g.getVariables({type:"global"}),k)!==undefined;}
        }
      },
      chatCompletionSettings:getPresetRawForCurrentContext(),
      getPresetManager:function(apiId){return apiId==="reasoning"?reasoningPresetManagerAdapter:presetManagerAdapter;},
      getRequestHeaders:function(){return {"Content-Type":"application/json"};},
      selectCharacterById:function(){return Promise.resolve();},
      getOneCharacter:function(){return Promise.resolve(charRecord);},
      getCharacters:function(){return Promise.resolve(chars);},
      loadWorldInfo:function(name){
        return g.getWorldbook(name).then(function(entries){
          var map={};
          entries.forEach(function(e,idx){map[String(e.uid!=null?e.uid:idx)]=e;});
          return {entries:map};
        });
      },
      saveWorldInfo:function(name,data){
        if(isPresetFrameNow())return Promise.resolve();
        var list=data&&data.entries?(Array.isArray(data.entries)?data.entries:Object.values(data.entries)):[];
        return g.replaceWorldbook(name,list).then(function(){
          return g.eventEmit(g.tavern_events.WORLDINFO_UPDATED,name,data||{entries:{}});
        });
      },
      reloadWorldInfoEditor:function(){},
      eventSource:eventSourceAdapter,
      event_types:g.tavern_events,
      eventTypes:g.tavern_events,
      substituteParams:g.substitudeMacros,
      substituteParamsExtended:g.substitudeMacros,
      saveMetadata:function(){return Promise.resolve();},
      saveMetadataDebounced:function(){},
      saveChatConditional:function(){return Promise.resolve();},
      saveSettings:function(){
        if(isPresetFrameNow())return Promise.resolve();
        return commitPresetFromSharedState().then(function(){});
      },
      saveSettingsDebounced:function(){
        if(isPresetFrameNow())return;
        syncPromptManagerDom();
        scheduleCommitPresetFromSettings();
      },
      writeExtensionField:function(){return Promise.resolve();},
      getCurrentChatId:function(){return (c&&(c.chatId||c.sessionId))||"default";},
      getTokenCountAsync:function(text){return Promise.resolve(Math.ceil(String(text||"").length/2));},
      getTokenCount:function(text){return Math.ceil(String(text||"").length/2);},
      generateQuietPrompt:function(opts){
        var p=typeof opts==="string"?opts:(opts&&opts.quietPrompt)||"";
        return g.TavernHelper.generate({user_input:p,should_silence:true});
      },
      generateRaw:function(opts){
        return g.TavernHelper.generateRaw(opts||{});
      },
      stopGeneration:function(){
        g.TavernHelper.stopAllGeneration();
        return true;
      },
      reloadCurrentChat:function(){return Promise.resolve();},
      clearChat:function(){return Promise.resolve();},
      addOneMessage:function(){},
      get generating(){
        var ctxNow=readRuntimeCtx();
        return Boolean(ctxNow&&ctxNow.streaming);
      },
      onlineStatus:"online",
      getChatCompletionModel:function(){
        var ctxNow=readRuntimeCtx();
        var s=getSharedPresetRaw();
        return String((ctxNow&&ctxNow.model)||(s&&(s.model||s.openai_model))||"");
      },
      saveChat:function(){return Promise.resolve();},
      generate:function(type,opts){
        var cfg=(opts&&typeof opts==="object")?Object.assign({},opts):{};
        if(type&&typeof type==="string"&&!cfg.type)cfg.type=type;
        if(type==="quiet"&&cfg.should_silence===undefined)cfg.should_silence=true;
        return g.TavernHelper.generate(cfg);
      },
      messageFormatting:function(mes){
        return g.formatAsDisplayedMessage(String(mes==null?"":mes));
      },
      updateMessageBlock:function(mesId,mesObj){
        if(typeof mesId!=="number"||!mesObj||typeof mesObj!=="object")return;
        return g.setChatMessage(mesObj,mesId);
      },
      updateReasoningUI:function(){},
      POPUP_TYPE:{TEXT:1,CONFIRM:2,INPUT:3,DISPLAY:4},
      POPUP_RESULT:{AFFIRMATIVE:1,NEGATIVE:0,CANCELLED:null,CUSTOM:2},
      callGenericPopup:function(content,type,inputValue,options){
        var pType=typeof type==="number"?type:1;
        if(isPresetFrameNow()){
          return Promise.resolve(pType===3?null:0);
        }
        var pDoc=(presetHost&&presetHost.document)||g.document;
        var defVal=inputValue==null?"":String(inputValue);
        if(!pDoc||!pDoc.body||typeof pDoc.createElement!=="function"){
          if(pType===3)return Promise.resolve(defVal);
          return Promise.resolve(pType===2?1:1);
        }
        return new Promise(function(resolve){
          var overlay=pDoc.createElement("div");
          overlay.setAttribute("style","position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,0.48);display:flex;align-items:center;justify-content:center;padding:16px;");
          var box=pDoc.createElement("div");
          box.setAttribute("style","min-width:280px;max-width:520px;width:100%;max-height:85vh;overflow:auto;background:var(--bg-elevated,#1f1f24);color:var(--ink,#f1f1f3);border:1px solid rgba(255,255,255,0.14);border-radius:12px;padding:18px;box-shadow:0 14px 40px rgba(0,0,0,0.45);font:inherit;");
          var body=pDoc.createElement("div");
          body.setAttribute("style","margin-bottom:14px;line-height:1.55;word-break:break-word;");
          if(typeof content==="string")body.innerHTML=content;
          else if(content&&typeof content==="object"&&content.nodeType)body.appendChild(content);
          else body.textContent=String(content==null?"":content);
          box.appendChild(body);
          var inputEl=null;
          if(pType===3){
            inputEl=pDoc.createElement("input");
            inputEl.type="text";
            inputEl.value=defVal;
            inputEl.setAttribute("style","width:100%;box-sizing:border-box;padding:8px 10px;margin-bottom:14px;border-radius:6px;border:1px solid rgba(255,255,255,0.22);background:rgba(0,0,0,0.22);color:inherit;font:inherit;");
            box.appendChild(inputEl);
          }
          var actions=pDoc.createElement("div");
          actions.setAttribute("style","display:flex;justify-content:flex-end;gap:8px;");
          var optsObj=(options&&typeof options==="object")?options:{};
          var done=false;
          function finish(val){
            if(done)return;
            done=true;
            try{if(overlay.parentNode)overlay.parentNode.removeChild(overlay);}catch(e){}
            resolve(val);
          }
          if(pType===2||pType===3||optsObj.allowVerticalScrolling===false){
            var cancelBtn=pDoc.createElement("button");
            cancelBtn.type="button";
            cancelBtn.textContent=String(optsObj.cancelButton||"Cancel");
            cancelBtn.setAttribute("style","padding:6px 14px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:transparent;color:inherit;cursor:pointer;");
            cancelBtn.onclick=function(){finish(pType===3?null:0);};
            actions.appendChild(cancelBtn);
          }
          var okBtn=pDoc.createElement("button");
          okBtn.type="button";
          okBtn.textContent=String(optsObj.okButton||"OK");
          okBtn.setAttribute("style","padding:6px 14px;border-radius:6px;border:0;background:var(--accent,#c84b31);color:#fff;cursor:pointer;font-weight:600;");
          okBtn.onclick=function(){finish(pType===3?(inputEl?inputEl.value:""):1);};
          actions.appendChild(okBtn);
          box.appendChild(actions);
          overlay.appendChild(box);
          overlay.onclick=function(ev){if(ev&&ev.target===overlay)finish(null);};
          pDoc.body.appendChild(overlay);
          if(inputEl&&typeof inputEl.focus==="function")inputEl.focus();
        });
      }
    };
  }
  if(!g.SillyTavern){
    Object.defineProperty(g,"SillyTavern",{
      get:function(){
        var ctx=buildStContext();
        ctx.getContext=buildStContext;
        return ctx;
      },
      configurable:true
    });
  }
}catch(e){console.error("[liyuan globals]",e);}
})();</script>`;
