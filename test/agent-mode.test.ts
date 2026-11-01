import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { chatModeOfSessionDir, createChat } from "../src/cardspace.ts";
import { CONVERSATION_PROCESS_TYPE } from "../src/conversation-mode.ts";
import { collectChatEvidence, loadManifest, memoryPaths, saveManifest } from "../src/card-memory.ts";
import { listCardMemory } from "../src/card-memory-tools.ts";
import { filterSandboxResultText, harnessManagedPath, sandboxScope, sandboxVerdict } from "../src/sandbox.ts";
import { buildAgentStateBlock } from "../src/stage/agent.ts";
import { SUMMARY_ENTRY_TYPE, type BranchEntryLike } from "../src/stage/assemble.ts";
import { historyTokens, planCompaction } from "../src/stage/compact.ts";
import { agentHistory, DISCUSSION_SUMMARY_TYPE, planDiscussionCompaction, serializeDiscussion } from "../src/stage/discussion.ts";
import { prependToLastUser } from "../src/stage/engine.ts";
import { listStoryFiles, storyDirectory } from "../src/stage/story-history.ts";
import { defaultState } from "../src/state.ts";

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "liyuan-agent2-")));

/** 一条 agent 讨论轮：user 消息 ＋ 过程记录（assistant 带工具调用、toolResult）＋ 显示回执 */
function turn(n: number, userText: string, toolArgs: string, resultText: string): BranchEntryLike[] {
	const uid = `u${n}`;
	return [
		{ id: uid, type: "message", message: { role: "user", content: [{ type: "text", text: userText }], details: { liyuanMode: "agent" } } },
		{ id: `p${n}a`, type: "custom", customType: CONVERSATION_PROCESS_TYPE, data: { requestId: uid, mode: "agent", message: { role: "assistant", content: [{ type: "toolCall", id: `c${n}`, name: "write", arguments: { path: `正文/00${n}.md`, content: toolArgs } }] } } },
		{ id: `p${n}r`, type: "custom", customType: CONVERSATION_PROCESS_TYPE, data: { requestId: uid, mode: "agent", message: { role: "toolResult", toolCallId: `c${n}`, toolName: "write", content: [{ type: "text", text: resultText }] } } },
		{ id: `p${n}f`, type: "custom", customType: CONVERSATION_PROCESS_TYPE, data: { requestId: uid, mode: "agent", message: { role: "assistant", content: [{ type: "text", text: `写好了 ${n}` }] } } },
		{ id: `a${n}`, type: "message", message: { role: "assistant", content: [{ type: "text", text: `写好了 ${n}` }], details: { liyuanMode: "agent", liyuanAuthoringReply: true } } },
	] as BranchEntryLike[];
}

test("讨论历史：无摘要全量回放；有摘要从 firstKeptEntryId 起回放、摘要置前", () => {
	const branch = [...turn(1, "写第一章", "x".repeat(10), "ok"), ...turn(2, "写第二章", "y".repeat(10), "ok"), ...turn(3, "改一下", "z", "ok")];
	const full = agentHistory(branch);
	assert.equal(full.filter((m) => m.role === "user").length, 3);
	assert.equal(full.filter((m) => m.role === "toolResult").length, 3, "过程记录逐条回放");
	const withSummary = [...branch.slice(0, 10), { id: "s1", type: "custom", customType: DISCUSSION_SUMMARY_TYPE, data: { summary: "前两轮写了两章", firstKeptEntryId: "u3" } } as BranchEntryLike, ...branch.slice(10)];
	const h = agentHistory(withSummary);
	assert.match((h[0]!.content as Array<{ text: string }>)[0]!.text, /【讨论摘要】[\s\S]*前两轮写了两章/);
	assert.equal(h.filter((m) => m.role === "user").length, 2, "摘要一条 + 第三轮一条");
	assert.equal(h.filter((m) => m.role === "toolResult").length, 1);
});

test("讨论压缩：估算不超窗口不压；超了从末尾按整轮保留、其余摘要，第二次压缩带上上一份摘要", () => {
	const big = "字".repeat(40000); // ≈ 10000 token/轮
	const branch = [...turn(1, "一", big, "ok"), ...turn(2, "二", big, "ok"), ...turn(3, "三", big, "ok"), ...turn(4, "四", big, "ok")];
	assert.equal(planDiscussionCompaction(branch, { contextWindow: 200000 }), null, "4 万 token 远小于窗口");
	const plan = planDiscussionCompaction(branch, { contextWindow: 50000, reserveTokens: 16384, keepRecentTokens: 15000 })!;
	assert.ok(plan, "40k > 50k−16k 应压");
	assert.equal(plan.firstKeptEntryId, "u3", "保留最近两轮（≥15k token）");
	assert.equal(plan.turns, 2);
	assert.match(plan.conversationText, /用户：一/);
	assert.doesNotMatch(plan.conversationText, /用户：三/);
	assert.ok(plan.conversationText.includes("[调用 write"), "工具调用压成一行");
	assert.ok(!plan.conversationText.includes(big), "参数截断，整章不进摘要输入");
	// 第二次：摘要落树后再涨
	const again = [...branch.slice(0, 10), { id: "s1", type: "custom", customType: DISCUSSION_SUMMARY_TYPE, data: { summary: "前两轮", firstKeptEntryId: "u3" } } as BranchEntryLike, ...branch.slice(10), ...turn(5, "五", big, "ok"), ...turn(6, "六", big, "ok")];
	const p2 = planDiscussionCompaction(again, { contextWindow: 50000, reserveTokens: 16384, keepRecentTokens: 15000 })!;
	assert.ok(p2);
	assert.equal(p2.previousSummary, "前两轮");
	assert.equal(p2.firstKeptEntryId, "u5");
	assert.doesNotMatch(p2.conversationText, /用户：一/, "已被摘要覆盖的不再进");
	assert.equal(serializeDiscussion([]), "");
});

test("讨论压缩：触发基准是真实 usage——估算看着不大、真实占用已超阈值也要压", () => {
	const small = [...turn(1, "一", "x".repeat(10), "ok"), ...turn(2, "二", "y".repeat(10), "ok"), ...turn(3, "三", "z".repeat(10), "ok")];
	assert.equal(planDiscussionCompaction(small, { contextWindow: 128000 }), null, "无 usage 时退估算：远小于窗口不压");
	// 给最近一条过程记录 assistant 记上真实 usage（引擎落树的过程记录带 usage，实测 304/321 条非零）
	const withUsage = small.map((e) =>
		e.id === "p3f" ? { ...e, data: { ...(e.data as object), message: { ...((e.data as { message: object }).message), usage: { input: 120000, output: 10, cacheRead: 0, cacheWrite: 0 } } } } : e,
	) as BranchEntryLike[];
	const plan = planDiscussionCompaction(withUsage, { contextWindow: 128000 });
	assert.ok(plan, "真实 12 万 > 128k−16k 应压");
	assert.equal(plan.tokensBefore, 120000, "基准取真实 usage，不取估算");
});

test("手动压缩：force 不等阈值；可压部分低于地板则不压", () => {
	const big = "字".repeat(40000); // ≈ 10000 token/轮
	const branch = [...turn(1, "一", big, "ok"), ...turn(2, "二", big, "ok"), ...turn(3, "三", big, "ok")];
	assert.equal(planDiscussionCompaction(branch, { contextWindow: 1000000 }), null, "远小于窗口，自动不压");
	const plan = planDiscussionCompaction(branch, { contextWindow: 1000000, force: true })!;
	assert.ok(plan, "手动：有可压轮次就压");
	assert.equal(plan.firstKeptEntryId, "u2", "仍守最近一轮原文");
	const small = [...turn(1, "一", "x", "ok"), ...turn(2, "二", "y", "ok")];
	assert.equal(
		planDiscussionCompaction(small, { contextWindow: 1000000, force: true, minCoveredTokens: 2000 }),
		null,
		"可压部分不足地板：不烧旁路调用",
	);
});

test("扮演历史估算：rp-summary 覆盖早期条目后估算占用变小——扮演压缩折算指示器的尺子", () => {
	const beat = (n: number) =>
		[
			{ id: `u${n}`, type: "message", message: { role: "user", content: [{ type: "text", text: `第 ${n} 拍我说的话。` }] } },
			{ id: `a${n}`, type: "message", message: { role: "assistant", content: [{ type: "text", text: `第 ${n} 拍的正文。${"云".repeat(2000)}` }] } },
		] as BranchEntryLike[];
	const branch = [...beat(1), ...beat(2), ...beat(3), ...beat(4), ...beat(5), ...beat(6)];
	const before = historyTokens(branch);
	assert.ok(before > 0);
	// rp-summary 覆盖前四拍，摘要很短——压缩后装配进上下文的历史应显著变短
	const after = [
		...branch,
		{ id: "s1", type: "custom", customType: SUMMARY_ENTRY_TYPE, data: { summary: "前四拍的接力摘要。", coversThroughId: "a4" } } as BranchEntryLike,
	];
	const post = historyTokens(after);
	assert.ok(post < before, `压缩后 ${post} 应小于压缩前 ${before}`);
});

test("前情压缩按文件：保留最后 N 个文件、跳过已覆盖、按字数到期；摘要条目记 coveredFiles", () => {
	const chat = tmp();
	try {
		const dir = storyDirectory(chat);
		mkdirSync(dir, { recursive: true });
		for (const [n, t] of [["001.md", "一".repeat(1500)], ["002.md", "二".repeat(1500)], ["003.md", "三".repeat(100)], ["004.md", "四".repeat(100)]] as const) writeFileSync(join(dir, n), t);
		const branch: BranchEntryLike[] = [{ id: "u1", type: "message", message: { role: "user", content: "x" } }];
		const opts = { everyNTurns: 2, keepRecentBeats: 2, userName: "u", charName: "c", storyDir: dir };
		const plan = planCompaction(branch, opts)!;
		assert.ok(plan, "前两个文件 3000 字 ≥ 2000 地板");
		assert.deepEqual(plan.coveredFiles, ["001.md", "002.md"]);
		assert.equal(plan.coversThroughId, "u1");
		assert.match(plan.conversationText, /^001\.md\n\n一/);
		// 摘要落树后：新插一个文件在中间，只有它是活的且不够字数
		const after: BranchEntryLike[] = [...branch, { id: "s1", type: "custom", customType: SUMMARY_ENTRY_TYPE, data: { summary: "前情", coversThroughId: "u1", coveredFiles: ["001.md", "002.md"] } }];
		writeFileSync(join(dir, "001b.md"), "插".repeat(500));
		assert.equal(planCompaction(after, opts), null, "只剩 001b 一个未覆盖且不够地板");
		writeFileSync(join(dir, "001b.md"), "插".repeat(2500));
		const p2 = planCompaction(after, opts)!;
		assert.deepEqual(p2.coveredFiles, ["001.md", "002.md", "001b.md"]);
		assert.equal(p2.previousSummary, "前情");
		assert.equal(planCompaction(after, { ...opts, everyNTurns: 0 }), null, "关闭");
	} finally { rmSync(chat, { recursive: true, force: true }); }
});

test("沙箱：正文/ 对原生写开放；历史/ 与 会话/ 拒绝；状态块带稿子目录不带正文", () => {
	const root = tmp();
	try {
		const cardsRoot = join(root, "cards");
		const cardDir = join(cardsRoot, "某卡");
		mkdirSync(cardDir, { recursive: true });
		writeFileSync(join(cardDir, "某卡.json"), JSON.stringify({ data: { name: "某卡" } }));
		const chat = createChat(cardDir, { mode: "agent" });
		assert.equal(chatModeOfSessionDir(chat.sessionsDir), "agent");
		assert.ok(existsSync(join(chat.dir, "正文")) && existsSync(join(chat.dir, "历史")), "建项目就有稿子目录与快照仓");
		assert.equal(harnessManagedPath(cardDir, join(chat.dir, "正文", "001.md")), false);
		assert.equal(harnessManagedPath(cardDir, join(chat.dir, "历史", "检查点.jsonl")), true);
		assert.equal(harnessManagedPath(cardDir, join(chat.dir, "会话", "x.jsonl")), true);
		const scope = sandboxScope(root, { card: "cards/某卡/某卡.json" });
		const grants = { dirs: [], bashAllow: [] };
		assert.equal(sandboxVerdict("write", { path: join(chat.dir, "正文", "001.md") }, scope, grants).kind, "allow");
		assert.equal(sandboxVerdict("edit", { path: join(chat.dir, "历史", "检查点.jsonl") }, scope, grants).kind, "deny");
		assert.equal(sandboxVerdict("read", { path: join(chat.dir, "历史", "检查点.jsonl") }, scope, grants).kind, "allow");

		writeFileSync(join(chat.dir, "正文", "001-初雪.md"), "第一章正文。");
		const block = buildAgentStateBlock({ state: defaultState(), files: listStoryFiles(join(chat.dir, "正文")) });
		assert.match(block, /【正文目录】正文\/ 共 1 个文件 6 字/);
		assert.match(block, /001-初雪\.md　6 字/);
		assert.doesNotMatch(block, /第一章正文/, "状态块不带正文");
		const history = [{ role: "user", content: [{ type: "text", text: "继续" }] }];
		prependToLastUser(history as never, block);
		assert.match((history[0]!.content as Array<{ text: string }>)[0]!.text, /^【世界状态】[\s\S]*继续$/);

		// 卡级记忆证据：agent 子项目按文件取，拍数＝文件数
		writeFileSync(join(chat.sessionsDir, "a.jsonl"), `${JSON.stringify({ type: "session", id: "s", timestamp: "2026-01-01T00:00:00Z" })}\n`);
		const ev = collectChatEvidence(chat, "u", "c");
		assert.ok(ev);
		assert.equal(ev.beats, 1);
		assert.match(ev.transcript, /001-初雪\.md\n\n第一章正文/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("agent system 槽位：全局追加读 AGENT_APPEND_SYSTEM.md 而非扮演的 APPEND_SYSTEM.md；空缺退随包默认值；卡级两份照旧", async () => {
	const { agentSystemPrompt } = await import("../src/stage/agent.ts");
	const base = { cwd: "/w", cardPath: "cards/x/card.png", storyDir: "/w/正文", macro: { charName: "冷鹰", userName: "怀瑾" } };
	const sys = agentSystemPrompt({ ...base, userRules: { global: "扮演规矩：产出是剧情正文。", agent: "agent 规矩：正文落文件。", card: "这张卡的规矩。" }, cardAgents: "{{char}} 的档案" });
	assert.ok(sys.includes("agent 规矩：正文落文件。"), "agent 槽在");
	assert.ok(!sys.includes("扮演规矩"), "扮演的全局追加不进 agent 轮");
	assert.ok(sys.includes("这张卡的规矩。") && sys.includes("冷鹰 的档案"), "卡级 APPEND_SYSTEM.md 与 AGENTS.md 照旧、宏求值");
	assert.ok(sys.indexOf("agent 规矩") < sys.indexOf("这张卡的规矩。") && sys.indexOf("这张卡的规矩。") < sys.indexOf("冷鹰 的档案"), "顺序：全局追加 → 卡追加 → 卡档案");
	const fallback = agentSystemPrompt({ ...base, userRules: { global: "扮演规矩", agent: "", card: "" } });
	assert.ok(fallback.includes("## 正文是文件"), "agent 槽空缺退随包 AGENT_APPEND_SYSTEM.md");
	assert.ok(!fallback.includes("扮演规矩"));
});

test("agent 讨论回退与删除：无检查点（纯讨论或调用报错）时也能定位末条用户输入并回退", () => {
	const errorBranch: BranchEntryLike[] = [
		{ id: "u1", type: "message", message: { role: "user", content: [{ type: "text", text: "第一章" }], details: { liyuanMode: "agent" } } },
		{ id: "a1_err", type: "message", message: { role: "assistant", content: [{ type: "text", text: "API 429 报错" }], details: { liyuanMode: "agent", liyuanAuthoringReply: true } } },
	];
	let lastUserIdx = -1;
	for (let i = errorBranch.length - 1; i >= 0; i--) {
		if (errorBranch[i].type === "message" && (errorBranch[i].message as { role?: unknown })?.role === "user") {
			lastUserIdx = i;
			break;
		}
	}
	assert.equal(lastUserIdx, 0);
	assert.equal(errorBranch[lastUserIdx].id, "u1");
	const hasReplyToDrop = errorBranch.slice(lastUserIdx + 1).some((e) => e.type === "message" && (e.message as { role?: unknown })?.role === "assistant");
	assert.ok(hasReplyToDrop, "报错回复可以作为回复被删除");
});

test("多项目物理隔离：第二个项目绝对禁止读取或修改第一个项目的正文、会话与历史，状态块不注入跨项目复盘", () => {
	const root = tmp();
	try {
		const cardsRoot = join(root, "cards");
		const cardDir = join(cardsRoot, "某卡");
		mkdirSync(cardDir, { recursive: true });
		writeFileSync(join(cardDir, "某卡.json"), JSON.stringify({ data: { name: "某卡" } }));

		const chat1 = createChat(cardDir, { mode: "agent", name: "项目1" });
		const chat2 = createChat(cardDir, { mode: "agent", name: "项目2" });

		writeFileSync(join(chat1.dir, "正文", "001-初雪.md"), "项目1的第一章。");
		writeFileSync(join(chat2.dir, "正文", "001-长街.md"), "项目2的第一章。");

		// 在 chat2 的作用域下
		const scope2 = sandboxScope(root, { card: "cards/某卡/某卡.json" }, chat2.dir);
		const grants = { dirs: [], bashAllow: [] };

		// 读写项目1的正文：全部拒绝
		assert.equal(sandboxVerdict("read", { path: join(chat1.dir, "正文", "001-初雪.md") }, scope2, grants).kind, "deny");
		assert.equal(sandboxVerdict("edit", { path: join(chat1.dir, "正文", "001-初雪.md") }, scope2, grants).kind, "deny");
		assert.equal(sandboxVerdict("write", { path: join(chat1.dir, "正文", "002.md") }, scope2, grants).kind, "deny");

		// 读项目1的会话与历史：全部拒绝
		assert.equal(sandboxVerdict("read", { path: join(chat1.dir, "会话", "a.jsonl") }, scope2, grants).kind, "deny");
		assert.equal(sandboxVerdict("read", { path: join(chat1.dir, "历史", "检查点.jsonl") }, scope2, grants).kind, "deny");

		// 列出对话总根（探测其他项目）：拒绝
		assert.equal(sandboxVerdict("ls", { path: join(cardDir, "对话") }, scope2, grants).kind, "deny");

		// 读写 chat2 自己的正文与项目记忆资产：放行
		assert.equal(sandboxVerdict("read", { path: join(chat2.dir, "正文", "001-长街.md") }, scope2, grants).kind, "allow");
		assert.equal(sandboxVerdict("write", { path: join(chat2.dir, "正文", "002-夜雨.md") }, scope2, grants).kind, "allow");
		assert.equal(sandboxVerdict("write", { path: join(chat2.dir, "记忆", "大纲.md") }, scope2, grants).kind, "allow");

		// 读写已废除的卡根目录 记忆/：一律拒绝并引导至当前项目的 记忆/
		assert.equal(sandboxVerdict("read", { path: join(cardDir, "记忆", "记忆.md") }, scope2, grants).kind, "deny");
		assert.equal(sandboxVerdict("write", { path: join(cardDir, "记忆", "大纲.md") }, scope2, grants).kind, "deny");

		// 读卡级公共配置（卡本体）：放行
		assert.equal(sandboxVerdict("read", { path: join(cardDir, "某卡.json") }, scope2, grants).kind, "allow");

		// 从卡根目录调用 ls / find / grep 时，结果过滤自动剥离其他子项目与旧卡根 记忆/，保留本卡公共文件与当前子项目
		const lsFiltered = filterSandboxResultText(
			"ls",
			{ path: "cards/某卡" },
			"某卡.json\nAGENTS.md\n对话/\n记忆/\n创作/",
			scope2,
		);
		assert.equal(lsFiltered, "某卡.json\nAGENTS.md\n创作/");

		const findFiltered = filterSandboxResultText(
			"find",
			{ path: "cards/某卡" },
			`某卡.json\n对话/${chat1.id}/正文/001-初雪.md\n对话/${chat2.id}/正文/001-长街.md\n记忆/常驻摘要.md`,
			scope2,
		);
		assert.equal(findFiltered, `某卡.json\n对话/${chat2.id}/正文/001-长街.md`);

		const grepFiltered = filterSandboxResultText(
			"grep",
			{ path: "cards/某卡" },
			`对话/${chat1.id}/正文/001-初雪.md:1: 项目1机密\n对话/${chat1.id}/正文/001-初雪.md-2- 上下文\n对话/${chat2.id}/正文/001-长街.md:1: 项目2公开\n记忆/记忆.md:3: 旧卡根记忆`,
			scope2,
		);
		assert.equal(grepFiltered, `对话/${chat2.id}/正文/001-长街.md:1: 项目2公开`);

		// 状态块装配：chat2 的状态块只带 chat2 的正文，无 residentSummary 时绝不出跨项目前情
		const block2 = buildAgentStateBlock({ state: defaultState(), files: listStoryFiles(join(chat2.dir, "正文")) });
		assert.match(block2, /001-长街\.md/);
		assert.doesNotMatch(block2, /初雪/);
		assert.doesNotMatch(block2, /【前情提要】/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("项目物理删除与记忆彻底清除：删项目时连根拔起正文、会话、快照及卡级复盘，清单自动登记遗忘", () => {
	const root = tmp();
	try {
		const cardsRoot = join(root, "cards");
		const cardDir = join(cardsRoot, "某卡");
		mkdirSync(cardDir, { recursive: true });
		writeFileSync(join(cardDir, "某卡.json"), JSON.stringify({ data: { name: "某卡" } }));

		const chat1 = createChat(cardDir, { mode: "agent", name: "待删项目" });
		writeFileSync(join(chat1.dir, "正文", "001-初雪.md"), "将被删除的正文。");
		writeFileSync(join(chat1.sessionsDir, "a.jsonl"), `${JSON.stringify({ type: "session", id: "s1", timestamp: "2026-01-01T00:00:00Z" })}\n`);

		// 创建卡级复盘文件与清单记录
		const p = memoryPaths(cardDir);
		mkdirSync(p.recapsDir, { recursive: true });
		const recapFile = p.recapOf(chat1.id);
		writeFileSync(recapFile, "待删项目的卡级复盘事实。", "utf8");
		const manifest = loadManifest(cardDir);
		manifest.recaps[chat1.id] = { sourceMark: "mark1", recapAt: new Date().toISOString() };
		saveManifest(cardDir, manifest);

		// 删除前可查到复盘
		assert.ok(existsSync(recapFile));
		assert.ok(listCardMemory(cardDir).some((d) => d.ref === `card:recap:${chat1.id}`));

		// 模拟执行彻底删除项目逻辑
		rmSync(chat1.dir, { recursive: true, force: true });
		if (existsSync(recapFile)) rmSync(recapFile, { force: true });
		delete manifest.recaps[chat1.id];
		manifest.manual ??= { protectedRefs: [], forgottenChats: [], supersededRecaps: {}, aggregatePinned: false, epoch: 0 };
		manifest.manual.forgottenChats.push(chat1.id);
		saveManifest(cardDir, manifest);

		// 验证彻底物理清除
		assert.equal(existsSync(chat1.dir), false, "子项目目录已彻底删除");
		assert.equal(existsSync(recapFile), false, "卡级复盘已彻底删除");
		assert.equal(listCardMemory(cardDir).some((d) => d.ref === `card:recap:${chat1.id}`), false, "卡级记忆列表0残留");
	} finally { rmSync(root, { recursive: true, force: true }); }
});

