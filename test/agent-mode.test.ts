import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { chatModeOfSessionDir, createChat } from "../src/cardspace.ts";
import { CONVERSATION_PROCESS_TYPE } from "../src/conversation-mode.ts";
import { collectChatEvidence } from "../src/card-memory.ts";
import { harnessManagedPath, sandboxScope, sandboxVerdict } from "../src/sandbox.ts";
import { buildAgentStateBlock } from "../src/stage/agent.ts";
import { SUMMARY_ENTRY_TYPE, type BranchEntryLike } from "../src/stage/assemble.ts";
import { planCompaction } from "../src/stage/compact.ts";
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
		const grants = { dirs: [], bash: false };
		assert.equal(sandboxVerdict("write", { path: join(chat.dir, "正文", "001.md") }, scope, grants).kind, "allow");
		assert.equal(sandboxVerdict("edit", { path: join(chat.dir, "历史", "检查点.jsonl") }, scope, grants).kind, "deny");
		assert.equal(sandboxVerdict("read", { path: join(chat.dir, "历史", "检查点.jsonl") }, scope, grants).kind, "allow");

		writeFileSync(join(chat.dir, "正文", "001-初雪.md"), "第一章正文。");
		const block = buildAgentStateBlock({ state: defaultState(), files: listStoryFiles(join(chat.dir, "正文")) });
		assert.match(block, /【稿子目录】正文\/ 共 1 个文件 6 字/);
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
