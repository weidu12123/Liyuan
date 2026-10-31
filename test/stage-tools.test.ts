import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_LOOKUPS, runStageTool, stageTools, type StageToolDeps } from "../src/stage/tools.ts";
import { defaultState, formatState } from "../src/state.ts";
import type { WorldState } from "../src/types.ts";

const makeDeps = (over: Partial<StageToolDeps> = {}): StageToolDeps => ({
	searchLore: () => [],
	searchMemory: async () => [],
	getState: () => defaultState(),
	formatState,
	...over,
});

test("工具清单：不注入写侧依赖时只有读侧三件；schema 合法", () => {
	// deps 缺省 = 只有 searchLore 一族可用，世界书写侧/列举/启停不上清单
	const tools = stageTools("中文", makeDeps());
	assert.deepEqual(
		tools.map((t) => t.name).sort(),
		["lorebook_search", "memory_search", "world_state_get"],
	);
	for (const t of tools) {
		assert.ok(t.description.length > 20, `${t.name} 要有像样的描述`);
		assert.equal((t.parameters as { type: string }).type, "object");
	}
	// 语言写进描述
	assert.ok(stageTools("English", makeDeps()).some((t) => t.description.includes("English")));
});

test("工具清单：注入世界书写侧依赖后，写侧/列举/启停才上清单（M-D2）", () => {
	// R8「台上零写入工具」已由 M-A（draft_write/world_state_update）与 M-D2（世界书族）
	// 正式退役——台上现在是 agent，写侧受门禁与依赖注入双重约束，而非一律不给。
	const full = stageTools(
		"中文",
		makeDeps({ listLore: () => [], fingerprint: (c) => c, toggleLore: () => 0 }),
	);
	assert.deepEqual(
		full.map((t) => t.name).sort(),
		["lorebook_list", "lorebook_read", "lorebook_search", "lorebook_toggle", "memory_search", "world_state_get"],
	);
});

test("工具清单：注入向量库写侧依赖后，memory_add/list/delete 才上清单（M-D3）", () => {
	const full = stageTools(
		"中文",
		makeDeps({
			addMemory: async () => ({ added: 1, total: 1, chunks: 1 }),
			listMemory: () => [],
			deleteMemory: () => true,
		}),
	);
	assert.deepEqual(
		full.map((t) => t.name).sort(),
		["lorebook_search", "memory_add", "memory_delete", "memory_list", "memory_search", "world_state_get"],
	);
});

test("lorebook_search：命中→标题+关键词+正文；无命中→允许自行创造", async () => {
	const hit = await runStageTool(
		makeDeps({
			searchLore: () => [
				{ entry: { uid: 1, comment: "北境骨誓", keys: ["骨誓", "北境"], content: "以骨为契的古俗。" } },
			],
		}),
		"lorebook_search",
		{ query: "骨誓" },
	);
	assert.ok(hit.text.includes("北境骨誓"));
	assert.ok(hit.text.includes("骨誓、北境"));
	assert.ok(hit.text.includes("以骨为契的古俗"));
	assert.ok(hit.activity?.includes("1 条"));

	const miss = await runStageTool(makeDeps(), "lorebook_search", { query: "不存在的东西" });
	assert.ok(miss.text.includes("尚未被写下"), "无命中要明确授权自行创造");
	assert.ok(miss.activity?.includes("无命中"));
});

test("memory_search：命中带来源标签；无命中禁止臆造", async () => {
	const hit = await runStageTool(
		makeDeps({
			searchMemory: async () => [
				{ text: "第三日，她在溪桥头还了怀表。", meta: { title: "第 12 轮" } },
				{ text: "怀表是师父的遗物。", meta: { fileName: "设定稿.md" } },
			],
		}),
		"memory_search",
		{ query: "怀表" },
	);
	assert.ok(hit.text.includes("〔第 12 轮〕"));
	assert.ok(hit.text.includes("〔设定稿.md〕"));
	assert.ok(hit.activity?.includes("2 条"));

	const miss = await runStageTool(makeDeps(), "memory_search", { query: "陈年旧事" });
	assert.ok(miss.text.includes("不要臆造"), "无命中必须挡住臆造");
	assert.ok(miss.text.includes("记不太清"), "给出可用的叙事出路");
});

test("world_state_get：给人读的格式 + RAW JSON（模型两种都能用）", async () => {
	const state: WorldState = {
		...defaultState(),
		time: "戌时",
		location: "溪桥",
		characters: { 云澜: { affinity: 6, status: "手臂有伤", notes: "" } },
		inventory: ["黄铜怀表（云澜持有）"],
	};
	const r = await runStageTool(makeDeps({ getState: () => state }), "world_state_get", {});
	assert.ok(r.text.includes("时间：戌时"));
	assert.ok(r.text.includes("云澜：好感 6"));
	const raw = JSON.parse(r.text.slice(r.text.indexOf("RAW:\n") + 5));
	assert.equal(raw.location, "溪桥");
	assert.deepEqual(raw.inventory, ["黄铜怀表（云澜持有）"]);
	assert.equal(r.activity, "查账本");
});

test("工具容错：检索抛错/缺参/未知工具都返回可读文本，不抛不中断本拍", async () => {
	const boom = await runStageTool(
		makeDeps({
			searchLore: () => {
				throw new Error("索引损坏");
			},
		}),
		"lorebook_search",
		{ query: "任意" },
	);
	assert.ok(boom.text.includes("索引损坏"));
	assert.ok(boom.text.includes("继续写"), "失败也要告诉模型怎么往下走");

	const memBoom = await runStageTool(
		makeDeps({
			searchMemory: async () => {
				throw new Error("向量库离线");
			},
		}),
		"memory_search",
		{ query: "任意" },
	);
	assert.ok(memBoom.text.includes("向量库离线"));

	assert.ok((await runStageTool(makeDeps(), "lorebook_search", {})).text.includes("缺少 query"));
	assert.ok((await runStageTool(makeDeps(), "memory_search", { query: "   " })).text.includes("缺少 query"));

	const unknown = await runStageTool(makeDeps(), "world_state_update", { patch: {} });
	assert.ok(unknown.text.includes("未知工具"), "写入类工具名要被明确拒绝");
	assert.ok(unknown.text.includes("lorebook_search"), "并告知可用清单");
});

test("检索配额常量是 3（一拍封顶，防查资料上瘾）", () => {
	assert.equal(MAX_LOOKUPS, 3);
});
