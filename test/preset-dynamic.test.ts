import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadPresetDoc } from "../src/preset-doc.ts";
import {
	applyHistoryInjections,
	buildStageInjection,
	buildStageSystemPrompt,
	readShippedRpSystemProtocol,
} from "../src/stage/assemble.ts";
import { assembleLiyuanPresetDynamic } from "../src/stage/preset-dynamic.ts";
import { readScriptScopeVarsSync, ScriptApiService, type ScriptApiHost } from "../src/script-api.ts";
import { defaultState } from "../src/state.ts";
import { DEFAULT_CONFIG, type CharacterCard, type RpConfig } from "../src/types.ts";
import { StageEngine } from "../src/stage/engine.ts";
import { fauxAssistantMessage } from "@liyuan/ai/providers/faux";
import { registerFauxProvider } from "@liyuan/ai/compat";
import { DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, createAgentSession } from "@liyuan/agent-runtime";
import roleplayExtension from "../.liyuan/extensions/roleplay.ts";

const sampleCard: CharacterCard = {
	name: "测试角色",
	description: "UNIQUE_CARD_DESC_MARKER",
	personality: "UNIQUE_CARD_PERSONALITY_MARKER",
	scenario: "UNIQUE_CARD_SCENARIO_MARKER",
	mesExample: "UNIQUE_CARD_MES_EXAMPLE",
	firstMes: "开场。",
	alternateGreetings: [],
	systemPrompt: "UNIQUE_CARD_SYSTEM_OVERRIDE",
	postHistoryInstructions: "UNIQUE_CARD_POST_HISTORY",
	creatorNotes: "",
	tags: [],
	book: [],
};

test("assembleLiyuanPresetDynamic：无预设时不注入多余片段且保持 extensionPrompts", async () => {
	const res = await assembleLiyuanPresetDynamic({
		card: sampleCard,
		presetDoc: null,
		userName: "测试玩家",
		history: [],
		userText: "我推开门。",
		extensionPrompts: [{ id: "ext-1", placement: "depth", role: "system", text: "扩展片段", depth: 1 }],
	});
	assert.equal(res.fragments.length, 1);
	assert.equal(res.fragments[0]!.id, "ext-1");
});

const realPresets = [
	"Meowssiah_1.9.12.json",
	"我即浪潮-1109-Amour.json",
	"梦鲸思客V5-1030-exp.json",
	"[主预设]-V19.7.7-狐神抚-·-毓忻.json",
	"双人成行v10.0—青云上-(1).json",
	"TGbreak😺V2.1.6.json",
	"Ny-Gemini-1.4.5_SogonSigon_1.json",
];

for (const file of realPresets) {
	test(`assembleLiyuanPresetDynamic 实测真实预设：${file}`, async (t) => {
		const path = join(process.cwd(), "assets", "presets", file);
		if (!existsSync(path)) {
			t.skip(`缺少测试预设文件：${file}`);
			return;
		}
		const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		const doc = loadPresetDoc(raw, file.replace(/\.json$/i, ""));
		const userInputSentinel = "UNIQUE_USER_TURN_INPUT_987654";

		const dyn = await assembleLiyuanPresetDynamic({
			card: sampleCard,
			presetDoc: doc,
			userName: "测试玩家",
			history: [
				{ role: "assistant", text: "开场白。" },
				{ role: "user", text: userInputSentinel },
			],
			userText: userInputSentinel,
		});

		const config: RpConfig = { ...DEFAULT_CONFIG, userName: "测试玩家", userPersona: "UNIQUE_USER_PERSONA" };
		const sp = buildStageSystemPrompt({
			card: sampleCard,
			config,
			constantLore: [],
			rpSystemProtocol: readShippedRpSystemProtocol(),
			extraSystemFragments: dyn.fragments.filter((f) => f.placement === "system").map((f) => f.text),
		});
		const inj = buildStageInjection({
			state: defaultState(),
			activatedLore: [],
			card: sampleCard,
			config,
		});
		const msgs = applyHistoryInjections(
			[{ role: "assistant", text: "开场白。" }],
			`${inj}\n\n${userInputSentinel}`,
			dyn.fragments,
			{ tailHasUserMessage: true },
		);

		const presetOnlyText = dyn.fragments.map((f) => f.text).join("\n");

		// 1. 不得把卡字段/用户人设重复塞进预设块
		assert.equal(presetOnlyText.includes("UNIQUE_CARD_DESC_MARKER"), false, `${file} 不应回填卡描述`);
		assert.equal(presetOnlyText.includes("UNIQUE_USER_PERSONA"), false, `${file} 不应回填用户人设`);
		assert.equal(presetOnlyText.includes("UNIQUE_CARD_SYSTEM_OVERRIDE"), false, `${file} 不应覆盖 main`);
		assert.equal(presetOnlyText.includes("UNIQUE_CARD_POST_HISTORY"), false, `${file} 不应覆盖 jailbreak`);

		// 2. 本轮用户输入原文只能出现 1 次（在 tailText）
		const fullMsgsText = msgs.map((m) => m.text).join("\n");
		const occurrences = fullMsgsText.split(userInputSentinel).length - 1;
		assert.equal(occurrences, 1, `${file} 用户原话只能出现 1 次（实测 ${occurrences} 次）`);

		// 3. 不得残留空 marker 外壳与假工具协议暗号
		assert.equal(presetOnlyText.includes("以下是梦境卡的设定："), false, `${file} 不得留空 <dream_setting> 外壳`);
		assert.equal(presetOnlyText.includes("</dream_setting>"), false, `${file} 不得留空 </dream_setting>`);
		assert.equal(presetOnlyText.includes("<World_Lore_Database>"), false, `${file} 不得留空世界书外壳`);
		assert.equal(presetOnlyText.includes("<User_Prefs>"), false, `${file} 不得留空 User_Prefs`);
		assert.equal(presetOnlyText.includes("<<<|catgodml|"), false, `${file} 不得残留 SPreset 暗号`);
		assert.equal(presetOnlyText.includes("<run_tool_replacement>"), false, `${file} 不得残留 <run_tool_replacement>`);
		assert.equal(presetOnlyText.includes("soliumbra_reply"), false, `${file} 不得残留 soliumbra_reply`);
		assert.equal(presetOnlyText.includes("wave_context_reference"), false, `${file} 不得残留 wave_context_reference`);
		assert.equal(presetOnlyText.includes("无需调用工具"), false, `${file} 不得残留假工具"无需调用工具"句`);
		assert.equal(presetOnlyText.includes("WAVE_CONTEXT_BEGIN"), false, `${file} 不得残留搬运定界符`);
		assert.equal(presetOnlyText.includes("压缩相邻消息::"), false, `${file} 不得残留未解析扩展占位宏`);

		// 4. system 含 RP 协议，且末尾最后一段必须是梨园最高优先级覆盖协议
		assert.ok(sp.includes("梨园扮演 Agent 引擎协议"), `${file} systemPrompt 含 RP 协议`);
		const lastMsg = msgs[msgs.length - 1]!;
		assert.equal(lastMsg.role, "user", `${file} 末条不能是 assistant 预填`);
		assert.ok(lastMsg.text.trimEnd().endsWith("虚构预设工具。"), `${file} 末条最尾端必须是【梨园引擎输出协议】`);
	});
}

test("ScriptApiService.preset.preview 支持 mode='liyuan' 完整返回动态装配与统计", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-preview-ly-"));
	try {
		mkdirSync(join(cwd, "assets", "presets"), { recursive: true });
		mkdirSync(join(cwd, "assets", "cards"), { recursive: true });
		writeFileSync(
			join(cwd, "assets", "cards", "c.json"),
			JSON.stringify({ data: { name: "师姐", description: "清冷师姐", first_mes: "你来了。" } }),
		);
		writeFileSync(
			join(cwd, "assets", "presets", "p.json"),
			JSON.stringify({
				prompts: [
					{ identifier: "main", name: "主提示", role: "system", content: "文风要求：简练。{{setvar::tone::清冷}}" },
					{ identifier: "charDescription", name: "Char Description", marker: true, role: "system", content: "" },
					{ identifier: "chatHistory", name: "Chat History", marker: true, role: "system", content: "" },
					{ identifier: "jailbreak", name: "尾规矩", role: "system", content: "语气：{{getvar::tone}}。不要写多余解释。" },
					{ identifier: "prefill", name: "预填", role: "assistant", content: "OUTPUT:" },
				],
				prompt_order: [
					{
						character_id: 100001,
						order: [
							{ identifier: "main", enabled: true },
							{ identifier: "charDescription", enabled: true },
							{ identifier: "chatHistory", enabled: true },
							{ identifier: "jailbreak", enabled: true },
							{ identifier: "prefill", enabled: true },
						],
					},
				],
			}),
		);
		writeFileSync(
			join(cwd, "liyuan.config.json"),
			JSON.stringify({ card: "assets/cards/c.json", preset: "assets/presets/p.json", userName: "沈舟" }),
		);

		const mockHost = {
			cwd,
			getConfig: (): RpConfig => ({
				...DEFAULT_CONFIG,
				card: "assets/cards/c.json",
				preset: "assets/presets/p.json",
				userName: "沈舟",
			}),
			getTarget: () => ({
				card: "assets/cards/c.json",
				cardName: "师姐",
				charName: "师姐",
				userName: "沈舟",
				chatId: null,
				sessionId: "s1",
				leafId: null,
				mode: "roleplay" as const,
				streaming: false,
			}),
			getMessages: () => [],
			getCurrentChatDir: () => null,
		} as unknown as ScriptApiHost;

		const api = new ScriptApiService(mockHost);
		const resp = await api.invoke({
			action: "preset.preview",
			params: { userText: "我推门而入。" },
		});
		assert.equal(resp.ok, true);
		const result = resp.result as {
			systemPrompt: string;
			messages: Array<{ role: string; text: string }>;
			stats: { skippedMarkers: number };
		};
		assert.equal(result.stats.skippedMarkers, 1);
		assert.ok(result.systemPrompt.includes("文风要求：简练。"));
		assert.ok(result.systemPrompt.includes("梨园扮演 Agent 引擎协议"));
		const tail = result.messages[result.messages.length - 1]!;
		assert.equal(tail.role, "user");
		assert.ok(tail.text.includes("语气：清冷。不要写多余解释。"));
		assert.ok(tail.text.includes("【梨园引擎输出协议｜最高优先级】"));
		assert.ok(!tail.text.includes("OUTPUT:"));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("StageEngine 自动注入动态预设投影、RP_SYSTEM.md、末端覆盖块并落盘脏变量", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-engine-dyn-"));
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		mkdirSync(join(cwd, "assets", "cards"), { recursive: true });
		mkdirSync(join(cwd, "assets", "presets"), { recursive: true });
		writeFileSync(join(cwd, "assets", "cards", "c.json"), JSON.stringify({ data: { name: "云澜", description: "师姐。", first_mes: "开场。" } }));
		writeFileSync(
			join(cwd, "assets", "presets", "p.json"),
			JSON.stringify({
				prompts: [
					{ identifier: "s1", name: "前段", role: "system", content: "DYNAMIC_SYS_WORD{{setvar::k::v1}}" },
					{ identifier: "u1", name: "对话唤醒", role: "user", content: "DYNAMIC_PRE_USER" },
					{ identifier: "a1", name: "对话承诺", role: "assistant", content: "DYNAMIC_PRE_ASST" },
					{ identifier: "chatHistory", name: "Chat History", marker: true, role: "system", content: "" },
					{ identifier: "j1", name: "后段", role: "system", content: "DYNAMIC_AFTER_VAL={{getvar::k}}" },
					{ identifier: "pf", name: "预填", role: "assistant", content: "SHOULD_BE_DROPPED" },
				],
				prompt_order: [
					{
						character_id: 100001,
						order: [
							{ identifier: "s1", enabled: true },
							{ identifier: "u1", enabled: true },
							{ identifier: "a1", enabled: true },
							{ identifier: "chatHistory", enabled: true },
							{ identifier: "j1", enabled: true },
							{ identifier: "pf", enabled: true },
						],
					},
				],
			}),
		);
		writeFileSync(
			join(cwd, "liyuan.config.json"),
			JSON.stringify({ card: "assets/cards/c.json", preset: "assets/presets/p.json", userName: "沈舟" }),
		);

		const sm = SessionManager.inMemory(cwd);
		const model = reg.getModel("faux-rp");
		const agentDir = join(cwd, ".pi-test");
		mkdirSync(agentDir, { recursive: true });
		const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null });
		modelRuntime.registerProvider(String(model.provider), { api: model.api, baseUrl: model.baseUrl, apiKey: "faux-key", models: [model as never] });
		await modelRuntime.setRuntimeApiKey(String(model.provider), "faux-key");
		const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			extensionFactories: [roleplayExtension],
		});
		await loader.reload();
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			modelRuntime,
			settingsManager,
			resourceLoader: loader,
			sessionManager: sm,
			model: model as never,
			thinkingLevel: "off",
			noTools: "builtin",
		});
		await session.bindExtensions({ mode: "rpc", onError: () => {} });

		let seenSys = "";
		let seenMsgs: Array<{ role: string; text: string }> = [];
		const engine = new StageEngine({
			cwd,
			getSession: () => session as never,
			getModel: () => session.model as never,
			getAuth: async () => ({ apiKey: "faux-key" }),
			getThinking: () => "off",
		});

		reg.setResponses([
			(ctx) => {
				seenSys = String(ctx.systemPrompt ?? "");
				seenMsgs = (ctx.messages as Array<{ role: string; content: Array<{ text?: string }> }>).map((m) => ({
					role: m.role,
					text: m.content.map((c) => c.text ?? "").join(""),
				}));
				return fauxAssistantMessage("云澜抬眼看向你。");
			},
			fauxAssistantMessage('{"patch":{}}'),
		]);

		try {
			const end = await engine.performTurn("我推开门走进去。");
			assert.equal(end.error, undefined);
			assert.ok(seenSys.includes("梨园扮演 Agent 引擎协议"), "RP_SYSTEM 协议已进 systemPrompt");
			assert.ok(seenSys.includes("DYNAMIC_SYS_WORD"), "before system 动态段已进 systemPrompt");
			assert.equal(seenMsgs[0]!.role, "user");
			assert.equal(seenMsgs[0]!.text, "DYNAMIC_PRE_USER");
			assert.equal(seenMsgs[1]!.role, "assistant");
			assert.equal(seenMsgs[1]!.text, "DYNAMIC_PRE_ASST");

			const lastMsg = seenMsgs[seenMsgs.length - 1]!;
			assert.equal(lastMsg.role, "user");
			assert.ok(lastMsg.text.includes("DYNAMIC_AFTER_VAL=v1"), "after 宏动态展开生效");
			assert.ok(lastMsg.text.includes("【梨园引擎输出协议｜最高优先级】"), "最高权重覆盖协议落在末端");
			assert.equal(lastMsg.text.includes("SHOULD_BE_DROPPED"), false, "预设末尾预填已剥除");

			const savedChatVars = readScriptScopeVarsSync(cwd, null, sm.getSessionId(), "assets/cards/c.json", "chat", "p");
			assert.equal(savedChatVars.k, "v1", "预设 setvar 已落盘");

			// 验证 setRuntimeInjections 跨拍注入与用完即焚
			engine.setRuntimeInjections([
				{ id: "rt-sys", role: "system", position: "before_prompt", content: "RUNTIME_BEFORE_SYS" },
				{ id: "rt-depth", role: "user", position: "in_chat", depth: 1, order: 50, content: "RUNTIME_IN_CHAT_D1" },
				{ id: "rt-after", role: "system", position: "in_prompt", order: 20, content: "RUNTIME_IN_PROMPT_AFTER" },
			]);
			reg.setResponses([
				(ctx) => {
					seenSys = String(ctx.systemPrompt ?? "");
					seenMsgs = (ctx.messages as Array<{ role: string; content: Array<{ text?: string }> }>).map((m) => ({
						role: m.role,
						text: m.content.map((c) => c.text ?? "").join(""),
					}));
					return fauxAssistantMessage("第二拍回复。");
				},
				fauxAssistantMessage('{"patch":{}}'),
			]);
			await engine.performTurn("第二拍输入。");
			assert.ok(seenSys.includes("RUNTIME_BEFORE_SYS"), "before_prompt 运行期片段进入 systemPrompt");
			assert.ok(seenMsgs.some((m) => m.text.includes("RUNTIME_IN_CHAT_D1")), "in_chat depth=1 运行期片段进入历史流");
			assert.ok(seenMsgs[seenMsgs.length - 1]!.text.includes("RUNTIME_IN_PROMPT_AFTER"), "in_prompt 运行期片段进入尾部且仍位于覆盖协议之前");
		} finally {
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			session.dispose();
		}
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

