/**
 * ST 聊天记录导入：解析（jsonl）→ 清洗（标签规则）→ 前情块格式化。纯函数，零 pi 依赖。
 *
 * 关键认知（用户提供）：ST 的 `mes` 存的是模型**全量输出**——思维链、状态栏、
 * 正文标签结构全在里面，「只显示正文」是 ST 前端正则做的显示期裁剪。
 * 逐条原样搬运会让残渣污染上下文，更会 few-shot 锚定我们的主演输出同款结构。
 * 因此导入 = 素材消化（D9：ST 记录是素材，注入上下文的是成片），清洗必须先行。
 *
 * D4 红线：不导入、不执行 ST 的正则脚本——清洗规则是我们自己格式的数据，
 * 由用户用一句话约定（如「正文在 content 标签之间」）。
 * 内容中立：清洗作用于标签结构，正文文本是穿过管道的不透明字符串。
 */

import { cleanAssistantText } from "./postprocess.ts";

interface StChatMeta {
	userName: string;
	charName: string;
	createDate?: string;
}

interface StChatMessage {
	role: "user" | "assistant";
	/** ST 侧的发言者名（群聊时区分角色） */
	name: string;
	/** 原始 mes（未清洗） */
	text: string;
	/** ST 中被 /hide 的隐藏楼层（is_system）；导入照常消化，仅供提示 */
	hidden?: boolean;
}

interface ParsedStChat {
	meta: StChatMeta;
	messages: StChatMessage[];
	/** 被 ST 隐藏（is_system）但仍纳入导入的楼层数 */
	hiddenCount: number;
}

/**
 * 解析 ST 聊天 jsonl：首行元数据，后续每行一条消息。
 * - `mes` 即用户选中的 swipe（ST 保证 mes === swipes[swipe_id]），mes 为空才回退 swipes
 * - `is_system` 行**不整体跳过**：ST 的 /hide 隐藏楼层就是 is_system=true，程序卡
 *   （状态栏 HTML 卡）常自动隐藏全部历史层只留最后一层省上下文——逐条跳过会让
 *   导入「只剩最后一条」。隐藏楼层是剧情本体，只是不进 ST 的上下文；导入是素材
 *   消化，正需要它们。仅 /comment 旁注（extra.type === "comment"，从不送模）跳过。
 */
export function parseStChat(jsonlText: string): ParsedStChat {
	const lines = jsonlText.split(/\r?\n/).filter((l) => l.trim().length > 0);
	if (lines.length === 0) throw new Error("空文件");

	let header: Record<string, unknown>;
	try {
		header = JSON.parse(lines[0]) as Record<string, unknown>;
	} catch {
		throw new Error("首行不是合法 JSON（应为 ST 聊天元数据行）");
	}
	if (typeof header.user_name !== "string" || typeof header.character_name !== "string") {
		throw new Error("首行缺少 user_name / character_name——这不是 ST 聊天记录文件？");
	}
	const meta: StChatMeta = {
		userName: header.user_name,
		charName: header.character_name,
		createDate: typeof header.create_date === "string" ? header.create_date : undefined,
	};

	const messages: StChatMessage[] = [];
	let hiddenCount = 0;
	for (let i = 1; i < lines.length; i++) {
		let m: Record<string, unknown>;
		try {
			m = JSON.parse(lines[i]) as Record<string, unknown>;
		} catch {
			continue; // 容忍个别损坏行
		}
		const hidden = m.is_system === true;
		if (hidden) {
			// /comment 旁注（extra.type === "comment"）是用户笔记，从不属于剧情——跳过
			const extra = m.extra && typeof m.extra === "object" ? (m.extra as Record<string, unknown>) : undefined;
			if (extra?.type === "comment") continue;
		}
		let text = typeof m.mes === "string" ? m.mes : "";
		if (!text && Array.isArray(m.swipes)) {
			const idx = typeof m.swipe_id === "number" ? m.swipe_id : 0;
			const s = (m.swipes as unknown[])[idx];
			if (typeof s === "string") text = s;
		}
		if (!text.trim()) continue;
		if (hidden) hiddenCount++;
		messages.push({
			role: m.is_user === true ? "user" : "assistant",
			name: typeof m.name === "string" ? m.name : m.is_user === true ? meta.userName : meta.charName,
			text,
			...(hidden ? { hidden: true } : {}),
		});
	}
	return { meta, messages, hiddenCount };
}


interface CleanRules {
	/** 正文提取标签：设置后只保留 <tag>…</tag> 之间的内容（多段拼接）；无命中时回退为策略清洗 */
	extractTag?: string;
	/**
	 * 额外整块剥离的标签名（叠加在策略引擎之上）。
	 * 默认空——fold/panel/strip/unwrap 由 postprocess 处理，无需枚举。
	 */
	stripTags?: string[];
}

const escapeReg = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 清洗单条消息：可选 extractTag；其余走 postprocess 策略引擎 */
export function cleanChatText(text: string, rules: CleanRules = {}): string {
	let t = text;

	if (rules.extractTag) {
		const tag = escapeReg(rules.extractTag);
		const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
		const parts: string[] = [];
		let match: RegExpExecArray | null;
		while ((match = re.exec(t)) !== null) parts.push(match[1]);
		if (parts.length > 0) {
			t = parts.join("\n\n");
		}
	}

	for (const tag of rules.stripTags ?? []) {
		const k = escapeReg(tag);
		t = t.replace(new RegExp(`<${k}(?:\\s[^>]*)?>[\\s\\S]*?</${k}>`, "gi"), "");
		t = t.replace(new RegExp(`<${k}(?:\\s[^>]*)?>[\\s\\S]*$`, "gi"), "");
	}

	return cleanAssistantText(t);
}

/** 批量清洗，丢弃清洗后为空的消息 */
export function cleanChat(messages: StChatMessage[], rules: CleanRules = {}): StChatMessage[] {
	return messages
		.map((m) => ({ ...m, text: cleanChatText(m.text, rules) }))
		.filter((m) => m.text.length > 0);
}

interface ImportBlockInput {
	/** 旧轮次的接力摘要（可为空：短对话无需摘要） */
	summary: string;
	/** 原文保留的最近轮次（已清洗） */
	recentTurns: StChatMessage[];
	charName: string;
	userName: string;
}

/** 组装注入会话起点的前情块（custom 消息 → 以 user 角色送达模型，TUI 可见） */
export function buildImportBlock({ summary, recentTurns, charName, userName }: ImportBlockInput): string {
	const parts: string[] = [
		`【前情导入】以下是本剧情此前的经过（自 SillyTavern 迁移）。剧情从这里继续，忽略更早的开场白；${charName} 的性格、双方关系与所有既成事实以下述内容为准。`,
	];
	if (summary.trim()) {
		parts.push(`── 前情提要 ──\n${summary.trim()}`);
	}
	if (recentTurns.length > 0) {
		const dialogue = recentTurns.map((m) => `${m.role === "user" ? userName : m.name || charName}：${m.text}`).join("\n\n");
		parts.push(`── 最近对白实录（原文） ──\n${dialogue}`);
	}
	parts.push(`（前情结束。接下来由 ${userName} 继续行动。）`);
	return parts.join("\n\n");
}

/** 摘要输入的上限保护：超长历史截取尾部（v0；分层摘要留待后续） */
export function serializeForImportSummary(messages: StChatMessage[], userName: string, maxChars = 100_000): string {
	const lines = messages.map((m) => `${m.role === "user" ? userName : m.name}：${m.text}`);
	let text = lines.join("\n\n");
	if (text.length > maxChars) {
		text = text.slice(text.length - maxChars);
		const firstBreak = text.indexOf("\n\n");
		if (firstBreak > 0) text = text.slice(firstBreak + 2);
		text = `（更早的剧情因长度上限未纳入摘要）\n\n${text}`;
	}
	return text;
}
