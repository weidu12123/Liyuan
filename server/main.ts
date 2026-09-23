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

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, unlinkSync, watch, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { basename, dirname, extname, isAbsolute, join, normalize, relative } from "node:path";
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
import { findModelEntry, loadAgentConfig, normalizeAgentConfig, syncAgentConfigToRuntime } from "../src/agent-config.ts";
import { loadCardFile, readCardRawJson, updateCardFields } from "../src/card.ts";
import { applyMacros } from "../src/card-macros.ts";
import { prepareDisplayText } from "../src/postprocess.ts";
import { findInitVar, findSchemaDefaults, seedMvuIfNeeded } from "../src/mvu.ts";
import { authorScriptManifest, extractAuthorScripts } from "../src/authorScripts.ts";
import { buildGreeting } from "../src/greeting.ts";
import { StageEngine, type AssistantMsgLike, type StageModelLike, type StageStreamFn } from "../src/stage/engine.ts";
import { displayConversationBranch, storyBranch, messageMode, isConversationMode } from "../src/conversation-mode.ts";
import { cardProjectOperation, previewCardProject } from "../src/card-authoring.ts";
import { buildCardPreviewRequest, CardPreviewHub } from "./card-preview.ts";
import { ScreenshotHub, type ScreenshotReport } from "./screenshot.ts";
import { stateFromBranch, type BranchEntryLike } from "../src/stage/assemble.ts";
import {
	activePanels,
	closePanel as closePanelInMap,
	loadPanels,
	savePanels,
	writePanel,
} from "../src/panels.ts";
import {
	DIRS,
	dir,
	migrateLegacyLayout,
	preferLiyuanAgentHome,
	seedBuiltinSkills,
	seedStageSystemPrompt,
	resolveConfigPath,
	takeAgentMergeLog,
} from "../src/paths.ts";
import { applyPatch, loadState, saveState } from "../src/state.ts";
import { DEFAULT_CONFIG, type RpConfig, type WorldState } from "../src/types.ts";
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
	flattenWorldlineSaves,
	latestSaveOnBranch,
	loadWorldlineMeta,
	planNewSave,
	renameWorldline as renameWorldlineMeta,
	RP_SAVE_TYPE,
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
import {
	memoryArchiveCompacted,
	memoryDeleteChunk,
	memoryListChunks,
	memoryManualAdd,
	memoryRecallForTurn,
	memorySearch,
	memorySearchReport,
	memoryReadChunk,
	onNarrativeTurnEnd,
} from "../src/memory/index.ts";
import {
	createLorebookWithEntry,
	createCardFile,
	currentCardPath,
	deleteLoreEntryAnywhere,
	handleApiRequest,
	loadCardFrontSnapshot,
	loadConfig,
	loadMergedLoreMarked,
	lorebookShelf,
	loreWriteTargets,
	patchLoreEntryAnywhere,
	setLorebookMounted,
	syncCardFiles,
	thinkingLevelOfEntry,
	writeMaybeGzip,
	type CurrentModelInfo,
	type PresetSyncResult,
	type RestHost,
} from "./rest.ts";

// 用户级 agent 目录 → ~/.liyuan/agent（须在 getAgentDir / 建会话之前）
// 并合并 fork 改名后遗留的 ~/.pi/agent（会话/配置，不覆盖更新的新树）
const agentHome = preferLiyuanAgentHome();
import {
	isBackstageText,
	skinAtDepth,
	summarizeToolResult,
	toWireHistory,
	toWireMsg,
	type ClientFrame,
	type ServerFrame,
	type WireNames,
	type WireStats,
	type WireStoryFile,
	type WireCheckpoint,
} from "./wire.ts";
import { chapterTitle, listStoryFiles, STORY_CHECKPOINT_TYPE, StoryHistory, storyDirectory, type Checkpoint } from "../src/stage/story-history.ts";
import { sameCardPath } from "../src/paths.ts";
import { readSessionCardInfo } from "../src/session-scan.ts";
import { t } from "../src/i18n/index.ts";
import { cardDirOfChatDir, cardFileIn, chatDataPath, chatDirOfSessionDir, createChat, loadCardConfig, mergeCardConfig, resolveCardSpace } from "../src/cardspace.ts";
import { chatSessionsOf, chatsOfCard, ensureStorySessionDir, newChatSessionDir, storySessionTarget } from "../src/story-guide.ts";
import { syncCardMemory } from "../src/card-memory.ts";
import { alreadyMigrated, applyCardMigration, planCardMigration, planOrphanSessions, promoteStagedCard } from "../src/migrate-cards.ts";
import {
	appendLorebookFileEntry,
	appendOverlayEntry,
	overlayPathFor,
	toggleDisabledLore,
} from "../src/lorebook.ts";
import { syncStoryPanelsFromDisk, syncStoryStateFromDisk } from "../src/story-sync.ts";
import { applyPendingBackupRestore, BACKUP_ROOT, buildBackupZip, projectSessionDir } from "../src/backup.ts";
import { fileChangeOf, toolStartDetail } from "../src/activity-format.ts";
import {
	checkLatestRelease,
	downloadAndStage,
	discardPendingUpdate,
	readPendingUpdate,
	type UpdateCheckResult,
} from "../src/update.ts";
import type { UpdateWire } from "./wire.ts";
import {
	defaultSessionEnabledIds,
	getMcpHub,
	RP_MCP_TYPE,
} from "../src/mcp.ts";
import { mcpEnabledFromBranch } from "../src/stage/mcp-stage.ts";

const cwd = process.cwd();
// 桌面版（docs/PLAN-DESKTOP.md §四）：cwd＝数据根（用户可见、可写），产品根只读、
// 经 LIYUAN_PRODUCT_ROOT 告知；源码包两者同一，行为不变。
const productRoot = process.env.LIYUAN_PRODUCT_ROOT ?? cwd;
// 扮演骨架播种（刀1，docs/PLAN-AGENT-SLOTS.md §七）：首次启动把随包的
// assets/SYSTEM.md 落到 <agentDir>/SYSTEM.md；已存在不覆盖——改了就是用户的。
seedStageSystemPrompt(cwd, agentHome);
seedBuiltinSkills(cwd);
const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 7620);
const newSessionFlag = process.argv.includes("--new");

// 数据目录/配置文件：.rp-* → .liyuan-*，rp.config.json → liyuan.config.json
for (const line of migrateLegacyLayout(cwd)) {
	console.log(`[liyuan] 迁移 ${line}`); // i18n-ignore：终端日志
}

// 待恢复备份（导入备份后重启触发）：在装载任何会话/素材之前精确铺回数据
for (const line of applyPendingBackupRestore(cwd, agentHome)) {
	console.log(`[liyuan] 恢复 ${line}`); // i18n-ignore：终端日志
}

// 卡＝工作空间一次性迁移（刀4 尾巴）：旧扁平布局 → cards/ 两层布局。
// plan 只读 → apply 动盘；幂等（cards/ 已在/搬过的不再搬），认不出卡的会话原地不动。
// 先备份再跑：备份与恢复机制就是这份迁移的兜底（backup.ts 闭包含全部用户数据）。
if (!alreadyMigrated(cwd)) {
	const plan = planCardMigration(cwd, projectSessionDir(cwd, agentHome));
	if (plan.cards.length > 0 || plan.sessions.length > 0) {
		try {
			const snap = join(cwd, BACKUP_ROOT, `pre-cards-migration-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`);
			const { count } = buildBackupZip(cwd, agentHome, snap);
			console.log(`[liyuan] 迁移前快照：${count} 项 → ${basename(snap)}`); // i18n-ignore：终端日志
		} catch (err) {
			console.error(`[liyuan] 迁移前快照失败，跳过迁移：${err instanceof Error ? err.message : String(err)}`); // i18n-ignore：终端日志
		}
		if (!alreadyMigrated(cwd)) {
			for (const line of applyCardMigration(cwd, plan)) console.log(`[liyuan] 卡迁移 ${line}`); // i18n-ignore：终端日志
		}
	}
}

// 当前卡若还住在导入暂存（assets/cards/）：每次开机都补一次升格。
// 整树迁移只在首启跑一次；而「导入 / 新建」落暂存的卡可能恰好就是当前卡——
// 此时切换路径上的升格保护不生效（不许动开着的会话），开机这一刀是它唯一的自愈点
// （此刻尚未创建任何会话，搬文件安全）。
{
	const cur = loadConfig(cwd).card ?? "";
	if (cur) {
		try {
			const promoted = promoteStagedCard(cwd, projectSessionDir(cwd, agentHome), cur);
			if (promoted) console.log(`[liyuan] 卡迁移 当前卡升格：${cur} → ${promoted}`); // i18n-ignore：终端日志
		} catch (err) {
			console.error(`[liyuan] 当前卡升格失败：${err instanceof Error ? err.message : String(err)}`); // i18n-ignore：终端日志
		}
	}
}

// 收散：扁平会话目录里指向已有卡空间的会话（卡空间化之后才生成的），搬回卡里。
// 不收回来的话，它既不属于这张卡、项目树里也永远不出现。幂等，通常无事可做。
{
	try {
		const strays = planOrphanSessions(cwd, projectSessionDir(cwd, agentHome));
		if (strays.length > 0) {
			for (const line of applyCardMigration(cwd, { cards: [], sessions: strays, skipped: [] })) {
				console.log(`[liyuan] 卡迁移 ${line}`); // i18n-ignore：终端日志
			}
		}
	} catch (err) {
		console.error(`[liyuan] 收散会话失败：${err instanceof Error ? err.message : String(err)}`); // i18n-ignore：终端日志
	}
}

// 自操作接口（LIYUAN_HTTP → 剧情 system prompt）已退役（2026-07-14）：剧情模型不再 curl 自家 API。
// 曾接手它的右栏「助手」也已于 2026-09-12 删除——要动配置/文件走主会话工作模式。

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

const names: WireNames = { charName: "角色", userName: "用户" }; // i18n-ignore：模块顶层不翻，refreshNamesFromConfig 启动即覆盖
/** 当前卡标识（liyuan.config.json 的 card 路径原文，会话过滤用） */
let cardPath = "";

/** 从项目配置刷新显示名与当前卡（启动时与每次配置写入/会话重载后调用） */
const refreshNamesFromConfig = () => {
	names.charName = t("角色");
	names.userName = t("用户");
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
		console.error(`[liyuan] 读取角色显示名失败（用占位名继续）：${err instanceof Error ? err.message : String(err)}`); // i18n-ignore：终端日志
	}
};
refreshNamesFromConfig();

// ---------- pi 会话宿主 ----------

const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
	const services = await createAgentSessionServices({
		cwd,
		// 刀1（PLAN-AGENT-SLOTS §一）：打开 pi 的上下文文件槽位后，应用根目录自己的
		// AGENTS.md/CLAUDE.md（开发者指令：铁律、src 索引、测试命令）会顺着 cwd 进
		// 扮演基座——那是给改梨园代码的 agent 看的，不是剧情素材。只滤应用根这一层；
		// 卡目录及用户自建的 AGENTS.md（刀3 的正主）照常继承。
		resourceLoaderOptions: {
			// 桌面版：cwd＝数据根，pi 按 cwd/.liyuan/extensions 扫不到产品扩展——经 pi 现成的
			// 显式路径通道指到产品根（roleplay.ts 的 ../../src 相对引用只在那一侧成立）。
			// 通道只认单个文件（目录语义是「包根」），照 stage 规则枚举 *.ts。
			...(productRoot !== cwd
				? {
						additionalExtensionPaths: existsSync(join(productRoot, ".liyuan", "extensions"))
							? readdirSync(join(productRoot, ".liyuan", "extensions"))
									.filter((f) => f.endsWith(".ts"))
									.map((f) => join(productRoot, ".liyuan", "extensions", f))
							: [],
					}
				: {}),
			agentsFilesOverride: (base) => ({
				agentsFiles: base.agentsFiles.filter((f) => {
					const rel = relative(cwd, f.path);
					return !(rel === "AGENTS.md" || rel === "CLAUDE.md" || rel === "AGENTS.override.md");
				}),
			}),
			// 刀2：用户规矩由 stage 每拍现读（materials 指纹缓存，改完下一拍生效）；
			// pi 原生的 APPEND_SYSTEM.md 发现是启动时缓存的，退出它＝单一主人=stage，不双份。
			appendSystemPromptOverride: () => [],
		},
	});
	return {
		...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
		services,
		diagnostics: services.diagnostics,
	};
};

// 刀4 引导：当前卡是 cards/ 卡文件夹 ⇒ 按两层布局定 sessionDir（最新子项目的会话目录）；
// 否则 undefined ⇒ pi 默认目录（老布局，行为与今天一致）。--new 仍表示「开局就要干净的」。
const bootGuide = storySessionTarget(cwd, cardPath);
// 卡空间还没有子项目（新导入/新升格、还没开聊的卡）：建第一个当落脚点——
// 没有它，首拍会话会落进 pi 的扁平默认目录（不属于这张卡、项目树也不出现）。
if (bootGuide.space && !bootGuide.sessionDir) {
	bootGuide.sessionDir = ensureStorySessionDir(cwd, cardPath) ?? undefined;
}
let runtime = await createAgentSessionRuntime(createRuntime, {
	cwd,
	agentDir: getAgentDir(),
	sessionManager:
		newSessionFlag || (bootGuide.sessionDir === undefined && !bootGuide.space)
			? SessionManager.create(cwd, bootGuide.sessionDir ?? undefined)
			: SessionManager.continueRecent(cwd, bootGuide.sessionDir ?? undefined),
});

let session: AgentSession = runtime.session;
let stage: StageEngine;
let unsubscribe: (() => void) | undefined;

// ---------- WS 广播 ----------

const clients = new Set<WebSocket>();
const wsAlive = new WeakMap<WebSocket, boolean>();
const wsPingTimer = setInterval(() => {
	for (const sock of clients) {
		if (sock.readyState !== sock.OPEN) continue;
		if (wsAlive.get(sock) === false) {
			sock.terminate();
			clients.delete(sock);
			continue;
		}
		wsAlive.set(sock, false);
		sock.ping();
	}
}, 20_000);
wsPingTimer.unref();
const broadcast = (frame: ServerFrame) => {
	const data = JSON.stringify(frame);
	for (const ws of clients) {
		if (ws.readyState === ws.OPEN) ws.send(data);
	}
};
/** agent 预览：广播请求并返回在线页面数（0 ＝ 没人能渲染） */
const cardPreviews = new CardPreviewHub((request) => {
	const frame = { type: "card_preview" as const, ...request };
	broadcast(frame);
	return [...clients].filter((ws) => ws.readyState === ws.OPEN).length;
});
/** agent 截图：广播请求，页面把渲染好的稿子截成 PNG 回报 */
const screenshots = new ScreenshotHub((request) => {
	broadcast({ type: "screenshot", ...request });
	return [...clients].filter((ws) => ws.readyState === ws.OPEN).length;
});

// ---------- 在线更新（主页 chip → 弹窗 → toast 进度；替换由启动脚本完成） ----------

const APP_VERSION: string = (() => {
	// 桌面版：数据根没有 package.json，版本取自产品根（源码包两根合一，先命中 cwd）
	for (const root of [cwd, productRoot]) {
		try {
			return (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0";
		} catch {
			/* 换下一个根 */
		}
	}
	return "0.0.0";
})();

let updateState: UpdateWire = { phase: "none", currentVersion: APP_VERSION };
let updateCheck: UpdateCheckResult | null = null;
let updateBusy = false;

const UPDATE_SUPERVISED = process.env.LIYUAN_SUPERVISED === "1";
/** Docker 部署：升级靠宿主机 git pull + rebuild，容器内不下载 zip（覆盖只写可写层、重建即丢） */
const IS_DOCKER = existsSync("/.dockerenv") || process.env.LIYUAN_DOCKER === "1";
/** 桌面版：升级走安装包，应用内 zip 更新没有启动脚本接盘（docs/PLAN-DESKTOP.md §四） */
const IS_DESKTOP = process.env.LIYUAN_DESKTOP === "1";
const pushUpdate = () =>
	broadcast({ type: "update", update: { ...updateState, supervised: UPDATE_SUPERVISED, dockerDeploy: IS_DOCKER, desktopDeploy: IS_DESKTOP } });

/** 启动后静默检查一次；失败不提示（manual 时才把 error 带给 UI） */
const runUpdateCheck = async (manual: boolean): Promise<void> => {
	// 已有暂存包：直接就绪态（跨重启持久；旧暂存版本低于当前版则丢弃）
	const pending = readPendingUpdate(cwd);
	if (pending) {
		if (IS_DOCKER || IS_DESKTOP || pending.version === APP_VERSION || pending.version < APP_VERSION) {
			discardPendingUpdate(cwd);
		} else {
			updateState = {
				phase: "ready",
				currentVersion: APP_VERSION,
				latestVersion: pending.version,
				verified: pending.verified,
			};
			pushUpdate();
			return;
		}
	}
	const r = await checkLatestRelease(APP_VERSION);
	updateCheck = r;
	if (r.error) {
		if (manual) {
			updateState = { ...updateState, phase: updateState.phase === "ready" ? "ready" : "none", error: r.error };
			pushUpdate();
		}
		return; // 静默降级：启动检查失败不打扰
	}
	if (r.hasUpdate && r.asset) {
		updateState = {
			phase: "available",
			currentVersion: APP_VERSION,
			latestVersion: r.latestVersion ?? undefined,
			releaseName: r.releaseName,
			releaseNotes: r.releaseNotes,
			releaseUrl: r.releaseUrl,
			publishedAt: r.publishedAt,
			assetSize: r.asset.size,
		};
	} else {
		updateState = { phase: "none", currentVersion: APP_VERSION, latestVersion: r.latestVersion ?? undefined };
	}
	pushUpdate();
};

/** 下载并暂存（进度限流 500ms 一帧）；完成后 ready，失败回 available 带 error */
const startUpdateDownload = async (mirror?: string): Promise<void> => {
	if (IS_DOCKER) throw new Error(t("Docker 部署请到宿主机执行 git pull && docker compose up -d --build"));
	if (IS_DESKTOP) throw new Error(t("桌面版请到 GitHub Releases 下载新版安装包"));
	if (updateBusy) throw new Error(t("已在下载中"));
	if (!updateCheck?.hasUpdate || !updateCheck.asset) throw new Error(t("没有可下载的更新"));
	updateBusy = true;
	const base = updateState;
	updateState = { ...base, phase: "downloading", received: 0, total: updateCheck.asset.size, error: undefined };
	pushUpdate();
	let lastPush = 0;
	try {
		const pending = await downloadAndStage({
			cwd,
			check: updateCheck,
			mirror,
			onProgress: (p) => {
				const now = Date.now();
				if (now - lastPush < 500) return;
				lastPush = now;
				updateState = { ...updateState, received: p.received, total: p.total || updateCheck?.asset?.size || 0 };
				pushUpdate();
			},
		});
		updateState = {
			phase: "ready",
			currentVersion: APP_VERSION,
			latestVersion: pending.version,
			releaseUrl: base.releaseUrl,
			verified: pending.verified,
		};
		pushUpdate();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		updateState = { ...base, phase: "available", error: msg };
		pushUpdate();
		throw new Error(t("下载更新失败：{msg}", { msg }));
	} finally {
		updateBusy = false;
	}
};

// 启动 3s 后后台静默检查（不卡启动、不打扰；失败无声）
setTimeout(() => void runUpdateCheck(false).catch(() => {}), 3000);

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

/**
 * 子项目级数据的落点：**一个子项目一份**（同一子项目里的多个会话看同一份账本／面板／世界线
 * ——那正是「在第二个会话窗口继续聊」的意思）。老布局（尚未迁移／内存会话）自动回落到
 * 今天按 sessionId 分文件的旧路径，分叉只在 src/cardspace.ts 的 chatDataPath 里那一处。
 */
const stateFileOf = (sessionId: string = session.sessionId) =>
	chatDataPath(cwd, session.sessionManager.getSessionDir(), sessionId, "state");
const panelsFileOf = (sessionId: string = session.sessionId) =>
	chatDataPath(cwd, session.sessionManager.getSessionDir(), sessionId, "panels");
const worldlineFileOf = (sessionId: string = session.sessionId) =>
	chatDataPath(cwd, session.sessionManager.getSessionDir(), sessionId, "worldline");

/**
 * 向量记忆的作用域：新布局落在子项目里（`<子项目>/向量记忆/`），一个子项目一份；
 * 老布局没有 chatDir ⇒ 仍按 `<卡hash>__<sessionId>` 落全局，行为不变。
 */
const memoryScopeFor = (sessionId: string = session.sessionId) => ({
	sessionId,
	card: cardPath || undefined,
	chatDir: chatDirOfSessionDir(session.sessionManager.getSessionDir()) ?? undefined,
});

/**
 * 落盘即推送的目录监听：落点随会话走，故换会话/换子项目时要重挂（rearm 由 bindSession 调）。
 * Windows 下同一次写可能触发多次事件，200ms 去抖。
 */
const makeDataWatcher = (kind: "state" | "panels", onHit: () => void) => {
	let watcher: ReturnType<typeof watch> | undefined;
	let armedDir = "";
	let armedFile = "";
	let timer: ReturnType<typeof setTimeout> | undefined;
	return {
		rearm() {
			const target = stateOrPanels(kind);
			const d = dirname(target);
			const f = basename(target);
			if (d === armedDir && f === armedFile && watcher) return;
			try {
				watcher?.close();
			} catch {
				/* 已失效的监听关不掉不影响重挂 */
			}
			watcher = undefined;
			armedDir = d;
			armedFile = f;
			try {
				mkdirSync(d, { recursive: true });
				watcher = watch(d, (_evt, filename) => {
					if (filename !== armedFile) return;
					clearTimeout(timer);
					timer = setTimeout(() => {
						try {
							onHit();
						} catch {
							// 读取竞态（写入未完成）：下次事件再推
						}
					}, 200);
				});
			} catch {
				watcher = undefined; // 目录还不存在等：下次 rearm 再试
			}
		},
	};
};
const stateOrPanels = (kind: "state" | "panels") => (kind === "state" ? stateFileOf() : panelsFileOf());
/**
 * 展示用账本。权威是会话树（R4：世界 = f(分支)）——swipe/rewind/切世界线后
 * 磁盘缓存仍是旧分支的账本，只有树快照能给出当前分支的正确值。
 * 树上无快照（未记账的新会话）时回落磁盘缓存：旧会话与导入建账都只有文件。
 *
 * MVU 卡：读出的 state 若还没建变量树（首拍/老会话，见 src/mvu.ts），从卡的初值声明懒建初始树
 * （世界书 `[initvar]` 优先，没有就退到卡自带脚本里 Zod schema 的 prefault），使状态栏面板与
 * 作者悬浮球在开局就有数据（之后由场记每拍推动）。按 cardPath 记忆卡料，避免每次读盘。
 */
/** 卡文件指纹：(mtime, size)。写卡应用、面板改卡、手工替换都会变——按路径 memo 会在应用后读到旧料（9/11 实弹：状态栏应用后挂载点永不补）。 */
const cardFingerprint = (abs: string): string => {
	try {
		const st = statSync(abs);
		return `${st.mtimeMs}:${st.size}`;
	} catch {
		return "missing";
	}
};
let mvuBookCache: { key: string; entries: Array<{ comment?: string; content?: string }> } | null = null;
const cardBookForMvu = (): Array<{ comment?: string; content?: string }> => {
	if (!cardPath) return [];
	const abs = isAbsolute(cardPath) ? cardPath : join(cwd, cardPath);
	const key = cardPath + "@" + cardFingerprint(abs);
	if (mvuBookCache?.key === key) return mvuBookCache.entries;
	try {
		const entries = loadCardFile(abs).book.map((e) => ({ comment: e.comment, content: e.content }));
		mvuBookCache = { key, entries };
		return entries;
	} catch {
		return [];
	}
};
/** 卡自带运行时脚本（初值第二形式的住处）；与卡书同一套 memo 纪律（指纹随卡文件失效） */
let mvuScriptCache: { key: string; scripts: Array<{ content?: string }> } | null = null;
const cardScriptsForMvu = (): Array<{ content?: string }> => {
	if (!cardPath) return [];
	const abs = isAbsolute(cardPath) ? cardPath : join(cwd, cardPath);
	const key = cardPath + "@" + cardFingerprint(abs);
	if (mvuScriptCache?.key === key) return mvuScriptCache.scripts;
	try {
		const scripts = extractAuthorScripts(readCardRawJson(abs).raw, "card");
		mvuScriptCache = { key, scripts };
		return scripts;
	} catch {
		return [];
	}
};
const currentState = (): WorldState => {
	const raw = ((): WorldState => {
		try {
			const branch = session.sessionManager.getBranch() as BranchEntryLike[];
			if (branch.some((e) => e.type === "custom" && e.customType === "rp-state")) {
				return stateFromBranch(branch);
			}
		} catch {
			// 树不可读（极早期生命周期）→ 磁盘缓存
		}
		return loadState(stateFileOf());
	})();
	return seedMvuIfNeeded(raw, cardBookForMvu(), names.userName, names.charName, cardScriptsForMvu()) as WorldState;
};

/**
 * 本卡的 MVU 变量树归梨园管吗——**判据必须与 seedMvuIfNeeded 的前提逐字同义**：
 * 卡有可解的初值声明（世界书 `[initvar]` 或卡自带脚本里的 Zod schema prefault）。
 * 两处判据一旦分家，就会出现「树建了但面板挂载点不补」这类只在某类卡上现形的怪毛病。
 * 归梨园管，梨园就要连 MVU 插件「回复后追加面板挂载点」那一步也一起干（src/mvu.ts）。
 * 按 cardPath memo：显示侧每条消息都要问一次，别重复解 YAML / 扫脚本。
 */
let mvuOwnedCache: { key: string; owned: boolean } | null = null;
const hasMvuTree = (): boolean => {
	if (!cardPath) return false;
	const key = cardPath + "@" + cardFingerprint(isAbsolute(cardPath) ? cardPath : join(cwd, cardPath));
	if (mvuOwnedCache?.key === key) return mvuOwnedCache.owned;
	const owned = findInitVar(cardBookForMvu()) !== null || findSchemaDefaults(cardScriptsForMvu()) !== null;
	mvuOwnedCache = { key, owned };
	return owned;
};

// 场记记账落盘即推送（PLAN-PHASE3 §4：fs.watch 目录级监听，零扩展改动）
const stateWatcher = makeDataWatcher("state", () => broadcast({ type: "state", state: currentState() }));

// agent 自建面板（柱 2）：与 state 同款——扩展落盘后 fs.watch 监听并推送活跃面板全量
// （panel_write/close 与 rewind 回退同一条路径）
const currentPanels = () => activePanels(loadPanels(panelsFileOf()));
const panelsWatcher = makeDataWatcher("panels", () => broadcast({ type: "panels", panels: currentPanels() }));

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

/**
 * reroll/编辑输入的「回退叶」：branch 前记录旧叶；生成失败或停止无产出时
 * 回退到它（8/05：reroll 链上停止，当前分支只剩 user、旧回复全部消失）。
 * onTurnEnd 消费后清空。
 */
let rerollFallbackLeaf: string | null = null;

/** 当前分支上最后一条剧情用户消息 entry id（戏外轮不计） */
const lastStoryUserId = (): string | null => {
	const branch = storyBranch(session.sessionManager.getBranch()) as unknown as Array<Record<string, unknown>>;
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
 * 当前分支上的节点 id 集合（向量记忆按分支隔离用，8/29）。
 *
 * 剧情库此前只按 {卡, 会话} 存：重roll/rewind 丢弃的那一拍照样入库，下一拍又被【剧情记忆】
 * 召回，模型把废弃分支当「上一拍」续写。树/账本/面板都是 f(分支)，这里给记忆补上同一坐标。
 * 取树失败返回空集——下游按「不判、放行」处理（宁可漏掉隔离，不可让记忆整体消失）。
 */
const branchNodeIds = (): Set<string> => {
	try {
		const out = new Set<string>();
		for (const e of storyBranch(session.sessionManager.getBranch()) as Array<{ id?: unknown }>) {
			if (typeof e?.id === "string" && e.id) out.add(e.id);
		}
		return out;
	} catch {
		return new Set<string>();
	}
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

/** 当前卡显示向皮肤（wire 上屏：先正则再 unwrap） */
const currentDisplaySkin = () => {
	try {
		const snap = loadCardFrontSnapshot(cwd);
		if (!snap.enabled || !snap.hasSkin || !snap.rules.length) return null;
		return {
			rules: snap.rules,
			charName: snap.charName || names.charName,
			userName: snap.userName || names.userName,
			// 树归梨园管 ⇒ 梨园在替 MVU 插件干活，那就连它「回复后追加面板挂载点」那一步也一起干
			// （src/mvu.ts mountMvuPanel）。没有树的卡（含全部非 MVU 卡）此位为 false，显示侧零变化。
			mvu: hasMvuTree(),
		};
	} catch {
		return null;
	}
};

/**
 * 会话树当前分支 → 显示层消息列表。
 * 台上引擎直接写树（R1 循环自持），AgentSession 的内存副本不再是权威——
 * 显示层一律以 SessionManager 分支为准（含 rp-greeting/rp-draft-op 等 custom_message）。
 */
const branchMessages = (): unknown[] => {
	let branch = session.sessionManager.getBranch();
	try { branch = applyDraftRevisions(branch); } catch { /* A broken draft receipt must not discard mode provenance. */ }
	const out: unknown[] = [];
	for (const e of displayConversationBranch(branch) as unknown as Array<Record<string, unknown>>) {
		if (e.type === "message" && e.message) out.push(e.message);
		else if (e.type === "custom_message") {
			// details 必须透传：开场白序号等元数据只存在于树条目上。
			out.push({ role: "custom", customType: e.customType, content: e.content, display: e.display, details: e.details });
		} else if (e.type === "custom" && e.customType === "rp-draft-revision") {
			const revision = e.data as { requestId?: string; version?: number } | undefined;
			if (revision?.requestId) out.push({ role: "custom", customType: "rp-draft-revision", content: t("上一拍已修订 · v{v}", { v: revision.version }), display: true });
		} else if (e.type === "custom" && e.customType === STORY_CHECKPOINT_TYPE) {
			// agent 模式：检查点在讨论区显示为「本轮改动」卡片（真相在 历史/检查点.jsonl，这只是树上的留痕）
			const cp = e.data as Omit<Checkpoint, "files"> | undefined;
			if (!cp?.id || !cp.changed) continue;
			out.push({ role: "custom", customType: STORY_CHECKPOINT_TYPE, display: true, content: cp.message, details: { checkpoint: toWireCheckpoint(cp) } });
		}
	}
	return out;
};

/** 用户手改的稿子文件名：稿子目录下的一个 .md，不带路径分隔与非法字符 */
const STORY_FILE_NAME_RE = /^[^\\/:*?"<>|]+\.md$/i;
const toWireCheckpoint = (c: Omit<Checkpoint, "files">): WireCheckpoint => ({
	id: c.id, ts: c.ts, author: c.author, message: c.message, changed: c.changed,
	...(c.turnId ? { turnId: c.turnId } : {}), ...(c.aborted ? { aborted: true } : {}), ...(c.restoredFrom ? { restoredFrom: c.restoredFrom } : {}),
});
/** agent 子项目目录（不是 agent 子项目＝undefined） */
const agentChatDir = (): string | undefined => {
	if (stage?.mode !== "agent") return undefined;
	return chatDirOfSessionDir(session.sessionManager.getSessionDir?.()) ?? undefined;
};
/** agent 子项目：稿子目录与检查点列表（hello 用，轻；正文与 diff 经 REST） */
const storyOutline = (): { files: WireStoryFile[]; checkpoints: WireCheckpoint[] } | undefined => {
	const chatDir = agentChatDir();
	if (!chatDir) return undefined;
	const files = listStoryFiles(storyDirectory(chatDir)).map((f) => ({ name: f.name, title: chapterTitle(f.name), chars: f.chars, mtime: f.mtime }));
	const checkpoints = new StoryHistory(chatDir).list().map(toWireCheckpoint);
	return { files, checkpoints };
};

const helloFrame = (): ServerFrame => {
	const workspace = stage?.getWorkspace();
	const cardfront = loadCardFrontSnapshot(cwd);
	const skin =
		cardfront.enabled && cardfront.hasSkin && cardfront.rules.length
			? {
					rules: cardfront.rules,
					charName: cardfront.charName || names.charName,
					userName: cardfront.userName || names.userName,
					// 同 currentDisplaySkin：树归梨园管就补挂面板挂载点。
					// 首屏这一路走 toWireHistory，由它按 depth 把非最新那些清掉。
					mvu: hasMvuTree(),
				}
			: null;
	/**
	 * hello 里**不带作者脚本正文，只带轻清单**。
	 *
	 * 显示规则必须与消息同帧（否则首屏 StatusBlock 会回落统一面板），脚本不然：它是页面级的，
	 * 晚一个往返出现完全不影响任何一条消息——酒馆那边也是聊天加载完才跑脚本。
	 * 而正文很重：实测一个预设自带的脚本 3.58MB。REST 那条路有 gzip（4.36MB→1.17MB），
	 * **hello 走 WebSocket 不压缩，且每次重放/回退都重发**——塞进 hello 就是每次 resync 白扛 4MB。
	 * 前端拿清单算指纹，只在换卡/换预设（指纹变了）时才去拉一次正文。
	 */
	const { scripts, ...cardfrontLite } = cardfront;
	return {
		type: "hello",
		uiLanguage: loadConfig(cwd).uiLanguage,
		sessionId: session.sessionId,
		charName: names.charName,
		userName: names.userName,
		messages: annotateSwipes(toWireHistory(branchMessages(), names, { skin })),
		state: currentState(),
		stats: safeStats(),
		panels: currentPanels(),
		workspace: workspace ? workspaceView(workspace) : undefined,
		streaming: stage?.isStreaming ?? false,
		conversationMode: stage?.mode ?? "roleplay",
		turnMode: stage?.turnMode,
		...(stage?.mode === "agent" ? { story: storyOutline() } : {}),
		// 一档皮肤与消息同帧:首屏不得依赖二次 REST(缓存/竞态会让 StatusBlock 回落统一面板)
		cardfront: { ...cardfrontLite, scriptManifest: authorScriptManifest(scripts) },
	};
};

/** 全量重放（斜杠命令 / 树导航 / 压缩后：让所有端与会话文件对齐） */
const resyncAll = () => broadcast(helloFrame());

const workspaceView = (workspace: TurnWorkspace) => {
	const { mediaDeliveries: _media, ...view } = workspace;
	return { ...view, revisions: workspace.revisions.map(({ text: _text, ...revision }) => revision) };
};

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
		broadcast({ type: "notify", level: "error", text: t("未配置角色卡") });
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
			text: t("角色卡装载失败：{msg}", { msg: err instanceof Error ? err.message : String(err) }),
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
		broadcast({ type: "notify", level: "error", text: t("本卡没有开场白") });
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
			broadcast({ type: "notify", level: "error", text: t("用法：/greeting [序号|next|prev]") });
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
			text: t("写入配置失败：{msg}", { msg: err instanceof Error ? err.message : String(err) }),
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
			text: t("已选定开场白 {i}/{n}，当前会话已开聊，下次新会话生效。", { i: displayOrdinal, n: displayTotal }),
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
			session.setLeaf(null);
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
	broadcast({ type: "notify", level: "info", text: t("已切换开场白 {i}/{n}", { i: displayOrdinal, n: displayTotal }) });
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
		broadcast({ type: "notify", level: "error", text: t("没有可重新生成的剧情轮（需要先有一条用户输入）") });
		return;
	}
	const sm = session.sessionManager;
	// 记录 reroll 前的叶：生成失败/停止无产出时回退到旧回复（8/05：reroll 链上停止，前版本全消失）
	rerollFallbackLeaf = sm.getLeafId();
	// 叶钉回 user：引擎在 user 下挂新的 assistant sibling（swipe 语义）。
	// 世界状态/历史均为 f(分支)（R3/R4），无需旧的 navigateTree 恢复舞蹈——
	// 废弃分支上的场记快照天然不在新分支上，账本不会泄漏（8/02 A 雷的结构性解法）。
	if (sm.getLeafId() !== userId) {
		session.setLeaf(userId);
	}
	// 展示层立刻去掉旧回复（只显示到 user）
	resyncAll();
	await stage.regenerate();
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
		broadcast({ type: "notify", level: "error", text: t("没有可切换的回复变体") });
		return;
	}
	const entries = swipeEntriesFromSession();
	const leafId = session.sessionManager.getLeafId();
	const variants = listReplyVariants(entries, userId, leafId);
	if (variants.length === 0) {
		// 尚无回复：next/new 等价生成
		if (dir === "next") await regenerateSwipe();
		else broadcast({ type: "notify", level: "info", text: t("还没有角色回复可切换") });
		return;
	}
	const meta = swipeMetaForUser(entries, userId, leafId);
	const idx = meta?.index ?? 0;
	if (dir === "prev") {
		if (idx <= 0) {
			broadcast({ type: "notify", level: "info", text: t("已经是第一条变体") });
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
	setTheme: () => ({ success: false, error: "Web 模式不支持主题切换" }), // i18n-ignore：pi TUI 接口桩，界面不显示
	getToolsExpanded: () => false,
	setToolsExpanded: noop,
};

// 旁路条目解析的告警去重：每拍都会问一次，配错了不能每拍刷一条
let warnedSideEntry = "";

/**
 * 旁路条目：`config.sideModel` 指向连接配置里的一条模型条目（provider + 条目名）。
 * 没配 = 返回 undefined = 调用方跟随剧情模型（旧行为逐字不变）。
 * 条目找不到 / 模型不可用 / 没 key 时告警一次并回落——绝不因为一条配错的旁路把正事丢掉。
 * 场记/压缩（引擎）与跨会话记忆同步（本文件）共用这一个主人。
 */
const sideEntryOf = (): { model: StageModelLike; thinking?: string; label?: string } | undefined => {
	const sel = loadConfig(cwd).sideModel;
	if (!sel) return undefined;
	const tag = `${sel.provider}/${sel.entry}`;
	const warn = (why: string): undefined => {
		if (warnedSideEntry !== tag + why) {
			warnedSideEntry = tag + why;
			console.error(`[stage-side] 旁路条目 ${tag} ${why}，本次回落跟随剧情模型`); // i18n-ignore：终端日志
		}
		return undefined;
	};
	try {
		const agent = loadAgentConfig(cwd).config;
		const entry = findModelEntry(agent.providers?.[sel.provider]?.models, sel.entry);
		if (!entry) return warn("不在连接配置里"); // i18n-ignore：终端日志
		const m = session.modelRuntime.getModel(sel.provider, entry.id);
		if (!m) return warn(`模型 ${entry.id} 不在可用清单`); // i18n-ignore：终端日志
		if (!session.modelRuntime.hasConfiguredAuth(m.provider)) return warn("缺少 API key"); // i18n-ignore：终端日志
		if (warnedSideEntry) warnedSideEntry = "";
		const thinking = thinkingLevelOfEntry(agent, sel.provider, sel.entry);
		return { model: m as never, ...(thinking ? { thinking } : {}), label: sel.entry };
	} catch (err) {
		return warn(`解析失败（${err instanceof Error ? err.message : String(err)}）`); // i18n-ignore：终端日志
	}
};

/**
 * 一次性旁路文本调用（单发）。restHost.runSideText（预设分拣等旁路声明）与
 * 跨会话记忆同步共用这一条——同 StageEngine.#sideText 的调用形状。
 * 走哪条模型由调用方给（剧情模型，或 sideEntryOf 解出的旁路条目）。
 */
const sideTextOnce = async (
	model: StageModelLike | undefined,
	systemPrompt: string,
	userText: string,
	opts?: { maxTokens?: number; reasoning?: string; signal?: AbortSignal },
): Promise<string | { error: string }> => {
	if (!model) return { error: t("无可用模型") };
	try {
		const s = session.modelRuntime.streamSimple(
			model as never,
			{ systemPrompt, messages: [{ role: "user", content: [{ type: "text", text: userText }], timestamp: Date.now() }] },
			{ maxTokens: opts?.maxTokens ?? 4096, reasoning: (opts?.reasoning ?? "off") as never, signal: opts?.signal },
		);
		let final: AssistantMsgLike | null = null;
		for await (const e of s) {
			if (e.type === "done") final = e.message ?? null;
			else if (e.type === "error") return { error: e.error?.errorMessage || `stopReason=${e.error?.stopReason ?? "?"}` };
		}
		if (!final) return { error: t("流未产出最终消息") };
		const text = final.content
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "")
			.join("")
			.trim();
		return text || { error: t("最终消息无文本") };
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
	}
};

/**
 * 跨会话记忆同步（第二步）：当前会话落在 cards/ 的某个子项目里才发生——内容变了的
 * 子项目逐个复盘，复盘文件有增/改/删就合并＋遗忘。进度走活动条（name=memory）；
 * 全程后台，失败只进日志——记忆滞后不影响演出。
 */
const memorySyncBusy = new Set<string>();
const memorySyncQueued = new Set<string>();

/** 给一张卡做一次记忆同步（模型/素材现读；任何失败只进日志、绝不抛出） */
const syncCardMemoryOnce = async (cardDir: string) => {
	try {
		// 素材取自这张卡自己：卡本体在卡文件夹里，配置＝全局与卡级合并（与台上同语义）
		const cardFile = cardFileIn(cardDir);
		if (!cardFile) return;
		const card = loadCardFile(cardFile);
		const config = mergeCardConfig(loadConfig(cwd), loadCardConfig(cardDir));
		// 旁路条目与场记/压缩同一条规则（sideEntryOf 是唯一主人）：配了走它，没配跟随剧情模型
		const side = sideEntryOf();
		const chosen = (side?.model ?? session.model) as StageModelLike | undefined;
		if (!chosen) return; // 还没配模型：下次落会话再同步
		const r = await syncCardMemory(
			{
				sideText: (sp, ut, maxTokens) =>
					sideTextOnce(chosen, sp, ut, {
						maxTokens,
						reasoning: side?.thinking ?? "off",
						signal: AbortSignal.timeout(300_000),
					}),
				onActivity: (detail) => broadcast({ type: "activity", activity: { kind: "note", name: "memory", detail } }),
			},
			{
				cardDir,
				language: config.language,
				userName: config.userName,
				charName: card.name,
			},
		);
		if (r.failed.length > 0 || r.merged === "failed") {
			console.error(`[card-memory] 同步未完成：复盘失败 ${r.failed.length} 局、合并 ${r.merged}`); // i18n-ignore：终端日志
		} else if (r.recapped.length + r.forgotten.length > 0) {
			console.log(`[card-memory] 同步完成：复盘 ${r.recapped.length} 局、遗忘 ${r.forgotten.length} 局`); // i18n-ignore：终端日志
			// 活动条只在拍内可见（拍外来的会被下一拍的 resetActs 清掉），完成时另给一条
			// notify（与「已钉档」同一通道）——只在真动了记忆时出声，无变化保持安静。
			broadcast({
				type: "notify",
				level: "info",
				text: r.forgotten.length
					? t("记忆已更新：复盘 {recapped} 局、遗忘 {forgotten} 局", { recapped: r.recapped.length, forgotten: r.forgotten.length })
					: t("记忆已更新：复盘 {recapped} 局", { recapped: r.recapped.length }),
			});
		}
	} catch (err) {
		console.error(`[card-memory] 同步异常：${err instanceof Error ? err.message : String(err)}`); // i18n-ignore：终端日志
	}
};

const runCardMemorySync = (cardDir: string) => {
	memorySyncBusy.add(cardDir);
	void syncCardMemoryOnce(cardDir).finally(() => {
		memorySyncBusy.delete(cardDir);
		if (memorySyncQueued.delete(cardDir)) runCardMemorySync(cardDir); // 忙时来的触发：收尾后带上最新内容补跑
	});
};

const syncMemoryForSession = () => {
	try {
		const chatDir = chatDirOfSessionDir(session.sessionManager.getSessionDir());
		if (!chatDir) return; // 老布局/内存会话：行为与今天一致
		const cardDir = cardDirOfChatDir(chatDir);
		if (!cardDir) return;
		if (memorySyncBusy.has(cardDir)) {
			memorySyncQueued.add(cardDir);
			return;
		}
		runCardMemorySync(cardDir);
	} catch (err) {
		console.error(`[card-memory] 触发同步异常：${err instanceof Error ? err.message : String(err)}`); // i18n-ignore：终端日志
	}
};

const bindSession = async () => {
	session = runtime.session;
	// 账本/面板的落点跟着会话走（子项目一份）：换会话/换子项目后要重挂目录监听
	stateWatcher.rearm();
	panelsWatcher.rearm();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- headless stub 集合，形状对齐 rpc-mode 的实现
	await session.bindExtensions({
		uiContext: uiContext as any,
		mode: "rpc",
		commandContextActions: {
			waitForIdle: () => session.waitForIdle(),
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
			broadcast({ type: "error", text: t("扩展错误（{event}）：{error}", { event: err.event, error: err.error }) });
		},
	});

	unsubscribe?.();
	unsubscribe = session.subscribe((event) => {
		// RP 增量与落树由拍级回调交付；原生工具起止事件供过程栏和资产缓存失效使用。
		if (stage?.isStreaming && event.type !== "tool_execution_start" && event.type !== "tool_execution_end") return;
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
					// 内置向量记忆：按策略把本轮助手正文入库（异步，失败不影响叙事）
					// ⚠ 树坐标必须**在进异步块之前**同步取：用户紧接着重roll 会把叶挪回 user 节点，
					// 那时再取就会给这条记忆打上「每条分支都可见」的坐标，隔离当场失效。
					const memNodeId = session.sessionManager.getLeafId();
					const memBranchIds = branchNodeIds();
					void (async () => {
						try {
							const msgs = branchMessages() as Array<{ role?: string; content?: unknown }>;
							let lastText = "";
							for (let i = msgs.length - 1; i >= 0; i--) {
								const m = msgs[i];
								if (m?.role !== "assistant") continue;
								const c = m.content;
								if (typeof c === "string") lastText = c;
								else if (Array.isArray(c)) {
									lastText = c
										.map((p) =>
											p && typeof p === "object" && (p as { type?: string }).type === "text"
												? String((p as { text?: string }).text ?? "")
												: "",
										)
										.join("");
								}
								if (lastText.trim()) break;
							}
							const mem = await onNarrativeTurnEnd(
								cwd,
								memoryScopeFor(),
								lastText,
								{ nodeId: memNodeId, branchIds: memBranchIds },
							);
							if (mem.error) {
								broadcast({
									type: "notify",
									level: "warning",
									text: t("向量记忆：入库失败 · {error}", { error: mem.error }),
								});
							} else if (mem.stored) {
								const how = mem.merged ? t("合并入已有条目") : t("新开条目");
								broadcast({
									type: "notify",
									level: "info",
									text: t("向量记忆：剧情库{how}（第 {n} 轮 · 当前对话）", { how, n: mem.counter }),
								});
							}
						} catch (e) {
							console.warn("[memory] auto ingest failed", e);
						}
					})();
				}
				break;
			case "message_update": {
				const e = event.assistantMessageEvent;
				if (e.type === "text_delta") broadcast({ type: "delta", kind: "text", delta: e.delta });
				else if (e.type === "thinking_delta") broadcast({ type: "delta", kind: "thinking", delta: e.delta });
				break;
			}
			case "message_end": {
				// 刚生成的这条就是最新消息（depth 0）——作者的深度限定按此筛，
				// 否则「N 楼外删掉」这类规则会当场把本拍的状态栏删了
				const wire = toWireMsg(event.message, names, { skin: skinAtDepth(currentDisplaySkin(), 0) });
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
				// RP 人话摘要（非 JSON）；模型台侧旁白另由 stream→note 捕获
				const detail = toolStartDetail(event.toolName, event.args);
				const change = fileChangeOf(event.toolName, event.args);
				broadcast({ type: "activity", activity: { kind: "tool_start", name: event.toolName, detail, ...(change ? { change } : {}) } });
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
				broadcast({ type: "notify", level: "warning", text: t("模型请求失败，自动重试 {attempt}/{max}…", { attempt: event.attempt, max: event.maxAttempts }) });
				break;
			default:
				break;
		}
	});

	// 第二步·跨会话记忆：落进某个会话（启动/切会话/换子项目）就给这张卡同步一次。
	// 后台进行不等它；老布局（会话不在 cards/ 里）内部自行短路。
	syncMemoryForSession();
};

/** 给 runtime 挂会话替换钩子（新建 runtime 时也要挂：new 帧「新开子项目」会换 runtime） */
const wireRuntimeHooks = () => {
	runtime.setRebindSession(async () => {
		await bindSession();
		resyncAll(); // /branch 等替换会话后，所有端对齐新会话
	});
};
wireRuntimeHooks();
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
		maxTokens: typeof m.maxTokens === "number" && m.maxTokens > 0 ? m.maxTokens : undefined,
	};
};

const restHost: RestHost = {
	cwd,
	isStreaming: () => session.isStreaming,
	settleCardPreview: (report) => cardPreviews.settle(report),
	settleScreenshot: (report) => screenshots.settle(report),
	runCardPreview: (args) => {
		const config = loadConfig(cwd);
		const data = previewCardProject(cwd, currentCardPath(cwd, config), config.userName);
		return cardPreviews.run(buildCardPreviewRequest(cardPreviews.nextId(), data, args));
	},
	listModels: () => ({
		current: currentModelInfo(),
		models: session.modelRuntime.getAvailableSnapshot().map((m) => ({
			provider: m.provider,
			providerName: session.modelRuntime.getProvider(m.provider)?.name ?? m.provider,
			id: m.id,
			name: m.name || m.id,
			reasoning: m.reasoning === true,
			vision: Array.isArray(m.input) && m.input.includes("image"),
			contextWindow: m.contextWindow ?? 0,
			maxTokens: typeof m.maxTokens === "number" && m.maxTokens > 0 ? m.maxTokens : undefined,
		})),
	}),
	async selectModel(provider, id) {
		const m = session.modelRuntime.getModel(provider, id);
		if (!m) throw new Error(t("模型不存在：{model}", { model: `${provider}/${id}` }));
		await session.setModel(m);
		const current = currentModelInfo();
		if (!current) throw new Error(t("模型切换后状态异常"));
		return current;
	},
	setThinkingLevel(level) {
		// 各模型档位名不同（off/low/high/xhigh/max…），由用户按模型文档自填英文，不做固定白名单
		const lv = level.trim();
		if (!lv) throw new Error(t("思考档位不能为空"));
		session.setThinkingLevel(lv as never);
		const current = currentModelInfo();
		if (!current) throw new Error(t("会话未就绪"));
		return current;
	},
	authProviders() {
		const counts = new Map<string, number>();
		for (const m of session.modelRuntime.getModels()) {
			counts.set(m.provider, (counts.get(m.provider) ?? 0) + 1);
		}
		// 当前会话模型所属 provider 置顶，便于在「现有渠道」里看见
		const currentProvider = session.model?.provider;
		return [...counts.entries()]
			.map(([provider, modelCount]) => {
				const status = session.modelRuntime.getProviderAuthStatus(provider);
				const ready = session.modelRuntime.hasConfiguredAuth(provider);
				return {
					provider,
					displayName: session.modelRuntime.getProvider(provider)?.name ?? provider,
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
	async setAuthKey(provider, key) {
		await session.modelRuntime.login(provider, "api_key", { prompt: async () => key, notify: () => {} });
	},
	async removeAuth(provider) {
		await session.modelRuntime.logout(provider);
	},
	agentDir: () => getAgentDir(),
	providerSnapshot(provider) {
		const all = session.modelRuntime.getModels().filter((m) => m.provider === provider);
		if (all.length === 0) return null;
		const sample = all[0] as { baseUrl?: string; api?: string; id: string; name?: string; reasoning?: boolean; contextWindow?: number; maxTokens?: number };
		const status = session.modelRuntime.getProviderAuthStatus(provider);
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
				...(m as Record<string, unknown>),
				id: m.id,
				name: m.name || m.id,
				reasoning: m.reasoning === true,
				contextWindow: m.contextWindow ?? undefined,
				maxTokens: (m as { maxTokens?: number }).maxTokens,
			})),
		};
	},
	async refreshModels() {
		await session.modelRuntime.refresh({ allowNetwork: false });
	},
	async reloadSession() {
		await session.reload();
		refreshNamesFromConfig();
		resyncAll();
	},
	/** 身份/配置/世界书挂载等：走扩展 /rprefresh，不整会话 reload */
	async softRefreshConfig(opts?: { reprocessPreset?: boolean }) {
		// 预设装载态同步（装载/卸载/拨开关/保存/还原/重新装载都经这里）：先把（预设）条目写进卡文件，再刷新装配
		await syncPresetNow(opts?.reprocessPreset === true);
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
		// 换卡：装载中的预设要按新卡（宏按卡求值）重新落条目；声明全局留档（assets/presets/.liyuan/），
		// 换卡不再重复问模型。后台跑，不挡切会话：链条自带串行（presetSyncChain）与跑完通知；
		// 开场白来自卡本体，不吃预设条目，紧接着的第一拍万一赶在转译落盘前，下一拍现读即生效。
		void syncPresetNow();
		// 清卡缓存：换卡后列表必须按新 cardPath 重读 rp-card
		cardCache.clear();
		const frame = await listSessions();
		const list = (frame as { type: "sessions"; list: Array<{ path: string; current: boolean; card?: string }> }).list;
		// 只在本卡会话里挑「最近非当前」；没有则新建（不把其它卡的 current 误当目标）
		const target = list.find((s) => !s.current && (!s.card || sameCardPath(s.card, cardPath, cwd)));
		let result: "switched" | "created";
		if (target) {
			await runtime.switchSession(target.path);
			result = "switched";
		} else {
			// 没有可切的历史会话：卡空间就落到「落脚子项目」（没有子项目就先建一个）——
			// 会话必须住进卡里，不然项目树不长项目、会话也不属于这张卡。
			// 老布局（ensure 返回 null）或已经在该子项目里：保持原行为 runtime.newSession()。
			const dir = ensureStorySessionDir(cwd, cardPath);
			const curChat = chatDirOfSessionDir(session.sessionManager.getSessionDir());
			if (dir && curChat !== chatDirOfSessionDir(dir)) {
				const previousSessionFile = session.sessionFile;
				await runtime.dispose();
				runtime = await createAgentSessionRuntime(createRuntime, {
					cwd,
					agentDir: getAgentDir(),
					sessionManager: SessionManager.create(cwd, dir),
					sessionStartEvent: { type: "session_start", reason: "new", previousSessionFile },
				});
				wireRuntimeHooks();
				await bindSession();
				result = "created";
			} else {
				await runtime.newSession();
				result = "created";
			}
		}
		broadcast(await listSessions());
		return result;
	},
	promptCommand: (text) => handlePrompt(text),
	queueCommand(text) {
		const queued = storyStreaming();
		// 不等待执行完成（流式中排队到本轮结束；/import 等长操作进度经 notify 推送）
		void handlePrompt(text).catch((err) => {
			broadcast({ type: "error", text: err instanceof Error ? err.message : String(err) });
		});
		return queued;
	},
	// 面板导入：写盘 + 进程内直达收编（不经 /panelsync prompt——剧情回合内排队会死锁）
	async importPanels(list) {
		const file = panelsFileOf();
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
			syncStoryPanelsFromDisk();
		}
		return { imported, names, errors };
	},
	// 用户删除面板：写盘 + 进程内收编
	async closePanel(name) {
		const file = panelsFileOf();
		const panels = loadPanels(file);
		const r = closePanelInMap(panels, name);
		if (!r.ok) throw new Error(r.error);
		savePanels(file, r.panels);
		syncStoryPanelsFromDisk();
	},
	// 用户手改面板源码：同 import 写路径，但要求面板已存在且未归档
	async savePanel(input) {
		const name = String(input?.name ?? "").trim();
		if (!name) throw new Error(t("面板名不能为空"));
		const file = panelsFileOf();
		const panels = loadPanels(file);
		const prev = panels[name];
		if (!prev) throw new Error(t("没有名为「{name}」的面板", { name }));
		if (prev.archived) throw new Error(t("面板「{name}」已归档，请先由 agent 同名写入重开", { name }));
		const kind = typeof input.kind === "string" && input.kind.trim() ? input.kind.trim() : prev.kind;
		const r = writePanel(panels, { name, kind, content: String(input.content ?? "") });
		if (!r.ok) throw new Error(r.error);
		savePanels(file, r.panels);
		syncStoryPanelsFromDisk();
		const saved = r.panels[name];
		return { name: saved.name, kind: saved.kind, updatedAt: saved.updatedAt };
	},
	// ---- 世界状态编辑（PLAN-PANELS §2.11）：用户主权 applyPatch，落盘即广播，命令桥收编进树 ----
	async applyStatePatch(patch) {
		const file = stateFileOf();
		const r = applyPatch(loadState(file), patch);
		saveState(file, r.state); // fs.watch 自动广播 state 帧
		syncStoryStateFromDisk();
		return { applied: r.applied, warnings: r.warnings };
	},
	// ---- agent 模式：稿子（正文/ 文件）与快照仓 ----
	storyView() {
		const chatDir = agentChatDir();
		const outline = storyOutline();
		if (!chatDir || !outline) return { files: [] };
		const dir = storyDirectory(chatDir);
		// 上屏正文与扮演气泡同一条链（prepareDisplayText：MVU 挂载点 → 卡皮肤正则 → 整页 HTML 保护 → fold/strip）；
		// 深度＝文件序列上倒数第几个（最后一个＝0），作者「N 楼外删掉」类规则按此生效。text 是原文，给编辑框。
		const skin = currentDisplaySkin();
		const n = outline.files.length;
		return { files: outline.files.map((f, i) => {
			let text = "";
			try { text = readFileSync(join(dir, f.name), "utf8"); } catch { /* 读不到：正文空，目录仍在 */ }
			return { ...f, text, display: prepareDisplayText(text, skinAtDepth(skin, n - 1 - i)) };
		}) };
	},
	storyDiff(checkpointId) {
		const chatDir = agentChatDir();
		if (!chatDir) throw new Error(t("当前不是 agent 子项目"));
		return { files: new StoryHistory(chatDir).diff(checkpointId) };
	},
	async editStoryFile(input) {
		const chatDir = agentChatDir();
		if (!chatDir) throw new Error(t("当前不是 agent 子项目"));
		if (stage.isStreaming) throw new Error(t("模型正在写，稍后再改"));
		if (!STORY_FILE_NAME_RE.test(input.name) || input.name.startsWith(".")) throw new Error(t("文件名须是稿子目录下的 .md 文件"));
		const dir = storyDirectory(chatDir);
		mkdirSync(dir, { recursive: true });
		const abs = join(dir, input.name);
		if (input.text === null) { if (existsSync(abs)) rmSync(abs); }
		else writeFileSync(abs, input.text, "utf8");
		const cp = new StoryHistory(chatDir).commit({ author: "user", message: input.text === null ? t("删除 {name}", { name: input.name }) : t("手改 {name}", { name: input.name }) });
		if (cp) {
			const { files: _files, ...lite } = cp;
			session.sessionManager.appendCustomEntry(STORY_CHECKPOINT_TYPE, lite);
			session.sessionManager.flush();
		}
		resyncAll();
		return { checkpointId: cp?.id };
	},
	// ---- 世界线视图 / 软删除 / 线名 ----
	worldlineView() {
		const sm = session.sessionManager;
		const sid = session.sessionId;
		const meta = loadWorldlineMeta(worldlineFileOf(sid));
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
		const file = worldlineFileOf();
		const meta = softDeleteSave(loadWorldlineMeta(file), saveId);
		saveWorldlineMeta(file, meta);
		broadcast({ type: "notify", level: "info", text: t("已删除存档节点（软删除，会话树原文保留）") });
	},
	renameWorldline(worldlineId, name) {
		const file = worldlineFileOf();
		const meta = renameWorldlineMeta(loadWorldlineMeta(file), worldlineId, name);
		saveWorldlineMeta(file, meta);
		broadcast({ type: "notify", level: "info", text: t("世界线已改名「{name}」", { name: name.trim() }) });
	},
	// ---- 会话管理（PLAN-PANELS §2.1）：面板的重命名/删除/导出/全文搜索 ----
	sessions: () => sessionInfos(),
	/** 当前子项目 id（REST 删除守卫用；老布局/未进对话时 null） */
	currentChatId() {
		const d = chatDirOfSessionDir(session.sessionManager.getSessionDir());
		return d ? basename(d) : null;
	},
	async renameSession(path, name) {
		await assertListedSession(path);
		const clean = name.replace(/[\r\n]+/g, " ").trim();
		if (!clean) throw new Error(t("名字不能为空"));
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
		if (session.sessionFile === path) throw new Error(t("不能删除当前打开的会话（先切到其他会话再删）"));
		unlinkSync(path);
		cardCache.delete(path);
		previewCache.delete(path);
	},
	// 删卡「相关数据」用：删除绑定某张卡的全部会话文件（rp-card 标记匹配）。
	// 调用方须保证当前打开的会话已不属于该卡（删当前卡先切走再调本方法）。
	// 两层布局：卡是 cards/ 卡文件夹 ⇒ 全部子项目都在该卡目录里，整卡删除由
	// DELETE /api/cards 直接删卡文件夹完成，这里无事可做（返回 0 不撒谎——
	// 老语义数的是会话文件数，此处由删除端点自己报子项目数）。
	async deleteCardSessions(cardRel) {
		if (resolveCardSpace(cwd, cardRel)) return 0;
		const all = await SessionManager.list(cwd);
		let n = 0;
		for (const s of all) {
			if (isSameSessionPath(s.path, session.sessionFile)) continue;
			const mtime = s.modified instanceof Date ? s.modified.getTime() : Number(s.modified) || 0;
			const info = readSessionCard(s.path, mtime);
			if (!info || !sameCardPath(info.card, cardRel, cwd)) continue;
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
			content: cap ? `〔配音〕${cap}` : "〔配音〕", // i18n-ignore：短标记进模型上下文，送模文案不翻
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
	updateCheckNow: () => runUpdateCheck(true),
	updateDownload: (mirror) => startUpdateDownload(mirror),
	updateDiscard: () => {
		discardPendingUpdate(cwd);
		updateState = { phase: "none", currentVersion: APP_VERSION };
		pushUpdate();
	},
	updateRestart: () => {
		// 启动脚本循环重拉（LIYUAN_SUPERVISED=1 时 exit 87 = 请求重启）；
		// 直跑 node 的开发场景没有监护，退了就是退了（下次手动启动时应用）。
		console.log("[liyuan] 收到重启应用更新请求，退出进程…"); // i18n-ignore：终端日志
		setTimeout(() => process.exit(87), 300);
	},
	/** 向量记忆：绑定当前角色卡 + 当前对话会话 */
	memoryScope: () => memoryScopeFor(),
	// 预设 AI 分拣等旁路声明：调当前会话模型做一次性判断（sideTextOnce，与跨会话记忆同步同一条）
	runSideText: (systemPrompt, userText, opts) =>
		sideTextOnce(session.model as StageModelLike | undefined, systemPrompt, userText, {
			maxTokens: opts?.maxTokens ?? 4096,
			reasoning: opts?.reasoning ?? "off",
			signal: opts?.signal,
		}),
};

/**
 * 预设装载态同步（rest.ts syncPresetTranslation）：装载即转译、改开关即转译、卸载即剥净。
 * 失败只通知不抛出——配置刷新不能因为旁路模型断供而卡死；产物有变/首次声明才提示。
 */
let presetSyncChain: Promise<PresetSyncResult | undefined> = Promise.resolve(undefined);
const syncPresetNow = (reprocess = false): Promise<PresetSyncResult | undefined> => {
	presetSyncChain = presetSyncChain.then(async () => {
		try {
			const cur = restHost.listModels().current;
			const { preset: r, lore } = await syncCardFiles(
				cwd,
				{
					runSideText: restHost.runSideText,
					modelLabel: cur ? `${cur.provider}/${cur.id}` : undefined,
				},
				{ reprocess },
			);
			if (lore.state === "written") {
				broadcast({ type: "notify", level: "info", text: t("卡档案已同步世界书常驻条目：{n} 条", { n: lore.entries }) });
			}
			if (r.mode === "process") {
				if (r.processError) {
					broadcast({
						type: "notify",
						level: "error",
						text: t("预设「{preset}」处理失败（产物暂缺，原因已落档 assets/presets/.liyuan/）：{error}", { preset: r.preset, error: r.processError }),
					});
				} else if (r.needProcess) {
					broadcast({ type: "notify", level: "info", text: t("预设「{preset}」尚未处理——到预设库点「重新装载」生成产物（要几分钟）", { preset: r.preset }) });
				} else if (r.state === "written" && r.preset) {
					broadcast({
						type: "notify",
						level: "info",
						text: t("预设「{preset}」已处理：身份 {identity} 字、写作 {writing} 字{how}{stale}", {
							preset: r.preset,
							identity: r.identityChars ?? 0,
							writing: r.writingChars ?? 0,
							how: r.processed ? t("（本次模型处理）") : t("（沿用留档）"),
							stale: r.stale ? t("；选项已改，要点「重新装载」才更新") : "",
						}),
					});
				}
			} else {
				if (r.declareError) {
					broadcast({
						type: "notify",
						level: "error",
						text: t("预设「{preset}」声明失败（{pending} 段先按保守方式全部保留）：{error}", { preset: r.preset, pending: r.pending, error: r.declareError }),
					});
				}
				if (r.state === "written" && r.preset) {
					broadcast({
						type: "notify",
						level: "info",
						text: t("预设「{preset}」已转译：活动条目 {active} 条、停用 {disabled} 条{declared}", {
							preset: r.preset,
							active: r.active,
							disabled: r.disabled,
							declared: r.declared ? t("（本次声明 {n} 段）", { n: r.declared }) : "",
						}),
					});
				}
			}
			// 卸载剥净才提示（process 机制缺留档的剥净有自己的 needProcess 提示，别误报「已卸载」）
			if (r.state === "stripped" && r.mode !== "process") {
				broadcast({ type: "notify", level: "info", text: t("预设已卸载：卡文件里的（预设）条目已移除") });
			}
			return r;
		} catch (err) {
			broadcast({ type: "notify", level: "error", text: t("预设同步失败：{msg}", { msg: err instanceof Error ? err.message : String(err) }) });
			return undefined;
		}
	});
	return presetSyncChain;
};

// 启动时：liyuan.agent.json → models.json，重绑模型 + 应用思考档（配置 → 当前生效）
try {
	const loaded = loadAgentConfig(cwd);
	if (loaded.exists && Object.keys(loaded.config.providers).length > 0) {
		const cfg = normalizeAgentConfig(loaded.config);
		syncAgentConfigToRuntime(cwd, getAgentDir(), cfg);
		await session.modelRuntime.refresh({ allowNetwork: false });
		const cur = session.model;
		if (cur) {
			const next = session.modelRuntime.getModel(cur.provider, cur.id);
			if (next) await session.setModel(next);
			const p = cfg.providers[cur.provider];
			const entry = Array.isArray(p?.models) ? p.models.find((m) => String(m.id) === cur.id) : undefined;
			const per =
				typeof entry?.thinkingLevel === "string" && entry.thinkingLevel.trim()
					? entry.thinkingLevel.trim()
					: "";
			const def =
				typeof cfg.defaultThinkingLevel === "string" && cfg.defaultThinkingLevel.trim()
					? cfg.defaultThinkingLevel.trim()
					: "";
			const think = per || def;
			if (think) {
				try {
					session.setThinkingLevel(think as never);
				} catch {
					/* 档位名不支持时忽略 */
				}
			}
		}
		console.log("[liyuan] 已从 liyuan.agent.json 同步 models.json 与思考档"); // i18n-ignore：终端日志
	}
} catch (err) {
	console.error(`[liyuan] 启动同步 agent 配置失败：${err instanceof Error ? err.message : String(err)}`); // i18n-ignore：终端日志
}

// ---------- HTTP：REST /api/* + 托管 web/dist（存在时）+ 健康检查 ----------

// 桌面版：前端产物随包在产品根（数据根没有 web/）；源码包两根合一，cwd 优先
const distDir = existsSync(join(cwd, "web", "dist")) ? join(cwd, "web", "dist") : join(productRoot, "web", "dist");
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

/**
 * 可压缩的文本类型（图片/字体/音视频本身已是压缩格式，再压只烧 CPU）。
 * 首屏那两个大件就在这里：index.js 557KB→175KB、index.css 111KB→20KB。
 */
const COMPRESSIBLE_EXT = new Set([".html", ".js", ".css", ".svg", ".json", ".webmanifest", ".manifest", ".map", ".txt"]);

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
				reject(new Error(t("body 过大")));
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
			json(200, { required: !!accessData, ok: requestAuthed(req), uiLanguage: loadConfig(cwd).uiLanguage ?? null });
			return;
		}
		if (req.method === "POST" && url === "/api/access/login") {
			if (!accessData) {
				json(400, { error: t("未设置访问密码") });
				return;
			}
			if (accessFails >= 5) await new Promise((r) => setTimeout(r, 1500)); // 暴力尝试限速
			const body = await readJsonBody(req);
			if (typeof body.password === "string" && verifyPassword(accessData, body.password)) {
				accessFails = 0;
				json(200, { ok: true }, issueToken(cwd, accessData));
			} else {
				accessFails++;
				json(401, { error: t("密码不正确") });
			}
			return;
		}
		if (req.method === "POST" && url === "/api/access/set") {
			const body = await readJsonBody(req);
			// 已有密码时，任何变更（改/关）都必须先验旧密码
			if (accessData && (typeof body.oldPassword !== "string" || !verifyPassword(accessData, body.oldPassword))) {
				json(403, { error: t("当前密码不正确") });
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
				json(400, { error: t("密码至少 4 位") });
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
			res.end(JSON.stringify({ error: t("需要登录") }));
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
			res.end(t("梨园 server 运行中。前端尚未构建：开发用 `npm --prefix web run dev`，或 `npm --prefix web run build` 后刷新本页。WS 端点：/ws"));
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
			// HTML 必须每次向服务器验证：无此头时手机浏览器启发式缓存旧壳，
			// 旧壳引用已删除的 hashed 资源 → 更新「刷新也不生效」甚至白屏
			if (ext === ".html") {
				headers["cache-control"] = "no-cache";
			}
			if (COMPRESSIBLE_EXT.has(ext)) {
				writeMaybeGzip(res, 200, body, headers);
			} else {
				res.writeHead(200, headers);
				res.end(body);
			}
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

// ---------- 台上领域逻辑（生成/工具循环归 pi，RP 扩展负责装配与收尾） ----------

stage = new StageEngine({
	cwd,
	getSession: () => session as never,
	getModel: () => session.model as never,
	getAuth: async (m) => {
		const result = await session.modelRuntime.getAuth(m as never);
		if (!result) throw new Error(t("模型 {model} 没有可用鉴权", { model: `${m.provider}/${m.id}` }));
		return result.auth;
	},
	// 旁路条目（场记/压缩用）：sideEntryOf 是唯一主人，定义与语义见 bindSession 前
	getSideEntry: sideEntryOf,
	getThinking: () => session.thinkingLevel,
	// 场记落盘 → fs.watch 自动广播 state 帧（与扩展/REST 写路径同一条）
	getStateFile: (sessionId) => stateFileOf(sessionId),
	// memory_search 工具：剧情库 + 外部资料库合并取前 6（与扩展侧同一套语义）
	// 分支隔离与被动召回同源——模型主动检索也不该捞到重roll 掉的那些拍。
	searchMemory: (sessionId, query) => memorySearchReport(cwd, memoryScopeFor(sessionId), query, branchNodeIds()),
	readMemory: (sessionId, ref) => memoryReadChunk(cwd, memoryScopeFor(sessionId), ref, branchNodeIds()),
	// 【剧情记忆】每拍被动召回：与 memory_search 同一套 scope 绑定，但走 memoryRecallForTurn——
	// 那里管着设置面板的「每轮自动检索并注入模型」开关（关 = 返回空 = 不出块）。
	recallMemory: (sessionId, query) =>
		memoryRecallForTurn(cwd, memoryScopeFor(sessionId), query, branchNodeIds()).catch(() => []),
	// 向量库写侧三件（M-D3）：MemoryScope 一律在此绑定（当前对话 + 当前卡），**不经模型**。
	// 写侧恒落 external——服务层 assertExtraStore 禁止手写剧情库，故工具不给 store 参数。
	addMemory: (sessionId, input) =>
		memoryManualAdd(cwd, memoryScopeFor(sessionId), input.text, {
			...(input.title ? { title: input.title } : {}),
		}),
	listMemory: (sessionId, storeId) =>
		memoryListChunks(cwd, memoryScopeFor(sessionId), storeId, branchNodeIds()),
	deleteMemory: (sessionId, storeId, id) =>
		memoryDeleteChunk(cwd, memoryScopeFor(sessionId), storeId, id),
	// 面板读写（M-D5）：按 session 绑定 artifacts 文件，注入后台上可通过 panel_write/read/close 操控面板
	loadPanels: (sessionId) => {
		const panels = loadPanels(panelsFileOf(sessionId));
		const result: Record<string, { name: string; kind: "markdown" | "svg" | "html"; content: string; archived?: boolean }> = {};
		for (const [k, v] of Object.entries(panels)) result[k] = { name: v.name, kind: v.kind, content: v.content, archived: v.archived };
		return result;
	},
	writePanel: (sessionId, input) => {
		const file = panelsFileOf(sessionId);
		const panels = loadPanels(file);
		const r = writePanel(panels, input);
		if (r.ok) { savePanels(file, r.panels); syncStoryPanelsFromDisk(); }
		return r;
	},
	closePanel: (sessionId, name) => {
		const file = panelsFileOf(sessionId);
		const panels = loadPanels(file);
		const r = closePanelInMap(panels, name);
		if (r.ok) { savePanels(file, r.panels); syncStoryPanelsFromDisk(); }
		return r;
	},
	// worldline_list 工具：树形视图摊平成存档表（工具面要表不要树）。
	// 只给读——存档点必须钉在封笔之后，台上没有那个执行位（见 src/tools/worldline.ts 文件头）。
	loadWorldline: () => flattenWorldlineSaves(restHost.worldlineView()),
	// worldline_store（M-D7）：引擎在**场记之后**调这里，此刻叶＝刚落的 assistant 条目，
	// rp-state 也刚写完——回退到此点账本/面板才对得齐（扩展的 /store 要自己先补两份快照，
	// 这里不用）。分线与否交给 planNewSave 按当下树形算，模型说了不算。
	storeSave: (_sessionId, name) => {
		const sm = session.sessionManager;
		const meta = loadWorldlineMeta(worldlineFileOf());
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
		const leafId = sm.getLeafId();
		if (!leafId) return null;
		const saves = extractSaves(entries, meta);
		const { ancestorsOf, branchIdsFromLeaf } = buildAncestryIndex(entries);
		const branchIds = branchIdsFromLeaf(leafId);
		const data = planNewSave({
			name,
			prevOnBranch: latestSaveOnBranch(saves, branchIds),
			branchEntryIds: branchIds,
			allSaves: saves,
			ancestorsOf,
		});
		sm.appendCustomEntry(RP_SAVE_TYPE, data);
		broadcast({ type: "notify", level: "info", text: t("已存档「{name}」（{worldline}）", { name: data.name, worldline: data.worldlineName }) });
		return { id: data.id, name: data.name, worldlineName: data.worldlineName };
	},
	// MCP 外设（8/06 重接）：009e22e 换引擎时 MCP 只留在扩展路径（pi.registerTool）+
	// 已删除的 director.ts，台上从此看不见——hub 连得上，模型无工具可用。此处补上注入。
	//
	// 启用集**自己从会话树读**，不问扩展要（jiti 二象性：扩展的 sessionMcpEnabled 闭包
	// 变量在 server 侧不可见）。树上的 rp-mcp 快照是唯一可靠信源，且天然随 rewind/fork 走。
	// 无快照（新会话尚未 /mcpsync，或扩展未装载）→ 回落项目 defaults，自愈不依赖扩展。
	mcp: {
		listTools: () => {
			const hub = getMcpHub(cwd);
			const fromTree = mcpEnabledFromBranch(session.sessionManager.getBranch() as unknown[], RP_MCP_TYPE);
			const want = fromTree ?? defaultSessionEnabledIds(cwd);
			// hub 的启用集与树不一致时对账一次（后台连接，本拍用当前已连上的）。
			// 不 await：装配不能被 MCP 握手拖慢；连上后的下一拍即可见。
			const current = hub.getSessionEnabled();
			if (want.join("|") !== current.join("|")) {
				void hub.sync(want).catch(() => {
					// 连不上不该拖垮叙事：本拍就当没有 MCP 工具
				});
			}
			return hub.listActiveTools();
		},
		callTool: (serverId, toolName, args, signal) => getMcpHub(cwd).callTool(serverId, toolName, args, signal),
	},
	// P7 剧情决策门禁（ask 工具）：复用 Phase 4 柱 1 的选择卡通道——
	// 弹卡 → 用户作答（选项原文/自由输入）回喂模型重拟计划；停止 → 本拍收束，笔还给用户。
	askUser: (question, options, signal) => askChoice(question, options, undefined, signal),
	// 截图（agent 模式）：请连接中的页面截当前稿子画面。无页面或超时返回 null。
	screenshot: async (file, signal) => {
		const report = await screenshots.run({ id: screenshots.nextId(), ...(file ? { file } : {}) });
		if (signal?.aborted) return null;
		return report && report.png ? { png: report.png, width: report.width, height: report.height } : null;
	},
	// 媒体交付（8/06 重接）：show_image/audio/video/html + tts。
	// 与 MCP 同源的断链——wire.ts 的消费端一直健在，缺的只是台上生产端。
	media: true,
	// TTS 需要服务端环境（LIYUAN_TTS_API_KEY / OPENAI_API_KEY）：每拍现查，
	// 用户中途配好 env 重启即生效；没配就不上清单（模型不会去试一个必然失败的工具）。
	ttsAvailable: () => loadTtsConfig() !== null,
	// M4 压缩归档：被摘要覆盖的早期正文完整入剧情库——摘要管连续性，归档管细节召回
	archiveCompacted: async (sessionId, text) => {
		const r = await memoryArchiveCompacted(cwd, memoryScopeFor(sessionId), text);
		if (r.archived) {
			broadcast({ type: "notify", level: "info", text: t("向量记忆：早期剧情已归档（{n} 段，可 memory_search 召回）", { n: r.chunks }) });
		}
	},
	// lorebook_toggle 工具（M-D2）：写 config.disabledLore 并软刷新素材。
	// 复用 M-C2 协议禁用的同一条指纹通道（PLAN-RP-TOOLING M-D2 明示不得另起一套）。
	//
	// 8/22 修：原实现引用了 `configPath` 与 `cfg`——那两个名字只活在 hostSwitchGreeting 的函数体里，
	// 这里根本不在作用域内，每次调用必抛 ReferenceError（被工具的 try 兜住，模型只看到「启停失败」）。
	// 现取 resolveConfigPath(cwd)；`cfg = {...}` 那句一并删掉：本处没有可更新的快照，
	// 重装由 softRefreshConfig 负责。
	setDisabledLore: (fingerprints, enabled) => {
		const file = resolveConfigPath(cwd);
		const disk = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
		const prev = Array.isArray(disk.disabledLore)
			? disk.disabledLore.filter((f): f is string => typeof f === "string")
			: [];
		const next = toggleDisabledLore(prev, fingerprints, enabled);
		if (next.length > 0) disk.disabledLore = next;
		else delete disk.disabledLore;
		writeFileSync(file, `${JSON.stringify(disk, null, "\t")}\n`, "utf8");
		// constant 条目影响 system prompt，素材需重装（与 REST /api/lorebook/toggle 同）
		void restHost.softRefreshConfig();
		return fingerprints.length;
	},
	// 世界书写侧宿主件（M-D7）：条目改/删 + 书一级列/建/挂载。
	// 全部经 rest.ts 的共用寻址（书单全部 + 补充设定集）——面板与两个 agent 面同一套语义，
	// 且 disabledLore 指纹迁移在那里统一善后。写完 softRefreshConfig：constant/挂载都影响注入。
	loreHost: {
		write: (input) => {
			const config = loadConfig(cwd);
			if (input.book) {
				const [abs] = loreWriteTargets(cwd, config, input.book);
				const entry = appendLorebookFileEntry(abs, {
					comment: input.title,
					keys: input.keys,
					content: input.content,
					...(input.constant !== undefined ? { constant: input.constant } : {}),
				});
				if (entry) void restHost.softRefreshConfig();
				return entry;
			}
			const card = loadCardFile(isAbsolute(config.card) ? config.card : join(cwd, config.card));
			return appendOverlayEntry(overlayPathFor(cwd, card.name, config.card), input);
		},
		update: (fingerprint, patch) => {
			const r = patchLoreEntryAnywhere(cwd, loadConfig(cwd), fingerprint, {
				...(patch.title !== undefined ? { comment: patch.title } : {}),
				...(patch.keys !== undefined ? { keys: patch.keys } : {}),
				...(patch.content !== undefined ? { content: patch.content } : {}),
				...(patch.constant !== undefined ? { constant: patch.constant } : {}),
			});
			if (r) void restHost.softRefreshConfig();
			return r;
		},
		remove: (fingerprint) => {
			const r = deleteLoreEntryAnywhere(cwd, loadConfig(cwd), fingerprint);
			if (r) void restHost.softRefreshConfig();
			return r;
		},
		listMarked: () => loadMergedLoreMarked(cwd, loadConfig(cwd)),
		listBooks: () => lorebookShelf(cwd, loadConfig(cwd)),
		createBook: (name, first) => {
			const r = createLorebookWithEntry(cwd, loadConfig(cwd), name, {
				comment: first.title,
				keys: first.keys,
				content: first.content,
				...(first.constant !== undefined ? { constant: first.constant } : {}),
			});
			if (r) void restHost.softRefreshConfig();
			return r;
		},
		mountBook: (path, mounted) => {
			const next = setLorebookMounted(cwd, loadConfig(cwd), path, mounted);
			void restHost.softRefreshConfig();
			return next;
		},
	},
	// card_update 工具（M-D7）：改用户的卡文件。PNG 卡改 tEXt 内嵌 JSON，立绘像素不动。
	// 卡字段进 system prompt，写完必须重装——与 setDisabledLore 同一条理由归宿主。
	updateCard: (patch) => {
		updateCardFields(currentCardPath(cwd, loadConfig(cwd)), patch);
		void restHost.softRefreshConfig();
	},
	authoring: {
		project: async (args) => {
			const config = loadConfig(cwd);
			const path = currentCardPath(cwd, config);
			if (args.action === "preview") return restHost.runCardPreview(args);
			return cardProjectOperation(cwd, path, args);
		},
		updateCard: (patch) => updateCardFields(currentCardPath(cwd, loadConfig(cwd)), patch),
		createCard: (input) => {
			const created = createCardFile(cwd, input);
			return created ? { name: created.name, path: created.abs } : null;
		},
	},
	afterAuthoringTurn: () => restHost.softRefreshConfig(),
	sideStreamFn: (model, context, options) => session.modelRuntime.streamSimple(model as never, context as never, options as never) as unknown as ReturnType<StageStreamFn>,
	events: {
		onModeChanged: (mode) => { broadcast({ type: "conversation_mode", mode, turnMode: stage.turnMode }); resyncAll(); },
		onTurnStart: () => broadcast({ type: "agent", state: "start" }),
		onDelta: (kind, delta, draft, reset) =>
			broadcast({ type: "delta", kind, delta, ...(draft ? { draft: true } : {}), ...(reset ? { reset: true } : {}) }),
		onDraftResync: (segments) => broadcast({ type: "draft_resync", segments }),
		onWorkspace: (workspace) => broadcast({ type: "draft_workspace", workspace: workspaceView(workspace), streaming: stage.isStreaming }),
		onReplyRevised: () => resyncAll(),
		onStreamClear: () => broadcast({ type: "stream", state: "clear" }),
		onNotify: (level, text) => broadcast({ type: "notify", level, text }),
		onActivity: (detail) => broadcast({ type: "activity", activity: { kind: "note", name: "stage", detail } }),
		onTurnEnd: (info) => {
			broadcast({ type: "agent", state: "end" });
			// reroll/编辑输入后无产出（aborted 无落树 / error）：回退到 reroll 前的旧叶——
			// 不许留下「只有 user 没有回复」的空拍（8/05：reroll 链上停止，前版本全消失）。
			if (rerollFallbackLeaf && !info.revisedEntryId && (!info.entryId || info.error)) {
				const sm = session.sessionManager;
				if (sm.getLeafId() !== rerollFallbackLeaf) {
					try {
						session.setLeaf(rerollFallbackLeaf);
					} catch {
						// 回退失败不致命：保持当前状态
					}
				}
			}
			rerollFallbackLeaf = null;
			resyncAll();
			const stats = safeStats();
			if (stats) broadcast({ type: "stats", stats });
			// 向量记忆入库：只在真落了新正文时（中断/错误拍不入）
			if (info.mode === "authoring") return;
			// agent 模式：正文是文件，不是讨论——检查点里新增的文件逐个入库（修改/改名不入）
			if (info.mode === "agent") {
				if (!info.checkpoint?.added.length || info.aborted || !info.entryId) return;
				const agentNodeId = info.entryId;
				const agentBranchIds = branchNodeIds();
				void (async () => {
					for (const f of info.checkpoint!.added) {
						try {
							const mem = await onNarrativeTurnEnd(cwd, memoryScopeFor(), f.text, { nodeId: agentNodeId, branchIds: agentBranchIds });
							if (mem.error) broadcast({ type: "notify", level: "warning", text: t("向量记忆：{file} 入库失败 · {error}", { file: f.name, error: mem.error }) });
							else if (mem.stored) broadcast({ type: "notify", level: "info", text: t("向量记忆：{file} 已入剧情库", { file: f.name }) });
						} catch (e) {
							console.warn("[memory] story file ingest failed", e);
						}
					}
				})();
				return;
			}
			if (!info.entryId || info.error || info.aborted) return;
			// 树坐标在进异步块前同步取（同上：随后的重roll 会挪叶）。这条路径已有 info.entryId
			// 就是本拍的落树节点，直接用它当 nodeId 最准。
			const memNodeId = info.entryId;
			const memBranchIds = branchNodeIds();
			void (async () => {
				try {
					const msgs = branchMessages() as Array<{ role?: string; content?: unknown }>;
					let lastText = "";
					for (let i = msgs.length - 1; i >= 0; i--) {
						const m = msgs[i];
						if (m?.role !== "assistant" || messageMode(m) === "authoring") continue;
						const c = m.content;
						if (typeof c === "string") lastText = c;
						else if (Array.isArray(c)) {
							lastText = c
								.map((p) =>
									p && typeof p === "object" && (p as { type?: string }).type === "text"
										? String((p as { text?: string }).text ?? "")
										: "",
								)
								.join("");
						}
						if (lastText.trim()) break;
					}
					const mem = await onNarrativeTurnEnd(
						cwd,
						memoryScopeFor(),
						lastText,
						{ nodeId: memNodeId, branchIds: memBranchIds },
					);
					if (mem.error) {
						broadcast({ type: "notify", level: "warning", text: t("向量记忆：入库失败 · {error}", { error: mem.error }) });
					} else if (mem.stored) {
						const how = mem.merged ? t("合并入已有条目") : t("新开条目");
						broadcast({ type: "notify", level: "info", text: t("向量记忆：剧情库{how}（第 {n} 轮 · 当前对话）", { how, n: mem.counter }) });
					}
				} catch (e) {
					console.warn("[memory] auto ingest failed", e);
				}
			})();
		},
	},
});

/** 台上或旧循环任一在流式中（守卫共用） */
const storyStreaming = (): boolean => session.isStreaming || stage.isStreaming;

/**
 * 手动压缩（/compact 与 WS compact 帧共用）：走台上引擎自管压缩（M4）。
 * 摘要落 rp-summary 后 resyncAll——重放时被覆盖的楼层照旧全在（树只追加），
 * 变的只是**送模上下文**：装配时那段改由【前情提要】代替。
 */
const hostCompact = async (): Promise<void> => {
	broadcast({ type: "compaction", state: "start" });
	const r = await stage.compactNow();
	broadcast({ type: "compaction", state: "end", ok: r.kind === "compacted" });
	if (r.kind === "compacted") {
		broadcast({
			type: "notify",
			level: "info",
			text: t("前情已压缩：{turns} 拍 {chars} 字 → 摘要 {summary} 字", { turns: r.turns, chars: r.chars, summary: r.summary.length }),
		});
		resyncAll();
	} else if (r.kind === "failed") {
		broadcast({ type: "notify", level: "error", text: t("压缩失败：{error}", { error: r.error }) });
	} else if (r.kind === "stale") {
		broadcast({ type: "notify", level: "warning", text: t("压缩已丢弃（期间切换了分支）") });
	} else {
		broadcast({
			type: "notify",
			level: "info",
			text: r.reason === "busy" ? t("正在演出中，稍后再压缩") : t("早期剧情还不够长，暂不需要压缩"),
		});
	}
};

/** 发送用户输入（含斜杠命令；命令后全量对齐所有端） */
const handlePrompt = async (text: string) => {
	const trimmed = text.trim();
	// ST 式变体：无参 /reroll 与 /swipe 由宿主处理（需重开一拍，扩展命令上下文无此能力）
	if (/^\/reroll\s*$/i.test(trimmed)) {
		if (storyStreaming()) {
			broadcast({ type: "notify", level: "warning", text: t("请等当前回复完成（或先停止），再{what}", { what: t("重新生成") }) });
			return;
		}
		await regenerateSwipe();
		return;
	}
	// M-D6 R1：有参 /reroll（前端编辑用户消息）同样在宿主拦截，走 StageEngine——
	// 之前漏到 pi 跑无台上装配的裸 LLM 回合（无预设拆层/无工作区/无验收器）。
	const rerollArgMatch = /^\/reroll\s+(.+)/i.exec(trimmed);
	if (rerollArgMatch) {
		if (storyStreaming()) {
			broadcast({ type: "notify", level: "warning", text: t("请等当前回复完成（或先停止），再{what}", { what: t("重新生成") }) });
			return;
		}
		const userId = lastStoryUserId();
		if (!userId) {
			broadcast({ type: "notify", level: "error", text: t("没有可重新生成的剧情轮（需要先有一条用户输入）") });
			return;
		}
		const sm = session.sessionManager;
		// 记录编辑前的叶：生成失败/停止无产出时回退到旧输入+旧回复
		rerollFallbackLeaf = sm.getLeafId();
		// 编辑输入 = **替换**该输入：钉到它的 parent，旧输入连同旧回复进旁支——
		// 树上不再有「旧输入 + 新输入」两条 user（8/05 实弹：编辑后 reroll，屏上两条输入都在）。
		// 与无参 reroll（regenerateSwipe，branch(userId) 保留输入重roll回复）语义不同。
		const branch = sm.getBranch() as Array<{ id?: string; parentId?: string }>;
		const userEntry = branch.find((e) => e.id === userId);
		const parentId = userEntry?.parentId;
		if (parentId && parentId !== userId) {
			if (sm.getLeafId() !== parentId) session.setLeaf(parentId);
		} else if (sm.getLeafId() !== userId) {
			// 旧输入是根（无 parent）：无法替换，退而保留输入本身
			session.setLeaf(userId);
		}
		// 追加编辑后的用户消息
		session.appendMessage({ role: "user", content: [{ type: "text", text: rerollArgMatch[1].trim() }], timestamp: Date.now() });
		sm.flush();
		resyncAll();
		await stage.regenerate();
		return;
	}
	// 开场白切换：宿主层处理，保证「同一条替换」而非叠楼
	const greetingMatch = /^\/greeting(?:\s+(.*))?$/i.exec(trimmed);
	if (greetingMatch) {
		if (storyStreaming()) {
			broadcast({ type: "notify", level: "warning", text: t("请等当前回复完成（或先停止），再{what}", { what: t("切换开场白") }) });
			return;
		}
		await hostSwitchGreeting(greetingMatch[1] ?? "");
		return;
	}
	const swipeMatch = /^\/swipe(?:\s+(prev|next|new))?\s*$/i.exec(trimmed);
	if (swipeMatch) {
		if (storyStreaming()) {
			broadcast({ type: "notify", level: "warning", text: t("请等当前回复完成（或先停止），再{what}", { what: t("切换回复变体") }) });
			return;
		}
		const dir = (swipeMatch[1]?.toLowerCase() ?? "next") as "prev" | "next" | "new";
		await handleSwipe(dir);
		return;
	}
	// /compact：台上引擎自管压缩（PLAN-RP-HARNESS M4）。
	// 旧路径 session.compact() 压的是 pi 的消息副本，看不全引擎写进树的东西
	// （rp-draft-op 补丁 / rp-state 快照 / 引擎直落的 assistant）——长局压不动，故整体让位。
	const compactMatch = /^\/compact(?:\s+(.*))?$/i.exec(trimmed);
	if (compactMatch) {
		if (storyStreaming()) {
			broadcast({ type: "notify", level: "warning", text: t("请等当前回复完成（或先停止），再{what}", { what: t("压缩上下文") }) });
			return;
		}
		await hostCompact();
		return;
	}

	// 只有已注册的命令可走命令通道。路径、// 与未知斜杠文本仍是当前模式的用户输入，
	// 必须经过台上的上下文投影，不能落入裸 pi 生成。
	// 与 AgentSession 的命令解析相同：命令名止于第一个 ASCII 空格。
	const commandName = trimmed.startsWith("/") ? trimmed.slice(1).split(" ", 1)[0] : undefined;
	const isCommand = !!commandName && !!session.extensionRunner.getCommand(commandName);
	if (!isCommand) {
		broadcast({
			type: "message",
			message: { channel: "user", name: names.userName, text: trimmed, ...(stage.mode !== "roleplay" ? { mode: stage.mode } : {}) },
		});
		// 流式中送达的输入由引擎排队到本拍结束（RP 语境：不打断正在进行的叙事）
		await stage.performTurn(trimmed);
		return;
	}
	await session.prompt(trimmed, session.isStreaming ? { streamingBehavior: "followUp" } : undefined);
	// 斜杠命令可能改写历史（/rewind /reroll /import）或注入消息：全量对齐
	{
		// /import：前情块是 custom 消息，SessionManager 在「尚无 assistant 回复」的
		// 新会话里默认不落盘（防空会话刷屏）——导入的会话没有回复也必须持久化，
		// 否则重启/切会话后整段前情蒸发、会话列表里也找不到（用户实测踩中）。
		if (/^\/import\b/i.test(trimmed)) {
			session.sessionManager.flush();
		}
		resyncAll();
	}
};

/** 流式中禁止的操作统一挡下 */
const refuseWhileStreaming = (ws: WebSocket, what: string): boolean => {
	if (!storyStreaming()) return false;
	ws.send(JSON.stringify({ type: "notify", level: "warning", text: t("请等当前回复完成（或先停止），再{what}", { what }) } satisfies ServerFrame));
	return true;
};

// ---------- 会话-卡绑定（PLAN-PHASE3 §2.1）：读文件头解析 rp-card，mtime 缓存 ----------

const cardCache = new Map<string, { mtimeMs: number; info: { card: string; name: string } | null }>();

const readSessionCard = (path: string, mtimeMs: number): { card: string; name: string } | null => {
	const cached = cardCache.get(path);
	if (cached && cached.mtimeMs === mtimeMs) return cached.info;
	// 扫描实现在 src/session-scan.ts（迁移器按同一判据给会话分卡）；这里只管 mtime 缓存
	const info = readSessionCardInfo(path);
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
 * - 其他卡 → 隐藏（即使是「当前打开」也不把同卡以外的旁支拉进列表）
 * - 无标记：不列入（session_start 会补写）
 * - 当前打开且绑定当前卡：标 current；当前打开却属其它卡：不列入（应已被 switchToCard 切走）
 * - 列表为空且进程有打开会话 → 兜底补一条「当前会话」
 */
const sessionInfos = async () => {
	// 每次列表前刷新卡路径，避免换卡后仍用旧 cardPath 滤错
	refreshNamesFromConfig();
	// 两层布局：当前卡是 cards/ 卡文件夹 ⇒ 会话散在各子项目里，聚合起来
	// （rp-card 过滤退役——子项目目录本身就是归属）；否则走老路径（pi 默认目录 + 卡过滤）。
	const chatEntries = chatSessionsOf(cwd, cardPath);
	// pi 的 listAll/list 只收**目录**（listSessionsFromDir 会 readdir）——传会话文件会
	// ENOTDIR 被吞、返回空。按子项目去重目录再列。
	const all = chatEntries
		? (await Promise.all([...new Set(chatEntries.map((e) => dirname(e.path)))].map((p) => SessionManager.listAll(p)))).flat()
		: await SessionManager.list(cwd);
	// 两层布局：会话文件所在目录即其子项目的会话目录——目录→chatId 一张表。
	// 用 chatsOfCard 全量子项目建表（含还没有会话文件的空项目）——否则新建项目后的
	// 当前会话（惰性、未落盘）认不出所属项目，会游离在树外。
	const chatOfDir = new Map<string, string>();
	if (chatEntries) for (const c of chatsOfCard(cwd, cardPath) ?? []) chatOfDir.set(c.sessionsDir, c.id);
	const chatIdOf = (p: string): string | undefined => chatOfDir.get(dirname(p));
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
		card?: string;
		chatId?: string;
	}> = [];
	const belongsHere = (card: string | undefined) => {
		if (!cardPath) return false; // 未配置卡：不铺开历史
		return sameCardPath(card, cardPath, cwd);
	};
	for (const s of all) {
		const mtime = s.modified instanceof Date ? s.modified.getTime() : Number(s.modified) || 0;
		// 新建后 mtime 刚变：清掉可能过期的卡缓存再读
		if (cardCache.has(s.path)) {
			const c = cardCache.get(s.path)!;
			if (c.mtimeMs !== mtime) cardCache.delete(s.path);
		}
		const info = readSessionCard(s.path, mtime);
		const isCurrent = s.id === curId || isSameSessionPath(s.path, curFile);
		// 两层布局不过滤：文件在这张卡的子项目目录里就是这张卡的，rp-card 标记只作显示
		// （issue #11：重绑定行漂到文件中部时按标记过滤会把会话藏掉）。
		// 老布局严格按卡过滤：其它卡一律不出现（含「当前打开却属其它卡」——由换卡流程切会话）。
		if (!chatEntries && (!info || !belongsHere(info.card))) {
			// 仅当「当前会话尚未打上标记」时保留入口，避免新建后列表空白
			if (!(isCurrent && !info && cardPath)) continue;
		}
		const preview = readSessionPreview(s.path, mtime);
		const chatId = chatIdOf(s.path);
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
			...(info?.card ? { card: info.card } : cardPath ? { card: cardPath } : {}),
			...(chatId ? { chatId } : {}),
		});
	}
	// 兜底：列表里没有任何 current，但进程确有打开会话 → 按 id/路径补一条（须属当前卡或无标记）
	if (curId && !list.some((x) => x.current)) {
		const mine = all.find((s) => s.id === curId || isSameSessionPath(s.path, curFile));
		if (mine) {
			const mtime = mine.modified instanceof Date ? mine.modified.getTime() : Number(mine.modified) || 0;
			const info = readSessionCard(mine.path, mtime);
			// 打开中的会话若明确属于其它卡：不塞进本卡列表（避免「切卡后仍见旧卡」）
			if (info && !belongsHere(info.card)) {
				// skip foreign current
			} else {
				const preview = readSessionPreview(mine.path, mtime);
				const chatId = chatIdOf(mine.path);
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
						...(info?.card ? { card: info.card } : cardPath ? { card: cardPath } : {}),
						...(chatId ? { chatId } : {}),
					});
				}
			}
		} else {
			// 惰性落盘：首条 assistant 前会话文件可能尚未出现在 SessionManager.list
			let cardName = names.charName;
			let boundCard = cardPath;
			try {
				const entries = session.sessionManager.getEntries() as Array<{
					type?: string;
					customType?: string;
					data?: { name?: string; card?: string };
				}>;
				for (let i = entries.length - 1; i >= 0; i--) {
					const e = entries[i];
					if (e?.type === "custom" && e.customType === "rp-card") {
						if (typeof e.data?.name === "string" && e.data.name) cardName = e.data.name;
						if (typeof e.data?.card === "string" && e.data.card) boundCard = e.data.card;
						break;
					}
				}
			} catch {
				// 极早期生命周期：回落显示名
			}
			if (!boundCard || belongsHere(boundCard)) {
				let messageCount = 0;
				try {
					messageCount = session.messages?.length ?? 0;
				} catch {
					messageCount = 0;
				}
				const chatId = chatIdOf(curFile || "");
				list.push({
					path: curFile || "",
					id: curId,
					firstMessage: "",
					modified: Date.now(),
					messageCount,
					current: true,
					cardName,
					...(boundCard ? { card: boundCard } : {}),
					...(chatId ? { chatId } : {}),
				});
			}
		}
	}
	list.sort((a, b) => b.modified - a.modified);
	return list;
};

const listSessions = async (): Promise<ServerFrame> => {
	// 两层布局附子项目清单（含空子项目，前端两层树用）；老布局不带 chats ⇒ 前端回落扁平列表
	const chats = chatsOfCard(cwd, cardPath);
	return {
		type: "sessions",
		list: await sessionInfos(),
		...(chats
			? {
					chats: chats.map((c) => ({
						id: c.id,
						...(c.meta.name ? { name: c.meta.name } : {}),
						createdAt: c.meta.createdAt,
						modified: c.modified,
						sessionCount: c.sessionCount,
						...(c.meta.mode === "agent" ? { mode: "agent" as const } : {}),
					})),
				}
			: {}),
	};
};

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
	const chatEntries = chatSessionsOf(cwd, cardPath);
	const all = chatEntries
		? (await Promise.all([...new Set(chatEntries.map((e) => dirname(e.path)))].map((p) => SessionManager.listAll(p)))).flat()
		: await SessionManager.list(cwd);
	const found = all.find((s) => isSameSessionPath(s.path, path));
	if (!found) throw new Error(t("不是本项目的会话文件"));
	return found;
};

wss.on("connection", (ws, req) => {
	// 访问密码闸门：WS 与 REST 同一套 Cookie 凭据
	if (!requestAuthed(req)) {
		ws.close(4401, "unauthorized");
		return;
	}
	clients.add(ws);
	wsAlive.set(ws, true);
	ws.on("pong", () => wsAlive.set(ws, true));
	ws.send(JSON.stringify(helloFrame()));
	// hello already restores the active beat and its stream; another start would erase that snapshot.
	// 在线更新状态：新连接即对齐（有新版/就绪时主页 chip 才能亮）
	if (updateState.phase !== "none")
		ws.send(JSON.stringify({ type: "update", update: { ...updateState, supervised: UPDATE_SUPERVISED } } satisfies ServerFrame));
	// 断线重连 / 新端接入：补发当前挂起的决策询问（未决卡不随 hello 历史走）
	for (const [id, p] of pendingChoices) ws.send(JSON.stringify(choiceFrame(id, p)));
	for (const request of cardPreviews.pending()) ws.send(JSON.stringify({ type: "card_preview", ...request }));
	for (const request of screenshots.pending()) ws.send(JSON.stringify({ type: "screenshot", ...request }));

	ws.on("message", (data) => {
		wsAlive.set(ws, true); // 任何入站帧都算活着——前端 20s 应用层 ping 覆盖 pong 迟到的情况
		void (async () => {
			let frame: ClientFrame;
			try {
				frame = JSON.parse(String(data)) as ClientFrame;
			} catch {
				return;
			}
			try {
					switch (frame.type) {
						case "draft_history": {
							const draft = stage.getWorkspaces().find((d) => d.id === frame.id);
							if (!draft) throw new Error(t("当前分支没有这份稿件。"));
							ws.send(JSON.stringify({ type: "draft_history", id: draft.id, revisions: draft.revisions } satisfies ServerFrame));
							break;
						}
						case "draft_restore": {
							if (stage.getWorkspace()?.id !== frame.id) throw new Error(t("只能恢复当前拍的稿件版本。"));
						const restored = stage.restoreDraft(frame.id, frame.version, frame.expectedVersion);
						if (restored.entryId) {
							resyncAll();
							}
							broadcast({ type: "draft_workspace", workspace: workspaceView(restored), streaming: stage.isStreaming });
							break;
						}
					case "conversation_mode": {
						if (!isConversationMode(frame.mode)) throw new Error(t("未知会话模式。"));
						if (storyStreaming()) throw new Error(t("请等当前回复完成（或先停止），再{what}", { what: t("切换模式。") }));
						stage.setMode(frame.mode);
						break;
					}
					case "prompt": {
						const text = String(frame.text ?? "").trim();
						if (text) await handlePrompt(text);
						break;
					}
					case "abort": {
						// 强制停止：按下即收敛 UI/选择卡，再撕掉本拍（台上引擎 + 旧循环）
						for (const id of [...pendingChoices.keys()]) settleChoice(id, { stop: true });
						if (session.isStreaming && !stage.isStreaming) broadcast({ type: "agent", state: "end" });
						stage.abort(); // 引擎自会以 aborted 谢幕（半拍正文保留）
						void session.abort().catch((err) => {
							console.error(`[liyuan] abort 失败：${err instanceof Error ? err.message : String(err)}`); // i18n-ignore：终端日志
						});
						break;
					}
					case "reroll": {
						if (refuseWhileStreaming(ws, t("重新生成"))) return;
						const t = String(frame.text ?? "").trim();
						// 无参 = ST sibling 变体；有参 = 改用户文案后整轮重来（扩展 /reroll）
						await handlePrompt(t ? `/reroll ${t}` : "/reroll");
						break;
					}
					case "swipe": {
						if (refuseWhileStreaming(ws, t("切换回复变体"))) return;
						const dir = frame.dir === "prev" || frame.dir === "next" || frame.dir === "new" ? frame.dir : "next";
						await handleSwipe(dir);
						break;
					}
					case "compact":
						if (refuseWhileStreaming(ws, t("压缩上下文"))) return;
						await hostCompact();
						break;
					case "sessions":
						ws.send(JSON.stringify(await listSessions()));
						break;
					case "open": {
						if (refuseWhileStreaming(ws, t("切换会话"))) return;
						const path = String(frame.path ?? "");
						if (!path || path === session.sessionFile) return;
						await runtime.switchSession(path);
						broadcast({ type: "notify", level: "info", text: t("已切换会话") });
						break;
					}
					case "new":
						if (refuseWhileStreaming(ws, t("新建会话"))) return;
						// 幂等短路（8/29）：当前已是干净的新会话（分支上没有任何剧情 user 消息）时，
						// 再建一个**语义等价**——同一张卡、同样的开局——却要付一次 hello 帧的全量界面
						// 重建（messages 整体替换 + 卡皮肤重挂 + 会话列表清空重拉），还在会话列表里
						// 堆一个空会话。这正是「哪怕单纯重复点击也刷新一次」的来源。
						// 幂等短路只对老布局成立（同 sessionDir 下再建一个语义等价的空会话是浪费）；
						// cards/ 卡上「新开对话」永远是新子项目，没有等价一说，不短路。
						if (!lastStoryUserId() && !resolveCardSpace(cwd, cardPath)) {
							ws.send(JSON.stringify({ type: "notify", level: "info", text: t("当前已是新会话") } satisfies ServerFrame));
							return;
						}
						// 两层布局：完全新开对话＝新建一个子项目——给 runtime 换一个
						// 新 sessionDir 上的干净会话（换 runtime 是 pi 提供的唯一切 sessionDir 通道，
						// switchSession 只能在既有文件间切）。同一子项目里再开会话＝
						// 「第二个窗口继续聊」，由 switchSession/open 承担。老布局走 runtime.newSession()。
						// name＝新建项目弹窗起的名（缺省前端已给「新建对话（N）」默认名）。
						const newName = typeof frame.name === "string" ? frame.name.trim() || undefined : undefined;
						// mode:"agent"＝新建一个 agent 子项目（docs/PLAN-AGENT-MODE.md §5.1：形态在建项目时定）；老布局不支持
						const newMode = frame.mode === "agent" ? "agent" : undefined;
						const freshDir = newChatSessionDir(cwd, cardPath, newName, newMode);
						if (newMode && !freshDir) {
							ws.send(JSON.stringify({ type: "notify", level: "error", text: t("agent 模式只在 cards/ 的子项目里可用") } satisfies ServerFrame));
							return;
						}
						if (freshDir) {
							// agent 子项目：用户选的开场白落成稿子第一个文件（docs/PLAN-AGENT-CODING.md §十三）——素材进稿子是用户的动作，不是注入
							if (newMode && Number.isInteger(frame.greeting) && frame.greeting! >= 0) {
								const chatDir = chatDirOfSessionDir(freshDir);
								const card = loadCardFile(isAbsolute(cardPath) ? cardPath : join(cwd, cardPath));
								const pool = [card.firstMes, ...card.alternateGreetings];
								const mes = pool[frame.greeting!];
								if (chatDir && typeof mes === "string" && mes.trim()) {
									const dir = storyDirectory(chatDir);
									mkdirSync(dir, { recursive: true });
									writeFileSync(join(dir, "000-开场.md"), applyMacros(mes, { charName: card.name, userName: loadConfig(cwd).userName }), "utf8"); // i18n-ignore：稿子文件名是协议
									new StoryHistory(chatDir).commit({ author: "user", message: t("开场白落成第一个文件") });
								}
							}
							const previousSessionFile = session.sessionFile;
							// 按 pi 的 teardownCurrent 同款收尾旧会话（session_shutdown → 扩展收尾 → dispose），
							// 不能只丢引用：roleplay.ts 在 shutdown 事件里落盘收尾。
							await runtime.dispose();
							runtime = await createAgentSessionRuntime(createRuntime, {
								cwd,
								agentDir: getAgentDir(),
								sessionManager: SessionManager.create(cwd, freshDir),
								sessionStartEvent: { type: "session_start", reason: "new", previousSessionFile },
							});
							wireRuntimeHooks();
							await bindSession();
							resyncAll();
						} else {
							await runtime.newSession();
						}
						broadcast({ type: "notify", level: "info", text: t("已新建会话") });
						break;
					case "story_restore": {
						// docs/PLAN-AGENT-CODING.md §4.3：files＝只重写 正文/（讨论不动）；both＝再把讨论截到那轮输入之前。
						if (refuseWhileStreaming(ws, t("恢复"))) return;
						const chatDir = agentChatDir();
						if (!chatDir) throw new Error(t("当前不是 agent 子项目"));
						const history = new StoryHistory(chatDir);
						const target = history.get(String(frame.checkpointId ?? ""));
						if (!target) throw new Error(t("没有这个检查点"));
						const both = frame.scope === "both" && !!target.turnId;
						if (both) {
							// 目标＝那轮 user 条目的父节点：那次输入还没发出的状态。底层仍是 pi 的叶子移动，但不提供树导航入口。
							const branch = session.sessionManager.getBranch() as Array<{ id?: string; parentId?: string | null }>;
							const at = branch.findIndex((e) => e.id === target.turnId);
							if (at < 0) throw new Error(t("那轮输入不在当前会话里，只能恢复文件"));
							const parent = branch[at]!.parentId ?? null;
							if (parent !== session.sessionManager.getLeafId()) {
								if (parent === null) session.sessionManager.resetLeaf(); // 那轮是首条输入：回到空树
								else {
									const result = await session.navigateTree(parent, { summarize: false });
									if (result.cancelled) return;
								}
							}
						}
						// 文件回到「那次改动之前」（both）或「那次改动之后」（files）——both 是回到输入前，文件也该是输入前的样子
						const all = history.list();
						const idx = all.findIndex((c) => c.id === target.id);
						const fileTarget = both ? all[idx - 1] : target;
						let cp: Checkpoint | undefined;
						if (fileTarget) cp = history.restore(fileTarget.id) ?? undefined;
						else {
							// 第一条检查点之前＝空稿子
							for (const f of listStoryFiles(storyDirectory(chatDir))) rmSync(join(storyDirectory(chatDir), f.name));
						}
						// both 且文件本来就一样：仍落一条空改动的检查点——树上要有它，pi 重载时叶子才停在截断处（叶子＝文件里最后一条）
						if (!cp && both) cp = history.commit({ author: "user", message: t("回到「{message}」之前", { message: target.message }), restoredFrom: target.id, force: true });
						if (cp) {
							const { files: _files, ...lite } = cp;
							session.sessionManager.appendCustomEntry(STORY_CHECKPOINT_TYPE, lite);
							session.sessionManager.flush();
						}
						resyncAll();
						broadcast({ type: "notify", level: "info", text: both ? t("已恢复文件并回到那次输入之前。") : t("已恢复文件；讨论不变。") });
						break;
					}
					case "chat_new_session": {
						if (refuseWhileStreaming(ws, t("新建会话"))) return;
						// 「第二个窗口继续聊」＝在指定子项目里再开一个会话。当前子项目：
						// runtime.newSession() 复用 sessionDir；别的子项目：换 runtime 落进
						// 它的会话目录（换 runtime 是 pi 唯一切 sessionDir 的通道）。
						const chatId = String(frame.chatId ?? "");
						const target = chatsOfCard(cwd, cardPath)?.find((c) => c.id === chatId);
						if (!target) {
							ws.send(
								JSON.stringify({ type: "notify", level: "error", text: t("子项目不存在（或当前卡不在 cards/）") } satisfies ServerFrame),
							);
							return;
						}
						const currentChatDir = chatDirOfSessionDir(session.sessionManager.getSessionDir());
						if (currentChatDir && currentChatDir === target.dir) {
							await runtime.newSession();
						} else {
							const previousSessionFile = session.sessionFile;
							// 按 pi 的 teardownCurrent 同款收尾旧会话（session_shutdown → 扩展收尾 → dispose），
							// 不能只丢引用：roleplay.ts 在 shutdown 事件里落盘收尾。
							await runtime.dispose();
							runtime = await createAgentSessionRuntime(createRuntime, {
								cwd,
								agentDir: getAgentDir(),
								sessionManager: SessionManager.create(cwd, target.sessionsDir),
								sessionStartEvent: { type: "session_start", reason: "new", previousSessionFile },
							});
							wireRuntimeHooks();
							await bindSession();
							resyncAll();
						}
						broadcast({ type: "notify", level: "info", text: t("已新建会话") });
						break;
					}
					case "ping":
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
	console.log(`[liyuan] ${names.charName} 已就位（会话 ${session.sessionId.slice(0, 8)}…）`); // i18n-ignore：终端日志
	console.log(`[liyuan] agent 目录 ${agentHome}`); // i18n-ignore：终端日志
	for (const line of takeAgentMergeLog()) {
		console.log(`[liyuan] 迁移 ${line}`); // i18n-ignore：终端日志
	}
	console.log(`[liyuan] ${urls.join("  |  ")}（手机连同一 Wi-Fi 访问后者；勿暴露公网）`); // i18n-ignore：终端日志
	// 启动时对一次账：装载中的预设与挂载书的镜像（升级前的状态也算）落进卡文件，再刷一次装配
	void restHost.softRefreshConfig().catch(() => {});
});

const shutdown = async () => {
	try {
		unsubscribe?.();
		clearInterval(wsPingTimer);
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
import { applyDraftRevisions } from "../src/stage/draft-projection.ts";
import type { TurnWorkspace } from "../src/stage/workspace.ts";
