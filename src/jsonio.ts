/**
 * JSON 文件读取：统一剥 UTF-8 BOM。
 * Windows 编辑器（记事本等）保存 JSON 常带 BOM，JSON.parse 会直接抛
 * SyntaxError（实证：rp-preset.json 被编辑后带 BOM，session_start 整体装载失败，
 * 且 state/缓存等带 try/catch 的读取会被 BOM「静默」打成默认值）。
 * 本项目一切磁盘 JSON 读取必须走这里。
 */

import { readFileSync } from "node:fs";

export function stripBom(s: string): string {
	return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function readJsonFile(path: string): unknown {
	return JSON.parse(stripBom(readFileSync(path, "utf8")));
}
