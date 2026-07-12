import assert from "node:assert/strict";
import { test } from "node:test";

import { pruneClosedTurns } from "../src/retention.ts";

const user = (text: string) => ({ role: "user", content: text });
const custom = (text: string) => ({ role: "custom", customType: "rp-greeting", content: text });
const toolResult = () => ({ role: "toolResult", toolName: "lorebook_search", content: [{ type: "text", text: "lore dump ".repeat(50) }] });
const assistant = (parts: Array<Record<string, unknown>>) => ({ role: "assistant", content: parts });
const text = (t: string) => ({ type: "text", text: t });
const toolCall = () => ({ type: "toolCall", id: "x", name: "lorebook_search", arguments: { query: "glade" } });
const thinking = () => ({ type: "thinking", thinking: "hmm ".repeat(30) });

test("当前轮（边界后）原样保留，包括进行中的工具循环", () => {
	const messages = [user("你好"), assistant([thinking(), toolCall()]), toolResult()];
	const { messages: out, stats } = pruneClosedTurns(messages);
	assert.deepEqual(out, messages);
	assert.equal(stats.droppedToolResults, 0);
});

test("闭合轮次：toolResult 整条删除、toolCall/thinking 块剥除、正文保留", () => {
	const messages = [
		custom("【开场】..."),
		user("第一轮"),
		assistant([thinking(), toolCall()]),
		toolResult(),
		assistant([text("第一轮正文")]),
		user("第二轮"),
	];
	const { messages: out, stats } = pruneClosedTurns(messages);
	assert.equal(stats.droppedToolResults, 1);
	assert.equal(stats.droppedToolCallBlocks, 1);
	assert.equal(stats.droppedThinkingBlocks, 1);
	assert.equal(stats.droppedEmptyAssistant, 1, "纯工具 assistant 消息应整条丢弃");
	assert.deepEqual(
		out.map((m) => m.role),
		["custom", "user", "assistant", "user"],
	);
	assert.ok(stats.charsAfter < stats.charsBefore);
});

test("闭合轮次中带正文的混合 assistant：剥块留文", () => {
	const messages = [user("A"), assistant([thinking(), text("正文"), toolCall()]), toolResult(), user("B")];
	const { messages: out } = pruneClosedTurns(messages);
	const mid = out[1] as { content: Array<{ type: string }> };
	assert.deepEqual(mid.content.map((p) => p.type), ["text"]);
});

test("无已闭合轮次（首轮）不动", () => {
	const messages = [custom("【开场】"), user("第一条")];
	const { messages: out } = pruneClosedTurns(messages);
	assert.deepEqual(out, messages);
});

test("多轮累积：只有最后一轮保留工具对", () => {
	const turn = (n: number) => [user(`u${n}`), assistant([toolCall()]), toolResult(), assistant([text(`t${n}`)])];
	const messages = [...turn(1), ...turn(2), ...turn(3)];
	const { messages: out, stats } = pruneClosedTurns(messages);
	assert.equal(stats.droppedToolResults, 2);
	assert.equal(stats.droppedEmptyAssistant, 2);
	// 第 3 轮（当前轮）完整：user, assistant(toolCall), toolResult, assistant(text)
	const tail = out.slice(-4).map((m) => m.role);
	assert.deepEqual(tail, ["user", "assistant", "toolResult", "assistant"]);
});

// ---- 戏外轮分级保留（2026-07-10 用户定调）----

const bsTurn = (n: number) => [
	user(`// 调试第 ${n} 步`),
	assistant([thinking(), toolCall()]),
	toolResult(),
	assistant([text(`中间叙述 ${n}`), toolCall()]),
	toolResult(),
	assistant([text(`最终报告 ${n}`)]),
];

test("最近的已闭合戏外轮整轮原样保留（工具对与思考都在）", () => {
	const messages = [...bsTurn(1), user("回到剧情")];
	const { messages: out, stats } = pruneClosedTurns(messages);
	assert.equal(stats.droppedToolResults, 0);
	assert.equal(stats.droppedThinkingBlocks, 0);
	assert.deepEqual(out, messages);
});

test("更早的戏外轮只留用户消息与最终报告，中间叙述整条裁掉", () => {
	const messages = [...bsTurn(1), ...bsTurn(2), user("回到剧情")];
	const { messages: out, stats } = pruneClosedTurns(messages);
	// 轮 1（旧戏外轮）：user + 最终报告；轮 2（最近戏外轮）：6 条全保留；边界 user 1 条
	assert.equal(out.length, 2 + 6 + 1);
	const kept1 = out[1] as { content: Array<{ type: string; text?: string }> };
	assert.equal(kept1.content[0].text, "最终报告 1");
	assert.equal(stats.droppedBackstageNarration, 1, "中间叙述 1 应整条裁掉");
	assert.equal(stats.droppedToolResults, 2, "只裁旧戏外轮的工具结果");
});

test("戏内轮夹在戏外轮之间：各按各的策略", () => {
	const messages = [
		...bsTurn(1),
		user("剧情发言"),
		assistant([toolCall()]),
		toolResult(),
		assistant([text("剧情正文")]),
		user("（帮我看下状态）"),
	];
	const { messages: out } = pruneClosedTurns(messages);
	// 戏外轮 1 是最近戏外轮 → 全保留（6 条）；戏内轮照旧裁剪（user+正文）；边界 user
	assert.equal(out.length, 6 + 2 + 1);
});
