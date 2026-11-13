import assert from "node:assert/strict";
import { test } from "node:test";

import { loadPresetDoc, patchPresetRaw, presetDocBlock, presetDocView } from "../src/preset-doc.ts";
import { assemble } from "../src/preset-assemble.ts";

const stRaw = () => ({
	temperature: 0.85,
	top_p: 0.98,
	max_tokens: 4096, // 不在采样搬运名单
	不认识的键: { 保持: "原样" },
	prompts: [
		{ identifier: "a", name: "甲", role: "system", content: "甲正文", marker: false },
		{ identifier: "chatHistory", name: "Chat History", marker: true },
		{ identifier: "b", name: "乙", role: "user", content: "乙正文", marker: false },
		{ identifier: "d", name: "深注", role: "system", content: "深", marker: false, injection_position: 1, injection_depth: 3 },
	],
	prompt_order: [
		{
			character_id: 100001,
			order: [
				{ identifier: "a", enabled: true },
				{ identifier: "chatHistory", enabled: true },
				{ identifier: "b", enabled: false },
				{ identifier: "d", enabled: true },
			],
		},
	],
});

const rpRaw = () => ({
	name: "文件里写的名字（应被文件名覆盖）",
	samplers: { temperature: 0.7 },
	blocks: [
		{ id: "s1", name: "系统块", channel: "system", role: "system", content: "系统正文", enabled: true },
		{ id: "p1", name: "末端块", channel: "postHistory", role: "system", content: "末端正文", enabled: false },
	],
});

test("文档层：判别格式、预设名取文件名不取文件内容", () => {
	assert.equal(loadPresetDoc(stRaw(), "双人成行").kind, "st");
	assert.equal(loadPresetDoc(stRaw(), "双人成行").name, "双人成行");
	const rp = loadPresetDoc(rpRaw(), "旧文件");
	assert.equal(rp.kind, "rp");
	assert.equal(rp.name, "旧文件", "旧格式文件里的 name 也不作数，文件名才是名字");
});

test("文档层：采样参数按名单提取，ST 取顶层、旧格式取 samplers", () => {
	assert.deepEqual(loadPresetDoc(stRaw(), "x").samplers, { temperature: 0.85, top_p: 0.98 });
	assert.deepEqual(loadPresetDoc(rpRaw(), "x").samplers, { temperature: 0.7 });
});

test("文档层：视图里 channel 是 chatHistory 派生的位置，marker 与 depth 如实标注", () => {
	const view = presetDocView(loadPresetDoc(stRaw(), "x"));
	assert.deepEqual(
		view.map((b) => [b.id, b.channel, b.marker]),
		[
			["a", "system", false],
			["chatHistory", "system", true],
			["b", "postHistory", false],
			["d", "postHistory", false],
		],
	);
	assert.equal(view.find((b) => b.id === "d")?.depth, 3);
	assert.equal(view.find((b) => b.id === "b")?.role, "user");
	assert.equal(view.find((b) => b.id === "b")?.enabled, false, "开关取 prompt_order");
});

test("文档层：单块全文；marker 槽位无内容", () => {
	const doc = loadPresetDoc(stRaw(), "x");
	assert.equal(presetDocBlock(doc, "a")?.content, "甲正文");
	assert.equal(presetDocBlock(doc, "chatHistory")?.content, "");
	assert.equal(presetDocBlock(doc, "不存在"), null);
});

test("写回：开关落 prompt_order，不落 prompts[].enabled；未点名的字节原样", () => {
	const doc = loadPresetDoc(stRaw(), "x");
	const next = patchPresetRaw(doc, { blocks: [{ id: "b", enabled: true }, { id: "a", enabled: false }] });

	const order = (next.prompt_order as any)[0].order;
	assert.equal(order.find((o: any) => o.identifier === "b").enabled, true);
	assert.equal(order.find((o: any) => o.identifier === "a").enabled, false);
	const prompts = next.prompts as any[];
	assert.ok(!("enabled" in prompts.find((p) => p.identifier === "b")), "有 order 时不往 prompts 写 enabled");

	assert.deepEqual(next.不认识的键, { 保持: "原样" }, "梨园不认识的键必须原样透传");
	assert.equal(next.max_tokens, 4096);
	assert.deepEqual(doc.raw, stRaw(), "入参原文不许被改");
});

test("写回：名字与内容落 prompts[]，采样落顶层", () => {
	const doc = loadPresetDoc(stRaw(), "x");
	const next = patchPresetRaw(doc, {
		blocks: [{ id: "a", name: " 甲改 ", content: "改后的正文" }],
		samplers: { temperature: 1.2, 乱来: 9 as unknown as number },
	});
	const a = (next.prompts as any[]).find((p) => p.identifier === "a");
	assert.equal(a.name, "甲改");
	assert.equal(a.content, "改后的正文");
	assert.equal(next.temperature, 1.2);
	assert.ok(!("乱来" in next), "名单外采样键不写进原文");
});

test("写回：没有 prompt_order 时开关只能落 prompts[].enabled", () => {
	const doc = loadPresetDoc({ prompts: [{ identifier: "a", name: "甲", content: "x" }] }, "x");
	const next = patchPresetRaw(doc, { blocks: [{ id: "a", enabled: false }] });
	assert.equal((next.prompts as any[])[0].enabled, false);
});

test("写回：旧梨园格式原样落回 blocks", () => {
	const doc = loadPresetDoc(rpRaw(), "x");
	const next = patchPresetRaw(doc, { blocks: [{ id: "p1", enabled: true, content: "新末端" }] });
	const p1 = (next.blocks as any[]).find((b) => b.id === "p1");
	assert.equal(p1.enabled, true);
	assert.equal(p1.content, "新末端");
	assert.equal((next.blocks as any[])[0].content, "系统正文", "没点名的块不动");
});

test("闭环：改开关 → 重读 → 重拼，装配结果跟着变", () => {
	const doc = loadPresetDoc(stRaw(), "x");
	const first = assemble(doc.entries);
	assert.deepEqual(first.after.map((p) => p.id), [], "b 关着、d 是深度注入，末端段应为空");
	assert.deepEqual(first.depth.map((p) => p.id), ["d"]);

	const next = patchPresetRaw(doc, { blocks: [{ id: "b", enabled: true }] });
	const second = assemble(loadPresetDoc(next, "x").entries);
	assert.deepEqual(second.after.map((p) => p.id), ["b"], "开了 b 就该出现在历史后");
});

test("刀3 · patchPresetRaw 支持全量 order 重排、role/depth/order 修改与 extensionsPatch 无损合并", () => {
	const rawWithExt = {
		...stRaw(),
		extensions: {
			SPreset: { keepMe: 123 },
			tavern_helper: { scripts: [{ id: "s1", content: "x" }], variables: { oldKey: "keep" } },
		},
	};
	const doc = loadPresetDoc(rawWithExt, "x");
	const next = patchPresetRaw(doc, {
		order: [
			{ identifier: "b", enabled: true },
			{ identifier: "chatHistory", enabled: true },
			{ identifier: "a", enabled: true },
			{ identifier: "d", enabled: true },
		],
		blocks: [
			{ id: "a", role: "assistant", injectionPosition: 1, injectionDepth: 2, injectionOrder: 888 },
		],
		prompts: [
			{ identifier: "b", name: "乙改名" },
		],
		extensionsPatch: {
			tavern_helper: { variables: { newKey: "added" } },
		},
	});
	const nextDoc = loadPresetDoc(next, "x");
	assert.deepEqual(nextDoc.entries.map((e) => e.identifier), ["b", "chatHistory", "a", "d"], "prompt_order 已重排");
	const bBlock = presetDocBlock(nextDoc, "b");
	assert.equal(bBlock?.name, "乙改名");
	assert.equal(bBlock?.content, "乙正文", "未点名字段原样保留");
	const aBlock = presetDocBlock(nextDoc, "a");
	assert.equal(aBlock?.role, "assistant");
	assert.equal(aBlock?.depth, 2);
	const rawPrompts = (next as { prompts: Array<Record<string, unknown>> }).prompts;
	assert.equal(rawPrompts.find((p) => p.identifier === "a")?.injection_order, 888);
	const ext = (next as { extensions: Record<string, unknown> }).extensions;
	assert.deepEqual((ext.SPreset as Record<string, unknown>)?.keepMe, 123, "未知第三方扩展原样保留");
	const th = ext.tavern_helper as { scripts: unknown[]; variables: Record<string, unknown> };
	assert.equal(th.scripts.length, 1, "既有 scripts 数组保留");
	assert.deepEqual(th.variables, { oldKey: "keep", newKey: "added" }, "extensionsPatch 深合并保留旧变量");
	assert.deepEqual((next as { 不认识的键?: unknown }).不认识的键, { 保持: "原样" });
});
