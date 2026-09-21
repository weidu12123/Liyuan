/**
 * 卡＝工作空间：卡文件夹（`cards/<卡文件夹>/`）与**子项目**（`对话/<对话id>/`）的
 * 发现、创建、元数据与卡级配置。
 *
 * 用户定的两层形状（2026-09-06，原话大意）：
 * **最外面一层是卡**；卡下面每一个**独立的对话是一个子项目**；一个子项目里**能包含很多会话**
 * ——「能在第二个会话窗口继续聊」的是同一个子项目里的另一个会话，「完全新开对话」才是新子项目。
 *
 * 这一层落到 pi 上正好有现成机制，不用新造：
 * - **同一子项目里再开一个会话** ＝ `runtime.newSession()`：它复用当前 `sessionDir`
 *   （`agent-session-runtime.ts:235`），本子项目的会话自然待在一起。
 * - **切到别的子项目** ＝ `switchSession(该子项目里的某个会话文件)`：`SessionManager.open`
 *   在没给 sessionDir 时**按文件父目录推导**（`session-manager.ts:1429`），sessionDir 随之换过去。
 * - **新开子项目** ＝ 建目录后 `SessionManager.create(cwd, 该子项目的会话目录)`。
 *
 * 目录名的唯一主人是 `src/paths.ts`；本模块只做「找 / 建 / 读写元数据」。
 */

import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { copyPathSafe } from "./fs-copy.ts";
import { readJsonFile } from "./jsonio.ts";
import { buildZipBuffer, extractZipFile } from "./ziplite.ts";
import {
	CARD_CONFIG_FILE,
	CARDS_ROOT,
	CHAT_META_FILE,
	CHAT_PANELS_FILE,
	CHAT_SESSIONS_DIR,
	CHAT_STATE_FILE,
	CHAT_WORLDLINE_FILE,
	CHATS_DIR,
	cardDirOf,
	cardsRoot,
	chatDirOf,
	chatSessionsDirOf,
	chatsRoot,
	dir,
	folderSafe,
} from "./paths.ts";
import type { RpConfig } from "./types.ts";

/** 卡本体可能的扩展名（与 `loadCardFile` 认的一致） */
const CARD_EXTS = [".png", ".json"];

export interface CardSpace {
	/** `cards/` 下的一级目录名 ＝ 这张卡的身份 */
	folder: string;
	/** 卡文件夹绝对路径 */
	dir: string;
	/** 卡本体文件绝对路径 */
	cardFile: string;
}

/** 子项目元数据（`对话/<id>/对话.json`） */
export interface ChatMeta {
	/** 显示名：用户可改；缺省由建立时间生成 */
	name?: string;
	/** ISO 时间 */
	createdAt: string;
	/**
	 * 子项目形态（docs/PLAN-AGENT-MODE.md §5.1）：缺省＝扮演（正文在树上）；`agent`＝正文住 `正文/` 章文件、
	 * 对话是讨论。新建时定，一个子项目一种形态，不在拍与拍之间切换。
	 */
	mode?: "agent";
}

export interface ChatInfo {
	id: string;
	/** 子项目目录绝对路径 */
	dir: string;
	/** 本子项目的会话目录（＝ 传给 SessionManager 的 sessionDir） */
	sessionsDir: string;
	meta: ChatMeta;
	/** 本子项目下的会话文件数 */
	sessionCount: number;
	/** 最近活动时间（取会话文件里最新的 mtime，无会话则取目录 mtime） */
	modified: number;
}

// ---------- 卡文件夹 ----------

/** 卡文件夹里的卡本体：排除 `卡.json` 这类固定成员，取字典序第一个 .png/.json */
export function cardFileIn(dirAbs: string): string | null {
	let names: string[];
	try {
		names = readdirSync(dirAbs);
	} catch {
		return null;
	}
	const hit = names
		.filter((n) => n !== CARD_CONFIG_FILE && CARD_EXTS.some((e) => n.toLowerCase().endsWith(e)))
		.filter((n) => {
			try {
				return statSync(join(dirAbs, n)).isFile();
			} catch {
				return false;
			}
		})
		.sort();
	return hit.length > 0 ? join(dirAbs, hit[0]) : null;
}

/** `cards/<folder>` 形态的引用 → CardSpace；不是卡文件夹（或里面没有卡本体）返回 null */
export function resolveCardSpace(cwd: string, ref: string): CardSpace | null {
	if (!ref) return null;
	const rel = ref.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
	const prefix = `${CARDS_ROOT}/`;
	if (!rel.startsWith(prefix)) return null;
	const rest = rel.slice(prefix.length);
	// ref 可能指到卡本体文件（cards/<文件夹>/<文件>.png）——认第一个路径段当文件夹
	const folder = rest.split("/")[0] ?? "";
	if (!folder) return null; // 裸 cards/：不认
	const dirAbs = cardDirOf(cwd, folder);
	if (!existsSync(dirAbs)) return null;
	const cardFile = cardFileIn(dirAbs);
	if (!cardFile) return null;
	return { folder, dir: dirAbs, cardFile };
}

/** 卡库：`cards/` 下每个含卡本体的一级目录 */
export function listCardSpaces(cwd: string): CardSpace[] {
	const root = cardsRoot(cwd);
	if (!existsSync(root)) return [];
	const out: CardSpace[] = [];
	for (const folder of readdirSync(root).sort()) {
		const dirAbs = join(root, folder);
		try {
			if (!statSync(dirAbs).isDirectory()) continue;
		} catch {
			continue;
		}
		const cardFile = cardFileIn(dirAbs);
		if (cardFile) out.push({ folder, dir: dirAbs, cardFile });
	}
	return out;
}

/** 取一个没被占用的文件夹名（同名卡加 `-2`、`-3`…） */
export function freeCardFolder(cwd: string, preferred: string): string {
	const base = folderSafe(preferred) || "card";
	let name = base;
	let n = 2;
	while (existsSync(cardDirOf(cwd, name))) {
		name = `${base}-${n}`;
		n += 1;
	}
	return name;
}

/**
 * 建一张卡的工作空间：`cards/<folder>/` + 把卡本体放进去。
 * `move=true` 时搬（迁移用），否则拷（导入用）。
 */
export function createCardSpace(
	cwd: string,
	cardFileAbs: string,
	preferredName: string,
	opts?: { move?: boolean; copy?: (from: string, to: string) => void },
): CardSpace {
	const folder = freeCardFolder(cwd, preferredName);
	const dirAbs = cardDirOf(cwd, folder);
	mkdirSync(dirAbs, { recursive: true });
	const dest = join(dirAbs, basename(cardFileAbs));
	if (opts?.move) {
		// 跨设备（Docker 里 assets/cards 是 bind mount、cards/ 在容器层）rename 会 EXDEV：
		// 整份拷过去再删源，语义仍是「搬」（失败时源还在，重跑幂等）。
		try {
			renameSync(cardFileAbs, dest);
		} catch (err) {
			const code = (err as { code?: string }).code;
			if (code !== "EXDEV" && code !== "EPERM") throw err;
			copyPathSafe(cardFileAbs, dest);
			rmSync(cardFileAbs, { force: true });
		}
	} else if (opts?.copy) opts.copy(cardFileAbs, dest);
	else throw new Error("createCardSpace：要么 move，要么给 copy");
	return { folder, dir: dirAbs, cardFile: dest };
}

// ---------- 子项目（一个独立的对话） ----------

/** 可排序、可读、Windows 合法（无冒号）的对话 id */
export function newChatId(now = new Date()): string {
	const p = (n: number, w = 2) => String(n).padStart(w, "0");
	const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
	return `${stamp}-${randomBytes(2).toString("hex")}`;
}

export function readChatMeta(cardDir: string, chatId: string): ChatMeta | null {
	const file = join(chatDirOf(cardDir, chatId), CHAT_META_FILE);
	if (!existsSync(file)) return null;
	try {
		const raw = readJsonFile(file) as Partial<ChatMeta>;
		return { createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "", ...(raw.name ? { name: raw.name } : {}), ...(raw.mode === "agent" ? { mode: "agent" as const } : {}) };
	} catch {
		return null;
	}
}

export function writeChatMeta(cardDir: string, chatId: string, meta: ChatMeta): void {
	const dirAbs = chatDirOf(cardDir, chatId);
	mkdirSync(dirAbs, { recursive: true });
	writeFileSync(join(dirAbs, CHAT_META_FILE), `${JSON.stringify(meta, null, "\t")}\n`, "utf8");
}

/** 改子项目显示名：只动 name，createdAt 原样保留；子项目不存在时报错 */
export function renameChat(cardDir: string, chatId: string, name: string): void {
	const old = readChatMeta(cardDir, chatId);
	if (!old) throw new Error(`子项目不存在：${chatId}`);
	const clean = name.replace(/[\r\n]+/g, " ").trim();
	if (!clean) throw new Error("名字不能为空");
	writeChatMeta(cardDir, chatId, { ...old, name: clean });
}

/** 删除整个子项目（`对话/<id>/` 整棵，含全部会话与世界状态）；不存在时报错 */
export function deleteChat(cardDir: string, chatId: string): void {
	const dirAbs = chatDirOf(cardDir, chatId);
	if (!existsSync(dirAbs)) throw new Error(`子项目不存在：${chatId}`);
	rmSync(dirAbs, { recursive: true, force: true });
}

// ---------- 子项目导入导出（刀5：项目化落到文件上，就该能整段搬走） ----------

/** 收集目录下全部文件的相对名（/ 分隔）与绝对路径 */
function collectFiles(rootAbs: string, rel = ""): Array<{ name: string; abs: string }> {
	const out: Array<{ name: string; abs: string }> = [];
	for (const f of readdirSync(join(rootAbs, rel))) {
		const r = rel ? `${rel}/${f}` : f;
		let st;
		try {
			st = statSync(join(rootAbs, r));
		} catch {
			continue;
		}
		if (st.isDirectory()) out.push(...collectFiles(rootAbs, r));
		else out.push({ name: r, abs: join(rootAbs, r) });
	}
	return out;
}

/**
 * 导出子项目：`对话/<id>/` 整棵打成 zip（store）。manifest 恒为第一条（格式与版本），
 * 其余条目名相对子项目根。返回 Buffer 与建议下载名。
 */
export function exportChatZip(cardDir: string, chatId: string): { data: Buffer; fileCount: number; fileName: string } {
	const dirAbs = chatDirOf(cardDir, chatId);
	if (!existsSync(dirAbs)) throw new Error(`子项目不存在：${chatId}`);
	const files = collectFiles(dirAbs);
	if (!files.length) throw new Error("子项目是空的，没有可导出的内容");
	const manifest = Buffer.from(
		JSON.stringify({ format: "liyuan-chat", version: 1, chatId, exportedAt: new Date().toISOString() }, null, "\t"),
		"utf8",
	);
	const data = buildZipBuffer([
		{ name: "chat-manifest.json", data: manifest },
		...files.map((f) => ({ name: f.name, data: readFileSync(f.abs) })),
	]);
	const meta = readChatMeta(cardDir, chatId);
	const safe = (meta?.name || chatId).replace(/[\\/:*?"<>|]/g, "_");
	return { data, fileCount: files.length, fileName: `${safe}.zip` };
}

/**
 * 导入子项目包：解包成新的 `对话/<新id>/`（不覆盖任何现有项目），并给每个会话文件
 * 追加 rp-card 重绑定行指向当前卡——跨卡导入的会话也能正确列出（同卡导入等于再钉一次，幂等）。
 * 临时目录放在卡文件夹内（同盘 rename，不撞跨盘 EXDEV）；`对话/` 只收正式项目，不受污染。
 */
export function importChatZip(cardDir: string, zip: Buffer, currentCardRef: string): { chatId: string; fileCount: number } {
	if (!existsSync(chatsRoot(cardDir))) mkdirSync(chatsRoot(cardDir), { recursive: true });
	const tmp = join(cardDir, `.chat-import-${randomBytes(4).toString("hex")}`);
	try {
		const zipPath = join(tmp, "in.zip");
		const ex = join(tmp, "ex");
		mkdirSync(ex, { recursive: true });
		writeFileSync(zipPath, zip);
		extractZipFile(zipPath, ex); // 自带 zip-slip 防御
		// 认根：条目直接铺在根上（梨园导出形态）；用户手动压时多包一层目录也认
		let root = ex;
		const top = readdirSync(ex);
		if (!top.some((f) => f === CHAT_SESSIONS_DIR || f === CHAT_META_FILE)) {
			const sub = top.filter((f) => {
				try {
					return statSync(join(ex, f)).isDirectory();
				} catch {
					return false;
				}
			});
			if (sub.length === 1) {
				const inner = readdirSync(join(ex, sub[0]));
				if (inner.some((f) => f === CHAT_SESSIONS_DIR || f === CHAT_META_FILE)) root = join(ex, sub[0]);
			}
		}
		if (!existsSync(join(root, CHAT_SESSIONS_DIR)) && !existsSync(join(root, CHAT_META_FILE))) {
			throw new Error("不是子项目包（找不到 会话/ 或 对话.json）");
		}
		let chatId = newChatId();
		while (existsSync(join(chatsRoot(cardDir), chatId))) chatId = newChatId();
		const dest = join(chatsRoot(cardDir), chatId);
		renameSync(root, dest);
		mkdirSync(join(dest, CHAT_SESSIONS_DIR), { recursive: true }); // 空项目包没有会话目录：补上
		rmSync(join(dest, "chat-manifest.json"), { force: true }); // 包元数据不进项目目录
		let fileCount = 0;
		const sdir = join(dest, CHAT_SESSIONS_DIR);
		for (const f of readdirSync(sdir)) {
			if (!f.endsWith(".jsonl")) continue;
			fileCount += 1;
			appendSessionCardRebind(join(sdir, f), currentCardRef);
		}
		return { chatId, fileCount };
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

/**
 * 给会话文件追加一条 rp-card 重绑定行（pi 的 `appendCustomEntry` 落行格式）。
 * parentId 链在追加场景用「文件里最后一条有 id 的条目」接上；接不上（空文件）就 null。
 */
export function appendSessionCardRebind(file: string, newRef: string): void {
	const lines = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
	if (!lines.length) return;
	let parentId: string | null = null;
	for (let i = lines.length - 1; i >= 0; i--) {
		try {
			const e = JSON.parse(lines[i]) as { id?: unknown };
			if (typeof e.id === "string" && e.id) {
				parentId = e.id;
				break;
			}
		} catch {
			/* 半行跳过 */
		}
	}
	const name = lastCardNameOf(lines);
	const entry = {
		type: "custom",
		customType: "rp-card",
		data: { card: newRef, ...(name ? { name } : {}) },
		id: randomBytes(4).toString("hex"),
		parentId,
		timestamp: new Date().toISOString(),
	};
	appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
}

/** 重绑定行带上原卡名（显示用）；从既有 rp-card 行里取最后一条的 name */
function lastCardNameOf(lines: string[]): string {
	for (let i = lines.length - 1; i >= 0; i--) {
		if (!lines[i].includes('"rp-card"')) continue;
		try {
			const e = JSON.parse(lines[i]) as { customType?: string; data?: { name?: unknown } };
			if (e.customType === "rp-card" && typeof e.data?.name === "string" && e.data.name) return e.data.name;
		} catch {
			/* 半行跳过 */
		}
	}
	return "";
}

/** 一个子项目的现状（会话数与最近活动时间取自会话目录，元数据缺失也照样列出） */
export function chatInfo(cardDir: string, chatId: string): ChatInfo {
	const dirAbs = chatDirOf(cardDir, chatId);
	const sessionsDir = chatSessionsDirOf(cardDir, chatId);
	let sessionCount = 0;
	let modified = 0;
	try {
		for (const f of readdirSync(sessionsDir)) {
			if (!f.endsWith(".jsonl")) continue;
			sessionCount += 1;
			const m = statSync(join(sessionsDir, f)).mtimeMs;
			if (m > modified) modified = m;
		}
	} catch {
		/* 还没有会话目录：算 0 条 */
	}
	if (modified === 0) {
		try {
			modified = statSync(dirAbs).mtimeMs;
		} catch {
			modified = 0;
		}
	}
	const meta = readChatMeta(cardDir, chatId) ?? { createdAt: "" };
	return { id: chatId, dir: dirAbs, sessionsDir, meta, sessionCount, modified };
}

/** 本卡的全部子项目，按最近活动倒序 */
export function listChats(cardDir: string): ChatInfo[] {
	const root = chatsRoot(cardDir);
	if (!existsSync(root)) return [];
	const out: ChatInfo[] = [];
	for (const id of readdirSync(root)) {
		try {
			if (!statSync(join(root, id)).isDirectory()) continue;
		} catch {
			continue;
		}
		out.push(chatInfo(cardDir, id));
	}
	// 最近活动倒序；时间戳并列（同一毫秒写入）时按 id 倒序兜底——id 本身就是可排序的时间戳，
	// 不给兜底的话顺序由 readdir 决定，同一份磁盘上两次调用可能不一样。
	return out.sort((a, b) => b.modified - a.modified || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** 建一个新的子项目（＝「完全新开对话」）：目录 + 会话目录 + 元数据 */
export function createChat(cardDir: string, opts?: { id?: string; name?: string; now?: Date; mode?: "agent" }): ChatInfo {
	const now = opts?.now ?? new Date();
	const id = opts?.id ?? newChatId(now);
	mkdirSync(chatSessionsDirOf(cardDir, id), { recursive: true });
	writeChatMeta(cardDir, id, { createdAt: now.toISOString(), ...(opts?.name ? { name: opts.name } : {}), ...(opts?.mode === "agent" ? { mode: "agent" } : {}) });
	return chatInfo(cardDir, id);
}

/** 最近活动的子项目（没有则 null——调用方决定是建一个还是报错） */
export function latestChat(cardDir: string): ChatInfo | null {
	return listChats(cardDir)[0] ?? null;
}

// ---------- 「当前是哪个子项目」——从会话目录反推，不另存状态 ----------

/**
 * 会话目录（`<子项目>/会话`）→ 子项目目录。
 *
 * **会话就住在子项目里，所以目录本身就是答案**：不需要在进程里另存一份「当前哪个子项目」，
 * 也不需要把它传遍所有函数——凡是拿得到 `sessionManager.getSessionDir()` 的地方都能自己算出来。
 * 不是这个形状（老布局的 `~/.liyuan/agent/sessions/--<cwd>--/`、内存会话）返回 null。
 */
export function chatDirOfSessionDir(sessionDir: string | undefined): string | null {
	if (!sessionDir) return null;
	const norm = sessionDir.replace(/[\\/]+$/, "");
	if (basename(norm) !== CHAT_SESSIONS_DIR) return null;
	const parent = dirname(norm);
	return parent && parent !== norm ? parent : null;
}

/** 会话文件 → 子项目目录（`<子项目>/会话/x.jsonl`） */
export function chatDirOfSessionFile(sessionFile: string | undefined): string | null {
	if (!sessionFile) return null;
	return chatDirOfSessionDir(dirname(sessionFile));
}

/** 会话目录所属子项目的形态：`agent` 子项目返回 "agent"；扮演子项目、老布局、内存会话返回 undefined */
export function chatModeOfSessionDir(sessionDir: string | undefined): "agent" | undefined {
	const chatDir = chatDirOfSessionDir(sessionDir);
	const cardDir = chatDir ? cardDirOfChatDir(chatDir) : null;
	if (!chatDir || !cardDir) return undefined;
	return readChatMeta(cardDir, basename(chatDir))?.mode;
}

/** 子项目目录 → 卡文件夹目录（`cards/<卡>/<对话>/<id>` 的上两级）；不是这个形状返回 null */
export function cardDirOfChatDir(chatDir: string): string | null {
	const up = dirname(chatDir);
	if (basename(up) !== CHATS_DIR) return null;
	const cardDir = dirname(up);
	return cardDir && cardDir !== up ? cardDir : null;
}

/** 子项目级数据的种类 → 文件名（老布局回落时按 sessionId 分文件，见 chatDataPath） */
const CHAT_DATA_FILES = {
	state: CHAT_STATE_FILE,
	worldline: CHAT_WORLDLINE_FILE,
	panels: CHAT_PANELS_FILE,
} as const;

const LEGACY_DIR_KEYS = { state: "state", worldline: "worldline", panels: "artifacts" } as const;

export type ChatDataKind = keyof typeof CHAT_DATA_FILES;

/**
 * 子项目级数据的落点：**全仓唯一一处**「新布局还是老布局」的分叉。
 *
 * 新布局（会话在 `<子项目>/会话/` 里）→ `<子项目>/世界状态.json` 之类，一个子项目一份，
 * 同一子项目里的多个会话看的是同一份账本——这正是「在第二个窗口继续聊」的意思。
 * 老布局（没迁移过 / 内存会话 / 从别处打开的会话）→ 回落今天的 `.liyuan-state/<sessionId>.json`。
 */
export function chatDataPath(
	cwd: string,
	sessionDir: string | undefined,
	sessionId: string,
	kind: ChatDataKind,
): string {
	const chatDir = chatDirOfSessionDir(sessionDir);
	if (chatDir) return join(chatDir, CHAT_DATA_FILES[kind]);
	return join(dir(cwd, LEGACY_DIR_KEYS[kind]), `${sessionId}.json`);
}

// ---------- 卡级配置 ----------

/**
 * 跟卡走的字段（2026-09-05 用户定案的 10 项里去掉 `card` 自己——
 * 「当前打开哪张卡」是全局单值，不是某张卡的属性）。
 * 其余 9 项留在产品根的 `liyuan.config.json`。
 * 2026-09-12 追加沙箱两项：卡外永久授权是这张卡的声明（docs/PLAN-SANDBOX.md），只由沙箱读写。
 */
export const CARD_LEVEL_KEYS = [
	"lorebooks",
	"userName",
	"userPersona",
	"displayName",
	"greeting",
	"greetingIndex",
	"disabledLore",
	"cardSkinOff",
	"preset",
	"sandboxAllow",
	"sandboxBash",
] as const satisfies ReadonlyArray<keyof RpConfig>;

export type CardLevelKey = (typeof CARD_LEVEL_KEYS)[number];
export type CardConfig = Partial<Pick<RpConfig, CardLevelKey>>;

const CARD_LEVEL_SET = new Set<string>(CARD_LEVEL_KEYS);

export function cardConfigPath(cardDir: string): string {
	return join(cardDir, CARD_CONFIG_FILE);
}

/** 读卡级配置；文件不存在/坏了都当「这张卡没有自己的意见」（全部继承全局） */
export function loadCardConfig(cardDir: string): CardConfig {
	const file = cardConfigPath(cardDir);
	if (!existsSync(file)) return {};
	let raw: Record<string, unknown>;
	try {
		raw = readJsonFile(file) as Record<string, unknown>;
	} catch {
		return {};
	}
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(raw ?? {})) {
		if (CARD_LEVEL_SET.has(k) && v !== undefined) out[k] = v;
	}
	return out as CardConfig;
}

/** 写卡级配置（只落跟卡走的字段；`undefined`/`null` ＝ 删掉这条意见、回到继承全局） */
export function saveCardConfig(cardDir: string, patch: Record<string, unknown>): CardConfig {
	const next: Record<string, unknown> = { ...loadCardConfig(cardDir) };
	for (const [k, v] of Object.entries(patch)) {
		if (!CARD_LEVEL_SET.has(k)) continue;
		if (v === undefined || v === null) delete next[k];
		else next[k] = v;
	}
	mkdirSync(cardDir, { recursive: true });
	writeFileSync(cardConfigPath(cardDir), `${JSON.stringify(next, null, "\t")}\n`, "utf8");
	return next as CardConfig;
}

/**
 * 合并语义（2026-09-06 定案）：**逐字段赢者独占，卡级盖全局**。
 * 卡级没写这条 ⇒ 继承全局；写了 ⇒ 这条对本卡切断继承。
 *
 * 为什么不是叠加：pi 那边只有 `AGENTS.md` 是真叠加，而它叠的是**文本**；
 * `SYSTEM.md`/`APPEND_SYSTEM.md` 都是赢者独占。配置这一格是标量与清单，
 * 逐字段覆盖既最可预测，也天然给出「这张卡不继承那条全局偏好」的表达方式。
 */
export function mergeCardConfig(global: RpConfig, card: CardConfig): RpConfig {
	const out = { ...global } as Record<string, unknown>;
	for (const k of CARD_LEVEL_KEYS) {
		const v = (card as Record<string, unknown>)[k];
		if (v !== undefined) out[k] = v;
	}
	return out as RpConfig;
}
