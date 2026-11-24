import assert from "node:assert/strict";
import test from "node:test";

import { runCheck } from "../scripts/i18n-check.mjs";
import { localizedCommands } from "../src/commands.ts";
import { t as tServer, setUiLocale } from "../src/i18n/index.ts";

test("i18n：外壳源码里的中文字面量全部走 t()；目录无死条目、无译法冲突", () => {
	const r = runCheck();
	const sample = r.misses.slice(0, 20).map((m) => `${m.file}:${m.line} ${m.text}`).join("\n");
	assert.equal(r.misses.length, 0, `未走 t() 的中文字面量 ${r.misses.length} 条，例如：\n${sample}`);
	assert.equal(r.dead.length, 0, `目录里有源码不再使用的键：${r.dead.slice(0, 10).map((d) => d.key).join(" | ")}`);
	assert.equal(r.missingEn.length, 0, `源码 t() 的键缺英文：${r.missingEn.slice(0, 10).join(" | ")}`);
});

test("i18n：t() 占位符、单复数、缺条目回落", () => {
	setUiLocale("zh");
	assert.equal(tServer("非法预设路径"), "非法预设路径");
	setUiLocale("en");
	assert.equal(tServer("这句没有英文"), "这句没有英文");
	assert.equal(tServer("已删除 {n} 条", { n: 3 }).includes("3"), true);
	setUiLocale("garbage");
	assert.equal(tServer("非法预设路径"), "非法预设路径");
});

test("i18n：localizedCommands('en') 所有斜杠命令的 usage 与 description 均无中文残留，且含 | 语法不被误裁", () => {
	const han = /[㐀-鿿豈-﫿]/;
	const cmds = localizedCommands("en");
	assert.ok(cmds.length >= 20);
	for (const c of cmds) {
		assert.equal(han.test(c.usage), false, `/${c.name} usage 含中文：${c.usage}`);
		assert.equal(han.test(c.description), false, `/${c.name} description 含中文：${c.description}`);
		assert.ok(c.usage.startsWith(`/${c.name}`), `/${c.name} usage 不应被 | 误截断：${c.usage}`);
	}
	setUiLocale("en");
	assert.equal(tServer("用法：/greeting [序号|next|prev]"), "Usage: /greeting [index|next|prev]");
	assert.equal(tServer("已清理 {n} 条非活跃名录条目", { n: 1 }), "Cleared 1 inactive roster entry");
	assert.equal(tServer("已清理 {n} 条非活跃名录条目", { n: 3 }), "Cleared 3 inactive roster entries");
	setUiLocale("zh");
});
