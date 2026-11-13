/**
 * 作者运行时脚本通道（酒馆助手脚本库 → 页面级悬浮球）。
 *
 * 合成用例守协议形状（两种命名空间拼写、卡在 data 层 / 预设在顶层、enabled 语义、顺序与去重）；
 * 实卡实预设用例按**形状**发现夹具，本地没有这种料就跳过而不是红（见 test/fixtures.ts）。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
	authorScriptHash,
	authorScriptManifest,
	authorScriptSig,
	buildAuthorScripts,
	extractAuthorScripts,
	extractAuthorScriptVariables,
} from "../src/authorScripts.ts";
import { buildCardFrontSnapshot } from "../src/cardfront.ts";
import { findLocalCard, findLocalPreset, localCards, localPresets } from "./fixtures.ts";

const script = (over: Record<string, unknown> = {}) => ({
	id: "s1",
	name: "悬浮球",
	type: "script",
	content: "$(function(){})",
	enabled: true,
	...over,
});

/** 卡的 extensions 在 data 层；预设在顶层。两种都要认出来 */
const cardRaw = (scripts: unknown[], ns = "TavernHelper") => ({
	data: { extensions: { [ns]: { scripts } } },
});
const presetRaw = (scripts: unknown[], ns = "tavern_helper") => ({
	extensions: { [ns]: { scripts } },
});

test("卡的 data.extensions.TavernHelper.scripts 能取出", () => {
	const out = extractAuthorScripts(cardRaw([script()]), "card");
	assert.equal(out.length, 1);
	assert.equal(out[0].id, "s1");
	assert.equal(out[0].source, "card");
	assert.equal(out[0].content, "$(function(){})");
});

test("预设的顶层 extensions.tavern_helper.scripts 能取出", () => {
	const out = extractAuthorScripts(presetRaw([script()]), "preset");
	assert.equal(out.length, 1);
	assert.equal(out[0].source, "preset");
});

test("两种命名空间拼写都认（同一插件的历史写法，非名单）", () => {
	assert.equal(extractAuthorScripts(cardRaw([script()], "tavern_helper"), "card").length, 1);
	assert.equal(extractAuthorScripts(presetRaw([script()], "TavernHelper"), "preset").length, 1);
});

test("enabled:false 跳过——作者停用就是对用户停用", () => {
	const out = extractAuthorScripts(cardRaw([script({ enabled: false }), script({ id: "s2" })]), "card");
	assert.deepEqual(
		out.map((s) => s.id),
		["s2"],
	);
});

test("enabled 缺省当启用（只有显式 false 才停）", () => {
	const s = script();
	delete (s as Record<string, unknown>).enabled;
	assert.equal(extractAuthorScripts(cardRaw([s]), "card").length, 1);
});

test("空 content / 纯空白 跳过（占位条目不进宿主）", () => {
	const out = extractAuthorScripts(cardRaw([script({ content: "" }), script({ id: "s2", content: "   \n" })]), "card");
	assert.equal(out.length, 0);
});

test("缺 id 时按 source+序号兜底，不至于两条同名", () => {
	const a = script();
	const b = script({ name: "另一个" });
	delete (a as Record<string, unknown>).id;
	delete (b as Record<string, unknown>).id;
	const out = extractAuthorScripts(cardRaw([a, b]), "card");
	assert.deepEqual(
		out.map((s) => s.id),
		["card-0", "card-1"],
	);
});

test("没有声明 / 坏输入 → 空数组，永不抛", () => {
	assert.deepEqual(extractAuthorScripts(null, "card"), []);
	assert.deepEqual(extractAuthorScripts(undefined, "card"), []);
	assert.deepEqual(extractAuthorScripts({}, "card"), []);
	assert.deepEqual(extractAuthorScripts({ data: { extensions: {} } }, "card"), []);
	assert.deepEqual(extractAuthorScripts({ extensions: { tavern_helper: { scripts: "不是数组" } } }, "preset"), []);
	assert.deepEqual(extractAuthorScripts(cardRaw([null, 42, "x"]), "card"), []);
});

test("预设与卡自带的脚本一并进宿主：预设在前、卡在后，按 source:id 去重", () => {
	const out = buildAuthorScripts(
		cardRaw([script({ id: "c" }), script({ id: "dup", name: "卡同名" })]),
		presetRaw([script({ id: "p" }), script({ id: "dup", name: "预设同名" })]),
	);
	assert.deepEqual(
		out.map((s) => `${s.source}:${s.id}`),
		["preset:p", "preset:dup", "card:c", "card:dup"],
	);
	assert.deepEqual(buildAuthorScripts(null), []);
});

test("同来源同 id 只留第一条", () => {
	const out = buildAuthorScripts(cardRaw([script({ id: "dup" }), script({ id: "dup", content: "x=2" })]));
	assert.equal(out.length, 1);
	assert.equal(out[0].content, "$(function(){})");
});

test("cardfront 快照同时携带预设与卡的 scripts（hello 与 REST 同源）", () => {
	const snap = buildCardFrontSnapshot(
		{ card: "a.png", userName: "旅人" },
		cardRaw([script()]) as Record<string, unknown>,
		"某角色",
		presetRaw([script({ id: "p" })]) as Record<string, unknown>,
	);
	assert.deepEqual(
		snap.scripts.map((s) => `${s.source}:${s.id}`),
		["preset:p", "card:s1"],
	);
	// 没有显示规则不影响脚本：两条通道各走各的
	assert.equal(snap.hasSkin, false);
});

test("无脚本的卡：scripts 为空数组，其余字段行为不变（没见过的卡零变化）", () => {
	const snap = buildCardFrontSnapshot({ card: "a.png", userName: "旅人" }, { data: {} }, "某角色", null);
	assert.deepEqual(snap.scripts, []);
});

// ---- 清单与指纹：正文不进 hello，靠指纹判断变没变 ----

test("清单带内容摘要，不带正文（hello 帧要轻）", () => {
	const list = buildAuthorScripts(cardRaw([script({ content: "x".repeat(5000) })]));
	const man = authorScriptManifest(list);
	assert.deepEqual(man, [{ id: "s1", source: "card", len: 5000, hash: authorScriptHash("x".repeat(5000)) }]);
	assert.ok(!JSON.stringify(man).includes("xxxx"), "清单里不许出现正文");
});

test("指纹：清单与全量算出同一个值（两处各算一遍必对不上）", () => {
	const list = buildAuthorScripts(cardRaw([script(), script({ id: "p2", content: "abc" })]));
	assert.equal(authorScriptSig(list), authorScriptSig(authorScriptManifest(list)));
});

test("指纹随内容长度变化（作者改了脚本 → 宿主该重启）", () => {
	const a = buildAuthorScripts(cardRaw([script({ content: "aa" })]));
	const b = buildAuthorScripts(cardRaw([script({ content: "aaa" })]));
	assert.notEqual(authorScriptSig(a), authorScriptSig(b));
});

test("等长修改也会刷新，清单与正文得到相同指纹", () => {
	const before = buildAuthorScripts(cardRaw([script({ content: "const value=1;" })]));
	const after = buildAuthorScripts(cardRaw([script({ content: "const value=2;" })]));
	assert.notEqual(authorScriptSig(before), authorScriptSig(after));
	assert.equal(authorScriptSig(after), authorScriptSig(authorScriptManifest(after)));
});

test("指纹随顺序变化（预设/卡对调 = 不同的执行序）", () => {
	const a = authorScriptSig([
		{ id: "1", source: "preset", len: 10 },
		{ id: "2", source: "card", len: 20 },
	]);
	const b = authorScriptSig([
		{ id: "2", source: "card", len: 20 },
		{ id: "1", source: "preset", len: 10 },
	]);
	assert.notEqual(a, b);
});

test("空清单的指纹是空串（前端据此判「这张卡没脚本」）", () => {
	assert.equal(authorScriptSig([]), "");
	assert.deepEqual(authorScriptManifest([]), []);
});

test("刀1：支持 type='folder' 文件夹展开与文件夹级 enabled 门控", () => {
	const raw = cardRaw([
		{
			type: "folder",
			id: "f1",
			name: "启用文件夹",
			enabled: true,
			scripts: [
				script({ id: "in-folder-1", content: "window.a=1;" }),
				script({ id: "in-folder-disabled", enabled: false, content: "window.b=2;" }),
			],
		},
		{
			type: "folder",
			id: "f2",
			name: "禁用文件夹",
			enabled: false,
			scripts: [script({ id: "in-disabled-folder", content: "window.c=3;" })],
		},
		script({ id: "top-level", content: "window.d=4;" }),
	]);
	const out = extractAuthorScripts(raw, "card");
	assert.deepEqual(
		out.map((s) => s.id),
		["in-folder-1", "top-level"],
	);
});

test("刀1：兼容旧版 TavernHelper_scripts、value 包装、代码块围栏及 data/button/info 元数据", () => {
	const legacyRaw = {
		data: {
			extensions: {
				TavernHelper_scripts: [
					{
						type: "script",
						value: {
							id: "leg-1",
							name: "旧版单脚本",
							enabled: true,
							content: "```javascript\nconst x = 42;\n```",
							info: "脚本说明",
							data: { initCount: 10 },
							buttons: [{ name: "打开面板", visible: true }],
						},
					},
					{
						type: "folder",
						name: "旧版文件夹",
						value: [
							{
								id: "leg-2",
								name: "文件夹内旧脚本",
								enabled: true,
								content: "console.log('ok');",
							},
						],
					},
				],
				TavernHelper_characterScriptVariables: {
					faction: "青云门",
				},
			},
		},
	};
	const out = extractAuthorScripts(legacyRaw, "card");
	assert.equal(out.length, 2);
	assert.equal(out[0].id, "leg-1");
	assert.equal(out[0].content, "const x = 42;");
	assert.equal(out[0].info, "脚本说明");
	assert.deepEqual(out[0].data, { initCount: 10 });
	assert.deepEqual(out[0].button, {
		enabled: true,
		buttons: [{ name: "打开面板", visible: true }],
	});
	assert.equal(out[1].id, "leg-2");
	assert.deepEqual(extractAuthorScriptVariables(legacyRaw), { faction: "青云门" });
});

// ---- 实卡 / 实预设：按形状发现，没有就跳过 ----

/** 判据＝这份原文声明了至少一条启用的作者脚本 */
const declaresScripts = (raw: Record<string, unknown>, source: "card" | "preset") =>
	extractAuthorScripts(raw, source).length > 0;

test("实卡：声明了脚本的卡能被完整取出，且每条都有可执行内容", (t) => {
	const card = findLocalCard((c) => declaresScripts(c.raw, "card"));
	if (!card) return t.skip("本地没有声明作者脚本的卡");
	const out = extractAuthorScripts(card.raw, "card");
	assert.ok(out.length > 0);
	for (const s of out) {
		assert.equal(typeof s.content, "string");
		assert.ok(s.content.trim().length > 0);
		assert.equal(s.source, "card");
	}
});

test("实预设：声明了脚本的预设能被完整取出", (t) => {
	const preset = findLocalPreset((p) => declaresScripts(p.raw, "preset"));
	if (!preset) return t.skip("本地没有声明作者脚本的预设");
	const out = extractAuthorScripts(preset.raw, "preset");
	assert.ok(out.length > 0);
	for (const s of out) assert.ok(s.content.trim().length > 0);
});

test("实料：页面级 UI 脚本（往父页挂 DOM 的那种）确实存在于本通道", (t) => {
	// 形状判据：脚本里有「取父页 document」+「fixed 定位」——这就是悬浮球那一类。
	// 不问名字：叫什么都行，认的是它对宿主的要求。
	const isPageLevel = (code: string) =>
		/(?:parent|top)\s*(?:\?\.|\s*&&\s*(?:parent|top)\s*\.)?\s*document|parent\?\.document/.test(code) &&
		/position\s*:\s*fixed/i.test(code);
	const found = [
		...localPresets().flatMap((p) => extractAuthorScripts(p.raw, "preset")),
		...localCards().flatMap((c) => extractAuthorScripts(c.raw, "card")),
	].filter((s) => isPageLevel(s.content));
	if (found.length === 0) return t.skip("本地没有页面级 UI 脚本");
	// 这些脚本假定自己跑在子帧里、往父页挂 DOM —— 正是 ScriptHost 存在的理由
	assert.ok(found.length > 0);
});
