/** Independent Bot sessions. Only the host layer touches the native agent SDK. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { t } from "../src/i18n/index.ts";
import {
	createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, estimateTokens, compact, convertToLlm, serializeConversation,
	type AgentSession, type ModelRuntime,
} from "@liyuan/agent-runtime";
import { buildBotView, readBotThread, type BotThreadEntry, type BotToolCallRecord } from "../src/stage/bot.ts";
import type { BotContextInfo, BotModelSelection, BotSessionAction, BotSessionInfo, BotSessionRun, BotSessionSnapshot } from "../src/stage/bot-session-types.ts";

interface SessionRecord extends BotSessionInfo { file: string; customName?: boolean }
interface Index { version: 1; activeId: string; sessions: SessionRecord[] }
const textOf = (m: any): string => typeof m.content === "string" ? m.content : (m.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text ?? "").join("");
const emptyUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const userMessage = (text: string) => ({ role: "user" as const, content: [{ type: "text" as const, text }], timestamp: Date.now() });
const historyAssistant = (text: string) => ({ role: "assistant" as const, content: [{ type: "text" as const, text }], timestamp: Date.now(), api: "openai-completions" as const, provider: "history", model: "history", stopReason: "stop" as const, usage: emptyUsage });
const tokensOfText = (text: string) => estimateTokens(userMessage(text));
const pad2 = (n: number) => String(n).padStart(2, "0");
const formatSessionTime = (ms: number): string => {
	const d = new Date(ms);
	return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const summarizeFirstInput = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, 40);
const buildSessionLabel = (firstMessage: string | undefined, ts: number): string => {
	const head = firstMessage ? summarizeFirstInput(firstMessage) : "";
	return head ? `${head} · ${formatSessionTime(ts)}` : `${t("新对话")} · ${formatSessionTime(ts)}`;
};

export class BotSessionStore {
	readonly root: string;
	readonly legacyFile: string;
	readonly cwd: string;
	private indexFile: string;
	constructor(legacyFile: string, cwd: string) {
		this.legacyFile = legacyFile;
		this.cwd = cwd;
		this.root = `${legacyFile}.sessions`;
		this.indexFile = join(this.root, "index.json");
	}
	private save(index: Index) {
		mkdirSync(this.root, { recursive: true });
		const tmp = `${this.indexFile}.${randomUUID()}.tmp`;
		writeFileSync(tmp, JSON.stringify(index, null, 2), "utf8");
		renameSync(tmp, this.indexFile);
	}
	private createRecord(name?: string): SessionRecord {
		const sm = SessionManager.create(this.cwd, this.root);
		const now = Date.now();
		const trimmed = name?.trim();
		const record: SessionRecord = {
			id: sm.getSessionId(),
			file: basename(sm.getSessionFile()!),
			name: trimmed || buildSessionLabel(undefined, now),
			...(trimmed ? { customName: true } : {}),
			created: now,
			updated: now,
		};
		sm.appendSessionInfo(record.name);
		sm.flush();
		return record;
	}
	private syncRecordFromManager(record: SessionRecord, manager: SessionManager): { changed: boolean; hasMessages: boolean } {
		let firstUserText: string | undefined;
		let firstUserTs: number | undefined;
		let hasMessages = false;
		for (const e of manager.getBranch()) {
			if (e.type !== "message") continue;
			hasMessages = true;
			if (e.message.role === "user") {
				const txt = summarizeFirstInput(textOf(e.message));
				if (txt) {
					firstUserText = txt;
					if (typeof e.message.timestamp === "number" && e.message.timestamp >= 1_000_000_000_000) {
						firstUserTs = e.message.timestamp;
					}
					break;
				}
			}
		}
		let changed = false;
		if (firstUserText && record.firstMessage !== firstUserText) {
			record.firstMessage = firstUserText;
			changed = true;
		}
		const ts = firstUserTs ?? record.created;
		const autoName = buildSessionLabel(record.firstMessage, ts);
		if (!record.customName && record.name !== autoName) {
			record.name = autoName;
			changed = true;
		}
		return { changed, hasMessages };
	}
	index(): Index {
		if (existsSync(this.indexFile)) {
			const index = JSON.parse(readFileSync(this.indexFile, "utf8")) as Index;
			if (index.version !== 1 || !Array.isArray(index.sessions) || !index.sessions.some(s => s.id === index.activeId && !s.deleted)) throw new Error(t("副编剧会话索引损坏"));
			for (const s of index.sessions) if (basename(s.file) !== s.file || !s.file.endsWith(".jsonl")) throw new Error(t("副编剧会话路径无效"));
			return index;
		}
		const record = this.createRecord();
		const sm = this.openRecord(record);
		for (const e of readBotThread(this.legacyFile)) {
			const message = e.role === "user" ? userMessage(e.text) : historyAssistant(e.text);
			message.timestamp = e.ts ?? Date.now();
			sm.appendMessage(message);
			if (e.tools?.length) sm.appendCustomEntry("bot-legacy-tools", e.tools);
		}
		this.syncRecordFromManager(record, sm);
		sm.flush();
		const index: Index = { version: 1, activeId: record.id, sessions: [record] };
		this.save(index);
		return index;
	}
	private openRecord(record: SessionRecord) {
		const path = join(this.root, record.file);
		if (!existsSync(path)) throw new Error(t("副编剧会话文件缺失"));
		return SessionManager.open(path, this.root, this.cwd);
	}
	current() {
		const index = this.index();
		const record = index.sessions.find(s => s.id === index.activeId)!;
		return { record, manager: this.openRecord(record) };
	}
	manage(action: BotSessionAction): BotSessionSnapshot {
		const index = this.index();
		const active = index.sessions.find(s => s.id === index.activeId && !s.deleted);
		const target = index.sessions.find(s => s.id === ("id" in action && action.id ? action.id : index.activeId) && !s.deleted);
		if (!target) throw new Error(t("副编剧会话不存在"));
		const dropEmptyActiveIfUnused = (nextId?: string) => {
			if (!active || active.id === nextId || active.model || active.customName) return;
			const { hasMessages } = this.syncRecordFromManager(active, this.openRecord(active));
			if (!hasMessages && !active.firstMessage) active.deleted = true;
		};
		if (action.action === "new") {
			const record = this.createRecord(action.name);
			dropEmptyActiveIfUnused(record.id);
			index.sessions.push(record); index.activeId = record.id;
		} else if (action.action === "open") {
			dropEmptyActiveIfUnused(target.id);
			index.activeId = target.id;
		} else if (action.action === "rename") {
			if (!action.name?.trim()) throw new Error(t("会话名称不能为空"));
			target.name = action.name.trim().slice(0, 120);
			target.customName = true;
			const sm = this.openRecord(target); sm.appendSessionInfo(target.name); sm.flush();
		} else if (action.action === "delete") {
			// Soft deletion: retain the native log for recovery; never delete project assets.
			target.deleted = true;
			if (target.id === index.activeId) {
				let next = index.sessions.find(s => !s.deleted);
				if (!next) { next = this.createRecord(); index.sessions.push(next); }
				index.activeId = next.id;
			}
		} else if (action.action === "model") {
			if (action.model) target.model = action.model; else delete target.model;
		}
		this.save(index);
		return this.snapshot();
	}
	touch(id: string) {
		const index = this.index(); const record = index.sessions.find(s => s.id === id);
		if (record) {
			record.updated = Date.now();
			this.syncRecordFromManager(record, this.openRecord(record));
			this.save(index);
		}
	}
	snapshot(live = false): BotSessionSnapshot {
		const index = this.index();
		const { record, manager } = this.current();
		let dirty = this.syncRecordFromManager(record, manager).changed;
		for (const s of index.sessions) {
			if (!s.deleted && s.id !== record.id && !s.firstMessage) {
				if (this.syncRecordFromManager(s, this.openRecord(s)).changed) dirty = true;
			}
		}
		if (dirty) this.save(index);
		const messages: BotThreadEntry[] = [];
		let state: Partial<BotSessionSnapshot> = {};
		for (const e of manager.getBranch()) {
			if (e.type === "custom" && e.customType === "bot-status") state = { ...state, ...e.data as object };
			if (e.type === "custom" && e.customType === "bot-legacy-tools" && messages.length) messages[messages.length - 1].tools = e.data as BotToolCallRecord[];
			if (e.type !== "message") continue;
			const m = e.message;
			if (m.role === "user" || m.role === "assistant") {
				const text = textOf(m);
				const calls = m.role === "assistant" ? m.content.filter(c => c.type === "toolCall").map(c => ({ name: (c as any).name })) : [];
				if (text || calls.length) messages.push({ role: m.role, text, ts: m.timestamp, ...(calls.length ? { tools: calls } : {}) });
			} else if (m.role === "toolResult") {
				const previous = messages[messages.length - 1];
				const tool = previous?.tools?.find(t => t.name === m.toolName && !t.detail);
				if (tool) { tool.detail = textOf(m).slice(0, 240); tool.isError = m.isError; }
			}
		}
		if (!live && (state.status === "running" || state.status === "compacting")) state.status = "interrupted";
		return { activeId: index.activeId, sessions: index.sessions.filter(s => !s.deleted).map(({ file, customName, ...s }) => s), messages, status: "idle", ...state };
	}
}

export interface BotRuntimeDeps {
	agentDir: string;
	modelRuntime: ModelRuntime;
	resolveModel: (selection?: BotModelSelection) => { model: any; thinking?: string; label?: string };
	onSnapshot?: (snapshot: BotSessionSnapshot) => void;
	/** Test/provider seam; production uses the shared ModelRuntime. */
	stream?: any;
}

/** Fit external story data separately: it never becomes Bot history or a compaction source. */
export function fitBotView(view: BotSessionRun["view"], budget: number): { text: string; beats: number } {
	const max = view.window && view.window > 0 ? Math.min(view.window, view.beats.length) : view.beats.length;
	const base = buildBotView({ ...view, beats: [] });
	if (tokensOfText(base) > budget) throw new Error(t("剧情摘要和世界状态已超过副编剧视野预算，请先整理资料或选择更大窗口的模型。"));
	let low = 0, high = max;
	while (low < high) {
		const n = Math.ceil((low + high) / 2);
		if (tokensOfText(buildBotView({ ...view, window: n })) <= budget) low = n; else high = n - 1;
	}
	return { text: low ? buildBotView({ ...view, window: low }) : base, beats: low };
}

export async function runBotSession(o: BotSessionRun, deps: BotRuntimeDeps): Promise<{ text: string; tools?: BotToolCallRecord[] } | { error: string }> {
	const store = new BotSessionStore(o.file, o.cwd);
	const { record, manager } = store.current();
	let session: AgentSession | undefined;
	let status: BotSessionSnapshot["status"] = o.compact ? "compacting" : "running";
	let context: BotContextInfo | undefined;
	let modelLabel: string | undefined;
	const notify = (patch: Partial<BotSessionSnapshot> = {}) => {
		manager.appendCustomEntry("bot-status", { status, context, modelLabel, error: undefined, ...patch });
		manager.flush();
		deps.onSnapshot?.(store.snapshot(true));
	};
	const abort = () => { void session?.abort(); };
	try {
		const selected = deps.resolveModel(record.model);
		const model = selected.model;
		if (!model || !Number.isFinite(model.contextWindow) || model.contextWindow <= 0) throw new Error(t("副编剧模型未配置有效的上下文窗口。"));
		modelLabel = selected.label ?? `${model.provider}/${model.id}`;
		const window = model.contextWindow;
		const output = Math.max(1, Math.min(model.maxTokens ?? 8192, 8192, Math.floor(window / 4)));
		const fixed = tokensOfText(o.systemPrompt) + tokensOfText(JSON.stringify(o.tools)) + 256;
		const available = window - output - fixed;
		if (available < 512) throw new Error(t("副编剧系统提示词和工具定义已超出模型容量，请选择更大窗口的模型。"));
		const view = fitBotView(o.view, Math.min(Math.floor(window / 4), Math.floor(available / 2)));
		const reserve = output + fixed + tokensOfText(view.text) + 128;
		const settingsManager = SettingsManager.inMemory({
			compaction: { enabled: true, reserveTokens: reserve, keepRecentTokens: Math.max(128, Math.min(12000, Math.floor((window - reserve) / 3))) },
			retry: { enabled: true, maxRetries: 5, baseDelayMs: 1000 },
		});
		const loader = new DefaultResourceLoader({
			cwd: o.cwd, agentDir: deps.agentDir, settingsManager,
			noExtensions: true, noContextFiles: true, noSkills: true, noPromptTemplates: true, noThemes: true,
			systemPrompt: o.systemPrompt, appendSystemPromptOverride: () => [],
			extensionFactories: [pi => {
				pi.on("before_agent_start", () => ({ systemPrompt: o.systemPrompt }));
				pi.on("context", e => ({ messages: view.text ? [userMessage(view.text), historyAssistant("已同步当前台前剧情与状态。"), ...e.messages] : e.messages })); // i18n-ignore: stable model-facing background acknowledgment
				pi.on("session_before_compact", async e => {
					const p = e.preparation;
					const text = serializeConversation(convertToLlm([...p.messagesToSummarize, ...p.turnPrefixMessages]));
					if (tokensOfText(text) + tokensOfText(p.previousSummary ?? "") < window - output - 2048) return;
					// A model switch can leave more history than even the summarizer can accept.
					// Feed bounded chunks through the native summary updater; originals stay intact.
					let offset = 0, previousSummary = p.previousSummary;
					let result: Awaited<ReturnType<typeof compact>> | undefined;
					const auth = await deps.modelRuntime.getAuth(model);
					while (offset < text.length) {
						if (e.signal.aborted || o.signal.aborted) throw new Error(t("副编剧已停止"));
						const budget = window - output - 2048 - tokensOfText(previousSummary ?? "");
						if (budget < 128) throw new Error(t("副编剧摘要超过模型容量，请选择更大窗口的模型。"));
						let low = 1, high = text.length - offset;
						while (low < high) {
							const n = Math.ceil((low + high) / 2);
							if (tokensOfText(text.slice(offset, offset + n)) <= budget) low = n; else high = n - 1;
						}
						result = await compact({ ...p, messagesToSummarize: [userMessage(text.slice(offset, offset + low))], turnPrefixMessages: [], isSplitTurn: false, previousSummary,
							settings: { ...p.settings, reserveTokens: Math.floor(output / 0.8) } }, model, auth?.auth.apiKey, auth?.auth.headers as any, e.customInstructions, e.signal,
							session!.thinkingLevel, session!.agent.streamFunction, undefined, settingsManager.getRetrySettings());
						previousSummary = result.summary; offset += low;
					}
					return result ? { compaction: result } : undefined;
				});
			}],
		});
		await loader.reload();
		const tools: BotToolCallRecord[] = [];
		const created = await createAgentSession({
			cwd: o.cwd, agentDir: deps.agentDir, modelRuntime: deps.modelRuntime, model, thinkingLevel: (record.model?.thinking ?? selected.thinking ?? "off") as any,
			settingsManager, resourceLoader: loader, sessionManager: manager, tools: o.tools.map(tool => tool.name),
			customTools: o.tools.map(tool => ({ name: tool.name, label: tool.name, description: tool.description, parameters: tool.parameters as any,
				execute: async (_id: string, args: any, signal?: AbortSignal) => {
					if (signal?.aborted || o.signal.aborted) throw new Error(t("副编剧已停止"));
					const r = await o.execute(tool.name, args);
					const rec = { name: tool.name, ...(r.activity ? { detail: r.activity } : {}), ...(r.isError ? { isError: true } : {}) };
					tools.push(rec); o.onToolCall?.(rec); if (r.activity) o.onActivity?.(r.activity);
					return { content: [{ type: "text" as const, text: r.text || "" }, ...(r.images ?? []).map(i => ({ type: "image" as const, ...i }))], details: {}, isError: r.isError };
				},
			})),
		});
		session = created.session;
		await session.bindExtensions({ mode: "rpc", onError: e => { throw new Error(e.error); } });
		await session.setModel(model);
		session.setThinkingLevel((record.model?.thinking ?? selected.thinking ?? "off") as any);
		const nativeStream = session.agent.streamFunction;
		session.agent.streamFunction = ((m: any, c: any, opts: any) => {
			const tokens = tokensOfText(c.systemPrompt ?? "") + tokensOfText(JSON.stringify(c.tools ?? [])) + c.messages.reduce((n: number, x: any) => n + estimateTokens(x), 0) + 128;
			const maxTokens = Math.min(output, opts?.maxTokens ?? output);
			if (status !== "compacting") {
				context = { tokens, contextWindow: window, outputReserve: output, viewBeats: view.beats, totalBeats: o.view.beats.length, estimated: true };
				notify();
			}
			if (tokens + maxTokens > window) throw new Error(t("副编剧上下文仍超出模型容量，本轮未发送。请手动压缩或选择更大窗口的模型。"));
			return (deps.stream ?? nativeStream)(m, c, { ...opts, maxTokens });
		}) as any;
		let lastText = "";
		let failure: string | undefined;
		session.subscribe(e => {
			if (e.type === "message_update") {
				const delta = e.assistantMessageEvent;
				if (delta.type === "text_delta") o.onDelta?.("text", delta.delta);
				if (delta.type === "thinking_delta") o.onDelta?.("thinking", delta.delta);
			}
			if (e.type === "message_end") {
				manager.flush();
				if (e.message.role === "assistant") {
					lastText = textOf(e.message);
					failure = e.message.stopReason === "error" ? e.message.errorMessage || t("模型请求失败") : undefined;
				}
			}
			if (e.type === "auto_retry_start") {
				lastText = "";
				failure = undefined;
				const retryText = t("模型请求失败，自动重试 {attempt}/{max}…", { attempt: e.attempt, max: e.maxAttempts });
				o.onActivity?.(retryText);
				notify({ error: retryText });
			}
			if (e.type === "auto_retry_end" && e.success) {
				notify({});
			}
			if (e.type === "compaction_start") { status = "compacting"; notify(); }
			if (e.type === "compaction_end") {
				status = o.compact ? "complete" : "running";
				const tokens = fixed + tokensOfText(view.text) + session!.messages.reduce((n, m) => n + estimateTokens(m), 0);
				context = { tokens, contextWindow: window, outputReserve: output, viewBeats: view.beats, totalBeats: o.view.beats.length, estimated: true };
				notify(e.errorMessage ? { error: e.errorMessage } : {});
			}
		});
		o.signal.addEventListener("abort", abort, { once: true });
		if (o.signal.aborted) throw new Error(t("副编剧已停止"));
		notify();
		if (o.compact) await session.compact();
		else {
			// The native next-turn hook covers tool continuations; the first request also needs
			// a preflight after restoring a session or selecting a smaller model.
			const historyTokens = session.messages.reduce((n, m) => n + estimateTokens(m), 0);
			if (historyTokens + tokensOfText(o.userText) > window - reserve) await session.compact();
			if (o.signal.aborted) throw new Error(t("副编剧已停止"));
			await session.prompt(o.userText, { expandPromptTemplates: false });
		}
		if (o.signal.aborted) { status = "stopped"; notify(); return { error: t("副编剧已停止，已执行的操作和对话已保存。") }; }
		if (failure) throw new Error(failure);
		status = "complete"; notify();
		return { text: o.compact ? t("副编剧上下文已压缩。") : lastText, ...(tools.length ? { tools } : {}) };
	} catch (err) {
		status = o.signal.aborted ? "stopped" : "error";
		const error = err instanceof Error ? err.message : String(err);
		notify({ error }); return { error };
	} finally {
		o.signal.removeEventListener("abort", abort);
		manager.flush(); store.touch(record.id); session?.dispose();
	}
}
