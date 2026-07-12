/**
 * MCP 外设（PLAN-PHASE4 柱 4）：extension 级 MCP client + 本机发现。
 *
 * 模型对齐 Grok CLI（读配置台账，不是扫安装目录）：
 * - 发现：~/.claude.json · ~/.liyuan/mcp.json · 项目 .mcp.json · .liyuan-mcp.json 等
 * - 默认关闭：发现来的服务器不自动暴露（RP 场景多数无用）
 * - 开关：偏好可持久；本会话启用集随会话树走（新对话=新窗口）
 * - 连接：仅对本会话启用的 id 做 connect，工具名 mcp__{id}__{tool}
 *
 * 领域层：不 import runtime/pi（PLAN.md D3）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Type, type TSchema } from "typebox";

// ---------- 类型 ----------

export const MCP_CONFIG_FILE = ".liyuan-mcp.json";
export const MCP_USER_CONFIG_FILE = "mcp.json"; // ~/.liyuan/mcp.json
export const RP_MCP_TYPE = "rp-mcp"; // 会话树：本对话启用的服务器 id 列表

export type McpTransport = "stdio" | "http" | "sse";

/** 配置从哪来的（面板展示；高优先级覆盖低优先级的 endpoint） */
export type McpSource = "claude" | "cursor" | "user" | "project-mcp" | "liyuan";

export interface McpServerConfig {
	id: string;
	name: string;
	/** 偏好层：新对话默认是否启用（发现项默认 false） */
	enabled: boolean;
	transport: McpTransport;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	url?: string;
	headers?: Record<string, string>;
}

export interface McpCatalogEntry extends McpServerConfig {
	/** 最高优先级来源（决定当前 endpoint） */
	source: McpSource;
	/** 所有出现过来源 */
	sources: McpSource[];
	/** true=仅发现/导入，无项目手写条目（删=只关，不能从本机台账抹掉） */
	discovered: boolean;
}

export interface McpConfigFile {
	format: "liyuan-mcp";
	version: 2;
	/** 项目内手写/覆盖的服务器（可改 endpoint） */
	servers: McpServerConfig[];
	/**
	 * 新对话默认启用表。发现项未出现在此表 = false。
	 * 手写 servers[].enabled 会在加载时并入此表。
	 */
	defaults?: Record<string, boolean>;
}

export interface McpToolDescriptor {
	serverId: string;
	serverName: string;
	name: string;
	qualifiedName: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export type McpConnStatus = "disconnected" | "connecting" | "connected" | "error";

export interface McpServerStatus {
	id: string;
	name: string;
	/** 本会话是否启用（不是「本机装了」） */
	enabled: boolean;
	/** 新对话默认是否启用 */
	defaultEnabled: boolean;
	transport: McpTransport;
	status: McpConnStatus;
	error?: string;
	tools: Array<{ name: string; qualifiedName: string; description: string }>;
	summary: string;
	source: McpSource;
	sources: McpSource[];
	discovered: boolean;
}

// ---------- 路径 ----------

export function mcpConfigPath(cwd: string): string {
	return join(cwd, MCP_CONFIG_FILE);
}

export function userMcpConfigPath(): string {
	return join(homedir(), ".liyuan", MCP_USER_CONFIG_FILE);
}

export function emptyMcpConfig(): McpConfigFile {
	return { format: "liyuan-mcp", version: 2, servers: [], defaults: {} };
}

// ---------- 读写偏好 ----------

export function loadMcpConfig(cwd: string): McpConfigFile {
	const p = mcpConfigPath(cwd);
	if (!existsSync(p)) return emptyMcpConfig();
	try {
		return normalizeMcpConfig(JSON.parse(readFileSync(p, "utf8")) as Partial<McpConfigFile>);
	} catch {
		return emptyMcpConfig();
	}
}

export function saveMcpConfig(cwd: string, config: McpConfigFile): void {
	const normalized = normalizeMcpConfig(config);
	writeFileSync(mcpConfigPath(cwd), `${JSON.stringify(normalized, null, "\t")}\n`, "utf8");
}

export function loadUserMcpConfig(): McpConfigFile {
	const p = userMcpConfigPath();
	if (!existsSync(p)) return emptyMcpConfig();
	try {
		return normalizeMcpConfig(JSON.parse(readFileSync(p, "utf8")) as Partial<McpConfigFile>);
	} catch {
		return emptyMcpConfig();
	}
}

export function saveUserMcpConfig(config: McpConfigFile): void {
	const dir = join(homedir(), ".liyuan");
	mkdirSync(dir, { recursive: true });
	writeFileSync(userMcpConfigPath(), `${JSON.stringify(normalizeMcpConfig(config), null, "\t")}\n`, "utf8");
}

export function normalizeMcpConfig(raw: Partial<McpConfigFile> | null | undefined): McpConfigFile {
	const servers = Array.isArray(raw?.servers) ? raw!.servers : [];
	const seen = new Set<string>();
	const out: McpServerConfig[] = [];
	const defaults: Record<string, boolean> = {};

	// v1 兼容：无 defaults 时从 servers[].enabled 推导
	if (raw?.defaults && typeof raw.defaults === "object" && !Array.isArray(raw.defaults)) {
		for (const [k, v] of Object.entries(raw.defaults)) {
			const id = sanitizeServerId(k);
			if (id) defaults[id] = v === true;
		}
	}

	for (const s of servers) {
		if (!s || typeof s !== "object") continue;
		const id = sanitizeServerId(String((s as McpServerConfig).id ?? ""));
		if (!id || seen.has(id)) continue;
		seen.add(id);
		const transport = normalizeTransport((s as McpServerConfig).transport);
		const enabled = (s as McpServerConfig).enabled === true; // 显式 true 才算默认开
		out.push({
			id,
			name: String((s as McpServerConfig).name ?? id).trim() || id,
			enabled,
			transport,
			command: typeof (s as McpServerConfig).command === "string" ? (s as McpServerConfig).command : undefined,
			args: Array.isArray((s as McpServerConfig).args)
				? (s as McpServerConfig).args!.filter((x): x is string => typeof x === "string")
				: undefined,
			env: isStringRecord((s as McpServerConfig).env) ? { ...(s as McpServerConfig).env } : undefined,
			cwd: typeof (s as McpServerConfig).cwd === "string" ? (s as McpServerConfig).cwd : undefined,
			url: typeof (s as McpServerConfig).url === "string" ? (s as McpServerConfig).url : undefined,
			headers: isStringRecord((s as McpServerConfig).headers) ? { ...(s as McpServerConfig).headers } : undefined,
		});
		// servers[].enabled 并入 defaults（若 defaults 未写该键）
		if (!(id in defaults) && enabled) defaults[id] = true;
		if ((s as McpServerConfig).enabled === false) defaults[id] = false;
	}

	return { format: "liyuan-mcp", version: 2, servers: out, defaults };
}

function isStringRecord(v: unknown): v is Record<string, string> {
	if (!v || typeof v !== "object" || Array.isArray(v)) return false;
	return Object.values(v).every((x) => typeof x === "string");
}

function normalizeTransport(t: unknown): McpTransport {
	if (t === "http" || t === "sse" || t === "stdio") return t;
	// Claude / 部分客户端用 type 字段
	if (t === "streamable-http" || t === "streamableHttp") return "http";
	return "stdio";
}

export function sanitizeServerId(raw: string): string {
	const s = raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 32);
	return s;
}

export function allocateServerId(cwd: string, nameOrId: string): string {
	const base = sanitizeServerId(nameOrId) || "server";
	const catalog = discoverMcpCatalog(cwd);
	const used = new Set(catalog.map((s) => s.id));
	if (!used.has(base)) return base;
	for (let i = 2; i < 1000; i++) {
		const id = `${base}_${i}`.slice(0, 32);
		if (!used.has(id)) return id;
	}
	return `${base}_${Date.now().toString(36)}`.slice(0, 32);
}

export function validateServerConfig(s: McpServerConfig): string | null {
	if (!s.id) return "缺少服务器 id";
	if (s.transport === "stdio") {
		if (!s.command?.trim()) return "stdio 服务器需要 command";
	} else {
		if (!s.url?.trim()) return `${s.transport} 服务器需要 url`;
		try {
			// eslint-disable-next-line no-new
			new URL(s.url);
		} catch {
			return "url 不是合法地址";
		}
	}
	return null;
}

export function serverSummary(s: Pick<McpServerConfig, "transport" | "command" | "args" | "url">): string {
	if (s.transport === "stdio") {
		const args = (s.args ?? []).join(" ");
		return `${s.command ?? ""}${args ? ` ${args}` : ""}`.trim();
	}
	return s.url ?? "";
}

/** 合并后的默认启用表：用户级 ← 项目级（项目覆盖） */
export function loadDefaultEnabledMap(cwd: string): Record<string, boolean> {
	const user = loadUserMcpConfig().defaults ?? {};
	const project = loadMcpConfig(cwd).defaults ?? {};
	return { ...user, ...project };
}

/** 新对话应启用的 id 列表（仅 defaults 里显式 true） */
export function defaultSessionEnabledIds(cwd: string): string[] {
	const map = loadDefaultEnabledMap(cwd);
	return Object.entries(map)
		.filter(([, v]) => v === true)
		.map(([k]) => k)
		.sort();
}

/** 写入项目偏好：某 id 是否作为新对话默认启用 */
export function setDefaultEnabled(cwd: string, id: string, enabled: boolean): void {
	const sid = sanitizeServerId(id);
	if (!sid) return;
	const cfg = loadMcpConfig(cwd);
	const defaults = { ...(cfg.defaults ?? {}) };
	defaults[sid] = enabled;
	// 同步 servers[] 里同名条目的 enabled 字段
	const servers = cfg.servers.map((s) => (s.id === sid ? { ...s, enabled } : s));
	saveMcpConfig(cwd, { ...cfg, servers, defaults });
}

// ---------- 发现 ----------

/** 原始 Claude/Cursor 风格 mcpServers 字典 → 归一化条目 */
export function parseMcpServersMap(
	map: Record<string, unknown> | null | undefined,
	source: McpSource,
): McpCatalogEntry[] {
	if (!map || typeof map !== "object") return [];
	const out: McpCatalogEntry[] = [];
	for (const [rawName, raw] of Object.entries(map)) {
		if (!raw || typeof raw !== "object") continue;
		const o = raw as Record<string, unknown>;
		const id = sanitizeServerId(rawName);
		if (!id) continue;
		// type / transport
		const typeHint = o.type ?? o.transport;
		let transport = normalizeTransport(typeHint);
		if (typeof o.url === "string" && o.url.trim() && typeHint == null) {
			// 有 url 无 type：偏远程
			transport = "sse";
		}
		if (typeof o.command === "string" && o.command.trim() && typeHint == null && !o.url) {
			transport = "stdio";
		}
		const entry: McpCatalogEntry = {
			id,
			name: rawName.trim() || id,
			enabled: false, // 发现项默认关
			transport,
			command: typeof o.command === "string" ? o.command : undefined,
			args: Array.isArray(o.args) ? o.args.filter((x): x is string => typeof x === "string") : undefined,
			env: isStringRecord(o.env) ? { ...o.env } : undefined,
			cwd: typeof o.cwd === "string" ? o.cwd : undefined,
			url: typeof o.url === "string" ? o.url : undefined,
			headers: isStringRecord(o.headers) ? { ...o.headers } : undefined,
			source,
			sources: [source],
			discovered: true,
		};
		// 跳过无效
		if (validateServerConfig(entry)) continue;
		out.push(entry);
	}
	return out;
}

function readJsonFile(path: string): unknown | null {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

function extractMcpServersMap(doc: unknown): Record<string, unknown> | null {
	if (!doc || typeof doc !== "object") return null;
	const d = doc as Record<string, unknown>;
	if (d.mcpServers && typeof d.mcpServers === "object") return d.mcpServers as Record<string, unknown>;
	// 少数文件顶层就是 map
	const keys = Object.keys(d);
	if (keys.length > 0 && keys.every((k) => d[k] && typeof d[k] === "object" && !Array.isArray(d[k]))) {
		const sample = d[keys[0]] as Record<string, unknown>;
		if ("command" in sample || "url" in sample || "type" in sample || "args" in sample) {
			return d as Record<string, unknown>;
		}
	}
	return null;
}

/**
 * 多源发现并合并。优先级低→高（后者覆盖 endpoint）：
 * claude → cursor → user(~/.liyuan) → project .mcp.json → project .liyuan-mcp.json
 */
export function discoverMcpCatalog(cwd: string): McpCatalogEntry[] {
	const layers: Array<{ source: McpSource; entries: McpCatalogEntry[] }> = [];

	// 1) Claude Code 用户级
	const claudeJson = readJsonFile(join(homedir(), ".claude.json"));
	const claudeMap = extractMcpServersMap(claudeJson);
	if (claudeMap) layers.push({ source: "claude", entries: parseMcpServersMap(claudeMap, "claude") });

	// Claude 旁路小文件（若有）
	for (const name of ["mcp_settings.json", "mcp-config.json", "settings.json"]) {
		const doc = readJsonFile(join(homedir(), ".claude", name));
		const m = extractMcpServersMap(doc);
		if (m) layers.push({ source: "claude", entries: parseMcpServersMap(m, "claude") });
	}

	// 2) Cursor
	const cursorDoc = readJsonFile(join(homedir(), ".cursor", "mcp.json"));
	const cursorMap = extractMcpServersMap(cursorDoc);
	if (cursorMap) layers.push({ source: "cursor", entries: parseMcpServersMap(cursorMap, "cursor") });

	// 3) 用户级梨园
	const userCfg = loadUserMcpConfig();
	if (userCfg.servers.length) {
		layers.push({
			source: "user",
			entries: userCfg.servers.map((s) => ({
				...s,
				source: "user" as const,
				sources: ["user" as const],
				discovered: false,
			})),
		});
	}

	// 4) 项目 .mcp.json（Claude/Cursor 项目约定）
	const projectMcp = extractMcpServersMap(readJsonFile(join(cwd, ".mcp.json")));
	if (projectMcp) layers.push({ source: "project-mcp", entries: parseMcpServersMap(projectMcp, "project-mcp") });

	// 5) 项目 .liyuan-mcp.json（最高）
	const project = loadMcpConfig(cwd);
	if (project.servers.length) {
		layers.push({
			source: "liyuan",
			entries: project.servers.map((s) => ({
				...s,
				source: "liyuan" as const,
				sources: ["liyuan" as const],
				discovered: false,
			})),
		});
	}

	const byId = new Map<string, McpCatalogEntry>();
	for (const layer of layers) {
		for (const e of layer.entries) {
			const prev = byId.get(e.id);
			if (!prev) {
				byId.set(e.id, { ...e, sources: [...e.sources] });
				continue;
			}
			// 合并：新层覆盖 endpoint，sources 累加
			const sources = [...new Set([...prev.sources, ...e.sources])];
			byId.set(e.id, {
				...e,
				name: e.name || prev.name,
				sources,
				discovered: prev.discovered && e.discovered,
				// enabled 字段在 catalog 里无语义，真正启用看 session/defaults
				enabled: false,
			});
		}
	}

	// 把 defaults 写进 enabled 字段方便 UI（defaultEnabled）
	const defaults = loadDefaultEnabledMap(cwd);
	const list = [...byId.values()].map((e) => ({
		...e,
		enabled: defaults[e.id] === true,
	}));
	list.sort((a, b) => a.name.localeCompare(b.name, "zh"));
	return list;
}

/** 解析本会话应连接的服务器配置（仅 sessionEnabled 中的 id） */
export function resolveSessionServers(cwd: string, sessionEnabled: string[]): McpServerConfig[] {
	const catalog = discoverMcpCatalog(cwd);
	const want = new Set(sessionEnabled.map(sanitizeServerId).filter(Boolean));
	return catalog
		.filter((e) => want.has(e.id))
		.map((e) => ({
			id: e.id,
			name: e.name,
			enabled: true,
			transport: e.transport,
			command: e.command,
			args: e.args,
			env: e.env,
			cwd: e.cwd,
			url: e.url,
			headers: e.headers,
		}));
}

// ---------- 工具名 ----------

export function qualifyMcpToolName(serverId: string, toolName: string): string {
	const sid = sanitizeServerId(serverId) || "srv";
	const tn = String(toolName)
		.replace(/[^a-zA-Z0-9_-]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 40);
	return `mcp__${sid}__${tn || "tool"}`.slice(0, 64);
}

export function parseQualifiedMcpTool(qualified: string): { serverId: string; toolName: string } | null {
	if (!qualified.startsWith("mcp__")) return null;
	const rest = qualified.slice("mcp__".length);
	const i = rest.indexOf("__");
	if (i <= 0) return null;
	return { serverId: rest.slice(0, i), toolName: rest.slice(i + 2) };
}

export function parametersFromMcpSchema(inputSchema: unknown): TSchema {
	if (inputSchema && typeof inputSchema === "object" && !Array.isArray(inputSchema)) {
		const s = inputSchema as Record<string, unknown>;
		if (s.type === "object" || s.properties || s.$schema) {
			try {
				return Type.Unsafe(s);
			} catch {
				// fall through
			}
		}
	}
	return Type.Object({}, { additionalProperties: true });
}

// ---------- 探测 ----------

export interface McpProbeResult {
	ok: boolean;
	error?: string;
	tools: Array<{ name: string; description: string }>;
}

export async function probeMcpServer(server: McpServerConfig, timeoutMs = 20_000): Promise<McpProbeResult> {
	const err = validateServerConfig(server);
	if (err) return { ok: false, error: err, tools: [] };
	let client: Client | null = null;
	try {
		const conn = await openConnection(server, timeoutMs);
		client = conn.client;
		const listed = await withTimeout(client.listTools(), timeoutMs, "listTools 超时");
		const tools = (listed.tools ?? []).map((t) => ({
			name: t.name,
			description: t.description ?? "",
		}));
		return { ok: true, tools };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e), tools: [] };
	} finally {
		try {
			await client?.close();
		} catch {
			// ignore
		}
	}
}

// ---------- Hub（按本会话启用集连接） ----------

interface LiveConnection {
	config: McpServerConfig;
	client: Client | null;
	tools: McpToolDescriptor[];
	status: McpConnStatus;
	error?: string;
}

let hubSingleton: McpHub | null = null;

export function getMcpHub(cwd: string): McpHub {
	if (!hubSingleton || hubSingleton.cwd !== cwd) {
		if (hubSingleton) void hubSingleton.closeAll();
		hubSingleton = new McpHub(cwd);
	}
	return hubSingleton;
}

export function resetMcpHubForTests(): void {
	if (hubSingleton) void hubSingleton.closeAll();
	hubSingleton = null;
}

export class McpHub {
	readonly cwd: string;
	private live = new Map<string, LiveConnection>();
	private syncing: Promise<void> | null = null;
	/** 本会话启用的 id（agent 绑定对话） */
	private sessionEnabled: string[] = [];

	constructor(cwd: string) {
		this.cwd = cwd;
	}

	getSessionEnabled(): string[] {
		return [...this.sessionEnabled];
	}

	/**
	 * 按本会话启用集对账连接。
	 * @param sessionEnabled 本对话打开的服务器；省略则保持 hub 内当前集
	 */
	async sync(sessionEnabled?: string[]): Promise<McpServerStatus[]> {
		if (sessionEnabled) {
			this.sessionEnabled = [...new Set(sessionEnabled.map(sanitizeServerId).filter(Boolean))];
		}
		if (this.syncing) {
			await this.syncing;
			return this.statusList();
		}
		this.syncing = this.doSync();
		try {
			await this.syncing;
		} finally {
			this.syncing = null;
		}
		return this.statusList();
	}

	private async doSync(): Promise<void> {
		const wantList = resolveSessionServers(this.cwd, this.sessionEnabled);
		const want = new Map(wantList.map((s) => [s.id, s]));

		for (const [id, conn] of [...this.live.entries()]) {
			const next = want.get(id);
			if (!next || !sameEndpoint(conn.config, next)) {
				await this.drop(id);
			}
		}

		for (const [id, server] of want) {
			if (this.live.has(id) && this.live.get(id)!.status === "connected") continue;
			await this.connectOne(server);
		}
	}

	private async connectOne(server: McpServerConfig): Promise<void> {
		const v = validateServerConfig(server);
		if (v) {
			this.live.set(server.id, { config: server, client: null, tools: [], status: "error", error: v });
			return;
		}
		this.live.set(server.id, { config: server, client: null, tools: [], status: "connecting" });
		try {
			const { client } = await openConnection(server, 25_000);
			const listed = await withTimeout(client.listTools(), 15_000, "listTools 超时");
			const tools: McpToolDescriptor[] = (listed.tools ?? []).map((t) => ({
				serverId: server.id,
				serverName: server.name,
				name: t.name,
				qualifiedName: qualifyMcpToolName(server.id, t.name),
				description: t.description ?? "",
				inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
			}));
			const used = new Set<string>();
			for (const tool of tools) {
				let q = tool.qualifiedName;
				let n = 2;
				while (used.has(q)) {
					q = `${tool.qualifiedName.slice(0, 60)}_${n++}`.slice(0, 64);
				}
				used.add(q);
				tool.qualifiedName = q;
			}
			this.live.set(server.id, { config: server, client, tools, status: "connected" });
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.live.set(server.id, { config: server, client: null, tools: [], status: "error", error: msg });
		}
	}

	private async drop(id: string): Promise<void> {
		const conn = this.live.get(id);
		this.live.delete(id);
		if (conn?.client) {
			try {
				await conn.client.close();
			} catch {
				// ignore
			}
		}
	}

	async closeAll(): Promise<void> {
		for (const id of [...this.live.keys()]) await this.drop(id);
		this.sessionEnabled = [];
	}

	listActiveTools(): McpToolDescriptor[] {
		const out: McpToolDescriptor[] = [];
		for (const id of this.sessionEnabled) {
			const conn = this.live.get(id);
			if (conn?.status === "connected") out.push(...conn.tools);
		}
		return out;
	}

	listActiveToolNames(): string[] {
		return this.listActiveTools().map((t) => t.qualifiedName);
	}

	/** 全目录状态：目录来自发现，enabled=本会话是否打开 */
	statusList(): McpServerStatus[] {
		const catalog = discoverMcpCatalog(this.cwd);
		const defaults = loadDefaultEnabledMap(this.cwd);
		const session = new Set(this.sessionEnabled);
		return catalog.map((e) => {
			const enabled = session.has(e.id);
			const live = this.live.get(e.id);
			if (!enabled) {
				return {
					id: e.id,
					name: e.name,
					enabled: false,
					defaultEnabled: defaults[e.id] === true,
					transport: e.transport,
					status: "disconnected" as const,
					tools: [],
					summary: serverSummary(e),
					source: e.source,
					sources: e.sources,
					discovered: e.discovered,
				};
			}
			if (!live) {
				return {
					id: e.id,
					name: e.name,
					enabled: true,
					defaultEnabled: defaults[e.id] === true,
					transport: e.transport,
					status: "disconnected" as const,
					tools: [],
					summary: serverSummary(e),
					source: e.source,
					sources: e.sources,
					discovered: e.discovered,
				};
			}
			return {
				id: e.id,
				name: e.name,
				enabled: true,
				defaultEnabled: defaults[e.id] === true,
				transport: e.transport,
				status: live.status,
				error: live.error,
				tools: live.tools.map((t) => ({
					name: t.name,
					qualifiedName: t.qualifiedName,
					description: t.description,
				})),
				summary: serverSummary(e),
				source: e.source,
				sources: e.sources,
				discovered: e.discovered,
			};
		});
	}

	async callTool(
		serverId: string,
		toolName: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean; details: unknown }> {
		const sid = sanitizeServerId(serverId);
		if (!this.sessionEnabled.includes(sid)) {
			return {
				content: [{ type: "text", text: `MCP「${sid}」未在本对话启用。` }],
				isError: true,
				details: { serverId: sid, toolName },
			};
		}
		const conn = this.live.get(sid);
		if (!conn || conn.status !== "connected" || !conn.client) {
			return {
				content: [{ type: "text", text: `MCP 服务器「${sid}」未连接。` }],
				isError: true,
				details: { serverId: sid, toolName },
			};
		}
		const desc = conn.tools.find((t) => t.name === toolName || t.qualifiedName === toolName);
		const realName = desc?.name ?? toolName;
		try {
			const result = await conn.client.callTool(
				{ name: realName, arguments: args ?? {} },
				undefined,
				signal ? { signal } : undefined,
			);
			const content: Array<{ type: "text"; text: string }> = [];
			const blocks = Array.isArray(result.content) ? result.content : [];
			for (const block of blocks) {
				if (!block || typeof block !== "object") continue;
				const b = block as { type?: string; text?: string; data?: string; mimeType?: string };
				if (b.type === "text" && typeof b.text === "string") {
					content.push({ type: "text", text: b.text });
				} else if (b.type === "image" && typeof b.data === "string") {
					content.push({
						type: "text",
						text: `[MCP 图片 ${b.mimeType ?? "image"}，base64 长度 ${b.data.length}；请用 show_image 等通道交付给用户]`,
					});
				} else if (b.type === "resource" || b.type === "resource_link") {
					content.push({ type: "text", text: `[MCP 资源] ${JSON.stringify(block).slice(0, 2000)}` });
				} else {
					content.push({ type: "text", text: JSON.stringify(block).slice(0, 4000) });
				}
			}
			if (content.length === 0) {
				content.push({ type: "text", text: result.isError ? "工具返回错误（无文本内容）" : "（无输出）" });
			}
			return {
				content,
				isError: result.isError === true,
				details: { serverId: sid, toolName: realName, structured: result.structuredContent },
			};
		} catch (e) {
			return {
				content: [{ type: "text", text: `MCP 调用失败：${e instanceof Error ? e.message : String(e)}` }],
				isError: true,
				details: { serverId: sid, toolName: realName },
			};
		}
	}
}

export function formatMcpIndex(statuses: McpServerStatus[]): string {
	const live = statuses.filter((s) => s.enabled && s.status === "connected" && s.tools.length > 0);
	if (live.length === 0) {
		const errs = statuses.filter((s) => s.enabled && s.status === "error");
		if (errs.length > 0) {
			return `（本对话已启用 MCP 但连接失败：${errs.map((e) => `${e.name}「${e.error ?? "error"}」`).join("；")}）`;
		}
		const catalogN = statuses.length;
		return catalogN > 0
			? `（本机发现 ${catalogN} 个 MCP，本对话均未启用。可在「扩展能力 → MCP」打开需要的。）`
			: "（当前没有可用的 MCP 工具。）";
	}
	return live
		.map((s) => {
			const tools = s.tools.map((t) => `${t.qualifiedName}${t.description ? ` — ${t.description}` : ""}`).join("\n  ");
			return `- ${s.name}（${s.id}，${s.source}）\n  ${tools}`;
		})
		.join("\n");
}

// ---------- 连接底层 ----------

async function openConnection(server: McpServerConfig, timeoutMs: number): Promise<{ client: Client }> {
	const client = new Client({ name: "liyuan", version: "0.1.0" });
	if (server.transport === "stdio") {
		const transport = new StdioClientTransport({
			command: server.command!,
			args: server.args ?? [],
			env: server.env,
			cwd: server.cwd,
			stderr: "pipe",
		});
		await withTimeout(client.connect(transport), timeoutMs, `连接 stdio「${server.id}」超时`);
		return { client };
	}
	const url = new URL(server.url!);
	const requestInit =
		server.headers && Object.keys(server.headers).length > 0 ? { headers: server.headers } : undefined;
	if (server.transport === "sse") {
		const transport = new SSEClientTransport(url, requestInit ? { requestInit } : undefined);
		await withTimeout(client.connect(transport), timeoutMs, `连接 sse「${server.id}」超时`);
		return { client };
	}
	const transport = new StreamableHTTPClientTransport(url, requestInit ? { requestInit } : undefined);
	await withTimeout(client.connect(transport), timeoutMs, `连接 http「${server.id}」超时`);
	return { client };
}

function sameEndpoint(a: McpServerConfig, b: McpServerConfig): boolean {
	if (a.transport !== b.transport) return false;
	if (a.transport === "stdio") {
		return (
			a.command === b.command &&
			JSON.stringify(a.args ?? []) === JSON.stringify(b.args ?? []) &&
			JSON.stringify(a.env ?? {}) === JSON.stringify(b.env ?? {}) &&
			(a.cwd ?? "") === (b.cwd ?? "")
		);
	}
	return a.url === b.url && JSON.stringify(a.headers ?? {}) === JSON.stringify(b.headers ?? {});
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const t = setTimeout(() => reject(new Error(label)), ms);
		p.then(
			(v) => {
				clearTimeout(t);
				resolve(v);
			},
			(e) => {
				clearTimeout(t);
				reject(e);
			},
		);
	});
}
