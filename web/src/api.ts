/**
 * REST 客户端（server/rest.ts 的前端镜像）：面板 CRUD 走 /api/*，流内容走 WS。
 *
 * GET 内存缓存 + 同步 peek：预取/再次打开面板可首帧直接有数据（对齐 ST「不闪读取中」）。
 * 写操作按路径前缀失效，避免一次 POST 清空全部缓存。
 */

/** GET 响应缓存（完整 path 含 query → 数据） */
const getCache = new Map<string, { at: number; data: unknown }>();
/** 同一 path 并发合并 */
const getInflight = new Map<string, Promise<unknown>>();
const GET_TTL_MS = 180_000;

export function apiGetCacheClear(prefix?: string): void {
	if (!prefix) {
		getCache.clear();
		return;
	}
	for (const k of [...getCache.keys()]) {
		if (k === prefix || k.startsWith(prefix)) getCache.delete(k);
	}
}

/** 同步读缓存（usePanelData 首帧水合用；过期返回 null） */
export function apiGetPeek<T>(path: string): T | null {
	const hit = getCache.get(path);
	if (!hit) return null;
	if (Date.now() - hit.at >= GET_TTL_MS) return null;
	return hit.data as T;
}

/** 写接口路径 → 需要失效的 GET 前缀（精细化，避免牵连无关面板） */
function invalidateAfterWrite(writePath: string): void {
	const p = writePath.split("?")[0];
	// 更具体的规则须排在前面（先匹配先清；可多规则命中）
	const rules: Array<{ test: RegExp; prefixes: string[] }> = [
		// 卡内嵌世界书另存并挂载：同时改 lorebooks 文件列表 + config 挂载
		{
			test: /^\/api\/card\/import-embedded-lore$/,
			prefixes: ["/api/lorebook", "/api/lorebooks", "/api/config", "/api/card", "/api/cards", "/api/cardfront"],
		},
		// 换卡 / 卡详情写：必须连带清 cardfront，否则 180s 内仍吃上一张卡的皮肤缓存
		{ test: /^\/api\/cardfront/, prefixes: ["/api/cardfront"] },
		{ test: /^\/api\/cards?/, prefixes: ["/api/card", "/api/cards", "/api/cardfront", "/api/card-agents", "/api/rules"] },
		{ test: /^\/api\/persona/, prefixes: ["/api/personas", "/api/config"] },
		// 挂载/改书 ⇒ 卡档案里的（世界书·…）镜像条目随之重写；装载/拨开关 ⇒ （预设）条目落进卡文件——两份文件的缓存一起失效
		{ test: /^\/api\/lorebook/, prefixes: ["/api/lorebook", "/api/lorebooks", "/api/config", "/api/card-agents", "/api/rules"] },
		{ test: /^\/api\/preset/, prefixes: ["/api/preset", "/api/presets", "/api/card-agents", "/api/rules"] },
		{ test: /^\/api\/mcp/, prefixes: ["/api/mcp"] },
		{ test: /^\/api\/skills/, prefixes: ["/api/skills"] },
		{ test: /^\/api\/memory/, prefixes: ["/api/memory"] },
		{ test: /^\/api\/agent-/, prefixes: ["/api/agent-config", "/api/agent-profiles", "/api/models"] },
		{ test: /^\/api\/models/, prefixes: ["/api/models", "/api/agent-config"] },
		{ test: /^\/api\/channels/, prefixes: ["/api/models", "/api/agent-config", "/api/agent-profiles"] },
		{ test: /^\/api\/config/, prefixes: ["/api/config"] },
		{ test: /^\/api\/backup/, prefixes: [] },
		{ test: /^\/api\/upload/, prefixes: ["/api/uploads"] },
	];
	let hit = false;
	for (const r of rules) {
		if (r.test.test(p)) {
			for (const pref of r.prefixes) apiGetCacheClear(pref);
			hit = true;
			// 具体规则已处理完则不必再吃宽松 cards? 规则的重复清（仍允许其它规则叠加）
			if (r.test.source.includes("import-embedded-lore")) break;
		}
	}
	// 未识别的写：整表清，保守
	if (!hit) apiGetCacheClear();
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const method = (init?.method ?? "GET").toUpperCase();
	const res = await fetch(path, {
		headers: { "content-type": "application/json" },
		...init,
	});
	let data: unknown = null;
	try {
		data = await res.json();
	} catch {
		// 非 JSON
	}
	const err = (data as { error?: string } | null)?.error;
	if (!res.ok || err) throw new Error(err || `请求失败（HTTP ${res.status}）`);
	if (method !== "GET" && method !== "HEAD") invalidateAfterWrite(path);
	return data as T;
}

/** 上传二进制（File 直传原始字节，非 multipart）：服务器按 body 原样读（子项目 zip 导入用） */
export async function apiPostFile<T>(path: string, file: Blob): Promise<T> {
	const res = await fetch(path, { method: "POST", body: file });
	let data: unknown = null;
	try {
		data = await res.json();
	} catch {
		// 非 JSON
	}
	const err = (data as { error?: string } | null)?.error;
	if (!res.ok || err) throw new Error(err || `请求失败（HTTP ${res.status}）`);
	invalidateAfterWrite(path);
	return data as T;
}

/**
 * 面板重拉期间递增：其内的 apiGet 一律走网络（仍回写缓存供 peek）。
 * 内存缓存只负责「首帧秒开」，不负责「刷新/reload 结果」——否则右上角刷新会假成功。
 */
let panelFetchBypassDepth = 0;

/** @internal 由 usePanelData 包一层；业务代码勿直接调 */
export function runWithPanelFetchBypass<T>(fn: () => Promise<T>): Promise<T> {
	panelFetchBypassDepth += 1;
	return fn().finally(() => {
		panelFetchBypassDepth -= 1;
	});
}

export async function apiGet<T>(path: string, opts?: { bypassCache?: boolean }): Promise<T> {
	const bypass = !!opts?.bypassCache || panelFetchBypassDepth > 0;
	if (!bypass) {
		const hit = getCache.get(path);
		if (hit && Date.now() - hit.at < GET_TTL_MS) return hit.data as T;
		const inflight = getInflight.get(path);
		if (inflight) return inflight as Promise<T>;
	}
	const p = api<T>(path).then((d) => {
		getCache.set(path, { at: Date.now(), data: d });
		getInflight.delete(path);
		return d;
	});
	if (!bypass) getInflight.set(path, p);
	try {
		return await p;
	} catch (e) {
		getInflight.delete(path);
		throw e;
	}
}

/** 按面板 id 清相关 GET 缓存（手动刷新按钮用，避免 remount 后 peek 仍是旧数据） */
export function apiGetCacheClearForPanel(panelId: string): void {
	const map: Record<string, string[]> = {
		// 角色板块＝卡库 + 用户角色两页签，刷新一次清两边
		roles: ["/api/card", "/api/cards", "/api/cardfront", "/api/personas", "/api/config"],
		card: ["/api/card", "/api/cards", "/api/cardfront"],
		lorebook: ["/api/lorebook", "/api/lorebooks", "/api/config", "/api/card-agents"],
		persona: ["/api/personas", "/api/config"],
		preset: ["/api/preset", "/api/presets", "/api/card-agents", "/api/rules"],
		connect: ["/api/models", "/api/agent-config", "/api/agent-profiles"],
		powers: ["/api/mcp", "/api/skills"],
		settings: ["/api/config"],
		// 媒体列表挂在 GET /api/uploads 的 media 字段，无独立 /api/media
		uploads: ["/api/uploads"],
		worldline: ["/api/worldline"],
	};
	const prefixes = map[panelId];
	if (!prefixes) {
		// 未知面板：保守不整表清，仅无 cacheKey 的组件靠 bypass 拉新
		return;
	}
	for (const pref of prefixes) apiGetCacheClear(pref);
}

/**
 * agent 台上工具名 → 它写过的资产对应的 GET 前缀。
 *
 * 只列**真正改盘**的工具。读工具（`*_search`/`*_list`/`*_read`/`world_state_get`/`skill_read`）、
 * 决策工具（`ask`）、以及走 WS 帧直接推前端的世界状态/名录/面板（`panel_*`、记账）都不在此——
 * 它们不动 GET 端点的数据，清了纯属白重拉（慢链路上 preset 全量就有 119KB）。
 * 与 `invalidateAfterWrite` 是同一套「写谁清谁」，只是这里的键是 harness 自己发行的工具名，不是路径。
 * 表里没有的工具名 → 不清（宁可漏清一格靠 180s TTL 兜，也不要每拍全表清）。
 */
const TOOL_WRITE_PREFIXES: Record<string, string[]> = {
	lorebook_write: ["/api/lorebook", "/api/lorebooks", "/api/card-agents"],
	lorebook_update: ["/api/lorebook", "/api/lorebooks", "/api/card-agents"],
	lorebook_delete: ["/api/lorebook", "/api/lorebooks", "/api/card-agents"],
	lorebook_toggle: ["/api/lorebook", "/api/lorebooks", "/api/card-agents"],
	lorebook_create: ["/api/lorebook", "/api/lorebooks", "/api/config", "/api/card-agents"],
	lorebook_mount: ["/api/lorebooks", "/api/config", "/api/card-agents"],
	memory_add: ["/api/memory"],
	memory_delete: ["/api/memory"],
	card_create: ["/api/card", "/api/cards", "/api/cardfront"],
	card_update: ["/api/card", "/api/cards", "/api/cardfront"],
	card_project: ["/api/card", "/api/cards", "/api/cardfront"],
	card_switch: ["/api/card", "/api/cards", "/api/cardfront", "/api/config"],
	card_greetings: ["/api/card", "/api/cards"],
	persona_write: ["/api/personas", "/api/config"],
	persona_use: ["/api/personas", "/api/config"],
	persona_delete: ["/api/personas", "/api/config"],
	preset_write: ["/api/preset", "/api/presets", "/api/card-agents", "/api/rules"],
	preset_save: ["/api/preset", "/api/presets", "/api/card-agents", "/api/rules"],
	preset_create: ["/api/preset", "/api/presets"],
	preset_saveas: ["/api/preset", "/api/presets"],
	preset_select: ["/api/preset", "/api/presets", "/api/card-agents", "/api/rules"],
	stage_skill_write: ["/api/skills"],
	stage_skill_delete: ["/api/skills"],
};

/**
 * agent 一轮结束：按**本轮真正调过的写工具**清对应缓存（8/29）。
 * 服务端的写客户端看不见（`invalidateAfterWrite` 只认前端自己发的写），故 agent 改了资产要主动失效；
 * 但此前是每轮无条件 `apiGetCacheClear()` 整表清——日常一拍只记账（走 WS，不碰 GET 缓存），
 * 却把 preset/card 等无关配置全冲了，慢链路（VPS）上就成了「每次开面板都重新加载」。
 * 现在只清本轮写工具碰过的前缀；本轮没有写工具则一格都不清。返回是否清过（供调用方决定是否还要提示重拉）。
 */
export function apiGetCacheClearForToolNames(toolNames: Iterable<string>): boolean {
	const prefixes = new Set<string>();
	for (const name of toolNames) {
		const ps = TOOL_WRITE_PREFIXES[name];
		if (ps) for (const p of ps) prefixes.add(p);
	}
	for (const p of prefixes) apiGetCacheClear(p);
	return prefixes.size > 0;
}

export const apiPost = <T,>(path: string, body: unknown) =>
	api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const apiPut = <T,>(path: string, body: unknown) =>
	api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const apiDelete = <T,>(path: string) => api<T>(path, { method: "DELETE" });

/** 连接就绪后预热常用面板数据 */
export function prefetchPanelApis(): void {
	const paths = [
		"/api/cards",
		"/api/card",
		"/api/personas",
		"/api/config",
		"/api/lorebooks",
		"/api/preset",
		"/api/presets",
		"/api/skills",
		"/api/mcp",
		"/api/models",
		"/api/agent-config",
		"/api/agent-profiles",
		"/api/uploads",
	];
	for (const p of paths) void apiGet(p).catch(() => {});
}

export const uploadFile = (file: File) =>
	api<{ file: string; bytes: number; size: string }>(`/api/upload?name=${encodeURIComponent(file.name)}`, {
		method: "POST",
		headers: { "content-type": "application/octet-stream" },
		body: file,
	});

// ---------- 模型 / 连接 ----------

export interface CurrentModelInfo {
	provider: string;
	id: string;
	name: string;
	thinkingLevel: string;
	availableLevels: string[];
	/** 当前模型上下文窗口 token 数（连接配置可改） */
	contextWindow: number;
	/** 单次最大输出 tokens（连接配置可改；未配置时运行时默认 16384） */
	maxTokens?: number;
}

export interface ModelInfo {
	provider: string;
	providerName: string;
	id: string;
	name: string;
	reasoning: boolean;
	vision: boolean;
	contextWindow: number;
	maxTokens?: number;
}

export interface ModelsResponse {
	current: CurrentModelInfo | null;
	models: ModelInfo[];
}

export interface AuthProviderInfo {
	provider: string;
	displayName: string;
	configured: boolean;
	ready: boolean;
	source?: string;
	label?: string;
	modelCount: number;
}

/**
 * Agent 配置中的模型条目。
 * 同一个模型可以有多条条目（同 id、不同思考档）；条目的身份是 `label`，没起名就回落 id。
 */
export type ModelEntry = { id: string; label?: string } & Record<string, unknown>;

/** 梨园完整 Agent 配置 */
export interface LiyuanAgentConfig {
	version: 1;
	defaultProvider?: string;
	defaultModel?: string;
	/** 剧情模型指向哪条条目（条目名）；defaultModel 仍留模型 id 给运行时 */
	defaultModelEntry?: string;
	defaultThinkingLevel?: string;
	shellPath?: string;
	skills?: string[];
	enableSkillCommands?: boolean;
	providers: Record<string, AgentProviderRaw>;
	[key: string]: unknown;
}

export type AgentProviderRaw = {
	baseUrl?: string;
	api?: string;
	apiKey?: string;
	models?: ModelEntry[];
} & Record<string, unknown>;

export interface AgentConfigResponse {
	path: string;
	exists: boolean;
	config: LiyuanAgentConfig;
	text: string;
	seeded?: boolean;
}

/** 渠道清单项（脱敏） */
export interface ChannelInfo {
	name: string;
	baseUrl?: string;
	api?: string;
	hasKey: boolean;
	keyKind: "none" | "literal" | "env" | "command" | "placeholder";
	models: ModelEntry[];
	modelCount: number;
	modelIds: string[];
	[key: string]: unknown;
}

export interface ChannelsResponse {
	path: string;
	configPath?: string;
	channels: ChannelInfo[];
	defaultProvider?: string | null;
	defaultModel?: string | null;
}

export interface ChannelTestResult {
	ok: boolean;
	status: number;
	detail: string;
}

// ---------- 其它面板类型（保持兼容） ----------

export interface RpConfigView {
	card: string;
	/** 多本同时挂载 */
	lorebooks?: string[];
	/** @deprecated 旧单本 */
	lorebook?: string;
	userName: string;
	displayName?: string;
	userPersona: string;
	language: string;
	uiLanguage?: "zh" | "en";
	scanDepth: number;
	maxLoreInjections: number;
	greeting: boolean;
	greetingIndex?: number;
	importStripTags?: string[];
	preset?: string;
	disabledLore?: string[];
	backendControl?: boolean;
	creationMode?: "ask" | "silent";
	/** 固定楼层压缩：每 N 个叙事轮主动压缩早期正文；0=仅被动压缩 */
	compactEveryNTurns?: number;
	/** 旁路模型（记账/压缩）：指向连接配置里的一条模型条目；缺省=跟随剧情模型 */
	sideModel?: { provider: string; entry: string };
}

export interface CardResponse {
	path: string;
	displayName: string | null;
	greetingIndex: number;
	name: string;
	description: string;
	personality: string;
	scenario: string;
	creatorNotes: string;
	tags: string[];
	/** 卡内嵌 character_book 条数 */
	embeddedLoreCount?: number;
	greetings: Array<{ index: number; label: string; text: string }>;
}

export interface LoreEntryView {
	fingerprint: string;
	comment: string;
	keys: string[];
	secondaryKeys: string[];
	constant: boolean;
	enabled: boolean;
	/** 是否要求次要关键词也命中（ST selective） */
	selective: boolean;
	/** 插入优先级（ST order / insertion_order，越小越靠前） */
	order: number;
	chars: number;
	source: "card" | "file" | "agent";
	preview: string;
}

/** 写回世界书源文件的条目补丁 */
export interface LoreEntryPatchBody {
	fingerprint: string;
	constant?: boolean;
	order?: number;
	keys?: string[];
	secondaryKeys?: string[];
	selective?: boolean;
	comment?: string;
	content?: string;
}

export interface LorebookResponse {
	/** @deprecated 兼容字段；现等于 viewPath */
	lorebookPath: string | null;
	/** 会话中已挂载的路径（多本） */
	lorebookPaths?: string[];
	/** 当前条目列表对应的书（点选浏览，非合并） */
	viewPath?: string | null;
	viewSource?: "file" | "agent" | null;
	viewName?: string | null;
	total: number;
	entries: LoreEntryView[];
}

export interface LoreSearchHit {
	comment: string;
	keys: string[];
	score: number;
	preview: string;
}

export interface PresetBlockView {
	id: string;
	name: string;
	/** 派生只读值：相对 chatHistory 槽位的前后（酒馆里这是位置，不是可选属性） */
	channel: "system" | "postHistory";
	role: string;
	enabled: boolean;
	/** 酒馆内置槽位（Chat History / Char Description…）：占位，无正文 */
	marker: boolean;
	/** in-chat 深度注入才有 */
	depth?: number;
	chars: number;
}

/** PUT /api/preset 的块补丁——只发改动，原文其余字节不动 */
export interface PresetBlockPatch {
	id: string;
	enabled?: boolean;
	name?: string;
	content?: string;
	/** 从预设整块移除 */
	remove?: boolean;
}

/** GET /api/preset/block 单块全文（编辑用） */
export interface PresetBlockDetail extends PresetBlockView {
	content: string;
}

export interface PresetResponse {
	path?: string;
	missing?: string;
	/** 是否有未写入磁盘的运行时草稿 */
	dirty?: boolean;
	preset: {
		name: string;
		/** st＝酒馆原文；rp＝v1.4.1 及以前导入的旧梨园格式 */
		kind?: "st" | "rp";
		samplers: Record<string, number>;
		blocks: Array<PresetBlockView & { content?: string }>;
	} | null;
}

export interface CommandMeta {
	name: string;
	usage: string;
	description: string;
	takesArgs: boolean;
}

export interface SkillInfo {
	name: string;
	description: string;
	file: string;
	disableModelInvocation: boolean;
}

export interface UploadInfo {
	file: string;
	name: string;
	size: string;
	mtimeMs: number;
}

/** GET /api/uploads：我的上传 + 本地图片（AI 出图） */
export interface UploadsResponse {
	uploads: UploadInfo[];
	media: UploadInfo[];
}

export interface CardLibItem {
	path: string;
	name: string;
	tags: string[];
	isPng: boolean;
	/** 有封面可显示：PNG 卡恒真；JSON 卡看侧挂封面（同名 .png）在不在 */
	hasCover?: boolean;
	mtimeMs: number;
	fav: boolean;
}

export interface CardsResponse {
	current: string;
	cards: CardLibItem[];
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

export interface StatePatchResult {
	applied: string[];
	warnings: string[];
}

export interface PersonaInfo {
	id: string;
	name: string;
	persona: string;
	/** 相对路径；有值时用 /api/personas/avatar?id= 取图 */
	avatar?: string;
}

/** 头像 URL（带 cache-bust，保存后立刻刷新） */
export const personaAvatarUrl = (id: string, bust?: string | number) =>
	`/api/personas/avatar?id=${encodeURIComponent(id)}${bust != null ? `&t=${bust}` : ""}`;

export interface PersonasResponse {
	personas: PersonaInfo[];
	current: string | null;
	lockedForCard: string | null;
	activeId: string | null;
}

export interface PresetFileInfo {
	file: string;
	name: string;
	/** 机制自选（2026-09-14）：declare＝快速处理（默认，分类照搬）；process＝深度处理（模型重组） */
	mode?: "declare" | "process";
}

export interface PresetsResponse {
	active: string | null;
	presets: PresetFileInfo[];
}

/** GET /api/presets/blocks：库内任意预设的块视图（不装载也能展开拨开关） */
export interface PresetBlocksResponse {
	file: string;
	active: boolean;
	/** 活动预设：有未落盘草稿 */
	dirty: boolean;
	name: string;
	blocks: Array<PresetBlockView & { content?: string }>;
}

/** 用户提示词：SYSTEM.md（全局系统提示词）+ 全局追加两份（扮演 APPEND_SYSTEM.md / agent 模式 AGENT_APPEND_SYSTEM.md）+ 这张卡的 APPEND_SYSTEM.md */
export interface RulesResponse {
	global: { content: string; path: string };
	agent: { content: string; path: string };
	card: { content: string; path: string; cardName: string };
	system: { content: string; path: string };
}

export interface RulesSaveResponse {
	ok: boolean;
	path: string;
	chars: number;
}

/** 预设一次性转译（刀2）：产物是卡级规矩文件 + config 迁移 + 报告 */
export interface PresetTranslateResponse {
	ok: boolean;
	/** ok=false 且 exists=true：卡级规矩文件已存在，需 overwrite=true 重试 */
	exists?: boolean;
	path?: string;
	chars?: number;
	lines?: number;
	prefillDropped?: number;
	markersSkipped?: number;
	samplersMoved?: number;
	report?: string;
}

/** 卡档案 AGENTS.md（刀3）：文件为准 / 投影兜底两态 */
export interface CardAgentsResponse {
	exists: boolean;
	active: "file" | "projection";
	content: string;
	/** 生效投影（diff 基准）：装配真正送的那份（协议判死已滤） */
	projection: string;
	/** 未过滤全量投影（生成素材）：含被运行时判死/归属剥离的条目，交模型重新判断 */
	unfilteredProjection: string;
	/** 被判死条目名单（标题 + 判定原因） */
	droppedTitles: string[];
	path: string;
	cardName: string;
}

export interface CardAgentsSaveResponse {
	ok: boolean;
	path: string;
	chars: number;
}

export interface LorebookFileInfo {
	path: string;
	name: string;
	entryCount: number;
}

export interface LorebooksResponse {
	/** 多本同时挂载的路径列表（可为空） */
	active: string[] | string | null;
	/** @deprecated 旧单本字段 */
	activeOne?: string | null;
	books: LorebookFileInfo[];
}

/** 规范化挂载列表（兼容旧 API 返回 string / null） */
export function normalizeActiveLorebooks(active: LorebooksResponse["active"]): string[] {
	if (Array.isArray(active)) return active.filter((p): p is string => typeof p === "string" && !!p);
	if (typeof active === "string" && active) return [active];
	return [];
}

/** @deprecated 用 AgentConfigResponse；保留别名避免旧引用炸 */
export type ModelsJsonResponse = AgentConfigResponse & { content?: LiyuanAgentConfig };

export const importCard = (file: File) =>
	api<{ ok: true; path: string; name: string; embeddedLoreCount?: number }>(
		`/api/cards/import?name=${encodeURIComponent(file.name)}`,
		{
			method: "POST",
			headers: { "content-type": "application/octet-stream" },
			body: file,
		},
	);

// ---------- 项目完整备份 / 恢复 ----------

export const createBackup = () =>
	api<{ ok: true; filename: string; files: number; bytes: number }>("/api/backup/create", {
		method: "POST",
		body: "{}",
	});

/** 导出备份包：走浏览器原生下载（携带访问 Cookie，服务器回 content-disposition） */
export function downloadBackup(): void {
	const a = document.createElement("a");
	a.href = "/api/backup/download";
	a.download = "";
	document.body.appendChild(a);
	a.click();
	a.remove();
}

export const importBackup = (file: File) =>
	api<{ ok: true; note?: string }>("/api/backup/import", {
		method: "POST",
		headers: { "content-type": "application/octet-stream" },
		body: file,
	});

export function downloadJson(filename: string, data: unknown): void {
	const blob = new Blob([JSON.stringify(data, null, "\t")], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

export function downloadText(filename: string, text: string): void {
	const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
