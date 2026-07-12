/**
 * REST 层（PLAN-PHASE3 §4）：面板 CRUD 走 /api/*，请求-响应形态；流内容继续走 WS wire。
 *
 * D3 纪律：本模块零 pi import——凡需要触碰 pi 的操作（模型/凭据/会话重载/换卡/命令），
 * 通过 main.ts 注入的 RestHost 接口（纯平面类型）完成；本模块自己只做
 * HTTP 路由 + liyuan.config.json / liyuan-preset.json / 世界书 / 角色卡的领域层文件操作。
 *
 * 写入纪律（PLAN-PHASE3 §4）：写 liyuan.config.json / 预设前先备份 .bak；
 * 触发会话重载的写操作在流式中一律拒绝（409）。
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, isAbsolute, join } from "node:path";

import {
	EMPTY_AGENT_CONFIG,
	deleteProfile,
	enableProfile,
	listProfiles,
	loadAgentConfig,
	loadProfile,
	materializeEnvKeysInConfig,
	mergeModelsById,
	migrateActiveConfigIntoProfiles,
	normalizeAgentConfig,
	normalizeModels,
	publicProvider,
	saveAgentConfig,
	saveProfile,
	seedProviderFromRuntime,
	syncAgentConfigToRuntime,
	type AgentModelEntry,
	type AgentProvider,
	type LiyuanAgentConfig,
} from "../src/agent-config.ts";
import {
	addCardGreeting,
	deleteCardGreeting,
	exportCardFile,
	loadCardFile,
	moveCardGreeting,
	remapGreetingIndexAfterMove,
	setCardGreetings,
	updateCardFields,
	updateCardGreeting,
	type CardExportLoreMode,
	type CardFieldPatch,
} from "../src/card.ts";
import {
	appendCodexEntry,
	createCodex,
	deleteCodexEntry,
	findCodex,
	listCodexes,
	loadCodexEntries,
	userEntryToCodexInput,
} from "../src/codex.ts";
import { RP_COMMANDS } from "../src/commands.ts";
import { resolveConfigPath } from "../src/paths.ts";
import type { WorldlineView } from "../src/worldline.ts";
import {
	applyDisabledLore,
	exportStLorebook,
	loadLorebookFile,
	loreFingerprint,
	mergeEntries,
	mountedLorebookPaths,
	normalizeEntries,
	overlayPathFor,
	patchLorebookFileEntry,
	searchEntries,
	setMountedLorebooks,
	type LoreEntryPatch,
} from "../src/lorebook.ts";
import {
	clearPersonaAvatar,
	createPersona,
	deletePersona,
	findPersona,
	loadPersonas,
	personaForCard,
	savePersonaAvatar,
	savePersonas,
	updatePersona,
	type Persona,
} from "../src/personas.ts";
import { convertStPreset, normalizeRpPreset, type RpPreset } from "../src/preset.ts";
import {
	allocateServerId,
	discoverMcpCatalog,
	getMcpHub,
	loadMcpConfig,
	probeMcpServer,
	saveMcpConfig,
	sanitizeServerId,
	setDefaultEnabled,
	validateServerConfig,
	type McpServerConfig,
} from "../src/mcp.ts";
import { listSkills, saveSkill } from "../src/skills.ts";
import { DEFAULT_CONFIG, type LorebookEntry, type RpConfig } from "../src/types.ts";
import { readJsonFile } from "../src/jsonio.ts";
import { formatBytes, listMedia, listUploads, saveUpload } from "../src/uploads.ts";

// ---------- 宿主接口（由 main.ts 实现；纯平面类型，pi 止步于 main） ----------

export interface CurrentModelInfo {
	provider: string;
	id: string;
	name: string;
	thinkingLevel: string;
	availableLevels: string[];
}

export interface ModelInfo {
	provider: string;
	providerName: string;
	id: string;
	name: string;
	reasoning: boolean;
	/** 支持图片输入（上传图片可被该模型看见） */
	vision: boolean;
	contextWindow: number;
}

export interface AuthProviderInfo {
	provider: string;
	displayName: string;
	/** 已写入 auth.json（可「移除已存 key」） */
	configured: boolean;
	/**
	 * 当前是否真正可用（stored / 环境变量已设 / runtime key 等）。
	 * 注意：pi 的 getAuthStatus().configured 对「仅环境变量」恒为 false，
	 * 列表展示必须以 ready 为准，否则 DeepSeek 等会沉进「未配置」。
	 */
	ready: boolean;
	/** 凭据来源（stored/environment/models_json_key…） */
	source?: string;
	/** 环境变量名等提示（如 DEEPSEEK_API_KEY） */
	label?: string;
	modelCount: number;
}

/** 运行时渠道快照（用于空配置时收编当前正在用的渠道） */
export interface ProviderRuntimeSnapshot {
	provider: string;
	baseUrl?: string;
	api?: string;
	/** 环境变量名（无 $），如 DEEPSEEK_API_KEY */
	envKey?: string;
	models: Array<{
		id: string;
		name?: string;
		reasoning?: boolean;
		contextWindow?: number;
		maxTokens?: number;
	}>;
}

export interface RestHost {
	cwd: string;
	isStreaming(): boolean;
	listModels(): { current: CurrentModelInfo | null; models: ModelInfo[] };
	selectModel(provider: string, id: string): Promise<CurrentModelInfo>;
	setThinkingLevel(level: string): CurrentModelInfo;
	authProviders(): AuthProviderInfo[];
	setAuthKey(provider: string, key: string): void;
	removeAuth(provider: string): void;
	/** runtime agent 目录（同步用，不对用户暴露） */
	agentDir(): string;
	/** 取某 provider 的运行时模型/端点快照 */
	providerSnapshot(provider: string): ProviderRuntimeSnapshot | null;
	refreshModels(): void;
	/** 会话重载（session_start 重放，素材重装）+ 服务端显示名刷新 + 全端对齐 */
	reloadSession(): Promise<void>;
	/**
	 * 热更新：扩展内重读 config/卡/世界书/预设并重建 system prompt，不 session.reload。
	 * 用于切身份、改 user 设定、挂载世界书等——ST 式即时生效。
	 */
	softRefreshConfig(): Promise<void>;
	/** config.card 已写盘后调用：切到该卡最近会话，无则新建 */
	switchToCard(): Promise<"switched" | "created">;
	/** 经会话通道执行斜杠命令（/import 等，扩展的 notify 会以 wire notify 推送） */
	promptCommand(text: string): Promise<void>;
	/** 排队执行斜杠命令（不等待完成；流式中自动排到本轮结束）。返回是否进入了排队 */
	queueCommand(text: string): boolean;
	/** 面板导入（柱 2 liyuan-panels 格式）：逐条领域层校验写入当前会话，返回成功数/成功名单/逐条错误 */
	importPanels(list: Array<{ name?: unknown; kind?: unknown; content?: unknown }>): {
		imported: number;
		names: string[];
		errors: string[];
	};
	/** 当前剧情分支上挂载的知识库名（会话树 rp-codex 快照，随 rewind/fork 走） */
	mountedCodexes(): string[];
	// ---- 会话管理（PLAN-PANELS §2.1，main.ts 实现） ----
	sessions(): Promise<SessionInfoLite[]>;
	renameSession(path: string, name: string): Promise<void>;
	deleteSession(path: string): Promise<void>;
	readSessionFile(path: string): Promise<string>;
	searchSessions(q: string): Promise<SessionSearchHit[]>;
	/** 世界状态用户主权编辑（applyPatch 语义，落盘+树快照经命令桥） */
	applyStatePatch(patch: Record<string, unknown>): { applied: string[]; warnings: string[] };
	notify(level: "info" | "warning" | "error", text: string): void;
	/** 世界线时间线视图（会话树 rp-save + 旁路 meta） */
	worldlineView(): import("../src/worldline.ts").WorldlineView;
	/** 软删除存档节点 */
	deleteWorldlineSave(saveId: string): void;
	/** 重命名世界线（自动名可改） */
	renameWorldline(worldlineId: string, name: string): void;
	/** 文生音并写入会话（气泡「配音」/ REST） */
	ttsSpeak(text: string, caption?: string): Promise<{ src: string; bytes: number }>;
}

export interface SessionInfoLite {
	path: string;
	id: string;
	name?: string;
	firstMessage: string;
	modified: number;
	messageCount: number;
	current: boolean;
	preview?: string;
	cardName?: string;
}

export interface SessionSearchHit {
	path: string;
	name?: string;
	firstMessage: string;
	modified: number;
	messageCount: number;
	snippet: string;
	current: boolean;
}

// ---------- 基础工具 ----------

const MAX_BODY = 32 * 1024 * 1024; // ST 聊天记录/预设上传上限 32MB
const MAX_UPLOAD = 64 * 1024 * 1024; // 上传区文件上限 64MB

function readBodyRaw(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => {
			size += c.length;
			if (size > maxBytes) {
				reject(new Error("请求体过大"));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

function readBody(req: IncomingMessage): Promise<string> {
	return readBodyRaw(req, MAX_BODY).then((b) => b.toString("utf8"));
}

function sendJson(res: ServerResponse, code: number, obj: unknown): void {
	res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(obj));
}

const resolvePath = (cwd: string, p: string) => (isAbsolute(p) ? p : join(cwd, p));

/** 带 .bak 备份的 JSON 写盘（tab 缩进，与手写配置一致） */
function writeJsonWithBackup(path: string, data: unknown): void {
	if (existsSync(path)) copyFileSync(path, `${path}.bak`);
	writeFileSync(path, JSON.stringify(data, null, "\t") + "\n", "utf8");
}

// ---------- 配置读写 ----------

const configPath = (cwd: string) => resolveConfigPath(cwd);

function loadConfig(cwd: string): RpConfig {
	const p = configPath(cwd);
	if (!existsSync(p)) return { ...DEFAULT_CONFIG };
	const raw = { ...DEFAULT_CONFIG, ...(JSON.parse(readFileSync(p, "utf8")) as Partial<RpConfig>) };
	// 规范化：旧 lorebook 单本 → lorebooks 数组
	return setMountedLorebooks(raw, mountedLorebookPaths(raw));
}

/** config PUT 白名单（card 不在内：换卡必须走 /api/card/switch 的完整流程） */
const CONFIG_EDITABLE = new Set([
	"userName",
	"userPersona",
	"displayName",
	"language",
	"scanDepth",
	"maxLoreInjections",
	"greeting",
	"greetingIndex",
	"importStripTags",
	"lorebook",
	"lorebooks",
	"preset",
	"disabledLore",
	"backendControl",
	"creationMode",
]);

function applyConfigPatch(config: RpConfig, patch: Record<string, unknown>): RpConfig {
	const next = { ...config } as Record<string, unknown>;
	for (const [k, v] of Object.entries(patch)) {
		if (!CONFIG_EDITABLE.has(k)) continue;
		if (v === null || v === undefined || v === "") {
			delete next[k]; // 空值 = 删除可选键（displayName/lorebook/preset 等）
		} else {
			next[k] = v;
		}
	}
	// 必填字段兜底
	if (typeof next.userName !== "string" || !next.userName) next.userName = DEFAULT_CONFIG.userName;
	if (typeof next.language !== "string" || !next.language) next.language = DEFAULT_CONFIG.language;
	next.scanDepth = clampInt(next.scanDepth, 1, 50, DEFAULT_CONFIG.scanDepth);
	next.maxLoreInjections = clampInt(next.maxLoreInjections, 0, 20, DEFAULT_CONFIG.maxLoreInjections);
	next.greeting = next.greeting === true;
	// 决策门禁档位：只认 ask / silent；非法值删除（扩展缺省按 silent）
	if (next.creationMode !== "ask" && next.creationMode !== "silent") delete next.creationMode;
	// 挂载书：lorebooks 数组优先；兼容旧单本 lorebook
	const paths = mountedLorebookPaths(next as RpConfig);
	Object.assign(next, setMountedLorebooks(next as RpConfig, paths));
	return next as unknown as RpConfig;
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
	const n = typeof v === "number" ? Math.round(v) : Number.parseInt(String(v), 10);
	if (!Number.isFinite(n)) return dflt;
	return Math.min(max, Math.max(min, n));
}

// ---------- 世界书（服务端只读副本，与扩展同一装配路径） ----------

export type LoreSource = "card" | "file" | "agent";

/**
 * 世界书装配：已挂载独立书（0..N 本）+ agent 补充设定集。
 * 卡内 character_book **不**自动进上下文——须导入为独立书并挂载（config.lorebooks）。
 * 角色卡与世界书解耦：换卡不改挂载列表。
 * source：file=挂载书 / agent=补充设定。
 */
function loadMergedLoreWithSource(
	cwd: string,
	config: RpConfig,
): {
	entries: LorebookEntry[];
	sourceOf: (e: LorebookEntry) => LoreSource;
	cardName: string;
	paths: string[];
} {
	const card = loadCardFile(resolvePath(cwd, config.card));
	const paths = mountedLorebookPaths(config);
	const fileGroups: LorebookEntry[][] = [];
	for (const rel of paths) {
		const abs = resolvePath(cwd, rel);
		if (existsSync(abs)) fileGroups.push(loadLorebookFile(abs));
	}
	const fileEntries = mergeEntries(...fileGroups);
	const overlayPath = overlayPathFor(cwd, card.name);
	const overlayEntries = existsSync(overlayPath) ? loadLorebookFile(overlayPath) : [];
	const fileSet = new Set(fileEntries.map((e) => e.content.trim()));
	const entries = applyDisabledLore(mergeEntries(fileEntries, overlayEntries), config.disabledLore);
	const sourceOf = (e: LorebookEntry): LoreSource => (fileSet.has(e.content.trim()) ? "file" : "agent");
	return { entries, sourceOf, cardName: card.name, paths };
}

function loadMergedLore(cwd: string, config: RpConfig): LorebookEntry[] {
	return loadMergedLoreWithSource(cwd, config).entries;
}

/**
 * 导出用活跃世界书：挂载书 + 补充设定 + 卡原内嵌（指纹去重）+ 用户停用清单。
 * 即「改过角色卡/世界书之后」的创作态，便于分享回 ST / 再导入梨园。
 */
function collectActiveLoreForExport(cwd: string, config: RpConfig): LorebookEntry[] {
	const card = loadCardFile(resolvePath(cwd, config.card));
	const { entries: active } = loadMergedLoreWithSource(cwd, config);
	return applyDisabledLore(mergeEntries(active, card.book), config.disabledLore);
}

const previewText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

// ---------- 卡库（PLAN-PANELS §2.7）：扫描候选目录，卡头信息按 mtime 缓存 ----------

const cardMetaCache = new Map<string, { mtimeMs: number; meta: { name: string; tags: string[] } | null }>();

/** 卡库扫描目录：assets/cards + 当前卡所在目录（用户素材常在项目外） */
function cardDirSpecs(cwd: string, config: RpConfig): Array<{ abs: string; relBase: string }> {
	const specs = [{ abs: join(cwd, "assets", "cards"), relBase: "assets/cards" }];
	const cardRel = config.card.replace(/\\/g, "/");
	const base = cardRel.includes("/") ? cardRel.slice(0, cardRel.lastIndexOf("/")) : ".";
	const abs = resolvePath(cwd, base);
	if (!specs.some((s) => s.abs === abs)) specs.push({ abs, relBase: base });
	return specs;
}

interface CardLibItem {
	path: string;
	name: string;
	tags: string[];
	isPng: boolean;
	mtimeMs: number;
}

function listCardLibrary(cwd: string, config: RpConfig): CardLibItem[] {
	const out: CardLibItem[] = [];
	for (const spec of cardDirSpecs(cwd, config)) {
		if (!existsSync(spec.abs)) continue;
		for (const f of readdirSync(spec.abs)) {
			if (!/\.(png|json)$/i.test(f)) continue;
			const abs = join(spec.abs, f);
			let mtimeMs = 0;
			try {
				mtimeMs = statSync(abs).mtimeMs;
			} catch {
				continue;
			}
			const cached = cardMetaCache.get(abs);
			let meta = cached && cached.mtimeMs === mtimeMs ? cached.meta : undefined;
			if (meta === undefined) {
				try {
					const c = loadCardFile(abs);
					// 卡名为空视为非角色卡（同目录常混有预设等其他 JSON）
					meta = c.name.trim() ? { name: c.name, tags: c.tags } : null;
				} catch {
					meta = null;
				}
				cardMetaCache.set(abs, { mtimeMs, meta });
			}
			if (!meta) continue;
			out.push({ path: `${spec.relBase}/${f}`, name: meta.name, tags: meta.tags, isPng: /\.png$/i.test(f), mtimeMs });
		}
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

/** 校验 query 里的卡路径确属卡库（一切卡文件读操作的门），返回绝对路径 */
function assertLibraryCard(cwd: string, config: RpConfig, relPath: string): string {
	const item = listCardLibrary(cwd, config).find((c) => c.path === relPath);
	if (!item) throw new Error("不是卡库中的角色卡");
	return resolvePath(cwd, relPath);
}

// 卡收藏（借鉴 ST favorites）：独立小文件，不动 rp.config（免会话重载）
const favsPath = (cwd: string) => join(cwd, ".liyuan-cache", "card-favs.json");

function loadFavs(cwd: string): string[] {
	try {
		const j = JSON.parse(readFileSync(favsPath(cwd), "utf8")) as unknown;
		return Array.isArray(j) ? j.filter((x): x is string => typeof x === "string") : [];
	} catch {
		return [];
	}
}

function saveFavs(cwd: string, favs: string[]): void {
	mkdirSync(join(cwd, ".liyuan-cache"), { recursive: true });
	writeFileSync(favsPath(cwd), `${JSON.stringify(favs, null, "\t")}\n`, "utf8");
}

// ---------- 梨园 Agent 配置（liyuan.agent.json 真源；同步 runtime 为实现细节） ----------

/** 读配置；若 providers 为空且会话有当前模型，自动收编一条渠道并落盘（标准化测试遗留） */
function loadProjectAgentExtras(cwd: string): {
	shellPath?: string;
	skills?: string[];
	enableSkillCommands?: boolean;
} {
	try {
		const ps = JSON.parse(readFileSync(join(cwd, ".liyuan", "settings.json"), "utf8")) as Record<string, unknown>;
		return {
			shellPath: typeof ps.shellPath === "string" ? ps.shellPath : undefined,
			skills: Array.isArray(ps.skills) ? ps.skills.filter((x): x is string => typeof x === "string") : undefined,
			enableSkillCommands: typeof ps.enableSkillCommands === "boolean" ? ps.enableSkillCommands : undefined,
		};
	} catch {
		return {};
	}
}

function loadOrSeedAgentConfig(host: RestHost): { path: string; exists: boolean; config: LiyuanAgentConfig; seeded: boolean } {
	// 仓库为空时，把当前启用配置拆进仓库（迁移）
	const mig = migrateActiveConfigIntoProfiles(host.cwd);
	if (mig.migrated) {
		host.notify("info", `已建立配置仓库：${mig.ids.join("、")}`);
	}

	const loaded = loadAgentConfig(host.cwd);

	// 已有配置：把残留 $ENV 收成配置文件明文（Agent 只读自己的配置文件）
	if (Object.keys(loaded.config.providers).length > 0) {
		const cfg = loaded.config;
		if (materializeEnvKeysInConfig(cfg)) {
			saveAgentConfig(host.cwd, cfg);
			syncAgentConfigToRuntime(host.cwd, host.agentDir(), cfg);
			host.refreshModels();
			return { path: loaded.path, exists: true, config: cfg, seeded: false };
		}
		return { ...loaded, seeded: false };
	}

	const { current } = host.listModels();
	if (!current) return { ...loaded, seeded: false };
	const snap = host.providerSnapshot(current.provider);
	if (!snap || snap.models.length === 0) return { ...loaded, seeded: false };

	const extras = loadProjectAgentExtras(host.cwd);
	// key 写入配置文件本身：一次性从环境取实值写入，之后不再依赖环境变量
	const apiKey =
		(snap.envKey && process.env[snap.envKey]?.trim()) ||
		(current.provider === "deepseek" ? process.env.DEEPSEEK_API_KEY?.trim() : undefined) ||
		undefined;

	const provider = seedProviderFromRuntime({
		provider: snap.provider,
		baseUrl: snap.baseUrl,
		api: snap.api,
		apiKey,
		models: snap.models,
	});
	const config: LiyuanAgentConfig = {
		version: 1,
		defaultProvider: current.provider,
		defaultModel: current.id,
		defaultThinkingLevel: current.thinkingLevel,
		...extras,
		providers: { [snap.provider]: provider },
	};
	saveAgentConfig(host.cwd, config);
	syncAgentConfigToRuntime(host.cwd, host.agentDir(), config);
	host.refreshModels();
	return { path: loaded.path, exists: true, config, seeded: true };
}

function persistAgentConfig(host: RestHost, config: LiyuanAgentConfig): LiyuanAgentConfig {
	const normalized = normalizeAgentConfig(config);
	saveAgentConfig(host.cwd, normalized);
	syncAgentConfigToRuntime(host.cwd, host.agentDir(), normalized);
	host.refreshModels();
	return normalized;
}

function resolveProbeKey(apiKey?: string): string | undefined {
	if (!apiKey || apiKey === "placeholder") return undefined;
	if (apiKey.startsWith("$")) {
		const name = apiKey.slice(1).replace(/^\{|\}$/g, "");
		const v = process.env[name];
		return v || undefined;
	}
	if (apiKey.startsWith("!")) return undefined; // 命令取 key：探测跳过
	return apiKey;
}

async function probeModelsEndpoint(
	baseUrl: string,
	apiKey?: string,
): Promise<{ ok: boolean; status: number; detail: string; ids: string[] }> {
	const url = `${baseUrl.replace(/\/+$/, "")}/models`;
	const headers: Record<string, string> = {};
	const resolved = resolveProbeKey(apiKey);
	if (resolved) headers.authorization = `Bearer ${resolved}`;
	try {
		const r = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
		if (!r.ok) {
			return { ok: false, status: r.status, detail: (await r.text()).slice(0, 300) || `HTTP ${r.status}`, ids: [] };
		}
		const json = (await r.json()) as {
			data?: Array<{ id?: unknown; name?: unknown }>;
			models?: Array<{ id?: unknown; name?: unknown }>;
		};
		const list = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];
		const ids = list.map((m) => String(m.id ?? m.name ?? "").trim()).filter(Boolean);
		return {
			ok: true,
			status: r.status,
			detail: ids.length
				? `连通（HTTP ${r.status}，${ids.length} 个模型）`
				: `连通（HTTP ${r.status}，模型清单为空）`,
			ids,
		};
	} catch (e) {
		return { ok: false, status: 0, detail: e instanceof Error ? e.message : String(e), ids: [] };
	}
}

// ---------- 多预设管理（PLAN-PANELS-V2 §2.6：assets/presets/ 存多份，config.preset 指向当前） ----------

const PRESETS_DIR = "assets/presets";

const presetSlug = (name: string) => name.trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "preset";

/** 预设路径白名单：历史单文件 liyuan-preset.json 或 assets/presets/ 顶层 .json */
function validatePresetPath(p: string): string {
	const norm = p.replace(/\\/g, "/");
	if (norm === "liyuan-preset.json") return norm;
	const base = norm.startsWith(`${PRESETS_DIR}/`) ? norm.slice(PRESETS_DIR.length + 1) : "";
	if (!base || base.includes("/") || base.includes("..") || !base.endsWith(".json")) throw new Error("非法预设路径");
	return norm;
}

function listPresetFiles(cwd: string): Array<{ file: string; name: string }> {
	const out: Array<{ file: string; name: string }> = [];
	const readName = (abs: string): string | null => {
		try {
			return normalizeRpPreset(JSON.parse(readFileSync(abs, "utf8"))).name;
		} catch {
			return null;
		}
	};
	const legacy = join(cwd, "liyuan-preset.json");
	if (existsSync(legacy)) {
		const name = readName(legacy);
		if (name !== null) out.push({ file: "liyuan-preset.json", name });
	}
	const dir = join(cwd, PRESETS_DIR);
	if (existsSync(dir)) {
		for (const f of readdirSync(dir)) {
			if (!f.endsWith(".json")) continue;
			const name = readName(join(dir, f));
			if (name !== null) out.push({ file: `${PRESETS_DIR}/${f}`, name });
		}
	}
	return out;
}

// ---------- 世界书文件管理（PLAN-PANELS-V2 §2.3：选书/导入/删除） ----------

const LOREBOOKS_DIR = "assets/lorebooks";

/** 世界书扫描目录：assets/lorebooks + 各挂载书所在目录（用户素材常在项目外） */
function lorebookDirSpecs(cwd: string, config: RpConfig): Array<{ abs: string; relBase: string }> {
	const specs = [{ abs: join(cwd, LOREBOOKS_DIR), relBase: LOREBOOKS_DIR }];
	for (const rel of mountedLorebookPaths(config)) {
		const base = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ".";
		const abs = resolvePath(cwd, base);
		if (!specs.some((s) => s.abs === abs)) specs.push({ abs, relBase: base });
	}
	return specs;
}

const lorebookMetaCache = new Map<string, { mtimeMs: number; count: number | null; displayName: string }>();

function listLorebookFiles(cwd: string, config: RpConfig): Array<{ path: string; name: string; entryCount: number }> {
	const out: Array<{ path: string; name: string; entryCount: number }> = [];
	for (const spec of lorebookDirSpecs(cwd, config)) {
		if (!existsSync(spec.abs)) continue;
		for (const f of readdirSync(spec.abs)) {
			if (!f.endsWith(".json")) continue;
			const abs = join(spec.abs, f);
			let mtimeMs = 0;
			try {
				mtimeMs = statSync(abs).mtimeMs;
			} catch {
				continue;
			}
			const cached = lorebookMetaCache.get(abs);
			// Prefer JSON `name` over bare filename — zip tools (Windows Compress-Archive)
			// often corrupt non-ASCII filenames while leaving UTF-8 content intact.
			let displayName = f.replace(/\.json$/i, "");
			let count: number | null;
			if (cached && cached.mtimeMs === mtimeMs) {
				count = cached.count;
				displayName = cached.displayName || displayName;
			} else {
				try {
					const raw = readJsonFile(abs) as Record<string, unknown>;
					const entries = normalizeEntries(raw.entries);
					count = entries.length > 0 ? entries.length : null; // 0 条=不是世界书（同目录常混有卡/预设）
					if (typeof raw.name === "string" && raw.name.trim()) {
						displayName = raw.name.trim();
					}
				} catch {
					count = null;
				}
				lorebookMetaCache.set(abs, { mtimeMs, count, displayName });
			}
			if (count === null) continue;
			out.push({ path: `${spec.relBase}/${f}`, name: displayName, entryCount: count });
		}
	}
	return out;
}

// ---------- persona 投影（PLAN-PANELS-V2 §2.5：config.userName/userPersona=当前 persona 的镜像） ----------

function projectPersonaToConfig(cwd: string, p: Persona): void {
	const config = loadConfig(cwd) as unknown as Record<string, unknown>;
	config.userName = p.name;
	config.userPersona = p.persona;
	writeJsonWithBackup(configPath(cwd), config);
}

// ---------- 路由 ----------

/** /api/* 请求处理；非 /api 路径返回 false 交回静态托管 */
export async function handleApiRequest(req: IncomingMessage, res: ServerResponse, host: RestHost): Promise<boolean> {
	const url = (req.url ?? "/").split("?")[0];
	if (!url.startsWith("/api/")) return false;
	const query = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
	const route = `${req.method} ${url}`;

	/** 触发会话重载/切换的写操作在流式中拒绝 */
	const refuseWhileStreaming = (): boolean => {
		if (!host.isStreaming()) return false;
		sendJson(res, 409, { error: "正在生成回复，请稍候（或先停止）再操作" });
		return true;
	};

	try {
		switch (route) {
			// ---- 命令清单（输入框补全用；单一来源 src/commands.ts） ----
			case "GET /api/commands": {
				sendJson(res, 200, { commands: RP_COMMANDS });
				return true;
			}
			// ---- 命令桥（agent 自操作 / 脚本化入口；PLAN-PHASE3 §6.3 三入口之一） ----
			case "POST /api/command": {
				const body = JSON.parse(await readBody(req)) as { text?: string };
				const text = (body.text ?? "").trim();
				const m = /^\/(\w+)(?:\s|$)/.exec(text);
				if (!m || !RP_COMMANDS.some((c) => c.name === m[1])) {
					throw new Error(`不是可用命令：${text.slice(0, 40)}（可用：${RP_COMMANDS.map((c) => `/${c.name}`).join(" ")}）`);
				}
				const queued = host.queueCommand(text);
				sendJson(res, 200, { ok: true, queued, note: queued ? "生成中：已排队到本轮结束执行" : "已提交执行" });
				return true;
			}

			// ---- 文生音（气泡配音 / 脚本） ----
			case "POST /api/tts": {
				const body = JSON.parse(await readBody(req)) as { text?: string; caption?: string };
				const text = (body.text ?? "").trim();
				if (!text) throw new Error("缺少 text");
				const r = await host.ttsSpeak(text, body.caption?.trim() || undefined);
				sendJson(res, 200, { ok: true, ...r });
				return true;
			}

			// ---- 世界线（存档时间线） ----
			case "GET /api/worldline": {
				sendJson(res, 200, host.worldlineView() satisfies WorldlineView);
				return true;
			}
			case "POST /api/worldline/delete-save": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { saveId?: string };
				const saveId = (body.saveId ?? "").trim();
				if (!saveId) throw new Error("缺少 saveId");
				host.deleteWorldlineSave(saveId);
				sendJson(res, 200, { ok: true, view: host.worldlineView() });
				return true;
			}
			case "POST /api/worldline/rename": {
				const body = JSON.parse(await readBody(req)) as { worldlineId?: string; name?: string };
				const worldlineId = (body.worldlineId ?? "").trim();
				const name = (body.name ?? "").trim();
				if (!worldlineId || !name) throw new Error("需要 worldlineId 与 name");
				host.renameWorldline(worldlineId, name);
				sendJson(res, 200, { ok: true, view: host.worldlineView() });
				return true;
			}

			// ---- 上传区（附件随消息模型）：原始字节直传，文件名走 query（免 multipart 解析依赖）。
			// 不触碰会话：流式中也允许（agent 下一轮注入的【上传文件】速览自然可见）
			case "POST /api/upload": {
				const rawName = (query.get("name") ?? "").trim();
				if (!rawName) throw new Error("缺少 name（URL 编码的原始文件名）");
				const data = await readBodyRaw(req, MAX_UPLOAD);
				if (data.length === 0) throw new Error("文件内容为空");
				const saved = saveUpload(host.cwd, rawName, data);
				sendJson(res, 200, { ok: true, file: saved.file, bytes: saved.bytes, size: formatBytes(saved.bytes) });
				return true;
			}
			case "GET /api/uploads": {
				const map = (u: { file: string; name: string; bytes: number; mtimeMs: number }) => ({
					file: u.file,
					name: u.name,
					size: formatBytes(u.bytes),
					mtimeMs: u.mtimeMs,
				});
				sendJson(res, 200, {
					/** 我的上传：.liyuan-uploads/ */
					uploads: listUploads(host.cwd).map(map),
					/** 本地图片：.liyuan-media/（AI show_image 等） */
					media: listMedia(host.cwd).map(map),
				});
				return true;
			}
			case "DELETE /api/uploads": {
				const file = query.get("file") ?? "";
				// 只许删 .liyuan-uploads/ 或 .liyuan-media/ 顶层文件
				let base = "";
				let dir = "";
				if (file.startsWith(".liyuan-uploads/") || file.startsWith(".rp-uploads/")) {
					base = file.replace(/^\.(liyuan|rp)-uploads\//, "");
					dir = ".liyuan-uploads";
				} else if (file.startsWith(".liyuan-media/") || file.startsWith(".rp-media/")) {
					base = file.replace(/^\.(liyuan|rp)-media\//, "");
					dir = ".liyuan-media";
				}
				if (!dir || !base || base.includes("/") || base.includes("\\") || base.includes("..")) {
					throw new Error("非法路径");
				}
				const abs = join(host.cwd, dir, base);
				if (!existsSync(abs)) throw new Error("文件不存在");
				unlinkSync(abs);
				sendJson(res, 200, { ok: true });
				return true;
			}

			// ---- 知识库（柱 3）：面板只读展示 + 挂载状态；建库/挂载/写入经由对话（agent 是入口） ----
			case "GET /api/codex": {
				const mounted = new Set(host.mountedCodexes());
				sendJson(res, 200, {
					mounted: [...mounted],
					codexes: listCodexes(host.cwd).map((c) => ({
						name: c.name,
						description: c.description,
						entryCount: c.entryCount,
						mounted: mounted.has(c.name),
					})),
				});
				return true;
			}
			case "GET /api/codex/entries": {
				const name = query.get("name") ?? "";
				const entries = loadCodexEntries(host.cwd, name);
				if (!entries) throw new Error(`知识库不存在：${name}`);
				sendJson(res, 200, {
					entries: entries.map((e) => ({
						fingerprint: loreFingerprint(e.content),
						/** 前端主标题：名字 */
						name: e.comment || e.keys[0] || "（未命名）",
						comment: e.comment,
						keys: e.keys,
						constant: e.constant,
						/** 前端正文：信息 */
						content: e.content,
						chars: e.content.length,
					})),
				});
				return true;
			}
			/**
			 * 用户添加条目：只收 name（名字）+ info（信息），后端译为标准 lore 条目
			 * （comment/keys/content；keys 从名字自动派生，可被检索）。
			 */
			case "POST /api/codex/entries": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as {
					codex?: string;
					name?: string;
					info?: string;
					/** 兼容旧字段 / agent 同形 */
					title?: string;
					content?: string;
					keys?: string[];
				};
				const codexName = (body.codex ?? "").trim();
				if (!codexName) throw new Error("缺少知识库名 codex");
				const title = (body.name ?? body.title ?? "").trim();
				const info = (body.info ?? body.content ?? "").trim();
				if (!title) throw new Error("名字不能为空");
				if (!info) throw new Error("信息不能为空");
				const input = userEntryToCodexInput(
					title,
					info,
					Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === "string") : undefined,
				);
				const r = appendCodexEntry(host.cwd, codexName, input);
				if (!r.ok) throw new Error(r.error);
				if (!r.entry) {
					sendJson(res, 200, { ok: true, duplicate: true, fingerprint: loreFingerprint(input.content) });
					return true;
				}
				if (host.mountedCodexes().some((n) => n.toLowerCase() === codexName.toLowerCase())) {
					await host.reloadSession();
				}
				host.notify("info", `已写入「${codexName}」：${r.entry.comment}`);
				sendJson(res, 200, {
					ok: true,
					duplicate: false,
					fingerprint: loreFingerprint(r.entry.content),
					name: r.entry.comment,
				});
				return true;
			}
			case "DELETE /api/codex/entries": {
				if (refuseWhileStreaming()) return true;
				const codexName = (query.get("codex") ?? query.get("name") ?? "").trim();
				const fp = (query.get("fp") ?? query.get("fingerprint") ?? "").trim();
				if (!codexName) throw new Error("缺少知识库名");
				if (!fp) throw new Error("缺少条目 fingerprint");
				const r = deleteCodexEntry(host.cwd, codexName, fp);
				if (!r.ok) throw new Error(r.error);
				if (!r.removed) throw new Error("条目不存在（可能已删除）");
				if (host.mountedCodexes().some((n) => n.toLowerCase() === codexName.toLowerCase())) {
					await host.reloadSession();
				}
				host.notify("info", `已从「${codexName}」删除一条`);
				sendJson(res, 200, { ok: true });
				return true;
			}
			// 导出知识库为世界书 JSON（公开格式，可互通酒馆等；柱 3）
			case "GET /api/codex/export": {
				const name = query.get("name") ?? "";
				const entries = loadCodexEntries(host.cwd, name);
				if (!entries) throw new Error(`知识库不存在：${name}`);
				sendJson(res, 200, { name, json: exportStLorebook(name, entries) });
				return true;
			}

			// ---- 技能库：面板只读展示 + /skill:name 显式触发（触发经会话通道，同输入框打命令） ----
			case "GET /api/skills": {
				sendJson(res, 200, {
					skills: listSkills(host.cwd).map((s) => ({
						name: s.name,
						description: s.description,
						file: s.file,
						disableModelInvocation: s.disableModelInvocation === true,
					})),
				});
				return true;
			}
			case "GET /api/skills/content": {
				const file = query.get("file") ?? "";
				const base = file.startsWith(".liyuan-skills/") ? file.slice(".liyuan-skills/".length) : "";
				if (!base || base.includes("/") || base.includes("\\") || base.includes("..") || !base.endsWith(".md")) {
					throw new Error("非法路径");
				}
				const abs = join(host.cwd, ".liyuan-skills", base);
				if (!existsSync(abs)) throw new Error("技能文件不存在");
				sendJson(res, 200, { content: readFileSync(abs, "utf8") });
				return true;
			}
			// 技能写入/更新（PLAN-PANELS §2.6）：同名覆盖=更新，frontmatter 由 saveSkill 统一生成
			case "POST /api/skills": {
				const body = JSON.parse(await readBody(req)) as {
					name?: string;
					description?: string;
					content?: string;
					disableModelInvocation?: boolean;
				};
				const name = (body.name ?? "").trim();
				const content = (body.content ?? "").trim();
				if (!name) throw new Error("缺少技能名");
				if (!content) throw new Error("技能内容为空");
				const r = saveSkill(host.cwd, {
					name,
					description: (body.description ?? "").trim(),
					content,
					disableModelInvocation: body.disableModelInvocation === true,
				});
				sendJson(res, 200, { ok: true, ...r, note: "system prompt 里的技能索引在下次会话重载时更新" });
				return true;
			}
			case "DELETE /api/skills": {
				const file = query.get("file") ?? "";
				const base = file.startsWith(".liyuan-skills/") ? file.slice(".liyuan-skills/".length) : "";
				if (!base || base.includes("/") || base.includes("\\") || base.includes("..") || !base.endsWith(".md")) {
					throw new Error("非法路径");
				}
				const abs = join(host.cwd, ".liyuan-skills", base);
				if (!existsSync(abs)) throw new Error("技能文件不存在");
				unlinkSync(abs);
				sendJson(res, 200, { ok: true });
				return true;
			}

			// ---- MCP 外设（柱 4）：多源发现 + 本对话开关 + 项目手写 + 探测 ----
			case "GET /api/mcp": {
				const hub = getMcpHub(host.cwd);
				const catalog = discoverMcpCatalog(host.cwd);
				const statuses = hub.statusList();
				// hub 尚未 session_start 时 sessionEnabled 为空：仍展示目录，enabled 全 false
				const byId = new Map(statuses.map((s) => [s.id, s]));
				const servers = catalog.map((e) => {
					const st = byId.get(e.id);
					if (st) return st;
					return {
						id: e.id,
						name: e.name,
						enabled: false,
						defaultEnabled: e.enabled,
						transport: e.transport,
						status: "disconnected" as const,
						tools: [],
						summary:
							e.transport === "stdio"
								? `${e.command ?? ""} ${(e.args ?? []).join(" ")}`.trim()
								: (e.url ?? ""),
						source: e.source,
						sources: e.sources,
						discovered: e.discovered,
					};
				});
				const project = loadMcpConfig(host.cwd);
				sendJson(res, 200, {
					servers,
					sessionEnabled: hub.getSessionEnabled(),
					// 项目手写条目（编辑表单回填）
					config: project.servers,
					// 发现摘要（调试/面板提示）
					discovered: catalog.length,
				});
				return true;
			}
			case "POST /api/mcp/sync": {
				try {
					await host.promptCommand("/mcpsync");
				} catch {
					// 扩展未装载：仅 hub 侧对账
					const hub = getMcpHub(host.cwd);
					await hub.sync();
				}
				sendJson(res, 200, { ok: true, servers: getMcpHub(host.cwd).statusList() });
				return true;
			}
			// 本对话启用/关闭（agent 绑会话）；可选写入「新对话默认」
			case "POST /api/mcp/enable": {
				const body = JSON.parse(await readBody(req)) as {
					id?: string;
					enabled?: boolean;
					/** true=同时写入项目 defaults，影响之后的新对话 */
					persistDefault?: boolean;
				};
				const id = sanitizeServerId(String(body.id ?? ""));
				if (!id) throw new Error("缺少 id");
				const on = body.enabled === true;
				if (body.persistDefault === true) {
					setDefaultEnabled(host.cwd, id, on);
				}
				try {
					await host.promptCommand(`/mcpset ${id} ${on ? "on" : "off"}`);
				} catch (e) {
					throw new Error(`切换失败：${e instanceof Error ? e.message : String(e)}`);
				}
				sendJson(res, 200, {
					ok: true,
					id,
					enabled: on,
					servers: getMcpHub(host.cwd).statusList(),
					sessionEnabled: getMcpHub(host.cwd).getSessionEnabled(),
				});
				return true;
			}
			case "POST /api/mcp/servers": {
				const body = JSON.parse(await readBody(req)) as Partial<McpServerConfig> & { id?: string };
				const cfg = loadMcpConfig(host.cwd);
				const name = String(body.name ?? body.id ?? "").trim();
				if (!name && !body.command && !body.url) throw new Error("请填写名称，以及 command 或 url");
				const id = body.id?.trim()
					? sanitizeServerId(body.id)
					: allocateServerId(host.cwd, name || body.command || "server");
				if (!id) throw new Error("无效的服务器 id");
				if (cfg.servers.some((s) => s.id === id)) throw new Error(`id「${id}」已在项目配置中`);
				// 手写添加默认关（与发现一致）；调用方可显式 enabled:true
				const server: McpServerConfig = {
					id,
					name: name || id,
					enabled: body.enabled === true,
					transport: body.transport === "http" || body.transport === "sse" ? body.transport : "stdio",
					command: typeof body.command === "string" ? body.command.trim() : undefined,
					args: Array.isArray(body.args) ? body.args.filter((x): x is string => typeof x === "string") : undefined,
					env: body.env && typeof body.env === "object" ? (body.env as Record<string, string>) : undefined,
					cwd: typeof body.cwd === "string" ? body.cwd.trim() : undefined,
					url: typeof body.url === "string" ? body.url.trim() : undefined,
					headers: body.headers && typeof body.headers === "object" ? (body.headers as Record<string, string>) : undefined,
				};
				const v = validateServerConfig(server);
				if (v) throw new Error(v);
				cfg.servers.push(server);
				if (server.enabled) {
					cfg.defaults = { ...(cfg.defaults ?? {}), [id]: true };
				}
				saveMcpConfig(host.cwd, cfg);
				if (server.enabled) {
					try {
						await host.promptCommand(`/mcpset ${id} on`);
					} catch {
						// ignore
					}
				}
				host.notify("info", `MCP「${server.name}」已写入项目配置`);
				sendJson(res, 200, {
					ok: true,
					server,
					servers: getMcpHub(host.cwd).statusList(),
				});
				return true;
			}
			case "PUT /api/mcp/servers": {
				const body = JSON.parse(await readBody(req)) as Partial<McpServerConfig> & { id?: string };
				const id = sanitizeServerId(String(body.id ?? ""));
				if (!id) throw new Error("缺少 id");
				const cfg = loadMcpConfig(host.cwd);
				const idx = cfg.servers.findIndex((s) => s.id === id);
				// 仅项目手写可改 endpoint；发现项请用 enable 开关
				if (idx < 0) {
					if (typeof body.enabled === "boolean") {
						// 发现项：只改开关
						setDefaultEnabled(host.cwd, id, body.enabled);
						try {
							await host.promptCommand(`/mcpset ${id} ${body.enabled ? "on" : "off"}`);
						} catch {
							// ignore
						}
						sendJson(res, 200, {
							ok: true,
							servers: getMcpHub(host.cwd).statusList(),
							sessionEnabled: getMcpHub(host.cwd).getSessionEnabled(),
						});
						return true;
					}
					throw new Error(`项目中无手写条目「${id}」（发现项只能开关，或先「添加」做项目覆盖）`);
				}
				const prev = cfg.servers[idx];
				const server: McpServerConfig = {
					...prev,
					name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : prev.name,
					enabled: typeof body.enabled === "boolean" ? body.enabled : prev.enabled,
					transport:
						body.transport === "http" || body.transport === "sse" || body.transport === "stdio"
							? body.transport
							: prev.transport,
					command: body.command !== undefined ? String(body.command).trim() : prev.command,
					args: body.args !== undefined
						? Array.isArray(body.args)
							? body.args.filter((x): x is string => typeof x === "string")
							: prev.args
						: prev.args,
					env: body.env !== undefined
						? body.env && typeof body.env === "object"
							? (body.env as Record<string, string>)
							: undefined
						: prev.env,
					cwd: body.cwd !== undefined ? String(body.cwd).trim() || undefined : prev.cwd,
					url: body.url !== undefined ? String(body.url).trim() || undefined : prev.url,
					headers: body.headers !== undefined
						? body.headers && typeof body.headers === "object"
							? (body.headers as Record<string, string>)
							: undefined
						: prev.headers,
				};
				const v = validateServerConfig(server);
				if (v) throw new Error(v);
				cfg.servers[idx] = server;
				cfg.defaults = { ...(cfg.defaults ?? {}), [id]: server.enabled === true };
				saveMcpConfig(host.cwd, cfg);
				try {
					await host.promptCommand(`/mcpset ${id} ${server.enabled ? "on" : "off"}`);
				} catch {
					// ignore
				}
				sendJson(res, 200, { ok: true, server, servers: getMcpHub(host.cwd).statusList() });
				return true;
			}
			case "DELETE /api/mcp/servers": {
				const id = sanitizeServerId(query.get("id") ?? "");
				if (!id) throw new Error("缺少 id");
				const cfg = loadMcpConfig(host.cwd);
				const next = cfg.servers.filter((s) => s.id !== id);
				if (next.length === cfg.servers.length) {
					throw new Error(`项目中无手写「${id}」（发现项不能删除，关掉即可）`);
				}
				cfg.servers = next;
				if (cfg.defaults) {
					const d = { ...cfg.defaults };
					delete d[id];
					cfg.defaults = d;
				}
				saveMcpConfig(host.cwd, cfg);
				try {
					await host.promptCommand(`/mcpset ${id} off`);
				} catch {
					// ignore
				}
				host.notify("info", `已删除项目 MCP「${id}」`);
				sendJson(res, 200, { ok: true, servers: getMcpHub(host.cwd).statusList() });
				return true;
			}
			case "POST /api/mcp/probe": {
				const body = JSON.parse(await readBody(req)) as Partial<McpServerConfig> & { id?: string };
				// 允许只传 id：从目录取 endpoint
				let server: McpServerConfig;
				if (body.id && !body.command && !body.url) {
					const hit = discoverMcpCatalog(host.cwd).find((s) => s.id === sanitizeServerId(body.id!));
					if (!hit) throw new Error(`目录中无「${body.id}」`);
					server = {
						id: hit.id,
						name: hit.name,
						enabled: true,
						transport: hit.transport,
						command: hit.command,
						args: hit.args,
						env: hit.env,
						cwd: hit.cwd,
						url: hit.url,
						headers: hit.headers,
					};
				} else {
					server = {
						id: sanitizeServerId(String(body.id ?? "probe")) || "probe",
						name: String(body.name ?? "probe"),
						enabled: true,
						transport: body.transport === "http" || body.transport === "sse" ? body.transport : "stdio",
						command: typeof body.command === "string" ? body.command.trim() : undefined,
						args: Array.isArray(body.args) ? body.args.filter((x): x is string => typeof x === "string") : undefined,
						env: body.env && typeof body.env === "object" ? (body.env as Record<string, string>) : undefined,
						cwd: typeof body.cwd === "string" ? body.cwd.trim() : undefined,
						url: typeof body.url === "string" ? body.url.trim() : undefined,
						headers:
							body.headers && typeof body.headers === "object" ? (body.headers as Record<string, string>) : undefined,
					};
				}
				const result = await probeMcpServer(server);
				sendJson(res, 200, result);
				return true;
			}

			// ---- Agent 自建面板：liyuan-panels 社区格式导入（柱 2）。导出走前端（内容已在 wire，零服务端） ----
			case "POST /api/panels/import": {
				const body = JSON.parse(await readBody(req)) as {
					format?: unknown;
					panels?: unknown;
					name?: unknown;
					kind?: unknown;
					content?: unknown;
				};
				// 宽进：标准 {format:"liyuan-panels",panels:[…]}，也容单面板裸对象 {name,kind,content}
				const list = Array.isArray(body.panels)
					? (body.panels as Array<{ name?: unknown; kind?: unknown; content?: unknown }>)
					: typeof body.name === "string" && typeof body.content === "string"
						? [body]
						: null;
				if (!list || list.length === 0) {
					throw new Error('格式不对：需要 liyuan-panels JSON（{"format":"liyuan-panels","version":1,"panels":[{"name","kind","content"}]}）');
				}
				const result = host.importPanels(list);
				if (result.imported > 0) {
					host.notify("info", `已导入 ${result.imported} 个面板${result.errors.length ? `（${result.errors.length} 个失败）` : ""}`);
				}
				sendJson(res, result.imported > 0 ? 200 : 400, { ok: result.imported > 0, ...result });
				return true;
			}

			// ---- 会话管理（PLAN-PANELS §2.1）：重命名/删除/导出/全文搜索 ----
			case "GET /api/sessions/search": {
				sendJson(res, 200, { hits: await host.searchSessions(query.get("q") ?? "") });
				return true;
			}
			case "POST /api/sessions/rename": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { path?: string; name?: string };
				if (!body.path || !body.name?.trim()) throw new Error("缺少 path / name");
				await host.renameSession(body.path, body.name);
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "DELETE /api/sessions": {
				if (refuseWhileStreaming()) return true;
				const path = query.get("path") ?? "";
				if (!path) throw new Error("缺少 path");
				await host.deleteSession(path);
				host.notify("info", "会话已删除");
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "GET /api/sessions/export": {
				const path = query.get("path") ?? "";
				if (!path) throw new Error("缺少 path");
				const content = await host.readSessionFile(path);
				res.writeHead(200, {
					"content-type": "application/x-ndjson; charset=utf-8",
					"content-disposition": `attachment; filename="session.jsonl"; filename*=UTF-8''${encodeURIComponent(basename(path))}`,
				});
				res.end(content);
				return true;
			}

			// ---- 卡库（PLAN-PANELS §2.7）：清单/立绘/导入/收藏 ----
			case "GET /api/cards": {
				const config = loadConfig(host.cwd);
				const favs = new Set(loadFavs(host.cwd));
				sendJson(res, 200, {
					current: config.card,
					cards: listCardLibrary(host.cwd, config).map((c) => ({ ...c, fav: favs.has(c.path) })),
				});
				return true;
			}
			case "GET /api/cards/image": {
				const p = query.get("path") ?? "";
				const abs = assertLibraryCard(host.cwd, loadConfig(host.cwd), p);
				if (!/\.png$/i.test(abs)) throw new Error("该卡没有内嵌立绘（JSON 卡）");
				// 路径稳定即可长缓存；避免卡库↔详情来回时封面反复重下
				let mtime = 0;
				try {
					mtime = statSync(abs).mtimeMs;
				} catch {
					/* ignore */
				}
				res.writeHead(200, {
					"content-type": "image/png",
					"cache-control": "public, max-age=604800, immutable",
					etag: `"${mtime.toString(16)}"`,
				});
				res.end(readFileSync(abs));
				return true;
			}
			case "POST /api/cards/import": {
				const rawName = (query.get("name") ?? "").trim();
				if (!rawName || !/\.(png|json)$/i.test(rawName)) throw new Error("文件名必须以 .png 或 .json 结尾");
				const safe = rawName.replace(/[\\/:*?"<>|]/g, "-");
				const dir = join(host.cwd, "assets", "cards");
				mkdirSync(dir, { recursive: true });
				const dest = join(dir, safe);
				if (existsSync(dest)) throw new Error(`同名卡已存在：${safe}`);
				const data = await readBodyRaw(req, MAX_UPLOAD);
				if (data.length === 0) throw new Error("文件内容为空");
				writeFileSync(dest, data);
				try {
					const card = loadCardFile(dest);
					if (!card.name.trim()) throw new Error("卡名为空");
					host.notify("info", `已导入角色卡「${card.name}」`);
					sendJson(res, 200, {
						ok: true,
						path: `assets/cards/${safe}`,
						name: card.name,
						embeddedLoreCount: card.book.length,
					});
				} catch (e) {
					unlinkSync(dest); // 坏卡不留盘
					throw new Error(`不是有效的角色卡：${e instanceof Error ? e.message : String(e)}`);
				}
				return true;
			}
			case "POST /api/cards/fav": {
				const body = JSON.parse(await readBody(req)) as { path?: string; fav?: boolean };
				if (!body.path) throw new Error("缺少 path");
				const favs = new Set(loadFavs(host.cwd));
				if (body.fav) favs.add(body.path);
				else favs.delete(body.path);
				saveFavs(host.cwd, [...favs]);
				sendJson(res, 200, { ok: true });
				return true;
			}

			// ---- 世界状态编辑（PLAN-PANELS §2.11）：用户主权，applyPatch 语义，不经模型 ----
			case "PUT /api/state": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { patch?: Record<string, unknown> };
				if (!body.patch || typeof body.patch !== "object") throw new Error("缺少 patch");
				const r = host.applyStatePatch(body.patch);
				sendJson(res, 200, r);
				return true;
			}

			// ---- 用户角色 persona（PLAN-PANELS-V2 §2.5）：多身份清单/创建/选择/编辑/删除/按卡锁定 ----
			case "GET /api/personas": {
				let store = loadPersonas(host.cwd);
				const config = loadConfig(host.cwd);
				// 迁移：首次使用且 config 已有单人设 → 自动收编为第一个 persona
				if (store.personas.length === 0 && config.userName) {
					const r = createPersona(store, { name: config.userName, persona: config.userPersona });
					store = { ...r.store, current: r.id };
					savePersonas(host.cwd, store);
				}
				const active = personaForCard(store, config.card);
				sendJson(res, 200, {
					personas: store.personas,
					current: store.current,
					lockedForCard: store.byCard[config.card] ?? null,
					activeId: active?.id ?? null,
				});
				return true;
			}
			case "POST /api/personas": {
				const body = JSON.parse(await readBody(req)) as { name?: string; persona?: string };
				if (!body.name?.trim()) throw new Error("缺少名字");
				const store = loadPersonas(host.cwd);
				const r = createPersona(store, { name: body.name, persona: body.persona });
				// 第一个 persona 自动成为全局默认
				savePersonas(host.cwd, r.store.current === null ? { ...r.store, current: r.id } : r.store);
				sendJson(res, 200, { ok: true, id: r.id });
				return true;
			}
			case "PUT /api/personas": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { id?: string; name?: string; persona?: string };
				if (!body.id) throw new Error("缺少 id");
				const store = loadPersonas(host.cwd);
				if (!findPersona(store, body.id)) throw new Error("身份不存在");
				const next = updatePersona(store, body.id, { name: body.name, persona: body.persona });
				savePersonas(host.cwd, next);
				// 改的是当前生效身份 → 投影进 config 并重载
				const config = loadConfig(host.cwd);
				const active = personaForCard(next, config.card);
				if (active?.id === body.id) {
					projectPersonaToConfig(host.cwd, active);
					await host.softRefreshConfig();
				}
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "DELETE /api/personas": {
				const id = query.get("id") ?? "";
				const store = loadPersonas(host.cwd);
				if (!findPersona(store, id)) throw new Error("身份不存在");
				if (store.personas.length <= 1) throw new Error("至少保留一个身份");
				savePersonas(host.cwd, deletePersona(host.cwd, store, id));
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "POST /api/personas/select": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { id?: string; lockToCard?: boolean };
				const store = loadPersonas(host.cwd);
				const p = findPersona(store, body.id ?? "");
				if (!p) throw new Error("身份不存在");
				const config = loadConfig(host.cwd);
				const byCard = { ...store.byCard };
				if (body.lockToCard === true) byCard[config.card] = p.id;
				else if (body.lockToCard === false) delete byCard[config.card];
				savePersonas(host.cwd, { ...store, current: body.lockToCard ? store.current : p.id, byCard });
				projectPersonaToConfig(host.cwd, p);
				await host.softRefreshConfig();
				host.notify("info", `已切换身份：${p.name}`);
				sendJson(res, 200, { ok: true });
				return true;
			}
			/** 上传裁剪后的头像（raw PNG/JPEG 字节，ST 式方形头像由前端裁完再传） */
			case "POST /api/personas/avatar": {
				const id = (query.get("id") ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const store = loadPersonas(host.cwd);
				if (!findPersona(store, id)) throw new Error("身份不存在");
				const data = await readBodyRaw(req, 8 * 1024 * 1024); // 裁后头像上限 8MB
				const next = savePersonaAvatar(host.cwd, store, id, data);
				savePersonas(host.cwd, next);
				const p = findPersona(next, id)!;
				host.notify("info", `已更新头像：${p.name}`);
				sendJson(res, 200, { ok: true, avatar: p.avatar });
				return true;
			}
			case "GET /api/personas/avatar": {
				const id = (query.get("id") ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const store = loadPersonas(host.cwd);
				const p = findPersona(store, id);
				if (!p?.avatar) {
					res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "无头像" }));
					return true;
				}
				const abs = resolvePath(host.cwd, p.avatar);
				if (!existsSync(abs)) {
					res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "头像文件缺失" }));
					return true;
				}
				const buf = readFileSync(abs);
				const isPng = buf[0] === 0x89 && buf[1] === 0x50;
				res.writeHead(200, {
					"content-type": isPng ? "image/png" : "image/jpeg",
					// 头像 URL 常带 bust 参数；允许短缓存减少切换闪烁
					"cache-control": "public, max-age=3600",
					"content-length": buf.length,
				});
				res.end(buf);
				return true;
			}
			case "DELETE /api/personas/avatar": {
				const id = (query.get("id") ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const store = loadPersonas(host.cwd);
				if (!findPersona(store, id)) throw new Error("身份不存在");
				const next = clearPersonaAvatar(host.cwd, store, id);
				savePersonas(host.cwd, next);
				sendJson(res, 200, { ok: true });
				return true;
			}

			// ---- 多预设管理（PLAN-PANELS-V2 §2.6） ----
			case "GET /api/presets": {
				const config = loadConfig(host.cwd);
				sendJson(res, 200, { active: config.preset ?? null, presets: listPresetFiles(host.cwd) });
				return true;
			}
			case "POST /api/presets/select": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { file?: string | null };
				const config = loadConfig(host.cwd) as unknown as Record<string, unknown>;
				if (body.file === null || body.file === "") {
					delete config.preset; // 不用预设
				} else {
					const file = validatePresetPath(body.file ?? "");
					if (!existsSync(resolvePath(host.cwd, file))) throw new Error("预设文件不存在");
					config.preset = file;
				}
				writeJsonWithBackup(configPath(host.cwd), config);
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "POST /api/presets/saveas": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { name?: string };
				const name = (body.name ?? "").trim();
				if (!name) throw new Error("缺少预设名");
				const config = loadConfig(host.cwd);
				const current: RpPreset = config.preset
					? normalizeRpPreset(JSON.parse(readFileSync(resolvePath(host.cwd, config.preset), "utf8")))
					: { name, samplers: {}, blocks: [] };
				const file = `${PRESETS_DIR}/${presetSlug(name)}.json`;
				const abs = resolvePath(host.cwd, file);
				if (existsSync(abs)) throw new Error(`同名预设文件已存在：${file}`);
				mkdirSync(join(host.cwd, PRESETS_DIR), { recursive: true });
				writeJsonWithBackup(abs, { ...current, name });
				writeJsonWithBackup(configPath(host.cwd), { ...loadConfig(host.cwd), preset: file });
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, file });
				return true;
			}
			case "POST /api/presets/rename": {
				const body = JSON.parse(await readBody(req)) as { file?: string; name?: string };
				const file = validatePresetPath(body.file ?? "");
				const name = (body.name ?? "").trim();
				if (!name) throw new Error("缺少新名字");
				const abs = resolvePath(host.cwd, file);
				const preset = normalizeRpPreset(JSON.parse(readFileSync(abs, "utf8")));
				writeJsonWithBackup(abs, { ...preset, name });
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "DELETE /api/presets": {
				if (refuseWhileStreaming()) return true;
				const file = validatePresetPath(query.get("file") ?? "");
				const abs = resolvePath(host.cwd, file);
				if (!existsSync(abs)) throw new Error("预设文件不存在");
				unlinkSync(abs);
				const config = loadConfig(host.cwd) as unknown as Record<string, unknown>;
				if (config.preset === file) {
					delete config.preset;
					writeJsonWithBackup(configPath(host.cwd), config);
					await host.softRefreshConfig();
				}
				sendJson(res, 200, { ok: true });
				return true;
			}
			// 导入：ST 预设自动转换 / 梨园预设直接收档；存入 assets/presets/ 并切换启用
			case "POST /api/presets/import": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { name?: string; json?: Record<string, unknown> };
				if (!body.json || typeof body.json !== "object") throw new Error("缺少预设 JSON");
				const name = (body.name ?? "").trim() || "imported-preset";
				const isSt = Array.isArray(body.json.prompts) || Array.isArray(body.json.prompt_order);
				const { preset, report } = isSt
					? convertStPreset(body.json, name)
					: { preset: { ...normalizeRpPreset(body.json), name }, report: [] };
				const file = `${PRESETS_DIR}/${presetSlug(name)}.json`;
				const abs = resolvePath(host.cwd, file);
				mkdirSync(join(host.cwd, PRESETS_DIR), { recursive: true });
				writeJsonWithBackup(abs, preset);
				writeJsonWithBackup(configPath(host.cwd), { ...loadConfig(host.cwd), preset: file });
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, file, report, blockCount: preset.blocks.length, converted: isSt });
				return true;
			}
			case "GET /api/presets/export": {
				const file = validatePresetPath(query.get("file") ?? "");
				const abs = resolvePath(host.cwd, file);
				const preset = normalizeRpPreset(JSON.parse(readFileSync(abs, "utf8")));
				sendJson(res, 200, { name: preset.name, json: preset });
				return true;
			}

			// ---- 世界书文件管理（PLAN-PANELS-V2 §2.3：选书/导入/删除） ----
			case "GET /api/lorebooks": {
				const config = loadConfig(host.cwd);
				const active = mountedLorebookPaths(config);
				sendJson(res, 200, {
					/** 多本同时挂载；兼容旧前端：active 现为 string[] */
					active,
					/** @deprecated 旧单本字段：取 active[0] 或 null */
					activeOne: active[0] ?? null,
					books: listLorebookFiles(host.cwd, config),
				});
				return true;
			}
			/**
			 * 挂载多选：
			 * - { paths: string[] } 整体覆盖挂载列表（[] = 一本都不挂）
			 * - { path, enabled?: boolean } 单本开关（默认 enabled=true 切换为挂上；enabled=false 卸下）
			 * - { path: null } 清空全部挂载
			 * 角色卡与世界书无关：本接口不碰 card。
			 */
			case "POST /api/lorebooks/select": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as {
					path?: string | null;
					paths?: string[];
					enabled?: boolean;
				};
				const config = loadConfig(host.cwd);
				const ensureBook = (p: string) => {
					const abs = resolvePath(host.cwd, p);
					if (!existsSync(abs) || loadLorebookFile(abs).length === 0) {
						throw new Error(`不是有效的世界书文件：${p}`);
					}
				};
				let nextPaths: string[];
				if (Array.isArray(body.paths)) {
					nextPaths = body.paths.map((p) => p.replace(/\\/g, "/")).filter(Boolean);
					for (const p of nextPaths) ensureBook(p);
				} else if (body.path === null || body.path === "") {
					nextPaths = [];
				} else if (typeof body.path === "string" && body.path.trim()) {
					const p = body.path.replace(/\\/g, "/");
					ensureBook(p);
					const cur = new Set(mountedLorebookPaths(config));
					const on = body.enabled !== false; // 默认挂上；传 false 卸下
					// 若未显式传 enabled 且已在列表中 → 视为切换（toggle）
					if (body.enabled === undefined) {
						if (cur.has(p)) cur.delete(p);
						else cur.add(p);
					} else if (on) cur.add(p);
					else cur.delete(p);
					nextPaths = [...cur];
				} else {
					throw new Error("缺少 path 或 paths");
				}
				const next = setMountedLorebooks(config, nextPaths);
				writeJsonWithBackup(configPath(host.cwd), next);
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, active: nextPaths });
				return true;
			}
			case "POST /api/lorebooks/import": {
				const rawName = (query.get("name") ?? "").trim().replace(/\.json$/i, "");
				if (!rawName) throw new Error("缺少 name");
				const safe = `${rawName.replace(/[\\/:*?"<>|]/g, "-")}.json`;
				mkdirSync(join(host.cwd, LOREBOOKS_DIR), { recursive: true });
				const dest = join(host.cwd, LOREBOOKS_DIR, safe);
				if (existsSync(dest)) throw new Error(`同名世界书已存在：${safe}`);
				const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
				const entries = normalizeEntries(body.entries);
				if (entries.length === 0) throw new Error("不是有效的世界书（entries 为空）");
				writeFileSync(dest, `${JSON.stringify(body, null, "\t")}\n`, "utf8");
				host.notify("info", `世界书「${rawName}」已导入（${entries.length} 条）`);
				sendJson(res, 200, { ok: true, path: `${LOREBOOKS_DIR}/${safe}`, entryCount: entries.length });
				return true;
			}
			case "DELETE /api/lorebooks": {
				if (refuseWhileStreaming()) return true;
				const p = (query.get("path") ?? "").replace(/\\/g, "/");
				const base = p.startsWith(`${LOREBOOKS_DIR}/`) ? p.slice(LOREBOOKS_DIR.length + 1) : "";
				if (!base || base.includes("/") || base.includes("..") || !base.endsWith(".json")) {
					throw new Error("只能删除 assets/lorebooks/ 下的世界书（项目外的素材文件不动）");
				}
				const abs = join(host.cwd, LOREBOOKS_DIR, base);
				if (!existsSync(abs)) throw new Error("文件不存在");
				unlinkSync(abs);
				const config = loadConfig(host.cwd);
				const active = mountedLorebookPaths(config);
				if (active.includes(p)) {
					const next = setMountedLorebooks(
						config,
						active.filter((x) => x !== p),
					);
					writeJsonWithBackup(configPath(host.cwd), next);
					await host.softRefreshConfig();
				}
				sendJson(res, 200, { ok: true });
				return true;
			}

			// ---- 知识库管理（PLAN-PANELS-V2 §2.4：建库/改名/删除/挂载按钮，用户主权） ----
			case "POST /api/codex": {
				const body = JSON.parse(await readBody(req)) as { name?: string; description?: string };
				const r = createCodex(host.cwd, body.name ?? "", body.description ?? "");
				if (!r.ok) throw new Error(r.error);
				host.notify("info", `知识库「${r.meta.name}」已创建`);
				sendJson(res, 200, { ok: true, name: r.meta.name });
				return true;
			}
			case "POST /api/codex/rename": {
				const body = JSON.parse(await readBody(req)) as { name?: string; newName?: string };
				const meta = findCodex(host.cwd, body.name ?? "");
				if (!meta) throw new Error(`知识库不存在：${body.name}`);
				const newName = (body.newName ?? "").trim();
				if (!newName) throw new Error("缺少新名字");
				if (host.mountedCodexes().some((n) => n.toLowerCase() === meta.name.toLowerCase())) {
					throw new Error("该库已挂载到当前对话，先卸载再改名");
				}
				if (findCodex(host.cwd, newName)) throw new Error(`已存在同名知识库：${newName}`);
				const r = createCodex(host.cwd, newName, meta.description);
				if (!r.ok) throw new Error(r.error);
				// 搬条目：读旧文件原始 entries 写入新文件（保 uid 与灯法字段）
				const oldRaw = JSON.parse(readFileSync(meta.file, "utf8")) as Record<string, unknown>;
				const newRaw = JSON.parse(readFileSync(r.meta.file, "utf8")) as Record<string, unknown>;
				writeFileSync(r.meta.file, `${JSON.stringify({ ...newRaw, entries: oldRaw.entries ?? [] }, null, "\t")}\n`, "utf8");
				unlinkSync(meta.file);
				sendJson(res, 200, { ok: true, name: newName });
				return true;
			}
			case "DELETE /api/codex": {
				const name = query.get("name") ?? "";
				const meta = findCodex(host.cwd, name);
				if (!meta) throw new Error(`知识库不存在：${name}`);
				if (host.mountedCodexes().some((n) => n.toLowerCase() === meta.name.toLowerCase())) {
					throw new Error("该库已挂载到当前对话，先卸载再删除");
				}
				unlinkSync(meta.file);
				host.notify("info", `知识库「${meta.name}」已删除`);
				sendJson(res, 200, { ok: true });
				return true;
			}
			// 挂载/卸载：经命令桥走扩展 /codexmount（与 codex_mount 工具同一内存+树快照路径）
			case "POST /api/codex/mount": {
				const body = JSON.parse(await readBody(req)) as { name?: string; mounted?: boolean };
				const meta = findCodex(host.cwd, body.name ?? "");
				if (!meta) throw new Error(`知识库不存在：${body.name}`);
				const queued = host.queueCommand(`/codexmount ${body.mounted ? "mount" : "unmount"} ${meta.name}`);
				sendJson(res, 200, { ok: true, queued });
				return true;
			}

			// ---- 角色卡字段编辑（JSON + PNG tEXt 回写） ----
			case "PUT /api/card": {
				if (refuseWhileStreaming()) return true;
				const patch = JSON.parse(await readBody(req)) as CardFieldPatch;
				const config = loadConfig(host.cwd);
				updateCardFields(resolvePath(host.cwd, config.card), patch);
				await host.softRefreshConfig(); // 卡字段进 system prompt，必须重装
				sendJson(res, 200, { ok: true });
				return true;
			}
			/**
			 * 导出当前角色卡（含可选世界书合并）。
			 * query: format=json|png，lore=active|embedded|none
			 * - active（默认）：挂载世界书 + 本卡补充设定 + 原内嵌书（指纹去重），即「改过之后」的创作态
			 * - embedded：仅卡内原 character_book
			 * - none：不带世界书
			 */
			case "GET /api/card/export": {
				const config = loadConfig(host.cwd);
				const format = (query.get("format") ?? "json").toLowerCase() === "png" ? "png" : "json";
				const loreRaw = (query.get("lore") ?? "active").toLowerCase();
				const loreMode: CardExportLoreMode =
					loreRaw === "none" || loreRaw === "embedded" ? loreRaw : "active";
				const abs = resolvePath(host.cwd, config.card);
				const bookEntries =
					loreMode === "active" ? collectActiveLoreForExport(host.cwd, config) : undefined;
				const exp = exportCardFile(abs, { format, loreMode, bookEntries });
				res.writeHead(200, {
					"content-type": exp.mime,
					"content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(exp.filename)}`,
					"cache-control": "no-store",
					"x-liyuan-lore-mode": exp.loreMode,
					"x-liyuan-lore-count": String(exp.loreCount),
				});
				res.end(exp.body);
				return true;
			}
			/** 开场白 CRUD：index 0=first_mes，1..=alternate_greetings */
			case "PUT /api/card/greetings": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as {
					index?: number;
					text?: string;
					greetings?: string[];
				};
				const config = loadConfig(host.cwd);
				const abs = resolvePath(host.cwd, config.card);
				if (Array.isArray(body.greetings)) {
					setCardGreetings(
						abs,
						body.greetings.map((t) => String(t ?? "")),
					);
				} else if (typeof body.index === "number" && typeof body.text === "string") {
					updateCardGreeting(abs, body.index, body.text);
				} else {
					throw new Error("需要 greetings[] 或 index+text");
				}
				// 若当前选中序号越界，钳回
				const card = loadCardFile(abs);
				const max = card.alternateGreetings.length;
				const gi = config.greetingIndex ?? 0;
				if (gi > max) {
					writeJsonWithBackup(configPath(host.cwd), { ...config, greetingIndex: 0 });
				}
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "POST /api/card/greetings": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { text?: string };
				const config = loadConfig(host.cwd);
				const abs = resolvePath(host.cwd, config.card);
				const index = addCardGreeting(abs, body.text ?? "");
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, index });
				return true;
			}
			case "DELETE /api/card/greetings": {
				if (refuseWhileStreaming()) return true;
				const index = Number.parseInt(query.get("index") ?? "", 10);
				if (!Number.isFinite(index)) throw new Error("缺少 index");
				const config = loadConfig(host.cwd);
				const abs = resolvePath(host.cwd, config.card);
				deleteCardGreeting(abs, index);
				const card = loadCardFile(abs);
				const max = card.alternateGreetings.length;
				let gi = config.greetingIndex ?? 0;
				if (gi > max) gi = 0;
				else if (gi === index) gi = Math.max(0, index - 1);
				else if (gi > index) gi = gi - 1;
				writeJsonWithBackup(configPath(host.cwd), { ...config, greetingIndex: gi });
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, greetingIndex: gi });
				return true;
			}
			/** 开场白上移/下移：{ index, delta: -1|1 } */
			case "POST /api/card/greetings/move": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { index?: number; delta?: number };
				const index = typeof body.index === "number" ? body.index : Number.NaN;
				const delta = body.delta === -1 || body.delta === 1 ? body.delta : Number.NaN;
				if (!Number.isFinite(index) || !Number.isFinite(delta)) throw new Error("需要 index 与 delta（-1 上移 / 1 下移）");
				const config = loadConfig(host.cwd);
				const abs = resolvePath(host.cwd, config.card);
				const to = moveCardGreeting(abs, index, delta);
				const gi0 = config.greetingIndex ?? 0;
				const gi = remapGreetingIndexAfterMove(gi0, index, to);
				if (gi !== gi0) {
					writeJsonWithBackup(configPath(host.cwd), { ...config, greetingIndex: gi });
				}
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, index: to, greetingIndex: gi });
				return true;
			}

			// ---- 模型 ----
			case "GET /api/models": {
				sendJson(res, 200, host.listModels());
				return true;
			}
			case "POST /api/models/select": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { provider?: string; id?: string };
				if (!body.provider || !body.id) throw new Error("缺少 provider / id");
				const current = await host.selectModel(body.provider, body.id);
				host.notify("info", `模型已切换：${current.name}`);
				sendJson(res, 200, { current });
				return true;
			}
			case "POST /api/models/thinking": {
				const body = JSON.parse(await readBody(req)) as { level?: string };
				if (!body.level) throw new Error("缺少 level");
				sendJson(res, 200, { current: host.setThinkingLevel(body.level) });
				return true;
			}

			// ---- API 连接 ----
			case "GET /api/auth": {
				sendJson(res, 200, { providers: host.authProviders() });
				return true;
			}
			case "POST /api/auth": {
				const body = JSON.parse(await readBody(req)) as { provider?: string; key?: string };
				if (!body.provider || !body.key) throw new Error("缺少 provider / key");
				host.setAuthKey(body.provider, body.key.trim());
				host.refreshModels();
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "DELETE /api/auth": {
				const provider = query.get("provider");
				if (!provider) throw new Error("缺少 provider");
				host.removeAuth(provider);
				host.refreshModels();
				sendJson(res, 200, { ok: true });
				return true;
			}
			// ---- 配置仓库 liyuan-profiles/ + 当前启用 liyuan.agent.json ----
			case "GET /api/agent-profiles": {
				loadOrSeedAgentConfig(host); // 触发迁移
				sendJson(res, 200, { profiles: listProfiles(host.cwd) });
				return true;
			}
			case "GET /api/agent-profiles/one": {
				const id = (query.get("id") ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const rec = loadProfile(host.cwd, id);
				if (!rec) throw new Error(`配置不存在：${id}`);
				sendJson(res, 200, {
					id: rec.id,
					name: rec.name,
					updatedAt: rec.updatedAt,
					config: rec.config,
					text: `${JSON.stringify(rec.config, null, "\t")}\n`,
				});
				return true;
			}
			/** 生成器：只写入仓库，不启用 */
			case "POST /api/agent-profiles": {
				const body = JSON.parse(await readBody(req)) as {
					id?: string;
					name?: string;
					config?: unknown;
					text?: string;
				};
				let parsed: unknown = body.config;
				if (typeof body.text === "string") {
					try {
						parsed = JSON.parse(body.text);
					} catch (e) {
						throw new Error(`JSON 无法解析：${e instanceof Error ? e.message : String(e)}`);
					}
				}
				if (!parsed) throw new Error("缺少 config 或 text");
				const config = normalizeAgentConfig(parsed);
				materializeEnvKeysInConfig(config);
				const idRaw = (body.id ?? body.name ?? Object.keys(config.providers)[0] ?? "").trim();
				if (!idRaw) throw new Error("请填写配置名");
				const name = (body.name ?? idRaw).trim();
				// 生成器只写入仓库，不启用；同名则覆盖仓库副本
				const rec = saveProfile(host.cwd, idRaw, name, config);
				host.notify("info", `配置「${rec.name}」已存入仓库（未启用）`);
				sendJson(res, 200, { ok: true, profile: { id: rec.id, name: rec.name, updatedAt: rec.updatedAt }, profiles: listProfiles(host.cwd) });
				return true;
			}
			/** 修改仓库中的配置（不自动启用，除非已是启用中的那份） */
			case "PUT /api/agent-profiles": {
				const body = JSON.parse(await readBody(req)) as {
					id?: string;
					name?: string;
					config?: unknown;
					text?: string;
				};
				const id = (body.id ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const prev = loadProfile(host.cwd, id);
				if (!prev) throw new Error(`配置不存在：${id}`);
				let parsed: unknown = body.config ?? prev.config;
				if (typeof body.text === "string") {
					try {
						parsed = JSON.parse(body.text);
					} catch (e) {
						throw new Error(`JSON 无法解析：${e instanceof Error ? e.message : String(e)}`);
					}
				}
				const config = normalizeAgentConfig(parsed);
				materializeEnvKeysInConfig(config);
				const name = (body.name ?? prev.name).trim();
				const rec = saveProfile(host.cwd, id, name, config);
				// 若正在启用这份，同步到 runtime
				const active = listProfiles(host.cwd).find((p) => p.active);
				if (active?.id === id) {
					persistAgentConfig(host, config);
				}
				host.notify("info", `配置「${rec.name}」已更新`);
				sendJson(res, 200, { ok: true, profile: { id: rec.id, name: rec.name, updatedAt: rec.updatedAt }, profiles: listProfiles(host.cwd) });
				return true;
			}
			case "POST /api/agent-profiles/enable": {
				const body = JSON.parse(await readBody(req)) as { id?: string };
				const id = (body.id ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const config = enableProfile(host.cwd, host.agentDir(), id);
				host.refreshModels();
				// 切换到配置里的默认模型
				if (config.defaultProvider && config.defaultModel) {
					try {
						await host.selectModel(config.defaultProvider, config.defaultModel);
					} catch {
						/* 模型可能暂不可用 */
					}
					if (config.defaultThinkingLevel) {
						try {
							host.setThinkingLevel(config.defaultThinkingLevel);
						} catch {
							/* */
						}
					}
				}
				host.notify("info", `已启用配置「${id}」`);
				sendJson(res, 200, {
					ok: true,
					config,
					profiles: listProfiles(host.cwd),
					current: host.listModels().current,
				});
				return true;
			}
			case "DELETE /api/agent-profiles": {
				const id = (query.get("id") ?? "").trim();
				if (!id) throw new Error("缺少 id");
				deleteProfile(host.cwd, id);
				host.notify("info", `已删除配置「${id}」`);
				sendJson(res, 200, { ok: true, profiles: listProfiles(host.cwd) });
				return true;
			}

			// ---- 当前启用的 Agent 配置（liyuan.agent.json）----
			case "GET /api/agent-config": {
				const { path, exists, config, seeded } = loadOrSeedAgentConfig(host);
				if (seeded) host.notify("info", "已将当前使用中的渠道收编进梨园 Agent 配置");
				sendJson(res, 200, {
					path,
					exists: exists || seeded,
					config,
					text: `${JSON.stringify(config, null, "\t")}\n`,
					seeded,
					profiles: listProfiles(host.cwd),
				});
				return true;
			}
			case "PUT /api/agent-config": {
				const body = JSON.parse(await readBody(req)) as { text?: string; config?: unknown };
				let parsed: unknown;
				if (typeof body.text === "string") {
					try {
						parsed = JSON.parse(body.text);
					} catch (e) {
						throw new Error(`JSON 无法解析：${e instanceof Error ? e.message : String(e)}`);
					}
				} else if (body.config !== undefined) {
					parsed = body.config;
				} else {
					throw new Error("缺少 text 或 config");
				}
				const config = persistAgentConfig(host, normalizeAgentConfig(parsed));
				host.notify("info", "当前 Agent 配置已保存");
				sendJson(res, 200, {
					ok: true,
					path: loadAgentConfig(host.cwd).path,
					config,
					text: `${JSON.stringify(config, null, "\t")}\n`,
				});
				return true;
			}
			// 兼容旧路径：转发到 agent-config
			case "GET /api/models-json": {
				const { path, exists, config, seeded } = loadOrSeedAgentConfig(host);
				sendJson(res, 200, {
					path,
					exists: exists || seeded,
					content: config,
					text: `${JSON.stringify(config, null, "\t")}\n`,
				});
				return true;
			}
			case "PUT /api/models-json": {
				const body = JSON.parse(await readBody(req)) as { text?: string; content?: unknown };
				const parsed =
					typeof body.text === "string"
						? JSON.parse(body.text)
						: body.content !== undefined
							? body.content
							: null;
				if (!parsed) throw new Error("缺少 text 或 content");
				const config = persistAgentConfig(host, normalizeAgentConfig(parsed));
				sendJson(res, 200, {
					ok: true,
					path: loadAgentConfig(host.cwd).path,
					text: `${JSON.stringify(config, null, "\t")}\n`,
				});
				return true;
			}
			case "POST /api/channels": {
				const body = JSON.parse(await readBody(req)) as {
					name?: string;
					baseUrl?: string;
					api?: string;
					apiKey?: string;
					models?: unknown;
					provider?: Record<string, unknown>;
					setDefault?: boolean;
				};
				const name = (body.name ?? "").trim();
				const baseUrl = (body.baseUrl ?? (body.provider?.baseUrl as string | undefined) ?? "").toString().trim();
				const api = (body.api ?? (body.provider?.api as string | undefined) ?? "").toString().trim();
				if (!name || !baseUrl || !api) throw new Error("渠道名、Base URL、API 类型均必填（模型清单可后补）");
				if (!/^[\w.-]+$/.test(name)) throw new Error("渠道名只允许字母数字与 . - _");
				const { config } = loadOrSeedAgentConfig(host);
				if (config.providers[name]) throw new Error(`渠道已存在：${name}`);
				const models = normalizeModels(body.models ?? body.provider?.models ?? []);
				const fromProvider = body.provider && typeof body.provider === "object" ? { ...body.provider } : {};
				delete fromProvider.name;
				const entry: AgentProvider = {
					...fromProvider,
					baseUrl,
					api,
					apiKey: (body.apiKey ?? (fromProvider.apiKey as string | undefined) ?? "").toString().trim() || "placeholder",
					models,
				};
				config.providers[name] = entry;
				if (body.setDefault || !config.defaultProvider) {
					config.defaultProvider = name;
					if (models[0]) config.defaultModel = models[0].id;
				}
				persistAgentConfig(host, config);
				host.notify("info", `渠道「${name}」已保存（${models.length} 个模型）`);
				sendJson(res, 200, { ok: true, channel: publicProvider(name, entry), config });
				return true;
			}
			case "GET /api/channels": {
				const { path, config, seeded } = loadOrSeedAgentConfig(host);
				if (seeded) host.notify("info", "已将当前使用中的渠道收编进梨园 Agent 配置");
				sendJson(res, 200, {
					path,
					configPath: path,
					channels: Object.entries(config.providers).map(([name, p]) => publicProvider(name, p)),
					defaultProvider: config.defaultProvider ?? null,
					defaultModel: config.defaultModel ?? null,
				});
				return true;
			}
			case "PUT /api/channels": {
				const body = JSON.parse(await readBody(req)) as {
					name?: string;
					baseUrl?: string;
					api?: string;
					apiKey?: string;
					models?: unknown;
					mergeModels?: boolean;
					patch?: Record<string, unknown>;
					setDefault?: boolean;
				};
				const name = (body.name ?? "").trim();
				const { config } = loadOrSeedAgentConfig(host);
				const ch = config.providers[name];
				if (!ch) throw new Error(`渠道不存在：${name}`);
				if (body.patch && typeof body.patch === "object") {
					for (const [k, v] of Object.entries(body.patch)) {
						if (k === "name") continue;
						if (v === null) delete ch[k];
						else ch[k] = v;
					}
				}
				if (typeof body.baseUrl === "string" && body.baseUrl.trim()) ch.baseUrl = body.baseUrl.trim();
				if (typeof body.api === "string" && body.api.trim()) ch.api = body.api.trim();
				if (typeof body.apiKey === "string" && body.apiKey.trim()) ch.apiKey = body.apiKey.trim();
				if (body.models !== undefined) {
					const incoming = normalizeModels(body.models);
					ch.models = body.mergeModels ? mergeModelsById(normalizeModels(ch.models), incoming) : incoming;
				}
				config.providers[name] = ch;
				if (body.setDefault) {
					config.defaultProvider = name;
					const mid = normalizeModels(ch.models)[0]?.id;
					if (mid) config.defaultModel = mid;
				}
				persistAgentConfig(host, config);
				sendJson(res, 200, { ok: true, channel: publicProvider(name, ch), config });
				return true;
			}
			case "DELETE /api/channels": {
				const name = (query.get("name") ?? "").trim();
				const { config } = loadOrSeedAgentConfig(host);
				if (!config.providers[name]) throw new Error(`渠道不存在：${name}`);
				delete config.providers[name];
				if (config.defaultProvider === name) {
					const first = Object.keys(config.providers)[0];
					config.defaultProvider = first;
					config.defaultModel = first ? normalizeModels(config.providers[first].models)[0]?.id : undefined;
				}
				persistAgentConfig(host, config);
				host.notify("info", `渠道「${name}」已删除`);
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "POST /api/channels/test": {
				const body = JSON.parse(await readBody(req)) as { name?: string; baseUrl?: string; apiKey?: string };
				let baseUrl = (body.baseUrl ?? "").trim();
				let apiKey = (body.apiKey ?? "").trim() || undefined;
				const name = (body.name ?? "").trim();
				if (name) {
					const ch = loadOrSeedAgentConfig(host).config.providers[name];
					if (!ch?.baseUrl) throw new Error(`渠道不存在或缺 Base URL：${name}`);
					baseUrl = String(ch.baseUrl);
					if (!apiKey) {
						const k = typeof ch.apiKey === "string" ? ch.apiKey : "";
						if (k && k !== "placeholder") apiKey = k; // $ENV 由 probe 解析
					}
				}
				if (!baseUrl) throw new Error("缺少 name 或 baseUrl");
				const result = await probeModelsEndpoint(baseUrl, apiKey);
				sendJson(res, 200, { ok: result.ok, status: result.status, detail: result.detail });
				return true;
			}
			case "POST /api/channels/fetch-models": {
				const body = JSON.parse(await readBody(req)) as {
					name?: string;
					baseUrl?: string;
					apiKey?: string;
					apply?: boolean;
				};
				let baseUrl = (body.baseUrl ?? "").trim();
				let apiKey = (body.apiKey ?? "").trim() || undefined;
				const name = (body.name ?? "").trim();
				const loaded = name ? loadOrSeedAgentConfig(host) : null;
				const ch = name && loaded ? loaded.config.providers[name] : undefined;
				if (name) {
					if (!ch?.baseUrl) throw new Error(`渠道不存在或缺 Base URL：${name}`);
					baseUrl = String(ch.baseUrl);
					if (!apiKey) {
						const k = typeof ch.apiKey === "string" ? ch.apiKey : "";
						if (k && k !== "placeholder") apiKey = k;
					}
				}
				if (!baseUrl) throw new Error("缺少 name 或 baseUrl");
				const result = await probeModelsEndpoint(baseUrl, apiKey);
				if (!result.ok) throw new Error(`拉取失败：${result.detail}`);
				if (result.ids.length === 0) throw new Error("渠道返回了空模型清单");
				const models = result.ids.map((id) => ({ id })) as AgentModelEntry[];
				if (body.apply && name && loaded && ch) {
					ch.models = mergeModelsById(normalizeModels(ch.models), models);
					loaded.config.providers[name] = ch;
					persistAgentConfig(host, loaded.config);
					host.notify("info", `「${name}」已合并 ${result.ids.length} 个模型`);
					sendJson(res, 200, { ok: true, models: result.ids, channel: publicProvider(name, ch) });
					return true;
				}
				sendJson(res, 200, { ok: true, models: result.ids });
				return true;
			}

			// ---- 配置（用户角色 / 设置） ----
			case "GET /api/config": {
				sendJson(res, 200, { config: loadConfig(host.cwd) });
				return true;
			}
			case "PUT /api/config": {
				if (refuseWhileStreaming()) return true;
				const patch = JSON.parse(await readBody(req)) as Record<string, unknown>;
				const next = applyConfigPatch(loadConfig(host.cwd), patch);
				writeJsonWithBackup(configPath(host.cwd), next);
				await host.softRefreshConfig();
				sendJson(res, 200, { config: next });
				return true;
			}

			// ---- 角色卡 ----
			case "GET /api/card": {
				const config = loadConfig(host.cwd);
				const card = loadCardFile(resolvePath(host.cwd, config.card));
				sendJson(res, 200, {
					path: config.card,
					displayName: config.displayName ?? null,
					greetingIndex: config.greetingIndex ?? 0,
					name: card.name,
					description: card.description,
					personality: card.personality,
					scenario: card.scenario,
					creatorNotes: card.creatorNotes,
					tags: card.tags,
					/** 卡内嵌 character_book 条数（>0 时前端可提示导入配套世界书） */
					embeddedLoreCount: card.book.length,
					greetings: [card.firstMes, ...card.alternateGreetings].map((text, index) => ({
						index,
						label: index === 0 ? "默认开场白" : `备选 ${index}`,
						text,
					})),
				});
				return true;
			}
			case "POST /api/greeting": {
				const body = JSON.parse(await readBody(req)) as { index?: number; apply?: boolean };
				const config = loadConfig(host.cwd);
				const card = loadCardFile(resolvePath(host.cwd, config.card));
				const max = card.alternateGreetings.length; // 合法范围 0..max
				const index = clampInt(body.index, 0, max, 0);
				writeJsonWithBackup(configPath(host.cwd), { ...config, greetingIndex: index });
				// apply=true：走扩展 /greeting，未开聊时可即时替换对话里的开场白
				if (body.apply) {
					if (refuseWhileStreaming()) return true;
					await host.promptCommand(`/greeting ${index}`);
					sendJson(res, 200, { greetingIndex: index, applied: true });
					return true;
				}
				host.notify("info", "开场白已选定，对下一个新会话生效");
				sendJson(res, 200, { greetingIndex: index, applied: false });
				return true;
			}
			case "POST /api/card/switch": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { card?: string };
				const cardPath = (body.card ?? "").trim();
				if (!cardPath) throw new Error("缺少 card 路径");
				const card = loadCardFile(resolvePath(host.cwd, cardPath)); // 先验卡，坏卡不落盘
				const config = loadConfig(host.cwd) as unknown as Record<string, unknown>;
				// 卡专属字段随卡走：显示名/开场白选择清掉。
				// 世界书与角色卡解耦：换卡不碰 lorebooks / disabledLore（条目启停跨卡保留）。
				delete config.displayName;
				delete config.greetingIndex;
				config.card = cardPath;
				writeJsonWithBackup(configPath(host.cwd), config);
				// persona 按卡自动选用（卡锁定→全局默认）：投影进 config 一并生效
				const pstore = loadPersonas(host.cwd);
				const persona = personaForCard(pstore, cardPath);
				if (persona) projectPersonaToConfig(host.cwd, persona);
				const result = await host.switchToCard();
				host.notify(
					"info",
					`${result === "switched" ? `已切换到「${card.name}」的最近会话` : `已为「${card.name}」新建会话`}${persona ? `（身份：${persona.name}）` : ""}`,
				);
				sendJson(res, 200, {
					result,
					name: card.name,
					path: cardPath,
					embeddedLoreCount: card.book.length,
				});
				return true;
			}
			/**
			 * 把当前卡（或指定卡）的内嵌 character_book 另存为独立世界书并挂到配置。
			 * 卡内嵌书仍会随卡加载；另存后可在世界书面板管理、跨卡复用。
			 */
			case "POST /api/card/import-embedded-lore": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { card?: string };
				const config = loadConfig(host.cwd);
				const cardPath = (body.card ?? config.card).trim();
				if (!cardPath) throw new Error("缺少角色卡");
				const card = loadCardFile(resolvePath(host.cwd, cardPath));
				if (card.book.length === 0) throw new Error(`「${card.name}」没有内嵌世界书`);
				const safeBase = card.name.replace(/[\\/:*?"<>|]/g, "-").trim() || "card-lore";
				mkdirSync(join(host.cwd, LOREBOOKS_DIR), { recursive: true });
				let file = `${safeBase}.json`;
				let dest = join(host.cwd, LOREBOOKS_DIR, file);
				let n = 2;
				while (existsSync(dest)) {
					file = `${safeBase}-${n}.json`;
					dest = join(host.cwd, LOREBOOKS_DIR, file);
					n += 1;
				}
				const stJson = exportStLorebook(card.name, card.book);
				writeFileSync(dest, `${JSON.stringify(stJson, null, "\t")}\n`, "utf8");
				const rel = `${LOREBOOKS_DIR}/${file}`;
				// 追加挂载，不顶掉其它已启用的书
				const next = setMountedLorebooks(config, [...mountedLorebookPaths(config), rel]);
				writeJsonWithBackup(configPath(host.cwd), next);
				await host.softRefreshConfig();
				host.notify("info", `已导入配套世界书「${card.name}」（${card.book.length} 条）并加入挂载`);
				sendJson(res, 200, { ok: true, path: rel, entryCount: card.book.length, name: card.name });
				return true;
			}

			// ---- 世界书 ----
			/**
			 * 条目列表：默认按「当前点开的那一本」返回，不合并多本。
			 * - ?path=assets/lorebooks/xxx.json → 只返回该文件条目
			 * - ?source=agent → 只返回当前卡的 agent 补充设定
			 * - 无参 → 空列表（避免误把全部挂载书砸进 UI）
			 * 会话上下文仍由 config.lorebooks 多本合并（扩展层），与本列表解耦。
			 */
			case "GET /api/lorebook": {
				const config = loadConfig(host.cwd);
				const pathQ = (query.get("path") ?? "").replace(/\\/g, "/").trim();
				const sourceQ = (query.get("source") ?? "").trim();
				const mounted = mountedLorebookPaths(config);
				const mapEntries = (entries: LorebookEntry[], source: LoreSource) =>
					entries.map((e) => ({
						fingerprint: loreFingerprint(e.content),
						comment: e.comment,
						keys: e.keys,
						secondaryKeys: e.secondaryKeys,
						constant: e.constant,
						enabled: e.enabled,
						selective: e.selective,
						order: e.order,
						chars: e.content.length,
						source,
						preview: previewText(e.content, 160),
					}));

				if (sourceQ === "agent") {
					const card = loadCardFile(resolvePath(host.cwd, config.card));
					const overlayPath = overlayPathFor(host.cwd, card.name);
					const raw = existsSync(overlayPath) ? loadLorebookFile(overlayPath) : [];
					const entries = applyDisabledLore(raw, config.disabledLore);
					sendJson(res, 200, {
						lorebookPath: null,
						lorebookPaths: mounted,
						viewPath: null,
						viewSource: "agent" as const,
						viewName: "agent 补充设定",
						total: entries.length,
						entries: mapEntries(entries, "agent"),
					});
					return true;
				}

				if (pathQ) {
					const abs = resolvePath(host.cwd, pathQ);
					if (!existsSync(abs)) throw new Error("世界书文件不存在");
					const raw = loadLorebookFile(abs);
					if (raw.length === 0) throw new Error("不是有效的世界书文件");
					const entries = applyDisabledLore(raw, config.disabledLore);
					const name =
						(() => {
							try {
								const j = readJsonFile(abs) as Record<string, unknown>;
								return typeof j.name === "string" && j.name.trim() ? j.name.trim() : null;
							} catch {
								return null;
							}
						})() ?? pathQ.split("/").pop()?.replace(/\.json$/i, "") ?? pathQ;
					sendJson(res, 200, {
						lorebookPath: pathQ,
						lorebookPaths: mounted,
						viewPath: pathQ,
						viewSource: "file" as const,
						viewName: name,
						total: entries.length,
						entries: mapEntries(entries, "file"),
					});
					return true;
				}

				// 无 path：不返回合并全集（UI 必须先点选一本）
				sendJson(res, 200, {
					lorebookPath: null,
					lorebookPaths: mounted,
					viewPath: null,
					viewSource: null,
					viewName: null,
					total: 0,
					entries: [],
				});
				return true;
			}
			case "GET /api/lorebook/entry": {
				const fp = query.get("fp") ?? "";
				const config = loadConfig(host.cwd);
				// 在全部库文件 + 补充设定里找（浏览未挂载书时也能展开正文）
				const card = loadCardFile(resolvePath(host.cwd, config.card));
				const candidates: Array<{ abs: string; source: LoreSource }> = [];
				for (const b of listLorebookFiles(host.cwd, config)) {
					candidates.push({ abs: resolvePath(host.cwd, b.path), source: "file" });
				}
				candidates.push({ abs: overlayPathFor(host.cwd, card.name), source: "agent" });
				let found: LorebookEntry | null = null;
				let source: LoreSource = "file";
				for (const c of candidates) {
					if (!existsSync(c.abs)) continue;
					const hit = applyDisabledLore(loadLorebookFile(c.abs), config.disabledLore).find(
						(e) => loreFingerprint(e.content) === fp,
					);
					if (hit) {
						found = hit;
						source = c.source;
						break;
					}
				}
				if (!found) throw new Error("条目不存在（世界书可能已更换）");
				sendJson(res, 200, {
					content: found.content,
					comment: found.comment,
					keys: found.keys,
					secondaryKeys: found.secondaryKeys,
					constant: found.constant,
					enabled: found.enabled,
					selective: found.selective,
					order: found.order,
					source,
					fingerprint: fp,
				});
				return true;
			}
			/**
			 * 编辑条目：写回源文件（独立世界书 file / agent 补充设定）。
			 * 可改 constant（绿/蓝灯）、order（优先级）、keys、selective、comment、content。
			 */
			case "PUT /api/lorebook/entry": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as {
					fingerprint?: string;
					constant?: boolean;
					order?: number;
					keys?: string[];
					secondaryKeys?: string[];
					selective?: boolean;
					comment?: string;
					content?: string;
				};
				const fp = (body.fingerprint ?? "").trim();
				if (!fp) throw new Error("缺少 fingerprint");
				const config = loadConfig(host.cwd);
				const card = loadCardFile(resolvePath(host.cwd, config.card));
				// 写回：扫描全部世界书文件 + 补充设定（不限当前挂载，浏览哪本改哪本）
				const candidates: string[] = [];
				for (const b of listLorebookFiles(host.cwd, config)) {
					candidates.push(resolvePath(host.cwd, b.path));
				}
				candidates.push(overlayPathFor(host.cwd, card.name));

				const patch: LoreEntryPatch = {};
				if (typeof body.constant === "boolean") patch.constant = body.constant;
				if (typeof body.order === "number" && Number.isFinite(body.order)) {
					patch.order = Math.max(0, Math.min(9999, Math.round(body.order)));
				}
				if (Array.isArray(body.keys)) patch.keys = body.keys.filter((k): k is string => typeof k === "string");
				if (Array.isArray(body.secondaryKeys)) {
					patch.secondaryKeys = body.secondaryKeys.filter((k): k is string => typeof k === "string");
				}
				if (typeof body.selective === "boolean") patch.selective = body.selective;
				if (typeof body.comment === "string") patch.comment = body.comment;
				if (typeof body.content === "string") patch.content = body.content;
				if (Object.keys(patch).length === 0) throw new Error("没有可更新的字段");

				let result: { entry: LorebookEntry; newFingerprint: string } | null = null;
				let wrotePath = "";
				for (const abs of candidates) {
					if (!existsSync(abs)) continue;
					const r = patchLorebookFileEntry(abs, fp, patch);
					if (r) {
						result = r;
						wrotePath = abs;
						break;
					}
				}
				if (!result) throw new Error("未找到可写条目（世界书可能已更换，或条目不在挂载书/补充设定中）");

				// 内容变更时迁移 disabledLore 指纹
				if (result.newFingerprint !== fp && config.disabledLore?.includes(fp)) {
					const disabled = config.disabledLore.map((d) => (d === fp ? result!.newFingerprint : d));
					const next = { ...config, disabledLore: disabled } as Record<string, unknown>;
					writeJsonWithBackup(configPath(host.cwd), next);
				}

				// constant / order / content 影响注入，重装会话
				await host.softRefreshConfig();
				host.notify("info", "世界书条目已保存");
				sendJson(res, 200, {
					ok: true,
					fingerprint: result.newFingerprint,
					constant: result.entry.constant,
					order: result.entry.order,
					path: wrotePath.startsWith(host.cwd) ? wrotePath.slice(host.cwd.length + 1).replace(/\\/g, "/") : wrotePath,
				});
				return true;
			}
			case "GET /api/lorebook/search": {
				const q = query.get("q") ?? "";
				const entries = loadMergedLore(host.cwd, loadConfig(host.cwd));
				const hits = searchEntries(entries, q, 5);
				sendJson(res, 200, {
					hits: hits.map((h) => ({
						comment: h.entry.comment,
						keys: h.entry.keys,
						score: h.score,
						preview: previewText(h.entry.content, 400),
					})),
				});
				return true;
			}
			case "POST /api/lorebook/toggle": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as {
					fingerprint?: string;
					fingerprints?: string[];
					enabled?: boolean;
				};
				// 单条与批量（过滤结果全启/全停）共用一个端点
				const fps = [
					...(body.fingerprint ? [body.fingerprint] : []),
					...(Array.isArray(body.fingerprints) ? body.fingerprints.filter((f): f is string => typeof f === "string") : []),
				];
				if (fps.length === 0) throw new Error("缺少 fingerprint(s)");
				const config = loadConfig(host.cwd);
				const disabled = new Set(config.disabledLore ?? []);
				for (const fp of fps) {
					if (body.enabled) disabled.delete(fp);
					else disabled.add(fp);
				}
				const next = { ...config, disabledLore: [...disabled] } as Record<string, unknown>;
				if ((next.disabledLore as string[]).length === 0) delete next.disabledLore;
				writeJsonWithBackup(configPath(host.cwd), next);
				await host.softRefreshConfig(); // constant 条目影响 system prompt，必须重装
				sendJson(res, 200, { ok: true, count: fps.length });
				return true;
			}
			// 导出：?path=按书导出（原样内容）；缺省导出合并结果（agent 补充的正典也有了带走的路）
			case "GET /api/lorebook/export": {
				const p = (query.get("path") ?? "").replace(/\\/g, "/");
				if (p) {
					const abs = resolvePath(host.cwd, p);
					if (!existsSync(abs)) throw new Error("世界书文件不存在");
					const entries = loadLorebookFile(abs);
					if (entries.length === 0) throw new Error("不是有效的世界书文件");
					const name = p.split("/").pop()?.replace(/\.json$/i, "") ?? "lorebook";
					sendJson(res, 200, { name, json: exportStLorebook(name, entries) });
					return true;
				}
				const { entries, cardName } = loadMergedLoreWithSource(host.cwd, loadConfig(host.cwd));
				const name = `${cardName}-梨园世界书`;
				sendJson(res, 200, { name, json: exportStLorebook(name, entries) });
				return true;
			}

			// ---- 预设 ----
			case "GET /api/preset": {
				const config = loadConfig(host.cwd);
				if (!config.preset) {
					sendJson(res, 200, { preset: null });
					return true;
				}
				const p = resolvePath(host.cwd, config.preset);
				if (!existsSync(p)) {
					sendJson(res, 200, { preset: null, missing: config.preset });
					return true;
				}
				const preset = normalizeRpPreset(JSON.parse(readFileSync(p, "utf8")));
				sendJson(res, 200, {
					path: config.preset,
					preset: {
						name: preset.name,
						samplers: preset.samplers,
						blocks: preset.blocks.map((b) => ({
							id: b.id,
							name: b.name,
							channel: b.channel,
							role: b.role,
							enabled: b.enabled,
							chars: b.content.length,
						})),
					},
				});
				return true;
			}
			case "PUT /api/preset": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as {
					samplers?: Record<string, number>;
					blocks?: Array<{ id: string; enabled: boolean }>;
				};
				const config = loadConfig(host.cwd);
				if (!config.preset) throw new Error("当前未配置预设文件");
				const p = resolvePath(host.cwd, config.preset);
				const preset = normalizeRpPreset(JSON.parse(readFileSync(p, "utf8")));
				const next: RpPreset = {
					...preset,
					samplers: sanitizeSamplers(body.samplers) ?? preset.samplers,
					blocks: preset.blocks.map((b) => {
						const patch = body.blocks?.find((x) => x.id === b.id);
						return patch ? { ...b, enabled: patch.enabled === true } : b;
					}),
				};
				writeJsonWithBackup(p, next);
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "POST /api/preset/convert": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { name?: string; json?: Record<string, unknown> };
				if (!body.json || typeof body.json !== "object") throw new Error("缺少 ST 预设 JSON");
				const { preset, report } = convertStPreset(body.json, (body.name ?? "").trim() || "imported-preset");
				const outPath = join(host.cwd, "liyuan-preset.json");
				writeJsonWithBackup(outPath, preset);
				const config = loadConfig(host.cwd);
				if (config.preset !== "liyuan-preset.json") {
					writeJsonWithBackup(configPath(host.cwd), { ...config, preset: "liyuan-preset.json" });
				}
				await host.softRefreshConfig();
				sendJson(res, 200, { report, blockCount: preset.blocks.length, samplers: preset.samplers });
				return true;
			}

			// ---- 导入 ST 聊天记录 ----
			case "POST /api/import": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { content?: string; tag?: string };
				if (!body.content?.trim()) throw new Error("聊天记录内容为空");
				const dir = join(host.cwd, ".liyuan-cache", "imports");
				mkdirSync(dir, { recursive: true });
				const rel = join(".liyuan-cache", "imports", `import-${Date.now()}.jsonl`);
				writeFileSync(join(host.cwd, rel), body.content, "utf8");
				const tag = (body.tag ?? "").trim();
				// /import 全流程（解析→清洗→摘要→建账→注入）由扩展命令完成，进度经 notify 推送
				await host.promptCommand(`/import ${rel}${tag ? ` ${tag}` : ""}`);
				sendJson(res, 200, { ok: true });
				return true;
			}

			default:
				sendJson(res, 404, { error: `未知接口：${route}` });
				return true;
		}
	} catch (err) {
		sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
		return true;
	}
}

function sanitizeSamplers(input: Record<string, number> | undefined): Record<string, number> | undefined {
	if (!input || typeof input !== "object") return undefined;
	const out: Record<string, number> = {};
	for (const [k, v] of Object.entries(input)) {
		if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
	}
	return out;
}
