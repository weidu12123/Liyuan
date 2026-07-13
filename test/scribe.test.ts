import assert from "node:assert/strict";
import { test } from "node:test";

import { buildLoreAliasPrompt, buildScribeTurnPrompt, parseLoreAliases, parseScribeResult } from "../src/scribe.ts";
import { withAliases } from "../src/lorebook.ts";
import { defaultState } from "../src/state.ts";
import type { LorebookEntry } from "../src/types.ts";

test("场记提示词：只记账，不含连续性审查", () => {
	const { systemPrompt, userText } = buildScribeTurnPrompt({
		state: defaultState(),
		userText: "*我递出怀表* 收下吧。",
		assistantText: "*她推了回去*「不收诊金。」",
		charName: "青梧",
		userName: "阿远",
	});
	assert.ok(systemPrompt.includes("patch"));
	assert.ok(!systemPrompt.includes('"warnings"'), "不再要求输出 warnings 字段");
	assert.ok(!systemPrompt.includes("连续性"), "不再做连续性审查");
	assert.ok(!systemPrompt.includes("unasked_turn"), "不再做先斩后奏检测");
	assert.ok(systemPrompt.includes("否定性事件"), "拒收类事件必须显式要求记账");
	assert.ok(systemPrompt.includes("青梧"));
	assert.ok(userText.includes("【当前账本】"));
	assert.ok(userText.includes("阿远：*我递出怀表*"));
});

test("场记提示词：detectUnaskedTurn 已忽略", () => {
	const { systemPrompt } = buildScribeTurnPrompt({
		state: defaultState(),
		userText: "我们继续。",
		assistantText: "*他忽然拔剑刺向盟友。*",
		charName: "青梧",
		userName: "阿远",
		detectUnaskedTurn: true,
	});
	assert.ok(!systemPrompt.includes("unasked_turn"));
	assert.ok(!systemPrompt.includes("先斩后奏"));
});

test("场记输出解析：只取 patch，丢弃审查字段", () => {
	const bare = parseScribeResult('{"patch":{"time":"第二天清晨"},"warnings":["正文说怀表在她手中 vs 账本记录阿远持有"]}');
	assert.ok(bare);
	assert.equal((bare.patch as { time?: string }).time, "第二天清晨");
	assert.equal(bare.warnings.length, 0, "warnings 一律清空");
	assert.equal(bare.unaskedTurn, null);

	const fenced = parseScribeResult('好的，以下是结果：\n```json\n{"patch":{},"warnings":[]}\n```');
	assert.ok(fenced);
	assert.deepEqual(fenced.patch, {});
	assert.deepEqual(fenced.warnings, []);

	assert.equal(parseScribeResult("模型拒绝输出 JSON 的散文"), null);
	const malformed = parseScribeResult('{"patch": "不是对象", "warnings": [42, "有效告警", ""]}');
	assert.ok(malformed);
	assert.deepEqual(malformed.patch, {}, "非对象 patch 应回退为空");
	assert.deepEqual(malformed.warnings, []);
});

test("场记输出解析：unasked_turn 即使返回也丢弃", () => {
	const hit = parseScribeResult('{"patch":{},"warnings":[],"unasked_turn":"未经询问即让盟友背叛"}');
	assert.ok(hit);
	assert.equal(hit.unaskedTurn, null);
});

test("别名提示词与解析", () => {
	const { systemPrompt, userText } = buildLoreAliasPrompt(
		[{ uid: 1, keys: ["gloomhound", "beast"], comment: "gloomhound", excerpt: "beasts of darkness..." }],
		"中文",
	);
	assert.ok(systemPrompt.includes("中文"));
	assert.ok(userText.includes("uid=1"));

	const map = parseLoreAliases('```json\n{"1": ["幽影犬", "暗影兽", ""], "x": ["无效键"], "2": "非数组"}\n```');
	assert.ok(map);
	assert.deepEqual(map.get(1), ["幽影犬", "暗影兽"]);
	assert.equal(map.size, 1);
});

const entry = (uid: number, keys: string[]): LorebookEntry => ({
	uid,
	keys,
	secondaryKeys: [],
	comment: "",
	content: `内容${uid}`,
	constant: false,
	enabled: true,
	selective: false,
	order: 100,
});

test("withAliases：合入去重、不改原条目", () => {
	const src = [entry(1, ["gloomhound"]), entry(2, ["glade"])];
	const out = withAliases(src, new Map([[1, ["幽影犬", "Gloomhound"]]]));
	assert.deepEqual(out[0].keys, ["gloomhound", "幽影犬"], "大小写重复的别名应去重");
	assert.deepEqual(out[1].keys, ["glade"]);
	assert.deepEqual(src[0].keys, ["gloomhound"], "原条目不可变");
});
