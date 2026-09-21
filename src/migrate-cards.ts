/**
 * 一次性迁移：扁平项目 → **卡＝工作空间**的两层布局（2026-09-06 用户定案 B）。
 *
 *   assets/cards/<卡>.png              → cards/<卡文件夹>/<卡>.png
 *   ~/.liyuan/agent/sessions/…/<会话>  → cards/<卡文件夹>/对话/<对话id>/会话/<会话>
 *   .liyuan-state/<sid>.json           → cards/<卡文件夹>/对话/<对话id>/世界状态.json
 *   .liyuan-worldline/<sid>.json       → …/世界线.json
 *   .liyuan-artifacts/<sid>.json       → …/面板.json
 *   .liyuan-memory/scopes/<hash>__<sid>/ → …/向量记忆/
 *   .liyuan-lore/<卡名>.json           → cards/<卡文件夹>/补充设定集.json
 *
 * **「今天的一个会话 ＝ 一个子项目」**：今天「新建对话」建的就是一个新会话、而且账本/世界线/
 * 面板/向量记忆全按 sessionId 分家 —— 那正是用户说的「完全新开的对话」。所以旧会话逐个
 * 变成子项目最忠实，不需要猜谁跟谁是一局。此后同一子项目里再开的会话才是「第二个窗口继续聊」。
 *
 * 纪律：
 * - **plan 与 apply 分开**：plan 只读，apply 才动盘；测试与「先看看会搬什么」都用得上。
 * - **只搬不删**：全程 rename（同盘即原子），失败逐条记账继续，不做「先删后拷」。
 * - **认不出卡的会话原地不动**（宁可留在老地方，也不猜）。
 * - 目录名的唯一主人仍是 `src/paths.ts`。
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, join } from "node:path";

import { loadCardFile } from "./card.ts";
import { copyPathSafe } from "./fs-copy.ts";
import { loadPersonas, savePersonas } from "./personas.ts";
import { appendSessionCardRebind, createCardSpace, freeCardFolder, listCardSpaces, resolveCardSpace, writeChatMeta, type CardSpace } from "./cardspace.ts";
import { stripBom } from "./jsonio.ts";
import {
	CARD_OVERLAY_FILE,
	CHAT_PANELS_FILE,
	CHAT_STATE_FILE,
	CHAT_WORLDLINE_FILE,
	CHAT_MEMORY_DIR,
	CARDS_ROOT,
	DIRS,
	cardDirOf,
	chatDirOf,
	chatSessionsDirOf,
	dir,
	nameSafe,
	resolveConfigPath,
	sameCardPath,
} from "./paths.ts";
import { readSessionCardInfo } from "./session-scan.ts";

/** 一张卡：从哪搬到哪个文件夹 */
export interface CardMove {
	/** 卡本体现在的绝对路径 */
	from: string;
	/** 目标文件夹名（cards/ 下一级） */
	folder: string;
	/** 卡显示名（取不到时用文件名） */
	name: string;
	/** 迁移前配置里引用这张卡时用的相对路径（用于改写 config.card 与会话归属比对） */
	ref: string;
}

/** 一个旧会话 → 一个子项目 */
export interface SessionMove {
	/** 会话 jsonl 绝对路径 */
	file: string;
	/** 落到哪张卡的文件夹 */
	folder: string;
	/** 新的子项目 id */
	chatId: string;
	/** 会话 id（拿它去找 state/worldline/artifacts/memory） */
	sessionId: string;
	/** 会话最后修改时间（子项目元数据的 createdAt 用） */
	modified: number;
	/** 迁移后这张卡的新引用（`cards/<folder>/<file>`）：追加 rp-card 重绑定行用 */
	newRef: string;
}

export interface CardMigrationPlan {
	cards: CardMove[];
	sessions: SessionMove[];
	/** 认不出卡、原地不动的会话 */
	skipped: Array<{ file: string; why: string }>;
}

/** 会话文件名 `2026-09-05T16-41-36-682Z_01a07272-…jsonl` → `20260905-164136-a072` */
export function chatIdFromSessionFile(fileName: string, fallbackIndex = 0): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})[^_]*_([0-9a-f]{4})/i.exec(fileName);
	if (m) return `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}-${m[7].toLowerCase()}`;
	// 文件名不合套路：仍要给一个可排序、稳定、Windows 合法的 id
	const digits = fileName.replace(/\D/g, "").slice(0, 14).padEnd(14, "0");
	return `${digits.slice(0, 8)}-${digits.slice(8, 14)}-${String(fallbackIndex).padStart(4, "0")}`;
}

/** 会话文件名里的 session id（`…_<uuid>.jsonl`） */
export function sessionIdFromFile(fileName: string): string {
	const m = /_([0-9a-f-]{8,})\.jsonl$/i.exec(fileName);
	return m ? m[1] : "";
}

/**
 * 产品种子卡（随包 `default_*`）：导入暂存里的这份是种子，不是用户导入。
 * 升格/一次性迁移只**拷进**卡空间，源文件留着——Docker 把 `assets/cards` 挂成卷，
 * 搬走＝CI 断言与下次播种都落空；卡库会同时列出暂存和空间，拷完靠 basename 去重。
 */
export function isProductSeedCard(fileName: string): boolean {
	return /^default_/i.test(basename(fileName));
}

function spaceForBasename(cwd: string, fileName: string): CardSpace | undefined {
	const base = basename(fileName);
	return listCardSpaces(cwd).find((s) => basename(s.cardFile) === base);
}

/** 迁移是否已经做过：有过至少一张卡空间＝做过或用户自己建了。空 `cards/` 目录不算（Docker 卷会先建出空目录）。 */
export function alreadyMigrated(cwd: string): boolean {
	return listCardSpaces(cwd).length > 0;
}

/** 迁移后这张卡的新引用（`cards/<folder>/<file>`）——迁移器唯一改写口径 */
function newRefOf(card: CardMove): string {
	return `${CARDS_ROOT}/${card.folder}/${basename(card.from)}`;
}

/**
 * 排一份迁移计划（**只读**）。
 * @param cardRefs 卡库里的卡（相对 cwd 的路径），缺省扫 `assets/cards/`
 * @param sessionDir 旧的剧情会话目录（`~/.liyuan/agent/sessions/--<cwd>--/`）
 */
export function planCardMigration(cwd: string, sessionDir: string): CardMigrationPlan {
	const cards: CardMove[] = [];
	const taken = new Set<string>(listCardSpaces(cwd).map((s) => s.folder));
	const legacyDir = join(cwd, "assets", "cards");
	const files = existsSync(legacyDir) ? readdirSync(legacyDir).sort() : [];
	for (const f of files) {
		const abs = join(legacyDir, f);
		try {
			if (!statSync(abs).isFile()) continue;
		} catch {
			continue;
		}
		if (!/\.(png|json)$/i.test(f)) continue;
		let name = f.replace(/\.(png|json)$/i, "");
		try {
			const card = loadCardFile(abs);
			if (card.name?.trim()) name = card.name.trim();
		} catch {
			// 坏卡：用文件名当文件夹名，照样搬（用户自己去看）
		}
		// freeCardFolder 只看磁盘；同一批计划内的重名要自己记账
		let folder = freeCardFolder(cwd, name);
		let n = 2;
		while (taken.has(folder)) {
			folder = freeCardFolder(cwd, `${name}-${n}`);
			n += 1;
		}
		taken.add(folder);
		cards.push({ from: abs, folder, name, ref: `assets/cards/${f}` });
	}

	const sessions: SessionMove[] = [];
	const skipped: Array<{ file: string; why: string }> = [];
	const sessionFiles = existsSync(sessionDir) ? readdirSync(sessionDir).sort() : [];
	const usedChatIds = new Set<string>();
	let idx = 0;
	for (const f of sessionFiles) {
		if (!f.endsWith(".jsonl")) continue;
		const abs = join(sessionDir, f);
		idx += 1;
		const info = readSessionCardInfo(abs);
		if (!info?.card) {
			skipped.push({ file: abs, why: "会话里没有 rp-card 标记，认不出属于哪张卡" });
			continue;
		}
		const hit = cards.find((c) => sameCardPath(info.card, c.ref, cwd));
		if (!hit) {
			skipped.push({ file: abs, why: `标记指向 ${info.card}，卡库里没有这张卡` });
			continue;
		}
		let chatId = chatIdFromSessionFile(f, idx);
		while (usedChatIds.has(chatId)) chatId = `${chatId}x`;
		usedChatIds.add(chatId);
		let modified = 0;
		try {
			modified = statSync(abs).mtimeMs;
		} catch {
			modified = Date.now();
		}
		sessions.push({ file: abs, folder: hit.folder, chatId, sessionId: sessionIdFromFile(f), modified, newRef: newRefOf(hit) });
	}

	return { cards, sessions, skipped };
}

/** 搬一个文件/目录；已存在则不覆盖。返回一行日志（无事可做返回 null） */
function move(from: string, to: string, label: string, log: string[]): boolean {
	if (!existsSync(from)) return false;
	if (existsSync(to)) {
		log.push(`保留 ${label}（目标已存在，跳过）`);
		return false;
	}
	try {
		mkdirSync(join(to, ".."), { recursive: true });
		try {
			renameSync(from, to);
		} catch (err) {
			// 跨盘（会话在 C:、卡库在 E:）renameSync 撞 EXDEV：整份拷过去再删源，
			// 语义仍是「搬」（失败时源还在，重跑幂等）。
			const code = (err as { code?: string }).code;
			if (code !== "EXDEV" && code !== "EPERM") throw err;
			copyPathSafe(from, to); // to 已确认不存在，语义仍是「不覆盖已存在的目标」
			rmSync(from, { recursive: true, force: true });
		}
		return true;
	} catch (err) {
		log.push(`搬不动 ${label}：${err instanceof Error ? err.message : String(err)}`);
		return false;
	}
}

/**
 * 执行迁移（**动盘**）。返回人话日志。
 * 幂等：已经搬走的不会再搬；目标已存在一律保留不覆盖。
 */
export function applyCardMigration(cwd: string, plan: CardMigrationPlan): string[] {
	const log: string[] = [];
	if (plan.cards.length === 0 && plan.sessions.length === 0) return log;

	// 1) 卡本体进卡文件夹
	const spaceOf = new Map<string, CardSpace>();
	for (const c of plan.cards) {
		try {
			const existing = spaceForBasename(cwd, c.from);
			if (existing) {
				spaceOf.set(c.folder, existing);
				log.push(`卡「${c.name}」已在 ${CARDS_ROOT}/${existing.folder}/，跳过`);
				continue;
			}
			const seed = isProductSeedCard(c.from);
			const space = createCardSpace(cwd, c.from, c.folder, seed ? { copy: copyPathSafe } : { move: true });
			spaceOf.set(c.folder, space);
			log.push(`卡「${c.name}」→ ${CARDS_ROOT}/${space.folder}/${seed ? "（种子留下）" : ""}`);
		} catch (err) {
			log.push(`卡「${c.name}」搬不动：${err instanceof Error ? err.message : String(err)}`);
		}
	}

	// 2) 补充设定集（按卡名存的那份）进卡文件夹
	for (const c of plan.cards) {
		const space = spaceOf.get(c.folder);
		if (!space) continue;
		const overlay = join(dir(cwd, "lore"), `${nameSafe(c.name)}.json`);
		if (move(overlay, join(space.dir, CARD_OVERLAY_FILE), `补充设定集（${c.name}）`, log)) {
			log.push(`  补充设定集 → ${CARDS_ROOT}/${space.folder}/${CARD_OVERLAY_FILE}`);
		}
	}

	// 3) 每个旧会话变成一个子项目，随身数据跟着走
	const stateDir = dir(cwd, "state");
	const worldlineDir = dir(cwd, "worldline");
	const artifactsDir = dir(cwd, "artifacts");
	const memoryScopes = join(dir(cwd, "memory"), "scopes");
	let moved = 0;
	for (const s of plan.sessions) {
		const cardDir = cardDirOf(cwd, s.folder);
		const chatAbs = chatDirOf(cardDir, s.chatId);
		const sessionsAbs = chatSessionsDirOf(cardDir, s.chatId);
		try {
			mkdirSync(sessionsAbs, { recursive: true });
		} catch (err) {
			log.push(`建不出子项目 ${s.chatId}：${err instanceof Error ? err.message : String(err)}`);
			continue;
		}
		if (!move(s.file, join(sessionsAbs, basename(s.file)), `会话 ${basename(s.file)}`, log)) continue;
		moved += 1;
		writeChatMeta(cardDir, s.chatId, { createdAt: new Date(s.modified).toISOString() });
		if (s.sessionId) {
			move(join(stateDir, `${s.sessionId}.json`), join(chatAbs, CHAT_STATE_FILE), "世界状态", log);
			move(join(worldlineDir, `${s.sessionId}.json`), join(chatAbs, CHAT_WORLDLINE_FILE), "世界线", log);
			move(join(artifactsDir, `${s.sessionId}.json`), join(chatAbs, CHAT_PANELS_FILE), "面板", log);
			// 向量记忆的目录名是 `<卡路径hash10>__<sessionId>`，按后缀找
			if (existsSync(memoryScopes)) {
				for (const scope of readdirSync(memoryScopes)) {
					if (!scope.endsWith(`__${s.sessionId}`)) continue;
					move(join(memoryScopes, scope), join(chatAbs, CHAT_MEMORY_DIR), "向量记忆", log);
					break;
				}
			}
		}
		// 会话搬完就重绑定：追加一条 rp-card 行（pi 的 appendCustomEntry 落行格式），
		// 指向新卡引用。旧卡引用的行留在前面（parse 取最后一条），但列表过滤从此认新引用。
		try {
			appendSessionCardRebind(join(sessionsAbs, basename(s.file)), s.newRef);
		} catch (err) {
			log.push(`重绑定 ${basename(s.file)} 失败：${err instanceof Error ? err.message : String(err)}`);
		}
	}
	if (moved > 0) log.push(`${moved} 个旧会话各成一个子项目`);
	for (const k of plan.skipped) log.push(`原地保留 ${basename(k.file)}：${k.why}`);

	// 4) 改写 config.card / personas byCard / 卡收藏：旧引用 → 新引用
	rewriteCardRefs(cwd, plan, log, spaceOf);
	return log;
}

/**
 * 单卡升格（打开卡时调用）：把仍住在导入暂存（`assets/cards/`）里的卡搬进卡空间
 * （`cards/<卡名>/`），连同它在扁平会话目录里的旧会话各成一个子项目——与一次性迁移
 * 同一套动作（幂等、只搬不删、认不出的会话原地不动）。
 *
 * 补的是一条断链：一次性迁移只在首启跑一次，而此后的「导入 / 新建」卡都落暂存，
 * 没有第二个人把它们搬进两层布局——不升格，这张卡永远只有「新建对话」，
 * 聊多少轮都长不出「新建项目」。返回升格后的新引用；不是暂存卡（已在 cards/ 或找不到）返回 null。
 */
export function promoteStagedCard(cwd: string, sessionDir: string, cardRef: string): string | null {
	const rel = cardRef.replace(/\\/g, "/").replace(/^\.\//, "");
	if (!rel.startsWith("assets/cards/")) return null; // 只有导入暂存里的卡需要升格
	const plan = planCardMigration(cwd, sessionDir);
	const mine = plan.cards.find((c) => sameCardPath(c.ref, cardRef, cwd));
	if (!mine) return null;
	applyCardMigration(cwd, {
		cards: [mine],
		sessions: plan.sessions.filter((s) => s.folder === mine.folder),
		skipped: [],
	});
	const after = spaceForBasename(cwd, rel);
	return after ? `${CARDS_ROOT}/${after.folder}/${basename(after.cardFile)}` : newRefOf(mine);
}

/**
 * 收散：扁平会话目录里**指向已有卡空间**的会话——卡空间化之后才生成的
 * （升格前就已开聊、或修复前掉进默认目录的那批）。它们哪个项目树都不属于，
 * 各搬进对应卡的一个子项目。暂存卡（assets/cards/…）的会话不在这里收：
 * 它们的归属跟着「单卡升格」走。开机跑，幂等、通常无事可做。
 */
export function planOrphanSessions(cwd: string, sessionDir: string): SessionMove[] {
	const out: SessionMove[] = [];
	const sessionFiles = existsSync(sessionDir) ? readdirSync(sessionDir).sort() : [];
	const usedChatIds = new Set<string>();
	let idx = 0;
	for (const f of sessionFiles) {
		if (!f.endsWith(".jsonl")) continue;
		idx += 1;
		const abs = join(sessionDir, f);
		const info = readSessionCardInfo(abs);
		if (!info?.card) continue;
		// 只收「指向已有卡空间」的：暂存卡、认不出的路径都不动
		const space = resolveCardSpace(cwd, info.card);
		if (!space) continue;
		let chatId = chatIdFromSessionFile(f, idx);
		while (usedChatIds.has(chatId)) chatId = `${chatId}x`;
		usedChatIds.add(chatId);
		let modified = 0;
		try {
			modified = statSync(abs).mtimeMs;
		} catch {
			modified = Date.now();
		}
		out.push({ file: abs, folder: space.folder, chatId, sessionId: sessionIdFromFile(f), modified, newRef: info.card });
	}
	return out;
}

/**
 * 改写「按卡路径键控」的引用：liyuan.config.json 的 card、personas 的 byCard、
 * 卡收藏 card-favs.json。逐条换成新引用；旧引用不再出现在任何键上。
 */
function rewriteCardRefs(cwd: string, plan: CardMigrationPlan, log: string[], spaceOf?: Map<string, CardSpace>): void {
	if (plan.cards.length === 0) return;
	const refOf = new Map<string, string>(); // 旧引用（归一）→ 新引用
	for (const c of plan.cards) {
		const space = spaceOf?.get(c.folder);
		const dest = space ? `${CARDS_ROOT}/${space.folder}/${basename(space.cardFile)}` : newRefOf(c);
		refOf.set(normalizeRef(c.ref), dest);
	}
	const rewrite = (old: string | undefined): string | undefined => {
		if (!old) return undefined;
		return refOf.get(normalizeRef(old));
	};
	// config.card
	try {
		const path = resolveConfigPath(cwd);
		if (existsSync(path)) {
			const raw = JSON.parse(stripBom(readFileSync(path, "utf8"))) as Record<string, unknown>;
			const next = rewrite(String(raw.card ?? ""));
			if (next && next !== raw.card) {
				raw.card = next;
				writeFileSync(path, `${JSON.stringify(raw, null, "\t")}\n`, "utf8");
				log.push(`config.card → ${next}`);
			}
		}
	} catch (err) {
		log.push(`改写 config.card 失败：${err instanceof Error ? err.message : String(err)}`);
	}
	// personas byCard（键是卡路径）
	try {
		const store = loadPersonas(cwd);
		let touched = false;
		const byCard: Record<string, string> = {};
		for (const [k, v] of Object.entries(store.byCard)) {
			const nk = rewrite(k);
			if (nk && nk !== k) {
				byCard[nk] = v;
				touched = true;
			} else {
				byCard[k] = v;
			}
		}
		if (touched) {
			savePersonas(cwd, { ...store, byCard });
			log.push("personas 按卡锁定改指新卡引用");
		}
	} catch (err) {
		log.push(`改写 personas 失败：${err instanceof Error ? err.message : String(err)}`);
	}
	// 卡收藏
	try {
		const favsFile = join(cwd, DIRS.cache, "card-favs.json");
		if (existsSync(favsFile)) {
			const favs = JSON.parse(stripBom(readFileSync(favsFile, "utf8"))) as unknown;
			if (Array.isArray(favs)) {
				const next = favs.map((f) => (typeof f === "string" ? (rewrite(f) ?? f) : f));
				if (next.some((f, i) => f !== favs[i])) {
					mkdirSync(join(cwd, DIRS.cache), { recursive: true });
					writeFileSync(favsFile, `${JSON.stringify(next, null, "\t")}\n`, "utf8");
					log.push("卡收藏改指新卡引用");
				}
	}
		}
	} catch (err) {
		log.push(`改写卡收藏失败：${err instanceof Error ? err.message : String(err)}`);
	}
}

/** 引用归一（比对键）：正反斜杠/大小写/./前缀的差异不该挡住改写 */
function normalizeRef(ref: string): string {
	return ref.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}
