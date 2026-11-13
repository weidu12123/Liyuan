import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	applyHistoryInjections,
	buildLiyuanOutputOverrideFragment,
	buildStageInjection,
	buildStageSystemPrompt,
	detectsLanguageMismatch,
	readShippedRpSystemProtocol,
	rebuildHistory,
	stateFromBranch,
	type BranchEntryLike,
	type PromptFragment,
} from "../src/stage/assemble.ts";
import type { DisplayRule } from "../src/cardfront.ts";
import { constantLoreOf, loadStageMaterials } from "../src/stage/materials.ts";
import { defaultState } from "../src/state.ts";
import { DEFAULT_CONFIG, type RpConfig } from "../src/types.ts";

// ---------------- 分支 → 历史 ----------------

const userE = (text: string): BranchEntryLike => ({
	type: "message",
	message: { role: "user", content: [{ type: "text", text }] },
});
const asstE = (text: string): BranchEntryLike => ({
	type: "message",
	message: { role: "assistant", content: [{ type: "text", text }] },
});

test("rebuildHistory：开场白→assistant、补丁套用、过程条目蒸发、同角色合并", () => {
	const branch: BranchEntryLike[] = [
		{ type: "custom_message", customType: "rp-greeting", content: "【开场】她回头。" },
		{ type: "custom", customType: "rp-state", data: { scene: "山门" } },
		userE("我上前行礼。"),
		{
			type: "message",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "内心盘算……" },
					{ type: "text", text: "云澜受了半礼，袖口沾着晨露。" },
				],
			},
		},
		// 同拍第二条 assistant（旧会话工具轮之间的散文本）→ 应与上条合并
		asstE("「起来吧。」"),
		// 补丁：定点替换
		{ type: "custom_message", customType: "rp-draft-op", content: JSON.stringify({ old: "晨露", new: "夜霜" }) },
		// 工具回执（旧会话残留）→ 不进历史
		{ type: "message", message: { role: "toolResult", content: [{ type: "text", text: "ok" }] } },
		userE("说明来意。"),
	];
	const { history, lastUserText, lastNarrativeText } = rebuildHistory(branch);

	assert.equal(history[0].role, "assistant");
	assert.ok(history[0].text.includes("【开场】"));
	assert.equal(history.length, 4); // 开场 / user / assistant(合并) / user
	assert.ok(history[2].text.includes("夜霜"), "补丁应套用");
	assert.ok(!history[2].text.includes("晨露"));
	assert.ok(history[2].text.includes("「起来吧。」"), "同角色相邻合并");
	assert.ok(!history[2].text.includes("内心盘算"), "thinking 不进历史");
	assert.equal(lastUserText, "说明来意。");
	assert.ok(lastNarrativeText.includes("夜霜"), "语言检测源=最后台上叙事（含补丁）");
});

test("rebuildHistory：送模侧作者正则（promptOnly/破坏性）剥「作者不想让模型看」的块", () => {
	const branch: BranchEntryLike[] = [
		userE("你先进去。"),
		{
			type: "message",
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "正文一句。\n\n<w2g>选项：1 走 2 停</w2g>\n\n<SexualScene>内容</SexualScene>" },
				],
			},
		},
	];
	const promptRulesFixture: DisplayRule[] = [
		// TG-ai看不见 同款：剥 VariableCheck/SexualScene/Disclaimer/w2g
		{
			name: "TG-ai看不见",
			source: "<(VariableCheck|SexualScene|Disclaimer|w2g)>([\\s\\S]*?)<\\/\\1>|<!--([\\s\\S]*?)-->",
			flags: "g",
			replace: "",
		},
	];
	const { history } = rebuildHistory(branch, promptRulesFixture);
	const sent = history[history.length - 1].text;
	assert.ok(sent.includes("正文一句"), "正文保留");
	assert.ok(!sent.includes("w2g"), "作者 promptOnly 规则剥掉不想让模型看的块");
	assert.ok(!sent.includes("SexualScene"), "同上");
	// 对照组：不传规则 → 块原样进历史（unwrapped 内容仍在）
	const { history: ctrl } = rebuildHistory(branch);
	assert.ok(ctrl[ctrl.length - 1].text.includes("SexualScene") || ctrl[ctrl.length - 1].text.includes("内容"), "无规则时不剥");
});

test("rebuildHistory：送模侧深度限定——旧状态栏剥掉，最新那条留着当模型的格式模仿源", () => {
	// 实卡形态：`隐藏历史多状态栏`（minDepth:3 起、replace 空）
	// 与 `折叠通用多状态栏`（maxDepth:2）是按深度互补的一对。忽略 depth 全深度跑，
	// 历史里一个范例都不剩，模型每拍得从散文重推格式。
	const hideOld: DisplayRule[] = [
		{ name: "隐藏历史多状态栏", source: "<state1>[\\s\\S]*?<\\/state1>", flags: "g", replace: "", minDepth: 3 },
	];
	const branch: BranchEntryLike[] = [
		asstE("老段。\n<state1>老栏</state1>"),
		userE("u1"),
		asstE("新段。\n<state1>新栏</state1>"),
		userE("u2"),
	];
	// 合并后 4 条：老段 depth3 / u1 depth2 / 新段 depth1 / u2 depth0
	const { history } = rebuildHistory(branch, hideOld);
	assert.ok(!history[0].text.includes("老栏"), "depth≥3 的旧状态栏剥掉（省上下文）");
	assert.ok(history[0].text.includes("老段"), "只剥状态栏，正文不动");
	assert.ok(history[2].text.includes("新栏"), "最新那条留着——模型的格式模仿源");

	// 对照：忽略 depth 全深度跑（改动前的行为）＝连最新的也删光
	const noDepth = hideOld.map(({ minDepth: _drop, ...r }) => r);
	const { history: flat } = rebuildHistory(branch, noDepth);
	assert.ok(!flat[2].text.includes("新栏"), "对照组确实会把最新的也删光");
});

test("rebuildHistory：深度按合并后的历史条目数，一拍多条 message 只算一条", () => {
	// 一拍在梨园是多条 assistant message（多轮工具＋多段正文），在酒馆眼里是一条消息。
	// 按原始条目数算，本拍第一段就落到 depth 3，作者的 minDepth:2 会把本拍状态栏删掉。
	const hide: DisplayRule[] = [
		{ name: "隐藏历史", source: "<state1>[\\s\\S]*?<\\/state1>", flags: "g", replace: "", minDepth: 2 },
	];
	const branch: BranchEntryLike[] = [
		userE("u1"),
		asstE("第一段。\n<state1>本拍栏</state1>"),
		asstE("第二段。"),
		asstE("第三段。"),
		asstE("第四段。"),
	];
	const { history } = rebuildHistory(branch, hide);
	assert.equal(history.length, 2, "四条 assistant 合成一条历史");
	assert.ok(history[1].text.includes("本拍栏"), "本拍整体 depth 0，状态栏必须留着");
});

test("rebuildHistory：幕后轮的回复不作语言检测源；rp-import 记为 user 侧", () => {
	const branch: BranchEntryLike[] = [
		{ type: "custom_message", customType: "rp-import", content: "【前情提要】旧事一段。" },
		userE("我环顾四周。"),
		asstE("殿内烛影摇动。"),
		userE("//帮我看下配置"),
		asstE("Config check done, everything looks fine and here is a long english reply for you."),
	];
	const { history, lastNarrativeText } = rebuildHistory(branch);
	assert.equal(history[0].role, "user");
	assert.ok(history[0].text.includes("前情提要"));
	assert.ok(lastNarrativeText.includes("烛影"), "幕后轮回复跳过，检测源回溯到台上叙事");
});

test("stateFromBranch：最近快照生效；无快照=初始", () => {
	const branch: BranchEntryLike[] = [
		{ type: "custom", customType: "rp-state", data: { scene: "旧场景" } },
		userE("走。"),
		{ type: "custom", customType: "rp-state", data: { scene: "新场景" } },
	];
	assert.equal((stateFromBranch(branch) as { scene?: string }).scene, "新场景");
	assert.deepEqual(stateFromBranch([userE("嗨")]), defaultState());
});

// ---------------- 提示词装配 ----------------

const card = {
	name: "云澜",
	description: "{{user}}的同门师姐。",
	personality: "冷静自持",
	scenario: "山门月下",
	mesExample: "",
	firstMes: "你来了。",
	alternateGreetings: [],
	systemPrompt: "",
	postHistoryInstructions: "",
	creatorNotes: "",
	tags: [],
	book: [],
};
const config: RpConfig = { ...DEFAULT_CONFIG, userName: "沈舟" };

test("system prompt：纯净底座——卡字段按自己版式出，无档案时不双份，人设为空时占位到位", () => {
	const rich = { ...card, description: "云澜是师姐。", personality: "冷。", scenario: "山门外。" };
	const noFile = buildStageSystemPrompt({ card: rich, config, constantLore: [] });
	assert.ok(noFile.includes("# 你扮演的角色：云澜") && noFile.includes("云澜是师姐。"), "角色描述在场");
	assert.ok(noFile.includes("## 性格\n冷。"), "性格在场");
	assert.ok(noFile.includes("## 当前场景\n山门外。"), "场景在场");
	assert.ok(noFile.includes("# 用户扮演：沈舟"), "用户身份无条件出");

	const emptyPersona: RpConfig = { ...DEFAULT_CONFIG, userName: "沈舟", userPersona: "" };
	const sys = buildStageSystemPrompt({
		card,
		config: emptyPersona,
		constantLore: [],
	});
	assert.ok(sys.includes("# 用户扮演：沈舟"), "名字到位");
	assert.ok(sys.includes("（沈舟 的具体形象由用户在剧情中自行呈现）"), "人设为空时占位到位");
});

test("末端注入：事实块——数据带标注送达，语义归 system；导演备注容器解散（D5/D6/D7）", () => {
	const inj = buildStageInjection({
		state: defaultState(),
		activatedLore: [],
		card: { ...card, postHistoryInstructions: "卡作者的末端叮嘱。" },
		config,
		languageMismatch: true,
	});
	assert.ok(inj.startsWith("【世界状态】\n"), "世界状态最前，纯数据无解说");
	assert.ok(!inj.includes("正文不得与之矛盾"), "语义解说不再逐拍复述（在 system 语义表）");
	// 预设 after 段改走消息数组（按作者 role 落成真实消息），不再进注入块、梨园也不再扣标签
	assert.ok(!inj.includes("【预设末端指令】"), "梨园的标签不再盖作者的话");
	assert.ok(!inj.includes("【文风与写法】") && !inj.includes("【行为边界】"), "零归拢");
	assert.ok(inj.includes("【卡作者末端指令】\n卡作者的末端叮嘱。"), "卡末端指令独立成块（D5）");
	assert.ok(!inj.includes("【导演备注】"), "D5：导演备注容器解散");
	assert.ok(!inj.includes("【状态栏】"), "D6：状态栏注入块已删（谢幕注入替代）");
	assert.ok(!inj.includes("【思考的用法】"), "D7：rehearsalGuard 注入整体删除");
	assert.ok(inj.includes("【语言】以中文写叙事与对白（专有名词可保留原文）。"), "语言一行（config 事实）");
	assert.ok(!inj.includes("演完本拍即停"), "「演完即停」句删——时序由判定/谢幕日程表达");
	assert.ok(inj.includes("【语言纠正】"), "语言自愈事实保留");
	assert.ok(!inj.includes("【登场名录】"), "无名录不出块");
});

test("末端注入：字数一行纯事实（§2.2）；无目标不出行", () => {
	const inj = buildStageInjection({
		state: defaultState(),
		activatedLore: [],
		card,
		config,
		wordRange: { min: 500, max: 800 },
	});
	assert.ok(inj.includes("本拍约 500–800 字"), "字数事实在场");
	assert.ok(!inj.includes("心里有数") && !inj.includes("朝这个量落笔") && !inj.includes("不必核算"), "纯事实，无落笔指令");
	const none = buildStageInjection({ state: defaultState(), activatedLore: [], card, config });
	assert.ok(!none.includes("本拍约"), "无目标不出行");
	assert.ok(!none.includes("800–1500"), "无预设兜底数字随 D1 迁出（默认预设数据承接）");
});

test("末端注入：导演备注——有则成末块（紧贴原话之前），无则逐字不变（PLAN-DIRECTOR-NOTE）", () => {
	const base = buildStageInjection({ state: defaultState(), activatedLore: [], card, config });
	assert.ok(!base.includes("【导演备注】"), "无备注不出块");
	const withNote = buildStageInjection({
		state: defaultState(), activatedLore: [], card, config,
		directorNote: "  让她傲娇一点，别急着答应。  ",
	});
	assert.ok(withNote.endsWith("【导演备注】\n让她傲娇一点，别急着答应。"), "备注成末块且首尾空白已去");
	assert.equal(withNote.slice(0, base.length), base, "有备注时其余输出与无备注逐字一致");
	const blank = buildStageInjection({ state: defaultState(), activatedLore: [], card, config, directorNote: "   " });
	assert.equal(blank, base, "空白备注视同无备注");
});

test("detectsLanguageMismatch：中文目标才判、样本要够长", () => {
	const en = "The moon hangs over the courtyard while she waits in silence for a long time tonight.";
	assert.equal(detectsLanguageMismatch(en, "中文"), true);
	assert.equal(detectsLanguageMismatch("殿内烛影摇动，她伏案未眠，窗外霜色渐重，更漏声一声一声敲在瓦上，夜风穿堂而过带起纸页。", "中文"), false);
	assert.equal(detectsLanguageMismatch("short", "中文"), false);
	assert.equal(detectsLanguageMismatch(en, "English"), false);
});

// ---------------- 素材装载 ----------------

test("loadStageMaterials：第 1 步清零态——保留 presetDoc（采样与正则），不直接装配或写入预设文本", () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-mat-"));
	try {
		writeFileSync(
			join(cwd, "card.json"),
			JSON.stringify({ data: { name: "云澜", description: "{{user}}的师姐", first_mes: "你来了。" } }),
		);
		writeFileSync(
			join(cwd, "preset.json"),
			JSON.stringify({
				blocks: [
					{ id: "s1", channel: "system", enabled: true, content: "文风基调：清冷。" },
					{ id: "p1", channel: "postHistory", enabled: true, content: "回应用户。" },
				],
				samplers: { temperature: 0.9 },
			}),
		);
		writeFileSync(
			join(cwd, "liyuan.config.json"),
			JSON.stringify({ card: "card.json", preset: "preset.json", userName: "沈舟" }),
		);
		mkdirSync(join(cwd, ".liyuan"), { recursive: true });

		const m = loadStageMaterials(cwd);
		assert.equal(m.card.name, "云澜");
		assert.equal(m.presetDoc?.kind, "rp", "旧梨园格式仍能读");
		assert.equal(m.presetDoc?.name, "preset", "预设名取文件名");
		assert.equal(m.presetDoc?.samplers.temperature, 0.9, "采样参数从装载的预设取");
		assert.equal(constantLoreOf(m).length, 0);

		const sp = buildStageSystemPrompt({
			card: m.card,
			config: m.config,
			constantLore: constantLoreOf(m),
			userRules: m.userRules,
			cardAgents: m.cardAgents,
		});
		assert.ok(!sp.includes("文风基调：清冷"), "第 1 步已解除静态转译与直通拼接，预设文本不进 system");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("无预设＝真的无预设：config.preset 空 → presetDoc 为 null", () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-def-"));
	try {
		writeFileSync(join(cwd, "card.json"), JSON.stringify({ data: { name: "云澜", first_mes: "你来了。" } }));
		writeFileSync(join(cwd, "liyuan.config.json"), JSON.stringify({ card: "card.json", userName: "沈舟" }));

		const m = loadStageMaterials(cwd);
		assert.equal(m.presetDoc, null, "无预设时 presetDoc 为 null");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

// ---------------- 第 2 步刀 1：通用消息流分层注入 ----------------

test("刀1 · applyHistoryInjections：空片段保持原序列；depth=0/1/2/超界与同深度 order 升序、角色次序与预填丢弃全对", () => {
	const past = [
		{ role: "assistant" as const, text: "开场白" },
		{ role: "user" as const, text: "用户1" },
		{ role: "assistant" as const, text: "助手1" },
	];
	const tailText = "【世界状态】正常\n\n用户2（本拍输入）";

	// 1. 空片段：零变化
	const base = applyHistoryInjections(past, tailText, []);
	assert.equal(base.length, 4);
	assert.equal(base[3]!.text, tailText);
	assert.equal(base[3]!.isTail, true);

	// 2. 完整 depth / order / role / after / prefill 组合
	const fragments: PromptFragment[] = [
		{ id: "sys", placement: "system", role: "system", text: "前置系统片段" },
		{ id: "d5", placement: "depth", role: "system", text: "超界depth5", depth: 5, order: 10 },
		{ id: "d2", placement: "depth", role: "user", text: "插在助手1之前(depth2)", depth: 2, order: 100 },
		{ id: "d1-hi", placement: "depth", role: "system", text: "depth1大order", depth: 1, order: 114514 },
		{ id: "d1-lo-sys", placement: "depth", role: "system", text: "depth1小order-sys", depth: 1, order: 100 },
		{ id: "d1-lo-asst", placement: "depth", role: "assistant", text: "depth1小order-asst", depth: 1, order: 100 },
		{ id: "d0", placement: "depth", role: "system", text: "depth0贴末尾", depth: 0, order: 999 },
		{ id: "a-sys", placement: "after", role: "system", text: "after系统块降级user" },
		{ id: "a-asst", placement: "after", role: "assistant", text: "after末尾assistant预填" },
		{ id: "a-empty", placement: "after", role: "user", text: "   " },
	];

	// 验证 extraSystemFragments 进入 systemPrompt
	const sp = buildStageSystemPrompt({
		card,
		config,
		constantLore: [],
		extraSystemFragments: fragments.filter((f) => f.placement === "system").map((f) => f.text),
		tools: false,
	});
	assert.ok(sp.startsWith("前置系统片段"), "system 片段置入系统提示词前沿");

	const out = applyHistoryInjections(past, tailText, fragments, { tailHasUserMessage: true });
	// 期望顺序：
	// [0] 超界 depth5 (user) -> [1] 开场白 (asst) -> [2] 用户1 (user) -> [3] 插在助手1之前(depth2) (user)
	// -> [4] 助手1 (asst) -> [5] depth1小order-asst (asst)
	// -> [6] 同深度同role合并(user): depth1小order-sys + depth1大order
	// -> [7] 合并后的尾部 user（tailText + depth0贴末尾 + after系统块降级user）；末尾 assistant 预填已丢弃
	assert.equal(out.length, 8);
	assert.deepEqual(
		out.map((m) => [m.role, m.text]),
		[
			["user", "超界depth5"],
			["assistant", "开场白"],
			["user", "用户1"],
			["user", "插在助手1之前(depth2)"],
			["assistant", "助手1"],
			["assistant", "depth1小order-asst"],
			["user", "depth1小order-sys\n\ndepth1大order"],
			["user", `${tailText}\n\ndepth0贴末尾\n\nafter系统块降级user`],
		],
	);
	assert.equal(out.some((m) => m.text.includes("after末尾assistant预填")), false, "末尾 assistant 预填已剥除");
});

test("第4步刀1 · rpSystemProtocol 置前、preHistory 落于摘要前、after 按 order 升序且先剥预填再追加覆盖块", () => {
	const protocol = readShippedRpSystemProtocol();
	assert.ok(protocol.includes("梨园扮演 Agent 引擎协议"), "随包 RP_SYSTEM.md 可读");

	const sp = buildStageSystemPrompt({
		card,
		config,
		constantLore: [],
		rpSystemProtocol: protocol,
		extraSystemFragments: ["【预设前置系统段】"],
	});
	const idxProto = sp.indexOf("梨园扮演 Agent 引擎协议");
	const idxPreset = sp.indexOf("【预设前置系统段】");
	const idxRules = sp.indexOf("# 消息流约定");
	assert.ok(idxProto >= 0 && idxPreset > idxProto && idxRules > idxPreset, "system 顺序为：梨园扮演协议 → 预设前置 → 梨园约定");

	const past = [
		{ role: "user" as const, text: "旧user" },
		{ role: "assistant" as const, text: "旧asst" },
	];
	const overrideFrag = buildLiyuanOutputOverrideFragment();
	const frags: PromptFragment[] = [
		{ id: "pre-u", placement: "preHistory", role: "user", text: "破限唤醒" },
		{ id: "pre-a", placement: "preHistory", role: "assistant", text: "破限承诺" },
		{ id: "a-hi", placement: "after", role: "user", text: "预设after高权重", order: 200 },
		{ id: "a-lo", placement: "after", role: "system", text: "预设after低权重", order: 10 },
		{ id: "a-prefill", placement: "after", role: "assistant", text: "OUTPUT <think_fox~>", order: 500 },
		overrideFrag,
	];

	const out = applyHistoryInjections(past, "本拍注入+用户输入", frags, {
		summaryText: "【前情提要】更早的剧情。",
	});

	assert.equal(out[0]!.role, "user");
	assert.equal(out[0]!.text, "破限唤醒");
	assert.equal(out[1]!.role, "assistant");
	assert.equal(out[1]!.text, "破限承诺");
	assert.equal(out[2]!.role, "user");
	assert.equal(out[2]!.text, "【前情提要】更早的剧情。");
	assert.equal(out[3]!.role, "user");
	assert.equal(out[3]!.text, "旧user");
	assert.equal(out[4]!.role, "assistant");
	assert.equal(out[4]!.text, "旧asst");

	const tail = out[out.length - 1]!;
	assert.equal(tail.role, "user");
	assert.equal(tail.isTail, true);
	assert.ok(!tail.text.includes("OUTPUT <think_fox~>"), "预设末尾 assistant 预填必须在追加梨园覆盖块前被剥除");
	const iLow = tail.text.indexOf("预设after低权重");
	const iHigh = tail.text.indexOf("预设after高权重");
	const iOver = tail.text.indexOf("【梨园引擎输出协议｜最高优先级】");
	assert.ok(iLow > 0 && iHigh > iLow && iOver > iHigh, "after 按 order 升序排列，且梨园覆盖片稳居全包最末端");
});

