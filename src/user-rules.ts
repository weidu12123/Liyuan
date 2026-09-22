/**
 * 用户规矩（刀2，docs/PLAN-AGENT-SLOTS.md §七）：把「追加 system」这个 agent 能力
 * 还给用户。两级文件，stage 每拍现读（materials 指纹缓存）：
 *
 * - 全局：`<agentDir>/APPEND_SYSTEM.md`（路径与 pi 的同名槽位一致；RP 会话已退出
 *   pi 的原生 append 发现——单一主人是 stage，不双份、且改动下一拍即生效，
 *   不必像 pi 原生那样重启）。
 * - 卡级：`cards/<卡>/APPEND_SYSTEM.md`（只对这张卡生效，接在全局之后）。
 *
 * 酒馆预设在这里退场为**一次性转译**：预设作者自己的文本块按原序落进卡级规矩
 * 文件；marker 槽位跳过（新架构里卡内容/历史的位置由装配与 AGENTS.md 链决定，
 * 不再由预设作者指定）；samplers 迁 config；逐块去向落转译报告——错的也要
 * 错在看得见的地方（铁律三）。
 *
 * 纯函数 + 零模块级可变状态（jiti 二象性红线），可单测。
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { assemble, type AssembledPiece } from "./preset-assemble.ts";
import type { PresetDoc } from "./preset-doc.ts";

/** 用户规矩文件名（两级同名，对齐 pi 的 APPEND_SYSTEM.md 习惯） */
export const USER_RULES_FILE = "APPEND_SYSTEM.md";
/** agent 模式的全局追加槽：与 APPEND_SYSTEM.md 平级、二选一——扮演轮读前者，agent 轮读本文件 */
export const AGENT_RULES_FILE = "AGENT_APPEND_SYSTEM.md";

/** agentDir：与 paths.ts preferLiyuanAgentHome 同一约定（启动时写 env；只认 LIYUAN_*，PI_* 不当输入） */
export function rulesAgentDir(): string {
	return process.env.LIYUAN_CODING_AGENT_DIR || join(homedir(), ".liyuan", "agent");
}

export function globalRulesPath(): string {
	return join(rulesAgentDir(), USER_RULES_FILE);
}

export function agentRulesPath(): string {
	return join(rulesAgentDir(), AGENT_RULES_FILE);
}

/**
 * SYSTEM.md（刀1 播种的扮演骨架）：pi customPrompt 槽位，启动时装载缓存——
 * 与两级规矩文件（每拍现读）不同，改它要**重启梨园**才生效；清空/删除则退回
 * 随包骨架并每拍告警（roleplay.ts 兜底）。前端「全局系统提示词」编辑器用。
 */
export function systemPromptPath(): string {
	return join(rulesAgentDir(), "SYSTEM.md");
}

export function cardRulesPath(cardDir: string): string {
	return join(cardDir, USER_RULES_FILE);
}

export interface UserRules {
	global: string;
	/** agent 模式的全局追加（AGENT_APPEND_SYSTEM.md）；扮演轮不读 */
	agent: string;
	card: string;
}

export function readUserRules(cardDir: string): UserRules {
	const read = (p: string): string => {
		if (!existsSync(p)) return "";
		try {
			return readFileSync(p, "utf-8");
		} catch {
			return "";
		}
	};
	return { global: read(globalRulesPath()), agent: read(agentRulesPath()), card: read(cardRulesPath(cardDir)) };
}

// ---------------- 预设 → 规矩文件（一次性转译） ----------------

export interface TranslateLineItem {
	name: string;
	chars: number;
	/** 去向 */
	action: "included" | "skipped-marker" | "skipped-disabled" | "skipped-empty" | "dropped-prefill";
	/** included 落进哪一段 */
	where?: "before" | "after" | "depth";
}

export interface TranslateResult {
	/** 卡级规矩文件全文（含脚手架行，用户可改可删） */
	markdown: string;
	/** 逐块去向报告 */
	lines: TranslateLineItem[];
	/** 迁进 config.samplers 的采样参数（无则空对象） */
	samplers: Record<string, number>;
	/** 引用了 {{lastusermessage}} 的块（逐拍宏，静态文件里不成立，报告点名） */
	usesLastUserMessage: string[];
	/** 装配期遇到的清单外宏（原样保留在文本里） */
	unsupportedMacros: string[];
}

const fmtDate = (): string => {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * 转译复用 `assemble()`（求值/前后分段/深度注入/关闭块全走同一套，不另造规则），
 * 只做三件它不管的事：
 * - materials 不给料 ⇒ marker 槽位自然空、不进产物（去向进报告）
 * - 末尾连续 assistant 块＝酒馆预填位，丢弃（8/23 定案；engine 同规则）
 * - 求值后文本按段渲染成 markdown
 *
 * 位置语义的降级如实呈现：历史后段/深度注入在新架构里都并入常驻，标题写明原位置。
 */
export function translatePresetToRules(doc: PresetDoc, opts: { charName: string; userName: string }): TranslateResult {
	const r = assemble(doc.entries, { charName: opts.charName, userName: opts.userName });

	// 预填位丢弃：after 段尾部连续 assistant 块
	let end = r.after.length;
	while (end > 0 && r.after[end - 1].role === "assistant") end--;
	const droppedPrefill = r.after.slice(end);
	const after = r.after.slice(0, end);

	const lines: TranslateLineItem[] = [];
	for (const item of r.report) {
		if (item.action === "marker 槽位" || item.action === "marker 无料") {
			if (item.identifier === "chatHistory") continue;
			lines.push({ name: item.name || item.identifier, chars: item.chars, action: "skipped-marker" });
		} else if (item.action === "关闭") {
			lines.push({ name: item.name || item.identifier, chars: item.chars, action: "skipped-disabled" });
		} else if (item.action === "零字" || item.action === "缺失定义") {
			lines.push({ name: item.name || item.identifier, chars: item.chars, action: "skipped-empty" });
		} else if (item.action === "历史前" || item.action === "历史后" || item.action === "深度注入") {
			lines.push({
				name: item.name || item.identifier,
				chars: item.chars,
				action: "included",
				where: item.action === "历史前" ? "before" : item.action === "历史后" ? "after" : "depth",
			});
		}
	}
	for (const p of droppedPrefill) {
		lines.push({ name: p.name || p.id, chars: p.text.length, action: "dropped-prefill" });
	}

	const render = (pieces: AssembledPiece[]): string[] =>
		pieces.map((p) => p.text.trim()).filter((t) => t.length > 0);

	const parts: string[] = [
		`# 预设提示词`,
		``,
		`> 转译自预设「${doc.name}」· ${fmtDate()}。原文存档在预设库，可重新转译；本文件是你的，随便改。`,
	];
	const before = render(r.before);
	const afterText = render(after);
	const depthText = render(r.depth);
	if (before.length > 0) parts.push(``, `## 以下原在聊天记录之前`, ``, before.join("\n\n"));
	if (afterText.length > 0) parts.push(``, `## 以下原在聊天记录之后`, ``, afterText.join("\n\n"));
	if (depthText.length > 0) {
		parts.push(
			``,
			`## 以下原是深度注入（酒馆 in-chat）`,
			``,
			`<!-- 这些块在梨园此前从未生效过；转译后并入常驻 -->`,
			``,
			depthText.join("\n\n"),
		);
	}

	return {
		markdown: parts.join("\n").trim() + "\n",
		lines,
		samplers: { ...doc.samplers },
		usesLastUserMessage: r.usesLastUserMessage,
		unsupportedMacros: r.unsupported,
	};
}

/** 转译报告（与规矩文件同目录 .liyuan/ 下） */
export function translateReport(doc: PresetDoc, r: TranslateResult, sourceFile: string): string {
	const head = [
		`# 转译报告：${doc.name}`,
		``,
		`- 原文：\`${sourceFile}\`（未改动，可重新转译）`,
		`- 产物：本卡 ${USER_RULES_FILE}（${r.markdown.length.toLocaleString()} 字）`,
		`- 采样参数：${Object.keys(r.samplers).length} 项 → 已迁入 config.samplers（不再随提示词通道）`,
	];
	if (r.usesLastUserMessage.length > 0) {
		head.push(`- ⚠ 引用 {{lastusermessage}} 的块（逐拍宏，转译按空串求值）：${r.usesLastUserMessage.join("、")}`);
	}
	if (r.unsupportedMacros.length > 0) {
		head.push(`- ⚠ 清单外宏（原样保留在文本里）：${r.unsupportedMacros.join("、")}`);
	}
	head.push(``, `## 逐块去向`, ``);
	const rows = r.lines.map((l) => {
		const where = l.where ? `→ ${l.where === "before" ? "历史前段" : l.where === "after" ? "历史后段" : "深度注入段"}` : "";
		const why =
			l.action === "skipped-marker"
				? "（槽位：卡内容/历史在新架构里由装配与 AGENTS.md 链归位，不随预设走）"
				: l.action === "skipped-disabled"
					? "（预设里就是关的）"
					: l.action === "dropped-prefill"
						? "（酒馆预填位，梨园从未支持预填，8/23 定案丢弃）"
						: l.action === "skipped-empty"
							? "（无正文/缺失定义）"
							: "";
		return `- ${l.name} · ${l.chars.toLocaleString()} 字：${actionLabel(l.action)}${where}${why}`;
	});
	return [...head, ...rows, ""].join("\n");
}

const actionLabel = (a: TranslateLineItem["action"]): string => {
	switch (a) {
		case "included":
			return "收入规矩文件";
		case "skipped-marker":
			return "跳过";
		case "skipped-disabled":
			return "未启用";
		case "skipped-empty":
			return "无正文";
		case "dropped-prefill":
			return "丢弃";
	}
};
