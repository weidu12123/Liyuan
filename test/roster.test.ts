import assert from "node:assert/strict";
import { test } from "node:test";

import { applyPatch, defaultState } from "../src/state.ts";

test("名录不删：活跃状态里移除后名录仍在案", () => {
	const r1 = applyPatch(defaultState(), {
		characters: { 苏茜: { status: "在场" } },
		inventory: ["铁剑"],
		plot_threads: ["旧约"],
	});
	const r2 = applyPatch(r1.state, { characters: { 苏茜: null }, inventory: [], plot_threads: [] });
	assert.equal(Object.keys(r2.state.characters).length, 0);
	assert.ok("苏茜" in (r2.state.roster?.characters ?? {}));
	assert.ok("铁剑" in (r2.state.roster?.items ?? {}));
	assert.ok("旧约" in (r2.state.roster?.events ?? {}));
});

test("名录容量：剧情线超上限丢最旧", () => {
	let s = defaultState();
	for (let i = 0; i < 70; i++) {
		s = applyPatch(s, { plot_threads: [`线索${i}`] }).state;
	}
	const events = Object.keys(s.roster?.events ?? {});
	assert.equal(events.length, 60);
	assert.ok(!events.includes("线索0"));
	assert.ok(events.includes("线索69"));
});

test("名录一句话超长截断", () => {
	const r = applyPatch(defaultState(), { characters: { 龙王: { status: "一".repeat(80) } } });
	assert.ok((r.state.roster?.characters["龙王"] ?? "").length <= 30);
});

test("名录编辑：离场条目可删；活跃条目删了被登记复活", () => {
	const r1 = applyPatch(defaultState(), { characters: { 苏茜: { status: "在场" }, 老周: { status: "在场" } } });
	const r2 = applyPatch(r1.state, { characters: { 苏茜: null } });
	// 离场的苏茜：删除生效
	const r3 = applyPatch(r2.state, { roster: { characters: { 苏茜: null } } });
	assert.ok(!("苏茜" in (r3.state.roster?.characters ?? {})));
	assert.ok(r3.applied.some((a) => a.includes("roster.characters.苏茜 已移除")));
	// 在场的老周：删除后被 registerRoster 立即重新登记
	const r4 = applyPatch(r3.state, { roster: { characters: { 老周: null } } });
	assert.ok("老周" in (r4.state.roster?.characters ?? {}));
});

test("名录编辑：改一句话（60 字截断）；非法值告警忽略", () => {
	const r1 = applyPatch(defaultState(), { characters: { 苏茜: { status: "初登场" } } });
	const r2 = applyPatch(r1.state, { roster: { characters: { 苏茜: "三年前的旧识" } } });
	assert.equal(r2.state.roster?.characters["苏茜"], "三年前的旧识");
	const r3 = applyPatch(r2.state, { roster: { characters: { 苏茜: "长".repeat(90) } } });
	assert.equal((r3.state.roster?.characters["苏茜"] ?? "").length, 60);
	const r4 = applyPatch(r3.state, { roster: { characters: { 苏茜: 42 } } });
	assert.ok(r4.warnings.some((w) => w.includes("需要字符串或 null")));
});

test("名录编辑：roster 非对象/子表非对象告警忽略", () => {
	const r1 = applyPatch(defaultState(), { roster: "bad" });
	assert.ok(r1.warnings.some((w) => w.includes("roster 需要对象")));
	const r2 = applyPatch(defaultState(), { roster: { items: ["x"] } });
	assert.ok(r2.warnings.some((w) => w.includes("roster.items 需要对象")));
});

test("在场位置归一：转场时原在场旧角色跟随当前场景，不误标为已离场；显式离场保持原位", () => {
	// 模拟旧存档：角色 at 曾被写成第一夜的 location
	let s = applyPatch(defaultState(), {
		time: "第一夜",
		location: "伊利里欧庄园·庭院",
		characters: {
			丹妮莉丝: { status: "同行", at: "伊利里欧庄园·庭院" },
			乔拉: { status: "护卫", at: "伊利里欧庄园·庭院" },
			伊利里欧: { status: "留在书房", at: "书房" },
		},
	}).state;
	// at 与当前 location 相同应归一为空串
	assert.equal(s.characters["丹妮莉丝"]!.at, "");
	assert.equal(s.characters["伊利里欧"]!.at, "书房");

	// 兼容未归一的旧档（手动构造 c.at === prevLocation）
	s.characters["乔拉"]!.at = "伊利里欧庄园·庭院";
	s = applyPatch(s, { time: "第二日", location: "潘托斯集市" }).state;
	assert.equal(s.characters["丹妮莉丝"]!.at, "", "原本在场角色转场后仍在场");
	assert.equal(s.characters["乔拉"]!.at, "", "旧档中 at === prevLocation 的角色转场后自动跟随");
	assert.equal(s.characters["伊利里欧"]!.at, "书房", "原本就不在场的角色保持原去向");
});

test("名录容量：places 上限收紧为 30，超出丢最旧", () => {
	let s = defaultState();
	for (let i = 0; i < 40; i++) {
		s = applyPatch(s, { location: `地点${i}` }).state;
	}
	const places = Object.keys(s.roster?.places ?? {});
	assert.equal(places.length, 30);
	assert.ok(!places.includes("地点0"));
	assert.ok(places.includes("地点39"));
});

test("名录合并：支持合并地点/人物/事件重复条目并同步迁移活跃引用", () => {
	let s = applyPatch(defaultState(), {
		time: "第一夜",
		location: "红堡·大厅",
		characters: {
			Daenerys: { affinity: 10, status: "观察" },
			"Daenerys Targaryen": { affinity: 15, status: "微笑" },
		},
		plot_threads: ["寻找盟友", "寻求盟友支持"],
	}).state;
	s = applyPatch(s, { location: "红堡大厅" }).state;

	const merged = applyPatch(s, {
		roster: {
			merge: [
				{ table: "places", from: "红堡·大厅", to: "红堡大厅" },
				{ table: "characters", from: "Daenerys", to: "Daenerys Targaryen" },
				{ table: "events", from: "寻求盟友支持", to: "寻找盟友" },
			],
		},
	});
	assert.deepEqual(merged.warnings, []);
	assert.ok(!("红堡·大厅" in (merged.state.roster?.places ?? {})));
	assert.ok("红堡大厅" in (merged.state.roster?.places ?? {}));
	assert.ok(!("Daenerys" in merged.state.characters));
	assert.ok(!("Daenerys" in (merged.state.roster?.characters ?? {})));
	assert.ok("Daenerys Targaryen" in merged.state.characters);
	assert.deepEqual(merged.state.plot_threads, ["寻找盟友"]);
	assert.ok(!("寻求盟友支持" in (merged.state.roster?.events ?? {})));
});

