import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";

import { sameCardPath } from "../src/paths.ts";

// 用本机 cwd，避免硬编码 Windows 盘符在 Linux CI 上 isAbsolute 失效
const cwd = process.cwd();

test("sameCardPath：相对路径与正反斜杠", () => {
	assert.ok(sameCardPath("assets/cards/a.png", "assets/cards/a.png", cwd));
	assert.ok(sameCardPath("assets/cards/a.png", "assets\\cards\\a.png", cwd));
	assert.ok(sameCardPath("./assets/cards/a.png", "assets/cards/a.png", cwd));
});

test("sameCardPath：相对 vs 绝对", () => {
	const abs = join(cwd, "assets/cards/a.png");
	assert.ok(sameCardPath("assets/cards/a.png", abs, cwd));
	assert.ok(sameCardPath(abs, "assets/cards/a.png", cwd));
});

test("sameCardPath：Windows 盘符路径（POSIX 宿主也认）", () => {
	const winCwd = "E:/silly-agent/Liyuan";
	const winAbs = "E:\\silly-agent\\Liyuan\\assets\\cards\\a.png";
	assert.ok(sameCardPath("assets/cards/a.png", winAbs, winCwd));
	assert.ok(sameCardPath(winAbs, "assets/cards/a.png", winCwd));
	assert.ok(sameCardPath("E:/silly-agent/Liyuan/assets/cards/a.png", winAbs, winCwd));
});

test("sameCardPath：不同卡", () => {
	assert.ok(!sameCardPath("assets/cards/a.png", "assets/cards/b.png", cwd));
	assert.ok(!sameCardPath("assets/cards/a.png", "../材料2/大乾.json", cwd));
	assert.ok(!sameCardPath("", "assets/cards/a.png", cwd));
	assert.ok(!sameCardPath(undefined, "assets/cards/a.png", cwd));
});
