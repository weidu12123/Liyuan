/**
 * 记忆配置：`.liyuan-memory/config.json`（与 liyuan.config 分离，改策略不必重载 agent）
 * 向量数据：`.liyuan-memory/scopes/<scopeId>/stores/<storeId>/chunks.jsonl`（按卡+对话隔离）
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHAT_MEMORY_DIR, DIRS } from "../paths.ts";
import {
	DEFAULT_CLOUD_EMBED,
	DEFAULT_MEMORY_CONFIG,
	type MemoryCloudEmbed,
	type MemoryConfig,
	type MemoryScope,
	type MemoryStoreConfig,
} from "./types.ts";

function memoryRoot(cwd: string): string {
	return join(cwd, DIRS.memory);
}

function memoryConfigPath(cwd: string): string {
	return join(memoryRoot(cwd), "config.json");
}

/** 归一化角色卡路径，保证同一卡不同写法落到同一 hash */
function normalizeMemoryCardKey(card?: string): string {
	return (card || "").replace(/\\/g, "/").trim().toLowerCase();
}

/**
 * 作用域目录名：`<cardHash10>__<sessionId>`。
 * 新对话 / 新角色卡 → 不同目录 → 互不串库。
 */
export function memoryScopeId(scope: MemoryScope): string {
	const sid = (scope.sessionId || "_default").replace(/[^\w.\-]/g, "_").slice(0, 80) || "_default";
	const cardKey = normalizeMemoryCardKey(scope.card);
	const cardHash = cardKey
		? createHash("sha1").update(cardKey).digest("hex").slice(0, 10)
		: "nocard";
	return `${cardHash}__${sid}`;
}

/** 某作用域下全部 store 的根目录 */
export function memoryScopeRoot(cwd: string, scope: MemoryScope): string {
	// 新布局：向量库住在子项目里，随卡目录一起拷走；scopeId 那套 hash 命名随之退役
	if (scope.chatDir) return join(scope.chatDir, CHAT_MEMORY_DIR);
	return join(memoryRoot(cwd), "scopes", memoryScopeId(scope));
}

function ensureDir(cwd: string): void {
	const root = memoryRoot(cwd);
	if (!existsSync(root)) mkdirSync(root, { recursive: true });
}

function normalizeStore(raw: Partial<MemoryStoreConfig> | undefined, fallback: MemoryStoreConfig): MemoryStoreConfig {
	const id = (raw?.id || fallback.id).replace(/[^\w\-]/g, "_").slice(0, 64) || fallback.id;
	const kind = raw?.kind === "external" || raw?.kind === "custom" || raw?.kind === "narrative" ? raw.kind : fallback.kind;
	// 内置库显示名固定（旧配置「外部资料/正文剧情」自动升级）
	let name = (raw?.name || fallback.name).slice(0, 80);
	if (id === "narrative") name = "剧情数据库";
	else if (id === "external") name = "额外数据库";
	// 剧情库条数上限默认更紧（合并入库，不必上千条）
	const minChunks = id === "narrative" ? 20 : 100;
	return {
		id,
		name,
		kind,
		enabled: raw?.enabled !== false,
		everyNTurns: clampInt(raw?.everyNTurns, 0, 50, fallback.everyNTurns),
		maxChunks: clampInt(raw?.maxChunks, minChunks, 50_000, fallback.maxChunks),
	};
}

function clampInt(v: unknown, min: number, max: number, d: number): number {
	const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : d;
	return Math.min(max, Math.max(min, n));
}

function normalizeCloud(raw: unknown): MemoryCloudEmbed {
	const d = DEFAULT_CLOUD_EMBED;
	if (!raw || typeof raw !== "object") return { ...d };
	const o = raw as Record<string, unknown>;
	return {
		baseUrl: typeof o.baseUrl === "string" ? o.baseUrl.trim() : d.baseUrl,
		apiKey: typeof o.apiKey === "string" ? o.apiKey : d.apiKey,
		model: typeof o.model === "string" ? o.model.trim() : d.model,
	};
}

function normalizeMemoryConfig(raw: unknown): MemoryConfig {
	const base = DEFAULT_MEMORY_CONFIG;
	if (!raw || typeof raw !== "object") return structuredClone(base);
	const o = raw as Record<string, unknown>;
	const storesIn = Array.isArray(o.stores) ? o.stores : base.stores;
	const defaultsById = new Map(base.stores.map((s) => [s.id, s]));
	const stores: MemoryStoreConfig[] = [];
	const seen = new Set<string>();
	for (const s of storesIn) {
		if (!s || typeof s !== "object") continue;
		const partial = s as Partial<MemoryStoreConfig>;
		const fb = defaultsById.get(String(partial.id ?? "")) ?? {
			id: String(partial.id || `custom_${stores.length}`),
			name: String(partial.name || "自定义库"),
			kind: "custom" as const,
			enabled: true,
			everyNTurns: 0,
			maxChunks: 2000,
		};
		const st = normalizeStore(partial, fb);
		if (seen.has(st.id)) continue;
		seen.add(st.id);
		stores.push(st);
	}
	for (const must of base.stores) {
		if (!seen.has(must.id)) {
			stores.unshift(must);
			seen.add(must.id);
		}
	}
	const turnCounters =
		o.turnCounters && typeof o.turnCounters === "object" && o.turnCounters
			? (o.turnCounters as Record<string, number>)
			: {};
	const embedMode = o.embedMode === "cloud" ? "cloud" : "local";
	return {
		version: 1,
		enabled: o.enabled === true,
		searchTopK: clampInt(o.searchTopK, 1, 20, base.searchTopK),
		injectOnTurn: o.injectOnTurn !== false,
		embedMode,
		cloudEmbed: normalizeCloud(o.cloudEmbed),
		stores,
		turnCounters,
	};
}

export function loadMemoryConfig(cwd: string): MemoryConfig {
	const p = memoryConfigPath(cwd);
	if (!existsSync(p)) return structuredClone(DEFAULT_MEMORY_CONFIG);
	try {
		return normalizeMemoryConfig(JSON.parse(readFileSync(p, "utf8")));
	} catch {
		return structuredClone(DEFAULT_MEMORY_CONFIG);
	}
}

export function saveMemoryConfig(cwd: string, cfg: MemoryConfig): MemoryConfig {
	ensureDir(cwd);
	const next = normalizeMemoryConfig(cfg);
	// 落盘时保留 apiKey；对外 GET 可脱敏
	writeFileSync(memoryConfigPath(cwd), JSON.stringify(next, null, 2), "utf8");
	return next;
}

export function patchMemoryConfig(cwd: string, patch: Partial<MemoryConfig>): MemoryConfig {
	const cur = loadMemoryConfig(cwd);
	const merged: MemoryConfig = {
		...cur,
		...patch,
		version: 1,
		cloudEmbed: patch.cloudEmbed ? { ...cur.cloudEmbed, ...patch.cloudEmbed } : cur.cloudEmbed,
	};
	return saveMemoryConfig(cwd, merged);
}

/** 给前端：apiKey 只回是否已配置 */
export function publicMemoryConfig(cfg: MemoryConfig): MemoryConfig & { cloudEmbedConfigured: boolean } {
	const key = cfg.cloudEmbed.apiKey || "";
	return {
		...cfg,
		cloudEmbed: {
			...cfg.cloudEmbed,
			apiKey: key ? "••••••••" : "",
		},
		cloudEmbedConfigured: key.length > 0,
	};
}
