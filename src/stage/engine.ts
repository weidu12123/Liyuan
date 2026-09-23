/**
 * 台上一拍的领域逻辑：装配 → pi 生成/工具循环 → 定稿/场记/存档。
 *
 * 生成只经 AgentSession.prompt；真实钩子由 roleplay 扩展注册。
 * 本层保留 RP 的拍级队列、稿纸、合并、媒体与旁路工作，不再自持模型循环。
 */

import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

import { applyProjectedSamplers } from "../samplers.ts";
import { getStageConnection, type StageHooks, type StageToolResult } from "./bridge.ts";
import { DraftStore, draftDirectory, listDrafts } from "./draft-store.ts";
import { applyDraftRevisions, DRAFT_REVISION_TYPE } from "./draft-projection.ts";
import { PreviousDraftEditor } from "./previous-draft.ts";
import { projectToolContext } from "./context.ts";
import { authoringHistory, authoringRequestIds, contextText, conversationMode, CONVERSATION_MODE_TYPE, CONVERSATION_PROCESS_TYPE, isConversationMode, roleplayHistory, type ConversationMode, type ContextMessage } from "../conversation-mode.ts";
import { authoringTools, authoringSystemPrompt, runAuthoringTool, AUTHORING_NATIVE_TOOLS, CONVERSATION_MODE_TOOL } from "./authoring.ts";
import { AGENT_ASK_TOOL, AGENT_SCREENSHOT_TOOL, agentSystemPrompt, buildAgentStateBlock } from "./agent.ts";
import { describeChange, listStoryFiles, STORY_CHECKPOINT_TYPE, StoryHistory, storyDirectory, type ChangeSet } from "./story-history.ts";
import { agentHistory, buildDiscussionSummaryPrompt, DISCUSSION_SUMMARY_TYPE, planDiscussionCompaction } from "./discussion.ts";
import { readFileSync } from "node:fs";
import { createSandboxGate, sandboxGrantsFromBranch, SANDBOX_GRANT_TYPE } from "../sandbox.ts";
import { fileChangeOf } from "../activity-format.ts";
import type { CardDeps } from "../tools/card.ts";
import type { GateInput } from "../tools/gate.ts";
import { extractDraftRules } from "../draft.ts";
import {
	appendOverlayEntry,
	loreFingerprint,
	overlayPathFor,
	scanEntries,
	searchEntries,
} from "../lorebook.ts";
import { formatPanelIndex, formatPanelSnapshot, loadPanels } from "../panels.ts";
import { cardDirOfChatDir, chatDataPath, chatDirOfSessionDir, chatModeOfSessionDir } from "../cardspace.ts";
import { fitResidentSummary, loadResidentSummary } from "../card-memory.ts";
import { changeCardMemory, listCardMemory, readCardMemory, searchCardMemory } from "../card-memory-tools.ts";
import { classifyTag, scanTaggedBlocks } from "../postprocess.ts";
import { formatRosterIndex, formatState, saveState } from "../state.ts";
import { isBackstageText } from "../stance.ts";
import type { LorebookEntry, WorldState } from "../types.ts";
import {
	buildStageInjection,
	buildStageSystemPrompt,
	detectsLanguageMismatch,
	formatLoreIndex,
	rebuildHistory,
	stateFromBranch,
	type BranchEntryLike,
} from "./assemble.ts";
import {
	assemblePresetAfter,
	constantLoreOf,
	loadStageConfig,
	loadStageMaterials,
	readStageSkill,
	type AssembledPiece,
	type StageMaterials,
} from "./materials.ts";
import {
	MANUAL_MIN_COMPACT_CHARS,
	runCompaction,
	SUMMARY_ENTRY_TYPE,
	type CompactOutcome,
	type RpSummaryData,
} from "./compact.ts";
import { runScribeTurn, STATE_ENTRY_TYPE } from "./scribe-run.ts";
import { seedMvuIfNeeded, findMvuRules } from "../mvu.ts";
import {
	MAX_ROUNDS,
	runStageTool,
	stageTools,
	writeTools,
	skillReadTool,
	type MemoryHitLike,
	type StageTool,
	type StageToolDeps,
	type ToolRunResult,
} from "./tools.ts";
import { unifiedStageToolNames } from "../tools/adapters/stage.ts";
import {
	mcpStageTools,
	mcpStageToolNames,
	runMcpStageTool,
	type McpStageDeps,
} from "./mcp-stage.ts";
import {
	mediaStageToolNames,
	mediaStageTools,
	runMediaStageTool,
	type MediaStageResult,
} from "./media-stage.ts";
import type { MemoryChunkLike, MemoryDocument, MemorySearchResult } from "../tools/memory.ts";
import type { WorldlineViewLite } from "../tools/worldline.ts";
import { defaultSaveName } from "../worldline.ts";
import { extractDraftBody } from "../draft.ts";
import {
	createWorkspace,
	commitWorkspace,
	finalTimeline,
	recordSegment,
	reviseDraft,
	restoreDraftVersion,
	runWriteTool,
	workspaceToolBlock,
	type TurnWorkspace,
	type WorkspaceDeps,
} from "./workspace.ts";

// ---------------- 依赖面（结构类型，不引 @liyuan/agent-runtime） ----------------

export interface StageSessionManager {
	getBranch(): unknown[];
	getLeafId(): string | null;
	appendMessage(message: unknown): string;
	appendCustomMessageEntry(customType: string, content: string, display: boolean): string;
	/** CustomEntry（不进 LLM 上下文）：账本快照用 */
	appendCustomEntry(customType: string, data?: unknown): string;
	getSessionId(): string;
	/** 会话所在目录：子项目级数据（面板/账本/世界线）的落点由它派生，见 src/cardspace.ts */
	getSessionDir?(): string;
	flush(): void;
}

export interface StageModelLike {
	id: string;
	provider?: string;
	api?: unknown;
	baseUrl?: string;
	[k: string]: unknown;
}

/** @liyuan/ai streamSimple 的结构子集 */
export type StageStreamFn = (
	model: StageModelLike,
	context: { systemPrompt?: string; messages: unknown[] },
	options?: Record<string, unknown>,
) => AsyncIterable<StageStreamEvent> & { result(): Promise<AssistantMsgLike> };

export interface AssistantMsgLike {
	role: "assistant";
	content: Array<{
		type: string;
		text?: string;
		thinking?: string;
		name?: string;
		arguments?: Record<string, unknown>;
	}>;
	stopReason?: string;
	errorMessage?: string;
	[k: string]: unknown;
}

export interface StageStreamEvent {
	type: string;
	delta?: string;
	contentIndex?: number;
	toolCall?: { name?: string; arguments?: Record<string, unknown> };
	partial?: AssistantMsgLike;
	message?: AssistantMsgLike;
	error?: AssistantMsgLike;
}

export interface StageTurnEndInfo {
	/** Controls derived story writes; an authoring turn stays authoring even after switching back. */
	mode?: ConversationMode;
	aborted: boolean;
	/** 非空 = 本拍以错误收场（已通知，无正文落树） */
	error?: string;
	/** 落树的 assistant 条目 id（错误/空拍时无） */
	entryId?: string;
	/** An existing reply was revised; no new story or memory-ingestion turn was created. */
	revisedEntryId?: string;
	/** agent 模式：本轮落下的检查点（正文/ 有改动才有）；added 带新文件全文，宿主据此入向量记忆 */
	checkpoint?: { id: string; changed: ChangeSet; added: Array<{ name: string; text: string }> };
}

export interface StageEvents {
	onModeChanged?: (mode: ConversationMode) => void;
	onTurnStart?: () => void;
	/** 流式增量（转 WS delta 帧；kind 对应正文/思考通道） */
	/**
	 * 流式增量。draft=true 表示该增量是 draft_write 参数的转发
	 * （稿件流 = 替换语义：多稿重交原地更新，前端不得叠加）；
	 * reset=true 表示本次调用的首个分片（前端据此清掉旧稿）。
	 */
	onDelta?: (kind: "text" | "thinking", delta: string, draft?: boolean, reset?: boolean) => void;
	/**
	 * 中间轮旁白清理：稿落地前的工具轮吐出的 text（读题/计划旁白）已流式上屏，
	 * 但不是正文——通知前端把它收进过程条并从正文区移除（8/09 实弹：读题文字
	 * 先挂在正文顶部、落树后又拼到正文尾部）。
	 */
	onStreamClear?: () => void;
	/**
	 * 稿件分段重同步（修复后）：前端把屏上全部稿段**原位**替换为 segments。
	 * 与 onDelta 的稿件流互补——流式分片管「一段段长出来」，resync 管「原地变新」：
	 * draft_edit 改稿成功后按当前稿全量重切下发，修后的段就是用户看到的段。
	 */
	onDraftResync?: (segments: string[]) => void;
	/** Canonical artifact/plan + current preview; also used on reconnect. */
	onWorkspace?: (workspace: TurnWorkspace) => void;
	/** Refresh the original reply after its revision receipt is durable. */
	onReplyRevised?: (entryId: string) => void;
	onTurnEnd?: (info: StageTurnEndInfo) => void;
	/** 面向用户的告警（宏降级等）；每种只发一次 */
	onNotify?: (level: "info" | "warning" | "error", text: string) => void;
	/** 过程条短句（验收/修订进度；kind:"note" 形态，无需工具名） */
	onActivity?: (detail: string) => void;
}

/**
 * 旁路一次调用的实测回执。存在的理由只有一个：**让用户看得见旁路到底思考没思考、跑了多久**。
 * 所以 thinkChars 是主角——`档 off` 旁边跟着 `思考 6619 字`，这个矛盾本身就是要看的东西
 * （`reasoning:"off"` 在 openai-completions 上会被化成「什么都不发」，端点按自己的默认开思考，
 * 见 openai-completions.ts:511 与 :698-702）。
 */
export interface SideTextStat {
	/** 哪一路旁路 */
	kind: "scribe" | "compact";
	/** provider/id */
	model: string;
	/** 条目名；配了旁路条目才有 */
	entry?: string;
	/** **请求的**思考档（不等于端点真收到了它）；undefined = 连 reasoning 参数都没发 */
	thinking?: string;
	ms: number;
	/** 实收思考字数。0 = 这一发真的没思考 */
	thinkChars: number;
	textChars: number;
}

/** 旁路回执的人话（活动条与服务端日志共用一份措辞） */
export function sideStatLine(s: SideTextStat): string {
	const who = s.entry && s.entry !== s.model ? `${s.entry}（${s.model}）` : s.model;
	return `${s.kind === "scribe" ? "记账" : "压缩"}旁路 ${who}｜${
		s.thinking ? `档 ${s.thinking}` : "未发思考档"
	}｜思考 ${s.thinkChars} 字｜${(s.ms / 1000).toFixed(1)}s`;
}

/** 由 pi 会话独占消息持久化与内存历史。 */
export interface StageAgentSession {
	sessionManager: StageSessionManager;
	prompt(text: string, options: { expandPromptTemplates: false; reuseUserMessage: boolean }): Promise<void>;
	abort(): Promise<void>;
	appendMessage(message: unknown): string;
	getAllTools(): Array<{ name: string }>;
	setActiveToolsByName(names: string[]): void;
	setTurnSystemPrompt(prompt: string): void;
}

export interface StageEngineDeps {
	cwd: string;
	getSession: () => StageAgentSession;
	getModel: () => StageModelLike | undefined;
	/** Shared card services, bound to the host's currently loaded card. */
	authoring?: Partial<CardDeps>;
	/** Runs after the native session is idle, before queued story input resumes. */
	afterAuthoringTurn?: () => Promise<void>;
	getAuth: (model: StageModelLike) => Promise<{ apiKey?: string; headers?: Record<string, string | null> }>;
	/**
	 * 旁路条目（场记记账 / 长局压缩用哪个模型、哪一档）：给出则旁路调用走它，
	 * 不给（或用户没配）则跟随剧情模型 —— 逐字旧行为。
	 *
	 * **模型和档一起给**：两者出自连接配置里同一条模型条目，拆成两个 dep 就会出现
	 * 「模型是这条的、档是那条的」这种对不上的状态。见 RpConfig.sideModel。
	 */
	getSideEntry?: () => { model: StageModelLike; thinking?: string; label?: string } | undefined;
	/** 会话当前思考档（用户自由，引擎透传） */
	getThinking?: () => string | undefined;
	/** 账本磁盘缓存路径（.liyuan-state/<sessionId>.json）；给出则场记落盘（fs.watch → state 帧） */
	getStateFile?: (sessionId: string) => string | undefined;
	/** 剧情库检索（memory_search 工具用）；未注入 = 该工具恒返回无命中 */
	searchMemory?: (sessionId: string, query: string) => Promise<MemoryHitLike[] | MemorySearchResult>;
	readMemory?: (sessionId: string, ref: string) => MemoryDocument | undefined;
	/**
	 * 每拍被动召回（【剧情记忆】注入用）：宿主按「当前对话 + 当前卡」绑 MemoryScope 后
	 * 调 memoryRecallForTurn，受设置里「每轮自动检索并注入模型」开关管辖。
	 * 未注入 = 无【剧情记忆】块（该块的语义 system 里已说明，出不出块按有无数据）。
	 */
	recallMemory?: (sessionId: string, query: string) => Promise<MemoryHitLike[]>;
	/**
	 * 向量库写侧三件（M-D3）。均由宿主按「当前对话 + 当前卡」绑定 MemoryScope 后注入——
	 * **作用域不经模型**（PLAN-RP-TOOLING M-D3：scope 全隐藏），引擎只透传 sessionId。
	 * 未注入 = 台上无对应工具（依赖缺失的工具不上清单）。
	 */
	addMemory?: (
		sessionId: string,
		input: { text: string; title?: string },
	) => Promise<{ added: number; total: number; chunks: number }>;
	listMemory?: (sessionId: string, storeId: string) => MemoryChunkLike[];
	deleteMemory?: (sessionId: string, storeId: string, id: string) => boolean;
	/**
	 * 面板读写（M-D5）。由宿主按当前会话绑定 artifacts 文件后注入。
	 * 未注入 = 台上无面板工具（依赖缺失的工具不上清单）。
	 */
	loadPanels?: (sessionId: string) => Record<string, { name: string; kind: "markdown" | "svg" | "html"; content: string; archived?: boolean }>;
	writePanel?: (sessionId: string, input: { name: string; kind: string; content: string; data?: Record<string, unknown> }) => { ok: true; created: boolean; reopened: boolean; activeCount: number; overLimit: boolean } | { ok: false; error: string };
	closePanel?: (sessionId: string, name: string) => { ok: boolean; error?: string };
	/**
	 * 世界线存档表（worldline_list 工具用）。宿主摊平后注入
	 * （`flattenWorldlineSaves(buildWorldlineView(...))`）——树形归展示面，工具面要表。
	 * 未注入 = 台上无 worldline_list。写侧（store/back）不上台，理由见 src/tools/worldline.ts 文件头。
	 */
	loadWorldline?: (sessionId: string) => WorldlineViewLite;
	/**
	 * 钉一个存档点（`worldline_store`，M-D7）。**封笔后调用**——引擎在场记之后执行，
	 * 那时 rp-state 刚落、面板快照也已随写入落在分支上，回退到此点状态才对得齐。
	 * 分线与否由宿主按钉档那一刻的树形算（planNewSave），不经模型。
	 * 未注入 = 台上无 worldline_store。
	 */
	storeSave?: (sessionId: string, name: string) => { id: string; name: string; worldlineName: string } | null;
	/** 被压缩裁掉的早期正文归档进剧情库（供 memory_search 召回细节）；未注入 = 只落摘要不归档 */
	archiveCompacted?: (sessionId: string, text: string) => Promise<void>;
	/**
	 * 世界书条目启停落盘（lorebook_toggle 工具用，M-D2）：写 config.disabledLore 并重装素材。
	 * 由宿主注入——落盘与热重载归 server/ 侧（引擎不碰 server 的 writeJsonWithBackup）。
	 * 未注入 = 台上无 lorebook_toggle 工具。
	 */
	setDisabledLore?: (fingerprints: string[], enabled: boolean) => number;
	/**
	 * 世界书写侧宿主件（M-D7）：改/删条目、列书单、建书、挂载，以及带来源标记的列举。
	 *
	 * 为什么整包归宿主而不是引擎自己干：写的是**用户的书文件**，写完还要迁移
	 * `config.disabledLore` 里的指纹、热重载素材、通知前端——config 落盘与热重载都在
	 * server/ 侧（引擎不碰 writeJsonWithBackup，与 setDisabledLore 同一条理由）。
	 *
	 * 未注入 = 台上退回旧行为：写只落补充设定集、列举不带来源标记、无改/删/书一级工具。
	 */
	loreHost?: {
		write: (input: { title: string; keys: string[]; content: string; constant?: boolean; book?: string }) => LorebookEntry | null;
		update: (
			fingerprint: string,
			patch: { title?: string; keys?: string[]; content?: string; constant?: boolean },
		) => { entry: LorebookEntry; newFingerprint: string; path: string } | null;
		remove: (fingerprint: string) => { entry: LorebookEntry; path: string } | null;
		listMarked: () => Array<LorebookEntry & { agentWritten?: boolean }>;
		listBooks: () => { books: Array<{ path: string; name: string; entryCount: number }>; mounted: string[] };
		createBook: (
			name: string,
			first: { title: string; keys: string[]; content: string; constant?: boolean },
		) => { path: string; mounted: string[] } | null;
		mountBook: (path: string, mounted: boolean) => string[];
	};
	/**
	 * 改当前角色卡的字段（`card_update`，M-D7）。归宿主：卡字段进 system prompt，
	 * 写完必须热重载（softRefreshConfig 在 server/ 侧）。未注入 = 台上无 card_update。
	 */
	updateCard?: (patch: {
		name?: string;
		description?: string;
		personality?: string;
		scenario?: string;
		firstMes?: string;
		mesExample?: string;
		systemPrompt?: string;
		postHistoryInstructions?: string;
		creatorNotes?: string;
		tags?: string[];
	}) => void;
	/**
	 * MCP 外设（8/06 重新接线）：宿主注入 hub 的两个能力，台上据此挂 mcp__ 工具。
	 * 未注入 = 台上无 MCP 工具（依赖缺失的工具不上清单）。
	 * hub 单例由宿主持有——引擎不自建，避免第二个实例（见 src/mcp.ts 的 globalThis 槽）。
	 */
	mcp?: McpStageDeps;
	/**
	 * 媒体交付工具（8/06 重接）：show_image/audio/video/html + tts。
	 * 与 MCP 同源的断链——消费端（wire.ts）一直健在，缺的是台上生产端。
	 * false/省略 = 不挂（tts 另需服务端 TTS 环境，由 ttsAvailable 决定）。
	 */
	media?: boolean;
	/** TTS 环境是否就绪（未就绪则 tts 不上清单——依赖缺失的工具不上清单） */
	ttsAvailable?: () => boolean;
	/**
	 * 剧情决策询问（ask 工具，P7 接回）：弹出选择卡等用户应答。
	 * 应答 = 用户选择的选项原文（作为新输入回喂模型，计划据此重拟）；
	 * undefined = 用户停止（笔还给用户，本拍收束）。
	 * 未注入 = 台上无 ask 工具（依赖缺失的工具不上清单）。
	 */
	askUser?: (question: string, options: string[], signal?: AbortSignal) => Promise<string | undefined>;
	/**
	 * 截图（agent 模式）：请连接中的页面把当前稿子画面截成 PNG，返回 base64。
	 * null = 没有连接的页面或超时。未注入 = 不上 screenshot 工具。
	 */
	screenshot?: (file: string | undefined, signal?: AbortSignal) => Promise<{ png: string; width: number; height: number } | null>;
	/** 仅供场记/压缩旁路使用；主模型由 pi 调用。 */
	sideStreamFn: StageStreamFn;
	events?: StageEvents;
}

// ---------------- 引擎 ----------------

/**
 * 【剧情记忆】被动召回的超时上限。向量检索正常在秒内返回，但云端 embedding 抽风时
 * 单次可挂几百秒——这是串在扮演之前的旁路调用，超时即放弃，绝不让用户干等。
 */
const RECALL_TIMEOUT_MS = 5000;

const nowMsg = (text: string) => ({
	role: "user",
	content: [{ type: "text", text }],
	timestamp: Date.now(),
});

const textOfAssistant = (m: AssistantMsgLike | null): string => {
	if (!m) return "";
	return m.content
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("");
};

/** 把数据块压在最后一条 user 消息的原话之前（不动树，只改这份送模副本） */
export const prependToLastUser = (history: ContextMessage[], block: string): void => {
	for (let i = history.length - 1; i >= 0; i--) {
		const m = history[i]!;
		if (m.role !== "user") continue;
		if (typeof m.content === "string") m.content = `${block}\n\n${m.content}`;
		else if (Array.isArray(m.content)) {
			const part = m.content.find((p) => p?.type === "text");
			if (part) part.text = `${block}\n\n${part.text ?? ""}`;
			else m.content.unshift({ type: "text", text: block });
		} else m.content = [{ type: "text", text: block }];
		return;
	}
};

/**
 * 定稿合并：稿件为主体；text 通道里**格式特征**的尾巴（状态栏占位 / catsay / w2g…）
 * 拼回，纯文本增量（闲聊收笔）丢弃——树上正文 = 用户最终该看到的全部内容。
 *
 * 模型常把 draft_write 理解成「交正文」，把格式栈尾巴走普通 text 通道输出。
 * 旧逻辑 `ws.draft.trim() ? ws.draft : text` 是二选一，尾巴连同 token 一起被丢弃
 * （8/05 实锤：模型思考里宣告「body, status bar, and cat commentary」，
 * draft_write 只交了 679 字正文，状态栏与咪咪点评凭空蒸发）。
 * 但也不能无脑全拼——纯文本尾巴（"就这样吧。"）是收笔闲聊，不该进正文。
 */
const TAG_NAME_SRC = "[A-Za-z_\\u4e00-\\u9fff][\\w\\u4e00-\\u9fff.\\-]*";
const FENCE_LINE_RE = /^```/m;
const FENCE_BLOCK_RE = /```[\s\S]*?```/g;
/** 逐个扫标签名，用于跳过 fold/strip 类（它们不是格式内容） */
const TAG_SCAN_RE = new RegExp(`<(${TAG_NAME_SRC})(?:\\s[^>]*)?\\/?\\s*>`, "g");
/** 成对块，用于把 fold/strip 类整块从尾巴里剔掉 */
const SELF_CLOSING_RE = new RegExp(`<(${TAG_NAME_SRC})(?:\\s[^>]*)?\\/\\s*>`, "g");

/**
 * 尾巴里格式内容的起点（第一个尖括号标签或行首 ``` 围栏）；没有 → -1。
 *
 * 8/10 实弹收口：旧口径整串检验、整串拼接——元话语（收笔自检逐条、ask 开场白
 * 起了又劝退）挂在格式块前面时跟着一起进定稿（HK 5 会话 11 拍：7 个裸尾巴段
 * 里 3 个带元话语，41 个稿段 0 违约）。改为**只取格式内容**：从第一个标签/围栏
 * 起切，之前的自由文本一律丢弃；纯自由文本尾巴（闲聊收笔）仍整段不进正文。
 */
export const formatTailStart = (tail: string): number => {
	TAG_SCAN_RE.lastIndex = 0;
	let tag = -1;
	for (let m = TAG_SCAN_RE.exec(tail); m; m = TAG_SCAN_RE.exec(tail)) {
		if (classifyTag(m[1]!) === "unwrap") {
			tag = m.index;
			break;
		}
	}
	const fence = FENCE_LINE_RE.exec(tail)?.index ?? -1;
	if (tag < 0) return fence;
	return fence < 0 ? tag : Math.min(tag, fence);
};



/**
 * 尾巴 → **只留格式内容**：格式类标签块 + ``` 围栏块，按原序拼回；块之外的自由文本
 * 一律丢弃。
 *
 * 8/10 只挡了「格式块之前」的自由文本（起点切一刀）。8/16 实弹暴露另一半：模型在
 * 尾巴里把**整段正文重述了一遍**，夹在 `<time_format>` 与 `<options>` 之间——起点切
 * 不到它（它在第一个格式块之后），`trimContentBodyRepeat` 也管不到（它只认
 * `<content>` 包裹的重述）。于是定稿里正文出现两遍。
 *
 * 判据仍是「块 vs 非块」，不认名字：块＝成对标签（policy 由 classifyTag 定，fold/strip
 * 类不算格式内容）或 ``` 围栏。
 */
const formatContentOnly = (tail: string): string => {
	type Span = { start: number; end: number; text: string };
	const spans: Span[] = [];
	// 先剥 HTML 注释再扫块（同 extractDraftBody）：注释里的 `<Prism>` 这类会被当成无闭合
	// 标签，一路吃到文末，把注释后面的裸重述正文整段包进「格式块」（8/16 实弹踩到）。
	const src = tail.replace(/<!--[\s\S]*?-->/g, "");
	FENCE_BLOCK_RE.lastIndex = 0;
	for (let m = FENCE_BLOCK_RE.exec(src); m; m = FENCE_BLOCK_RE.exec(src)) {
		spans.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
	}
	for (const b of scanTaggedBlocks(src)) {
		if (b.policy !== "unwrap") continue; // fold/strip 类不是格式内容
		if (b.hanging) continue; // 无闭合＝不是成形的格式块，别拿它当筐把正文装进来
		spans.push({ start: b.start, end: b.end, text: b.raw });
	}
	// 自闭合格式标签（`<StatusPlaceHolderImpl/>` 这类占位符）——scanTaggedBlocks 只找成对块
	SELF_CLOSING_RE.lastIndex = 0;
	for (let m = SELF_CLOSING_RE.exec(src); m; m = SELF_CLOSING_RE.exec(src)) {
		if (classifyTag(m[1]!) !== "unwrap") continue;
		spans.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
	}
	spans.sort((a, b) => a.start - b.start || b.end - a.end);
	const kept: Span[] = [];
	for (const s of spans) {
		const last = kept[kept.length - 1];
		if (last && s.start < last.end) continue; // 被前一块覆盖（嵌套/重叠）
		kept.push(s);
	}
	return kept
		.map((s) => s.text.trim())
		.filter(Boolean)
		.join("\n\n");
};

/**
 * 逐字相同的格式块去重（8/10 实弹：预设状态栏规则＋谢幕注入双指令源下，
 * 模型把同一份状态栏在一条尾巴里输出了两遍）。零名单零识别——块＝任意
 * `<Tag>…</Tag>`，只删与已见块**完全相同**的重复，内容有任何差异都不动。
 */
export const dedupeIdenticalBlocks = (s: string): string => {
	const seen = new Set<string>();
	return s
		.replace(/<([A-Za-z][\w-]*)>[\s\S]*?<\/\1>/g, (block) => {
			const key = block.trim();
			if (seen.has(key)) return "";
			seen.add(key);
			return block;
		})
		.replace(/\n{3,}/g, "\n\n")
		.trim();
};

/**
 * 尾巴里 `<content>` 块以正文结尾文字开头（模型按卡格式在 `<content>` 里重述正文）时，
 * 裁掉重复前缀——正文以稿件为准，定稿不得出现两遍。
 * （8/13 实弹：B1 的 `<content>` 以正文末段开头 + 新内容；B2 的 `<content>` 整段重述正文。）
 */
const trimContentBodyRepeat = (body: string, inner: string): string => {
	const d = body.trim();
	const i0 = inner.trimStart();
	if (!d || !i0) return inner;
	for (let n = Math.min(d.length, i0.length); n > 0; n--) {
		const suffix = d.slice(d.length - n);
		if (i0.startsWith(suffix)) {
			const rest = i0.slice(n).trim();
			return rest ? `\n${rest}` : "";
		}
	}
	return inner;
};

export const mergeFinalText = (draft: string, text: string): string => {
	const d = draft.trim();
	const t = text.trim();
	if (!d) return dedupeIdenticalBlocks(t);
	if (!t || d === t) return d;
	// 稿件已包含 text（模型边写边交，text 是半截）：稿件已是全量
	if (d.includes(t)) return d;
	// 只认「稿件在尾巴开头」的续写增量（正文在前、尾巴在后）；稿件出现在尾巴中段
	// 不切——格式块（state1/options 等）在正文之前，indexOf 会把它当「增量起点」把
	// 前面的格式块一起切掉（8/13 实弹：<state1>…<content>正文</content>，状态栏全丢）。
	let tail = t;
	if (t.startsWith(d)) tail = t.slice(d.length);
	const from = formatTailStart(tail);
	if (from < 0) return d;
	// 尾巴只留格式内容（块之外的自由文本／重述正文一律丢）；`<content>` 里重述的正文再裁一次
	const tailPart = formatContentOnly(tail.slice(from))
		.replace(/<content>([\s\S]*?)<\/content>/g, (whole, inner: string) => {
			const trimmed = trimContentBodyRepeat(d, inner);
			return trimmed ? `<content>${trimmed}</content>` : "";
		})
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return dedupeIdenticalBlocks([d, tailPart].filter(Boolean).join("\n\n"));
};

export class StageEngine {
	#deps: StageEngineDeps;
	#busy = false;
	#queue: Array<{ text: string; mode: ConversationMode }> = [];
	#abort: AbortController | null = null;
	#warnedMacros = "";
	#warnedAuditDrop = 0;
	#warnedProtocolDrop = "";
	#lastAssemblyJson = "";
	#workspace?: { ws: TurnWorkspace; deps: WorkspaceDeps };
	#turnMode?: ConversationMode;
	/** 子项目形态缓存（对话.json 只在建项目时写，按会话目录记一次即可） */
	#chatMode?: { sessionDir: string; mode: "agent" | undefined };

	/**
	 * agent 是子项目属性（对话.json 的 mode），压过树上的 liyuan-mode 条目；扮演/工作仍由树上条目决定。
	 */
	get mode(): ConversationMode {
		const sm = this.#deps.getSession().sessionManager;
		const sessionDir = sm.getSessionDir?.() ?? "";
		if (sessionDir) {
			if (this.#chatMode?.sessionDir !== sessionDir) this.#chatMode = { sessionDir, mode: chatModeOfSessionDir(sessionDir) };
			if (this.#chatMode.mode === "agent") return "agent";
		}
		return conversationMode(sm.getBranch() as BranchEntryLike[]);
	}
	get turnMode(): ConversationMode | undefined { return this.#turnMode; }

	setMode(mode: ConversationMode): void {
		if (!isConversationMode(mode)) throw new Error("未知会话模式。");
		if (this.#busy) throw new Error("请等当前回复完成（或先停止），再切换模式。");
		if (this.mode === mode) return;
		if (mode === "agent" || this.mode === "agent") throw new Error("agent 是子项目的形态，新建对话时选定，不在拍与拍之间切换。");
		const sm = this.#deps.getSession().sessionManager;
		sm.appendCustomEntry(CONVERSATION_MODE_TYPE, { mode, source: "user" });
		sm.flush();
		this.#deps.events?.onModeChanged?.(mode);
	}

	getWorkspaces(): TurnWorkspace[] {
		const sm = this.#deps.getSession().sessionManager;
		const authoringIds = authoringRequestIds(sm.getBranch() as BranchEntryLike[]);
		const ids = new Set((sm.getBranch() as Array<{ id: string }>).map((e) => e.id));
		const directory = draftDirectory(this.#deps.cwd, sm.getSessionDir?.(), sm.getSessionId());
		const list = listDrafts(directory).filter((w) => w.sessionId === sm.getSessionId() && !authoringIds.has(w.userId ?? "") &&
			(!w.revision || ids.has(w.revision.requestId)) &&
			(w.entryId ? ids.has(w.entryId) : w.userId ? ids.has(w.userId) : w.parentId === null || ids.has(w.parentId)));
		const recovered = list.map((w) => {
			if (!w.restorePending || this.#busy) return w;
			const store = new DraftStore(directory, w.id), current = store.read()!;
			this.#publishDraftRestore(current, store);
			return current;
		});
		const projected = new Map(applyDraftRevisions(sm.getBranch() as BranchEntryLike[]).map((e) => [e.id, e]));
		return recovered.filter((w) => {
			const entry = w.entryId ? projected.get(w.entryId) : undefined;
			const details = (entry?.type === "message" ? entry.message : entry) as { details?: { rpDraft?: { id?: string } } } | undefined;
			const currentId = details?.details?.rpDraft?.id;
			return !currentId || currentId === w.id;
		}).sort((a, b) => b.updatedAt - a.updatedAt);
	}

	/** The artifact journals the operation first; replay the receipt once after an interrupted flush. */
	#publishDraftRestore(ws: TurnWorkspace, store: DraftStore): void {
		if (!ws.restorePending || !ws.entryId) return;
		const sm = this.#deps.getSession().sessionManager;
		const branch = sm.getBranch() as Array<{ id: string; type: string; customType?: string; data?: { draftId?: string; version?: number } }>;
		if (ws.sessionId !== sm.getSessionId() || !branch.some((e) => e.id === ws.entryId) ||
			(ws.revision && !branch.some((e) => e.id === ws.revision!.requestId))) throw new Error("修订所属会话或分支已切换；回到原分支后再同步。");
		const exists = branch.some(
			(e) => e.type === "custom" && e.customType === DRAFT_REVISION_TYPE && e.data?.draftId === ws.id && e.data.version === ws.version,
		);
		if (!exists) sm.appendCustomEntry(DRAFT_REVISION_TYPE, { targetId: ws.entryId, text: ws.draft, timeline: ws.timeline, draftId: ws.id, version: ws.version, phase: ws.phase,
			...(ws.revision ? { requestId: ws.revision.requestId } : {}) });
		sm.flush();
		const next = structuredClone(ws); delete next.restorePending;
		commitWorkspace(ws, { rules: {}, userName: "", charName: "", persist: (value) => store.write(value) }, next);
	}

	getWorkspace(): TurnWorkspace | undefined {
		if (this.mode !== "roleplay" || (this.#turnMode && this.#turnMode !== "roleplay")) return undefined;
		const active = this.#workspace?.ws;
		if (this.#busy && active?.sessionId === this.#deps.getSession().sessionManager.getSessionId()) return structuredClone(active);
		const latest = this.getWorkspaces()[0];
		if (latest && ["writing", "exploring", "waiting"].includes(latest.phase)) {
			latest.phase = "stopped"; // interrupted process; the saved preview remains reviewable
		}
		return latest;
	}

	/** Host-only undo. Ended replies get an append-only receipt; waiting replies continue on the new version. */
	restoreDraft(id: string, version: number, expectedVersion: number): TurnWorkspace {
		if (this.#busy) {
			const active = this.#workspace;
			if (!active || active.ws.id !== id || active.ws.phase !== "waiting") throw new Error("请在等待回答或本拍结束后恢复稿件。");
			restoreDraftVersion(active.ws, active.deps, version, expectedVersion);
			this.#deps.events?.onWorkspace?.(active.ws);
			return structuredClone(active.ws);
		}
		const ws = this.getWorkspaces().find((w) => w.id === id);
		if (!ws) throw new Error("当前分支没有这份稿件。");
		const sm = this.#deps.getSession().sessionManager;
		const store = new DraftStore(draftDirectory(this.#deps.cwd, sm.getSessionDir?.(), sm.getSessionId()), id);
		const current = store.read()!;
		if (["writing", "exploring", "waiting"].includes(current.phase)) current.phase = "stopped";
		current.restorePending = !!current.entryId;
		restoreDraftVersion(current, { rules: {}, userName: "", charName: "", persist: (w) => store.write(w) }, version, expectedVersion);
		this.#publishDraftRestore(current, store);
		return current;
	}
	/**
	 * 本拍模型请求的存档名（`worldline_store` 登记，封笔后由 #turn 兑现）。
	 * 每拍开头清空——报错/空手/中断都会从 #turn 里提前 return，只有这里清才不会漏到下一拍。
	 */
	#pendingSave: string | null = null;
	/** 本拍 panel_write 声明的面板数据（面板名→初始树）；封笔后并进状态树，见 performTurn */
	#pendingPanelData: Record<string, Record<string, unknown>> = {};

	constructor(deps: StageEngineDeps) {
		this.#deps = deps;
	}

	get isStreaming(): boolean {
		return this.#busy;
	}

	/** 用户新输入开一拍：先落 user 消息再开演；忙时排队（流式中送达的输入不打断叙事） */
	async performTurn(userText: string): Promise<void> {
		if (this.#busy) {
			this.#queue.push({ text: userText, mode: this.mode });
			return;
		}
		await this.#run(userText);
		await this.#drain();
	}

	/** 再生成：叶已钉在 user（swipe/reroll 已 branch），不追加 user 消息直接开演 */
	async regenerate(): Promise<void> {
		if (this.#busy) return;
		await this.#run(null);
		await this.#drain();
	}

	/** 强制停止本拍：已流出的部分正文仍落树可见 */
	abort(): void {
		this.#abort?.abort();
		void this.#deps.getSession().abort();
	}

	async #drain(): Promise<void> {
		while (this.#queue.length > 0 && !this.#busy) {
			const next = this.#queue.shift();
			if (next !== undefined) await this.#run(next.text, next.mode);
		}
	}

	async #run(userText: string | null, requestedMode = this.mode): Promise<void> {
		const ev = this.#deps.events ?? {};
		if (requestedMode !== this.mode) this.setMode(requestedMode);
		this.#busy = true;
		this.#turnMode = this.mode;
		this.#abort = new AbortController();
		this.#pendingSave = null; // 上一拍若中途 return，登记的存档请求不许漏到这一拍
		this.#pendingPanelData = {};
		ev.onTurnStart?.();
		let endInfo: StageTurnEndInfo = { aborted: false };
		try {
			endInfo = await this.#turn(userText);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			ev.onNotify?.("error", `本拍开演失败：${msg}`);
			endInfo = { aborted: false, error: msg };
		} finally {
			this.#busy = false;
			this.#abort = null;
			if (this.#turnMode && this.#turnMode !== "roleplay") endInfo.mode = this.#turnMode;
			this.#turnMode = undefined;
			ev.onTurnEnd?.(endInfo);
		}
	}

	async #turn(userText: string | null): Promise<StageTurnEndInfo> {
		const { cwd, events: rawEv = {} } = this.#deps;
		const session = this.#deps.getSession();
		const sm = session.sessionManager;
		let mode = this.mode;
		// agent 轮＝工作模式那条 pi 会话路（原始过程回放、沙箱内原生工具）＋稿子工具＋项目状态块（docs/PLAN-AGENT-MODE.md §四）
		const agentTurn = mode === "agent";
		let authoringTurn = mode === "authoring" || agentTurn;
		let modeExit = false;
		const connection = getStageConnection(sm.getSessionId());
		if (!connection) throw new Error("RP 扩展尚未绑定当前 pi 会话。");
		const chatDir = chatDirOfSessionDir(sm.getSessionDir?.());
		if (agentTurn && !chatDir) throw new Error("agent 模式只在 cards/ 的子项目里可用。");

		// ---- 全流程文字留档 ----
		// 前端能看到的每一个字、每一次工具调用/回执、每一次注入，按时序全记。
		const beatLog: Array<{ ts: number; ev: string; data: string }> = [];
		const blog = (event: string, data: string) => beatLog.push({ ts: Date.now(), ev: event, data });
		// 拦截所有发往前端的事件
		const ev: typeof rawEv = {
			...rawEv,
			onDelta: (kind, delta, draft, reset) => {
				blog(draft ? "draft_delta" : kind === "thinking" ? "thinking" : "text", delta);
				rawEv.onDelta?.(kind, delta, draft, reset);
			},
			onStreamClear: () => { blog("stream_clear", ""); rawEv.onStreamClear?.(); },
			onDraftResync: (segs) => { blog("draft_resync", segs.join("\n---\n")); rawEv.onDraftResync?.(segs); },
			onActivity: (d) => { blog("activity", d); rawEv.onActivity?.(d); },
			onNotify: (lv, t) => { blog("notify", `[${lv}] ${t}`); rawEv.onNotify?.(lv, t); },
		};
		// 工具调用/回执统一由 pi 的 tool_call/tool_result 钩子记录。
		const _blog = blog;

		// 素材现读：改卡/改预设/挂书即时生效
		const materials = loadStageMaterials(cwd);
		const { config, card } = materials;
		if (materials.macroWarnings.length > 0) {
			const key = materials.macroWarnings.join(",");
			if (key !== this.#warnedMacros) {
				this.#warnedMacros = key;
				ev.onNotify?.("warning", `预设含未支持的宏（已置空处理）：${materials.macroWarnings.join("、")}`);
			}
		}

		const model = this.#deps.getModel();
		if (!model) {
			ev.onNotify?.("error", "尚未配置剧情模型——请先在「连接」面板选择模型。");
			return { aborted: false, error: "no-model" };
		}

		// 新输入由 pi 在 message_end 落树。预演装配只使用一份虚拟分支，
		// 这样素材/鉴权失败时不会启动一个缺少 RP 上下文的裸回合。
		const branch = [
			...sm.getBranch(),
			...(userText !== null ? [{ type: "message", message: nowMsg(userText) }] : []),
		] as BranchEntryLike[];
		const state = stateFromBranch(branch);
		const { history: storyHistory, lastNarrativeText, summary } = rebuildHistory(branch, materials.promptRules);
		// 无缝模式（9/11 定案）：维护性的输入/输出在扮演上下文里也可见——带标记的外围消息，
		// 不进 story 流（rebuildHistory 内的 storyBranch 已滤），持久化隔离不变。
		// 位置：插在剧情流**之前**——末端 user 消息是「本拍输入挂在数据块之后」的装配锚点，
		// 维护段排在它后面会被并进末端注入块（9/11 实弹：RETURN_REQUEST 被世界状态块吞掉）。
		const maintenance = authoringTurn ? [] : roleplayHistory(sm.getBranch() as BranchEntryLike[]).map((m) => ({
			role: m.role as "user" | "assistant", text: (m.content as Array<{ type?: string; text?: string }>)[0]?.text ?? "",
		})).filter((m) => m.text);
		const history = [...maintenance, ...storyHistory];
		const lastUserText = userText ?? contextText([...branch].reverse().find((e) => e.type === "message" && e.message?.role === "user")?.message?.content);
		if (!lastUserText.trim()) {
			ev.onNotify?.("error", "没有可开演的用户输入。");
			return { aborted: false, error: "no-user-input" };
		}

		const languageMismatch = lastNarrativeText
			? detectsLanguageMismatch(lastNarrativeText, config.language)
			: false;
		// 关键词扫描只看剧情流：维护文本不该触发世界书绿灯
		const windowText = storyHistory
			.slice(-config.scanDepth)
			.map((m) => m.text)
			.join("\n");
		const activated = scanEntries(materials.entries, windowText, config.maxLoreInjections);

		// 面板快照（M1 读磁盘缓存；写侧与分支化随 M3）。
		// 声明了数据的面板喂**数据**不喂外观——一张 HTML 面板的标签动辄四千字，
		// 每拍原样喂给模型纯属白烧，它要的只是里面那几十个字的事实。
		let panelIndex: string | undefined;
		try {
			const panels = loadPanels(chatDataPath(cwd, sm.getSessionDir?.(), sm.getSessionId(), "panels"));
			panelIndex =
				formatPanelSnapshot(panels, { data: state.panelData }) ?? formatPanelIndex(panels) ?? undefined;
		} catch {
			panelIndex = undefined;
		}

		// 旧会话遗留的戏外轮：不注预设末端模板（不按剧情模板硬写）
		const legacyBackstage = !!lastUserText && isBackstageText(lastUserText);

		// 历史后段每拍重装（{{lastusermessage}} 在此生效）：原文原序直通末端，不再拆层。
		const phAll = legacyBackstage ? [] : (assemblePresetAfter(materials, lastUserText) ?? []);
		// M-C2：外部插件协议条目退场（世界书/卡内嵌通道 H 类）——每套组合只播报一次
		if (materials.protocolDrops.length > 0) {
			const key = materials.protocolDrops.map((d) => `${d.family}:${d.title}`).join("|");
			if (key !== this.#warnedProtocolDrop) {
				this.#warnedProtocolDrop = key;
				const chars = materials.protocolDrops.reduce((n, d) => n + d.chars, 0);
				const titles = materials.protocolDrops.map((d) => `${d.label}「${d.title}」`).join("、");
				console.error(
					`[stage] 外部插件协议退场：${materials.protocolDrops.length} 条 / ${chars} 字（${titles}）——梨园以工具记账，无需模型手写格式块`,
				);
			}
		}

		// 装配报告落盘（PLAN §5.3 可视化）：装载期静态面 + 本拍历史后段；内容变了才写
		this.#writeAssemblyReport(cwd, materials, phAll);

		// M-A 工具组 + skill_read（M-R2 名称制：文件包+进口包非空才挂——不凭空点名）。
		// 回合工作区 = 正文工件的落点；字数目标在此提取一次（数据，供末端注入）。
		// 读侧依赖先建：统一层按注入情况决定哪些世界书工具上清单（M-D2）。
		// skill 全部走标准按需档：名字+描述上 skill_read 清单，读不读归模型（8/23 定案）。
		// 写卡手册（frontmatter mode: authoring）不上 skill_read 清单：它是 card_project 的说明书，由该工具的 guide 操作按需读
		const skillList = materials.skillFiles.filter((f) => f.mode !== "authoring").map((f) => ({ name: f.name, description: f.description }));
		const readDeps = this.#toolDeps();
		// MCP 外设（8/06 重接）：hub 里本会话已连接的工具并入清单。
		// 空数组＝没启用/没连上，与「未注入 mcp 依赖」同效——都不上清单。
		const mcpTools = mcpStageTools(this.#deps.mcp);
		// 媒体交付（8/06 重接）：tts 另需服务端环境，未就绪不上清单
		const mediaOpts = { tts: this.#deps.ttsAvailable?.() === true };
		const mediaTools = this.#deps.media ? mediaStageTools(config.language, mediaOpts) : [];
		// P7：ask 工具依赖宿主注入 askUser（选择卡通道）；未注入则从清单剔除
		const askEnabled = !!this.#deps.askUser;
		const rpTools: StageTool[] = [
			CONVERSATION_MODE_TOOL,
			...stageTools(config.language, readDeps),
			...(skillList.length > 0 ? [skillReadTool(config.language, skillList)] : []),
			...writeTools(config.language).filter((t) => t.name !== "ask" || askEnabled),
			...mediaTools,
			...mcpTools,
		];
		const cardDeps: CardDeps = { ...readDeps, ...this.#deps.authoring };
		const workTools: StageTool[] = [CONVERSATION_MODE_TOOL, ...authoringTools(config.language, cardDeps),
			...(skillList.length ? [skillReadTool(config.language, skillList)] : []), ...mcpTools];
		const nativeNames = config.backendControl === false ? [] : session.getAllTools().map((t) => t.name).filter((n) => AUTHORING_NATIVE_TOOLS.includes(n));
		// agent 模式清单（docs/PLAN-AGENT-CODING.md §五）＝扮演数据工具中与树无关的（世界线是树分支，不给）∪ skill_read ∪ ask
		// ∪ 媒体 ∪ MCP ∪ 写卡工具 ∪ 原生七工具；稿子就用原生 read/grep/edit/write。排在最前：同名工具（ask）以 agent 版定义为准。
		const storyDir = agentTurn ? storyDirectory(chatDir!) : undefined;
		const agentTools: StageTool[] = agentTurn ? [
			...stageTools(config.language, readDeps).filter((t) => !t.name.startsWith("worldline_")),
			...(skillList.length ? [skillReadTool(config.language, skillList)] : []),
			...(askEnabled ? [AGENT_ASK_TOOL] : []),
			...(this.#deps.screenshot ? [AGENT_SCREENSHOT_TOOL] : []),
			...mediaTools, ...mcpTools,
			...authoringTools(config.language, cardDeps),
		] : [];
		const rpNames = rpTools.map((t) => t.name);
		const workNames = [...new Set([...workTools.map((t) => t.name), ...nativeNames])];
		const agentNames = [...new Set([...agentTools.map((t) => t.name), ...nativeNames])];
		const tools = [...new Map([...agentTools, ...rpTools, ...workTools].map((t) => [t.name, t])).values()];
		const workPrompt = agentTurn
			? agentSystemPrompt({ cwd, cardPath: config.card, storyDir: storyDir!, userRules: materials.userRules, cardAgents: materials.cardAgents, macro: { charName: card.name, userName: config.userName } })
			: authoringSystemPrompt(cwd, config.card);
		const ws = createWorkspace({ sessionId: sm.getSessionId(), parentId: sm.getLeafId(),
			...(userText === null ? { userId: [...branch].reverse().find((e) => e.type === "message" && e.message?.role === "user")?.id } : {}) });
		const draftStore = new DraftStore(draftDirectory(cwd, sm.getSessionDir?.(), sm.getSessionId()), ws.id);
		const previousDraft = new PreviousDraftEditor(() => sm.getBranch() as BranchEntryLike[], draftDirectory(cwd, sm.getSessionDir?.(), sm.getSessionId()));
		const wsDeps: WorkspaceDeps = {
			rules: extractDraftRules([...materials.presetRuleTexts, ...phAll.map((b) => b.text)]),
			userName: config.userName,
			charName: card.name,
			file: draftStore.file,
			persist: (next) => draftStore.write(next),
			reload: () => draftStore.read(),
		};
		this.#workspace = authoringTurn ? undefined : { ws, deps: wsDeps };
		if (!authoringTurn) { draftStore.write(ws); ev.onWorkspace?.(ws); }

		// 【剧情记忆】被动召回：向量库注入侧。旁路调用必须带超时——provider 抽风时单次能卡
		// 几百秒，扮演不能陪着干等；拿不到就当没有，这一拍不出该块。
		const memoryRecall = authoringTurn ? undefined : await this.#recallForBeat(sm.getSessionId(), lastUserText);

		const systemPrompt = buildStageSystemPrompt({
			card,
			config,
			constantLore: constantLoreOf(materials),
			userRules: materials.userRules,
			cardAgents: materials.cardAgents,
			// 预设装配段：原文原序，marker 已按预设作者的位置填入梨园材料
			presetBefore: materials.presetBefore.map((p) => p.text),
			filledMarkers: materials.filledMarkers,
			tools: tools.length > 0,
			// MCP 外设索引进 system（不进每拍注入）：会话内字节稳定，不破前缀缓存。
			// 与旧 director.ts 同一位置——工具清单里有 mcp__ 工具，这里说明它们是什么。
			mcpTools: mcpTools.map((t) => ({ name: t.name, description: t.description })),
		});
		const rosterIndex = formatRosterIndex(state);
		const injection = buildStageInjection({
			state,
			activatedLore: activated,
			card,
			config,
			languageMismatch,
			cardAgentsActive: materials.cardAgents.trim().length > 0,
			panelIndex,
			...(wsDeps.rules.wordRange ? { wordRange: wsDeps.rules.wordRange } : {}),
			loreIndex: formatLoreIndex(materials.entries),
			rosterIndex,
			...(memoryRecall ? { memoryRecall } : {}),
			// off 挡（无原生思考通道、不主动检索）：绿灯命中给正文兜底；其余档位给标题让模型自取。
			passiveLore: (this.#deps.getThinking?.() ?? "off") === "off",
		});

		// 第二步·跨会话记忆（读侧）：卡的常驻摘要与这局的前情共用【前情提要】槽位——
		// 两者语义同为「更早剧情的既定事实」，本局摘要在前、往局记忆在后。摘要是数据块，
		// 走既有通道与既有语义句（铁律一/二：零新增文案、零新增注入点）；预算在 card-memory。
		const residentSummary = authoringTurn && !agentTurn ? undefined : this.#residentSummary(sm, summary, state, rosterIndex);
		// agent 模式的项目状态块（docs/PLAN-AGENT-CODING.md §六）：与扮演同一份数据，多带稿子目录（不带正文）；每次装配现读目录。
		const agentStateBlock = (): string => buildAgentStateBlock({ state, rosterIndex, summary, residentSummary, files: listStoryFiles(storyDir!) });

		// 末端消息 = 梨园数据块 + 本拍用户原话 + 预设 after 段（各按自己的 role）。
		// 顺序要紧：用户当拍的话必须落在**梨园数据块之后**。数据块压在提问之后时，模型会把提问
		// 读成历史里的旧话，于是既不检索也不正面回应——8/03 实测：同一提问，挪到注入之后立刻触发 lorebook_search。
		// ⚠ after 段排在原话之后（实测最长把原话推离生成点 9190 字，双人成行）：那是预设作者指定的
		// 位置，且 after 段是元指令（格式/CoT 开头/预填）而非剧情数据，与 8/03 那批被误读成旧话的数据不同性质。
		const endsWithUser = history[history.length - 1]?.role === "user";
		const past = endsWithUser ? history.slice(0, -1) : history;
		const tailText = endsWithUser ? `${injection}\n\n${history[history.length - 1].text}` : injection;

		// 预设 after 段（酒馆 chatHistory 槽位之后的条目）：按作者声明的 role 落成真实消息。
		// 降级规则照抄酒馆 src/prompt-converters.js，不是梨园自创：
		//  ① packages/ai 的消息只有 user/assistant（system 只走 streamFn 的独立参数）；酒馆
		//     convertClaudeMessages 同样只把**开头连续**的 system 收进 system 参数，其后
		//     role==='system' 一律改成 'user'——故历史之后的 system 块在此作 user。
		//  ② 连续同角色合并成一条（convertClaudeMessages 的 mergedMessages：轮次只支持 user/assistant）。
		//  ③ 末条 assistant 是酒馆的预填位（addAssistantPrefix）。**梨园不要预填，整块丢弃**
		//     （8/23 用户定案）。降级成 user 是假动作：role 变了，那段字仍顶在生成点前，模型照样
		//     接着写——实测预填 `OUTPUT <think_fox~>` 让 provider 把整段输出（思维链+正文+状态栏）
		//     判成思维链切进 reasoning_content，text 通道只剩切分边界后的残字，正文全丢。
		//     丢弃后生成点前是预设自己的末块，模型从头写、自己打标签，正文回到 text 通道。
		//     认的是**协议角色+位置**（历史之后的末条 assistant＝预填位），不认任何标签名（铁律三）。
		const asUser = (text: string, timestamp = 0) => ({ role: "user", content: [{ type: "text", text }], timestamp });
		const asAssistant = (text: string, timestamp = 0) => ({
			role: "assistant",
			content: [{ type: "text", text }],
			api: "openai-completions",
			provider: "history",
			model: "history",
			usage: {
				input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp,
		});
		const tailRuns: Array<{ role: "user" | "assistant"; text: string }> = [
			{ role: "user", text: tailText },
			...phAll
				.filter((p) => p.text.trim().length > 0)
				.map((p) => ({ role: p.role === "assistant" ? ("assistant" as const) : ("user" as const), text: p.text })),
		];
		// 预填位丢弃：末尾连续的 assistant 块整块不发（tailRuns[0] 恒为 user，循环不会掏空）。
		while (tailRuns.length > 0 && tailRuns[tailRuns.length - 1].role === "assistant") tailRuns.pop();
		const tailMerged: Array<{ role: "user" | "assistant"; text: string }> = [];
		for (const run of tailRuns) {
			const prev = tailMerged[tailMerged.length - 1];
			if (prev && prev.role === run.role) prev.text = `${prev.text}\n\n${run.text}`;
			else tailMerged.push({ ...run });
		}

		const messages: unknown[] = [
			// M4 前情提要：被 rp-summary 覆盖的早期剧情在此回读（历史里那段已整体不存在）。
			// 以 user 角色打头，措辞与 system「消息流约定」里的【前情提要】对上。
			// 跨会话常驻摘要（如有）接在本局摘要之后：同一语义、同一句开场。
			...(summary || residentSummary
				? [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: `【前情提要】以下是更早剧情的接力摘要，是既定事实：\n\n${[summary, residentSummary]
										.filter(Boolean)
										.join("\n\n")}`,
								},
							],
							timestamp: 0,
						},
					]
				: []),
			...past.map((m) => (m.role === "user" ? asUser(m.text) : asAssistant(m.text))),
			...tailMerged.map((r) => (r.role === "user" ? asUser(r.text, Date.now()) : asAssistant(r.text, Date.now()))),
		];

		const { apiKey, headers } = await this.#deps.getAuth(model);
		if (this.#abort?.signal.aborted) {
			if (userText !== null) session.appendMessage({ ...nowMsg(userText), ...(authoringTurn ? { details: { liyuanMode: "authoring" } } : {}) });
			sm.flush();
			return { aborted: true };
		}
		// 采样参数（刀2 D1）：config.samplers（预设转译迁来的家）优先，遗留预设文件兜底
		const samplers = config.samplers ?? materials.presetDoc?.samplers;
		let final: AssistantMsgLike | null = null;
		let errored: string | undefined;
		let text = "";
		let loopText = "";
		let loopTail = "";
		let roundText = "";
		let round = 0;
		let tailStart = -1;
		let contextStart: number | undefined;
		let userStopped = false;
		let finished = false;
		let endInfo: StageTurnEndInfo | undefined;
		const readNames = new Set([...unifiedStageToolNames(readDeps), "world_state_get", "skill_read"]);
		const mcpNames = mcpStageToolNames(this.#deps.mcp);
		const mediaNames = this.#deps.media ? mediaStageToolNames(mediaOpts) : new Set<string>();
		const publish = () => ev.onWorkspace?.(structuredClone(ws));
		let lastCheckpoint = 0;
		const checkpoint = (force = false) => {
			if (authoringTurn) return;
			if (force || Date.now() - lastCheckpoint > 250) {
				commitWorkspace(ws, wsDeps, structuredClone(ws)); lastCheckpoint = Date.now(); publish();
			}
		};
		const exchanges: ContextMessage[] = [];
		const agentMedia: Array<{ toolName: string; toolCallId: string; details: Record<string, unknown>; text: string }> = [];
		const requestId = () => ws.userId ??= [...sm.getBranch() as BranchEntryLike[]].reverse().find((e) => e.type === "message" && e.message?.role === "user")?.id;
		const finishAuthoring = (): StageTurnEndInfo => {
			const aborted = this.#abort?.signal.aborted === true || (!modeExit && final?.stopReason === "aborted");
			const liyuanMode = agentTurn ? "agent" : "authoring";
			const timeline: TurnWorkspace["timeline"] = [];
			for (const m of exchanges) {
				if (m.role === "assistant" && Array.isArray(m.content)) for (const c of m.content) {
					if (c.type === "text" && c.text) timeline.push({ kind: "text", text: c.text });
					else if (c.type === "thinking" && c.thinking) timeline.push({ kind: "thinking", text: c.thinking });
					else if (c.type === "toolCall") {
						const change = fileChangeOf(c.name ?? "", c.arguments);
						timeline.push({ kind: "tool", activities: [{ kind: "tool_start", name: c.name, detail: JSON.stringify(c.arguments).slice(0, 1200), ...(change ? { change } : {}) }] });
					}
				}
				else if (m.role === "toolResult") timeline.push({ kind: "tool", activities: [{ kind: "tool_end", name: String(m.toolName), detail: contextText(m.content).slice(0, 1200), isError: m.isError === true }] });
			}
			const body = exchanges.filter((m) => m.role === "assistant").map((m) => contextText(m.content)).filter(Boolean).join("\n\n");
			const entryId = final && (body || timeline.length) ? session.appendMessage({ ...final,
				content: [{ type: "text", text: body }],
				details: { liyuanMode, liyuanAuthoringReply: true, rpTimeline: timeline },
				...(modeExit ? { stopReason: "stop" } : {}),
			}) : undefined;
			sm.flush();
			// 媒体交付落树（与扮演同一条：wire 只认树上的 toolResult 出媒体帧）
			if (!aborted && agentMedia.length) {
				for (const d of agentMedia) session.appendMessage({ role: "toolResult", toolName: d.toolName, toolCallId: d.toolCallId, content: [{ type: "text", text: d.text }], details: d.details, isError: false, timestamp: Date.now() });
				sm.flush();
			}
			if (errored && !aborted) ev.onNotify?.("error", `${agentTurn ? "本轮" : "写卡"}失败：${errored}`);
			return { mode: liyuanMode, aborted, entryId, ...(errored ? { error: errored } : {}) };
		};

		const finish = async (): Promise<StageTurnEndInfo> => {
			if (authoringTurn) {
				const info = finishAuthoring();
				if (agentTurn) {
					// 轮末落检查点（docs/PLAN-AGENT-CODING.md §4.2）：正文/ 有改动才落；纯讨论一轮什么都不发生。
					const turnId = requestId();
					const message = `${lastUserText.replace(/\s+/g, " ").trim().slice(0, 60)}${info.aborted ? "（已中止）" : ""}`;
					let checkpoint: ReturnType<StoryHistory["commit"]>;
					try { checkpoint = new StoryHistory(chatDir!).commit({ author: "agent", message, ...(turnId ? { turnId } : {}), ...(info.aborted ? { aborted: true } : {}) }); }
					catch (err) { ev.onNotify?.("warning", `稿子检查点未落下：${err instanceof Error ? err.message : String(err)}`); }
					if (checkpoint) {
						const { files: _files, ...lite } = checkpoint;
						sm.appendCustomEntry(STORY_CHECKPOINT_TYPE, lite);
						sm.flush();
						const added = checkpoint.changed.added.map((name) => { try { return { name, text: readFileSync(join(storyDir!, name), "utf8") }; } catch { return { name, text: "" }; } }).filter((f) => f.text.trim());
						info.checkpoint = { id: checkpoint.id, changed: checkpoint.changed, added };
						ev.onActivity?.(`已保存检查点：${describeChange(checkpoint.changed)}`);
						// 旁路链挂在检查点上（§七）：场记只对新增文件跑；前情压缩按文件、按字数到期。
						await this.#afterCheckpoint({ model, auth: { apiKey, headers }, materials, sm, ev, added, aborted: info.aborted, storyDir: storyDir! });
					}
					// 讨论层压缩（§六.3）：估算超过窗口才压，与正文无关；失败只记日志。
					if (!info.aborted) await this.#compactDiscussion(model, { apiKey, headers }, sm, ev);
				}
				return info;
			}
			const aborted = userStopped || this.#abort?.signal.aborted === true || final?.stopReason === "aborted";
			if (ws.revision) {
				this.#publishDraftRestore(ws, draftStore);
				delete ws.preview;
				checkpoint(true);
				ev.onStreamClear?.();
				sm.appendCustomEntry("rp-text-debug", { beatLog, revision: ws.revision, draft: ws.draft });
				sm.flush();
				return { aborted, revisedEntryId: ws.revision.targetId };
			}
			if (!text) text = textOfAssistant(final);
			if ((aborted || errored) && ws.mode === "write" && ws.preview?.content && ws.preview.version === ws.version) {
				const preview = ws.preview;
				const partial = preview.name === "draft_append" ? ws.draft + (ws.draft ? preview.separator ?? "\n\n" : "") + preview.content : preview.content;
				runWriteTool(ws, wsDeps, "draft_write", { content: partial }, true);
			}

			// 定稿 = 工作区稿（工件）；工作区空（中断半拍/循环认栽）退回直出正文
			// **但**模型常把格式栈尾巴（状态栏/catsay 等）走 text 通道而非 draft_write 参数：
			// 二选一会把那部分连内容一起扔掉（8/05 实锤：模型宣告要出「正文+状态栏+咪咪点评」，
			// draft_write 只交了正文，屏上流式见过三样、落树只剩一样）。故此处**合并**：
			// 稿件为主体，text 里**格式特征**的尾巴补回（纯文本闲聊不进正文）。
			const merged = mergeFinalText(ws.draft, ws.draft.trim() ? loopTail : ws.mode === "write" ? text : "");
			// The existing format-tail compatibility path may add material, but never rewrites the artifact itself.
			const finalText = ws.draft ? ws.draft + (merged.startsWith(ws.draft.trim()) ? merged.slice(ws.draft.trim().length) : "") : merged;
			const finalSegments = finalTimeline(ws, finalText).map((s) => s.kind === "text" ? { ...s, draft: true } : s);
			if (finalText !== ws.draft) reviseDraft(ws, finalText, "finalize");
			ws.timeline = finalSegments;
			ws.phase = aborted ? "stopped" : errored ? "error" : ws.sealed ? "sealed" : "stopped";
			ws.sealed = ws.phase === "sealed";
			delete ws.preview;

			// 全流程文字留档：beatLog 时序 + merge 四件全部落进 session JSONL
			_blog("merge_input_draft", ws.draft);
			_blog("merge_input_tail", loopTail);
			_blog("merge_output", finalText);

			// 落树：正文以定稿为准（保留思考块，剥离工具调用轨迹）；纯错误/空拍不落
			let entryId: string | undefined;
			if (final && finalText) {
				const keep = (final.content ?? []).filter((c) => c.type === "thinking");
				// 时间线随 details 持久化：定稿只留最后一稿正文，但用户要看的
				// 「思考→工具→正文」全链在此保住——resyncAll 全量重放与刷新后仍在。
				// 稿段以定稿为准（工作区空时退回直出正文，时间线里也可能没有稿段）。
				const timeline = ws.timeline;
				const prevDetails =
					final.details && typeof final.details === "object" && !Array.isArray(final.details)
						? (final.details as Record<string, unknown>)
						: undefined;
				const details = { ...prevDetails, rpTimeline: timeline, rpDraft: { id: ws.id, version: ws.version, phase: ws.phase },
					...(ws.choices?.length ? { rpChoices: ws.choices } : {}) };
				entryId = session.appendMessage({
					...final,
					...(ws.sealed ? { stopReason: "stop" } : {}),
					content: [...keep, { type: "text", text: finalText }],
					...(details ? { details } : {}),
				});
				ws.entryId = entryId;
				sm.flush();
			}
			checkpoint(true);

			// 聚合诊断放在正文之后，保持展示顺序；原始过程已逐条持久化在正文之前。
			// swipe 会穿过这些元数据节点寻找定稿，仍以 user 的直接子树区分变体。
			// 空拍（无 final/finalText）照样保留诊断。
			sm.appendCustomEntry("rp-text-debug", { beatLog, draft: ws.draft, loopTail, finalText });
			sm.flush();

			// 媒体交付落树（8/06 重接）：wire 只认树上的 toolResult 出 image/audio/video/html 帧。
			// 落在正文**之后**——屏上顺序与演出顺序一致（先看正文，再看图）。
			// 正文空拍时也要落：用户可能只让「把刚才那张图再给我看看」，没有正文照样得交付。
			if (!aborted && ws.mediaDeliveries?.length) {
				for (const d of ws.mediaDeliveries) {
					session.appendMessage({
						role: "toolResult",
						toolName: d.toolName,
						toolCallId: d.toolCallId,
						content: [{ type: "text", text: d.text }],
						details: d.details,
						isError: false,
						timestamp: Date.now(),
					});
				}
				sm.flush();
			}

			if (errored && !aborted) {
				ev.onNotify?.("error", `生成失败：${errored}`);
				return { aborted: false, error: errored, entryId };
			}

			// 模型停手但无正文：如实通知，保持今天的空拍行为。
			if (!errored && !aborted && !finalText) {
				ev.onNotify?.("warning", "本拍模型未交出任何正文——请重试或更换模型。");
				return { aborted: false, error: "no-draft" };
			}
			if (!aborted && !errored && finalText && !ws.sealed) {
				ev.onNotify?.("warning", "稿件已保存，本拍尚未收笔。");
				return { aborted: false, error: "unsealed-draft", entryId };
			}

			// 定稿后的 RP 旁路工作，统一归 agent_end。
			// 记账（第三步）：world_state_update 已撤出模型视野，账本整体归封笔后的场记旁路。
			// 触发是结构信号（本拍有正文＝封笔），扮演者无感；场记读「已写出的正文＋当前账本」
			// 出 patch，判断在模型、落账由 harness 死板执行（叶守卫在 runScribeTurn 内）。
			if (entryId && !aborted && finalText) {
				await this.#scribe({ model, auth: { apiKey, headers }, materials, sm, ev, state, userText: lastUserText, assistantText: finalText });
			}
			this.#pendingPanelData = {};

			// 世界线存档（M-D7）：模型本拍调过 worldline_store 才有值。
			// **必须排在场记之后**——rp-state 刚落在叶上，回退到此点账本才对得齐
			// （面板快照在 panel_write 时已自落，无需再补）。分线与否由宿主按此刻树形算。
			if (this.#pendingSave && this.#deps.storeSave && entryId && !aborted && finalText) {
				const want = this.#pendingSave;
				try {
					const saved = this.#deps.storeSave(sm.getSessionId(), want);
					if (saved) {
						ev.onActivity?.(`已钉档「${saved.name}」（${saved.worldlineName}）`);
						sm.flush();
					} else {
						ev.onNotify?.("warning", `存档「${want}」未能钉下（无当前叶位）。`);
					}
				} catch (err) {
					// 存档失败不该动摇已经写好的一拍
					console.error("[stage] 钉档失败", err);
					ev.onNotify?.("warning", `存档「${want}」失败：${err instanceof Error ? err.message : String(err)}`);
				}
			}
			this.#pendingSave = null;

			// M4 长局压缩：攒够拍数就把早期剧情摘要成 rp-summary（装配时回读为【前情提要】）。
			// 放在谢幕前的最后一步——记账已落，摘要能读到最新账本；叶守卫在 runCompaction 内。
			// 压缩失败/未到期都只是跳过，下一拍会再判一次。
			if (entryId && !aborted && finalText) {
				await this.#compact(model, { apiKey, headers }, config.compactEveryNTurns ?? 30);
			}
			return { aborted, entryId };
		};

		// 工作模式沙箱（docs/PLAN-SANDBOX.md）：原生文件工具以卡目录为界，卡外停在 tool_call 钩子里等用户批准。
		// 允许集按本拍的卡算一次；授权现读——本会话的在树上，永久的在 卡.json。
		const sandboxGate = createSandboxGate({
			cwd, config,
			sessionGrants: () => sandboxGrantsFromBranch(sm.getBranch() as BranchEntryLike[]),
			rememberSession: (grant) => { sm.appendCustomEntry(SANDBOX_GRANT_TYPE, grant); sm.flush(); },
			ask: this.#deps.askUser ? (question, options) => this.#deps.askUser!(question, options, this.#abort?.signal) : undefined,
			onStop: () => { userStopped = true; void session.abort(); },
			log: (line) => blog("sandbox", line),
		});

		const hooks: StageHooks = {
			get mode() { return mode; },
			get systemPrompt() { return authoringTurn ? workPrompt : systemPrompt; },
			get toolNames() { return modeExit ? [] : mode === "agent" ? agentNames : mode === "authoring" ? workNames : rpNames; },
			context: (piMessages) => {
				// 历史/状态/预设/记忆只有这一份出口；本拍新增的工具过程仍由 pi 持有。
				contextStart ??= piMessages.length;
				ws.userId ??= [...sm.getBranch() as Array<{ id: string; type: string; message?: { role?: string } }>].reverse().find((e) => e.type === "message" && e.message?.role === "user")?.id;
				if (authoringTurn) {
					// agent：讨论历史认讨论摘要（docs/PLAN-AGENT-CODING.md §六.3）；项目状态块压在本轮用户原话之前（同扮演「数据块之后才是提问」的装配锚点）
					const history = agentTurn ? agentHistory(sm.getBranch() as BranchEntryLike[]) : authoringHistory(applyDraftRevisions(sm.getBranch() as BranchEntryLike[]));
					if (agentTurn) prependToLastUser(history, agentStateBlock());
					return history;
				}
				const projected = projectToolContext([...messages, ...piMessages.slice(contextStart)]);
				ws.context = projected.stats; checkpoint(true);
				return projected.messages;
			},
			providerPayload: (payload, requestModel = model) => {
				if (!samplers || !Object.keys(samplers).length || !payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
				return applyProjectedSamplers(payload as Record<string, unknown>, samplers, {
					provider: requestModel.provider,
					modelId: requestModel.id,
					baseUrl: requestModel.baseUrl,
					api: typeof requestModel.api === "string" ? requestModel.api : undefined,
				});
			},
			update: (event) => {
				if (authoringTurn) {
					if ((event.type === "text_delta" || event.type === "thinking_delta") && event.delta) ev.onDelta?.(event.type === "text_delta" ? "text" : "thinking", event.delta);
					return;
				}
				if (ws.revision) return; // A completed edit cannot grow another narrative or mutate its saved timeline.
				if (event.type === "text_delta" && event.delta) {
						text += event.delta;
						roundText += event.delta;
						if (round > 0) loopText += event.delta;
						if (ws.sealed) recordSegment(ws, { kind: "text", text: event.delta });
						ev.onDelta?.("text", event.delta);
						if (ws.mode === "write" && !ws.sealed) ws.preview = { name: ws.draft ? "draft_append" : "direct", content: ws.draft ? roundText : text, version: ws.version };
					checkpoint();
				} else if (event.type === "thinking_delta" && event.delta) {
					recordSegment(ws, { kind: "thinking", text: event.delta });
					ev.onDelta?.("thinking", event.delta);
				} else if (event.type.startsWith("toolcall_") && event.partial && event.contentIndex !== undefined) {
					const call = event.partial.content[event.contentIndex];
					if ((call?.name === "draft_write" || call?.name === "draft_append") && typeof call.arguments?.content === "string" &&
						call.arguments.version === ws.version && !workspaceToolBlock(ws, call.name, "write")) {
						ws.preview = { name: call.name, content: call.arguments.content, version: ws.version, ...(typeof call.arguments.separator === "string" ? { separator: call.arguments.separator } : {}) };
						checkpoint();
					}
				}
			},
			messageEnd: (message) => {
				if (message.role === "user" && authoringTurn) message.details = { ...(message.details as object ?? {}), liyuanMode: agentTurn ? "agent" : "authoring" };
				if (message.role !== "assistant" && message.role !== "toolResult") return undefined;
				const raw = structuredClone(message) as ContextMessage;
				exchanges.push(raw);
				const userId = requestId();
				if (userId) { sm.appendCustomEntry(CONVERSATION_PROCESS_TYPE, { requestId: userId, mode, message: raw }); sm.flush(); }
				if (message.role === "assistant") {
					final = message as AssistantMsgLike;
					if (authoringTurn) {
						if (final.stopReason === "error") errored = final.errorMessage || "provider error";
						return { persist: false };
					}
					if (ws.revision) {
						if (round >= MAX_ROUNDS && final.content.some((block) => block.type === "toolCall")) void session.abort();
						return { persist: false };
					}
					if (!roundText && textOfAssistant(final)) {
						roundText = textOfAssistant(final); text += roundText;
						if (round > 0) loopText += roundText;
						if (ws.draft) recordSegment(ws, { kind: "text", text: roundText });
					}
					if (final.stopReason === "error") errored = final.errorMessage || "provider error";
					const calls = final.content.filter((block) => block.type === "toolCall");
					if (!errored && final.stopReason !== "aborted") {
						if (round >= MAX_ROUNDS && calls.length) {
							// 撤工具后的最后一发仍幻觉调用：停在本次回应，不再执行或续轮。
							void session.abort();
						} else if (!calls.length) {
							if (ws.draft && !ws.sealed && ws.mode === "write") {
								const continuation = textOfAssistant(final);
								if (continuation) {
									runWriteTool(ws, wsDeps, "draft_append", { content: continuation }, "capture");
									tailStart = loopText.length;
								}
								if (!ws.explicitWrites) runWriteTool(ws, wsDeps, "draft_seal", {}, true);
							}
						if (!ws.draft.trim() && text.trim() && ws.mode === "write") {
							const result = runWriteTool(ws, wsDeps, "draft_write", { content: text }, true);
								ws.strayText = "";
								ev.onActivity?.(result.ok ? "直出正文已代收为 draft_write" : "直出正文代收失败");
							}
						}
					}
				}
				// Raw exchanges are durable in the shared tree. pi's temporary copy is
				// discarded; each mode rebuilds its own view of that same tree.
				return { persist: false };
			},
			toolCall: async (name, input) => {
				blog("tool_call", `${name}: ${JSON.stringify(input)}`);
				let blockReason = !hooks.toolNames.includes(name) ? "此工具在当前会话模式不可用。" :
					name === CONVERSATION_MODE_TOOL.name || authoringTurn ? undefined : workspaceToolBlock(ws, name, tools.find((t) => t.name === name)?.mode);
				if (!blockReason && nativeNames.includes(name)) blockReason = await sandboxGate(name, input);
				return { toolName: name, lastUserText, creationMode: loadStageConfig(cwd).creationMode, ...(blockReason ? { blockReason } : {}) };
			},
			toolResult: (name, content) => {
				blog("tool_result", `${name}: ${content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("")}`);
			},
			turnEnd: (withdrawTools) => {
				if (authoringTurn) {
					if (modeExit) { withdrawTools(); void session.abort(); }
					return;
				}
				const calls = final?.content.filter((block) => block.type === "toolCall") ?? [];
				if (calls.length && final?.stopReason !== "aborted" && !userStopped && !this.#abort?.signal.aborted) {
					delete ws.preview;
					if (!ws.sealed) ws.timeline = ws.timeline.filter((s) => s.kind !== "text" || s.draft);
					checkpoint(true);
				}
				if (!userStopped && !errored && final?.stopReason !== "aborted" && calls.length && round < MAX_ROUNDS) {
					if (tailStart < 0) {
						if (roundText.trim()) ev.onStreamClear?.();
						if (ws.draft.trim()) tailStart = loopText.length;
					}
					if (ws.draft.trim()) {
						ws.strayText = text.slice(0, text.length - loopText.length + (tailStart >= 0 ? tailStart : loopText.length)).trim();
					}
				}
				loopTail = tailStart >= 0 ? loopText.slice(tailStart) : loopText;
				roundText = "";
				round++;
				if (round >= MAX_ROUNDS) withdrawTools();
			},
			end: async () => {
				if (finished) return;
				finished = true;
				try {
					endInfo = await finish();
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					ev.onNotify?.("error", `本拍收尾失败：${message}`);
					endInfo = { aborted: this.#abort?.signal.aborted === true, error: message };
				}
			},
			execute: async (name, id, input, signal) => {
				if (name === CONVERSATION_MODE_TOOL.name) {
					if (!isConversationMode(input.mode)) return { content: [{ type: "text", text: "mode 必须为 roleplay 或 authoring。" }], isError: true };
					if (input.mode === mode) return { content: [{ type: "text", text: `当前已是 ${mode} 模式。` }] };
					mode = input.mode;
					authoringTurn = true;
					this.#turnMode = "authoring";
					this.#workspace = undefined;
					modeExit = mode === "roleplay";
					sm.appendCustomEntry(CONVERSATION_MODE_TYPE, { mode, source: "agent", requestId: requestId() });
					sm.flush();
					session.setActiveToolsByName(hooks.toolNames);
					if (!modeExit) session.setTurnSystemPrompt(workPrompt);
					ev.onStreamClear?.();
					ev.onModeChanged?.(mode);
					return { content: [{ type: "text", text: modeExit ? "已切回扮演，维护操作结束；下一条用户输入继续剧情。" : "已进入工作模式；下一次模型调用可见本会话完整操作记录与工作工具。" }], ...(modeExit ? { terminate: true } : {}) };
				}
				if (authoringTurn) {
					if (agentTurn && name === "ask" && this.#deps.askUser) {
						const question = String(input.question ?? "").trim() || "请你定夺";
						const options = Array.isArray(input.options) ? input.options.map((v) => String(v).trim()).filter(Boolean) : [];
						const answer = await this.#deps.askUser(question, options, signal);
						if (answer === undefined) {
							ev.onActivity?.(`ask「${question.slice(0, 24)}」· 用户停止`);
							userStopped = true; void session.abort();
							return { content: [] };
						}
						ev.onActivity?.(`ask「${question.slice(0, 24)}」· 用户作答`);
						return { content: [{ type: "text", text: `用户已作答：「${answer}」。` }] };
					}
					if (agentTurn && name === "screenshot" && this.#deps.screenshot) {
						const file = typeof input.file === "string" && input.file.trim() ? input.file.trim() : undefined;
						const shot = await this.#deps.screenshot(file, signal);
						if (!shot) return { content: [{ type: "text", text: "没有截到画面：没有打开的页面，或页面没有在限时内回报。请让用户在浏览器里打开梨园后重试。" }], isError: true };
						ev.onActivity?.(`截图${file ? `「${file}」` : "（整页稿子）"} · ${shot.width}×${shot.height}`);
						return { content: [{ type: "text", text: `已截取${file ? `「${file}」` : "整页稿子"}的当前画面（${shot.width}×${shot.height}）。` }, { type: "image", data: shot.png, mimeType: "image/png" }] };
					}
					if (mcpNames.has(name)) {
						const result = await runMcpStageTool(this.#deps.mcp!, name, input, signal);
						return { content: [{ type: "text", text: result?.text ?? "MCP 工具不可用。" }], isError: result?.isError ?? !result };
					}
					if (name === "skill_read" || (agentTurn && readNames.has(name))) {
						const result = await runStageTool(readDeps, name, input, config.language);
						if (agentTurn && result.activity) ev.onActivity?.(result.activity);
						return { content: [{ type: "text", text: result.text }], isError: result.isError };
					}
					if (agentTurn && mediaNames.has(name)) {
						const result = (await runMediaStageTool(this.#deps.cwd, name, input)) ?? { text: `未知工具「${name}」。`, isError: true };
						if (result.details && result.isError !== true) agentMedia.push({ toolName: name, toolCallId: id, details: result.details, text: result.text });
						if (result.activity) ev.onActivity?.(result.activity);
						return { content: [{ type: "text", text: result.text }], ...(result.details ? { details: result.details } : {}), ...(result.isError ? { isError: true } : {}) };
					}
					const result = await runAuthoringTool(name, input, config.language, cardDeps);
					return result ? { content: [{ type: "text", text: result.text }], details: result.details, isError: result.isError } : { content: [{ type: "text", text: `当前${agentTurn ? "agent" : "工作"}模式没有此工具。` }], isError: true };
				}
				if (name === "ask" && roundText.trim() && ws.mode === "write") {
					runWriteTool(ws, wsDeps, ws.draft ? "draft_append" : "draft_write", { content: roundText, version: ws.version }, "capture");
					tailStart = loopText.length; roundText = "";
				}
				const result = await this.#executeTool({
					ws, wsDeps, previousDraft, language: config.language, readDeps, readNames, mcpNames, mediaNames, ev,
					stop: () => { userStopped = true; void session.abort(); },
				}, name, id, input, signal);
				delete ws.preview;
				checkpoint(true);
				if (ws.revision && ws.restorePending) {
					try {
						this.#publishDraftRestore(ws, draftStore);
						ev.onReplyRevised?.(ws.revision.targetId);
					} catch (error) {
						return { content: [{ type: "text", text: `修订稿已保存，回复同步待恢复：${error instanceof Error ? error.message : String(error)}` }], isError: true };
					}
				}
				return result;
			},
		};
		const release = connection.activate(hooks, tools);
		try {
			await session.prompt(userText ?? lastUserText, { expandPromptTemplates: false, reuseUserMessage: userText === null });
			if (!finished || !endInfo) throw new Error("pi 未完成本拍的 RP 收尾。");
			return endInfo;
		} finally {
			release();
			if (authoringTurn) await this.#deps.afterAuthoringTurn?.();
		}
	}

	/**
	 * 手动压缩（/compact）：不等周期，立刻把早期剧情摘要成 rp-summary。
	 * everyNTurns=1 + 更低的字数地板 = 「只要真有可裁的早期剧情就压」
	 * （仍守最近 KEEP_RECENT_BEATS 拍原文，续演点不动）。
	 * 流式中拒绝——压缩要改上下文，不能与正在装配的一拍打架。
	 */
	async compactNow(): Promise<CompactOutcome> {
		if (this.#busy) return { kind: "skipped", reason: "busy" };
		const model = this.#deps.getModel();
		if (!model) return { kind: "failed", error: "尚未配置剧情模型" };
		this.#busy = true;
		try {
			const { apiKey, headers } = await this.#deps.getAuth(model);
			return await this.#compact(model, { apiKey, headers }, 1, MANUAL_MIN_COMPACT_CHARS);
		} catch (err) {
			return { kind: "failed", error: err instanceof Error ? err.message : String(err) };
		} finally {
			this.#busy = false;
		}
	}

	/**
	 * 场记记账（封笔后的旁路，扮演与 agent 共用）。触发是结构信号——扮演＝本拍有正文，agent＝写入了一章；
	 * 场记读「已写出的正文＋当前账本」出 patch，判断在模型、落账由 harness 死板执行（叶守卫在 runScribeTurn 内）。
	 */
	async #scribe(o: {
		model: StageModelLike; auth: { apiKey?: string; headers?: Record<string, string | null> }; materials: StageMaterials;
		sm: StageSessionManager; ev: StageEvents; state: WorldState; userText: string; assistantText: string;
	}): Promise<void> {
		const { model, auth, materials, sm, ev, state } = o;
		// MVU 卡：开演前若树还没建（首拍/老会话），从卡的初值声明懒建——世界书 [initvar] 优先，
		// 没有就退到卡自带脚本里 Zod schema 的 prefault（见 seedMvuIfNeeded）。规则喂给场记当参考。
		const seededState = seedMvuIfNeeded(
			state,
			materials.card.book,
			materials.config.userName,
			materials.card.name,
			materials.cardAuthorScripts,
		) as WorldState;
		const mvuRules = seededState.mvu ? findMvuRules(materials.card.book) : undefined;
		/**
		 * 本拍新声明的面板数据并进账本，赶在场记之前——这样场记这一拍就能看见新面板的树、
		 * 顺手把它推到本拍剧情的状态。**已有的树不覆盖**：agent 重写外观时可能连 data 一起再给
		 * 一遍（那是它写模板时的初值），拿它盖掉推进过的值就等于每次重画都把面板打回开局。
		 */
		const declared = Object.entries(this.#pendingPanelData);
		const scribeState = declared.length
			? {
					...seededState,
					panelData: declared.reduce(
						(acc, [name, tree]) => (acc[name] ? acc : { ...acc, [name]: tree }),
						{ ...(seededState.panelData ?? {}) } as Record<string, Record<string, unknown>>,
					),
				}
			: seededState;
		const r = await runScribeTurn(
			{
				// 2048：账本+名录随剧情增长，patch 可能很长；1024 实测会截断出半截 JSON（8/03）
				sideText: (sp, ut) => this.#sideText(model, sp, ut, auth, 2048, "scribe"),
				appendStateEntry: (s) => sm.appendCustomEntry(STATE_ENTRY_TYPE, s),
				getLeafId: () => sm.getLeafId(),
				stateFile: this.#deps.getStateFile?.(sm.getSessionId()),
				onActivity: (d) => ev.onActivity?.(d),
			},
			{
				state: scribeState,
				userText: o.userText,
				assistantText: o.assistantText,
				charName: materials.card.name,
				userName: materials.config.userName,
				mvuRules,
			},
		);
		if (r.kind === "failed") console.error(`[stage-scribe] 记账跳过：${r.error}`);
		/**
		 * 场记这拍没落账（无变化/解析失败/切了分支），新声明的面板数据就没人写下来——
		 * 而 panel_write 不会再调一次，那棵树会永久丢失、面板永远显示不出值。所以补一笔。
		 * r.kind === "applied" 时不必补：scribeState 已经带着声明进去、随账本一起落了。
		 */
		if (declared.length && r.kind !== "applied") {
			try {
				sm.appendCustomEntry(STATE_ENTRY_TYPE, scribeState);
				const f = this.#deps.getStateFile?.(sm.getSessionId());
				if (f) saveState(f, scribeState);
			} catch {
				// 补写失败只是这拍面板没值，不影响正文
			}
		}
		sm.flush();
	}

	/**
	 * agent 模式的旁路链挂在检查点上（docs/PLAN-AGENT-CODING.md §七）：场记只对新增文件跑（一文件一遍，账本随新章推进）；
	 * 修改/改名/删除不触发；然后按文件、按字数到期压缩前情。世界线钉档不在 agent 模式里。
	 * 用户中途停止时旁路调用会因 abort 信号立即失败——只记日志。
	 */
	async #afterCheckpoint(o: {
		model: StageModelLike; auth: { apiKey?: string; headers?: Record<string, string | null> }; materials: StageMaterials;
		sm: StageSessionManager; ev: StageEvents; added: Array<{ name: string; text: string }>; aborted: boolean; storyDir: string;
	}): Promise<void> {
		const { model, auth, materials, sm, ev } = o;
		for (const { text } of o.added) {
			const state = stateFromBranch(sm.getBranch() as BranchEntryLike[]);
			await this.#scribe({ model, auth, materials, sm, ev, state, userText: "", assistantText: text });
			this.#pendingPanelData = {};
		}
		this.#pendingSave = null;
		// 前情压缩按文件：保留按文件名序最后 N 个（N 复用 compactEveryNTurns，<=0 关闭），其余未覆盖的攒够字数就压。
		const keep = materials.config.compactEveryNTurns ?? 30;
		if (!o.aborted && keep > 0) await this.#compact(model, auth, keep, undefined, keep);
	}

	/**
	 * 讨论层压缩（docs/PLAN-AGENT-CODING.md §六.3）：判据照 pi（估算 token > 上下文窗口 − 预留），摘要由旁路模型写，
	 * 落 liyuan-discussion-summary 条目，agentHistory 从 firstKeptEntryId 起回放。叶守卫同前情压缩。
	 */
	async #compactDiscussion(model: StageModelLike, auth: { apiKey?: string; headers?: Record<string, string | null> }, sm: StageSessionManager, ev: StageEvents): Promise<void> {
		const contextWindow = typeof model.contextWindow === "number" ? model.contextWindow : 0;
		if (!(contextWindow > 0)) return;
		try {
			const plan = planDiscussionCompaction(sm.getBranch() as BranchEntryLike[], { contextWindow });
			if (!plan) return;
			const leafBefore = sm.getLeafId();
			ev.onActivity?.(`正在压缩讨论（${plan.turns} 轮 · 约 ${plan.tokensBefore} token）…`);
			const prompt = buildDiscussionSummaryPrompt({ conversationText: plan.conversationText, ...(plan.previousSummary ? { previousSummary: plan.previousSummary } : {}) });
			const resp = await this.#sideText(model, prompt.systemPrompt, prompt.userText, auth, 4096, "compact");
			if (typeof resp !== "string" || !resp.trim()) { console.error(`[stage-discussion] 压缩跳过：${typeof resp === "string" ? "摘要为空" : resp.error}`); return; }
			if (sm.getLeafId() !== leafBefore) { ev.onActivity?.("讨论压缩已丢弃（期间切换了分支）"); return; }
			sm.appendCustomEntry(DISCUSSION_SUMMARY_TYPE, { summary: resp.trim(), firstKeptEntryId: plan.firstKeptEntryId, tokensBefore: plan.tokensBefore });
			sm.flush();
			ev.onActivity?.(`讨论已压缩：${plan.turns} 轮 → 摘要 ${resp.trim().length} 字`);
		} catch (err) {
			console.error(`[stage-discussion] 压缩异常：${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/** 压缩一次（自动/手动共用）。失败只记日志不抛——压缩从不影响正文。 */
	async #compact(
		model: StageModelLike,
		auth: { apiKey?: string; headers?: Record<string, string | null> },
		everyNTurns: number,
		minChars?: number,
		keepRecentBeats?: number,
	): Promise<CompactOutcome> {
		const ev = this.#deps.events ?? {};
		const sm = this.#deps.getSession().sessionManager;
		const { config, card } = loadStageMaterials(this.#deps.cwd);
		try {
			const branch = sm.getBranch() as BranchEntryLike[];
			// agent 子项目：planCompaction 按稿子文件计划（docs/PLAN-AGENT-CODING.md §七）
			const chatDir = chatDirOfSessionDir(sm.getSessionDir?.());
			const agentStoryDir = chatDir && chatModeOfSessionDir(sm.getSessionDir?.()) === "agent" ? storyDirectory(chatDir) : undefined;
			const c = await runCompaction(
				{
					// 4096：摘要要装下前情/人物/伏笔/事实账五节，且要合并上一份摘要
					sideText: (sp, ut) => this.#sideText(model, sp, ut, auth, 4096, "compact"),
					appendSummaryEntry: (data: RpSummaryData) => sm.appendCustomEntry(SUMMARY_ENTRY_TYPE, data),
					getLeafId: () => sm.getLeafId(),
					archive: this.#deps.archiveCompacted
						? (text) => this.#deps.archiveCompacted!(sm.getSessionId(), text)
						: undefined,
					onActivity: (d) => ev.onActivity?.(d),
				},
				{
					branch,
					state: stateFromBranch(branch),
					language: config.language,
					userName: config.userName,
					charName: card.name,
					everyNTurns,
					...(minChars !== undefined ? { minChars } : {}),
					...(keepRecentBeats !== undefined ? { keepRecentBeats } : {}),
					...(agentStoryDir ? { storyDir: agentStoryDir } : {}),
				},
			);
			if (c.kind === "failed") console.error(`[stage-compact] 压缩跳过：${c.error}`);
			if (c.kind === "compacted") sm.flush();
			return c;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[stage-compact] 压缩异常：${msg}`);
			return { kind: "failed", error: msg };
		}
	}

	/**
	 * 卡的跨会话常驻摘要（第二步读侧）。当前会话住在 cards/ 的子项目里、卡里有
	 * 记忆/常驻摘要.md 才有值；老布局/没建过记忆的卡返回 undefined（行为与今天一致）。
	 * 预算封套＝常驻摘要＋本局前情＋【世界状态】＋【登场名录】：本局的账本优先，摘要让位。
	 */
	#residentSummary(
		sm: StageSessionManager,
		branchSummary: string | undefined,
		state: WorldState,
		rosterIndex: string | undefined,
	): string | undefined {
		const chatDir = chatDirOfSessionDir(sm.getSessionDir?.());
		if (!chatDir) return undefined;
		const cardDir = cardDirOfChatDir(chatDir);
		if (!cardDir) return undefined;
		const text = loadResidentSummary(cardDir);
		if (!text) return undefined;
		const otherChars = (branchSummary?.length ?? 0) + formatState(state).length + (rosterIndex?.length ?? 0);
		return fitResidentSummary(text, otherChars);
	}

	/** pi 负责校验、顺序执行与中断；这里仅派发一件 RP 工具及记录领域结果。 */
	async #executeTool(
		o: {
			ws: TurnWorkspace; wsDeps: WorkspaceDeps; previousDraft: PreviousDraftEditor; language: string; readDeps: StageToolDeps;
			readNames: Set<string>; mcpNames: Set<string>; mediaNames: Set<string>; ev: StageEvents; stop: () => void;
		},
		name: string,
		id: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<StageToolResult> {
		const { ws, ev } = o;
		let result: ToolRunResult | MediaStageResult;
		if (name === "ask" && this.#deps.askUser) {
			const question = String(args.question ?? "").trim() || "请你定夺";
			const options = Array.isArray(args.options) ? args.options.map((value) => String(value).trim()).filter(Boolean) : [];
			recordSegment(ws, { kind: "tool", activity: { kind: "tool_start", name, detail: question } });
			commitWorkspace(ws, o.wsDeps, { ...structuredClone(ws), phase: "waiting" });
			ev.onWorkspace?.(structuredClone(ws));
			const answer = await this.#deps.askUser(question, options, signal);
			ws.lookups++;
			if (answer === undefined) {
				ev.onActivity?.(`ask「${question.slice(0, 24)}」· 用户停止`);
				recordSegment(ws, { kind: "tool", activity: { kind: "tool_end", name, detail: "用户停止——笔还给用户" } });
				o.stop();
				return { content: [] };
			}
			commitWorkspace(ws, o.wsDeps, { ...structuredClone(ws), phase: ws.mode === "explore" ? "exploring" : "writing",
				choices: [...(ws.choices ?? []), { question, answer }] });
			result = { text: `用户已作答：「${answer}」。当前稿件版本 v${ws.version}。`, activity: `ask「${question.slice(0, 24)}」· 用户作答` };
		} else {
			if (name === "panel_write" || name === "panel_close") ws.panelWrites++;
			result = name === "previous_draft_read" || name === "previous_draft_edit"
				? o.previousDraft.run(ws, o.wsDeps, name, args)
				: o.mcpNames.has(name)
					? ((await runMcpStageTool(this.#deps.mcp!, name, args, signal)) ?? { text: `未知工具「${name}」。`, isError: true })
					: o.mediaNames.has(name)
						? ((await runMediaStageTool(this.#deps.cwd, name, args)) ?? { text: `未知工具「${name}」。`, isError: true })
						: o.readNames.has(name)
							? await this.#runReadTool(o, o.readDeps, name, args)
							: runWriteTool(ws, o.wsDeps, name, args);
		}
		const media = result as MediaStageResult;
		if (o.mediaNames.has(name) && media.details && media.isError !== true) {
			ws.mediaDeliveries ??= [];
			ws.mediaDeliveries.push({ toolName: name, toolCallId: id, details: media.details, text: result.text });
		}
		if (!ws.revision || ws.restorePending) {
			if (name !== "ask") recordSegment(ws, { kind: "tool", activity: { kind: "tool_start", name, detail: result.activity ?? "" } });
			recordSegment(ws, { kind: "tool", activity: { kind: "tool_end", name, detail: media.isError ? result.text : result.activity ?? "", ...(media.isError ? { isError: true } : {}) } });
		}
		if (result.activity) ev.onActivity?.(result.activity);
		return {
			content: [{ type: "text", text: result.text }],
			...(media.details ? { details: media.details } : {}),
			...(media.isError ? { isError: true } : {}),
			...((name === "draft_seal" && ws.sealed || name === "previous_draft_edit" && ws.revision) && !media.isError ? { terminate: true } : {}),
		};
	}


	/**
	 * 台上读侧工具，并把「查过世界」记进工作区。
	 *
	 * lookups 只用于观测，不参与收笔或查库次数门禁。skill_read 不计入事实读取。
	 */
	async #runReadTool(
		o: { ws: TurnWorkspace; language: string },
		readDeps: StageToolDeps,
		name: string,
		args: Record<string, unknown>,
	): Promise<ToolRunResult> {
		if (name !== "skill_read") o.ws.lookups++;
		return runStageTool(readDeps, name, args, o.language);
	}



	/**
	 * 台上工具的执行依赖（每次取用现读素材/账本——工具看到的世界与装配同源）。
	 * 写入许可统一由 RP 扩展的 tool_call 钩子判断。
	 */
	#toolDeps(): StageToolDeps {
		const cwd = this.#deps.cwd;
		const sm = this.#deps.getSession().sessionManager;
		/** 台上补充设定集路径（写侧落点；卡未装载时为空＝无 lorebook_write） */
		const chatDir = chatDirOfSessionDir(sm.getSessionDir?.());
		const cardDir = chatDir ? cardDirOfChatDir(chatDir) : null;
		const overlayOf = (): string => {
			try {
				const m = loadStageMaterials(cwd);
				return overlayPathFor(cwd, m.card.name, m.config.card);
			} catch {
				return "";
			}
		};
		// 世界书写侧宿主件：给出则全族可用（含用户的书），不给则退回「只写补充设定集」的旧行为
		const lh = this.#deps.loreHost;
		return {
			searchLore: (query, limit) => {
				const m = loadStageMaterials(cwd);
				// 语料 = 世界书（已挂载的独立书）+ 补充设定集；materials 已剥离外部插件协议条目。
				const hits = searchEntries(m.entries, query, limit);
				const marked = lh?.listMarked() as Array<LorebookEntry & { source?: string }> | undefined;
				return hits.map((h) => ({ ...h, entry: { ...h.entry, source: marked?.find((e) => loreFingerprint(e.content) === loreFingerprint(h.entry.content))?.source } }));
			},
			// ---- M-D2 写侧 / M-D7 改删与书一级：有宿主件走宿主件，否则退回 overlay ----
			writeLore: lh
				? lh.write
				: (input) => {
						const overlay = overlayOf();
						if (!overlay) return null;
						return appendOverlayEntry(overlay, input);
					},
			listLore: lh ? lh.listMarked : () => loadStageMaterials(cwd).entries,
			...(lh
				? {
						updateLore: lh.update,
						deleteLore: (fp: string) => lh.remove(fp),
						listBooks: lh.listBooks,
						createBook: lh.createBook,
						mountBook: lh.mountBook,
					}
				: {}),
			fingerprint: loreFingerprint,
			...(this.#deps.setDisabledLore ? { toggleLore: this.#deps.setDisabledLore } : {}),
			searchMemory: async (query) => {
				const search = this.#deps.searchMemory;
				let result: MemorySearchResult;
				try {
					const r = search ? await search(sm.getSessionId(), query) : { hits: [], sources: [{ scope: "session", status: "unavailable" as const }] };
					result = Array.isArray(r) ? { hits: r, sources: [{ scope: "session", status: "ok" }] } : r;
				} catch (e) { result = { hits: [], sources: [{ scope: "session", status: "error", error: e instanceof Error ? e.message : String(e) }] }; }
				if (cardDir) {
					try { result.hits.push(...searchCardMemory(cardDir, query)); result.sources.push({ scope: "card", status: "ok" }); }
					catch (e) { result.sources.push({ scope: "card", status: "error", error: String(e) }); }
				} else result.sources.push({ scope: "card", status: "unavailable" });
				return result;
			},
			...(this.#deps.readMemory || cardDir ? { readMemory: (ref: string) => ref.startsWith("card:")
				? cardDir ? readCardMemory(cardDir, ref) : undefined : this.#deps.readMemory?.(sm.getSessionId(), ref) } : {}),
			...(cardDir ? { updateMemory: (ref: string, version: string, content: string) => changeCardMemory(cardDir, ref, version, content)! } : {}),
			// ---- M-D3 向量库写侧：scope 由宿主绑定，模型只给内容（作用域不经模型） ----
			...(this.#deps.addMemory
				? { addMemory: (input: { text: string; title?: string }) => this.#deps.addMemory!(sm.getSessionId(), input) }
				: {}),
			...(this.#deps.listMemory || cardDir
				? { listMemory: (storeId: string) => storeId === "card" ? (cardDir ? listCardMemory(cardDir).map((d) => ({ ...d, id: d.ref })) : []) : this.#deps.listMemory?.(sm.getSessionId(), storeId) ?? [] }
				: {}),
			...(this.#deps.deleteMemory || cardDir
				? { deleteMemory: (storeId: string, id: string, version?: string) => {
					if (storeId !== "card") return this.#deps.deleteMemory?.(sm.getSessionId(), storeId, id) ?? false;
					if (!cardDir) return false;
					changeCardMemory(cardDir, id, version ?? ""); return true;
				} }
				: {}),
			// ---- M-D4 角色库：读卡面 / M-D7 改卡（改的是用户的卡文件，宿主负责热重载） ----
			readCard: () => {
				const m = loadStageMaterials(cwd);
				const c = m.card;
				if (!c) return null;
				return {
					name: c.name,
					description: c.description,
					personality: c.personality,
					scenario: c.scenario,
					firstMes: c.firstMes,
					mesExample: c.mesExample,
					systemPrompt: c.systemPrompt,
					creatorNotes: c.creatorNotes,
					tags: c.tags,
					alternateGreetings: c.alternateGreetings,
				};
			},
			...(this.#deps.updateCard ? { updateCard: this.#deps.updateCard } : {}),
			// ---- M-D5 面板：读/写/关（依赖由宿主按 session 注入） ----
			...(this.#deps.loadPanels
				? {
						loadPanels: () => this.#deps.loadPanels!(sm.getSessionId()),
						writePanel: (input: { name: string; kind: string; content: string; data?: Record<string, unknown> }) => {
								// 数据与外观分家：外观交给宿主落盘，数据攒着，封笔后随账本一起进状态树
								// （那儿才有分支/快照；同 storeSave 的「本拍内只登记意图」）。
								if (input.data && Object.keys(input.data).length > 0) {
									this.#pendingPanelData[input.name] = input.data;
								}
								return this.#deps.writePanel!(sm.getSessionId(), input);
							},
						closePanel: (name: string) => this.#deps.closePanel!(sm.getSessionId(), name),
					}
				: {}),
			// ---- M-D5 世界线：读存档表；store 推迟到封笔后（见 src/tools/worldline.ts 文件头） ----
			...(this.#deps.loadWorldline
				? { loadWorldline: () => this.#deps.loadWorldline!(sm.getSessionId()) }
				: {}),
			...(this.#deps.storeSave
				? {
						storeSave: (name: string) => {
							// 本拍内只登记意图：此刻叶位还是用户那条输入，钉在这儿的存档回退过去
							// 只有输入没有回复。真正钉档在 performTurn 的场记之后。
							this.#pendingSave = name.trim() || defaultSaveName();
							return { id: "", name: this.#pendingSave, worldlineName: "", deferred: true };
						},
					}
				: {}),
			getState: () => stateFromBranch(sm.getBranch() as BranchEntryLike[]),
			formatState,
			getSkill: (name, file, start, end) => {
				const m = loadStageMaterials(cwd);
				// {{可用skill}} 动态表格随「skill指导」（8/19 拆循环时删除）一并退役——
				// 标准形态下这张表就是 skill_read 的工具描述本身，不再由某条 skill 正文转发。
				return readStageSkill(cwd, name, file, start, end);
			},
		};
	}

	/**
	 * 每拍被动召回（【剧情记忆】块）：宿主未注入 recallMemory、开关关闭、查询过短、
	 * 超时或报错，一律返回 undefined——该块不出现，扮演照常进行（降级不阻断）。
	 */
	async #recallForBeat(sessionId: string, query: string): Promise<string | undefined> {
		const recall = this.#deps.recallMemory;
		if (!recall || !query.trim()) return undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const hits = await Promise.race([
				recall(sessionId, query),
				new Promise<null>((resolve) => {
					timer = setTimeout(() => resolve(null), RECALL_TIMEOUT_MS);
				}),
			]);
			if (hits === null) {
				console.warn(`[stage] 剧情记忆召回超时（>${RECALL_TIMEOUT_MS}ms），本拍不注入【剧情记忆】`);
				return undefined;
			}
			if (hits.length === 0) return undefined;
			return hits
				.map((h) => `- ${h.meta?.title ? `【${h.meta.title}】` : ""}${h.text.trim()}`)
				.join("\n");
		} catch (e) {
			console.warn("[stage] 剧情记忆召回失败，本拍不注入【剧情记忆】", e);
			return undefined;
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	/** 装配报告写盘（.liyuan/preset-assembly.json）——每块预设去向可查；内容不变不写 */
	#writeAssemblyReport(cwd: string, materials: StageMaterials, phAfter: AssembledPiece[]): void {
		try {
			const chars = (a: AssembledPiece[]) => a.reduce((n, p) => n + p.text.length, 0);
			const report = {
				preset: materials.presetDoc?.name ?? null,
				kind: materials.presetDoc?.kind ?? null,
				/** 送模字数：历史前段 + 本拍历史后段（深度注入数据层保真，尚未消费） */
				chars: {
					before: chars(materials.presetBefore),
					after: chars(phAfter),
					depth: chars(materials.presetDepth),
				},
				filledMarkers: [...materials.filledMarkers],
				// 刀3：卡常驻内容的来源——file=卡 AGENTS.md（chars 是文件字数）；projection=自动投影
				cardAgents: materials.cardAgents.trim()
					? { source: "file", chars: materials.cardAgents.length }
					: { source: "projection" },
				// M-C2：世界书/卡内嵌通道被判死的外部插件协议条目（判据可回溯）
				protocolDrops: materials.protocolDrops,
				blocks: materials.presetAssembly,
			};
			const json = JSON.stringify(report, null, "\t");
			if (json === this.#lastAssemblyJson) return;
			this.#lastAssemblyJson = json;
			const outDir = join(cwd, ".liyuan");
			mkdirSync(outDir, { recursive: true });
			writeFileSync(join(outDir, "preset-assembly.json"), json, "utf8");
		} catch {
			// 报告写失败不影响演出
		}
	}

	// M-A 起 #revise 精修旁路退役（8/10 验收整体退役，revise.ts 已删除）。

	/** 旁路文本调用（场记/压缩用）：静默收集，不外发增量；失败返回 {error} */
	async #sideText(
		model: StageModelLike,
		systemPrompt: string,
		userText: string,
		auth: { apiKey?: string; headers?: Record<string, string | null> },
		maxTokens = 8192,
		kind: SideTextStat["kind"] = "scribe",
		reasoning: string | undefined = "off",
	): Promise<string | { error: string }> {
		/**
		 * 旁路走哪条条目只有这一个主人：配了旁路条目就走它，没配就跟随剧情模型（入参那个）。
		 * 两个调用点（场记 / 压缩）因此不必各自判一遍。
		 */
		const side = this.#deps.getSideEntry?.();
		const chosen = side?.model ?? model;
		/**
		 * 换了模型就得换 key：入参那份 auth 是调用点按**剧情模型**取的，
		 * 旁路模型若在另一个渠道上，拿它去发必然 401。
		 */
		let sideAuth = auth;
		if (chosen !== model) {
			try {
				sideAuth = await this.#deps.getAuth(chosen);
			} catch (err) {
				return {
					error: `旁路模型 ${chosen.provider ?? "?"}/${chosen.id} 取鉴权失败：${err instanceof Error ? err.message : String(err)}`,
				};
			}
		}
		/**
		 * 档跟着条目走——用户在连接配置里给那条条目写的是什么就是什么，这里不替他改。
		 * 没配旁路条目时才回落调用点的默认（历史行为：off）。
		 */
		const level = side ? side.thinking : reasoning;
		const options: Record<string, unknown> = {
			apiKey: sideAuth.apiKey,
			headers: sideAuth.headers,
			maxTokens,
			signal: this.#abort?.signal,
			...(level !== undefined ? { reasoning: level } : {}),
		};
		const t0 = Date.now();
		let thinkChars = 0;
		let reported = false;
		/** 成败都要出回执——「跑了很久然后失败」和「很快失败」是两回事 */
		const report = (textChars: number) => {
			if (reported) return;
			reported = true;
			const stat: SideTextStat = {
				kind,
				model: `${chosen.provider ?? "?"}/${chosen.id}`,
				...(side?.label ? { entry: side.label } : {}),
				...(level !== undefined ? { thinking: level } : {}),
				ms: Date.now() - t0,
				thinkChars,
				textChars,
			};
			const line = sideStatLine(stat);
			this.#deps.events?.onActivity?.(line);
			console.log(`[stage-side] ${line}`);
		};
		try {
			const s = this.#deps.sideStreamFn(
				chosen,
				{
					systemPrompt,
					messages: [{ role: "user", content: [{ type: "text", text: userText }], timestamp: Date.now() }],
				},
				options,
			);
			let final: AssistantMsgLike | null = null;
			for await (const e of s) {
				if (e.type === "thinking_delta") thinkChars += (e.delta ?? "").length;
				else if (e.type === "done") final = e.message ?? null;
				else if (e.type === "error") {
					report(0);
					return { error: e.error?.errorMessage || `stopReason=${e.error?.stopReason ?? "?"}` };
				}
			}
			if (!final) {
				report(0);
				return { error: "流未产出最终消息" };
			}
			const text = textOfAssistant(final);
			report(text.length);
			return text || { error: "最终消息无文本" };
		} catch (err) {
			report(0);
			return { error: err instanceof Error ? err.message : String(err) };
		}
	}
}
