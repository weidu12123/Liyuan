import assert from "node:assert/strict";
import { test } from "node:test";

import { runUnifiedStageTool, unifiedStageTools, type UnifiedStageDeps } from "../src/tools/adapters/stage.ts";
import { checkWriteGate } from "../src/tools/gate.ts";
import {
	lorebookList,
	lorebookSearch,
	lorebookToggle,
	type LoreDeps,
	type LoreHitLike,
} from "../src/tools/lore.ts";
import { intArg, strArg, type ToolContext } from "../src/tools/registry.ts";

const HIT: LoreHitLike = {
	entry: { uid: 1, comment: "北境骨誓", keys: ["骨誓", "北境"], content: "以骨为契的古俗。" },
};

const deps = (over: Partial<LoreDeps> = {}): LoreDeps => ({
	searchLore: () => [HIT],
	loreSize: () => 42,
	...over,
});

/** 台上统一层依赖（世界书族 + 向量库族的并集，M-D3 起装配清单按它过滤） */
const stageDeps = (over: Partial<UnifiedStageDeps> = {}): UnifiedStageDeps => ({
	searchLore: () => [HIT],
	loreSize: () => 42,
	searchMemory: async () => [],
	...over,
});

const stageCtx: ToolContext = { surface: "stage", language: "中文" };
const extensionCtx: ToolContext = { surface: "extension", language: "中文" };

// ---------------- 合一的核心验收：同一工具，同一份实现 ----------------

test("跨 surface 产出一致性：同样的命中，正文部分逐字相同（差异只在话术裁剪）", async () => {
	const s = await lorebookSearch.run({ query: "骨誓" }, deps(), stageCtx);
	const a = await lorebookSearch.run({ query: "骨誓" }, deps(), extensionCtx);
	// 命中格式化是共用的：标题+全角关键词+正文，两面必须逐字一致
	assert.equal(s.text, a.text);
	assert.equal(s.text, "### 北境骨誓（关键词：骨誓、北境）\n以骨为契的古俗。");
	assert.equal(s.activity, a.activity);
});

test("台上不开 limit（配额固定），助手开 limit 且钳到 [1,20]", async () => {
	const stageSchema = lorebookSearch.parameters(stageCtx) as { properties: Record<string, unknown> };
	const asstSchema = lorebookSearch.parameters(extensionCtx) as { properties: Record<string, unknown> };
	assert.ok(!("limit" in stageSchema.properties), "台上一拍检索配额有限，条数固定才好控上下文预算");
	assert.ok("limit" in asstSchema.properties);

	const seen: number[] = [];
	const spy = deps({
		searchLore: (_q, l) => {
			seen.push(l);
			return [HIT];
		},
	});
	await lorebookSearch.run({ query: "x" }, spy, stageCtx);
	await lorebookSearch.run({ query: "x" }, spy, extensionCtx);
	await lorebookSearch.run({ query: "x", limit: 999 }, spy, extensionCtx);
	await lorebookSearch.run({ query: "x", limit: 0 }, spy, extensionCtx);
	await lorebookSearch.run({ query: "x", limit: "abc" }, spy, extensionCtx);
	assert.deepEqual(seen, [3, 5, 20, 1, 5], "台上恒 3；助手默认 5、上钳 20、下钳 1、非法回默认");
});

test("容错契约：检索抛错/缺参都回可读文本，不抛（一拍不因工具出错中断）", async () => {
	const boom = deps({
		searchLore: () => {
			throw new Error("索引损坏");
		},
	});
	const s = await lorebookSearch.run({ query: "任意" }, boom, stageCtx);
	assert.match(s.text, /索引损坏/);
	assert.match(s.text, /继续写/, "台上失败也要告诉模型怎么往下走");

	const a = await lorebookSearch.run({ query: "任意" }, boom, extensionCtx);
	assert.match(a.text, /索引损坏/);

	for (const ctx of [stageCtx, extensionCtx]) {
		assert.match((await lorebookSearch.run({}, deps(), ctx)).text, /缺少 query/);
		assert.match((await lorebookSearch.run({ query: "   " }, deps(), ctx)).text, /缺少 query/);
	}
});

test("命中格式化：无关键词时不留空括号；标题回落 keys[0] → 「条目」", async () => {
	const r = await lorebookSearch.run(
		{ query: "x" },
		deps({
			searchLore: () => [
				{ entry: { content: "甲" } },
				{ entry: { keys: ["乙键"], content: "乙" } },
			],
		}),
		stageCtx,
	);
	assert.equal(r.text, "### 条目\n甲\n\n### 乙键（关键词：乙键）\n乙");
	assert.doesNotMatch(r.text, /（）/, "无关键词不该留空括号");
});

// ---------------- 地基：注册表工具函数 ----------------

test("registry：strArg/intArg 吃住模型的脏参数", () => {
	assert.equal(strArg({ q: "  x  " }, "q"), "x");
	assert.equal(strArg({ q: 5 }, "q"), "", "非字符串按空串（模型偶尔传 number/null）");
	assert.equal(strArg({}, "q"), "");
	assert.equal(intArg({}, "n", 5, 1, 20), 5);
	assert.equal(intArg({ n: "7" }, "n", 5, 1, 20), 7, "字符串数字要收");
	assert.equal(intArg({ n: 7.9 }, "n", 5, 1, 20), 7, "截断而非四舍五入");
	assert.equal(intArg({ n: -3 }, "n", 5, 1, 20), 1);
	assert.equal(intArg({ n: Number.NaN }, "n", 5, 1, 20), 5);
});

// ---------------- 台上适配器 ----------------

test("stage 适配器：装配纯数据 schema（零 typebox），未知工具名回 null 让调用方回落", async () => {
	const [tool] = unifiedStageTools("中文");
	assert.equal(tool.name, "lorebook_search");
	assert.equal((tool.parameters as { type: string }).type, "object");
	assert.ok(tool.description.length > 20);
	// 裸 JSON Schema：不带 typebox 的 Kind symbol
	assert.equal(Object.getOwnPropertySymbols(tool.parameters).length, 0);

	// 不属统一层的工具名回落旧派发（world_state_get 仍在 stage/tools.ts）
	assert.equal(await runUnifiedStageTool(deps(), "world_state_get", {}, "中文"), null);
	const hit = await runUnifiedStageTool(deps(), "lorebook_search", { query: "骨誓" }, "中文");
	assert.match(String(hit?.text), /北境骨誓/);
});

test("D-T1 红线：src/tools/ 不得依赖 typebox（破了就失去离线单测能力）", async () => {
	const { readFileSync, readdirSync } = await import("node:fs");
	const { join } = await import("node:path");
	const roots = ["src/tools", "src/tools/adapters"];
	for (const root of roots) {
		for (const f of readdirSync(root).filter((n) => n.endsWith(".ts"))) {
			const src = readFileSync(join(root, f), "utf8");
			assert.doesNotMatch(src, /from\s+["']typebox/, `${root}/${f} 不得 import typebox`);
		}
	}
});

// ---------------- M-D2：写侧门禁 ----------------

test("写入门禁：silent 档不拦；ask 档只放行用户本拍明确要求的写入", () => {
	// silent = 旧行为，门禁不介入
	assert.equal(checkWriteGate({ toolName: "lorebook_write", lastUserText: "随便说说", creationMode: "silent" }).allow, true);
	assert.equal(checkWriteGate({ toolName: "lorebook_write", lastUserText: "随便说说" }).allow, true);

	// ask 档：用户没要求 → 拦
	const blocked = checkWriteGate({ toolName: "lorebook_write", lastUserText: "我们继续走吧", creationMode: "ask" });
	assert.equal(blocked.allow, false);
	assert.match(blocked.allow ? "" : blocked.reason, /需用户明确要求/);
	assert.match(blocked.allow ? "" : blocked.reason, /不要询问/, "不许转头问用户要不要写");

	// ask 档：用户明确要求 → 放行
	for (const say of ["把这条记下来", "写进设定集", "存到知识库", "save this", "记录一下这个设定"]) {
		assert.equal(checkWriteGate({ toolName: "lorebook_write", lastUserText: say, creationMode: "ask" }).allow, true, say);
	}
});

test("写入门禁：读不到用户原文时宁拦勿写", () => {
	assert.equal(checkWriteGate({ toolName: "lorebook_write", lastUserText: "", creationMode: "ask" }).allow, false);
});

// ---------------- M-D2：写侧 / 列举 / 启停 ----------------

test("lorebook_list：给目录不给正文；标出常驻/已停用；带指纹供 toggle 取用", async () => {
	const d = deps({
		listLore: () => [
			{ comment: "甲", keys: ["甲键"], content: "甲的正文内容", constant: true, enabled: true },
			{ comment: "乙", keys: [], content: "乙的正文内容", enabled: false },
		],
		fingerprint: (c) => `fp-${c.length}`,
	});
	const r = await lorebookList.run({}, d, stageCtx);
	assert.match(r.text, /共 2 条/);
	assert.match(r.text, /甲.*常驻/s);
	assert.match(r.text, /乙.*已停用/s);
	assert.match(r.text, /指纹 fp-6/, "指纹要给出来，否则 toggle 无从取");
	assert.doesNotMatch(r.text, /甲的正文内容/, "列举只给目录，正文归 lorebook_search");

	// keyword 过滤 + 无命中如实说
	assert.match((await lorebookList.run({ keyword: "甲" }, d, stageCtx)).text, /1\/2 条/);
	assert.match((await lorebookList.run({ keyword: "丙" }, d, stageCtx)).text, /无标题\/关键词含/);
});

test("lorebook_toggle：缺参明确报错；启停回执说明持久语义", async () => {
	const d = deps({ toggleLore: (fps) => fps.length });
	assert.match((await lorebookToggle.run({ enabled: false }, d, stageCtx)).text, /缺少 fingerprints/);
	assert.match((await lorebookToggle.run({ fingerprints: ["a"] }, d, stageCtx)).text, /缺少 enabled/);

	const off = await lorebookToggle.run({ fingerprints: ["a", "b"], enabled: false }, d, stageCtx);
	assert.match(off.text, /已停用 2 条/);
	assert.match(off.text, /跨会话保留/, "必须说清这是持久开关不是本拍忽略");
	assert.match(off.text, /不再注入上下文/);

	const on = await lorebookToggle.run({ fingerprints: ["a"], enabled: true }, d, stageCtx);
	assert.match(on.text, /已启用 1 条/);
});

test("依赖缺失的工具不上清单（工具存在却恒回「不支持」会让模型反复试）", () => {
	const readOnly = unifiedStageTools("中文", stageDeps()).map((t) => t.name);
	assert.deepEqual(
		readOnly,
		["lorebook_search", "memory_search"],
		"只注入两个检索函数时只该有两件检索",
	);

	const full = unifiedStageTools("中文", stageDeps({
		listLore: () => [],
		fingerprint: (c) => c,
		toggleLore: () => 0,
		addMemory: async () => ({ added: 1, total: 1, chunks: 1 }),
		listMemory: () => [],
		deleteMemory: () => true,
	})).map((t) => t.name).sort();
	assert.deepEqual(full, [
		"lorebook_list",
		"lorebook_read",
		"lorebook_search",
		"lorebook_toggle",
		"memory_add",
		"memory_delete",
		"memory_list",
		"memory_search",
	]);
});

test("toggleDisabledLore：与 M-C2 协议禁用同一条指纹通道，重复停用不产生重复项", async () => {
	const { toggleDisabledLore } = await import("../src/lorebook.ts");
	assert.deepEqual(toggleDisabledLore([], ["a"], false), ["a"]);
	assert.deepEqual(toggleDisabledLore(["a"], ["a"], false), ["a"], "重复停用不该出现两份");
	assert.deepEqual(toggleDisabledLore(["a", "b"], ["a"], true), ["b"]);
	assert.deepEqual(toggleDisabledLore(undefined, ["x"], false), ["x"]);
	assert.deepEqual(toggleDisabledLore(["a"], ["不存在"], true), ["a"], "启用未停用项是无操作");
});
