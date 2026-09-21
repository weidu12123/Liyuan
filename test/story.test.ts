import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { chatModeOfSessionDir, createChat, readChatMeta } from "../src/cardspace.ts";
import { storyBranch, messageMode, CONVERSATION_PROCESS_TYPE } from "../src/conversation-mode.ts";
import { collectChatEvidence } from "../src/card-memory.ts";
import { sandboxScope, sandboxVerdict, harnessManagedPath } from "../src/sandbox.ts";
import { buildAgentStateBlock } from "../src/stage/agent.ts";
import { stateFromBranch, SUMMARY_ENTRY_TYPE, type BranchEntryLike } from "../src/stage/assemble.ts";
import { planCompaction } from "../src/stage/compact.ts";
import { prependToLastUser } from "../src/stage/engine.ts";
import {
	CHAPTER_ENTRY_TYPE, CHAPTER_REVISION_TYPE, formatStoryTail, hasChapters, projectChapters, runStoryTool, StoryStore, storyDirectory, storyTail,
	storyTools, type StoryToolDeps,
} from "../src/stage/story.ts";
import { buildScribeTurnPrompt } from "../src/scribe.ts";
import { defaultState } from "../src/state.ts";

/** 一个内存里的会话树：只模拟 appendCustomEntry 与分支（线性），够 story 工具用 */
function makeTree(dir: string) {
	const branch: BranchEntryLike[] = [];
	let n = 0;
	const deps: StoryToolDeps = {
		store: new StoryStore(dir),
		getBranch: () => branch,
		appendEntry: (customType, data) => { branch.push({ id: `e${++n}`, type: "custom", customType, data }); },
	};
	const user = (text: string) => branch.push({ id: `u${++n}`, type: "message", message: { role: "user", content: text, details: { liyuanMode: "agent" } } });
	return { branch, deps, user };
}

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "liyuan-story-")));

test("story：append 落文件＋树条目，投影按分支顺序编号；edit 写时复制、版本冲突整批不改、不许清空", () => {
	const dir = tmp();
	try {
		const { branch, deps, user } = makeTree(storyDirectory(dir));
		user("写第一章");
		const a1 = runStoryTool(deps, "story_append", { content: "第一章正文。\n\n她推开门。", title: "山门" });
		assert.equal(a1.isError, undefined);
		assert.ok(a1.appended);
		assert.equal(a1.appended!.chapter.index, 1);
		const a2 = runStoryTool(deps, "story_append", { content: "第二章正文。" });
		assert.equal(a2.appended!.chapter.index, 2);
		assert.deepEqual(readdirSync(storyDirectory(dir)).sort(), [a1.appended!.chapter.file, a2.appended!.chapter.file].sort());

		const outline = JSON.parse(runStoryTool(deps, "story_outline", {}).text);
		assert.deepEqual(outline.chapters.map((c: { index: number; title?: string; version: number }) => [c.index, c.title, c.version]), [[1, "山门", 1], [2, undefined, 1]]);
		assert.equal(outline.totalChars, "第一章正文。\n\n她推开门。".length + "第二章正文。".length);

		const id1 = a1.appended!.chapter.chapterId;
		// 版本冲突：整批不改、不落条目、不写文件
		const bad = runStoryTool(deps, "story_edit", { chapterId: id1, version: 2, edits: [{ old: "推开门", new: "关上门" }] });
		assert.equal(bad.isError, true);
		assert.match(bad.text, /版本冲突/);
		assert.equal(branch.filter((e) => e.customType === CHAPTER_REVISION_TYPE).length, 0);
		// 一处失败整批不改
		const partial = runStoryTool(deps, "story_edit", { chapterId: id1, version: 1, edits: [{ old: "推开门", new: "关上门" }, { old: "不存在的句子", new: "x" }] });
		assert.equal(partial.isError, true);
		assert.equal(projectChapters(branch)[0]!.version, 1);
		// 清空拒绝
		const empty = runStoryTool(deps, "story_edit", { chapterId: id1, version: 1, edits: [{ old: "第一章正文。\n\n她推开门。", new: " " }] });
		assert.equal(empty.isError, true);
		assert.match(empty.text, /清空/);
		// 成功：新文件、旧文件仍在、投影指向 v2
		const ok = runStoryTool(deps, "story_edit", { chapterId: id1, version: 1, edits: [{ old: "推开门", new: "关上门" }] });
		assert.equal(ok.isError, undefined, ok.text);
		assert.equal(ok.appended, undefined, "story_edit 不是定稿边界");
		const chapters = projectChapters(branch);
		assert.equal(chapters[0]!.version, 2);
		assert.equal(chapters[0]!.title, "山门");
		assert.ok(existsSync(join(storyDirectory(dir), a1.appended!.chapter.file)), "旧版本文件不被覆盖");
		assert.equal(deps.store.read(chapters[0]!), "第一章正文。\n\n她关上门。");
		assert.equal(deps.store.read(chapters[1]!), "第二章正文。");

		// read：按 id 列表 / 尾部 / 范围
		const read = JSON.parse(runStoryTool(deps, "story_read", { chapterIds: [id1] }).text);
		assert.equal(read.chapters[0].version, 2);
		assert.equal(read.chapters[0].content, "第一章正文。\n\n她关上门。");
		const ranged = JSON.parse(runStoryTool(deps, "story_read", { chapterIds: [id1], start: 0, end: 5 }).text);
		assert.equal(ranged.chapters[0].content, "第一章正文");
		const tail = JSON.parse(runStoryTool(deps, "story_read", { tail: 3 }).text);
		assert.equal(tail.chapters.length, 1);
		assert.equal(tail.chapters[0].content, "第二章正文。".slice(-3));
		assert.equal(runStoryTool(deps, "story_read", { chapterIds: ["nope"] }).isError, true);
		// grep
		const hits = JSON.parse(runStoryTool(deps, "story_grep", { query: "正文" }).text);
		assert.equal(hits.total, 2);
		assert.deepEqual(hits.hits.map((h: { index: number; line: number }) => [h.index, h.line]), [[1, 1], [2, 1]]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("story：分支隔离——兄弟分支看不到对方的章与修订；回退到某章＝投影截断", () => {
	const dir = tmp();
	try {
		const { branch, deps } = makeTree(storyDirectory(dir));
		runStoryTool(deps, "story_append", { content: "共同的第一章。" });
		const forkAt = branch.length;
		runStoryTool(deps, "story_append", { content: "A 线第二章。" });
		const id1 = projectChapters(branch)[0]!.chapterId;
		runStoryTool(deps, "story_edit", { chapterId: id1, version: 1, edits: [{ old: "共同", new: "A 改过" }] });
		const lineA = [...branch];
		// 另一条线：从第一章之后分叉
		const lineB = branch.slice(0, forkAt);
		const depsB: StoryToolDeps = { ...deps, getBranch: () => lineB, appendEntry: (t, d) => lineB.push({ id: `b${lineB.length}`, type: "custom", customType: t, data: d }) };
		runStoryTool(depsB, "story_append", { content: "B 线第二章。" });
		const a = projectChapters(lineA), b = projectChapters(lineB);
		assert.equal(a[0]!.version, 2);
		assert.equal(b[0]!.version, 1, "B 线仍看第一章旧版");
		assert.equal(deps.store.read(b[0]!), "共同的第一章。");
		assert.equal(deps.store.read(a[1]!), "A 线第二章。");
		assert.equal(deps.store.read(b[1]!), "B 线第二章。");
		// 回退到第一章＝分支截到该条目
		const rewound = lineA.slice(0, forkAt);
		assert.equal(projectChapters(rewound).length, 1);
		assert.ok(hasChapters(rewound));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("story：尾部按预算从末章往前取，装不下的那章从段落边界截；块只是数据", () => {
	const dir = tmp();
	try {
		const { branch, deps } = makeTree(storyDirectory(dir));
		runStoryTool(deps, "story_append", { content: "甲".repeat(100) + "\n" + "乙".repeat(100), title: "一" });
		runStoryTool(deps, "story_append", { content: "丙".repeat(50), title: "二" });
		const chapters = projectChapters(branch);
		const t = storyTail(deps.store, chapters, 160);
		assert.equal(t.pieces.length, 2);
		assert.equal(t.pieces[1]!.from, 0);
		assert.equal(t.pieces[0]!.text, "乙".repeat(100), "第一章只取换行之后的段（预算内往后找段落起点）");
		assert.equal(t.pieces[0]!.from, 101);
		assert.equal(storyTail(deps.store, chapters, 120).pieces[0]!.text, "乙".repeat(70), "预算内没有段落起点就硬截，不超预算");
		const text = formatStoryTail(t);
		assert.match(text, /【稿子尾部】共 2 章 251 字；以下是最后 150 字/);
		assert.match(text, /第 1 章「一」 chapterId=\S+ v1（第 101–201 字，共 201 字）/);
		assert.match(text, /第 2 章「二」 chapterId=\S+ v1（全文 50 字）/);
		assert.doesNotMatch(text, /请|先读|必须/);
		assert.equal(formatStoryTail(storyTail(deps.store, [], 100)), "【稿子尾部】尚无章节。");
		// 状态块顺序：前情 → 账本 → 名录 → 尾部；压在末条 user 原话之前
		const block = buildAgentStateBlock({ state: defaultState(), rosterIndex: "共 1 名：她（第 1 章）", summary: "早年。", tail: t });
		assert.ok(block.indexOf("【前情提要】") < block.indexOf("【世界状态】") && block.indexOf("【世界状态】") < block.indexOf("【登场名录】") && block.indexOf("【登场名录】") < block.indexOf("【稿子尾部】"));
		const history = [{ role: "user", content: "早" }, { role: "assistant", content: "好" }, { role: "user", content: [{ type: "text", text: "写第三章" }] }];
		prependToLastUser(history, block);
		assert.equal(history[0]!.content, "早");
		assert.equal((history[2]!.content as Array<{ text: string }>)[0]!.text, `${block}\n\n写第三章`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("story：agent 讨论不进 story 流，数据条目仍在；压缩按章、覆盖锚在章条目上；证据从章取", () => {
	const dir = tmp();
	try {
		const cardDir = join(dir, "cards", "云澜");
		mkdirSync(cardDir, { recursive: true });
		const chat = createChat(cardDir, { mode: "agent", name: "长篇" });
		assert.equal(readChatMeta(cardDir, chat.id)?.mode, "agent");
		assert.equal(chatModeOfSessionDir(chat.sessionsDir), "agent");
		assert.equal(chatModeOfSessionDir(createChat(cardDir).sessionsDir), undefined);

		const { branch, deps, user } = makeTree(storyDirectory(chat.dir));
		user("讨论一下开头");
		branch.push({ id: "p1", type: "custom", customType: CONVERSATION_PROCESS_TYPE, data: { requestId: "u1", mode: "agent", message: { role: "assistant", content: "好的" } } });
		branch.push({ id: "a1", type: "message", message: { role: "assistant", content: "DISCUSSION", details: { liyuanMode: "agent" } } });
		user("写吧");
		for (let i = 1; i <= 4; i++) {
			runStoryTool(deps, "story_append", { content: `第${i}章。`.repeat(300), title: `第${i}章` });
			branch.push({ id: `s${i}`, type: "custom", customType: "rp-state", data: { ...defaultState(), location: `地点${i}` } });
		}
		assert.equal(messageMode(branch[0]!.message), "agent");
		const story = storyBranch(branch);
		assert.equal(story.filter((e) => e.type === "message").length, 0, "讨论不进 story 流");
		assert.equal(story.filter((e) => e.customType === CHAPTER_ENTRY_TYPE).length, 4, "章条目留在剧情侧");
		assert.equal(stateFromBranch(branch).location, "地点4");

		// 按章压缩：keep 1、每章判一次 → 覆盖前三章，锚在第三章条目
		const plan = planCompaction(branch, { userName: "我", charName: "她", everyNTurns: 1, keepRecentBeats: 1, minChars: 1, story: deps.store })!;
		assert.ok(plan);
		assert.equal(plan.turns, 3);
		assert.equal(plan.coversThroughId, projectChapters(branch)[2]!.entryId);
		assert.match(plan.conversationText, /第 1 章「第1章」/);
		assert.doesNotMatch(plan.conversationText, /DISCUSSION|第4章。/);
		assert.equal(planCompaction(branch, { userName: "我", charName: "她", everyNTurns: 1, keepRecentBeats: 4, minChars: 1, story: deps.store }), null);
		// 落一份摘要后：只剩第 4 章活着 → 不到期；再写一章 → 覆盖第 4 章
		branch.push({ id: "sum", type: "custom", customType: SUMMARY_ENTRY_TYPE, data: { summary: "前三章摘要", coversThroughId: plan.coversThroughId } });
		assert.equal(planCompaction(branch, { userName: "我", charName: "她", everyNTurns: 1, keepRecentBeats: 1, minChars: 1, story: deps.store }), null);
		runStoryTool(deps, "story_append", { content: "第5章。".repeat(300) });
		const plan2 = planCompaction(branch, { userName: "我", charName: "她", everyNTurns: 1, keepRecentBeats: 1, minChars: 1, story: deps.store })!;
		assert.equal(plan2.turns, 1);
		assert.equal(plan2.previousSummary, "前三章摘要");
		assert.match(plan2.conversationText, /第 4 章/);

		// 局复盘证据：从章取，拍数＝章数
		writeFileSync(join(chat.sessionsDir, "s.jsonl"), branch.map((e, i) => JSON.stringify({ ...e, parentId: i ? branch[i - 1]!.id : null })).join("\n") + "\n");
		const evidence = collectChatEvidence(chat, "我", "她")!;
		assert.ok(evidence);
		assert.equal(evidence.beats, 5);
		assert.match(evidence.transcript, /第 5 章/);
		assert.doesNotMatch(evidence.transcript, /DISCUSSION/);
		assert.match(evidence.stateSnapshot, /地点4/);

		// 场记：章写入没有「用户这一拍的话」，提示词里不出现空的用户行；扮演路径逐字不变
		const agent = buildScribeTurnPrompt({ state: defaultState(), userText: "", assistantText: "章原文", charName: "她", userName: "我" });
		assert.match(agent.userText, /【本轮对话】\n章原文$/);
		const rp = buildScribeTurnPrompt({ state: defaultState(), userText: "你好", assistantText: "回复", charName: "她", userName: "我" });
		assert.match(rp.userText, /【本轮对话】\n我：你好\n\n她：回复$/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("story：沙箱——对话/<id>/正文 与 会话 对原生写工具只读，读照常，卡目录其余照旧", () => {
	const cwd = tmp();
	try {
		const cardDir = join(cwd, "cards", "云澜");
		mkdirSync(join(cardDir, "对话", "c1", "正文"), { recursive: true });
		mkdirSync(join(cardDir, "对话", "c1", "会话"), { recursive: true });
		mkdirSync(join(cardDir, "创作"), { recursive: true });
		writeFileSync(join(cardDir, "云澜.json"), JSON.stringify({ data: { name: "云澜" } }));
		writeFileSync(join(cardDir, "对话", "c1", "正文", "x.v1.md"), "章");
		const scope = sandboxScope(cwd, { card: "cards/云澜/云澜.json" });
		const grants = { dirs: [], bash: false };
		assert.equal(harnessManagedPath(cardDir, join(cardDir, "对话", "c1", "正文", "x.v1.md")), true);
		assert.equal(harnessManagedPath(cardDir, join(cardDir, "对话", "c1", "会话", "a.jsonl")), true);
		assert.equal(harnessManagedPath(cardDir, join(cardDir, "对话", "c1", "世界状态.json")), false);
		assert.equal(harnessManagedPath(cardDir, join(cardDir, "创作", "a.md")), false);
		assert.equal(sandboxVerdict("write", { path: join(cardDir, "对话", "c1", "正文", "x.v1.md") }, scope, grants).kind, "deny");
		assert.equal(sandboxVerdict("edit", { path: join(cardDir, "对话", "c1", "会话", "a.jsonl") }, scope, grants).kind, "deny");
		assert.equal(sandboxVerdict("read", { path: join(cardDir, "对话", "c1", "正文", "x.v1.md") }, scope, grants).kind, "allow");
		assert.equal(sandboxVerdict("grep", { path: join(cardDir, "对话", "c1", "正文") }, scope, grants).kind, "allow");
		assert.equal(sandboxVerdict("write", { path: join(cardDir, "对话", "c1", "面板.json") }, scope, grants).kind, "allow");
		assert.equal(sandboxVerdict("write", { path: join(cardDir, "创作", "a.md") }, scope, grants).kind, "allow");
		assert.equal(storyTools().map((t) => t.name).join(","), "story_outline,story_read,story_grep,story_append,story_edit");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
