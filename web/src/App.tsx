/**
 * 梨园 Web 前端 — F1 骨架：顶栏驱动的面板系统（PLAN-PHASE3 v2 §2）。
 *
 * 交互模型（ST 同款，用户定调）：左右栏默认为空；点顶栏按钮在对应侧展开面板，
 * 再点收起、点同侧其他按钮切换；展开状态记入 localStorage（刷新恢复）。
 * 手机（<1000px）：面板变全屏抽屉。
 */

import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import {
	apiGet,
	apiGetCacheClear,
	apiGetCacheClearForPanel,
	apiGetCacheClearForToolNames,
	apiPost,
	personaAvatarUrl,
	prefetchPanelApis,
	uploadFile,
	type CardResponse,
	type CommandMeta,
	type PersonasResponse,
} from "./api.ts";
import {
	attachmentUrl,
	buildAttachmentLine,
	splitAttachments,
	toAttachmentView,
	type AttachmentView,
} from "./attachments.ts";
import { ArtifactPanel } from "./components/ArtifactPanel.tsx";
import { DraftPanel } from "./components/DraftPanel.tsx";
import { workspaceSegments } from "./draft-view.ts";
import type { DraftView } from "./wire.ts";
import { BrandLogo } from "./components/BrandLogo.tsx";
import { ConnectPanel } from "./components/ConnectPanel.tsx";
import { FloatWindow } from "./components/FloatWindow.tsx";
import { PreviewRunner, type CardPreviewRequestFrame } from "./components/PreviewRunner.tsx";
import { CardStudio } from "./components/CardStudio.tsx";
import { WelcomePanel } from "./components/HomePage.tsx";
import { StatusPanel } from "./components/StatusPanel.tsx";
import { UpdateModal, UpdateToast } from "./components/UpdateFlow.tsx";
import { PanelRefreshContext } from "./components/kit.tsx";
import { registerLiyuanToast, registerTavernChatBridge } from "./tavernShim.ts";
import { syncCardRuntimeVariables } from "./cardRuntimeFrames.ts";
import { setAtHome, shouldShowHomeOnBoot, touchVisit } from "./visit.ts";
import { getTheme, setTheme } from "./theme.ts";
import {
	IconApi,
	IconAttach,
	IconPlus,
	IconBell,
	IconCard,
	IconChevronDown,
	IconClose,
	IconDock,
	IconEdit,
	IconLorebook,
	IconNewChat,
	IconPanelLeft,
	IconPreset,
	IconPuzzle,
	IconRefresh,
	IconRoster,
	IconSend,
	IconSessions,
	IconSettings,
	IconSun,
	IconMoon,
	IconInfo,
	IconStatus,
	IconStop,
	IconUploads,
	IconWorldline,
} from "./components/icons.tsx";
import { LorebookPanel } from "./components/LorebookPanel.tsx";
import {
	BackstageGroup,
	Bubble,
	ChoiceCard,
	MsgAvatar,
	TurnTimeline,
	toolLabel,
	type ChatMsg,
	type SkinProp,
} from "./components/Messages.tsx";
import {
	appendActivity,
	appendDelta,
	concatSegments,
	pruneEmpty,
	resyncDraftSegs,
	segmentsFromLegacy,
	trailingText,
	type TurnSegment,
} from "./timeline.ts";
import type { DisplayRule } from "../../src/cardfront.ts";
import { authorScriptSig } from "../../src/authorScripts.ts";
import { skinAtDepth } from "../../src/postprocess.ts";
import { PanelDock } from "./components/PanelDock.tsx";
import { PanelOrb } from "./components/PanelOrb.tsx";
import { PowersPanel } from "./components/PowersPanel.tsx";
import { PresetPanel } from "./components/PresetPanel.tsx";
import { RolesPanel, type RolesTab } from "./components/RolesPanel.tsx";
import { RosterPanel } from "./components/RosterPanel.tsx";
import { ScriptHost } from "./components/ScriptHost.tsx";
import { SessionsPanel, NewProjectBox, nextProjectName } from "./components/SessionsPanel.tsx";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
import { AboutPanel } from "./components/AboutPanel.tsx";
import { SessionStatsBar, StatusStrip } from "./components/StatusStrip.tsx";
import { UploadsPanel } from "./components/UploadsPanel.tsx";
import { StoreModal, WorldlinePanel } from "./components/WorldlinePanel.tsx";
import { StoryPane, type StoryChapterView } from "./components/StoryPane.tsx";
import { useWire, type ConnState } from "./ws.ts";
import type {
	AuthorScript,
	ConversationMode,
	RpPanel,
	ServerFrame,
	WireActivity,
	WireChatInfo,
	WireSessionInfo,
	WireStats,
	WireStoryChapter,
	UpdateWire,
	WorldState,
} from "./wire.ts";

interface Toast {
	id: number;
	level: "info" | "warning" | "error";
	text: string;
}

/** 通知气泡自动消散时间；仍可点击立即关闭。info 多是「已保存」这类回执，看一眼就够 */
const TOAST_TTL_MS: Record<Toast["level"], number> = {
	info: 2000,
	warning: 6000,
	error: 8000,
};

/** 审计告警留存（原状态面板一栏，去中心化后进顶栏铃铛） */
interface WarnEntry {
	ts: number;
	level: "warning" | "error";
	text: string;
}

/** 待发送附件（已在服务端落盘，chip 移除只是不随消息发送，文件保留） */
interface PendingUpload extends AttachmentView {
	size: string;
}

// ---------- 面板注册表（PLAN-FRONTEND-V2 §二/§三：五个入口收为三键 + 一条抽屉轨） ----------

type PanelId =
	| "sessions"
	| "worldline"
	| "connect"
	| "preset"
	| "powers"
	| "settings"
	| "about"
	| "roles"
	| "lorebook"
	| "roster"
	| "uploads"
	| "status";

/** agent 自建面板的右栏选择 id（柱 2）：`agent:` + 面板名，页签随 panels 帧动态长出 */
type AgentPanelId = `agent:${string}`;
const agentId = (name: string): AgentPanelId => `agent:${name}`;

/**
 * 左抽屉轨位（PLAN-FRONTEND-V2 §三）。
 *
 * 判据只有一条：**换一个会话它还在不在**。在＝资产/配置，进抽屉；不在＝这一场戏的
 * 运行时状态，留聊天面或会话树。以后新面板往哪放照这条问，不必一事一议。
 */
const DRAWER_SECTIONS: PanelId[] = ["roles", "connect", "preset", "lorebook", "powers", "uploads"];
/** 抽屉可开全集＝轨位 + 轨底的设置与关于 */
const DRAWER_PANELS: PanelId[] = [...DRAWER_SECTIONS, "settings", "about"];
/** 右栏可开面板：状态栏 / 世界线 / 登场名录 / 会话树 / agent 面板（桌面端平立分栏，会话左移） */
const RIGHT_OPENABLE: PanelId[] = ["sessions", "status", "worldline", "roster"];

/**
 * 悬浮窗形态：保留为兜底，但在桌面端所有右侧面板统一走平立分栏，彻底消灭遮挡式弹窗。
 */
const FLOAT_PANELS = new Set<PanelId>([]);
/**
 * 悬浮窗形态判据。
 */
const isFloatPanel = (id: PanelId | AgentPanelId | null): id is PanelId | AgentPanelId =>
	id != null && FLOAT_PANELS.has(id as PanelId);

const PANEL_LABEL: Record<PanelId, string> = {
	sessions: "会话",
	worldline: "世界线",
	connect: "连接",
	preset: "提示词",
	powers: "扩展",
	settings: "设置",
	about: "关于",
	roles: "角色",
	lorebook: "世界书",
	roster: "登场名录",
	uploads: "资料",
	status: "状态栏",
};

/** 图标承载识别，文字进 tooltip/aria-label */
const PANEL_ICON: Record<PanelId, (p: { size?: number }) => React.JSX.Element> = {
	sessions: IconSessions,
	worldline: IconWorldline,
	connect: IconApi,
	preset: IconPreset,
	powers: IconPuzzle,
	settings: IconSettings,
	about: IconInfo,
	roles: IconCard,
	lorebook: IconLorebook,
	roster: IconRoster,
	uploads: IconUploads,
	status: IconStatus,
};

function loadPanelPrefs(): { left: PanelId | null; right: PanelId | null; lastSection: PanelId | null } {
	// 首启默认展开左栏卡库（2026-09-12 用户反馈：左栏收着时首屏只剩孤零零一个输入框，难看）
	const DEFAULT_LEFT: PanelId = "roles";
	try {
		const raw = JSON.parse(localStorage.getItem("liyuan.panels") ?? "{}") as Record<string, unknown>;
		const pick = (v: unknown, group: PanelId[]) => (group.includes(v as PanelId) ? (v as PanelId) : null);
		const lastSection = pick(raw.left, DRAWER_PANELS);
		/**
		 * 手机上抽屉是铺满的：还原成「开着」＝打开应用先看见面板而不是聊天，
		 * 与「聊天界面保持干净」相反。所以窄屏只记住是哪一格，不记住开着。
		 * 桌面抽屉浮在左留白上，不挡聊天，沿用原来的还原行为。
		 */
		const mobile = typeof matchMedia !== "undefined" && matchMedia("(max-width: 999px)").matches;
		return { left: mobile ? null : (lastSection ?? DEFAULT_LEFT), right: pick(raw.right, RIGHT_OPENABLE), lastSection };
	} catch {
		const mobile = typeof matchMedia !== "undefined" && matchMedia("(max-width: 999px)").matches;
		return { left: mobile ? null : DEFAULT_LEFT, right: null, lastSection: null };
	}
}

export default function App() {
	const [conn, setConn] = useState<ConnState>("connecting");
	const [charName, setCharName] = useState("梨园");
	const [userName, setUserName] = useState("");
	/** 对话头像：角色卡 PNG / 当前用户身份 */
	const [charAvatarUrl, setCharAvatarUrl] = useState<string | null>(null);
	const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(null);
	const [messages, setMessages] = useState<ChatMsg[]>([]);
	const [streamText, setStreamText] = useState("");
	const [draftWorkspace, setDraftWorkspace] = useState<DraftView>();
	const [draftHistory, setDraftHistory] = useState<{ id: string; revisions: Array<{ version: number; text: string; reason: string; at: number }> }>();
	const [streamThinking, setStreamThinking] = useState("");
	/** 本轮时间线的实时渲染态（与 turnSegsRef 同内容） */
	const [liveSegs, setLiveSegs] = useState<TurnSegment[]>([]);
	const [thinkingLive, setThinkingLive] = useState(false);
	const [busy, setBusy] = useState(false);
	const [conversationMode, setConversationMode] = useState<ConversationMode>("roleplay");
	const modeRef = useRef<ConversationMode>("roleplay");
	const [streamMode, setStreamMode] = useState<ConversationMode>("roleplay");
	const streamModeRef = useRef<ConversationMode>("roleplay");
	/** agent 模式：当前分支章目录（hello 同帧）；正文按目录指纹变化才拉 GET /api/story */
	const [storyOutline, setStoryOutline] = useState<WireStoryChapter[] | null>(null);
	const [storyChapters, setStoryChapters] = useState<StoryChapterView[] | null>(null);
	/** 手机：稿子与讨论是两个页签 */
	const [storyTab, setStoryTab] = useState<"story" | "chat">("chat");
	/** 讨论区章卡片点击 → 稿子视图滚到该章 */
	const [storyFocus, setStoryFocus] = useState<{ chapterId: string; tick: number } | null>(null);
	const [toolNote, setToolNote] = useState<string | null>(null);
	/** 本轮过程步骤（实时清单渲染用；与 turnActsRef 同内容） */
	const [liveActs, setLiveActs] = useState<WireActivity[]>([]);
	const [toasts, setToasts] = useState<Toast[]>([]);
	// 在线更新：WS update 帧驱动；modal 开关与 ready 气泡的本次会话收起标记
	const [updateInfo, setUpdateInfo] = useState<UpdateWire | null>(null);
	const [updateModalOpen, setUpdateModalOpen] = useState(false);
	const [updateToastDismissed, setUpdateToastDismissed] = useState(false);
	const updateErrRef = useRef<string | null>(null);
	// 顶栏「新建」：点击出两项（新建项目 / 新建对话，2026-09-14 用户点名——一般先建项目）
	const [newMenuOpen, setNewMenuOpen] = useState(false);
	const [namingProject, setNamingProject] = useState(false);
	const [input, setInput] = useState("");
	// 待发送附件（附件随消息，上传即落服务端 .liyuan-uploads/，发送时路径附在消息尾行）
	const [pending, setPending] = useState<PendingUpload[]>([]);
	const [uploading, setUploading] = useState(false);
	const [atBottom, setAtBottom] = useState(true);
	/** 消息内联编辑：idx + 草稿 + 类型（用户改写后 reroll / agent 改写后 editreply） */
	const [msgEdit, setMsgEdit] = useState<{ idx: number; kind: "user" | "narrative" | "greeting"; draft: string } | null>(
		null,
	);
	/** 手机端输入框左侧工具收纳：展开成上方一行（桌面端按钮常驻，此态无效） */
	const [composerTools, setComposerTools] = useState(false);
	const [sessions, setSessions] = useState<WireSessionInfo[] | null>(null);
	/** 两层布局的子项目清单（null＝老布局/未下发 ⇒ 面板回落扁平列表） */
	const [chats, setChats] = useState<WireChatInfo[] | null>(null);
	// 右栏数据
	const [worldState, setWorldState] = useState<WorldState | null>(null);
	const [stats, setStats] = useState<WireStats | null>(null);
	const [warnings, setWarnings] = useState<WarnEntry[]>([]);
	const [bellOpen, setBellOpen] = useState(false);
	// 决策门禁（Phase 4 柱 1）：当前挂起的选择卡（live 交互；应答后收敛，留痕由重放消息渲染）
	const [activeChoice, setActiveChoice] = useState<{ id: string; question: string; options: string[]; placeholder?: string } | null>(null);
	/** agent 请求页面渲染创作稿（card_preview 帧）：可见地跑一次并回报 */
	const [previewRequest, setPreviewRequest] = useState<CardPreviewRequestFrame | null>(null);
	// agent 自建面板（柱 2）：server 推送的活跃面板全量（页签序）；入口在面板坞，展开到左栏
	const [agentPanels, setAgentPanels] = useState<RpPanel[]>([]);
	// 面板系统
	const initialPanels = useMemo(loadPanelPrefs, []);
	const [leftPanel, setLeftPanel] = useState<PanelId | AgentPanelId | null>(initialPanels.left);
	const [rightPanel, setRightPanel] = useState<PanelId | AgentPanelId | null>(initialPanels.right);
	/** 悬浮窗当前显示的面板（与左右栏并列的第三种形态，同时只开一个） */
	const [floatPanel, setFloatPanel] = useState<PanelId | AgentPanelId | null>(null);
	const [studioOpen, setStudioOpen] = useState(false);
	const [dark, setDark] = useState(() => getTheme() === "dark");
	/** 悬浮窗「刷新」用：+1 强制重挂载窗内面板（与侧栏 manualTick 同机制） */
	const [floatTick, setFloatTick] = useState(0);
	// 手机（≤999px，与 CSS 抽屉断点一致）：左右栏是全屏抽屉，同时只能开一个。
	// 用 ref 避免把它塞进每个 setter 的依赖；开一侧时若在手机上，先关另一侧。
	const mobileRef = useRef(typeof matchMedia !== "undefined" && matchMedia("(max-width: 999px)").matches);
	useEffect(() => {
		if (typeof matchMedia === "undefined") return;
		const mq = matchMedia("(max-width: 999px)");
		const sync = () => {
			mobileRef.current = mq.matches;
			// 切到手机宽度时若两侧都开着，收起右侧只留左侧，回到「单开」不变量
			if (mq.matches) setRightPanel((r) => (r && leftPanelRef.current ? null : r));
		};
		sync();
		mq.addEventListener("change", sync);
		return () => mq.removeEventListener("change", sync);
	}, []);
	/**
	 * 开左栏：手机上先关右栏（单开不变量）。传 null 或函数式更新按原样透传。
	 * 悬浮窗形态的面板从这里改道——入口（底栏钮 / `/line` / 会话面板里的跳转）都不必知道它换了形态。
	 */
	const openLeft = useCallback((next: PanelId | AgentPanelId | null) => {
		if (isFloatPanel(next)) {
			setFloatPanel(next);
			return;
		}
		if (mobileRef.current && next !== null) setRightPanel(null);
		setLeftPanel(next);
	}, []);
	/** 开右栏：手机上先关左栏（桌面端平立分栏，会话左移） */
	const openRight = useCallback((next: PanelId | AgentPanelId | null) => {
		if (mobileRef.current && next !== null) setLeftPanel(null);
		setRightPanel(next);
	}, []);
	/** 切换右栏面板（点同钮收起，点异钮切换） */
	const toggleRight = useCallback(
		(id: PanelId | AgentPanelId) => {
			openRight(rightPanelRef.current === id ? null : id);
		},
		[openRight],
	);
	/** 打开写卡平台：折叠左栏，收起右视窗，4:6桌面分栏展开 */
	const openStudio = useCallback(() => {
		openLeft(null);
		openRight(null);
		setStudioOpen(true);
	}, [openLeft, openRight]);
	/** 切换写卡平台开合 */
	const toggleStudio = useCallback(() => {
		if (studioOpen) {
			setStudioOpen(false);
		} else {
			openStudio();
		}
	}, [studioOpen, openStudio]);
	/** 角色板块的当前页签：角色卡库 ⇄ 用户角色 */
	const [rolesTab, setRolesTab] = useState<RolesTab>("card");
	/** 抽屉上次停在哪一格（收起后仍记住，见落盘 effect 与 toggleDrawer） */
	const lastSectionRef = useRef<PanelId | null>(initialPanels.lastSection);
	/** /store 存档命名弹窗 */
	const [storeOpen, setStoreOpen] = useState(false);
	const [storeDefaultName, setStoreDefaultName] = useState("");
	const [ttsBusy, setTtsBusy] = useState(false);
	/**
	 * 欢迎区（学 ST）：嵌在聊天流内，不关顶栏/输入框。
	 * 久未访问启动显示；点品牌强制打开；开会话/发消息后收起。
	 */
	const [welcome, setWelcome] = useState(() => shouldShowHomeOnBoot());

	const dismissWelcome = useCallback(() => {
		setWelcome(false);
		setAtHome(false); // 进入对话：刷新可续聊
		touchVisit();
	}, []);

	const showWelcome = useCallback(() => {
		setWelcome(true);
		setAtHome(true); // 主动回主页：刷新仍停主页，不再被短间隔续聊
		setSessions(null);
		setChats(null);
	}, []);

	const openStoreModal = useCallback(() => {
		const d = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		setStoreDefaultName(`存档 ${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`);
		setStoreOpen(true);
	}, []);

	// 面板刷新（横切基建）：agentTick 每轮 agent 结束递增（watchAgent 面板自动重拉）；
	// manualTick 手动刷新按侧递增（key 重挂载=显式重置，含表单草稿）
	const [agentTick, setAgentTick] = useState(0);
	const [manualTick, setManualTick] = useState({ left: 0, right: 0 });
	/**
	 * 面板保活：ST 式「打开过就缓存」。关闭侧栏只隐藏 DOM，不卸载，
	 * 再开时不重复「读取中…」；每侧最多保留 5 个最近打开的面板。
	 */
	const [leftKeep, setLeftKeep] = useState<Array<PanelId | AgentPanelId>>(() =>
		// 用 lastSection 而非 left：手机上抽屉不还原成开着，但「上次是哪一格」要记住
		initialPanels.lastSection ? [initialPanels.lastSection] : [],
	);
	const [rightKeep, setRightKeep] = useState<Array<PanelId | AgentPanelId>>(() => (initialPanels.right ? [initialPanels.right] : []));
	useEffect(() => {
		if (!leftPanel) return;
		setLeftKeep((prev) => [leftPanel, ...prev.filter((x) => x !== leftPanel)].slice(0, 5));
	}, [leftPanel]);
	useEffect(() => {
		if (!rightPanel) return;
		setRightKeep((prev) => [rightPanel, ...prev.filter((x) => x !== rightPanel)].slice(0, 5));
	}, [rightPanel]);

	const streamRef = useRef("");
	const streamThinkingRef = useRef("");
	const turnActsRef = useRef<WireActivity[]>([]);
	/**
	 * 本轮时间线（思考/工具/正文按发生顺序）：取代「三条并行通道各占固定分区」的旧结构。
	 * ref 供定稿时附着到消息，state 供生成中的实时渲染。
	 */
	const turnSegsRef = useRef<TurnSegment[]>([]);
	const sessionIdRef = useRef("");
	/** 用户已按停止：忽略迟到 delta，避免 UI 解锁后还在刷字 */
	const abortingRef = useRef(false);
	const rightPanelRef = useRef<PanelId | AgentPanelId | null>(initialPanels.right);
	// onFrame 闭包内读最新面板/左栏选择（useCallback 依赖冻结，走 ref 防陈旧）
	const agentPanelsRef = useRef<RpPanel[]>([]);
	const leftPanelRef = useRef<PanelId | AgentPanelId | null>(initialPanels.left);
	const welcomeRef = useRef(false);
	/** 在 onFrame 里发 WS（useWire 后于 onFrame 定义，走 ref） */
	const sendRef = useRef<(frame: import("./wire.ts").ClientFrame) => void>(() => {});
	const toastSeq = useRef(0);
	const listRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const uploadInputRef = useRef<HTMLInputElement>(null);
	const atBottomRef = useRef(true);

	useEffect(() => {
		/**
		 * 抽屉收起时不把 left 写成 null——那会抹掉「上次开的是哪一格」。
		 * 记住格子、不记住开合：手机下次开应用先看见聊天，点开抽屉仍回到原来那格。
		 */
		const left = leftPanel ?? lastSectionRef.current;
		if (leftPanel && DRAWER_PANELS.includes(leftPanel as PanelId)) lastSectionRef.current = leftPanel as PanelId;
		localStorage.setItem("liyuan.panels", JSON.stringify({ left, right: rightPanel }));
	}, [leftPanel, rightPanel]);

	// 手机键盘顶起：用 visualViewport 把被挡高度写入 --kb-inset，避免输入框被盖住
	useEffect(() => {
		const vv = window.visualViewport;
		if (!vv) return;
		const sync = () => {
			const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
			document.documentElement.style.setProperty("--kb-inset", `${Math.round(gap)}px`);
		};
		sync();
		vv.addEventListener("resize", sync);
		vv.addEventListener("scroll", sync);
		return () => {
			vv.removeEventListener("resize", sync);
			vv.removeEventListener("scroll", sync);
			document.documentElement.style.removeProperty("--kb-inset");
		};
	}, []);

	useEffect(() => {
		leftPanelRef.current = leftPanel;
	}, [leftPanel]);

	useEffect(() => {
		rightPanelRef.current = rightPanel;
	}, [rightPanel]);

	/**
	 * MVU 变量投递（唯一通道）：把账本里的 MVU 树（worldState.mvu）送进所有脚本 iframe 的
	 * window.__liyuanVariables，卡自带的 setInterval 轮询 getAllVariables 自行点亮/刷新状态栏面板。
	 *
	 * 两个方向都要，缺一即漏：
	 * - **推**：mvu 变化（场记记账后 state 帧到达）→ 广播给当前所有 iframe。
	 * - **拉**：新 iframe 滚进视口/切会话后才 boot，错过了上一次广播 → 它 onload 时 postMessage
	 *   {liyuanVariablesReady} 主动要一次，这里应答。与高度上报（子→父 postMessage）同款。
	 *
	 * 卡脚本读 getAllVariables().stat_data，而账本的 mvu 就是那棵 stat_data 树，故包一层 {stat_data}。
	 * 只投递给正式消息帧和脚本宿主，创作预览使用独立测试数据。
	 */
	useEffect(() => {
		const mvu = worldState?.mvu;
		if (!mvu || typeof mvu !== "object") return;
		return syncCardRuntimeVariables(mvu);
	}, [worldState?.mvu]);

	useEffect(() => {
		welcomeRef.current = welcome;
		if (!welcome) return;
		// 回主页：滚到欢迎区最顶（两帧后布局已换，避免停在对话流原滚动位）
		const id1 = requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				const el = listRef.current;
				if (el) el.scrollTop = 0;
			});
		});
		return () => cancelAnimationFrame(id1);
	}, [welcome]);

	const pushToast = useCallback((level: Toast["level"], text: string) => {
		const id = ++toastSeq.current;
		setToasts((ts) => [...ts, { id, level, text }]);
		window.setTimeout(() => {
			setToasts((ts) => ts.filter((t) => t.id !== id));
		}, TOAST_TTL_MS[level]);
	}, []);

	/**
	 * agent 模式的稿子：hello 只带章目录，正文按「目录指纹」变化才拉一次 GET /api/story（gzip）。
	 * 指纹＝chapterId:version 序列——写章/修订/回退/分叉都会改它；纯讨论一轮不变，零请求。
	 */
	const storyKey = storyOutline ? storyOutline.map((c) => `${c.chapterId}:${c.version}`).join("|") : null;
	useEffect(() => {
		if (storyKey === null) { setStoryChapters(null); return; }
		if (storyKey === "") { setStoryChapters([]); return; }
		let live = true;
		void apiGet<{ chapters: StoryChapterView[] }>("/api/story", { bypassCache: true })
			.then((r) => { if (live) setStoryChapters(r.chapters); })
			.catch((e) => { if (live) pushToast("warning", `读取稿子失败：${e instanceof Error ? e.message : String(e)}`); });
		return () => { live = false; };
	}, [storyKey, pushToast]);

	const doTts = useCallback(
		async (text: string) => {
			const t = text.trim();
			if (!t || ttsBusy) return;
			setTtsBusy(true);
			try {
				await apiPost<{ ok: boolean; src: string }>("/api/tts", {
					text: t.slice(0, 4000),
					caption: t.slice(0, 40),
				});
				pushToast("info", "配音已生成");
			} catch (err) {
				pushToast("error", err instanceof Error ? err.message : String(err));
			} finally {
				setTtsBusy(false);
			}
		},
		[ttsBusy, pushToast],
	);

	const clearStream = () => {
		streamRef.current = "";
		streamThinkingRef.current = "";
		setStreamText("");
		setStreamThinking("");
	};

	/** 时间线写入的唯一入口（ref + state 同步，避免两者漂移） */
	const setSegs = (next: TurnSegment[]) => {
		turnSegsRef.current = next;
		setLiveSegs(next);
	};
	/** 流式增量进时间线：稿件流（draft=true，reset=本次调用首块）替换末尾正文段，其余同类并入末段 */
	const pushSegDelta = (kind: "text" | "thinking", delta: string, draft?: boolean, reset?: boolean) => {
		setSegs(appendDelta(turnSegsRef.current, kind, delta, draft, reset));
	};
	/** 丢弃旁白正文段（stream:clear）：稿段是作品一概保留；非稿 text 段全清——
	 * 台上引擎只在稿落地前发 clear（那时不存在合法尾巴段，所有非稿段都是读题/计划旁白），
	 * 状态栏等尾巴产出于稿落地后，不会被误删。 */
	const dropSegDraft = () => {
		setSegs(turnSegsRef.current.filter((s) => !(s.kind === "text" && s.draft !== true)));
	};
	const resetSegs = () => {
		setSegs([]);
	};

	/** 本轮过程步骤追加：ref 供定稿时附着到消息，state 供生成中的实时清单渲染（codex 式全程可见） */
	const pushAct = (a: WireActivity) => {
		turnActsRef.current = [...turnActsRef.current, a];
		setLiveActs(turnActsRef.current);
		setSegs(appendActivity(turnSegsRef.current, a));
	};
	const resetActs = () => {
		turnActsRef.current = [];
		setLiveActs([]);
	};
	/**
	 * 中间旁白留档：模型在调工具前吐出的计划文字被服务端从叙事流过滤时，客户端把它收进过程清单。
	 * 时间线侧只取**末尾**中间态正文（前面轮次已定稿的正文不算旁白）。
	 */
	const captureStreamNote = () => {
		const t = (trailingText(turnSegsRef.current) || streamRef.current).trim();
		if (!t) return;
		turnActsRef.current = [
			...turnActsRef.current,
			{ kind: "note", name: "", detail: t.length > 400 ? `${t.slice(0, 400)}…` : t },
		];
		setLiveActs(turnActsRef.current);
	};

	/**
	 * 同一条用户输入只对应一个角色气泡：若本轮（最近一条剧情 user 之后）已有
	 * narrative/backstage，则合并正文/思维链/过程条，而不是再 append 一条。
	 */
	const upsertTurnReply = (ms: ChatMsg[], incoming: ChatMsg): ChatMsg[] => {
		const channel = incoming.channel;
		if (channel !== "narrative" && channel !== "backstage") return [...ms, incoming];

		let lastStoryUser = -1;
		for (let i = ms.length - 1; i >= 0; i--) {
			if (ms[i].channel === "user" && ms[i].mode === undefined && !ms[i].backstage) {
				lastStoryUser = i;
				break;
			}
		}
		for (let i = ms.length - 1; i > lastStoryUser; i--) {
			if (ms[i].channel !== channel) continue;
			const prev = ms[i];
			const text = [prev.text, incoming.text].map((s) => (s ?? "").trim()).filter(Boolean).join("\n\n");
			const thinking = [prev.thinking, incoming.thinking].map((s) => (s ?? "").trim()).filter(Boolean).join("\n\n");
			const activities = [...(prev.activities ?? []), ...(incoming.activities ?? [])];
			// 时间线首尾相接（缺席方由旧字段合成），整体时序 = 先前轮在前
			const segments = pruneEmpty(
				concatSegments(
					prev.segments ?? segmentsFromLegacy(prev),
					incoming.segments ?? segmentsFromLegacy(incoming),
				),
			);
			const unfinished = prev.unfinished === true || incoming.unfinished === true;
			const merged: ChatMsg = {
				...prev,
				...incoming,
				text,
				...(thinking ? { thinking } : {}),
				...(activities.length ? { activities } : {}),
				...(segments.length ? { segments } : {}),
				...(unfinished ? { unfinished: true } : {}),
			};
			if (!unfinished) delete merged.unfinished;
			return [...ms.slice(0, i), merged, ...ms.slice(i + 1)];
		}
		return [...ms, incoming];
	};

	/** 一档卡皮肤：显示向规则（启用且有规则时注入对话流） */
	const [cardSkin, setCardSkin] = useState<SkinProp | null>(null);
	/**
	 * 作者运行时脚本（页面级）：卡/预设声明的悬浮球等常驻 UI，交 ScriptHost 跑。
	 * 与 cardSkin 同源同车（cardfront 快照）但各走各的通道——那是「页面上常驻什么」，
	 * 不是「这条消息怎么画」，故不受 hasSkin（有没有显示规则）影响，只受皮肤总开关约束。
	 */
	const [authorScripts, setAuthorScripts] = useState<AuthorScript[]>([]);
	/** 生成中的这条就是最新消息（depth 0）：作者「N 楼外删掉」类规则不该落在它头上 */
	const liveSkin = useMemo(() => skinAtDepth(cardSkin, 0), [cardSkin]);
	/** 当前这批作者脚本的清单指纹（见 syncAuthorScripts）；声明在两个使用者之前 */
	const authorSigRef = useRef<string>("");
	const refreshCardFront = useCallback(async () => {
		try {
			// 显式清缓存 + bypass:换卡/hello 后绝对不能吃上一张卡的 rules
			apiGetCacheClear("/api/cardfront");
			const r = await apiGet<{
				enabled: boolean;
				hasSkin: boolean;
				rules: DisplayRule[];
				charName: string;
				userName: string;
			}>("/api/cardfront", { bypassCache: true });
			setCardSkin(r.enabled && r.hasSkin ? { rules: r.rules, charName: r.charName, userName: r.userName } : null);
			if (!r.enabled) {
				authorSigRef.current = "";
				setAuthorScripts([]);
			}
		} catch {
			// hello 已注入时保留;仅 REST 失败且当前无皮时保持 null
		}
	}, []);

	/**
	 * 作者脚本正文：**只在清单指纹变了才拉**（换卡/换预设）。
	 * 正文实测可达 3.58MB，而 refreshCardFront 每次 hello 都跑——默认带上正文
	 * 就是每次重放/回退白拉一遍。指纹由服务端的轻清单算出，与 ScriptHost 的
	 * generation 同一算法（authorScriptSig，共用一份）。
	 */
	const syncAuthorScripts = useCallback(
		async (manifest: Array<{ id: string; source: "preset" | "card"; len: number; hash?: string }> | undefined, enabled: boolean) => {
			if (!enabled) {
				authorSigRef.current = "";
				setAuthorScripts([]);
				return;
			}
			// 旧服务端没有这个字段：什么都不做（没有页面级脚本这回事）
			if (!manifest) return;
			const sig = authorScriptSig(manifest);
			if (sig === authorSigRef.current) return; // 同一批脚本，宿主不必重启
			authorSigRef.current = sig;
			if (!manifest.length) {
				setAuthorScripts([]);
				return;
			}
			try {
				apiGetCacheClear("/api/cardfront?scripts=1");
				const r = await apiGet<{ enabled: boolean; scripts?: AuthorScript[] }>("/api/cardfront?scripts=1", {
					bypassCache: true,
				});
				if (authorSigRef.current === sig) setAuthorScripts(r.enabled ? (r.scripts ?? []) : []);
			} catch {
				// 拉不到就当没有：球不出现，不影响正文与其它面板
				if (authorSigRef.current === sig) authorSigRef.current = "";
			}
		},
		[],
	);

	/** 拉角色卡立绘 + 当前身份头像（hello / 切卡后） */
	const refreshAvatars = useCallback(() => {
		void (async () => {
			try {
				const card = await apiGet<CardResponse>("/api/card");
				if (card.path && /\.png$/i.test(card.path)) {
					// 不拼缓存参数：新鲜度由服务端 ETag 保证（换过卡图 mtime 就变）。
					// 拼 `&t=Date.now()` 会让这张几 MB 的卡图永不命中缓存，且与 CardPanel 的
					// 同一张图分成两个 URL 各下一遍。
					setCharAvatarUrl(`/api/cards/image?path=${encodeURIComponent(card.path)}`);
				} else {
					setCharAvatarUrl(null);
				}
			} catch {
				setCharAvatarUrl(null);
			}
			try {
				const pr = await apiGet<PersonasResponse>("/api/personas");
				const active = pr.personas.find((p) => p.id === pr.activeId);
				if (active?.avatar) {
					// 不拼 bust：新鲜度由服务端 ETag 保证（换头像 mtime 就变）。
					// Date.now() 会让 URL 每次都变，缓存永不命中（与卡图 &t= 同病）
					setUserAvatarUrl(personaAvatarUrl(active.id));
				} else {
					setUserAvatarUrl(null);
				}
			} catch {
				setUserAvatarUrl(null);
			}
		})();
	}, []);

	const onFrame = useCallback(
		(frame: ServerFrame) => {
			switch (frame.type) {
				case "hello": {
					modeRef.current = frame.conversationMode ?? "roleplay";
					setConversationMode(modeRef.current);
					streamModeRef.current = frame.turnMode ?? modeRef.current;
					setStreamMode(streamModeRef.current);
					setStoryOutline(modeRef.current === "agent" ? frame.story?.chapters ?? [] : null);
					setCharName(frame.charName);
					setUserName(frame.userName);
					// wire timeline → 本地 segments：持久化的时间线在刷新后仍按时序渲染
					const sameSession = sessionIdRef.current === frame.sessionId;
					const keepComposerFocus = document.activeElement === inputRef.current;
					setMessages(
						frame.messages.map((m) => {
							if (!m.timeline || m.timeline.length === 0) return m;
							return { ...m, segments: m.timeline as unknown as TurnSegment[] };
						}),
					);
					if (!sameSession) setMsgEdit(null);
					if (keepComposerFocus) requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
					setWorldState(frame.state);
					setStats(frame.stats);
					// 一档皮肤:优先用 hello 同帧载荷(与消息同步),杜绝 REST 缓存/时序导致的漏皮
					if (frame.cardfront) {
						const cf = frame.cardfront;
						setCardSkin(
							cf.enabled && cf.hasSkin
								? { rules: cf.rules, charName: cf.charName, userName: cf.userName }
								: null,
						);
						// 作者脚本：hello 只带轻清单，正文按指纹变化才拉（见 syncAuthorScripts）
						void syncAuthorScripts(cf.scriptManifest, cf.enabled);
					} else {
						// 旧服务端无 cardfront 字段时才回落 REST。
						// ⚠ 8/29：这里原先是**无条件**再拉一次（注释写的是「回落」，实现却每次都跑）——
						// 而 enabled/hasSkin/rules/charName/userName 帧里全都有、还是服务端当场算的，
						// 比 REST 更权威。那一次 bypass 强拉（/api/cardfront，gzip 27KB）纯冗余，
						// 且会第二次 setCardSkin 把卡皮肤对象换新 → 卡界面 iframe 白重建一遍，
						// 就是「新建对话时界面强制刷新一次」里看得见的那一下。
						void refreshCardFront();
					}
					agentPanelsRef.current = frame.panels ?? [];
					setAgentPanels(agentPanelsRef.current);
					// 恢复/切换后左栏若停在已不存在的 agent 面板上：收起
					const sel = leftPanelRef.current;
					if (sel?.startsWith("agent:") && !agentPanelsRef.current.some((p) => agentId(p.name) === sel)) {
						setLeftPanel(null);
					}
					clearStream();
					resetSegs();
					// 切到别的会话：清空会话内数据（同会话的命令后重放则保留）
					if (sessionIdRef.current !== frame.sessionId) {
						sessionIdRef.current = frame.sessionId;
						setWarnings([]);
						setActiveChoice(null);
						turnActsRef.current = [];
						// 列表「当前」标记已变：重拉（+短延迟再拉一次，等 rp-card 落盘）。
						// 不清空旧列表——清空只会让面板空白 672ms（实测）再长回来，
						// 那就是「新建对话时会话记录强制刷新一次」的观感来源。
						// 旧列表在新列表到达前仍是当时最好的答案，就地替换即可。
						if (welcomeRef.current || leftPanelRef.current === "sessions") {
							sendRef.current({ type: "sessions" });
							window.setTimeout(() => sendRef.current({ type: "sessions" }), 350);
						}
					} else if (welcomeRef.current || leftPanelRef.current === "sessions") {
						// 同会话 hello（重载）：刷新列表
						sendRef.current({ type: "sessions" });
					}
						document.title = "梨园";
						setDraftWorkspace(frame.workspace);
						setDraftHistory(undefined);
						setBusy(frame.streaming === true);
						if (frame.streaming && frame.workspace && !frame.workspace.entryId) {
							const segs = workspaceSegments(frame.workspace);
							setSegs(segs);
							streamRef.current = segs.filter((s) => s.kind === "text").map((s) => s.text).join("");
							setStreamText(streamRef.current);
						}
						refreshAvatars();
					break;
				}
				case "conversation_mode":
					modeRef.current = frame.mode;
					setConversationMode(frame.mode);
					streamModeRef.current = frame.turnMode ?? frame.mode;
					setStreamMode(streamModeRef.current);
					if (frame.turnMode !== undefined ? frame.turnMode !== "roleplay" : frame.mode !== "roleplay") setDraftWorkspace(undefined);
					break;
				case "message":
					if (frame.message.channel === "narrative" || frame.message.channel === "backstage") {
						clearStream();
						setToolNote(null);
						// 过程条：把本轮积累的步骤（工具+旁白）收进定稿消息的单个折叠（不持久化，刷新即失）
						const acts = turnActsRef.current;
						// 时间线：**优先 wire 持久化的**（定稿 = finalText，尾巴已并入、多稿已替换、
						// 皮肤已应用——权威版）；实时构建的只做兜底（旧服务端无 rpTimeline 时）。
						const segs = frame.message.timeline?.length
							? (frame.message.timeline as unknown as TurnSegment[])
							: turnSegsRef.current.length > 0
								? turnSegsRef.current
								: undefined;
						resetActs();
						resetSegs();
						const incoming: ChatMsg = {
							...frame.message,
							...(acts.length ? { activities: acts } : {}),
							...(segs?.length ? { segments: segs } : {}),
						};
						setMessages((ms) => upsertTurnReply(ms, incoming));
					} else if (frame.message.channel === "greeting") {
						// 未开聊时切换开场白：替换已有开场白气泡，禁止往下叠楼
						setMessages((ms) => {
							const hasUser = ms.some((m) => m.channel === "user" && m.mode === undefined && !m.backstage);
							if (hasUser) return [...ms, frame.message];
							const rest = ms.filter((m) => m.channel !== "greeting");
							return [...rest, frame.message];
						});
					} else {
						setMessages((ms) => [...ms, frame.message]);
					}
					break;
				case "delta":
					if (abortingRef.current) break;
					if (frame.kind === "text") {
						setThinkingLive(false);
						streamRef.current += frame.delta;
						setStreamText(streamRef.current);
					} else {
						setThinkingLive(true);
						streamThinkingRef.current += frame.delta;
						setStreamThinking(streamThinkingRef.current);
					}
					pushSegDelta(frame.kind, frame.delta, frame.draft, frame.reset);
					break;
					case "draft_resync":
					// 修复后的稿件分段重同步：全部稿段原位替换成修后分段（该段原地变新）
					if (abortingRef.current) break;
					setSegs(resyncDraftSegs(turnSegsRef.current, frame.segments));
						break;
					case "draft_workspace": {
						setDraftWorkspace(frame.workspace);
						if (frame.streaming && !frame.workspace.entryId) {
							const segs = workspaceSegments(frame.workspace);
							setSegs(segs);
							streamRef.current = segs.filter((s) => s.kind === "text").map((s) => s.text).join("");
							setStreamText(streamRef.current);
						}
						break;
					}
					case "draft_history":
						setDraftHistory({ id: frame.id, revisions: frame.revisions });
						break;
				case "stream":
					// 中间 tool 轮被 server 过滤：计划旁白留档进过程清单，再清流式半成品
					if (frame.state === "clear") {
						captureStreamNote();
						dropSegDraft();
						clearStream();
						setThinkingLive(false);
					}
					break;
				case "agent":
					if (frame.state === "start") {
						// 新一轮生成：解除停止冻结
						abortingRef.current = false;
						setBusy(true);
						streamModeRef.current = modeRef.current;
						setStreamMode(streamModeRef.current);
						resetActs();
						resetSegs();
					} else {
						// 服务端 abort 会立刻广播 end，但 provider 流可能仍在吐 delta。
						// 若用户已按停止：保持 abortingRef，继续丢弃迟到 delta，直到下一次 start。
						const wasAborting = abortingRef.current;
						if (!wasAborting) abortingRef.current = false;
						setBusy(false);
						setThinkingLive(false);
						setToolNote(null);
						// 本轮 agent 可能写了技能/知识库/世界书等资产：通知 watchAgent 面板重拉
						// 并清 GET 缓存——服务端的写客户端看不见（invalidateAfterWrite 只认前端自己发的写），
						// 不清则「打开面板吃缓存」会让 agent 刚改的东西在 TTL 内不露面。
						// ⚠ 但只清**本轮真正调过的写工具**碰过的前缀，别整表清：日常一拍只记账（世界状态/名录
						// 走 WS 帧直推前端，不经 GET 缓存），无关的 preset(119KB)/card 缓存不该跟着作废——
						// 那正是 VPS 慢链路上「每次开面板都重新加载」的来源（8/29）。本轮没写工具就一格都不清。
						apiGetCacheClearForToolNames(
							turnActsRef.current.flatMap((a) => (a.kind === "tool_start" ? [a.name] : [])),
						);
						setAgentTick((t) => t + 1);
						// 中断/异常遗留的半截正文/思维链：并入本轮同一角色泡（不新开泡）
						const text = streamRef.current;
						const thinking = streamThinkingRef.current.trim();
						const acts = turnActsRef.current;
						const segs = turnSegsRef.current;
						if (text.trim() || thinking || wasAborting) {
							resetActs();
							resetSegs();
							clearStream();
							if (text.trim() || thinking) {
								const leftover: ChatMsg = {
									channel: streamModeRef.current !== "roleplay" ? "authoring" : "narrative",
									...(streamModeRef.current !== "roleplay" ? { mode: streamModeRef.current } : {}),
									// 仅有思维链时也留痕；unfinished 与 resync 的 aborted 稿对齐
									text: text.trim() ? text : "（正文未流出，见思维链）",
									...(thinking ? { thinking } : {}),
									...(acts.length ? { activities: acts } : {}),
									...(segs.length ? { segments: segs } : {}),
									...(wasAborting ? { unfinished: true } : {}),
								};
								setMessages((ms) => upsertTurnReply(ms, leftover));
							} else if (wasAborting) {
								setLiveActs([]);
							}
						} else {
							clearStream();
							resetSegs();
							setLiveActs([]);
						}
					}
					break;
				case "activity":
					// 工具开始时把已流出的计划旁白留档，再清流式；步骤实时追加进清单
					if (frame.activity.kind === "tool_start" && (streamRef.current || streamThinkingRef.current)) {
						captureStreamNote();
						clearStream();
					}
					pushAct(frame.activity);
					setToolNote(
						frame.activity.kind === "tool_start"
							? frame.activity.detail?.trim()
								? frame.activity.detail.trim().length > 80
									? `${frame.activity.detail.trim().slice(0, 80)}…`
									: frame.activity.detail.trim()
								: `${toolLabel(frame.activity.name)}…`
							: null,
					);
					break;
				case "state":
					setWorldState(frame.state);
					break;
				case "panels": {
					// agent 自建面板（柱 2）：新面板自动展开到左栏（agent 持有前端，建了就给用户看）；
					// 已开面板的更新自然重渲染；未开面板的更新只提示；被收起的面板若正开着则回落。
					const prev = agentPanelsRef.current;
					const next = frame.panels;
					agentPanelsRef.current = next;
					setAgentPanels(next);
					const sel = leftPanelRef.current;
					const fresh = next.find((p) => !prev.some((q) => q.name === p.name));
					if (fresh) {
						openRight(agentId(fresh.name));
					} else {
						const updated = next.find((p) => {
							const q = prev.find((x) => x.name === p.name);
							return q && q.updatedAt !== p.updatedAt;
						});
						if (updated && sel !== agentId(updated.name)) pushToast("info", `面板「${updated.name}」已更新`);
					}
					if (sel?.startsWith("agent:") && !next.some((p) => agentId(p.name) === sel)) {
						setLeftPanel(null);
					}
					break;
				}
				case "stats":
					setStats(frame.stats);
					break;
				case "compaction":
					setToolNote(frame.state === "start" ? "压缩上下文…" : null);
					if (frame.state === "end") pushToast(frame.ok === false ? "warning" : "info", frame.ok === false ? "压缩失败" : "上下文已压缩");
					break;
				case "sessions":
					setSessions(frame.list);
					setChats(frame.chats ?? null);
					break;
				case "choice":
					// 新的决策询问：弹出 live 选择卡（会话被切换时由 hello 分支清空）
					setActiveChoice({ id: frame.id, question: frame.question, options: frame.options, placeholder: frame.placeholder });
					break;
				case "choice_resolved":
					// 该询问已决（本端/他端应答或超时）：收起 live 卡；留痕由工具结果重放消息承载
					setActiveChoice((c) => (c && c.id === frame.id ? null : c));
					break;
				case "card_preview":
					setPreviewRequest({ id: frame.id, data: frame.data, message: frame.message, variables: frame.variables, wait: frame.wait });
					break;
				case "update": {
					const prevErr = updateErrRef.current;
					updateErrRef.current = frame.update.error ?? null;
					setUpdateInfo(frame.update);
					if (frame.update.phase === "downloading" || frame.update.phase === "ready") setUpdateToastDismissed(false);
					// 下载失败（downloading→available+error）：临时气泡提示，否则用户不重开弹窗看不到原因
					if (frame.update.error && frame.update.error !== prevErr) {
						pushToast("error", `更新失败：${frame.update.error}（点主页提示可重试/设镜像）`);
					}
					break;
				}
				case "notify":
					pushToast(frame.level, frame.text);
					if (frame.level !== "info") {
						setWarnings((ws) => [{ ts: Date.now(), level: frame.level as "warning" | "error", text: frame.text }, ...ws].slice(0, 30));
					}
					// 新建/切换后服务端会 notify；若会话面板开着，确保列表与 current 标记更新
					if (
						(frame.text.includes("新建会话") || frame.text.includes("切换会话")) &&
						(welcomeRef.current || leftPanelRef.current === "sessions")
					) {
						// 同上：不清空，就地替换（清空 = 面板空白一下）
						sendRef.current({ type: "sessions" });
						window.setTimeout(() => sendRef.current({ type: "sessions" }), 350);
					}
					break;
				case "error":
					pushToast("error", frame.text);
					setWarnings((ws) => [{ ts: Date.now(), level: "error" as const, text: frame.text }, ...ws].slice(0, 30));
					break;
			}
		},
		[pushToast, refreshAvatars, refreshCardFront],
	);

	const ws = useWire(onFrame, setConn);

	// WS 连通后：1) 预热 GET 缓存 2) 后台预挂载左右栏面板（ST 式常驻，再点顶栏不冷启动）
	useEffect(() => {
		if (conn !== "open") return;
		prefetchPanelApis();
		const t = window.setTimeout(() => {
			// 预挂载常用面板进 keep（collapsed 侧栏仍保留 DOM）
			setRightKeep((prev) => {
				const next: PanelId[] = ["sessions"];
				for (const p of prev) if (!next.includes(p as PanelId)) next.push(p as PanelId);
				return next.slice(0, 8) as PanelId[];
			});
			setLeftKeep((prev) => {
				// 角色最贵（封面）也最常开，首位预挂；其余轨位随用随挂
				const base: Array<PanelId | AgentPanelId> = ["roles"];
				for (const p of prev) if (!base.includes(p)) base.push(p);
				return base.slice(0, 8);
			});
		}, 350);
		return () => clearTimeout(t);
	}, [conn]);
	sendRef.current = ws.send;

	// 楼层号：只数进入叙事流的消息（user/narrative/greeting；场外问答不占楼层）
	const numbered = useMemo(() => {
		let floor = 0;
		return messages.map((msg) => {
			const counts =
				msg.mode === undefined && !msg.backstage && (msg.channel === "user" || msg.channel === "narrative" || msg.channel === "greeting");
			return { msg, floor: counts ? ++floor : undefined };
		});
	}, [messages]);

	// 戏外轮分组（codex 式）：连续 backstage 消息合成一组，中间步骤折进过程、只露最终报告
	type RenderBlock =
		| { kind: "one"; msg: ChatMsg; floor?: number; idx: number }
		| { kind: "backstage"; msgs: ChatMsg[]; idx: number };
	const blocks = useMemo(() => {
		const out: RenderBlock[] = [];
		numbered.forEach(({ msg, floor }, idx) => {
			if (msg.channel === "backstage") {
				const last = out[out.length - 1];
				if (last && last.kind === "backstage") {
					last.msgs.push(msg);
					last.idx = idx;
				} else {
					out.push({ kind: "backstage", msgs: [msg], idx });
				}
			} else {
				out.push({ kind: "one", msg, floor, idx });
			}
		});
		return out;
	}, [numbered]);

	const lastNarrativeIdx = useMemo(() => {
		for (let i = messages.length - 1; i >= 0; i--) if (messages[i].channel === "narrative") return i;
		return -1;
	}, [messages]);
	const lastUserIdx = useMemo(() => {
		for (let i = messages.length - 1; i >= 0; i--) if (messages[i].channel === "user" && messages[i].mode === undefined && !messages[i].backstage) return i;
		return -1;
	}, [messages]);
	/** 本轮用户输入之后是否已有定稿角色回复（有则隐藏空的「生成中」壳，避免双泡） */
	const turnHasCommittedReply = useMemo(() => {
		let lastStoryUser = -1;
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].channel === "user" && messages[i].mode === undefined && !messages[i].backstage) {
				lastStoryUser = i;
				break;
			}
		}
		for (let i = lastStoryUser + 1; i < messages.length; i++) {
			if (messages[i].channel === "narrative" || messages[i].channel === "backstage") return true;
		}
		return false;
	}, [messages]);
	/** 剧情用户轮（不含戏外），用于回退 N 计算 */
	const storyUserIdxs = useMemo(
		() => messages.map((m, i) => (m.channel === "user" && m.mode === undefined && !m.backstage ? i : -1)).filter((i) => i >= 0),
		[messages],
	);
	/** 仅有开场白、尚未开聊 → 可切换备选开场 */
	const greetingOnly = useMemo(() => {
		const hasGreet = messages.some((m) => m.channel === "greeting");
		const hasUser = messages.some((m) => m.channel === "user" && m.mode === undefined && !m.backstage);
		return hasGreet && !hasUser;
	}, [messages]);
	const [greetingMeta, setGreetingMeta] = useState<{ index: number; total: number } | null>(null);
	const refreshGreetingMeta = useCallback(async () => {
		try {
			const r = await apiGet<CardResponse>("/api/card");
			const list = Array.isArray(r.greetings) ? r.greetings : [];
			// 跳过空开场白：角标与宿主 hostSwitchGreeting 的 non-empty 序位一致
			const nonempty = list.filter((g) => (g.text ?? "").trim());
			const fullIdx = r.greetingIndex ?? 0;
			let pos = nonempty.findIndex((g) => g.index === fullIdx);
			if (pos < 0) pos = Math.max(0, Math.min(nonempty.length - 1, fullIdx));
			setGreetingMeta({
				index: nonempty.length ? pos : 0,
				total: nonempty.length || list.length,
			});
		} catch {
			setGreetingMeta(null);
		}
	}, []);
	useEffect(() => {
		// 消息自带 greetingPick 时以其为准（与正文同源）；否则再拉 /api/card
		const fromMsg = [...messages].reverse().find((m) => m.channel === "greeting" && m.greetingPick);
		if (fromMsg?.greetingPick && fromMsg.greetingPick.total > 0) {
			setGreetingMeta({
				index: fromMsg.greetingPick.index,
				total: fromMsg.greetingPick.total,
			});
			return;
		}
		if (greetingOnly || messages.some((m) => m.channel === "greeting")) void refreshGreetingMeta();
	}, [greetingOnly, messages, refreshGreetingMeta]);

	// 跟随滚动：仅当用户本就在底部
	useEffect(() => {
		const el = listRef.current;
		if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
	}, [messages, streamText, streamThinking, thinkingLive, toolNote, liveActs, liveSegs, activeChoice]);

	const onScroll = () => {
		const el = listRef.current;
		if (!el) return;
		const near = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
		atBottomRef.current = near;
		setAtBottom(near);
	};

	const jumpToBottom = () => {
		const el = listRef.current;
		if (!el) return;
		atBottomRef.current = true;
		setAtBottom(true);
		el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
	};

	const send = useCallback(() => {
		const typed = input.trim();
		// 附件随消息：路径清单作为尾行附在正文后（这一行即持久记录，重放同路径解析）
		const attachLine = pending.length > 0 ? buildAttachmentLine(pending.map((p) => p.file)) : "";
		const text = attachLine ? (typed ? `${typed}\n${attachLine}` : attachLine) : typed;
		if (!text) return;
		if (/^\/store\s*$/i.test(typed) && pending.length === 0) {
			setWelcome(false);
			setAtHome(false);
			touchVisit();
			openStoreModal();
			setInput("");
			setPending([]);
			return;
		}
		if (/^\/line\s*$/i.test(typed) && pending.length === 0) {
			setWelcome(false);
			setAtHome(false);
			touchVisit();
			toggleRight("worldline");
			setInput("");
			setPending([]);
			return;
		}
		let sent: boolean;
		if (/^\/compact(?:\s|$)/i.test(typed) && pending.length === 0) {
			sent = typed === "/compact" || /^\/compact\s*$/i.test(typed)
				? ws.send({ type: "compact" })
				: ws.send({ type: "prompt", text: typed });
		} else {
			sent = ws.send({ type: "prompt", text });
		}
		if (!sent) {
			pushToast("warning", "连接还没好，内容还在输入框里");
			return;
		}
		setWelcome(false);
		setAtHome(false);
		touchVisit();
		setInput("");
		setPending([]);
		atBottomRef.current = true;
		setAtBottom(true);
		if (inputRef.current) inputRef.current.style.height = "auto";
	}, [input, pending, ws, openStoreModal, pushToast, toggleRight]);


	// 卡 HTML（如 某卡 开场表单）调用 triggerSlash(`/send …|/trigger`)
	// 须接到输入框 / WS，否则界面显示「档案已发送」但聊天栏空白
	const inputRefForBridge = useRef(input);
	inputRefForBridge.current = input;
	const connRef = useRef(conn);
	connRef.current = conn;
	useEffect(() => {
		registerTavernChatBridge({
			setInput: (text) => {
				setWelcome(false);
				setAtHome(false);
				setInput(text);
				// 焦点到输入框，便于用户确认
				requestAnimationFrame(() => {
					const el = inputRef.current;
					if (el) {
						el.focus();
						el.style.height = "auto";
						el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
					}
				});
			},
			sendPrompt: (text) => {
				if (connRef.current !== "open") {
					pushToast("warning", "连接未就绪，无法从界面发送");
					return;
				}
				const body = (text || inputRefForBridge.current || "").trim();
				if (!body) {
					pushToast("warning", "没有可发送的内容");
					return;
				}
				setWelcome(false);
				setAtHome(false);
				touchVisit();
				ws.send({ type: "prompt", text: body });
				setInput("");
				setPending([]);
				atBottomRef.current = true;
				setAtBottom(true);
				if (inputRef.current) inputRef.current.style.height = "auto";
				pushToast("info", "已从界面注入并发送");
			},
			runCommand: (cmd) => {
				if (connRef.current !== "open") return;
				ws.send({ type: "prompt", text: cmd });
			},
		});
		return () => registerTavernChatBridge(null);
	}, [ws, pushToast]);

	// 作者脚本的 toastr → 梨园通知条（子帧经 parent.__liyuanToast 调；缺它就只落 console）
	useEffect(() => {
		registerLiyuanToast((level, text) => pushToast(level, text));
		return () => registerLiyuanToast(null);
	}, [pushToast]);

	// 上传：即时落服务端 .liyuan-uploads/，成功后进 pending（chip 显示，发送时随消息）
	const doUpload = useCallback(
		async (files: FileList | File[]) => {
			const list = Array.from(files);
			if (list.length === 0) return;
			setUploading(true);
			try {
				for (const f of list) {
					try {
						const r = await uploadFile(f);
						setPending((prev) => [...prev, { ...toAttachmentView(r.file), size: r.size }]);
					} catch (err) {
						pushToast("error", `「${f.name}」上传失败：${err instanceof Error ? err.message : String(err)}`);
					}
				}
			} finally {
				setUploading(false);
			}
		},
		[pushToast],
	);

	const startMsgEdit = useCallback(
		(idx: number, kind: "user" | "narrative" | "greeting") => {
			const m = messages[idx];
			if (!m || busy) return;
			// 用户消息：编辑可见正文（去掉附件尾行，提交时若原有附件再拼回）
			let draft = m.text;
			if (kind === "user") {
				const { body } = splitAttachments(m.text);
				draft = body;
			}
			setMsgEdit({ idx, kind, draft });
		},
		[messages, busy],
	);

	const cancelMsgEdit = useCallback(() => setMsgEdit(null), []);

	const submitMsgEdit = useCallback(() => {
		if (!msgEdit || busy) return;
		const text = msgEdit.draft.trim();
		if (!text) return;
		let sent: boolean;
		if (msgEdit.kind === "user") {
			const orig = messages[msgEdit.idx]?.text ?? "";
			const { attachments } = splitAttachments(orig);
			const attachLine =
				attachments.length > 0 ? buildAttachmentLine(attachments.map((a) => a.file)) : "";
			const full = attachLine ? `${text}\n${attachLine}` : text;
			sent = ws.send({ type: "reroll", text: full });
		} else {
			const orig = (messages[msgEdit.idx]?.text ?? "").trim();
			if (text === orig && msgEdit.kind === "narrative") {
				sent = ws.send({ type: "reroll" });
			} else {
				sent = ws.send({ type: "prompt", text: `/editreply ${text}` });
			}
		}
		if (!sent) {
			pushToast("warning", "连接还没好，改写还在编辑框里");
			return;
		}
		setMsgEdit(null);
	}, [msgEdit, busy, messages, ws, pushToast]);

	/** 回退到某条用户消息之前（含该条）：N = 从该条到末尾的剧情用户轮数 */
	const rewindToUser = useCallback(
		(msgIdx: number) => {
			const pos = storyUserIdxs.indexOf(msgIdx);
			if (pos < 0 || busy) return;
			const n = storyUserIdxs.length - pos;
			if (n < 1) return;
			ws.send({ type: "prompt", text: `/rewind ${n}` });
		},
		[storyUserIdxs, busy, ws],
	);

	const deleteLastUserTurn = useCallback(() => {
		if (busy || lastUserIdx < 0) return;
		if (!window.confirm("删除本轮对话（你的输入 + 角色回复）？内容会留在会话树旁支，可从世界线找回。")) return;
		ws.send({ type: "prompt", text: "/rewind 1" });
	}, [busy, lastUserIdx, ws]);

	const dropLastReply = useCallback(() => {
		if (busy || lastNarrativeIdx < 0) return;
		if (!window.confirm("删除最后一条角色回复？你的输入会保留，可编辑后再发。")) return;
		ws.send({ type: "prompt", text: "/drop" });
	}, [busy, lastNarrativeIdx, ws]);

	const switchGreeting = useCallback(
		(dir: "prev" | "next") => {
			if (busy || !greetingOnly) return;
			// 乐观更新角标（最终以 hello/message 上的 greetingPick 为准）
			setGreetingMeta((m) => {
				if (!m || m.total < 1) return m;
				const next =
					dir === "next" ? (m.index + 1) % m.total : (m.index - 1 + m.total) % m.total;
				return { ...m, index: next };
			});
			ws.send({ type: "prompt", text: `/greeting ${dir}` });
		},
		[busy, greetingOnly, ws],
	);

	// ---- `/` 命令补全（清单来自 GET /api/commands，单一来源 src/commands.ts） ----
	const [commands, setCommands] = useState<CommandMeta[] | null>(null);
	const [cmdIndex, setCmdIndex] = useState(0);
	const [cmdDismissed, setCmdDismissed] = useState(false);

	useEffect(() => {
		if (input.startsWith("/") && commands === null) {
			apiGet<{ commands: CommandMeta[] }>("/api/commands")
				.then((r) => setCommands(r.commands))
				.catch(() => setCommands([]));
		}
	}, [input, commands]);

	const suggestions = useMemo(() => {
		const m = /^\/(\w*)$/.exec(input);
		if (!m || cmdDismissed || !commands) return [];
		return commands.filter((c) => c.name.startsWith(m[1]));
	}, [input, commands, cmdDismissed]);

	const argHint = useMemo(() => {
		const m = /^\/(\w+)\s/.exec(input);
		if (!m || !commands) return null;
		return commands.find((c) => c.name === m[1]) ?? null;
	}, [input, commands]);

	const completeCmd = (c: CommandMeta) => {
		setInput(c.takesArgs ? `/${c.name} ` : `/${c.name}`);
		setCmdIndex(0);
		inputRef.current?.focus();
	};

	const doCopy = (text: string) => {
		pushToast("info", copyText(text) ? "已复制正文" : "复制失败（浏览器限制）");
	};

	// 面板开合：点同侧同钮=收起；桌面端右侧面板统一走平立分栏（会话左移）
	const togglePanel = (id: PanelId | AgentPanelId) => {
		if (DRAWER_PANELS.includes(id as PanelId)) {
			openLeft(leftPanel === id ? null : id);
			return;
		}
		toggleRight(id);
		if (id === "sessions" && rightPanel !== "sessions") {
			// 不清空：保留上次列表当场显示，后台静默重拉（回来替换）。
			ws.send({ type: "sessions" });
		}
	};

	/**
	 * 顶栏左键：开合抽屉。开的时候回到上次那一格（`leftKeep[0]`），首开落「角色」——
	 * 用户点名的第一块，也是唯一带封面的一块，开箱即好看。
	 */
	const toggleDrawer = () => {
		if (leftPanel) {
			openLeft(null);
			return;
		}
		const last =
			lastSectionRef.current ?? (leftKeep.find((x) => DRAWER_PANELS.includes(x as PanelId)) as PanelId | undefined);
		openLeft(last ?? "roles");
	};

	// 欢迎区 / 会话面板：列表为空时补拉（含新建会话后 hello 清空）
	useEffect(() => {
		if (conn !== "open") return;
		if (welcome || (rightPanel === "sessions" && sessions === null)) {
			ws.send({ type: "sessions" });
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- ws.send 稳定；sessions 变 null 时要重拉
	}, [conn, welcome, rightPanel, sessions]);

	// 访问时间：未在欢迎态时心跳 + 离开页写入（久未访问 → 下次欢迎）
	useEffect(() => {
		if (welcome) return;
		touchVisit();
		const onLeave = () => touchVisit();
		const onVis = () => {
			if (document.visibilityState === "hidden") onLeave();
		};
		const heartbeat = setInterval(() => touchVisit(), 60_000);
		window.addEventListener("pagehide", onLeave);
		document.addEventListener("visibilitychange", onVis);
		return () => {
			clearInterval(heartbeat);
			window.removeEventListener("pagehide", onLeave);
			document.removeEventListener("visibilitychange", onVis);
			touchVisit();
		};
	}, [welcome]);

	const renderPanel = (id: PanelId) => {
		switch (id) {
			case "sessions":
				return (
					<SessionsPanel
						sessions={sessions}
						chats={chats}
						stats={stats}
						atHome={welcome}
						onOpen={(path) => {
							// 橙标当前会话：主页→进对话；对话中再点→回主页
							const isCur = sessions?.some((s) => s.current && s.path === path);
							if (isCur) {
								if (welcome) dismissWelcome();
								else showWelcome();
								return;
							}
							ws.send({ type: "open", path });
							dismissWelcome();
						}}
						onNew={(name, mode) => {
							ws.send({ type: "new", ...(name ? { name } : {}), ...(mode ? { mode } : {}) });
							dismissWelcome();
						}}
						onNewInChat={(chatId) => {
							ws.send({ type: "chat_new_session", chatId });
							dismissWelcome();
						}}
						onCompact={() => ws.send({ type: "compact" })}
						onWorldline={() => {
							toggleRight("worldline");
						}}
						onStore={openStoreModal}
						onRefresh={() => {
							// 不 set null：避免整列表「读取中」闪一下（ST 式原地刷新）
							ws.send({ type: "sessions" });
						}}
						toast={pushToast}
					/>
				);
			case "worldline":
				return (
					<WorldlinePanel
						toast={pushToast}
						runCommand={(text) => ws.send({ type: "prompt", text })}
						onStore={openStoreModal}
					/>
				);
			case "connect":
				return <ConnectPanel toast={pushToast} />;
			case "preset":
				return <PresetPanel toast={pushToast} />;
			case "powers":
				return (
					<>
						<PowersPanel toast={pushToast} />
						{/* agent 自建面板的清单与导入导出：原顶栏「面板坞」下拉退场后落这里
						    （它们是扩展能力跑出来的产物）。开合仍走悬浮球那套。 */}
						<PanelDock
							variant="dropdown"
							panels={agentPanels}
							charName={charName}
							activeAgent={activeAgentName}
							rosterActive={rightPanel === "roster"}
							onOpenRoster={() => toggleRight("roster")}
							onOpen={(name) => toggleRight(agentId(name))}
							toast={pushToast}
						/>
					</>
				);
			case "settings":
				return (
					<SettingsPanel
						toast={pushToast}
						onOpenAbout={() => openLeft("about")}
						currentVersion={updateInfo?.currentVersion}
					/>
				);
			case "about":
				return (
					<AboutPanel
						update={updateInfo}
						onOpenUpdate={() => setUpdateModalOpen(true)}
						toast={pushToast}
					/>
				);
			case "roles":
				return (
					<RolesPanel
						tab={rolesTab}
						onTab={setRolesTab}
						toast={pushToast}
						onOpenStudio={openStudio}
						active={leftPanel === "roles"}
						onEnterChat={dismissWelcome}
						onGoHome={showWelcome}
						onFrontChange={() => void refreshCardFront()}
						headerTabs={true}
					/>
				);
			case "lorebook":
				return <LorebookPanel toast={pushToast} />;
			case "roster":
				return <RosterPanel state={worldState} toast={pushToast} />;
			case "status":
				return <StatusPanel state={worldState} toast={pushToast} />;
			case "uploads":
				return (
					<UploadsPanel
						toast={pushToast}
						onAttach={(u) => {
							setPending((prev) =>
								prev.some((x) => x.file === u.file) ? prev : [...prev, { ...toAttachmentView(u.file), size: u.size }],
							);
							pushToast("info", `已附到待发送：${u.name}`);
						}}
					/>
				);
		}
	};

	const sidePanel = (id: PanelId | AgentPanelId | null, side: "left" | "right") => {
		/**
		 * 关键：以前 `if (!id) return null` 会在收起时卸载整侧 → 再点顶栏整面板冷启动 +「读取中」。
		 * 现在：打开过的面板始终挂在 keep 里，收起只加 side-collapsed（不占布局、不卸 DOM）。
		 */
		const keep = side === "left" ? leftKeep : rightKeep;
		const ids: Array<PanelId | AgentPanelId> = id
			? keep.includes(id)
				? keep
				: [id, ...keep.filter((x) => x !== id)].slice(0, 5)
			: keep;
		if (ids.length === 0) return null;

		const open = id != null;
		const headId = id ?? ids[0];
		const agent = headId.startsWith("agent:") ? agentPanels.find((p) => agentId(p.name) === headId) : undefined;
		if (headId.startsWith("agent:") && !agent && open) return null;
		const HeadIcon = agent ? IconDock : PANEL_ICON[headId as PanelId];
		const refreshable = !agent;
		const doRefresh = () => {
			if (id === "sessions") {
				ws.send({ type: "sessions" });
				return;
			}
			// 先清该面板 GET 缓存，再 remount：否则 peek / 旧缓存会让「刷新」假成功
			if (id && !id.startsWith("agent:")) apiGetCacheClearForPanel(id);
			// 仅强制重挂载当前可见面板（表单草稿也会重置）；其它 keep 不动
			setManualTick((t) => ({ ...t, [side]: t[side] + 1 }));
		};
		return (
			<aside
				className={`side side-${side} ${open ? "" : "side-collapsed"}`}
				aria-hidden={!open}
			>
				{/* 左抽屉的轨：品牌在顶、板块在中、设置在底（PLAN-FRONTEND-V2 §三） */}
				{side === "left" && (
					<nav className="drawer-rail" aria-label="板块">
						<button
							type="button"
							className="drawer-rail-brand"
							title="欢迎页"
							aria-label="打开欢迎页"
							onClick={() => {
								if (welcome) listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
								else showWelcome();
							}}
						>
							<BrandLogo className="brand-logo" size={26} />
						</button>
						<div className="drawer-rail-list">
							{DRAWER_SECTIONS.map((sid) => {
								const Ic = PANEL_ICON[sid];
								return (
									<button
										key={sid}
										type="button"
										className={`drawer-rail-btn ${leftPanel === sid ? "active" : ""}`}
										onClick={() => openLeft(sid)}
										aria-label={PANEL_LABEL[sid]}
										aria-current={leftPanel === sid}
										data-tip={PANEL_LABEL[sid]}
									>
										<Ic size={19} />
									</button>
								);
							})}
						</div>
						<button
							type="button"
							className="drawer-rail-btn drawer-rail-foot"
							onClick={() => {
								const next = dark ? "light" : "dark";
								setTheme(next);
								setDark(next === "dark");
								pushToast("info", next === "dark" ? "已切换到黑夜模式" : "已切换到白昼模式");
							}}
							aria-label={dark ? "切换到白天" : "切换到黑夜"}
							aria-pressed={dark}
							data-tip={dark ? "白天" : "黑夜"}
							title={dark ? "白天" : "黑夜"}
						>
							{dark ? <IconSun size={19} /> : <IconMoon size={19} />}
						</button>
						<button
							type="button"
							className={`drawer-rail-btn drawer-rail-foot ${leftPanel === "settings" ? "active" : ""}`}
							onClick={() => openLeft("settings")}
							aria-label="设置"
							aria-current={leftPanel === "settings"}
							data-tip="设置"
						>
							<IconSettings size={19} />
						</button>
						<button
							type="button"
							className={`drawer-rail-btn drawer-rail-foot ${leftPanel === "about" ? "active" : ""}`}
							onClick={() => openLeft("about")}
							aria-label="关于"
							aria-current={leftPanel === "about"}
							data-tip="关于"
						>
							<IconInfo size={19} />
						</button>
					</nav>
				)}
								<div className="side-main">
				{open && (
					<div className="panel-head">
						{headId === "roles" ? (
							<div className="panel-head-tabs" role="group" aria-label="角色视图">
								<button
									type="button"
									className={`panel-head-tab ${rolesTab === "card" ? "active" : ""}`}
									onClick={() => setRolesTab("card")}
								>
									角色卡库
								</button>
								<button
									type="button"
									className={`panel-head-tab ${rolesTab === "persona" ? "active" : ""}`}
									onClick={() => setRolesTab("persona")}
								>
									用户角色
								</button>
							</div>
						) : (
							<span className="panel-head-title">
								<HeadIcon size={15} />
								{agent ? agent.name : PANEL_LABEL[headId as PanelId]}
							</span>
						)}
						<span className="panel-head-actions">
							{headId === "roles" && rolesTab === "card" && (
								<button
									className="icon-btn"
									onClick={() => setStudioOpen(true)}
									title="角色卡工坊"
									aria-label="打开角色卡工坊"
								>
									<IconEdit size={15} />
								</button>
							)}
							{refreshable && (
								<button className="icon-btn" onClick={doRefresh} title="刷新" aria-label="刷新面板">
									<IconRefresh size={15} />
								</button>
							)}
							<button
								className="icon-btn"
								onClick={() => (side === "left" ? setLeftPanel(null) : setRightPanel(null))}
								title="收起"
								aria-label="收起面板"
							>
								<IconClose size={16} />
							</button>
						</span>
					</div>
				)}
{ids.map((pid) => {
					const isAgent = pid.startsWith("agent:");
					const ag = isAgent ? agentPanels.find((p) => agentId(p.name) === pid) : undefined;
					if (isAgent && !ag) return null;
					const visible = open && pid === id;
					const bodyKey =
						visible && id
							? `${pid}-${manualTick[side]}`
							: pid; /* 非可见不要用 tick，避免刷新可见面板时误卸其它保活 */
					return (
						<div
							key={pid}
							className="side-panel-keep"
							hidden={!visible}
							aria-hidden={!visible}
							/* 可见时参与 flex 占满高度（才能滚）；隐藏时 display:none 卸出布局 */
							style={visible ? { flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" } : { display: "none" }}
						>
							{ag ? (
								<ArtifactPanel
									panel={ag}
									data={worldState?.panelData?.[ag.name]}
									onSaved={(p) => {
										// 乐观更新；随后 WS panels 帧会再对齐
										setAgentPanels((list) =>
											list.map((x) =>
												x.name === p.name
													? { ...x, kind: p.kind as typeof x.kind, content: p.content, updatedAt: p.updatedAt }
													: x,
											),
										);
									}}
								/>
							) : (
								<Fragment key={bodyKey}>{renderPanel(pid as PanelId)}</Fragment>
							)}
						</div>
					);
				})}
				</div>
			</aside>
		);
	};

	const coarse = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

	const activeAgentName = floatPanel?.startsWith("agent:") ? floatPanel.slice("agent:".length) : null;

	const openSessionFromWelcome = (path: string) => {
		// 主页点当前会话 = 展开进对话；点其它 = 切换后进入
		const isCur = sessions?.some((s) => s.current && s.path === path);
		if (!isCur) ws.send({ type: "open", path });
		dismissWelcome();
	};

	const newSessionFromWelcome = () => {
		ws.send({ type: "new" });
		dismissWelcome();
	};

	const openPanelFromWelcome = (
		id: "connect" | "card" | "powers" | "sessions" | "lorebook" | "preset" | "persona",
	) => {
		// 不关欢迎区：面板与欢迎同屏
		if (id === "sessions") {
			openRight("sessions");
			// 见 togglePanel：保留旧列表、后台重拉，避免「读取中…」闪一下
			ws.send({ type: "sessions" });
			return;
		}
		if (id === "card" || id === "persona") {
			setRolesTab(id);
			openLeft("roles");
			return;
		}
		openLeft(id);
	};

	/** 顶栏主标题：当前会话与卡名 */
	const currentSession = sessions?.find((s) => s.current);
	const homeHasHistory = sessions !== null && sessions.some((s) => s.preview);
	/** agent 子项目的分栏：主页与写卡平台打开时让位（写卡平台占同一块中间区域） */
	const agentSplit = conversationMode === "agent" && !welcome && !studioOpen;

	return (
		<PanelRefreshContext.Provider value={agentTick}>
		<div className="app">
			{/*
			  * 页面级作者脚本宿主：卡/预设声明的悬浮球等常驻 UI 在此起跑，产物挂到父页 body。
			  * 帧自身零尺寸不可见，放在这里只为跟着 App 的生命周期走（换卡即换帧、卸载即收 DOM）。
			  */}
			<ScriptHost scripts={authorScripts} />

			<div className="toasts">
				<UpdateToast
					update={updateInfo}
					dismissed={updateToastDismissed}
					onDismiss={() => setUpdateToastDismissed(true)}
					onToast={pushToast}
				/>
				{toasts.map((t) => (
					<div key={t.id} className={`toast toast-${t.level}`} onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>
						{t.text}
					</div>
				))}
			</div>

			{updateModalOpen && updateInfo && (updateInfo.phase === "available" || updateInfo.phase === "downloading") && (
				<UpdateModal update={updateInfo} onClose={() => setUpdateModalOpen(false)} onToast={pushToast} />
			)}

			{/* 顶栏「新建项目」起名弹窗（与左栏同一条 onNew 通道） */}
			{namingProject && chats && (
				<NewProjectBox
					initial={nextProjectName(chats)}
					busy={busy}
					onDone={(name, mode) => {
						setNamingProject(false);
						if (name) {
							ws.send({ type: "new", name, ...(mode ? { mode } : {}) });
							dismissWelcome();
						}
					}}
				/>
			)}

			{/* 左侧栏：在桌面为平级满高分栏（与主工作区同图层分立）；移动端为浮层抽屉 */}
			{sidePanel(leftPanel, "left")}

			<div className="workspace">
				<header className="topbar">
				{/* 左一键：开合左抽屉（PLAN-FRONTEND-V2 §四） */}
				<div className="tb-side tb-side-left">
						<button
							type="button"
							className={`tb-btn ${leftPanel ? "active" : ""}`}
							onClick={toggleDrawer}
							aria-label="板块"
							aria-expanded={!!leftPanel}
							data-tip="板块"
							title="板块"
						>
							<IconPanelLeft size={18} />
						</button>
						{chats ? (
							<div className="tb-new-wrap">
								<button
									type="button"
									className={`tb-btn ${newMenuOpen ? "active" : ""}`}
									onClick={() => setNewMenuOpen((v) => !v)}
									disabled={conn !== "open"}
									aria-label="新建"
									aria-expanded={newMenuOpen}
									data-tip="新建"
									title="新建项目 / 新建对话"
								>
									<IconNewChat size={18} />
								</button>
								{newMenuOpen && (
									<>
										<div className="tb-new-backdrop" onClick={() => setNewMenuOpen(false)} />
										<div className="tb-new-menu" role="menu">
											<button
												type="button"
												role="menuitem"
												className="tb-new-item"
												onClick={() => {
													setNewMenuOpen(false);
													setNamingProject(true);
												}}
											>
												新建项目
												<span className="tb-new-item-sub">新的一层，起名后建</span>
											</button>
											<button
												type="button"
												role="menuitem"
												className="tb-new-item"
												onClick={() => {
													setNewMenuOpen(false);
													// 当前项目里再开一个＝chat_new_session（项目行「＋」同通道）；
													// 裸 new 在两层布局下是新建项目，别用。
													const currentChatId = sessions?.find((s) => s.current)?.chatId;
													if (currentChatId) ws.send({ type: "chat_new_session", chatId: currentChatId });
													else ws.send({ type: "new" });
													dismissWelcome();
												}}
											>
												新建对话
												<span className="tb-new-item-sub">在当前项目里再开一个</span>
											</button>
										</div>
									</>
								)}
							</div>
						) : (
							<button
								type="button"
								className="tb-btn"
								onClick={() => {
									ws.send({ type: "new" });
									dismissWelcome();
								}}
								disabled={conn !== "open"}
								aria-label="新建对话"
								data-tip="新建"
								title="新建对话"
							>
								<IconNewChat size={18} />
							</button>
						)}
					</div>
				{/*
				  * 中：会话名 + 一行状态。卡名（原右 gutter）、扮演/工作（原输入框上方那条）、
				  * 忙闲与连接态（原右 gutter）三样合并到这里，右 gutter 整个退场。
				  */}
				<div className="tb-title">
					<span className="tb-title-main" title={currentSession?.name ? `${charName || "新对话"} · ${currentSession.name}` : (charName || "新对话")}>
						{charName || "新对话"}
					</span>
					<span className="tb-title-sub">
						{conversationMode === "agent" ? (
							<button type="button" className="tb-sub-mode tb-sub-mode-agent" title="agent 模式：正文是稿子里的章，这里的对话是讨论；手机上点它看稿子" onClick={() => setStoryTab("story")}>
								agent<span className="tb-sub-mode-agent-story">· 稿子{storyOutline?.length ? ` ${storyOutline.length} 章` : ""}</span>
							</button>
						) : (
						<div className="tb-sub-mode" role="radiogroup" aria-label="对话模式" title="扮演：演剧情；工作：改卡、写前端/脚本、任何要动代码与文件的任务">
							{(["roleplay", "authoring"] as const).map((m) => (
								<button
									key={m}
									type="button"
									role="radio"
									aria-checked={conversationMode === m}
									className={`tb-sub-mode-opt ${conversationMode === m ? "active" : ""}`}
									disabled={busy || conn !== "open" || conversationMode === m}
									onClick={() => ws.send({ type: "conversation_mode", mode: m })}
								>
									{m === "authoring" ? "工作" : "扮演"}
								</button>
							))}
						</div>
						)}
						{(!coarse || busy || conn !== "open") && (
							<>
								<span className="tb-sub-sep" aria-hidden="true">
									·
								</span>
								<span className={`tb-sub-state tb-sub-state-${conn === "open" ? (busy ? "busy" : "idle") : conn}`}>
									{conn === "open" ? (busy ? "生成中" : "空闲") : conn === "connecting" ? "连接中" : "已断开"}
								</span>
							</>
						)}
						{warnings.length > 0 && (
							<button
								type="button"
								className={`tb-warn ${bellOpen ? "active" : ""}`}
								onClick={() => setBellOpen((v) => !v)}
								aria-label={`告警 ${warnings.length} 条`}
								title={`告警 ${warnings.length} 条`}
							>
								<IconBell size={13} />
								{warnings.length > 9 ? "9+" : warnings.length}
							</button>
						)}
					</span>
					{bellOpen && (
						<div className="bell-pop">
							{warnings.length === 0 && <div className="sp-empty">暂无告警（旁侧审计的警告会留在这里）</div>}
							{warnings.map((w, i) => (
								<div key={i} className={`sp-warn ${w.level === "error" ? "sp-warn-error" : ""}`}>
									<span className="sp-warn-time">{new Date(w.ts).toLocaleTimeString()}</span>
									{w.text}
								</div>
							))}
							{warnings.length > 0 && (
								<button
									type="button"
									className="act"
									onClick={() => {
										setWarnings([]);
										setBellOpen(false);
									}}
								>
									清空
								</button>
							)}
						</div>
					)}
				</div>
				{/* 右两键：新建 / 会话树 */}
				<div className="tb-side tb-side-right">
						<button
							type="button"
							className={`tb-btn ${studioOpen ? "active" : ""}`}
							onClick={toggleStudio}
							aria-label="写卡平台"
							data-tip="写卡平台"
							title="写卡平台"
						>
							<IconEdit size={18} />
						</button>
						<button
							type="button"
							className={`tb-btn ${rightPanel === "sessions" ? "active" : ""}`}
							onClick={() => togglePanel("sessions")}
							aria-label="会话树"
							data-tip="会话树"
							title="会话树"
						>
							<IconSessions size={18} />
						</button>
					</div>
			</header>

				<div className="layout">
					{/* agent 模式：稿子在中间（桌面 60%），讨论在右（40%）；手机上两者是页签（story-pane 覆盖式） */}
					{agentSplit && (
						<aside className={`story-pane ${storyTab === "story" ? "story-pane-active" : ""}`} aria-label="稿子">
							<StoryPane chapters={storyChapters} focus={storyFocus} onBack={() => setStoryTab("chat")} />
						</aside>
					)}
					<main className={`center ${welcome && sessions !== null && !homeHasHistory ? "center-home-empty" : ""} ${welcome && homeHasHistory ? "center-home-filled" : ""} ${studioOpen ? "center-studio-split" : ""} ${agentSplit ? "center-agent-split" : ""}`}>
					<div className={`stage-wrap ${rightPanel ? "split-active" : ""}`}>
					<div className="stage-col stage-col-left">
						{(rightPanel || studioOpen || agentSplit) && (
							<div className="stage-col-head">
								<span className="stage-col-title">
									<IconCard size={14} />
									<span>{agentSplit ? "讨论" : "剧情推演"}</span>
								</span>
								{agentSplit && (
									<button type="button" className="story-tab-btn" onClick={() => setStoryTab("story")}>
										稿子{storyOutline?.length ? `（${storyOutline.length} 章）` : ""}
									</button>
								)}
							</div>
						)}
					<div className="list" ref={listRef} onScroll={onScroll} onPointerDown={() => composerTools && setComposerTools(false)}>
						<div className="flow">
							{/* 欢迎区嵌在聊天流（学 ST）：顶栏/侧栏/输入框仍可用 */}
							{welcome ? (
								<WelcomePanel
									update={updateInfo}
									onUpdateClick={() => setUpdateModalOpen(true)}
									sessions={sessions}
									conn={conn}
									charName={charName}
									userName={userName}
									charAvatarUrl={charAvatarUrl}
									onOpen={openSessionFromWelcome}
									onNew={newSessionFromWelcome}
									onBrowseAll={() => {
										dismissWelcome();
										openRight("sessions");
										// 保留旧列表、后台重拉（不清 null，避免闪「读取中…」）
										ws.send({ type: "sessions" });
									}}
									onOpenPanel={openPanelFromWelcome}
								/>
							) : (
								<>
									{messages.length === 0 && !busy && (
										<div className="empty-state">
											<div className="empty-brand" aria-hidden="true">
												<BrandLogo className="empty-logo" size={96} />
												<span className="empty-title">梨园</span>
											</div>
											<div className="empty-hint">{conn === "open" ? "新的会话，开始对话吧。" : "连接后台中…"}</div>
										</div>
									)}
									{blocks.map((b, bi) =>
										b.kind === "backstage" ? (
											<BackstageGroup
												key={`bs-${b.idx}`}
												msgs={b.msgs}
												fallbackName={charName}
												open={bi === blocks.length - 1}
												avatarUrl={charAvatarUrl}
											/>
										) : (
											<Bubble
												key={b.idx}
												msg={b.msg}
												floor={b.floor}
												fallbackName={b.msg.channel === "user" ? userName || "你" : charName}
												avatarUrl={b.msg.channel === "user" ? userAvatarUrl : charAvatarUrl}
												skin={cardSkin}
												onChapter={agentSplit || conversationMode === "agent" ? (chapterId) => { setStoryFocus({ chapterId, tick: Date.now() }); setStoryTab("story"); } : undefined}
												onReroll={
													!busy &&
													!msgEdit &&
													b.msg.channel === "narrative" &&
													b.idx === lastNarrativeIdx
														? () => ws.send({ type: "swipe", dir: "new" })
														: undefined
												}
												swipe={
													!busy &&
													!msgEdit &&
													b.msg.channel === "narrative" &&
													b.idx === lastNarrativeIdx
														? {
																index: b.msg.swipe?.index ?? 0,
																total: b.msg.swipe?.total ?? 1,
																onPrev: () => ws.send({ type: "swipe", dir: "prev" }),
																onNext: () => ws.send({ type: "swipe", dir: "next" }),
															}
														: undefined
												}
												onEdit={
													!busy && !msgEdit
														? b.msg.channel === "user" && b.idx === lastUserIdx
															? () => startMsgEdit(b.idx, "user")
															: b.msg.channel === "narrative" && b.idx === lastNarrativeIdx
																? () => startMsgEdit(b.idx, "narrative")
																: b.msg.channel === "greeting" && greetingOnly
																	? () => startMsgEdit(b.idx, "greeting")
																	: undefined
														: undefined
												}
												onRewind={
													!busy &&
													!msgEdit &&
													b.msg.channel === "user" &&
													!b.msg.backstage &&
													storyUserIdxs.includes(b.idx)
														? () => rewindToUser(b.idx)
														: undefined
												}
												onDelete={
													!busy && !msgEdit
														? b.msg.channel === "user" && b.idx === lastUserIdx
															? deleteLastUserTurn
															: b.msg.channel === "narrative" && b.idx === lastNarrativeIdx
																? dropLastReply
																: undefined
														: undefined
												}
												onCopy={
													b.msg.channel === "narrative" || b.msg.channel === "greeting" || b.msg.channel === "user"
														? doCopy
														: undefined
												}
												onStore={
													!busy &&
													!msgEdit &&
													(b.msg.channel === "narrative" || b.msg.channel === "greeting") &&
													(b.idx === lastNarrativeIdx || (greetingOnly && b.msg.channel === "greeting"))
														? openStoreModal
														: undefined
												}
												onTts={
													!busy &&
													!msgEdit &&
													(b.msg.channel === "narrative" || b.msg.channel === "greeting" || b.msg.channel === "user")
														? doTts
														: undefined
												}
												ttsBusy={ttsBusy}
												greetingSwitch={
													!busy &&
													!msgEdit &&
													greetingOnly &&
													b.msg.channel === "greeting"
														? {
																// 优先消息自带序号（与正文同源），避免 API 轮询滞后
																index:
																	b.msg.greetingPick?.index ??
																	greetingMeta?.index ??
																	0,
																total: Math.max(
																	1,
																	b.msg.greetingPick?.total ??
																		greetingMeta?.total ??
																		1,
																),
																onPrev: () => switchGreeting("prev"),
																onNext: () => switchGreeting("next"),
															}
														: undefined
												}
												edit={
													msgEdit && msgEdit.idx === b.idx
														? {
																draft: msgEdit.draft,
																onChange: (v) => setMsgEdit((e) => (e ? { ...e, draft: v } : e)),
																onCancel: cancelMsgEdit,
																onSubmit: submitMsgEdit,
																submitLabel:
																	msgEdit.kind === "user"
																		? "按修改后的输入重新生成"
																		: "采用改写（或未改时重新生成）",
															}
														: undefined
												}
											/>
										),
									)}
								</>
							)}
							{/* 整轮生成共用一个实时角色泡：时间线按发生顺序依次上屏（codex 式），定稿后随消息收进折叠 */}
							{busy && (!turnHasCommittedReply || streamText || streamThinking || toolNote || liveSegs.length > 0) && (
								<div className="msg msg-char msg-live">
									<div className="msg-head">
										<MsgAvatar src={charAvatarUrl} name={charName} kind="char" />
										<span className="msg-name msg-name-char">{streamMode === "authoring" ? "工作" : streamMode === "agent" ? "agent" : charName}</span>
										<span className="msg-live-tag">生成中</span>
									</div>
									{liveSegs.length > 0 ? (
										<TurnTimeline segments={liveSegs} skin={streamMode !== "roleplay" ? null : liveSkin} plain={streamMode !== "roleplay"} live />
									) : (
										<div className="info-line pulse" style={{ margin: "0.4rem 0 0" }}>
											{`${streamMode === "authoring" ? "工作" : streamMode === "agent" ? "agent" : charName} ${thinkingLive ? "正在思考…" : "工作中…"}`}
										</div>
									)}
									{toolNote && (
										<div className="info-line pulse" style={{ margin: "0.4rem 0 0" }}>
											{toolNote}
										</div>
									)}
									{(streamText || streamThinking) && <span className="caret" />}
								</div>
							)}
								{!welcome && draftWorkspace && <DraftPanel workspace={draftWorkspace} busy={busy}
									revisions={draftHistory?.id === draftWorkspace.id ? draftHistory.revisions : undefined}
									onInspect={() => ws.send({ type: "draft_history", id: draftWorkspace.id })}
									onRestore={(version) => ws.send({ type: "draft_restore", id: draftWorkspace.id, version, expectedVersion: draftWorkspace.version })} />}
								{!welcome && activeChoice && (
								<ChoiceCard
									choice={activeChoice}
									onReply={(r) => {
										ws.send({ type: "choice_reply", id: activeChoice.id, ...r });
										setActiveChoice(null);
									}}
								/>
							)}
						</div>
					</div>

					{!welcome && !atBottom && (
						<button className="jump-bottom" onClick={jumpToBottom} title="回到最新" aria-label="回到最新">
							<IconChevronDown size={17} />
						</button>
					)}
					</div>
					{rightPanel && (
						<aside className="stage-col stage-col-right" aria-label={PANEL_LABEL[rightPanel as PanelId] || "状态栏"}>
							<div className="stage-col-head">
								<span className="stage-col-title">
									{(() => {
										const isAg = rightPanel.startsWith("agent:");
										const ag = isAg ? agentPanels.find((p) => agentId(p.name) === rightPanel) : undefined;
										const Icon = ag ? IconDock : PANEL_ICON[rightPanel as PanelId] || IconStatus;
										return (
											<>
												<Icon size={14} />
												<span>{ag ? ag.name : PANEL_LABEL[rightPanel as PanelId] || "状态栏"}</span>
											</>
										);
									})()}
								</span>
								<button
									type="button"
									className="icon-btn"
									onClick={() => openRight(null)}
									title="收起"
									aria-label="收起状态栏"
								>
									<IconClose size={15} />
								</button>
							</div>
							<div className="stage-col-body">
								{renderPanel(rightPanel as PanelId)}
							</div>
						</aside>
					)}
					</div>
					<footer
						className="composer"
						onDragOver={(e) => {
							e.preventDefault();
						}}
						onDrop={(e) => {
							e.preventDefault();
							if (e.dataTransfer.files.length > 0) void doUpload(e.dataTransfer.files);
						}}
					>
						{/* 生效世界状态：输入框上方，与输入同宽一排 */}
						{!welcome && (
							<div className="composer-shell status-above">
							{conversationMode === "roleplay" && (
								<StatusStrip
									state={worldState}
									toast={pushToast}
									active={rightPanel === "status"}
									onOpenPanel={() => toggleRight("status")}
								/>
							)}
						</div>
						)}
						{/* 扮演/工作的开关已上移到顶栏副标题（PLAN-FRONTEND-V2 §四），此处不再重复一条 */}
						{(pending.length > 0 || uploading) && (
							<div className="composer-shell attach-row">
								{pending.map((p) => (
									<span key={p.file} className="attach-chip" title={`${p.file}（${p.size}）`}>
										{p.image ? <img className="attach-thumb" src={attachmentUrl(p)} alt={p.label} /> : <span className="file-ext">{(p.name.split(".").pop() ?? "?").toUpperCase()}</span>}
										<span className="attach-label">{p.label}</span>
										<button
											className="attach-x"
											title="不随消息发送（文件保留在上传区）"
											aria-label="移除附件"
											onClick={() => setPending((prev) => prev.filter((x) => x.file !== p.file))}
										>
											<IconClose size={12} />
										</button>
									</span>
								))}
								{uploading && <span className="attach-chip attach-uploading">上传中…</span>}
							</div>
						)}
						<div className="composer-shell composer-box">
							{suggestions.length > 0 && (
								<div className="cmd-pop">
									{suggestions.map((c, i) => (
										<button
											key={c.name}
											className={`cmd-item ${i === cmdIndex ? "active" : ""}`}
											onMouseDown={(e) => {
												e.preventDefault();
												completeCmd(c);
											}}
										>
											<span className="cmd-name">/{c.name}</span>
											<span className="cmd-desc">{c.description}</span>
										</button>
									))}
								</div>
							)}
							{argHint && (
								<div className="cmd-hint">
									{argHint.usage} — {argHint.description}
								</div>
							)}
							{/* 手机端：左侧三钮收进「＋」，展开为输入框上方一行；桌面端 CSS 隐藏此钮、工具常驻 */}
							<button
								type="button"
								className={`dock-btn composer-more ${composerTools ? "active" : ""}`}
								title="更多工具"
								aria-label="更多工具"
								aria-expanded={composerTools}
								onClick={() => setComposerTools((v) => !v)}
							>
								<IconPlus size={18} />
							</button>
							<div className={`composer-tools ${composerTools ? "open" : ""}`}>
								{/* 会话已上移到顶栏右键（会话树），此处不再重复 */}
								<button
									type="button"
									className={`dock-btn ${rightPanel === "worldline" ? "active" : ""}`}
									title="世界线"
									aria-label="世界线"
									onClick={() => {
										toggleRight("worldline");
										setComposerTools(false);
									}}
								>
									<IconWorldline size={18} />
									<span className="composer-tool-label">世界线</span>
								</button>
								<button
									type="button"
									className={`dock-btn ${rightPanel === "roster" ? "active" : ""}`}
									title="登场名录"
									aria-label="登场名录"
									onClick={() => {
										toggleRight("roster");
										setComposerTools(false);
									}}
								>
									<IconRoster size={18} />
									<span className="composer-tool-label">名录</span>
								</button>
								<button
									type="button"
									className="dock-btn"
									title="上传图片/文件（也可拖入或粘贴）"
									aria-label="上传图片或文件"
									onClick={() => {
										uploadInputRef.current?.click();
										setComposerTools(false);
									}}
								>
									<IconAttach size={18} />
									<span className="composer-tool-label">上传</span>
								</button>
							</div>
							<input
								ref={uploadInputRef}
								type="file"
								multiple
								hidden
								onChange={(e) => {
									if (e.target.files?.length) void doUpload(e.target.files);
									e.target.value = "";
								}}
							/>
							<textarea
								ref={inputRef}
								value={input}
								placeholder={conn === "open" ? (conversationMode === "authoring" ? "描述要做的事：改卡、写前端或脚本、整理文件…" : conversationMode === "agent" ? "讨论剧情、下达写作指令；正文由 agent 写进稿子…" : userName ? `以「${userName}」的身份发言…` : "输入消息…") : "等待连接…"}
								rows={1}
								onFocus={() => {
									setComposerTools(false);
									setTimeout(() => inputRef.current?.scrollIntoView({ block: "nearest" }), 250);
								}}
								onPaste={(e) => {
									if (e.clipboardData.files.length > 0) {
										e.preventDefault();
										void doUpload(e.clipboardData.files);
									}
								}}
								onChange={(e) => {
									setInput(e.target.value);
									setCmdDismissed(false);
									setCmdIndex(0);
									e.target.style.height = "auto";
									e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
								}}
								onKeyDown={(e) => {
									if (suggestions.length > 0) {
										const sel = suggestions[cmdIndex] ?? suggestions[0];
										if (e.key === "ArrowDown") {
											e.preventDefault();
											setCmdIndex((i) => (i + 1) % suggestions.length);
											return;
										}
										if (e.key === "ArrowUp") {
											e.preventDefault();
											setCmdIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
											return;
										}
										if (e.key === "Escape") {
											setCmdDismissed(true);
											return;
										}
										if (e.key === "Tab") {
											e.preventDefault();
											completeCmd(sel);
											return;
										}
										// 输入尚未构成完整命令名时 Enter=补全；已完整则落到发送
										if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && input.trim() !== `/${sel.name}`) {
											e.preventDefault();
											completeCmd(sel);
											return;
										}
									}
									if (!coarse && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
										e.preventDefault();
										send();
									}
								}}
							/>
							{busy ? (
								<button
									className="btn btn-stop"
									onClick={() => {
										// 强制停止：本地立刻解锁输入，冻结流式，不等待服务端确认。
										// abortingRef 保持到下一次 agent:start，防止服务端乐观 end 后迟到 delta 复活。
										abortingRef.current = true;
										setBusy(false);
										setThinkingLive(false);
										setToolNote(null);
										// 无条件留痕：刚开拍就停（无正文无思考）也不许消息凭空消失（8/05）。
										// 正文没有时给占位——有思考引用思考，都没有明示「已停止」。
										const text = streamRef.current;
										const thinking = streamThinkingRef.current.trim();
										const acts = turnActsRef.current;
										const segs = turnSegsRef.current;
										resetActs();
										resetSegs();
										clearStream();
										const leftover: ChatMsg = {
											channel: streamModeRef.current !== "roleplay" ? "authoring" : "narrative",
											...(streamModeRef.current !== "roleplay" ? { mode: streamModeRef.current } : {}),
											text: text.trim()
												? text
												: thinking
													? "（正文未流出，见思维链）"
													: "（已停止）",
											...(thinking ? { thinking } : {}),
											...(acts.length ? { activities: acts } : {}),
											...(segs.length ? { segments: segs } : {}),
											unfinished: true,
										};
										setMessages((ms) => upsertTurnReply(ms, leftover));
										ws.send({ type: "abort" });
									}}
									title="停止"
									aria-label="停止生成"
								>
									<IconStop size={18} />
								</button>
							) : (
								<button
									className="btn btn-send"
									onClick={send}
									disabled={(!input.trim() && pending.length === 0) || conn !== "open"}
									title="发送"
									aria-label="发送"
								>
									<IconSend size={17} />
								</button>
							)}
						</div>
						{/* 会话用量：输入框下方，右缘与输入框齐平 */}
						{!welcome && (
							<div className="composer-shell session-stats-wrap">
							<SessionStatsBar stats={stats} />
						</div>
						)}
					</footer>
				</main>
				{studioOpen && (
					<aside className="studio-split-pane" aria-label="写卡平台">
						<CardStudio
							onClose={() => setStudioOpen(false)}
							onApplied={() => { apiGetCacheClear("/api/card"); void refreshCardFront(); }}
						/>
					</aside>
				)}
			</div>
			</div>
			<PreviewRunner request={previewRequest} onClose={() => setPreviewRequest(null)} />
			{floatPanel &&
				(() => {
					// agent 自建面板与内置面板共用同一个壳，只是标题/图标/刷新与内容各自不同
					const ag = activeAgentName ? agentPanels.find((p) => p.name === activeAgentName) : undefined;
					if (activeAgentName && !ag) return null; // 面板被 close 掉了
					const Icon = ag ? IconDock : PANEL_ICON[floatPanel as PanelId];
					return (
						<FloatWindow
							id={floatPanel}
							title={ag ? ag.name : PANEL_LABEL[floatPanel as PanelId]}
							icon={<Icon size={15} />}
							{...(ag
								? {}
								: {
										onRefresh: () => {
											// 与侧栏刷新同规矩：先清该面板的 GET 缓存，再 remount，否则旧缓存会让「刷新」假成功
											apiGetCacheClearForPanel(floatPanel);
											setFloatTick((t) => t + 1);
										},
									})}
							onClose={() => setFloatPanel(null)}
						>
							{ag ? (
								<ArtifactPanel
									panel={ag}
									data={worldState?.panelData?.[ag.name]}
									onSaved={(p) => {
										setAgentPanels((list) =>
											list.map((x) =>
												x.name === p.name
													? { ...x, kind: p.kind as typeof x.kind, content: p.content, updatedAt: p.updatedAt }
													: x,
											),
										);
									}}
								/>
							) : (
								<Fragment key={`${floatPanel}-${floatTick}`}>{renderPanel(floatPanel as PanelId)}</Fragment>
							)}
						</FloatWindow>
					);
				})()}
			{/*
			  * 梨园自己的悬浮球：常驻的面板启动器（世界线 / 登场名录 / agent 自建面板）。
			  * 顶栏与底栏的老入口都留着——它是多一条路，不是替换掉肌肉记忆。
			  */}
			{!studioOpen && !welcome && (
				<PanelOrb
					entries={[
					{
						id: "status",
						label: "状态栏",
						icon: <IconStatus size={14} />,
						active: rightPanel === "status",
					},
					{
						id: "worldline",
						label: "世界线",
						icon: <IconWorldline size={14} />,
						active: rightPanel === "worldline",
					},
					{
						id: "roster",
						label: "登场名录",
						icon: <IconRoster size={14} />,
						active: rightPanel === "roster",
					},
					...agentPanels.map((p) => ({
						id: agentId(p.name),
						label: p.name,
						icon: <IconDock size={14} />,
						active: rightPanel === agentId(p.name),
					})),
				]}
				onPick={(id) => {
					toggleRight(id as PanelId | AgentPanelId);
				}}
				/>
			)}
			{storeOpen && (
				<StoreModal
					defaultName={storeDefaultName}
					onCancel={() => setStoreOpen(false)}
					onConfirm={(name) => {
						setStoreOpen(false);
						ws.send({ type: "prompt", text: `/store ${name}` });
					}}
				/>
			)}
		</div>
		</PanelRefreshContext.Provider>
	);
}

/** 复制到剪贴板：clipboard API 需要安全上下文，局域网 http 走隐藏 textarea 兜底 */
function copyText(text: string): boolean {
	if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
		void navigator.clipboard.writeText(text);
		return true;
	}
	try {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand("copy");
		document.body.removeChild(ta);
		return ok;
	} catch {
		return false;
	}
}
