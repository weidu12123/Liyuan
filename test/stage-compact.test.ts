import assert from "node:assert/strict";
import { test } from "node:test";

import { activeSummary, rebuildHistory, SUMMARY_ENTRY_TYPE, type BranchEntryLike } from "../src/stage/assemble.ts";
import {
	KEEP_RECENT_BEATS,
	planCompaction,
	runCompaction,
	serializeForSummary,
	type CompactRunDeps,
} from "../src/stage/compact.ts";
import { defaultState } from "../src/state.ts";

// ---------------- 造树 ----------------

let seq = 0;
const userE = (text: string, id = `u${++seq}`): BranchEntryLike => ({
	id,
	type: "message",
	message: { role: "user", content: [{ type: "text", text }] },
});
const asstE = (text: string, id = `a${++seq}`): BranchEntryLike => ({
	id,
	type: "message",
	message: { role: "assistant", content: [{ type: "text", text }] },
});
const summaryE = (summary: string, coversThroughId: string, id = `s${++seq}`): BranchEntryLike => ({
	id,
	type: "custom",
	customType: SUMMARY_ENTRY_TYPE,
	data: { summary, coversThroughId },
});

/** N 拍的分支，每拍 user + assistant；正文足够长以过字数地板（3 拍即可越过 MIN_COMPACT_CHARS） */
const beats = (n: number, chars = 800): BranchEntryLike[] => {
	const out: BranchEntryLike[] = [];
	for (let i = 1; i <= n; i++) {
		out.push(userE(`第 ${i} 拍我说的话。`, `u-${i}`));
		out.push(asstE(`第 ${i} 拍的正文。${"云".repeat(chars)}`, `a-${i}`));
	}
	return out;
};

// ---------------- 读侧：摘要回读 ----------------

test("activeSummary：取最后一条 rp-summary，cut 到锚点之后", () => {
	const branch = [...beats(3)];
	branch.push(summaryE("【前情】头三拍。", "a-2"));
	const active = activeSummary(branch);
	assert.ok(active);
	assert.equal(active.summary, "【前情】头三拍。");
	// 锚点 a-2 在 index 3 → cut=4（u-1..a-2 共 4 条被覆盖）
	assert.equal(active.cut, 4);
});

test("rebuildHistory：被摘要覆盖的早期条目整段不进历史，改由 summary 回读", () => {
	const branch = [...beats(3)];
	branch.push(summaryE("【前情】头两拍发生的事。", "a-2"));
	const { history, summary } = rebuildHistory(branch);

	assert.equal(summary, "【前情】头两拍发生的事。");
	const text = history.map((m) => m.text).join("\n");
	assert.ok(!text.includes("第 1 拍"), "被覆盖的第 1 拍不该进历史");
	assert.ok(!text.includes("第 2 拍"), "被覆盖的第 2 拍不该进历史");
	assert.ok(text.includes("第 3 拍"), "保留区的第 3 拍必须还在");
});

test("rebuildHistory：多份摘要时后者全覆盖前者（合并语义）", () => {
	const branch = [...beats(5)];
	branch.push(summaryE("旧摘要：1-2 拍。", "a-2"));
	branch.push(userE("第 6 拍我说的话。", "u-6"));
	branch.push(asstE("第 6 拍的正文。", "a-6"));
	branch.push(summaryE("新摘要：1-4 拍（已并入旧摘要）。", "a-4"));

	const { history, summary } = rebuildHistory(branch);
	assert.equal(summary, "新摘要：1-4 拍（已并入旧摘要）。");
	const text = history.map((m) => m.text).join("\n");
	assert.ok(!text.includes("第 4 拍"), "新摘要覆盖到第 4 拍");
	assert.ok(text.includes("第 5 拍") && text.includes("第 6 拍"), "第 5、6 拍保留");
});

test("rebuildHistory：兼容旧会话 pi 的 compaction 条目（firstKeptEntryId 语义）", () => {
	const branch: BranchEntryLike[] = [...beats(3)];
	branch.push({
		id: "c1",
		type: "compaction",
		// pi 的形状：summary + firstKeptEntryId（保留区从该条**开始**）
		...({ summary: "pi 写的旧摘要。", firstKeptEntryId: "u-3" } as object),
	} as BranchEntryLike);
	const { history, summary } = rebuildHistory(branch);
	assert.equal(summary, "pi 写的旧摘要。");
	const text = history.map((m) => m.text).join("\n");
	assert.ok(!text.includes("第 1 拍") && !text.includes("第 2 拍"));
	assert.ok(text.includes("第 3 拍"), "firstKeptEntryId 那条起保留");
});

test("rebuildHistory：锚点丢失（异常树）时退守到摘要条目之前，不炸不空", () => {
	const branch = [...beats(2)];
	branch.push(summaryE("摘要。", "不存在的-id"));
	const { history, summary } = rebuildHistory(branch);
	assert.equal(summary, "摘要。");
	assert.equal(history.length, 0, "退守 = 摘要之前全覆盖");
});

test("无摘要的分支：summary 为 undefined，历史照旧全在", () => {
	const { history, summary } = rebuildHistory(beats(2));
	assert.equal(summary, undefined);
	assert.equal(history.length, 4);
});

// ---------------- 判定：切点与门槛 ----------------

test("planCompaction：未攒够拍数不压缩", () => {
	const plan = planCompaction(beats(KEEP_RECENT_BEATS + 1), {
		everyNTurns: 3,
		userName: "沈舟",
		charName: "云澜",
	});
	assert.equal(plan, null, "保留 6 拍 + 周期 3 = 至少 9 拍才压");
});

test("planCompaction：攒够则切在「最近 KEEP_RECENT 拍」之前", () => {
	const branch = beats(10);
	const plan = planCompaction(branch, { everyNTurns: 3, userName: "沈舟", charName: "云澜" });
	assert.ok(plan);
	// 10 拍，保留 6 → 覆盖前 4 拍，锚点是第 4 拍的 assistant
	assert.equal(plan.turns, 4);
	assert.equal(plan.coversThroughId, "a-4");
	assert.ok(plan.conversationText.includes("第 4 拍"));
	assert.ok(!plan.conversationText.includes("第 5 拍"), "保留区不进摘要输入");
	assert.equal(plan.previousSummary, undefined);
});

test("planCompaction：可裁正文太短则不烧旁路调用", () => {
	const plan = planCompaction(beats(10, 1), {
		everyNTurns: 3,
		userName: "沈舟",
		charName: "云澜",
		minChars: 5000,
	});
	assert.equal(plan, null);
});

test("planCompaction：everyNTurns<=0 = 关闭主动压缩", () => {
	const plan = planCompaction(beats(30), { everyNTurns: 0, userName: "沈舟", charName: "云澜" });
	assert.equal(plan, null);
});

test("planCompaction：二次压缩只算「活着的」拍，并带上一份摘要合并", () => {
	const branch = [...beats(12)];
	branch.push(summaryE("旧摘要：1-6 拍。", "a-6"));
	// 活着的 = 7..12 共 6 拍；保留 6 → 还差周期，不该压
	assert.equal(
		planCompaction(branch, { everyNTurns: 3, userName: "沈舟", charName: "云澜" }),
		null,
		"摘要之后的拍数没攒够就不该二次压缩",
	);

	// 再演 3 拍 → 活着的 9 拍，可压 3 拍
	branch.push(...beats(3).map((e, i) => ({ ...e, id: `${e.id}-x${i}` })));
	const plan = planCompaction(branch, { everyNTurns: 3, userName: "沈舟", charName: "云澜" });
	assert.ok(plan);
	assert.equal(plan.previousSummary, "旧摘要：1-6 拍。", "上一份摘要要合并进本次");
	assert.ok(plan.conversationText.includes("第 7 拍"), "从上次覆盖点之后接着摘");
	assert.ok(!plan.conversationText.includes("第 6 拍"), "已被覆盖的不重复摘");
});

test("serializeForSummary：剔掉区间内的旧摘要条目，正文不被误裁", () => {
	// 回归：旧 rp-summary 落在待摘区间内，其锚点已不在区间里——
	// 若不剔除，rebuildHistory 会「退守到摘要之前全裁」，把要摘的正文全丢掉。
	const region: BranchEntryLike[] = [
		summaryE("更早的摘要。", "早已被裁走的-id"),
		userE("区间里我说的话。", "u-x"),
		asstE("区间里的正文。", "a-x"),
	];
	const text = serializeForSummary(region, "沈舟", "云澜");
	assert.ok(text.includes("区间里我说的话"), "正文必须还在");
	assert.ok(text.includes("区间里的正文"));
	assert.ok(!text.includes("更早的摘要"), "旧摘要不混进对话原文（走 previousSummary）");
});

test("serializeForSummary：补丁已套用（摘要读到的与模型读到的同源）", () => {
	const region: BranchEntryLike[] = [
		userE("我说的话。", "u-p"),
		asstE("袖口沾着晨露。", "a-p"),
		{ id: "op1", type: "custom_message", customType: "rp-draft-op", content: JSON.stringify({ old: "晨露", new: "夜霜" }) },
	];
	const text = serializeForSummary(region, "沈舟", "云澜");
	assert.ok(text.includes("夜霜"), "补丁后的定稿进摘要");
	assert.ok(!text.includes("晨露"), "初稿原文不进摘要");
});

// ---------------- 执行：落树 / 归档 / 叶守卫 ----------------

const makeDeps = (
	over: Partial<CompactRunDeps> & { resp?: string | { error: string } } = {},
): CompactRunDeps & { appended: unknown[]; archived: string[] } => {
	const appended: unknown[] = [];
	const archived: string[] = [];
	return {
		appended,
		archived,
		sideText: async () => over.resp ?? "## 前情提要\n三拍剧情。",
		appendSummaryEntry: (data) => appended.push(data),
		getLeafId: () => "leaf-1",
		archive: async (t) => void archived.push(t),
		...(over.sideText ? { sideText: over.sideText } : {}),
		...(over.getLeafId ? { getLeafId: over.getLeafId } : {}),
		...(over.archive !== undefined ? { archive: over.archive } : {}),
	} as CompactRunDeps & { appended: unknown[]; archived: string[] };
};

const input = (branch: BranchEntryLike[], everyNTurns = 3) => ({
	branch,
	state: defaultState(),
	language: "中文",
	userName: "沈舟",
	charName: "云澜",
	everyNTurns,
});

test("runCompaction：落 rp-summary 快照 + 归档被裁正文", async () => {
	const deps = makeDeps();
	const r = await runCompaction(deps, input(beats(10)));

	assert.equal(r.kind, "compacted");
	assert.equal(deps.appended.length, 1);
	const data = deps.appended[0] as { summary: string; coversThroughId: string; turns: number };
	assert.equal(data.coversThroughId, "a-4");
	assert.equal(data.turns, 4);
	assert.ok(data.summary.includes("前情提要"));
	assert.equal(deps.archived.length, 1, "被裁正文必须先归档（细节召回靠它）");
	assert.ok(deps.archived[0].includes("第 1 拍"));
});

test("runCompaction：未到期 = skipped，不落树不归档", async () => {
	const deps = makeDeps();
	const r = await runCompaction(deps, input(beats(4)));
	assert.equal(r.kind, "skipped");
	assert.equal(deps.appended.length, 0);
	assert.equal(deps.archived.length, 0);
});

test("runCompaction：叶守卫——调用期间切分支则整体丢弃（R9）", async () => {
	let leaf = "leaf-1";
	const deps = makeDeps({
		sideText: async () => {
			leaf = "leaf-2"; // 模拟调用期间 swipe/rewind
			return "## 前情提要\n摘要。";
		},
		getLeafId: () => leaf,
	});
	const r = await runCompaction(deps, input(beats(10)));
	assert.equal(r.kind, "stale");
	assert.equal(deps.appended.length, 0, "摘要绝不能落到导航后的分支上");
});

test("runCompaction：旁路调用失败/空摘要 → failed，正文不受影响", async () => {
	const bad = await runCompaction(makeDeps({ resp: { error: "429" } }), input(beats(10)));
	assert.equal(bad.kind, "failed");

	const empty = await runCompaction(makeDeps({ resp: "   " }), input(beats(10)));
	assert.equal(empty.kind, "failed");
});

test("runCompaction：归档失败不挡压缩（连续性优先于细节召回）", async () => {
	const deps = makeDeps({
		archive: async () => {
			throw new Error("embed 服务挂了");
		},
	});
	const r = await runCompaction(deps, input(beats(10)));
	assert.equal(r.kind, "compacted");
	assert.equal(deps.appended.length, 1);
});

test("planCompaction：everyNTurns=0 时，上下文吃紧可被动触发；未吃紧不触发", () => {
	const branch = beats(10);
	const calm = planCompaction(branch, {
		everyNTurns: 0,
		userName: "沈舟",
		charName: "云澜",
		contextPressure: { usedTokens: 60000, contextWindow: 128000 },
	});
	assert.equal(calm, null, "未到窗口阈值时不触发被动压缩");

	const tight = planCompaction(branch, {
		everyNTurns: 0,
		userName: "沈舟",
		charName: "云澜",
		contextPressure: { usedTokens: 115000, contextWindow: 128000 },
	});
	assert.ok(tight, "超过 128000 - 16384 阈值时应被动触发压缩");
	assert.equal(tight.turns, 4, "10 拍留 6 拍，压前 4 拍");
});

test("planCompaction：超长文不足 KEEP_RECENT_BEATS+1 拍时，被动吃紧退让保留拍数防死锁", () => {
	const branch = beats(4, 3000);
	const plan = planCompaction(branch, {
		everyNTurns: 30,
		userName: "沈舟",
		charName: "云澜",
		contextPressure: { usedTokens: 120000, contextWindow: 128000 },
	});
	assert.ok(plan, "仅 4 拍但上下文吃紧时应退让保留拍数并压出前 1 拍");
	assert.equal(plan.turns, 1);
	assert.equal(plan.coversThroughId, "a-1");
});

test("planCompaction：导入对话的 rp-import 条目计入叙事拍边界", () => {
	const branch: BranchEntryLike[] = [];
	for (let i = 1; i <= 8; i++) {
		branch.push({ id: `iu-${i}`, type: "custom_message", customType: "rp-import", content: `导入第 ${i} 拍用户输入。` });
		branch.push({ id: `ia-${i}`, type: "custom_message", customType: "rp-edited-reply", content: `导入第 ${i} 拍正文。${"风".repeat(1200)}` });
	}
	const plan = planCompaction(branch, {
		everyNTurns: 2,
		userName: "沈舟",
		charName: "云澜",
	});
	assert.ok(plan, "8 拍导入对话满足 keep(6) + everyNTurns(2) 应触发压缩");
	assert.equal(plan.turns, 2);
	assert.equal(plan.coversThroughId, "ia-2");
});

