import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	constantEntries,
	loadLorebookFile,
	loreFingerprint,
	mergeEntries,
	normalizeEntries,
	patchLorebookFileEntry,
	scanEntries,
	searchEntries,
} from "../src/lorebook.ts";

const bookPath = fileURLToPath(new URL("../assets/lorebooks/Mistvale.json", import.meta.url));

test("ST 世界书格式加载（key/disable/order）", () => {
	const entries = loadLorebookFile(bookPath);
	assert.equal(entries.length, 4);
	assert.ok(entries.every((e) => e.enabled));
	assert.equal(constantEntries(entries).length, 0);
});

test("卡内嵌格式归一化（keys/enabled/insertion_order）", () => {
	const entries = normalizeEntries([
		{ id: 7, keys: ["a", "b"], secondary_keys: ["c"], enabled: false, insertion_order: 42, content: "x", name: "t" },
	]);
	assert.equal(entries[0].uid, 7);
	assert.deepEqual(entries[0].keys, ["a", "b"]);
	assert.deepEqual(entries[0].secondaryKeys, ["c"]);
	assert.equal(entries[0].enabled, false);
	assert.equal(entries[0].order, 42);
	assert.equal(entries[0].comment, "t");
});

test("合并去重（独立世界书与卡内嵌书内容相同）", () => {
	const entries = loadLorebookFile(bookPath);
	const merged = mergeEntries(entries, entries);
	assert.equal(merged.length, 4);
});

test("关键词被动激活：英文命中", () => {
	const entries = loadLorebookFile(bookPath);
	const activated = scanEntries(entries, "Last night I was chased by a Gloomhound through the woods.", 5);
	const comments = activated.map((e) => e.comment);
	assert.ok(comments.includes("gloomhound"));
	assert.ok(comments.includes("mistvale"), "woods 应触发 mistvale 条目（key: wood）");
});

test("关键词被动激活：中文文本不误触发（验证 S2 探针场景成立）", () => {
	const entries = loadLorebookFile(bookPath);
	const activated = scanEntries(entries, "我昨晚在树林里被黑色的怪兽追赶，太可怕了。", 5);
	assert.equal(activated.length, 0);
});

test("激活上限", () => {
	const entries = loadLorebookFile(bookPath);
	const activated = scanEntries(entries, "gloomhound beast in mistvale forest glade with magic power", 2);
	assert.equal(activated.length, 2);
});

test("主动检索：Gloomhound 排第一", () => {
	const entries = loadLorebookFile(bookPath);
	const hits = searchEntries(entries, "Gloomhound curse darkness", 3);
	assert.ok(hits.length >= 1);
	assert.equal(hits[0].entry.comment, "gloomhound");
});

test("主动检索：空查询与无命中", () => {
	const entries = loadLorebookFile(bookPath);
	assert.deepEqual(searchEntries(entries, "", 3), []);
	assert.deepEqual(searchEntries(entries, "量子力学", 3), []);
});

test("patchLorebookFileEntry：改 constant/order 写回并保留其它条目", () => {
	const dir = mkdtempSync(join(tmpdir(), "liyuan-lore-"));
	try {
		const dest = join(dir, "Mistvale.json");
		copyFileSync(bookPath, dest);
		const before = loadLorebookFile(dest);
		const target = before[0];
		const fp = loreFingerprint(target.content);
		const r = patchLorebookFileEntry(dest, fp, { constant: true, order: 7 });
		assert.ok(r);
		assert.equal(r.entry.constant, true);
		assert.equal(r.entry.order, 7);
		const after = loadLorebookFile(dest);
		assert.equal(after.length, before.length);
		const updated = after.find((e) => loreFingerprint(e.content) === fp);
		assert.ok(updated);
		assert.equal(updated.constant, true);
		assert.equal(updated.order, 7);
		// 文件仍是合法 JSON
		assert.ok(JSON.parse(readFileSync(dest, "utf8")).entries);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
