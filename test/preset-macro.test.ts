/**
 * 预设宏求值器：ST 宏最小核心集（setvar/getvar/addvar/random/trim/{{//}}/lastusermessage/char/user）。
 * 承诺边界：清单外的 {{…}} 一律剥除并记入 unsupported（显式降级，不发字面量噪声）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createMacroEnv, evalPresetMacros } from "../src/preset-macro.ts";

const env = (overrides: Partial<Parameters<typeof createMacroEnv>[0]> = {}) =>
	createMacroEnv({ charName: "阿远", userName: "小舟", userText: "我们出发吧", ...overrides });

test("char/user 宏替换（大小写不敏感）", () => {
	const r = evalPresetMacros("{{char}}看着{{USER}}", env());
	assert.equal(r.text, "阿远看着小舟");
	assert.deepEqual(r.unsupported, []);
});

test("setvar 存值返回空串，getvar 取值，未定义取空", () => {
	const e = env();
	const r1 = evalPresetMacros("{{setvar::pov::第一人称}}", e);
	assert.equal(r1.text, "");
	const r2 = evalPresetMacros("视角:{{getvar::pov}}|空:{{getvar::nothing}}", e);
	assert.equal(r2.text, "视角:第一人称|空:");
});

test("setvar 值可含多行与冒号外字符，跨块共享同一 env", () => {
	const e = env();
	evalPresetMacros("{{setvar::hook::\n<rule>\n- 不收尾\n</rule>\n}}", e);
	const r = evalPresetMacros("{{getvar::hook}}", e);
	assert.ok(r.text.includes("- 不收尾"));
});

test("addvar 追加到已有值", () => {
	const e = env();
	evalPresetMacros("{{setvar::style::简练}}{{addvar::style::、冷峻}}", e);
	assert.equal(evalPresetMacros("{{getvar::style}}", e).text, "简练、冷峻");
});

test("setvar 空值可清空变量", () => {
	const e = env();
	evalPresetMacros("{{setvar::x::有}}{{setvar::x::}}", e);
	assert.equal(evalPresetMacros("[{{getvar::x}}]", e).text, "[]");
});

test("getvar 取出的值中若含宏，继续求值（有限轮，自引用不死循环）", () => {
	const e = env();
	evalPresetMacros("{{setvar::inner::{{char}}的独白}}", e);
	assert.equal(evalPresetMacros("{{getvar::inner}}", e).text, "阿远的独白");
	// 自引用：不挂起，最终剥除
	evalPresetMacros("{{setvar::loop::A{{getvar::loop}}}}", e);
	const r = evalPresetMacros("{{getvar::loop}}", e);
	assert.ok(!r.text.includes("{{"), `自引用应被剥净，得到:${r.text}`);
});

test("random：逗号列表与 :: 列表都支持，结果是候选之一", () => {
	const candidates = ["甲", "乙", "丙"];
	for (const tpl of ["{{random::甲,乙,丙}}", "{{random::甲::乙::丙}}"]) {
		const r = evalPresetMacros(tpl, env());
		assert.ok(candidates.includes(r.text), `${tpl} → ${r.text}`);
	}
});

test("{{//注释}} 与 {{trim}} 剥除；trim 收掉两侧空白", () => {
	const r = evalPresetMacros("{{//这是说明文字}}正文A \n {{trim}} \n正文B", env());
	assert.equal(r.text, "正文A正文B");
});

test("lastusermessage 展开为本轮用户原文，缺省为空", () => {
	assert.equal(evalPresetMacros("<m>{{lastusermessage}}</m>", env()).text, "<m>我们出发吧</m>");
	assert.equal(evalPresetMacros("<m>{{lastusermessage}}</m>", env({ userText: undefined })).text, "<m></m>");
});

test("清单外宏原样保留并记录名字（去重）；roll 已支持且同表达式恒同值", () => {
	const src = "{{roll:d20}}A{{time}}B{{pick::x,y}}C{{time}}";
	const r = evalPresetMacros(src, env());
	// 酒馆 evaluateMacros 是「认识才替换」：清单外宏原样送模，只登记名字供降级告警
	assert.ok(r.text.includes("{{time}}") && r.text.includes("{{pick::x,y}}"), `清单外宏应原样保留，得到:${r.text}`);
	assert.deepEqual([...r.unsupported].sort(), ["pick", "time"]);
	// roll 已进求值面：出数字，且内容寻址钉死（同表达式恒得同值，保 R3 前缀缓存）
	assert.match(r.text.slice(0, r.text.indexOf("A")), /^[0-9]+$/);
	assert.equal(evalPresetMacros(src, env()).text, r.text);
});

test("非宏的花括号文本不受影响", () => {
	const src = "JSON 示例 {\"a\":1} 与 ${模板} 原样保留";
	assert.equal(evalPresetMacros(src, env()).text, src);
});

test("实战混合：双人成行式块求值", () => {
	const e = env();
	evalPresetMacros(
		"{{setvar::pov_target::\n<pov>\n写作视角: 用户角色第一人称\n</pov>\n}}{{setvar::word_count::1000-1500}}{{trim}}",
		e,
	);
	const r = evalPresetMacros(
		"【问题】核心文风:\n  - 以{{getvar::pov_target}}叙述故事\n【问题】字数: {{getvar::word_count}}字\n{{getvar::plot_check}}{{unknownmacro::x}}",
		e,
	);
	assert.ok(r.text.includes("用户角色第一人称"));
	assert.ok(r.text.includes("1000-1500字"));
	assert.ok(r.text.includes("{{unknownmacro::x}}"), `清单外宏原样保留，得到:${r.text}`);
	assert.ok(!r.text.includes("{{getvar"), "清单内宏照旧求值（未设变量得空）");
	assert.deepEqual(r.unsupported, ["unknownmacro"]);
});

test("刀2 · 扩展标准宏（global/inc/dec/has/delete/lastmessage/lastcharmessage/charifnotgroup/space/newline/noop）", () => {
	const e = env({
		vars: { count: "5", keep: "yes" },
		globalVars: { g_zishu: "1500字", g_num: "10" },
		lastMessage: "最新一句",
		lastCharMessage: "角色最近一句",
	});
	const r = evalPresetMacros(
		[
			"{{charIfNotGroup}}|{{lastMessage}}|{{lastCharMessage}}",
			"g={{getglobalvar::g_zishu}}",
			"{{addglobalvar::g_num::5}}gn={{getglobalvar::g_num}}",
			"{{setglobalvar::g_flag::ok}}{{getglobalvar::g_flag}}",
			"inc={{incvar::count}}/dec={{decvar::count}}/ginc={{incglobalvar::g_num}}/gdec={{decglobalvar::g_num}}",
			"has={{hasvar::keep}}|{{varexists::missing}}",
			"{{deletevar::keep}}afterDel={{hasvar::keep}}",
			"{{addvar::numNew::3}}numNew={{getvar::numNew}}",
			"A{{space::3}}B{{newline::2}}C{{noop}}",
		].join("|"),
		e,
	);
	assert.equal(
		r.text,
		[
			"阿远|最新一句|角色最近一句",
			"g=1500字",
			"gn=15",
			"ok",
			"inc=6/dec=5/ginc=16/gdec=15",
			"has=true|false",
			"afterDel=false",
			"numNew=3",
			"A   B\n\nC",
		].join("|"),
	);
	assert.deepEqual(r.unsupported, []);
});
