import assert from "node:assert/strict";
import { test } from "node:test";

import {
	buildAncestryIndex,
	buildWorldlineView,
	defaultSaveName,
	extractSaves,
	findSave,
	formatWorldlineText,
	planNewSave,
	softDeleteSave,
	type SaveOnTree,
	type TreeEntryLite,
} from "../src/worldline.ts";

const entry = (
	id: string,
	parentId: string | null,
	extra?: Partial<TreeEntryLite> & { save?: object },
): TreeEntryLite => {
	if (extra?.save) {
		return {
			id,
			parentId,
			type: "custom",
			customType: "rp-save",
			data: extra.save,
			timestamp: extra.timestamp,
		};
	}
	return { id, parentId, type: "message", ...extra };
};

test("首存：无前驱 → 主线", () => {
	const planned = planNewSave({
		name: "开场",
		prevOnBranch: null,
		branchEntryIds: new Set(["a"]),
		allSaves: [],
		ancestorsOf: () => new Set(),
		now: 1000,
	});
	assert.equal(planned.name, "开场");
	assert.equal(planned.worldlineName, "主线");
	assert.ok(planned.worldlineId);
	assert.equal(planned.parentSaveId, undefined);
});

test("同线延长：prev 后无分叉存档 → 继承 worldlineId", () => {
	const prev: SaveOnTree = {
		id: "s1",
		name: "进城",
		worldlineId: "wl-main",
		worldlineName: "主线",
		entryId: "e1",
		treeParentId: null,
		createdAt: 1,
	};
	const planned = planNewSave({
		name: "血战前夜",
		prevOnBranch: prev,
		branchEntryIds: new Set(["e1", "e2", "e3"]),
		allSaves: [prev],
		ancestorsOf: (id) => (id === "e1" ? new Set(["e1"]) : new Set(["e1", id])),
		now: 2000,
	});
	assert.equal(planned.worldlineId, "wl-main");
	assert.equal(planned.worldlineName, "主线");
	assert.equal(planned.parentSaveId, "s1");
	assert.equal(planned.forkFromSaveId, undefined);
});

test("分叉：prev 后另有不在当前分支的存档 → 新世界线", () => {
	const prev: SaveOnTree = {
		id: "s1",
		name: "进城",
		worldlineId: "wl-main",
		worldlineName: "主线",
		entryId: "e1",
		treeParentId: null,
		createdAt: 1,
	};
	const oldPath: SaveOnTree = {
		id: "s2",
		name: "血战",
		worldlineId: "wl-main",
		worldlineName: "主线",
		parentSaveId: "s1",
		entryId: "e-old",
		treeParentId: "e1",
		createdAt: 2,
	};
	// 当前分支：e1 → e-new（回档后新路），不含 e-old
	const planned = planNewSave({
		name: "议和",
		prevOnBranch: prev,
		branchEntryIds: new Set(["e1", "e-new"]),
		allSaves: [prev, oldPath],
		ancestorsOf: (id) => {
			if (id === "e1") return new Set(["e1"]);
			if (id === "e-old") return new Set(["e1", "e-old"]);
			if (id === "e-new") return new Set(["e1", "e-new"]);
			return new Set([id]);
		},
		now: 3000,
	});
	assert.notEqual(planned.worldlineId, "wl-main");
	assert.equal(planned.forkFromSaveId, "s1");
	assert.equal(planned.parentSaveId, "s1");
	assert.match(planned.worldlineName, /进城/);
	assert.match(planned.worldlineName, /线/);
});

test("分叉后第二次 store：prev 已是新线最近钉 → 继承新线", () => {
	const forkFirst: SaveOnTree = {
		id: "s3",
		name: "议和",
		worldlineId: "wl-b",
		worldlineName: "从「进城」分出 · 线2",
		parentSaveId: "s1",
		forkFromSaveId: "s1",
		entryId: "e-b1",
		treeParentId: "e1",
		createdAt: 3,
	};
	const oldPath: SaveOnTree = {
		id: "s2",
		name: "血战",
		worldlineId: "wl-main",
		worldlineName: "主线",
		entryId: "e-old",
		treeParentId: "e1",
		createdAt: 2,
	};
	const planned = planNewSave({
		name: "结盟",
		prevOnBranch: forkFirst,
		branchEntryIds: new Set(["e1", "e-b1", "e-b2"]),
		allSaves: [oldPath, forkFirst],
		ancestorsOf: (id) => {
			if (id === "e-old") return new Set(["e1", "e-old"]);
			if (id === "e-b1") return new Set(["e1", "e-b1"]);
			if (id === "e-b2") return new Set(["e1", "e-b1", "e-b2"]);
			return new Set([id]);
		},
		now: 4000,
	});
	// oldPath 不是 e-b1 的后继 → 无 divergent → 同 wl-b
	assert.equal(planned.worldlineId, "wl-b");
	assert.equal(planned.parentSaveId, "s3");
});

test("extractSaves + softDelete + findSave + view", () => {
	const entries: TreeEntryLite[] = [
		entry("m0", null),
		entry("e1", "m0", {
			save: {
				id: "s1",
				name: "开场",
				worldlineId: "w1",
				worldlineName: "主线",
				createdAt: 10,
			},
		}),
		entry("m1", "e1"),
		entry("e2", "m1", {
			save: {
				id: "s2",
				name: "进城",
				worldlineId: "w1",
				worldlineName: "主线",
				parentSaveId: "s1",
				createdAt: 20,
			},
		}),
	];
	let saves = extractSaves(entries);
	assert.equal(saves.length, 2);
	assert.equal(findSave(saves, "进城")?.id, "s2");
	assert.equal(findSave(saves, "s1")?.name, "开场");

	const meta = softDeleteSave({ deletedSaveIds: [], worldlineNames: {} }, "s1");
	saves = extractSaves(entries, meta);
	assert.equal(saves.length, 1);
	assert.equal(saves[0].id, "s2");

	const { branchIdsFromLeaf } = buildAncestryIndex(entries);
	const branch = branchIdsFromLeaf("e2");
	const view = buildWorldlineView(saves, meta, branch, "e2");
	assert.equal(view.lines.length, 1);
	assert.equal(view.currentSaveId, "s2");
	assert.ok(formatWorldlineText(view).includes("进城"));
});

test("defaultSaveName 非空", () => {
	assert.ok(defaultSaveName(Date.now()).startsWith("存档 "));
});
