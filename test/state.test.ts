import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { applyPatch, canonicalizeCharacterKeys, defaultState, formatState, loadState, saveState } from "../src/state.ts";

test("补丁：时间地点替换、角色合并、好感钳制", () => {
	let s = defaultState();
	let r = applyPatch(s, { time: "黄昏", location: "林间小屋", characters: { Alice: { affinity: 150, status: "警惕" } } });
	assert.equal(r.warnings.length, 0);
	s = r.state;
	assert.equal(s.time, "黄昏");
	assert.equal(s.characters["Alice"].affinity, 100, "好感应钳制到 100");

	r = applyPatch(s, { characters: { Alice: { status: "放松" } } });
	s = r.state;
	assert.equal(s.characters["Alice"].affinity, 100, "部分更新应保留旧字段");
	assert.equal(s.characters["Alice"].status, "放松");
});

test("补丁：null 删除角色与 flag", () => {
	let s = defaultState();
	s = applyPatch(s, { characters: { Bob: { affinity: 5 } }, flags: { 天气: "暴雨" } }).state;
	s = applyPatch(s, { characters: { Bob: null }, flags: { 天气: null } }).state;
	assert.equal(Object.keys(s.characters).length, 0);
	assert.equal(Object.keys(s.flags).length, 0);
});

test("补丁：数组整体替换、未知键告警", () => {
	let s = defaultState();
	s = applyPatch(s, { inventory: ["猎刀", "草药"] }).state;
	const r = applyPatch(s, { inventory: ["草药"], hp: 100 });
	assert.deepEqual(r.state.inventory, ["草药"]);
	assert.equal(r.warnings.length, 1);
	assert.ok(r.warnings[0].includes("hp"));
});

test("持久化 roundtrip 与缺失文件回退", () => {
	const dir = mkdtempSync(join(tmpdir(), "rp-state-"));
	try {
		const file = join(dir, "deep", "s.json");
		assert.deepEqual(loadState(file), defaultState(), "缺失文件应回退默认");
		const s = applyPatch(defaultState(), { time: "午夜", plot_threads: ["寻找失踪的商队"] }).state;
		saveState(file, s);
		assert.deepEqual(loadState(file), s);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("角色键归一化：大小写/空白变体归到已知名", () => {
	const patch = {
		time: "清晨",
		characters: {
			"alice ": { affinity: 20 },
			ALICE: { status: "警觉" },
			新角色: { affinity: 5 },
		},
	};
	const out = canonicalizeCharacterKeys(patch, ["Alice", "旅人"]);
	const chars = out.characters as Record<string, { affinity?: number; status?: string }>;
	assert.deepEqual(Object.keys(chars).sort(), ["Alice", "新角色"], "变体应合并到规范名，未知名保留");
	assert.equal(chars["Alice"].affinity, 20, "撞名浅合并应保留先写字段");
	assert.equal(chars["Alice"].status, "警觉");
	assert.equal((out as { time?: string }).time, "清晨", "非 characters 字段原样透传");
});

test("角色键归一化：无 characters 时原样返回", () => {
	const patch = { time: "午夜" };
	assert.deepEqual(canonicalizeCharacterKeys(patch, ["Alice"]), patch);
});

test("注入格式化", () => {
	const s = applyPatch(defaultState(), {
		time: "清晨",
		characters: { Alice: { affinity: 30, status: "守夜后疲惫" } },
		inventory: ["药茶"],
	}).state;
	const text = formatState(s);
	assert.ok(text.includes("清晨"));
	assert.ok(text.includes("Alice"));
	assert.ok(text.includes("药茶"));
	assert.ok(formatState(defaultState()).includes("尚无记录"));
});
