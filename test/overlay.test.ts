import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { appendOverlayEntry, loadLorebookFile, mergeEntries, searchEntries } from "../src/lorebook.ts";

const dir = mkdtempSync(join(tmpdir(), "rp-lore-"));
const file = join(dir, "测试卡.json");
after(() => rmSync(dir, { recursive: true, force: true }));

test("补充设定集：创建、追加、指纹去重", () => {
	const a = appendOverlayEntry(file, {
		title: "北境骨誓",
		keys: ["骨誓", "bone oath"],
		content: "北境人以折骨为誓，毁誓者被逐出氏族。",
	});
	assert.ok(a);
	assert.equal(a.comment, "北境骨誓");
	assert.ok(a.uid >= 9000, "overlay uid 独立空间");
	assert.equal(a.constant, false);

	const b = appendOverlayEntry(file, {
		title: "换个标题也不行",
		keys: ["别名"],
		content: "北境人以折骨为誓，毁誓者被逐出氏族。",
	});
	assert.equal(b, null, "内容指纹一致应拒绝写入");

	const c = appendOverlayEntry(file, { title: "王都宵禁", keys: ["宵禁"], content: "王都亥时起宵禁。", constant: true });
	assert.ok(c);
	assert.equal(c.constant, true);
	assert.equal(c.uid, 9001);
});

test("补充设定集：loadLorebookFile 可读，合并与检索生效", () => {
	const overlay = loadLorebookFile(file);
	assert.equal(overlay.length, 2);
	const merged = mergeEntries([], overlay);
	const hits = searchEntries(merged, "骨誓", 3);
	assert.ok(hits.length > 0);
	assert.equal(hits[0].entry.comment, "北境骨誓");
});
