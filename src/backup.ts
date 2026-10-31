/**
 * 项目完整备份（PLAN-PANELS-V2 §2.12）：把「回档能恢复什么」的闭包整体打包/还原。
 *
 * 语义：不做按卡拆包、不做「和现有项目合并」——备份的是整个项目的用户数据，
 * 恢复 = 精确回到备份当时的项目状态（换机/搬家/灾备）。
 *
 * 范围（用户数据闭包，不含程序代码）：
 * - 项目根数据目录：.liyuan-{state,artifacts,assistant,lore,memory,media,skills,uploads,audio,worldline}
 * - 素材：assets/{cards,lorebooks,presets,personas}、skills/（自建+预设生成）
 * - 配置：liyuan.config.json / liyuan.agent.json / liyuan.agent.meta.json / liyuan-preset.json /
 *   liyuan-profiles/ / .liyuan-personas.json / .liyuan-mcp.json
 * - .liyuan/ 下的用户数据文件（access.json / output-contract* / preset-override.json / settings.json）
 *   ——明确排除 .liyuan/extensions/（产品接线层源码，绝不随恢复覆盖）
 * - 本项目的剧情会话目录（~/.liyuan/agent/sessions/<encoded-cwd>/），不碰其它项目
 *
 * 明确不含：node_modules / .git / web/dist / .liyuan-cache（含备份自身）/ 其它项目的会话。
 *
 * 安全：zip 打包仅 method 0（store），名字与中央目录自写；解压复用 ziplite 的 zip-slip 防御。
 * 恢复前先把当前项目打成一份快照（仍是一份可再导入的备份），恢复失败也不丢旧数据。
 */

import {
	closeSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { DIRS, MCP_CONFIG_FILE, PERSONAS_FILE } from "./paths.ts";
import { copyPathSafe } from "./fs-copy.ts";
import { extractZipFile } from "./ziplite.ts";

const BACKUP_FORMAT = "liyuan-backup";
const BACKUP_VERSION = 1;
/** 备份/恢复入口统一落 .liyuan-cache/backup（自身不在备份范围内，避免递归） */
export const BACKUP_ROOT = `${DIRS.cache}/backup`;
const RESTORE_SUBDIR = "restore";
const PENDING_FILE = "pending.json";

/** 备份**不**收的数据目录：cache 里住着 BACKUP_ROOT 自己，收进来会递归 */
const EXCLUDED_DIR_KEYS: ReadonlySet<keyof typeof DIRS> = new Set(["cache"]);

/**
 * 项目根数据目录（整体拷贝，不含任何程序代码）。
 * ⚠ 目录名的唯一主人是 `src/paths.ts` 的 `DIRS`——这里只声明「哪些 key 不收」，
 * 不再手抄名字（原先是 10 个字面量的平行清单，`DIRS` 加了目录它不会跟着长）。
 */
const PROJECT_DIR_SCOPES = [
	...(Object.keys(DIRS) as Array<keyof typeof DIRS>).filter((k) => !EXCLUDED_DIR_KEYS.has(k)).map((k) => DIRS[k]),
	"assets/cards",
	"assets/lorebooks",
	"assets/presets",
	"assets/personas",
	"liyuan-profiles",
	"skills",
];

/** 项目根单文件配置 */
const PROJECT_FILE_SCOPES = [
	"liyuan.config.json",
	"liyuan.agent.json",
	"liyuan.agent.meta.json",
	"liyuan-preset.json",
	PERSONAS_FILE,
	MCP_CONFIG_FILE,
];

/** .liyuan/ 下随用户走的数据文件（白名单；extensions 是源码，永不进备份） */
const DOT_LIYUAN_DATA_FILES = [
	"access.json",
	"preset-override.json",
	"settings.json",
];

interface BackupManifest {
	format: "liyuan-backup";
	version: 1;
	appVersion: string;
	createdAt: string;
	projectDir: string;
	fileCount: number;
}

/** 本项目专属的剧情会话目录（与 SessionManager 默认编码一致） */
export function projectSessionDir(cwd: string, agentHome: string): string {
	const resolvedCwd = resolve(cwd);
	const safe = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(agentHome, "sessions", safe);
}

function appVersion(cwd: string): string {
	try {
		return (JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

function walkDir(dir: string): string[] {
	const out: string[] = [];
	const stack = [dir];
	while (stack.length) {
		const cur = stack.pop()!;
		let ents: ReturnType<typeof readdirSync>;
		try {
			ents = readdirSync(cur, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of ents) {
			const p = join(cur, e.name);
			if (e.isDirectory()) stack.push(p);
			else if (e.isFile()) out.push(p);
		}
	}
	return out.sort();
}

const toPosix = (p: string) => p.replace(/\\/g, "/");

/** 收集项目内数据文件（zip 内置于 project/ 前缀下） */
function collectProjectFiles(cwd: string): Array<{ name: string; absPath: string }> {
	const out: Array<{ name: string; absPath: string }> = [];
	for (const rel of PROJECT_DIR_SCOPES) {
		const abs = join(cwd, rel);
		if (!existsSync(abs)) continue;
		for (const f of walkDir(abs)) {
			out.push({ name: `project/${toPosix(relative(cwd, f))}`, absPath: f });
		}
	}
	for (const rel of DOT_LIYUAN_DATA_FILES) {
		const abs = join(cwd, ".liyuan", rel);
		if (existsSync(abs)) out.push({ name: `project/.liyuan/${rel}`, absPath: abs });
	}
	for (const rel of PROJECT_FILE_SCOPES) {
		const abs = join(cwd, rel);
		if (existsSync(abs)) out.push({ name: `project/${rel}`, absPath: abs });
	}
	return out;
}

/** 收集本项目剧情会话文件（zip 内置于 sessions/ 前缀下） */
function collectSessionFiles(cwd: string, agentHome: string): Array<{ name: string; absPath: string }> {
	const dir = projectSessionDir(cwd, agentHome);
	if (!existsSync(dir)) return [];
	return walkDir(dir).map((f) => ({
		name: `sessions/${toPosix(relative(dir, f))}`,
		absPath: f,
	}));
}

// ---------- zip（method 0 store） ----------

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

export function crc32(buf: Buffer): number {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
	const y = d.getFullYear() >= 1980 ? d.getFullYear() - 1980 : 0;
	const date = (y << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
	const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
	return { time, date };
}

function buildLocalHeader(nameBuf: Buffer, crc: number, size: number, dos: { time: number; date: number }): Buffer {
	const b = Buffer.alloc(30);
	b.writeUInt32LE(0x04034b50, 0);
	b.writeUInt16LE(20, 4); // version needed
	b.writeUInt16LE(0x0800, 6); // UTF-8
	b.writeUInt16LE(0, 8); // store
	b.writeUInt16LE(dos.time, 10);
	b.writeUInt16LE(dos.date, 12);
	b.writeUInt32LE(crc, 14);
	b.writeUInt32LE(size, 18);
	b.writeUInt32LE(size, 22);
	b.writeUInt16LE(nameBuf.length, 26);
	b.writeUInt16LE(0, 28); // extra len
	return Buffer.concat([b, nameBuf]);
}

function buildCentralHeader(
	nameBuf: Buffer,
	crc: number,
	size: number,
	dos: { time: number; date: number },
	offset: number,
): Buffer {
	const b = Buffer.alloc(46);
	b.writeUInt32LE(0x02014b50, 0);
	b.writeUInt16LE(20, 4); // version made by
	b.writeUInt16LE(20, 6); // version needed
	b.writeUInt16LE(0x0800, 8); // UTF-8
	b.writeUInt16LE(0, 10); // store
	b.writeUInt16LE(dos.time, 12);
	b.writeUInt16LE(dos.date, 14);
	b.writeUInt32LE(crc, 16);
	b.writeUInt32LE(size, 20);
	b.writeUInt32LE(size, 24);
	b.writeUInt16LE(nameBuf.length, 28);
	b.writeUInt16LE(0, 30); // extra len
	b.writeUInt16LE(0, 32); // comment len
	b.writeUInt16LE(0, 34); // disk start
	b.writeUInt16LE(0, 36); // internal attrs
	b.writeUInt32LE(0, 38); // external attrs
	b.writeUInt32LE(offset, 42);
	return Buffer.concat([b, nameBuf]);
}

function buildEocd(count: number, cdSize: number, cdOffset: number): Buffer {
	const b = Buffer.alloc(22);
	b.writeUInt32LE(0x06054b50, 0);
	b.writeUInt16LE(0, 4);
	b.writeUInt16LE(0, 6);
	b.writeUInt16LE(count, 8);
	b.writeUInt16LE(count, 10);
	b.writeUInt32LE(cdSize, 12);
	b.writeUInt32LE(cdOffset, 16);
	b.writeUInt16LE(0, 20);
	return b;
}

function writeAll(fd: number, buf: Buffer): void {
	let off = 0;
	while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
}

/**
 * 构建完整备份 zip。manifest 恒为第一条。逐文件读、逐文件写（峰值内存 = 最大单个文件）。
 */
export function buildBackupZip(cwd: string, agentHome: string, outPath: string): { count: number; bytes: number } {
	const project = collectProjectFiles(cwd);
	const sessions = collectSessionFiles(cwd, agentHome);
	const manifest: BackupManifest = {
		format: BACKUP_FORMAT,
		version: BACKUP_VERSION,
		appVersion: appVersion(cwd),
		createdAt: new Date().toISOString(),
		projectDir: cwd.split(/[/\\]/).filter(Boolean).pop() || cwd,
		fileCount: project.length + sessions.length + 1,
	};

	mkdirSync(dirname(outPath), { recursive: true });
	const fd = openSync(outPath, "w");
	let offset = 0;
	let bytes = 0;
	const central: Buffer[] = [];
	const addEntry = (name: string, data: Buffer, mtime: Date) => {
		const crc = crc32(data);
		const nameBuf = Buffer.from(name, "utf8");
		const dos = dosDateTime(mtime);
		const local = buildLocalHeader(nameBuf, crc, data.length, dos);
		writeAll(fd, local);
		writeAll(fd, data);
		central.push(buildCentralHeader(nameBuf, crc, data.length, dos, offset));
		offset += local.length + data.length;
		bytes += data.length;
	};
	addEntry("manifest.json", Buffer.from(`${JSON.stringify(manifest, null, "\t")}\n`, "utf8"), new Date());
	for (const f of [...project, ...sessions]) {
		addEntry(f.name, readFileSync(f.absPath), statSync(f.absPath).mtime);
	}
	const cdOffset = offset;
	let cdSize = 0;
	for (const c of central) {
		writeAll(fd, c);
		cdSize += c.length;
	}
	writeAll(fd, buildEocd(central.length, cdSize, cdOffset));
	closeSync(fd);
	return { count: central.length, bytes };
}

// ---------- 恢复 ----------

export function validateExtractedBackup(extractedDir: string): BackupManifest {
	const mpath = join(extractedDir, "manifest.json");
	if (!existsSync(mpath)) throw new Error("不是有效的梨园备份（缺 manifest.json）");
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(mpath, "utf8")) as unknown;
	} catch {
		throw new Error("备份 manifest.json 无法解析");
	}
	const m = raw as Partial<BackupManifest>;
	if (m?.format !== BACKUP_FORMAT || m?.version !== BACKUP_VERSION) throw new Error("备份格式不兼容（请用同版本梨园导出的备份）");
	return m as BackupManifest;
}

/** 接收备份 zip：解压到暂存目录 + 校验 + 写待恢复标记。返回 manifest（供前端展示）。 */
export function stageRestore(cwd: string, zipPath: string): BackupManifest {
	const rdir = join(cwd, BACKUP_ROOT, RESTORE_SUBDIR);
	rmSync(rdir, { recursive: true, force: true });
	mkdirSync(rdir, { recursive: true });
	const extracted = join(rdir, "extracted");
	extractZipFile(zipPath, extracted);
	const manifest = validateExtractedBackup(extracted);
	writeFileSync(
		join(rdir, PENDING_FILE),
		`${JSON.stringify({ extractedDir: extracted, createdAt: new Date().toISOString() }, null, "\t")}\n`,
		"utf8",
	);
	return manifest;
}

interface RestorePending {
	extractedDir: string;
	createdAt: string;
}

function readRestorePending(cwd: string): RestorePending | null {
	const p = join(cwd, BACKUP_ROOT, RESTORE_SUBDIR, PENDING_FILE);
	if (!existsSync(p)) return null;
	try {
		const j = JSON.parse(readFileSync(p, "utf8")) as RestorePending;
		if (j?.extractedDir && existsSync(j.extractedDir)) return j;
		return null;
	} catch {
		return null;
	}
}

/**
 * 只清空目录的**子项**，保留目录本身。
 * 用于 Docker bind mount / named volume：对挂载点顶层 rmdir 会 EBUSY（且不该删挂载点），
 * 逐个删子项再重新填充才是安全、可回退的「精确覆盖」。
 */
function clearDirContents(dir: string): void {
	if (!existsSync(dir)) return;
	for (const name of readdirSync(dir)) {
		rmSync(join(dir, name), { recursive: true, force: true });
	}
}

/** 把暂存的备份精确铺回项目（不清空 .liyuan/extensions 等源码） */
function restoreFromExtracted(cwd: string, agentHome: string, extractedDir: string): void {
	const projectRoot = join(extractedDir, "project");
	const sessionsRoot = join(extractedDir, "sessions");

	for (const rel of PROJECT_DIR_SCOPES) {
		const src = join(projectRoot, rel);
		const dst = join(cwd, rel);
		clearDirContents(dst);
		if (existsSync(src)) {
			mkdirSync(dirname(dst), { recursive: true });
			copyPathSafe(src, dst);
		}
	}
	for (const rel of DOT_LIYUAN_DATA_FILES) {
		const src = join(projectRoot, ".liyuan", rel);
		const dst = join(cwd, ".liyuan", rel);
		if (existsSync(src)) {
			mkdirSync(dirname(dst), { recursive: true });
			copyFileSync(src, dst);
		}
		// 备份里没有的 .liyuan 数据文件一律不删：避免误伤源码旁的产物，也规避 Docker 软链被换
	}
	for (const rel of PROJECT_FILE_SCOPES) {
		const src = join(projectRoot, rel);
		const dst = join(cwd, rel);
		if (existsSync(src)) {
			mkdirSync(dirname(dst), { recursive: true });
			copyFileSync(src, dst);
		}
		// 单文件配置只覆盖不删除——Docker 下 liyuan.config.json / liyuan.agent.json 是软链，
		// 绝不能 rm 后再建（会把软链换成普通文件、与 /app/config 绑定断开）
	}

	const sessionDir = projectSessionDir(cwd, agentHome);
	clearDirContents(sessionDir);
	if (existsSync(sessionsRoot)) {
		mkdirSync(sessionDir, { recursive: true });
		copyPathSafe(sessionsRoot, sessionDir);
	}
}

/**
 * 启动时应用待恢复备份（有 pending 才动）：先快照当前项目，再精确铺回；成败都清 pending。
 * 返回日志行（供 main.ts 打印）。
 */
export function applyPendingBackupRestore(cwd: string, agentHome: string): string[] {
	const pending = readRestorePending(cwd);
	if (!pending) return [];
	const log: string[] = [];
	const snap = join(cwd, BACKUP_ROOT, `pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`);
	try {
		buildBackupZip(cwd, agentHome, snap);
		log.push(`恢复前快照已保留：${relative(cwd, snap)}`);
	} catch (err) {
		log.push(`恢复前快照失败（中止恢复，旧数据不动）：${err instanceof Error ? err.message : String(err)}`);
		rmSync(join(cwd, BACKUP_ROOT, RESTORE_SUBDIR), { recursive: true, force: true });
		return log;
	}
	try {
		restoreFromExtracted(cwd, agentHome, pending.extractedDir);
		log.push("备份已恢复（会话/记忆/素材/配置一并就位）");
	} catch (err) {
		log.push(`恢复失败（可用恢复前快照重新导入）：${err instanceof Error ? err.message : String(err)}`);
	}
	rmSync(join(cwd, BACKUP_ROOT, RESTORE_SUBDIR), { recursive: true, force: true });
	return log;
}
