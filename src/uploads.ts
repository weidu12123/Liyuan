/**
 * 上传区：用户经 Web 端上传的文件落 `.liyuan-uploads/`（旧 `.rp-uploads/` 启动时迁移）。
 * agent 用通用能力（read/ls）自由处置。
 */

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { DIRS, UPLOAD_PREFIX, dir } from "./paths.ts";

export interface UploadMeta {
	/** 落盘文件名（含时间戳前缀） */
	name: string;
	/** 相对 cwd 的路径（写进提示词与消息，agent 用 read 工具取内容） */
	file: string;
	bytes: number;
	mtimeMs: number;
}

export function uploadsDir(cwd: string): string {
	return dir(cwd, "uploads");
}

/** 上传原名 → 安全文件名（去目录、替换 Windows 保留字符、限长、保扩展名） */
export function sanitizeUploadName(name: string): string {
	// 浏览器给的是纯文件名，但不信任输入：剥掉一切路径成分
	const base = basename(name.replace(/\\/g, "/"));
	const ext = extname(base).replace(/[^.\w-]/g, "").slice(0, 16);
	let stem = base.slice(0, base.length - extname(base).length);
	stem = stem
		.replace(/[\\/:*?"<>|\s-]+/g, "-")
		.replace(/^[-.\s]+|[-.\s]+$/g, "")
		.slice(0, 80);
	return (stem || "file") + ext;
}

const two = (n: number) => String(n).padStart(2, "0");

/** 保存上传内容；同名自动加序号，绝不覆盖既有文件。返回相对路径。 */
export function saveUpload(cwd: string, rawName: string, data: Buffer): { file: string; bytes: number } {
	const dir = uploadsDir(cwd);
	mkdirSync(dir, { recursive: true });
	const d = new Date();
	const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
	const safe = sanitizeUploadName(rawName);
	const ext = extname(safe);
	const stem = safe.slice(0, safe.length - ext.length);
	let filename = `${stamp}-${safe}`;
	for (let i = 2; existsSync(join(dir, filename)); i++) {
		filename = `${stamp}-${stem}-${i}${ext}`;
	}
	writeFileSync(join(dir, filename), data);
	return { file: `${UPLOAD_PREFIX}${filename}`, bytes: data.length };
}

/** 列出上传区全部文件，新的在前（目录不存在时安静返回空） */
export function listUploads(cwd: string): UploadMeta[] {
	return listDirFiles(cwd, DIRS.uploads);
}

/** AI 出图等本地媒体（show_image → .liyuan-media/），新的在前 */
export function mediaDir(cwd: string): string {
	return dir(cwd, "media");
}

export function listMedia(cwd: string): UploadMeta[] {
	return listDirFiles(cwd, DIRS.media);
}

function listDirFiles(cwd: string, relDir: string): UploadMeta[] {
	const dir = join(cwd, relDir);
	if (!existsSync(dir)) return [];
	const out: UploadMeta[] = [];
	for (const f of readdirSync(dir)) {
		try {
			const st = statSync(join(dir, f));
			if (!st.isFile()) continue;
			// 只列常见图片/文件，跳过隐藏
			if (f.startsWith(".")) continue;
			out.push({ name: f, file: `${relDir}/${f}`, bytes: st.size, mtimeMs: st.mtimeMs });
		} catch {
			// 单个文件不可读不影响其余
		}
	}
	out.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return out;
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n}B`;
	if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
	return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

/** 上传区速览一行（每轮末端注入用）；空文件夹返回 null（不注入） */
export function formatUploadIndex(uploads: UploadMeta[], max = 6): string | null {
	if (uploads.length === 0) return null;
	const shown = uploads.slice(0, max).map((u) => `${u.name}(${formatBytes(u.bytes)})`);
	const rest = uploads.length > max ? `（另有 ${uploads.length - max} 个旧文件，ls ${DIRS.uploads}/ 可见全部）` : "";
	return shown.join("、") + rest;
}
