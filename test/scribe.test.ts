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

// ---------- 面板数据推进（v1.5.3：外观 agent 写一次，数据每拍由场记推进） ----------

test("场记提示词：无面板时逐字等于旧版（守回归）", () => {
	const args = {
		state: defaultState(),
		userText: "我们继续。",
		assistantText: "*她点头*",
		charName: "青梧",
		userName: "阿远",
	};
	const bare = buildScribeTurnPrompt(args);
	// 空数组、全是空树、字段缺失，三种都必须与「没有面板」完全一致
	assert.deepEqual(buildScribeTurnPrompt({ ...args, panels: [] }), bare);
	assert.ok(!bare.systemPrompt.includes("panel_patch"));
	assert.ok(!bare.userText.includes("【面板数据·当前值】"));
});

test("场记提示词：有面板时追加 panel_patch 段与当前值", () => {
	const { systemPrompt, userText } = buildScribeTurnPrompt({
		state: defaultState(),
		userText: "翻过北岭。",
		assistantText: "*风雪渐大*",
		charName: "青梧",
		userName: "阿远",
		panels: [{ name: "队伍", tree: { 体力: 8, 位置: "南麓" } }],
	});
	assert.ok(systemPrompt.includes("panel_patch"));
	assert.ok(systemPrompt.includes("面板名"), "要求按面板分层，不是把面板名拼进路径");
	assert.ok(userText.includes("【面板数据·当前值】"));
	assert.ok(userText.includes("队伍"));
	assert.ok(userText.includes("南麓"), "当前值要给出去，否则模型无从判断哪个变了");
});

test("解析 panel_patch：两层对象才认，一层的整个丢弃", () => {
	const ok = parseScribeResult('{"patch":{},"panel_patch":{"队伍":{"体力":6,"位置":"北岭"}}}');
	assert.deepEqual(ok?.panelPatch, { 队伍: { 体力: 6, 位置: "北岭" } });

	// 模型给成一层（把路径当面板名）→ 不能凭空建出一个叫「体力」的面板
	const flat = parseScribeResult('{"patch":{},"panel_patch":{"体力":6}}');
	assert.equal(flat?.panelPatch, undefined);

	// 混合：合法的留下，非对象的那条丢掉
	const mixed = parseScribeResult('{"patch":{},"panel_patch":{"队伍":{"体力":6},"坏的":3}}');
	assert.deepEqual(mixed?.panelPatch, { 队伍: { 体力: 6 } });

	// 空 / 缺失 → undefined，不是 {}
	assert.equal(parseScribeResult('{"patch":{},"panel_patch":{}}')?.panelPatch, undefined);
	assert.equal(parseScribeResult('{"patch":{}}')?.panelPatch, undefined);
});

test("端到端：面板数据被场记推进，模板随之显示新值", async () => {
	const { runScribeTurn } = await import("../src/stage/scribe-run.ts");
	const { fillPanelTemplate, formatPanelSnapshot, writePanel } = await import("../src/panels.ts");

	// 开局：agent 写了外观（含占位符）+ 声明了数据
	const template = "<div>体力 {{体力}} · 位置 {{位置}}</div>";
	const w = writePanel({}, { name: "队伍", kind: "html", content: template });
	const panels = w.ok ? w.panels : {};
	const state = { ...defaultState(), panelData: { 队伍: { 体力: 8, 位置: "南麓" } } };

	assert.equal(
		fillPanelTemplate(template, state.panelData.队伍, { escapeMarkup: true }),
		"<div>体力 8 · 位置 南麓</div>",
		"开局按声明的初值显示",
	);

	// 注入侧：喂的是数据不是标签
	const snap = formatPanelSnapshot(panels, { data: state.panelData })!;
	assert.ok(snap.includes("南麓") && !snap.includes("<div>"), "注入喂数据不喂外观");

	let sawPrompt = "";
	const out = await runScribeTurn(
		{
			sideText: async (_sp, ut) => {
				sawPrompt = ut;
				return '{"patch":{"location":"北岭"},"panel_patch":{"队伍":{"体力":5,"位置":"北岭"}}}';
			},
			appendStateEntry: () => {},
			getLeafId: () => "leaf-1",
		},
		{
			state,
			userText: "继续翻山。",
			assistantText: "*风雪里走了整日，终于翻过北岭。*",
			charName: "青梧",
			userName: "旅人",
		},
	);

	assert.ok(sawPrompt.includes("【面板数据·当前值】"), "场记看得见面板当前值");
	assert.equal(out.kind, "applied");
	if (out.kind !== "applied") return;
	assert.deepEqual(out.state.panelData?.队伍, { 体力: 5, 位置: "北岭" });
	// 外观没变，显示出来的值变了——这正是「外观写一次、数据每拍推进」
	assert.equal(
		fillPanelTemplate(template, out.state.panelData?.队伍, { escapeMarkup: true }),
		"<div>体力 5 · 位置 北岭</div>",
	);
});

test("场记不许凭空建面板：账本里没有的面板名一律忽略", async () => {
	const { runScribeTurn } = await import("../src/stage/scribe-run.ts");
	const out = await runScribeTurn(
		{
			sideText: async () => '{"patch":{},"panel_patch":{"根本不存在的面板":{"x":1},"队伍":{"体力":3}}}',
			appendStateEntry: () => {},
			getLeafId: () => "leaf-1",
		},
		{
			state: { ...defaultState(), panelData: { 队伍: { 体力: 9 } } },
			userText: "继续。",
			assistantText: "*走了一段。*",
			charName: "青梧",
			userName: "旅人",
		},
	);
	assert.equal(out.kind, "applied");
	if (out.kind !== "applied") return;
	assert.deepEqual(Object.keys(out.state.panelData ?? {}), ["队伍"], "幻觉出来的面板名不建");
	assert.equal(out.state.panelData?.队伍.体力, 3);
});
