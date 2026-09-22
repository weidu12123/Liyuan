/**
 * agent 模式的稿子与快照仓（docs/PLAN-AGENT-CODING.md §三、§四）。
 *
 * 稿子＝`<子项目>/正文/` 下按文件名字典序排列的 .md 文件，就是这些文件，没有别的（不认子目录、不认 frontmatter）。
 * 快照仓＝`<子项目>/历史/`：`对象/<sha256>` 是内容寻址的文件快照，`检查点.jsonl` 一行一个检查点——
 * 每条带当时 正文/ 的完整清单（文件名→sha），这是 git 的 blob＋tree，没有 git 的分支/合并/远端。
 * 对象与检查点只增不改；恢复到旧检查点也是落一条新的，旧的仍在。
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CHAT_HISTORY_DIR, CHAT_STORY_DIR } from "../paths.ts";

export const HISTORY_OBJECTS_DIR = "对象";
export const HISTORY_LOG_FILE = "检查点.jsonl";

export const storyDirectory = (chatDir: string): string => join(chatDir, CHAT_STORY_DIR);
export const historyDirectory = (chatDir: string): string => join(chatDir, CHAT_HISTORY_DIR);

/** 稿子里的一个文件（一章） */
export interface StoryFile {
	name: string;
	chars: number;
	/** 最后一次改动（毫秒时间戳） */
	mtime: number;
}

const isChapterFile = (name: string) => name.toLowerCase().endsWith(".md") && !name.startsWith(".");

/** 稿子目录：字典序即稿子顺序。目录不存在＝空稿子。 */
export function listStoryFiles(storyDir: string): StoryFile[] {
	if (!existsSync(storyDir)) return [];
	return readdirSync(storyDir, { withFileTypes: true })
		.filter((d) => d.isFile() && isChapterFile(d.name))
		.map((d) => d.name)
		.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
		.map((name) => {
			const abs = join(storyDir, name);
			const st = statSync(abs);
			return { name, chars: readFileSync(abs, "utf8").length, mtime: Math.round(st.mtimeMs) };
		});
}

/** 章标题：去掉序号前缀与扩展名（展示用；harness 不据此排序或识别） */
export function chapterTitle(name: string): string {
	const stem = name.replace(/\.md$/i, "");
	const stripped = stem.replace(/^[\d.\-_ ]+(?=\S)/, "").trim();
	return stripped && /[^\d.\-_ ]/.test(stripped) ? stripped : stem;
}

/** 项目状态块里的【稿子目录】：数据，不带正文，不带指令。 */
export function formatStoryIndex(files: StoryFile[]): string {
	if (!files.length) return `【稿子目录】${CHAT_STORY_DIR}/ 尚无文件。`;
	const total = files.reduce((n, f) => n + f.chars, 0);
	const fmt = (ms: number) => {
		const d = new Date(ms);
		const p = (n: number) => String(n).padStart(2, "0");
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
	};
	return [`【稿子目录】${CHAT_STORY_DIR}/ 共 ${files.length} 个文件 ${total} 字（按文件名排序）`, ...files.map((f) => `${f.name}　${f.chars} 字　${fmt(f.mtime)}`)].join("\n");
}

// ---------------- 快照仓 ----------------

/** 文件名 → 内容哈希 */
export type Manifest = Record<string, string>;

export interface ChangeSet {
	added: string[];
	modified: string[];
	/** [旧名, 新名]：内容相同、名字不同 */
	renamed: Array<[string, string]>;
	removed: string[];
}

export interface Checkpoint {
	id: string;
	ts: number;
	author: "agent" | "user";
	/** 这轮 user 条目的 id：讨论与文件之间唯一的对应关系；用户手改没有 */
	turnId?: string;
	message: string;
	aborted?: boolean;
	/** 由哪个检查点恢复而来 */
	restoredFrom?: string;
	files: Manifest;
	changed: ChangeSet;
}

const hashOf = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export const isEmptyChange = (c: ChangeSet): boolean => !c.added.length && !c.modified.length && !c.renamed.length && !c.removed.length;

/** 两份清单的差。改名＝同一哈希在旧清单里消失、在新清单里出现（一对一，多出的算增删）。 */
export function diffManifests(prev: Manifest, next: Manifest): ChangeSet {
	const out: ChangeSet = { added: [], modified: [], renamed: [], removed: [] };
	const gone = Object.keys(prev).filter((n) => !(n in next));
	const fresh = Object.keys(next).filter((n) => !(n in prev));
	const byHash = new Map<string, string[]>();
	for (const n of gone) byHash.set(prev[n]!, [...(byHash.get(prev[n]!) ?? []), n]);
	for (const n of fresh) {
		const olds = byHash.get(next[n]!);
		if (olds?.length) out.renamed.push([olds.shift()!, n]);
		else out.added.push(n);
	}
	for (const olds of byHash.values()) out.removed.push(...olds);
	for (const n of Object.keys(next)) if (n in prev && prev[n] !== next[n]) out.modified.push(n);
	const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
	out.added.sort(cmp); out.modified.sort(cmp); out.removed.sort(cmp); out.renamed.sort((a, b) => cmp(a[1], b[1]));
	return out;
}

export class StoryHistory {
	readonly storyDir: string;
	readonly historyDir: string;
	constructor(chatDir: string) {
		this.storyDir = storyDirectory(chatDir);
		this.historyDir = historyDirectory(chatDir);
	}

	private get objectsDir() { return join(this.historyDir, HISTORY_OBJECTS_DIR); }
	private get logFile() { return join(this.historyDir, HISTORY_LOG_FILE); }

	/** 全部检查点，按时间顺序 */
	list(): Checkpoint[] {
		if (!existsSync(this.logFile)) return [];
		const out: Checkpoint[] = [];
		for (const line of readFileSync(this.logFile, "utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				const c = JSON.parse(line) as Checkpoint;
				if (c && typeof c.id === "string" && c.files && typeof c.files === "object") out.push(c);
			} catch { /* 坏行跳过：只增不改的日志，一行坏不该拖垮整仓 */ }
		}
		return out;
	}

	get(id: string): Checkpoint | undefined {
		return this.list().find((c) => c.id === id);
	}

	latest(): Checkpoint | undefined {
		const all = this.list();
		return all[all.length - 1];
	}

	/** 某检查点里一个文件的内容 */
	readObject(sha: string): string {
		return readFileSync(join(this.objectsDir, sha), "utf8");
	}

	/** 把 正文/ 现状写进对象仓，返回清单（同内容不重存）。 */
	snapshot(): Manifest {
		const manifest: Manifest = {};
		for (const f of listStoryFiles(this.storyDir)) {
			const text = readFileSync(join(this.storyDir, f.name), "utf8");
			const sha = hashOf(text);
			const abs = join(this.objectsDir, sha);
			if (!existsSync(abs)) {
				mkdirSync(this.objectsDir, { recursive: true });
				writeFileSync(abs, text, "utf8");
			}
			manifest[f.name] = sha;
		}
		return manifest;
	}

	/**
	 * 落一条检查点。正文/ 与上一条清单相同则不落（返回 undefined）。
	 * 这是唯一的写入口：轮末、用户手改、恢复之后都从这里过。
	 */
	commit(o: { author: Checkpoint["author"]; message: string; turnId?: string; aborted?: boolean; restoredFrom?: string; force?: boolean }): Checkpoint | undefined {
		const prev = this.latest();
		const files = this.snapshot();
		const changed = diffManifests(prev?.files ?? {}, files);
		if (isEmptyChange(changed) && !o.force) return undefined;
		const c: Checkpoint = {
			id: `${Date.now().toString(36)}-${hashOf(JSON.stringify(files) + Math.random()).slice(0, 6)}`,
			ts: Date.now(),
			author: o.author,
			...(o.turnId ? { turnId: o.turnId } : {}),
			message: o.message,
			...(o.aborted ? { aborted: true } : {}),
			...(o.restoredFrom ? { restoredFrom: o.restoredFrom } : {}),
			files,
			changed,
		};
		mkdirSync(this.historyDir, { recursive: true });
		appendFileSync(this.logFile, `${JSON.stringify(c)}\n`, "utf8");
		return c;
	}

	/**
	 * 只恢复文件：把 正文/ 重写成该检查点的清单（多出的 .md 删掉、缺的从对象仓写回），然后落一条新检查点。
	 * 讨论不动——「文件和对话一起恢复」由宿主在此之后截讨论。
	 */
	restore(id: string, author: Checkpoint["author"] = "user"): Checkpoint | undefined {
		const target = this.get(id);
		if (!target) throw new Error("没有这个检查点。");
		mkdirSync(this.storyDir, { recursive: true });
		for (const f of listStoryFiles(this.storyDir)) if (!(f.name in target.files)) rmSync(join(this.storyDir, f.name));
		for (const [name, sha] of Object.entries(target.files)) {
			const text = this.readObject(sha);
			const abs = join(this.storyDir, name);
			if (!existsSync(abs) || readFileSync(abs, "utf8") !== text) writeFileSync(abs, text, "utf8");
		}
		return this.commit({ author, message: `恢复到「${target.message}」`, restoredFrom: id });
	}

	/** 按这轮 user 条目找检查点（一轮至多一条） */
	byTurn(turnId: string): Checkpoint | undefined {
		return this.list().find((c) => c.turnId === turnId);
	}

	/** 某检查点相对前一条的逐文件差（展示用） */
	diff(id: string): FileDiff[] {
		const all = this.list();
		const at = all.findIndex((c) => c.id === id);
		if (at < 0) throw new Error("没有这个检查点。");
		const cur = all[at]!;
		const prev = at > 0 ? all[at - 1]!.files : {};
		const out: FileDiff[] = [];
		const read = (sha: string | undefined) => (sha ? this.readObject(sha) : "");
		for (const n of cur.changed.added) out.push({ kind: "added", name: n, hunks: lineDiff("", read(cur.files[n])) });
		for (const n of cur.changed.modified) out.push({ kind: "modified", name: n, hunks: lineDiff(read(prev[n]), read(cur.files[n])) });
		for (const [from, to] of cur.changed.renamed) out.push({ kind: "renamed", name: to, from, hunks: [] });
		for (const n of cur.changed.removed) out.push({ kind: "removed", name: n, hunks: lineDiff(read(prev[n]), "") });
		return out;
	}
}

// ---------------- 行级 diff（纯函数） ----------------

export interface DiffLine { op: " " | "-" | "+"; text: string }
export interface FileDiff { kind: "added" | "modified" | "renamed" | "removed"; name: string; from?: string; hunks: DiffLine[] }

/** 最长公共子序列的行 diff；相同行用 " "，删 "-"，增 "+"。稿子文件几百行，O(n·m) 够用。 */
export function lineDiff(a: string, b: string): DiffLine[] {
	const A = a ? a.split("\n") : [];
	const B = b ? b.split("\n") : [];
	const n = A.length, m = B.length;
	const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
	for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
	const out: DiffLine[] = [];
	let i = 0, j = 0;
	while (i < n && j < m) {
		if (A[i] === B[j]) { out.push({ op: " ", text: A[i]! }); i++; j++; }
		else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ op: "-", text: A[i++]! });
		else out.push({ op: "+", text: B[j++]! });
	}
	while (i < n) out.push({ op: "-", text: A[i++]! });
	while (j < m) out.push({ op: "+", text: B[j++]! });
	return out;
}
