/**
 * 访问密码（Web 登录）：scrypt 加盐哈希 + 持久化会话 token（纯函数，零 pi 依赖）。
 *
 * - 存储 `.liyuan/access.json`（.gitignore 已覆盖 .liyuan/*，不随仓库分发）；
 * - 未设置密码 = 完全开放（首次使用零门槛）；设置后 REST / WS / 媒体托管统一凭 Cookie 过闸；
 * - 设置/修改密码会清空全部旧 token（所有已登录设备下线），并为当前设备签发新 token。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const ACCESS_COOKIE = "liyuan_access";
const MAX_TOKENS = 20;

export interface AccessToken {
	id: string;
	createdAt: number;
}

export interface AccessData {
	salt: string;
	hash: string;
	tokens: AccessToken[];
}

function accessPath(cwd: string): string {
	return join(cwd, ".liyuan", "access.json");
}

export function loadAccess(cwd: string): AccessData | null {
	const p = accessPath(cwd);
	if (!existsSync(p)) return null;
	try {
		const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<AccessData>;
		if (typeof raw.salt !== "string" || typeof raw.hash !== "string") return null;
		const tokens = Array.isArray(raw.tokens)
			? raw.tokens.filter((t): t is AccessToken => !!t && typeof t.id === "string")
			: [];
		return { salt: raw.salt, hash: raw.hash, tokens };
	} catch {
		return null;
	}
}

function save(cwd: string, data: AccessData): void {
	mkdirSync(join(cwd, ".liyuan"), { recursive: true });
	writeFileSync(accessPath(cwd), JSON.stringify(data, null, "\t"));
}

function hashPassword(password: string, salt: string): string {
	return scryptSync(password, salt, 64).toString("hex");
}

/** 设置/修改密码：清空旧 token（所有设备下线），返回为当前设备签发的新 token */
export function setPassword(cwd: string, password: string): { data: AccessData; token: string } {
	const salt = randomBytes(16).toString("hex");
	const token = randomBytes(32).toString("hex");
	const data: AccessData = { salt, hash: hashPassword(password, salt), tokens: [{ id: token, createdAt: Date.now() }] };
	save(cwd, data);
	return { data, token };
}

/** 关闭密码：删除存储文件，恢复完全开放 */
export function clearPassword(cwd: string): void {
	try {
		rmSync(accessPath(cwd));
	} catch {
		/* 文件不存在即目标态 */
	}
}

export function verifyPassword(data: AccessData, password: string): boolean {
	const a = Buffer.from(hashPassword(password, data.salt), "hex");
	const b = Buffer.from(data.hash, "hex");
	return a.length === b.length && timingSafeEqual(a, b);
}

/** 登录成功后签发新 token 并落盘（FIFO，上限 MAX_TOKENS） */
export function issueToken(cwd: string, data: AccessData): string {
	const token = randomBytes(32).toString("hex");
	data.tokens.push({ id: token, createdAt: Date.now() });
	while (data.tokens.length > MAX_TOKENS) data.tokens.shift();
	save(cwd, data);
	return token;
}

export function verifyToken(data: AccessData, token: string | undefined): boolean {
	if (!token) return false;
	const t = Buffer.from(token);
	let ok = false;
	for (const item of data.tokens) {
		const id = Buffer.from(item.id);
		if (id.length === t.length && timingSafeEqual(id, t)) ok = true;
	}
	return ok;
}

/** 注销：吊销单个 token */
export function revokeToken(cwd: string, data: AccessData, token: string | undefined): void {
	if (!token) return;
	const before = data.tokens.length;
	data.tokens = data.tokens.filter((t) => t.id !== token);
	if (data.tokens.length !== before) save(cwd, data);
}

/** 解析 Cookie 请求头 */
export function parseCookies(header: string | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!header) return out;
	for (const part of header.split(";")) {
		const i = part.indexOf("=");
		if (i > 0) {
			try {
				out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
			} catch {
				/* 非法编码的杂项 cookie 忽略 */
			}
		}
	}
	return out;
}
