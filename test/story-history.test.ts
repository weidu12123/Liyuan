import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { chapterTitle, diffManifests, formatStoryIndex, lineDiff, listStoryFiles, StoryHistory, storyDirectory } from "../src/stage/story-history.ts";

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "liyuan-history-")));
const write = (dir: string, name: string, text: string) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, name), text, "utf8"); };

test("稿子目录：字典序即顺序，只认 .md，标题去序号与扩展名", () => {
	const chat = tmp();
	try {
		const story = storyDirectory(chat);
		write(story, "002-长街.md", "二");
		write(story, "001-初雪.md", "一一");
		write(story, "笔记.txt", "x");
		write(story, ".草稿.md", "x");
		mkdirSync(join(story, "子目录"));
		const files = listStoryFiles(story);
		assert.deepEqual(files.map((f) => [f.name, f.chars]), [["001-初雪.md", 2], ["002-长街.md", 1]]);
		assert.equal(chapterTitle("001-初雪.md"), "初雪");
		assert.equal(chapterTitle("03. 长街.md"), "长街");
		assert.equal(chapterTitle("尾声.md"), "尾声");
		assert.equal(chapterTitle("007.md"), "007");
		const index = formatStoryIndex(files);
		assert.match(index, /共 2 个文件 3 字/);
		assert.match(index, /001-初雪\.md　2 字/);
		assert.match(formatStoryIndex([]), /尚无文件/);
	} finally { rmSync(chat, { recursive: true, force: true }); }
});

test("快照仓：无变化不落、同内容不重存、改名识别、恢复重写目录并落新检查点", () => {
	const chat = tmp();
	try {
		const story = storyDirectory(chat);
		const h = new StoryHistory(chat);
		assert.equal(h.commit({ author: "agent", message: "空" }), undefined, "空稿子无变化不落");

		write(story, "001-初雪.md", "第一章。");
		write(story, "002-长街.md", "第二章。");
		const c1 = h.commit({ author: "agent", message: "写两章", turnId: "u1" })!;
		assert.deepEqual(c1.changed, { added: ["001-初雪.md", "002-长街.md"], modified: [], renamed: [], removed: [] });
		assert.equal(h.commit({ author: "agent", message: "又一轮纯讨论" }), undefined);
		assert.equal(h.byTurn("u1")?.id, c1.id);

		// 同内容不重存：两个文件内容相同只有一个对象
		write(story, "003-同文.md", "第一章。");
		const c2 = h.commit({ author: "agent", message: "复制一章", turnId: "u2" })!;
		assert.equal(readdirSync(join(h.historyDir, "对象")).length, 2);
		assert.equal(c2.files["003-同文.md"], c2.files["001-初雪.md"]);

		// 改一处 + 改名 + 删一个
		write(story, "001-初雪.md", "第一章。\n她关上门。");
		renameSync(join(story, "002-长街.md"), join(story, "002-长街尽头.md"));
		rmSync(join(story, "003-同文.md"));
		const c3 = h.commit({ author: "agent", message: "改名删章", turnId: "u3", aborted: true })!;
		assert.deepEqual(c3.changed, { added: [], modified: ["001-初雪.md"], renamed: [["002-长街.md", "002-长街尽头.md"]], removed: ["003-同文.md"] });
		assert.equal(c3.aborted, true);

		const d = h.diff(c3.id);
		assert.deepEqual(d.map((f) => [f.kind, f.name]), [["modified", "001-初雪.md"], ["renamed", "002-长街尽头.md"], ["removed", "003-同文.md"]]);
		assert.deepEqual(d[0]!.hunks, [{ op: " ", text: "第一章。" }, { op: "+", text: "她关上门。" }]);

		// 只恢复文件：回到 c1
		const r = h.restore(c1.id)!;
		assert.deepEqual(listStoryFiles(story).map((f) => f.name), ["001-初雪.md", "002-长街.md"]);
		assert.equal(readFileSync(join(story, "001-初雪.md"), "utf8"), "第一章。");
		assert.equal(r.restoredFrom, c1.id);
		assert.deepEqual(r.files, c1.files);
		assert.equal(h.list().length, 4, "恢复本身是一条新检查点，旧的都还在");
		assert.ok(existsSync(join(h.historyDir, "对象", c3.files["001-初雪.md"]!)), "被恢复掉的版本对象仍在");
		assert.equal(h.restore(c1.id), undefined, "已在该状态再恢复一次＝无变化");
		assert.throws(() => h.restore("nope"), /没有这个检查点/);
	} finally { rmSync(chat, { recursive: true, force: true }); }
});

test("清单差与行 diff 是纯函数", () => {
	assert.deepEqual(diffManifests({ a: "1", b: "2" }, { a: "1", c: "2" }), { added: [], modified: [], renamed: [["b", "c"]], removed: [] });
	assert.deepEqual(diffManifests({ a: "1" }, { a: "9", b: "1" }), { added: ["b"], modified: ["a"], renamed: [], removed: [] }, "a 仍在（改了），b 是新增不是改名");
	assert.deepEqual(lineDiff("x\ny\nz", "x\nz\nw"), [{ op: " ", text: "x" }, { op: "-", text: "y" }, { op: " ", text: "z" }, { op: "+", text: "w" }]);
	assert.deepEqual(lineDiff("", ""), []);
});
