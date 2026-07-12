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
	const rules: Array<{ test: RegExp; prefixes: string[] }> = [
		{ test: /^\/api\/cards?/, prefixes: ["/api/card", "/api/cards"] },
		{ test: /^\/api\/persona/, prefixes: ["/api/personas", "/api/config"] },
		{ test: /^\/api\/lorebook/, prefixes: ["/api/lorebook", "/api/lorebooks"] },
		{ test: /^\/api\/codex/, prefixes: ["/api/codex"] },
		{ test: /^\/api\/preset/, prefixes: ["/api/preset", "/api/presets"] },
		{ test: /^\/api\/mcp/, prefixes: ["/api/mcp"] },
		{ test: /^\/api\/skills/, prefixes: ["/api/skills"] },
		{ test: /^\/api\/agent-/, prefixes: ["/api/agent-config", "/api/agent-profiles", "/api/models"] },
		{ test: /^\/api\/models/, prefixes: ["/api/models", "/api/agent-config"] },
		{ test: /^\/api\/channels/, prefixes: ["/api/models", "/api/agent-config", "/api/agent-profiles"] },
		{ test: /^\/api\/config/, prefixes: ["/api/config"] },
		{ test: /^\/api\/upload/, prefixes: ["/api/uploads", "/api/media"] },
	];
	let hit = false;
	for (const r of rules) {
		if (r.test.test(p)) {
			for (const pref of r.prefixes) apiGetCacheClear(pref);
			hit = true;
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

export async function apiGet<T>(path: string, opts?: { bypassCache?: boolean }): Promise<T> {
	if (!opts?.bypassCache) {
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
	if (!opts?.bypassCache) getInflight.set(path, p);
	try {
		return await p;
	} catch (e) {
		getInflight.delete(path);
		throw e;
	}
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
		"/api/codex",
		"/api/skills",
		"/api/mcp",
		"/api/models",
		"/api/agent-config",
		"/api/agent-profiles",
		"/api/uploads",
		"/api/media",
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
}

export interface ModelInfo {
	provider: string;
	providerName: string;
	id: string;
	name: string;
	reasoning: boolean;
	vision: boolean;
	contextWindow: number;
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

/** Agent 配置中的模型条目 */
export type ModelEntry = { id: string } & Record<string, unknown>;

/** 梨园完整 Agent 配置 */
export interface LiyuanAgentConfig {
	version: 1;
	defaultProvider?: string;
	defaultModel?: string;
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
	scanDepth: number;
	maxLoreInjections: number;
	greeting: boolean;
	greetingIndex?: number;
	importStripTags?: string[];
	preset?: string;
	disabledLore?: string[];
	backendControl?: boolean;
	creationMode?: "ask" | "silent";
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
	channel: "system" | "postHistory";
	role: string;
	enabled: boolean;
	chars: number;
}

export interface PresetResponse {
	path?: string;
	missing?: string;
	preset: {
		name: string;
		samplers: Record<string, number>;
		blocks: PresetBlockView[];
	} | null;
}

export interface ConvertReportItem {
	identifier: string;
	name: string;
	action: string;
	contentChars: number;
}

export interface CommandMeta {
	name: string;
	usage: string;
	description: string;
	takesArgs: boolean;
}

export interface CodexInfo {
	name: string;
	description: string;
	entryCount: number;
	mounted: boolean;
}

export interface CodexEntryView {
	/** 内容指纹，删除用 */
	fingerprint: string;
	/** 展示用名字（= comment） */
	name: string;
	comment: string;
	keys: string[];
	constant: boolean;
	/** 信息正文 */
	content: string;
	chars: number;
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
}

export interface PresetsResponse {
	active: string | null;
	presets: PresetFileInfo[];
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
