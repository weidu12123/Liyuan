import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	appendLorebookFileEntry,
	constantEntries,
	deleteLorebookFileEntry,
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

test("ST 世界书与卡内嵌格式保留 position/depth/role/outletName", () => {
	const entries = normalizeEntries([
		{ uid: 1, key: ["k1"], content: "before", position: 0 },
		{ uid: 2, key: ["k2"], content: "after", position: 1 },
		{ uid: 3, key: ["k3"], content: "atDepth", position: 4, depth: 2, role: 2 },
		{ uid: 4, key: ["k4"], content: "outlet", position: 7, outletName: "custom_slot" },
		{
			id: 5,
			keys: ["k5"],
			content: "cardExtDepth",
			position: "before_char",
			extensions: { position: 4, depth: 3, role: 1, outlet_name: "from_ext" },
		},
		{ id: 6, keys: ["k6"], content: "cardAfterChar", position: "after_char" },
	]);
	assert.equal(entries[0].position, 0);
	assert.equal(entries[1].position, 1);
	assert.equal(entries[2].position, 4);
	assert.equal(entries[2].depth, 2);
	assert.equal(entries[2].role, "assistant");
	assert.equal(entries[3].position, 7);
	assert.equal(entries[3].outletName, "custom_slot");
	assert.equal(entries[4].position, 4);
	assert.equal(entries[4].depth, 3);
	assert.equal(entries[4].role, "user");
	assert.equal(entries[4].outletName, "from_ext");
	assert.equal(entries[5].position, 1);
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

test("appendLorebookFileEntry：ST 对象 entries——保持对象形态与顶层字段，uid 不撞车", () => {
	const dir = mkdtempSync(join(tmpdir(), "liyuan-lore-add-"));
	try {
		const dest = join(dir, "Mistvale.json");
		copyFileSync(bookPath, dest);
		const before = loadLorebookFile(dest);
		const beforeJson = JSON.parse(readFileSync(dest, "utf8")) as Record<string, unknown>;
		const added = appendLorebookFileEntry(dest, {
			comment: "南阳宵禁",
			keys: ["南阳", "宵禁"],
			content: "南阳城亥时起宵禁，巡夜的是黑甲卫。",
		});
		assert.ok(added);
		assert.equal(added.comment, "南阳宵禁");
		assert.deepEqual(added.keys, ["南阳", "宵禁"]);
		assert.equal(added.constant, false, "默认蓝灯");
		assert.equal(added.enabled, true);
		assert.equal(added.order, 100);

		const json = JSON.parse(readFileSync(dest, "utf8")) as Record<string, unknown>;
		assert.ok(!Array.isArray(json.entries), "对象 entries 必须仍是对象");
		assert.equal(json.name, beforeJson.name, "顶层 name 等字段不得丢失");
		const after = loadLorebookFile(dest);
		assert.equal(after.length, before.length + 1);
		// uid 唯一——别名缓存按 uid 键控，撞车会串条目
		const uids = after.map((e) => e.uid);
		assert.equal(new Set(uids).size, uids.length, "uid 必须唯一");

		// 内容重复：返回 null 且不写文件
		const snapshot = readFileSync(dest, "utf8");
		const dup = appendLorebookFileEntry(dest, {
			comment: "另起标题",
			keys: ["x"],
			content: "南阳城亥时起宵禁，巡夜的是黑甲卫。",
		});
		assert.equal(dup, null);
		assert.equal(readFileSync(dest, "utf8"), snapshot, "重复内容不得写文件");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("appendLorebookFileEntry：文件不存在则新建数组格式；绿灯/次要词/order 落位", () => {
	const dir = mkdtempSync(join(tmpdir(), "liyuan-lore-add2-"));
	try {
		const dest = join(dir, "nested", "overlay.json");
		const a = appendLorebookFileEntry(dest, {
			comment: "王都",
			keys: ["王都"],
			content: "王都居中原之心。",
			constant: true,
			order: 5,
		});
		assert.ok(a, "父目录不存在也应能新建");
		assert.equal(a.constant, true);
		assert.equal(a.order, 5);

		// 次要词取三字：两字中文走 keyMatches 的词边界路径，本就不命中（见「中文不误触发」用例）
		const b = appendLorebookFileEntry(dest, {
			comment: "黑甲卫",
			keys: ["黑甲卫"],
			secondaryKeys: ["王都城"],
			selective: true,
			content: "黑甲卫只听王命。",
		});
		assert.ok(b);
		assert.equal(b.selective, true);
		assert.deepEqual(b.secondaryKeys, ["王都城"]);

		const json = JSON.parse(readFileSync(dest, "utf8")) as { entries: Array<Record<string, unknown>> };
		assert.ok(Array.isArray(json.entries));
		assert.equal(json.entries.length, 2);
		assert.notEqual(json.entries[0].uid, json.entries[1].uid);
		// 两套字段名同写：导回酒馆与再读都认
		assert.deepEqual(json.entries[0].key, ["王都"]);
		assert.deepEqual(json.entries[0].keys, ["王都"]);
		assert.equal(json.entries[0].insertion_order, 5);
		assert.equal(json.entries[0].order, 5);
		assert.equal(json.entries[0].disable, false);
		assert.equal(json.entries[0].enabled, true);

		// selective 无次要词时不得留脏状态
		const c = appendLorebookFileEntry(dest, {
			comment: "无次要词",
			keys: ["k"],
			content: "内容 C。",
			selective: true,
		});
		assert.ok(c);
		assert.equal(c.selective, false);

		// 追加后仍可被检索与关键词扫描命中
		const entries = loadLorebookFile(dest);
		assert.equal(entries.length, 3);
		assert.equal(constantEntries(entries).length, 1);
		assert.ok(scanEntries(entries, "黑甲卫昨夜巡过王都城长街", 5).some((e) => e.comment === "黑甲卫"));
		assert.equal(
			scanEntries(entries, "黑甲卫昨夜巡街", 5).length,
			0,
			"selective 条目次要词未命中时不应激活",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("deleteLorebookFileEntry：ST 对象 entries——删中间一条，其余原样（含未知字段）", () => {
	const dir = mkdtempSync(join(tmpdir(), "liyuan-lore-del-"));
	try {
		const dest = join(dir, "Mistvale.json");
		copyFileSync(bookPath, dest);
		const before = loadLorebookFile(dest);
		const target = before[1];
		const fp = loreFingerprint(target.content);
		const removed = deleteLorebookFileEntry(dest, fp);
		assert.ok(removed);
		assert.equal(loreFingerprint(removed.content), fp);
		const after = loadLorebookFile(dest);
		assert.equal(after.length, before.length - 1);
		assert.ok(!after.some((e) => loreFingerprint(e.content) === fp), "目标条目应消失");
		for (const e of before) {
			if (loreFingerprint(e.content) === fp) continue;
			assert.ok(after.some((a) => a.content === e.content), "其余条目原样保留");
		}
		assert.ok(JSON.parse(readFileSync(dest, "utf8")).entries, "文件仍是合法 JSON");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("deleteLorebookFileEntry：数组 entries（补充设定格式）+ 未命中不写文件", () => {
	const dir = mkdtempSync(join(tmpdir(), "liyuan-lore-del2-"));
	try {
		const dest = join(dir, "overlay.json");
		const raw = {
			entries: [
				{ uid: 9000, keys: ["甲"], comment: "条目甲", content: "甲的内容", enabled: true, custom_field: "keep" },
				{ uid: 9001, keys: ["乙"], comment: "条目乙", content: "乙的内容", enabled: true },
			],
		};
		writeFileSync(dest, JSON.stringify(raw, null, "\t"), "utf8");
		// 未命中：返回 null 且文件不变
		const before = readFileSync(dest, "utf8");
		assert.equal(deleteLorebookFileEntry(dest, "ffffffffffff"), null);
		assert.equal(readFileSync(dest, "utf8"), before, "未命中不得写文件");
		// 命中：删乙留甲，甲的未知字段保留
		const removed = deleteLorebookFileEntry(dest, loreFingerprint("乙的内容"));
		assert.ok(removed);
		assert.equal(removed.comment, "条目乙");
		const json = JSON.parse(readFileSync(dest, "utf8")) as { entries: Array<Record<string, unknown>> };
		assert.equal(json.entries.length, 1);
		assert.equal(json.entries[0].comment, "条目甲");
		assert.equal(json.entries[0].custom_field, "keep", "未知 ST 字段不得丢失");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
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

test("patchLorebookFileEntry：enabled 写回源文件（导入即关闭的条目可启用）", () => {
	const dir = mkdtempSync(join(tmpdir(), "liyuan-lore-"));
	try {
		const dest = join(dir, "book.json");
		// ST 对象 entries 格式，条目带 disable:true——导入即关闭的典型来源
		writeFileSync(
			dest,
			JSON.stringify({
				name: "book",
				entries: {
					"0": { uid: 0, key: ["x"], content: "c", disable: true, order: 100 },
				},
			}),
			"utf8",
		);
		const before = loadLorebookFile(dest);
		assert.equal(before[0].enabled, false, "源文件 disable:true 应归一化为停用");
		const fp = loreFingerprint(before[0].content);
		const r = patchLorebookFileEntry(dest, fp, { enabled: true });
		assert.ok(r);
		assert.equal(r.entry.enabled, true);
		const after = loadLorebookFile(dest);
		assert.equal(after[0].enabled, true, "写回后应可启用");
		const raw = JSON.parse(readFileSync(dest, "utf8")) as {
			entries: Record<string, { disable?: boolean; enabled?: boolean }>;
		};
		assert.equal(raw.entries["0"].disable, false, "ST 字段 disable 应翻为 false");
		assert.equal(raw.entries["0"].enabled, true, "V2 字段 enabled 应翻为 true");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
