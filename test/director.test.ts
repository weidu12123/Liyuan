import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadCardFile } from "../src/card.ts";
import { buildSystemPrompt, buildTurnInjection, detectsLanguageMismatch } from "../src/director.ts";
import { defaultState } from "../src/state.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";

const card = loadCardFile(fileURLToPath(new URL("../assets/cards/default_Qingwu.json", import.meta.url)));

test("system prompt 含角色/纪律/双职责/工具分工/语言指令且宏已替换", () => {
	const sp = buildSystemPrompt({ card, config: DEFAULT_CONFIG, constantLore: [] });
	assert.ok(sp.includes("青梧"));
	assert.ok(sp.includes("双重职责"), "应说明戏内/戏外双职责（F3 §6.1）");
	assert.ok(sp.includes("//"), "应说明 // 场外标记");
	assert.ok(sp.includes("（）"), "应说明括号场外标记（用户定调 2026-07-09）");
	assert.ok(sp.includes("你也应当分辨"), "无标记场外话应授权模型自行判断");
	assert.ok(sp.includes("world_state_update"), "记账工具已还给主演（F3 §6.3）");
	assert.ok(sp.includes("lorebook_write"), "补充设定集工具应在剧情工具清单（F3-3）");
	assert.ok(sp.includes("panel_write"), "自建面板工具应在剧情工具清单（Phase4 柱 2）");
	assert.ok(sp.includes("bash"), "backendControl 默认开，应说明通用工具纪律");
	assert.ok(!sp.includes("/api/command"), "未注入 selfApiBase 时（TUI 模式）不出现自操作接口段");
	assert.ok(!sp.includes("舞台监督") && !sp.includes("幕后"), "命名纪律：不用戏剧隐喻词（模型会跟着自称）");
	assert.ok(sp.includes("中文"));
	assert.ok(!sp.includes("{{char}}"), "宏应已替换");
	assert.ok(!sp.includes("{{user}}"), "宏应已替换");
});

test("system prompt：backendControl 关闭时不出现通用工具段", () => {
	const sp = buildSystemPrompt({ card, config: { ...DEFAULT_CONFIG, backendControl: false }, constantLore: [] });
	assert.ok(!sp.includes("bash"), "关闭后不应提及通用工具");
	assert.ok(sp.includes("world_state_update"), "剧情工具不受开关影响");
	assert.ok(
		!buildSystemPrompt({
			card,
			config: { ...DEFAULT_CONFIG, backendControl: false },
			constantLore: [],
			selfApiBase: "http://localhost:7620",
		}).includes("/api/command"),
		"backendControl 关闭时即使有 selfApiBase 也不出现自操作接口段",
	);
});

test("system prompt：selfApiBase 注入自操作接口段（含命令桥/确认纪律/auth 禁区）", () => {
	const sp = buildSystemPrompt({
		card,
		config: DEFAULT_CONFIG,
		constantLore: [],
		selfApiBase: "http://localhost:7620",
	});
	assert.ok(sp.includes("http://localhost:7620/api/command"), "命令桥地址应写明");
	assert.ok(sp.includes("/api/config"), "配置接口应写明");
	assert.ok(sp.includes("永不调用 /api/auth"), "密钥禁区应写明");
});

test("末端注入：戏外姿态换导演备注，叙事纪律与预设末端指令不注入", () => {
	const base = { state: defaultState(), activatedLore: [], card, config: DEFAULT_CONFIG };
	const backstage = buildTurnInjection({
		...base,
		stance: "backstage" as const,
		languageMismatch: true,
		auditWarnings: ["测试告警"],
		presetPostHistoryBlocks: [
			{ id: "x", name: "x", channel: "postHistory" as const, role: "system" as const, content: "预设指令内容", enabled: true },
		],
	});
	assert.ok(backstage.includes("助手姿态"), "戏外备注应出现");
	assert.ok(backstage.includes("【世界状态】"), "世界状态照常注入（办事资料）");
	assert.ok(!backstage.includes("连续性提醒"), "审计提醒不在戏外轮消费");
	assert.ok(!backstage.includes("错误的语言"), "语言纠正不在戏外轮消费");
	assert.ok(!backstage.includes("预设指令内容"), "预设末端指令（叙事工艺）不注入戏外轮");
	const onstage = buildTurnInjection({ ...base, stance: "onstage" as const });
	assert.ok(!onstage.includes("助手姿态"), "戏内轮无戏外备注");
});

test("末端注入：审计告警出现且列出条目，无告警时不出现", () => {
	const base = { state: defaultState(), activatedLore: [], card, config: DEFAULT_CONFIG };
	const withWarn = buildTurnInjection({ ...base, auditWarnings: ["正文说怀表在她手中 vs 账本记录阿远持有"] });
	assert.ok(withWarn.includes("连续性提醒"));
	assert.ok(withWarn.includes("怀表"));
	assert.ok(!buildTurnInjection({ ...base, auditWarnings: [] }).includes("连续性提醒"));
	assert.ok(!buildTurnInjection({ ...base }).includes("连续性提醒"));
});

test("末端注入：语言与硬边界纪律恒在", () => {
	const text = buildTurnInjection({ state: defaultState(), activatedLore: [], card, config: DEFAULT_CONFIG });
	assert.ok(text.includes("中文"));
	assert.ok(text.includes("旅人"));
	assert.ok(text.includes("【世界状态】"));
	assert.ok(text.includes("不得与之矛盾"), "状态注入应为硬约束措辞");
});

test("末端注入：语言失配时出现纠正提醒", () => {
	const base = { state: defaultState(), activatedLore: [], card, config: DEFAULT_CONFIG };
	assert.ok(buildTurnInjection({ ...base, languageMismatch: true }).includes("错误的语言"));
	assert.ok(!buildTurnInjection({ ...base, languageMismatch: false }).includes("错误的语言"));
});

test("末端注入：活跃面板速览随 panelIndex 出现（戏内外皆注入），缺省不出现", () => {
	const base = { state: defaultState(), activatedLore: [], card, config: DEFAULT_CONFIG };
	const withPanels = buildTurnInjection({ ...base, panelIndex: "地图(svg)、装备库(markdown)" });
	assert.ok(withPanels.includes("【活跃面板】地图(svg)、装备库(markdown)"));
	assert.ok(withPanels.includes("panel_write"), "速览应附更新提醒");
	assert.ok(
		buildTurnInjection({ ...base, stance: "backstage" as const, panelIndex: "地图(svg)" }).includes("【活跃面板】"),
		"戏外轮也注入（办事可能要动面板）",
	);
	assert.ok(!buildTurnInjection(base).includes("【活跃面板】"), "无面板不出现");
});

test("末端注入：决策门禁提醒仅 ask 档戏内轮出现", () => {
	const askConfig = { ...DEFAULT_CONFIG, creationMode: "ask" as const };
	const base = { state: defaultState(), activatedLore: [], card, config: askConfig };
	assert.ok(buildTurnInjection(base).includes("ask_director"), "ask 档每轮末端应有门禁提醒");
	assert.ok(
		!buildTurnInjection({ ...base, config: DEFAULT_CONFIG }).includes("ask_director"),
		"silent 档（缺省）不提醒",
	);
	assert.ok(
		!buildTurnInjection({ ...base, stance: "backstage" as const }).includes("ask_director"),
		"戏外轮不提醒（门禁是叙事纪律）",
	);
});

test("语言失配检测：英文正文报警，中文正文与短文本不报", () => {
	const en =
		"*Qingwu sets the teacup down and studies your rain-soaked figure for a moment, her voice calm and clear beneath the steady sound of rain on the roof tiles.*";
	const zh = "*青梧放下茶盏，目光在你被雨水浸透的肩头停了一瞬。她的声音不高，混在瓦上的雨声里，却平静而清晰。*";
	const mixed = "*Qingwu 轻轻点头。*「你醒了，旅人。这里是栖水镇的听雨轩——你已经安全了，好好休息。」";
	assert.equal(detectsLanguageMismatch(en, "中文"), true, "英文正文应报警");
	assert.equal(detectsLanguageMismatch(zh, "中文"), false, "中文正文不应报警");
	assert.equal(detectsLanguageMismatch(mixed, "中文"), false, "夹杂专有名词的中文不应报警");
	assert.equal(detectsLanguageMismatch("Okay.", "中文"), false, "短文本不判定");
	assert.equal(detectsLanguageMismatch(en, "English"), false, "非中文目标 v0 不检测");
});
