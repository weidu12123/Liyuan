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

/** 单模型条目：id 必填，其余字段原样保留 */
export type AgentModelEntry = { id: string } & Record<string, unknown>;

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
	return { ...obj, id };
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

export function mergeModelsById(existing: AgentModelEntry[] | undefined, incoming: AgentModelEntry[]): AgentModelEntry[] {
	const prev = new Map((existing ?? []).map((m) => [m.id, m]));
	return incoming.map((m) => {
		const old = prev.get(m.id);
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
 * 把梨园 Agent 配置投影到 runtime 读取的文件（实现细节）。
 * - providers → agentDir/models.json
 * - 默认模型/思考/shell/skills → 项目 .liyuan/settings.json（合并）
 * - 默认模型/思考 → agentDir/settings.json（合并，影响全局默认）
 */
export function syncAgentConfigToRuntime(cwd: string, agentDir: string, config: LiyuanAgentConfig): void {
	const cfg = normalizeAgentConfig(config);

	// providers → models.json
	writeJsonBackup(join(agentDir, "models.json"), { providers: cfg.providers });

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
	}>;
}): AgentProvider {
	const models: AgentModelEntry[] = input.models.map((m) => {
		const e: AgentModelEntry = { id: m.id };
		if (m.name) e.name = m.name;
		if (m.reasoning) e.reasoning = true;
		if (m.contextWindow) e.contextWindow = m.contextWindow;
		if (m.maxTokens) e.maxTokens = m.maxTokens;
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
	saveAgentConfig(cwd, config);
	syncAgentConfigToRuntime(cwd, agentDir, config);
	saveActiveProfileId(cwd, id);
	return config;
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
