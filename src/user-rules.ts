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

/** 用户规矩文件名（两级同名，对齐 pi 的 APPEND_SYSTEM.md 习惯） */
export const USER_RULES_FILE = "APPEND_SYSTEM.md";
/** agent 模式的全局追加槽：与 APPEND_SYSTEM.md 平级、二选一——扮演轮读前者，agent 轮读本文件 */
const AGENT_RULES_FILE = "AGENT_APPEND_SYSTEM.md";
/** 旁路助手（/btw）的全局追加槽：与 APPEND_SYSTEM.md、AGENT_APPEND_SYSTEM.md 平级 */
export const BTW_RULES_FILE = "BTW_APPEND_SYSTEM.md";

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
		global: read(globalRulesPath()),
		agent: read(agentRulesPath()),
		btw: read(btwRulesPath()),
		card: read(cardRulesPath(cardDir)),
		...(chatDir ? { chat: read(chatRulesPath(chatDir)) } : {}),
	};
}
