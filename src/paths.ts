/**
 * 梨园数据路径（产品命名，与上游 pi 运行时目录解耦）。
 *
 * 不可改（上游锁定）：
 * Agent 内核（@liyuan/agent-runtime，见 packages/）使用 configDir=".liyuan"。
 * 旧布局 `.pi/`、`.rp-*`、`rp.config.json` 在 migrateLegacyLayout 时迁移。
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";

/** 项目配置主文件（新） */
export const CONFIG_FILE = "liyuan.config.json";
/** 旧配置文件名（兼容读） */
export const CONFIG_FILE_LEGACY = "rp.config.json";

/** 预设默认文件名 */
export const PRESET_FILE = "liyuan-preset.json";
export const PRESET_FILE_LEGACY = "rp-preset.json";

/** 在 POSIX 上 path.isAbsolute 不认盘符；会话里常存 Windows 绝对路径 */
function isAbsPath(p: string): boolean {
	if (isAbsolute(p)) return true;
	// C:\… / C:/…
	return /^[a-zA-Z]:[\\/]/.test(p);
}

/**
 * 角色卡路径是否同一张卡（会话列表过滤用）。
 * 兼容相对/绝对、Windows 反斜杠、./ 前缀、盘符大小写（含 Linux 宿主读 Windows 会话标记）。
 */
export function sameCardPath(a: string | undefined, b: string | undefined, projectCwd: string): boolean {
	if (!a || !b) return false;
	if (a === b) return true;
	const key = (p: string) => {
		const s = p.replace(/\\/g, "/").trim().replace(/^\.\//, "");
		const abs = isAbsPath(s) ? s : join(projectCwd, s).replace(/\\/g, "/");
		// normalize 在 POSIX 上对 `E:/a/b` 较保守，统一成 / 后再比
		return normalize(abs).replace(/\\/g, "/").toLowerCase();
	};
	try {
		return key(a) === key(b);
	} catch {
		return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
	}
}

/** 数据目录（相对项目根） */
export const DIRS = {
	state: ".liyuan-state",
	artifacts: ".liyuan-artifacts",
	cache: ".liyuan-cache",
	lore: ".liyuan-lore",
	media: ".liyuan-media",
	audio: ".liyuan-audio",
	skills: ".liyuan-skills",
	uploads: ".liyuan-uploads",
	worldline: ".liyuan-worldline",
	/** 内置向量记忆（正文库 / 外部资料库） */
	memory: ".liyuan-memory",
} as const;

/**
 * 全局共享的库（相对项目根）：世界书库、预设库、全局技能根、办事笔记。
 * 卡级只存指针指向它们（见下方两层布局注释）；工作模式沙箱把它们当只读根（docs/PLAN-SANDBOX.md）。
 */
export const SHARED_LIBRARY_DIRS = ["assets/lorebooks", "assets/presets", "skills", DIRS.skills] as const;

/**
 * `target` 是否落在 `root` 之内（含 root 本身）。两边都应是已 resolve 的绝对路径；
 * 符号链接不在此处理，调用方按需先取 realpath。Windows 下 relative 不分大小写、跨盘符返回绝对路径。
 */
export function insidePath(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + (process.platform === "win32" ? "\\" : "/")));
}

const LEGACY_DIRS: Record<keyof typeof DIRS, string> = {
	state: ".rp-state",
	artifacts: ".rp-artifacts",
	cache: ".rp-cache",
	lore: ".rp-lore",
	media: ".rp-media",
	audio: ".rp-audio",
	skills: ".rp-skills",
	uploads: ".rp-uploads",
	worldline: ".rp-worldline",
	memory: ".rp-memory", // 未使用过；占位
};

// ---------- 卡＝工作空间：两层布局（2026-09-06 用户定案 B）----------
//
// 用户定的形状（原话大意）：**最外面一层是卡**；卡下面是**子项目——每一个独立的对话
// 就是一个子项目**；一个子项目里**能包含很多会话**（一种是能在第二个会话窗口继续聊
// 的同一段剧情，另一种是完全新开的对话＝新的子项目）。
//
//   cards/<卡文件夹>/                 ← 一张卡＝一个工作空间
//     <卡本体>.png|json
//     卡.json                         ← 卡级配置（跟卡走的字段，见 src/cardspace.ts）
//     补充设定集.json                  ← agent 写的世界书（旧 .liyuan-lore/<卡名>.json）
//     技能/  记忆/
//     对话/<对话id>/                   ← 子项目：一个独立的对话
//       对话.json                     ← 子项目元数据（名字/建于何时）
//       会话/*.jsonl                   ← pi 的 sessionDir：本子项目的多个会话
//       世界状态.json  世界线.json  面板.json  向量记忆/
//
// `assets/cards/` 退成**导入暂存区**；世界书库（assets/lorebooks）与预设库仍全局共享，
// 卡级只存「挂哪几本 / 用哪份预设」的指针。
/** 卡库根（相对产品根） */
export const CARDS_ROOT = "cards";
/** 卡文件夹内：卡级配置 */
export const CARD_CONFIG_FILE = "卡.json";
/** 卡文件夹内：agent 写的补充设定集（旧 .liyuan-lore/<卡名>.json） */
export const CARD_OVERLAY_FILE = "补充设定集.json";
/** 卡文件夹内：本卡的技能 */
export const CARD_SKILLS_DIR = "技能";
/** 卡文件夹内：代码与内容的创作稿、原包快照。 */
export const CARD_AUTHORING_DIR = "创作";
/** 卡文件夹内：跨对话记忆（第二步，见 src/card-memory.ts） */
export const CARD_MEMORY_DIR = "记忆";
/** 记忆/ 内：常驻摘要（每拍进上下文的那一层，有字数上限） */
export const CARD_MEMORY_RESIDENT_FILE = "常驻摘要.md";
/** 记忆/ 内：合并后的手册（按局分块，供检索层；人可读可改） */
export const CARD_MEMORY_HANDBOOK_FILE = "记忆.md";
/** 记忆/ 内：一局一份复盘（一局＝一个子项目）；删掉一份＝遗忘只由它支撑的记忆 */
export const CARD_MEMORY_RECAPS_DIR = "局";
/** 记忆/ 内：harness 的记账（哪局复盘到哪、上次合并见过哪些文件）；不是记忆内容 */
export const CARD_MEMORY_MANIFEST_FILE = ".清单.json";
/** 卡文件夹内：子项目层 */
export const CHATS_DIR = "对话";
/** 子项目内：元数据 */
export const CHAT_META_FILE = "对话.json";
/** 子项目内：会话目录（＝ pi 的 sessionDir） */
export const CHAT_SESSIONS_DIR = "会话";
/** agent 模式子项目的稿子目录（docs/PLAN-AGENT-CODING.md §三）：一章一个 .md，按文件名字典序即稿子顺序 */
export const CHAT_STORY_DIR = "正文";
/** agent 模式子项目的快照仓（docs/PLAN-AGENT-CODING.md §四）：内容寻址对象＋检查点清单，只增不改 */
export const CHAT_HISTORY_DIR = "历史";
/** 子项目内：世界状态账本（旧 .liyuan-state/<sessionId>.json） */
export const CHAT_STATE_FILE = "世界状态.json";
/** 子项目内：世界线元数据（旧 .liyuan-worldline/<sessionId>.json） */
export const CHAT_WORLDLINE_FILE = "世界线.json";
/** 子项目内：面板（旧 .liyuan-artifacts/<sessionId>.json） */
export const CHAT_PANELS_FILE = "面板.json";
/** 子项目内：向量记忆（旧 .liyuan-memory/scopes/<cardHash>__<sessionId>/） */
export const CHAT_MEMORY_DIR = "向量记忆";

/** 文件名安全化：卡名可能含 `\/:*?"<>|`，落盘前统一换 `_`（唯一实现，别再各写一份） */
export function nameSafe(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, "_");
}

/**
 * 文件**夹**名：在 `nameSafe` 之上再去掉结尾的空白与点——Windows 建不出这种目录名。
 * （`nameSafe` 不做这一步：既有落点如补充设定集文件名必须逐字不变。）
 */
export function folderSafe(name: string): string {
	return nameSafe(name).replace(/[\s.]+$/, "").trim();
}

export function cardsRoot(cwd: string): string {
	return join(cwd, CARDS_ROOT);
}
/** 卡文件夹绝对路径（folder ＝ cards/ 下的一级目录名） */
export function cardDirOf(cwd: string, folder: string): string {
	return join(cardsRoot(cwd), folder);
}
export function chatsRoot(cardDir: string): string {
	return join(cardDir, CHATS_DIR);
}
export function chatDirOf(cardDir: string, chatId: string): string {
	return join(chatsRoot(cardDir), chatId);
}
/** 子项目的会话目录：显式传给 SessionManager 的 sessionDir（pi 的 create/open/list 都收） */
export function chatSessionsDirOf(cardDir: string, chatId: string): string {
	return join(chatDirOf(cardDir, chatId), CHAT_SESSIONS_DIR);
}
/** 卡的跨对话记忆目录 */
export function cardMemoryDirOf(cardDir: string): string {
	return join(cardDir, CARD_MEMORY_DIR);
}

export const PERSONAS_FILE = ".liyuan-personas.json";
/** MCP 外设配置（项目根单文件；`src/mcp.ts` 同名再导出给既有调用方） */
export const MCP_CONFIG_FILE = ".liyuan-mcp.json";
export const PERSONAS_FILE_LEGACY = ".rp-personas.json";

export function dir(cwd: string, key: keyof typeof DIRS): string {
	return join(cwd, DIRS[key]);
}

/** 消息/API 里存的相对路径前缀（uploads） */
export const UPLOAD_PREFIX = `${DIRS.uploads}/`;
export const UPLOAD_PREFIX_LEGACY = ".rp-uploads/";
export const MEDIA_PREFIX = `${DIRS.media}/`;
export const MEDIA_PREFIX_LEGACY = ".rp-media/";
export const SKILLS_PREFIX = `${DIRS.skills}/`;

/** 把历史消息里的旧前缀归一到新前缀（读路径用） */
export function normalizeDataPath(p: string): string {
	if (p.startsWith(UPLOAD_PREFIX_LEGACY)) return UPLOAD_PREFIX + p.slice(UPLOAD_PREFIX_LEGACY.length);
	if (p.startsWith(MEDIA_PREFIX_LEGACY)) return MEDIA_PREFIX + p.slice(MEDIA_PREFIX_LEGACY.length);
	if (p.startsWith(".rp-skills/")) return `${DIRS.skills}/${p.slice(".rp-skills/".length)}`;
	if (p.startsWith(".rp-lore/")) return `${DIRS.lore}/${p.slice(".rp-lore/".length)}`;
	return p;
}

/**
 * 启动时迁移旧布局：目录/文件若仅有旧名则 rename 为新名。
 * 安全：新名已存在则不覆盖，只继续用新名。
 */
export function migrateLegacyLayout(cwd: string): string[] {
	const log: string[] = [];
	const move = (fromRel: string, toRel: string) => {
		const from = join(cwd, fromRel);
		const to = join(cwd, toRel);
		if (!existsSync(from)) return;
		if (existsSync(to)) {
			log.push(`保留 ${toRel}（已存在，跳过旧 ${fromRel}）`);
			return;
		}
		try {
			renameSync(from, to);
			log.push(`${fromRel} → ${toRel}`);
		} catch (err) {
			log.push(`迁移失败 ${fromRel}：${err instanceof Error ? err.message : String(err)}`);
		}
	};

	// 上游 harness 项目配置目录：.pi → .liyuan
	move(".pi", ".liyuan");

	for (const key of Object.keys(DIRS) as (keyof typeof DIRS)[]) {
		move(LEGACY_DIRS[key], DIRS[key]);
	}
	move(CONFIG_FILE_LEGACY, CONFIG_FILE);
	move(`${CONFIG_FILE_LEGACY}.bak`, `${CONFIG_FILE}.bak`);
	move(PRESET_FILE_LEGACY, PRESET_FILE);
	move(PERSONAS_FILE_LEGACY, PERSONAS_FILE);

	return log;
}

/**
 * 解析配置文件路径：优先新名，否则旧名（迁移前热读）。
 */
export function resolveConfigPath(cwd: string): string {
	const neu = join(cwd, CONFIG_FILE);
	if (existsSync(neu)) return neu;
	const old = join(cwd, CONFIG_FILE_LEGACY);
	if (existsSync(old)) return old;
	return neu; // 默认写新名
}

export function resolvePresetPath(cwd: string, configured?: string): string {
	if (configured) {
		const p = configured.startsWith(".") || configured.includes("/") || configured.includes("\\")
			? join(cwd, configured)
			: join(cwd, configured);
		if (existsSync(p)) return p;
		// 配置写着 rp-preset.json 时尝试新名
		if (configured === PRESET_FILE_LEGACY || configured.endsWith(PRESET_FILE_LEGACY)) {
			const alt = join(cwd, PRESET_FILE);
			if (existsSync(alt)) return alt;
		}
		return p;
	}
	const neu = join(cwd, PRESET_FILE);
	if (existsSync(neu)) return neu;
	return join(cwd, PRESET_FILE_LEGACY);
}

/**
 * 将用户级 agent 目录指到 ~/.liyuan/agent。
 * 须在 createAgentSession / getAgentDir 之前调用。
 * 只认 LIYUAN_CODING_AGENT_DIR；PI_CODING_AGENT_DIR 仅写出给 vendored pi 内部代码读
 * （packages/coding-agent/src/config.ts）——不再当输入：上游 pi 用户若给自己配过该
 * 变量，旧逻辑会把梨园 agentHome 指进用户的 pi 目录，models.json 随之被整体覆写
 * （2026-09-12 用户定案切除此耦合）。
 *
 * pi→liyuan 改名后遗症：历史上会话可能只在 ~/.pi/agent，或两边各有一份。
 * 启动时把旧树里「缺失 / 更新」的文件并入 ~/.liyuan/agent（不删旧树、不覆盖更新的新文件）。
 */
export function preferLiyuanAgentHome(): string {
	const target = join(homedir(), ".liyuan", "agent");
	const resolved = process.env.LIYUAN_CODING_AGENT_DIR || target;
	process.env.LIYUAN_CODING_AGENT_DIR = resolved;
	process.env.PI_CODING_AGENT_DIR = resolved;
	try {
		mkdirSync(resolved, { recursive: true });
		const legacy = join(homedir(), ".pi", "agent");
		// 仅当实际落点是默认 ~/.liyuan/agent 时，才从旧 pi 树合并（避免用户显式指到别处时误拷）
		if (existsSync(legacy) && resolved === target) {
			// 合并结果进 lastAgentMergeLog，启动日志用 takeAgentMergeLog()
			mergePiAgentTree(legacy, resolved);
		}
	} catch {
		// ignore
	}
	return resolved;
}

/** 最近一次 preferLiyuanAgentHome / merge 产生的说明（启动日志用） */
let lastAgentMergeLog: string[] = [];

export function takeAgentMergeLog(): string[] {
	const out = lastAgentMergeLog;
	lastAgentMergeLog = [];
	return out;
}

/**
 * 播种两个全局提示词槽位（刀1 立位 / 2026-09-08 重构定形）：
 * - SYSTEM.md：**环境底座**，pi 形状的最小基线（一句身份＋工作区事实），不规定行为
 * - APPEND_SYSTEM.md：**扮演定义的默认值**（一拍/稿纸/检索/岔口）——「梨园是谁、怎么演」
 *   是用户的选择（沉浸式扮演 vs 全局 agent），住可编辑的追加槽，不进 harness 底座
 *
 * 两个都只在缺失时播种：改过就是用户的。删除 SYSTEM.md ⇒ pi 回落 coding 基座，
 * roleplay 扩展退随包底座并每拍告警（刀1 语义不变）。
 *
 * 一次性迁移：刀1 版把扮演定义错放在 SYSTEM.md 里（越权，用户 2026-09-08 定性）。
 * 现存 SYSTEM.md 若以旧版开场句开头 ⇒ 那是梨园自己发的旧底座（未按用户意思改过），
 * 把它的全文挪去 APPEND_SYSTEM.md（若 APPEND 尚不存在），SYSTEM.md 换成新底座。
 * 用户自己改写过的（不以旧开场句开头）一律不动。
 */
const LEGACY_SYSTEM_OPENING = "你在 **梨园**（Liyuan）里担任角色扮演 agent";

export function seedStageSystemPrompt(cwd: string, agentDir: string): void {
	try {
		mkdirSync(agentDir, { recursive: true });
		const shipped = (name: string) => join(cwd, "assets", name);
		const target = join(agentDir, "SYSTEM.md");
		const appendTarget = join(agentDir, "APPEND_SYSTEM.md");

		// 迁移：旧底座（扮演定义错位）→ 挪进追加槽，底座换新
		if (existsSync(target)) {
			const current = readFileSync(target, "utf8");
			if (current.startsWith(LEGACY_SYSTEM_OPENING)) {
				if (!existsSync(appendTarget)) {
					writeFileSync(appendTarget, current, "utf8");
					lastAgentMergeLog.push(`迁移：旧 SYSTEM.md 的扮演定义已挪至 APPEND_SYSTEM.md`);
				}
				if (existsSync(shipped("SYSTEM.md"))) {
					copyFileSync(shipped("SYSTEM.md"), target);
					lastAgentMergeLog.push(`迁移：SYSTEM.md 已换成最小环境底座`);
				}
			}
		} else if (existsSync(shipped("SYSTEM.md"))) {
			copyFileSync(shipped("SYSTEM.md"), target);
			lastAgentMergeLog.push(`已播种环境底座 SYSTEM.md → ${target}`);
		}

		if (!existsSync(appendTarget) && existsSync(shipped("APPEND_SYSTEM.md"))) {
			copyFileSync(shipped("APPEND_SYSTEM.md"), appendTarget);
			lastAgentMergeLog.push(`已播种扮演定义默认值 APPEND_SYSTEM.md → ${appendTarget}`);
		}

		// agent 模式的追加槽（与 APPEND_SYSTEM.md 平级二选一）：同一规则，缺失才播种
		const agentAppendTarget = join(agentDir, "AGENT_APPEND_SYSTEM.md");
		if (!existsSync(agentAppendTarget) && existsSync(shipped("AGENT_APPEND_SYSTEM.md"))) {
			copyFileSync(shipped("AGENT_APPEND_SYSTEM.md"), agentAppendTarget);
			lastAgentMergeLog.push(`已播种 agent 模式定义默认值 AGENT_APPEND_SYSTEM.md → ${agentAppendTarget}`);
		}
	} catch (err) {
		console.error(`[liyuan] 播种提示词槽位失败：${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * 发行的内置 skill（assets/skills/<name>/SKILL.md）播种到全局技能根 skills/<name>/：
 * 目标目录不存在才播种；存在就是用户的，不覆盖不合并（与 SYSTEM.md 同一规则）。
 */
export function seedBuiltinSkills(cwd: string): string[] {
	const shipped = join(cwd, "assets", "skills");
	const seeded: string[] = [];
	if (!existsSync(shipped)) return seeded;
	// 整包复制（含 references/ 等子目录）：skill 可能是文件包，不是单个 SKILL.md
	const copyTree = (from: string, to: string) => {
		mkdirSync(to, { recursive: true });
		for (const entry of readdirSync(from, { withFileTypes: true })) {
			if (entry.isDirectory()) copyTree(join(from, entry.name), join(to, entry.name));
			else if (entry.isFile()) copyFileSync(join(from, entry.name), join(to, entry.name));
		}
	};
	try {
		for (const entry of readdirSync(shipped, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			if (!existsSync(join(shipped, entry.name, "SKILL.md"))) continue;
			const targetDir = join(cwd, "skills", entry.name);
			if (existsSync(targetDir)) continue;
			copyTree(join(shipped, entry.name), targetDir);
			seeded.push(entry.name);
			lastAgentMergeLog.push(`已播种内置 skill ${entry.name} → ${targetDir}`);
		}
	} catch (err) {
		console.error(`[liyuan] 播种内置 skill 失败：${err instanceof Error ? err.message : String(err)}`);
	}
	return seeded;
}

/**
 * 把 ~/.pi/agent 中缺失或更新的文件并入 ~/.liyuan/agent。
 * - models/auth/settings：目标不存在则拷贝
 * - sessions/**：目标不存在，或源 mtime 更新 → 拷贝（绝不覆盖更新的目标）
 */
function mergePiAgentTree(legacyAgent: string, targetAgent: string): string[] {
	const log: string[] = [];
	for (const name of ["models.json", "auth.json", "settings.json"]) {
		const from = join(legacyAgent, name);
		const to = join(targetAgent, name);
		if (existsSync(from) && !existsSync(to)) {
			try {
				copyFileSync(from, to);
				log.push(`配置 ${name} ← ~/.pi/agent`);
			} catch (err) {
				log.push(`配置 ${name} 拷贝失败：${err instanceof Error ? err.message : String(err)}`);
			}
		}
	}

	const legacySessions = join(legacyAgent, "sessions");
	const targetSessions = join(targetAgent, "sessions");
	if (!existsSync(legacySessions)) {
		lastAgentMergeLog = log;
		return log;
	}

	let copied = 0;
	let skippedNewer = 0;
	const walk = (dir: string) => {
		let ents: ReturnType<typeof readdirSync>;
		try {
			ents = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of ents) {
			const from = join(dir, e.name);
			if (e.isDirectory()) {
				walk(from);
				continue;
			}
			if (!e.isFile()) continue;
			const rel = relative(legacySessions, from);
			const to = join(targetSessions, rel);
			try {
				const fromSt = statSync(from);
				if (!existsSync(to)) {
					mkdirSync(dirname(to), { recursive: true });
					copyFileSync(from, to);
					copied++;
					continue;
				}
				const toSt = statSync(to);
				// 旧树更新 → 并入；目标更新或相同 → 跳过
				if (fromSt.mtimeMs > toSt.mtimeMs + 1000) {
					copyFileSync(from, to);
					copied++;
				} else if (toSt.mtimeMs > fromSt.mtimeMs + 1000) {
					skippedNewer++;
				}
			} catch (err) {
				log.push(`会话 ${rel} 合并失败：${err instanceof Error ? err.message : String(err)}`);
			}
		}
	};
	walk(legacySessions);
	if (copied > 0) log.push(`会话从 ~/.pi/agent 并入 ${copied} 个文件`);
	// 仅诊断：有并入动作时才附带说明「旧树有较旧副本被跳过」
	if (copied > 0 && skippedNewer > 0) {
		log.push(`另有 ${skippedNewer} 个会话以 ~/.liyuan/agent 为准（新树更新）`);
	}
	lastAgentMergeLog = log;
	return log;
}
