/**
 * 梨园（Liyuan）接线层扩展 — Phase 2
 *
 * 本文件是项目中唯一允许接触 pi API 的地方（PLAN.md D3）。
 * 职责：装载配置/角色卡/世界书 → 组装 system prompt → 注册幕后工具 →
 * 每轮末端注入世界状态与触发设定 → 新会话注入开场白 →
 * 剧情向压缩接管 → 每轮后场记记账 + 一致性审计（旁侧模型，D10：产出是数据与告警，绝不碰正文）。
 */

import { existsSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@liyuan/agent-runtime";
import { completeSimple } from "@liyuan/ai/compat";
import { Type } from "typebox";

import { loadCardFile } from "../../src/card.ts";
import { buildImportBlock, cleanChat, DEFAULT_STRIP_TAGS, parseStChat, serializeForImportSummary } from "../../src/chatlog.ts";
import { findCommand } from "../../src/commands.ts";
import {
	appendCodexEntry,
	createCodex,
	findCodex,
	formatCodexIndex,
	listCodexes,
	loadCodexEntries,
} from "../../src/codex.ts";
import { buildRpSummaryPrompt, serializeForSummary } from "../../src/compaction.ts";
import { buildGreeting, buildSystemPrompt, buildTurnInjection, detectsLanguageMismatch } from "../../src/director.ts";
import {
	constantEntries,
	appendOverlayEntry,
	applyDisabledLore,
	loadLorebookFile,
	mergeEntries,
	mountedLorebookPaths,
	overlayPathFor,
	scanEntries,
	searchEntries,
	setMountedLorebooks,
	withAliases,
} from "../../src/lorebook.ts";
import { cleanAssistantText } from "../../src/postprocess.ts";
import {
	activePanels,
	closePanel,
	formatPanelIndex,
	loadPanels,
	PANEL_SOFT_LIMIT,
	savePanels,
	writePanel,
	type PanelMap,
} from "../../src/panels.ts";
import { enabledBlocks, normalizeRpPreset, type RpPreset } from "../../src/preset.ts";
import { formatPruneStats, pruneClosedTurns } from "../../src/retention.ts";
import { buildLoreAliasPrompt, buildScribeTurnPrompt, parseLoreAliases, parseScribeResult } from "../../src/scribe.ts";
import { listSkills, saveSkill } from "../../src/skills.ts";
import { formatUploadIndex, listUploads } from "../../src/uploads.ts";
import { isBackstageText } from "../../src/stance.ts";
import {
	applyPatch,
	canonicalizeCharacterKeys,
	defaultState,
	formatState,
	loadState,
	saveState,
} from "../../src/state.ts";
import {
	importLocalAudio,
	loadTtsConfig,
	saveAudioBuffer,
	synthesizeSpeech,
	ttsConfigHint,
} from "../../src/tts.ts";
import {
	defaultSessionEnabledIds,
	formatMcpIndex,
	getMcpHub,
	parametersFromMcpSchema,
	RP_MCP_TYPE,
	sanitizeServerId,
	type McpToolDescriptor,
} from "../../src/mcp.ts";
import { dir, resolveConfigPath, DIRS } from "../../src/paths.ts";
import { DEFAULT_CONFIG, type CharacterCard, type LorebookEntry, type RpConfig, type WorldState } from "../../src/types.ts";
import {
	buildAncestryIndex,
	buildWorldlineView,
	defaultSaveName,
	extractSaves,
	findSave,
	formatWorldlineText,
	latestSaveOnBranch,
	loadWorldlineMeta,
	metaPath,
	planNewSave,
	RP_SAVE_TYPE,
	type TreeEntryLite,
} from "../../src/worldline.ts";

// 剧情工具（world_state_update 于 F3 还给主演——场记已兜底，主演亲手记账更及时，PLAN-PHASE3 §6.3；
// lorebook_write：新造设定固化为正典，写入补充设定集 .liyuan-lore/，用户原始世界书永远只读；
// show_image / show_audio / show_video：媒体通道交付；skill_save：技能沉淀；
// panel_*：agent 自建面板（PLAN-PHASE4 柱 2）——agent 持有的前端展示面）
const RP_TOOLS = [
	"lorebook_search",
	"world_state_get",
	"world_state_update",
	"lorebook_write",
	"codex_create",
	"codex_mount",
	"codex_unmount",
	"codex_write",
	"show_image",
	"show_audio",
	"show_video",
	"show_html",
	"tts",
	"skill_save",
	"panel_write",
	"panel_read",
	"panel_close",
];

/** 决策门禁工具（PLAN-PHASE4 柱 1）：仅 creationMode==="ask" 时进活跃集，停笔向用户询问剧情决策 */
const ASK_TOOL = "ask_director";

/** 命令描述统一取自清单（src/commands.ts，与 Web 补全同源） */
const cmdDesc = (name: string): string => {
	const c = findCommand(name);
	return c ? `${c.description}，用法 ${c.usage}` : name;
};

export default function roleplayExtension(pi: ExtensionAPI) {
	let rpMode = true;
	let savedTools: string[] | null = null;

	let config: RpConfig = { ...DEFAULT_CONFIG };
	let card: CharacterCard | null = null;
	let entries: LorebookEntry[] = [];
	let systemPromptCache = "";
	let state: WorldState = defaultState();
	let stateFile = "";
	// agent 自建面板（柱 2）：与 state 同一套「磁盘缓存 + 会话树快照」机制
	let panels: PanelMap = {};
	let panelsFile = "";
	let preset: RpPreset | null = null;
	/** 补充设定集文件（lorebook_write 的落点，按卡分文件） */
	let overlayFile = "";
	// 知识库（柱 3）：本会话挂载的库名与其归一化条目（独立于卡，.liyuan-codex/ 全局存在）
	let mountedCodexes: string[] = [];
	let codexEntries: LorebookEntry[] = [];
	let codexIndexCache: string | null = null;
	/** 项目根（工具执行时无 ctx.cwd，session_start 捕获） */
	let appCwd = process.cwd();
	// 场记/审计：进行中标志（防重入）与待注入的一致性告警
	let scribeBusy = false;
	let pendingWarnings: string[] = [];
	// 世界书中文别名：一次性生成 + 磁盘缓存的懒初始化
	let aliasPromise: Promise<void> | null = null;
	// MCP 外设（柱 4）：本会话启用集 + 已注册工具（agent 绑对话，新对话=新窗口）
	let sessionMcpEnabled: string[] = [];
	let mcpToolNames: string[] = [];
	const mcpRegistered = new Set<string>();
	let mcpIndexCache = "（当前没有可用的 MCP 工具。）";

	const notify = (ctx: { ui: { notify: (msg: string, level: string) => void } }, msg: string, level = "info") => {
		try {
			ctx.ui.notify(msg, level);
		} catch {
			// print/rpc 模式无 UI 时静默
		}
	};

	const resolvePath = (cwd: string, p: string) => (isAbsolute(p) ? p : join(cwd, p));

	/**
	 * 装配 RP 工具底座（PLAN-PHASE3 §6.2 通用能力回归）：
	 * backendControl 开 → pi 通用工具（bash/read/write 等）+ 剧情工具；关 → 仅剧情工具。
	 * 优先用会话启动时的活跃集（savedTools）推断通用工具；若它已被上次收窄成纯剧情集
	 * （reload 场景），回落到 0.80.3 内置名单。
	 */
	const BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
	const applyRpToolset = () => {
		// 决策门禁开时把 ask_director 并入剧情工具集（silent 档不注册，模型无从调用=旧行为）
		const rpTools = config.creationMode === "ask" ? [...RP_TOOLS, ASK_TOOL] : RP_TOOLS;
		const withMcp = [...rpTools, ...mcpToolNames];
		if (config.backendControl !== false) {
			const general = (savedTools ?? []).filter(
				(t) => !rpTools.includes(t) && t !== ASK_TOOL && !t.startsWith("mcp__") && !mcpToolNames.includes(t),
			);
			const base = general.length > 0 ? general : BUILTIN_TOOLS;
			try {
				pi.setActiveTools([...new Set([...base, ...withMcp])]);
				return;
			} catch {
				// 个别工具名不可用：回落纯剧情工具集
			}
		}
		pi.setActiveTools(withMcp);
	};

	/** 把 hub 里已连接的 MCP 工具 register 进 agent（同名跳过，避免 reload 重复注册报错） */
	const registerMcpTools = (tools: McpToolDescriptor[]) => {
		const hub = getMcpHub(appCwd);
		for (const tool of tools) {
			if (mcpRegistered.has(tool.qualifiedName)) continue;
			try {
				const desc = tool;
				pi.registerTool({
					name: desc.qualifiedName,
					label: `MCP · ${desc.serverName} · ${desc.name}`,
					description:
						`[MCP:${desc.serverId}] ${desc.description || desc.name}`.slice(0, 1024),
					parameters: parametersFromMcpSchema(desc.inputSchema),
					async execute(_id, params, signal) {
						const args =
							params && typeof params === "object" && !Array.isArray(params)
								? (params as Record<string, unknown>)
								: {};
						const r = await hub.callTool(desc.serverId, desc.name, args, signal);
						return {
							content: r.content,
							details: r.details,
							...(r.isError ? { isError: true } : {}),
						};
					},
				});
				mcpRegistered.add(desc.qualifiedName);
			} catch (err) {
				if (process.env.RP_DEBUG) {
					console.error(
						`[rp-mcp] 注册 ${tool.qualifiedName} 失败：${err instanceof Error ? err.message : String(err)}`,
					);
				}
			}
		}
	};

	/** 本会话 MCP 启用集快照（随 rewind/fork 走） */
	const snapshotMcpEnabled = () => {
		try {
			pi.appendEntry(RP_MCP_TYPE, { enabled: sessionMcpEnabled });
		} catch {
			// 极早期不可写时跳过
		}
	};

	/** 从剧情分支恢复本会话 MCP 启用集；无快照返回 false */
	const restoreMcpFromBranch = (sm: { getBranch: (fromId?: string) => unknown[] }): boolean => {
		try {
			const branch = sm.getBranch() as Array<Record<string, unknown>>;
			for (let i = branch.length - 1; i >= 0; i--) {
				const e = branch[i];
				if (e.type === "custom" && e.customType === RP_MCP_TYPE && e.data && typeof e.data === "object") {
					const enabled = (e.data as { enabled?: unknown }).enabled;
					sessionMcpEnabled = Array.isArray(enabled)
						? enabled.map((x) => sanitizeServerId(String(x))).filter(Boolean)
						: [];
					return true;
				}
			}
		} catch {
			// ignore
		}
		return false;
	};

	/**
	 * 同步 MCP：按本会话启用集 connect → 注册工具 → 刷新活跃集与索引。
	 * @param enabled 若传入则更新会话启用集并落树；否则用当前 sessionMcpEnabled
	 */
	const syncMcp = async (enabled?: string[]) => {
		if (enabled) {
			sessionMcpEnabled = [...new Set(enabled.map(sanitizeServerId).filter(Boolean))];
			snapshotMcpEnabled();
		}
		const hub = getMcpHub(appCwd);
		const statuses = await hub.sync(sessionMcpEnabled);
		const tools = hub.listActiveTools();
		mcpToolNames = tools.map((t) => t.qualifiedName);
		registerMcpTools(tools);
		mcpIndexCache = formatMcpIndex(statuses);
		if (rpMode) applyRpToolset();
		return statuses;
	};

	/** 状态快照写入会话树：账本随剧情分支走（/rewind /branch 后可恢复），.liyuan-state 文件只是最新位置的缓存 */
	const snapshotState = () => {
		try {
			pi.appendEntry("rp-state", state);
		} catch {
			// 会话不可写时（极早期生命周期）跳过；下次写入会补上
		}
	};

	/** 从当前剧情分支上最近的快照恢复账本；无快照返回 false */
	const restoreStateFromBranch = (sm: { getBranch: (fromId?: string) => unknown[] }): boolean => {
		try {
			const branch = sm.getBranch() as Array<Record<string, unknown>>;
			for (let i = branch.length - 1; i >= 0; i--) {
				const e = branch[i];
				if (e.type === "custom" && e.customType === "rp-state" && e.data && typeof e.data === "object") {
					state = { ...defaultState(), ...(e.data as Partial<WorldState>) };
					return true;
				}
			}
		} catch {
			// 树读取失败按无快照处理
		}
		return false;
	};

	/** 面板快照写入会话树（同 snapshotState）：面板随剧情分支走，rewind 后地图同步回退 */
	const snapshotPanels = () => {
		try {
			pi.appendEntry("rp-panels", panels);
		} catch {
			// 会话不可写时跳过；下次写入会补上
		}
	};

	/** 面板落盘 + 快照（工具执行处共用）。写文件触发 server 的 fs.watch → panels 帧推送前端 */
	const persistPanels = () => {
		if (panelsFile) savePanels(panelsFile, panels);
		snapshotPanels();
	};

	/** 从当前剧情分支上最近的面板快照恢复；无快照返回 false */
	const restorePanelsFromBranch = (sm: { getBranch: (fromId?: string) => unknown[] }): boolean => {
		try {
			const branch = sm.getBranch() as Array<Record<string, unknown>>;
			for (let i = branch.length - 1; i >= 0; i--) {
				const e = branch[i];
				if (e.type === "custom" && e.customType === "rp-panels" && e.data && typeof e.data === "object") {
					panels = { ...(e.data as PanelMap) };
					return true;
				}
			}
		} catch {
			// 树读取失败按无快照处理
		}
		return false;
	};

	// ---------- 知识库挂载（柱 3）：挂载关系随剧情分支走，与账本/面板同一套快照机制 ----------

	/** 重新装载全部挂载库的条目（挂载/卸载/写入后调用；库被删除的静默跳过），同时刷新末端注入用的速览 */
	const reloadCodexEntries = () => {
		const loaded = mountedCodexes.map((n) => ({ name: n, entries: loadCodexEntries(appCwd, n) ?? [] }));
		codexEntries = loaded.flatMap((c) => c.entries);
		codexIndexCache = formatCodexIndex(loaded.map((c) => ({ name: c.name, entryCount: c.entries.length })));
	};

	/** 检索用的合并条目集：卡素材（含补充设定集）+ 挂载知识库 */
	const allEntries = () => (codexEntries.length > 0 ? [...entries, ...codexEntries] : entries);

	/** 挂载清单快照写入会话树（rewind/fork 后挂载关系跟随剧情位置） */
	const snapshotCodexMounts = () => {
		try {
			pi.appendEntry("rp-codex", { mounted: mountedCodexes });
		} catch {
			// 会话不可写时跳过；下次写入会补上
		}
	};

	/** 从当前剧情分支上最近的挂载快照恢复；无快照返回 false */
	const restoreCodexFromBranch = (sm: { getBranch: (fromId?: string) => unknown[] }): boolean => {
		try {
			const branch = sm.getBranch() as Array<Record<string, unknown>>;
			for (let i = branch.length - 1; i >= 0; i--) {
				const e = branch[i];
				if (e.type === "custom" && e.customType === "rp-codex" && e.data && typeof e.data === "object") {
					const mounted = (e.data as { mounted?: unknown }).mounted;
					mountedCodexes = Array.isArray(mounted) ? mounted.filter((n): n is string => typeof n === "string") : [];
					return true;
				}
			}
		} catch {
			// 树读取失败按无快照处理
		}
		return false;
	};

	/** 旁侧模型调用（场记/审计/摘要/别名共用）。返回文本或 null；错误上抛由调用方定夺 */
	type SideCtx = {
		model?: Parameters<typeof completeSimple>[0];
		modelRegistry: { getApiKeyAndHeaders: (m: never) => Promise<{ apiKey?: string; headers?: Record<string, string> }> };
	};
	const sideComplete = async (
		ctx: SideCtx,
		systemPrompt: string,
		userText: string,
		maxTokens: number,
		signal?: AbortSignal,
	): Promise<string | null> => {
		if (!ctx.model) return null;
		const { apiKey, headers } = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model as never);
		const response = await completeSimple(
			ctx.model,
			{
				systemPrompt,
				messages: [{ role: "user", content: [{ type: "text", text: userText }], timestamp: Date.now() }],
			},
			{ apiKey, headers, signal, maxTokens },
		);
		if (response.stopReason === "error") {
			throw new Error(response.errorMessage || "side model error");
		}
		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n")
			.trim();
		return text || null;
	};

	/** 从任意消息对象提取纯文本（user 字符串、assistant/custom 内容块） */
	const extractText = (m: unknown): string => {
		const msg = m as { role?: string; content?: unknown };
		if (typeof msg.content === "string") return msg.content;
		if (Array.isArray(msg.content)) {
			return msg.content
				.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
				.join("\n");
		}
		return "";
	};

	/**
	 * 会话树里的开场白条目：pi 用 custom_message 落盘，不是 type=message + role=custom。
	 * 旧逻辑只认 message 形，导致 greetIdx 永远 -1 → 切换时直接 append，叠出 #1#2#3#4。
	 */
	type BranchEntry = {
		id: string;
		parentId?: string | null;
		type: string;
		customType?: string;
		message?: { role?: string; customType?: string; content?: unknown };
	};
	const isGreetingEntry = (e: BranchEntry): boolean => {
		if (e.type === "custom_message" && e.customType === "rp-greeting") return true;
		if (e.type === "message" && e.message?.role === "custom" && e.message?.customType === "rp-greeting") {
			return true;
		}
		return false;
	};
	/**
	 * 退到「第一条开场白」之前，使新开场白成为同级 sibling（界面上同一条记录被替换，而不是往下叠楼）。
	 * @returns "injected" = 已由 newSession/session_start 注入，调用方勿再 sendMessage；
	 *          "ready" = 叶已就位，调用方可 inject；"cancelled" = 用户取消。
	 */
	const navigateBeforeGreetings = async (
		ctx: { navigateTree: (id: string, o: { summarize: boolean }) => Promise<{ cancelled: boolean }>; newSession: () => Promise<{ cancelled: boolean }> },
		branch: BranchEntry[],
	): Promise<"injected" | "ready" | "cancelled"> => {
		const greets = branch.filter(isGreetingEntry);
		if (greets.length === 0) return "ready";
		const first = greets[0];
		const parentId = first.parentId ?? null;
		if (parentId) {
			const result = await ctx.navigateTree(parentId, { summarize: false });
			return result.cancelled ? "cancelled" : "ready";
		}
		// 开场白是树根：无 parent 可导航 → 新会话（session_start 按已更新的 greetingIndex 注入一条）
		const result = await ctx.newSession();
		return result.cancelled ? "cancelled" : "injected";
	};

	/**
	 * 世界书中文别名懒初始化：为无 CJK 关键词的条目生成中文检索别名并合入 keys。
	 * 修复实证缺陷（agent-run-03）：主演把专有名词中译后，英文关键词地板整场失效。
	 * 结果按世界书内容哈希缓存到 .liyuan-cache/，每副世界书只花一次旁侧调用。
	 */
	const ensureAliases = (ctx: SideCtx & { cwd: string }) => {
		if (aliasPromise) return aliasPromise;
		aliasPromise = (async () => {
			if (!/中文|汉语|chinese/i.test(config.language)) return;
			const need = entries.filter(
				(e) => e.enabled && e.keys.length > 0 && !e.keys.some((k) => /\p{Script=Han}/u.test(k)),
			);
			if (need.length === 0) return;
			const hash = createHash("md5")
				.update(JSON.stringify(need.map((e) => [e.uid, e.keys, e.content])))
				.digest("hex")
				.slice(0, 12);
			const cacheFile = join(dir(ctx.cwd, "cache"), `lore-aliases-${hash}.json`);
			let aliasMap: Map<number, string[]> | null = null;
			if (existsSync(cacheFile)) {
				try {
					const raw = JSON.parse(readFileSync(cacheFile, "utf8")) as Record<string, string[]>;
					aliasMap = new Map(Object.entries(raw).map(([k, v]) => [Number(k), v]));
				} catch {
					// 缓存损坏则重新生成
				}
			}
			if (!aliasMap) {
				const { systemPrompt, userText } = buildLoreAliasPrompt(
					need.map((e) => ({ uid: e.uid, keys: e.keys, comment: e.comment, excerpt: e.content.slice(0, 300) })),
					config.language,
				);
				const text = await sideComplete(ctx, systemPrompt, userText, 1024);
				if (!text) return;
				aliasMap = parseLoreAliases(text);
				if (!aliasMap || aliasMap.size === 0) return;
				try {
					mkdirSync(join(dir(ctx.cwd, "cache")), { recursive: true });
					writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(aliasMap), null, "\t"), "utf8");
				} catch {
					// 缓存写入失败不影响本次会话
				}
			}
			entries = withAliases(entries, aliasMap);
			if (process.env.RP_DEBUG) {
				console.error(`[rp-alias] 世界书中文别名就绪（${aliasMap.size} 条）`);
			}
		})().catch((err) => {
			if (process.env.RP_DEBUG) {
				console.error(`[rp-alias] 生成失败（下次会话重试）：${err instanceof Error ? err.message : String(err)}`);
			}
			aliasPromise = null; // 允许重试
		});
		return aliasPromise;
	};

	// ---------- 幕后工具 ----------

	try {
		pi.registerTool({
			name: "lorebook_search",
			label: "世界书检索",
			description:
				"Search the roleplay lorebook (world info) for setting details: places, races, history, characters, magic. Lore text is in English — use English keywords. Call this BEFORE writing narrative that involves world details you are not fully sure about.",
			parameters: Type.Object({
				query: Type.String({ description: "Keywords in the lorebook's own language" }),
			}),
			async execute(_id, params) {
				const hits = searchEntries(allEntries(), params.query, 3);
				if (hits.length === 0) {
					return { content: [{ type: "text", text: "No matching lore entries. The detail is unwritten — invent it consistently with established facts, then record important inventions via world_state_update (plot_threads or flags)." }] };
				}
				const text = hits
					.map((h) => `### ${h.entry.comment || h.entry.keys[0] || "entry"} (keys: ${h.entry.keys.join(", ")})\n${h.entry.content}`)
					.join("\n\n");
				return { content: [{ type: "text", text }], details: { hits: hits.map((h) => ({ uid: h.entry.uid, score: h.score })) } };
			},
		});

		pi.registerTool({
			name: "world_state_get",
			label: "查看世界状态",
			description: "Get the current structured world state (time, location, character affinity/status, inventory, flags, plot threads). Call when unsure about established facts.",
			parameters: Type.Object({}),
			async execute() {
				return { content: [{ type: "text", text: formatState(state) + "\n\nRAW:\n" + JSON.stringify(state) }] };
			},
		});

		pi.registerTool({
			name: "lorebook_write",
			label: "写入补充设定集",
			description:
				"Record a NEW piece of world canon (a setting/rule/character profile you invented or agreed on with the user) into the supplementary lorebook, so it persists across sessions and becomes searchable. Use for worldbuilding facts only — plot progress belongs to world_state_update. Never duplicates: identical content is rejected.",
			parameters: Type.Object({
				title: Type.String({ description: "Short entry title, e.g. '北境骨誓风俗'" }),
				keys: Type.Array(Type.String(), {
					description: "Trigger keywords for retrieval (include Chinese AND any original-language names)",
				}),
				content: Type.String({ description: "The canon text (concise, factual, in the story's language)" }),
				constant: Type.Optional(
					Type.Boolean({ description: "true = always inject into context (reserve for globally critical facts)" }),
				),
			}),
			async execute(_id, params) {
				if (!overlayFile) {
					return { content: [{ type: "text", text: "补充设定集未就绪（会话尚未装载角色卡）。" }], isError: true };
				}
				const entry = appendOverlayEntry(overlayFile, {
					title: params.title,
					keys: params.keys,
					content: params.content,
					constant: params.constant,
				});
				if (!entry) {
					return { content: [{ type: "text", text: "内容与已有条目重复，未写入。" }] };
				}
				entries = [...entries, entry];
				return {
					content: [
						{
							type: "text",
							text: `已固化为正典：【${entry.comment}】关键词 ${entry.keys.join("、") || "（无）"}${entry.constant ? "（常驻注入）" : ""}。此后检索可命中，跨会话保留。`,
						},
					],
					details: { uid: entry.uid, file: overlayFile },
				};
			},
		});

		// ---------- 知识库（PLAN-PHASE4 柱 3）：用户自建、跨对话挂载的命名设定库 ----------

		pi.registerTool({
			name: "codex_create",
			label: "创建知识库",
			description:
				"Create a new named knowledge codex — a user-owned lore database independent of any character card, mountable to ANY conversation (e.g. '九州风物志', '奇物图鉴'). Use when the user asks to create a codex/database/library for collecting knowledge across stories. The new codex is automatically mounted to this conversation.",
			parameters: Type.Object({
				name: Type.String({ description: "Codex name, e.g. '九州风物志'（≤40 chars, used as its identity everywhere）" }),
				description: Type.Optional(Type.String({ description: "One-line summary of what this codex collects" })),
			}),
			async execute(_id, params) {
				const r = createCodex(appCwd, params.name, params.description ?? "");
				if (!r.ok) {
					return { content: [{ type: "text", text: r.error }], isError: true };
				}
				if (!mountedCodexes.some((n) => n.toLowerCase() === r.meta.name.toLowerCase())) {
					mountedCodexes = [...mountedCodexes, r.meta.name];
					snapshotCodexMounts();
					reloadCodexEntries();
				}
				return {
					content: [
						{
							type: "text",
							text: `知识库「${r.meta.name}」已创建并挂载到本对话。此后可用 codex_write 写入条目；其他对话也可 codex_mount 挂载它。`,
						},
					],
					details: { codex: r.meta.name },
				};
			},
		});

		pi.registerTool({
			name: "codex_mount",
			label: "挂载知识库",
			description:
				"Mount an existing knowledge codex onto this conversation (its entries join lorebook_search results, and you may write new entries into it via codex_write). Call WITHOUT a name to list all available codexes. Mounts persist with the story branch (they survive across turns and follow rewind).",
			parameters: Type.Object({
				name: Type.Optional(Type.String({ description: "Codex name to mount; omit to list all codexes" })),
			}),
			async execute(_id, params) {
				const all = listCodexes(appCwd);
				if (!params.name || !params.name.trim()) {
					if (all.length === 0) {
						return { content: [{ type: "text", text: "尚无任何知识库。可用 codex_create 创建。" }] };
					}
					const lines = all.map((c) => {
						const mounted = mountedCodexes.some((n) => n.toLowerCase() === c.name.toLowerCase());
						return `- ${c.name}（${c.entryCount} 条${mounted ? "，已挂载" : ""}）${c.description ? `：${c.description}` : ""}`;
					});
					return { content: [{ type: "text", text: `现有知识库：\n${lines.join("\n")}` }] };
				}
				const meta = findCodex(appCwd, params.name);
				if (!meta) {
					const known = all.map((c) => c.name).join("、");
					return {
						content: [{ type: "text", text: `没有名为「${params.name.trim()}」的知识库${known ? `（现有：${known}）` : "（尚无任何库，可 codex_create 创建）"}。` }],
						isError: true,
					};
				}
				if (mountedCodexes.some((n) => n.toLowerCase() === meta.name.toLowerCase())) {
					return { content: [{ type: "text", text: `知识库「${meta.name}」已在挂载中（${meta.entryCount} 条）。` }] };
				}
				mountedCodexes = [...mountedCodexes, meta.name];
				snapshotCodexMounts();
				reloadCodexEntries();
				return {
					content: [
						{ type: "text", text: `知识库「${meta.name}」已挂载（${meta.entryCount} 条），条目已并入检索。剧情中出现值得沉淀的新知识可用 codex_write 写入。` },
					],
					details: { codex: meta.name, entryCount: meta.entryCount },
				};
			},
		});

		pi.registerTool({
			name: "codex_unmount",
			label: "卸载知识库",
			description:
				"Unmount a codex from this conversation (the codex file is kept on disk untouched; it just stops participating in this story's retrieval).",
			parameters: Type.Object({
				name: Type.String({ description: "Mounted codex name to unmount" }),
			}),
			async execute(_id, params) {
				const n = params.name.trim().toLowerCase();
				if (!mountedCodexes.some((x) => x.toLowerCase() === n)) {
					return {
						content: [{ type: "text", text: `「${params.name.trim()}」不在挂载中${mountedCodexes.length ? `（当前挂载：${mountedCodexes.join("、")}）` : "（当前无挂载）"}。` }],
						isError: true,
					};
				}
				mountedCodexes = mountedCodexes.filter((x) => x.toLowerCase() !== n);
				snapshotCodexMounts();
				reloadCodexEntries();
				return { content: [{ type: "text", text: `知识库「${params.name.trim()}」已卸载（文件保留，随时可再挂载）。` }] };
			},
		});

		pi.registerTool({
			name: "codex_write",
			label: "写入知识库",
			description:
				"Record a piece of knowledge into a MOUNTED codex so it persists across ALL conversations that mount it. Use PROACTIVELY when the story produces novel knowledge/items/beings/places worth keeping beyond this story — and when the user asks to record something. Card-specific canon belongs to lorebook_write instead. Never duplicates: identical content is rejected.",
			parameters: Type.Object({
				codex: Type.String({ description: "Mounted codex name to write into" }),
				title: Type.String({ description: "Short entry title, e.g. '赤髓·蚀骨兰'" }),
				keys: Type.Array(Type.String(), {
					description: "Trigger keywords for retrieval (include Chinese AND any original-language names)",
				}),
				content: Type.String({ description: "The knowledge text (concise, factual, in the story's language)" }),
				constant: Type.Optional(
					Type.Boolean({ description: "true = always inject into context when mounted (reserve for critical facts)" }),
				),
			}),
			async execute(_id, params) {
				if (!mountedCodexes.some((n) => n.toLowerCase() === params.codex.trim().toLowerCase())) {
					return {
						content: [{ type: "text", text: `「${params.codex.trim()}」未挂载到本对话${mountedCodexes.length ? `（当前挂载：${mountedCodexes.join("、")}）` : ""}。先 codex_mount 再写入。` }],
						isError: true,
					};
				}
				const r = appendCodexEntry(appCwd, params.codex, {
					title: params.title,
					keys: params.keys,
					content: params.content,
					constant: params.constant,
				});
				if (!r.ok) {
					return { content: [{ type: "text", text: r.error }], isError: true };
				}
				if (!r.entry) {
					return { content: [{ type: "text", text: "内容与库中已有条目重复，未写入。" }] };
				}
				reloadCodexEntries();
				return {
					content: [
						{
							type: "text",
							text: `已写入知识库「${params.codex.trim()}」：【${r.entry.comment}】关键词 ${r.entry.keys.join("、") || "（无）"}。所有挂载该库的对话此后都能检索到。`,
						},
					],
					details: { codex: params.codex.trim(), uid: r.entry.uid },
				};
			},
		});

		pi.registerTool({
			name: "world_state_update",
			label: "更新世界状态",
			description:
				"Record persistent changes to the world state. Call IMMEDIATELY when: time/location changes, items gained/lost, injuries/recovery, affinity or relationship shifts, promises made, new plot threads opened or resolved. Semantics: time/location = replace; characters/flags = per-key merge (null deletes); inventory/plot_threads = pass the COMPLETE new array (full replace).",
			parameters: Type.Object({
				time: Type.Optional(Type.String({ description: "In-story time, e.g. '第二天清晨'" })),
				location: Type.Optional(Type.String()),
				characters: Type.Optional(
					Type.Record(
						Type.String({
							description:
								"Character name — use the EXACT name as it already appears in 【世界状态】 or on the character card. NEVER invent alternate spellings or translations for the same character.",
						}),
						Type.Union([
							Type.Object({
								affinity: Type.Optional(Type.Number({ description: "-100..100 attitude toward the user" })),
								status: Type.Optional(Type.String()),
								notes: Type.Optional(Type.String()),
							}),
							Type.Null(),
						]),
					),
				),
				inventory: Type.Optional(Type.Array(Type.String(), { description: "COMPLETE inventory after the change" })),
				flags: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Null()]))),
				plot_threads: Type.Optional(Type.Array(Type.String(), { description: "COMPLETE list of open plot threads" })),
			}),
			async execute(_id, params) {
				const knownNames = [
					...(card ? [card.name] : []),
					config.userName,
					...Object.keys(state.characters),
				];
				const patch = canonicalizeCharacterKeys(params as Record<string, unknown>, knownNames);
				const result = applyPatch(state, patch);
				state = result.state;
				if (stateFile) saveState(stateFile, state);
				snapshotState();
				const lines = [...result.applied.map((a) => `✓ ${a}`), ...result.warnings.map((w) => `⚠ ${w}`)];
				return {
					content: [{ type: "text", text: lines.length ? lines.join("\n") : "（无变更）" }],
					details: { state },
				};
			},
		});

		// 图片通道（PLAN-PHASE3 §6.5）：交付数据放 details.rpImage，wire 层翻译成 image 消息
		// （toolResult 自然进会话文件 → live 推送与刷新重放同一条路径；D10：插图是舞台美术，与正文明确区隔）
		pi.registerTool({
			name: "show_image",
			label: "展示图片",
			description:
				"Display an image to the user inside the chat (shown below the narrative, clearly separated). Use this to DELIVER any image the user asked for (e.g. one you just generated via an external API) — never just paste a link as text. source = an http(s) image URL, or a LOCAL file path of an image on this machine.",
			parameters: Type.Object({
				source: Type.String({ description: "http(s) image URL, or local image file path (.png/.jpg/.jpeg/.webp/.gif/.avif)" }),
				caption: Type.Optional(Type.String({ description: "Short caption shown under the image" })),
			}),
			async execute(_id, params) {
				let src: string;
				if (/^https?:\/\//i.test(params.source)) {
					src = params.source;
				} else {
					const abs = resolvePath(appCwd, params.source);
					if (!existsSync(abs)) {
						return { content: [{ type: "text", text: `图片文件不存在：${abs}` }], isError: true };
					}
					const ext = extname(abs).toLowerCase();
					if (![".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"].includes(ext)) {
						return { content: [{ type: "text", text: `不支持的图片格式：${ext || "（无扩展名）"}` }], isError: true };
					}
					// 复制进 .liyuan-media/（内容寻址命名）：会话可携带展示历史，原文件删了也不影响回看
					const mediaDir = dir(appCwd, "media");
					mkdirSync(mediaDir, { recursive: true });
					const name = `${createHash("md5").update(readFileSync(abs)).digest("hex").slice(0, 16)}${ext}`;
					copyFileSync(abs, join(mediaDir, name));
					src = `/media/${name}`;
				}
				return {
					content: [{ type: "text", text: "图片已在对话中展示给用户。" }],
					details: { rpImage: { src, ...(params.caption ? { caption: params.caption } : {}) } },
				};
			},
		});

		// 音频通道（同 show_image）：交付配乐/配音文件；文生音见 tts 工具
		pi.registerTool({
			name: "show_audio",
			label: "展示音频",
			description:
				"Display an audio player in the chat (below narrative, clearly separated). Use after you generated or obtained an audio file — never just paste a bare link. source = http(s) audio URL, or a LOCAL audio file path (.mp3/.wav/.ogg/.m4a/.webm).",
			parameters: Type.Object({
				source: Type.String({ description: "http(s) audio URL, or local audio file path" }),
				caption: Type.Optional(Type.String({ description: "Short label under the player" })),
			}),
			async execute(_id, params) {
				let src: string;
				if (/^https?:\/\//i.test(params.source)) {
					src = params.source;
				} else {
					const abs = resolvePath(appCwd, params.source);
					if (!existsSync(abs)) {
						return { content: [{ type: "text", text: `音频文件不存在：${abs}` }], isError: true };
					}
					const ext = extname(abs).toLowerCase();
					if (![".mp3", ".wav", ".ogg", ".m4a", ".webm", ".aac", ".flac"].includes(ext)) {
						return { content: [{ type: "text", text: `不支持的音频格式：${ext || "（无扩展名）"}` }], isError: true };
					}
					const saved = importLocalAudio(appCwd, abs, ext);
					src = saved.src;
				}
				return {
					content: [{ type: "text", text: "音频已在对话中展示给用户（可播放）。" }],
					details: { rpAudio: { src, ...(params.caption ? { caption: params.caption } : {}) } },
				};
			},
		});

		// 视频通道（同 show_image/audio）：第三方/本机生成的短视频交付到对话内播放器
		pi.registerTool({
			name: "show_video",
			label: "展示视频",
			description:
				"Display a video player in the chat (below narrative, clearly separated). Use after you generated or obtained a video (e.g. via external API or skill) — never just paste a bare link. source = http(s) video URL, or a LOCAL video file path (.mp4/.webm/.mov/.mkv/.ogv).",
			parameters: Type.Object({
				source: Type.String({ description: "http(s) video URL, or local video file path" }),
				caption: Type.Optional(Type.String({ description: "Short caption under the player" })),
			}),
			async execute(_id, params) {
				let src: string;
				if (/^https?:\/\//i.test(params.source)) {
					src = params.source;
				} else {
					const abs = resolvePath(appCwd, params.source);
					if (!existsSync(abs)) {
						return { content: [{ type: "text", text: `视频文件不存在：${abs}` }], isError: true };
					}
					const ext = extname(abs).toLowerCase();
					if (![".mp4", ".webm", ".mov", ".mkv", ".ogv", ".m4v"].includes(ext)) {
						return { content: [{ type: "text", text: `不支持的视频格式：${ext || "（无扩展名）"}` }], isError: true };
					}
					// 与图片同目录内容寻址：/media/ 已托管；大文件可接受（会话回放依赖副本）
					const mediaDir = dir(appCwd, "media");
					mkdirSync(mediaDir, { recursive: true });
					const name = `${createHash("md5").update(readFileSync(abs)).digest("hex").slice(0, 16)}${ext}`;
					const dest = join(mediaDir, name);
					if (!existsSync(dest)) copyFileSync(abs, dest);
					src = `/media/${name}`;
				}
				return {
					content: [{ type: "text", text: "视频已在对话中展示给用户（可播放）。" }],
					details: { rpVideo: { src, ...(params.caption ? { caption: params.caption } : {}) } },
				};
			},
		});

		// 对话流 HTML 底座：在聊天消息流中嵌入可渲染 HTML（手机框、小界面等），与角色卡前端无关
		pi.registerTool({
			name: "show_html",
			label: "展示 HTML",
			description:
				"Embed a custom HTML UI in the CHAT STREAM (below narrative, clearly separated)—e.g. a phone SMS thread, status card, mini map, or interactive widget. Pass complete HTML (fragment or full document). Set scripts=true when the UI needs JavaScript (runs in a sandboxed iframe isolated from the parent page). Prefer show_html over dumping raw HTML as plain text. For side-panel meta only, use panel_write instead.",
			parameters: Type.Object({
				html: Type.String({
					description: "HTML document or fragment to render in the chat (e.g. phone chrome + message bubbles)",
				}),
				title: Type.Optional(Type.String({ description: "Short label above the frame" })),
				scripts: Type.Optional(
					Type.Boolean({
						description:
							"true = allow JS inside the iframe (still sandboxed, cannot access parent). false/default = static HTML/CSS only.",
					}),
				),
			}),
			async execute(_id, params) {
				const html = typeof params.html === "string" ? params.html : "";
				if (!html.trim()) {
					return { content: [{ type: "text", text: "html 不能为空" }], isError: true };
				}
				if (html.length > 500_000) {
					return { content: [{ type: "text", text: `html 过大（${html.length} 字符，上限 500000）` }], isError: true };
				}
				return {
					content: [{ type: "text", text: "HTML 界面已在对话中展示给用户。" }],
					details: {
						rpHtml: {
							html,
							...(params.title ? { title: params.title } : {}),
							scripts: params.scripts === true,
						},
					},
				};
			},
		});

		// 文生音：OpenAI 兼容 speech API → .liyuan-audio/ → 对话内播放器（与 show_audio 同一交付通道）
		pi.registerTool({
			name: "tts",
			label: "文生音",
			description:
				"Synthesize speech from text (TTS) and show a player in chat. Use when the user asks to 配音/朗读/生成语音 for dialogue or narration. Requires server TTS env (LIYUAN_TTS_API_KEY or OPENAI_API_KEY). Prefer Chinese text as-is; keep lines reasonably short.",
			parameters: Type.Object({
				text: Type.String({ description: "Text to speak (prefer one speech turn, not a whole chapter)" }),
				caption: Type.Optional(Type.String({ description: "Label under the player" })),
				voice: Type.Optional(Type.String({ description: "Voice id if the provider supports it (e.g. alloy, nova)" })),
			}),
			async execute(_id, params) {
				const cfg = loadTtsConfig();
				if (!cfg) {
					return { content: [{ type: "text", text: ttsConfigHint() }], isError: true };
				}
				try {
					const { buffer, ext } = await synthesizeSpeech(cfg, params.text, {
						...(params.voice ? { voice: params.voice } : {}),
					});
					const saved = saveAudioBuffer(appCwd, buffer, ext);
					return {
						content: [{ type: "text", text: `已生成语音并展示（${saved.bytes} 字节）。` }],
						details: {
							rpAudio: {
								src: saved.src,
								caption: params.caption ?? params.text.slice(0, 40),
							},
						},
					};
				} catch (err) {
					return {
						content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
						isError: true,
					};
				}
			},
		});

		// 技能沉淀（PLAN-PHASE3 §6.4）：agent 摸通外部服务后自写调用笔记，跨会话复用
		pi.registerTool({
			name: "skill_save",
			label: "沉淀技能",
			description:
				"Save a reusable skill note into the skill library (${DIRS.skills}/) — how to call an external service/API you just figured out, or one the user handed you (URL + key) and asked to save. Write it so a future session can succeed in ONE step: base URL, auth, request format, one VERIFIED curl example, quirks. Saving with an existing name updates that skill.",
			parameters: Type.Object({
				name: Type.String({ description: "Short stable skill name, e.g. 'comfyui-生图'" }),
				description: Type.String({ description: "One-line summary shown in the skill index" }),
				content: Type.String({ description: "Full note in Markdown: endpoint, auth, request format, verified curl example, notes" }),
				disableModelInvocation: Type.Optional(
					Type.Boolean({
						description:
							"true = hide this skill from the model-facing index; it can only be invoked explicitly by the user via /skill:name. Use when the user says the skill should only run on their explicit command.",
					}),
				),
			}),
			async execute(_id, params) {
				const saved = saveSkill(appCwd, params);
				return {
					content: [
						{
							type: "text",
							text: `技能已${saved.updated ? "更新" : "保存"}：${params.name}（${saved.file}）。本会话的技能清单不会刷新，但文件已生效——下次会话可直接按清单调用。`,
						},
					],
					details: saved,
				};
			},
		});

		// ---------- Agent 自建面板（PLAN-PHASE4 柱 2）：agent 持有的前端展示面 ----------
		//
		// 面板种类不由我们穷举，由 agent 按剧情需要现场发明（地图/装备库/线索板……）。
		// 持久化同 rp-state 三件套：.liyuan-artifacts/<sessionId>.json 缓存 + rp-panels 树快照，
		// 落盘触发 server 的 fs.watch → panels 帧 → 前端右栏动态页签。D10：面板是舞台美术，不碰正文。

		pi.registerTool({
			name: "panel_write",
			label: "更新面板",
			description:
				"Create or update one of YOUR display panels — UI you own, shown beside the chat as a tab (map, inventory, clue board, relationship chart, custom tracker…). Invent panels as the story needs them; update a panel whenever its facts change. Same name = full replacement of content. kind: 'markdown' (lists/boards/tables), 'svg' (hand-drawn maps/diagrams — include a viewBox), 'html' (rich layout). STATIC content only: scripts and external resources are blocked by the sandbox. Panels hold meta-information for the user's eyes — NEVER narrative prose.",
			parameters: Type.Object({
				name: Type.String({ description: "Stable panel name, shown as the tab title, e.g. '地图'、'装备库'" }),
				kind: Type.Union([Type.Literal("markdown"), Type.Literal("svg"), Type.Literal("html")], {
					description: "markdown = lists/tables; svg = hand-drawn map/diagram (with viewBox); html = rich static layout",
				}),
				content: Type.String({ description: "Full panel content (complete replacement, not a diff)" }),
			}),
			async execute(_id, params) {
				const r = writePanel(panels, params);
				if (!r.ok) {
					return { content: [{ type: "text", text: r.error }], isError: true };
				}
				panels = r.panels;
				persistPanels();
				const verb = r.created ? "已创建" : r.reopened ? "已重开并更新" : "已更新";
				const over = r.overLimit
					? `注意：活跃面板已有 ${r.activeCount} 个，超过建议上限 ${PANEL_SOFT_LIMIT}——用 panel_close 收拾不再需要的旧面板。`
					: "";
				return {
					content: [
						{
							type: "text",
							text: `面板「${params.name}」${verb}（${params.kind}，${params.content.length} 字符），用户侧页签已同步。${over}`,
						},
					],
					details: { rpPanel: { name: params.name, kind: params.kind, activeCount: r.activeCount } },
				};
			},
		});

		pi.registerTool({
			name: "panel_read",
			label: "查看面板",
			description:
				"Read the current content of one of your panels. Call before an incremental update when you are not sure what the panel currently shows (older turns' panel content may have left your context).",
			parameters: Type.Object({
				name: Type.String({ description: "Panel name to read" }),
			}),
			async execute(_id, params) {
				const p = panels[params.name.trim()];
				if (!p) {
					const known = activePanels(panels).map((x) => x.name);
					return {
						content: [
							{
								type: "text",
								text: `没有名为「${params.name}」的面板${known.length ? `（现有：${known.join("、")}）` : "（尚无面板）"}`,
							},
						],
						isError: true,
					};
				}
				return {
					content: [{ type: "text", text: `面板「${p.name}」（${p.kind}${p.archived ? "，已归档" : ""}）当前内容：\n\n${p.content}` }],
				};
			},
		});

		pi.registerTool({
			name: "panel_close",
			label: "收起面板",
			description:
				"Archive one of your panels when the story no longer needs it (its tab disappears for the user; content is kept on disk and panel_write with the same name reopens it). Keep the panel set tidy.",
			parameters: Type.Object({
				name: Type.String({ description: "Panel name to archive" }),
			}),
			async execute(_id, params) {
				const r = closePanel(panels, params.name);
				if (!r.ok) {
					return { content: [{ type: "text", text: r.error }], isError: true };
				}
				panels = r.panels;
				persistPanels();
				return { content: [{ type: "text", text: `面板「${params.name.trim()}」已收起（内容保留，同名 panel_write 可重开）。` }] };
			},
		});

		// 决策门禁（PLAN-PHASE4 柱 1）：模型判断到关键剧情决策点时停笔，向用户摊开选项。
		// D10 主动形态——不只 harness 不代笔，更把重大创作决策交还用户。ctx.ui.select 在 Web
		// 宿主被接成选择卡通道（server/main.ts）：返回用户所选文字，返回 undefined = 用户停止本回合。
		pi.registerTool({
			name: ASK_TOOL,
			label: "请用户定夺",
			description:
				"Pause the story and ask the user to decide a PIVOTAL, hard-to-reverse creative point before you commit it to the narrative. Use for: defining a NEW important character (name/identity/personality), a major plot turn (death, betrayal, a relationship's nature changing, a big time-skip), locking down a piece of the world's canon, or anywhere the user has signalled they want a say. Do NOT use for trivia or routine beats — asking about small things is worse than not asking. CRITICAL: whenever you want to offer the user a set of choices about the story, you MUST do it by calling this tool — NEVER list options as narrative prose in your reply. Provide 2-4 concrete options in the story's language; the user may also type their own answer or stop. After the user answers, continue the narrative following their choice.",
			parameters: Type.Object({
				question: Type.String({
					description: "The decision to put to the user, in the story's language, e.g. '这位新登场的女官，你想她是什么性格？'",
				}),
				options: Type.Array(Type.String(), {
					description: "2-4 concrete, distinct options in the story's language. Do not pad with filler options.",
					minItems: 2,
					maxItems: 4,
				}),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				const options = params.options.slice(0, 4);
				let answer: string | undefined;
				try {
					answer = await ctx.ui.select(params.question, options, { signal });
				} catch {
					// 无交互通道（print 模式等）：视作用户未参与，交回模型自主决定
					return {
						content: [{ type: "text", text: "（当前无法向用户询问，请你自行做出最合适的选择并继续。）" }],
					};
				}
				if (answer === undefined) {
					// 用户停止了本回合：笔还给用户。返回留痕，回合已由 harness abort。
					return {
						content: [{ type: "text", text: "用户选择停止本回合，收回主导权。就此停笔，不要继续叙事。" }],
						details: { rpChoice: { question: params.question, options, stopped: true } },
					};
				}
				return {
					content: [{ type: "text", text: `用户的选择：${answer}\n\n据此继续叙事。` }],
					details: { rpChoice: { question: params.question, options, answer } },
				};
			},
		});
	} catch {
		// reload 场景下重复注册：忽略
	}

	// ---------- 会话生命周期 ----------

	pi.on("session_start", async (event, ctx) => {
		if (process.env.RP_DEBUG) console.error(`[rp-debug] session_start fired（v-f1）`);
		try {
			const configPath = resolveConfigPath(ctx.cwd);
			appCwd = ctx.cwd;
			if (existsSync(configPath)) {
				const raw = { ...DEFAULT_CONFIG, ...(JSON.parse(readFileSync(configPath, "utf8")) as Partial<RpConfig>) };
				// 旧 lorebook 单本 → lorebooks[]；与 REST loadConfig 一致
				config = setMountedLorebooks(raw, mountedLorebookPaths(raw));
			}
			card = loadCardFile(resolvePath(ctx.cwd, config.card));

			// 世界书只来自「已挂载的独立书（0..N 本）」+ agent 补充设定集；
			// 卡内 character_book 不自动进上下文（与角色卡解耦，可另存为独立书再挂）。
			const fileGroups: LorebookEntry[][] = [];
			for (const rel of mountedLorebookPaths(config)) {
				const abs = resolvePath(ctx.cwd, rel);
				if (existsSync(abs)) fileGroups.push(loadLorebookFile(abs));
			}
			const fileEntries = mergeEntries(...fileGroups);
			overlayFile = overlayPathFor(ctx.cwd, card.name);
			const overlayEntries = existsSync(overlayFile) ? loadLorebookFile(overlayFile) : [];
			entries = applyDisabledLore(mergeEntries(fileEntries, overlayEntries), config.disabledLore);

			// 转换后的预设（可选）：system 块进 system prompt，postHistory 块进末端注入
			preset = null;
			if (config.preset) {
				const presetPath = resolvePath(ctx.cwd, config.preset);
				if (existsSync(presetPath)) {
					preset = normalizeRpPreset(JSON.parse(readFileSync(presetPath, "utf8")));
				}
			}

			stateFile = join(dir(ctx.cwd, "state"), `${ctx.sessionManager.getSessionId()}.json`);
			state = loadState(stateFile);
			// fork 出的新会话文件没有状态缓存：从复制过来的剧情分支快照恢复
			if (JSON.stringify(state) === JSON.stringify(defaultState()) && restoreStateFromBranch(ctx.sessionManager)) {
				saveState(stateFile, state);
			}
			// 面板同款装载：缓存缺失（fork/新拉起）时从剧情分支快照恢复
			panelsFile = join(dir(ctx.cwd, "artifacts"), `${ctx.sessionManager.getSessionId()}.json`);
			panels = loadPanels(panelsFile);
			if (Object.keys(panels).length === 0 && restorePanelsFromBranch(ctx.sessionManager)) {
				savePanels(panelsFile, panels);
			}
			// 知识库挂载恢复：挂载关系只存会话树（无磁盘缓存），从剧情分支快照恢复
			mountedCodexes = [];
			restoreCodexFromBranch(ctx.sessionManager);
			reloadCodexEntries();
			// MCP 启用集：有会话树快照则恢复（续接/fork）；否则用项目「新对话默认」（发现项默认全关）
			if (!restoreMcpFromBranch(ctx.sessionManager)) {
				sessionMcpEnabled = defaultSessionEnabledIds(ctx.cwd);
				snapshotMcpEnabled();
			}
			scribeBusy = false;
			pendingWarnings = [];
			aliasPromise = null; // 素材可能已变，允许重新初始化（有磁盘缓存，代价极低）

			// MCP 外设：按本会话启用集连接；索引写进 system prompt（D8：会话内字节稳定）
			try {
				await syncMcp();
			} catch (err) {
				if (process.env.RP_DEBUG) {
					console.error(`[rp-mcp] sync 失败：${err instanceof Error ? err.message : String(err)}`);
				}
				mcpToolNames = [];
				mcpIndexCache = "（MCP 同步失败。）";
			}

			systemPromptCache = buildSystemPrompt({
				card,
				config,
				constantLore: constantEntries(entries),
				presetSystemBlocks: preset ? enabledBlocks(preset, "system") : undefined,
				// Web 宿主注入自身接口地址（TUI 下缺省）；会话内不变，D8 字节稳定
				selfApiBase: process.env.LIYUAN_HTTP || undefined,
				// 技能库索引（§6.4）：session_start 装载，会话内字节稳定
				skills: listSkills(ctx.cwd),
				mcpIndex: mcpIndexCache,
			});

			if (rpMode) {
				savedTools = pi.getActiveTools();
				applyRpToolset();
			}

			// 会话-卡绑定（PLAN-PHASE3 §2.1）：会话文件声明属于哪张卡。
			// - 无标记 → 写入当前卡
			// - 已有标记但路径≠当前 config.card（换卡后仍续着旧会话）→ 再写一条新标记（解析取最后一条）
			try {
				const cardEntries = ctx.sessionManager
					.getEntries()
					.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "rp-card") as Array<{
					type: string;
					customType?: string;
					data?: { card?: string; name?: string };
				}>;
				const last = cardEntries[cardEntries.length - 1];
				const bound = last?.data?.card;
				if (!bound || bound !== config.card) {
					pi.appendEntry("rp-card", { card: config.card, name: card.name });
					if (process.env.RP_DEBUG) {
						console.error(`[rp-card] ${bound ? "换卡后更新" : "补写"}卡标记：${card.name} ← ${config.card}`);
					}
				}
			} catch (err) {
				// 会话不可写的极早期生命周期：跳过，不影响游玩
				if (process.env.RP_DEBUG) {
					console.error(`[rp-card] 写入失败：${err instanceof Error ? err.message : String(err)}`);
				}
			}

			// 新会话注入开场白（既定第一条消息，参与 LLM 上下文并在 TUI 显示）
			if (rpMode && config.greeting && card.firstMes) {
				const hasHistory = ctx.sessionManager
					.getEntries()
					.some((e: { type: string }) => e.type === "message" || e.type === "custom_message");
				if (!hasHistory) {
					pi.sendMessage({ customType: "rp-greeting", content: buildGreeting(card, config), display: true });
				}
			}

			const toolCount = RP_TOOLS.length + (config.creationMode === "ask" ? 1 : 0) + mcpToolNames.length;
			const mcpNote = mcpToolNames.length ? `，MCP ${mcpToolNames.length}` : "";
			notify(ctx, `RP 模式：${card.name} 已装载（世界书 ${entries.length} 条，工具 ${toolCount} 个${mcpNote}${config.creationMode === "ask" ? "，决策门禁：开" : ""}）`);
		} catch (err) {
			if (process.env.RP_DEBUG) {
				console.error(`[rp-debug] session_start 装载失败：`, err);
			}
			systemPromptCache = `你在进行角色扮演，但素材装载失败（${err instanceof Error ? err.message : String(err)}）。请向用户说明该错误。`;
			notify(ctx, `RP 素材装载失败：${err instanceof Error ? err.message : String(err)}`, "error");
		}
	});

	pi.on("before_agent_start", async () => {
		if (rpMode && systemPromptCache) {
			return { systemPrompt: systemPromptCache };
		}
		return undefined;
	});

	// 每轮 LLM 调用前：D9 减法裁剪 → 清理助手历史文本 → 末端注入世界状态与触发设定
	pi.on("context", async (event, ctx) => {
		if (!rpMode || !card) return undefined;

		// 世界书中文别名懒初始化（首次会话一次旁侧调用，此后走磁盘缓存）
		await ensureAliases(ctx);

		// D9：裁剪已闭合轮次的工具残渣与思考块（只影响本次 LLM 调用，会话文件完整保留）
		const pruned = pruneClosedTurns(event.messages as Array<Record<string, unknown>>);
		const messages = pruned.messages;
		if (process.env.RP_DEBUG && pruned.stats.charsBefore > 0) {
			console.error(`[rp-prune] ${formatPruneStats(pruned.stats)}`);
		}

		// 用户手改的角色回复：custom → assistant，避免 convertToLlm 把它当成 user
		for (let i = 0; i < messages.length; i++) {
			const m = messages[i] as Record<string, unknown>;
			if (m.role === "custom" && m.customType === "rp-edited-reply") {
				const raw = m.content;
				const content = typeof raw === "string" ? [{ type: "text", text: raw }] : raw;
				messages[i] = {
					role: "assistant",
					content,
					api: "openai-completions",
					provider: "edited",
					model: "edited",
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					stopReason: "stop",
					timestamp: typeof m.timestamp === "number" ? m.timestamp : Date.now(),
				};
			}
		}

		for (const m of messages) {
			if (m.role === "assistant" && Array.isArray(m.content)) {
				for (const part of m.content as Array<Record<string, unknown>>) {
					if (part.type === "text" && typeof part.text === "string") {
						part.text = cleanAssistantText(part.text);
					}
				}
			}
		}

		const windowText = messages
			.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "custom")
			.slice(-config.scanDepth)
			.map(extractText)
			.join("\n");
		const activated = scanEntries(allEntries(), windowText, config.maxLoreInjections);

		// 语言自愈：上一条**台上**叙事文本（助手正文，首轮回退到开场白）语言与配置不符时注入显式纠正。
		// 首轮盲区实证（smoke 多次复现）：英文开场白锚定第一轮输出英文，必须把开场白纳入检测源。
		// 幕后轮的助手回复不是叙事，不作为检测源（英文命令输出会误报）。
		const lastNarrative = (() => {
			let inBackstageTurn = false;
			let found: unknown;
			for (const m of messages) {
				if (m.role === "user") {
					inBackstageTurn = isBackstageText(extractText(m));
				} else if (
					(m.role === "assistant" || (m.role === "custom" && (m as { customType?: string }).customType === "rp-greeting")) &&
					!inBackstageTurn
				) {
					found = m;
				}
			}
			return found;
		})();
		const languageMismatch = lastNarrative
			? detectsLanguageMismatch(extractText(lastNarrative), config.language)
			: false;

		// 姿态检测（PLAN-PHASE3 §6.1）：最后一条用户消息带场外标记 = 戏外轮（对助手说话）。
		// 无标记的场外话由模型自行分辨（system prompt 已授权），harness 不越俎代庖。
		const lastUser = [...messages].reverse().find((m) => m.role === "user");
		const stance: "onstage" | "backstage" = lastUser && isBackstageText(extractText(lastUser)) ? "backstage" : "onstage";

		// 审计告警只在戏内轮消费（戏外轮不写正文，提醒保留到下一个戏内轮）
		const auditWarnings = stance === "onstage" ? pendingWarnings : [];
		if (stance === "onstage") pendingWarnings = [];

		messages.push({
			role: "custom",
			customType: "rp-inject",
			content: buildTurnInjection({
				state,
				activatedLore: activated,
				card,
				config,
				stance,
				languageMismatch,
				auditWarnings,
				presetPostHistoryBlocks: preset ? enabledBlocks(preset, "postHistory") : undefined,
				panelIndex: formatPanelIndex(panels) ?? undefined,
				codexIndex: codexIndexCache ?? undefined,
				uploadIndex: formatUploadIndex(listUploads(appCwd)) ?? undefined,
			}),
			display: false,
			timestamp: Date.now(),
		});

		return { messages };
	});

	// 预设采样参数：直接改写 provider 请求体（OpenAI 兼容键，原样搬运）
	pi.on("before_provider_request", async (event) => {
		if (!rpMode || !preset || Object.keys(preset.samplers).length === 0) return undefined;
		const payload = event.payload;
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
		return { ...(payload as Record<string, unknown>), ...preset.samplers };
	});

	// 场记 + 一致性审计（每个用户轮结束后一次旁侧调用；D10：产出是状态数据与元信息告警，绝不碰正文）
	pi.on("agent_end", async (event, ctx) => {
		if (!rpMode || !card || scribeBusy) return;
		const msgs = event.messages as Array<{ role?: string; content?: unknown; customType?: string }>;
		let lastUserIdx = -1;
		for (let i = msgs.length - 1; i >= 0; i--) {
			if (msgs[i].role === "user") {
				lastUserIdx = i;
				break;
			}
		}
		if (lastUserIdx === -1) return;
		const userText = extractText(msgs[lastUserIdx]);
		// 戏外轮（场外标记）不是剧情：不记账、不审计
		if (isBackstageText(userText)) return;
		const assistantText = msgs
			.slice(lastUserIdx + 1)
			.filter((m) => m.role === "assistant")
			.map(extractText)
			.filter(Boolean)
			.join("\n");
		if (!assistantText.trim()) return;

		// 决策门禁第二层地板（ask 档）：本轮若已经过 ask_director 询问则豁免，
		// 否则让场记顺带检测「先斩后奏的重大转折」（同一次旁侧调用，零额外成本）
		const askedThisTurn = msgs
			.slice(lastUserIdx + 1)
			.some((m) => (m as { role?: string; toolName?: string }).role === "toolResult" && (m as { toolName?: string }).toolName === "ask_director");
		const detectUnaskedTurn = config.creationMode === "ask" && !askedThisTurn;

		scribeBusy = true;
		try {
			const prompt = buildScribeTurnPrompt({
				state,
				userText,
				assistantText,
				charName: card.name,
				userName: config.userName,
				detectUnaskedTurn,
			});
			const text = await sideComplete(ctx, prompt.systemPrompt, prompt.userText, 2048);
			if (!text) return;
			const result = parseScribeResult(text);
			if (!result) {
				if (process.env.RP_DEBUG) console.error(`[rp-scribe] 输出不可解析，本轮跳过`);
				return;
			}
			if (Object.keys(result.patch).length > 0) {
				const knownNames = [card.name, config.userName, ...Object.keys(state.characters)];
				const applied = applyPatch(state, canonicalizeCharacterKeys(result.patch, knownNames));
				state = applied.state;
				if (stateFile) saveState(stateFile, state);
				snapshotState();
				if (process.env.RP_DEBUG) {
					console.error(`[rp-scribe] ${applied.applied.join("；") || "（无变更）"}`);
				}
			}
			if (result.warnings.length > 0) {
				pendingWarnings = result.warnings.slice(0, 5);
				notify(ctx, `⚠ 连续性告警（下一轮注入提醒；如需修正本轮正文请重 roll）：\n${pendingWarnings.map((w) => `- ${w}`).join("\n")}`, "warning");
			}
			// 决策门禁地板：检测到先斩后奏的重大转折 → 告警上屏 + rewind 建议（正文由用户裁夺，D10 不改写）
			if (result.unaskedTurn) {
				notify(
					ctx,
					`⚠ 这一轮似乎单方面推进了一个重大转折，没有先征询你：\n${result.unaskedTurn}\n如果这不是你想要的走向，可以 /rewind 1 退回这轮重来（决策门禁开启时，这类转折本应先问你）。`,
					"warning",
				);
			}
		} catch (err) {
			if (process.env.RP_DEBUG) {
				console.error(`[rp-scribe] 失败（本轮跳过）：${err instanceof Error ? err.message : String(err)}`);
			}
		} finally {
			scribeBusy = false;
		}
	});

	// 剧情向压缩接管：用场记提示词替代 pi 默认的 coding 摘要模板
	// （agent-run-02 P9：默认模板把陈旧场景写成 Critical Context，压缩后剧情倒退）。
	// 注意：completeSimple 来自本项目自装的 pi-ai 副本，与 pi 内部实例的 provider
	// 注册表相互独立——内置渠道（deepseek 等）两边都有，运行期注册的自定义 provider
	// 则只在 pi 侧可见；本项目不使用运行期注册，风险可控。
	pi.on("session_before_compact", async (event, ctx) => {
		if (!rpMode || !card || !ctx.model) return undefined;
		try {
			const prep = event.preparation;
			const msgs = [...prep.messagesToSummarize, ...(prep.isSplitTurn ? prep.turnPrefixMessages : [])];
			if (msgs.length === 0) return undefined;

			const { systemPrompt, userText } = buildRpSummaryPrompt({
				conversationText: serializeForSummary(msgs, config.userName, card.name),
				stateSnapshot: formatState(state),
				previousSummary: prep.previousSummary,
				language: config.language,
				userName: config.userName,
			});
			const summary = await sideComplete(ctx, systemPrompt, userText, 4096, event.signal);
			if (!summary) return undefined;
			return {
				compaction: {
					summary,
					firstKeptEntryId: prep.firstKeptEntryId,
					tokensBefore: prep.tokensBefore,
				},
			};
		} catch (err) {
			// 接管失败回落 pi 默认压缩：coding 模板的摘要也比压缩失败强
			if (process.env.RP_DEBUG) {
				console.error(`[rp-compaction] 接管失败，回落默认摘要：${err instanceof Error ? err.message : String(err)}`);
			}
			return undefined;
		}
	});

	// ---------- 正典落盘门禁（PLAN-PHASE4 柱 1 第一层，harness 级） ----------
	//
	// 与提示词层的 ask_director（模型自觉调用）不同，这里是真门禁：tool_call 钩子是
	// pi 的工具执行咽喉点，落盘类工具的每次调用必然经过——ask 档下先弹批准卡，
	// 用户不点头就 block，模型物理上写不进正典。与 coding agent 拦 Edit/Write 同构。
	// 门禁清单只收「不可逆剧情资产落盘」；world_state_update 是每轮记账（有场记兜底），拦了会问烦。
	const GATED_TOOLS = ["lorebook_write", "codex_write"]; // 柱 3 的 card_write 出生即入列

	pi.on("tool_call", async (event, ctx) => {
		if (!rpMode || config.creationMode !== "ask") return undefined;
		if (!GATED_TOOLS.includes(event.toolName)) return undefined;

		// 卡面摘要由 harness 生成（元信息层，非正文，D10 合规）
		const input = event.input as { codex?: unknown; title?: unknown; keys?: unknown; content?: unknown; constant?: unknown };
		const title = typeof input.title === "string" ? input.title : "（无标题）";
		const content = typeof input.content === "string" ? input.content : "";
		const excerpt = content.length > 300 ? `${content.slice(0, 300)}…` : content;
		const question =
			event.toolName === "codex_write"
				? `是否把这条新知识写入知识库「${typeof input.codex === "string" ? input.codex : "？"}」（跨对话共享，永久保留）？\n【${title}】\n${excerpt}`
				: `是否把这条新设定写入设定集（跨会话保留，成为正式设定）？\n【${title}】\n${excerpt}`;

		let answer: string | undefined;
		try {
			answer = await ctx.ui.select(question, ["写入", "不写入"]);
		} catch {
			// 无交互通道（print 模式等）：无法征得同意，宁拦勿写
			return { block: true, reason: "当前无法向用户确认，设定未写入。稍后用户在场时再试。" };
		}
		if (answer === "写入") return undefined; // 放行，工具正常执行
		if (answer === undefined) {
			return { block: true, reason: "用户停止了本回合，设定未写入。" };
		}
		if (answer === "不写入") {
			return { block: true, reason: "用户否决了这次写入：不要写入设定集，也不要在后续正文中把它当作已定事实。" };
		}
		// 自由输入 = 否决 + 修改意见
		return {
			block: true,
			reason: `用户未同意原样写入，并给出意见：「${answer}」。请按意见调整后重新提交，或放弃写入。`,
		};
	});

	/** 等待在途的场记调用归位（树导航前必须等：否则快照会写到导航后的位置上） */
	const waitForScribe = async (ms = 20000) => {
		const start = Date.now();
		while (scribeBusy && Date.now() - start < ms) {
			await new Promise((r) => setTimeout(r, 200));
		}
	};

	// 树导航后：账本与面板随剧情位置回退（快照存在树里，导航到哪就恢复到哪）
	pi.on("session_tree", async (_event, ctx) => {
		if (!rpMode) return;
		const restored = restoreStateFromBranch(ctx.sessionManager);
		if (!restored) state = defaultState();
		if (stateFile) saveState(stateFile, state);
		// 面板同步回退：无快照 = 该剧情点尚无面板，清空（落盘触发前端页签同步）
		if (!restorePanelsFromBranch(ctx.sessionManager)) panels = {};
		if (panelsFile) savePanels(panelsFile, panels);
		// 知识库挂载同步回退：无快照 = 该剧情点尚无挂载
		if (!restoreCodexFromBranch(ctx.sessionManager)) mountedCodexes = [];
		reloadCodexEntries();
		// MCP 启用集随剧情位置：无快照回落到新对话默认
		if (!restoreMcpFromBranch(ctx.sessionManager)) {
			sessionMcpEnabled = defaultSessionEnabledIds(appCwd);
		}
		try {
			await syncMcp();
		} catch {
			// 树导航时 MCP 重连失败不挡主流程
		}
		notify(ctx, restored ? "世界状态已随剧情位置同步（/state 查看）" : "已回到无状态记录的剧情点，账本已清空");
	});

	// ---------- 命令 ----------

	pi.registerCommand("reroll", {
		description: cmdDesc("reroll"),
		handler: async (args, ctx) => {
			const newText = (args ?? "").trim();
			// 无参：由 server/main 拦截走 ST sibling 变体（agent.continue）。此处若仍被调用则提示。
			if (!newText) {
				notify(
					ctx,
					"无参 /reroll 应由 Web 宿主处理；若你看到这条，请用气泡左右箭头或再发一次 /reroll。",
					"warning",
				);
				return;
			}
			const branch = ctx.sessionManager.getBranch() as Array<{
				id: string;
				type: string;
				message?: { role?: string; content?: unknown };
			}>;
			let lastUserIdx = -1;
			for (let i = branch.length - 1; i >= 0; i--) {
				if (branch[i].type === "message" && branch[i].message?.role === "user") {
					lastUserIdx = i;
					break;
				}
			}
			if (lastUserIdx <= 0) {
				notify(ctx, "没有可重新生成的回合（或已在会话起点）", "error");
				return;
			}
			await waitForScribe();
			// 有参：编辑用户输入后整轮重来——退到 user 之前，再发新文案（旧 user+回复进旁支）
			const result = await ctx.navigateTree(branch[lastUserIdx - 1].id, { summarize: false });
			if (result.cancelled) return;
			pi.sendUserMessage(newText);
			notify(ctx, "已按编辑后的消息重新生成；原输入与回复保留在会话树。");
		},
	});

	pi.registerCommand("rewind", {
		description: cmdDesc("rewind"),
		handler: async (args, ctx) => {
			const n = Math.max(1, Number.parseInt((args ?? "").trim(), 10) || 1);
			const branch = ctx.sessionManager.getBranch() as Array<{
				id: string;
				type: string;
				message?: { role?: string };
			}>;
			// 只数剧情轮：戏外问答（场外标记）不是剧情，不计入 N（与 UI 楼层号同一语义）
			const userIdxs = branch
				.map((e, i) =>
					e.type === "message" && e.message?.role === "user" && !isBackstageText(extractText(e.message)) ? i : -1,
				)
				.filter((i) => i >= 0);
			if (userIdxs.length < n) {
				notify(ctx, `没有足够的用户轮可回退（当前只有 ${userIdxs.length} 轮）`, "error");
				return;
			}
			const targetUserIdx = userIdxs[userIdxs.length - n];
			if (targetUserIdx === 0) {
				notify(ctx, "已到剧情起点，无法再回退", "error");
				return;
			}
			await waitForScribe();
			const target = branch[targetUserIdx - 1];
			const result = await ctx.navigateTree(target.id, { summarize: false });
			if (!result.cancelled) {
				notify(ctx, `已回退 ${n} 个用户轮。被回退的内容保留在会话树里（可再导航回去），从这里继续。`);
			}
		},
	});

	/** 删掉最后一条角色回复，叶子停在最后一条用户消息上（可编辑后再发 /reroll） */
	pi.registerCommand("drop", {
		description: cmdDesc("drop"),
		handler: async (_args, ctx) => {
			const branch = ctx.sessionManager.getBranch() as Array<{
				id: string;
				type: string;
				message?: { role?: string; customType?: string };
			}>;
			let lastUserIdx = -1;
			for (let i = branch.length - 1; i >= 0; i--) {
				if (branch[i].type === "message" && branch[i].message?.role === "user") {
					lastUserIdx = i;
					break;
				}
			}
			if (lastUserIdx < 0) {
				notify(ctx, "没有可删除的角色回复（尚无用户消息）", "error");
				return;
			}
			// 用户消息之后必须还有助手/开场等，否则没什么可 drop
			const after = branch.slice(lastUserIdx + 1).some(
				(e) =>
					e.type === "message" &&
					(e.message?.role === "assistant" || e.message?.role === "custom" || e.message?.role === "toolResult"),
			);
			if (!after) {
				notify(ctx, "最后一轮还没有角色回复可删", "error");
				return;
			}
			await waitForScribe();
			const result = await ctx.navigateTree(branch[lastUserIdx].id, { summarize: false });
			if (!result.cancelled) {
				notify(ctx, "已删除最后一条角色回复；你的输入仍在，可编辑后发送或点「重新生成」。");
			}
		},
	});

	/**
	 * 采用用户改写的角色正文：退到最后一条用户消息，注入 rp-edited-reply（显示为叙事）。
	 * 上下文钩子会把该 custom 转成 assistant，避免进 LLM 时被当成 user。
	 * 也可改写当前开场白（仅未开聊时）。
	 */
	pi.registerCommand("editreply", {
		description: cmdDesc("editreply"),
		handler: async (args, ctx) => {
			const text = (args ?? "").trim();
			if (!text) {
				notify(ctx, "用法：/editreply <改写后的正文>", "error");
				return;
			}
			const branch = ctx.sessionManager.getBranch() as Array<{
				id: string;
				parentId?: string | null;
				type: string;
				message?: { role?: string; customType?: string };
			}>;
			let lastUserIdx = -1;
			for (let i = branch.length - 1; i >= 0; i--) {
				if (branch[i].type === "message" && branch[i].message?.role === "user") {
					lastUserIdx = i;
					break;
				}
			}
			await waitForScribe();
			if (lastUserIdx >= 0) {
				const result = await ctx.navigateTree(branch[lastUserIdx].id, { summarize: false });
				if (result.cancelled) return;
				pi.sendMessage({ customType: "rp-edited-reply", content: text, display: true });
				notify(ctx, "已采用你改写的角色回复（原回复保留在会话树）。");
				return;
			}
			// 无用户消息：尝试改开场白（custom_message 形）
			if (!branch.some(isGreetingEntry)) {
				notify(ctx, "没有可改写的角色回复或开场白", "error");
				return;
			}
			const nav = await navigateBeforeGreetings(ctx, branch);
			if (nav === "cancelled") return;
			if (nav === "injected") {
				// newSession 已注入默认开场白：再覆盖为改写正文
				// 新会话只有一条 greeting，再 navigate 到其 parent 不可能 → 直接叠一层 sibling 需 reset。
				// 改写路径：newSession 后 leaf 在新 greeting 上，再 edit 用 inject 会叠；此处简单 notify 请用户重开。
				notify(ctx, "已新开会话；请在气泡内再次修改开场白以采用改写。", "warning");
				return;
			}
			// 开场白改写仍用 greeting 通道展示
			pi.sendMessage({ customType: "rp-greeting", content: text, display: true });
			notify(ctx, "已采用你改写的开场白。");
		},
	});

	/** 切换开场白：未开聊时即时替换；已开聊只写配置给下次新会话 */
	pi.registerCommand("greeting", {
		description: cmdDesc("greeting"),
		handler: async (args, ctx) => {
			if (!card) {
				notify(ctx, "角色卡未装载", "error");
				return;
			}
			const pool = [card.firstMes, ...card.alternateGreetings].filter((t) => typeof t === "string" && t.trim());
			if (pool.length === 0) {
				notify(ctx, "本卡没有开场白", "error");
				return;
			}
			const raw = (args ?? "").trim().toLowerCase();
			const cur = config.greetingIndex ?? 0;
			let idx = cur;
			if (!raw || raw === "next") idx = (cur + 1) % pool.length;
			else if (raw === "prev") idx = (cur - 1 + pool.length) % pool.length;
			else {
				const n = Number.parseInt(raw, 10);
				if (!Number.isFinite(n)) {
					notify(ctx, "用法：/greeting [序号|next|prev]（序号从 0 起）", "error");
					return;
				}
				idx = Math.max(0, Math.min(pool.length - 1, n));
			}
			// 落盘 + 内存（须在 newSession 之前，session_start 读最新 index）
			const cwd = ctx.cwd || appCwd;
			const configPath = resolveConfigPath(cwd);
			try {
				const disk = existsSync(configPath)
					? (JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>)
					: {};
				disk.greetingIndex = idx;
				writeFileSync(configPath, `${JSON.stringify(disk, null, "\t")}\n`, "utf8");
			} catch (err) {
				notify(ctx, `写入配置失败：${err instanceof Error ? err.message : String(err)}`, "error");
				return;
			}
			config = { ...config, greetingIndex: idx };

			const branch = ctx.sessionManager.getBranch() as BranchEntry[];
			const hasUser = branch.some(
				(e) => e.type === "message" && e.message?.role === "user" && !isBackstageText(extractText(e.message)),
			);
			if (hasUser) {
				notify(ctx, `已选定开场白 ${idx + 1}/${pool.length}，当前会话已开聊，下次新会话生效。`);
				return;
			}

			// 未开聊：退到开场白之前再注入 → 界面上同一条位置被替换（旧文案进会话树旁支）
			await waitForScribe();
			const nav = await navigateBeforeGreetings(ctx, branch);
			if (nav === "cancelled") return;
			if (nav === "injected") {
				notify(ctx, `已切换开场白 ${idx + 1}/${pool.length}`);
				return;
			}
			if (config.greeting !== false) {
				pi.sendMessage({ customType: "rp-greeting", content: buildGreeting(card, config), display: true });
			}
			notify(ctx, `已切换开场白 ${idx + 1}/${pool.length}`);
		},
	});

	pi.registerCommand("branch", {
		description: cmdDesc("branch"),
		handler: async (_args, ctx) => {
			const branch = ctx.sessionManager.getBranch() as Array<{ id: string }>;
			if (branch.length === 0) {
				notify(ctx, "会话为空，无从分支", "error");
				return;
			}
			await waitForScribe();
			const leaf = branch[branch.length - 1];
			const result = await ctx.fork(leaf.id, { position: "at" });
			if (!result.cancelled) {
				notify(ctx, "已从当前剧情点开出新分支（新会话文件）；原剧情线完整保留。");
			}
		},
	});

	/** 会话树 entries → 世界线用的轻量结构 */
	const treeEntriesLite = (sm: {
		getEntries: () => Array<Record<string, unknown>>;
	}): TreeEntryLite[] =>
		sm.getEntries().map((e) => ({
			id: String(e.id),
			parentId: (e.parentId as string | null) ?? null,
			type: String(e.type),
			...(typeof e.customType === "string" ? { customType: e.customType } : {}),
			...(e.data !== undefined ? { data: e.data } : {}),
			...(typeof e.timestamp === "string" ? { timestamp: e.timestamp } : {}),
		}));

	const worldlineSnapshot = (sm: {
		getEntries: () => Array<Record<string, unknown>>;
		getBranch: () => Array<{ id: string }>;
		getLeafId: () => string | null;
		getSessionId: () => string;
	}) => {
		const sid = sm.getSessionId();
		const meta = loadWorldlineMeta(metaPath(appCwd, sid));
		const entries = treeEntriesLite(sm);
		const saves = extractSaves(entries, meta);
		const leafId = sm.getLeafId();
		const { ancestorsOf, branchIdsFromLeaf } = buildAncestryIndex(entries);
		const branchIds = branchIdsFromLeaf(leafId);
		const view = buildWorldlineView(saves, meta, branchIds, leafId);
		return { meta, entries, saves, leafId, ancestorsOf, branchIds, view };
	};

	// ---------- 世界线：/store /back /line ----------

	pi.registerCommand("store", {
		description: cmdDesc("store"),
		handler: async (args, ctx) => {
			await waitForScribe();
			const sm = ctx.sessionManager as {
				getEntries: () => Array<Record<string, unknown>>;
				getBranch: () => Array<{ id: string }>;
				getLeafId: () => string | null;
				getSessionId: () => string;
			};
			const nameArg = (args ?? "").trim();
			const name = nameArg || defaultSaveName();
			const { saves, branchIds, ancestorsOf } = worldlineSnapshot(sm);
			const prev = latestSaveOnBranch(saves, branchIds);
			const data = planNewSave({
				name,
				prevOnBranch: prev,
				branchEntryIds: branchIds,
				allSaves: saves,
				ancestorsOf,
			});
			// 钉档前再刷一次账本/面板快照，保证 /back 到此点时状态对齐
			snapshotState();
			snapshotPanels();
			snapshotCodexMounts();
			pi.appendEntry(RP_SAVE_TYPE, data);
			const lineNote =
				data.forkFromSaveId && data.worldlineName !== prev?.worldlineName
					? `（新世界线：${data.worldlineName}）`
					: `（${data.worldlineName}）`;
			notify(ctx, `已存档「${data.name}」${lineNote}`);
		},
	});

	pi.registerCommand("back", {
		description: cmdDesc("back"),
		handler: async (args, ctx) => {
			await waitForScribe();
			const sm = ctx.sessionManager as {
				getEntries: () => Array<Record<string, unknown>>;
				getBranch: () => Array<{ id: string }>;
				getLeafId: () => string | null;
				getSessionId: () => string;
			};
			const { saves, branchIds } = worldlineSnapshot(sm);
			if (saves.length === 0) {
				notify(ctx, "还没有存档。先用 /store 钉一个点。", "error");
				return;
			}
			const q = (args ?? "").trim();
			const target = q ? findSave(saves, q) : latestSaveOnBranch(saves, branchIds) ?? saves.sort((a, b) => b.createdAt - a.createdAt)[0];
			if (!target) {
				notify(ctx, q ? `找不到存档「${q}」。用 /line 查看列表。` : "找不到可回退的存档。", "error");
				return;
			}
			const result = await ctx.navigateTree(target.entryId, { summarize: false });
			if (!result.cancelled) {
				notify(ctx, `已回到存档「${target.name}」（${target.worldlineName}）。从这里继续会走出当前线的后续；若与旧后续不同，再 /store 时会自动分出新世界线。`);
			}
		},
	});

	pi.registerCommand("line", {
		description: cmdDesc("line"),
		handler: async (_args, ctx) => {
			const sm = ctx.sessionManager as {
				getEntries: () => Array<Record<string, unknown>>;
				getBranch: () => Array<{ id: string }>;
				getLeafId: () => string | null;
				getSessionId: () => string;
			};
			const { view } = worldlineSnapshot(sm);
			notify(ctx, formatWorldlineText(view));
		},
	});

	pi.registerCommand("rp", {
		description: cmdDesc("rp"),
		handler: async (_args, ctx) => {
			rpMode = !rpMode;
			if (rpMode) {
				savedTools = pi.getActiveTools();
				applyRpToolset();
			} else if (savedTools) {
				pi.setActiveTools(savedTools);
			}
			notify(ctx, rpMode ? "RP 模式：开" : "RP 模式：关（coding 工具已恢复）");
		},
	});

	// MCP 热同步（面板改配置后 REST 经命令桥调用）：重连 + 注册新工具 + 刷新活跃集。
	// system prompt 索引仍要等会话 reload 才更新（D8）；工具列表当轮即可用。
	pi.registerCommand("mcpsync", {
		description: "同步 MCP 服务器连接（扩展能力面板改配置后由系统自动调用）",
		handler: async (_args, ctx) => {
			try {
				const statuses = await syncMcp();
				const ok = statuses.filter((s) => s.enabled && s.status === "connected").length;
				const bad = statuses.filter((s) => s.enabled && s.status === "error").length;
				notify(
					ctx,
					`MCP 已同步：本对话启用 ${sessionMcpEnabled.length} · 在线 ${ok}${bad ? ` · 失败 ${bad}` : ""} · 工具 ${mcpToolNames.length}`,
					bad ? "warning" : "info",
				);
			} catch (err) {
				notify(ctx, `MCP 同步失败：${err instanceof Error ? err.message : String(err)}`, "error");
			}
		},
	});

	// 本对话开关 MCP（agent 绑会话）：/mcpset <id> on|off  ·  /mcpset 列出
	pi.registerCommand("mcpset", {
		description: "本对话启用/关闭 MCP 服务器，用法 /mcpset <id> on|off",
		handler: async (args, ctx) => {
			const raw = (args ?? "").trim();
			if (!raw) {
				notify(
					ctx,
					sessionMcpEnabled.length
						? `本对话已启用 MCP：${sessionMcpEnabled.join("、")}`
						: "本对话未启用任何 MCP（扩展能力面板可开；发现项默认全关）",
				);
				return;
			}
			const m = /^(\S+)\s+(on|off|1|0|true|false)$/i.exec(raw);
			if (!m) {
				notify(ctx, "用法：/mcpset <服务器id> on|off");
				return;
			}
			const id = sanitizeServerId(m[1]);
			const on = /^(on|1|true)$/i.test(m[2]);
			if (!id) {
				notify(ctx, "无效的服务器 id");
				return;
			}
			const next = on
				? [...new Set([...sessionMcpEnabled, id])]
				: sessionMcpEnabled.filter((x) => x !== id);
			try {
				await syncMcp(next);
				// 开关后就地重装 system prompt 索引（同会话内 MCP 段可变；其余仍稳定）
				if (card) {
					systemPromptCache = buildSystemPrompt({
						card,
						config,
						constantLore: constantEntries(entries),
						presetSystemBlocks: preset ? enabledBlocks(preset, "system") : undefined,
						selfApiBase: process.env.LIYUAN_HTTP || undefined,
						skills: listSkills(appCwd),
						mcpIndex: mcpIndexCache,
					});
				}
				notify(ctx, on ? `本对话已启用 MCP「${id}」（工具 ${mcpToolNames.length}）` : `本对话已关闭 MCP「${id}」`);
			} catch (err) {
				notify(ctx, `MCP 切换失败：${err instanceof Error ? err.message : String(err)}`, "error");
			}
		},
	});

	/**
	 * 热更新配置与素材（不重放 session_start）：
	 * 身份/语言/世界书挂载/预设/卡字段改完后，REST 走 softRefresh，避免 VPS 上整会话 reload 卡 1s+。
	 * 不碰 state/panels/会话树；只重装 config + card + lore + preset + system prompt + 工具集。
	 */
	const hotReloadMaterials = (cwd: string) => {
		const configPath = resolveConfigPath(cwd);
		if (existsSync(configPath)) {
			const raw = { ...DEFAULT_CONFIG, ...(JSON.parse(readFileSync(configPath, "utf8")) as Partial<RpConfig>) };
			config = setMountedLorebooks(raw, mountedLorebookPaths(raw));
		}
		card = loadCardFile(resolvePath(cwd, config.card));
		const fileGroups: LorebookEntry[][] = [];
		for (const rel of mountedLorebookPaths(config)) {
			const abs = resolvePath(cwd, rel);
			if (existsSync(abs)) fileGroups.push(loadLorebookFile(abs));
		}
		const fileEntries = mergeEntries(...fileGroups);
		overlayFile = overlayPathFor(cwd, card.name);
		const overlayEntries = existsSync(overlayFile) ? loadLorebookFile(overlayFile) : [];
		entries = applyDisabledLore(mergeEntries(fileEntries, overlayEntries), config.disabledLore);
		preset = null;
		if (config.preset) {
			const presetPath = resolvePath(cwd, config.preset);
			if (existsSync(presetPath)) {
				preset = normalizeRpPreset(JSON.parse(readFileSync(presetPath, "utf8")));
			}
		}
		systemPromptCache = buildSystemPrompt({
			card,
			config,
			constantLore: constantEntries(entries),
			presetSystemBlocks: preset ? enabledBlocks(preset, "system") : undefined,
			selfApiBase: process.env.LIYUAN_HTTP || undefined,
			skills: listSkills(cwd),
			mcpIndex: mcpIndexCache,
		});
		if (rpMode) applyRpToolset();
	};

	pi.registerCommand("rprefresh", {
		description: "热更新 RP 配置与素材（身份/世界书/预设等，不重装会话）",
		handler: async (_args, ctx) => {
			try {
				hotReloadMaterials(ctx.cwd || appCwd);
				// 静默：REST 会 notify；TUI 下给一句确认
				if (process.env.RP_DEBUG) notify(ctx, "rprefresh ok");
			} catch (err) {
				notify(ctx, `热更新失败：${err instanceof Error ? err.message : String(err)}`, "error");
			}
		},
	});

	// 面板磁盘同步（柱 2 导入导出）：REST 导入直接写 .liyuan-artifacts 文件后经命令桥调用本命令，
	// 把磁盘状态收编进扩展内存并快照进会话树（否则下次 panel_write 会覆盖导入、rewind 也退不回来）
	pi.registerCommand("panelsync", {
		description: "从磁盘同步面板（面板导入后由系统自动调用）",
		handler: async (_args, ctx) => {
			if (!panelsFile) return;
			panels = loadPanels(panelsFile);
			snapshotPanels();
			notify(ctx, `面板已同步：${activePanels(panels).length} 个活跃`);
		},
	});

	// 状态磁盘同步（panelsync 同款命令桥模式）：状态面板的用户编辑经 REST 直接写 .liyuan-state
	// 文件后调用本命令，把磁盘状态收编进扩展内存并快照进会话树（用户主权，不经模型；rewind 可回退）
	pi.registerCommand("statesync", {
		description: "从磁盘同步世界状态（状态面板编辑后由系统自动调用）",
		handler: async (_args, ctx) => {
			if (!stateFile) return;
			state = { ...defaultState(), ...loadState(stateFile) };
			snapshotState();
			notify(ctx, "世界状态已按面板编辑更新");
		},
	});

	// 知识库面板按钮（PLAN-PANELS-V2 §2.4，用户主权直接放行不过门禁）：REST 经命令桥调用本命令挂/卸库，
	// 与 codex_mount 工具同一内存与树快照路径（rewind/fork 跟随）
	pi.registerCommand("codexmount", {
		description: "挂载/卸载知识库（知识库面板按钮由系统自动调用），用法 /codexmount mount|unmount <库名>",
		handler: async (args, ctx) => {
			const m = /^\s*(mount|unmount)\s+(.+)$/.exec(args ?? "");
			if (!m) {
				notify(ctx, "用法：/codexmount mount|unmount <库名>");
				return;
			}
			const name = m[2].trim();
			if (m[1] === "mount") {
				const meta = findCodex(appCwd, name);
				if (!meta) {
					notify(ctx, `没有名为「${name}」的知识库`);
					return;
				}
				if (!mountedCodexes.some((n) => n.toLowerCase() === meta.name.toLowerCase())) {
					mountedCodexes = [...mountedCodexes, meta.name];
					snapshotCodexMounts();
				}
				notify(ctx, `知识库「${meta.name}」已挂载到本对话`);
			} else {
				const n = name.toLowerCase();
				if (mountedCodexes.some((x) => x.toLowerCase() === n)) {
					mountedCodexes = mountedCodexes.filter((x) => x.toLowerCase() !== n);
					snapshotCodexMounts();
				}
				notify(ctx, `知识库「${name}」已卸载`);
			}
		},
	});

	pi.registerCommand("state", {
		description: cmdDesc("state"),
		handler: async (_args, ctx) => {
			notify(ctx, formatState(state));
		},
	});

	pi.registerCommand("lore", {
		description: cmdDesc("lore"),
		handler: async (args, ctx) => {
			const hits = searchEntries(allEntries(), args ?? "", 5);
			notify(
				ctx,
				hits.length
					? hits.map((h) => `${h.entry.comment || h.entry.keys[0]}（score ${h.score}）`).join("；")
					: "无命中",
			);
		},
	});

	// ST 聊天记录导入：素材消化（解析→清洗→旧轮摘要→场记建账→前情注入）
	// 用法：/import <path.jsonl> [正文标签名]。建议在新会话中执行。
	pi.registerCommand("import", {
		description: cmdDesc("import"),
		handler: async (args, ctx) => {
			if (!rpMode || !card) {
				notify(ctx, "RP 模式未就绪，无法导入", "error");
				return;
			}
			const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
			const path = parts[0];
			const extractTag = parts[1];
			if (!path) {
				notify(ctx, "用法：/import <ST聊天.jsonl> [正文标签名]（标签名如 content，表示正文在 <content>…</content> 之间）", "error");
				return;
			}
			try {
				const parsed = parseStChat(readFileSync(resolvePath(ctx.cwd, path), "utf8"));
				const cleaned = cleanChat(parsed.messages, {
					extractTag,
					stripTags: [...DEFAULT_STRIP_TAGS, ...(config.importStripTags ?? [])],
				});
				if (cleaned.length === 0) {
					notify(ctx, "清洗后没有剩下任何消息——正文标签名是否写错？", "error");
					return;
				}
				const removed = parsed.messages.length - cleaned.length;
				const KEEP_RECENT = 8;
				const recent = cleaned.slice(-KEEP_RECENT);
				const older = cleaned.slice(0, -KEEP_RECENT);

				notify(ctx, `解析 ${parsed.messages.length} 条（清洗后剩 ${cleaned.length}，剔除 ${removed} 条空壳）。正在消化旧剧情（${older.length} 条）…`);

				// 旧轮次 → 剧情向接力摘要（复用压缩摘要提示词）
				let summary = "";
				if (older.length > 0) {
					const prompt = buildRpSummaryPrompt({
						conversationText: serializeForImportSummary(older, config.userName),
						stateSnapshot: formatState(state),
						language: config.language,
						userName: config.userName,
					});
					summary = (await sideComplete(ctx, prompt.systemPrompt, prompt.userText, 4096)) ?? "";
				}

				// 场记建账：从摘要+最近对白初始化世界状态
				const digest = [summary, ...recent.map((m) => `${m.name}：${m.text}`)].filter(Boolean).join("\n\n");
				const scribePrompt = buildScribeTurnPrompt({
					state,
					userText: "（导入的历史剧情，正文见助手侧）",
					assistantText: digest,
					charName: card.name,
					userName: config.userName,
				});
				const scribeText = await sideComplete(ctx, scribePrompt.systemPrompt, scribePrompt.userText, 2048);
				const scribeResult = scribeText ? parseScribeResult(scribeText) : null;
				if (scribeResult && Object.keys(scribeResult.patch).length > 0) {
					const knownNames = [card.name, config.userName, ...Object.keys(state.characters)];
					const applied = applyPatch(state, canonicalizeCharacterKeys(scribeResult.patch, knownNames));
					state = applied.state;
					if (stateFile) saveState(stateFile, state);
					snapshotState();
				}

				// 前情块注入会话（custom 消息，TUI 可见，LLM 以 user 角色读到）
				pi.sendMessage({
					customType: "rp-import",
					content: buildImportBlock({ summary, recentTurns: recent, charName: card.name, userName: config.userName }),
					display: true,
				});
				notify(
					ctx,
					`导入完成：摘要 ${older.length} 条 + 原文保留 ${recent.length} 条；世界状态已建账（/state 查看）。继续你的剧情吧。`,
				);
			} catch (err) {
				notify(ctx, `导入失败：${err instanceof Error ? err.message : String(err)}`, "error");
			}
		},
	});
}
