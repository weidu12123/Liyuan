import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, test } from "node:test";

import {
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	createAgentSession,
	type AgentSession,
} from "@liyuan/agent-runtime";
import { fauxAssistantMessage } from "@liyuan/ai/providers/faux";
import { getModel, registerFauxProvider, streamSimple } from "@liyuan/ai/compat";

import roleplayExtension from "../.liyuan/extensions/roleplay.ts";
import { loadCardFile } from "../src/card.ts";
import { normalizeEntries } from "../src/lorebook.ts";
import { loadPresetDoc } from "../src/preset-doc.ts";
import { StageEngine, type StageEngineDeps, type StageStreamFn } from "../src/stage/engine.ts";
import { assemblePureTavern } from "../src/stage/pure-tavern.ts";
import type { CharacterCard } from "../src/types.ts";
import { localCards, localPresets } from "./fixtures.ts";

const SANDBOX_AGENT_DIR = realpathSync(mkdtempSync(join(tmpdir(), "liyuan-pure-agent-")));
process.env.LIYUAN_CODING_AGENT_DIR = SANDBOX_AGENT_DIR;
after(() => rmSync(SANDBOX_AGENT_DIR, { recursive: true, force: true }));

const sessions: AgentSession[] = [];
const hookErrors: string[] = [];
afterEach(async () => {
	for (const session of sessions.splice(0)) {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
	}
	assert.deepEqual(hookErrors.splice(0), [], "真实 pi 扩展不得静默丢钩子");
});

async function makePiEngine(deps: Omit<StageEngineDeps, "getSession"> & { sessionManager: SessionManager; agentDir: string }) {
	const selected = deps.getModel() ?? getModel("anthropic", "claude-sonnet-4-5");
	const modelRuntime = await ModelRuntime.create({ authPath: join(deps.agentDir, "auth.json"), modelsPath: null });
	modelRuntime.registerProvider(String(selected!.provider), {
		api: selected!.api,
		baseUrl: selected!.baseUrl,
		apiKey: "test-key",
		models: [selected as never],
	});
	await modelRuntime.setRuntimeApiKey(String(selected!.provider), "test-key");
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const resourceLoader = new DefaultResourceLoader({
		cwd: deps.cwd,
		agentDir: deps.agentDir,
		settingsManager,
		extensionFactories: [roleplayExtension],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: deps.cwd,
		agentDir: deps.agentDir,
		modelRuntime,
		settingsManager,
		resourceLoader,
		sessionManager: deps.sessionManager,
		model: selected as never,
		thinkingLevel: "off",
		noTools: "builtin",
	});
	await session.bindExtensions({ mode: "rpc", onError: (event) => hookErrors.push(`${event.event}: ${event.error}`) });
	session.agent.streamFunction = streamSimple as never;
	sessions.push(session);
	return new StageEngine({ ...deps, getSession: () => session as never });
}

test("assemblePureTavern：1:1 复现 ST marker、worldInfo position、EJS/宏/持久变量与 before 角色切分", async () => {
	const card: CharacterCard = {
		name: "云澜",
		description: "青云剑宗大师姐，对{{user}}表面严厉。",
		personality: "外冷内热",
		scenario: "深夜演武场",
		firstMes: "你来晚了。",
		mesExample: "<START>\n{{user}}: 师姐。\n{{char}}: 拔剑吧。",
		systemPrompt: "卡主系统覆盖：只写第二人称动作。",
		postHistoryInstructions: "卡末端覆盖：保持古风修仙用语。",
		creatorNotes: "",
		alternateGreetings: [],
		tags: [],
		book: [],
	};

	const rawPreset = {
		temperature: 0.85,
		wi_format: "[World]\n{0}\n[/World]",
		scenario_format: "[Scene: {{scenario}}]",
		personality_format: "[Persona: {{personality}}]",
		new_example_chat_prompt: "[Sample]",
		prompts: [
			{ identifier: "main", name: "Main", role: "system", content: "默认主指令", system_prompt: true },
			{ identifier: "vars", name: "Vars", role: "system", content: "{{setvar::tone::清冷}}{{// 注释剥除}}" },
			{ identifier: "worldInfoBefore", name: "World Info (before)", marker: true },
			{ identifier: "charDescription", name: "Char Description", marker: true },
			{ identifier: "charPersonality", name: "Char Personality", marker: true },
			{ identifier: "scenario", name: "Scenario", marker: true },
			{ identifier: "worldInfoAfter", name: "World Info (after)", marker: true },
			{ identifier: "personaDescription", name: "Persona", marker: true },
			{ identifier: "dialogueExamples", name: "Examples", marker: true },
			{
				identifier: "beforeUserExample",
				name: "历史前示例user",
				role: "user",
				content: "前导示例对话：口令={{getglobalvar::sleep_var_zishu_define}}；出口={{outlet::customSlot}}",
			},
			{
				identifier: "beforeSystemAfterUser",
				name: "user之后的before系统块",
				role: "system",
				content: "这条跟在历史前 user 之后，文风：{{getvar::tone}}",
			},
			{ identifier: "chatHistory", name: "Chat History", marker: true },
			{
				identifier: "deepPreset",
				name: "预设深度块",
				role: "system",
				content: "预设深度提醒D1",
				injection_position: 1,
				injection_depth: 1,
				injection_order: 200,
			},
			{ identifier: "jailbreak", name: "Jailbreak", role: "system", content: "默认越狱" },
			{ identifier: "prefill", name: "Pre-fill", role: "assistant", content: "<think>" },
		],
		prompt_order: [
			{
				character_id: 100001,
				order: [
					{ identifier: "main", enabled: true },
					{ identifier: "vars", enabled: true },
					{ identifier: "worldInfoBefore", enabled: true },
					{ identifier: "charDescription", enabled: true },
					{ identifier: "charPersonality", enabled: true },
					{ identifier: "scenario", enabled: true },
					{ identifier: "worldInfoAfter", enabled: true },
					{ identifier: "personaDescription", enabled: true },
					{ identifier: "dialogueExamples", enabled: true },
					{ identifier: "beforeUserExample", enabled: true },
					{ identifier: "beforeSystemAfterUser", enabled: true },
					{ identifier: "chatHistory", enabled: true },
					{ identifier: "deepPreset", enabled: true },
					{ identifier: "jailbreak", enabled: true },
					{ identifier: "prefill", enabled: true },
				],
			},
		],
	};

	const loreEntries = normalizeEntries([
		{ uid: 1, key: [], constant: true, enabled: true, position: 0, order: 10, comment: "前世界观", content: "九州灵气复苏。" },
		{ uid: 2, key: [], constant: true, enabled: true, position: 1, order: 20, comment: "后世界观", content: "宗门禁地不得擅入。" },
		{
			uid: 3,
			key: [],
			constant: true,
			enabled: true,
			position: 4,
			depth: 1,
			role: 1,
			order: 100,
			comment: "世界书@D1",
			content: "世界书D1用户提醒（应排在preset order=200之前）",
		},
		{ uid: 4, key: [], constant: true, enabled: true, position: 5, order: 10, comment: "示例前", content: "以下为师姐口吻：" },
		{ uid: 5, key: [], constant: true, enabled: true, position: 7, outletName: "customSlot", content: "千字精简" },
		{
			uid: 6,
			key: [],
			constant: true,
			enabled: true,
			position: 0,
			order: 30,
			comment: "EJS动态世界书",
			content: "<%- await getwi(null, '隐藏玄天设定') %>",
		},
		{ uid: 7, key: [], constant: false, enabled: false, position: 0, comment: "隐藏玄天设定", content: "玄天界九大宗门详情。" },
	]);

	const res = await assemblePureTavern({
		card,
		presetDoc: loadPresetDoc(rawPreset, "测试预设"),
		loreEntries,
		allLoreEntries: loreEntries,
		userName: "沈舟",
		userPersona: "外门新弟子",
		history: [
			{ role: "assistant", text: "你来晚了。" },
			{ role: "user", text: "弟子知错。" },
		],
		userText: "弟子知错。",
		scanDepth: 4,
		maxLoreInjections: 3,
		globalVars: { sleep_var_zishu_define: "1800字" },
	});

	// systemPrompt 含卡覆盖后的 main + 全部 marker + EJS getwi 展开内容，且不含梨园任何文字
	assert.ok(res.systemPrompt.includes("卡主系统覆盖：只写第二人称动作。"));
	assert.ok(!res.systemPrompt.includes("默认主指令"));
	assert.ok(res.systemPrompt.includes("[World]\n九州灵气复苏。\n玄天界九大宗门详情。\n[/World]"));
	assert.ok(res.systemPrompt.includes("青云剑宗大师姐，对沈舟表面严厉。"));
	assert.ok(res.systemPrompt.includes("[Persona: 外冷内热]"));
	assert.ok(res.systemPrompt.includes("[Scene: 深夜演武场]"));
	assert.ok(res.systemPrompt.includes("宗门禁地不得擅入。"));
	assert.ok(res.systemPrompt.includes("外门新弟子"));
	assert.ok(res.systemPrompt.includes("以下为师姐口吻：\n\n[Sample]\n沈舟: 师姐。\n云澜: 拔剑吧。"));
	assert.ok(!res.systemPrompt.includes("【世界状态】") && !res.systemPrompt.includes("消息流约定"));

	// before 中首个非 system 块及后续块落入历史最前方
	assert.equal(res.messages[0]?.role, "user");
	assert.ok(res.messages[0]?.text.includes("口令=1800字；出口=千字精简"));
	assert.ok(res.messages[0]?.text.includes("这条跟在历史前 user 之后，文风：清冷"));

	// 历史对话与深度注入 order 升序（worldbook order=100 在 preset order=200 之前）
	const d1Msg = res.messages.find((m) => m.text.includes("世界书D1用户提醒"));
	assert.ok(d1Msg);
	const wiD1Pos = d1Msg.text.indexOf("世界书D1用户提醒");
	const presetD1Pos = d1Msg.text.indexOf("预设深度提醒D1");
	assert.ok(wiD1Pos >= 0 && presetD1Pos > wiD1Pos, "同 depth=1 下 order=100 应先于 order=200");

	// 本拍纯粹用户原话 + 卡覆盖 jailbreak + 末尾 assistant 预填安全记录
	const tailMsg = res.messages.find((m) => m.isTail);
	assert.ok(tailMsg && tailMsg.text.includes("弟子知错。"));
	assert.ok(!tailMsg.text.includes("【世界状态】"));
	assert.ok(res.messages.some((m) => m.text.includes("卡末端覆盖：保持古风修仙用语。")));
	assert.deepEqual(
		res.droppedPrefills.map((d) => d.id),
		["prefill"],
	);
});

test("StageEngine + roleplayExtension 在 presetMode='pure' 下：彻底旁路 SYSTEM.md / APPEND_SYSTEM.md / AGENTS.md / 工具 / 场记", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-pure-stage-"));
	const agentDir = join(cwd, ".pi-agent");
	try {
		mkdirSync(join(cwd, ".liyuan"), { recursive: true });
		mkdirSync(join(cwd, "assets", "presets"), { recursive: true });
		mkdirSync(join(cwd, "cards", "云澜"), { recursive: true });
		mkdirSync(agentDir, { recursive: true });

		// 故意塞入梨园各级静态提示词，验证纯酒馆模式下它们一字不许出现
		writeFileSync(join(agentDir, "SYSTEM.md"), "LIYUAN_SYSTEM_SENTINEL", "utf8");
		writeFileSync(join(agentDir, "APPEND_SYSTEM.md"), "LIYUAN_GLOBAL_APPEND_SENTINEL", "utf8");
		writeFileSync(join(cwd, "cards", "云澜", "AGENTS.md"), "## 卡档案\n\nLIYUAN_CARD_AGENTS_SENTINEL\n", "utf8");
		writeFileSync(
			join(cwd, "cards", "云澜", "云澜.json"),
			JSON.stringify({
				data: {
					name: "云澜",
					description: "卡描述：持剑而立。",
					first_mes: "请出招。",
					character_book: {
						entries: [{ id: 1, keys: [], constant: true, enabled: true, position: "before_char", content: "内嵌世界书条目" }],
					},
				},
			}),
			"utf8",
		);
		writeFileSync(
			join(cwd, "assets", "presets", "PureTest.json"),
			JSON.stringify({
				temperature: 0.72,
				prompts: [
					{ identifier: "main", name: "Main", role: "system", content: "酒馆主指令-{{char}}-{{user}}" },
					{ identifier: "worldInfoBefore", name: "WI Before", marker: true },
					{ identifier: "charDescription", name: "Char Desc", marker: true },
					{ identifier: "chatHistory", name: "Chat History", marker: true },
					{ identifier: "afterRule", name: "After", role: "system", content: "酒馆末尾规则" },
				],
				prompt_order: [
					{
						character_id: 100001,
						order: [
							{ identifier: "main", enabled: true },
							{ identifier: "worldInfoBefore", enabled: true },
							{ identifier: "charDescription", enabled: true },
							{ identifier: "chatHistory", enabled: true },
							{ identifier: "afterRule", enabled: true },
						],
					},
				],
			}),
			"utf8",
		);
		writeFileSync(
			join(cwd, "liyuan.config.json"),
			JSON.stringify({
				card: "cards/云澜/云澜.json",
				preset: "assets/presets/PureTest.json",
				presetMode: "pure",
				userName: "沈舟",
			}),
			"utf8",
		);

		const sm = SessionManager.create(cwd, join(cwd, "sessions"));
		const reg = registerFauxProvider({ models: [{ id: "faux-pure" }] });
		let capturedCtx: { systemPrompt?: string; messages?: Array<{ role: string; content: unknown }>; tools?: unknown[] } | null = null;
		let sideCalls = 0;

		try {
			// 只给 1 条回复（无场记回复）：若场记被错误触发就会因响应耗尽直接报错
			reg.setResponses([
				((ctx: unknown) => {
					capturedCtx = ctx as typeof capturedCtx;
					return fauxAssistantMessage("云澜举剑回礼。");
				}) as never,
			]);

			const engine = await makePiEngine({
				cwd,
				agentDir,
				sessionManager: sm,
				getModel: () => reg.getModel("faux-pure") as never,
				getAuth: async () => ({}),
				sideStreamFn: ((..._args: unknown[]) => {
					sideCalls++;
					return streamSimple(...(_args as Parameters<typeof streamSimple>));
				}) as unknown as StageStreamFn,
			});

			const res = await engine.performTurn("我拱手致意。");
			assert.equal(res.error, undefined);
			assert.equal(sideCalls, 0, "纯酒馆模式不得触发后台场记或压缩");
			assert.ok(capturedCtx, "应捕获发往模型的上下文");
			assert.equal(capturedCtx!.tools?.length ?? 0, 0, "纯酒馆模式必须为 0 工具直出");

			const sys = capturedCtx!.systemPrompt ?? "";
			assert.ok(sys.includes("酒馆主指令-云澜-沈舟"));
			assert.ok(sys.includes("内嵌世界书条目"));
			assert.ok(sys.includes("卡描述：持剑而立。"));
			assert.ok(!sys.includes("LIYUAN_SYSTEM_SENTINEL"), "不得混入 SYSTEM.md");
			assert.ok(!sys.includes("LIYUAN_GLOBAL_APPEND_SENTINEL"), "不得混入 APPEND_SYSTEM.md");
			assert.ok(!sys.includes("LIYUAN_CARD_AGENTS_SENTINEL"), "不得混入 AGENTS.md");
			assert.ok(!sys.includes("消息流约定"), "不得混入梨园消息流约定");

			const msgText = JSON.stringify(capturedCtx!.messages ?? []);
			assert.ok(msgText.includes("我拱手致意。"));
			assert.ok(msgText.includes("酒馆末尾规则"));
			assert.ok(!msgText.includes("【世界状态】"), "不得混入梨园动态事实块");
			assert.ok(!msgText.includes("【设定集索引】"));

			const branch = sm.getBranch() as Array<{ type: string; customType?: string; message?: { role?: string; content?: Array<{ text?: string }> } }>;
			assert.ok(!branch.some((e) => e.type === "custom" && e.customType === "rp-state"), "不得写入 rp-state");
			const asst = branch.find((e) => e.type === "message" && e.message?.role === "assistant");
			assert.equal(asst?.message?.content?.[0]?.text, "云澜举剑回礼。");
		} finally {
			reg.unregister();
		}
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("实卡实预设报文验证：对本地真实大预设（非小白X）跑通纯酒馆从零拼接", async () => {
	const presets = localPresets().filter((p) => !/Ny-|夏瑾/i.test(p.name));
	const cards = localCards();
	if (presets.length === 0 || cards.length === 0) return;

	const cardPath = cards[0]!.path;
	const card = loadCardFile(cardPath);

	for (const p of presets.slice(0, 5)) {
		const raw = JSON.parse(readFileSync(p.path, "utf8")) as Record<string, unknown>;
		const doc = loadPresetDoc(raw, p.name);
		const r = await assemblePureTavern({
			card,
			presetDoc: doc,
			loreEntries: card.book,
			allLoreEntries: card.book,
			userName: "旅人",
			userPersona: "游历修士",
			history: [
				{ role: "assistant", text: card.firstMes || "你好。" },
				{ role: "user", text: "你好，请自我介绍一下。" },
			],
			userText: "你好，请自我介绍一下。",
			scanDepth: 4,
			maxLoreInjections: 3,
			globalVars: { sleep_var_zishu_define: "1200字" },
		});
		assert.ok(r.systemPrompt.length > 0 || r.messages.length > 0, `预设 ${p.name} 应产出有效送模内容`);
		assert.ok(!r.systemPrompt.includes("【世界状态】"), `预设 ${p.name} 不得含梨园注入块`);
		assert.ok(
			r.markers.some((m) => m.id === "chatHistory"),
			`预设 ${p.name} 应经过 chatHistory 边界切分`,
		);
	}
});
