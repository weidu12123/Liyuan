/**
 * 命令黑名单（docs/PLAN-AGENT-BACK-TO-PI.md §二，2026-10-15 用户定案）：
 * agent 每次 bash 调用前对照的一份**用户可见可改的规则文件**（`<agentDir>/BASH_DENYLIST.txt`），
 * 命中即拒绝执行。设置 → agent 行为 →「后端操控」下面可查看与编辑。
 *
 * 写法同 Claude Code 的 `Bash(...)` 规则：一行一条，`#` 与空行是注释；字面文本 + `*` 通配；
 * 词边界匹配（`rm -rf /` 不误伤 `rm -rf /var/log`）；两侧统一归一化后比对。
 * 这份名单防手滑，不防蓄意绕过——脚本内部的破坏由资产快照兜底（PLAN-AGENT-BACK-TO-PI §四）。
 *
 * 纯函数 + 零模块级可变状态（jiti 二象性红线），可单测。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { rulesAgentDir } from "./user-rules.ts";

const DENYLIST_FILE = "BASH_DENYLIST.txt";

export function denylistPath(): string {
	return join(rulesAgentDir(), DENYLIST_FILE);
}

/** 随包默认（assets/BASH_DENYLIST.txt）：文件缺失时的播种源与读侧回退 */
function shippedDenylist(): string {
	return readFileSync(new URL("../assets/BASH_DENYLIST.txt", import.meta.url), "utf8");
}

/** 首次启动播种；已存在不覆盖——改了就是用户的 */
export function seedBashDenylist(agentDir: string): void {
	try {
		const target = join(agentDir, DENYLIST_FILE);
		if (existsSync(target)) return;
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(target, shippedDenylist(), "utf8");
	} catch {
		// 播种失败不拦启动：读侧有随包回退
	}
}

export interface DenylistRule {
	/** 文件里的原样一行——回执里给用户看的就是它 */
	raw: string;
	/** 归一化后的比对形态 */
	norm: string;
}

/**
 * 归一化（规则与命令两侧同用）：剥引号、`\/` 还原成 `/`、折叠空白、转小写、
 * 短选项排序并合并（故 -rf / -fr / -r -f / -f -r 四种写法等价）。
 */
export function normalizeCommand(input: string): string {
	let s = input.replace(/\\\//g, "/").replace(/["']/g, "");
	s = s.replace(/\s+/g, " ").trim().toLowerCase();
	const out: string[] = [];
	let pending: string[] = [];
	const flush = () => {
		if (pending.length) {
			out.push(`-${pending.sort().join("")}`);
			pending = [];
		}
	};
	for (const token of s.split(" ")) {
		if (/^-[a-z]+$/.test(token)) {
			pending.push(...token.slice(1));
			continue;
		}
		flush();
		out.push(token);
	}
	flush();
	return out.join(" ");
}

/** 规则文件 → 规则表（`#` 开头与空行跳过） */
export function parseDenylist(text: string): DenylistRule[] {
	const rules: DenylistRule[] = [];
	for (const line of text.split(/\r?\n/)) {
		const raw = line.trim();
		if (!raw || raw.startsWith("#")) continue;
		rules.push({ raw, norm: normalizeCommand(raw) });
	}
	return rules;
}

/** 规则 → 正则源码：字面文本转义；通配可跨空白（mkfs…/dev/… 这类要跨过中间参数） */
function globSource(pattern: string): string {
	return pattern
		.split("*")
		.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("[\\s\\S]*");
}

/** 词边界匹配：命中必须起于词首、止于词尾（`rm -rf /` 不误伤 `rm -rf /var/log`） */
export function matchDenylist(command: string, rules: DenylistRule[]): DenylistRule | undefined {
	const norm = normalizeCommand(command);
	if (!norm) return undefined;
	for (const rule of rules) {
		if (!rule.norm) continue;
		const re = new RegExp(globSource(rule.norm), "g");
		for (const m of norm.matchAll(re)) {
			const start = m.index ?? 0;
			const end = start + m[0].length;
			const before = start === 0 || norm[start - 1] === " ";
			const after = end === norm.length || norm[end] === " ";
			if (before && after) return rule;
		}
	}
	return undefined;
}

/** 生效内容：文件在则文件说了算，缺失回退随包默认（播种在启动时做） */
export function denylistContent(): string {
	try {
		const path = denylistPath();
		return existsSync(path) ? readFileSync(path, "utf8") : shippedDenylist();
	} catch {
		return shippedDenylist();
	}
}

/** 读规则（生效内容 → 规则表） */
export function readDenylistRules(): DenylistRule[] {
	return parseDenylist(denylistContent());
}
