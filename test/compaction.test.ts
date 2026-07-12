import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRpSummaryPrompt, serializeForSummary } from "../src/compaction.ts";

test("摘要输入序列化：保留正文与开场白，剔除工具残渣与思考块", () => {
	const messages = [
		{ role: "custom", customType: "rp-greeting", content: "【开场】*她守在你身边。*" },
		{ role: "custom", customType: "rp-inject", content: "" },
		{ role: "user", content: "我睁开眼。" },
		{
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "应该先检索设定" },
				{ type: "toolCall", id: "t1", name: "lorebook_search", arguments: { query: "Gloomhound" } },
				{ type: "text", text: "*她转过身来。*「你醒了。」" },
			],
		},
		{ role: "toolResult", content: [{ type: "text", text: "### gloomhound…" }], toolCallId: "t1" },
	];
	const text = serializeForSummary(messages, "阿远", "青梧");
	assert.ok(text.includes("阿远：我睁开眼。"));
	assert.ok(text.includes("青梧：*她转过身来。*「你醒了。」"));
	assert.ok(text.includes("【开场】"));
	assert.ok(!text.includes("lorebook_search"), "工具调用不应进入摘要输入");
	assert.ok(!text.includes("应该先检索设定"), "思考块不应进入摘要输入");
	assert.ok(!text.includes("gloomhound"), "工具结果不应进入摘要输入");
});

test("RP 摘要提示词：结构完整、以当前场景收尾、语言与用户名注入", () => {
	const { systemPrompt, userText } = buildRpSummaryPrompt({
		conversationText: "User: 你好\nAssistant: *她抬起头* 你醒了。",
		stateSnapshot: "时间：第三天清晨\n物品：黄铜怀表（阿远持有）",
		language: "中文",
		userName: "阿远",
	});
	for (const section of ["前情提要", "人物", "承诺与伏笔", "事实账", "当前场景"]) {
		assert.ok(systemPrompt.includes(`## ${section}`), `缺少 ${section} 节`);
	}
	assert.ok(systemPrompt.includes("最新"), "必须强调以最新场景为续演点");
	assert.ok(systemPrompt.includes("阿远"));
	assert.ok(systemPrompt.includes("中文"));
	assert.ok(userText.includes("<conversation>"));
	assert.ok(userText.includes("黄铜怀表"));
	assert.ok(userText.includes("以对话记录为准"), "账本快照须声明从属地位");
	assert.ok(!userText.includes("<previous-summary>"), "无既有摘要时不应出现该块");
});

test("RP 摘要提示词：增量压缩时合并既有摘要", () => {
	const { userText } = buildRpSummaryPrompt({
		conversationText: "…",
		stateSnapshot: "（尚无记录）",
		previousSummary: "第一天：阿远在林间空地醒来。",
		language: "中文",
		userName: "阿远",
	});
	assert.ok(userText.includes("<previous-summary>"));
	assert.ok(userText.includes("第一天：阿远在林间空地醒来。"));
	assert.ok(userText.includes("合并进本次摘要"));
});
