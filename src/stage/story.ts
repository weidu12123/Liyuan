/**
 * agent 模式的稿子（docs/PLAN-AGENT-MODE.md §5.2–5.3）：正文住 `<子项目>/正文/<chapterId>.v<n>.md`，
 * 版本与归属住会话树——`rp-chapter` 条目＝一次写入，`rp-chapter-revision` 条目把同一个 chapterId 指向新文件
 * 与新版本（写时复制，兄弟世界线仍看旧版）。**当前分支上的章条目按序拼起来就是这份稿子**，与今天正文是
 * storyBranch 的投影同构；不存在总文件，文件不带 frontmatter。
 *
 * 五个工具是梨园自己发行的闭合协议；story_append 是唯一定稿入口（旁路链挂在引擎那头），story_edit 沿用
 * previous_draft_edit 的约束：版本匹配、引用唯一不重叠、整批原子、不许清空，且不触发旁路。
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { applyDraftEdits, type DraftEditItem } from "../draft.ts";
import { CHAT_STORY_DIR } from "../paths.ts";
import type { BranchEntryLike } from "./assemble.ts";
import type { StageTool, ToolRunResult } from "./tools.ts";

export const CHAPTER_ENTRY_TYPE = "rp-chapter";
export const CHAPTER_REVISION_TYPE = "rp-chapter-revision";
/** 项目状态块「稿子尾部」缺省字数（§9 待定项 2：实弹定，起点 6000≈最近一两章） */
export const DEFAULT_STORY_TAIL_CHARS = 6000;

export interface ChapterEntryData {
	chapterId: string;
	/** 相对 `正文/` 的文件名 */
	file: string;
	version: number;
	title?: string;
	chars: number;
}
export interface ChapterRevisionData extends ChapterEntryData {
	/** 谁改的：模型（story_edit）或用户（刀 3 的按章直接编辑） */
	source?: "agent" | "user";
}

/** 当前分支上一章的投影（已套用修订） */
export interface Chapter extends ChapterEntryData {
	/** 分支内序号（从 1 起） */
	index: number;
	/** rp-chapter 条目 id（回退/分叉的树坐标） */
	entryId?: string;
	/** 生效修订的条目 id（无修订则无） */
	revisionEntryId?: string;
}

const isData = (d: unknown): d is ChapterEntryData => {
	const x = d as Partial<ChapterEntryData> | undefined;
	return !!x && typeof x.chapterId === "string" && !!x.chapterId && typeof x.file === "string" && !!x.file && Number.isInteger(x.version) && x.version! > 0;
};

/** 分支 → 章目录。修订只认分支上已有的章；指向未知章的修订条目忽略。 */
export function projectChapters(branch: BranchEntryLike[]): Chapter[] {
	const out: Chapter[] = [];
	const byId = new Map<string, Chapter>();
	for (const e of branch) {
		if (e.type !== "custom" || !isData(e.data)) continue;
		if (e.customType === CHAPTER_ENTRY_TYPE) {
			if (byId.has(e.data.chapterId)) continue; // 同 id 二次写入（异常树）：以首次为准
			const ch: Chapter = { ...e.data, chars: e.data.chars ?? 0, index: out.length + 1, ...(e.id ? { entryId: e.id } : {}) };
			out.push(ch);
			byId.set(ch.chapterId, ch);
		} else if (e.customType === CHAPTER_REVISION_TYPE) {
			const ch = byId.get(e.data.chapterId);
			if (!ch || e.data.version <= ch.version) continue;
			ch.file = e.data.file;
			ch.version = e.data.version;
			ch.chars = e.data.chars ?? ch.chars;
			if (typeof e.data.title === "string") ch.title = e.data.title;
			if (e.id) ch.revisionEntryId = e.id;
		}
	}
	return out;
}

export const hasChapters = (branch: BranchEntryLike[]): boolean =>
	branch.some((e) => e.type === "custom" && e.customType === CHAPTER_ENTRY_TYPE && isData(e.data));

export function storyDirectory(chatDir: string): string {
	return join(chatDir, CHAT_STORY_DIR);
}

/** 可排序、Windows 合法的章 id（与子项目 id 同一形状；跨分支不撞名） */
export function newChapterId(now = new Date()): string {
	const p = (n: number, w = 2) => String(n).padStart(w, "0");
	const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
	return `${stamp}-${randomBytes(2).toString("hex")}`;
}

export const chapterFileName = (chapterId: string, version: number): string => `${chapterId}.v${version}.md`;

/** 章文件仓：只有读与「写新版本文件」两件事；版本归属由树条目决定，这里不覆盖任何已有文件。 */
export class StoryStore {
	readonly directory: string;
	constructor(directory: string) {
		this.directory = directory;
	}
	read(chapter: Pick<ChapterEntryData, "file">): string {
		return readFileSync(join(this.directory, chapter.file), "utf8");
	}
	exists(chapter: Pick<ChapterEntryData, "file">): boolean {
		return existsSync(join(this.directory, chapter.file));
	}
	write(chapterId: string, version: number, text: string): string {
		mkdirSync(this.directory, { recursive: true });
		const file = chapterFileName(chapterId, version);
		const abs = join(this.directory, file);
		if (existsSync(abs)) throw new Error(`章文件已存在：${file}`);
		writeFileSync(abs, text, "utf8");
		return file;
	}
}

// ---------------- 稿子尾部（项目状态块的一项） ----------------

export interface StoryTailPiece {
	chapter: Chapter;
	/** 取自该章的起始偏移（UTF-16；0＝整章） */
	from: number;
	text: string;
}
export interface StoryTail {
	totalChapters: number;
	totalChars: number;
	pieces: StoryTailPiece[];
}

/** 最后 maxChars 字：从末章往前取整章，装不下的那一章从段落边界起截尾部。 */
export function storyTail(store: Pick<StoryStore, "read">, chapters: Chapter[], maxChars: number): StoryTail {
	const totalChars = chapters.reduce((n, c) => n + (c.chars ?? 0), 0);
	const pieces: StoryTailPiece[] = [];
	let budget = Math.max(0, maxChars);
	for (let i = chapters.length - 1; i >= 0 && budget > 0; i--) {
		const chapter = chapters[i]!;
		let text: string;
		try {
			text = store.read(chapter);
		} catch {
			break; // 文件缺失：尾部到此为止，缺的那章在 story_outline 里仍可见
		}
		if (text.length <= budget) {
			pieces.unshift({ chapter, from: 0, text });
			budget -= text.length;
			continue;
		}
		const cut = text.length - budget;
		const nl = text.indexOf("\n", cut);
		const from = nl >= 0 && nl + 1 < text.length ? nl + 1 : cut;
		pieces.unshift({ chapter, from, text: text.slice(from) });
		break;
	}
	return { totalChapters: chapters.length, totalChars, pieces };
}

const chapterHead = (c: Chapter): string => `第 ${c.index} 章${c.title ? `「${c.title}」` : ""} chapterId=${c.chapterId} v${c.version}`;

/** 项目状态块里的【稿子尾部】：数据，不带任何落笔指令。 */
export function formatStoryTail(tail: StoryTail): string {
	if (tail.totalChapters === 0) return "【稿子尾部】尚无章节。";
	const shown = tail.pieces.reduce((n, p) => n + p.text.length, 0);
	const lines = [`【稿子尾部】共 ${tail.totalChapters} 章 ${tail.totalChars} 字；以下是最后 ${shown} 字`];
	for (const p of tail.pieces) {
		const total = p.chapter.chars;
		const range = p.from > 0 ? `第 ${p.from}–${total} 字，共 ${total} 字` : `全文 ${total} 字`;
		lines.push(`── ${chapterHead(p.chapter)}（${range}）\n${p.text}`);
	}
	return lines.join("\n\n");
}

// ---------------- 工具 ----------------

const STR = { type: "string" } as const;
const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, ...(required.length ? { additionalProperties: false } : {}) });

export const STORY_TOOL_NAMES = ["story_outline", "story_read", "story_grep", "story_append", "story_edit"] as const;
export type StoryToolName = (typeof STORY_TOOL_NAMES)[number];

export function storyTools(): StageTool[] {
	const chapterId = { ...STR, description: "story_outline 给出的 chapterId" };
	return [
		{
			name: "story_outline", mode: "read",
			description: "当前分支的章目录：序号、chapterId、标题、字数、版本。",
			parameters: schema({}, []),
		},
		{
			name: "story_read", mode: "read",
			description: "读章原文。chapterIds 按 id 列表读；tail 读稿子最后 N 字；只读一章时 start/end 是从 0 开始的 UTF-16 偏移，end 不含。返回带 chapterId 与 version 的精确原文。",
			parameters: schema({
				chapterIds: { type: "array", items: chapterId },
				tail: { type: "integer", minimum: 1, description: "读最后这么多字" },
				start: { type: "integer", minimum: 0 },
				end: { type: "integer", minimum: 0 },
			}, []),
		},
		{
			name: "story_grep", mode: "read",
			description: "在当前分支全部章里按字面检索原文，返回 chapterId 与命中行。语义检索走 memory_search。",
			parameters: schema({ query: STR, limit: { type: "integer", minimum: 1, maximum: 50 } }, ["query"]),
		},
		{
			name: "story_append", mode: "write",
			description: "把一章正文追加到稿子末尾。这是正文进入稿子的唯一入口；成功后场记记账与前情压缩按章进行。content 是完整章原文，保留格式与空白。",
			parameters: schema({ content: STR, title: STR }, ["content"]),
		},
		{
			name: "story_edit", mode: "write",
			description: "按 version 与唯一原文引用原位修改当前分支的任一章；未引用部分保留，任一处缺失、重复、重叠或版本冲突则整批不改；不能清空整章。写入新版本文件，旧版本仍归兄弟世界线；不触发记账与压缩。",
			parameters: schema({
				chapterId,
				version: { type: "integer", minimum: 1, description: "该章当前版本（story_outline / story_read 回执里的 version）" },
				edits: { type: "array", minItems: 1, items: schema({ old: STR, new: STR }, ["old", "new"]) },
			}, ["chapterId", "version", "edits"]),
		},
	];
}

export interface StoryToolDeps {
	getBranch: () => BranchEntryLike[];
	store: StoryStore;
	/** 落一条树条目（挂在当前叶上）；由引擎接 sessionManager.appendCustomEntry */
	appendEntry: (customType: string, data: ChapterEntryData | ChapterRevisionData) => void;
	now?: () => Date;
}

export interface StoryToolResult extends ToolRunResult {
	/** story_append 成功时：本次写入的章与原文（引擎据此跑旁路链） */
	appended?: { chapter: Chapter; text: string };
}

const fail = (text: string): StoryToolResult => ({ text, isError: true });

export function runStoryTool(deps: StoryToolDeps, name: string, args: Record<string, unknown>): StoryToolResult {
	try {
		const chapters = projectChapters(deps.getBranch());
		if (name === "story_outline") {
			return {
				text: JSON.stringify({
					chapters: chapters.map((c) => ({ index: c.index, chapterId: c.chapterId, ...(c.title ? { title: c.title } : {}), chars: c.chars, version: c.version })),
					totalChars: chapters.reduce((n, c) => n + c.chars, 0),
				}),
				activity: "读章目录",
			};
		}
		if (name === "story_read") {
			if (args.tail !== undefined) {
				const n = Number(args.tail);
				if (!Number.isInteger(n) || n < 1) return fail("tail 须为正整数。");
				const tail = storyTail(deps.store, chapters, n);
				return {
					text: JSON.stringify({ chapters: tail.pieces.map((p) => ({ index: p.chapter.index, chapterId: p.chapter.chapterId, version: p.chapter.version, ...(p.chapter.title ? { title: p.chapter.title } : {}), start: p.from, end: p.chapter.chars, total: p.chapter.chars, content: p.text })) }),
					activity: `读稿子末 ${n} 字`,
				};
			}
			const ids = Array.isArray(args.chapterIds) ? args.chapterIds.map(String) : [];
			if (!ids.length) return fail("给 chapterIds 或 tail 之一。");
			const picked = ids.map((id) => chapters.find((c) => c.chapterId === id));
			const missing = ids.filter((_, i) => !picked[i]);
			if (missing.length) return fail(`当前分支没有这些章：${missing.join("、")}。story_outline 可列出章目录。`);
			const ranged = args.start !== undefined || args.end !== undefined;
			if (ranged && picked.length !== 1) return fail("start/end 只能与单个 chapterId 同用。");
			const out = picked.map((c) => {
				const text = deps.store.read(c!);
				const start = args.start === undefined ? 0 : Number(args.start);
				const end = args.end === undefined ? text.length : Number(args.end);
				if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) throw new Error("start/end 必须是该章范围内的字符偏移（从 0 开始，end 不含）。");
				return { index: c!.index, chapterId: c!.chapterId, version: c!.version, ...(c!.title ? { title: c!.title } : {}), start, end, total: text.length, content: text.slice(start, end) };
			});
			return { text: JSON.stringify({ chapters: out }), activity: `读第 ${out.map((c) => c.index).join("、")} 章` };
		}
		if (name === "story_grep") {
			const query = typeof args.query === "string" ? args.query : "";
			if (!query.trim()) return fail("query 不能为空。");
			const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
			const hits: Array<{ index: number; chapterId: string; line: number; text: string }> = [];
			let total = 0;
			for (const c of chapters) {
				let text: string;
				try { text = deps.store.read(c); } catch { continue; }
				const lines = text.split("\n");
				for (let i = 0; i < lines.length; i++) {
					if (!lines[i]!.includes(query)) continue;
					total++;
					if (hits.length < limit) hits.push({ index: c.index, chapterId: c.chapterId, line: i + 1, text: lines[i]!.length > 200 ? `${lines[i]!.slice(0, 200)}…` : lines[i]! });
				}
			}
			return { text: JSON.stringify({ total, hits }), activity: `查稿子「${query.slice(0, 16)}」` };
		}
		if (name === "story_append") {
			const content = typeof args.content === "string" ? args.content : "";
			if (!content.trim()) return fail("content 不能为空。");
			const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : undefined;
			const chapterId = newChapterId(deps.now?.());
			const file = deps.store.write(chapterId, 1, content);
			const data: ChapterEntryData = { chapterId, file, version: 1, ...(title ? { title } : {}), chars: content.length };
			deps.appendEntry(CHAPTER_ENTRY_TYPE, data);
			const chapter: Chapter = { ...data, index: chapters.length + 1 };
			return {
				text: `已写入第 ${chapter.index} 章${title ? `「${title}」` : ""}（${content.length} 字）。chapterId=${chapterId} v1`,
				activity: `写入第 ${chapter.index} 章`,
				details: { chapterId, version: 1, index: chapter.index, chars: content.length },
				appended: { chapter, text: content },
			};
		}
		if (name === "story_edit") {
			const chapterId = typeof args.chapterId === "string" ? args.chapterId : "";
			const chapter = chapters.find((c) => c.chapterId === chapterId);
			if (!chapter) return fail("当前分支没有该章。story_outline 可列出章目录。");
			if (args.version !== chapter.version) return fail(`版本冲突：该章当前为 v${chapter.version}，收到 ${String(args.version)}。本次未修改；story_read 可读取当前版本。`);
			if (!Array.isArray(args.edits)) return fail("edits 须为 old/new 数组。");
			const text = deps.store.read(chapter);
			const result = applyDraftEdits(text, args.edits as DraftEditItem[]);
			if (!result.ok) return fail(result.details.join("\n"));
			if (!result.text!.trim()) return fail("修订不能清空整章。");
			const version = chapter.version + 1;
			const file = deps.store.write(chapterId, version, result.text!);
			deps.appendEntry(CHAPTER_REVISION_TYPE, { chapterId, file, version, ...(chapter.title ? { title: chapter.title } : {}), chars: result.text!.length, source: "agent" });
			return {
				text: `第 ${chapter.index} 章已修订，v${version}。\n${result.details.join("\n")}`,
				activity: `修订第 ${chapter.index} 章 ${args.edits.length} 处`,
				details: { chapterId, version, index: chapter.index, chars: result.text!.length },
			};
		}
		return fail(`未知稿子工具 ${name}。`);
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error));
	}
}

/**
 * 用户按章直接编辑（刀 3）：与 story_edit 同一条落点——写新版本文件、追加修订条目、来源标 user；
 * 同样只认当前分支上的章、版本必须匹配、不许清空。全文替换（用户在编辑框里改的就是整章）。
 */
export function replaceChapterText(deps: StoryToolDeps, chapterId: string, version: number, text: string): { chapterId: string; version: number; index: number; chars: number } {
	const chapter = projectChapters(deps.getBranch()).find((c) => c.chapterId === chapterId);
	if (!chapter) throw new Error("当前分支没有该章。");
	if (version !== chapter.version) throw new Error(`该章已是 v${chapter.version}，请刷新后再改。`);
	if (!text.trim()) throw new Error("修订不能清空整章。");
	if (text === deps.store.read(chapter)) return { chapterId, version: chapter.version, index: chapter.index, chars: chapter.chars };
	const next = chapter.version + 1;
	const file = deps.store.write(chapterId, next, text);
	deps.appendEntry(CHAPTER_REVISION_TYPE, { chapterId, file, version: next, ...(chapter.title ? { title: chapter.title } : {}), chars: text.length, source: "user" });
	return { chapterId, version: next, index: chapter.index, chars: text.length };
}

/**
 * 「回退到第 N 章」的树坐标：写入该章的那一轮的**最后一条条目**（收尾 assistant 之后还有场记落的
 * rp-state / 摘要，都属于这一轮；停在 assistant 上会把这章的账本一起退掉，讨论回放也不能留下没有回执的
 * 工具调用）。同一轮写了多章时，回退到其中任一章＝保留整轮。
 */
export function chapterRewindTarget(branch: BranchEntryLike[], chapterId: string): string | undefined {
	const at = branch.findIndex((e) => e.type === "custom" && e.customType === CHAPTER_ENTRY_TYPE && (e.data as ChapterEntryData | undefined)?.chapterId === chapterId);
	if (at < 0) return undefined;
	let target = branch[at]!.id;
	for (let i = at + 1; i < branch.length; i++) {
		const e = branch[i]!;
		if (e.type === "message" && e.message?.role === "user") break;
		if (e.id) target = e.id;
	}
	return target;
}
