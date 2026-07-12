import assert from "node:assert/strict";
import { test } from "node:test";

import { looksLikeYamlBlock, splitStatusParts, stripYamlFence } from "../web/src/statusBlocks.ts";

test("splitStatusParts: 拆 normal/special 并去掉标签", () => {
	const text = `序\n<normal_status>\n\`\`\`yaml\n『时间』: 夏\n\`\`\`\n</normal_status>\n正文\n<special_status>\n状态\n</special_status>\n尾`;
	const p = splitStatusParts(text);
	assert.equal(p[0].kind, "text");
	assert.equal(p[1].kind, "status");
	if (p[1].kind === "status") assert.equal(p[1].tag, "normal_status");
	assert.equal(p[2].kind, "text");
	assert.equal(p[3].kind, "status");
	if (p[3].kind === "status") assert.equal(p[3].tag, "special_status");
});

test("descriptive_analysis 不展示", () => {
	const p = splitStatusParts("前<descriptive_analysis>分析</descriptive_analysis>后");
	assert.deepEqual(
		p.filter((x) => x.kind === "text").map((x) => (x.kind === "text" ? x.text : "")),
		["前", "后"],
	);
	assert.equal(p.some((x) => x.kind === "status"), false);
});

test("looksLikeYamlBlock / stripYamlFence", () => {
	assert.equal(looksLikeYamlBlock("```yaml\na: 1\nb: 2\n```"), true);
	assert.equal(stripYamlFence("```yaml\na: 1\n```"), "a: 1");
});

test("plot 误写成 </splot> 仍能拆出第二段（大乾卡笔误）", () => {
	const text =
		"<plot>\n第一段剧情\n</plot>\n\n<plot>\n第二段被错关\n</splot>\n\n正文尾巴";
	const p = splitStatusParts(text);
	const statuses = p.filter((x) => x.kind === "status");
	assert.equal(statuses.length, 2);
	if (statuses[0].kind === "status") assert.match(statuses[0].body, /第一段/);
	if (statuses[1].kind === "status") assert.match(statuses[1].body, /第二段/);
	const tails = p.filter((x) => x.kind === "text").map((x) => (x.kind === "text" ? x.text : ""));
	assert.ok(tails.some((t) => t.includes("正文尾巴")));
	assert.ok(!tails.some((t) => t.includes("<plot>")), "不应再泄漏裸开标签");
});
