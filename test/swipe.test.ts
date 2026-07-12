import assert from "node:assert/strict";
import { test } from "node:test";

import {
	currentVariantIndex,
	isReplyVariantRoot,
	lastStoryUserEntryId,
	leafOfVariant,
	listReplyVariants,
	subtreeIds,
	swipeMetaForUser,
	type SwipeEntry,
} from "../src/swipe.ts";

const e = (
	id: string,
	parentId: string | null,
	extra: Partial<SwipeEntry> = {},
): SwipeEntry => ({
	id,
	parentId,
	type: "message",
	timestamp: extra.timestamp ?? `2026-01-01T00:00:0${id.length}Z`,
	...extra,
});

test("isReplyVariantRoot：assistant / edited-reply 算变体根，user 与纯 custom 不算", () => {
	assert.equal(isReplyVariantRoot(e("a", "u", { role: "assistant" })), true);
	assert.equal(
		isReplyVariantRoot(e("b", "u", { role: "custom", customType: "rp-edited-reply" })),
		true,
	);
	assert.equal(isReplyVariantRoot(e("c", "u", { role: "user" })), false);
	assert.equal(isReplyVariantRoot({ id: "d", parentId: "u", type: "custom", customType: "rp-state" }), false);
});

test("listReplyVariants：同一 user 下多条 assistant 按时间排序；leaf 跟子树", () => {
	const entries: SwipeEntry[] = [
		e("u", null, { role: "user", timestamp: "t0" }),
		e("a1", "u", { role: "assistant", timestamp: "t1" }),
		e("a2", "u", { role: "assistant", timestamp: "t2" }),
		e("a2-child", "a2", { role: "assistant", timestamp: "t3" }), // 工具链后续
	];
	const vars = listReplyVariants(entries, "u", "a2-child");
	assert.equal(vars.length, 2);
	assert.equal(vars[0].rootId, "a1");
	assert.equal(vars[0].leafId, "a1");
	assert.equal(vars[1].rootId, "a2");
	assert.equal(vars[1].leafId, "a2-child"); // 当前 leaf 在 a2 子树
	assert.equal(currentVariantIndex(vars, "a2-child", entries), 1);
});

test("leafOfVariant：无 currentLeaf 时取子树最新叶", () => {
	const entries: SwipeEntry[] = [
		e("r", "u", { role: "assistant", timestamp: "t1" }),
		e("x", "r", { role: "assistant", timestamp: "t2" }),
		e("y", "r", { role: "assistant", timestamp: "t3" }),
	];
	assert.equal(leafOfVariant(entries, "r", null), "y");
	assert.equal(leafOfVariant(entries, "r", "x"), "x");
});

test("subtreeIds 含根与全部后代", () => {
	const entries: SwipeEntry[] = [e("r", "u"), e("c", "r"), e("g", "c"), e("other", "u")];
	const ids = subtreeIds(entries, "r");
	assert.deepEqual([...ids].sort(), ["c", "g", "r"]);
});

test("lastStoryUserEntryId 跳过戏外", () => {
	const branch = [
		{ id: "u1", type: "message", role: "user", text: "剧情" },
		{ id: "u2", type: "message", role: "user", text: "// 幕后问" },
		{ id: "a", type: "message", role: "assistant", text: "答" },
	];
	const isBs = (t: string) => t.startsWith("//");
	assert.equal(lastStoryUserEntryId(branch, isBs), "u1");
});

test("swipeMetaForUser：无变体 total=0；有变体给 index/leafIds", () => {
	const empty = swipeMetaForUser([e("u", null, { role: "user" })], "u", "u");
	assert.deepEqual(empty, { index: 0, total: 0, userEntryId: "u", leafIds: [] });

	const entries: SwipeEntry[] = [
		e("u", null, { role: "user" }),
		e("a1", "u", { role: "assistant", timestamp: "t1" }),
		e("a2", "u", { role: "assistant", timestamp: "t2" }),
	];
	const meta = swipeMetaForUser(entries, "u", "a1");
	assert.equal(meta?.total, 2);
	assert.equal(meta?.index, 0);
	assert.deepEqual(meta?.leafIds, ["a1", "a2"]);
});
