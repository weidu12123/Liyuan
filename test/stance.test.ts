import assert from "node:assert/strict";
import { test } from "node:test";

import { isBackstageText } from "../src/stance.ts";

test("场外标记：// 与双括号与整条括号包裹", () => {
	assert.ok(isBackstageText("//帮我看看好感度"));
	assert.ok(isBackstageText("  //前面有空白"));
	assert.ok(isBackstageText("((ooc: 这段太快了))"));
	assert.ok(isBackstageText("（（把温度调低点））"));
	assert.ok(isBackstageText("（帮我把这段设定存进世界书）"));
	assert.ok(isBackstageText("(generate an image of this scene)"));
	assert.ok(isBackstageText("（中文开括号英文闭括号也认)"));
});

test("场外标记：剧情输入不误判", () => {
	assert.ok(!isBackstageText("我推门走了进去。"));
	assert.ok(!isBackstageText("/rewind 2"), "单斜杠命令不是场外话");
	assert.ok(!isBackstageText("她说（小声地）：走吧"), "括号在句中不算整条包裹");
	assert.ok(!isBackstageText("（他抬起头）随后说道：你来了"), "开头括号但未包裹整条");
	assert.ok(!isBackstageText(""));
	assert.ok(!isBackstageText("   "));
});
