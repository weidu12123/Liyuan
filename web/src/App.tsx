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
import { BrandLogo } from "./components/BrandLogo.tsx";
import { CardPanel } from "./components/CardPanel.tsx";
import { CodexPanel } from "./components/CodexPanel.tsx";
import { ConnectPanel } from "./components/ConnectPanel.tsx";
import { WelcomePanel } from "./components/HomePage.tsx";
import { PanelRefreshContext } from "./components/kit.tsx";
import { setAtHome, shouldShowHomeOnBoot, touchVisit } from "./visit.ts";
import {
	IconApi,
	IconAttach,
	IconBell,
	IconCard,
	IconChevronDown,
	IconClose,
	IconCodex,
	IconDock,
	IconLorebook,
	IconPersona,
	IconPreset,
	IconPuzzle,
	IconRefresh,
	IconSend,
	IconSessions,
	IconSettings,
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
	Paragraphs,
	ThinkingBlock,
	toolLabel,
	type ChatMsg,
} from "./components/Messages.tsx";
import { PanelDock } from "./components/PanelDock.tsx";
import { PersonaPanel } from "./components/PersonaPanel.tsx";
import { PowersPanel } from "./components/PowersPanel.tsx";
import { PresetPanel } from "./components/PresetPanel.tsx";
import { SessionsPanel } from "./components/SessionsPanel.tsx";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
import { SessionStatsBar, StatusStrip } from "./components/StatusStrip.tsx";
import { UploadsPanel } from "./components/UploadsPanel.tsx";
import { StoreModal, WorldlinePanel } from "./components/WorldlinePanel.tsx";
import { useWire, type ConnState } from "./ws.ts";
import type { RpPanel, ServerFrame, WireActivity, WireSessionInfo, WireStats, WorldState } from "./wire.ts";

interface Toast {
	id: number;
	level: "info" | "warning" | "error";
	text: string;
}

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

// ---------- 面板注册表（PLAN-PANELS-V2 §1.1：12 入口收纳为 10） ----------

type PanelId =
	| "sessions"
	| "worldline"
	| "connect"
	| "preset"
	| "powers"
	| "settings"
	| "card"
	| "lorebook"
	| "codex"
	| "persona"
	| "uploads";

/** agent 自建面板的右栏选择 id（柱 2）：`agent:` + 面板名，页签随 panels 帧动态长出 */
type AgentPanelId = `agent:${string}`;
const agentId = (name: string): AgentPanelId => `agent:${name}`;

/**
 * 顶栏 4-2-4（与对话框同宽对齐）：
 * - 左 4：连接 / 预设 / 扩展 / 上传
 * - 中 2：设置 / 面板（向下展开）
 * - 右 4：角色卡 / 世界书 / 知识库 / 用户角色
 * 会话在底栏。
 */
const LEFT_PANELS: PanelId[] = ["connect", "preset", "powers", "uploads"];
const RIGHT_PANELS: PanelId[] = ["card", "lorebook", "codex", "persona"];

/** 长文面板用宽档（横切基建 §1 面板宽度） */
const WIDE_PANELS = new Set<PanelId>(["card", "lorebook", "codex"]);

const PANEL_LABEL: Record<PanelId, string> = {
	sessions: "会话",
	worldline: "世界线",
	connect: "连接",
	preset: "预设",
	powers: "扩展能力",
	settings: "设置",
	card: "角色卡",
	lorebook: "世界书",
	codex: "知识库",
	persona: "用户角色",
	uploads: "上传区",
};

/** 顶栏图标(收纳入口的关键:图标承载识别,文字进 tooltip/aria-label) */
const PANEL_ICON: Record<PanelId, (p: { size?: number }) => React.JSX.Element> = {
	sessions: IconSessions,
	worldline: IconWorldline,
	connect: IconApi,
	preset: IconPreset,
	powers: IconPuzzle,
	settings: IconSettings,
	card: IconCard,
	lorebook: IconLorebook,
	codex: IconCodex,
	persona: IconPersona,
	uploads: IconUploads,
};

type CenterMenu = "settings" | "panels" | null;

/** 左栏：顶栏左组 + 底栏会话/世界线 + agent 面板 */
const LEFT_OPENABLE: PanelId[] = [...LEFT_PANELS, "sessions", "worldline"];

function loadPanelPrefs(): { left: PanelId | null; right: PanelId | null } {
	try {
		const raw = JSON.parse(localStorage.getItem("liyuan.panels") ?? "{}") as Record<string, unknown>;
		const pick = (v: unknown, group: PanelId[]) => (group.includes(v as PanelId) ? (v as PanelId) : null);
		const left = pick(raw.left, LEFT_OPENABLE);
		// settings 走中央下拉，旧 prefs 里的 settings 忽略
		return { left: left === ("settings" as PanelId) ? null : left, right: pick(raw.right, RIGHT_PANELS) };
	} catch {
		return { left: null, right: null };
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
	const [streamThinking, setStreamThinking] = useState("");
	const [thinkingLive, setThinkingLive] = useState(false);
	const [busy, setBusy] = useState(false);
	const [toolNote, setToolNote] = useState<string | null>(null);
	const [toasts, setToasts] = useState<Toast[]>([]);
	const [input, setInput] = useState("");
	// 待发送附件（附件随消息，上传即落服务端 .liyuan-uploads/，发送时路径附在消息尾行）
	const [pending, setPending] = useState<PendingUpload[]>([]);
	const [uploading, setUploading] = useState(false);
	const [atBottom, setAtBottom] = useState(true);
	/** 消息内联编辑：idx + 草稿 + 类型（用户改写后 reroll / agent 改写后 editreply） */
	const [msgEdit, setMsgEdit] = useState<{ idx: number; kind: "user" | "narrative" | "greeting"; draft: string } | null>(
		null,
	);
	const [sessions, setSessions] = useState<WireSessionInfo[] | null>(null);
	// 右栏数据
	const [worldState, setWorldState] = useState<WorldState | null>(null);
	const [stats, setStats] = useState<WireStats | null>(null);
	const [warnings, setWarnings] = useState<WarnEntry[]>([]);
	const [bellOpen, setBellOpen] = useState(false);
	// 决策门禁（Phase 4 柱 1）：当前挂起的选择卡（live 交互；应答后收敛，留痕由重放消息渲染）
	const [activeChoice, setActiveChoice] = useState<{ id: string; question: string; options: string[]; placeholder?: string } | null>(null);
	// agent 自建面板（柱 2）：server 推送的活跃面板全量（页签序）；入口在面板坞，展开到左栏
	const [agentPanels, setAgentPanels] = useState<RpPanel[]>([]);
	// 面板系统
	const initialPanels = useMemo(loadPanelPrefs, []);
	const [leftPanel, setLeftPanel] = useState<PanelId | AgentPanelId | null>(initialPanels.left);
	const [rightPanel, setRightPanel] = useState<PanelId | null>(initialPanels.right);
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
	/** 开左栏：手机上先关右栏（单开不变量）。传 null 或函数式更新按原样透传 */
	const openLeft = useCallback((next: PanelId | AgentPanelId | null) => {
		if (mobileRef.current && next !== null) setRightPanel(null);
		setLeftPanel(next);
	}, []);
	/** 开右栏：手机上先关左栏 */
	const openRight = useCallback((next: PanelId | null) => {
		if (mobileRef.current && next !== null) setLeftPanel(null);
		setRightPanel(next);
	}, []);
	/** 顶栏中央下拉：设置 | 面板 */
	const [centerMenu, setCenterMenu] = useState<CenterMenu>(null);
	/** 设置/面板坞保活：关下拉不卸 DOM，再开零冷启动 */
	const [dropKeep, setDropKeep] = useState<"settings" | "panels" | null>(null);
	useEffect(() => {
		if (centerMenu) setDropKeep(centerMenu);
	}, [centerMenu]);
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
		initialPanels.left ? [initialPanels.left] : [],
	);
	const [rightKeep, setRightKeep] = useState<PanelId[]>(() => (initialPanels.right ? [initialPanels.right] : []));
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
	const sessionIdRef = useRef("");
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
		localStorage.setItem("liyuan.panels", JSON.stringify({ left: leftPanel, right: rightPanel }));
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
		if (level === "info") {
			setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 5000);
		}
	}, []);

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

	/** 拉角色卡立绘 + 当前身份头像（hello / 切卡后） */
	const refreshAvatars = useCallback(() => {
		void (async () => {
			try {
				const card = await apiGet<CardResponse>("/api/card");
				if (card.path && /\.png$/i.test(card.path)) {
					setCharAvatarUrl(`/api/cards/image?path=${encodeURIComponent(card.path)}&t=${Date.now()}`);
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
					setUserAvatarUrl(personaAvatarUrl(active.id, Date.now()));
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
					setCharName(frame.charName);
					setUserName(frame.userName);
					setMessages(frame.messages);
					setMsgEdit(null); // 会话对齐后关闭内联编辑
					setWorldState(frame.state);
					setStats(frame.stats);
					agentPanelsRef.current = frame.panels ?? [];
					setAgentPanels(agentPanelsRef.current);
					// 恢复/切换后左栏若停在已不存在的 agent 面板上：收起
					const sel = leftPanelRef.current;
					if (sel?.startsWith("agent:") && !agentPanelsRef.current.some((p) => agentId(p.name) === sel)) {
						setLeftPanel(null);
					}
					clearStream();
					// 切到别的会话：清空会话内数据（同会话的命令后重放则保留）
					if (sessionIdRef.current !== frame.sessionId) {
						sessionIdRef.current = frame.sessionId;
						setWarnings([]);
						setActiveChoice(null);
						turnActsRef.current = [];
						// 列表「当前」标记已变：清空后立刻重拉（+短延迟再拉一次，等 rp-card 落盘）
						setSessions(null);
						if (welcomeRef.current || leftPanelRef.current === "sessions") {
							sendRef.current({ type: "sessions" });
							window.setTimeout(() => sendRef.current({ type: "sessions" }), 350);
						}
					} else if (welcomeRef.current || leftPanelRef.current === "sessions") {
						// 同会话 hello（重载）：刷新列表
						sendRef.current({ type: "sessions" });
					}
					document.title = "梨园";
					refreshAvatars();
					break;
				}
				case "message":
					if (frame.message.channel === "narrative" || frame.message.channel === "backstage") {
						clearStream();
						// 过程条 v0：把本轮积累的工具活动挂到定稿消息上（不持久化，刷新即失）
						const acts = turnActsRef.current;
						turnActsRef.current = [];
						setMessages((ms) => [...ms, acts.length ? { ...frame.message, activities: acts } : frame.message]);
					} else if (frame.message.channel === "greeting") {
						// 未开聊时切换开场白：替换已有开场白气泡，禁止往下叠楼
						setMessages((ms) => {
							const hasUser = ms.some((m) => m.channel === "user" && !m.backstage);
							if (hasUser) return [...ms, frame.message];
							const rest = ms.filter((m) => m.channel !== "greeting");
							return [...rest, frame.message];
						});
					} else {
						setMessages((ms) => [...ms, frame.message]);
					}
					break;
				case "delta":
					if (frame.kind === "text") {
						setThinkingLive(false);
						streamRef.current += frame.delta;
						setStreamText(streamRef.current);
					} else {
						setThinkingLive(true);
						streamThinkingRef.current += frame.delta;
						setStreamThinking(streamThinkingRef.current);
					}
					break;
				case "agent":
					if (frame.state === "start") {
						setBusy(true);
						turnActsRef.current = [];
					} else {
						setBusy(false);
						setThinkingLive(false);
						setToolNote(null);
						// 本轮 agent 可能写了技能/知识库/世界书等资产：通知 watchAgent 面板重拉
						setAgentTick((t) => t + 1);
						// 中断/异常遗留的半截正文落为本地消息（内容仍是模型原始输出），刷新后以会话文件为准
						if (streamRef.current.trim()) {
							const text = streamRef.current;
							const thinking = streamThinkingRef.current.trim();
							const acts = turnActsRef.current;
							turnActsRef.current = [];
							clearStream();
							setMessages((ms) => [
								...ms,
								{ channel: "narrative", text, ...(thinking ? { thinking } : {}), ...(acts.length ? { activities: acts } : {}) },
							]);
						} else {
							clearStream();
						}
					}
					break;
				case "activity":
					turnActsRef.current = [...turnActsRef.current, frame.activity];
					setToolNote(frame.activity.kind === "tool_start" ? `${toolLabel(frame.activity.name)}…` : null);
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
						openLeft(agentId(fresh.name));
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
					break;
				case "choice":
					// 新的决策询问：弹出 live 选择卡（会话被切换时由 hello 分支清空）
					setActiveChoice({ id: frame.id, question: frame.question, options: frame.options, placeholder: frame.placeholder });
					break;
				case "choice_resolved":
					// 该询问已决（本端/他端应答或超时）：收起 live 卡；留痕由工具结果重放消息承载
					setActiveChoice((c) => (c && c.id === frame.id ? null : c));
					break;
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
						setSessions(null);
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
		[pushToast, refreshAvatars],
	);

	const ws = useWire(onFrame, setConn);

	// WS 连通后：1) 预热 GET 缓存 2) 后台预挂载左右栏面板（ST 式常驻，再点顶栏不冷启动）
	useEffect(() => {
		if (conn !== "open") return;
		prefetchPanelApis();
		const t = window.setTimeout(() => {
			// 预挂载常用面板进 keep（collapsed 侧栏仍保留 DOM）
			setRightKeep((prev) => {
				const next = [...RIGHT_PANELS];
				for (const p of prev) if (!next.includes(p as PanelId)) next.push(p as PanelId);
				return next.slice(0, 8) as PanelId[];
			});
			setLeftKeep((prev) => {
				const base: Array<PanelId | AgentPanelId> = [...LEFT_PANELS, "sessions", "worldline"];
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
				!msg.backstage && (msg.channel === "user" || msg.channel === "narrative" || msg.channel === "greeting");
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
		for (let i = messages.length - 1; i >= 0; i--) if (messages[i].channel === "user") return i;
		return -1;
	}, [messages]);
	/** 剧情用户轮（不含戏外），用于回退 N 计算 */
	const storyUserIdxs = useMemo(
		() => messages.map((m, i) => (m.channel === "user" && !m.backstage ? i : -1)).filter((i) => i >= 0),
		[messages],
	);
	/** 仅有开场白、尚未开聊 → 可切换备选开场 */
	const greetingOnly = useMemo(() => {
		const hasGreet = messages.some((m) => m.channel === "greeting");
		const hasUser = messages.some((m) => m.channel === "user" && !m.backstage);
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
	}, [messages, streamText, streamThinking, thinkingLive, toolNote]);

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
		if (!text || conn !== "open") return;
		// 在欢迎区发送 = 进入当前会话对话（学 ST）
		setWelcome(false);
		setAtHome(false);
		touchVisit();
		if (/^\/compact(?:\s|$)/i.test(typed) && pending.length === 0) {
			// /compact：走专用帧（与会话面板按钮同源）；可选说明仍用 prompt，由服务端短路为 session.compact
			if (typed === "/compact" || /^\/compact\s*$/i.test(typed)) {
				ws.send({ type: "compact" });
			} else {
				ws.send({ type: "prompt", text: typed });
			}
		} else if (/^\/store\s*$/i.test(typed) && pending.length === 0) {
			// 无参 /store → 弹窗起名（有参则直接命令）
			openStoreModal();
		} else if (/^\/line\s*$/i.test(typed) && pending.length === 0) {
			setCenterMenu(null);
			openLeft("worldline");
		} else {
			ws.send({ type: "prompt", text });
		}
		setInput("");
		setPending([]);
		atBottomRef.current = true;
		setAtBottom(true);
		if (inputRef.current) inputRef.current.style.height = "auto";
	}, [input, pending, conn, ws, openStoreModal]);

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
		if (msgEdit.kind === "user") {
			// 保留原消息附件行
			const orig = messages[msgEdit.idx]?.text ?? "";
			const { attachments } = splitAttachments(orig);
			const attachLine =
				attachments.length > 0 ? buildAttachmentLine(attachments.map((a) => a.file)) : "";
			const full = attachLine ? `${text}\n${attachLine}` : text;
			ws.send({ type: "reroll", text: full });
		} else {
			// agent / 开场白：采用改写（不重新跑模型）；原文未改则等同「重新生成」
			const orig = (messages[msgEdit.idx]?.text ?? "").trim();
			if (text === orig && msgEdit.kind === "narrative") {
				ws.send({ type: "reroll" });
			} else {
				ws.send({ type: "prompt", text: `/editreply ${text}` });
			}
		}
		setMsgEdit(null);
	}, [msgEdit, busy, messages, ws]);

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

	// 面板开合：点同侧同钮=收起；开侧栏时收起中央下拉
	const togglePanel = (id: PanelId) => {
		setCenterMenu(null);
		if (LEFT_OPENABLE.includes(id)) {
			const next = leftPanel === id ? null : id;
			openLeft(next);
			if (next === "sessions") {
				setSessions(null);
				ws.send({ type: "sessions" });
			}
		} else {
			openRight(rightPanel === id ? null : id);
		}
	};

	const toggleCenter = (menu: Exclude<CenterMenu, null>) => {
		setCenterMenu((cur) => (cur === menu ? null : menu));
	};

	// 欢迎区 / 会话面板：列表为空时补拉（含新建会话后 hello 清空）
	useEffect(() => {
		if (conn !== "open") return;
		if (welcome || (leftPanel === "sessions" && sessions === null)) {
			ws.send({ type: "sessions" });
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- ws.send 稳定；sessions 变 null 时要重拉
	}, [conn, welcome, leftPanel, sessions]);

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
						onNew={() => {
							ws.send({ type: "new" });
							dismissWelcome();
						}}
						onCompact={() => ws.send({ type: "compact" })}
						onWorldline={() => {
							openLeft("worldline");
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
				return <PowersPanel toast={pushToast} />;
			case "settings":
				return <SettingsPanel toast={pushToast} />;
			case "card":
				return <CardPanel toast={pushToast} onEnterChat={dismissWelcome} active={rightPanel === "card"} />;
			case "lorebook":
				return <LorebookPanel toast={pushToast} />;
			case "persona":
				return <PersonaPanel toast={pushToast} />;
			case "codex":
				return <CodexPanel toast={pushToast} />;
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
			// 仅强制重挂载当前可见面板（表单草稿也会重置）；其它 keep 不动
			setManualTick((t) => ({ ...t, [side]: t[side] + 1 }));
		};
		const wide = open && !agent && WIDE_PANELS.has(headId as PanelId);
		return (
			<aside
				className={`side side-${side} ${wide ? "side-wide" : ""} ${open ? "" : "side-collapsed"}`}
				aria-hidden={!open}
			>
				{open && (
					<div className="panel-head">
						<span className="panel-head-title">
							<HeadIcon size={15} />
							{agent ? agent.name : PANEL_LABEL[headId as PanelId]}
						</span>
						<span className="panel-head-actions">
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
				{/* 保活：始终挂载；仅当前可见。收起侧栏时全体仍在 DOM */}
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
								<ArtifactPanel panel={ag} />
							) : (
								<Fragment key={bodyKey}>{renderPanel(pid as PanelId)}</Fragment>
							)}
						</div>
					);
				})}
			</aside>
		);
	};

	const coarse = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

	const activeAgentName = leftPanel?.startsWith("agent:") ? leftPanel.slice("agent:".length) : null;

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
		id: "connect" | "card" | "powers" | "sessions" | "lorebook" | "preset" | "persona" | "codex",
	) => {
		// 不关欢迎区：面板与欢迎同屏
		if (id === "card" || id === "lorebook" || id === "persona" || id === "codex") {
			openRight(id);
			return;
		}
		openLeft(id);
		if (id === "sessions") {
			setSessions(null);
			ws.send({ type: "sessions" });
		}
	};

	return (
		<PanelRefreshContext.Provider value={agentTick}>
		<div className="app">
			<header className="topbar">
				{/* 中 2：相对整条顶栏绝对居中 = 屏幕水平正中（不受左右留白不对称影响） */}
				<div className="tb-slot tb-slot-center">
					<button
						type="button"
						className={`tb-btn ${centerMenu === "settings" ? "active" : ""}`}
						onClick={() => toggleCenter("settings")}
						aria-label="设置"
						data-tip="设置"
					>
						<IconSettings size={18} />
					</button>
					<button
						type="button"
						className={`tb-btn ${centerMenu === "panels" || activeAgentName ? "active" : ""}`}
						onClick={() => toggleCenter("panels")}
						aria-label="面板"
						data-tip="面板"
					>
						<IconDock size={18} />
						{agentPanels.length > 0 && <span className="dock-count">{agentPanels.length}</span>}
					</button>
				</div>
				<div className="topbar-gutter topbar-gutter-left">
					<button
						type="button"
						className="brand brand-btn"
						title="欢迎页"
						aria-label="打开欢迎页"
						onClick={() => {
							if (welcome) {
								// 已在欢迎：滚到顶
								listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
							} else {
								showWelcome();
							}
						}}
					>
						<BrandLogo className="brand-logo" size={28} />
						<span className="brand-text">梨园</span>
					</button>
				</div>
				{/* 左 4 / 右 4：贴对话框左右缘；中间留白给绝对定位的中 2 */}
				<div className="tb-groups tb-groups-tri">
					<div className="tb-slot tb-slot-left">
						{LEFT_PANELS.map((id) => {
							const Ic = PANEL_ICON[id];
							return (
								<button
									key={id}
									type="button"
									className={`tb-btn ${leftPanel === id ? "active" : ""}`}
									onClick={() => togglePanel(id)}
									aria-label={PANEL_LABEL[id]}
									data-tip={PANEL_LABEL[id]}
								>
									<Ic size={18} />
								</button>
							);
						})}
					</div>
					<div className="tb-center-spacer" aria-hidden="true" />
					<div className="tb-slot tb-slot-right">
						{RIGHT_PANELS.map((id) => {
							const Ic = PANEL_ICON[id];
							return (
								<button
									key={id}
									type="button"
									className={`tb-btn ${rightPanel === id ? "active" : ""}`}
									onClick={() => togglePanel(id)}
									aria-label={PANEL_LABEL[id]}
									data-tip={PANEL_LABEL[id]}
								>
									<Ic size={18} />
								</button>
							);
						})}
					</div>
				</div>
				<div className="topbar-gutter topbar-gutter-right">
					<span className="char" title={charName}>
						{charName}
					</span>
					<div className="bell-wrap">
						<button
							type="button"
							className={`tb-btn ${bellOpen ? "active" : ""}`}
							onClick={() => setBellOpen((v) => !v)}
							aria-label="告警记录"
							data-tip="告警"
						>
							<IconBell size={17} />
							{warnings.length > 0 && <span className="bell-badge">{warnings.length > 9 ? "9+" : warnings.length}</span>}
						</button>
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
					{busy ? <span className="busy">生成中</span> : <span className={`dot dot-${conn}`} title={conn} />}
				</div>
			</header>

			{(centerMenu || dropKeep) && (
				<div className={`tb-drop-root ${centerMenu ? "" : "tb-drop-collapsed"}`} aria-hidden={!centerMenu}>
					{centerMenu && (
						<button type="button" className="tb-drop-scrim" aria-label="关闭" onClick={() => setCenterMenu(null)} />
					)}
					<div
						className="tb-drop"
						role="dialog"
						aria-modal={!!centerMenu}
						aria-label={centerMenu === "settings" || dropKeep === "settings" ? "设置" : "面板"}
						style={centerMenu ? undefined : { display: "none" }}
					>
						{centerMenu && (
							<div className="tb-drop-head">
								<span className="tb-drop-title">{centerMenu === "settings" ? "设置" : "面板"}</span>
								<button type="button" className="icon-btn" title="收起" aria-label="收起" onClick={() => setCenterMenu(null)}>
									<IconClose size={16} />
								</button>
							</div>
						)}
						<div className="tb-drop-body">
							{/* 两套内容保活，仅显示当前 */}
							{(dropKeep === "settings" || centerMenu === "settings") && (
								<div
									hidden={centerMenu !== "settings"}
									style={centerMenu === "settings" ? undefined : { display: "none" }}
								>
									<SettingsPanel toast={pushToast} />
								</div>
							)}
							{(dropKeep === "panels" || centerMenu === "panels") && (
								<div hidden={centerMenu !== "panels"} style={centerMenu === "panels" ? undefined : { display: "none" }}>
									<PanelDock
										variant="dropdown"
										panels={agentPanels}
										charName={charName}
										activeAgent={activeAgentName}
										onOpen={(name) => {
											openLeft(agentId(name));
											setCenterMenu(null);
										}}
										toast={pushToast}
									/>
								</div>
							)}
						</div>
					</div>
				</div>
			)}

			<div className="toasts">
				{toasts.map((t) => (
					<div key={t.id} className={`toast toast-${t.level}`} onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>
						{t.text}
					</div>
				))}
			</div>

			<div className="layout">
				{sidePanel(leftPanel, "left")}

				<main className="center">
					<div className="list" ref={listRef} onScroll={onScroll}>
						<div className="flow">
							{/* 欢迎区嵌在聊天流（学 ST）：顶栏/侧栏/输入框仍可用 */}
							{welcome ? (
								<WelcomePanel
									sessions={sessions}
									conn={conn}
									charName={charName}
									userName={userName}
									charAvatarUrl={charAvatarUrl}
									onOpen={openSessionFromWelcome}
									onNew={newSessionFromWelcome}
									onBrowseAll={() => {
										dismissWelcome();
										openLeft("sessions");
										setSessions(null);
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
							{(streamText || streamThinking) && (
								<div className="msg msg-char">
									<div className="msg-head">
										<MsgAvatar src={charAvatarUrl} name={charName} kind="char" />
										<span className="msg-name msg-name-char">{charName}</span>
									</div>
									{streamThinking && <ThinkingBlock text={streamThinking} live={thinkingLive} />}
									{streamText && <Paragraphs text={streamText} />}
									<span className="caret" />
								</div>
							)}
							{(thinkingLive || toolNote) && !streamText && (
								<div className="info-line pulse">{toolNote ?? `${charName} 正在思考…`}</div>
							)}
							{activeChoice && (
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

					{!atBottom && (
						<button className="jump-bottom" onClick={jumpToBottom} title="回到最新" aria-label="回到最新">
							<IconChevronDown size={17} />
						</button>
					)}

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
						<div className="composer-shell status-above">
							<StatusStrip state={worldState} toast={pushToast} />
						</div>
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
							<button
								type="button"
								className={`dock-btn ${leftPanel === "sessions" ? "active" : ""}`}
								title="会话"
								aria-label="会话"
								onClick={() => togglePanel("sessions")}
							>
								<IconSessions size={18} />
							</button>
							<button
								type="button"
								className={`dock-btn ${leftPanel === "worldline" ? "active" : ""}`}
								title="世界线"
								aria-label="世界线"
								onClick={() => togglePanel("worldline")}
							>
								<IconWorldline size={18} />
							</button>
							<button
								type="button"
								className="dock-btn"
								title="上传图片/文件（也可拖入或粘贴）"
								aria-label="上传图片或文件"
								onClick={() => uploadInputRef.current?.click()}
							>
								<IconAttach size={18} />
							</button>
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
								placeholder={conn === "open" ? (userName ? `以「${userName}」的身份发言…` : "输入消息…") : "等待连接…"}
								rows={1}
								onFocus={() => {
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
								<button className="btn btn-stop" onClick={() => ws.send({ type: "abort" })} title="停止" aria-label="停止生成">
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
						<div className="composer-shell session-stats-wrap">
							<SessionStatsBar stats={stats} />
						</div>
					</footer>
				</main>

				{sidePanel(rightPanel, "right")}
			</div>
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
