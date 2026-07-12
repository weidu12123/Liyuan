import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	appendCodexEntry,
	CODEX_NAME_MAX,
	codexPathFor,
	createCodex,
	deleteCodexEntry,
	findCodex,
	formatCodexIndex,
	keysFromTitle,
	listCodexes,
	loadCodexEntries,
	userEntryToCodexInput,
	validateCodexName,
} from "../src/codex.ts";
import { loreFingerprint, searchEntries } from "../src/lorebook.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "rp-codex-"));

test("createCodex：创建/同名拒绝/列表可见", () => {
	const cwd = tmp();
	try {
		const r = createCodex(cwd, "九州风物志", "跨剧本的风物图鉴");
		assert.ok(r.ok);
		assert.ok(r.ok && r.meta.entryCount === 0);

		const dup = createCodex(cwd, " 九州风物志 ");
		assert.ok(!dup.ok, "同名（含空白差异）拒绝");

		const list = listCodexes(cwd);
		assert.equal(list.length, 1);
		assert.equal(list[0].name, "九州风物志");
		assert.equal(list[0].description, "跨剧本的风物图鉴");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("validateCodexName：空名/超长/纯特殊字符拒绝", () => {
	assert.ok(validateCodexName("  "));
	assert.ok(validateCodexName("x".repeat(CODEX_NAME_MAX + 1)));
	assert.ok(validateCodexName("///"));
	assert.equal(validateCodexName("奇物图鉴"), null);
});

test("appendCodexEntry：写入/内容去重/不存在的库报错", () => {
	const cwd = tmp();
	try {
		createCodex(cwd, "奇物图鉴");
		const r = appendCodexEntry(cwd, "奇物图鉴", {
			title: "赤髓·蚀骨兰",
			keys: ["蚀骨兰", "chigsui"],
			content: "生于火山岩缝的赤色兰花，汁液可蚀铁。",
		});
		assert.ok(r.ok && r.entry, "写入成功");
		assert.ok(r.ok && r.entry && r.entry.uid >= 20000, "uid 在知识库专属段");

		const dup = appendCodexEntry(cwd, "奇物图鉴", {
			title: "换个标题",
			keys: [],
			content: "生于火山岩缝的赤色兰花，汁液可蚀铁。",
		});
		assert.ok(dup.ok && dup.entry === null, "内容指纹重复不写入");

		const missing = appendCodexEntry(cwd, "不存在的库", { title: "x", keys: [], content: "y" });
		assert.ok(!missing.ok);

		const entries = loadCodexEntries(cwd, "奇物图鉴");
		assert.ok(entries && entries.length === 1);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("知识库条目可被 searchEntries 检索（与世界书同构）", () => {
	const cwd = tmp();
	try {
		createCodex(cwd, "风物志");
		appendCodexEntry(cwd, "风物志", {
			title: "蚀骨兰",
			keys: ["蚀骨兰"],
			content: "赤色兰花，汁液可蚀铁。",
		});
		const entries = loadCodexEntries(cwd, "风物志")!;
		const hits = searchEntries(entries, "蚀骨兰", 3);
		assert.equal(hits.length, 1);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("findCodex 大小写不敏感；codexPathFor 清洗非法文件名字符", () => {
	const cwd = tmp();
	try {
		createCodex(cwd, "Bestiary");
		assert.ok(findCodex(cwd, "bestiary"));
		assert.ok(!codexPathFor(cwd, 'a:b?"c"').includes("?"));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("formatCodexIndex：速览格式与空表", () => {
	assert.equal(formatCodexIndex([]), null);
	assert.equal(
		formatCodexIndex([
			{ name: "风物志", entryCount: 12 },
			{ name: "图鉴", entryCount: 3 },
		]),
		"风物志(12 条)、图鉴(3 条)",
	);
});

test("userEntryToCodexInput：名字+信息 → 标准字段，keys 从名字派生", () => {
	const input = userEntryToCodexInput("赤髓·蚀骨兰", "生于火山岩缝的赤色兰花。");
	assert.equal(input.title, "赤髓·蚀骨兰");
	assert.equal(input.content, "生于火山岩缝的赤色兰花。");
	assert.ok(input.keys.includes("赤髓·蚀骨兰"));
	assert.ok(input.keys.includes("赤髓") || input.keys.includes("蚀骨兰"));
	assert.equal(input.constant, false);
	assert.deepEqual(keysFromTitle("单纯名"), ["单纯名"]);
});

test("deleteCodexEntry：按指纹删除", () => {
	const cwd = tmp();
	try {
		createCodex(cwd, "图鉴");
		const r = appendCodexEntry(cwd, "图鉴", userEntryToCodexInput("甲", "内容甲"));
		assert.ok(r.ok && r.entry);
		appendCodexEntry(cwd, "图鉴", userEntryToCodexInput("乙", "内容乙"));
		const fp = loreFingerprint(r.entry!.content);
		const del = deleteCodexEntry(cwd, "图鉴", fp);
		assert.ok(del.ok && del.removed);
		const left = loadCodexEntries(cwd, "图鉴")!;
		assert.equal(left.length, 1);
		assert.equal(left[0].comment, "乙");
		const miss = deleteCodexEntry(cwd, "图鉴", fp);
		assert.ok(miss.ok && !miss.removed);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
