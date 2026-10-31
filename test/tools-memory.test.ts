/**
 * M-D3 向量库族工具单测（PLAN-RP-TOOLING §3）。
 *
 * 三条验收轴（契约点名）：
 *   1. 跨 surface 一致性——台上/助手同一份实现，命中正文逐字相同，差异只在话术裁剪；
 *   2. **作用域正确性**——scope 不经模型、写侧不给 store、delete 的 store 归属由 list 决定；
 *   3. 门禁——写侧认写入信号、删除认删除信号，拦下时服务层根本不该被调到。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { checkWriteGate, DELETE_REQUEST_RE, GATED_TOOLS } from "../src/tools/gate.ts";
import {
	memoryAdd,
	memoryDelete,
	memoryList,
	memorySearch,
	memoryTools,
	type MemoryDeps,
} from "../src/tools/memory.ts";
import { toolsFor, type ToolContext } from "../src/tools/registry.ts";

const stageCtx: ToolContext = { surface: "stage", language: "中文" };
const extensionCtx: ToolContext = { surface: "extension", language: "中文" };

const deps = (over: Partial<MemoryDeps> = {}): MemoryDeps => ({
	searchMemory: async () => [],
	...over,
});

/** 用户明确要求写入/删除的原文（门禁放行） */
const ASK_WRITE = { lastUserText: "把这段记住", creationMode: "ask" as const };
const ASK_DELETE = { lastUserText: "把那条记忆忘掉", creationMode: "ask" as const };

// ---------------- 1. 合一与跨 surface 一致性 ----------------

test("记忆族六件；memory_search 两面共用一份实现", () => {
	assert.deepEqual(
		memoryTools.map((t) => t.name),
		["memory_search", "memory_read", "memory_update", "memory_add", "memory_list", "memory_delete"],
	);
	assert.deepEqual([...memorySearch.surfaces].sort(), ["extension", "stage"]);
	// 写侧与管理三件不给扩展面（那套工具面对台上不可达，不新增暴露）
	assert.deepEqual(
		toolsFor(memoryTools, "extension").map((t) => t.name),
		["memory_search"],
	);
	assert.deepEqual(
		toolsFor(memoryTools, "stage").map((t) => t.name).sort(),
		["memory_add", "memory_delete", "memory_list", "memory_read", "memory_search", "memory_update"],
	);
});

test("跨 surface 一致性：同样的命中，正文逐字相同（差异只在无命中话术）", async () => {
	const d = deps({
		searchMemory: async () => [
			{ text: "青梧在黑渊封印了魔尊。", meta: { title: "旧事" } },
			{ text: "玉佩碎成两半。", meta: { source: "archive" } },
		],
	});
	const s = await memorySearch.run({ query: "青梧" }, d, stageCtx);
	const a = await memorySearch.run({ query: "青梧" }, d, extensionCtx);
	assert.equal(s.text, a.text, "命中格式化是共用的，两面必须逐字一致");
	assert.equal(s.text, "1. 〔旧事〕\n青梧在黑渊封印了魔尊。\n\n2. 〔archive〕\n玉佩碎成两半。");
	assert.equal(s.activity, a.activity);
});

test("跨 surface 差异是**有意**的：台上禁臆造给出路，助手报诊断口径", async () => {
	const s = await memorySearch.run({ query: "无此事" }, deps(), stageCtx);
	const a = await memorySearch.run({ query: "无此事" }, deps(), extensionCtx);
	// 台上：不许臆造，但要给「怎么往下演」的出路，否则模型会卡住
	assert.match(s.text, /不要臆造/);
	assert.match(s.text, /模糊化处理/);
	// 助手：诊断面，提示可能是没启用而非没记过
	assert.match(a.text, /未启用|尚未入库/);
	assert.doesNotMatch(a.text, /模糊化处理/);
});

test("容错契约：检索抛错/缺参都回可读文本，不抛", async () => {
	const boom = deps({
		searchMemory: async () => {
			throw new Error("向量索引损坏");
		},
	});
	const s = await memorySearch.run({ query: "x" }, boom, stageCtx);
	assert.match(s.text, /向量索引损坏/);
	assert.match(s.text, /继续写/, "台上失败也要告诉模型怎么往下走");
	assert.match((await memorySearch.run({}, deps(), stageCtx)).text, /缺少 query/);
});

// ---------------- 2. 作用域语义（契约点名的硬前置） ----------------

test("作用域不经模型：任何工具的 schema 都不得出现 scope/sessionId/card 参数", () => {
	for (const spec of memoryTools) {
		for (const ctx of [stageCtx, extensionCtx]) {
			const props = (spec.parameters(ctx) as { properties?: Record<string, unknown> }).properties ?? {};
			for (const banned of ["scope", "sessionId", "session_id", "card"]) {
				assert.ok(
					!(banned in props),
					`${spec.name} 不得让模型指定 ${banned}——作用域由宿主按当前对话+当前卡绑定`,
				);
			}
		}
	}
});

test("写侧不给 store 参数：narrative 服务层禁写，只有一个合法值就不该让模型选", () => {
	const addProps = (memoryAdd.parameters(stageCtx) as { properties: Record<string, unknown> }).properties;
	assert.ok(!("store" in addProps), "memory_add 恒写 external，给了 store 等于摆一个必然失败的选项");
	assert.deepEqual(Object.keys(addProps).sort(), ["text", "title"]);

	// search 也不分库（合并两库，模型不关心一条记忆当初从哪个通道进来）
	const searchProps = (memorySearch.parameters(stageCtx) as { properties: Record<string, unknown> }).properties;
	assert.deepEqual(Object.keys(searchProps), ["query"]);

	// list 要分库（两库性质不同：手动录入 vs 自动生成的剧情摘要）
	const listProps = (memoryList.parameters(stageCtx) as { properties: Record<string, { enum?: string[] }> }).properties;
	assert.deepEqual(listProps.store?.enum, ["external", "narrative", "card", "chat"]);
});

test("memory_add 的描述必须钉死「不跨会话」（最易说谎处）", () => {
	const d = memoryAdd.description(stageCtx);
	assert.match(d, /不跨会话|本对话/, "记忆按对话隔离，不说清模型会当长期记忆用");
});

test("memory_add 回执如实说明作用域，不许承诺「永久记住」", async () => {
	const r = await memoryAdd.run(
		{ text: "主角前世是守陵人。", title: "前世" },
		deps({ addMemory: async () => ({ added: 1, total: 7, chunks: 1 }), gate: () => ASK_WRITE }),
		stageCtx,
	);
	assert.match(r.text, /前世/);
	assert.match(r.text, /共 7 条/);
	assert.match(r.text, /只在当前对话有效/, "回执必须自带作用域声明");
	assert.doesNotMatch(r.text, /永久|跨会话保留/);
});

test("memory_delete 的 store 归属由 list 回传，缺省 external；未命中要指回 list", async () => {
	const seen: Array<[string, string]> = [];
	const d = deps({
		deleteMemory: (store, id) => {
			seen.push([store, id]);
			return false;
		},
		gate: () => ASK_DELETE,
	});
	const miss = await memoryDelete.run({ id: "abc" }, d, stageCtx);
	assert.deepEqual(seen[0], ["external", "abc"], "缺省 external");
	assert.match(miss.text, /没有编号 abc/);
	assert.match(miss.text, /memory_list/, "未命中要指回取编号的入口");

	await memoryDelete.run({ id: "z", store: "narrative" }, d, stageCtx);
	assert.deepEqual(seen[1], ["narrative", "z"]);
	// 非法 store 落回 external 而不是把脏值透给服务层
	await memoryDelete.run({ id: "y", store: "乱填的" }, d, stageCtx);
	assert.deepEqual(seen[2], ["external", "y"]);
});

// ---------------- 3. 门禁（D-T4） ----------------

test("门禁：memory_add/memory_delete 都在受管清单里", () => {
	assert.ok((GATED_TOOLS as readonly string[]).includes("memory_add"));
	assert.ok((GATED_TOOLS as readonly string[]).includes("memory_delete"));
});

test("门禁：删除认**删除**信号，不认写入信号（两个信号集必须分开）", () => {
	// 用户说「把那条忘掉」——不含任何写入词，用写入信号判会被错拦
	for (const say of ["把那条忘掉", "删掉刚才那条记忆", "这条记错了", "forget that"]) {
		assert.equal(
			checkWriteGate({ toolName: "memory_delete", lastUserText: say, creationMode: "ask" }).allow,
			true,
			say,
		);
	}
	// 反向：删除词不该去放行**写入**类工具（否则「删掉那条设定」会放行 lorebook_write）
	assert.equal(
		checkWriteGate({ toolName: "lorebook_write", lastUserText: "把那条设定删掉", creationMode: "ask" }).allow,
		false,
		"删除词不得放行写入工具",
	);
	// 写入词同样不该放行删除
	assert.equal(
		checkWriteGate({ toolName: "memory_delete", lastUserText: "把这段记下来", creationMode: "ask" }).allow,
		false,
		"写入词不得放行删除工具",
	);
	assert.ok(DELETE_REQUEST_RE.test("忘掉"));
});

test("门禁：memory_add 认写入信号；silent 档不拦；读不到用户原文宁拦勿写", () => {
	for (const say of ["记住这个设定", "把这段存进记忆库", "牢记这一点", "remember this"]) {
		assert.equal(checkWriteGate({ toolName: "memory_add", lastUserText: say, creationMode: "ask" }).allow, true, say);
	}
	assert.equal(checkWriteGate({ toolName: "memory_add", lastUserText: "我们继续走", creationMode: "ask" }).allow, false);
	assert.equal(checkWriteGate({ toolName: "memory_add", lastUserText: "我们继续走", creationMode: "silent" }).allow, true);
	assert.equal(checkWriteGate({ toolName: "memory_add", lastUserText: "", creationMode: "ask" }).allow, false);
});

test("门禁拦下时服务层根本不该被调到（写与删都是）", async () => {
	let added = 0;
	let deleted = 0;
	const d = deps({
		addMemory: async () => {
			added++;
			return { added: 1, total: 1, chunks: 1 };
		},
		deleteMemory: () => {
			deleted++;
			return true;
		},
		gate: () => ({ lastUserText: "我们继续赶路", creationMode: "ask" }),
	});

	const w = await memoryAdd.run({ text: "一段足够长的内容。" }, d, stageCtx);
	assert.equal(added, 0, "被拦就不该碰服务层");
	assert.match(w.text, /需用户明确要求/);
	assert.match(String(w.activity), /门禁拦下/);

	const del = await memoryDelete.run({ id: "abc" }, d, stageCtx);
	assert.equal(deleted, 0);
	assert.match(del.text, /删除已拒绝|需用户明确要求/);
	assert.match(del.text, /不要删/, "删除的拦下话术要指向「绕开它继续演」而非「等确认」");
});

// ---------------- memory_add / memory_list 行为 ----------------

test("memory_add：缺参/服务层抛错/重复内容都回可读文本，不抛", async () => {
	const d = deps({ addMemory: async () => ({ added: 1, total: 1, chunks: 1 }), gate: () => ASK_WRITE });
	assert.match((await memoryAdd.run({}, d, stageCtx)).text, /缺少 text/);

	const boom = await memoryAdd.run(
		{ text: "内容" },
		deps({
			addMemory: async () => {
				throw new Error("请先启用向量记忆");
			},
			gate: () => ASK_WRITE,
		}),
		stageCtx,
	);
	assert.match(boom.text, /请先启用向量记忆/, "服务层的原因要原样转给模型");

	const dup = await memoryAdd.run(
		{ text: "内容" },
		deps({ addMemory: async () => ({ added: 0, total: 3, chunks: 1 }), gate: () => ASK_WRITE }),
		stageCtx,
	);
	assert.match(dup.text, /已在记忆库中/);
	assert.match(String(dup.activity), /重复跳过/);
});

test("memory_list：只给目录不给正文；标出来源；截断要说出来（不得静默封顶）", async () => {
	const many = Array.from({ length: 25 }, (_, i) => ({
		id: `id${i}`,
		text: `第 ${i} 条的开头。${"正文尾部不该出现在目录里。".repeat(8)}`,
		meta: { source: "manual" as const, title: `条目${i}` },
	}));
	const d = deps({ listMemory: () => many });

	const r = await memoryList.run({}, d, stageCtx);
	assert.match(r.text, /20\/25 条/, "默认封顶 20");
	assert.match(r.text, /其余 5 条未列出/, "静默截断会让模型以为库里就这些");
	assert.match(r.text, /\[id0\]/, "编号要给出来，否则 delete 无从取");
	assert.match(r.text, /手动录入/, "来源标签要可读");
	assert.match(r.text, /第 0 条的开头。/, "预览要给开头");
	assert.match(r.text, /…/, "超长正文要截断");
	assert.ok(
		!r.text.includes("正文尾部不该出现在目录里。正文尾部不该出现在目录里。正文尾部不该出现在目录里。"),
		"列举只给预览，正文归 memory_search",
	);

	// keyword 过滤 / 空库 / limit 钳制
	assert.match((await memoryList.run({ keyword: "条目7" }, d, stageCtx)).text, /1\/1 条/);
	assert.match((await memoryList.run({ keyword: "不存在" }, d, stageCtx)).text, /无含「不存在」的条目/);
	assert.match((await memoryList.run({}, deps({ listMemory: () => [] }), stageCtx)).text, /是空的/);
	assert.match((await memoryList.run({ limit: 999 }, d, stageCtx)).text, /25\/25 条/, "上钳 60，够列完 25 条");

	// narrative 库要用剧情库的名字，别把两库混为一谈
	const narr = await memoryList.run(
		{ store: "narrative" },
		deps({ listMemory: (s) => (s === "narrative" ? [{ id: "n1", text: "第一夜的剧情摘要内容。", meta: { source: "narrative" } }] : []) }),
		stageCtx,
	);
	assert.match(narr.text, /剧情库/);
	assert.match(narr.text, /剧情摘要/);
});

test("依赖缺失时明确说不支持（而不是假装成功）", async () => {
	assert.match((await memoryAdd.run({ text: "x" }, deps(), stageCtx)).text, /不支持/);
	assert.match((await memoryList.run({}, deps(), stageCtx)).text, /不支持/);
	assert.match((await memoryDelete.run({ id: "a" }, deps(), stageCtx)).text, /不支持/);
});
