/**
 * 梨园 Web 宿主（PLAN-PHASE3 §2）：进程内嵌 pi SDK，向浏览器暴露 wire 协议。
 *
 * D3 扩展条款：本文件是接线层之外唯一允许接触 pi API 的地方，且只许碰
 * 会话托管面（runtime 创建 / 事件订阅 / prompt / abort / bindExtensions / 树导航桥接）；
 * 领域逻辑在 .liyuan/extensions/roleplay.ts；本文件只碰会话托管面。
 * 前端只见 wire 协议（server/wire.ts）。
 *
 * 用法：node server/main.ts [--new]        （cwd 必须是 Liyuan/ 产品根）
 *   HOST=0.0.0.0 PORT=7620 可经环境变量覆盖。默认绑 0.0.0.0：手机可连，勿暴露公网。
 *   --new 开新会话；默认续接最近会话。同一会话勿同时开 TUI（无文件锁）。
 */

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, unlinkSync, watch, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { dirname, extname, isAbsolute, join, normalize } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	SessionManager,
	type AgentSession,
	type CreateAgentSessionRuntimeFactory,
} from "@liyuan/agent-runtime";

import {
	ACCESS_COOKIE,
	clearPassword,
	issueToken,
	loadAccess,
	parseCookies,
	revokeToken,
	setPassword,
	verifyPassword,
	verifyToken,
	type AccessData,
} from "../src/access.ts";
import { loadCardFile } from "../src/card.ts";
import { buildGreeting } from "../src/director.ts";
import { activePanels, loadPanels, savePanels, writePanel } from "../src/panels.ts";
import {
	DIRS,
	dir,
	migrateLegacyLayout,
	preferLiyuanAgentHome,
	resolveConfigPath,
	takeAgentMergeLog,
} from "../src/paths.ts";
import { applyPatch, loadState, saveState } from "../src/state.ts";
import { DEFAULT_CONFIG, type RpConfig } from "../src/types.ts";
import {
	loadTtsConfig,
	saveAudioBuffer,
	synthesizeSpeech,
	ttsConfigHint,
} from "../src/tts.ts";
import {
	buildAncestryIndex,
	buildWorldlineView,
	extractSaves,
	loadWorldlineMeta,
	metaPath,
	renameWorldline as renameWorldlineMeta,
	saveWorldlineMeta,
	softDeleteSave,
	type TreeEntryLite,
} from "../src/worldline.ts";
import {
	lastStoryUserEntryId,
	listReplyVariants,
	swipeMetaForUser,
	type SwipeEntry,
} from "../src/swipe.ts";
import { handleApiRequest, type CurrentModelInfo, type RestHost } from "./rest.ts";

// 用户级 agent 目录 → ~/.liyuan/agent（须在 getAgentDir / 建会话之前）
// 并合并 fork 改名后遗留的 ~/.pi/agent（会话/配置，不覆盖更新的新树）
const agentHome = preferLiyuanAgentHome();
import {
	isBackstageText,
	parseCardFromSessionHead,
	summarizeToolResult,
	toWireHistory,
	toWireMsg,
	type ClientFrame,
	type ServerFrame,
	type WireNames,
	type WireStats,
} from "./wire.ts";

const cwd = process.cwd();
const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 7620);
const newSessionFlag = process.argv.includes("--new");

// 数据目录/配置文件：.rp-* → .liyuan-*，rp.config.json → liyuan.config.json
for (const line of migrateLegacyLayout(cwd)) {
	console.log(`[liyuan] 迁移 ${line}`);
}

// 自操作接口地址：扩展在 session_start 读取并写进 system prompt（PLAN-PHASE3 §6.3，
// agent 经 bash curl 操作本系统）。必须在 runtime 创建（扩展加载）之前设置。
process.env.LIYUAN_HTTP = `http://localhost:${PORT}`;

// Windows 环境修补（F3 实测缺陷，2026-07-10）：pi 以非登录模式启动 bash，PATH 里没有
// Git 的 usr/bin，agent 的 bash 工具找不到 cat/sed/grep 等 coreutils（python3 还会撞上
// 微软商店 stub）。从 .liyuan/settings.json 的 shellPath 推导 usr/bin 前置进 PATH，子进程继承。
try {
	const settings = JSON.parse(readFileSync(join(cwd, ".liyuan", "settings.json"), "utf8")) as { shellPath?: string };
	if (settings.shellPath) {
		const usrBin = dirname(settings.shellPath);
		if (existsSync(usrBin) && !(process.env.PATH ?? "").split(";").includes(usrBin)) {
			process.env.PATH = `${usrBin};${process.env.PATH ?? ""}`;
		}
	}
} catch {
	// 无 settings.json 或不可读：跳过（非 Windows/标准安装不需要修补）
}

// ---------- 显示名（角色/用户）：直接读配置与卡（领域层，合法） ----------

const names: WireNames = { charName: "角色", userName: "用户" };
/** 当前卡标识（liyuan.config.json 的 card 路径原文，会话过滤用） */
let cardPath = "";

/** 从项目配置刷新显示名与当前卡（启动时与每次配置写入/会话重载后调用） */
const refreshNamesFromConfig = () => {
	names.charName = "角色";
	names.userName = "用户";
	cardPath = "";
	try {
		const config = JSON.parse(readFileSync(resolveConfigPath(cwd), "utf8")) as {
			card?: string;
			userName?: string;
			displayName?: string;
		};
		if (config.userName) names.userName = config.userName;
		if (config.card) {
			cardPath = config.card;
			const abs = isAbsolute(config.card) ? config.card : join(cwd, config.card);
			names.charName = loadCardFile(abs).name;
		}
		// 显示名覆盖（仅显示层；{{char}} 宏与提示词仍用卡名）
		if (config.displayName) names.charName = config.displayName;
	} catch (err) {
		console.error(`[liyuan] 读取角色显示名失败（用占位名继续）：${err instanceof Error ? err.message : String(err)}`);
	}
};
refreshNamesFromConfig();

// ---------- pi 会话宿主 ----------

const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
	const services = await createAgentSessionServices({ cwd });
	return {
		...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
		services,
		diagnostics: services.diagnostics,
	};
};

const runtime = await createAgentSessionRuntime(createRuntime, {
	cwd,
	agentDir: getAgentDir(),
	sessionManager: newSessionFlag ? SessionManager.create(cwd) : SessionManager.continueRecent(cwd),
});

let session: AgentSession = runtime.session;
let unsubscribe: (() => void) | undefined;

// ---------- WS 广播 ----------

const clients = new Set<WebSocket>();
const broadcast = (frame: ServerFrame) => {
	const data = JSON.stringify(frame);
	for (const ws of clients) {
		if (ws.readyState === ws.OPEN) ws.send(data);
	}
};

// ---------- 会话统计与世界状态（右栏信息面板的数据源） ----------

const safeStats = (): WireStats | null => {
	try {
		const s = session.getSessionStats();
		const cu = s.contextUsage;
		return {
			userMessages: s.userMessages,
			assistantMessages: s.assistantMessages,
			totalTokens: s.tokens.total,
			cost: s.cost,
			contextPercent: cu?.percent ?? null,
			contextTokens: cu?.tokens ?? null,
			contextWindow: cu?.contextWindow ?? session.model?.contextWindow ?? null,
		};
	} catch {
		return null;
	}
};

const stateDir = dir(cwd, "state");
mkdirSync(stateDir, { recursive: true });
const currentState = () => loadState(join(stateDir, `${session.sessionId}.json`));

// 场记记账落盘即推送（PLAN-PHASE3 §4：fs.watch 目录级监听，零扩展改动；
// Windows 下同一次写可能触发多次事件，200ms 去抖）
let stateDebounce: ReturnType<typeof setTimeout> | undefined;
watch(stateDir, (_evt, filename) => {
	if (filename !== `${session.sessionId}.json`) return;
	clearTimeout(stateDebounce);
	stateDebounce = setTimeout(() => {
		try {
			broadcast({ type: "state", state: currentState() });
		} catch {
			// 读取竞态（写入未完成）：下次事件再推
		}
	}, 200);
});

// agent 自建面板（柱 2）：与 state 同款——扩展落盘 .rp-artifacts/<sessionId>.json，
// 这里 fs.watch 监听并推送活跃面板全量（panel_write/close 与 rewind 回退同一条路径）
const artifactsDir = dir(cwd, "artifacts");
mkdirSync(artifactsDir, { recursive: true });
const currentPanels = () => activePanels(loadPanels(join(artifactsDir, `${session.sessionId}.json`)));

let panelsDebounce: ReturnType<typeof setTimeout> | undefined;
watch(artifactsDir, (_evt, filename) => {
	if (filename !== `${session.sessionId}.json`) return;
	clearTimeout(panelsDebounce);
	panelsDebounce = setTimeout(() => {
		try {
			broadcast({ type: "panels", panels: currentPanels() });
		} catch {
			// 读取竞态（写入未完成）：下次事件再推
		}
	}, 200);
});

/** 会话树条目 → swipe 纯函数输入 */
const swipeEntriesFromSession = (): SwipeEntry[] => {
	const raw = session.sessionManager.getEntries() as Array<Record<string, unknown>>;
	return raw.map((e) => {
		const id = String(e.id);
		const parentId = (e.parentId as string | null) ?? null;
		const type = String(e.type);
		const timestamp = typeof e.timestamp === "string" ? e.timestamp : undefined;
		if (type === "message" && e.message && typeof e.message === "object") {
			const m = e.message as { role?: unknown; customType?: unknown };
			return {
				id,
				parentId,
				type: "message",
				role: typeof m.role === "string" ? m.role : undefined,
				customType: typeof m.customType === "string" ? m.customType : undefined,
				timestamp,
			};
		}
		return {
			id,
			parentId,
			type,
			customType: typeof e.customType === "string" ? e.customType : undefined,
			timestamp,
		};
	});
};

const extractEntryText = (content: unknown): string => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((p) =>
			p && typeof p === "object" && (p as { type?: unknown }).type === "text"
				? String((p as { text?: unknown }).text ?? "")
				: "",
		)
		.join("");
};

/** 当前分支上最后一条剧情用户消息 entry id（戏外轮不计） */
const lastStoryUserId = (): string | null => {
	const branch = session.sessionManager.getBranch() as Array<Record<string, unknown>>;
	const lite = branch.map((e) => {
		const type = String(e.type);
		if (type === "message" && e.message && typeof e.message === "object") {
			const m = e.message as { role?: unknown; content?: unknown };
			return {
				id: String(e.id),
				type: "message",
				role: typeof m.role === "string" ? m.role : undefined,
				text: extractEntryText(m.content),
			};
		}
		return { id: String(e.id), type };
	});
	return lastStoryUserEntryId(lite, isBackstageText);
};

/**
 * 给历史 wire 消息挂上 ST swipe 元数据：仅「当前分支最后一轮剧情角色回复」一条。
 * total=0 时不挂（尚无回复，箭头由前端在空状态决定是否展示——目前只在有 narrative 时显示）。
 */
const annotateSwipes = (messages: import("./wire.ts").WireMsg[]): import("./wire.ts").WireMsg[] => {
	const userId = lastStoryUserId();
	if (!userId) return messages;
	const leafId = session.sessionManager.getLeafId();
	const meta = swipeMetaForUser(swipeEntriesFromSession(), userId, leafId);
	// total=0 也挂上（仅 user 尚无回复时 UI 可点右生成；有 narrative 时至少 1）
	// 找最后一条 narrative（非 backstage 流里的角色回复）
	let lastNar = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].channel === "narrative") {
			lastNar = i;
			break;
		}
	}
	if (lastNar < 0) return messages;
	const total = Math.max(1, meta?.total ?? 1);
	const index = meta && meta.total > 0 ? meta.index : 0;
	return messages.map((m, i) => (i === lastNar ? { ...m, swipe: { index, total } } : m));
};

const helloFrame = (): ServerFrame => ({
	type: "hello",
	sessionId: session.sessionId,
	charName: names.charName,
	userName: names.userName,
	messages: annotateSwipes(toWireHistory(session.messages, names)),
	state: currentState(),
	stats: safeStats(),
	panels: currentPanels(),
});

/** 全量重放（斜杠命令 / 树导航 / 压缩后：让所有端与会话文件对齐） */
const resyncAll = () => broadcast(helloFrame());

/** 会话树条目是否为开场白 */
const isGreetingTreeEntry = (e: Record<string, unknown>): boolean => {
	const t = String(e.type ?? "");
	if (t === "custom_message" && e.customType === "rp-greeting") return true;
	const msg = e.message as { role?: unknown; customType?: unknown } | undefined;
	if (t === "message" && msg?.role === "custom" && msg?.customType === "rp-greeting") return true;
	return false;
};

/**
 * 宿主层切换开场白：await 导航 + 注入 + resync，避免叠楼。
 * （扩展里 pi.sendMessage 是 fire-and-forget，resync 会抢跑；且 custom_message 识别曾漏检）
 */
const hostSwitchGreeting = async (rawArg: string): Promise<void> => {
	const configPath = resolveConfigPath(cwd);
	let cfg: RpConfig = { ...DEFAULT_CONFIG };
	try {
		if (existsSync(configPath)) {
			cfg = { ...DEFAULT_CONFIG, ...(JSON.parse(readFileSync(configPath, "utf8")) as Partial<RpConfig>) };
		}
	} catch {
		/* default */
	}
	if (!cfg.card) {
		broadcast({ type: "notify", level: "error", text: "未配置角色卡" });
		return;
	}
	let card;
	try {
		const cardPath = isAbsolute(cfg.card) ? cfg.card : join(cwd, cfg.card);
		card = loadCardFile(cardPath);
	} catch (err) {
		broadcast({
			type: "notify",
			level: "error",
			text: `角色卡装载失败：${err instanceof Error ? err.message : String(err)}`,
		});
		return;
	}
	// 全量下标（与 buildGreeting / 配置 greetingIndex 一致）+ 非空槽位（切换时跳过空开场白）
	const fullPool = [card.firstMes, ...card.alternateGreetings].map((t, i) => ({
		i,
		t: typeof t === "string" ? t : "",
	}));
	const nonempty = fullPool.filter((x) => x.t.trim());
	if (nonempty.length === 0) {
		broadcast({ type: "notify", level: "error", text: "本卡没有开场白" });
		return;
	}
	const raw = rawArg.trim().toLowerCase();
	const curFull = cfg.greetingIndex ?? 0;
	let pos = nonempty.findIndex((x) => x.i === curFull);
	if (pos < 0) pos = 0;
	if (!raw || raw === "next") pos = (pos + 1) % nonempty.length;
	else if (raw === "prev") pos = (pos - 1 + nonempty.length) % nonempty.length;
	else {
		const n = Number.parseInt(raw, 10);
		if (!Number.isFinite(n)) {
			broadcast({ type: "notify", level: "error", text: "用法：/greeting [序号|next|prev]" });
			return;
		}
		// 数字按「全量下标」理解（与配置 / 卡面板一致）
		const hit = nonempty.findIndex((x) => x.i === n);
		pos = hit >= 0 ? hit : Math.max(0, Math.min(nonempty.length - 1, n));
	}
	const idx = nonempty[pos].i; // 写入配置与 buildGreeting 的全量下标
	const displayOrdinal = pos + 1; // 角标用非空序位 1..N
	const displayTotal = nonempty.length;
	try {
		const disk = existsSync(configPath)
			? (JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>)
			: {};
		disk.greetingIndex = idx;
		writeFileSync(configPath, `${JSON.stringify(disk, null, "\t")}\n`, "utf8");
	} catch (err) {
		broadcast({
			type: "notify",
			level: "error",
			text: `写入配置失败：${err instanceof Error ? err.message : String(err)}`,
		});
		return;
	}
	cfg = { ...cfg, greetingIndex: idx };

	const sm = session.sessionManager;
	const branch = sm.getBranch() as Array<Record<string, unknown>>;
	const hasUser = branch.some((e) => {
		if (e.type !== "message") return false;
		const msg = e.message as { role?: string; content?: unknown } | undefined;
		if (msg?.role !== "user") return false;
		return !isBackstageText(extractEntryText(msg.content));
	});
	if (hasUser) {
		broadcast({
			type: "notify",
			level: "info",
			text: `已选定开场白 ${displayOrdinal}/${displayTotal}，当前会话已开聊，下次新会话生效。`,
		});
		return;
	}

	const greets = branch.filter(isGreetingTreeEntry);
	if (greets.length > 0) {
		const first = greets[0];
		const parentId = (first.parentId as string | null) ?? null;
		if (parentId) {
			const result = await session.navigateTree(parentId, { summarize: false });
			if (result.cancelled) return;
		} else {
			// 树根开场白：resetLeaf，新开场白与旧的并列 sibling，当前只显示新的
			sm.resetLeaf();
			const ctx = sm.buildSessionContext();
			session.agent.state.messages = ctx.messages;
		}
	}

	const text = buildGreeting(card, cfg);
	// details 带序号 → wire greetingPick，前端角标与正文同源
	await session.sendCustomMessage({
		customType: "rp-greeting",
		content: text,
		display: true,
		details: { rpGreeting: { index: pos, total: displayTotal, fullIndex: idx } },
	});
	resyncAll();
	broadcast({ type: "notify", level: "info", text: `已切换开场白 ${displayOrdinal}/${displayTotal}` });
};

/**
 * ST 式再生成：叶指针落在「最后一条剧情 user」上，再 agent.continue()。
 * 新 assistant 作为该 user 的 sibling 子树；旧变体保留在旁支。
 *
 * 注意：session.navigateTree(userId) 对 user 会退到 parent 并把文案放进 editor，
 * 不适合 swipe（会拆成多条 user）。这里用 branch(userId) 固定挂在同一 user 下。
 * 不写 /store → 不产生世界线分叉。
 */
const regenerateSwipe = async (): Promise<void> => {
	const userId = lastStoryUserId();
	if (!userId) {
		broadcast({ type: "notify", level: "error", text: "没有可重新生成的剧情轮（需要先有一条用户输入）" });
		return;
	}
	const sm = session.sessionManager;
	const oldLeafId = sm.getLeafId();
	// 先导航到当前变体叶（或 user 子树内节点）触发 session_tree，再把叶钉到 user
	if (oldLeafId && oldLeafId !== userId) {
		const entry = sm.getEntry(oldLeafId) as { parentId?: string | null } | undefined;
		// 若当前叶已是 user 的后裔，navigateTree 到该叶只为发 session_tree；否则导航到 user 的直接子（若有）
		const r = await session.navigateTree(oldLeafId, { summarize: false });
		if (r.cancelled) return;
		void entry;
	}
	// 叶 = user：上下文以用户消息结尾，continue 会在 user 下挂新的 assistant sibling
	if (sm.getLeafId() !== userId) {
		sm.branch(userId);
		const ctx = sm.buildSessionContext();
		session.agent.state.messages = ctx.messages;
	}
	// 展示层立刻去掉旧回复（只显示到 user）
	resyncAll();
	try {
		await session.agent.continue();
	} catch (err) {
		broadcast({
			type: "notify",
			level: "error",
			text: err instanceof Error ? err.message : String(err),
		});
	}
};

/**
 * ST 式变体切换 / 再生成。
 * - prev：上一条 sibling（到头则提示）
 * - next：下一条；已在末条则再生成
 * - new：强制再生成
 */
const handleSwipe = async (dir: "prev" | "next" | "new"): Promise<void> => {
	if (dir === "new") {
		await regenerateSwipe();
		return;
	}
	const userId = lastStoryUserId();
	if (!userId) {
		broadcast({ type: "notify", level: "error", text: "没有可切换的回复变体" });
		return;
	}
	const entries = swipeEntriesFromSession();
	const leafId = session.sessionManager.getLeafId();
	const variants = listReplyVariants(entries, userId, leafId);
	if (variants.length === 0) {
		// 尚无回复：next/new 等价生成
		if (dir === "next") await regenerateSwipe();
		else broadcast({ type: "notify", level: "info", text: "还没有角色回复可切换" });
		return;
	}
	const meta = swipeMetaForUser(entries, userId, leafId);
	const idx = meta?.index ?? 0;
	if (dir === "prev") {
		if (idx <= 0) {
			broadcast({ type: "notify", level: "info", text: "已经是第一条变体" });
			return;
		}
		const target = variants[idx - 1].leafId;
		const result = await session.navigateTree(target, { summarize: false });
		if (!result.cancelled) resyncAll();
		return;
	}
	// next
	if (idx >= variants.length - 1) {
		await regenerateSwipe();
		return;
	}
	const target = variants[idx + 1].leafId;
	const result = await session.navigateTree(target, { summarize: false });
	if (!result.cancelled) resyncAll();
};

// ---------- 扩展绑定：headless UI 上下文 + 命令动作桥（参考 dist/modes/rpc/rpc-mode.js） ----------

const noop = () => {};

// ---------- 剧情决策门禁通道（Phase 4 柱 1）：uiContext.select/input ↔ 前端选择卡 ----------
//
// 扩展的 ask_director 工具调用 ctx.ui.select(question, options) 停笔询问；这里把它翻成
// choice 帧广播给所有端，挂起等待应答。语义（用户定调 2026-07-10）：
//   - 应答（选项原文 / 自由输入）→ resolve 该字符串，模型据此续写；
//   - 停止 → resolve undefined + abort 本回合（笔还给用户）；
//   - 无限等待（RP 本是回合制，不设超时）；
//   - 断线重连：hello 补发未决卡；多端先答先得，其余端收 choice_resolved 收敛留痕。

interface PendingChoice {
	question: string;
	options: string[];
	placeholder?: string;
	/** value=字符串应答；undefined=停止本回合 */
	resolve: (value: string | undefined) => void;
	settled: boolean;
}
const pendingChoices = new Map<string, PendingChoice>();
let choiceSeq = 0;

/** 未决卡帧（hello 补发 / 首次广播共用） */
const choiceFrame = (id: string, p: PendingChoice): ServerFrame => ({
	type: "choice",
	id,
	question: p.question,
	options: p.options,
	...(p.placeholder ? { placeholder: p.placeholder } : {}),
});

/** 收敛一张未决卡：resolve 扩展侧的挂起 Promise，并广播留痕态给所有端 */
const settleChoice = (id: string, outcome: { value?: string; stop?: boolean }) => {
	const p = pendingChoices.get(id);
	if (!p || p.settled) return;
	p.settled = true;
	pendingChoices.delete(id);
	broadcast({ type: "choice_resolved", id, ...(outcome.stop ? { stopped: true } : { answer: outcome.value }) });
	p.resolve(outcome.stop ? undefined : outcome.value);
};

/** 挂起一次询问，等前端应答（signal 触发或主动 abort 时按停止处理） */
const askChoice = (question: string, options: string[], placeholder: string | undefined, signal?: AbortSignal) =>
	new Promise<string | undefined>((resolve) => {
		const id = `c${Date.now().toString(36)}-${++choiceSeq}`;
		const pending: PendingChoice = { question, options, placeholder, resolve, settled: false };
		pendingChoices.set(id, pending);
		broadcast(choiceFrame(id, pending));
		// 回合被外部中止（主 Stop 按钮 / 压缩等）：未决卡按停止收敛，避免悬挂
		signal?.addEventListener("abort", () => settleChoice(id, { stop: true }), { once: true });
	});

const uiContext = {
	// 有实义的部分：通知直达 Web（审计告警零改动上屏）
	notify(message: string, type?: "info" | "warning" | "error") {
		broadcast({ type: "notify", level: type ?? "info", text: message });
	},
	// 决策门禁：选择卡（有选项）/ 自由输入卡（无选项）——均带自由输入框与停止按钮（前端渲染）
	select: async (title: string, options: string[], opts?: { signal?: AbortSignal }) =>
		askChoice(title, Array.isArray(options) ? options : [], undefined, opts?.signal),
	confirm: async () => false,
	input: async (title: string, placeholder?: string, opts?: { signal?: AbortSignal }) =>
		askChoice(title, [], placeholder, opts?.signal),
	editor: async () => undefined,
	custom: async () => undefined,
	// 其余 TUI 专属能力：no-op stub
	onTerminalInput: () => noop,
	setStatus: noop,
	setWorkingMessage: noop,
	setWorkingVisible: noop,
	setWorkingIndicator: noop,
	setHiddenThinkingLabel: noop,
	setWidget: noop,
	setFooter: noop,
	setHeader: noop,
	setTitle: noop,
	pasteToEditor: noop,
	setEditorText: noop,
	getEditorText: () => "",
	addAutocompleteProvider: noop,
	setEditorComponent: noop,
	getEditorComponent: () => undefined,
	get theme() {
		return undefined;
	},
	getAllThemes: () => [],
	getTheme: () => undefined,
	setTheme: () => ({ success: false, error: "Web 模式不支持主题切换" }),
	getToolsExpanded: () => false,
	setToolsExpanded: noop,
};

const bindSession = async () => {
	session = runtime.session;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- headless stub 集合，形状对齐 rpc-mode 的实现
	await session.bindExtensions({
		uiContext: uiContext as any,
		mode: "rpc",
		commandContextActions: {
			waitForIdle: () => session.agent.waitForIdle(),
			newSession: (options: unknown) => runtime.newSession(options as never),
			fork: async (entryId: string, options: unknown) => {
				const result = await runtime.fork(entryId, options as never);
				return { cancelled: result.cancelled };
			},
			navigateTree: async (targetId: string, options: unknown) => {
				const result = await session.navigateTree(targetId, options as never);
				return { cancelled: result.cancelled };
			},
			switchSession: (sessionPath: string, options: unknown) => runtime.switchSession(sessionPath, options as never),
			reload: () => session.reload(),
		} as never,
		onError: (err: { extensionPath: string; event: string; error: string }) => {
			broadcast({ type: "error", text: `扩展错误（${err.event}）：${err.error}` });
		},
	});

	unsubscribe?.();
	unsubscribe = session.subscribe((event) => {
		switch (event.type) {
			case "agent_start":
				broadcast({ type: "agent", state: "start" });
				break;
			case "agent_end":
				if (!event.willRetry) {
					broadcast({ type: "agent", state: "end" });
					const stats = safeStats();
					if (stats) broadcast({ type: "stats", stats });
					// 挂上 swipe 序号（流式 message 帧无树元数据）
					resyncAll();
				}
				break;
			case "message_update": {
				const e = event.assistantMessageEvent;
				if (e.type === "text_delta") broadcast({ type: "delta", kind: "text", delta: e.delta });
				else if (e.type === "thinking_delta") broadcast({ type: "delta", kind: "thinking", delta: e.delta });
				break;
			}
			case "message_end": {
				const wire = toWireMsg(event.message, names, { backstage: backstageTurn });
				// user 消息在 prompt 受理时已回显，这里跳过防重
				if (wire && wire.channel !== "user") {
					broadcast({ type: "message", message: wire });
				} else if ((event.message as { role?: string } | undefined)?.role === "assistant") {
					// 中间 tool 轮 / 纯工具轮被过滤：清掉前端流式半成品，整轮只保留一个角色气泡
					broadcast({ type: "stream", state: "clear" });
				}
				break;
			}
			case "tool_execution_start": {
				let detail = "";
				try {
					detail = JSON.stringify(event.args);
					if (detail.length > 120) detail = `${detail.slice(0, 120)}…`;
				} catch {
					// 参数不可序列化则留空
				}
				broadcast({ type: "activity", activity: { kind: "tool_start", name: event.toolName, detail } });
				break;
			}
			case "tool_execution_end":
				broadcast({
					type: "activity",
					activity: {
						kind: "tool_end",
						name: event.toolName,
						detail: summarizeToolResult(event.result),
						isError: event.isError === true,
					},
				});
				break;
			case "compaction_start":
				broadcast({ type: "compaction", state: "start" });
				break;
			case "compaction_end":
				broadcast({ type: "compaction", state: "end", ok: !event.aborted && !event.errorMessage });
				resyncAll();
				break;
			case "auto_retry_start":
				broadcast({ type: "notify", level: "warning", text: `模型请求失败，自动重试 ${event.attempt}/${event.maxAttempts}…` });
				break;
			default:
				break;
		}
	});
};

runtime.setRebindSession(async () => {
	await bindSession();
	resyncAll(); // /branch 等替换会话后，所有端对齐新会话
});
await bindSession();

// ---------- REST 宿主接口（rest.ts 经此触碰 pi；pi 类型不出本文件） ----------

const currentModelInfo = (): CurrentModelInfo | null => {
	const m = session.model;
	if (!m) return null;
	return {
		provider: m.provider,
		id: m.id,
		name: m.name || m.id,
		thinkingLevel: session.thinkingLevel,
		availableLevels: session.getAvailableThinkingLevels(),
		contextWindow: m.contextWindow ?? 0,
	};
};

const restHost: RestHost = {
	cwd,
	isStreaming: () => session.isStreaming,
	listModels: () => ({
		current: currentModelInfo(),
		models: session.modelRegistry.getAvailable().map((m) => ({
			provider: m.provider,
			providerName: session.modelRegistry.getProviderDisplayName(m.provider),
			id: m.id,
			name: m.name || m.id,
			reasoning: m.reasoning === true,
			vision: Array.isArray(m.input) && m.input.includes("image"),
			contextWindow: m.contextWindow ?? 0,
		})),
	}),
	async selectModel(provider, id) {
		const m = session.modelRegistry.find(provider, id);
		if (!m) throw new Error(`模型不存在：${provider}/${id}`);
		await session.setModel(m);
		const current = currentModelInfo();
		if (!current) throw new Error("模型切换后状态异常");
		return current;
	},
	setThinkingLevel(level) {
		// 各模型档位名不同（off/low/high/xhigh/max…），由用户按模型文档自填英文，不做固定白名单
		const lv = level.trim();
		if (!lv) throw new Error("思考档位不能为空");
		session.setThinkingLevel(lv as never);
		const current = currentModelInfo();
		if (!current) throw new Error("会话未就绪");
		return current;
	},
	authProviders() {
		const counts = new Map<string, number>();
		for (const m of session.modelRegistry.getAll()) {
			counts.set(m.provider, (counts.get(m.provider) ?? 0) + 1);
		}
		// 当前会话模型所属 provider 置顶，便于在「现有渠道」里看见
		const currentProvider = session.model?.provider;
		return [...counts.entries()]
			.map(([provider, modelCount]) => {
				const status = session.modelRegistry.getProviderAuthStatus(provider);
				// pi：环境变量渠道 configured 恒 false，但 hasAuth 为真且模型可用
				const ready = session.modelRegistry.authStorage.hasAuth(provider);
				return {
					provider,
					displayName: session.modelRegistry.getProviderDisplayName(provider),
					configured: status.configured,
					ready,
					...(ready || status.configured
						? {
								source: status.configured ? status.source : "environment",
								...(status.label ? { label: status.label } : {}),
							}
						: status.source === "environment" && status.label
							? { label: status.label } // 未就绪也提示可配哪个环境变量
							: {}),
					modelCount,
				};
			})
			.sort((a, b) => {
				if (currentProvider) {
					if (a.provider === currentProvider && b.provider !== currentProvider) return -1;
					if (b.provider === currentProvider && a.provider !== currentProvider) return 1;
				}
				return Number(b.ready) - Number(a.ready) || Number(b.configured) - Number(a.configured) || a.displayName.localeCompare(b.displayName);
			});
	},
	setAuthKey(provider, key) {
		session.modelRegistry.authStorage.set(provider, { type: "api_key", key });
	},
	removeAuth(provider) {
		session.modelRegistry.authStorage.remove(provider);
	},
	agentDir: () => getAgentDir(),
	providerSnapshot(provider) {
		const all = session.modelRegistry.getAll().filter((m) => m.provider === provider);
		if (all.length === 0) return null;
		const sample = all[0] as { baseUrl?: string; api?: string; id: string; name?: string; reasoning?: boolean; contextWindow?: number; maxTokens?: number };
		const status = session.modelRegistry.getProviderAuthStatus(provider);
		const envKey =
			status.source === "environment" && status.label
				? status.label
				: provider === "deepseek"
					? "DEEPSEEK_API_KEY"
					: undefined;
		return {
			provider,
			baseUrl: typeof sample.baseUrl === "string" ? sample.baseUrl : undefined,
			api: typeof sample.api === "string" ? sample.api : undefined,
			envKey,
			models: all.map((m) => ({
				id: m.id,
				name: m.name || m.id,
				reasoning: m.reasoning === true,
				contextWindow: m.contextWindow ?? undefined,
				maxTokens: (m as { maxTokens?: number }).maxTokens,
			})),
		};
	},
	refreshModels: () => session.modelRegistry.refresh(),
	async reloadSession() {
		await session.reload();
		refreshNamesFromConfig();
		resyncAll();
	},
	/** 身份/配置/世界书挂载等：走扩展 /rprefresh，不整会话 reload */
	async softRefreshConfig() {
		if (session.isStreaming) {
			// 流式中改设定：排队到本轮结束，避免与 prompt 抢通道
			void session
				.prompt("/rprefresh", { streamingBehavior: "followUp" })
				.then(() => {
					refreshNamesFromConfig();
					resyncAll();
				})
				.catch((err) => {
					broadcast({
						type: "notify",
						level: "error",
						text: err instanceof Error ? err.message : String(err),
					});
				});
			return;
		}
		await session.prompt("/rprefresh");
		refreshNamesFromConfig();
		resyncAll();
	},
	async switchToCard() {
		refreshNamesFromConfig(); // rest.ts 已写盘新 card，先让会话过滤对准新卡
		const frame = await listSessions();
		const list = (frame as { type: "sessions"; list: Array<{ path: string; current: boolean }> }).list;
		const target = list.find((s) => !s.current);
		if (target) {
			await runtime.switchSession(target.path);
			return "switched";
		}
		await runtime.newSession();
		return "created";
	},
	promptCommand: (text) => handlePrompt(text),
	queueCommand(text) {
		const queued = session.isStreaming;
		// 不等待执行完成（流式中排队到本轮结束；/import 等长操作进度经 notify 推送）
		void handlePrompt(text).catch((err) => {
			broadcast({ type: "error", text: err instanceof Error ? err.message : String(err) });
		});
		return queued;
	},
	// 面板导入（柱 2 社区格式）：领域层校验逐条写入当前会话的面板文件（fs.watch 自动推送前端），
	// 再经命令桥 /panelsync 让扩展收编进内存 + 会话树快照
	importPanels(list) {
		const file = join(artifactsDir, `${session.sessionId}.json`);
		let panels = loadPanels(file);
		let imported = 0;
		const names: string[] = [];
		const errors: string[] = [];
		for (const item of list) {
			const name = String(item?.name ?? "");
			const r = writePanel(panels, {
				name,
				kind: String(item?.kind ?? ""),
				content: String(item?.content ?? ""),
			});
			if (r.ok) {
				panels = r.panels;
				imported++;
				names.push(name.trim());
			} else {
				errors.push(`「${name || "?"}」：${r.error}`);
			}
		}
		if (imported > 0) {
			savePanels(file, panels);
			void handlePrompt("/panelsync").catch((err) => {
				broadcast({ type: "error", text: err instanceof Error ? err.message : String(err) });
			});
		}
		return { imported, names, errors };
	},
	// 挂载知识库：与扩展 restoreCodexFromBranch 同规则——当前分支上最近的 rp-codex 快照
	mountedCodexes() {
		try {
			const branch = session.sessionManager.getBranch() as Array<{
				type: string;
				customType?: string;
				data?: { mounted?: unknown };
			}>;
			for (let i = branch.length - 1; i >= 0; i--) {
				const e = branch[i];
				if (e.type === "custom" && e.customType === "rp-codex") {
					const mounted = e.data?.mounted;
					return Array.isArray(mounted) ? mounted.filter((n): n is string => typeof n === "string") : [];
				}
			}
		} catch {
			// 树读取失败按无挂载处理
		}
		return [];
	},
	// ---- 世界状态编辑（PLAN-PANELS §2.11）：用户主权 applyPatch，落盘即广播，命令桥收编进树 ----
	applyStatePatch(patch) {
		const file = join(stateDir, `${session.sessionId}.json`);
		const r = applyPatch(loadState(file), patch);
		saveState(file, r.state); // fs.watch 自动广播 state 帧
		// statesync：扩展把磁盘状态收编进内存并快照进会话树（panelsync 同款命令桥）
		void handlePrompt("/statesync").catch((err) => {
			broadcast({ type: "error", text: err instanceof Error ? err.message : String(err) });
		});
		return { applied: r.applied, warnings: r.warnings };
	},
	// ---- 世界线视图 / 软删除 / 线名 ----
	worldlineView() {
		const sm = session.sessionManager;
		const sid = session.sessionId;
		const meta = loadWorldlineMeta(metaPath(cwd, sid));
		const entries: TreeEntryLite[] = sm.getEntries().map((e) => ({
			id: e.id,
			parentId: e.parentId,
			type: e.type,
			...("customType" in e && typeof (e as { customType?: string }).customType === "string"
				? { customType: (e as { customType: string }).customType }
				: {}),
			...("data" in e ? { data: (e as { data?: unknown }).data } : {}),
			...(typeof e.timestamp === "string" ? { timestamp: e.timestamp } : {}),
		}));
		const saves = extractSaves(entries, meta);
		const leafId = sm.getLeafId();
		const { branchIdsFromLeaf } = buildAncestryIndex(entries);
		return buildWorldlineView(saves, meta, branchIdsFromLeaf(leafId), leafId);
	},
	deleteWorldlineSave(saveId) {
		const file = metaPath(cwd, session.sessionId);
		const meta = softDeleteSave(loadWorldlineMeta(file), saveId);
		saveWorldlineMeta(file, meta);
		broadcast({ type: "notify", level: "info", text: "已删除存档节点（软删除，会话树原文保留）" });
	},
	renameWorldline(worldlineId, name) {
		const file = metaPath(cwd, session.sessionId);
		const meta = renameWorldlineMeta(loadWorldlineMeta(file), worldlineId, name);
		saveWorldlineMeta(file, meta);
		broadcast({ type: "notify", level: "info", text: `世界线已改名「${name.trim()}」` });
	},
	// ---- 会话管理（PLAN-PANELS §2.1）：面板的重命名/删除/导出/全文搜索 ----
	sessions: () => sessionInfos(),
	async renameSession(path, name) {
		await assertListedSession(path);
		const clean = name.replace(/[\r\n]+/g, " ").trim();
		if (!clean) throw new Error("名字不能为空");
		if (session.sessionFile === path) {
			session.sessionManager.appendSessionInfo(clean);
			return;
		}
		// 离线会话：按 pi session_info 条目格式追加一行（parentId=文件最后一条的 id，等效 leaf）
		const lines = readFileSync(path, "utf8").split(/\r?\n/);
		let parentId: string | null = null;
		for (let i = lines.length - 1; i >= 0; i--) {
			const line = lines[i].trim();
			if (!line) continue;
			try {
				const e = JSON.parse(line) as { id?: unknown };
				if (typeof e.id === "string") {
					parentId = e.id;
					break;
				}
			} catch {
				// 半行跳过
			}
		}
		const entry = {
			type: "session_info",
			id: randomBytes(4).toString("hex"),
			parentId,
			timestamp: new Date().toISOString(),
			name: clean,
		};
		appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
	},
	async deleteSession(path) {
		await assertListedSession(path);
		if (session.sessionFile === path) throw new Error("不能删除当前打开的会话（先切到其他会话再删）");
		unlinkSync(path);
		cardCache.delete(path);
		previewCache.delete(path);
	},
	// 删卡「相关数据」用：删除绑定某张卡的全部会话文件（rp-card 标记匹配）。
	// 调用方须保证当前打开的会话已不属于该卡（删当前卡先切走再调本方法）。
	async deleteCardSessions(cardRel) {
		const all = await SessionManager.list(cwd);
		let n = 0;
		for (const s of all) {
			if (isSameSessionPath(s.path, session.sessionFile)) continue;
			const mtime = s.modified instanceof Date ? s.modified.getTime() : Number(s.modified) || 0;
			const info = readSessionCard(s.path, mtime);
			if (!info || info.card !== cardRel) continue;
			try {
				unlinkSync(s.path);
				cardCache.delete(s.path);
				previewCache.delete(s.path);
				n += 1;
			} catch {
				// 单个文件删不掉（占用等）不挡整体
			}
		}
		if (n > 0) broadcast(await listSessions());
		return n;
	},
	async readSessionFile(path) {
		await assertListedSession(path);
		return readFileSync(path, "utf8");
	},
	// 全文搜索（借鉴 ST：搜会话内容而非只搜标题）；只搜 user/assistant 正文，注入素材不算命中
	async searchSessions(q) {
		const needle = q.trim().toLowerCase();
		if (!needle) return [];
		const out: Array<{
			path: string;
			name?: string;
			firstMessage: string;
			modified: number;
			messageCount: number;
			snippet: string;
			current: boolean;
		}> = [];
		for (const s of await sessionInfos()) {
			try {
				if (statSync(s.path).size > 20 * 1024 * 1024) continue; // 异常大文件跳过
				let snippet = "";
				for (const line of readFileSync(s.path, "utf8").split(/\r?\n/)) {
					if (!line.toLowerCase().includes(needle)) continue;
					try {
						const t = entryMsgText(JSON.parse(line));
						if (!t) continue;
						const flat = t.replace(/\s+/g, " ");
						const idx = flat.toLowerCase().indexOf(needle);
						if (idx < 0) continue;
						const start = Math.max(0, idx - 40);
						snippet = `${start > 0 ? "…" : ""}${flat.slice(start, idx + needle.length + 60)}…`;
						break;
					} catch {
						// 非 JSON 行跳过
					}
				}
				if (snippet) {
					out.push({
						path: s.path,
						...(s.name ? { name: s.name } : {}),
						firstMessage: s.firstMessage,
						modified: s.modified,
						messageCount: s.messageCount,
						snippet,
						current: s.current,
					});
				}
				if (out.length >= 20) break;
			} catch {
				// 单个会话读取失败不影响其余
			}
		}
		return out;
	},
	notify: (level, text) => broadcast({ type: "notify", level, text }),
	async ttsSpeak(text, caption) {
		const cfg = loadTtsConfig();
		if (!cfg) throw new Error(ttsConfigHint());
		const { buffer, ext } = await synthesizeSpeech(cfg, text);
		const saved = saveAudioBuffer(cwd, buffer, ext);
		const cap = (caption ?? text).trim().slice(0, 80);
		// 写入会话树为可展示 custom（刷新可回放）；短标记进 LLM 上下文可接受
		session.sessionManager.appendMessage({
			role: "custom",
			customType: "rp-audio",
			content: cap ? `〔配音〕${cap}` : "〔配音〕",
			display: true,
			details: { rpAudio: { src: saved.src, ...(cap ? { caption: cap } : {}) } },
			timestamp: Date.now(),
		} as never);
		const wireMsg = {
			channel: "audio" as const,
			text: cap,
			src: saved.src,
		};
		broadcast({ type: "message", message: wireMsg });
		return { src: saved.src, bytes: saved.bytes };
	},
};

// ---------- HTTP：REST /api/* + 托管 web/dist（存在时）+ 健康检查 ----------

const distDir = join(cwd, "web", "dist");
const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".avif": "image/avif",
	".ico": "image/x-icon",
	".webmanifest": "application/manifest+json",
	".manifest": "application/manifest+json",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".ogg": "audio/ogg",
	".m4a": "audio/mp4",
	".webm": "video/webm",
	".aac": "audio/aac",
	".flac": "audio/flac",
	".mp4": "video/mp4",
	".m4v": "video/mp4",
	".mov": "video/quicktime",
	".mkv": "video/x-matroska",
	".ogv": "video/ogg",
	".woff2": "font/woff2",
	".map": "application/json",
};

// ---------- 访问密码闸门（src/access.ts；设置面板「访问密码」区管理） ----------

let accessData: AccessData | null = loadAccess(cwd);
let accessFails = 0; // 连续失败计数：≥5 次后每次登录尝试强制延迟

function requestAuthed(req: IncomingMessage): boolean {
	if (!accessData) return true;
	return verifyToken(accessData, parseCookies(req.headers.cookie)[ACCESS_COOKIE]);
}

/** 需过闸的路径：业务 API 与用户数据托管；静态前端壳放行（登录页就在壳里） */
function accessGuarded(url: string): boolean {
	if (url.startsWith("/api/")) return !url.startsWith("/api/access/");
	return url.startsWith("/media/") || url.startsWith("/audio/") || url.startsWith("/uploads/");
}

function setAccessCookie(res: ServerResponse, token: string | null): void {
	const base = `${ACCESS_COOKIE}=${token ?? ""}; Path=/; HttpOnly; SameSite=Strict`;
	res.setHeader("set-cookie", token ? `${base}; Max-Age=31536000` : `${base}; Max-Age=0`);
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (c: Buffer) => {
			size += c.length;
			if (size > 65536) {
				reject(new Error("body 过大"));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on("end", () => {
			try {
				resolve(chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>) : {});
			} catch (e) {
				reject(e as Error);
			}
		});
		req.on("error", reject);
	});
}

async function handleAccessApi(req: IncomingMessage, res: ServerResponse, url: string): Promise<void> {
	const json = (code: number, body: unknown, token?: string | null) => {
		if (token !== undefined) setAccessCookie(res, token);
		res.writeHead(code, { "content-type": "application/json" });
		res.end(JSON.stringify(body));
	};
	try {
		if (req.method === "GET" && url === "/api/access/status") {
			json(200, { required: !!accessData, ok: requestAuthed(req) });
			return;
		}
		if (req.method === "POST" && url === "/api/access/login") {
			if (!accessData) {
				json(400, { error: "未设置访问密码" });
				return;
			}
			if (accessFails >= 5) await new Promise((r) => setTimeout(r, 1500)); // 暴力尝试限速
			const body = await readJsonBody(req);
			if (typeof body.password === "string" && verifyPassword(accessData, body.password)) {
				accessFails = 0;
				json(200, { ok: true }, issueToken(cwd, accessData));
			} else {
				accessFails++;
				json(401, { error: "密码不正确" });
			}
			return;
		}
		if (req.method === "POST" && url === "/api/access/set") {
			const body = await readJsonBody(req);
			// 已有密码时，任何变更（改/关）都必须先验旧密码
			if (accessData && (typeof body.oldPassword !== "string" || !verifyPassword(accessData, body.oldPassword))) {
				json(403, { error: "当前密码不正确" });
				return;
			}
			const next = typeof body.newPassword === "string" ? body.newPassword : "";
			if (!next) {
				clearPassword(cwd);
				accessData = null;
				json(200, { required: false }, null);
				return;
			}
			if (next.length < 4) {
				json(400, { error: "密码至少 4 位" });
				return;
			}
			const r = setPassword(cwd, next);
			accessData = r.data;
			accessFails = 0;
			json(200, { required: true }, r.token); // 旧 token 全部失效；当前设备用新 token 续座
			return;
		}
		if (req.method === "POST" && url === "/api/access/logout") {
			if (accessData) revokeToken(cwd, accessData, parseCookies(req.headers.cookie)[ACCESS_COOKIE]);
			json(200, { ok: true }, null);
			return;
		}
		json(404, { error: "unknown access endpoint" });
	} catch (e) {
		json(400, { error: (e as Error).message });
	}
}

const httpServer = createServer((req, res) => {
	void (async () => {
		const urlPath = (req.url ?? "/").split("?")[0];
		if (urlPath.startsWith("/api/access/")) {
			await handleAccessApi(req, res, urlPath);
			return;
		}
		if (accessGuarded(urlPath) && !requestAuthed(req)) {
			res.writeHead(401, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "需要登录" }));
			return;
		}
		if (await handleApiRequest(req, res, restHost)) return;
		const url = (req.url ?? "/").split("?")[0];
		if (url === "/healthz") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true, sessionId: session.sessionId, char: names.charName }));
			return;
		}
		// 图片通道媒体托管（show_image → .liyuan-media/）
		if (url.startsWith("/media/")) {
			const mediaDir = dir(cwd, "media");
			const rel = normalize(url.slice("/media/".length)).replace(/^([/\\.])+/, "");
			const file = join(mediaDir, rel);
			if (file.startsWith(mediaDir) && existsSync(file)) {
				res.writeHead(200, {
					"content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
					"cache-control": "public, max-age=31536000, immutable", // 内容寻址文件名，可永久缓存
				});
				res.end(readFileSync(file));
			} else {
				res.writeHead(404);
				res.end();
			}
			return;
		}
		// 音频通道（show_audio / tts → .liyuan-audio/）
		if (url.startsWith("/audio/")) {
			const audioDir = dir(cwd, "audio");
			const rel = normalize(url.slice("/audio/".length)).replace(/^([/\\.])+/, "");
			const file = join(audioDir, rel);
			if (file.startsWith(audioDir) && existsSync(file)) {
				res.writeHead(200, {
					"content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
					"cache-control": "public, max-age=31536000, immutable",
				});
				res.end(readFileSync(file));
			} else {
				res.writeHead(404);
				res.end();
			}
			return;
		}
		// 上传区托管（.liyuan-uploads/）
		if (url.startsWith("/uploads/")) {
			const upDir = dir(cwd, "uploads");
			let rel = "";
			try {
				rel = normalize(decodeURIComponent(url.slice("/uploads/".length))).replace(/^([/\\.])+/, "");
			} catch {
				// 畸形百分号编码：按 404 处理
			}
			const file = rel ? join(upDir, rel) : "";
			if (file.startsWith(upDir) && existsSync(file)) {
				res.writeHead(200, {
					"content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
					"cache-control": "public, max-age=86400",
					"content-security-policy": "default-src 'none'",
					"x-content-type-options": "nosniff",
				});
				res.end(readFileSync(file));
			} else {
				res.writeHead(404);
				res.end();
			}
			return;
		}
		if (!existsSync(distDir)) {
			res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
			res.end("梨园 server 运行中。前端尚未构建：开发用 `npm --prefix web run dev`，或 `npm --prefix web run build` 后刷新本页。WS 端点：/ws");
			return;
		}
		// 静态文件（含 SPA 回退），normalize 防目录穿越
		const rel = normalize(url === "/" ? "/index.html" : url).replace(/^([/\\])+/, "");
		let file = join(distDir, rel);
		if (!file.startsWith(distDir) || !existsSync(file)) file = join(distDir, "index.html");
		try {
			const body = readFileSync(file);
			const ext = extname(file).toLowerCase();
			const headers: Record<string, string> = {
				"content-type": MIME[ext] ?? "application/octet-stream",
			};
			// 品牌图 / 壳资源：可缓存（SW 会再管一层）
			if (
				ext === ".png" ||
				ext === ".webmanifest" ||
				ext === ".js" ||
				ext === ".css" ||
				ext === ".woff2" ||
				file.endsWith(`${"sw.js"}`) ||
				file.endsWith("site.webmanifest")
			) {
				const name = file.replace(/\\/g, "/");
				if (name.includes("/assets/")) {
					headers["cache-control"] = "public, max-age=31536000, immutable";
				} else if (name.endsWith("/sw.js")) {
					headers["cache-control"] = "no-cache";
				} else {
					headers["cache-control"] = "public, max-age=86400";
				}
			}
			res.writeHead(200, headers);
			res.end(body);
		} catch {
			res.writeHead(404);
			res.end();
		}
	})().catch((err) => {
		if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
	});
});

// ---------- WS 端点 ----------

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

/** 当前轮是否戏外轮（用户输入带场外标记；决定助手回复的显示通道） */
let backstageTurn = false;

/** 发送用户输入（含斜杠命令；命令后全量对齐所有端） */
const handlePrompt = async (text: string) => {
	const trimmed = text.trim();
	// ST 式变体：无参 /reroll 与 /swipe 由宿主处理（需 agent.continue，扩展命令上下文无此能力）
	if (/^\/reroll\s*$/i.test(trimmed)) {
		if (session.isStreaming) {
			broadcast({ type: "notify", level: "warning", text: "请等当前回复完成（或先停止），再重新生成" });
			return;
		}
		await regenerateSwipe();
		return;
	}
	// 开场白切换：宿主层处理，保证「同一条替换」而非叠楼
	const greetingMatch = /^\/greeting(?:\s+(.*))?$/i.exec(trimmed);
	if (greetingMatch) {
		if (session.isStreaming) {
			broadcast({ type: "notify", level: "warning", text: "请等当前回复完成（或先停止），再切换开场白" });
			return;
		}
		await hostSwitchGreeting(greetingMatch[1] ?? "");
		return;
	}
	const swipeMatch = /^\/swipe(?:\s+(prev|next|new))?\s*$/i.exec(trimmed);
	if (swipeMatch) {
		if (session.isStreaming) {
			broadcast({ type: "notify", level: "warning", text: "请等当前回复完成（或先停止），再切换变体" });
			return;
		}
		const dir = (swipeMatch[1]?.toLowerCase() ?? "next") as "prev" | "next" | "new";
		await handleSwipe(dir);
		return;
	}
	// /compact：pi 在 TUI 层拦截，SDK prompt 不会当命令执行。Web/API/补全统一在此走 session.compact。
	// compaction_end 事件会 resyncAll；失败时用 notify 回传（session too small / Already compacted 等）。
	const compactMatch = /^\/compact(?:\s+(.*))?$/i.exec(trimmed);
	if (compactMatch) {
		if (session.isStreaming) {
			broadcast({ type: "notify", level: "warning", text: "请等当前回复完成（或先停止），再压缩上下文" });
			return;
		}
		if (session.isCompacting) return;
		const custom = compactMatch[1]?.trim();
		try {
			await session.compact(custom || undefined);
		} catch (err) {
			broadcast({
				type: "notify",
				level: "error",
				text: err instanceof Error ? err.message : String(err),
			});
		}
		return;
	}

	const backstage = isBackstageText(trimmed);
	const isCommand = trimmed.startsWith("/") && !backstage;
	if (!isCommand) {
		backstageTurn = backstage;
		broadcast({
			type: "message",
			message: { channel: "user", name: names.userName, text: trimmed, ...(backstage ? { backstage: true } : {}) },
		});
	}
	// 流式中送达的用户输入排队到本轮结束（RP 语境：不打断正在进行的叙事）
	await session.prompt(trimmed, session.isStreaming ? { streamingBehavior: "followUp" } : undefined);
	// 斜杠命令可能改写历史（/rewind /reroll /import）或注入消息：全量对齐
	if (isCommand) resyncAll();
};

/** 流式中禁止的操作统一挡下 */
const refuseWhileStreaming = (ws: WebSocket, what: string): boolean => {
	if (!session.isStreaming) return false;
	ws.send(JSON.stringify({ type: "notify", level: "warning", text: `请等当前回复完成（或先停止），再${what}` } satisfies ServerFrame));
	return true;
};

// ---------- 会话-卡绑定（PLAN-PHASE3 §2.1）：读文件头解析 rp-card，mtime 缓存 ----------

const cardCache = new Map<string, { mtimeMs: number; info: { card: string; name: string } | null }>();

const readSessionCard = (path: string, mtimeMs: number): { card: string; name: string } | null => {
	const cached = cardCache.get(path);
	if (cached && cached.mtimeMs === mtimeMs) return cached.info;
	let info: { card: string; name: string } | null = null;
	try {
		// 取最后一条 rp-card：头 64KB + 尾 64KB（换卡后新标记 append 在文件末尾）
		const size = statSync(path).size;
		const fd = openSync(path, "r");
		try {
			const headLen = Math.min(size, 65536);
			const headBuf = Buffer.alloc(headLen);
			readSync(fd, headBuf, 0, headLen, 0);
			let text = headBuf.toString("utf8");
			if (size > 65536) {
				const tailLen = Math.min(size - headLen, 65536);
				const tailBuf = Buffer.alloc(tailLen);
				readSync(fd, tailBuf, 0, tailLen, size - tailLen);
				text += "\n" + tailBuf.toString("utf8");
			}
			info = parseCardFromSessionHead(text);
		} finally {
			closeSync(fd);
		}
	} catch {
		info = null;
	}
	cardCache.set(path, { mtimeMs, info });
	return info;
};

/** 会话路径是否为当前打开（Windows 路径大小写/斜杠差异时 path=== 会失败） */
const isSameSessionPath = (a: string | undefined, b: string | undefined): boolean => {
	if (!a || !b) return false;
	const n = (p: string) => normalize(p).replace(/\\/g, "/").toLowerCase();
	return n(a) === n(b);
};

/**
 * 仅列**当前角色卡**下的会话（全部对话按卡绑定，不再有「未标记」分组）。
 * - 有 rp-card 且路径=当前卡 → 列出
 * - 其他卡 → 隐藏
 * - 无标记：不列入（session_start 会补写）
 * - 当前打开的会话：按 sessionId / 路径始终列出并标 current（新建后列表必须立刻有「当前会话」）
 */
const sessionInfos = async () => {
	const all = await SessionManager.list(cwd);
	const curFile = session.sessionFile;
	const curId = session.sessionId;
	const list: Array<{
		path: string;
		id: string;
		name?: string;
		firstMessage: string;
		modified: number;
		messageCount: number;
		current: boolean;
		preview?: string;
		cardName: string;
	}> = [];
	for (const s of all) {
		const mtime = s.modified instanceof Date ? s.modified.getTime() : Number(s.modified) || 0;
		// 新建后 mtime 刚变：清掉可能过期的卡缓存再读
		if (cardCache.has(s.path)) {
			const c = cardCache.get(s.path)!;
			if (c.mtimeMs !== mtime) cardCache.delete(s.path);
		}
		const info = readSessionCard(s.path, mtime);
		const isCurrent = s.id === curId || isSameSessionPath(s.path, curFile);
		if (info && info.card !== cardPath && !isCurrent) continue; // 其他卡
		if (!info && !isCurrent) continue; // 无卡标记且非当前
		const preview = readSessionPreview(s.path, mtime);
		list.push({
			path: s.path,
			id: s.id,
			...(s.name ? { name: s.name } : {}),
			firstMessage: s.firstMessage,
			modified: mtime,
			messageCount: s.messageCount,
			current: isCurrent,
			...(preview ? { preview } : {}),
			cardName: info?.name || names.charName,
		});
	}
	// 兜底：列表里没有任何 current，但进程确有打开会话 → 按 id/路径补一条
	if (curId && !list.some((x) => x.current)) {
		const mine = all.find((s) => s.id === curId || isSameSessionPath(s.path, curFile));
		if (mine) {
			const mtime = mine.modified instanceof Date ? mine.modified.getTime() : Number(mine.modified) || 0;
			const info = readSessionCard(mine.path, mtime);
			const preview = readSessionPreview(mine.path, mtime);
			const existing = list.find((x) => x.id === mine.id || isSameSessionPath(x.path, mine.path));
			if (existing) {
				existing.current = true;
			} else {
				list.push({
					path: mine.path,
					id: mine.id,
					...(mine.name ? { name: mine.name } : {}),
					firstMessage: mine.firstMessage,
					modified: mtime,
					messageCount: mine.messageCount,
					current: true,
					...(preview ? { preview } : {}),
					cardName: info?.name || names.charName,
				});
			}
		}
	}
	list.sort((a, b) => b.modified - a.modified);
	return list;
};

const listSessions = async (): Promise<ServerFrame> => ({ type: "sessions", list: await sessionInfos() });

// ---------- 会话文件辅助（预览/重命名/删除/搜索——面板重做 PLAN-PANELS §2.1） ----------

/** 读文件尾部若干字节（末条消息预览用；大会话不整读） */
const readFileTail = (path: string, bytes = 65536): string => {
	const fd = openSync(path, "r");
	try {
		const size = statSync(path).size;
		const start = Math.max(0, size - bytes);
		const buf = Buffer.alloc(size - start);
		const n = readSync(fd, buf, 0, buf.length, start);
		return buf.toString("utf8", 0, n);
	} finally {
		closeSync(fd);
	}
};

/** 从会话条目提取正文文本（user/assistant 消息；其余条目返回 null） */
const entryMsgText = (entry: unknown): string | null => {
	const e = entry as { message?: unknown; role?: unknown; content?: unknown } | null;
	const m = (e?.message ?? e) as { role?: unknown; content?: unknown } | null;
	if (!m || (m.role !== "assistant" && m.role !== "user")) return null;
	if (typeof m.content === "string") return m.content;
	if (Array.isArray(m.content)) {
		const t = m.content
			.map((p) => (p && typeof p === "object" && (p as { type?: unknown }).type === "text" ? String((p as { text?: unknown }).text ?? "") : ""))
			.filter(Boolean)
			.join(" ");
		return t || null;
	}
	return null;
};

const previewCache = new Map<string, { mtimeMs: number; text: string }>();

/** 末条消息预览（ST 过去聊天信息密度，借鉴项）：尾部扫描最后一条 user/assistant 正文 */
const readSessionPreview = (path: string, mtimeMs: number): string => {
	const cached = previewCache.get(path);
	if (cached && cached.mtimeMs === mtimeMs) return cached.text;
	let text = "";
	try {
		const lines = readFileTail(path).split(/\r?\n/);
		for (let i = lines.length - 1; i >= 0; i--) {
			const line = lines[i].trim();
			if (!line) continue;
			try {
				const t = entryMsgText(JSON.parse(line));
				if (t?.trim()) {
					text = t.replace(/\s+/g, " ").trim().slice(0, 80);
					break;
				}
			} catch {
				// 尾部截断的半行：跳过
			}
		}
	} catch {
		// 文件读取失败：无预览
	}
	previewCache.set(path, { mtimeMs, text });
	return text;
};

/** 校验路径确属本项目会话清单（所有会话文件操作的门），返回清单项 */
const assertListedSession = async (path: string) => {
	const all = await SessionManager.list(cwd);
	const found = all.find((s) => s.path === path);
	if (!found) throw new Error("不是本项目的会话文件");
	return found;
};

wss.on("connection", (ws, req) => {
	// 访问密码闸门：WS 与 REST 同一套 Cookie 凭据
	if (!requestAuthed(req)) {
		ws.close(4401, "unauthorized");
		return;
	}
	clients.add(ws);
	ws.send(JSON.stringify(helloFrame()));
	if (session.isStreaming) ws.send(JSON.stringify({ type: "agent", state: "start" } satisfies ServerFrame));
	// 断线重连 / 新端接入：补发当前挂起的决策询问（未决卡不随 hello 历史走）
	for (const [id, p] of pendingChoices) ws.send(JSON.stringify(choiceFrame(id, p)));

	ws.on("message", (data) => {
		void (async () => {
			let frame: ClientFrame;
			try {
				frame = JSON.parse(String(data)) as ClientFrame;
			} catch {
				return;
			}
			try {
				switch (frame.type) {
					case "prompt": {
						const text = String(frame.text ?? "").trim();
						if (text) await handlePrompt(text);
						break;
					}
					case "abort":
						await session.abort();
						break;
					case "reroll": {
						if (refuseWhileStreaming(ws, "重新生成")) return;
						const t = String(frame.text ?? "").trim();
						// 无参 = ST sibling 变体；有参 = 改用户文案后整轮重来（扩展 /reroll）
						await handlePrompt(t ? `/reroll ${t}` : "/reroll");
						break;
					}
					case "swipe": {
						if (refuseWhileStreaming(ws, "切换回复变体")) return;
						const dir = frame.dir === "prev" || frame.dir === "next" || frame.dir === "new" ? frame.dir : "next";
						await handleSwipe(dir);
						break;
					}
					case "compact":
						if (refuseWhileStreaming(ws, "压缩上下文")) return;
						if (session.isCompacting) return;
						await session.compact();
						break;
					case "sessions":
						ws.send(JSON.stringify(await listSessions()));
						break;
					case "open": {
						if (refuseWhileStreaming(ws, "切换会话")) return;
						const path = String(frame.path ?? "");
						if (!path || path === session.sessionFile) return;
						await runtime.switchSession(path);
						broadcast({ type: "notify", level: "info", text: "已切换会话" });
						break;
					}
					case "new":
						if (refuseWhileStreaming(ws, "新建会话")) return;
						await runtime.newSession();
						broadcast({ type: "notify", level: "info", text: "已新建会话" });
						break;
					case "choice_reply": {
						const id = String(frame.id ?? "");
						if (!pendingChoices.has(id)) return; // 已被他端应答/超时收敛
						if (frame.stop) {
							// 停止本回合：先收敛留痕（防重入），再中止当前生成，笔还给用户
							settleChoice(id, { stop: true });
							await session.abort();
						} else {
							const value = String(frame.value ?? "").trim();
							if (!value) return; // 空应答忽略，卡片保持未决
							settleChoice(id, { value });
						}
						break;
					}
				}
			} catch (err) {
				broadcast({ type: "error", text: err instanceof Error ? err.message : String(err) });
			}
		})();
	});

	ws.on("close", () => clients.delete(ws));
	ws.on("error", () => clients.delete(ws));
});

// ---------- 启动 ----------

httpServer.listen(PORT, HOST, () => {
	const urls = [`http://localhost:${PORT}`];
	if (HOST === "0.0.0.0") {
		for (const list of Object.values(networkInterfaces())) {
			for (const ni of list ?? []) {
				if (ni.family === "IPv4" && !ni.internal) urls.push(`http://${ni.address}:${PORT}`);
			}
		}
	}
	console.log(`[liyuan] ${names.charName} 已就位（会话 ${session.sessionId.slice(0, 8)}…）`);
	console.log(`[liyuan] agent 目录 ${agentHome}`);
	for (const line of takeAgentMergeLog()) {
		console.log(`[liyuan] 迁移 ${line}`);
	}
	console.log(`[liyuan] ${urls.join("  |  ")}（手机连同一 Wi-Fi 访问后者；勿暴露公网）`);
});

const shutdown = async () => {
	try {
		unsubscribe?.();
		for (const ws of clients) ws.close();
		wss.close();
		httpServer.close();
		await runtime.dispose();
	} finally {
		process.exit(0);
	}
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
