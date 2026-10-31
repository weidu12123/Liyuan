import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, test } from "node:test";

import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
} from "@liyuan/agent-runtime";
import { registerFauxProvider, streamSimple } from "@liyuan/ai/compat";
import { fauxAssistantMessage, fauxThinking, fauxToolCall } from "@liyuan/ai/providers/faux";

import roleplayExtension from "../.liyuan/extensions/roleplay.ts";
import { createBtwRunner } from "../server/btw.ts";
import { cardProjectOperation } from "../src/card-authoring.ts";
import { seedBashDenylist } from "../src/bash-denylist.ts";
import { btwSystemPrompt, buildBtwStageBlock, prependToFirstUser } from "../src/stage/btw.ts";
import { StageEngine, type StageStreamFn } from "../src/stage/engine.ts";
import { defaultState } from "../src/state.ts";

const TEST_AGENT_DIR = realpathSync(mkdtempSync(join(tmpdir(), "liyuan-btw-agent-")));
process.env.LIYUAN_CODING_AGENT_DIR = TEST_AGENT_DIR;
seedBashDenylist(TEST_AGENT_DIR);
after(() => rmSync(TEST_AGENT_DIR, { recursive: true, force: true }));

const activeSessions: AgentSession[] = [];
afterEach(async () => {
	for (const s of activeSessions.splice(0)) {
		await s.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		s.dispose();
	}
});

test("btw 提示词与视野块：自定义与空缺回退、不混入卡级酒馆预设、首条浅拷贝不污染原消息", () => {
	const fallback = btwSystemPrompt({
		cwd: "/workspace",
		cardPath: "cards/云澜/云澜.json",
		chatDir: "/workspace/cards/云澜/对话/chat-1",
		userRules: {
			global: "GLOBAL_RP_ONLY_SENTINEL",
			agent: "AGENT_MODE_ONLY_SENTINEL",
			btw: "   ",
			card: "CARD_TAVERN_PRESET_SENTINEL",
			chat: "PROJECT_LOCAL_RULE_SENTINEL",
		},
		chatMemoryIndex: "- [旧约](旧约.md) — {{char}}与{{user}}的约定",
		cardAgents: "# 角色：{{char}}",
		macro: { charName: "云澜", userName: "沈舟" },
	});
	assert.match(fallback, /# 旁路助手/, "btw 槽空缺时回退随包 BTW_APPEND_SYSTEM.md");
	assert.match(fallback, /PROJECT_LOCAL_RULE_SENTINEL/, "拼入项目级局部守则");
	assert.match(fallback, /云澜与沈舟的约定/, "拼入项目记忆索引并展开宏");
	assert.match(fallback, /# 角色：云澜/, "拼入卡档案 AGENTS.md");
	assert.doesNotMatch(fallback, /CARD_TAVERN_PRESET_SENTINEL/, "不混入卡级 APPEND_SYSTEM.md（防酒馆文风预设串味）");
	assert.doesNotMatch(fallback, /GLOBAL_RP_ONLY_SENTINEL|AGENT_MODE_ONLY_SENTINEL/, "不混入其他模式的全局追加槽");

	const custom = btwSystemPrompt({
		cwd: "/workspace",
		cardPath: "cards/云澜/云澜.json",
		userRules: { global: "", agent: "", btw: "CUSTOM_SHARP_CRITIC_STYLE", card: "" },
		macro: { charName: "云澜", userName: "沈舟" },
	});
	assert.match(custom, /CUSTOM_SHARP_CRITIC_STYLE/, "自定义 BTW_APPEND_SYSTEM.md 生效");
	assert.doesNotMatch(custom, /# 旁路助手/, "自定义非空时替换随包默认");

	const block = buildBtwStageBlock({
		state: defaultState(),
		summary: "两人初遇于山门。",
		history: [
			{ role: "user", text: "师姐好。" },
			{ role: "assistant", text: "云澜轻轻颔首。" },
		],
		charName: "云澜",
		userName: "沈舟",
	});
	assert.match(block, /【前情提要】[\s\S]*两人初遇于山门/);
	assert.match(block, /【当前台前剧情】[\s\S]*\[沈舟\]\n师姐好。[\s\S]*\[云澜\]\n云澜轻轻颔首。/);

	const rawMsgs = [
		{ role: "user", content: [{ type: "text", text: "第一问" }] },
		{ role: "assistant", content: [{ type: "text", text: "第一答" }] },
		{ role: "user", content: [{ type: "text", text: "第二问" }] },
	];
	const p1 = prependToFirstUser(rawMsgs, block);
	const p2 = prependToFirstUser(rawMsgs, block);
	assert.equal(rawMsgs[0]!.content[0]!.text, "第一问", "不得原地修改 pi 内存会话中的消息对象");
	assert.equal(JSON.stringify(p1[0]), JSON.stringify(p2[0]), "同一视野下多次装配首条消息字节严格一致");
	assert.ok(p1[0]!.content[0]!.text.endsWith("\n\n第一问"), "首轮用户提问仍在整条消息最末尾");
	assert.equal(p1[2]!.content[0]!.text, "第二问", "后续轮次提问保持原样");
});

test("btw 全链路：读干净台前视野 + 多轮改卡写记忆 + 叉掉即焚 + 主会话树与磁盘零污染 + 沙箱拦截", async () => {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "liyuan-btw-run-")));
	const cardDir = join(cwd, "cards", "云澜");
	const chat1Dir = join(cardDir, "对话", "chat-1");
	const chat1SessDir = join(chat1Dir, "会话");
	const chat2Dir = join(cardDir, "对话", "chat-2");
	mkdirSync(chat1SessDir, { recursive: true });
	mkdirSync(chat2Dir, { recursive: true });
	writeFileSync(join(chat2Dir, "secret.md"), "OTHER_PROJECT_SECRET", "utf8");

	const cardPathRel = "cards/云澜/云澜.json";
	writeFileSync(
		join(cardDir, "云澜.json"),
		JSON.stringify({ data: { name: "云澜", description: "清冷剑修", scenario: "青峰山门", first_mes: "你来了。" } }),
		"utf8",
	);
	writeFileSync(join(cardDir, "APPEND_SYSTEM.md"), "TAVERN_STATUSBAR_NOISE_SENTINEL", "utf8");
	writeFileSync(join(cwd, "liyuan.config.json"), JSON.stringify({ card: cardPathRel, userName: "沈舟", creationMode: "ask" }), "utf8");
	mkdirSync(join(cwd, ".liyuan"), { recursive: true });

	const reg = registerFauxProvider({ models: [{ id: "faux-btw" }] });
	try {
		const model = reg.getModel("faux-btw")!;
		const modelRuntime = await ModelRuntime.create({ authPath: join(TEST_AGENT_DIR, "auth.json"), modelsPath: null });
		modelRuntime.registerProvider(String(model.provider), {
			api: model.api,
			baseUrl: model.baseUrl,
			apiKey: "test-key",
			models: [model as never],
		});
		await modelRuntime.setRuntimeApiKey(String(model.provider), "test-key");
		const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
		const sm = SessionManager.create(cwd, chat1SessDir);
		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir: TEST_AGENT_DIR,
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
			cwd,
			agentDir: TEST_AGENT_DIR,
			modelRuntime,
			settingsManager,
			resourceLoader,
			sessionManager: sm,
			model: model as never,
			thinkingLevel: "off",
		});
		await session.bindExtensions({ mode: "rpc" });
		session.agent.streamFunction = streamSimple as never;
		activeSessions.push(session);

		let softRefreshes = 0;
		const engine = new StageEngine({
			cwd,
			getSession: () => session as never,
			getModel: () => model as never,
			getAuth: async () => ({}),
			sideStreamFn: streamSimple as unknown as StageStreamFn,
			authoring: {
				project: async (args) => cardProjectOperation(cwd, join(cardDir, "云澜.json"), args),
			},
			afterAuthoringTurn: () => {
				softRefreshes++;
			},
		});

		// 1. 台前先演一拍（含思考块），确认旁路只见干净正文、不见思考噪声
		reg.setResponses([
			fauxAssistantMessage([fauxThinking("INTERNAL_STAGE_THINKING_NOISE"), { type: "text", text: "云澜按剑望向山道：「夜深风急，跟紧我。」" }]),
			fauxAssistantMessage(JSON.stringify({ patch: {} })),
		] as never);
		await engine.performTurn("我提灯跟上师姐。");

		const branchBefore = sm.getBranch().length;
		const leafBefore = sm.getLeafId();
		const sessionFilesBefore = readdirSync(chat1SessDir);

		const streamed: string[] = [];
		const toolLogs: string[] = [];
		const btw = createBtwRunner({
			cwd,
			agentDir: TEST_AGENT_DIR,
			stage: engine,
			getServices: () => ({ modelRuntime, settingsManager }),
			getModelState: () => ({ model: session.model, thinkingLevel: session.thinkingLevel }),
			events: {
				onDelta: (kind, d) => {
					if (kind === "text") streamed.push(d);
				},
				onTool: (d) => toolLogs.push(d),
			},
		});

		try {
			// 2. 第 1 轮 /btw：点评剧情 + 读卡面
			let turn1FirstMsg = "";
			let turn1Sys = "";
			reg.setResponses([
				fauxAssistantMessage([fauxToolCall("card_read", {})], { stopReason: "toolUse" }),
				(ctx: { systemPrompt?: string; messages: Array<{ role: string; content: unknown }> }) => {
					turn1Sys = String(ctx.systemPrompt ?? "");
					turn1FirstMsg = JSON.stringify(ctx.messages[0]);
					assert.match(turn1FirstMsg, /夜深风急，跟紧我/, "旁路可见台前已定稿剧情");
					assert.doesNotMatch(turn1FirstMsg, /INTERNAL_STAGE_THINKING_NOISE/, "旁路不见台前思考过程");
					assert.doesNotMatch(turn1Sys, /TAVERN_STATUSBAR_NOISE_SENTINEL/, "旁路不装卡级酒馆文风预设");
					assert.match(JSON.stringify(ctx.messages), /青峰山门/, "card_read 回执已送达");
					return fauxAssistantMessage("这一拍节奏利落，当前卡场景是青峰山门。");
				},
			] as never);
			const r1 = await btw.prompt("点评刚才这一拍，顺便看看卡面场景是什么");
			assert.equal(r1.error, undefined);
			assert.equal(btw.hasSession, true);
			assert.equal(btw.userTurnCount, 1);

			// 3. 第 2 轮 /btw：多轮追问（不含“记住/写入”关键词，验证不被台前 checkWriteGate 误拦）+ 改卡字段 + 写项目记忆 + 沙箱拦截探测
			let turn2FirstMsg = "";
			let sandboxResults = "";
			reg.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("memory_add", { title: "夜巡", text: "沈舟提灯随云澜夜巡山道。" }),
						fauxToolCall("read", { path: "cards/云澜/对话/chat-2/secret.md" }),
						fauxToolCall("write", { path: "cards/云澜/对话/chat-1/会话/hack.jsonl", content: "{}" }),
						fauxToolCall("bash", { command: "rm -rf /" }),
					],
					{ stopReason: "toolUse" },
				),
				(ctx: { messages: Array<{ role: string; content: unknown }> }) => {
					turn2FirstMsg = JSON.stringify(ctx.messages[0]);
					sandboxResults = JSON.stringify(ctx.messages.slice(-4));
					return fauxAssistantMessage("夜巡笔记已落盘，越界操作均被拦截。");
				},
			] as never);
			// 注意：本句不含 WRITE_REQUEST_RE 词表，验证 /btw 不受台前防幻觉门禁误伤
			const r2 = await btw.prompt("挺好，按刚才说的办吧");
			assert.equal(r2.error, undefined);
			assert.equal(btw.userTurnCount, 2);
			assert.equal(turn2FirstMsg, turn1FirstMsg, "同一拍内多轮追问首条消息字节严格不变（命中前缀缓存）");
			assert.ok(existsSync(join(chat1Dir, "记忆", "夜巡.md")), "memory_add 已真实写入当前项目记忆");
			assert.doesNotMatch(sandboxResults, /OTHER_PROJECT_SECRET/, "跨子项目读取被沙箱拦截");
			assert.equal(existsSync(join(chat1SessDir, "hack.jsonl")), false, "会话目录对原生写工具只读");
			assert.match(sandboxResults, /已拦截|不可恢复|不允许|禁止/, "黑名单命令与越界路径返回明确拦截回执");
			assert.ok(softRefreshes >= 2, "每轮结束后触发宿主软刷新");

			// 4. 主会话树与会话目录零污染
			assert.equal(sm.getBranch().length, branchBefore, "主会话树条目数零变化");
			assert.equal(sm.getLeafId(), leafBefore, "主会话叶节点零变化");
			assert.deepEqual(readdirSync(chat1SessDir), sessionFilesBefore, "不产生额外磁盘会话文件");

			// 5. 叉掉即焚（close）+ 磁盘自定义 BTW_APPEND_SYSTEM.md 真实透传 + 无参 ls 默认本卡目录 + card_project 过程回执
			await btw.close();
			assert.equal(btw.hasSession, false);
			assert.equal(btw.userTurnCount, 0);
			assert.ok(existsSync(join(chat1Dir, "记忆", "夜巡.md")), "关闭旁路后已落盘文件完好保留");

			writeFileSync(join(TEST_AGENT_DIR, "BTW_APPEND_SYSTEM.md"), "DISK_CUSTOM_BTW_PROMPT_SENTINEL", "utf8");
			let afterCloseMsgCount = 0;
			let afterCloseSys = "";
			let lsResultText = "";
			reg.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("ls", {}),
						fauxToolCall("card_project", { action: "inspect" }),
					],
					{ stopReason: "toolUse" },
				),
				(ctx: { systemPrompt?: string; messages: unknown[] }) => {
					// messages = [user, assistant(toolCall), toolResult(ls), toolResult(card_project)]
					afterCloseMsgCount = ctx.messages.filter((m) => (m as { role?: string }).role === "user").length;
					afterCloseSys = String(ctx.systemPrompt ?? "");
					lsResultText = JSON.stringify(ctx.messages.slice(-2));
					return fauxAssistantMessage("全新草稿会话。");
				},
			] as never);
			const r3 = await btw.prompt("新问题");
			assert.equal(r3.error, undefined);
			assert.equal(afterCloseMsgCount, 1, "close 后重新提问不再携带旧旁路历史");
			assert.match(afterCloseSys, /DISK_CUSTOM_BTW_PROMPT_SENTINEL/, "磁盘 BTW_APPEND_SYSTEM.md 经 materials 真实生效");
			assert.match(lsResultText, /云澜\.json/, "无参 ls 默认落在本卡目录并直接放行");
			assert.ok(toolLogs.some((l) => l.includes("卡创作工程 · inspect")), "card_project 发射带动作名的过程回执");
		} finally {
			await btw.close();
		}
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});
