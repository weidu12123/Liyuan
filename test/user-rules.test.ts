import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadPresetDoc } from "../src/preset-doc.ts";
import { loadStageMaterials } from "../src/stage/materials.ts";
import { translatePresetToRules, translateReport } from "../src/user-rules.ts";
import { buildStageSystemPrompt } from "../src/stage/assemble.ts";
import type { RpConfig } from "../src/types.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";

/** 一份小而全的酒馆形状预设：历史前/后块、marker 槽位、关闭块、深度注入、末尾 assistant 预填、采样 */
const FIXTURE = {
	name: "测试预设",
	temperature: 0.9,
	top_p: 0.95,
	prompts: [
		{ identifier: "main", name: "主提示词", system_prompt: true, content: "你是{{char}}。", enabled: true, injection_position: 0, injection_order: 100 },
		{ identifier: "worldInfoBefore", name: "World Info (before)", system_prompt: true, marker: true, content: "", enabled: true, injection_position: 0, injection_order: 200 },
		{ identifier: "style", name: "文风", system_prompt: true, content: "写 800 字。称呼 {{user}} 为大人。", enabled: true, injection_position: 0, injection_order: 300 },
		{ identifier: "chatHistory", name: "Chat History", system_prompt: true, marker: true, content: "", enabled: true, injection_position: 0, injection_order: 400 },
		{ identifier: "cot", name: "思考引导", system_prompt: true, content: "先想后写。", enabled: true, injection_position: 0, injection_order: 500 },
		{ identifier: "nsfw-off", name: "关闭的块", system_prompt: true, content: "不该出现", enabled: false, injection_position: 0, injection_order: 600 },
		{ identifier: "depth-inject", name: "深度注入", system_prompt: true, content: "深度块。", enabled: true, injection_position: 1, injection_order: 100, injection_depth: 4 },
		{ identifier: "prefill", name: "预填", role: "assistant", system_prompt: false, content: "OUTPUT <status>", enabled: true, injection_position: 0, injection_order: 900 },
	],
	prompt_order: [
		{ character_id: 100001, order: [
			{ identifier: "main", enabled: true },
			{ identifier: "worldInfoBefore", enabled: true },
			{ identifier: "style", enabled: true },
			{ identifier: "chatHistory", enabled: true },
			{ identifier: "cot", enabled: true },
			{ identifier: "nsfw-off", enabled: false },
			{ identifier: "depth-inject", enabled: true },
			{ identifier: "prefill", enabled: true },
		] },
	],
};

test("转译：块去向全对——前/后分段、宏求值、marker 跳过、关闭不进、预填丢弃、samplers 迁出", () => {
	const doc = loadPresetDoc(FIXTURE as never, "测试预设");
	const r = translatePresetToRules(doc, { charName: "冷鹰", userName: "怀瑾" });

	// 宏已求值
	assert.ok(r.markdown.includes("你是冷鹰。"), "{{char}} 求值");
	assert.ok(r.markdown.includes("称呼 怀瑾 为大人"), "{{user}} 求值");
	// 分段
	assert.ok(r.markdown.indexOf("你是冷鹰") < r.markdown.indexOf("## 以下原在聊天记录之后"), "历史前段在前");
	assert.ok(r.markdown.includes("先想后写"), "历史后段收录");
	assert.ok(r.markdown.includes("深度块"), "深度注入收录");
	assert.ok(r.markdown.includes("此前从未生效"), "深度段有如注脚手架");
	// 不该出现的
	assert.ok(!r.markdown.includes("不该出现"), "关闭块不进产物");
	assert.ok(!r.markdown.includes("OUTPUT"), "预填丢弃");
	// 去向账
	const byName = new Map(r.lines.map((l) => [l.name, l]));
	assert.equal(byName.get("主提示词")?.action, "included");
	assert.equal(byName.get("主提示词")?.where, "before");
	assert.equal(byName.get("思考引导")?.where, "after", "chatHistory 之后的块归历史后段");
	assert.equal(byName.get("关闭的块")?.action, "skipped-disabled");
	assert.equal(byName.get("预填")?.action, "dropped-prefill");
	assert.equal(byName.get("深度注入")?.where, "depth");
	const marker = r.lines.find((l) => l.action === "skipped-marker");
	assert.ok(marker && /World Info|槽位|Chat/.test(marker.name + "") || r.lines.some((l) => l.action === "skipped-marker"), "marker 槽位进报告");
	// samplers
	assert.deepEqual(r.samplers, { temperature: 0.9, top_p: 0.95 });
	// 报告逐块有行
	const report = translateReport(doc, r, "assets/presets/测试预设.json");
	assert.ok(report.includes("逐块去向"));
	assert.ok(report.includes("丢弃"), "预填在报告里点名");
	assert.ok(report.includes("config.samplers"));
});

test("用户规矩进 system：全局在前、卡级在后、原文直通无包装", () => {
	const config: RpConfig = { ...DEFAULT_CONFIG, userName: "怀瑾" };
	const sys = buildStageSystemPrompt({
		card: { name: "冷鹰", description: "监察院使", personality: "", scenario: "", firstMes: "", mesExample: "", systemPrompt: "", postHistoryInstructions: "", creatorNotes: "", alternateGreetings: [], tags: [], book: [] },
		config,
		constantLore: [],
		userRules: { global: "全局规矩第一句。", agent: "agent 模式的规矩。", card: "这张卡的规矩。" },
		tools: false,
	});
	assert.ok(sys.includes("全局规矩第一句。"));
	assert.ok(sys.includes("这张卡的规矩。"));
	assert.ok(sys.indexOf("全局规矩第一句。") < sys.indexOf("这张卡的规矩。"), "全局在前");
	assert.ok(!sys.includes("agent 模式的规矩。"), "扮演轮不读 agent 模式的追加槽");
	// 空规矩零痕迹（不加空段）
	const sys2 = buildStageSystemPrompt({
		card: { name: "冷鹰", description: "", personality: "", scenario: "", firstMes: "", mesExample: "", systemPrompt: "", postHistoryInstructions: "", creatorNotes: "", alternateGreetings: [], tags: [], book: [] },
		config,
		constantLore: [],
		userRules: { global: "", agent: "", card: "" },
		tools: false,
	});
	assert.ok(!sys2.startsWith("\n"), "空规矩不产生空段");
});

test("applyConfigPatch：samplers 只收数字键、坏键丢弃、空对象清键；preset 空值删除（转译端点的 config 通道）", async () => {
	const { applyConfigPatch } = await import("../server/rest.ts");
	const next = applyConfigPatch(
		{ card: "c.png", preset: "assets/presets/旧.json", userName: "沈舟", language: "中文", scanDepth: 4, maxLoreInjections: 3, greeting: true } as never,
		{
			preset: null,
			samplers: { temperature: 1.2, top_p: 0.95, top_k: 64, junk: "bad", nan: Number.NaN },
		},
	);
	assert.equal((next as { preset?: string }).preset, undefined, "preset 指针清空");
	const samplers = (next as { samplers?: Record<string, number> }).samplers ?? {};
	assert.deepEqual(samplers, { temperature: 1.2, top_p: 0.95, top_k: 64 }, "数字键收下，坏键丢弃");
	// 空对象 ⇒ 连键删（没带采样参数的预设转译后不留空壳）
	const next2 = applyConfigPatch({ ...next } as never, { samplers: {} });
	assert.equal((next2 as { samplers?: unknown }).samplers, undefined, "空 samplers 清键");
});

test("applyConfigPatch：compactEveryNTurns 在白名单内，0 表示关主动压缩，未打补丁保持原值", async () => {
	const { applyConfigPatch } = await import("../server/rest.ts");
	const base = {
		card: "c.png",
		userName: "沈舟",
		language: "中文",
		scanDepth: 4,
		maxLoreInjections: 3,
		greeting: true,
		compactEveryNTurns: 30,
	} as never;
	assert.equal(applyConfigPatch(base, { compactEveryNTurns: 12 }).compactEveryNTurns, 12);
	assert.equal(applyConfigPatch(base, { compactEveryNTurns: 0 }).compactEveryNTurns, 0, "0 = 仅被动压缩");
	assert.equal(applyConfigPatch(base, { compactEveryNTurns: 999 }).compactEveryNTurns, 500, "上限 500");
	assert.equal(applyConfigPatch(base, { scanDepth: 8 }).compactEveryNTurns, 30, "没打补丁保持原值");
});

test("规矩文件指纹进缓存：改文件后 loadStageMaterials 重算（端到端走真装载）", () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-rules-"));
	process.env.LIYUAN_CODING_AGENT_DIR = join(cwd, "agentDir");
	try {
		writeFileSync(join(cwd, "card.json"), JSON.stringify({ data: { name: "冷鹰", first_mes: "你来了。" } }));
		writeFileSync(join(cwd, "liyuan.config.json"), JSON.stringify({ card: "card.json", userName: "怀瑾" }));
		mkdirSync(join(cwd, "agentDir"), { recursive: true });
		writeFileSync(join(cwd, "agentDir", "APPEND_SYSTEM.md"), "全局规则。", "utf8");
		writeFileSync(join(cwd, "APPEND_SYSTEM.md"), "卡级规则。", "utf8");

		const m1 = loadStageMaterials(cwd);
		assert.equal(m1.userRules.global, "全局规则。", "全局规矩读到");
		assert.equal(m1.userRules.card, "卡级规则。", "卡级规矩读到");

		writeFileSync(join(cwd, "APPEND_SYSTEM.md"), "改过的卡级规则。", "utf8");
		const m2 = loadStageMaterials(cwd);
		assert.equal(m2.userRules.card, "改过的卡级规则。", "指纹变化 ⇒ 缓存失效重读");
		assert.equal(m2.userRules.global, "全局规则。", "另一份不受影响");
	} finally {
		delete process.env.LIYUAN_CODING_AGENT_DIR;
		rmSync(cwd, { recursive: true, force: true });
	}
});
