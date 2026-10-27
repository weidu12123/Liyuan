/**
 * 梨园 Agent 配置体系：
 * - 仓库 liyuan-profiles/*.json：配置文件保管（生成/改/删，默认不启用）
 * - 当前启用 app/liyuan.agent.json：运行中的 Agent 配置（由「启用」写入）
 * - 同步到 runtime 的路径是实现细节，不对用户暴露
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const AGENT_CONFIG_FILE = "liyuan.agent.json";
export const PROFILES_DIR = "liyuan-profiles";
export const ACTIVE_META_FILE = "liyuan.agent.meta.json";

/**
 * 单模型条目：id 必填，其余字段原样保留。
 * `thinkingLevels` 记录用户在编辑器中勾选的该模型支持的思考档位列表（如 `["off", "low", "high"]`），
 * `thinkingLevel` 记录该模型当前默认/选中的档位。
 */
export type AgentModelEntry = {
	id: string;
	label?: string;
	thinkingLevel?: string;
	thinkingLevels?: string[];
} & Record<string, unknown>;

/**
 * 条目身份：用户起的名，没起就用 id。provider 内唯一。
 * 剧情模型与旁路模型都按这个键指向条目——**不要再按 id 找条目**，同 id 会有多条。
 */
export function modelEntryKey(m: AgentModelEntry): string {
	const label = typeof m.label === "string" ? m.label.trim() : "";
	return label || m.id;
}

/** 按条目身份取条目；找不到返回 undefined */
export function findModelEntry(models: AgentModelEntry[] | undefined, key: string): AgentModelEntry | undefined {
	return (models ?? []).find((m) => modelEntryKey(m) === key);
}

/** 渠道（provider）档案 */
export type AgentProvider = {
	baseUrl?: string;
	api?: string;
	apiKey?: string;
	models?: AgentModelEntry[];
} & Record<string, unknown>;

/** 完整 Agent 配置（连接板块的配置文件本体） */
export interface LiyuanAgentConfig {
	version: 1;
	/** 默认渠道名（providers 键） */
	defaultProvider?: string;
	/** 默认模型 id */
	defaultModel?: string;
	/**
	 * 剧情模型指向哪条**条目**（modelEntryKey）。与 defaultModel 并存而不是取代它：
	 * defaultModel 会被投影进 settings.json 给运行时用，那里只认模型 id；
	 * 而同一个 id 可能有多条条目，「是哪条」只能记在这个梨园侧的字段上。
	 */
	defaultModelEntry?: string;
	/** 默认思考档 */
	defaultThinkingLevel?: string;
	shellPath?: string;
	skills?: string[];
	enableSkillCommands?: boolean;
	/** 渠道表 */
	providers: Record<string, AgentProvider>;
}

export const EMPTY_AGENT_CONFIG = (): LiyuanAgentConfig => ({
	version: 1,
	providers: {},
});

export function agentConfigPath(cwd: string): string {
	return join(cwd, AGENT_CONFIG_FILE);
}

function writeJsonBackup(path: string, data: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	if (existsSync(path)) copyFileSync(path, `${path}.bak`);
	writeFileSync(path, `${JSON.stringify(data, null, "\t")}\n`, "utf8");
}

export function normalizeModelEntry(m: unknown): AgentModelEntry | null {
	if (typeof m === "string") {
		const id = m.trim();
		return id ? { id } : null;
	}
	if (!m || typeof m !== "object" || Array.isArray(m)) return null;
	const obj = m as Record<string, unknown>;
	const id = typeof obj.id === "string" ? obj.id.trim() : "";
	if (!id) return null;
	const label = typeof obj.label === "string" ? obj.label.trim() : "";
	// 空 label 不留键：条目身份回落 id，配置文件里也就看不到一个没用的空字段
	const out: AgentModelEntry = { ...obj, id };
	if (label) out.label = label;
	else delete out.label;
	if (Array.isArray(obj.thinkingLevels)) {
		const levels = [
			...new Set(
				obj.thinkingLevels
					.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
					.map((x) => x.trim()),
			),
		];
		if (levels.length > 0) out.thinkingLevels = levels;
		else delete out.thinkingLevels;
	}
	return out;
}

export function normalizeModels(list: unknown): AgentModelEntry[] {
	if (!Array.isArray(list)) return [];
	const out: AgentModelEntry[] = [];
	for (const m of list) {
		const e = normalizeModelEntry(m);
		if (e) out.push(e);
	}
	return out;
}

/**
 * 合并同一条目的新旧字段（用户手改的 compat / thinkingLevelMap / cost 等不被覆盖丢失）。
 * **按条目身份配对，不按 id**——同 id 可以有多条条目，按 id 配对会把「flash high」的字段
 * 灌进「flash off」里。
 */
export function mergeModelEntries(existing: AgentModelEntry[] | undefined, incoming: AgentModelEntry[]): AgentModelEntry[] {
	const prev = new Map((existing ?? []).map((m) => [modelEntryKey(m), m]));
	return incoming.map((m) => {
		const old = prev.get(modelEntryKey(m));
		return old ? { ...old, ...m, id: m.id } : m;
	});
}

export function keyMeta(apiKey: unknown): {
	hasKey: boolean;
	keyKind: "none" | "literal" | "env" | "command" | "placeholder";
} {
	if (typeof apiKey !== "string" || !apiKey) return { hasKey: false, keyKind: "none" };
	if (apiKey === "placeholder") return { hasKey: false, keyKind: "placeholder" };
	if (apiKey.startsWith("!")) return { hasKey: true, keyKind: "command" };
	if (apiKey.startsWith("$")) return { hasKey: true, keyKind: "env" };
	return { hasKey: true, keyKind: "literal" };
}

/** 宽松解析：保证 version=1、providers 对象；未知顶栏字段保留 */
export function normalizeAgentConfig(raw: unknown): LiyuanAgentConfig {
	const base = EMPTY_AGENT_CONFIG();
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
	const obj = raw as Record<string, unknown>;
	const providersIn =
		obj.providers && typeof obj.providers === "object" && !Array.isArray(obj.providers)
			? (obj.providers as Record<string, unknown>)
			: {};
	const providers: Record<string, AgentProvider> = {};
	for (const [name, p] of Object.entries(providersIn)) {
		if (!p || typeof p !== "object" || Array.isArray(p)) continue;
		const pr = p as Record<string, unknown>;
		providers[name] = {
			...pr,
			models: normalizeModels(pr.models),
		};
	}
	const str = (k: string) => (typeof obj[k] === "string" ? (obj[k] as string) : undefined);
	const bool = (k: string) => (typeof obj[k] === "boolean" ? (obj[k] as boolean) : undefined);
	return {
		...base,
		...obj,
		version: 1,
		defaultProvider: str("defaultProvider"),
		defaultModel: str("defaultModel"),
		defaultModelEntry: str("defaultModelEntry"),
		defaultThinkingLevel: str("defaultThinkingLevel"),
		shellPath: str("shellPath"),
		skills: Array.isArray(obj.skills) ? obj.skills.filter((x): x is string => typeof x === "string") : undefined,
		enableSkillCommands: bool("enableSkillCommands"),
		providers,
	};
}

export function loadAgentConfig(cwd: string): { path: string; exists: boolean; config: LiyuanAgentConfig } {
	const path = agentConfigPath(cwd);
	const exists = existsSync(path);
	if (!exists) return { path, exists: false, config: EMPTY_AGENT_CONFIG() };
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return { path, exists: true, config: normalizeAgentConfig(raw) };
	} catch {
		return { path, exists: true, config: EMPTY_AGENT_CONFIG() };
	}
}

export function saveAgentConfig(cwd: string, config: LiyuanAgentConfig): void {
	const path = agentConfigPath(cwd);
	const normalized = normalizeAgentConfig(config);
	writeJsonBackup(path, normalized);
}

/**
 * 条目表 → 运行时模型清单：**按 id 收成一条，取第一条**。
 *
 * 梨园这边一个模型可以有多条条目（同 id、不同思考档），但 models.json 是运行时的模型清单，
 * 那里一个 id 只能是一个模型：同 id 两条进去，`mergeCustomModels`
 * （packages/coding-agent/src/core/model-registry.ts:487-498）会让后一条**整体顶掉**前一条
 * ——不是按字段合并，前一条独有的字段直接没了；连 headers 都会被独立地覆盖/删掉（:742-745）。
 * 所以投影时必须先收干净，别把这种歧义丢给运行时。
 *
 * 字段一个都不删（含 thinkingLevel）：models.json 里 `thinkingLevel` 这个键**存在与否**决定了
 * 运行时把模型标成 reasoning 与否（model-registry.ts:664-668 的梨园补丁），删了等于关死思考。
 * 条目之间思考档的差异不靠这里表达——那是梨园侧调用时自己传的 reasoning。
 */
export function modelsForRuntime(models: AgentModelEntry[]): AgentModelEntry[] {
	const seen = new Set<string>();
	const out: AgentModelEntry[] = [];
	for (const m of models) {
		if (seen.has(m.id)) continue;
		seen.add(m.id);
		const copy: AgentModelEntry = { ...m };
		if (!("thinkingLevel" in copy) && Array.isArray(copy.thinkingLevels) && copy.thinkingLevels.length > 0) {
			copy.thinkingLevel = copy.thinkingLevels.find((lv) => lv !== "off") ?? copy.thinkingLevels[0];
		}
		out.push(copy);
	}
	return out;
}

/**
 * 旁路条目 → 运行时模型：把**条目自己**的 thinkingLevelMap 盖到运行时模型上。
 *
 * 为什么需要这一层：`modelsForRuntime` 按 id 收敛（同 id 多条只留第一条），而
 * 「同 id、不同思考档」的各条目恰恰把差异（`thinkingLevelMap: {"off": "none"}`）
 * 写在后几条上——投影后全丢了。运行时拿到的是第一条的裸模型，`reasoning: "off"`
 * 到底层会被折成 undefined（packages/ai/src/api/openai-completions.ts:747），
 * 于是请求里连 reasoning_effort 都不发，服务端按自己的默认继续思考。
 *
 * 纯函数：不动入参，没有 map 时原样返回同一个对象。
 */
export function applyEntryThinkingMap<M extends { thinkingLevelMap?: Record<string, unknown> }>(
	base: M,
	entry?: AgentModelEntry | null,
): M {
	const map = entry?.thinkingLevelMap;
	if (!map || typeof map !== "object" || Array.isArray(map)) return base;
	return {
		...base,
		thinkingLevelMap: { ...(base.thinkingLevelMap ?? {}), ...(map as Record<string, unknown>) },
	};
}

/**
 * 把梨园 Agent 配置投影到 runtime 读取的文件（实现细节）。
 * - providers → agentDir/models.json（模型清单按 id 收敛，见 modelsForRuntime）
 * - 默认模型/思考/shell/skills → 项目 .liyuan/settings.json（合并）
 * - 默认模型/思考 → agentDir/settings.json（合并，影响全局默认）
 */
export function syncAgentConfigToRuntime(cwd: string, agentDir: string, config: LiyuanAgentConfig): void {
	const cfg = normalizeAgentConfig(config);

	// providers → models.json
	const runtimeProviders: Record<string, AgentProvider> = {};
	for (const [name, p] of Object.entries(cfg.providers)) {
		runtimeProviders[name] = { ...p, models: modelsForRuntime(normalizeModels(p.models)) };
	}
	writeJsonBackup(join(agentDir, "models.json"), { providers: runtimeProviders });

	const patchSettings = (path: string, fields: Record<string, unknown>) => {
		let cur: Record<string, unknown> = {};
		if (existsSync(path)) {
			try {
				cur = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
			} catch {
				cur = {};
			}
		}
		const next = { ...cur };
		for (const [k, v] of Object.entries(fields)) {
			if (v === undefined) continue;
			next[k] = v;
		}
		writeJsonBackup(path, next);
	};

	const projectSettings: Record<string, unknown> = {};
	if (cfg.defaultModel) projectSettings.defaultModel = cfg.defaultModel;
	if (cfg.defaultProvider) projectSettings.defaultProvider = cfg.defaultProvider;
	if (cfg.defaultThinkingLevel) projectSettings.defaultThinkingLevel = cfg.defaultThinkingLevel;
	if (cfg.shellPath) projectSettings.shellPath = cfg.shellPath;
	if (cfg.skills) projectSettings.skills = cfg.skills;
	if (cfg.enableSkillCommands !== undefined) projectSettings.enableSkillCommands = cfg.enableSkillCommands;
	if (Object.keys(projectSettings).length > 0) {
		patchSettings(join(cwd, ".liyuan", "settings.json"), projectSettings);
	}

	const globalSettings: Record<string, unknown> = {};
	if (cfg.defaultModel) globalSettings.defaultModel = cfg.defaultModel;
	if (cfg.defaultProvider) globalSettings.defaultProvider = cfg.defaultProvider;
	if (cfg.defaultThinkingLevel) globalSettings.defaultThinkingLevel = cfg.defaultThinkingLevel;
	if (Object.keys(globalSettings).length > 0) {
		patchSettings(join(agentDir, "settings.json"), globalSettings);
	}
}

export function publicProvider(name: string, p: AgentProvider) {
	const { apiKey, ...rest } = p;
	const km = keyMeta(apiKey);
	const models = normalizeModels(p.models);
	return {
		name,
		...rest,
		...km,
		models,
		modelCount: models.length,
		modelIds: models.map((m) => m.id),
	};
}

/**
 * 从运行时快照生成一条渠道，写入 Agent 配置真源。
 * apiKey 必须是配置文件里的实值（或用户显式填写），禁止写 $ENV 引用——Agent 只读自己的配置文件。
 */
export function seedProviderFromRuntime(input: {
	provider: string;
	baseUrl?: string;
	api?: string;
	/** 明文 key（已从环境解析好的实值）；缺省则 placeholder */
	apiKey?: string;
	models: Array<{
		id: string;
		name?: string;
		reasoning?: boolean;
		contextWindow?: number;
		maxTokens?: number;
		[key: string]: unknown;
	}>;
}): AgentProvider {
	const models: AgentModelEntry[] = input.models.map((m) => {
		const e: AgentModelEntry = { ...m, id: m.id };
		// 清理 undefined 值
		for (const k of Object.keys(e)) {
			if (e[k] === undefined || e[k] === null) delete e[k];
		}
		return e;
	});
	const p: AgentProvider = { models };
	if (input.baseUrl) p.baseUrl = input.baseUrl;
	if (input.api) p.api = input.api;
	const key = (input.apiKey ?? "").trim();
	p.apiKey = key && !key.startsWith("$") ? key : key.startsWith("$") ? resolveEnvApiKey(key) || "placeholder" : "placeholder";
	return p;
}

/** 解析 $VAR / ${VAR}；非 $ 开头原样返回 */
export function resolveEnvApiKey(apiKey: string): string | undefined {
	const k = apiKey.trim();
	if (!k || k === "placeholder") return undefined;
	if (k.startsWith("!")) return undefined;
	if (k.startsWith("$")) {
		const name = k.slice(1).replace(/^\{|\}$/g, "");
		const v = process.env[name];
		return v?.trim() || undefined;
	}
	return k;
}

/**
 * 把配置里残留的 $ENV 引用收成明文（一次性正本清源）。
 * 返回是否发生了改写。
 */
export function materializeEnvKeysInConfig(config: LiyuanAgentConfig): boolean {
	let changed = false;
	for (const p of Object.values(config.providers)) {
		if (typeof p.apiKey !== "string") continue;
		if (!p.apiKey.startsWith("$") && !p.apiKey.startsWith("!")) continue;
		const resolved = resolveEnvApiKey(p.apiKey);
		if (resolved) {
			p.apiKey = resolved;
			changed = true;
		}
	}
	return changed;
}

// ---------- 配置仓库（profiles）----------

export interface AgentProfileRecord {
	/** 仓库 id（文件名 slug） */
	id: string;
	/** 显示名 */
	name: string;
	updatedAt: number;
	/** 完整 Agent 配置内容 */
	config: LiyuanAgentConfig;
}

export interface AgentProfileListItem {
	id: string;
	name: string;
	updatedAt: number;
	active: boolean;
	providerKeys: string[];
	modelCount: number;
	defaultProvider?: string;
	defaultModel?: string;
	hasKey: boolean;
}

function profilesDir(cwd: string): string {
	return join(cwd, PROFILES_DIR);
}

function profilePath(cwd: string, id: string): string {
	return join(profilesDir(cwd), `${id}.json`);
}

function activeMetaPath(cwd: string): string {
	return join(cwd, ACTIVE_META_FILE);
}

export function loadActiveProfileId(cwd: string): string | null {
	const p = activeMetaPath(cwd);
	if (!existsSync(p)) return null;
	try {
		const j = JSON.parse(readFileSync(p, "utf8")) as { activeId?: string };
		return typeof j.activeId === "string" && j.activeId ? j.activeId : null;
	} catch {
		return null;
	}
}

export function saveActiveProfileId(cwd: string, activeId: string | null): void {
	writeJsonBackup(activeMetaPath(cwd), { activeId });
}

/** 合法 id：字母数字 . - _ */
export function sanitizeProfileId(raw: string): string {
	const s = raw
		.trim()
		.replace(/[\\/:*?"<>|\s]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!s || !/^[\w.-]+$/.test(s)) throw new Error("配置名只允许字母数字与 . - _");
	return s;
}

export function loadProfile(cwd: string, id: string): AgentProfileRecord | null {
	const path = profilePath(cwd, id);
	if (!existsSync(path)) return null;
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		const config = normalizeAgentConfig(raw.config ?? raw);
		const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id;
		const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now();
		return { id, name, updatedAt, config };
	} catch {
		return null;
	}
}

export function saveProfile(cwd: string, id: string, name: string, config: LiyuanAgentConfig): AgentProfileRecord {
	const safeId = sanitizeProfileId(id);
	const dir = profilesDir(cwd);
	mkdirSync(dir, { recursive: true });
	const record = {
		id: safeId,
		name: name.trim() || safeId,
		updatedAt: Date.now(),
		config: normalizeAgentConfig(config),
	};
	writeJsonBackup(profilePath(cwd, safeId), record);
	return record;
}

export function deleteProfile(cwd: string, id: string): void {
	const path = profilePath(cwd, id);
	if (!existsSync(path)) throw new Error(`配置不存在：${id}`);
	unlinkSync(path);
	if (loadActiveProfileId(cwd) === id) saveActiveProfileId(cwd, null);
}

/**
 * 彻底从 profile 仓库中清除指定的渠道，防止后续聚合时复活已删除的渠道
 */
export function deleteChannelFromProfiles(cwd: string, channelName: string): void {
	const safeName = sanitizeProfileId(channelName);
	const list = listProfiles(cwd);
	for (const item of list) {
		const rec = loadProfile(cwd, item.id);
		if (!rec) continue;
		let touched = false;
		if (rec.config.providers && rec.config.providers[channelName]) {
			delete rec.config.providers[channelName];
			touched = true;
		}
		const remaining = Object.keys(rec.config.providers ?? {});
		if (remaining.length === 0 || item.id === channelName || item.id === safeName) {
			try {
				deleteProfile(cwd, item.id);
			} catch {
				/* ignore */
			}
		} else if (touched) {
			saveProfile(cwd, item.id, rec.name, rec.config);
		}
	}
	for (const candidate of [channelName, safeName]) {
		try {
			deleteProfile(cwd, candidate);
		} catch {
			/* ignore */
		}
	}
}

export function listProfiles(cwd: string): AgentProfileListItem[] {
	const dir = profilesDir(cwd);
	const activeId = loadActiveProfileId(cwd);
	if (!existsSync(dir)) return [];
	const out: AgentProfileListItem[] = [];
	for (const f of readdirSync(dir)) {
		if (!f.endsWith(".json")) continue;
		const id = f.replace(/\.json$/i, "");
		const rec = loadProfile(cwd, id);
		if (!rec) continue;
		const providers = rec.config.providers ?? {};
		const keys = Object.keys(providers);
		let modelCount = 0;
		let hasKey = false;
		for (const p of Object.values(providers)) {
			modelCount += normalizeModels(p.models).length;
			const km = keyMeta(p.apiKey);
			if (km.hasKey) hasKey = true;
		}
		out.push({
			id: rec.id,
			name: rec.name,
			updatedAt: rec.updatedAt,
			active: activeId === rec.id,
			providerKeys: keys,
			modelCount,
			defaultProvider: rec.config.defaultProvider,
			defaultModel: rec.config.defaultModel,
			hasKey,
		});
	}
	out.sort((a, b) => Number(b.active) - Number(a.active) || b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
	return out;
}

/** 启用仓库中的配置 → 写入当前 Agent 配置并同步 runtime */
export function enableProfile(cwd: string, agentDir: string, id: string): LiyuanAgentConfig {
	const rec = loadProfile(cwd, id);
	if (!rec) throw new Error(`配置不存在：${id}`);
	const config = normalizeAgentConfig(rec.config);
	materializeEnvKeysInConfig(config);
	// 合并磁盘上已有的模型字段（用户手改的 compat / thinkingLevelMap / cost 等不被覆盖丢失）
	const onDisk = loadAgentConfig(cwd).config;
	for (const [name, provider] of Object.entries(config.providers)) {
		const diskProvider = onDisk.providers[name];
		if (diskProvider && Array.isArray(diskProvider.models) && Array.isArray(provider.models)) {
			provider.models = mergeModelEntries(diskProvider.models, provider.models);
		}
	}
	saveAgentConfig(cwd, config);
	syncAgentConfigToRuntime(cwd, agentDir, config);
	saveActiveProfileId(cwd, id);
	return config;
}

/**
 * 合并一个渠道下因旧版切档而拆成多条 `#2` 的同 id 模型条目，将其档位归并进第一条的 `thinkingLevels`。
 */
export function consolidateProviderModels(models: AgentModelEntry[]): { models: AgentModelEntry[]; changed: boolean } {
	const out: AgentModelEntry[] = [];
	let changed = false;
	for (const m of models) {
		const isAutoDup = typeof m.label === "string" && new RegExp(`^${m.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+#\\d+$`).test(m.label.trim());
		const primary = out.find((x) => x.id === m.id && !x.label);
		if (isAutoDup && primary) {
			const set = new Set<string>(primary.thinkingLevels ?? []);
			const pLv = typeof primary.thinkingLevel === "string" ? primary.thinkingLevel.trim() : "";
			const mLv = typeof m.thinkingLevel === "string" ? m.thinkingLevel.trim() : "";
			if (pLv) set.add(pLv);
			if (mLv) set.add(mLv);
			if (set.size > 0 && !set.has("off")) set.add("off");
			primary.thinkingLevels = [...set];
			if (!primary.contextWindow && m.contextWindow) primary.contextWindow = m.contextWindow;
			if (!primary.maxTokens && m.maxTokens) primary.maxTokens = m.maxTokens;
			changed = true;
			continue;
		}
		const copy: AgentModelEntry = { ...m };
		const lv = typeof copy.thinkingLevel === "string" ? copy.thinkingLevel.trim() : "";
		if (!Array.isArray(copy.thinkingLevels) || copy.thinkingLevels.length === 0) {
			if (lv && lv !== "off") {
				copy.thinkingLevels = ["off", lv];
				changed = true;
			} else if (lv === "off") {
				copy.thinkingLevels = ["off"];
				changed = true;
			}
		}
		out.push(copy);
	}
	return { models: out, changed };
}

/**
 * 聚合迁移：把 `liyuan-profiles/*.json` 中所有渠道合并进 `liyuan.agent.json.providers`，
 * 使所有已配置渠道同时在线供 pi 聚合切换（不再每次只启用单渠道），并归并同 id 的 `#2` 档位条目。
 */
export function mergeProfilesIntoActiveConfig(cwd: string): { merged: boolean; providers: string[] } {
	const list = listProfiles(cwd);
	const loaded = loadAgentConfig(cwd);
	const cfg = loaded.config;
	let changed = false;
	const added: string[] = [];
	for (const item of list) {
		const rec = loadProfile(cwd, item.id);
		if (!rec) continue;
		for (const [pname, pval] of Object.entries(rec.config.providers ?? {})) {
			if (!cfg.providers[pname]) {
				cfg.providers[pname] = pval;
				changed = true;
				added.push(pname);
			}
		}
		if (!cfg.defaultProvider && rec.config.defaultProvider) {
			cfg.defaultProvider = rec.config.defaultProvider;
			cfg.defaultModel = rec.config.defaultModel;
			cfg.defaultThinkingLevel = rec.config.defaultThinkingLevel;
			changed = true;
		}
		if (!cfg.shellPath && rec.config.shellPath) {
			cfg.shellPath = rec.config.shellPath;
			changed = true;
		}
	}
	for (const [pname, prov] of Object.entries(cfg.providers)) {
		const res = consolidateProviderModels(normalizeModels(prov.models));
		if (res.changed) {
			cfg.providers[pname] = { ...prov, models: res.models };
			changed = true;
		}
	}
	if (changed) {
		saveAgentConfig(cwd, cfg);
	}
	return { merged: changed, providers: added };
}

/**
 * 把当前 liyuan.agent.json 拆进仓库（若仓库为空）。
 * 每个 provider 存成一份配置；active = defaultProvider 对应那份。
 */
export function migrateActiveConfigIntoProfiles(cwd: string): { migrated: boolean; ids: string[] } {
	if (listProfiles(cwd).length > 0) return { migrated: false, ids: [] };
	const { exists, config } = loadAgentConfig(cwd);
	if (!exists || Object.keys(config.providers).length === 0) return { migrated: false, ids: [] };

	const ids: string[] = [];
	const extras = {
		shellPath: config.shellPath,
		skills: config.skills,
		enableSkillCommands: config.enableSkillCommands,
	};
	for (const [pname, provider] of Object.entries(config.providers)) {
		const id = sanitizeProfileId(pname);
		const models = normalizeModels(provider.models);
		const cfg: LiyuanAgentConfig = {
			version: 1,
			...extras,
			defaultProvider: pname,
			defaultModel: models[0]?.id ?? config.defaultModel,
			defaultThinkingLevel:
				(typeof models[0]?.thinkingLevel === "string" && models[0].thinkingLevel) ||
				config.defaultThinkingLevel,
			providers: { [pname]: provider },
		};
		saveProfile(cwd, id, pname, cfg);
		ids.push(id);
	}
	const active =
		(config.defaultProvider && ids.includes(sanitizeProfileId(config.defaultProvider))
			? sanitizeProfileId(config.defaultProvider)
			: ids[0]) ?? null;
	if (active) {
		saveActiveProfileId(cwd, active);
		const rec = loadProfile(cwd, active);
		if (rec) {
			saveAgentConfig(cwd, rec.config);
		}
	}
	return { migrated: true, ids };
}
