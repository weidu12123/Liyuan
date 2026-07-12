/**
 * wire 协议：Web 前端与 server 之间的自有消息格式（PLAN-PHASE3 §3/§4）。
 *
 * 本模块与领域层同纪律（PLAN.md D3）：零 pi import，对 pi 的 AgentMessage
 * 只做鸭子类型的结构性访问——pi 0.x 漂移时前端零感知，翻译规则可独立单测。
 *
 * D10：narrative 通道的文本必须是主演模型原始输出，翻译只做通道分发与
 * 结构块（thinking/toolCall）的丢弃，绝不改写正文字符。
 */

import { isBackstageText } from "../src/stance.ts";
import type { RpPanel } from "../src/panels.ts";
import type { WorldState } from "../src/types.ts";

export type { WorldState, RpPanel };
export { isBackstageText };

export type WireChannel =
	| "user"
	| "narrative"
	| "greeting"
	| "import"
	| "info"
	| "backstage"
	| "image"
	| "audio"
	| "video"
	| "choice"
	/** 对话流内嵌 HTML（show_html 工具 / 正文 ```html 块） */
	| "html";

/** ST 式回复变体：挂在 narrative 上；左右箭头切换，agent 只见当前选中 */
export interface WireSwipe {
	/** 0-based 当前变体序号 */
	index: number;
	/** 已有变体条数（0=尚无角色回复，仍可点右生成） */
	total: number;
}

export interface WireMsg {
	channel: WireChannel;
	/** 发言者显示名（narrative/greeting 为角色名，user 为用户名） */
	name?: string;
	text: string;
	/** 模型思维链（原始输出，UI 折叠呈现；无则缺省） */
	thinking?: string;
	/** user 消息专用：带场外标记（//、（）包裹），该轮助手回复走 backstage 通道 */
	backstage?: boolean;
	/** image / audio / video 通道：资源地址（http(s) 或本服务 /media/ · /audio/） */
	src?: string;
	/** choice 通道专用：选择卡内容（历史重放为已决状态） */
	choice?: WireChoice;
	/**
	 * html 通道专用：文档 HTML（可含完整 <html> 或片段）。
	 * 展示层 iframe 沙箱渲染；scripts=true 时允许脚本（仍隔离于父页面）。
	 */
	html?: string;
	/** html 通道：是否允许脚本（默认 false 更安全；show_html 可显式开启） */
	scripts?: boolean;
	/**
	 * 回复变体（ST swipe）：仅当前分支上最后一轮剧情角色回复携带。
	 * 右箭头在末条时 = 再生成一条（原回复保留在会话树旁支，不产生世界线）。
	 */
	swipe?: WireSwipe;
	/**
	 * 开场白序号（0-based index + 非空总数）。
	 * 挂在 greeting 消息上，避免只靠 /api/card 轮询导致「正文已是第 4 条、角标还是 2」。
	 */
	greetingPick?: { index: number; total: number };
}

/**
 * 剧情决策选择卡（Phase 4 柱 1）：模型经 ask_director 停笔询问，用户
 * 选选项 / 自由输入 / 停止本回合。选后卡片留痕（answer/stopped 已决态）。
 */
export interface WireChoice {
	/** 未决卡的应答关联 id（choice_reply 回传）；历史重放的已决卡缺省 */
	id?: string;
	question: string;
	/** 模型给的 2~4 个选项；input 对话框（无选项、纯自由输入）为空数组 */
	options: string[];
	/** 自由输入框占位文本（input 对话框用） */
	placeholder?: string;
	/** 已决：用户的回答（选项原文或自由输入） */
	answer?: string;
	/** 已决：用户停止了本回合（笔还给用户） */
	stopped?: boolean;
}

/** 会话列表条目（SessionManager.list 的裁剪投影，已按当前卡过滤） */
export interface WireSessionInfo {
	path: string;
	id: string;
	name?: string;
	firstMessage: string;
	/** 最后修改时间（epoch ms） */
	modified: number;
	messageCount: number;
	current: boolean;
	/** 末条 user/assistant 消息预览（≤80 字，借鉴 ST 过去聊天信息密度） */
	preview?: string;
	/** 会话所属卡名（rp-card 条目；与当前卡绑定） */
	cardName?: string;
}

/** 会话统计（getSessionStats 裁剪投影） */
export interface WireStats {
	userMessages: number;
	assistantMessages: number;
	totalTokens: number;
	cost: number;
	/** 上下文占用百分比（0-100），未知为 null */
	contextPercent: number | null;
}

/** 过程活动（过程条 v0：工具调用；F3 扩展场记/审计） */
export interface WireActivity {
	kind: "tool_start" | "tool_end";
	name: string;
	/** start=参数摘要；end=结果摘要（截断） */
	detail?: string;
	/** tool_end 专用：是否出错 */
	isError?: boolean;
}

/** Server → Client 帧 */
export type ServerFrame =
	| {
			type: "hello";
			sessionId: string;
			charName: string;
			userName: string;
			messages: WireMsg[];
			state: WorldState | null;
			stats: WireStats | null;
			/** agent 自建面板（柱 2）：当前活跃面板全量（页签序） */
			panels: RpPanel[];
	  }
	| { type: "message"; message: WireMsg }
	| { type: "delta"; kind: "text" | "thinking"; delta: string }
	| { type: "agent"; state: "start" | "end" }
	| { type: "activity"; activity: WireActivity }
	| { type: "state"; state: WorldState }
	/** agent 自建面板变化（panel_write/close 落盘、rewind 回退）：活跃面板全量推送（同 state 的 fs.watch 机制） */
	| { type: "panels"; panels: RpPanel[] }
	| { type: "stats"; stats: WireStats }
	| { type: "notify"; level: "info" | "warning" | "error"; text: string }
	| { type: "compaction"; state: "start" | "end"; ok?: boolean }
	| { type: "sessions"; list: WireSessionInfo[] }
	/** 剧情决策询问（ask_director 停笔）：前端渲染选择卡，等用户应答 */
	| { type: "choice"; id: string; question: string; options: string[]; placeholder?: string }
	/** 询问已决（本端应答成功 / 他端先答 / 超时/中止）：前端把未决卡收敛成留痕态 */
	| { type: "choice_resolved"; id: string; answer?: string; stopped?: boolean }
	| { type: "error"; text: string };

/** Client → Server 帧 */
export type ClientFrame =
	| { type: "prompt"; text: string }
	| { type: "abort" }
	/**
	 * 重新生成最后一轮。
	 * - text 缺省：ST 式——同一条用户消息下新开 sibling 变体（原回复保留，不产生世界线）
	 * - text 给出：编辑用户输入后整轮重来（旧 user+回复进旁支）
	 */
	| { type: "reroll"; text?: string }
	/**
	 * ST 式变体导航 / 再生成（不写世界线）。
	 * prev|next：在同一 user 下的 sibling 间切换；在末条 next = 等同 reroll 无参。
	 * new：强制再生成一条变体。
	 */
	| { type: "swipe"; dir: "prev" | "next" | "new" }
	| { type: "compact" }
	| { type: "sessions" }
	| { type: "open"; path: string }
	/** 剧情决策应答：value=选项原文或自由输入；stop=停止本回合（笔还给用户） */
	| { type: "choice_reply"; id: string; value?: string; stop?: boolean }
	| { type: "new" };

/** 翻译时需要的显示名 */
export interface WireNames {
	charName: string;
	userName: string;
}

interface MsgLike {
	role?: unknown;
	content?: unknown;
	customType?: unknown;
	display?: unknown;
	details?: unknown;
	toolName?: unknown;
	isError?: unknown;
	details?: unknown;
}

/** show_image 工具结果 → image 消息（图片通道 §6.5）；非该工具或出错返回 null */
function imageOfToolResult(msg: MsgLike): WireMsg | null {
	if (msg.toolName !== "show_image" || msg.isError === true) return null;
	const img =
		msg.details && typeof msg.details === "object"
			? (msg.details as { rpImage?: { src?: unknown; caption?: unknown } }).rpImage
			: undefined;
	if (!img || typeof img.src !== "string") return null;
	return { channel: "image", text: typeof img.caption === "string" ? img.caption : "", src: img.src };
}

/** show_audio / tts 工具结果 → audio 消息；非该工具或出错返回 null */
function audioOfToolResult(msg: MsgLike): WireMsg | null {
	if ((msg.toolName !== "show_audio" && msg.toolName !== "tts") || msg.isError === true) return null;
	const aud =
		msg.details && typeof msg.details === "object"
			? (msg.details as { rpAudio?: { src?: unknown; caption?: unknown } }).rpAudio
			: undefined;
	if (!aud || typeof aud.src !== "string") return null;
	return { channel: "audio", text: typeof aud.caption === "string" ? aud.caption : "", src: aud.src };
}

/** show_video 工具结果 → video 消息；非该工具或出错返回 null */
function videoOfToolResult(msg: MsgLike): WireMsg | null {
	if (msg.toolName !== "show_video" || msg.isError === true) return null;
	const vid =
		msg.details && typeof msg.details === "object"
			? (msg.details as { rpVideo?: { src?: unknown; caption?: unknown } }).rpVideo
			: undefined;
	if (!vid || typeof vid.src !== "string") return null;
	return { channel: "video", text: typeof vid.caption === "string" ? vid.caption : "", src: vid.src };
}

/** show_html 工具结果 → html 消息（对话流内嵌 UI 底座）；非该工具或出错返回 null */
function htmlOfToolResult(msg: MsgLike): WireMsg | null {
	if (msg.toolName !== "show_html" || msg.isError === true) return null;
	const h =
		msg.details && typeof msg.details === "object"
			? (msg.details as {
					rpHtml?: { html?: unknown; title?: unknown; scripts?: unknown; height?: unknown };
				}).rpHtml
			: undefined;
	if (!h || typeof h.html !== "string" || !h.html.trim()) return null;
	return {
		channel: "html",
		text: typeof h.title === "string" ? h.title : "",
		html: h.html,
		scripts: h.scripts === true,
		// 高度提示塞进 src 字段不合适；前端用 text 作标题，高度用默认
	};
}

/**
 * ask_director 工具结果 → choice 消息（决策门禁，Phase 4 柱 1）。工具执行完成
 * 时用户已应答，结果里带着已决的选择卡（details.rpChoice），重放即还原留痕态。
 * 非该工具或结构不符返回 null。
 */
function choiceOfToolResult(msg: MsgLike): WireMsg | null {
	if (msg.toolName !== "ask_director") return null;
	const c =
		msg.details && typeof msg.details === "object"
			? (msg.details as { rpChoice?: { question?: unknown; options?: unknown; answer?: unknown; stopped?: unknown } }).rpChoice
			: undefined;
	if (!c || typeof c.question !== "string") return null;
	const options = Array.isArray(c.options) ? c.options.filter((o): o is string => typeof o === "string") : [];
	const choice: WireChoice = { question: c.question, options };
	if (typeof c.answer === "string") choice.answer = c.answer;
	if (c.stopped === true) choice.stopped = true;
	return { channel: "choice", text: "", choice };
}

/** 从消息 content（字符串或内容块数组）提取纯文本，thinking/toolCall 块丢弃 */
function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((p) =>
			p && typeof p === "object" && (p as { type?: unknown }).type === "text"
				? String((p as { text?: unknown }).text ?? "")
				: "",
		)
		.filter(Boolean)
		.join("\n");
}

/** 提取 thinking 块文本（主演思考过程，UI 折叠显示） */
function thinkingOf(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.map((p) =>
			p && typeof p === "object" && (p as { type?: unknown }).type === "thinking"
				? String((p as { thinking?: unknown }).thinking ?? "")
				: "",
		)
		.filter(Boolean)
		.join("\n");
}

/**
 * 单条 AgentMessage → WireMsg。不属于叙事流的消息（rp-inject、toolResult、
 * 纯工具轮 assistant、未知类型）返回 null，调用方跳过。
 * opts.backstage：该轮用户以 // 开头（幕后轮），助手回复走 backstage 通道
 * （PLAN-PHASE3 §6.1 显示通道——排版区隔，非上下文切割）。
 */
export function toWireMsg(m: unknown, names: WireNames, opts?: { backstage?: boolean }): WireMsg | null {
	if (!m || typeof m !== "object") return null;
	const msg = m as MsgLike;
	const text = textOf(msg.content).trim();

	if (msg.role === "user") {
		if (!text) return null;
		return isBackstageText(text)
			? { channel: "user", name: names.userName, text, backstage: true }
			: { channel: "user", name: names.userName, text };
	}
	if (msg.role === "assistant") {
		// 纯工具/思考轮无正文：整条跳过（D9 同款判断）
		if (!text) return null;
		const thinking = thinkingOf(msg.content).trim();
		const channel: WireChannel = opts?.backstage ? "backstage" : "narrative";
		return thinking ? { channel, name: names.charName, text, thinking } : { channel, name: names.charName, text };
	}
	if (msg.role === "custom") {
		if (msg.display === false) return null; // rp-inject 等幕后注入
		if (msg.customType === "rp-greeting") {
			if (!text) return null;
			const pick =
				msg.details && typeof msg.details === "object"
					? (msg.details as { rpGreeting?: { index?: unknown; total?: unknown } }).rpGreeting
					: undefined;
			// index = 非空序位 0-based（角标用 index+1）；total = 非空条数
			const index = typeof pick?.index === "number" && Number.isFinite(pick.index) ? Math.max(0, pick.index) : undefined;
			const total = typeof pick?.total === "number" && Number.isFinite(pick.total) ? Math.max(0, pick.total) : undefined;
			return {
				channel: "greeting",
				name: names.charName,
				text,
				...(index !== undefined && total !== undefined && total > 0
					? { greetingPick: { index, total } }
					: {}),
			};
		}
		/** 用户手改后的角色回复：显示同叙事通道 */
		if (msg.customType === "rp-edited-reply") {
			return text ? { channel: "narrative", name: names.charName, text } : null;
		}
		if (msg.customType === "rp-import") {
			return text ? { channel: "import", text } : null;
		}
		// 用户气泡「配音」写入的可展示音频（details.rpAudio；正文尽量不进 LLM 注意力，见 convert 侧仍可能带短标记）
		if (msg.customType === "rp-audio") {
			const aud =
				msg.details && typeof msg.details === "object"
					? (msg.details as { rpAudio?: { src?: unknown; caption?: unknown } }).rpAudio
					: undefined;
			if (aud && typeof aud.src === "string") {
				return {
					channel: "audio",
					text: typeof aud.caption === "string" ? aud.caption : text || "",
					src: aud.src,
				};
			}
		}
		// 其他可显示 custom（压缩摘要横幅等）走 info 通道
		return text ? { channel: "info", text } : null;
	}
	if (msg.role === "toolResult") {
		return (
			imageOfToolResult(msg) ??
			audioOfToolResult(msg) ??
			videoOfToolResult(msg) ??
			htmlOfToolResult(msg) ??
			choiceOfToolResult(msg)
		);
	}
	return null; // bash / 未知类型
}

/** 全量历史 → wire 消息列表（hello 帧用）；沿途跟踪场外标记轮，助手回复分道 */
export function toWireHistory(messages: unknown[], names: WireNames): WireMsg[] {
	const out: WireMsg[] = [];
	let backstage = false;
	for (const m of messages) {
		const role = (m as MsgLike | null)?.role;
		if (role === "user") {
			backstage = isBackstageText(textOf((m as MsgLike).content));
		}
		const w = toWireMsg(m, names, { backstage });
		if (w) out.push(w);
	}
	return out;
}

/**
 * 从会话 JSONL 文本解析 rp-card 自描述条目（PLAN-PHASE3 §2.1）。
 * 取**最后一条**（换卡后会补写新标记；旧标记可能仍留在文件前部）。
 * 读前若干 KB 通常够；大会话若标记在尾部由调用方扩大窗口。
 */
export function parseCardFromSessionHead(headText: string): { card: string; name: string } | null {
	let found: { card: string; name: string } | null = null;
	for (const line of headText.split(/\r?\n/)) {
		if (!line.includes('"rp-card"')) continue; // 快速跳过
		try {
			const e = JSON.parse(line) as { type?: unknown; customType?: unknown; data?: { card?: unknown; name?: unknown } };
			if (e.type === "custom" && e.customType === "rp-card" && e.data && typeof e.data.card === "string") {
				found = { card: e.data.card, name: typeof e.data.name === "string" ? e.data.name : "" };
			}
		} catch {
			// 半行/损坏行跳过
		}
	}
	return found;
}

/** 工具结果 → 过程条摘要文本（取首个 text 块，截断） */
export function summarizeToolResult(result: unknown, maxChars = 200): string {
	if (!result || typeof result !== "object") return "";
	const content = (result as { content?: unknown }).content;
	if (!Array.isArray(content)) return "";
	for (const p of content) {
		if (p && typeof p === "object" && (p as { type?: unknown }).type === "text") {
			const t = String((p as { text?: unknown }).text ?? "").trim();
			if (t) return t.length > maxChars ? `${t.slice(0, maxChars)}…` : t;
		}
	}
	return "";
}
