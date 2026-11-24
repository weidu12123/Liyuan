/**
 * 用户规矩（刀2，docs/PLAN-AGENT-SLOTS.md §七）：把「追加 system」这个 agent 能力
 * 还给用户。两级文件，stage 每拍现读（materials 指纹缓存）：
 *
 * - 全局：`<agentDir>/APPEND_SYSTEM.md`（路径与 pi 的同名槽位一致；RP 会话已退出
 *   pi 的原生 append 发现——单一主人是 stage，不双份、且改动下一拍即生效，
 *   不必像 pi 原生那样重启）。
 * - 卡级：`cards/<卡>/APPEND_SYSTEM.md`（只对这张卡生效，接在全局之后）。
 *
 * 纯函数 + 零模块级可变状态（jiti 二象性红线），可单测。
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { getUiLocale, type UiLocale } from "./i18n/index.ts";

/** 用户规矩文件名（两级同名，对齐 pi 的 APPEND_SYSTEM.md 习惯） */
export const USER_RULES_FILE = "APPEND_SYSTEM.md";
/** agent 模式的全局追加槽：与 APPEND_SYSTEM.md 平级、二选一——扮演轮读前者，agent 轮读本文件 */
const AGENT_RULES_FILE = "AGENT_APPEND_SYSTEM.md";
/** 旁路助手（/btw）的全局追加槽：与 APPEND_SYSTEM.md、AGENT_APPEND_SYSTEM.md 平级 */
export const BTW_RULES_FILE = "BTW_APPEND_SYSTEM.md";

export type ShippedSlotName = "SYSTEM.md" | "APPEND_SYSTEM.md" | "AGENT_APPEND_SYSTEM.md" | "BTW_APPEND_SYSTEM.md";

const EN_SLOT_FILE: Record<ShippedSlotName, string> = {
	"SYSTEM.md": "SYSTEM.en.md",
	"APPEND_SYSTEM.md": "APPEND_SYSTEM.en.md",
	"AGENT_APPEND_SYSTEM.md": "AGENT_APPEND_SYSTEM.en.md",
	"BTW_APPEND_SYSTEM.md": "BTW_APPEND_SYSTEM.en.md",
};

const normText = (s: string): string => s.replace(/\r\n/g, "\n").trim();

/** 读取随包内置提示词正本（按 locale 取中文或英文；缺英文文件时回落中文） */
export function shippedSlotPrompt(slot: ShippedSlotName, locale: UiLocale = getUiLocale()): string {
	const readAsset = (name: string): string => {
		try {
			return readFileSync(new URL(`../assets/${name}`, import.meta.url), "utf8");
		} catch {
			return "";
		}
	};
	if (locale === "en") {
		const enText = readAsset(EN_SLOT_FILE[slot]);
		if (enText.trim()) return enText;
	}
	return readAsset(slot);
}

/** 判断某段文本是否仍等于随包默认正本（中文版或英文版任一匹配即视为未手改） */
export function isShippedSlotDefault(slot: ShippedSlotName, content: string): boolean {
	const n = normText(content);
	if (!n) return false;
	const zh = normText(shippedSlotPrompt(slot, "zh"));
	if (zh && n === zh) return true;
	const en = normText(shippedSlotPrompt(slot, "en"));
	return Boolean(en && n === en);
}

/**
 * 读取全局提示词槽位：
 * - 文件存在且已被用户手改 → 原样返回，绝不覆盖；
 * - 文件内容仍为未手改的随包默认正本（中或英）→ 自动按目标 locale 返回对应语言正本；
 * - 文件缺失 → 可选回落随包正本（fallbackToShipped 默认 false，与历史 readUserRules 行为兼容）。
 */
export function readLocalizedGlobalSlot(
	filePath: string,
	slot: ShippedSlotName,
	opts?: { locale?: UiLocale; fallbackToShipped?: boolean },
): string {
	const locale = opts?.locale ?? getUiLocale();
	if (existsSync(filePath)) {
		try {
			const raw = readFileSync(filePath, "utf-8");
			if (!raw.trim()) return opts?.fallbackToShipped ? shippedSlotPrompt(slot, locale) : raw;
			if (isShippedSlotDefault(slot, raw)) return shippedSlotPrompt(slot, locale);
			return raw;
		} catch {
			return opts?.fallbackToShipped ? shippedSlotPrompt(slot, locale) : "";
		}
	}
	return opts?.fallbackToShipped ? shippedSlotPrompt(slot, locale) : "";
}

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

export function btwRulesPath(): string {
	return join(rulesAgentDir(), BTW_RULES_FILE);
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

/** 项目级局部守则（`cards/<卡>/对话/<chatId>/APPEND_SYSTEM.md`）：第三层提示词，紧接卡级之后 */
export function chatRulesPath(chatDir: string): string {
	return join(chatDir, USER_RULES_FILE);
}

export interface UserRules {
	global: string;
	/** agent 模式的全局追加（AGENT_APPEND_SYSTEM.md）；扮演轮不读 */
	agent: string;
	/** 旁路助手的全局追加（BTW_APPEND_SYSTEM.md）；台前与写作轮不读 */
	btw?: string;
	card: string;
	/** 项目级局部守则（cards/<卡>/对话/<chatId>/APPEND_SYSTEM.md） */
	chat?: string;
}

export function readUserRules(cardDir: string, chatDir?: string | null): UserRules {
	const read = (p: string): string => {
		if (!existsSync(p)) return "";
		try {
			return readFileSync(p, "utf-8");
		} catch {
			return "";
		}
	};
	return {
		global: readLocalizedGlobalSlot(globalRulesPath(), "APPEND_SYSTEM.md"),
		agent: readLocalizedGlobalSlot(agentRulesPath(), "AGENT_APPEND_SYSTEM.md"),
		btw: readLocalizedGlobalSlot(btwRulesPath(), "BTW_APPEND_SYSTEM.md"),
		card: read(cardRulesPath(cardDir)),
		...(chatDir ? { chat: read(chatRulesPath(chatDir)) } : {}),
	};
}
