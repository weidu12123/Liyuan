/**
 * 梨园 Web 前端 — F1 骨架：顶栏驱动的面板系统（PLAN-PHASE3 v2 §2）。
 *
 * 交互模型（ST 同款，用户定调）：左右栏默认为空；点顶栏按钮在对应侧展开面板，
 * 再点收起、点同侧其他按钮切换；展开状态记入 localStorage（刷新恢复）。
 * 手机（<1000px）：面板变全屏抽屉。
 */

import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import { createPortal } from "react-dom";
import {
	apiGet,
	apiGetCacheClear,
	apiGetCacheClearForPanel,
	apiGetCacheClearForToolNames,
	apiPost,
	apiPut,
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
import { ArtifactPanel, renderMarkdown } from "./components/ArtifactPanel.tsx";
import { DraftPanel } from "./components/DraftPanel.tsx";
import { workspaceSegments } from "./draft-view.ts";
import type { DraftView } from "./wire.ts";
import { BrandLogo } from "./components/BrandLogo.tsx";
import { ComposerModelSwitch, ConnectEditorPane, ConnectPanel, type ConnectEditTarget } from "./components/ConnectPanel.tsx";
import { FloatWindow } from "./components/FloatWindow.tsx";
import { PreviewRunner, type CardPreviewRequestFrame } from "./components/PreviewRunner.tsx";
import { WelcomePanel } from "./components/HomePage.tsx";
import { StatusPanel } from "./components/StatusPanel.tsx";
import { UpdateModal, UpdateToast } from "./components/UpdateFlow.tsx";
import { bumpWatchPanels, PanelRefreshContext } from "./components/kit.tsx";
import { registerLiyuanToast, registerTavernChatBridge } from "./tavernShim.ts";
import { syncCardRuntimeVariables } from "./cardRuntimeFrames.ts";
import { setAtHome, shouldShowHomeOnBoot, touchVisit } from "./visit.ts";
import { getTheme, setTheme } from "./theme.ts";
import { getWallpaperConfig, type WallpaperConfig } from "./themes.ts";
import { syncLocaleFromConfig, t, useLocale } from "./i18n/index.ts";
import {
	IconApi,
	IconAttach,
	IconPlus,
	IconPin,
	IconUndo,
	IconPalette,
	IconBell,
	IconCard,
	IconChevronDown,
	IconChevronLeft,
	IconClose,
	IconDock,
	IconEdit,
	IconPencil,
	IconLorebook,
	IconNewChat,
	IconPanelLeft,
	IconPersona,
	IconBot,
	IconMore,
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
import { LoreDetailCenter } from "./components/LoreDetailCenter.tsx";
import { BashDenylistCenter } from "./components/BashDenylistCenter.tsx";
import type { LoreEntryView } from "./api.ts";
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
import { PresetPanel, PresetEditorPane, type PresetEditTarget } from "./components/PresetPanel.tsx";
import { RolesPanel, type RolesTab } from "./components/RolesPanel.tsx";
import { CardLorePicker } from "./components/CardPanel.tsx";
import { RosterPanel } from "./components/RosterPanel.tsx";
import { ScriptHost } from "./components/ScriptHost.tsx";
import { SessionsPanel, NewProjectBox, nextProjectName, ChatAssetCenter, type ChatAssetTarget } from "./components/SessionsPanel.tsx";
import { BotSessionControls } from "./components/BotSessionControls.tsx";
import type { BotSessionSnapshot } from "../../src/stage/bot-session-types.ts";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
import { AboutPanel } from "./components/AboutPanel.tsx";
import { ThemePanel } from "./components/ThemePanel.tsx";
import { SessionStatsBar, StatusStrip } from "./components/StatusStrip.tsx";
import { UploadsPanel } from "./components/UploadsPanel.tsx";
import { StoreModal, WorldlinePanel } from "./components/WorldlinePanel.tsx";
import { StoryPane, type StoryDiffFile, type StoryFileView } from "./components/StoryPane.tsx";
import { captureStoryPng } from "./captureStory.ts";
import { useWire, type ConnState } from "./ws.ts";
import type {
	AuthorScript,
	ConversationMode,
	RpPanel,
	ServerFrame,
	WireActivity,
	WireBotMsg,
	WireBotToolCall,
	WireChatInfo,
	WireSessionInfo,
	WireStats,
	WireStoryFile,
	WireCheckpoint,
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
	| "theme"
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
const PRIMARY_NAV_SECTIONS: PanelId[] = ["roles", "connect", "preset", "lorebook", "powers"];
const MORE_NAV_SECTIONS: PanelId[] = ["uploads", "theme"];
const MOBILE_PRIMARY_TABS: PanelId[] = ["roles", "connect", "preset"];
const MOBILE_MORE_TABS: PanelId[] = ["lorebook", "powers", "uploads", "theme"];
const DRAWER_SECTIONS: PanelId[] = [...PRIMARY_NAV_SECTIONS, ...MORE_NAV_SECTIONS];
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

// 面板名表：用时经 t() 翻（locale 运行时可切）
const PANEL_LABEL: Record<PanelId, string> = {
	sessions: "会话", // i18n-ignore
	worldline: "世界线", // i18n-ignore
	connect: "连接", // i18n-ignore
	preset: "提示词", // i18n-ignore
	powers: "扩展", // i18n-ignore
	settings: "设置", // i18n-ignore
	about: "关于", // i18n-ignore
	roles: "角色", // i18n-ignore
	lorebook: "世界书", // i18n-ignore
	roster: "登场名录", // i18n-ignore
	uploads: "资料", // i18n-ignore
	theme: "主题", // i18n-ignore
	status: "状态栏", // i18n-ignore
};
const panelLabel = (id: PanelId | string | null | undefined): string => (id && id in PANEL_LABEL ? t(PANEL_LABEL[id as PanelId]) : "");

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
	theme: IconPalette,
	status: IconStatus,
};

function loadPanelPrefs(): { left: PanelId | null; right: PanelId | null; lastSection: PanelId | null } {
	// 左栏改为常驻导航＋会话树，板块在右侧主工作区全宽铺开，故首启默认展示对话舞台（left = null）
	try {
		const raw = JSON.parse(localStorage.getItem("liyuan.panels") ?? "{}") as Record<string, unknown>;
		const pick = (v: unknown, group: PanelId[]) => (group.includes(v as PanelId) ? (v as PanelId) : null);
		const lastSection = pick(raw.left, DRAWER_PANELS);
		return { left: null, right: pick(raw.right, RIGHT_OPENABLE), lastSection };
	} catch {
		return { left: null, right: null, lastSection: null };
	}
}

export default function App() {
	useLocale(); // 顶层订阅界面语言：切换时整棵树重渲染
	const [conn, setConn] = useState<ConnState>("connecting");
	const [charName, setCharName] = useState("梨园"); // i18n-ignore：hello 到达前的占位，随即被卡名覆盖
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
	/** agent 模式：稿子目录与检查点（hello 同帧）；正文按目录指纹变化才拉 GET /api/story */
	const [storyOutline, setStoryOutline] = useState<WireStoryFile[] | null>(null);
	const [storyCheckpoints, setStoryCheckpoints] = useState<WireCheckpoint[]>([]);
	const [storyFiles, setStoryFiles] = useState<StoryFileView[] | null>(null);
	/** 手机：稿子与讨论是左右两页，横滑切换；这个值是当前停在哪一页 */
	const [storyTab, setStoryTab] = useState<"story" | "chat">("chat");
	const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
	/** 桌面：稿子占分栏的比例（可拖）与讨论栏是否收起，都记在本浏览器 */
	const [storyFrac, setStoryFrac] = useState(() => {
		try {
			const v = Number(localStorage.getItem("liyuan.storyFrac"));
			return v >= 0.2 && v <= 0.85 ? v : 0.6;
		} catch { return 0.6; }
	});
	const [chatCollapsed, setChatCollapsed] = useState(() => {
		try { return localStorage.getItem("liyuan.agentChatCollapsed") === "1"; } catch { return false; }
	});
	const pagesRef = useRef<HTMLDivElement | null>(null);
	const storyDragRef = useRef(false);
	/** 讨论区检查点卡片点击 → 稿子视图历史里展开它 */
	const [storyFocus, setStoryFocus] = useState<{ file?: string; checkpointId?: string; tick: number } | null>(null);
	const [toolNote, setToolNote] = useState<string | null>(null);
	/** 压缩进行中（引擎 compaction 帧驱动）：常驻到结束，含开始时刻做计时 */
	const [compacting, setCompacting] = useState<{ detail: string; since: number } | null>(null);
	/** 本轮过程步骤（实时清单渲染用；与 turnActsRef 同内容） */
	const [liveActs, setLiveActs] = useState<WireActivity[]>([]);
	const [toasts, setToasts] = useState<Toast[]>([]);
	const [wallpaper, setWallpaper] = useState<WallpaperConfig | null>(() => getWallpaperConfig());
	useEffect(() => {
		const handler = (e: Event) => {
			const custom = e as CustomEvent<WallpaperConfig | null>;
			setWallpaper(custom.detail);
		};
		window.addEventListener("liyuan:wallpaper-change", handler);
		return () => window.removeEventListener("liyuan:wallpaper-change", handler);
	}, []);
	// 在线更新：WS update 帧驱动；modal 开关与 ready 气泡的本次会话收起标记
	const [updateInfo, setUpdateInfo] = useState<UpdateWire | null>(null);
	const [updateModalOpen, setUpdateModalOpen] = useState(false);
	const [updateToastDismissed, setUpdateToastDismissed] = useState(false);
	const updateErrRef = useRef<string | null>(null);
	// 顶栏「新建」：点击出两项（新建项目 / 新建对话，2026-09-14 用户点名——一般先建项目）
	const [newMenuOpen, setNewMenuOpen] = useState(false);
	const [namingProject, setNamingProject] = useState(false);
	// 顶栏右上角「用户角色」快速切换气泡
	const [personaMenuOpen, setPersonaMenuOpen] = useState(false);
	const [personaStore, setPersonaStore] = useState<PersonasResponse | null>(null);
	const [personaSwitching, setPersonaSwitching] = useState(false);
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
	/**
	 * 备注行（PLAN-DIRECTOR-NOTE）：点「备注」加一行，可多条。发送/重 roll/重抽时随行——
	 * 前端先发 `/note`（多条＝一个命令多行）再发动作；不进入剧情历史，用完即清。
	 */
	const [noteRows, setNoteRows] = useState<string[]>([]);
	// 幕后副编剧 Bot 伴随抽屉状态（PLAN-COMPANION-BOT 刀 3）
	const [botOpen, setBotOpen] = useState(false);
	const [botSession, setBotSession] = useState<BotSessionSnapshot | null>(null);
	const [botMessages, setBotMessages] = useState<WireBotMsg[]>([]);
	const [botStreaming, setBotStreaming] = useState(false);
	const [botStreamText, setBotStreamText] = useState("");
	const [botStreamThinking, setBotStreamThinking] = useState("");
	const [botLiveTools, setBotLiveTools] = useState<WireBotToolCall[]>([]);
	const [botInput, setBotInput] = useState("");
	const [botSettingsOpen, setBotSettingsOpen] = useState(false);
	const [botSettingsScope, setBotSettingsScope] = useState<"global" | "card">("global");
	const [botGlobalPersona, setBotGlobalPersona] = useState("");
	const [botCardPersona, setBotCardPersona] = useState("");
	const [botPresets, setBotPresets] = useState<Array<{ id: string; name: string; tagline: string; content: string }>>([]);
	const [botViewBeats, setBotViewBeats] = useState<number>(0);
	const [botSavingSettings, setBotSavingSettings] = useState(false);
	const botScrollRef = useRef<HTMLDivElement>(null);
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
	// 面板系统：sidebarOpen 控制左栏（上导航＋下会话树）的开合；leftPanel 控制右侧主工作区当前展示的设置/资产板块
	const initialPanels = useMemo(loadPanelPrefs, []);
	const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
		const mobile = typeof matchMedia !== "undefined" && matchMedia("(max-width: 999px)").matches;
		if (mobile) return false;
		try {
			return localStorage.getItem("liyuan.sidebarOpen") !== "0";
		} catch {
			return true;
		}
	});
	const [navMoreOpen, setNavMoreOpen] = useState(false);
	const [leftPanel, setLeftPanel] = useState<PanelId | AgentPanelId | null>(initialPanels.left);
	const [rightPanel, setRightPanel] = useState<PanelId | AgentPanelId | null>(initialPanels.right);
	/** 悬浮窗当前显示的面板（与左右栏并列的第三种形态，同时只开一个） */
	const [floatPanel, setFloatPanel] = useState<PanelId | AgentPanelId | null>(null);
	const [studioOpen, setStudioOpen] = useState(false);
	const [cardLoreOpen, setCardLoreOpen] = useState(false);
	const [connectEditorTarget, setConnectEditorTarget] = useState<ConnectEditTarget | null>(null);
	const [presetEditorTarget, setPresetEditorTarget] = useState<PresetEditTarget | null>(null);
	const sidebarBeforeStudioRef = useRef<boolean | null>(null);
		const [centerLoreDetail, setCenterLoreDetail] = useState<{ entry: LoreEntryView; scopePath: string } | null>(null);
		const [centerDenylist, setCenterDenylist] = useState(false);
		const [centerChatAsset, setCenterChatAsset] = useState<ChatAssetTarget | null>(null);
		const [chatAssetTick, setChatAssetTick] = useState(0);
	const [dark, setDark] = useState(() => getTheme() === "dark");
	useEffect(() => {
		const handler = (e: Event) => {
			const custom = e as CustomEvent<{ isDark?: boolean }>;
			if (typeof custom.detail?.isDark === "boolean") {
				setDark(custom.detail.isDark);
			} else {
				setDark(getTheme() === "dark");
			}
		};
		window.addEventListener("liyuan:theme-change", handler);
		return () => window.removeEventListener("liyuan:theme-change", handler);
	}, []);
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
			if (mq.matches) {
				setSidebarOpen(false);
				setRightPanel((r) => (r && leftPanelRef.current ? null : r));
			}
		};
		sync();
		mq.addEventListener("change", sync);
		return () => mq.removeEventListener("change", sync);
	}, []);
	useEffect(() => {
		if (mobileRef.current) return;
		try { localStorage.setItem("liyuan.sidebarOpen", sidebarOpen ? "1" : "0"); } catch { /* 隐私模式等 */ }
	}, [sidebarOpen]);
	const restoreSidebarFromStudio = useCallback(() => {
		setStudioOpen(false);
		if (!mobileRef.current && sidebarBeforeStudioRef.current !== null) {
			setSidebarOpen(sidebarBeforeStudioRef.current);
			sidebarBeforeStudioRef.current = null;
		}
	}, []);
	/**
	 * 切换右侧主工作区展示的板块（roles / connect / preset / lorebook 等）。
	 * 传 null 即回到对话舞台；手机上选中板块后自动收起左侧导航抽屉。
	 */
	const openLeft = useCallback((next: PanelId | AgentPanelId | null) => {
		setCenterChatAsset(null);
		setMobileMoreOpen(false);
		if (next !== "roles") setCardLoreOpen(false);
		if (next !== "connect") setConnectEditorTarget(null);
		if (next !== "preset") setPresetEditorTarget(null);
		if (isFloatPanel(next)) {
			setFloatPanel(next);
			return;
		}
		restoreSidebarFromStudio();
		if (next !== null) {
			setRightPanel(null);
			if (mobileRef.current) {
				setSidebarOpen(false);
			}
		}
		setLeftPanel(next);
	}, [restoreSidebarFromStudio]);
	/** 开右栏：收起中间展开面板，避免四栏挤压 */
	const openRight = useCallback((next: PanelId | AgentPanelId | null) => {
		if (next !== null) {
			restoreSidebarFromStudio();
			setLeftPanel(null);
			setCenterChatAsset(null);
		}
		setRightPanel(next);
	}, [restoreSidebarFromStudio]);
	/** 切换右栏面板（点同钮收起，点异钮切换） */
	const toggleRight = useCallback(
		(id: PanelId | AgentPanelId) => {
			openRight(rightPanelRef.current === id ? null : id);
		},
		[openRight],
	);
	/** 在角色板块内切入 00–09 写卡工坊视图，同时自动折叠左侧栏让出横向空间 */
	const openStudio = useCallback(() => {
		if (!mobileRef.current && sidebarBeforeStudioRef.current === null) {
			sidebarBeforeStudioRef.current = sidebarOpen;
		}
		setSidebarOpen(false);
		setRightPanel(null);
		setCenterChatAsset(null);
		setRolesTab("card");
		setLeftPanel("roles");
		setStudioOpen(true);
	}, [sidebarOpen]);
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
		setStoreDefaultName(t("存档 {date} {time}", { date: `${d.getMonth() + 1}/${d.getDate()}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }));
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
	useEffect(() => {
		if (!leftPanel) return;
		setLeftKeep((prev) => [leftPanel, ...prev.filter((x) => x !== leftPanel)].slice(0, 5));
	}, [leftPanel]);

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
	 * agent 模式的稿子：hello 只带目录，正文按「目录指纹」变化才拉一次 GET /api/story（gzip）。
	 * 指纹＝文件名:字数:mtime 序列——写/改/改名/恢复都会改它；纯讨论一轮不变，零请求。
	 */
	const storyKey = storyOutline ? storyOutline.map((f) => `${f.name}:${f.chars}:${f.mtime}`).join("|") : null;
	useEffect(() => {
		if (storyKey === null) { setStoryFiles(null); return; }
		if (storyKey === "") { setStoryFiles([]); return; }
		let live = true;
		void apiGet<{ files: StoryFileView[] }>("/api/story", { bypassCache: true })
			.then((r) => { if (live) setStoryFiles(r.files); })
			.catch((e) => { if (live) pushToast("warning", t("读取正文失败：{err}", { err: e instanceof Error ? e.message : String(e) })); });
		return () => { live = false; };
	}, [storyKey, pushToast]);

	const loadStoryDiff = useCallback(
		(id: string) => apiGet<{ files: StoryDiffFile[] }>(`/api/story/diff?checkpoint=${encodeURIComponent(id)}`, { bypassCache: true }).then((r) => r.files),
		[],
	);

	const doTts = useCallback(
		async (text: string) => {
			const body = text.trim();
			if (!body || ttsBusy) return;
			setTtsBusy(true);
			try {
				await apiPost<{ ok: boolean; src: string }>("/api/tts", {
					text: body.slice(0, 4000),
					caption: body.slice(0, 40),
				});
				pushToast("info", t("配音已生成"));
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
				setPersonaStore(pr);
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
					syncLocaleFromConfig(frame.uiLanguage);
					modeRef.current = frame.conversationMode ?? "roleplay";
					setConversationMode(modeRef.current);
					streamModeRef.current = frame.turnMode ?? modeRef.current;
					setStreamMode(streamModeRef.current);
					setStoryOutline(modeRef.current === "agent" ? frame.story?.files ?? [] : null);
					setStoryCheckpoints(modeRef.current === "agent" ? frame.story?.checkpoints ?? [] : []);
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
						// 会话树常驻左栏下半区：列表「当前」标记已变，重拉（+短延迟再拉一次，等 rp-card 落盘）。
						sendRef.current({ type: "sessions" });
						window.setTimeout(() => sendRef.current({ type: "sessions" }), 350);
					} else {
						// 同会话 hello（重载）：刷新列表
						sendRef.current({ type: "sessions" });
					}
						document.title = t("梨园");
						setDraftWorkspace(frame.workspace);
						setDraftHistory(undefined);
						setBusy(frame.streaming === true);
						setBotMessages(frame.botMessages ?? []);
						setBotSession(frame.botSession ?? null);
						setBotStreaming(frame.botStreaming === true);
						if (!frame.botStreaming) {
							setBotStreamText("");
							setBotStreamThinking("");
							setBotLiveTools([]);
						}
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
									text: text.trim() ? text : t("（正文未流出，见思维链）"),
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
						if (updated && sel !== agentId(updated.name)) pushToast("info", t("面板「{name}」已更新", { name: updated.name }));
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
					// 压缩起止（自动与手动同一条）：进行中常驻在底部状态栏（带计时），完成给一次提示。
					// 文案由引擎给（detail），前端不解析 activity 字符串。
					if (frame.state === "start") {
						setCompacting({ detail: frame.detail?.trim() || t("正在压缩上下文…"), since: Date.now() });
						setToolNote(frame.detail?.trim() || t("正在压缩上下文…"));
					} else {
						setCompacting(null);
						setToolNote(null);
						if (frame.ok === false) pushToast("warning", frame.detail?.trim() || t("压缩失败"));
						else if (frame.detail?.trim()) pushToast("info", frame.detail.trim());
					}
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
					case "screenshot":
						void (async () => {
							const shot = await captureStoryPng(frame.file);
							try { await apiPost("/api/screenshot/report", { id: frame.id, png: shot?.png ?? "", width: shot?.width ?? 0, height: shot?.height ?? 0, ...(shot ? {} : { note: t("没有可截的正文") }) }); } catch { /* 回报失败：服务端按超时处理 */ }
						})();
						break;
				case "update": {
					const prevErr = updateErrRef.current;
					updateErrRef.current = frame.update.error ?? null;
					setUpdateInfo(frame.update);
					if (frame.update.phase === "downloading" || frame.update.phase === "ready") setUpdateToastDismissed(false);
					// 下载失败（downloading→available+error）：临时气泡提示，否则用户不重开弹窗看不到原因
					if (frame.update.error && frame.update.error !== prevErr) {
						pushToast("error", t("更新失败：{err}（点主页提示可重试/设镜像）", { err: frame.update.error }));
					}
					break;
				}
				case "notify":
					pushToast(frame.level, frame.text);
					if (frame.level !== "info") {
						setWarnings((ws) => [{ ts: Date.now(), level: frame.level as "warning" | "error", text: frame.text }, ...ws].slice(0, 30));
					}
					// 新建/切换后服务端会 notify；会话树常驻左栏下半区，确保列表与 current 标记更新。
					sendRef.current({ type: "sessions" });
					window.setTimeout(() => sendRef.current({ type: "sessions" }), 350);
					break;
				case "error":
					pushToast("error", frame.text);
					setWarnings((ws) => [{ ts: Date.now(), level: "error" as const, text: frame.text }, ...ws].slice(0, 30));
					break;
				case "bot_session":
					setBotSession(frame.snapshot);
					setBotMessages(frame.snapshot.messages);
					if (!["running", "compacting"].includes(frame.snapshot.status)) {
						setBotStreamText(""); setBotStreamThinking(""); setBotLiveTools([]);
					}
					break;
				case "bot_history":
					setBotMessages(frame.messages);
					setBotStreamText("");
					setBotStreamThinking("");
					setBotLiveTools([]);
					break;
				case "bot_state":
					setBotStreaming(frame.state === "start");
					setBotStreamText("");
					setBotStreamThinking("");
					setBotLiveTools([]);
					break;
				case "bot_delta":
					if (frame.kind === "text") {
						setBotStreamText((prev) => prev + frame.delta);
					} else {
						setBotStreamThinking((prev) => prev + frame.delta);
					}
					break;
				case "bot_activity":
					setBotLiveTools((prev) => [
						...prev,
						{
							name: frame.activity.name,
							...(frame.activity.detail ? { detail: frame.activity.detail } : {}),
							...(frame.activity.isError ? { isError: true } : {}),
						},
					]);
					if (apiGetCacheClearForToolNames([frame.activity.name])) {
						bumpWatchPanels();
					}
					break;
				case "bot_message":
					setBotMessages((prev) => [...prev, frame.message]);
					if (frame.message.role === "assistant") {
						setBotStreamText("");
						setBotStreamThinking("");
						setBotLiveTools([]);
					}
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
			// 预挂载常用面板进 keep（隐藏时仍保留 DOM）
			setLeftKeep((prev) => {
				// 角色最贵（封面）也最常开，首位预挂；其余随用随挂
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

	const isAgentMode = conversationMode === "agent";
	const lastNarrativeIdx = useMemo(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			if (isAgentMode) {
				if (messages[i].channel === "authoring") return i;
			} else {
				if (messages[i].channel === "narrative") return i;
			}
		}
		return -1;
	}, [messages, isAgentMode]);
	const lastUserIdx = useMemo(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].channel === "user" && (isAgentMode || (messages[i].mode === undefined && !messages[i].backstage))) return i;
		}
		return -1;
	}, [messages, isAgentMode]);
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

	// 跟随滚动：仅当用户本就在底部。
	// 打开对话时消息一次全到，但卡皮肤的帧是落定后才把高度撑开的——只在 messages 变化时滚一次会滚在撑开之前，停在开头。
	// 所以在「本就在底部」期间盯着列表高度，变高就补滚到底；用户一旦往上翻，atBottomRef 转 false，不再打扰。
	useEffect(() => {
		const el = listRef.current;
		if (!el) return;
		const follow = () => { if (atBottomRef.current) el.scrollTop = el.scrollHeight; };
		follow();
		const ro = new ResizeObserver(follow);
		for (const child of el.children) ro.observe(child);
		return () => ro.disconnect();
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

	const saveAgentCheckpoint = useCallback((defaultMsg?: string) => {
		if (busy) return;
		const inputMsg = window.prompt(t("请输入检查点存档说明（可选）："), defaultMsg || "");
		if (inputMsg === null) return;
		const name = inputMsg.trim() || t("手动存档");
		ws.send({ type: "story_checkpoint", message: name });
	}, [busy, ws]);

	const rewindAgentTurn = useCallback(() => {
		if (busy) return;
		const latest = storyCheckpoints && storyCheckpoints.length > 0 ? storyCheckpoints[storyCheckpoints.length - 1] : null;
		if (latest) {
			const q = t("文件和讨论一起回退到「{msg}」之前？\n撤销本轮改动，讨论也将回到该轮输入之前。", { msg: latest.message });
			if (window.confirm(q)) {
				ws.send({ type: "story_restore", checkpointId: latest.id, scope: "both" });
			}
			return;
		}
		const q = t("撤销本轮输入与讨论？\n讨论将回到本轮输入之前。");
		if (window.confirm(q)) {
			ws.send({ type: "prompt", text: "/rewind 1" });
		}
	}, [busy, storyCheckpoints, ws]);

	/**
	 * 备注行 → 先发 `/note` 武装（多条＝一个命令内多行；服务端按「下一次扮演生成」消费：
	 * 发送/重 roll/重抽都算）。无备注行、或非扮演模式时什么都不发，视为成功。
	 * 返回 false＝连接未就绪，调用方应中止本次动作。
	 */
	const sendNotes = useCallback((): boolean => {
		if (conversationMode !== "roleplay") return true;
		const lines = noteRows.map((s) => s.trim()).filter(Boolean);
		if (lines.length === 0) return true;
		if (!ws.send({ type: "prompt", text: `/note ${lines.join("\n")}` })) return false;
		setNoteRows([]);
		return true;
	}, [conversationMode, noteRows, ws]);

	const send = useCallback(() => {
		const typed = input.trim();
		// 附件随消息：路径清单作为尾行附在正文后（这一行即持久记录，重放同路径解析）
		const attachLine = pending.length > 0 ? buildAttachmentLine(pending.map((p) => p.file)) : "";
		const text = attachLine ? (typed ? `${typed}\n${attachLine}` : attachLine) : typed;
		if (!text) return;
		if (conversationMode === "agent") {
			const saveMatch = /^\/(?:save|store)(?:\s+(.*))?$/i.exec(typed);
			if (saveMatch && pending.length === 0) {
				setWelcome(false);
				setAtHome(false);
				touchVisit();
				saveAgentCheckpoint(saveMatch[1]);
				setInput("");
				setPending([]);
				return;
			}
			if (/^\/(?:restore|back)\s*$/i.test(typed) && pending.length === 0) {
				setWelcome(false);
				setAtHome(false);
				touchVisit();
				rewindAgentTurn();
				setInput("");
				setPending([]);
				return;
			}
		} else {
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
		}
		let sent: boolean;
		if (/^\/bot(?:\s|$)/i.test(typed) && pending.length === 0) {
			setBotOpen(true);
			sent = ws.send({ type: "prompt", text: typed });
		} else if (/^\/compact(?:\s|$)/i.test(typed) && pending.length === 0) {
			sent = typed === "/compact" || /^\/compact\s*$/i.test(typed)
				? ws.send({ type: "compact" })
				: ws.send({ type: "prompt", text: typed });
		} else {
			// 备注随下一次生成走：先发 /note 再发正文（同一 WS 保序）；命令（/rewind 等）不带走备注
			if (!typed.startsWith("/") && !sendNotes()) {
				pushToast("warning", t("连接还没好，内容还在输入框里"));
				return;
			}
			sent = ws.send({ type: "prompt", text });
		}
		if (!sent) {
			pushToast("warning", t("连接还没好，内容还在输入框里"));
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
	}, [input, pending, ws, openStoreModal, pushToast, toggleRight, conversationMode, saveAgentCheckpoint, rewindAgentTurn, sendNotes]);


	// 卡 HTML（如 某卡 开场表单）调用 triggerSlash(`/send …|/trigger`)
	// 须接到输入框 / WS，否则界面显示「档案已发送」但聊天栏空白
	const inputRefForBridge = useRef(input);
	inputRefForBridge.current = input;
	useEffect(() => {
		if (!botOpen) return;
		const el = botScrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [botOpen, botMessages, botStreamText, botStreamThinking, botLiveTools]);

	const sendBot = useCallback(
		(override?: string) => {
			const q = (override ?? botInput).trim();
			if (!q) return;
			if (busy || botStreaming) {
				pushToast("warning", t("请等当前回复完成（或先停止），再唤副编剧"));
				return;
			}
			if (!ws.send({ type: "bot_prompt", text: q })) {
				pushToast("warning", t("连接还没好，内容还在输入框里"));
				return;
			}
			if (override === undefined) setBotInput("");
		},
		[botInput, botStreaming, busy, pushToast, ws],
	);

	const openBotSettings = useCallback(async () => {
		if (botSettingsOpen) {
			setBotSettingsOpen(false);
			return;
		}
		setBotSettingsOpen(true);
		try {
			apiGetCacheClear("/api/bot/settings");
			const r = await apiGet<{
				personas: Array<{ id: string; name: string; tagline: string; content: string }>;
				globalPersona: string;
				cardPersona: string;
				activeScope: "global" | "card";
				botViewBeats: number;
			}>("/api/bot/settings");
			setBotPresets(r.personas ?? []);
			setBotGlobalPersona(r.globalPersona ?? "");
			setBotCardPersona(r.cardPersona ?? "");
			setBotSettingsScope(r.activeScope ?? "global");
			setBotViewBeats(typeof r.botViewBeats === "number" ? r.botViewBeats : 0);
		} catch (e) {
			pushToast("error", e instanceof Error ? e.message : String(e));
		}
	}, [botSettingsOpen, pushToast]);

	const saveBotSettings = useCallback(async () => {
		if (botSavingSettings) return;
		setBotSavingSettings(true);
		try {
			const content = botSettingsScope === "card" ? botCardPersona : botGlobalPersona;
			await apiPut("/api/bot/settings", {
				scope: botSettingsScope,
				content,
				botViewBeats,
			});
			setBotSettingsOpen(false);
			pushToast("ok", t("副编剧设置已保存"));
		} catch (e) {
			pushToast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setBotSavingSettings(false);
		}
	}, [botCardPersona, botGlobalPersona, botSavingSettings, botSettingsScope, botViewBeats, pushToast]);

	const applyBotToNote = useCallback(
		(raw: string) => {
			const clean = raw
				.replace(/^#{1,4}\s+/gm, "")
				.replace(/\|\|([^|]+)\|\|/g, "$1")
				.replace(/\s*\n+\s*/g, "；")
				.trim();
			if (!clean) return;
			setNoteRows((rs) => [...rs.filter((x) => x.trim().length > 0), clean]);
			pushToast("ok", t("已填入台前备注（下一拍生效）"));
		},
		[pushToast],
	);

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
					pushToast("warning", t("连接未就绪，无法从界面发送"));
					return;
				}
				const body = (text || inputRefForBridge.current || "").trim();
				if (!body) {
					pushToast("warning", t("没有可发送的内容"));
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
				pushToast("info", t("已从界面注入并发送"));
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
						pushToast("error", t("「{name}」上传失败：{err}", { name: f.name, err: err instanceof Error ? err.message : String(err) }));
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
			// 改写输入后重 roll：备注同样随行（先 /note 再 /reroll）
			if (!sendNotes()) {
				pushToast("warning", t("连接还没好，改写还在编辑框里"));
				return;
			}
			sent = ws.send({ type: "reroll", text: full });
		} else {
			const orig = (messages[msgEdit.idx]?.text ?? "").trim();
			if (text === orig && msgEdit.kind === "narrative") {
				if (!sendNotes()) {
					pushToast("warning", t("连接还没好，改写还在编辑框里"));
					return;
				}
				sent = ws.send({ type: "reroll" });
			} else {
				sent = ws.send({ type: "prompt", text: `/editreply ${text}` });
			}
		}
		if (!sent) {
			pushToast("warning", t("连接还没好，改写还在编辑框里"));
			return;
		}
		setMsgEdit(null);
	}, [msgEdit, busy, messages, ws, pushToast, sendNotes]);

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
		if (!window.confirm(t("删除本轮对话（你的输入 + 角色回复）？内容会留在会话树旁支，可从世界线找回。"))) return;
		ws.send({ type: "prompt", text: "/rewind 1" });
	}, [busy, lastUserIdx, ws]);

	const dropLastReply = useCallback(() => {
		if (busy || lastNarrativeIdx < 0) return;
		if (!window.confirm(t("删除最后一条角色回复？你的输入会保留，可编辑后再发。"))) return;
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

	const activeCommands = useMemo(() => {
		if (!commands) return [];
		return commands.filter((c) => {
			if (conversationMode === "agent") {
				return c.mode === "agent" || c.mode === "all";
			}
			return c.mode === "roleplay" || c.mode === "all" || !c.mode;
		});
	}, [commands, conversationMode]);

	const suggestions = useMemo(() => {
		const m = /^\/(\w*)$/.exec(input);
		if (!m || cmdDismissed || !activeCommands.length) return [];
		return activeCommands.filter((c) => c.name.startsWith(m[1]));
	}, [input, activeCommands, cmdDismissed]);

	const argHint = useMemo(() => {
		const m = /^\/(\w+)\s/.exec(input);
		if (!m || !activeCommands.length) return null;
		return activeCommands.find((c) => c.name === m[1]) ?? null;
	}, [input, activeCommands]);

	const completeCmd = (c: CommandMeta) => {
		setInput(c.takesArgs ? `/${c.name} ` : `/${c.name}`);
		setCmdIndex(0);
		inputRef.current?.focus();
	};

	const doCopy = (text: string) => {
		pushToast("info", copyText(text) ? t("已复制正文") : t("复制失败（浏览器限制）"));
	};

	/**
	 * 顶栏左键：开合左侧栏（上导航＋下会话树）。
	 */
	const toggleDrawer = () => {
		setMobileMoreOpen(false);
		setSidebarOpen((v) => !v);
	};

	// 会话树常驻左栏下半区：列表为空时补拉（含新建会话后 hello 清空）
	useEffect(() => {
		if (conn !== "open") return;
		if (sessions === null) {
			ws.send({ type: "sessions" });
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- ws.send 稳定；sessions 变 null 时要重拉
	}, [conn, sessions]);

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
						activeAsset={centerChatAsset}
						assetTick={chatAssetTick}
						onOpenAsset={(asset) => {
							setCenterChatAsset(asset);
							if (asset) {
								setLeftPanel(null);
								setRightPanel(null);
								setStudioOpen(false);
								if (mobileRef.current) setSidebarOpen(false);
							}
						}}
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
						onNew={(name, mode, greeting) => {
							ws.send({ type: "new", ...(name ? { name } : {}), ...(mode ? { mode } : {}), ...(greeting !== undefined ? { greeting } : {}) });
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
				return (
					<ConnectPanel
						toast={pushToast}
						editorTarget={connectEditorTarget}
						onChangeEditorTarget={setConnectEditorTarget}
					/>
				);
			case "preset":
				return (
					<PresetPanel
						toast={pushToast}
						editorTarget={presetEditorTarget}
						onChangeEditorTarget={setPresetEditorTarget}
					/>
				);
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
						onOpenDenylist={() => setCenterDenylist(true)}
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
						onTab={(t) => {
							restoreSidebarFromStudio();
							if (t !== "card") setCardLoreOpen(false);
							setRolesTab(t);
						}}
						toast={pushToast}
						studioOpen={studioOpen}
						onOpenStudio={() => {
							setCardLoreOpen(false);
							openStudio();
						}}
						onBackFromStudio={restoreSidebarFromStudio}
						onCloseStudioPanel={() => openLeft(null)}
						onStudioApplied={() => apiGetCacheClear("/api/card")}
						active={leftPanel === "roles"}
						onEnterChat={() => {
							if (mobileRef.current) openLeft(null);
							dismissWelcome();
						}}
						onGoHome={() => {
							openLeft(null);
							showWelcome();
						}}
						onFrontChange={() => void refreshCardFront()}
						headerTabs={true}
						lorePickerOpen={cardLoreOpen}
						onToggleLorePicker={() => setCardLoreOpen((v) => !v)}
					/>
				);
			case "lorebook":
				return <LorebookPanel toast={pushToast} onOpenDetail={(entry, scopePath) => setCenterLoreDetail({ entry, scopePath })} />;
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
							pushToast("info", t("已附到待发送：{name}", { name: u.name }));
						}}
					/>
				);
			case "theme":
				return <ThemePanel toast={pushToast} />;
		}
	};

	const moreExpanded = navMoreOpen || (leftPanel != null && MORE_NAV_SECTIONS.includes(leftPanel as PanelId));

	/**
	 * 左侧栏（仿 WorkBuddy 上下分栏）：
	 * - 顶部：品牌 ＋「＋ 新建项目」＋ 功能板块导航（角色/连接/提示词/世界书/扩展/更多）
	 * - 下半区：常驻会话树（按「扮演模式 / 写作模式」切签）
	 * - 底栏：设置、关于、白天/黑夜切换
	 */
	const leftSidebar = () => (
		<aside
			className={`side side-left wb-sidebar ${sidebarOpen ? "" : "side-collapsed"}`}
			aria-hidden={!sidebarOpen}
		>
			<div className="wb-side-head">
				<button
					type="button"
					className="wb-brand-btn"
					title={t("欢迎页")}
					aria-label={t("打开欢迎页")}
					onClick={() => {
						setCenterChatAsset(null);
						setLeftPanel(null);
						if (welcome) listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
						else showWelcome();
						if (mobileRef.current) setSidebarOpen(false);
					}}
				>
					<BrandLogo className="brand-logo" size={24} />
					<span className="wb-brand-title">{t("梨园")}</span>
				</button>
			</div>

			<nav className="wb-nav" aria-label={t("板块")}>
				{PRIMARY_NAV_SECTIONS.map((sid) => {
					const Ic = PANEL_ICON[sid];
					const active = leftPanel === sid;
					return (
						<button
							key={sid}
							type="button"
							className={`wb-nav-item ${active ? "active" : ""}`}
							onClick={() => openLeft(active ? null : sid)}
							aria-current={active}
						>
							<Ic size={16} />
							<span>{panelLabel(sid)}</span>
						</button>
					);
				})}

				<button
					type="button"
					className={`wb-nav-item wb-nav-more-btn ${moreExpanded ? "expanded" : ""}`}
					onClick={() => setNavMoreOpen((v) => !v)}
					aria-expanded={moreExpanded}
				>
					<IconMore size={16} />
					<span>{t("更多")}</span>
					<IconChevronDown size={14} className="wb-nav-more-caret" />
				</button>

				{moreExpanded &&
					MORE_NAV_SECTIONS.map((sid) => {
						const Ic = PANEL_ICON[sid];
						const active = leftPanel === sid;
						return (
							<button
								key={sid}
								type="button"
								className={`wb-nav-item wb-nav-item-sub ${active ? "active" : ""}`}
								onClick={() => openLeft(active ? null : sid)}
								aria-current={active}
							>
								<Ic size={16} />
								<span>{panelLabel(sid)}</span>
							</button>
						);
					})}
			</nav>

			<div className="wb-sessions">
				<SessionsPanel
					compactSidebar
					sessions={sessions}
					chats={chats}
					stats={stats}
					atHome={welcome && !leftPanel}
					activeAsset={centerChatAsset}
					assetTick={chatAssetTick}
					onOpenAsset={(asset) => {
						setCenterChatAsset(asset);
						if (asset) {
							setLeftPanel(null);
						}
					}}
					onOpen={(path) => {
						const isCur = sessions?.some((s) => s.current && s.path === path);
						if (leftPanel) {
							setLeftPanel(null);
							if (mobileRef.current) setSidebarOpen(false);
							if (!isCur) ws.send({ type: "open", path });
							dismissWelcome();
							return;
						}
						if (mobileRef.current) setSidebarOpen(false);
						if (isCur) {
							if (welcome) dismissWelcome();
							else showWelcome();
							return;
						}
						ws.send({ type: "open", path });
						dismissWelcome();
					}}
					onNew={(name, mode, greeting) => {
						setLeftPanel(null);
						if (mobileRef.current) setSidebarOpen(false);
						ws.send({ type: "new", ...(name ? { name } : {}), ...(mode ? { mode } : {}), ...(greeting !== undefined ? { greeting } : {}) });
						dismissWelcome();
					}}
					onNewInChat={(chatId) => {
						setLeftPanel(null);
						if (mobileRef.current) setSidebarOpen(false);
						ws.send({ type: "chat_new_session", chatId });
						dismissWelcome();
					}}
					onCompact={() => ws.send({ type: "compact" })}
					onWorldline={() => {
						setLeftPanel(null);
						toggleRight("worldline");
					}}
					onStore={openStoreModal}
					onRefresh={() => {
						ws.send({ type: "sessions" });
					}}
					toast={pushToast}
				/>
			</div>

			<div className="wb-side-foot">
				<div className="wb-foot-left">
					<button
						type="button"
						className={`wb-foot-btn ${leftPanel === "settings" ? "active" : ""}`}
						onClick={() => openLeft(leftPanel === "settings" ? null : "settings")}
						aria-current={leftPanel === "settings"}
						title={t("设置")}
					>
						<IconSettings size={15} />
						<span>{t("设置")}</span>
					</button>
					<button
						type="button"
						className={`wb-foot-btn ${leftPanel === "about" ? "active" : ""}`}
						onClick={() => openLeft(leftPanel === "about" ? null : "about")}
						aria-current={leftPanel === "about"}
						title={t("关于")}
					>
						<IconInfo size={15} />
						<span>{t("关于")}</span>
					</button>
				</div>
				<button
					type="button"
					className="wb-foot-icon"
					onClick={() => {
						const curDark = getTheme() === "dark";
						const next = curDark ? "light" : "dark";
						setTheme(next);
						setDark(next === "dark");
						pushToast("info", next === "dark" ? t("已切换到黑夜模式") : t("已切换到白昼模式"));
					}}
					aria-label={dark ? t("切换到白天") : t("切换到黑夜")}
					aria-pressed={dark}
					title={dark ? t("白天") : t("黑夜")}
				>
					{dark ? <IconSun size={16} /> : <IconMoon size={16} />}
				</button>
			</div>
		</aside>
	);

	/**
	 * 右侧主工作区的全宽板块视图（当左栏选中某个板块时铺满主工作区；保活 leftKeep 不卸载）
	 */
	const workspaceSectionView = () => {
		const id = leftPanel;
		const ids: Array<PanelId | AgentPanelId> = id
			? leftKeep.includes(id)
				? leftKeep
				: [id, ...leftKeep.filter((x) => x !== id)].slice(0, 5)
			: leftKeep;
		if (ids.length === 0) return null;

		const open = id != null;
		const headId = id ?? ids[0];
		const agent = headId.startsWith("agent:") ? agentPanels.find((p) => agentId(p.name) === headId) : undefined;
		if (headId.startsWith("agent:") && !agent && open) return null;
		const HeadIcon = agent ? IconDock : PANEL_ICON[headId as PanelId];
		const refreshable = !agent;
		const doRefresh = () => {
			if (id && !id.startsWith("agent:")) apiGetCacheClearForPanel(id);
			setManualTick((t) => ({ ...t, left: t.left + 1 }));
		};

		return (
			<section
				className={`workspace-section ${open ? "" : "workspace-section-hidden"}`}
				hidden={!open}
				aria-hidden={!open}
			>
				{open && !(headId === "roles" && studioOpen) && (
					<div className="panel-head workspace-section-head">
						{headId === "roles" ? (
							<div className="panel-head-tabs" role="group" aria-label={t("角色视图")}>
								<button
									type="button"
									className={`panel-head-tab ${rolesTab === "card" ? "active" : ""}`}
									onClick={() => setRolesTab("card")}
								>
									{t("角色卡库")}
								</button>
								<button
									type="button"
									className={`panel-head-tab ${rolesTab === "persona" ? "active" : ""}`}
									onClick={() => {
										setCardLoreOpen(false);
										setRolesTab("persona");
									}}
								>
									{t("用户角色")}
								</button>
							</div>
						) : (
							<span className="panel-head-title">
								<HeadIcon size={16} />
								{agent ? agent.name : panelLabel(headId)}
							</span>
						)}
						<span className="panel-head-actions">
							{refreshable && (
								<button className="icon-btn" onClick={doRefresh} title={t("刷新")} aria-label={t("刷新面板")}>
									<IconRefresh size={15} />
								</button>
							)}
							<button
								className="icon-btn"
								onClick={() => {
									setCenterLoreDetail(null);
									setCenterDenylist(false);
									openLeft(null);
								}}
								title={t("返回对话")}
								aria-label={t("返回对话")}
							>
								<IconClose size={16} />
							</button>
						</span>
					</div>
				)}
				<div className="workspace-section-body">
					{ids.map((pid) => {
						const isAgent = pid.startsWith("agent:");
						const ag = isAgent ? agentPanels.find((p) => agentId(p.name) === pid) : undefined;
						if (isAgent && !ag) return null;
						const visible = open && pid === id;
						const bodyKey = visible && id ? `${pid}-${manualTick.left}` : pid;
						return (
							<div
								key={pid}
								className="side-panel-keep workspace-section-keep"
								hidden={!visible}
								aria-hidden={!visible}
								style={visible ? { flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" } : { display: "none" }}
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
									<Fragment key={bodyKey}>{renderPanel(pid as PanelId)}</Fragment>
								)}
							</div>
						);
					})}
					{open && centerLoreDetail && !mobileRef.current && (
						<LoreDetailCenter
							entry={centerLoreDetail.entry}
							scopePath={centerLoreDetail.scopePath}
							onClose={() => setCenterLoreDetail(null)}
							toast={pushToast}
						/>
					)}
					{open && centerDenylist && (
						<BashDenylistCenter
							onClose={() => setCenterDenylist(false)}
							toast={pushToast}
						/>
					)}
				</div>
			</section>
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
		if (id === "sessions") {
			setSidebarOpen(true);
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
	/** agent 子项目的分栏：主页时让位 */
	const agentSplit = conversationMode === "agent" && !welcome;

	// 手机：两页横滑切换。
	// 双轨保障：原生 scroll-snap 滚动 + 触摸滑移手势识别。
	// 用户手指按住拖动期间绝不执行任何自动吸附回滚；抬手时水平位移主导即顺畅切页。
	const storyTabRef = useRef(storyTab);
	storyTabRef.current = storyTab;
	const pendingLeftRef = useRef<number | null>(null);
	const touchingRef = useRef(false);
	useEffect(() => {
		const el = pagesRef.current;
		if (!agentSplit || !el || !mobileRef.current) return;
		const left = storyTab === "story" ? 0 : el.clientWidth;
		if (Math.abs(el.scrollLeft - left) > 1) {
			pendingLeftRef.current = left;
			el.scrollTo({ left, behavior: "smooth" });
		}
	}, [agentSplit, storyTab]);
	useEffect(() => {
		const el = pagesRef.current;
		if (!agentSplit || !el) return;
		if (mobileRef.current) el.scrollLeft = storyTabRef.current === "story" ? 0 : el.clientWidth;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let startX = 0;
		let startY = 0;

		const settle = () => {
			if (!mobileRef.current || el.clientWidth === 0 || touchingRef.current) return;
			const pending = pendingLeftRef.current;
			if (pending !== null) {
				if (Math.abs(el.scrollLeft - pending) > 1) { el.scrollTo({ left: pending, behavior: "smooth" }); return; }
				pendingLeftRef.current = null;
			}
			const page = el.scrollLeft / el.clientWidth < 0.5 ? "story" : "chat";
			if (page !== storyTabRef.current) setStoryTab(page);
			else {
				const left = page === "story" ? 0 : el.clientWidth;
				if (Math.abs(el.scrollLeft - left) > 1) el.scrollTo({ left, behavior: "smooth" });
			}
		};
		const onScroll = () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(settle, 100);
		};
		const onTouchStart = (e: TouchEvent) => {
			touchingRef.current = true;
			pendingLeftRef.current = null;
			const t0 = e.touches[0];
			if (t0) { startX = t0.clientX; startY = t0.clientY; }
		};
		const onTouchEnd = (e: TouchEvent) => {
			touchingRef.current = false;
			const t0 = e.changedTouches[0];
			if (t0 && mobileRef.current) {
				const dx = t0.clientX - startX;
				const dy = t0.clientY - startY;
				if (Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy) * 1.2) {
					if (dx > 0 && storyTabRef.current === "chat") {
						setStoryTab("story");
						return;
					}
					if (dx < 0 && storyTabRef.current === "story") {
						setStoryTab("chat");
						return;
					}
				}
			}
			if (timer) clearTimeout(timer);
			timer = setTimeout(settle, 60);
		};
		const onTouchCancel = () => {
			touchingRef.current = false;
			if (timer) clearTimeout(timer);
			timer = setTimeout(settle, 60);
		};

		el.addEventListener("scroll", onScroll, { passive: true });
		el.addEventListener("touchstart", onTouchStart, { passive: true });
		el.addEventListener("touchend", onTouchEnd, { passive: true });
		el.addEventListener("touchcancel", onTouchCancel, { passive: true });
		return () => {
			if (timer) clearTimeout(timer);
			el.removeEventListener("scroll", onScroll);
			el.removeEventListener("touchstart", onTouchStart);
			el.removeEventListener("touchend", onTouchEnd);
			el.removeEventListener("touchcancel", onTouchCancel);
		};
	}, [agentSplit]);
	useEffect(() => {
		try { localStorage.setItem("liyuan.storyFrac", String(storyFrac)); } catch { /* 隐私模式等 */ }
	}, [storyFrac]);
	useEffect(() => {
		try { localStorage.setItem("liyuan.agentChatCollapsed", chatCollapsed ? "1" : "0"); } catch { /* 同上 */ }
	}, [chatCollapsed]);
	// agent 模式手机：面板盖稿子页时底部停在输入栏之上，高度随输入栏（多行、键盘）实测
	useEffect(() => {
		if (!agentSplit) return;
		const el = document.querySelector<HTMLElement>(".center-agent-split .composer");
		if (!el) return;
		const sync = () => document.documentElement.style.setProperty("--agent-composer-h", `${Math.round(el.getBoundingClientRect().height)}px`);
		sync();
		const ro = new ResizeObserver(sync);
		ro.observe(el);
		return () => ro.disconnect();
	}, [agentSplit]);
	/** 桌面分隔条：按住拖动改稿子占比；双击回到 60%。拖动期间给容器挂 dragging，让卡皮肤 iframe 不吃指针 */
	const onSplitterDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
		const box = pagesRef.current?.parentElement ?? pagesRef.current;
		if (!box) return;
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		storyDragRef.current = true;
		box.classList.add("agent-pages-dragging");
		pagesRef.current?.classList.add("agent-pages-dragging");
		const rect = box.getBoundingClientRect();
		const move = (ev: PointerEvent) => {
			if (!storyDragRef.current || rect.width === 0) return;
			setStoryFrac(Math.min(0.78, Math.max(0.28, (ev.clientX - rect.left) / rect.width)));
		};
		const up = () => {
			storyDragRef.current = false;
			box.classList.remove("agent-pages-dragging");
			pagesRef.current?.classList.remove("agent-pages-dragging");
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", up);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", up);
	}, []);

	const middleOpen = Boolean(leftPanel || centerChatAsset);
	const showCardLoreSub = leftPanel === "roles" && rolesTab === "card" && !studioOpen && cardLoreOpen;
	const showConnectSub = leftPanel === "connect" && connectEditorTarget !== null;
	const showPresetSub = leftPanel === "preset" && presetEditorTarget !== null;
	const middleSubOpen = showCardLoreSub || showConnectSub || showPresetSub;
	const middleWide = Boolean(
		centerChatAsset ||
		(leftPanel === "roles" && studioOpen) ||
		centerLoreDetail ||
		centerDenylist ||
		leftPanel?.startsWith("agent:"),
	);

	return (
		<PanelRefreshContext.Provider value={agentTick}>
		<div className="app">
			{wallpaper && (
				<div
					className="app-wallpaper-layer"
					aria-hidden="true"
					style={{
						backgroundImage: `url("${wallpaper.url}")`,
						opacity: wallpaper.opacity,
						filter: wallpaper.blur > 0 ? `blur(${wallpaper.blur}px)` : "none",
					}}
				/>
			)}
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
					onDone={(name, mode, greeting) => {
						setNamingProject(false);
						if (name) {
							ws.send({ type: "new", name, ...(mode ? { mode } : {}), ...(greeting !== undefined ? { greeting } : {}) });
							dismissWelcome();
						}
					}}
				/>
			)}

			{/* 左侧栏：上下分栏（上板块导航、下会话树），在桌面为平级满高分栏；移动端为半屏浮层抽屉 */}
			{sidebarOpen && (
				<div
					className="wb-mobile-sidebar-backdrop"
					onClick={() => setSidebarOpen(false)}
				/>
			)}
			{leftSidebar()}

			<div className="workspace">
				<header className="topbar">
				{/* 左两键：开合左栏 + 新建 */}
				<div className="tb-side tb-side-left">
						<button
							type="button"
							className={`tb-btn ${sidebarOpen ? "active" : ""}`}
							onClick={toggleDrawer}
							aria-label={t("侧栏")}
							aria-expanded={sidebarOpen}
							data-tip={t("侧栏")}
							title={t("收起 / 展开侧栏")}
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
									aria-label={t("新建")}
									aria-expanded={newMenuOpen}
									data-tip={t("新建")}
									title={t("新建项目 / 新建对话")}
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
												{t("新建项目")}
												<span className="tb-new-item-sub">{t("新的一层，起名后建")}</span>
											</button>
											<button
												type="button"
												role="menuitem"
												className="tb-new-item"
												onClick={() => {
													setNewMenuOpen(false);
													setLeftPanel(null);
													// 当前项目里再开一个＝chat_new_session（项目行「＋」同通道）；
													// 裸 new 在两层布局下是新建项目，别用。
													const currentChatId = sessions?.find((s) => s.current)?.chatId;
													if (currentChatId) ws.send({ type: "chat_new_session", chatId: currentChatId });
													else ws.send({ type: "new" });
													dismissWelcome();
												}}
											>
												{t("新建对话")}
												<span className="tb-new-item-sub">{t("在当前项目里再开一个")}</span>
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
									setLeftPanel(null);
									ws.send({ type: "new" });
									dismissWelcome();
								}}
								disabled={conn !== "open"}
								aria-label={t("新建对话")}
								data-tip={t("新建")}
								title={t("新建对话")}
							>
								<IconNewChat size={18} />
							</button>
						)}
					</div>
				{/*
				  * 中：会话名 + 一行状态。
				  */}
				<div className="tb-title">
					<span className="tb-title-main" title={currentSession?.name ? `${charName || t("新对话")} · ${currentSession.name}` : (charName || t("新对话"))}>
						{charName || t("新对话")}
					</span>
					<span className="tb-title-sub">
						{conversationMode === "agent" ? (
							<button type="button" className="tb-sub-mode tb-sub-mode-agent" title={t("写作模式：正文是独立章节文件，这里的对话是讨论；手机上点它看正文")} onClick={() => { setLeftPanel(null); setStoryTab("story"); }}>
								{t("写作模式")}<span className="tb-sub-mode-agent-story">{storyOutline?.length ? t("· 正文 {n} 章", { n: storyOutline.length }) : t("· 正文")}</span>
							</button>
						) : (
							<span className="tb-sub-mode-tag">{t("扮演模式")}</span>
						)}
						{(!coarse || busy || conn !== "open") && (
							<>
								<span className="tb-sub-sep" aria-hidden="true">
									·
								</span>
								<span className={`tb-sub-state tb-sub-state-${conn === "open" ? (busy ? "busy" : "idle") : conn}`}>
									{conn === "open" ? (busy ? t("生成中") : t("空闲")) : conn === "connecting" ? t("连接中") : t("已断开")}
								</span>
							</>
						)}
						{warnings.length > 0 && (
							<button
								type="button"
								className={`tb-warn ${bellOpen ? "active" : ""}`}
								onClick={() => setBellOpen((v) => !v)}
								aria-label={t("告警 {n} 条", { n: warnings.length })}
								title={t("告警 {n} 条", { n: warnings.length })}
							>
								<IconBell size={13} />
								{warnings.length > 9 ? "9+" : warnings.length}
							</button>
						)}
					</span>
					{bellOpen && (
						<div className="bell-pop">
							{warnings.length === 0 && <div className="sp-empty">{t("暂无告警（旁侧审计的警告会留在这里）")}</div>}
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
									{t("清空")}
								</button>
							)}
						</div>
					)}
				</div>
				{/* 右侧：当前用户角色（Persona）快速选择气泡 */}
				<div className="tb-side tb-side-right">
					<div className="tb-persona-wrap">
						<button
							type="button"
							className={`tb-persona-btn ${personaMenuOpen ? "active" : ""}`}
							onClick={() => {
								const next = !personaMenuOpen;
								setPersonaMenuOpen(next);
								if (next) {
									apiGetCacheClear("/api/personas");
									void apiGet<PersonasResponse>("/api/personas")
										.then((pr) => setPersonaStore(pr))
										.catch(() => {});
								}
							}}
							aria-expanded={personaMenuOpen}
							aria-label={userName ? t("用户角色：{name}", { name: userName }) : t("用户角色")}
							title={userName ? t("用户角色：{name}（点击查看或切换）", { name: userName }) : t("用户角色（点击查看或切换）")}
						>
							{userAvatarUrl ? (
								<img className="tb-persona-avatar" src={userAvatarUrl} alt="" />
							) : (
								<span className="tb-persona-fallback" aria-hidden="true">
									<IconPersona size={15} />
								</span>
							)}
							{userName && <span className="tb-persona-name">{userName}</span>}
						</button>
						{personaMenuOpen && (
							<>
								<div className="tb-new-backdrop" onClick={() => setPersonaMenuOpen(false)} />
								<div className="tb-persona-pop" role="menu" aria-label={t("切换用户角色")}>
									<div className="tb-persona-pop-head">
										<span>{t("切换用户角色")}</span>
									</div>
									<div className="tb-persona-pop-list">
										{(personaStore?.personas ?? []).length === 0 ? (
											<div className="tb-persona-pop-empty">{t("暂无用户角色")}</div>
										) : (
											(personaStore?.personas ?? []).map((p) => {
												const isActive = p.id === personaStore?.activeId;
												const isDefault = p.id === personaStore?.current;
												const isLocked = p.id === personaStore?.lockedForCard;
												return (
													<button
														key={p.id}
														type="button"
														role="menuitemradio"
														aria-checked={isActive}
														disabled={personaSwitching}
														className={`tb-persona-pop-item ${isActive ? "on" : ""}`}
														onClick={() => {
															setPersonaSwitching(true);
															setUserName(p.name);
															setUserAvatarUrl(p.avatar ? personaAvatarUrl(p.id) : null);
															setPersonaMenuOpen(false);
															void apiPost("/api/personas/select", { id: p.id })
																.then(async () => {
																	apiGetCacheClear("/api/personas");
																	const pr = await apiGet<PersonasResponse>("/api/personas");
																	setPersonaStore(pr);
																	bumpWatchPanels();
																})
																.catch((err) => {
																	pushToast("error", err instanceof Error ? err.message : String(err));
																})
																.finally(() => setPersonaSwitching(false));
														}}
													>
														{p.avatar ? (
															<img className="tb-persona-pop-avatar" src={personaAvatarUrl(p.id)} alt="" />
														) : (
															<span className="tb-persona-pop-seal" aria-hidden="true">
																{(p.name || "？").slice(0, 1)}
															</span>
														)}
														<span className="tb-persona-pop-info">
															<span className="tb-persona-pop-row">
																<span className="tb-persona-pop-name">{p.name}</span>
																{isLocked && <span className="tb-persona-pop-tag locked">{t("本卡锁定")}</span>}
																{isDefault && !isLocked && <span className="tb-persona-pop-tag">{t("默认")}</span>}
															</span>
															{p.persona && (
																<span className="tb-persona-pop-desc">
																	{p.persona.replace(/\s+/g, " ").trim()}
																</span>
															)}
														</span>
														{isActive && <span className="tb-persona-pop-check">✓</span>}
													</button>
												);
											})
										)}
									</div>
									<div className="tb-persona-pop-foot">
										<button
											type="button"
											className="tb-persona-pop-manage"
											onClick={() => {
												setPersonaMenuOpen(false);
												setRolesTab("persona");
												openLeft("roles");
											}}
										>
											{t("管理用户角色…")}
										</button>
									</div>
								</div>
							</>
						)}
					</div>
				</div>
			</header>

				<div
					className={`layout ${sidebarOpen ? "layout-sidebar-open" : ""} ${middleOpen ? "layout-middle-open" : ""} ${agentSplit ? "layout-agent-split" : ""} ${agentSplit && chatCollapsed ? "layout-chat-collapsed" : ""}`}
					style={{ "--story-frac": storyFrac } as React.CSSProperties}
				>
					<div
						className={`workspace-middle-slot ${middleOpen ? "workspace-middle-slot-open" : "workspace-middle-slot-hidden"} ${middleWide ? "workspace-middle-slot-wide" : "workspace-middle-slot-compact"} ${middleSubOpen ? "workspace-middle-slot-subopen" : ""} ${showConnectSub || showPresetSub ? "workspace-middle-slot-subwide" : ""}`}
						hidden={!middleOpen}
						aria-hidden={!middleOpen}
					>
						{workspaceSectionView()}
						{showCardLoreSub && (
							<CardLorePicker
								toast={pushToast}
								onClose={() => setCardLoreOpen(false)}
							/>
						)}
						{showConnectSub && connectEditorTarget && (
							<ConnectEditorPane
								target={connectEditorTarget}
								onClose={() => setConnectEditorTarget(null)}
								toast={pushToast}
							/>
						)}
						{showPresetSub && presetEditorTarget && (
							<PresetEditorPane
								target={presetEditorTarget}
								onChangeTarget={setPresetEditorTarget}
								onClose={() => setPresetEditorTarget(null)}
								toast={pushToast}
							/>
						)}
						{centerChatAsset && (
							<ChatAssetCenter
								asset={centerChatAsset}
								onClose={() => setCenterChatAsset(null)}
								onChanged={() => setChatAssetTick((n) => n + 1)}
								onSelectAsset={(relPath) =>
									setCenterChatAsset((prev) => (prev ? { ...prev, relPath } : null))
								}
								toast={pushToast}
							/>
						)}
					</div>
					{middleOpen && middleWide && !agentSplit && (
						<div
							className="agent-splitter middle-splitter"
							role="separator"
							aria-orientation="vertical"
							aria-label={t("拖动调整正文与讨论的比例")}
							title={t("拖动调整比例，双击恢复默认")}
							onPointerDown={onSplitterDown}
							onDoubleClick={() => setStoryFrac(0.6)}
						/>
					)}
					{/* 写作模式：稿子在左、讨论在右。桌面是可拖比例的分栏（讨论可收起）；手机是横滑的两页（scroll-snap） */}
					<div
						ref={pagesRef}
						className={`agent-pages ${agentSplit ? "agent-pages-on" : ""} ${agentSplit && chatCollapsed ? "agent-pages-chat-collapsed" : ""}`}
						style={agentSplit ? ({ "--story-frac": storyFrac } as React.CSSProperties) : undefined}
					>
					{agentSplit && (
						<aside className={`story-pane ${storyTab === "story" ? "story-pane-active" : ""}`} aria-label={t("正文")}>
							<StoryPane
								files={storyFiles}
								checkpoints={storyCheckpoints}
								skin={cardSkin}
								focus={storyFocus}
								busy={busy}
								onBack={() => setStoryTab("chat")}
								chatCollapsed={chatCollapsed}
								onToggleChat={() => setChatCollapsed((v) => !v)}
								onEdit={async (f, text) => {
									try {
										await apiPost("/api/story/edit", { name: f.name, text });
									} catch (e) {
										pushToast("error", t("保存失败：{err}", { err: e instanceof Error ? e.message : String(e) }));
										throw e;
									}
								}}
								loadDiff={loadStoryDiff}
								onRestore={(cp, scope) => {
									const q = scope === "both"
										? t("文件和对话一起回到「{msg}」这轮输入之前？之后的讨论会从当前会话里截掉。", { msg: cp.message })
										: t("把正文恢复到「{msg}」之后的样子？讨论不变，恢复本身也会记成一条检查点。", { msg: cp.message });
									if (window.confirm(q)) ws.send({ type: "story_restore", checkpointId: cp.id, scope });
								}}
							/>
						</aside>
					)}
					{agentSplit && (
						<div
							className="agent-splitter"
							role="separator"
							aria-orientation="vertical"
							aria-label={t("拖动调整正文与讨论的比例")}
							title={t("拖动调整比例，双击恢复默认")}
							onPointerDown={onSplitterDown}
							onDoubleClick={() => setStoryFrac(0.6)}
						/>
					)}
					<main className={`center ${welcome && sessions !== null && !homeHasHistory ? "center-home-empty" : ""} ${welcome && homeHasHistory ? "center-home-filled" : ""} ${middleOpen && !agentSplit ? "center-middle-split" : ""} ${agentSplit ? "center-agent-split" : ""}`}>
					<div className={`stage-wrap ${rightPanel ? "split-active" : ""} ${agentSplit && rightPanel ? "agent-panel-cover" : ""}`}>
					<div className="stage-col stage-col-left">
						{(rightPanel || agentSplit || middleOpen) && (
							<div className="stage-col-head">
								<span className="stage-col-title">
									<IconCard size={14} />
									<span>{agentSplit ? t("讨论") : t("剧情推演")}</span>
								</span>
								{agentSplit && (
									<button type="button" className="story-tab-btn" onClick={() => setStoryTab("story")}>
										{storyOutline?.length ? t("正文（{n} 章）", { n: storyOutline.length }) : t("正文")}
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
										setSidebarOpen(true);
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
												<span className="empty-title">{t("梨园")}</span>
											</div>
											<div className="empty-hint">
													{conn === "open"
														? (agentSplit && mobileRef.current ? (
															<button
																type="button"
																className="empty-hint-action"
																onClick={() => setStoryTab("story")}
																title={t("右划进入正文页面")}
															>
																{t("右划进入正文页面")} ›
															</button>
														) : t("新的会话，开始对话吧。"))
														: t("连接后台中…")}
												</div>
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
												fallbackName={b.msg.channel === "user" ? userName || t("你") : charName}
												avatarUrl={b.msg.channel === "user" ? userAvatarUrl : charAvatarUrl}
												skin={cardSkin}
												onChapter={agentSplit || conversationMode === "agent" ? (checkpointId) => { setStoryFocus({ checkpointId, tick: Date.now() }); setStoryTab("story"); } : undefined}
												onReroll={
													!busy && !msgEdit
														? b.msg.channel === "narrative" && b.idx === lastNarrativeIdx
															? () => { if (sendNotes()) ws.send({ type: "swipe", dir: "new" }); }
															: isAgentMode && b.msg.channel === "authoring" && b.idx === lastNarrativeIdx
																? () => { ws.send({ type: "reroll" }); }
																: undefined
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
													!busy && !msgEdit
														? isAgentMode
															? b.idx === lastNarrativeIdx || b.idx === lastUserIdx
																? rewindAgentTurn
																: undefined
															: b.msg.channel === "user" && !b.msg.backstage && storyUserIdxs.includes(b.idx)
																? () => rewindToUser(b.idx)
																: undefined
														: undefined
												}
												onDelete={
													!busy && !msgEdit
														? isAgentMode
															? b.idx === lastNarrativeIdx
																? dropLastReply
																: b.idx === lastUserIdx
																	? deleteLastUserTurn
																	: undefined
															: b.msg.channel === "user" && b.idx === lastUserIdx
																? deleteLastUserTurn
																: b.msg.channel === "narrative" && b.idx === lastNarrativeIdx
																	? dropLastReply
																	: undefined
														: undefined
												}
												onCopy={
													b.msg.channel === "narrative" || b.msg.channel === "greeting" || b.msg.channel === "user" || b.msg.channel === "authoring"
														? doCopy
														: undefined
												}
												onStore={
													!busy && !msgEdit
														? isAgentMode
															? b.idx === lastNarrativeIdx || b.idx === lastUserIdx
																? () => saveAgentCheckpoint()
																: undefined
															: (b.msg.channel === "narrative" || b.msg.channel === "greeting") &&
															  (b.idx === lastNarrativeIdx || (greetingOnly && b.msg.channel === "greeting"))
																? openStoreModal
																: undefined
														: undefined
												}
												onTts={
													!busy &&
													!msgEdit &&
													!isAgentMode &&
													(b.msg.channel === "narrative" || b.msg.channel === "greeting")
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
																		? t("按修改后的输入重新生成")
																		: t("采用改写（或未改时重新生成）"),
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
										<span className="msg-name msg-name-char">{streamMode === "authoring" ? t("工作") : streamMode === "agent" ? t("写作") : charName}</span>
										<span className="msg-live-tag">{t("生成中")}</span>
									</div>
									{liveSegs.length > 0 ? (
										<TurnTimeline segments={liveSegs} skin={streamMode !== "roleplay" ? null : liveSkin} plain={streamMode !== "roleplay"} live />
									) : (
										<div className="info-line pulse" style={{ margin: "0.4rem 0 0" }}>
											{`${streamMode === "authoring" ? t("工作") : streamMode === "agent" ? t("写作") : charName} ${thinkingLive ? t("正在思考…") : t("工作中…")}`}
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
						<button className="jump-bottom" onClick={jumpToBottom} title={t("回到最新")} aria-label={t("回到最新")}>
							<IconChevronDown size={17} />
						</button>
					)}
					</div>
					{rightPanel && (() => {
						const pane = (
							<aside className="stage-col stage-col-right" aria-label={panelLabel(rightPanel) || t("状态栏")}>
								<div className="stage-col-head">
									<span className="stage-col-title">
										{(() => {
											const isAg = rightPanel.startsWith("agent:");
											const ag = isAg ? agentPanels.find((p) => agentId(p.name) === rightPanel) : undefined;
											const Icon = ag ? IconDock : PANEL_ICON[rightPanel as PanelId] || IconStatus;
											return (
												<>
													<Icon size={14} />
													<span>{ag ? ag.name : panelLabel(rightPanel) || t("状态栏")}</span>
												</>
											);
										})()}
									</span>
									<button
										type="button"
										className="icon-btn"
										onClick={() => openRight(null)}
										title={t("收起")}
										aria-label={t("收起状态栏")}
									>
										<IconClose size={15} />
									</button>
								</div>
								<div className="stage-col-body">
									{(() => {
										/* agent 自建面板：renderPanel 的 switch 只认内置 PanelId，掉进去返回 undefined＝空白列（2026-10-26 实测）。
										   照 sidePanel() 的 agent 分支用 ArtifactPanel 渲染，数据与保存回调同一套。 */
										if (rightPanel.startsWith("agent:")) {
											const ag = agentPanels.find((p) => agentId(p.name) === rightPanel);
											if (!ag) return null;
											return (
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
											);
										}
										return renderPanel(rightPanel as PanelId);
									})()}
								</div>
							</aside>
						);
						// agent 模式：面板盖在中间的稿子栏上，不占讨论栏的位置
						const host = agentSplit ? pagesRef.current?.querySelector(".story-pane") : null;
						return host ? createPortal(pane, host) : pane;
					})()}
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
											title={t("不随消息发送（文件保留在上传区）")}
											aria-label={t("移除附件")}
											onClick={() => setPending((prev) => prev.filter((x) => x.file !== p.file))}
										>
											<IconClose size={12} />
										</button>
									</span>
								))}
								{uploading && <span className="attach-chip attach-uploading">{t("上传中…")}</span>}
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
							{/* 备注行（PLAN-DIRECTOR-NOTE）：点「备注」加一行；flex-wrap 下占满一行、排在输入行上方。
							   发送/重 roll/重抽时随行（先 /note 再动作），不进入剧情历史。 */}
							{conversationMode === "roleplay" && noteRows.length > 0 && (
								<div className="note-rows">
									{noteRows.map((row, i) => (
										<div className="note-row" key={i}>
											<IconPencil size={13} />
											<input
												className="note-input"
												value={row}
												placeholder={t("备注：只影响下一拍演出或重 roll，不进入剧情历史")}
												autoFocus={i === noteRows.length - 1}
												onChange={(e) => setNoteRows((rs) => rs.map((r, j) => (j === i ? e.target.value : r)))}
												onKeyDown={(e) => {
													if (!coarse && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
														e.preventDefault();
														send();
													}
												}}
											/>
											<button
												type="button"
												className="note-x"
												title={t("删除这条备注")}
												aria-label={t("删除这条备注")}
												onClick={() => setNoteRows((rs) => rs.filter((_, j) => j !== i))}
											>
												<IconClose size={12} />
											</button>
										</div>
									))}
								</div>
							)}
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
								placeholder={conn === "open" ? (conversationMode === "authoring" ? t("描述要做的事：改卡、写前端或脚本、整理文件…") : conversationMode === "agent" ? t("讨论剧情、下达写作指令；正文由 agent 写入文件…") : userName ? t("以「{name}」的身份发言…", { name: userName }) : t("输入消息…")) : t("等待连接…")}
								rows={2}
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
							<div className="composer-bar">
								{/* 手机端：左侧三钮收进「＋」，展开为输入框上方一行；桌面端 CSS 隐藏此钮、工具常驻 */}
								<button
									type="button"
									className={`dock-btn composer-more ${composerTools ? "active" : ""}`}
									title={t("更多工具")}
									aria-label={t("更多工具")}
									aria-expanded={composerTools}
									onClick={() => setComposerTools((v) => !v)}
								>
									<IconPlus size={18} />
								</button>
								{composerTools && (
										<div
											className="composer-tools-backdrop"
											onClick={() => setComposerTools(false)}
										/>
									)}
									<div className={`composer-tools ${composerTools ? "open" : ""}`}>
									{conversationMode === "agent" ? (
										<>
											<button
												type="button"
												className="dock-btn"
												title={t("为当前正文与讨论保存一个检查点快照")}
												aria-label={t("保存检查点")}
												onClick={() => {
													saveAgentCheckpoint();
													setComposerTools(false);
												}}
											>
												<IconPin size={18} />
												<span className="composer-tool-label">{t("存档")}</span>
											</button>
											<button
												type="button"
												className="dock-btn"
												title={t("文件和讨论一起回退到上一轮输入之前")}
												aria-label={t("回退本轮")}
												onClick={() => {
													rewindAgentTurn();
													setComposerTools(false);
												}}
											>
												<IconUndo size={18} />
												<span className="composer-tool-label">{t("回退")}</span>
											</button>
											<button
												type="button"
												className="dock-btn"
												title={t("上传图片/文件（也可拖入或粘贴）")}
												aria-label={t("上传图片或文件")}
												onClick={() => {
													uploadInputRef.current?.click();
													setComposerTools(false);
												}}
											>
												<IconAttach size={18} />
												<span className="composer-tool-label">{t("上传")}</span>
											</button>
										</>
									) : (
										<>
											<button
												type="button"
												className={`dock-btn ${rightPanel === "status" ? "active" : ""}`}
												title={t("状态栏")}
												aria-label={t("状态栏")}
												onClick={() => {
													toggleRight("status");
													setComposerTools(false);
												}}
											>
												<IconStatus size={18} />
												<span className="composer-tool-label">{t("状态栏")}</span>
											</button>
											<button
												type="button"
												className={`dock-btn ${rightPanel === "worldline" ? "active" : ""}`}
												title={t("世界线")}
												aria-label={t("世界线")}
												onClick={() => {
													toggleRight("worldline");
													setComposerTools(false);
												}}
											>
												<IconWorldline size={18} />
												<span className="composer-tool-label">{t("世界线")}</span>
											</button>
											<button
												type="button"
												className={`dock-btn ${rightPanel === "roster" ? "active" : ""}`}
												title={t("登场名录")}
												aria-label={t("登场名录")}
												onClick={() => {
													toggleRight("roster");
													setComposerTools(false);
												}}
											>
												<IconRoster size={18} />
												<span className="composer-tool-label">{t("名录")}</span>
											</button>
											<button
												type="button"
												className="dock-btn"
												title={t("加一行备注：只影响下一拍演出或重 roll，不进入剧情历史")}
												aria-label={t("加一行备注")}
												onClick={() => {
													setNoteRows((rs) => [...rs, ""]);
													setComposerTools(false);
												}}
											>
												<IconPencil size={18} />
												<span className="composer-tool-label">{t("备注")}</span>
											</button>
											<button
												type="button"
												className="dock-btn"
												title={t("上传图片/文件（也可拖入或粘贴）")}
												aria-label={t("上传图片或文件")}
												onClick={() => {
													uploadInputRef.current?.click();
													setComposerTools(false);
												}}
											>
												<IconAttach size={18} />
												<span className="composer-tool-label">{t("上传")}</span>
											</button>
										</>
									)}
								</div>
								<ComposerModelSwitch
									toast={pushToast}
									onOpenConnect={() => openLeft("connect")}
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
														? t("（正文未流出，见思维链）")
														: t("（已停止）"),
												...(thinking ? { thinking } : {}),
												...(acts.length ? { activities: acts } : {}),
												...(segs.length ? { segments: segs } : {}),
												unfinished: true,
											};
											setMessages((ms) => upsertTurnReply(ms, leftover));
											ws.send({ type: "abort" });
										}}
										title={t("停止")}
										aria-label={t("停止生成")}
									>
										<IconStop size={18} />
									</button>
								) : (
									<button
										className="btn btn-send"
										onClick={send}
										disabled={(!input.trim() && pending.length === 0) || conn !== "open"}
										title={t("发送")}
										aria-label={t("发送")}
									>
										<IconSend size={17} />
									</button>
								)}
							</div>
						</div>
						{/* 会话用量：输入框下方，右缘与输入框齐平 */}
						{!welcome && (
							<div className="composer-shell session-stats-wrap">
							<SessionStatsBar stats={stats} compacting={compacting} />
						</div>
						)}
					</footer>
				</main>
				</div>
				{agentSplit && chatCollapsed && (
					<button
						type="button"
						className="agent-chat-reopen"
						onClick={() => setChatCollapsed(false)}
						title={t("展开讨论")}
						aria-label={t("展开讨论")}
					>
						<IconChevronLeft size={15} />
						<span>{t("讨论")}</span>
					</button>
				)}
			</div>
			{/* 手机端底部四格导航栏（对话界面是主界面不占按钮；再次点击当前按钮或点 ✕ 自然回到对话） */}
			{mobileMoreOpen && (
				<>
					<div className="wb-mobile-more-backdrop" onClick={() => setMobileMoreOpen(false)} />
					<div className="wb-mobile-more-sheet" role="menu" aria-label={t("更多")}>
						{MOBILE_MORE_TABS.map((sid) => {
							const Ic = PANEL_ICON[sid];
							const active = leftPanel === sid && !sidebarOpen;
							return (
								<button
									key={sid}
									type="button"
									role="menuitem"
									className={`wb-mobile-more-item ${active ? "active" : ""}`}
									onClick={() => {
										setMobileMoreOpen(false);
										setSidebarOpen(false);
										openLeft(leftPanel === sid ? null : sid);
									}}
								>
									<span className="wb-mobile-more-item-icon">
										<Ic size={18} />
									</span>
									<span className="wb-mobile-more-item-label">{panelLabel(sid)}</span>
								</button>
							);
						})}
					</div>
				</>
			)}
			<nav className="wb-mobile-tabbar" aria-label={t("板块")}>
				{MOBILE_PRIMARY_TABS.map((sid) => {
					const Ic = PANEL_ICON[sid];
					const active = leftPanel === sid && !sidebarOpen;
					return (
						<button
							key={sid}
							type="button"
							className={`wb-mobile-tab ${active ? "active" : ""}`}
							aria-current={active}
							onClick={() => {
								setMobileMoreOpen(false);
								setSidebarOpen(false);
								openLeft(leftPanel === sid ? null : sid);
							}}
						>
							<span className="wb-mobile-tab-icon">
								<Ic size={19} />
							</span>
							<span className="wb-mobile-tab-label">{panelLabel(sid)}</span>
						</button>
					);
				})}
				{(() => {
					const activeMoreId =
						leftPanel != null && MOBILE_MORE_TABS.includes(leftPanel as PanelId)
							? (leftPanel as PanelId)
							: null;
					const ActiveMoreIcon = activeMoreId ? PANEL_ICON[activeMoreId] : IconMore;
					const moreActive = (activeMoreId !== null || mobileMoreOpen) && !sidebarOpen;
					return (
						<button
							type="button"
							className={`wb-mobile-tab ${moreActive ? "active" : ""}`}
							aria-expanded={mobileMoreOpen}
							onClick={() => {
								setSidebarOpen(false);
								if (activeMoreId) {
									openLeft(null);
									setMobileMoreOpen(false);
								} else {
									setMobileMoreOpen((v) => !v);
								}
							}}
						>
							<span className="wb-mobile-tab-icon">
								<ActiveMoreIcon size={19} />
							</span>
							<span className="wb-mobile-tab-label">
								{activeMoreId ? panelLabel(activeMoreId) : t("更多")}
							</span>
						</button>
					);
				})()}
			</nav>
			{/* 右下角副编剧 Bot 入口与伴随抽屉（仅扮演模式显示，写作模式无副编剧） */}
			{!agentSplit && botOpen && (
				<aside className="bot-drawer" aria-label={t("副编剧 Bot")}>
					<header className="bot-drawer-head">
						<div className="bot-drawer-title">
							<span className={`bot-drawer-dot ${botStreaming ? "live" : ""}`} />
							<IconBot size={16} />
							<span className="bot-drawer-name">{t("副编剧")}</span>
							<span className="bot-drawer-sub">
								{botStreaming ? t("思考中…") : t("幕后伴随 · 不进正史")}
							</span>
						</div>
						<div className="bot-drawer-actions">
							<button
								type="button"
								className={`bot-head-btn ${botSettingsOpen ? "active" : ""}`}
								onClick={() => void openBotSettings()}
								title={t("副编剧设置")}
							>
								<IconSettings size={13} />
								<span>{t("设置")}</span>
							</button>
							<button
								type="button"
								className="bot-head-close"
								onClick={() => {
									setBotOpen(false);
									setBotSettingsOpen(false);
								}}
								title={t("收起副编剧")}
								aria-label={t("收起副编剧")}
							>
								<IconClose size={15} />
							</button>
						</div>
					</header>

					<BotSessionControls snapshot={botSession} disabled={botStreaming || busy || conn !== "open"} send={request => ws.send({ type: "bot_manage", request })} />
					{botSettingsOpen ? (
						<div className="bot-settings-pane">
							<div className="bot-settings-body">
								<div className="bot-field">
									<div className="bot-field-head">
										<span className="bot-field-label">{t("性格生效范围")}</span>
										<div className="bot-seg-group">
											<button
												type="button"
												className={`bot-seg-btn ${botSettingsScope === "global" ? "active" : ""}`}
												onClick={() => setBotSettingsScope("global")}
											>
												{t("全局默认")}
											</button>
											<button
												type="button"
												className={`bot-seg-btn ${botSettingsScope === "card" ? "active" : ""}`}
												onClick={() => setBotSettingsScope("card")}
											>
												{t("仅当前角色卡")}
											</button>
										</div>
									</div>
								</div>

								<div className="bot-field">
									<span className="bot-field-label">{t("预设性格模板")}</span>
									<div className="bot-preset-chips">
										{botPresets.map((p) => {
											const curVal = (botSettingsScope === "card" ? botCardPersona : botGlobalPersona).trim();
											const isMatched = curVal === p.content.trim();
											return (
												<button
													key={p.id}
													type="button"
													className={`bot-preset-chip ${isMatched ? "active" : ""}`}
													title={p.tagline}
													onClick={() => {
														if (botSettingsScope === "card") setBotCardPersona(p.content);
														else setBotGlobalPersona(p.content);
													}}
												>
													{t(p.name)}
												</button>
											);
										})}
									</div>
								</div>

								<div className="bot-field">
									<span className="bot-field-label">{t("性格与说话口吻")}</span>
									<span className="bot-field-hint">
										{t("只需写它的性格、脾气与对你的称呼；纯聊天体规范与幕后工具纪律已内置生效。")}
									</span>
									<textarea
										className="bot-persona-textarea"
										rows={6}
										value={botSettingsScope === "card" ? botCardPersona : botGlobalPersona}
										placeholder={
											botSettingsScope === "card"
												? t("留空则跟随全局默认性格…")
												: t("描述副编剧的性格与说话风格…")
										}
										onChange={(e) => {
											if (botSettingsScope === "card") setBotCardPersona(e.target.value);
											else setBotGlobalPersona(e.target.value);
										}}
									/>
								</div>

								<div className="bot-field">
									<div className="bot-field-head">
										<span className="bot-field-label">{t("剧情视野范围")}</span>
										<div className="bot-seg-group">
											<button
												type="button"
												className={`bot-seg-btn ${botViewBeats === 0 ? "active" : ""}`}
												onClick={() => setBotViewBeats(0)}
											>
												{t("跟随主模型视角")}
											</button>
											<button
												type="button"
												className={`bot-seg-btn ${botViewBeats > 0 ? "active" : ""}`}
												onClick={() => setBotViewBeats(botViewBeats > 0 ? botViewBeats : 8)}
											>
												{t("指定最近拍数")}
											</button>
										</div>
									</div>
									<span className="bot-field-hint">
										{botViewBeats === 0
											? t("与台前主模型完全一致（携带前情提要、世界状态与当前未压缩的全部剧情）。")
											: t("仅自动携带最近 N 拍剧情以节省上下文，更早的剧情由副编剧按需调工具查阅。")}
									</span>
									{botViewBeats > 0 && (
										<div className="bot-beats-row">
											<span>{t("最近")}</span>
											<input
												type="number"
												className="bot-beats-input"
												min={1}
												max={50}
												value={botViewBeats}
												onChange={(e) => setBotViewBeats(Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 1))))}
											/>
											<span>{t("拍")}</span>
										</div>
									)}
								</div>
							</div>

							<footer className="bot-settings-foot">
								<button
									type="button"
									className="bot-head-btn"
									onClick={() => setBotSettingsOpen(false)}
								>
									{t("取消")}
								</button>
								<button
									type="button"
									className="bot-save-btn"
									disabled={botSavingSettings}
									onClick={() => void saveBotSettings()}
								>
									{botSavingSettings ? t("保存中…") : t("保存设置")}
								</button>
							</footer>
						</div>
					) : (
						<>
							<div ref={botScrollRef} className="bot-drawer-body">
								{botMessages.length === 0 && !botStreaming ? (
									<div className="bot-empty">
										<div className="bot-empty-title">{t("随时唤我聊戏、查设定、记笔记")}</div>
										<div className="bot-empty-desc">
											{t("我与台前主模型共享当前剧目视野，也能帮你读写世界书和项目记忆，所有对话完全独立、绝不污染台前正文。")}
										</div>
								<div className="bot-quick-grid">
									<button
										type="button"
										className="bot-quick-card"
										onClick={() => sendBot(t("点评一下刚才最新这一拍的节奏和人物反应，有什么出彩或生硬的地方？"))}
									>
										<span className="bot-quick-card-title">{t("锐评刚才这拍")}</span>
										<span className="bot-quick-card-sub">{t("看看节奏、人设与张力")}</span>
									</button>
									<button
										type="button"
										className="bot-quick-card"
										onClick={() => sendBot(t("结合当前剧情和世界状态，帮我推演接下来 2~3 个有意思的剧情走向。"))}
									>
										<span className="bot-quick-card-title">{t("推演后续走向")}</span>
										<span className="bot-quick-card-sub">{t("给几个不同方向的脑洞")}</span>
									</button>
									<button
										type="button"
										className="bot-quick-card"
										onClick={() => sendBot(t("看看最近几拍有没有新出现的设定、人物或地点值得写进世界书？帮我整理并写入。"))}
									>
										<span className="bot-quick-card-title">{t("提取新设定入世界书")}</span>
										<span className="bot-quick-card-sub">{t("沉淀设定供台前检索")}</span>
									</button>
									<button
										type="button"
										className="bot-quick-card"
										onClick={() => sendBot(t("帮我把目前的重要剧情进展和伏笔整理进本项目的记忆文档里。"))}
									>
										<span className="bot-quick-card-title">{t("整理本局记忆")}</span>
										<span className="bot-quick-card-sub">{t("写入项目 记忆/*.md")}</span>
									</button>
								</div>
							</div>
						) : (
							<div className="bot-msg-list">
								{botMessages.map((m, idx) => (
									<div
										key={`${m.ts ?? idx}-${idx}`}
										className={`bot-msg ${m.role === "user" ? "bot-msg-user" : "bot-msg-assistant"}`}
									>
										{m.role === "assistant" && m.tools && m.tools.length > 0 && (
											<div className="bot-tool-chips">
												{m.tools.map((tc, ti) => (
													<span
														key={ti}
														className={`bot-tool-chip ${tc.isError ? "err" : ""}`}
														title={tc.detail || tc.name}
													>
														<span className="bot-tool-chip-name">{toolLabel(tc.name)}</span>
														{tc.detail && <span className="bot-tool-chip-detail">{tc.detail}</span>}
													</span>
												))}
											</div>
										)}
										<div className="bot-msg-content artifact-md">
											{m.role === "assistant" ? renderMarkdown(m.text) : m.text}
										</div>
										{m.role === "assistant" && (
											<div className="bot-msg-foot">
												<button
													type="button"
													className="bot-note-btn"
													onClick={() => applyBotToNote(m.text)}
													title={t("将这条建议填入台前输入框的「备注」栏，指导下一拍演出")}
												>
													<IconPencil size={11} />
													<span>{t("填入备注")}</span>
												</button>
											</div>
										)}
									</div>
								))}
								{botStreaming && (
									<div className="bot-msg bot-msg-assistant bot-msg-live">
										{botLiveTools.length > 0 && (
											<div className="bot-tool-chips">
												{botLiveTools.map((tc, ti) => (
													<span
														key={ti}
														className={`bot-tool-chip ${tc.isError ? "err" : ""}`}
													>
														<span className="bot-tool-chip-name">{toolLabel(tc.name)}</span>
														{tc.detail && <span className="bot-tool-chip-detail">{tc.detail}</span>}
													</span>
												))}
											</div>
										)}
										{botStreamThinking && !botStreamText && (
											<div className="bot-thinking">{t("正在思考与查阅资料…")}</div>
										)}
										{botStreamText ? (
											<div className="bot-msg-content artifact-md">{renderMarkdown(botStreamText)}</div>
										) : (
											!botStreamThinking && <div className="bot-thinking">{t("副编剧正在回应…")}</div>
										)}
									</div>
								)}
							</div>
						)}
					</div>

					<footer className="bot-drawer-foot">
						{botMessages.length > 0 && (
							<div className="bot-quick-pills">
								<button
									type="button"
									className="bot-quick-pill"
									disabled={botStreaming || busy}
									onClick={() => sendBot(t("点评一下刚才最新这一拍的节奏和人物反应，有什么出彩或生硬的地方？"))}
								>
									{t("锐评这拍")}
								</button>
								<button
									type="button"
									className="bot-quick-pill"
									disabled={botStreaming || busy}
									onClick={() => sendBot(t("结合当前剧情和世界状态，帮我推演接下来 2~3 个有意思的剧情走向。"))}
								>
									{t("推演走向")}
								</button>
								<button
									type="button"
									className="bot-quick-pill"
									disabled={botStreaming || busy}
									onClick={() => sendBot(t("看看最近几拍有没有新出现的设定、人物或地点值得写进世界书？帮我整理并写入。"))}
								>
									{t("提取设定")}
								</button>
								<button
									type="button"
									className="bot-quick-pill"
									disabled={botStreaming || busy}
									onClick={() => sendBot(t("帮我把目前的重要剧情进展和伏笔整理进本项目的记忆文档里。"))}
								>
									{t("整理记忆")}
								</button>
							</div>
						)}
						<div className="bot-input-row">
							<textarea
								className="bot-input"
								rows={2}
								value={botInput}
								placeholder={t("问剧情、聊走向、查设定、记笔记…（Enter 发送）")}
								onChange={(e) => setBotInput(e.target.value)}
								onKeyDown={(e) => {
									if (!coarse && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
										e.preventDefault();
										sendBot();
									}
								}}
							/>
							{botStreaming ? (
								<button
									type="button"
									className="bot-send-btn stop"
									onClick={() => ws.send({ type: "bot_manage", request: { action: "stop" } })}
									title={t("停止")}
								>
									<IconStop size={15} />
								</button>
							) : (
								<button
									type="button"
									className="bot-send-btn"
									disabled={!botInput.trim() || busy || conn !== "open"}
									onClick={() => sendBot()}
									title={t("发送给副编剧")}
								>
									<IconSend size={15} />
								</button>
							)}
						</div>
					</footer>
						</>
					)}
				</aside>
			)}
			{!agentSplit && (
				<button
					type="button"
					className={`bot-fab ${botOpen ? "active" : ""} ${botStreaming ? "streaming" : ""}`}
					title={t("副编剧 Bot")}
					aria-label={t("副编剧 Bot")}
					aria-expanded={botOpen}
					onClick={() => setBotOpen((v) => !v)}
				>
					<IconBot size={20} />
					{botMessages.length > 0 && !botOpen && (
						<span className="bot-fab-badge">{Math.ceil(botMessages.length / 2)}</span>
					)}
				</button>
			)}
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
							title={ag ? ag.name : panelLabel(floatPanel)}
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
						label: t("状态栏"),
						icon: <IconStatus size={14} />,
						active: rightPanel === "status",
					},
					{
						id: "worldline",
						label: t("世界线"),
						icon: <IconWorldline size={14} />,
						active: rightPanel === "worldline",
					},
					{
						id: "roster",
						label: t("登场名录"),
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
