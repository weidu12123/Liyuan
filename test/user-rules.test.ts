import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { syncCardFiles } from "../server/rest.ts";
import { cardAgentsPath } from "../src/card-agents.ts";
import { buildStageSystemPrompt } from "../src/stage/assemble.ts";
import { loadStageMaterials } from "../src/stage/materials.ts";
import { cardRulesPath } from "../src/user-rules.ts";
import type { RpConfig } from "../src/types.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";

test("syncCardFiles：停用静态转译后自动剥离历史遗留的（预设）条目，保留用户条款与世界书镜像", () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-strip-preset-"));
	process.env.LIYUAN_CODING_AGENT_DIR = join(cwd, "agentDir");
	try {
		mkdirSync(join(cwd, "agentDir"), { recursive: true });
		writeFileSync(join(cwd, "card.json"), JSON.stringify({ data: { name: "冷鹰", description: "监察院使", first_mes: "你来了。" } }));
		writeFileSync(join(cwd, "大世界.json"), JSON.stringify({ entries: [{ uid: 1, key: ["门派"], comment: "门派", content: "门派设定。", constant: true }] }));
		writeFileSync(join(cwd, "liyuan.config.json"), JSON.stringify({ card: "card.json", userName: "怀瑾", lorebooks: ["大世界.json"] }));

		// 1. APPEND_SYSTEM.md 仅包含旧转译产物：剥光后直接删除该空文件
		const rulesAbs = cardRulesPath(cwd);
		writeFileSync(rulesAbs, "# 预设提示词（预设）\n\n## 身份（预设）\n你是写手。\n", "utf8");

		// 2. AGENTS.md 混合了用户条款 + 旧预设条目 + 世界书镜像：仅剥除预设条目
		const agentsAbs = cardAgentsPath(cwd);
		writeFileSync(
			agentsAbs,
			"# 用户档案\n\n## 自写条款\n保持古风。\n\n## 写作规则（预设）\n旧预设内容。\n\n<!-- ## 思考（预设）\n停用预设内容。\n-->\n",
			"utf8",
		);

		const res = syncCardFiles(cwd);
		assert.equal(res.strippedPresetEntries, true, "触发历史预设条目剥离");
		assert.equal(existsSync(rulesAbs), false, "仅含旧预设的 APPEND_SYSTEM.md 已删除");
		const nextAgents = readFileSync(agentsAbs, "utf8");
		assert.ok(nextAgents.includes("## 自写条款\n保持古风。"), "用户自写条款完好保留");
		assert.ok(!nextAgents.includes("（预设）") && !nextAgents.includes("旧预设内容") && !nextAgents.includes("停用预设内容"), "所有活动/注释的预设条目均被剥净");
		assert.ok(nextAgents.includes("## 门派（世界书·大世界）"), "世界书蓝灯镜像照常同步");
	} finally {
		delete process.env.LIYUAN_CODING_AGENT_DIR;
		rmSync(cwd, { recursive: true, force: true });
	}
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
