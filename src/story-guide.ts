/**
 * 刀4 的引导面：**给定当前卡，剧情会话的 sessionDir 在哪、新对话建哪个子项目、
 * 列表从哪聚合**。main.ts 只在这里做决定，pi 的调用（create/open/list）在调用点。
 *
 * 设计前提（docs/PLAN-CARD-SPACE.md §三）：**不换 cwd**——卡目录经「当前卡文件夹」进入；
 * 会话引导用显式 sessionDir（pi 的 create/open/continueRecent/list 全都收这个参数）。
 * 当前卡不是 cards/ 里的文件夹（老布局/用户素材在项目外）⇒ 一律回落 pi 默认目录，
 * 行为与今天一致。
 */

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { createChat, latestChat, listCardSpaces, listChats, resolveCardSpace, type CardSpace, type ChatInfo } from "./cardspace.ts";
import { cardsRoot, chatSessionsDirOf } from "./paths.ts";

/** 引导决定的输出：main.ts 拿它去 SessionManager */
export interface StorySessionTarget {
	/** 当前卡的文件夹（不是 cards/ 卡时为 null） */
	space: CardSpace | null;
	/** 引导到的子项目（cards/ 卡但还没有任何子项目时为 null——调用方建） */
	chat: ChatInfo | null;
	/** 该给的 sessionDir（cards/ 卡 ⇒ 最新子项目的会话目录；否则 undefined ⇒ pi 默认） */
	sessionDir?: string;
}

/**
 * 启动/换卡后的引导：找到当前卡的最新子项目（= 最近在聊的那段对话）。
 * config.card 指着 cards/<文件夹>/… 里的卡本体时按两层布局走；否则一律 null/undefined。
 */
export function storySessionTarget(cwd: string, configCard: string): StorySessionTarget {
	const space = resolveCardSpace(cwd, configCard) ?? byCardName(cwd, configCard);
	if (!space) return { space: null, chat: null };
	const chat = latestChat(space.dir);
	return { space, chat, sessionDir: chat ? chat.sessionsDir : undefined };
}

/** config.card 里可能存的是「卡本体相对路径」（cards/<文件夹>/<文件>）——按路径认 */
function byCardName(_cwd: string, _ref: string): CardSpace | null {
	return null; // resolveCardSpace 已覆盖 cards/ 前缀；别的写法一律走老路径
}

/**
 * 「完全新开对话」＝新建一个子项目（建目录 + 会话目录 + 元数据），返回它的 sessionDir。
 * name 给了就写进 对话.json（新建项目弹窗的命名），缺省由前端给默认名。
 * 当前卡不在 cards/ 里 ⇒ 返回 undefined：调用方走 runtime.newSession()（同 sessionDir
 * 再开一个会话——老布局下「新对话」与今天语义一致）。
 */
export function newChatSessionDir(cwd: string, configCard: string, name?: string, mode?: "agent"): string | undefined {
	const space = resolveCardSpace(cwd, configCard);
	if (!space) return undefined;
	return createChat(space.dir, { ...(name ? { name } : {}), ...(mode ? { mode } : {}) }).sessionsDir;
}

/**
 * 卡空间的「落脚子项目」：最新一个；还没有任何子项目就先建第一个。
 * 卡在被使用（开机恢复 / 换到它）时必须有个项目当落脚点——没有的话，新会话会落进
 * pi 的扁平默认目录：既不属于这张卡、项目树里也永远不出现。老布局返回 null，调用方保持原行为。
 */
export function ensureStorySessionDir(cwd: string, configCard: string): string | null {
	const space = resolveCardSpace(cwd, configCard);
	if (!space) return null;
	return (latestChat(space.dir) ?? createChat(space.dir)).sessionsDir;
}

/**
 * 会话列表聚合：当前卡各子项目里的会话，全部展开成一个 SessionInfo 形状（path 供
 * runtime.switchSession 直用——它按父目录推导 sessionDir，正好回到该子项目）。
 * 当前卡不在 cards/ 里 ⇒ null（调用方走 SessionManager.list(cwd) 老路径）。
 */
export interface ChatSessionEntry {
	chatId: string;
	/** 会话文件绝对路径 */
	path: string;
}

export function chatSessionsOf(cwd: string, configCard: string): ChatSessionEntry[] | null {
	const space = resolveCardSpace(cwd, configCard);
	if (!space) return null;
	const out: ChatSessionEntry[] = [];
	for (const chat of listChatsSafe(space.dir)) {
		const sdir = chatSessionsDirOf(space.dir, chat.id);
		if (!existsSync(sdir)) continue;
		for (const f of safeReadDir(sdir)) {
			if (!f.endsWith(".jsonl")) continue;
			out.push({ chatId: chat.id, path: join(sdir, f) });
		}
	}
	// 最近活动的子项目排前；同子项目内文件名倒序（pi 的命名含时间戳，字典序即时间序）
	out.sort((a, b) => (chatOrder(space, a.chatId) - chatOrder(space, b.chatId)) || b.path.localeCompare(a.path));
	return out;
}

function listChatsSafe(cardDir: string): ChatInfo[] {
	try {
		// cardspace.listChats 自己有 try/catch，再包一层防 cards/ 结构异常拖垮列表
		return listChats(cardDir);
	} catch {
		return [];
	}
}

/** 当前卡的全部子项目（含空子项目），按最近活动倒序；老布局（卡不在 cards/）返回 null */
export function chatsOfCard(cwd: string, configCard: string): ChatInfo[] | null {
	const space = resolveCardSpace(cwd, configCard);
	if (!space) return null;
	return listChatsSafe(space.dir);
}

function safeReadDir(p: string): string[] {
	try {
		return readdirSync(p);
	} catch {
		return [];
	}
}

function chatOrder(_space: CardSpace, chatId: string): number {
	// 子项目 id 自带可排序时间戳；越新越前（列表已按 modified 排过，这里只做稳定兜底）
	return -chatId.localeCompare("9999");
}

/** 换卡落点：卡库枚举（cards/ 优先，assets/cards 老卡库并存展示） */
export function cardSpaceLibrary(cwd: string): CardSpace[] {
	return listCardSpaces(cwd);
}

/** cards/ 根本没建过（迁移从未发生且用户没手动建）⇒ 全程走老布局 */
export function cardsRootExists(cwd: string): boolean {
	return existsSync(cardsRoot(cwd));
}
