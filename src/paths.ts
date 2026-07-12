/**
 * 梨园数据路径（产品命名，与上游 pi 运行时目录解耦）。
 *
 * 不可改（上游锁定）：
 * Agent 内核（@liyuan/agent-runtime，见 packages/）使用 configDir=".liyuan"。
 * 旧布局 `.pi/`、`.rp-*`、`rp.config.json` 在 migrateLegacyLayout 时迁移。
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";

/** 项目配置主文件（新） */
export const CONFIG_FILE = "liyuan.config.json";
/** 旧配置文件名（兼容读） */
export const CONFIG_FILE_LEGACY = "rp.config.json";

/** 预设默认文件名 */
export const PRESET_FILE = "liyuan-preset.json";
export const PRESET_FILE_LEGACY = "rp-preset.json";

/** 数据目录（相对项目根） */
export const DIRS = {
	state: ".liyuan-state",
	artifacts: ".liyuan-artifacts",
	cache: ".liyuan-cache",
	codex: ".liyuan-codex",
	lore: ".liyuan-lore",
	media: ".liyuan-media",
	audio: ".liyuan-audio",
	skills: ".liyuan-skills",
	uploads: ".liyuan-uploads",
	worldline: ".liyuan-worldline",
} as const;

const LEGACY_DIRS: Record<keyof typeof DIRS, string> = {
	state: ".rp-state",
	artifacts: ".rp-artifacts",
	cache: ".rp-cache",
	codex: ".rp-codex",
	lore: ".rp-lore",
	media: ".rp-media",
	audio: ".rp-audio",
	skills: ".rp-skills",
	uploads: ".rp-uploads",
	worldline: ".rp-worldline",
};

export const PERSONAS_FILE = ".liyuan-personas.json";
export const PERSONAS_FILE_LEGACY = ".rp-personas.json";

export function dir(cwd: string, key: keyof typeof DIRS): string {
	return join(cwd, DIRS[key]);
}

/** 消息/API 里存的相对路径前缀（uploads） */
export const UPLOAD_PREFIX = `${DIRS.uploads}/`;
export const UPLOAD_PREFIX_LEGACY = ".rp-uploads/";
export const MEDIA_PREFIX = `${DIRS.media}/`;
export const MEDIA_PREFIX_LEGACY = ".rp-media/";

/** 把历史消息里的旧前缀归一到新前缀（读路径用） */
export function normalizeDataPath(p: string): string {
	if (p.startsWith(UPLOAD_PREFIX_LEGACY)) return UPLOAD_PREFIX + p.slice(UPLOAD_PREFIX_LEGACY.length);
	if (p.startsWith(MEDIA_PREFIX_LEGACY)) return MEDIA_PREFIX + p.slice(MEDIA_PREFIX_LEGACY.length);
	if (p.startsWith(".rp-skills/")) return `${DIRS.skills}/${p.slice(".rp-skills/".length)}`;
	if (p.startsWith(".rp-codex/")) return `${DIRS.codex}/${p.slice(".rp-codex/".length)}`;
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
 * fork 后环境变量为 LIYUAN_CODING_AGENT_DIR；同时写 PI_* 兼容旧代码路径。
 *
 * pi→liyuan 改名后遗症：历史上会话可能只在 ~/.pi/agent，或两边各有一份。
 * 启动时把旧树里「缺失 / 更新」的文件并入 ~/.liyuan/agent（不删旧树、不覆盖更新的新文件）。
 */
export function preferLiyuanAgentHome(): string {
	const target = join(homedir(), ".liyuan", "agent");
	if (!process.env.LIYUAN_CODING_AGENT_DIR && !process.env.PI_CODING_AGENT_DIR) {
		process.env.LIYUAN_CODING_AGENT_DIR = target;
		process.env.PI_CODING_AGENT_DIR = target;
	} else if (process.env.LIYUAN_CODING_AGENT_DIR && !process.env.PI_CODING_AGENT_DIR) {
		process.env.PI_CODING_AGENT_DIR = process.env.LIYUAN_CODING_AGENT_DIR;
	} else if (process.env.PI_CODING_AGENT_DIR && !process.env.LIYUAN_CODING_AGENT_DIR) {
		process.env.LIYUAN_CODING_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;
	}
	const resolved = process.env.LIYUAN_CODING_AGENT_DIR || process.env.PI_CODING_AGENT_DIR || target;
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
