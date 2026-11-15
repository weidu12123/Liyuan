/**
 * 梨园自身脚本接口（Script API）——面向作者运行时脚本、消息交互界面与 CLI 自动化。
 *
 * 核心原则（06 / 07 文档）：
 * 1. 开放梨园自己的业务能力，复用 StageEngine / SessionManager / loreHost / cardspace 等既有负责人，
 *    不另造平行状态库或提示词装配器，也不改任何送模文案或新增注入点（遵守梨园铁律一、二、三）。
 * 2. 所有请求支持显式 target 绑定（card / chatId / sessionId / leafId），防止换卡、换项目、换分支后的迟到写入串台。
 * 3. 明确区分 completion 等级（accepted / completed / committed / refreshed）与错误码（target_mismatch / busy / cancelled 等），
 *    绝不用输入回显、固定 ID 0 或假成功掩盖真实状态。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadCardFile, readCardRawJson, applyMacros } from "./card.ts";
import { applyCardSkin } from "./cardSkin.ts";
import { displayRules, promptRules, type DisplayRule } from "./cardfront.ts";
import {
	CHAT_SCRIPT_DATA_DIR,
	isInternalChatWorkspacePath,
	listChatMarkdownAssets,
} from "./cardspace.ts";
import {
	loadPresetDoc,
	patchPresetRaw,
	presetDocView,
	type PresetBlockView,
	type PresetDoc,
	type PresetPatch,
} from "./preset-doc.ts";
import { createMacroEnv, evalPresetMacros } from "./preset-macro.ts";
import { createEjsContext, evalEjsTemplate, getEjsSyntaxErrorInfo } from "./ejs-engine.ts";
import { loadStageMaterials } from "./stage/materials.ts";
import {
	presetDeclarationPath,
	stripPresetEntries,
	translatePresetWithDeclarationAsync,
	type PresetDeclaration,
} from "./preset-declare.ts";
import { parsePromptEntries, renderForModel } from "./prompt-entries.ts";
import { applyRelayPayload, type RelayModelLike } from "./stage/provider-relay.ts";
import { extractPresetRelayMeta } from "./stage/preset-relay-meta.ts";
import {
	applyHistoryInjections,
	buildStageInjection,
	buildStageSystemPrompt,
	formatLoreIndex,
} from "./stage/assemble.ts";
import { constantLoreOf } from "./stage/materials.ts";
import { scanEntries } from "./lorebook.ts";
import { defaultState } from "./state.ts";
import type { LorebookEntry, RpConfig, WorldState } from "./types.ts";

export type ScriptCompletionStatus = "accepted" | "completed" | "committed" | "refreshed";

export type ScriptErrorCode =
	| "unsupported_action"
	| "invalid_input"
	| "target_mismatch"
	| "version_conflict"
	| "busy"
	| "permission_denied"
	| "not_found"
	| "cancelled"
	| "execution_failed";

export interface ScriptTargetDescriptor {
	card: string;
	cardName: string;
	charName: string;
	userName: string;
	chatId: string | null;
	sessionId: string;
	leafId: string | null;
	mode: "roleplay" | "agent";
	streaming: boolean;
}

export interface ScriptTargetExpectation {
	card?: string;
	chatId?: string | null;
	sessionId?: string;
	leafId?: string | null;
}

export interface ScriptCallEnvelope<T = unknown> {
	ok: boolean;
	action: string;
	requestId: string;
	status?: ScriptCompletionStatus;
	target: ScriptTargetDescriptor;
	result?: T;
	error?: {
		code: ScriptErrorCode;
		message: string;
	};
}

export interface ScriptMessageItem {
	/** 当前分支稳定消息序号（0-based，与 getChatMessages 兼容） */
	index: number;
	message_id: number;
	/** 会话树节点 ID（真实持久节点，跨删除不漂移） */
	entryId?: string;
	role: "user" | "assistant" | "system";
	channel: string;
	name: string;
	text: string;
	message: string;
	mes: string;
	thinking?: string;
	timestamp?: number;
	swipe?: { index: number; total: number };
	swipe_id?: number;
	swipes?: string[];
	data: { stat_data: Record<string, unknown> };
	variables: { stat_data: Record<string, unknown> };
}

export interface ScriptRequestRecord {
	requestId: string;
	kind: "chat.submit" | "chat.regenerate" | "generation.explicit" | "generation.contextual";
	scriptId?: string;
	target: ScriptTargetDescriptor;
	state: "running" | "completed" | "failed" | "cancelled";
	text: string;
	thinking: string;
	createdAt: number;
	updatedAt: number;
	entryId?: string;
	error?: string;
}

export interface ScriptApiHost {
	cwd: string;
	getConfig(): RpConfig;
	getTarget(): ScriptTargetDescriptor;
	getMessages(): ScriptMessageItem[];
	getState(): WorldState;
	applyStatePatch(patch: Record<string, unknown>): Promise<{ applied: string[]; warnings: string[]; state: WorldState }>;
	submitChat(input: { text: string; directorNote?: string; wait?: boolean }): Promise<{
		queued: boolean;
		aborted?: boolean;
		entryId?: string;
		error?: string;
		replyText?: string;
	}>;
	regenerateChat(input?: { text?: string; directorNote?: string; wait?: boolean }): Promise<{
		aborted?: boolean;
		entryId?: string;
		error?: string;
		replyText?: string;
	}>;
	abortChat(): void;
	updateLastReply(text: string): Promise<{ entryId: string | null; text: string }>;
	switchGreeting?(index: number): Promise<{ greetingIndex: number; text: string }>;
	dropLastReply(): Promise<{ leafId: string | null }>;
	runExplicitGeneration(input: {
		requestId: string;
		systemPrompt?: string;
		prompt?: string;
		messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
		model?: { provider?: string; id?: string };
		maxTokens?: number;
		reasoning?: string;
		signal: AbortSignal;
		onDelta?: (kind: "text" | "thinking", delta: string) => void;
	}): Promise<{ text: string; thinking: string; model: string; stopReason?: string }>;
	runContextualGeneration(input: {
		requestId: string;
		prompt: string;
		systemPrompt?: string;
		model?: { provider?: string; id?: string };
		maxTokens?: number;
		reasoning?: string;
		signal: AbortSignal;
		onDelta?: (kind: "text" | "thinking", delta: string) => void;
	}): Promise<{ text: string; thinking: string; model: string; stopReason?: string }>;
	getCurrentChatDir(): string | null;
	getLoreHost(): {
		listBooks(): { books: Array<{ path: string; name: string; entryCount: number }>; mounted: string[] };
		listMarked(): Array<LorebookEntry & { agentWritten?: boolean; source?: string }>;
		write(input: { title: string; keys: string[]; content: string; constant?: boolean; book?: string }): LorebookEntry | null;
		update(
			fingerprint: string,
			patch: { title?: string; keys?: string[]; content?: string; constant?: boolean },
		): { entry: LorebookEntry; newFingerprint: string; path: string } | null;
		remove(fingerprint: string): { entry: LorebookEntry; path: string } | null;
		mountBook(path: string, mounted: boolean): string[];
	};
	getPanels(): Array<{ name: string; kind: string; content: string; updatedAt: number }>;
	savePanel(input: { name: string; kind?: string; content: string }): Promise<{ name: string; kind: string; updatedAt: number }>;
	importPanels(list: Array<{ name?: unknown; kind?: unknown; content?: unknown }>): Promise<{
		imported: number;
		names: string[];
		errors: string[];
	}>;
	closePanel(name: string): Promise<void>;
	getStoryView(): { files: Array<{ name: string; title: string; chars: number; mtime: number; text: string; display: string }> };
	editStoryFile(input: { name: string; text: string | null }): Promise<{ checkpointId?: string }>;
	getWorldlineView(): unknown;
	listModels(): {
		current: { provider: string; id: string; name?: string; thinkingLevel?: string } | null;
		models: Array<{ provider: string; id: string; name?: string; reasoning?: boolean; contextWindow?: number; maxTokens?: number }>;
	};
	getPresetHost?(): ScriptPresetHost;
	notify(level: "info" | "warning" | "error", text: string): void;
}

export interface ScriptPresetSnapshot {
	file: string | null;
	name: string;
	kind: "st" | "rp";
	dirty: boolean;
	samplers: Record<string, number>;
	blocks: PresetBlockView[];
	raw: Record<string, unknown>;
}

export interface ScriptPresetHost {
	list(): { active: string | null; presets: Array<{ file: string; name: string }> };
	get(name?: string): ScriptPresetSnapshot | null;
	update(input: { target: "draft" | "save"; patch: PresetPatch }): Promise<{
		snapshot: ScriptPresetSnapshot;
		added: string[];
		refreshed: boolean;
	}>;
}

export const SCRIPT_API_CAPABILITIES = [
	"context.read",
	"capabilities.read",
	"messages.list",
	"messages.get",
	"messages.updateReply",
	"messages.dropLast",
	"state.read",
	"state.commit",
	"data.read",
	"data.write",
	"data.remove",
	"chat.submit",
	"chat.regenerate",
	"generation.explicit",
	"generation.contextual",
	"requests.cancel",
	"requests.observe",
	"lorebooks.list",
	"lorebooks.read",
	"lorebooks.createEntry",
	"lorebooks.updateEntry",
	"lorebooks.removeEntry",
	"lorebooks.mount",
	"preset.list",
	"preset.get",
	"preset.update",
	"preset.preview",
	"project.files.list",
	"project.files.read",
	"project.files.write",
	"project.files.remove",
	"panels.list",
	"panels.write",
	"panels.close",
	"story.list",
	"story.read",
	"story.write",
	"worldline.list",
	"models.list",
	"text.macros",
	"text.transform",
	"text.ejs",
	"ui.notify",
] as const;

export type ScriptApiAction = (typeof SCRIPT_API_CAPABILITIES)[number];

const SAFE_SCOPE_ID_RE = /^[\w一-龥][\w一-龥.-]{0,63}$/;

function sanitizeScopeId(raw: unknown, fallback = "default"): string {
	const s = typeof raw === "string" ? raw.trim() : "";
	if (!s) return fallback;
	if (SAFE_SCOPE_ID_RE.test(s) && !s.includes("..")) return s;
	return s.replace(/[^\w一-龥.-]/g, "_").replace(/\.+/g, ".").slice(0, 64) || fallback;
}

function resolveRealPathWithMissing(targetPath: string): string {
	let cur = resolve(targetPath);
	const suffix: string[] = [];
	while (!existsSync(cur)) {
		const parent = dirname(cur);
		if (parent === cur) break;
		suffix.unshift(basename(cur));
		cur = parent;
	}
	const base = existsSync(cur) ? realpathSync(cur) : cur;
	return suffix.length > 0 ? join(base, ...suffix) : base;
}

function insideRealPath(rootDir: string, candidatePath: string): boolean {
	const absRoot = resolveRealPathWithMissing(rootDir);
	const absTarget = resolveRealPathWithMissing(candidatePath);
	const rel = relative(absRoot, absTarget);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export type ScriptDataScope = "script" | "chat" | "message" | "character" | "preset" | "global" | "extension";

function normalizeDataScope(raw: unknown): ScriptDataScope {
	const s = String(raw ?? "script").trim().toLowerCase();
	if (
		s === "chat" ||
		s === "message" ||
		s === "character" ||
		s === "preset" ||
		s === "global" ||
		s === "extension"
	) {
		return s;
	}
	return "script";
}

function scriptDataFilePath(
	cwd: string,
	chatDir: string | null,
	target: ScriptTargetDescriptor,
	scope: ScriptDataScope,
	scriptId: string,
	presetName?: string,
	ensureDir = true,
): string {
	if (scope === "global") {
		const dir = join(cwd, ".liyuan-state", "script-data", "global");
		if (ensureDir) mkdirSync(dir, { recursive: true });
		return join(dir, "_global.json");
	}
	if (scope === "extension") {
		const dir = join(cwd, ".liyuan-state", "script-data", "extension");
		if (ensureDir) mkdirSync(dir, { recursive: true });
		return join(dir, `${sanitizeScopeId(scriptId, "default")}.json`);
	}
	if (scope === "preset") {
		const dir = join(cwd, ".liyuan-state", "script-data", "preset");
		if (ensureDir) mkdirSync(dir, { recursive: true });
		const nameKey = presetName ? basename(presetName).replace(/\.json$/i, "") : "default";
		return join(dir, `${sanitizeScopeId(nameKey, "default")}.json`);
	}
	if (scope === "character") {
		const dir = join(cwd, ".liyuan-state", "script-data", "character");
		if (ensureDir) mkdirSync(dir, { recursive: true });
		return join(dir, `${sanitizeScopeId(target.card || scriptId, "card")}.json`);
	}
	const baseDir = chatDir
		? join(chatDir, CHAT_SCRIPT_DATA_DIR)
		: join(cwd, ".liyuan-state", "script-data", sanitizeScopeId(target.sessionId, "session"));
	if (ensureDir) mkdirSync(baseDir, { recursive: true });
	const fileKey =
		scope === "chat"
			? "_chat"
			: scope === "message"
				? "_messages"
				: sanitizeScopeId(scriptId, "default");
	return join(baseDir, `${fileKey}.json`);
}

export function readScriptScopeVarsSync(
	cwd: string,
	chatDir: string | null,
	sessionId: string,
	card: string,
	scope: "global" | "chat" | "character" | "preset",
	presetName?: string,
): Record<string, unknown> {
	const target: ScriptTargetDescriptor = { sessionId, chatDir, card, mode: "roleplay", streaming: false };
	const file = scriptDataFilePath(cwd, chatDir, target, scope, scope, presetName, false);
	return readScriptScopeData(file, scope).data;
}

export function writeScriptScopeVarUpdatesSync(
	cwd: string,
	chatDir: string | null,
	sessionId: string,
	card: string,
	scope: "global" | "chat",
	updates: Record<string, string>,
	presetName?: string,
): void {
	const entries = Object.entries(updates);
	if (entries.length === 0) return;
	const target: ScriptTargetDescriptor = { sessionId, chatDir, card, mode: "roleplay", streaming: false };
	const file = scriptDataFilePath(cwd, chatDir, target, scope, scope, presetName, true);
	const cur = readScriptScopeData(file, scope);
	const nextData = { ...cur.data };
	let changed = false;
	for (const [k, v] of entries) {
		if (nextData[k] !== v) {
			nextData[k] = v;
			changed = true;
		}
	}
	if (changed) writeScriptDataFile(file, nextData, cur.version);
}

/** 读取脚本作用域数据：对 global/preset 在主文件尚未生成时兼容旧版 default.json */
function readScriptScopeData(file: string, scope: ScriptDataScope): { version: number; updatedAt: number; data: Record<string, unknown> } {
	if (!existsSync(file) && (scope === "global" || scope === "preset")) {
		const legacyFile = join(dirname(file), "default.json");
		if (legacyFile !== file && existsSync(legacyFile)) {
			return readScriptDataFile(legacyFile);
		}
	}
	return readScriptDataFile(file);
}

function readScriptDataFile(file: string): { version: number; updatedAt: number; data: Record<string, unknown> } {
	if (!existsSync(file)) return { version: 0, updatedAt: 0, data: {} };
	try {
		const raw = JSON.parse(readFileSync(file, "utf8")) as {
			version?: unknown;
			updatedAt?: unknown;
			data?: unknown;
		};
		const data = raw && typeof raw.data === "object" && raw.data !== null && !Array.isArray(raw.data)
			? (raw.data as Record<string, unknown>)
			: {};
		return {
			version: typeof raw?.version === "number" ? raw.version : 1,
			updatedAt: typeof raw?.updatedAt === "number" ? raw.updatedAt : 0,
			data,
		};
	} catch {
		return { version: 0, updatedAt: 0, data: {} };
	}
}

function writeScriptDataFile(file: string, nextData: Record<string, unknown>, prevVersion: number): {
	version: number;
	updatedAt: number;
	data: Record<string, unknown>;
} {
	const next = {
		version: prevVersion + 1,
		updatedAt: Date.now(),
		data: nextData,
	};
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(next, null, "\t")}\n`, "utf8");
	return next;
}

function createDefaultPresetHost(cwd: string, getConfig: () => RpConfig): ScriptPresetHost {
	const nameFrom = (file: string): string => {
		const base = file.replace(/\\/g, "/").split("/").pop() ?? file;
		return base.replace(/\.json$/i, "") || "preset";
	};
	const overrideFile = () => join(cwd, ".liyuan", "preset-override.json");
	const presetsRoot = () => join(cwd, "assets", "presets");
	const list = () => {
		const cfg = getConfig();
		const out: Array<{ file: string; name: string }> = [];
		const legacy = join(cwd, "liyuan-preset.json");
		if (existsSync(legacy)) {
			try {
				JSON.parse(readFileSync(legacy, "utf8"));
				out.push({ file: "liyuan-preset.json", name: nameFrom("liyuan-preset.json") });
			} catch {
				/* ignore */
			}
		}
		const dir = presetsRoot();
		if (existsSync(dir)) {
			for (const f of readdirSync(dir)) {
				if (!f.endsWith(".json")) continue;
				try {
					JSON.parse(readFileSync(join(dir, f), "utf8"));
					out.push({ file: `assets/presets/${f}`, name: nameFrom(f) });
				} catch {
					/* ignore */
				}
			}
		}
		return { active: cfg.preset ?? null, presets: out };
	};
	const toSnap = (file: string | null, doc: PresetDoc, dirty: boolean): ScriptPresetSnapshot => ({
		file,
		name: doc.name,
		kind: doc.kind,
		dirty,
		samplers: doc.samplers,
		blocks: presetDocView(doc, { full: true }),
		raw: doc.raw,
	});
	const get = (name?: string): ScriptPresetSnapshot | null => {
		const cfg = getConfig();
		const wanted = typeof name === "string" ? name.trim() : "";
		if (!wanted || wanted === "in_use") {
			if (!cfg.preset) return null;
			const ovr = overrideFile();
			if (existsSync(ovr)) {
				try {
					const doc = loadPresetDoc(JSON.parse(readFileSync(ovr, "utf8")), nameFrom(cfg.preset));
					return toSnap(cfg.preset, doc, true);
				} catch {
					/* fall through */
				}
			}
			const abs = isAbsolute(cfg.preset) ? cfg.preset : join(cwd, cfg.preset);
			if (!existsSync(abs)) return null;
			try {
				const doc = loadPresetDoc(JSON.parse(readFileSync(abs, "utf8")), nameFrom(cfg.preset));
				return toSnap(cfg.preset, doc, false);
			} catch {
				return null;
			}
		}
		const all = list().presets;
		const hit = all.find((p) => p.file === wanted || p.name === wanted || nameFrom(p.file) === nameFrom(wanted));
		if (!hit) return null;
		const abs = join(cwd, hit.file);
		if (!existsSync(abs)) return null;
		try {
			const doc = loadPresetDoc(JSON.parse(readFileSync(abs, "utf8")), hit.name);
			return toSnap(hit.file, doc, cfg.preset === hit.file && existsSync(overrideFile()));
		} catch {
			return null;
		}
	};
	const update = async ({ target, patch }: { target: "draft" | "save"; patch: PresetPatch }) => {
		const cfg = getConfig();
		if (!cfg.preset) throw new Error("当前未配置预设文件");
		const cur = get("in_use");
		if (!cur) throw new Error(`预设文件不存在：${cfg.preset}`);
		const curDoc = loadPresetDoc(cur.raw, cur.name);
		const beforeIds = new Set(cur.blocks.map((b) => b.id));
		const nextRaw = patchPresetRaw(curDoc, patch);
		const nextDoc = loadPresetDoc(nextRaw, cur.name);
		const added = presetDocView(nextDoc)
			.map((b) => b.id)
			.filter((id) => !beforeIds.has(id));
		const ovr = overrideFile();
		if (target === "save") {
			const abs = isAbsolute(cfg.preset) ? cfg.preset : join(cwd, cfg.preset);
			if (!insideRealPath(cwd, abs)) throw new Error("非法预设路径");
			mkdirSync(dirname(abs), { recursive: true });
			writeFileSync(abs, `${JSON.stringify(nextRaw, null, "\t")}\n`, "utf8");
			if (existsSync(ovr)) unlinkSync(ovr);
			return { snapshot: toSnap(cfg.preset, nextDoc, false), added, refreshed: false };
		}
		mkdirSync(dirname(ovr), { recursive: true });
		writeFileSync(ovr, `${JSON.stringify(nextRaw, null, "\t")}\n`, "utf8");
		return { snapshot: toSnap(cfg.preset, nextDoc, true), added, refreshed: false };
	};
	return { list, get, update };
}

export class ScriptApiService {
	#host: ScriptApiHost;
	#seq = 0;
	#activeControllers = new Map<string, AbortController>();
	#requests = new Map<string, ScriptRequestRecord>();

	constructor(host: ScriptApiHost) {
		this.#host = host;
	}

	#nextId(prefix = "sreq"): string {
		this.#seq += 1;
		return `${prefix}_${Date.now().toString(36)}_${this.#seq}`;
	}

	#recordRequest(rec: ScriptRequestRecord): void {
		this.#requests.set(rec.requestId, rec);
		if (this.#requests.size > 120) {
			const firstKey = this.#requests.keys().next().value;
			if (firstKey) this.#requests.delete(firstKey);
		}
	}

	#checkTarget(expected?: ScriptTargetExpectation): { ok: true; current: ScriptTargetDescriptor } | { ok: false; current: ScriptTargetDescriptor; message: string } {
		const current = this.#host.getTarget();
		if (!expected) return { ok: true, current };
		if (expected.card !== undefined && expected.card !== current.card) {
			return {
				ok: false,
				current,
				message: `目标角色卡已切换（期望 ${expected.card}，当前 ${current.card}），拒绝跨卡操作`,
			};
		}
		if (expected.chatId !== undefined && expected.chatId !== current.chatId) {
			return {
				ok: false,
				current,
				message: `目标项目已切换（期望 ${expected.chatId ?? "null"}，当前 ${current.chatId ?? "null"}），拒绝跨项目操作`,
			};
		}
		if (expected.sessionId !== undefined && expected.sessionId !== current.sessionId) {
			return {
				ok: false,
				current,
				message: `目标会话已切换（期望 ${expected.sessionId}，当前 ${current.sessionId}），拒绝跨会话写入`,
			};
		}
		if (expected.leafId !== undefined && expected.leafId !== current.leafId) {
			return {
				ok: false,
				current,
				message: `目标分支节点已变化（期望 ${expected.leafId ?? "null"}，当前 ${current.leafId ?? "null"}），请刷新后重试`,
			};
		}
		return { ok: true, current };
	}

	async invoke(input: {
		action: string;
		params?: Record<string, unknown>;
		target?: ScriptTargetExpectation;
		scriptId?: string;
		requestId?: string;
	}): Promise<ScriptCallEnvelope> {
		const action = String(input?.action ?? "").trim();
		const params = (input?.params && typeof input.params === "object" ? input.params : {}) as Record<string, unknown>;
		const requestId = typeof input?.requestId === "string" && input.requestId.trim() ? input.requestId.trim() : this.#nextId();
		const scriptId = sanitizeScopeId(input?.scriptId ?? params.scriptId, "default");

		const guard = this.#checkTarget(input?.target);
		if (!guard.ok) {
			return {
				ok: false,
				action,
				requestId,
				target: guard.current,
				error: { code: "target_mismatch", message: guard.message },
			};
		}

		try {
			switch (action) {
				case "context.read": {
					const target = this.#host.getTarget();
					const cfg = this.#host.getConfig();
					const cardAbs = isAbsolute(cfg.card) ? cfg.card : join(this.#host.cwd, cfg.card);
					let cardMeta: { name: string; description: string; firstMes: string; alternateGreetingCount: number } | null = null;
					try {
						const c = loadCardFile(cardAbs);
						cardMeta = {
							name: c.name,
							description: c.description,
							firstMes: c.firstMes,
							alternateGreetingCount: c.alternateGreetings.length,
						};
					} catch {
						cardMeta = null;
					}
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target,
						result: {
							...target,
							cardMeta,
							mountedLorebooks: cfg.lorebooks ?? [],
							preset: cfg.preset ?? null,
							capabilities: SCRIPT_API_CAPABILITIES,
						},
					};
				}

				case "capabilities.read": {
					const target = this.#host.getTarget();
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target,
						result: {
							version: "1.0.0",
							capabilities: SCRIPT_API_CAPABILITIES,
						},
					};
				}

				case "messages.list": {
					const all = this.#host.getMessages();
					const roleFilter = typeof params.role === "string" ? params.role.trim() : "";
					const filtered = roleFilter ? all.filter((m) => m.role === roleFilter) : all;
					const limit = typeof params.limit === "number" && params.limit > 0 ? Math.floor(params.limit) : undefined;
					const items = limit ? filtered.slice(-limit) : filtered;
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target: this.#host.getTarget(),
						result: {
							total: all.length,
							lastMessageId: all.length > 0 ? all[all.length - 1]!.index : null,
							messages: items,
						},
					};
				}

				case "messages.get": {
					const all = this.#host.getMessages();
					if (all.length === 0) {
						return {
							ok: true,
							action,
							requestId,
							status: "completed",
							target: this.#host.getTarget(),
							result: { message: null, total: 0, lastMessageId: null },
						};
					}
					let hit: ScriptMessageItem | undefined;
					if (typeof params.entryId === "string" && params.entryId.trim()) {
						hit = all.find((m) => m.entryId === params.entryId);
					} else if (typeof params.index === "number" || typeof params.message_id === "number") {
						const rawIdx = Number(params.index ?? params.message_id);
						const idx = rawIdx < 0 ? all.length + rawIdx : rawIdx;
						hit = all[idx];
					} else {
						hit = all[all.length - 1];
					}
					if (!hit) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "not_found", message: "未找到指定消息" },
						};
					}
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target: this.#host.getTarget(),
						result: {
							message: hit,
							total: all.length,
							lastMessageId: all[all.length - 1]!.index,
						},
					};
				}

				case "messages.updateReply": {
					if (this.#host.getTarget().streaming) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "busy", message: "当前正在流式生成，请等待完成或先停止" },
						};
					}
					const msgId = typeof params.message_id === "number" ? params.message_id : undefined;
					const swipeId = typeof params.swipe_id === "number" && Number.isFinite(params.swipe_id) ? Math.max(0, Math.floor(params.swipe_id)) : undefined;
					const text = typeof params.text === "string" ? params.text.trim() : "";
					if (msgId === 0 && this.#host.switchGreeting) {
						let targetSwipe = swipeId;
						if (targetSwipe === undefined && text) {
							try {
								const cfg = this.#host.getConfig();
								const cardAbs = isAbsolute(cfg.card) ? cfg.card : join(this.#host.cwd, cfg.card);
								const card = loadCardFile(cardAbs);
								const pool = [card.firstMes, ...card.alternateGreetings];
								const hit = pool.findIndex((g) => g.trim() === text || text.endsWith(g.trim()));
								if (hit >= 0) targetSwipe = hit;
							} catch {
								/* ignore */
							}
						}
						if (targetSwipe !== undefined) {
							const gr = await this.#host.switchGreeting(targetSwipe);
							return {
								ok: true,
								action,
								requestId,
								status: "refreshed",
								target: this.#host.getTarget(),
								result: gr,
							};
						}
					}
					if (!text) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "invalid_input", message: "改写后的回复正文不能为空" },
						};
					}
					const r = await this.#host.updateLastReply(text);
					return {
						ok: true,
						action,
						requestId,
						status: "refreshed",
						target: this.#host.getTarget(),
						result: r,
					};
				}

				case "messages.dropLast": {
					if (this.#host.getTarget().streaming) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "busy", message: "当前正在流式生成，请等待完成或先停止" },
						};
					}
					const r = await this.#host.dropLastReply();
					return {
						ok: true,
						action,
						requestId,
						status: "refreshed",
						target: this.#host.getTarget(),
						result: r,
					};
				}

				case "state.read": {
					const state = this.#host.getState();
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target: this.#host.getTarget(),
						result: {
							state,
							mvu: state.mvu ?? {},
						},
					};
				}

				case "state.commit": {
					const patch = params.patch && typeof params.patch === "object" && !Array.isArray(params.patch)
						? (params.patch as Record<string, unknown>)
						: null;
					if (!patch) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "invalid_input", message: "state.commit 需要提供对象类型的 patch" },
						};
					}
					const r = await this.#host.applyStatePatch(patch);
					return {
						ok: true,
						action,
						requestId,
						status: "committed",
						target: this.#host.getTarget(),
						result: r,
					};
				}

				case "data.read": {
					const scopeRaw = String(params.scope ?? params.type ?? "script").toLowerCase();
					if (scopeRaw === "mvu") {
						const state = this.#host.getState();
						return {
							ok: true,
							action,
							requestId,
							status: "completed",
							target: this.#host.getTarget(),
							result: {
								scope: scopeRaw,
								version: 1,
								data: { stat_data: state.mvu ?? {} },
							},
						};
					}
					const scope = normalizeDataScope(scopeRaw);
					const target = this.#host.getTarget();
					const effId =
						typeof params.extension_id === "string" && params.extension_id.trim()
							? params.extension_id.trim()
							: scriptId;
					const presetName = typeof params.presetName === "string" && params.presetName.trim()
						? params.presetName.trim()
						: this.#host.getConfig().preset;
					const file = scriptDataFilePath(this.#host.cwd, this.#host.getCurrentChatDir(), target, scope, effId, presetName);
					const stored = readScriptScopeData(file, scope);
					const key = typeof params.key === "string" && params.key.trim() ? params.key.trim() : undefined;
					let outData: unknown = key !== undefined ? stored.data[key] : stored.data;
					if (scope === "message" && key === undefined && Object.keys(stored.data).length === 0) {
						const state = this.#host.getState();
						outData = { stat_data: state.mvu ?? {} };
					}
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target,
						result: {
							scope,
							scriptId: effId,
							version: stored.version,
							updatedAt: stored.updatedAt,
							data: outData,
						},
					};
				}

				case "data.write": {
					const scope = normalizeDataScope(params.scope ?? params.type ?? "script");
					const mode = params.mode === "replace" ? "replace" : "merge";
					const target = this.#host.getTarget();
					const effId =
						typeof params.extension_id === "string" && params.extension_id.trim()
							? params.extension_id.trim()
							: scriptId;
					const presetName = typeof params.presetName === "string" && params.presetName.trim()
						? params.presetName.trim()
						: this.#host.getConfig().preset;
					const file = scriptDataFilePath(this.#host.cwd, this.#host.getCurrentChatDir(), target, scope, effId, presetName);
					const cur = readScriptScopeData(file, scope);
					if (typeof params.expectedVersion === "number" && params.expectedVersion !== cur.version) {
						return {
							ok: false,
							action,
							requestId,
							target,
							error: {
								code: "version_conflict",
								message: `脚本数据版本冲突（期望 v${params.expectedVersion}，当前 v${cur.version}）`,
							},
						};
					}
					let nextData: Record<string, unknown>;
					if (typeof params.key === "string" && params.key.trim()) {
						nextData = mode === "replace" ? {} : { ...cur.data };
						nextData[params.key.trim()] = params.value;
					} else if (params.data && typeof params.data === "object" && !Array.isArray(params.data)) {
						nextData = mode === "replace"
							? { ...(params.data as Record<string, unknown>) }
							: { ...cur.data, ...(params.data as Record<string, unknown>) };
					} else {
						return {
							ok: false,
							action,
							requestId,
							target,
							error: { code: "invalid_input", message: "data.write 需提供 data 对象或 key+value" },
						};
					}
					const saved = writeScriptDataFile(file, nextData, cur.version);
					return {
						ok: true,
						action,
						requestId,
						status: "committed",
						target,
						result: {
							scope,
							scriptId: effId,
							version: saved.version,
							updatedAt: saved.updatedAt,
							data: saved.data,
						},
					};
				}

				case "data.remove": {
					const scope = normalizeDataScope(params.scope ?? params.type ?? "script");
					const target = this.#host.getTarget();
					const effId =
						typeof params.extension_id === "string" && params.extension_id.trim()
							? params.extension_id.trim()
							: scriptId;
					const presetName = typeof params.presetName === "string" && params.presetName.trim()
						? params.presetName.trim()
						: this.#host.getConfig().preset;
					const file = scriptDataFilePath(this.#host.cwd, this.#host.getCurrentChatDir(), target, scope, effId, presetName);
					const cur = readScriptScopeData(file, scope);
					const key = typeof params.key === "string" && params.key.trim() ? params.key.trim() : undefined;
					if (key) {
						const nextData = { ...cur.data };
						delete nextData[key];
						const saved = writeScriptDataFile(file, nextData, cur.version);
						return {
							ok: true,
							action,
							requestId,
							status: "committed",
							target,
							result: { scope, scriptId: effId, version: saved.version, data: saved.data },
						};
					}
					if (existsSync(file)) unlinkSync(file);
					return {
						ok: true,
						action,
						requestId,
						status: "committed",
						target,
						result: { scope, scriptId: effId, version: 0, data: {} },
					};
				}

				case "chat.submit": {
					const text = typeof params.text === "string" ? params.text.trim() : String(params.user_input ?? "").trim();
					const directorNote = typeof params.directorNote === "string" ? params.directorNote.trim() || undefined : undefined;
					const wait = params.wait !== false;
					if (!text) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "invalid_input", message: "chat.submit 的输入文本不能为空" },
						};
					}
					const startTarget = this.#host.getTarget();
					const rec: ScriptRequestRecord = {
						requestId,
						kind: "chat.submit",
						scriptId,
						target: startTarget,
						state: "running",
						text: "",
						thinking: "",
						createdAt: Date.now(),
						updatedAt: Date.now(),
					};
					this.#recordRequest(rec);
					const out = await this.#host.submitChat({ text, directorNote, wait });
					rec.updatedAt = Date.now();
					rec.text = out.replyText ?? "";
					rec.entryId = out.entryId;
					if (out.error) {
						rec.state = "failed";
						rec.error = out.error;
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "execution_failed", message: out.error },
						};
					}
					if (out.aborted) {
						rec.state = "cancelled";
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							result: { text: out.replyText ?? "", entryId: out.entryId, aborted: true },
							error: { code: "cancelled", message: "主聊天生成已中止" },
						};
					}
					rec.state = "completed";
					return {
						ok: true,
						action,
						requestId,
						status: wait ? "refreshed" : "accepted",
						target: this.#host.getTarget(),
						result: {
							queued: out.queued,
							entryId: out.entryId,
							text: out.replyText ?? "",
						},
					};
				}

				case "chat.regenerate": {
					if (this.#host.getTarget().streaming) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "busy", message: "当前正在流式生成，无法立即重新生成" },
						};
					}
					const text = typeof params.text === "string" && params.text.trim() ? params.text.trim() : undefined;
					const directorNote = typeof params.directorNote === "string" ? params.directorNote.trim() || undefined : undefined;
					const wait = params.wait !== false;
					const out = await this.#host.regenerateChat({ text, directorNote, wait });
					if (out.error) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "execution_failed", message: out.error },
						};
					}
					if (out.aborted) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							result: { text: out.replyText ?? "", entryId: out.entryId, aborted: true },
							error: { code: "cancelled", message: "重新生成已中止" },
						};
					}
					return {
						ok: true,
						action,
						requestId,
						status: wait ? "refreshed" : "accepted",
						target: this.#host.getTarget(),
						result: {
							entryId: out.entryId,
							text: out.replyText ?? "",
						},
					};
				}

				case "generation.explicit":
				case "generation.contextual": {
					const startTarget = this.#host.getTarget();
					const controller = new AbortController();
					this.#activeControllers.set(requestId, controller);
					const rec: ScriptRequestRecord = {
						requestId,
						kind: action,
						scriptId,
						target: startTarget,
						state: "running",
						text: "",
						thinking: "",
						createdAt: Date.now(),
						updatedAt: Date.now(),
					};
					this.#recordRequest(rec);

					try {
						const modelSpec = params.model && typeof params.model === "object"
							? (params.model as { provider?: string; id?: string })
							: undefined;
						const maxTokens = typeof params.maxTokens === "number" && params.maxTokens > 0 ? Math.floor(params.maxTokens) : undefined;
						const reasoning = typeof params.reasoning === "string" ? params.reasoning : undefined;
						const onDelta = (kind: "text" | "thinking", delta: string) => {
							if (kind === "text") rec.text += delta;
							else rec.thinking += delta;
							rec.updatedAt = Date.now();
						};

						let res: { text: string; thinking: string; model: string; stopReason?: string };
						const injectTexts = Array.isArray(params.injects)
							? params.injects
									.filter((it): it is { content?: unknown } => !!it && typeof it === "object")
									.map((it) => String(it.content ?? "").trim())
									.filter(Boolean)
							: [];
						if (action === "generation.explicit") {
							let prompt = typeof params.prompt === "string"
								? params.prompt
								: typeof params.user_input === "string"
									? params.user_input
									: "";
							if (injectTexts.length > 0) {
								prompt = [prompt, ...injectTexts].filter(Boolean).join("\n\n");
							}
							const systemPrompt = typeof params.systemPrompt === "string" ? params.systemPrompt : undefined;
							const rawSource = Array.isArray(params.messages)
								? params.messages
								: Array.isArray(params.ordered_prompts)
									? params.ordered_prompts
									: undefined;
							const rawMsgs = rawSource
								? rawSource
										.filter((m): m is { role?: unknown; content?: unknown } => !!m && typeof m === "object" && "content" in m)
										.map((m) => ({
											role: (m.role === "assistant" || m.role === "system" ? m.role : "user") as "user" | "assistant" | "system",
											content: String(m.content ?? ""),
										}))
										.filter((m) => m.content.trim().length > 0)
								: undefined;
							if (!prompt.trim() && (!rawMsgs || rawMsgs.length === 0)) {
								return {
									ok: false,
									action,
									requestId,
									target: startTarget,
									error: { code: "invalid_input", message: "generation.explicit 需提供非空 prompt 或 messages" },
								};
							}
							res = await this.#host.runExplicitGeneration({
								requestId,
								systemPrompt,
								prompt,
								messages: rawMsgs,
								model: modelSpec,
								maxTokens,
								reasoning,
								signal: controller.signal,
								onDelta,
							});
						} else {
							let prompt = typeof params.prompt === "string"
								? params.prompt
								: typeof params.user_input === "string"
									? params.user_input
									: "";
							if (injectTexts.length > 0) {
								prompt = [prompt, ...injectTexts].filter(Boolean).join("\n\n");
							}
							if (!prompt.trim()) {
								return {
									ok: false,
									action,
									requestId,
									target: startTarget,
									error: { code: "invalid_input", message: "generation.contextual 需提供非空 prompt" },
								};
							}
							const systemPrompt = typeof params.systemPrompt === "string" ? params.systemPrompt : undefined;
							res = await this.#host.runContextualGeneration({
								requestId,
								prompt,
								systemPrompt,
								model: modelSpec,
								maxTokens,
								reasoning,
								signal: controller.signal,
								onDelta,
							});
						}

						rec.text = res.text;
						rec.thinking = res.thinking;
						rec.updatedAt = Date.now();
						if (controller.signal.aborted || res.stopReason === "aborted") {
							rec.state = "cancelled";
							return {
								ok: false,
								action,
								requestId,
								target: this.#host.getTarget(),
								result: { text: res.text, thinking: res.thinking, model: res.model, aborted: true },
								error: { code: "cancelled", message: "独立生成请求已取消" },
							};
						}
						rec.state = "completed";
						return {
							ok: true,
							action,
							requestId,
							status: "completed",
							target: this.#host.getTarget(),
							result: {
								text: res.text,
								thinking: res.thinking,
								model: res.model,
								stopReason: res.stopReason ?? "stop",
							},
						};
					} catch (err) {
						rec.updatedAt = Date.now();
						if (controller.signal.aborted) {
							rec.state = "cancelled";
							return {
								ok: false,
								action,
								requestId,
								target: this.#host.getTarget(),
								result: { text: rec.text, thinking: rec.thinking, aborted: true },
								error: { code: "cancelled", message: "独立生成请求已取消" },
							};
						}
						const msg = err instanceof Error ? err.message : String(err);
						rec.state = "failed";
						rec.error = msg;
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "execution_failed", message: msg },
						};
					} finally {
						this.#activeControllers.delete(requestId);
					}
				}

				case "requests.cancel": {
					const targetReqId = typeof params.targetRequestId === "string"
						? params.targetRequestId.trim()
						: typeof params.id === "string"
							? params.id.trim()
							: "";
					if (targetReqId) {
						const ctrl = this.#activeControllers.get(targetReqId);
						const rec = this.#requests.get(targetReqId);
						if (ctrl) {
							ctrl.abort();
							if (rec) {
								rec.state = "cancelled";
								rec.updatedAt = Date.now();
							}
							return {
								ok: true,
								action,
								requestId,
								status: "completed",
								target: this.#host.getTarget(),
								result: { cancelledRequestId: targetReqId, cancelled: true },
							};
						}
						return {
							ok: true,
							action,
							requestId,
							status: "completed",
							target: this.#host.getTarget(),
							result: { cancelledRequestId: targetReqId, cancelled: false, state: rec?.state ?? "unknown" },
						};
					}
					// 未传特定 requestId 时：取消所有活跃独立生成，并在允许时中止当前主拍
					const cancelledIds: string[] = [];
					for (const [id, ctrl] of this.#activeControllers.entries()) {
						ctrl.abort();
						cancelledIds.push(id);
						const rec = this.#requests.get(id);
						if (rec) {
							rec.state = "cancelled";
							rec.updatedAt = Date.now();
						}
					}
					const abortMain = params.includeMainChat !== false && this.#host.getTarget().streaming;
					if (abortMain) this.#host.abortChat();
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target: this.#host.getTarget(),
						result: { cancelledIds, abortedMainChat: abortMain },
					};
				}

				case "requests.observe": {
					const targetReqId = typeof params.targetRequestId === "string"
						? params.targetRequestId.trim()
						: typeof params.id === "string"
							? params.id.trim()
							: "";
					if (targetReqId) {
						const rec = this.#requests.get(targetReqId) ?? null;
						if (!rec) {
							return {
								ok: false,
								action,
								requestId,
								target: this.#host.getTarget(),
								error: { code: "not_found", message: `未找到请求 ${targetReqId}` },
							};
						}
						return {
							ok: true,
							action,
							requestId,
							status: "completed",
							target: this.#host.getTarget(),
							result: { request: rec },
						};
					}
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target: this.#host.getTarget(),
						result: {
							activeIds: [...this.#activeControllers.keys()],
							recent: [...this.#requests.values()].slice(-20),
						},
					};
				}

				case "lorebooks.list": {
					const shelf = this.#host.getLoreHost().listBooks();
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target: this.#host.getTarget(),
						result: shelf,
					};
				}

				case "lorebooks.read": {
					const entries = this.#host.getLoreHost().listMarked();
					const bookFilter =
						typeof params.book === "string"
							? params.book.trim().replace(/\\/g, "/").replace(/\.json$/i, "").toLowerCase()
							: "";
					const hasSourceField = entries.some((e) => typeof e.source === "string" && e.source.trim().length > 0);
					const byBook =
						bookFilter && hasSourceField
							? entries.filter((e) => {
									const src = String(e.source ?? "").trim().replace(/\\/g, "/");
									const base = (src.split("/").pop() ?? src).replace(/\.json$/i, "").toLowerCase();
									return base === bookFilter || src.replace(/\.json$/i, "").toLowerCase() === bookFilter;
								})
							: entries;
					const query = typeof params.query === "string" ? params.query.trim().toLowerCase() : "";
					const filtered = query
						? byBook.filter(
								(e) =>
									(e.comment ?? "").toLowerCase().includes(query) ||
									e.content.toLowerCase().includes(query) ||
									e.keys.some((k) => k.toLowerCase().includes(query)),
							)
						: byBook;
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target: this.#host.getTarget(),
						result: { entries: filtered, total: byBook.length },
					};
				}

				case "lorebooks.createEntry": {
					const title = typeof params.title === "string" ? params.title.trim() : "";
					const content = typeof params.content === "string" ? params.content.trim() : "";
					const keys = Array.isArray(params.keys)
						? params.keys.map((k) => String(k).trim()).filter(Boolean)
						: typeof params.keys === "string"
							? params.keys.split(",").map((k) => k.trim()).filter(Boolean)
							: [];
					const constant = typeof params.constant === "boolean" ? params.constant : undefined;
					const book = typeof params.book === "string" && params.book.trim() ? params.book.trim() : undefined;
					if (!title || !content) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "invalid_input", message: "世界书条目需提供非空 title 与 content" },
						};
					}
					const entry = this.#host.getLoreHost().write({ title, keys, content, constant, book });
					return {
						ok: true,
						action,
						requestId,
						status: "committed",
						target: this.#host.getTarget(),
						result: { entry },
					};
				}

				case "lorebooks.updateEntry": {
					const fingerprint = typeof params.fingerprint === "string" ? params.fingerprint.trim() : "";
					if (!fingerprint) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "invalid_input", message: "lorebooks.updateEntry 需要提供 fingerprint" },
						};
					}
					const patch: { title?: string; keys?: string[]; content?: string; constant?: boolean } = {};
					if (typeof params.title === "string") patch.title = params.title.trim();
					if (typeof params.content === "string") patch.content = params.content;
					if (Array.isArray(params.keys)) patch.keys = params.keys.map((k) => String(k).trim()).filter(Boolean);
					if (typeof params.constant === "boolean") patch.constant = params.constant;
					const updated = this.#host.getLoreHost().update(fingerprint, patch);
					if (!updated) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "not_found", message: `未找到指纹为 ${fingerprint} 的世界书条目` },
						};
					}
					return {
						ok: true,
						action,
						requestId,
						status: "committed",
						target: this.#host.getTarget(),
						result: updated,
					};
				}

				case "lorebooks.removeEntry": {
					const fingerprint = typeof params.fingerprint === "string" ? params.fingerprint.trim() : "";
					if (!fingerprint) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "invalid_input", message: "lorebooks.removeEntry 需要提供 fingerprint" },
						};
					}
					const removed = this.#host.getLoreHost().remove(fingerprint);
					if (!removed) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "not_found", message: `未找到指纹为 ${fingerprint} 的世界书条目` },
						};
					}
					return {
						ok: true,
						action,
						requestId,
						status: "committed",
						target: this.#host.getTarget(),
						result: removed,
					};
				}

				case "lorebooks.mount": {
					const path = typeof params.path === "string" ? params.path.trim() : "";
					const mounted = params.mounted !== false;
					if (!path) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "invalid_input", message: "lorebooks.mount 需要提供 path" },
						};
					}
					const nextMounted = this.#host.getLoreHost().mountBook(path, mounted);
					return {
						ok: true,
						action,
						requestId,
						status: "committed",
						target: this.#host.getTarget(),
						result: { mounted: nextMounted },
					};
				}

				case "project.files.list": {
					const chatDir = this.#host.getCurrentChatDir();
					if (!chatDir) {
						return {
							ok: true,
							action,
							requestId,
							status: "completed",
							target: this.#host.getTarget(),
							result: { files: [] },
						};
					}
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target: this.#host.getTarget(),
						result: { files: listChatMarkdownAssets(chatDir) },
					};
				}

				case "project.files.read": {
					const chatDir = this.#host.getCurrentChatDir();
					const rel = typeof params.path === "string" ? params.path.trim().replace(/\\/g, "/") : "";
					if (!chatDir) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "permission_denied", message: "当前会话不在独立项目目录中" },
						};
					}
					if (!rel || isInternalChatWorkspacePath(rel)) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "permission_denied", message: `禁止访问受管或无效路径：${rel || "(空)"}` },
						};
					}
					const full = resolve(chatDir, rel);
					if (!insideRealPath(chatDir, full)) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "permission_denied", message: "路径越出当前项目目录边界" },
						};
					}
					if (!existsSync(full)) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "not_found", message: `项目文件不存在：${rel}` },
						};
					}
					const content = readFileSync(full, "utf8");
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target: this.#host.getTarget(),
						result: { path: rel, content },
					};
				}

				case "project.files.write": {
					const chatDir = this.#host.getCurrentChatDir();
					const rel = typeof params.path === "string" ? params.path.trim().replace(/\\/g, "/") : "";
					const content = typeof params.content === "string" ? params.content : "";
					if (!chatDir) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "permission_denied", message: "当前会话不在独立项目目录中" },
						};
					}
					if (!rel || isInternalChatWorkspacePath(rel)) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "permission_denied", message: `禁止写入受管或无效路径：${rel || "(空)"}` },
						};
					}
					const full = resolve(chatDir, rel);
					if (!insideRealPath(chatDir, full)) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "permission_denied", message: "路径越出当前项目目录边界" },
						};
					}
					mkdirSync(dirname(full), { recursive: true });
					writeFileSync(full, content, "utf8");
					return {
						ok: true,
						action,
						requestId,
						status: "committed",
						target: this.#host.getTarget(),
						result: { path: rel, bytes: Buffer.byteLength(content, "utf8"), files: listChatMarkdownAssets(chatDir) },
					};
				}

				case "project.files.remove": {
					const chatDir = this.#host.getCurrentChatDir();
					const rel = typeof params.path === "string" ? params.path.trim().replace(/\\/g, "/") : "";
					if (!chatDir) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "permission_denied", message: "当前会话不在独立项目目录中" },
						};
					}
					if (!rel || isInternalChatWorkspacePath(rel)) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "permission_denied", message: `禁止删除受管或无效路径：${rel || "(空)"}` },
						};
					}
					const full = resolve(chatDir, rel);
					if (!insideRealPath(chatDir, full)) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "permission_denied", message: "路径越出当前项目目录边界" },
						};
					}
					const existed = existsSync(full);
					if (existed) rmSync(full, { force: true });
					return {
						ok: true,
						action,
						requestId,
						status: "committed",
						target: this.#host.getTarget(),
						result: { path: rel, removed: existed, files: listChatMarkdownAssets(chatDir) },
					};
				}

				case "panels.list": {
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target: this.#host.getTarget(),
						result: { panels: this.#host.getPanels() },
					};
				}

				case "panels.write": {
					const name = typeof params.name === "string" ? params.name.trim() : "";
					const content = typeof params.content === "string" ? params.content : "";
					const kind = typeof params.kind === "string" && params.kind.trim() ? params.kind.trim() : "html";
					if (!name || !content.trim()) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "invalid_input", message: "panels.write 需提供非空 name 与 content" },
						};
					}
					const r = await this.#host.importPanels([{ name, kind, content }]);
					if (r.errors.length > 0 && r.imported === 0) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "execution_failed", message: r.errors.join("；") },
						};
					}
					return {
						ok: true,
						action,
						requestId,
						status: "committed",
						target: this.#host.getTarget(),
						result: { name, kind, panels: this.#host.getPanels() },
					};
				}

				case "panels.close": {
					const name = typeof params.name === "string" ? params.name.trim() : "";
					if (!name) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "invalid_input", message: "panels.close 需提供面板名称" },
						};
					}
					await this.#host.closePanel(name);
					return {
						ok: true,
						action,
						requestId,
						status: "committed",
						target: this.#host.getTarget(),
						result: { closed: name, panels: this.#host.getPanels() },
					};
				}

				case "story.list": {
					const view = this.#host.getStoryView();
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target: this.#host.getTarget(),
						result: {
							files: view.files.map(({ name, title, chars, mtime }) => ({ name, title, chars, mtime })),
						},
					};
				}

				case "story.read": {
					const view = this.#host.getStoryView();
					const name = typeof params.name === "string" ? params.name.trim() : "";
					if (!name) {
						return {
							ok: true,
							action,
							requestId,
							status: "completed",
							target: this.#host.getTarget(),
							result: view,
						};
					}
					const hit = view.files.find((f) => f.name === name);
					if (!hit) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "not_found", message: `未找到正文文件：${name}` },
						};
					}
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target: this.#host.getTarget(),
						result: { file: hit },
					};
				}

				case "story.write": {
					const name = typeof params.name === "string" ? params.name.trim() : "";
					const text = params.text === null ? null : typeof params.text === "string" ? params.text : undefined;
					if (!name || text === undefined) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "invalid_input", message: "story.write 需提供文件名 name 与 text（字符串或 null）" },
						};
					}
					const r = await this.#host.editStoryFile({ name, text });
					return {
						ok: true,
						action,
						requestId,
						status: "refreshed",
						target: this.#host.getTarget(),
						result: r,
					};
				}

				case "worldline.list": {
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target: this.#host.getTarget(),
						result: { worldline: this.#host.getWorldlineView() },
					};
				}

				case "models.list": {
					const models = this.#host.listModels();
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target: this.#host.getTarget(),
						result: models,
					};
				}

				case "text.macros": {
					const rawText = typeof params.text === "string" ? params.text : "";
					const target = this.#host.getTarget();
					const chatDir = this.#host.getCurrentChatDir();
					const msgs = this.#host.getMessages();
					const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1]?.text : undefined;
					const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.text;
					const lastChar = [...msgs].reverse().find((m) => m.role !== "user")?.text;
					const chatFile = scriptDataFilePath(this.#host.cwd, chatDir, target, "chat", scriptId);
					const globalFile = scriptDataFilePath(this.#host.cwd, chatDir, target, "global", scriptId);
					const storedChat = readScriptScopeData(chatFile, "chat");
					const storedGlobal = readScriptScopeData(globalFile, "global");
					const env = createMacroEnv({
						charName: typeof params.charName === "string" ? params.charName : target.charName,
						userName: typeof params.userName === "string" ? params.userName : target.userName,
						userText: typeof params.userText === "string" ? params.userText : lastUser,
						lastMessage: typeof params.lastMessage === "string" ? params.lastMessage : lastMsg,
						lastCharMessage: typeof params.lastCharMessage === "string" ? params.lastCharMessage : lastChar,
						vars: storedChat.data,
						globalVars: storedGlobal.data,
					});
					if (params.vars && typeof params.vars === "object" && !Array.isArray(params.vars)) {
						for (const [k, v] of Object.entries(params.vars as Record<string, unknown>)) {
							env.vars.set(k, typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? ""));
						}
					}
					if (params.globalVars && typeof params.globalVars === "object" && !Array.isArray(params.globalVars)) {
						for (const [k, v] of Object.entries(params.globalVars as Record<string, unknown>)) {
							env.globalVars.set(k, typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? ""));
						}
					}
					const evaluated = evalPresetMacros(applyMacros(rawText, { charName: env.charName, userName: env.userName }), env);
					let persisted = false;
					if (params.persist === true) {
						if (env.dirtyLocal && env.dirtyLocal.size > 0) {
							const nextChat = { ...storedChat.data };
							for (const k of env.dirtyLocal) {
								if (env.vars.has(k)) nextChat[k] = env.vars.get(k);
								else delete nextChat[k];
							}
							writeScriptDataFile(chatFile, nextChat, storedChat.version);
							persisted = true;
						}
						if (env.dirtyGlobal && env.dirtyGlobal.size > 0) {
							const nextGlobal = { ...storedGlobal.data };
							for (const k of env.dirtyGlobal) {
								if (env.globalVars.has(k)) nextGlobal[k] = env.globalVars.get(k);
								else delete nextGlobal[k];
							}
							writeScriptDataFile(globalFile, nextGlobal, storedGlobal.version);
							persisted = true;
						}
					}
					return {
						ok: true,
						action,
						requestId,
						status: persisted ? "committed" : "completed",
						target,
						result: {
							text: evaluated.text,
							unsupported: evaluated.unsupported,
							vars: Object.fromEntries(env.vars.entries()),
							globalVars: Object.fromEntries(env.globalVars.entries()),
							...(params.persist === true ? { persisted } : {}),
						},
					};
				}

				case "text.transform": {
					const rawText = typeof params.text === "string" ? params.text : "";
					const mode = params.mode === "prompt" ? "prompt" : "display";
					const target = this.#host.getTarget();
					let rules: DisplayRule[] = [];
					if (Array.isArray(params.rules)) {
						rules = mode === "prompt" ? promptRules(params.rules) : displayRules(params.rules);
					} else {
						const cfg = this.#host.getConfig();
						const cardAbs = isAbsolute(cfg.card) ? cfg.card : join(this.#host.cwd, cfg.card);
						try {
							const raw = readCardRawJson(cardAbs).raw as Record<string, unknown>;
							const scripts = Array.isArray((raw.data as Record<string, unknown> | undefined)?.extensions && ((raw.data as Record<string, unknown>).extensions as Record<string, unknown>).regex_scripts)
								? (((raw.data as Record<string, unknown>).extensions as Record<string, unknown>).regex_scripts as unknown[])
								: [];
							rules = mode === "prompt" ? promptRules(scripts) : displayRules(scripts);
						} catch {
							rules = [];
						}
					}
					const transformed = applyCardSkin(rawText, rules, {
						charName: target.charName,
						userName: target.userName,
					});
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target,
						result: {
							text: transformed,
							ruleCount: rules.length,
							mode,
						},
					};
				}

				case "text.ejs": {
					const rawCode = typeof params.code === "string" ? params.code : typeof params.text === "string" ? params.text : "";
					const target = this.#host.getTarget();
					if (params.syntaxOnly === true) {
						const errorInfo = getEjsSyntaxErrorInfo(rawCode);
						return {
							ok: true,
							action,
							requestId,
							status: "completed",
							target,
							result: { valid: errorInfo === "", errorInfo },
						};
					}
					const state = this.#host.getState();
					const chatDir = this.#host.getCurrentChatDir();
					const chatVars = readScriptScopeData(scriptDataFilePath(this.#host.cwd, chatDir, target, "chat", scriptId), "chat").data;
					const globalVars = readScriptScopeData(scriptDataFilePath(this.#host.cwd, chatDir, target, "global", scriptId), "global").data;
					const characterVars = readScriptScopeData(scriptDataFilePath(this.#host.cwd, chatDir, target, "character", scriptId), "character").data;

					let allLoreEntries: LorebookEntry[] = [];
					try {
						allLoreEntries = this.#host.getLoreHost().listMarked();
					} catch {
						allLoreEntries = [];
					}
					try {
						const cfg = this.#host.getConfig();
						const cardAbs = isAbsolute(cfg.card) ? cfg.card : join(this.#host.cwd, cfg.card);
						if (existsSync(cardAbs)) {
							const cardObj = loadCardFile(cardAbs);
							if (Array.isArray(cardObj.book) && cardObj.book.length > 0) {
								const seen = new Set(allLoreEntries.map((e) => `${e.comment ?? ""}:${e.uid}`));
								for (const b of cardObj.book) {
									const key = `${b.comment ?? ""}:${b.uid}`;
									if (!seen.has(key)) allLoreEntries.push(b);
								}
							}
						}
					} catch {
						/* ignore */
					}

					const msgs = this.#host.getMessages().map((m) => ({
						role: m.role,
						content: m.text,
						name: m.name,
					}));
					const extra =
						params.context && typeof params.context === "object" && !Array.isArray(params.context)
							? (params.context as Record<string, unknown>)
							: {};
					const ejsCtx = createEjsContext({
						state,
						chatVars,
						globalVars,
						characterVars,
						allLoreEntries,
						charName: target.charName,
						userName: target.userName,
						chatId: target.chatId,
						messages: msgs,
						extra,
					});
					const text = await evalEjsTemplate(rawCode, ejsCtx);
					if (ejsCtx.__modified && state.mvu) {
						await this.#host.applyStatePatch({ mvu: state.mvu });
					}
					return {
						ok: true,
						action,
						requestId,
						status: ejsCtx.__modified ? "committed" : "completed",
						target,
						result: {
							text,
							modified: ejsCtx.__modified,
							variables: ejsCtx.variables,
						},
					};
				}

				case "ui.notify": {
					const level = params.level === "warning" || params.level === "error" ? params.level : "info";
					const text = String(params.text ?? params.message ?? "").trim();
					if (text) this.#host.notify(level, text);
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target: this.#host.getTarget(),
						result: { notified: !!text, level, text },
					};
				}

				case "preset.list": {
					const presetHost = this.#host.getPresetHost?.() ?? createDefaultPresetHost(this.#host.cwd, () => this.#host.getConfig());
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target: this.#host.getTarget(),
						result: presetHost.list(),
					};
				}

				case "preset.get": {
					const presetHost = this.#host.getPresetHost?.() ?? createDefaultPresetHost(this.#host.cwd, () => this.#host.getConfig());
					const name = typeof params.name === "string" ? params.name : undefined;
					const includeRaw = params.includeRaw === true;
					const snap = presetHost.get(name);
					if (!snap) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: {
								code: "not_found",
								message: name && name !== "in_use" ? `未找到预设：${name}` : "当前未配置预设或预设文件不存在",
							},
						};
					}
					const { raw, ...rest } = snap;
					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target: this.#host.getTarget(),
						result: includeRaw ? { ...rest, raw } : rest,
					};
				}

				case "preset.update": {
					if (this.#host.getTarget().streaming) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "busy", message: "正在生成回复，请等待完成或先停止后再修改预设" },
						};
					}
					const patchRaw =
						params.patch && typeof params.patch === "object" && !Array.isArray(params.patch)
							? (params.patch as PresetPatch)
							: (params as PresetPatch);
					const hasPatchContent =
						Array.isArray(patchRaw.blocks) ||
						Array.isArray(patchRaw.add) ||
						Array.isArray(patchRaw.order) ||
						Array.isArray(patchRaw.prompts) ||
						(patchRaw.samplers && typeof patchRaw.samplers === "object") ||
						(patchRaw.extensionsPatch && typeof patchRaw.extensionsPatch === "object");
					if (!hasPatchContent) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "invalid_input", message: "preset.update 至少需提供 blocks / order / prompts / samplers / add / extensionsPatch 之一" },
						};
					}
					const presetHost = this.#host.getPresetHost?.() ?? createDefaultPresetHost(this.#host.cwd, () => this.#host.getConfig());
					if (!presetHost.get("in_use")) {
						return {
							ok: false,
							action,
							requestId,
							target: this.#host.getTarget(),
							error: { code: "not_found", message: "当前未配置活动预设" },
						};
					}
					const targetMode = params.target === "save" ? "save" : "draft";
					const updated = await presetHost.update({ target: targetMode, patch: patchRaw });
					const { raw: _raw, ...snapRest } = updated.snapshot;
					return {
						ok: true,
						action,
						requestId,
						status: updated.refreshed ? "refreshed" : "committed",
						target: this.#host.getTarget(),
						result: {
							...snapRest,
							added: updated.added,
							...(params.includeRaw === true ? { raw: updated.snapshot.raw } : {}),
						},
					};
				}

				case "preset.preview": {
					const materials = loadStageMaterials(this.#host.cwd);
					const presetHost = this.#host.getPresetHost?.() ?? createDefaultPresetHost(this.#host.cwd, () => this.#host.getConfig());
					const requestedName = typeof params.name === "string" && params.name.trim() ? params.name.trim() : undefined;
					let previewPresetDoc = materials.presetDoc;
					if (requestedName && requestedName !== "in_use") {
						const snap = presetHost.get(requestedName);
						if (!snap) {
							return {
								ok: false,
								action,
								requestId,
								target: this.#host.getTarget(),
								error: { code: "not_found", message: `未找到预设：${requestedName}` },
							};
						}
						previewPresetDoc = loadPresetDoc(snap.raw, snap.name);
					}
					const target = this.#host.getTarget();
					const userText = typeof params.userText === "string" ? params.userText : "";
					const macroCtx = { charName: materials.card.name, userName: materials.config.userName };
					const baseHistory: Array<{ role: "user" | "assistant"; text: string }> = [];
					for (const m of this.#host.getMessages()) {
						if (m.role === "system") continue;
						const role = m.role === "user" ? "user" : "assistant";
						let text = (m.text || m.mes || "").trim();
						if (materials.promptRules.length > 0 && text) {
							text = applyCardSkin(text, materials.promptRules, macroCtx).trim();
						}
						if (!text) continue;
						const prev = baseHistory[baseHistory.length - 1];
						if (prev && prev.role === role) prev.text = `${prev.text}\n\n${text}`;
						else baseHistory.push({ role, text });
					}
					if (userText.trim()) {
						const prev = baseHistory[baseHistory.length - 1];
						if (prev && prev.role === "user") prev.text = `${prev.text}\n\n${userText.trim()}`;
						else baseHistory.push({ role: "user", text: userText.trim() });
					}

					const windowText = baseHistory.slice(-Math.max(1, materials.config.scanDepth)).map((m) => m.text).join("\n");
					const activated = scanEntries(materials.entries, windowText, materials.config.maxLoreInjections);

					const relayMeta = extractPresetRelayMeta(previewPresetDoc);
					let effUserRules = materials.userRules;
					let effCardAgents = materials.cardAgents;
					let presetActive = 0;
					let presetDisabled = 0;

					if (previewPresetDoc) {
						const syncedInCard =
							(!requestedName || requestedName === "in_use") &&
							(parsePromptEntries(materials.userRules.card).some((e) => e.source?.kind === "preset") ||
								parsePromptEntries(materials.cardAgentsRaw ?? "").some((e) => e.source?.kind === "preset"));
						if (!syncedInCard) {
							const declAbs = presetDeclarationPath(this.#host.cwd, previewPresetDoc.name);
							let stored: PresetDeclaration | null = null;
							if (existsSync(declAbs)) {
								try {
									stored = JSON.parse(readFileSync(declAbs, "utf8")) as PresetDeclaration;
								} catch {
									stored = null;
								}
							}
							const decl: PresetDeclaration = stored ?? {
								version: 1,
								preset: previewPresetDoc.name,
								createdAt: new Date().toISOString(),
								entries: [],
							};
							const translated = await translatePresetWithDeclarationAsync(previewPresetDoc, decl, macroCtx);
							presetActive = translated.lines.filter((l) => l.action === "append" || l.action === "agents").length;
							presetDisabled = translated.lines.filter((l) => l.action === "disabled").length;
							effUserRules = {
								...materials.userRules,
								card: [stripPresetEntries(materials.userRules.card), renderForModel(translated.appendMarkdown)]
									.filter((s) => s.trim())
									.join("\n\n"),
							};
							effCardAgents = [stripPresetEntries(materials.cardAgents), renderForModel(translated.agentsSection)]
								.filter((s) => s.trim())
								.join("\n\n");
						} else {
							const allPresetEntries = [
								...parsePromptEntries(materials.userRules.card).filter((e) => e.source?.kind === "preset"),
								...parsePromptEntries(materials.cardAgentsRaw ?? "").filter((e) => e.source?.kind === "preset"),
							];
							presetActive = allPresetEntries.filter((e) => e.enabled).length;
							presetDisabled = allPresetEntries.filter((e) => !e.enabled).length;
						}
					}

					const systemPrompt = buildStageSystemPrompt({
						card: materials.card,
						config: materials.config,
						constantLore: constantLoreOf(materials),
						userRules: effUserRules,
						cardAgents: effCardAgents,
						tools: true,
					});
					const injection = buildStageInjection({
						state: defaultState(),
						activatedLore: activated,
						card: materials.card,
						config: materials.config,
						cardAgentsActive: effCardAgents.trim().length > 0,
						loreIndex: formatLoreIndex(materials.entries),
					});
					const endsWithUser = baseHistory[baseHistory.length - 1]?.role === "user";
					const past = endsWithUser ? baseHistory.slice(0, -1) : baseHistory;
					const tailText = endsWithUser ? `${injection}\n\n${baseHistory[baseHistory.length - 1]!.text}` : injection;
					const messages = applyHistoryInjections(past, tailText, [], { tailHasUserMessage: endsWithUser });

					let simulatedPayload: Record<string, unknown> | undefined;
					if (params.simulateRelay === true) {
						const simModel: RelayModelLike = {
							id: typeof params.model === "string" && params.model.trim() ? params.model.trim() : "preview-model",
							provider: typeof params.provider === "string" ? params.provider.trim() : "custom",
							api: typeof params.api === "string" && params.api.trim() ? params.api.trim() : "openai-completions",
							reasoning: params.reasoning === true,
						};

						let rawReq: Record<string, unknown>;
						if (simModel.api === "google-generative-ai" || simModel.api === "google-vertex") {
							rawReq = {
								model: simModel.id,
								contents: messages.map((m) => ({
									role: m.role === "assistant" ? "model" : "user",
									parts: [{ text: m.text }],
								})),
								config: systemPrompt.trim() ? { systemInstruction: systemPrompt } : {},
							};
						} else {
							rawReq = {
								model: simModel.id,
								messages: [
									...(systemPrompt.trim() ? [{ role: "system", content: systemPrompt }] : []),
									...messages.map((m) => ({ role: m.role, content: m.text })),
								],
								tools: [],
							};
						}
						const basePolicy = materials.config.relayPolicy ?? {};
						const simPolicy = {
							...basePolicy,
							...(params.contextPackMode === "off" ||
							params.contextPackMode === "auto" ||
							params.contextPackMode === "tool-desc"
								? { contextPackMode: params.contextPackMode }
								: {}),
							...(params.antiRouteShield === "off" ||
							params.antiRouteShield === "head" ||
							params.antiRouteShield === "deep" ||
							params.antiRouteShield === "scramble"
								? { antiRouteShield: params.antiRouteShield }
								: {}),
							...(typeof params.googleSafetyOnOpenAi === "boolean"
								? { googleSafetyOnOpenAi: params.googleSafetyOnOpenAi }
								: {}),
						};
						simulatedPayload =
							applyRelayPayload(rawReq, simModel, {
								policy: simPolicy,
								presetMeta: relayMeta,
							}) ?? rawReq;
					}

					const simTools = simulatedPayload
						? Array.isArray(simulatedPayload.tools)
							? (simulatedPayload.tools as Array<{ name?: unknown; function?: { name?: unknown; description?: unknown }; description?: unknown }>)
							: Array.isArray((simulatedPayload.config as { tools?: unknown[] } | undefined)?.tools)
								? (((simulatedPayload.config as { tools?: Array<{ functionDeclarations?: Array<{ name?: unknown; description?: unknown }> }> }).tools ?? []).flatMap((g) => g.functionDeclarations ?? []))
								: []
						: [];
					const carrier = simTools.find((t) => (t.function?.name ?? t.name) === "liyuan_context_reference");
					const carrierDesc = typeof carrier?.function?.description === "string"
						? carrier.function.description
						: typeof carrier?.description === "string"
							? carrier.description
							: "";
					const msgsSource = simulatedPayload
						? Array.isArray(simulatedPayload.messages)
							? simulatedPayload.messages
							: Array.isArray(simulatedPayload.contents)
								? simulatedPayload.contents
								: []
						: [];
					const relayStats = simulatedPayload
						? {
								packedIntoToolDescription: Boolean(carrier),
								carrierToolChars: carrierDesc.length,
								messagesChars: JSON.stringify(msgsSource).length,
							}
						: undefined;

					return {
						ok: true,
						action,
						requestId,
						status: "completed",
						target,
						result: {
							preset: previewPresetDoc?.name ?? null,
							systemPrompt,
							messages,
							samplers: previewPresetDoc?.samplers ?? materials.config.samplers ?? null,
							relayMeta,
							...(simulatedPayload ? { simulatedPayload } : {}),
							...(relayStats ? { relayStats } : {}),
							stats: { mode: "markdown-declared", activeEntries: presetActive, disabledEntries: presetDisabled },
						},
					};
				}

				default:
					return {
						ok: false,
						action,
						requestId,
						target: this.#host.getTarget(),
						error: {
							code: "unsupported_action",
							message: `未开放或未知的脚本接口操作：${action || "(空)"}`,
						},
					};
			}
		} catch (err) {
			return {
				ok: false,
				action,
				requestId,
				target: this.#host.getTarget(),
				error: {
					code: "execution_failed",
					message: err instanceof Error ? err.message : String(err),
				},
			};
		}
	}
}
