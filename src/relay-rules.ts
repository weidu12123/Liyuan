/**
 * 外置发送副本脱敏规则表（<agentDir>/RELAY_RULES.txt）。
 *
 * 对齐 src/bash-denylist.ts 模式：随包播种空模板、用户可见可改、零模块级可变状态、
 * 仅在后端发包副本生效，绝不把第三方或中文词表硬编码进引擎源码（《梨园铁律》第三条）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { rulesAgentDir } from "./user-rules.ts";

export const RELAY_RULES_FILE = "RELAY_RULES.txt";

const FALLBACK_TEMPLATE = [
	"# 梨园发包脱敏规则表（<agentDir>/RELAY_RULES.txt）",
	"# 语法：单段文本=词内打断（首字符后插 U+200B）；old => new=替身替换；# 开头与空行为注释。",
	"",
].join("\n");

export interface RelayRules {
	splits: string[];
	replacements: Array<{ from: string; to: string }>;
}

export function relayRulesPath(): string {
	return join(rulesAgentDir(), RELAY_RULES_FILE);
}

function shippedRelayRules(): string {
	try {
		return readFileSync(new URL("../assets/RELAY_RULES.txt", import.meta.url), "utf8");
	} catch {
		return FALLBACK_TEMPLATE;
	}
}

/** 首次启动播种；已存在则保留用户编辑内容 */
export function seedRelayRules(agentDir: string): void {
	try {
		const target = join(agentDir, RELAY_RULES_FILE);
		if (existsSync(target)) return;
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(target, shippedRelayRules(), "utf8");
	} catch {
		// 播种失败不阻塞启动：读侧回退模板
	}
}

/**
 * 解析文本为打断列表与替身列表：
 * - `#` 开头与空行跳过
 * - `old => new` 解析为替换项（忽略左侧为空或右侧为空的无效行），按左侧长度降序排列
 * - 其余非空行解析为词内打断项，按长度降序排列并去重
 */
export function parseRelayRules(text: string): RelayRules {
	const splitSet = new Set<string>();
	const repMap = new Map<string, string>();

	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const arrowIdx = trimmed.indexOf("=>");
		if (arrowIdx >= 0) {
			const from = trimmed.slice(0, arrowIdx).trim();
			const to = trimmed.slice(arrowIdx + 2).trim();
			if (from && to && from !== to) {
				repMap.set(from, to);
			}
			continue;
		}
		if (trimmed.length >= 2) {
			splitSet.add(trimmed);
		}
	}

	const splits = [...splitSet].sort((a, b) => b.length - a.length);
	const replacements = [...repMap.entries()]
		.map(([from, to]) => ({ from, to }))
		.sort((a, b) => b.from.length - a.from.length);

	return { splits, replacements };
}

/** 生效规则原文：磁盘文件存在以文件为准，否则回退随包默认模板 */
export function relayRulesContent(): string {
	try {
		const p = relayRulesPath();
		return existsSync(p) ? readFileSync(p, "utf8") : shippedRelayRules();
	} catch {
		return shippedRelayRules();
	}
}

/** 读取并解析当前生效的用户脱敏规则 */
export function readRelayRules(): RelayRules {
	return parseRelayRules(relayRulesContent());
}
