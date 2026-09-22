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

import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, isAbsolute, join } from "node:path";
import { gzipSync } from "node:zlib";

import {
	EMPTY_AGENT_CONFIG,
	deleteProfile,
	enableProfile,
	findModelEntry,
	listProfiles,
	loadAgentConfig,
	loadProfile,
	materializeEnvKeysInConfig,
	mergeModelEntries,
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
	coverSidecarOf,
	deleteCardGreeting,
	exportCardFile,
	loadCardFile,
	loreEntriesForExport,
	mergeExportLore,
	moveCardGreeting,
	readCardRawJson,
	remapGreetingIndexAfterMove,
	setCardGreetings,
	updateCardFields,
	updateCardGreeting,
	type CardExportLoreMode,
	type CardExportEntry,
	type CardFieldPatch,
} from "../src/card.ts";
import {
	buildCardFrontSnapshot,
	setSkinEnabled,
	type CardFrontSnapshot,
} from "../src/cardfront.ts";
import { RP_COMMANDS } from "../src/commands.ts";
import { setUiLocale } from "../src/i18n/index.ts";
import {
	getMemoryStatus,
	memoryClearStore,
	memoryDeleteChunk,
	memoryImportText,
	memoryListChunks,
	memoryManualAdd,
	memoryReembedScope,
	memoryRemoveStore,
	memorySearch,
	probeCloudEmbed,
	updateMemoryConfig,
	updateStoreConfig,
} from "../src/memory/index.ts";
import {
	CARDS_ROOT,
	DIRS,
	MEDIA_PREFIX,
	MEDIA_PREFIX_LEGACY,
	SKILLS_PREFIX,
	UPLOAD_PREFIX,
	UPLOAD_PREFIX_LEGACY,
	normalizeDataPath,
	resolveConfigPath,
	sameCardPath,
} from "../src/paths.ts";
import { createCardSpace, deleteChat, exportChatZip, importChatZip, listCardSpaces, renameChat, resolveCardSpace } from "../src/cardspace.ts";
import { scanSkillFiles, stageSkillRoot } from "../src/stage/materials.ts";
import { deleteStageSkill, saveStageSkill } from "../src/stage/skill-store.ts";
import type { WorldlineView } from "../src/worldline.ts";
import type { WireStoryFile } from "./wire.ts";
import type { FileDiff } from "../src/stage/story-history.ts";
import {
	appendLorebookFileEntry,
	applyDisabledLore,
	constantEntries,
	bookOfEntries,
	deleteLorebookFileEntry,
	exportStLorebook,
	keysFromTitle,
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
	type NewLoreEntryInput,
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
import {
	loadPresetDoc,
	patchPresetRaw,
	presetDocBlock,
	presetDocView,
	type PresetBlockPatch,
	type PresetDoc,
	type PresetPatch,
} from "../src/preset-doc.ts";
import {
	agentRulesPath,
	cardRulesPath,
	globalRulesPath,
	readUserRules,
	rulesAgentDir,
	systemPromptPath,
	translatePresetToRules,
	translateReport,
} from "../src/user-rules.ts";
import {
	assembleForDeclare,
	buildDeclarePrompt,
	buildProcessPrompt,
	compiledPieces,
	compilePreset,
	declarePieces,
	declareTranslateReport,
	parseDeclareResponse,
	parseProcessResponseWithError,
	presetFingerprint,
	processIntoEntries,
	processReport,
	stripPresetEntries,
	translatePresetWithDeclaration,
	type PresetDeclaration,
	type PresetProcessStore,
} from "../src/preset-declare.ts";
import { cardAgentsPath, projectCardToAgents } from "../src/card-agents.ts";
import { formatEntry, lorebookSourceSuffix, stripEntriesWhere, uniqueEntryName } from "../src/prompt-entries.ts";
import { cardProjectOperation, inspectCardProject, previewCardProject, readCardCover } from "../src/card-authoring.ts";
import type { CardPreviewReport } from "./card-preview.ts";
import { readDeclaration, removeDeclaration, writeDeclarationFromDetection } from "../src/lorebook-declare.ts";
import { constantLoreOf, loadStageMaterials } from "../src/stage/materials.ts";
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
import { BACKUP_ROOT, buildBackupZip, projectSessionDir, stageRestore } from "../src/backup.ts";
import { promoteStagedCard } from "../src/migrate-cards.ts";
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
	/** 当前模型上下文窗口（来自 models.json / 连接配置；默认 128000） */
	contextWindow: number;
	/** 单次最大输出（来自 models.json / 连接配置；缺省时 registry 用 16384） */
	maxTokens?: number;
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
	maxTokens?: number;
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
	setAuthKey(provider: string, key: string): Promise<void>;
	removeAuth(provider: string): Promise<void>;
	/** runtime agent 目录（同步用，不对用户暴露） */
	agentDir(): string;
	/** 取某 provider 的运行时模型/端点快照 */
	providerSnapshot(provider: string): ProviderRuntimeSnapshot | null;
	refreshModels(): Promise<void>;
	/** 会话重载（session_start 重放，素材重装）+ 服务端显示名刷新 + 全端对齐 */
	reloadSession(): Promise<void>;
	/**
	 * 热更新：扩展内重读 config/卡/世界书/预设并重建 system prompt，不 session.reload。
	 * 用于切身份、改 user 设定、挂载世界书等——ST 式即时生效。
	 * reprocessPreset：预设处理机制（process）强制重跑一次模型（装载/重新装载按钮用）。
	 */
	softRefreshConfig(opts?: { reprocessPreset?: boolean }): Promise<void>;
	/** 页面回报 agent 预览结果；未决请求不存在时返回 false */
	settleCardPreview(report: CardPreviewReport): boolean;
	/** 与写卡工具同一条预览通道（REST 侧供面板与验证用） */
	runCardPreview(args: Record<string, unknown>): Promise<unknown>;
	/** config.card 已写盘后调用：切到该卡最近会话，无则新建 */
	switchToCard(): Promise<"switched" | "created">;
	/** 经会话通道执行斜杠命令（/import 等，扩展的 notify 会以 wire notify 推送） */
	promptCommand(text: string): Promise<void>;
	/** 排队执行斜杠命令（不等待完成；流式中自动排到本轮结束）。返回是否进入了排队 */
	queueCommand(text: string): boolean;
	/** 面板导入（柱 2 liyuan-panels 格式）：写盘并 await panelsync 收编扩展内存 */
	importPanels(list: Array<{ name?: unknown; kind?: unknown; content?: unknown }>): Promise<{
		imported: number;
		names: string[];
		errors: string[];
	}>;
	/** 用户收起/删除面板（同 panel_close：归档出活跃列表，盘上保留，同名重写可重开） */
	closePanel(name: string): Promise<void>;
	/**
	 * 用户手改面板 content（A：通用源码编辑）。
	 * 须已有活跃面板；kind 可改（默认保留原 kind）。写盘 + 收编扩展内存 + 树快照。
	 */
	savePanel(input: {
		name: string;
		content: string;
		kind?: string;
	}): Promise<{ name: string; kind: string; updatedAt: number }>;
	// ---- 会话管理（PLAN-PANELS §2.1，main.ts 实现） ----
	/** 当前子项目 id（chats 删除守卫用）；老布局 null */
	currentChatId(): string | null;
	sessions(): Promise<SessionInfoLite[]>;
	renameSession(path: string, name: string): Promise<void>;
	deleteSession(path: string): Promise<void>;
	/** 删除绑定某张卡的全部会话文件（删卡「相关数据」用；当前打开的会话不动） */
	deleteCardSessions(cardRel: string): Promise<number>;
	readSessionFile(path: string): Promise<string>;
	searchSessions(q: string): Promise<SessionSearchHit[]>;
	/** 世界状态用户主权编辑（applyPatch 语义，落盘+ await statesync） */
	applyStatePatch(patch: Record<string, unknown>): Promise<{ applied: string[]; warnings: string[] }>;
	notify(level: "info" | "warning" | "error", text: string): void;
	/** 世界线时间线视图（会话树 rp-save + 旁路 meta） */
	worldlineView(): import("../src/worldline.ts").WorldlineView;
	/** agent 模式的稿子：正文/ 文件与全文（非 agent 子项目为空） */
	storyView(): { files: Array<WireStoryFile & { text: string; display: string }> };
	/** 某检查点相对前一条的逐文件差 */
	storyDiff(checkpointId: string): { files: FileDiff[] };
	/** 用户直接改稿：写文件（text 为 null＝删除）并立即落检查点（来源 user） */
	editStoryFile(input: { name: string; text: string | null }): Promise<{ checkpointId?: string }>;
	/** 软删除存档节点 */
	deleteWorldlineSave(saveId: string): void;
	/** 重命名世界线（自动名可改） */
	renameWorldline(worldlineId: string, name: string): void;
	/** 文生音并写入会话（气泡「配音」/ REST） */
	ttsSpeak(text: string, caption?: string): Promise<{ src: string; bytes: number }>;
	/** 向量记忆作用域：当前角色卡 + 当前对话（换卡/新对话 = 独立库） */
	memoryScope(): { sessionId: string; card?: string };
	// ---- 在线更新（主页 chip → 弹窗 → toast；状态经 WS update 帧推送） ----
	/** 手动检查（启动已静默查过一次；这里给弹窗里的重试） */
	updateCheckNow(): Promise<void>;
	/** 开始下载暂存（mirror=镜像前缀，空=直连）；进度经 WS 推送 */
	updateDownload(mirror?: string): Promise<void>;
	/** 丢弃已暂存的更新 */
	updateDiscard(): void;
	/** 重启进程应用更新（启动脚本包裹下：退出后由脚本循环重拉） */
	updateRestart(): void;
	/**
	 * 调当前会话模型做一次性旁路判断（预设分拣等装载期声明用）。
	 * 返回模型文本或 { error }。默认关思考、4k tokens。
	 */
	runSideText(
		systemPrompt: string,
		userText: string,
		opts?: { maxTokens?: number; reasoning?: string; signal?: AbortSignal },
	): Promise<string | { error: string }>;
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
const MAX_BACKUP_UPLOAD = 512 * 1024 * 1024; // 备份包上限（素材多，留裕量）

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

/**
 * 按 Accept-Encoding 压缩后写出（>=1KB 才压：更小的体积压完反而变大）。
 *
 * 为什么放在这一层：/api/* 的 JSON 出口只有下面的 sendJson 一处（133 个调用点），
 * 静态资源出口只有 main.ts 一处 —— 两点加压缩即全站受益，不必逐端点改。
 * 实测（真实数据）：预设 273KB→108KB、卡皮肤 140KB→31KB、首屏 JS 557KB→175KB；
 * 而面板每次打开都会重新拉这些包（usePanelData 一律走网络），所以省的是每一次。
 *
 * 用同步压缩：273KB 约数毫秒，远小于省下的传输时间；且保持 sendJson 同步，
 * 不改 headersSent / 500 兜底的时序。
 */
export function writeMaybeGzip(res: ServerResponse, code: number, body: Buffer, headers: Record<string, string>): void {
	const h: Record<string, string> = { ...headers, vary: "Accept-Encoding" };
	const accepts = String(res.req?.headers["accept-encoding"] ?? "");
	// gzip;q=0 是客户端明确拒绝（罕见但合法），此时不压
	const wantsGzip = /\bgzip\b/.test(accepts) && !/\bgzip\s*;\s*q=0(\.0+)?\b/.test(accepts);
	if (body.length >= 1024 && wantsGzip) {
		const gz = gzipSync(body, { level: 6 });
		h["content-encoding"] = "gzip";
		h["content-length"] = String(gz.length);
		res.writeHead(code, h);
		res.end(gz);
		return;
	}
	h["content-length"] = String(body.length);
	res.writeHead(code, h);
	res.end(body);
}

function sendJson(res: ServerResponse, code: number, obj: unknown): void {
	const body = Buffer.from(JSON.stringify(obj) ?? "", "utf8");
	writeMaybeGzip(res, code, body, { "content-type": "application/json; charset=utf-8" });
}

const resolvePath = (cwd: string, p: string) => (isAbsolute(p) ? p : join(cwd, p));

/** 子项目 id 形状守卫：id 会拼进磁盘路径，禁路径段（..、斜杠等） */
const chatIdOk = (id: string) => /^[\w][\w.-]*$/.test(id) && !id.includes("..");

/** 带 .bak 备份的 JSON 写盘（tab 缩进，与手写配置一致） */
export function writeJsonWithBackup(path: string, data: unknown): void {
	if (existsSync(path)) copyFileSync(path, `${path}.bak`);
	writeFileSync(path, JSON.stringify(data, null, "\t") + "\n", "utf8");
}

// ---------- 配置读写 ----------

export const configPath = (cwd: string) => resolveConfigPath(cwd);

export function loadConfig(cwd: string): RpConfig {
	const p = configPath(cwd);
	if (!existsSync(p)) return { ...DEFAULT_CONFIG };
	const raw = { ...DEFAULT_CONFIG, ...(JSON.parse(readFileSync(p, "utf8")) as Partial<RpConfig>) };
	// 界面语言跟配置走：每次读盘对齐一次，PUT /api/config 之后下一条送到界面的话就换语言
	setUiLocale(raw.uiLanguage);
	// 规范化：旧 lorebook 单本 → lorebooks 数组
	return setMountedLorebooks(raw, mountedLorebookPaths(raw));
}

/**
 * 一档皮肤快照(hello 与 GET /api/cardfront 唯一组装点)。
 * 读盘失败不抛:无皮肤即可,前端清空 cardSkin。
 * 规则表 = 预设自带 regex_scripts + 卡自带 regex_scripts(顺序同酒馆 PRESET → SCOPED)。
 */
export function loadCardFrontSnapshot(cwd: string): CardFrontSnapshot {
	const config = loadConfig(cwd);
	const abs = resolvePath(cwd, config.card);
	let raw: Record<string, unknown> | null = null;
	let charName = "";
	try {
		raw = readCardRawJson(abs).raw as Record<string, unknown>;
		charName = loadCardFile(abs).name;
	} catch {
		try {
			charName = loadCardFile(abs).name;
		} catch {
			/* ignore */
		}
	}
	// 预设原文里的 regex_scripts:坏预设不许拖垮皮肤,整段兜住
	let presetRaw: Record<string, unknown> | null = null;
	try {
		presetRaw = loadEffectivePreset(cwd).doc?.raw ?? null;
	} catch {
		/* ignore */
	}
	return buildCardFrontSnapshot(config, raw, charName, presetRaw);
}

/** config PUT 白名单（card 不在内：换卡必须走 /api/card/switch 的完整流程） */
const CONFIG_EDITABLE = new Set([
	"userName",
	"userPersona",
	"displayName",
	"language",
	"uiLanguage",
	"scanDepth",
	"maxLoreInjections",
	"greeting",
	"greetingIndex",
	"importStripTags",
	"lorebook",
	"lorebooks",
	"preset",
	"samplers",
	"disabledLore",
	"backendControl",
	"creationMode",
	"assistantModel",
	"sideModel",
	"compactEveryNTurns",
]);

export function applyConfigPatch(config: RpConfig, patch: Record<string, unknown>): RpConfig {
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
	if (next.uiLanguage !== "zh" && next.uiLanguage !== "en") delete next.uiLanguage;
	next.scanDepth = clampInt(next.scanDepth, 1, 50, DEFAULT_CONFIG.scanDepth);
	next.maxLoreInjections = clampInt(next.maxLoreInjections, 0, 20, DEFAULT_CONFIG.maxLoreInjections);
	// 固定楼层压缩周期：0=关闭主动压缩；上限防手滑（500 轮≈永不触发）
	next.compactEveryNTurns = clampInt(next.compactEveryNTurns, 0, 500, DEFAULT_CONFIG.compactEveryNTurns ?? 30);
	next.greeting = next.greeting === true;
	// 决策门禁档位：只认 ask / silent；非法值删除（扩展缺省按 silent）
	if (next.creationMode !== "ask" && next.creationMode !== "silent") delete next.creationMode;
	// 助手模型：只认 { provider, id } 形；非法值删除（缺省=跟随剧情模型）
	if (next.assistantModel !== undefined) {
		const am = next.assistantModel as { provider?: unknown; id?: unknown } | null;
		if (
			!am ||
			typeof am !== "object" ||
			typeof am.provider !== "string" ||
			!am.provider ||
			typeof am.id !== "string" ||
			!am.id
		) {
			delete next.assistantModel;
		} else {
			next.assistantModel = { provider: am.provider, id: am.id };
		}
	}
	// 旁路模型：只认 { provider, entry } 形——entry 是连接配置里那条模型条目的名字，
	// 不是模型 id（同一个 id 可以有多条条目）。非法值删除（缺省=跟随剧情模型）
	if (next.sideModel !== undefined) {
		const sm = next.sideModel as { provider?: unknown; entry?: unknown } | null;
		if (
			!sm ||
			typeof sm !== "object" ||
			typeof sm.provider !== "string" ||
			!sm.provider.trim() ||
			typeof sm.entry !== "string" ||
			!sm.entry.trim()
		) {
			delete next.sideModel;
		} else {
			next.sideModel = { provider: sm.provider.trim(), entry: sm.entry.trim() };
		}
	}
	// 挂载书：lorebooks 数组优先；兼容旧单本 lorebook
	const paths = mountedLorebookPaths(next as RpConfig);
	Object.assign(next, setMountedLorebooks(next as RpConfig, paths));
	// 采样参数（刀2 D1）：只收 { 键: 数字 }，坏键丢弃
	if (next.samplers !== undefined) {
		const src = next.samplers as Record<string, unknown> | null;
		const out: Record<string, number> = {};
		if (src && typeof src === "object") {
			for (const [k, v] of Object.entries(src)) {
				if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
			}
		}
		if (Object.keys(out).length > 0) next.samplers = out;
		else delete next.samplers;
	}
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
	const overlayPath = overlayPathFor(cwd, card.name, config.card);
	const overlayEntries = existsSync(overlayPath) ? loadLorebookFile(overlayPath) : [];
	const fileSet = new Set(fileEntries.map((e) => e.content.trim()));
	const entries = applyDisabledLore(mergeEntries(fileEntries, overlayEntries), config.disabledLore);
	const sourceOf = (e: LorebookEntry): LoreSource => (fileSet.has(e.content.trim()) ? "file" : "agent");
	return { entries, sourceOf, cardName: card.name, paths };
}

export function loadMergedLore(cwd: string, config: RpConfig): LorebookEntry[] {
	return loadMergedLoreWithSource(cwd, config).entries;
}

/**
 * 导出用活跃世界书：挂载书 + 补充设定 + 卡原内嵌（指纹去重）+ 用户停用清单。
 * 即「改过角色卡/世界书之后」的创作态，便于分享回 ST / 再导入梨园。
 */
export function collectActiveLoreForExport(cwd: string, config: RpConfig): CardExportEntry[] {
	const card = loadCardFile(resolvePath(cwd, config.card));
	const { raw } = readCardRawJson(resolvePath(cwd, config.card));
	const data = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
	const book = data.character_book as { entries?: unknown } | undefined;
	const embedded = loreEntriesForExport(book?.entries);
	const paths = [...mountedLorebookPaths(config).map(p => resolvePath(cwd, p)), overlayPathFor(cwd, card.name, config.card)];
	const active = mergeEntries(...paths.filter(p => existsSync(p)).map(p => {
		const source = readJsonFile(p) as { entries?: unknown };
		return loreEntriesForExport(source.entries, true);
	})) as CardExportEntry[];
	return applyDisabledLore(mergeExportLore(embedded, active), config.disabledLore) as CardExportEntry[];
}

const previewText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

// ---------- 卡库（PLAN-PANELS §2.7）：扫描候选目录，卡头信息按 mtime 缓存 ----------

const cardMetaCache = new Map<string, { mtimeMs: number; meta: { name: string; tags: string[] } | null }>();

/**
 * 卡库扫描目录：cards/<文件夹>/（两层布局，每夹一张卡本体）+ assets/cards（导入暂存，
 * 迁移后仍在的老卡）+ 当前卡所在目录（用户素材常在项目外）。
 */
function cardDirSpecs(cwd: string, config: RpConfig): Array<{ abs: string; relBase: string }> {
	const specs: Array<{ abs: string; relBase: string }> = [{ abs: join(cwd, "assets", "cards"), relBase: "assets/cards" }];
	for (const space of listCardSpaces(cwd)) {
		if (!specs.some((s) => s.abs === space.dir)) specs.push({ abs: space.dir, relBase: `${CARDS_ROOT}/${space.folder}` });
	}
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
	/** 有封面可显示：PNG 卡恒真；JSON 卡看侧挂封面（同名 .png）在不在 */
	hasCover: boolean;
	mtimeMs: number;
}

function listCardLibrary(cwd: string, config: RpConfig): CardLibItem[] {
	const out: CardLibItem[] = [];
	const spaceFiles = new Set(listCardSpaces(cwd).map((s) => basename(s.cardFile)));
	for (const spec of cardDirSpecs(cwd, config)) {
		if (!existsSync(spec.abs)) continue;
		for (const f of readdirSync(spec.abs)) {
			if (!/\.(png|json)$/i.test(f)) continue;
			// 暂存区与卡空间同文件名：空间是正本，暂存是种子/残留，不并列两张
			if (spec.relBase === "assets/cards" && spaceFiles.has(f)) continue;
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
			const isPng = /\.png$/i.test(f);
			out.push({ path: `${spec.relBase}/${f}`, name: meta.name, tags: meta.tags, isPng, hasCover: isPng || existsSync(coverSidecarOf(abs)), mtimeMs });
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
const favsPath = (cwd: string) => join(cwd, DIRS.cache, "card-favs.json");

function loadFavs(cwd: string): string[] {
	try {
		const j = JSON.parse(readFileSync(favsPath(cwd), "utf8")) as unknown;
		return Array.isArray(j) ? j.filter((x): x is string => typeof x === "string") : [];
	} catch {
		return [];
	}
}

function saveFavs(cwd: string, favs: string[]): void {
	mkdirSync(join(cwd, DIRS.cache), { recursive: true });
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

async function loadOrSeedAgentConfig(host: RestHost): Promise<{ path: string; exists: boolean; config: LiyuanAgentConfig; seeded: boolean }> {
	// 仓库为空时，把当前启用配置拆进仓库（迁移）
	const mig = migrateActiveConfigIntoProfiles(host.cwd);
	if (mig.migrated) {
		host.notify("info", `已建立配置仓库：${mig.ids.join("、")}`);
	}

	const loaded = loadAgentConfig(host.cwd);

	// 已有配置：把残留 $ENV 收成配置文件明文（Agent 只读自己的配置文件）
	// 并始终把 liyuan.agent.json 同步到 models.json，避免手改 agent.json 后重启/重开面板仍用旧 maxTokens
	if (Object.keys(loaded.config.providers).length > 0) {
		const cfg = loaded.config;
		if (materializeEnvKeysInConfig(cfg)) {
			saveAgentConfig(host.cwd, cfg);
		}
		syncAgentConfigToRuntime(host.cwd, host.agentDir(), cfg);
		await host.refreshModels();
		return { path: loaded.path, exists: true, config: cfg, seeded: false };
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
	await host.refreshModels();
	return { path: loaded.path, exists: true, config, seeded: true };
}

async function persistAgentConfig(host: RestHost, config: LiyuanAgentConfig): Promise<LiyuanAgentConfig> {
	const normalized = normalizeAgentConfig(config);
	// 合并磁盘上已有的模型字段（用户手改的 compat / thinkingLevelMap / cost 等不会被面板覆盖丢失）
	const onDisk = loadAgentConfig(host.cwd).config;
	for (const [name, provider] of Object.entries(normalized.providers)) {
		const diskProvider = onDisk.providers[name];
		if (diskProvider && Array.isArray(diskProvider.models) && Array.isArray(provider.models)) {
			provider.models = mergeModelEntries(diskProvider.models, provider.models);
		}
	}
	saveAgentConfig(host.cwd, normalized);
	syncAgentConfigToRuntime(host.cwd, host.agentDir(), normalized);
	await host.refreshModels();
	return normalized;
}

/** 从 Agent 配置解析某**条目**的思考档：条目 > defaultThinkingLevel */
export function thinkingLevelOfEntry(
	config: LiyuanAgentConfig,
	provider: string,
	entryKey: string,
): string | undefined {
	const entry = findModelEntry(config.providers?.[provider]?.models, entryKey);
	const per = typeof entry?.thinkingLevel === "string" ? entry.thinkingLevel.trim() : "";
	if (per) return per;
	const def = typeof config.defaultThinkingLevel === "string" ? config.defaultThinkingLevel.trim() : "";
	return def || undefined;
}

/**
 * 从 Agent 配置按**模型 id** 解析思考档：模型条目 > defaultThinkingLevel。
 *
 * 同一个 id 可以有多条条目（各带各的档），这时候光有 id 说不准是哪条——
 * 返回 undefined，让调用方保持会话现有的档不动，而不是随便挑第一条把用户选的档顶掉。
 * 知道是哪条条目的调用方请改用 thinkingLevelOfEntry。
 */
function thinkingLevelFromConfig(
	config: LiyuanAgentConfig,
	provider: string,
	modelId: string,
): string | undefined {
	const p = config.providers?.[provider];
	const list = Array.isArray(p?.models) ? p.models : [];
	const hits = list.filter((x) => String(x.id) === modelId);
	if (hits.length > 1) return undefined;
	const per = typeof hits[0]?.thinkingLevel === "string" ? hits[0].thinkingLevel.trim() : "";
	if (per) return per;
	const def = typeof config.defaultThinkingLevel === "string" ? config.defaultThinkingLevel.trim() : "";
	return def || undefined;
}

/**
 * models.json 刷新后：重绑当前模型（contextWindow / maxTokens）
 * 并把配置里的思考档写回会话（配置 → 当前生效，双向里「从配置上来」这一侧）
 */
async function rebindCurrentModel(host: RestHost, config?: LiyuanAgentConfig): Promise<void> {
	const cur = host.listModels().current;
	if (!cur) return;
	try {
		await host.selectModel(cur.provider, cur.id);
	} catch {
		// 模型可能暂不可用；配置已落盘，下次切换仍会带上新字段
	}
	const cfg = config ?? loadAgentConfig(host.cwd).config;
	const after = host.listModels().current;
	if (!after) return;
	const think = thinkingLevelFromConfig(cfg, after.provider, after.id);
	if (think) {
		try {
			host.setThinkingLevel(think);
		} catch {
			/* 模型不认该档位名时忽略 */
		}
	}
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
/** 面板未点「保存」时的运行时草稿（立即进 system；切换预设时丢弃） */
const PRESET_OVERRIDE_REL = ".liyuan/preset-override.json";

const presetSlug = (name: string) => name.trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "preset";

/** 预设路径白名单：历史单文件 liyuan-preset.json 或 assets/presets/ 顶层 .json */
function validatePresetPath(p: string): string {
	const norm = p.replace(/\\/g, "/");
	if (norm === "liyuan-preset.json") return norm;
	const base = norm.startsWith(`${PRESETS_DIR}/`) ? norm.slice(PRESETS_DIR.length + 1) : "";
	if (!base || base.includes("/") || base.includes("..") || !base.endsWith(".json")) throw new Error("非法预设路径");
	return norm;
}

export function presetOverridePath(cwd: string): string {
	return join(cwd, PRESET_OVERRIDE_REL);
}

function clearPresetOverride(cwd: string): void {
	const p = presetOverridePath(cwd);
	if (existsSync(p)) {
		try {
			unlinkSync(p);
		} catch {
			/* ignore */
		}
	}
}

/** 预设名＝文件名（酒馆预设没有 name 字段，名字在酒馆就是文件名） */
export function presetNameFromFile(file: string): string {
	const base = file.replace(/\\/g, "/").split("/").pop() ?? file;
	return base.replace(/\.json$/i, "") || "preset";
}

function readPresetDoc(cwd: string, file: string): PresetDoc {
	const abs = resolvePath(cwd, file);
	return loadPresetDoc(JSON.parse(readFileSync(abs, "utf8")), presetNameFromFile(file));
}

/** 磁盘上的已保存预设（不含草稿） */
export function loadDiskPreset(cwd: string): { path: string; doc: PresetDoc } | null {
	const config = loadConfig(cwd);
	if (!config.preset) return null;
	if (!existsSync(resolvePath(cwd, config.preset))) return null;
	return { path: config.preset, doc: readPresetDoc(cwd, config.preset) };
}

/** 运行时生效：草稿优先，否则磁盘。草稿与磁盘同格式（原文），只是没落盘 */
export function loadEffectivePreset(cwd: string): { path: string | null; doc: PresetDoc | null; fromOverride: boolean } {
	const config = loadConfig(cwd);
	if (!config.preset) return { path: null, doc: null, fromOverride: false };
	const ovr = presetOverridePath(cwd);
	if (existsSync(ovr)) {
		try {
			return {
				path: config.preset,
				doc: loadPresetDoc(JSON.parse(readFileSync(ovr, "utf8")), presetNameFromFile(config.preset)),
				fromOverride: true,
			};
		} catch {
			/* fall through */
		}
	}
	const disk = loadDiskPreset(cwd);
	if (!disk) return { path: config.preset, doc: null, fromOverride: false };
	return { path: disk.path, doc: disk.doc, fromOverride: false };
}

function listPresetFiles(cwd: string): Array<{ file: string; name: string }> {
	const out: Array<{ file: string; name: string }> = [];
	// 名字取文件名，但仍要解析一次确认是能读的 JSON——列表里不放坏文件
	const readable = (abs: string): boolean => {
		try {
			JSON.parse(readFileSync(abs, "utf8"));
			return true;
		} catch {
			return false;
		}
	};
	const legacy = join(cwd, "liyuan-preset.json");
	if (existsSync(legacy) && readable(legacy)) {
		out.push({ file: "liyuan-preset.json", name: presetNameFromFile("liyuan-preset.json") });
	}
	const dir = join(cwd, PRESETS_DIR);
	if (existsSync(dir)) {
		for (const f of readdirSync(dir)) {
			if (!f.endsWith(".json")) continue;
			if (!readable(join(dir, f))) continue;
			out.push({ file: `${PRESETS_DIR}/${f}`, name: presetNameFromFile(f) });
		}
	}
	return out;
}

// ---------- 预设：面板与助手工具共用（M-D8 工具化）----------
//
// 写侧一律两段式：先落运行时草稿（.liyuan/preset-override.json，下一拍生效但不动用户文件），
// `savePresetDraft(true)` 才落盘。面板本来就是这套，工具沿用同一套——否则会出现
// 「agent 改了预设、用户在面板点撤销却撤不掉」。

/** 预设库 + 当前用哪份（`preset_list` 与 GET /api/presets 同源） */
export function presetLibrary(cwd: string): { presets: Array<{ file: string; name: string }>; active: string | null } {
	return { presets: listPresetFiles(cwd), active: loadConfig(cwd).preset ?? null };
}

/** 把补丁打进**运行时草稿**（不落盘）。返回改了几块、新增了哪些 id */
export function writePresetDraft(cwd: string, patch: PresetPatch): { blocks: number; added: string[] } {
	const config = loadConfig(cwd);
	if (!config.preset) throw new Error("当前未配置预设文件");
	const base = loadEffectivePreset(cwd).doc ?? loadDiskPreset(cwd)?.doc;
	if (!base) throw new Error(`预设文件不存在：${config.preset}`);
	const beforeIds = new Set(presetDocView(base).map((b) => b.id));
	const next = patchPresetRaw(base, patch);
	const ovr = presetOverridePath(cwd);
	mkdirSync(join(cwd, ".liyuan"), { recursive: true });
	writeFileSync(ovr, `${JSON.stringify(next, null, "\t")}\n`, "utf8");
	const added = presetDocView(loadPresetDoc(next, base.name))
		.map((b) => b.id)
		.filter((id) => !beforeIds.has(id));
	return { blocks: patch.blocks?.length ?? 0, added };
}

/** 草稿落盘（save=true）或整份丢弃（save=false） */
export function savePresetDraft(cwd: string, save: boolean): void {
	if (!save) {
		clearPresetOverride(cwd);
		return;
	}
	const config = loadConfig(cwd);
	if (!config.preset) throw new Error("当前未配置预设文件");
	const doc = loadEffectivePreset(cwd).doc ?? loadDiskPreset(cwd)?.doc;
	if (!doc) throw new Error(`预设文件不存在：${config.preset}`);
	writeJsonWithBackup(resolvePath(cwd, config.preset), doc.raw);
	clearPresetOverride(cwd);
}

/**
 * 新建一份**可用的**空白预设并选用。
 * 骨架必须带 `chatHistory` 槽位——没有它历史无处可插，装配出来的预设是废的。
 */
export function createBlankPreset(cwd: string, name: string): { file: string } | null {
	const file = `${PRESETS_DIR}/${presetSlug(name)}.json`;
	const abs = resolvePath(cwd, file);
	if (existsSync(abs)) return null;
	const raw = {
		prompts: [
			{ identifier: "main", name: "主提示词", role: "system", content: "", system_prompt: true, marker: false },
			{ identifier: "chatHistory", name: "Chat History", marker: true },
		],
		prompt_order: [
			{
				character_id: 100001,
				order: [
					{ identifier: "main", enabled: true },
					{ identifier: "chatHistory", enabled: true },
				],
			},
		],
	};
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, `${JSON.stringify(raw, null, "\t")}\n`, "utf8");
	selectPresetFile(cwd, file);
	return { file };
}

/** 当前预设（含草稿）整份另存为新文件；不切换当前使用的那份 */
export function saveAsPreset(cwd: string, name: string): { file: string } | null {
	const file = `${PRESETS_DIR}/${presetSlug(name)}.json`;
	const abs = resolvePath(cwd, file);
	if (existsSync(abs)) return null;
	const raw = loadEffectivePreset(cwd).doc?.raw ?? {};
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, `${JSON.stringify(raw, null, "\t")}\n`, "utf8");
	return { file };
}

/** 换用某份预设（null = 不用预设）。与面板同语义：**丢弃未保存草稿**。false = 文件不存在 */
export function selectPresetFile(cwd: string, file: string | null): boolean {
	const config = loadConfig(cwd) as unknown as Record<string, unknown>;
	clearPresetOverride(cwd);
	if (file === null || file === "") {
		delete config.preset;
	} else {
		const safe = validatePresetPath(file);
		if (!existsSync(resolvePath(cwd, safe))) return false;
		config.preset = safe;
	}
	writeJsonWithBackup(configPath(cwd), config);
	return true;
}

// ---------- 预设装载态同步：装载即转译、改开关即转译（2026-09-12 用户定序） ----------

export interface PresetSyncDeps {
	runSideText: RestHost["runSideText"];
	/** 声明留档用的模型名 */
	modelLabel?: string;
}

export interface PresetSyncResult {
	/** none=未装载且无残留；stripped=卸载后剥净；unchanged=产物未变；written=产物已写 */
	state: "none" | "stripped" | "unchanged" | "written";
	preset?: string;
	/** 用了哪种机制（declare＝声明分类；process＝模型处理） */
	mode?: PresetMode;
	active?: number;
	disabled?: number;
	/** 本次向模型声明的段数（0＝全部命中留档） */
	declared?: number;
	/** 声明失败：这些段按「拿不准一律留」落成活动条目，下次同步再问 */
	declareError?: string;
	pending?: number;
	/** 机制二（process）：本次调了处理模型／两条产物字数／失败原因 */
	processed?: boolean;
	identityChars?: number;
	writingChars?: number;
	processError?: string;
	/** 预设原文指纹与产物指纹不一致＝选项改了产物还是上次的（要点「重新装载」） */
	stale?: boolean;
	/** 从未处理且后台刷新不许烧模型——提示用户去点「重新装载」 */
	needProcess?: boolean;
}

/**
 * 声明留档（全局一份，跟预设本体住一起——世界书同款形状）：`assets/presets/.liyuan/预设声明-*.json`。
 * 声明分类的是预设块，不依赖卡；按卡留档（b737bfd 形态）会让每张卡首次装载同一份预设
 * 都问一次模型（实测 20+ 秒），2026-09-13 改全局共享，一份预设只声明一次。
 */
const declarationPath = (cwd: string, presetName: string): string =>
	join(cwd, PRESETS_DIR, ".liyuan", `预设声明-${presetSlug(presetName)}.json`);

/** 旧按卡留档：全局档缺失时的回读来源（读到即上提全局），只读不写 */
const legacyDeclarationPath = (cardDir: string, presetName: string): string =>
	join(cardDir, ".liyuan", `预设声明-${presetSlug(presetName)}.json`);

/** 声明失败后的退避（同一预设 60 秒内不再问模型）——每拨一次开关就撞一次 402 没有意义 */
const declareFailedAt = new Map<string, number>();
const DECLARE_RETRY_MS = 60_000;

// ---------- 机制自选（2026-09-14 用户定案）：declare＝声明分类（默认）；process＝模型处理 ----------

/** 机制表：一份 JSON 映射（assets/presets/.liyuan/预设机制.json），按预设名记；缺省＝declare */
export type PresetMode = "declare" | "process";

const presetModesPath = (cwd: string): string => join(cwd, PRESETS_DIR, ".liyuan", "预设机制.json");

function readPresetModes(cwd: string): Record<string, PresetMode> {
	try {
		const raw = JSON.parse(readFileSync(presetModesPath(cwd), "utf8")) as Record<string, unknown>;
		const out: Record<string, PresetMode> = {};
		for (const [k, v] of Object.entries(raw)) {
			if (v === "declare" || v === "process") out[k] = v;
		}
		return out;
	} catch {
		return {};
	}
}

const presetModeOf = (cwd: string, presetName: string): PresetMode => readPresetModes(cwd)[presetName] ?? "declare";

function setPresetMode(cwd: string, presetName: string, mode: PresetMode): void {
	const all = readPresetModes(cwd);
	if (mode === "declare") delete all[presetName]; // 默认值不落盘，表里只记例外
	else all[presetName] = mode;
	mkdirSync(dirname(presetModesPath(cwd)), { recursive: true });
	writeFileSync(presetModesPath(cwd), JSON.stringify(all, null, "\t"), "utf8");
}

/** 处理留档（机制二）：一份预设一份档，按原文指纹命中复用；换卡只做机械落盘 */
const processStorePath = (cwd: string, presetName: string): string =>
	join(cwd, PRESETS_DIR, ".liyuan", `预设处理-${presetSlug(presetName)}.json`);

/** 处理失败留档（实弹教训：只报 toast 不够定位）——存响应原文头尾＋解析报错，成功即删 */
const processFailurePath = (cwd: string, presetName: string): string =>
	join(cwd, PRESETS_DIR, ".liyuan", `预设处理失败-${presetSlug(presetName)}.json`);

export interface ProcessFailureRecord {
	version: 1;
	preset: string;
	fingerprint: string;
	error: string;
	failedAt: string;
	responseHead?: string;
	responseTail?: string;
	responseChars?: number;
	parseError?: string;
}

/** 处理失败后的退避（同一预设 60 秒内不再问模型）；显式重新装载绕过 */
const processFailedAt = new Map<string, number>();
const PROCESS_RETRY_MS = 60_000;

const readProcessStore = (abs: string): PresetProcessStore | null => {
	if (!existsSync(abs)) return null;
	try {
		return JSON.parse(readFileSync(abs, "utf8")) as PresetProcessStore;
	} catch {
		return null;
	}
};

const writeProcessStore = (abs: string, store: PresetProcessStore): void => {
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, JSON.stringify(store, null, "\t"), "utf8");
};

const writeProcessFailure = (abs: string, rec: ProcessFailureRecord): void => {
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, JSON.stringify(rec, null, "\t"), "utf8");
};

const clearProcessFailure = (abs: string): void => {
	if (existsSync(abs)) {
		try {
			unlinkSync(abs);
		} catch {
			/* ignore */
		}
	}
};

/** 两份文件的条目级合并：先剥旧预设条目再追加；产物相同不写；剥空了就删文件（那份本就是我们生成的） */
function mergePresetEntriesInto(path: string, section: string, base: string): { changed: boolean } {
	const exists = existsSync(path);
	const raw = exists ? readFileSync(path, "utf8") : base;
	const stripped = exists ? stripPresetEntries(raw) : raw;
	let next = stripped;
	if (section) next = stripped.trim() ? `${stripped.trimEnd()}\n\n${section}` : section;
	next = next.trim() ? `${next.trim()}\n` : "";
	if (exists && next === raw) return { changed: false };
	if (!next) {
		if (exists) unlinkSync(path);
		return { changed: exists };
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, next, "utf8");
	return { changed: true };
}

/**
 * 唯一主人：`config.preset`（含未保存草稿）⇒ 当前卡 APPEND_SYSTEM.md / AGENTS.md 里的（预设）条目。
 * 每次配置刷新跑一遍（装载/卸载/拨开关/保存/还原/换卡/启动都经过 softRefreshConfig），机制按预设自选：
 * - declare（默认）⇒ 引擎按开关编译 → 缺声明的段问一次模型（30 秒级，全局留档按块复用）
 *   → 分流成逐块（预设）条目（机制段成关闭条目）；
 * - process ⇒ 模型处理拼接全文成两条产物（分钟级）。**模型调用只发生在装载缺档/重新装载这类
 *   用户正盯着的动作**（opts.reprocess），后台刷新一律机械落盘——绝不偷偷烧几分钟模型。
 * 无预设 ⇒ 两份文件里的预设条目剥净。台上不直接吃装载的预设（materials.ts）。
 */
export async function syncPresetTranslation(
	cwd: string,
	deps: PresetSyncDeps,
	opts: { reprocess?: boolean } = {},
): Promise<PresetSyncResult> {
	const config = loadConfig(cwd);
	const cardDir = dirname(resolvePath(cwd, config.card));
	const appendPath = cardRulesPath(cardDir);
	const agentsAbs = cardAgentsPath(cardDir);
	const { doc } = loadEffectivePreset(cwd);
	if (!doc) {
		const a = mergePresetEntriesInto(appendPath, "", "");
		const b = mergePresetEntriesInto(agentsAbs, "", "");
		return { state: a.changed || b.changed ? "stripped" : "none" };
	}
	if (presetModeOf(cwd, doc.name) === "process") {
		return await syncPresetProcess(cwd, deps, opts, { doc, appendPath, agentsAbs });
	}
	const card = loadCardFile(resolvePath(cwd, config.card));
	const macro = { charName: card.name, userName: config.userName };
	const pieces = declarePieces(assembleForDeclare(doc, macro));

	// 声明留档：全局一份（按块 identifier 命中就复用）；缺的才问模型
	const declAbs = declarationPath(cwd, doc.name);
	let stored: PresetDeclaration | null = null;
	if (existsSync(declAbs)) {
		try {
			stored = JSON.parse(readFileSync(declAbs, "utf8")) as PresetDeclaration;
		} catch {
			stored = null;
		}
	}
	// 旧按卡留档上提：全局档还没有时回读当前卡那份——声明实质不依赖卡，读到即全库生效
	let lifted = false;
	if (!stored) {
		const legacyAbs = legacyDeclarationPath(cardDir, doc.name);
		if (existsSync(legacyAbs)) {
			try {
				stored = JSON.parse(readFileSync(legacyAbs, "utf8")) as PresetDeclaration;
				lifted = true;
			} catch {
				stored = null;
			}
		}
	}
	const known = new Map((stored?.entries ?? []).map((e) => [e.identifier, e]));
	const missing = pieces.filter((p) => !known.has(p.id));
	let declareError: string | undefined;
	let declared = 0;
	if (missing.length > 0) {
		const key = doc.name;
		const failedAt = declareFailedAt.get(key) ?? 0;
		if (Date.now() - failedAt < DECLARE_RETRY_MS) {
			declareError = "声明模型刚失败过，稍后再试";
		} else {
			const prompt = buildDeclarePrompt(missing, { preset: doc.name });
			const resp = await deps.runSideText(prompt.systemPrompt, prompt.userText, {
				maxTokens: 16384,
				reasoning: "low",
				signal: AbortSignal.timeout(600_000),
			});
			if (typeof resp === "string") {
				declareFailedAt.delete(key);
				const parsed = parseDeclareResponse(resp, missing);
				for (const e of parsed.entries) known.set(e.identifier, e);
				declared = parsed.entries.length;
				const nextDecl: PresetDeclaration = {
					version: 1,
					preset: doc.name,
					createdAt: new Date().toISOString(),
					model: deps.modelLabel,
					entries: [...known.values()],
				};
				mkdirSync(dirname(declAbs), { recursive: true });
				writeFileSync(declAbs, JSON.stringify(nextDecl, null, "\t"), "utf8");
			} else {
				declareFailedAt.set(key, Date.now());
				declareError = resp.error;
			}
		}
	} else if (lifted && stored) {
		// 旧档整份命中（无需重问模型）：归一后落全局（剥掉旧形态的 card 字段），其余卡此后直接命中
		const liftedDecl: PresetDeclaration = {
			version: 1,
			preset: stored.preset || doc.name,
			createdAt: stored.createdAt,
			...(stored.model ? { model: stored.model } : {}),
			entries: [...known.values()],
		};
		mkdirSync(dirname(declAbs), { recursive: true });
		writeFileSync(declAbs, JSON.stringify(liftedDecl, null, "\t"), "utf8");
	}
	// 转译用的声明＝留档 ＋ 未声明段按「拿不准一律留」（normalizeDeclaration 对缺项落 writing，不落盘）
	const declaration: PresetDeclaration = {
		version: 1,
		preset: doc.name,
		createdAt: stored?.createdAt ?? new Date().toISOString(),
		model: stored?.model ?? deps.modelLabel,
		entries: [...known.values()],
	};
	const r = translatePresetWithDeclaration(doc, declaration, macro);

	// 无档案的卡：投影打底（带世界书来源标注）——档案一落盘卡即进文件模式（刀3），投影就是原本要喂的内容
	let agentsBase = "";
	if (!existsSync(agentsAbs) && r.agentsSection) {
		const materials = loadStageMaterials(cwd);
		const bookOf = bookOfEntries(mountedLorebookPaths(config).map((rel) => resolvePath(cwd, rel)));
		agentsBase = projectCardToAgents(materials.card, constantLoreOf(materials), config, { bookOf });
	}
	const a = mergePresetEntriesInto(appendPath, r.appendMarkdown, "");
	const b = mergePresetEntriesInto(agentsAbs, r.agentsSection, agentsBase);
	if (a.changed || b.changed || declared > 0) {
		const reportAbs = join(cardDir, ".liyuan", `转译报告-${presetSlug(doc.name)}.md`);
		mkdirSync(dirname(reportAbs), { recursive: true });
		writeFileSync(reportAbs, declareTranslateReport(doc, r, declaration, config.preset ?? doc.name), "utf8");
	}
	const pending = pieces.filter((p) => !known.has(p.id)).length;
	return {
		state: a.changed || b.changed ? "written" : "unchanged",
		preset: doc.name,
		active: r.lines.filter((l) => l.action === "append" || l.action === "agents").length,
		disabled: r.lines.filter((l) => l.action === "disabled").length,
		declared,
		declareError,
		pending,
	};
}

// ---------- 世界书蓝灯镜像：挂上就有、卸下就没、书改了跟着改（2026-09-12 用户点名） ----------

/**
 * 卡档案 AGENTS.md 在场（文件模式）时，挂载书的常驻条目以 `## 标题（世界书·书名）` 条目镜像在档案里，
 * 由本函数在每次配置刷新时整组重写：先剥掉全部 `（世界书·…）` 条目，再按当前挂载书的有效常驻集
 * （与台上同一份：用户停用、协议判定、MVU 规则归属都已应用）重新落。文件就是实时的，条目视图看得见。
 * 档案不在场 ⇒ 台上本就从挂载书现场装配，无事可做。
 */
export function syncLorebookMirror(cwd: string): { state: "none" | "unchanged" | "written"; entries: number } {
	const config = loadConfig(cwd);
	const agentsAbs = cardAgentsPath(dirname(resolvePath(cwd, config.card)));
	if (!existsSync(agentsAbs)) return { state: "none", entries: 0 };
	const materials = loadStageMaterials(cwd);
	const bookOf = bookOfEntries(mountedLorebookPaths(config).map((rel) => resolvePath(cwd, rel)));
	const used = new Set<string>();
	const mirror: string[] = [];
	for (const e of constantLoreOf(materials)) {
		const book = bookOf(e) ?? "补充设定";
		const title = (e.comment || e.keys?.[0] || `条目 ${e.uid}`).trim();
		mirror.push(formatEntry(uniqueEntryName(title, lorebookSourceSuffix(book), used), e.content));
	}
	const raw = readFileSync(agentsAbs, "utf8");
	const stripped = stripEntriesWhere(raw, (e) => e.source?.kind === "lorebook");
	let next = stripped;
	if (mirror.length > 0) next = stripped.trim() ? `${stripped.trimEnd()}\n\n${mirror.join("\n")}` : mirror.join("\n");
	next = next.trim() ? `${next.trim()}\n` : "";
	if (next === raw) return { state: "unchanged", entries: mirror.length };
	writeFileSync(agentsAbs, next, "utf8");
	return { state: "written", entries: mirror.length };
}

/** 配置刷新时的卡文件对账：预设转译（按预设自选机制）+ 世界书镜像（各认自己的来源后缀，互不相扰） */
export async function syncCardFiles(
	cwd: string,
	deps: PresetSyncDeps,
	opts: { reprocess?: boolean } = {},
): Promise<{ preset: PresetSyncResult; lore: ReturnType<typeof syncLorebookMirror> }> {
	const preset = await syncPresetTranslation(cwd, deps, opts);
	const lore = syncLorebookMirror(cwd);
	return { preset, lore };
}

/**
 * 机制二：模型处理（syncPresetTranslation 的 process 分支主体）。
 * 留档按指纹命中即复用（换卡只做机械落盘）；拨开关只改指纹、产物沿用留档标 stale；
 * 留档缺失时**不烧模型**——剥净＋needProcess 提示，等用户点「重新装载」（opts.reprocess 才真跑）。
 */
async function syncPresetProcess(
	cwd: string,
	deps: PresetSyncDeps,
	opts: { reprocess?: boolean },
	ctx: { doc: PresetDoc; appendPath: string; agentsAbs: string },
): Promise<PresetSyncResult> {
	const { doc, appendPath, agentsAbs } = ctx;
	const config = loadConfig(cwd);
	const cardDir = dirname(resolvePath(cwd, config.card));
	const card = loadCardFile(resolvePath(cwd, config.card));
	const macro = { charName: card.name, userName: config.userName };
	const compiled = compilePreset(doc);
	const pieces = compiledPieces(compiled);
	const fingerprint = presetFingerprint(doc);

	const storeAbs = processStorePath(cwd, doc.name);
	const failAbs = processFailurePath(cwd, doc.name);
	let store = readProcessStore(storeAbs);
	let processed = false;
	let processError: string | undefined;
	if (!store || opts.reprocess) {
		const failedAt = processFailedAt.get(doc.name) ?? 0;
		if (!opts.reprocess && Date.now() - failedAt < PROCESS_RETRY_MS) {
			processError = "处理模型刚失败过，稍后再试";
		} else if (pieces.length === 0) {
			// 全关/零料：空产物也落档，别让每次装载都惦记
			store = {
				version: 1,
				preset: doc.name,
				fingerprint,
				identity: "",
				writing: "",
				dropped: [],
				model: deps.modelLabel,
				createdAt: new Date().toISOString(),
			};
			processed = true;
			writeProcessStore(storeAbs, store);
			clearProcessFailure(failAbs);
		} else {
			const prompt = buildProcessPrompt(pieces, { preset: doc.name });
			const resp = await deps.runSideText(prompt.systemPrompt, prompt.userText, {
				maxTokens: 32768,
				reasoning: "low",
				signal: AbortSignal.timeout(600_000),
			});
			if (typeof resp === "string") {
				const { value: parsed, parseError } = parseProcessResponseWithError(resp);
				if (parsed) {
					processFailedAt.delete(doc.name);
					store = {
						version: 1,
						preset: doc.name,
						fingerprint,
						identity: parsed.identity,
						writing: parsed.writing,
						dropped: parsed.dropped,
						model: deps.modelLabel,
						createdAt: new Date().toISOString(),
					};
					processed = true;
					writeProcessStore(storeAbs, store);
					clearProcessFailure(failAbs);
				} else {
					processFailedAt.set(doc.name, Date.now());
					processError = "处理响应不可解析";
					writeProcessFailure(failAbs, {
						version: 1,
						preset: doc.name,
						fingerprint,
						error: processError,
						failedAt: new Date().toISOString(),
						responseHead: resp.slice(0, 1200),
						responseTail: resp.slice(-400),
						responseChars: resp.length,
						...(parseError ? { parseError } : {}),
					});
				}
			} else {
				processFailedAt.set(doc.name, Date.now());
				processError = resp.error;
				writeProcessFailure(failAbs, {
					version: 1,
					preset: doc.name,
					fingerprint,
					error: processError,
					failedAt: new Date().toISOString(),
				});
			}
		}
	}
	if (!store) {
		// 无留档（从未处理/处理失败）：剥净＋提示——后台刷新绝不烧模型
		const a = mergePresetEntriesInto(appendPath, "", "");
		const b = mergePresetEntriesInto(agentsAbs, "", "");
		return {
			state: a.changed || b.changed ? "stripped" : "none",
			preset: doc.name,
			mode: "process",
			processed,
			processError,
			needProcess: true,
		};
	}

	const entries = processIntoEntries(store, macro);
	// 无档案的卡：投影打底（带世界书来源标注）——档案一落盘卡即进文件模式（刀3）
	let agentsBase = "";
	if (!existsSync(agentsAbs) && entries.agentsSection) {
		const materials = loadStageMaterials(cwd);
		const bookOf = bookOfEntries(mountedLorebookPaths(config).map((rel) => resolvePath(cwd, rel)));
		agentsBase = projectCardToAgents(materials.card, constantLoreOf(materials), config, { bookOf });
	}
	const a = mergePresetEntriesInto(appendPath, entries.appendMarkdown, "");
	const b = mergePresetEntriesInto(agentsAbs, entries.agentsSection, agentsBase);
	if (a.changed || b.changed || processed) {
		const reportAbs = join(cardDir, ".liyuan", `处理报告-${presetSlug(doc.name)}.md`);
		mkdirSync(dirname(reportAbs), { recursive: true });
		writeFileSync(
			reportAbs,
			processReport(
				doc,
				{
					identityChars: entries.identityChars,
					writingChars: entries.writingChars,
					dropped: store.dropped,
					unsupportedMacros: entries.unsupportedMacros,
					usesLastUserMessage: compiled.usesLastUserMessage,
					disabledCount: compiled.report.filter((it) => it.action === "关闭").length,
				},
				store,
				config.preset ?? doc.name,
			),
			"utf8",
		);
	}
	return {
		state: a.changed || b.changed ? "written" : "unchanged",
		preset: doc.name,
		mode: "process",
		identityChars: entries.identityChars,
		writingChars: entries.writingChars,
		processed,
		processError,
		stale: store.fingerprint !== fingerprint,
	};
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

function listLorebookFiles(cwd: string, config: RpConfig): Array<{ path: string; name: string; entryCount: number; declared: number | null }> {
	const out: Array<{ path: string; name: string; entryCount: number; declared: number | null }> = [];
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
			const declaration = readDeclaration(abs);
			out.push({
				path: `${spec.relBase}/${f}`,
				name: displayName,
				entryCount: count,
				/** 刀4：协议判定数据状态——null=无判定文件（不过滤），数字=已判定停用的条目数 */
				declared: declaration ? declaration.entries.length : null,
			});
		}
	}
	return out;
}

// ---------- 条目写侧：面板 / 台上 / 助手三处共用一套寻址与善后 ----------
//
// 「改用户的书」这件事只能有一套实现。此前 PUT/DELETE 两个端点各抄一遍寻址 + 指纹迁移；
// 工具化之后再抄两遍（台上、助手）就是四份追着彼此跑——2026-08-22 收成下面三个函数。

/** 相对 cwd 的展示路径（回执里报「改了哪本」用） */
function relToCwd(cwd: string, abs: string): string {
	return abs.startsWith(cwd) ? abs.slice(cwd.length + 1).replace(/\\/g, "/") : abs;
}

/**
 * 可写目标的寻址范围：书单里的全部世界书 + 本卡补充设定集。
 * scope 可选：`"agent"` = 只认补充设定集；给路径 = 只认书单里的那一本
 * （**不接受任意文件路径**——书单与面板展示同源，越界即报错）。
 */
export function loreWriteTargets(cwd: string, config: RpConfig, scope?: string): string[] {
	const card = loadCardFile(resolvePath(cwd, config.card));
	const overlay = overlayPathFor(cwd, card.name, config.card);
	const p = (scope ?? "").replace(/\\/g, "/").trim();
	if (p === "agent") return [overlay];
	const known = listLorebookFiles(cwd, config).map((b) => b.path);
	if (p) {
		if (!known.includes(p)) throw new Error("不是已知的世界书文件");
		return [resolvePath(cwd, p)];
	}
	return [...known.map((k) => resolvePath(cwd, k)), overlay];
}

/**
 * 按指纹改一条：扫遍可写目标，命中哪本改哪本。
 * 内容变了＝换身份（指纹是内容 md5），停用清单里的旧指纹必须跟着迁移，
 * 否则用户亲手关掉的条目会静默复活。
 */
export function patchLoreEntryAnywhere(
	cwd: string,
	config: RpConfig,
	fingerprint: string,
	patch: LoreEntryPatch,
	scope?: string,
): { entry: LorebookEntry; newFingerprint: string; path: string } | null {
	for (const abs of loreWriteTargets(cwd, config, scope)) {
		if (!existsSync(abs)) continue;
		const r = patchLorebookFileEntry(abs, fingerprint, patch);
		if (!r) continue;
		if (r.newFingerprint !== fingerprint && config.disabledLore?.includes(fingerprint)) {
			const disabled = config.disabledLore.map((d) => (d === fingerprint ? r.newFingerprint : d));
			writeJsonWithBackup(configPath(cwd), { ...config, disabledLore: disabled });
		}
		return { ...r, path: relToCwd(cwd, abs) };
	}
	return null;
}

/** 按指纹删一条：同一寻址；顺手清掉停用清单里的残留指纹（删掉的条目不该继续占位）。 */
export function deleteLoreEntryAnywhere(
	cwd: string,
	config: RpConfig,
	fingerprint: string,
	scope?: string,
): { entry: LorebookEntry; path: string } | null {
	for (const abs of loreWriteTargets(cwd, config, scope)) {
		if (!existsSync(abs)) continue;
		const removed = deleteLorebookFileEntry(abs, fingerprint);
		if (!removed) continue;
		if (config.disabledLore?.includes(fingerprint)) {
			const disabled = config.disabledLore.filter((d) => d !== fingerprint);
			const next = { ...config } as Record<string, unknown>;
			if (disabled.length > 0) next.disabledLore = disabled;
			else delete next.disabledLore;
			writeJsonWithBackup(configPath(cwd), next);
		}
		return { entry: removed, path: relToCwd(cwd, abs) };
	}
	return null;
}

/** 书单 + 当前挂载（`lorebook_files` 工具与 GET /api/lorebooks 同源） */
export function lorebookShelf(
	cwd: string,
	config: RpConfig,
): { books: Array<{ path: string; name: string; entryCount: number }>; mounted: string[] } {
	return { books: listLorebookFiles(cwd, config), mounted: mountedLorebookPaths(config) };
}

/**
 * 挂载/卸载一本，返回挂载后的完整列表。
 * 挂载方向校验「是不是有效世界书」——与 POST /api/lorebooks/select 同一条：空书挂不上。
 */
export function setLorebookMounted(cwd: string, config: RpConfig, path: string, mounted: boolean): string[] {
	const p = path.replace(/\\/g, "/");
	if (mounted) {
		const abs = resolvePath(cwd, p);
		if (!existsSync(abs) || loadLorebookFile(abs).length === 0) {
			throw new Error(`不是有效的世界书文件（空书要先写入条目）：${p}`);
		}
	}
	const cur = new Set(mountedLorebookPaths(config));
	if (mounted) cur.add(p);
	else cur.delete(p);
	const next = [...cur];
	writeJsonWithBackup(configPath(cwd), setMountedLorebooks(config, next));
	return next;
}

/**
 * 新建一本世界书：**连第一条一起写，写完直接挂载**。返回 null = 同名已存在。
 *
 * 为什么不支持「建空书」：空书在本系统里根本不成立——`listLorebookFiles` 按条目数过滤
 * （0 条＝同目录混进来的卡/预设，跳过），挂载校验也拒空书。于是空书既列不出、挂不上，
 * 连 `loreWriteTargets` 都寻址不到它，建了等于没建（8/22 探针实测撞上这个死胡同）。
 */
/**
 * 建一本新世界书。**唯一实现**，两类入口共用：
 * agent 的 `lorebook_create` 工具（`main.ts` / `assistant.ts` 两处薄壳）与 `POST /api/lorebooks`（用户新建）。
 *
 * **首条必填，不接受空书**——这不是保守，是下游两条硬约束（8/29 实跑坐实，别再试图放宽）：
 *  1. `setLorebookMounted` 校验「空书要先写入条目」，空书挂不上；
 *  2. `listLorebookFiles` 用「entries 条数 > 0」当**「这个 json 到底是不是世界书」的判据**
 *     （同目录常混有卡/预设文件），所以空书压根不出现在书单里。
 * 于是空书是用户看不见、也用不了的孤儿文件——写首条失败就删盘。
 *
 * - `mount` 缺省 `true`（agent 原行为）；用户新建时可选不挂载，与「导入」那套挂载选择一致。
 * - 任何一步失败都 `unlinkSync` 回滚：否则盘上留个孤儿，下次同名新建被「已存在」挡死。
 */
export function createLorebookWithEntry(
	cwd: string,
	config: RpConfig,
	name: string,
	first: NewLoreEntryInput,
	opts?: { mount?: boolean },
): { path: string; mounted: string[] } | null {
	const safe = `${name.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\.json$/i, "")}.json`;
	if (safe === ".json") throw new Error("书名无效");
	const rel = `${LOREBOOKS_DIR}/${safe}`;
	const abs = join(cwd, LOREBOOKS_DIR, safe);
	if (existsSync(abs)) return null;
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, `${JSON.stringify({ name: name.trim(), entries: {} }, null, "\t")}\n`, "utf8");
	if (!appendLorebookFileEntry(abs, first)) {
		unlinkSync(abs); // 首条没写进去 = 建出来的是挂不上、列不出的空书，不留盘
		throw new Error("首条内容为空，未建书");
	}
	try {
		return {
			path: rel,
			mounted: opts?.mount !== false ? setLorebookMounted(cwd, config, rel, true) : mountedLorebookPaths(config),
		};
	} catch (e) {
		try {
			unlinkSync(abs); // 挂载失败不留孤儿文件，否则同名再建会被「已存在」挡死
		} catch {
			/* best-effort */
		}
		throw e;
	}
}

/** 合并语料及来源；内容指纹用于精确读取。 */
export function loadMergedLoreMarked(cwd: string, config: RpConfig): Array<LorebookEntry & { agentWritten?: boolean; source?: string }> {
	const { entries, sourceOf } = loadMergedLoreWithSource(cwd, config);
	const sources = new Map<string, string>();
	for (const rel of mountedLorebookPaths(config)) {
		const abs = resolvePath(cwd, rel);
		if (existsSync(abs)) for (const entry of loadLorebookFile(abs)) sources.set(loreFingerprint(entry.content), rel);
	}
	return entries.map((e) => ({ ...e, source: sources.get(loreFingerprint(e.content)) ?? "补充设定集", ...(sourceOf(e) === "agent" ? { agentWritten: true } : {}) }));
}

// ---------- persona 投影（PLAN-PANELS-V2 §2.5：config.userName/userPersona=当前 persona 的镜像） ----------

function projectPersonaToConfig(cwd: string, p: Persona): void {
	const config = loadConfig(cwd) as unknown as Record<string, unknown>;
	config.userName = p.name;
	config.userPersona = p.persona;
	writeJsonWithBackup(configPath(cwd), config);
}

// ---------- 卡库 / 身份：面板与两个 agent 面共用（M-D7 工具化）----------

/** 卡库列表 + 当前卡（`card_list` 工具与 GET /api/cards 同源） */
export function cardLibrary(cwd: string, config: RpConfig): { cards: CardLibItem[]; current: string } {
	return { cards: listCardLibrary(cwd, config), current: config.card };
}

export interface NewCardInput {
	name: string;
	description?: string;
	personality?: string;
	scenario?: string;
	firstMes: string;
	mesExample?: string;
	alternateGreetings?: string[];
}

/**
 * 建一张新角色卡（CharaCard V3 JSON）。**唯一实现**，两类入口共用（8/29 提取）：
 * agent 的 `card_create` 工具（原先是 `assistant.ts` 里的内联闭包，只有助手够得着）
 * 与 `POST /api/cards`（用户自己新建——此前只能导入酒馆卡，不能创作）。
 *
 * - 同名拒写，返回 `null`（不覆盖用户已有的卡）。
 * - 写完立刻 `loadCardFile` 回读验证：解析不出名字就删盘回滚，不留一张打不开的卡。
 * - **不切换当前卡**：新卡出现在卡库里由用户自己打开（与 `card_create` 原有语义一致）。
 * - 同时返回相对路径 `path`（卡库/前端的标识口径）与绝对路径 `abs`（agent 薄壳沿用原回执，行为不变）。
 */
export function createCardFile(cwd: string, input: NewCardInput): { name: string; path: string; abs: string } | null {
	const safe = input.name.replace(/[\\/<>:"|?*]/g, "_").slice(0, 120).trim();
	if (!safe) throw new Error("卡名无效");
	const fileName = `${safe}.json`;
	const dest = join(cwd, "assets", "cards", fileName);
	// 同名拒写：暂存里没有（创建后即升格清空），也要查已升格的卡空间
	if (existsSync(dest) || listCardSpaces(cwd).some((s) => basename(s.cardFile) === fileName)) return null;
	const card = {
		spec: "chara_card_v3",
		spec_version: "3.0",
		data: {
			name: safe,
			description: input.description ?? "",
			personality: input.personality ?? "",
			scenario: input.scenario ?? "",
			first_mes: input.firstMes,
			mes_example: input.mesExample ?? "",
			alternate_greetings: input.alternateGreetings ?? [],
			tags: [],
			creator: "",
			character_version: "",
		},
	};
	mkdirSync(dirname(dest), { recursive: true });
	writeFileSync(dest, `${JSON.stringify(card, null, 2)}\n`, "utf8");
	try {
		if (!loadCardFile(dest).name) throw new Error("角色卡解析失败");
	} catch (e) {
		try {
			unlinkSync(dest); // 不留一张打不开的卡
		} catch {
			/* best-effort */
		}
		throw e instanceof Error ? new Error(`${e.message}，已回滚`) : e;
	}
	// 落库即建卡空间（与导入同一条）：新卡从出生就在两层布局里；升格失败留在暂存，仍可用
	try {
		const space = createCardSpace(cwd, dest, safe, { move: true });
		return { name: safe, path: `${CARDS_ROOT}/${space.folder}/${basename(space.cardFile)}`, abs: space.cardFile };
	} catch (err) {
		console.error(`[liyuan] 新建卡升格失败（留在暂存）：${err instanceof Error ? err.message : String(err)}`);
		return { name: safe, path: `assets/cards/${fileName}`, abs: dest };
	}
}

/**
 * 换卡：验卡 → 写 config（清掉随卡走的 displayName/greetingIndex）→ 按卡投影身份 → 切/建会话。
 * **世界书与角色卡解耦**：不碰 lorebooks / disabledLore（条目启停跨卡保留）。
 * POST /api/card/switch 与 `card_switch` 工具共用此函数。
 */
export async function selectCard(
	cwd: string,
	host: RestHost,
	cardPath: string,
): Promise<{ name: string; path: string; result: "switched" | "created"; embeddedLoreCount: number; persona: string | null; promoted: boolean }> {
	const card = loadCardFile(resolvePath(cwd, cardPath)); // 先验卡，坏卡不落盘
	const config = loadConfig(cwd) as unknown as Record<string, unknown>;
	// 暂存卡（还住在 assets/cards/ 的导入卡）在真正打开时升格为卡空间：搬进 cards/<卡名>/、
	// 旧扁平会话各成一个子项目——「新建项目」这一层由此长出来。当前卡本身不升格：
	// 它可能正开着会话，搬文件会动到活会话（切走再切回即自愈）。
	const prevCard = typeof config.card === "string" ? config.card : "";
	let finalPath = cardPath;
	if (!sameCardPath(cardPath, prevCard, cwd)) {
		const promoted = promoteStagedCard(cwd, projectSessionDir(cwd, host.agentDir()), cardPath);
		if (promoted) finalPath = promoted;
	}
	delete config.displayName;
	delete config.greetingIndex;
	config.card = finalPath;
	writeJsonWithBackup(configPath(cwd), config);
	const persona = personaForCard(loadPersonas(cwd), finalPath);
	if (persona) projectPersonaToConfig(cwd, persona);
	const result = await host.switchToCard();
	return {
		name: card.name,
		path: finalPath,
		result,
		embeddedLoreCount: card.book.length,
		persona: persona?.name ?? null,
		promoted: finalPath !== cardPath,
	};
}

/** 当前卡的绝对路径（开场白等卡文件写侧共用） */
export function currentCardPath(cwd: string, config: RpConfig): string {
	return resolvePath(cwd, config.card);
}

/**
 * 身份一览（`persona_list` 工具与 GET /api/personas 同源，含首次使用时的单人设收编迁移）。
 * activeId = 当前卡实际生效的那个（卡锁定优先于全局默认）。
 */
export function personaOverview(cwd: string): {
	personas: Persona[];
	activeId: string | null;
	lockedForCard: string | null;
} {
	let store = loadPersonas(cwd);
	const config = loadConfig(cwd);
	if (store.personas.length === 0 && config.userName) {
		const r = createPersona(store, { name: config.userName, persona: config.userPersona });
		store = { ...r.store, current: r.id };
		savePersonas(cwd, store);
	}
	const active = personaForCard(store, config.card);
	return { personas: store.personas, activeId: active?.id ?? null, lockedForCard: store.byCard[config.card] ?? null };
}

/** 选用身份：lockToCard=true 锁到当前卡，否则设为全局默认。投影进 config（热载归调用方） */
export function usePersonaFor(cwd: string, id: string, lockToCard: boolean): boolean {
	const store = loadPersonas(cwd);
	const p = findPersona(store, id);
	if (!p) return false;
	const config = loadConfig(cwd);
	const byCard = { ...store.byCard };
	if (lockToCard) byCard[config.card] = p.id;
	else delete byCard[config.card];
	savePersonas(cwd, { ...store, current: lockToCard ? store.current : p.id, byCard });
	projectPersonaToConfig(cwd, p);
	return true;
}

/** 改身份；改到的若正是当前生效的那个，一并投影（热载归调用方）。false = id 不存在 */
export function updatePersonaFor(cwd: string, id: string, patch: { name?: string; persona?: string }): boolean {
	const store = loadPersonas(cwd);
	if (!findPersona(store, id)) return false;
	const next = updatePersona(store, id, patch);
	savePersonas(cwd, next);
	const active = personaForCard(next, loadConfig(cwd).card);
	if (active?.id === id) projectPersonaToConfig(cwd, active);
	return true;
}

// ---------- 路由 ----------

/** /api/* 请求处理；非 /api 路径返回 false 交回静态托管 */
export function importEmbeddedLoreForCards(
	cwd: string,
	targets: Array<{ card: string; mount: boolean }>,
	config: RpConfig,
): {
	results: Array<{ path: string; entryCount: number; name: string; mounted: boolean }>;
	newlyMounted: string[];
	nextConfig: RpConfig | null;
} {
	if (targets.length === 0) throw new Error("缺少角色卡");

	mkdirSync(join(cwd, LOREBOOKS_DIR), { recursive: true });
	const results: Array<{ path: string; entryCount: number; name: string; mounted: boolean }> = [];
	const newlyMounted: string[] = [];

	for (const t of targets) {
		const card = loadCardFile(resolvePath(cwd, t.card));
		if (card.book.length === 0) continue;
		const safeBase = card.name.replace(/[\\/:*?"<>|]/g, "-").trim() || "card-lore";
		const stJson = exportStLorebook(card.name, card.book);
		const jsonStr = `${JSON.stringify(stJson, null, "\t")}\n`;

		let file = `${safeBase}.json`;
		let dest = join(cwd, LOREBOOKS_DIR, file);
		let n = 2;
		while (existsSync(dest)) {
			try {
				const existing = readFileSync(dest, "utf8");
				if (existing.trim() === jsonStr.trim()) {
					break;
				}
			} catch {
				/* ignore */
			}
			file = `${safeBase}-${n}.json`;
			dest = join(cwd, LOREBOOKS_DIR, file);
			n += 1;
		}
		writeFileSync(dest, jsonStr, "utf8");
		const rel = `${LOREBOOKS_DIR}/${file}`;
		if (t.mount) {
			newlyMounted.push(rel);
		}
		results.push({ path: rel, entryCount: card.book.length, name: card.name, mounted: t.mount });
	}

	if (results.length === 0) {
		throw new Error("所选角色卡均无内嵌世界书");
	}

	let nextConfig: RpConfig | null = null;
	if (newlyMounted.length > 0) {
		const existing = mountedLorebookPaths(config);
		const merged = [...existing];
		for (const p of newlyMounted) {
			if (!merged.includes(p)) merged.push(p);
		}
		nextConfig = setMountedLorebooks(config, merged);
	}

	return { results, newlyMounted, nextConfig };
}

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

			// ---- agent 模式：稿子正文（hello 只带目录，正文走这里，有 gzip） ----
			case "GET /api/story": {
				sendJson(res, 200, host.storyView());
				return true;
			}
			case "GET /api/story/diff": {
				const id = (query.get("checkpoint") ?? "").trim();
				if (!id) throw new Error("需要 checkpoint");
				sendJson(res, 200, host.storyDiff(id));
				return true;
			}
			case "POST /api/story/edit": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { name?: string; text?: string | null };
				const name = (body.name ?? "").trim();
				if (!name || (typeof body.text !== "string" && body.text !== null)) throw new Error("需要 name 与 text（null＝删除）");
				sendJson(res, 200, { ok: true, ...(await host.editStoryFile({ name, text: body.text })) });
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
				if (file.startsWith(UPLOAD_PREFIX) || file.startsWith(UPLOAD_PREFIX_LEGACY)) {
					base = normalizeDataPath(file).slice(UPLOAD_PREFIX.length);
					dir = DIRS.uploads;
				} else if (file.startsWith(MEDIA_PREFIX) || file.startsWith(MEDIA_PREFIX_LEGACY)) {
					base = normalizeDataPath(file).slice(MEDIA_PREFIX.length);
					dir = DIRS.media;
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

			// ---- 内置向量记忆（按「角色卡+对话」隔离；设置面板一等公民） ----
			case "GET /api/memory": {
				sendJson(res, 200, getMemoryStatus(host.cwd, host.memoryScope()));
				return true;
			}
			case "PUT /api/memory": {
				const body = JSON.parse(await readBody(req)) as {
					enabled?: boolean;
					searchTopK?: number;
					injectOnTurn?: boolean;
					embedMode?: "local" | "cloud";
					cloudEmbed?: { baseUrl?: string; apiKey?: string; model?: string };
					stores?: Array<{
						id: string;
						enabled?: boolean;
						everyNTurns?: number;
						maxChunks?: number;
						name?: string;
					}>;
				};
				const sc = host.memoryScope();
				const cur = getMemoryStatus(host.cwd, sc).config;
				updateMemoryConfig(host.cwd, {
					...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
					...(typeof body.searchTopK === "number" ? { searchTopK: body.searchTopK } : {}),
					...(typeof body.injectOnTurn === "boolean" ? { injectOnTurn: body.injectOnTurn } : {}),
					...(body.embedMode === "local" || body.embedMode === "cloud" ? { embedMode: body.embedMode } : {}),
					...(body.cloudEmbed
						? {
								cloudEmbed: {
									baseUrl: body.cloudEmbed.baseUrl ?? cur.cloudEmbed.baseUrl,
									apiKey: body.cloudEmbed.apiKey ?? "",
									model: body.cloudEmbed.model ?? cur.cloudEmbed.model,
								},
							}
						: {}),
				});
				if (Array.isArray(body.stores)) {
					for (const s of body.stores) {
						if (!s?.id) continue;
						updateStoreConfig(host.cwd, s.id, {
							...(typeof s.enabled === "boolean" ? { enabled: s.enabled } : {}),
							...(typeof s.everyNTurns === "number" ? { everyNTurns: s.everyNTurns } : {}),
							...(typeof s.maxChunks === "number" ? { maxChunks: s.maxChunks } : {}),
							...(typeof s.name === "string" ? { name: s.name } : {}),
						});
					}
				}
				sendJson(res, 200, getMemoryStatus(host.cwd, sc));
				return true;
			}
			case "POST /api/memory/search": {
				const body = JSON.parse(await readBody(req)) as { storeId?: string; query?: string; topK?: number };
				const storeId = (body.storeId ?? "narrative").trim();
				const query = (body.query ?? "").trim();
				if (!query) throw new Error("缺少 query");
				const hits = await memorySearch(host.cwd, host.memoryScope(), storeId, query, body.topK);
				sendJson(res, 200, { hits });
				return true;
			}
			case "POST /api/memory/import": {
				const body = JSON.parse(await readBody(req)) as {
					storeId?: string;
					text?: string;
					fileName?: string;
				};
				// 仅额外库；剧情库禁止导入
				const storeId = (body.storeId ?? "external").trim() || "external";
				const text = (body.text ?? "").trim();
				if (!text) throw new Error("缺少 text");
				const sc = host.memoryScope();
				const r = await memoryImportText(host.cwd, sc, storeId, text, body.fileName);
				if (r.added > 0) {
					const label = body.fileName?.trim() || "额外库";
					host.notify(
						"info",
						`向量记忆：向量化成功 · 额外库 +${r.added} 条（「${label}」· 当前对话）`,
					);
				} else if (r.chunks > 0) {
					host.notify("info", "向量记忆：内容已在库中（无新增）");
				}
				sendJson(res, 200, { ok: true, ...r, ...getMemoryStatus(host.cwd, sc) });
				return true;
			}
			case "POST /api/memory/manual": {
				// 手动向量化 → 仅额外库，每段/块一条
				const body = JSON.parse(await readBody(req)) as {
					text?: string;
					title?: string;
					storeId?: string;
				};
				const text = (body.text ?? "").trim();
				if (!text) throw new Error("缺少 text");
				const sc = host.memoryScope();
				const r = await memoryManualAdd(host.cwd, sc, text, {
					title: body.title,
					storeId: body.storeId,
				});
				if (r.added > 0) {
					host.notify(
						"info",
						`向量记忆：手动向量化成功 · 额外库 +${r.added} 条（当前对话）`,
					);
				} else {
					host.notify("info", "向量记忆：内容已在库中（无新增）");
				}
				sendJson(res, 200, { ok: true, ...r, ...getMemoryStatus(host.cwd, sc) });
				return true;
			}
			case "GET /api/memory/chunks": {
				const storeId = (query.get("storeId") ?? "external").trim() || "external";
				const sc = host.memoryScope();
				const chunks = memoryListChunks(host.cwd, sc, storeId);
				sendJson(res, 200, { storeId, chunks });
				return true;
			}
			case "DELETE /api/memory/chunk": {
				const storeId = (query.get("storeId") ?? "").trim();
				const id = (query.get("id") ?? "").trim();
				if (!storeId) throw new Error("缺少 storeId");
				if (!id) throw new Error("缺少 id");
				const sc = host.memoryScope();
				const ok = memoryDeleteChunk(host.cwd, sc, storeId, id);
				if (!ok) throw new Error("条目不存在或已删除");
				host.notify("info", "向量记忆：已删除 1 条");
				sendJson(res, 200, { ok: true, ...getMemoryStatus(host.cwd, sc) });
				return true;
			}
			case "POST /api/memory/chunk/delete": {
				// 兼容不便发 DELETE body 的客户端
				const body = JSON.parse(await readBody(req)) as { storeId?: string; id?: string };
				const storeId = (body.storeId ?? "").trim();
				const id = (body.id ?? "").trim();
				if (!storeId) throw new Error("缺少 storeId");
				if (!id) throw new Error("缺少 id");
				const sc = host.memoryScope();
				const ok = memoryDeleteChunk(host.cwd, sc, storeId, id);
				if (!ok) throw new Error("条目不存在或已删除");
				host.notify("info", "向量记忆：已删除 1 条");
				sendJson(res, 200, { ok: true, ...getMemoryStatus(host.cwd, sc) });
				return true;
			}
			case "POST /api/memory/probe-embed": {
				const r = await probeCloudEmbed(host.cwd);
				sendJson(res, 200, r);
				return true;
			}
			case "POST /api/memory/reembed": {
				// 保留原文，按当前 embed 模式重算向量（换 local/cloud 后用）
				const body = JSON.parse((await readBody(req)) || "{}") as { storeId?: string };
				const sc = host.memoryScope();
				const r = await memoryReembedScope(host.cwd, sc, {
					storeId: body.storeId?.trim() || undefined,
				});
				const modeLabel = r.mode === "cloud" ? `云端(${r.model})` : "本地";
				if (r.totalChunks === 0) {
					host.notify("info", "向量记忆：当前对话库为空，无需重向量化");
				} else {
					host.notify(
						"info",
						`向量记忆：重向量化完成 · ${r.totalUpdated}/${r.totalChunks} 条 → ${modeLabel}（当前对话）`,
					);
				}
				sendJson(res, 200, { ok: true, ...r, ...getMemoryStatus(host.cwd, sc) });
				return true;
			}
			case "POST /api/memory/clear": {
				const body = JSON.parse(await readBody(req)) as { storeId?: string };
				const storeId = (body.storeId ?? "").trim();
				if (!storeId) throw new Error("缺少 storeId");
				const sc = host.memoryScope();
				memoryClearStore(host.cwd, sc, storeId);
				sendJson(res, 200, { ok: true, ...getMemoryStatus(host.cwd, sc) });
				return true;
			}
			case "DELETE /api/memory/store": {
				const storeId = (query.get("id") ?? "").trim();
				if (!storeId) throw new Error("缺少 id");
				const sc = host.memoryScope();
				memoryRemoveStore(host.cwd, sc, storeId);
				sendJson(res, 200, { ok: true, ...getMemoryStatus(host.cwd, sc) });
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
				const base = file.startsWith(SKILLS_PREFIX) ? file.slice(SKILLS_PREFIX.length) : "";
				if (!base || base.includes("/") || base.includes("\\") || base.includes("..") || !base.endsWith(".md")) {
					throw new Error("非法路径");
				}
				const abs = join(host.cwd, DIRS.skills, base);
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
				const base = file.startsWith(SKILLS_PREFIX) ? file.slice(SKILLS_PREFIX.length) : "";
				if (!base || base.includes("/") || base.includes("\\") || base.includes("..") || !base.endsWith(".md")) {
					throw new Error("非法路径");
				}
				const abs = join(host.cwd, DIRS.skills, base);
				if (!existsSync(abs)) throw new Error("技能文件不存在");
				unlinkSync(abs);
				sendJson(res, 200, { ok: true });
				return true;
			}

			// ---- 台上写作 skill 库（skills/<目录>/SKILL.md）：编辑器 CRUD 与引擎读同一份文件，
			// 保存后下一拍装载即生效（loadStageMaterials 每拍现读）。与 .liyuan-skills（幕后服务笔记）无关。
			case "GET /api/stage-skills": {
				sendJson(res, 200, {
					defaultScope: stageSkillRoot(host.cwd) === stageSkillRoot(host.cwd, "global") ? "global" : "card",
					skills: scanSkillFiles(host.cwd, true).map((s) => ({
						dir: s.dir ?? s.name,
						scope: s.scope,
						shadowed: s.shadowed,
						name: s.name,
						description: s.description,
						chars: s.body.length,
						body: s.body,
						disabled: s.disableModelInvocation === true,
					})),
				});
				return true;
			}
			case "POST /api/stage-skills": {
				const body = JSON.parse(await readBody(req)) as {
					dir?: string;
					name?: string;
					description?: string;
					body?: string;
					disabled?: boolean;
					scope?: "global" | "card";
				};
				if (body.scope !== undefined && body.scope !== "global" && body.scope !== "card") throw new Error("scope 须为 global 或 card。");
				const r = saveStageSkill(host.cwd, {
					dir: typeof body.dir === "string" && body.dir.trim() ? body.dir : undefined,
					name: body.name ?? "",
					description: body.description ?? "",
					body: body.body ?? "",
					scope: body.scope,
					...(typeof body.disabled === "boolean" ? { disabled: body.disabled } : {}),
				});
				sendJson(res, 200, { ok: true, dir: r.dir, note: "下一拍装载即生效（引擎每拍现读 skills/）" });
				return true;
			}
			case "DELETE /api/stage-skills": {
				const scope = query.get("scope");
				if (scope !== null && scope !== "global" && scope !== "card") throw new Error("scope 须为 global 或 card。");
				deleteStageSkill(host.cwd, query.get("dir") ?? "", scope ?? undefined);
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
						builtin: e.builtin,
					};
				});
				const project = loadMcpConfig(host.cwd);
				sendJson(res, 200, {
					servers,
					sessionEnabled: hub.getSessionEnabled(),
					// 项目手写条目（编辑表单回填）
					config: project.servers,
					// 发现项的完整配置（编辑发现项→建项目覆盖时预填表单）
					catalog: catalog.map((e) => ({
						id: e.id,
						name: e.name,
						enabled: e.enabled,
						transport: e.transport,
						command: e.command,
						args: e.args,
						env: e.env,
						cwd: e.cwd,
						url: e.url,
						headers: e.headers,
					})),
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
				const result = await host.importPanels(list);
				if (result.imported > 0) {
					host.notify("info", `已导入 ${result.imported} 个面板${result.errors.length ? `（${result.errors.length} 个失败）` : ""}`);
				}
				sendJson(res, result.imported > 0 ? 200 : 400, { ok: result.imported > 0, ...result });
				return true;
			}
			// 用户从面板坞删除：同 agent panel_close（归档，出活跃列表；fs.watch + panelsync）
			case "DELETE /api/panels": {
				const name = (query.get("name") ?? "").trim();
				if (!name) throw new Error("缺少 name");
				await host.closePanel(name);
				host.notify("info", `已删除面板「${name}」`);
				sendJson(res, 200, { ok: true, name });
				return true;
			}
			// 用户手改面板源码（markdown/svg/html 通用）：写盘 + 收编，下轮 agent 可见
			case "PUT /api/panels": {
				const body = JSON.parse(await readBody(req)) as {
					name?: unknown;
					content?: unknown;
					kind?: unknown;
				};
				const name = typeof body.name === "string" ? body.name.trim() : "";
				if (!name) throw new Error("缺少 name");
				if (typeof body.content !== "string") throw new Error("缺少 content");
				const kind = typeof body.kind === "string" && body.kind.trim() ? body.kind.trim() : undefined;
				const saved = await host.savePanel({ name, content: body.content, kind });
				host.notify("info", `已保存面板「${saved.name}」`);
				sendJson(res, 200, { ok: true, ...saved });
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
			// 子项目（对话层）改名：只动 对话.json 的 name，不触会话，流式中也无冲突
			case "POST /api/chats/rename": {
				const body = JSON.parse(await readBody(req)) as { chatId?: string; name?: string };
				if (!body.chatId || !body.name?.trim()) throw new Error("缺少 chatId / name");
				const space = resolveCardSpace(host.cwd, loadConfig(host.cwd).card);
				if (!space) throw new Error("当前卡不在 cards/（老布局没有对话层）");
				if (!chatIdOk(body.chatId)) throw new Error("chatId 不合法");
				renameChat(space.dir, body.chatId, body.name);
				sendJson(res, 200, { ok: true });
				return true;
			}
			// 导出子项目：整个 对话/<id>/ 打成 zip 下载
			case "GET /api/chats/export": {
				const chatId = (query.get("chatId") ?? "").trim();
				if (!chatId) throw new Error("缺少 chatId");
				if (!chatIdOk(chatId)) throw new Error("chatId 不合法");
				const space = resolveCardSpace(host.cwd, loadConfig(host.cwd).card);
				if (!space) throw new Error("当前卡不在 cards/（老布局没有对话层）");
				const r = exportChatZip(space.dir, chatId);
				writeMaybeGzip(res, 200, r.data, {
					"content-type": "application/zip",
					"content-disposition": `attachment; filename="chat.zip"; filename*=UTF-8''${encodeURIComponent(r.fileName)}`,
				});
				return true;
			}
			// 导入子项目包：落成新的 对话/<新id>/（不覆盖现有），会话重绑定到当前卡
			case "POST /api/chats/import": {
				const space = resolveCardSpace(host.cwd, loadConfig(host.cwd).card);
				if (!space) throw new Error("当前卡不在 cards/（老布局没有对话层）");
				const body = await readBodyRaw(req, MAX_UPLOAD);
				if (!body.length) throw new Error("缺少包体（.zip）");
				const r = importChatZip(space.dir, body, loadConfig(host.cwd).card);
				sendJson(res, 200, { ok: true, ...r });
				return true;
			}
			// 删除整个子项目（含全部对话与世界状态）；当前项目拒删（先切走再删）
			case "DELETE /api/chats": {
				const chatId = (query.get("chatId") ?? "").trim();
				if (!chatId) throw new Error("缺少 chatId");
				if (!chatIdOk(chatId)) throw new Error("chatId 不合法");
				const space = resolveCardSpace(host.cwd, loadConfig(host.cwd).card);
				if (!space) throw new Error("当前卡不在 cards/（老布局没有对话层）");
				if (host.currentChatId() === chatId) throw new Error("当前项目不能删（先切到别的项目再删它）");
				deleteChat(space.dir, chatId);
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "DELETE /api/sessions": {
				if (refuseWhileStreaming()) return true;
				// path 可给多个（面板多选删除）：一次请求、一条回执——逐条删会连甩 N 个气泡。
				const paths = query.getAll("path").filter((p) => p.trim());
				if (paths.length === 0) throw new Error("缺少 path");
				const failed: string[] = [];
				for (const p of paths) {
					try {
						await host.deleteSession(p);
					} catch (e) {
						failed.push(`${basename(p)}（${e instanceof Error ? e.message : String(e)}）`);
					}
				}
				const done = paths.length - failed.length;
				if (done === 0) throw new Error(`删除失败：${failed.join("；")}`);
				host.notify("info", done === 1 ? "会话已删除" : `已删除 ${done} 个会话`);
				if (failed.length > 0) host.notify("warning", `${failed.length} 个未能删除：${failed.join("；")}`);
				sendJson(res, 200, { ok: true, deleted: done, failed });
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

			// ---- 卡前端(一档皮肤,spec 2026-07-22 §7 P1) ----
			case "GET /api/cardfront": {
				// 与 GET /api/card 同：当前卡用 resolvePath（支持按路径换卡的非库内路径）
				// 载荷必须与 hello.cardfront 同源(buildCardFrontSnapshot)
				const snap = loadCardFrontSnapshot(host.cwd);
				/**
				 * 作者脚本正文默认**不带**（`?scripts=1` 才带）。
				 * 这条端点每次 hello 后都会被拉一遍（对齐皮肤开关态），而脚本正文实测可达 3.58MB；
				 * 默认带上就是每次重放/回退都白拉一遍。前端按 hello 里的清单指纹判断变没变，
				 * 只在换卡/换预设时才带 `?scripts=1` 拉一次。投影不改数据源，仍是同一份快照。
				 */
				const wantScripts = query.get("scripts") === "1";
				sendJson(res, 200, wantScripts ? snap : { ...snap, scripts: [] });
				return true;
			}
			case "PUT /api/cardfront": {
				const body = JSON.parse(await readBody(req)) as { enabled?: boolean };
				if (typeof body.enabled !== "boolean") throw new Error("enabled 必须是布尔值");
				const config = loadConfig(host.cwd);
				writeJsonWithBackup(configPath(host.cwd), setSkinEnabled(config, config.card, body.enabled));
				sendJson(res, 200, { ok: true, enabled: body.enabled });
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
				// PNG 卡＝整份卡文件（图内嵌卡数据）；JSON 卡回落侧挂封面（同名 .png，工坊「应用」落的）
				let img = abs;
				if (!/\.png$/i.test(abs)) {
					img = coverSidecarOf(abs);
					if (!existsSync(img)) throw new Error("该卡没有立绘（PNG 卡或已设侧挂封面才有）");
				}
				/**
				 * 卡图＝整份卡文件（JSON 内嵌在 PNG 里），单张动辄几 MB，必须真缓存住。
				 *
				 * 缓存键归服务端一处：ETag 取 mtime，浏览器带 If-None-Match 回来就发 304。
				 * 调用方因此**不需要**在 URL 上拼任何缓存参数——先前 App 拼 `&t=Date.now()`、
				 * CardPanel 不拼，同一张图成了两个 URL，一次加载把 4.8MB 下了两遍且永不命中缓存。
				 * 两处各造一份 URL 就会各错各的；判据只留一份，调用方拼不错。
				 *
				 * 不再发 immutable：那会让换过卡图的封面最多 7 天不更新（既有缺陷）。
				 * 改为每次条件请求——命中就是一个 304 空响应，比重下几 MB 便宜几个数量级。
				 */
				let mtime = 0;
				try {
					mtime = statSync(img).mtimeMs;
				} catch {
					/* ignore */
				}
				const etag = `"${mtime.toString(16)}"`;
				// 反代（nginx 等）可能把 ETag 弱化成 W/"…"，剥掉再比，否则条件请求永远不命中
				const inm = (req.headers["if-none-match"] ?? "").replace(/^W\//, "").trim();
				if (inm === etag) {
					res.writeHead(304, { etag, "cache-control": "no-cache" });
					res.end();
					return true;
				}
				res.writeHead(200, {
					"content-type": "image/png",
					"cache-control": "no-cache",
					etag,
				});
				res.end(readFileSync(img));
				return true;
			}
			case "POST /api/cards": {
				// 用户自己新建一张角色卡（8/29）。与 agent 的 card_create 共用 createCardFile。
				// 只要卡名 + 开场白：其余字段留空，之后用现成的编辑界面（PUT /api/card、greetings 那套）慢慢写。
				// 不切当前卡——新卡出现在卡库里由用户自己打开（与 card_create 语义一致）。
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as {
					name?: string;
					firstMes?: string;
					description?: string;
					personality?: string;
					scenario?: string;
				};
				const cardName = (body.name ?? "").trim();
				if (!cardName) throw new Error("缺少卡名");
				const firstMes = (body.firstMes ?? "").trim();
				if (!firstMes) throw new Error("缺少开场白——新会话的首条消息，卡没有它开不了场");
				const made = createCardFile(host.cwd, {
					name: cardName,
					firstMes,
					...(body.description?.trim() ? { description: body.description.trim() } : {}),
					...(body.personality?.trim() ? { personality: body.personality.trim() } : {}),
					...(body.scenario?.trim() ? { scenario: body.scenario.trim() } : {}),
				});
				if (!made) throw new Error(`同名角色卡已存在：${cardName}`);
				host.notify("info", `角色卡「${made.name}」已新建——在卡库里打开它就能开演`);
				sendJson(res, 200, { ok: true, name: made.name, path: made.path });
				return true;
			}
			case "POST /api/cards/import": {
				const rawName = (query.get("name") ?? "").trim();
				if (!rawName || !/\.(png|json)$/i.test(rawName)) throw new Error("文件名必须以 .png 或 .json 结尾");
				const safe = rawName.replace(/[\\/:*?"<>|]/g, "-");
				const dir = join(host.cwd, "assets", "cards");
				mkdirSync(dir, { recursive: true });
				const dest = join(dir, safe);
				// 同名不覆盖：暂存里没有（导入后即升格清空），也要查已升格的卡空间
				if (existsSync(dest) || listCardSpaces(host.cwd).some((s) => basename(s.cardFile) === safe)) {
					throw new Error(`同名卡已存在：${safe}`);
				}
				const data = await readBodyRaw(req, MAX_UPLOAD);
				if (data.length === 0) throw new Error("文件内容为空");
				writeFileSync(dest, data);
				let card: ReturnType<typeof loadCardFile>;
				try {
					card = loadCardFile(dest);
					if (!card.name.trim()) throw new Error("卡名为空");
				} catch (e) {
					try {
						unlinkSync(dest); // 坏卡不留盘
					} catch {
						/* ignore */
					}
					throw new Error(`不是有效的角色卡：${e instanceof Error ? e.message : String(e)}`);
				}
				// 落库即建卡空间：暂存 → cards/<卡名>/。升格失败留在暂存，仍是一张可用的旧布局卡。
				let rel = `assets/cards/${safe}`;
				try {
					const space = createCardSpace(host.cwd, dest, card.name, { move: true });
					rel = `${CARDS_ROOT}/${space.folder}/${basename(space.cardFile)}`;
				} catch (err) {
					console.error(`[liyuan] 导入卡升格失败（留在暂存）：${err instanceof Error ? err.message : String(err)}`);
				}
				host.notify("info", `已导入角色卡「${card.name}」`);
				sendJson(res, 200, {
					ok: true,
					path: rel,
					name: card.name,
					embeddedLoreCount: card.book.length,
				});
				return true;
			}
			/**
			 * 删除角色卡。query：
			 * - path：卡库内相对路径（必填）
			 * - lore=1：连同配套世界书（assets/lorebooks/<卡名>.json 及 -N 变体）一起删并取消挂载
			 * - data=1：连同相关数据（该卡全部会话、补充设定集、persona 卡锁定）一起删；
			 *   不带则数据保留，重新导入同路径同名卡可无缝续玩
			 * 删除当前使用中的卡：先自动切到默认卡（或卡库剩余第一张），最后一张卡拒删。
			 */
			case "DELETE /api/cards": {
				if (refuseWhileStreaming()) return true;
				const p = query.get("path") ?? "";
				const wantLore = query.get("lore") === "1";
				const wantData = query.get("data") === "1";
				let config = loadConfig(host.cwd);
				const abs = assertLibraryCard(host.cwd, config, p);
				let cardName = basename(p).replace(/\.(png|json)$/i, "");
				try {
					cardName = loadCardFile(abs).name || cardName;
				} catch {
					// 坏卡也允许删，名字退回文件名
				}
				const isCurrent = !!config.card && resolvePath(host.cwd, config.card) === abs;

				// 删当前卡：先切走（默认卡优先，其次卡库剩余第一张；没有可去处则拒绝）
				let switchedTo: string | null = null;
				if (isCurrent) {
					const others = listCardLibrary(host.cwd, config).filter((c) => resolvePath(host.cwd, c.path) !== abs);
					const fallback = others.find((c) => c.path === DEFAULT_CONFIG.card) ?? others[0];
					if (!fallback) throw new Error("这是卡库里最后一张卡，删掉就没有可用角色了：请先导入其它卡");
					// 兜底卡若还在导入暂存：同切换路径升格（与 selectCard 同一机制，各自幂等）
					const fallbackPath =
						promoteStagedCard(host.cwd, projectSessionDir(host.cwd, host.agentDir()), fallback.path) ?? fallback.path;
					const raw = config as unknown as Record<string, unknown>;
					delete raw.displayName;
					delete raw.greetingIndex;
					raw.card = fallbackPath;
					writeJsonWithBackup(configPath(host.cwd), raw);
					const persona = personaForCard(loadPersonas(host.cwd), fallbackPath);
					if (persona) projectPersonaToConfig(host.cwd, persona);
					await host.switchToCard();
					switchedTo = fallbackPath;
					config = loadConfig(host.cwd);
				}

				// 卡本体（JSON 卡的侧挂封面跟着卡走，留着就是孤儿裸图）
				unlinkSync(abs);
				const sidecar = coverSidecarOf(abs);
				if (sidecar !== abs && existsSync(sidecar)) unlinkSync(sidecar);
				cardMetaCache.delete(abs);
				const favs = loadFavs(host.cwd);
				if (favs.includes(p)) {
					saveFavs(host.cwd, favs.filter((f) => f !== p));
				}

				// 配套世界书：与 import-embedded-lore 同一命名推导（<卡名>.json / <卡名>-N.json）
				let deletedLore = 0;
				if (wantLore) {
					const safeBase = cardName.replace(/[\\/:*?"<>|]/g, "-").trim() || "card-lore";
					const rx = new RegExp(`^${safeBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(-\\d+)?\\.json$`, "i");
					const dir = join(host.cwd, LOREBOOKS_DIR);
					const gone: string[] = [];
					if (existsSync(dir)) {
						for (const f of readdirSync(dir)) {
							if (!rx.test(f)) continue;
							try {
								unlinkSync(join(dir, f));
								gone.push(`${LOREBOOKS_DIR}/${f}`);
							} catch {
								// 删不掉的留着，挂载也别拆
							}
						}
					}
					if (gone.length > 0) {
						const mounted = mountedLorebookPaths(config).filter((m) => !gone.includes(m));
						writeJsonWithBackup(configPath(host.cwd), setMountedLorebooks(config, mounted));
						await host.softRefreshConfig();
					}
					deletedLore = gone.length;
				}

				// 相关数据：会话 + 补充设定集 + persona 卡锁定（保留则重新导入同路径卡即无缝续玩）
				let deletedSessions = 0;
				if (wantData) {
					deletedSessions = await host.deleteCardSessions(p);
					const overlay = overlayPathFor(host.cwd, cardName, config.card);
					if (existsSync(overlay)) {
						try {
							unlinkSync(overlay);
						} catch {
							/* 不挡 */
						}
					}
					const pstore = loadPersonas(host.cwd);
					if (pstore.byCard[p]) {
						const byCard = { ...pstore.byCard };
						delete byCard[p];
						savePersonas(host.cwd, { ...pstore, byCard });
					}
				}

				host.notify(
					"info",
					`已删除角色卡「${cardName}」${wantLore && deletedLore > 0 ? `，配套世界书 ${deletedLore} 本` : ""}${wantData ? `，相关数据（会话 ${deletedSessions} 个）` : "（数据保留，重新导入可续玩）"}${switchedTo ? `；已切换到「${basename(switchedTo)}」` : ""}`,
				);
				sendJson(res, 200, { ok: true, deletedLore, deletedSessions, switchedTo });
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
				const r = await host.applyStatePatch(body.patch);
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
				// 新鲜度归服务端：头像文件名按 id 固定（每次上传覆盖同名文件），
				// URL 拼不上内容键——ETag 取 mtime，条件请求回 304，换头像立即可见。
				// 此前 max-age=3600 会被调用方的 bust 参数整个废掉（两个假设相反）。
				let mtime = 0;
				try {
					mtime = statSync(abs).mtimeMs;
				} catch {
					/* ignore */
				}
				const etag = `"${mtime.toString(16)}"`;
				// 反代可能把 ETag 弱化成 W/"…"，剥掉再比
				const inm = (req.headers["if-none-match"] ?? "").replace(/^W\//, "").trim();
				if (inm === etag) {
					res.writeHead(304, { etag, "cache-control": "no-cache" });
					res.end();
					return true;
				}
				res.writeHead(200, {
					"content-type": isPng ? "image/png" : "image/jpeg",
					"cache-control": "no-cache",
					etag,
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
				const modes = readPresetModes(host.cwd);
				sendJson(res, 200, {
					active: config.preset ?? null,
					presets: listPresetFiles(host.cwd).map((p) => ({ ...p, mode: modes[p.name] ?? "declare" })),
				});
				return true;
			}
			/** 机制自选（2026-09-14 用户定案）：declare＝声明分类（默认，30 秒级）；process＝模型处理（分钟级，产物两条） */
			case "PUT /api/presets/mode": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { file?: string; mode?: string };
				const file = validatePresetPath(body.file ?? "");
				if (body.mode !== "declare" && body.mode !== "process") throw new Error("mode 必须是 declare 或 process");
				if (!existsSync(resolvePath(host.cwd, file))) throw new Error(`预设文件不存在：${file}`);
				setPresetMode(host.cwd, presetNameFromFile(file), body.mode);
				const config = loadConfig(host.cwd);
				if (config.preset === file) await host.softRefreshConfig();
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "POST /api/presets/select": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { file?: string | null; redeclare?: boolean };
				// 切换（含“丢弃未保存草稿”）归 selectPresetFile，与 preset_select 工具共用
				if (!selectPresetFile(host.cwd, body.file ?? null)) throw new Error("预设文件不存在");
				// 重新装载按机制分流：声明＝丢弃声明缓存全部重问（30 秒级）；
				// 处理＝强制重跑处理模型（分钟级，按钮在等、完成有 toast）。
				// 处理机制的普通装载（首装缺留档）也跑一次——用户正盯着按钮。
				let reprocess = false;
				if (body.file) {
					const name = presetNameFromFile(body.file);
					if (presetModeOf(host.cwd, name) === "process") {
						reprocess = body.redeclare === true || !readProcessStore(processStorePath(host.cwd, name));
					} else if (body.redeclare) {
						const declAbs = declarationPath(host.cwd, name);
						if (existsSync(declAbs)) {
							try {
								unlinkSync(declAbs);
							} catch {
								/* ignore */
							}
						}
					}
				}
				await host.softRefreshConfig(reprocess ? { reprocessPreset: true } : undefined);
				sendJson(res, 200, { ok: true });
				return true;
			}
			/**
			 * 库内任意预设的块视图（2026-09-14 用户点名：不装载也能展开拨开关）。
			 * 活动预设读生效态（草稿优先），其余读磁盘原版。
			 */
			case "GET /api/presets/blocks": {
				const file = validatePresetPath(query.get("file") ?? "");
				const config = loadConfig(host.cwd);
				const isActive = config.preset === file;
				let doc: PresetDoc | null = null;
				if (isActive) {
					doc = loadEffectivePreset(host.cwd).doc;
				} else {
					const abs = resolvePath(host.cwd, file);
					if (!existsSync(abs)) throw new Error(`预设文件不存在：${file}`);
					doc = readPresetDoc(host.cwd, file);
				}
				if (!doc) throw new Error(`预设文件不存在：${file}`);
				sendJson(res, 200, {
					file,
					active: isActive,
					dirty: isActive && existsSync(presetOverridePath(host.cwd)),
					name: doc.name,
					blocks: presetDocView(doc, { full: true }),
				});
				return true;
			}
			/**
			 * 拨库内任意预设的块开关。活动预设＝打进运行时草稿并即时重转译（与 PUT /api/preset 同语义，
			 * 「保存」才落盘）；其余＝直接写原版文件（未装载，不上台，无需刷新）。
			 */
			case "PUT /api/presets/blocks": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { file?: string; blocks?: PresetBlockPatch[] };
				const file = validatePresetPath(body.file ?? "");
				if (!Array.isArray(body.blocks) || body.blocks.length === 0) throw new Error("缺少 blocks");
				const abs = resolvePath(host.cwd, file);
				if (!existsSync(abs)) throw new Error(`预设文件不存在：${file}`);
				const config = loadConfig(host.cwd);
				if (config.preset === file) {
					writePresetDraft(host.cwd, { blocks: body.blocks });
					await host.softRefreshConfig();
					sendJson(res, 200, { ok: true, dirty: true });
					return true;
				}
				const base = readPresetDoc(host.cwd, file);
				writeJsonWithBackup(abs, patchPresetRaw(base, { blocks: body.blocks }));
				sendJson(res, 200, { ok: true, dirty: false });
				return true;
			}
			case "POST /api/presets/saveas": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { name?: string };
				const name = (body.name ?? "").trim();
				if (!name) throw new Error("缺少预设名");
				// 另存：取当前生效原文（含未保存草稿），整份复制到新文件；名字＝新文件名
				const current = loadEffectivePreset(host.cwd).doc?.raw ?? {};
				const file = `${PRESETS_DIR}/${presetSlug(name)}.json`;
				const abs = resolvePath(host.cwd, file);
				if (existsSync(abs)) throw new Error(`同名预设文件已存在：${file}`);
				mkdirSync(join(host.cwd, PRESETS_DIR), { recursive: true });
				clearPresetOverride(host.cwd);
				writeJsonWithBackup(abs, current);
				writeJsonWithBackup(configPath(host.cwd), { ...loadConfig(host.cwd), preset: file });
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, file });
				return true;
			}
			// 重命名＝重命名文件（预设名就是文件名，原文一个字节不动）
			case "POST /api/presets/rename": {
				const body = JSON.parse(await readBody(req)) as { file?: string; name?: string };
				const file = validatePresetPath(body.file ?? "");
				const name = (body.name ?? "").trim();
				if (!name) throw new Error("缺少新名字");
				const abs = resolvePath(host.cwd, file);
				if (!existsSync(abs)) throw new Error("预设文件不存在");
				const nextFile = `${PRESETS_DIR}/${presetSlug(name)}.json`;
				if (nextFile === file) {
					sendJson(res, 200, { ok: true, file });
					return true;
				}
				const nextAbs = resolvePath(host.cwd, nextFile);
				if (existsSync(nextAbs)) throw new Error(`同名预设文件已存在：${nextFile}`);
				mkdirSync(join(host.cwd, PRESETS_DIR), { recursive: true });
				renameSync(abs, nextAbs);
				const config = loadConfig(host.cwd);
				if (config.preset === file) {
					writeJsonWithBackup(configPath(host.cwd), { ...config, preset: nextFile });
					await host.softRefreshConfig();
				}
				sendJson(res, 200, { ok: true, file: nextFile });
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
					clearPresetOverride(host.cwd);
					delete config.preset;
					writeJsonWithBackup(configPath(host.cwd), config);
					await host.softRefreshConfig();
				}
				sendJson(res, 200, { ok: true });
				return true;
			}
			// 导入：**原文原样落盘**，不转换、不分拣、不判断（PLAN-PRESET-PIPELINES §四之一）
			case "POST /api/presets/import": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { name?: string; json?: Record<string, unknown> };
				if (!body.json || typeof body.json !== "object") throw new Error("缺少预设 JSON");
				const name = (body.name ?? "").trim() || "imported-preset";
				const file = `${PRESETS_DIR}/${presetSlug(name)}.json`;
				const abs = resolvePath(host.cwd, file);
				mkdirSync(join(host.cwd, PRESETS_DIR), { recursive: true });
				clearPresetOverride(host.cwd);
				writeJsonWithBackup(abs, body.json);
				writeJsonWithBackup(configPath(host.cwd), { ...loadConfig(host.cwd), preset: file });
				await host.softRefreshConfig();
				const doc = loadPresetDoc(body.json, presetNameFromFile(file));
				sendJson(res, 200, {
					ok: true,
					file,
					kind: doc.kind,
					blockCount: doc.entries.length,
					enabledCount: doc.entries.filter((e) => e.enabled).length,
				});
				return true;
			}
			// 导出：原文原样吐回（酒馆能直接吃回去）
			case "GET /api/presets/export": {
				const file = validatePresetPath(query.get("file") ?? "");
				const abs = resolvePath(host.cwd, file);
				sendJson(res, 200, { name: presetNameFromFile(file), json: JSON.parse(readFileSync(abs, "utf8")) });
				return true;
			}
			// ---- 用户提示词（刀2/前端重构）：SYSTEM.md + 两级 APPEND_SYSTEM.md ----
			case "GET /api/rules": {
				const config = loadConfig(host.cwd);
				const cardDir = dirname(resolvePath(host.cwd, config.card));
				const rules = readUserRules(cardDir);
				sendJson(res, 200, {
					global: { content: rules.global, path: globalRulesPath() },
					agent: { content: rules.agent, path: agentRulesPath() },
					card: { content: rules.card, path: cardRulesPath(cardDir), cardName: config.displayName ?? basename(config.card).replace(/\.(png|json)$/i, "") },
					system: { content: existsSync(systemPromptPath()) ? readFileSync(systemPromptPath(), "utf8") : "", path: systemPromptPath() },
				});
				return true;
			}
			case "PUT /api/rules": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { scope?: string; content?: string };
				if (typeof body.content !== "string") throw new Error("缺少 content");
				const config = loadConfig(host.cwd);
				let abs: string;
				if (body.scope === "system") {
					abs = systemPromptPath();
					mkdirSync(rulesAgentDir(), { recursive: true });
				} else if (body.scope === "global") {
					abs = globalRulesPath();
					mkdirSync(rulesAgentDir(), { recursive: true });
				} else if (body.scope === "agent") {
					abs = agentRulesPath();
					mkdirSync(rulesAgentDir(), { recursive: true });
				} else if (body.scope === "card") {
					const cardDir = dirname(resolvePath(host.cwd, config.card));
					mkdirSync(cardDir, { recursive: true });
					abs = cardRulesPath(cardDir);
				} else {
					throw new Error("scope 必须是 system、global、agent 或 card");
				}
				writeFileSync(abs, body.content, "utf8");
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, path: abs, chars: body.content.length });
				return true;
			}
			// ---- 卡档案 AGENTS.md（刀3，docs/PLAN-AGENT-SLOTS.md §七）：文件为准 / 投影兜底 ----
			case "GET /api/card-agents": {
				const config = loadConfig(host.cwd);
				const cardDir = dirname(resolvePath(host.cwd, config.card));
				const abs = cardAgentsPath(cardDir);
				const content = existsSync(abs) ? readFileSync(abs, "utf8") : "";
				const materials = loadStageMaterials(host.cwd);
				// 生效投影（diff 基准）：跑的就是装配那条路——协议判死/归属剥离都已在内；
				// 蓝灯小节标题带 `（世界书·书名）`，与档案里的镜像条目同一形态（syncLorebookMirror）
				const bookOf = bookOfEntries(mountedLorebookPaths(config).map((rel) => resolvePath(host.cwd, rel)));
				const projection = projectCardToAgents(materials.card, constantLoreOf(materials), config, { bookOf });
				// 生成素材：只给卡自己的内容——世界书由镜像同步持有，助手不必也不该把书抄进档案
				const unfilteredProjection = projectCardToAgents(materials.card, [], config);
				sendJson(res, 200, {
					exists: existsSync(abs),
					active: content.trim() ? "file" : "projection",
					content,
					projection,
					unfilteredProjection,
					/** 被运行时判死/归属剥离的条目（判定数据可改，见世界书面板） */
					droppedTitles: materials.protocolDrops.map((d) => `${d.title}（${d.label}）`),
					path: abs,
					cardName: config.displayName ?? basename(config.card).replace(/.(png|json)$/i, ""),
				});
				return true;
			}
			case "PUT /api/card-agents": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { content?: string };
				if (typeof body.content !== "string") throw new Error("缺少 content");
				const config = loadConfig(host.cwd);
				const cardDir = dirname(resolvePath(host.cwd, config.card));
				mkdirSync(cardDir, { recursive: true });
				const abs = cardAgentsPath(cardDir);
				writeFileSync(abs, body.content, "utf8");
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, path: abs, chars: body.content.length });
				return true;
			}
			/** 删除卡档案 ⇒ 回到自动投影（可随时重新生成） */
			case "DELETE /api/card-agents": {
				if (refuseWhileStreaming()) return true;
				const config = loadConfig(host.cwd);
				const abs = cardAgentsPath(dirname(resolvePath(host.cwd, config.card)));
				if (existsSync(abs)) unlinkSync(abs);
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true });
				return true;
			}
			/** 刀2 整份收入（无界面入口，留给 REST 调用方）；装载态的自动转译见 syncPresetTranslation */
			case "POST /api/presets/translate": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { file?: string; overwrite?: boolean };
				const file = validatePresetPath(body.file ?? "");
				const abs = resolvePath(host.cwd, file);
				if (!existsSync(abs)) throw new Error(`预设文件不存在：${file}`);
				const config = loadConfig(host.cwd);
				const cardDir = dirname(resolvePath(host.cwd, config.card));
				const card = loadCardFile(resolvePath(host.cwd, config.card));
				const doc = loadPresetDoc(JSON.parse(readFileSync(abs, "utf8")), presetNameFromFile(file));

				const r = translatePresetToRules(doc, { charName: card.name, userName: config.userName });

				const target = cardRulesPath(cardDir);
				if (existsSync(target) && body.overwrite !== true) {
					sendJson(res, 200, { ok: false, exists: true, path: target });
					return true;
				}
				mkdirSync(cardDir, { recursive: true });
				writeFileSync(target, r.markdown, "utf8");

				const reportAbs = join(cardDir, ".liyuan", `转译报告-${presetSlug(presetNameFromFile(file))}.md`);
				mkdirSync(dirname(reportAbs), { recursive: true });
				writeFileSync(reportAbs, translateReport(doc, r, file), "utf8");

				// config：preset 指针清空；samplers 迁入（有值才写，空则连键一起删）
				const next = applyConfigPatch(config, {
					preset: null,
					...(Object.keys(r.samplers).length > 0 ? { samplers: r.samplers } : { samplers: null }),
				});
				writeJsonWithBackup(configPath(host.cwd), next);
				clearPresetOverride(host.cwd);
				await host.softRefreshConfig();
				sendJson(res, 200, {
					ok: true,
					chars: r.markdown.length,
					lines: r.lines.length,
					prefillDropped: r.lines.filter((l) => l.action === "dropped-prefill").length,
					markersSkipped: r.lines.filter((l) => l.action === "skipped-marker").length,
					samplersMoved: Object.keys(r.samplers).length,
					path: target,
					report: reportAbs,
				});
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
			/**
			 * 协议判定（刀4）：对一本书跑一遍检测并落成/刷新判定文件。
			 * 返回判定概要；判 0 条时删除既有判定文件（回到不过滤）。
			 */
			case "POST /api/lorebooks/declare": {
				const body = JSON.parse(await readBody(req)) as { path?: string };
				const p = (body.path ?? "").trim();
				if (!p) throw new Error("缺少 path");
				const abs = resolvePath(host.cwd, p);
				if (!existsSync(abs)) throw new Error(`世界书不存在：${p}`);
				const before = readDeclaration(abs)?.entries.length ?? 0;
				const declaration = writeDeclarationFromDetection(abs);
				const count = declaration?.entries.length ?? 0;
				if (!declaration) removeDeclaration(abs);
				await host.softRefreshConfig();
				sendJson(res, 200, {
					ok: true,
					declared: count,
					changed: count !== before,
					note: count > 0 ? `已判定停用 ${count} 条（书旁 ${p}.判定.json，可改可删）` : "未发现协议条目（如曾判定过，判定文件已删——本书不过滤）",
				});
				return true;
			}
			case "POST /api/lorebooks": {
				// 用户手动新建一本世界书（8/29）。与 agent 的 lorebook_create 共用 createLorebookWithEntry。
				// 首条必填：空书挂不上、也不会出现在书单里（见该函数注释），造出来就是孤儿文件。
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as {
					name?: string;
					mount?: boolean;
					first?: { title?: string; keys?: string[]; content?: string; constant?: boolean };
				};
				const name = (body.name ?? "").trim();
				if (!name) throw new Error("缺少书名");
				const f = body.first;
				const content = (f?.content ?? "").trim();
				if (!content) throw new Error("请写第一条条目的正文——空书挂不上，也不会出现在书单里");
				const created = createLorebookWithEntry(
					host.cwd,
					loadConfig(host.cwd),
					name,
					{
						comment: (f?.title ?? "").trim() || name,
						keys: Array.isArray(f?.keys) ? f.keys.filter((k) => typeof k === "string" && k.trim()) : [],
						content,
						...(typeof f?.constant === "boolean" ? { constant: f.constant } : {}),
					},
					{ mount: body.mount !== false },
				);
				if (!created) throw new Error(`同名世界书已存在：${name}`);
				await host.softRefreshConfig(); // 挂载变化影响注入，须重装
				const didMount = created.mounted.includes(created.path);
				host.notify("info", `世界书「${name}」已新建${didMount ? "并挂载" : "（未挂载）"}`);
				sendJson(res, 200, { ok: true, path: created.path, mounted: created.mounted, didMount });
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

			case "GET /api/card/authoring": {
				const path = currentCardPath(host.cwd, loadConfig(host.cwd));
				const requested = query.get("card");
				if (requested && resolvePath(host.cwd, requested) !== path) throw new Error("当前角色卡已切换");
				sendJson(res, 200, inspectCardProject(host.cwd, path));
				return true;
			}
			// 待换封面的图像（工坊预览用）；没有待换封面时 404
			case "GET /api/card/authoring/cover": {
				const path = currentCardPath(host.cwd, loadConfig(host.cwd));
				const cover = readCardCover(host.cwd, path);
				if (!cover) { sendJson(res, 404, { error: "没有待换封面" }); return true; }
				res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
				res.end(cover);
				return true;
			}
			// 页面回报 agent 预览：事件列表 + 是否就绪
			case "POST /api/card/authoring/preview-report": {
				const body = JSON.parse(await readBody(req)) as Partial<CardPreviewReport>;
				if (typeof body.id !== "string" || !Array.isArray(body.events)) throw new Error("预览回报格式不对");
				const events = body.events.filter((e): e is CardPreviewReport["events"][number] =>
					!!e && typeof e === "object" && typeof (e as { level?: unknown }).level === "string" && typeof (e as { message?: unknown }).message === "string")
					.slice(0, 200).map((e) => ({ level: e.level, source: typeof e.source === "string" ? e.source : "预览", message: e.message.slice(0, 8000) }));
				sendJson(res, 200, { accepted: host.settleCardPreview({ id: body.id, ready: body.ready === true, events }) });
				return true;
			}
			case "POST /api/card/authoring":
			case "POST /api/card/authoring/preview": {
				const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
				const config = loadConfig(host.cwd);
				const path = currentCardPath(host.cwd, config);
				if (typeof body.card !== "string" || resolvePath(host.cwd, body.card) !== path) throw new Error("当前角色卡已切换，请重新打开创作稿");
				if (route === "POST /api/card/authoring/preview") {
					sendJson(res, 200, previewCardProject(host.cwd, path, config.userName));
				} else {
					const applying = body.action === "apply" || body.action === "undo";
					if (applying && refuseWhileStreaming()) return true;
					const result = body.action === "preview" ? await host.runCardPreview(body) : cardProjectOperation(host.cwd, path, body);
					if (applying) await host.softRefreshConfig();
					sendJson(res, 200, result);
				}
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
				// 打开连接面板时：agent.json → models.json，并重绑当前模型（手改 maxTokens 等无需整进程重启）
				(await loadOrSeedAgentConfig(host));
				await rebindCurrentModel(host);
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
				await host.setAuthKey(body.provider, body.key.trim());
				await host.refreshModels();
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "DELETE /api/auth": {
				const provider = query.get("provider");
				if (!provider) throw new Error("缺少 provider");
				await host.removeAuth(provider);
				await host.refreshModels();
				sendJson(res, 200, { ok: true });
				return true;
			}
			// ---- 配置仓库 liyuan-profiles/ + 当前启用 liyuan.agent.json ----
			case "GET /api/agent-profiles": {
				(await loadOrSeedAgentConfig(host)); // 触发迁移
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
				// 若正在启用这份，同步到 runtime 并重绑当前模型（contextWindow 等）
				const active = listProfiles(host.cwd).find((p) => p.active);
				if (active?.id === id) {
					await persistAgentConfig(host, config);
					await rebindCurrentModel(host);
				}
				host.notify("info", `配置「${rec.name}」已更新`);
				sendJson(res, 200, {
					ok: true,
					profile: { id: rec.id, name: rec.name, updatedAt: rec.updatedAt },
					profiles: listProfiles(host.cwd),
					current: host.listModels().current,
				});
				return true;
			}
			case "POST /api/agent-profiles/enable":
			case "POST /api/agent-profiles/refresh": {
				// enable：启用仓库配置；refresh：已启用时从仓库/磁盘重读并重传到 models.json（不必先关再开）
				const isRefresh = route === "POST /api/agent-profiles/refresh";
				const body = JSON.parse(await readBody(req)) as { id?: string };
				const id = (body.id ?? "").trim();
				if (!id) throw new Error("缺少 id");
				if (isRefresh) {
					const active = listProfiles(host.cwd).find((p) => p.active);
					if (active?.id !== id) {
						throw new Error("只能刷新「启用中」的配置；其它配置请先点启用");
					}
				}
				const config = enableProfile(host.cwd, host.agentDir(), id);
				await host.refreshModels();
				// 切换到配置里的默认模型
				if (config.defaultProvider && config.defaultModel) {
					try {
						await host.selectModel(config.defaultProvider, config.defaultModel);
					} catch {
						/* 模型可能暂不可用 */
					}
				}
				// 模型条目 thinkingLevel > defaultThinkingLevel → 会话当前生效
				await rebindCurrentModel(host, config);
				host.notify("info", isRefresh ? `已刷新配置「${id}」并重传到运行时` : `已启用配置「${id}」`);
				sendJson(res, 200, {
					ok: true,
					refreshed: isRefresh,
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
				const { path, exists, config, seeded } = (await loadOrSeedAgentConfig(host));
				await rebindCurrentModel(host);
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
				const config = await persistAgentConfig(host, normalizeAgentConfig(parsed));
				await rebindCurrentModel(host);
				host.notify("info", "当前 Agent 配置已保存");
				sendJson(res, 200, {
					ok: true,
					path: loadAgentConfig(host.cwd).path,
					config,
					text: `${JSON.stringify(config, null, "\t")}\n`,
					current: host.listModels().current,
				});
				return true;
			}
			// 兼容旧路径：转发到 agent-config
			case "GET /api/models-json": {
				const { path, exists, config, seeded } = (await loadOrSeedAgentConfig(host));
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
				const config = await persistAgentConfig(host, normalizeAgentConfig(parsed));
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
				const { config } = (await loadOrSeedAgentConfig(host));
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
				await persistAgentConfig(host, config);
				host.notify("info", `渠道「${name}」已保存（${models.length} 个模型）`);
				sendJson(res, 200, { ok: true, channel: publicProvider(name, entry), config });
				return true;
			}
			case "GET /api/channels": {
				const { path, config, seeded } = (await loadOrSeedAgentConfig(host));
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
				const { config } = (await loadOrSeedAgentConfig(host));
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
					ch.models = body.mergeModels ? mergeModelEntries(normalizeModels(ch.models), incoming) : incoming;
				}
				config.providers[name] = ch;
				if (body.setDefault) {
					config.defaultProvider = name;
					const mid = normalizeModels(ch.models)[0]?.id;
					if (mid) config.defaultModel = mid;
				}
				await persistAgentConfig(host, config);
				sendJson(res, 200, { ok: true, channel: publicProvider(name, ch), config });
				return true;
			}
			case "DELETE /api/channels": {
				const name = (query.get("name") ?? "").trim();
				const { config } = (await loadOrSeedAgentConfig(host));
				if (!config.providers[name]) throw new Error(`渠道不存在：${name}`);
				delete config.providers[name];
				if (config.defaultProvider === name) {
					const first = Object.keys(config.providers)[0];
					config.defaultProvider = first;
					config.defaultModel = first ? normalizeModels(config.providers[first].models)[0]?.id : undefined;
				}
				await persistAgentConfig(host, config);
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
					const ch = (await loadOrSeedAgentConfig(host)).config.providers[name];
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
				const loaded = name ? (await loadOrSeedAgentConfig(host)) : null;
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
					ch.models = mergeModelEntries(normalizeModels(ch.models), models);
					loaded.config.providers[name] = ch;
					await persistAgentConfig(host, loaded.config);
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
				// 验卡 / 写盘 / 清随卡字段 / 身份投影 / 切会话 都在 selectCard 里（与 card_switch 工具共用）
				const r = await selectCard(host.cwd, host, cardPath);
				host.notify(
					"info",
					`${r.result === "switched" ? `已切换到「${r.name}」的最近会话` : `已为「${r.name}」新建会话`}${r.persona ? `（身份：${r.persona}）` : ""}`,
				);
				sendJson(res, 200, {
					result: r.result,
					name: r.name,
					path: r.path,
					embeddedLoreCount: r.embeddedLoreCount,
					promoted: r.promoted,
				});
				return true;
			}
			/**
			 * 把当前卡（或指定卡）的内嵌 character_book 另存为独立世界书并挂到配置。
			 * 卡内嵌书仍会随卡加载；另存后可在世界书面板管理、跨卡复用。
			 */
			case "POST /api/card/import-embedded-lore": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as {
					card?: string;
					mount?: boolean;
					cards?: Array<{ card: string; mount?: boolean }>;
				};
				const config = loadConfig(host.cwd);
				const targets: Array<{ card: string; mount: boolean }> = [];
				if (Array.isArray(body.cards) && body.cards.length > 0) {
					for (const c of body.cards) {
						if (typeof c?.card === "string" && c.card.trim()) {
							targets.push({ card: c.card.trim(), mount: c.mount !== false });
						}
					}
				} else {
					const singleCard = (body.card ?? config.card).trim();
					if (singleCard) {
						targets.push({ card: singleCard, mount: body.mount !== false });
					}
				}

				const { results, nextConfig } = importEmbeddedLoreForCards(host.cwd, targets, config);

				if (nextConfig) {
					writeJsonWithBackup(configPath(host.cwd), nextConfig);
					await host.softRefreshConfig();
				}

				if (results.length === 1) {
					const one = results[0];
					host.notify(
						"info",
						`已导入配套世界书「${one.name}」（${one.entryCount} 条）${one.mounted ? "并加入挂载" : ""}`,
					);
					sendJson(res, 200, {
						ok: true,
						path: one.path,
						entryCount: one.entryCount,
						name: one.name,
						mounted: one.mounted,
						results,
					});
				} else {
					const mountedCount = results.filter((r) => r.mounted).length;
					host.notify(
						"info",
						`已导入 ${results.length} 本配套世界书${mountedCount > 0 ? `（其中 ${mountedCount} 本加入挂载）` : ""}`,
					);
					sendJson(res, 200, {
						ok: true,
						path: results[0].path,
						entryCount: results[0].entryCount,
						name: results[0].name,
						mounted: mountedCount > 0,
						results,
					});
				}
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
					const overlayPath = overlayPathFor(host.cwd, card.name, config.card);
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
				candidates.push({ abs: overlayPathFor(host.cwd, card.name, config.card), source: "agent" });
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
			 * 新增条目：写进指定世界书文件（body.path=书路径，或 "agent"=本卡补充设定）。
			 * 面板只必填标题 + 正文；关键词留空则从标题派生——绿灯条目没有 key 永远不会触发。
			 */
			case "POST /api/lorebook/entry": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as {
					path?: string;
					comment?: string;
					name?: string;
					content?: string;
					info?: string;
					keys?: string[];
					secondaryKeys?: string[];
					constant?: boolean;
					selective?: boolean;
					order?: number;
				};
				const comment = (body.comment ?? body.name ?? "").trim();
				const content = (body.content ?? body.info ?? "").trim();
				if (!comment) throw new Error("标题不能为空");
				if (!content) throw new Error("正文不能为空");
				const config = loadConfig(host.cwd);
				const card = loadCardFile(resolvePath(host.cwd, config.card));
				const target = (body.path ?? "").replace(/\\/g, "/").trim();
				let abs: string;
				let targetLabel: string;
				if (!target || target === "agent") {
					abs = overlayPathFor(host.cwd, card.name, config.card);
					targetLabel = "补充设定";
				} else {
					// 与 DELETE 同源：只认书单里的路径
					const known = listLorebookFiles(host.cwd, config);
					const hit = known.find((b) => b.path === target);
					if (!hit) throw new Error("不是已知的世界书文件");
					abs = resolvePath(host.cwd, target);
					targetLabel = hit.name;
				}
				const rawKeys = Array.isArray(body.keys)
					? body.keys.filter((k): k is string => typeof k === "string").map((k) => k.trim()).filter(Boolean)
					: [];
				const entry = appendLorebookFileEntry(abs, {
					comment,
					keys: rawKeys.length > 0 ? rawKeys : keysFromTitle(comment),
					content,
					secondaryKeys: Array.isArray(body.secondaryKeys)
						? body.secondaryKeys.filter((k): k is string => typeof k === "string")
						: [],
					constant: body.constant === true,
					selective: body.selective === true,
					order: typeof body.order === "number" ? body.order : undefined,
				});
				if (!entry) {
					sendJson(res, 200, { ok: true, duplicate: true, fingerprint: loreFingerprint(content) });
					return true;
				}
				await host.softRefreshConfig();
				host.notify("info", `已向「${targetLabel}」新增条目：${entry.comment}`);
				sendJson(res, 200, {
					ok: true,
					duplicate: false,
					fingerprint: loreFingerprint(entry.content),
					comment: entry.comment,
					keys: entry.keys,
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

				// 寻址（书单全部 + 补充设定）与 disabledLore 指纹迁移都在 patchLoreEntryAnywhere 里
				const result = patchLoreEntryAnywhere(host.cwd, config, fp, patch);
				if (!result) throw new Error("未找到可写条目（世界书可能已更换，或条目不在挂载书/补充设定中）");

				// constant / order / content 影响注入，重装会话
				await host.softRefreshConfig();
				host.notify("info", "世界书条目已保存");
				sendJson(res, 200, {
					ok: true,
					fingerprint: result.newFingerprint,
					constant: result.entry.constant,
					order: result.entry.order,
					path: result.path,
				});
				return true;
			}
			/**
			 * 删除条目：从源文件（独立世界书 / agent 补充设定）里移除该条。
			 * 与 PUT 同一寻址方式：按指纹扫全部书文件 + 补充设定，命中哪本删哪本。
			 * 传 ?path= 时只在该文件内删（避免多本书含同指纹条目时误删别本）。
			 */
			case "DELETE /api/lorebook/entry": {
				if (refuseWhileStreaming()) return true;
				const fp = (query.get("fp") ?? query.get("fingerprint") ?? "").trim();
				if (!fp) throw new Error("缺少条目 fingerprint");
				const pathQ = (query.get("path") ?? "").replace(/\\/g, "/").trim();
				const config = loadConfig(host.cwd);
				// 寻址（含 path=agent 只删补充设定）与停用清单清理都在 deleteLoreEntryAnywhere 里
				const r = deleteLoreEntryAnywhere(host.cwd, config, fp, pathQ || undefined);
				if (!r) throw new Error("未找到该条目（世界书可能已更换，或条目不在可写文件中）");
				await host.softRefreshConfig();
				host.notify("info", `已删除条目「${r.entry.comment || r.entry.keys[0] || fp}」`);
				sendJson(res, 200, { ok: true, comment: r.entry.comment, path: r.path });
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
				// 启用方向：光摘 disabledLore 恢复不了源文件里本就 disabled 的条目（导入即关闭是常态），
				// 必须把 enable 写回源文件——否则「启用」对这类条目是空操作。
				const enableCandidates = body.enabled
					? (() => {
							const card = loadCardFile(resolvePath(host.cwd, config.card));
							const paths = listLorebookFiles(host.cwd, config).map((b) => resolvePath(host.cwd, b.path));
							paths.push(overlayPathFor(host.cwd, card.name, config.card));
							return paths;
						})()
					: null;
				for (const fp of fps) {
					if (body.enabled) {
						disabled.delete(fp);
						if (enableCandidates) {
							for (const abs of enableCandidates) {
								if (!existsSync(abs)) continue;
								if (patchLorebookFileEntry(abs, fp, { enabled: true })) break;
							}
						}
					} else {
						disabled.add(fp);
					}
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
			/**
			 * GET：默认读**磁盘已保存**版（切换回来应看到原样）。
			 * ?full=1 附带每块 content；?working=1 则返回当前运行时草稿（若有）。
			 */
			case "GET /api/preset": {
				const config = loadConfig(host.cwd);
				if (!config.preset) {
					sendJson(res, 200, { preset: null, dirty: false });
					return true;
				}
				const wantWorking = query.get("working") === "1";
				const full = query.get("full") === "1";
				const loaded = wantWorking ? loadEffectivePreset(host.cwd) : loadDiskPreset(host.cwd);
				const doc = loaded?.doc ?? null;
				if (!doc) {
					sendJson(res, 200, { preset: null, missing: config.preset, dirty: existsSync(presetOverridePath(host.cwd)) });
					return true;
				}
				sendJson(res, 200, {
					path: loaded?.path ?? config.preset,
					dirty: existsSync(presetOverridePath(host.cwd)),
					preset: {
						name: doc.name,
						kind: doc.kind,
						samplers: doc.samplers,
						blocks: presetDocView(doc, { full }),
					},
				});
				return true;
			}
			/** 单块全文：优先草稿，否则磁盘 */
			case "GET /api/preset/block": {
				const id = (query.get("id") ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const { doc, path } = loadEffectivePreset(host.cwd);
				if (!doc) throw new Error(path ? `预设文件不存在：${path}` : "当前未配置预设文件");
				const block = presetDocBlock(doc, id);
				if (!block) throw new Error(`找不到提示词块：${id}`);
				sendJson(res, 200, block);
				return true;
			}
			/**
			 * PUT：只写入运行时草稿并热更新（**不落盘**）。
			 * 开关/改字立刻影响下一轮生成；点「保存」才写预设文件。
			 * 草稿与磁盘同格式（原文）：补丁打进原文，梨园不认识的键原样透传。
			 */
			case "PUT /api/preset": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as {
					samplers?: Record<string, number>;
					blocks?: PresetBlockPatch[];
				};
				const config = loadConfig(host.cwd);
				if (!config.preset) throw new Error("当前未配置预设文件");
				const base = loadEffectivePreset(host.cwd).doc ?? loadDiskPreset(host.cwd)?.doc;
				if (!base) throw new Error(`预设文件不存在：${config.preset}`);
				const next = patchPresetRaw(base, body);
				const ovr = presetOverridePath(host.cwd);
				mkdirSync(join(host.cwd, ".liyuan"), { recursive: true });
				writeFileSync(ovr, `${JSON.stringify(next, null, "\t")}\n`, "utf8");
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, dirty: true, saved: false });
				return true;
			}
			/** 把当前草稿（或请求体补丁）写入磁盘预设文件，并清除草稿标记 */
			case "POST /api/preset/save": {
				if (refuseWhileStreaming()) return true;
				const rawBody = await readBody(req).catch(() => "");
				const body = JSON.parse(rawBody.trim() || "{}") as {
					samplers?: Record<string, number>;
					blocks?: PresetBlockPatch[];
				};
				const config = loadConfig(host.cwd);
				if (!config.preset) throw new Error("当前未配置预设文件");
				const filePath = resolvePath(host.cwd, config.preset);
				const base = loadEffectivePreset(host.cwd).doc ?? loadDiskPreset(host.cwd)?.doc;
				if (!base) throw new Error(`预设文件不存在：${config.preset}`);
				const next = body.blocks || body.samplers ? patchPresetRaw(base, body) : base.raw;
				writeJsonWithBackup(filePath, next);
				clearPresetOverride(host.cwd);
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, dirty: false, saved: true, path: config.preset });
				return true;
			}
			/** 丢弃未保存草稿，从磁盘重载 */
			case "POST /api/preset/revert": {
				if (refuseWhileStreaming()) return true;
				savePresetDraft(host.cwd, false); // 与 preset_save(save=false) 共用一份
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, dirty: false });
				return true;
			}

			// ---- 在线更新 ----
			case "POST /api/update/check": {
				await host.updateCheckNow();
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "POST /api/update/download": {
				const body = JSON.parse((await readBody(req)) || "{}") as { mirror?: string };
				// 不 await 完成：进度经 WS 推送，失败也经 WS 回 available+error
				void host.updateDownload(typeof body.mirror === "string" ? body.mirror : undefined).catch(() => {});
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "POST /api/update/discard": {
				host.updateDiscard();
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "POST /api/update/restart": {
				if (refuseWhileStreaming()) return true;
				sendJson(res, 200, { ok: true });
				// 先回包再退：前端收到 ok 后展示「重启中」并等重连
				host.updateRestart();
				return true;
			}

			// ---- 项目完整备份 / 恢复 ----
			case "POST /api/backup/create": {
				if (refuseWhileStreaming()) return true;
				const dir = join(host.cwd, BACKUP_ROOT);
				mkdirSync(dir, { recursive: true });
				const name = `liyuan-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
				const outPath = join(dir, name);
				const r = buildBackupZip(host.cwd, host.agentDir(), outPath);
				host.notify("info", `已在本机备份 ${r.count} 个文件（${formatBytes(r.bytes)}）`);
				sendJson(res, 200, { ok: true, filename: name, files: r.count, bytes: r.bytes });
				return true;
			}
			case "GET /api/backup/download": {
				if (refuseWhileStreaming()) return true;
				const dir = join(host.cwd, BACKUP_ROOT);
				mkdirSync(dir, { recursive: true });
				const name = `liyuan-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
				const outPath = join(dir, name);
				buildBackupZip(host.cwd, host.agentDir(), outPath);
				res.writeHead(200, {
					"content-type": "application/zip",
					"content-disposition": `attachment; filename="${name}"`,
				});
				createReadStream(outPath).pipe(res);
				res.on("finish", () => {
					try {
						rmSync(outPath, { force: true });
					} catch {
						/* 清理临时导出失败无碍 */
					}
				});
				return true;
			}
			case "POST /api/backup/import": {
				if (refuseWhileStreaming()) return true;
				const data = await readBodyRaw(req, MAX_BACKUP_UPLOAD);
				if (data.length === 0) throw new Error("备份文件为空");
				// 暂存 zip 放在 restore/ 的兄弟目录——stageRestore 会先清空 restore/，写进去会被自己删掉
				const dir = join(host.cwd, BACKUP_ROOT);
				mkdirSync(dir, { recursive: true });
				const zipPath = join(dir, "incoming.zip");
				writeFileSync(zipPath, data);
				const manifest = stageRestore(host.cwd, zipPath);
				rmSync(zipPath, { force: true }); // 已解压进 restore/，暂存 zip 用完即删
				// 先回包再退：前端收到 ok 后展示「重启中」
				sendJson(res, 200, {
					ok: true,
					note: `恢复点已就绪（${manifest.fileCount} 个文件），正在重启应用以完成导入…`,
				});
				host.updateRestart();
				return true;
			}

			// ---- 导入 ST 聊天记录 ----
			case "POST /api/import": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { content?: string; tag?: string };
				if (!body.content?.trim()) throw new Error("聊天记录内容为空");
				const dir = join(host.cwd, DIRS.cache, "imports");
				mkdirSync(dir, { recursive: true });
				const rel = join(DIRS.cache, "imports", `import-${Date.now()}.jsonl`);
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
