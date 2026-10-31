import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, afterEach, after } from "node:test";
import { createServer } from "node:http";

import { ModelRuntime, createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, type AgentSession } from "@liyuan/agent-runtime";
import roleplayExtension from "../.liyuan/extensions/roleplay.ts";
import { fauxAssistantMessage, fauxThinking, fauxToolCall } from "@liyuan/ai/providers/faux";
import { getModel, registerFauxProvider, streamSimple } from "@liyuan/ai/compat";

import { StageEngine, type StageStreamFn, type StageEngineDeps } from "../src/stage/engine.ts";
import { runBotSession } from "../server/bot-runtime.ts";
import { getStageConnection } from "../src/stage/bridge.ts";
import { applyDraftRevisions } from "../src/stage/draft-projection.ts";
import { DraftStore, draftDirectory } from "../src/stage/draft-store.ts";
import { authoringHistory, conversationMode, CONVERSATION_MODE_TYPE, CONVERSATION_PROCESS_TYPE, storyBranch } from "../src/conversation-mode.ts";
import { cardProjectOperation } from "../src/card-authoring.ts";
import { loadCardConfig } from "../src/cardspace.ts";
import { loadCardFile } from "../src/card.ts";
import { listReplyVariants } from "../src/swipe.ts";

/** 沙箱每拍读 <agentDir>/BASH_DENYLIST.txt：把 agentDir 指到临时目录，测试不读用户本机 */
const SANDBOX_AGENT_DIR = realpathSync(mkdtempSync(join(tmpdir(), "liyuan-eng-agent-")));
process.env.LIYUAN_CODING_AGENT_DIR = SANDBOX_AGENT_DIR;
after(() => rmSync(SANDBOX_AGENT_DIR, { recursive: true, force: true }));

const sessions: AgentSession[] = [];
const sessionByEngine = new WeakMap<StageEngine, AgentSession>();
const hookErrors: string[] = [];
afterEach(async () => {
	for (const session of sessions.splice(0)) {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
	}
	assert.deepEqual(hookErrors.splice(0), [], "真实 pi 扩展不得静默丢钩子");
});

async function makePiEngine(deps: Omit<StageEngineDeps, "getSession"> & { sessionManager: SessionManager }, nativeProvider = false, nativeTools = false) {
	const selected = deps.getModel() ?? getModel("anthropic", "claude-sonnet-4-5");
	const agentDir = join(deps.cwd, ".pi-test");
	mkdirSync(agentDir, { recursive: true });
	const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null });
	modelRuntime.registerProvider(String(selected!.provider), { api: selected!.api, baseUrl: selected!.baseUrl, apiKey: "test-key", models: [selected as never] });
	await modelRuntime.setRuntimeApiKey(String(selected!.provider), "test-key");
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const resourceLoader = new DefaultResourceLoader({
		cwd: deps.cwd, agentDir, settingsManager,
		extensionFactories: [roleplayExtension],
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: deps.cwd, agentDir, modelRuntime, settingsManager, resourceLoader,
		sessionManager: deps.sessionManager, model: selected as never, thinkingLevel: "off", ...(nativeTools ? {} : { noTools: "builtin" as const }),
	});
	await session.bindExtensions({ mode: "rpc", onError: (event) => hookErrors.push(event.event + ": " + event.error) });
	// faux 流注入真实 Agent 的 provider seam；context / tool_call / 生命周期均走生产钩子。
	if (!nativeProvider) session.agent.streamFunction = deps.sideStreamFn as never;
	sessions.push(session);
	const engine = new StageEngine({ ...deps, getSession: () => session as never,
		runBotSession: o => runBotSession(o, { agentDir, modelRuntime, resolveModel: () => ({ model: selected, thinking: "off" }), stream: nativeProvider ? undefined : deps.sideStreamFn }),
	});
	sessionByEngine.set(engine, session);
	return engine;
}

/** 临时舞台：配置+卡+独立会话目录 */
const makeStage = () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-eng-"));
	writeFileSync(
		join(cwd, "card.json"),
		JSON.stringify({ data: { name: "云澜", description: "{{user}}的师姐", first_mes: "你来了。" } }),
	);
	writeFileSync(join(cwd, "liyuan.config.json"), JSON.stringify({ card: "card.json", userName: "沈舟" }));
	mkdirSync(join(cwd, ".liyuan"), { recursive: true });
	const sm = SessionManager.create(cwd, join(cwd, "sessions"));
	return { cwd, sm };
};

const makeEngine = async (
	cwd: string,
	sm: InstanceType<typeof SessionManager>,
	model: unknown,
	events: ConstructorParameters<typeof StageEngine>[0]["events"] = {},
) =>
	await makePiEngine({
		cwd,
		sessionManager: sm,
		getModel: () => model as never,
		getAuth: async () => ({}),
		sideStreamFn: streamSimple as unknown as StageStreamFn,
		events,
	});

/** 封笔后的场记旁路。 */
const fauxScribeEmpty = () => fauxAssistantMessage(JSON.stringify({ patch: {} }));

/** 当前基线：一发正文，随后一发场记；不再有催告/记账注入轮。 */
const directBeat = (text: string | ((ctx: unknown) => unknown)) => [
	typeof text === "string" ? fauxAssistantMessage(text) : text,
	fauxScribeEmpty(),
];

test("引擎：一拍全链路（user 落树 → 流式 → assistant 落树 → 谢幕）", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		reg.setResponses(directBeat("云澜垂眸受了半礼。「山门夜巡未归的人，是你？」") as never);
		let partials = 0;
		let end: { aborted: boolean; entryId?: string; error?: string } | null = null;
		const engine = await makeEngine(cwd, sm, reg.getModel("faux-rp"), {
			onDelta: () => partials++,
			onTurnEnd: (info) => (end = info),
		});

		await engine.performTurn("我上前行礼。");

		const branch = sm.getBranch() as Array<{ type: string; message?: { role?: string; content?: unknown } }>;
		const roles = branch.filter((e) => e.type === "message").map((e) => e.message?.role);
		assert.deepEqual(roles, ["user", "assistant"]);
		assert.ok(partials > 0, "流式部分事件应外发");
		assert.ok(end && !end.aborted && !end.error && end.entryId, "谢幕信息应带落树条目 id");
		assert.ok(JSON.stringify(branch).includes("山门夜巡"), "正文在树上");
		assert.equal(engine.isStreaming, false);
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});



test("引擎：abort 半拍——已流出的正文落树、标记 aborted", async () => {
	const { cwd, sm } = makeStage();
	// 放慢出字速度，保证 abort 打在流中
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }], tokensPerSecond: 30 });
	try {
		reg.setResponses([
			fauxAssistantMessage("很长的一拍正文，慢慢地流出来，一句接一句，足够被中途打断的长度，再加一句压秤。"),
		]);
		let end: { aborted: boolean; entryId?: string } | null = null;
		let streamed = "";
		const engine = await makeEngine(cwd, sm, reg.getModel("faux-rp"), {
			onDelta: (kind, delta) => {
				if (kind !== "text") return;
				streamed += delta;
				if (streamed.length >= 8 && engine.isStreaming) engine.abort();
			},
			onTurnEnd: (info) => (end = info),
		});
		await engine.performTurn("开演。");

		assert.ok(end, "谢幕必须发生");
		assert.equal((end as { aborted: boolean }).aborted, true, "应标记为中断");
		const asst = (sm.getBranch() as Array<{ type: string; message?: { role?: string; stopReason?: string } }>).find(
			(e) => e.type === "message" && e.message?.role === "assistant",
		);
		assert.ok(asst, "半拍正文仍应落树（用户看过的戏不消失）");
		assert.equal(asst?.message?.stopReason, "aborted");
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("引擎：无模型/无用户输入的失败路径走通知，不落错误正文", async () => {
	const { cwd, sm } = makeStage();
	const notices: string[] = [];
	const engine = await makePiEngine({
		cwd,
		sessionManager: sm,
		getModel: () => undefined,
		getAuth: async () => ({}),
		sideStreamFn: streamSimple as unknown as StageStreamFn,
		events: { onNotify: (_l, t) => notices.push(t) },
	});
	await engine.performTurn("你好。");
	assert.ok(notices.some((t) => t.includes("剧情模型")), "无模型应有人话提示");
	const asst = (sm.getBranch() as Array<{ type: string; message?: { role?: string } }>).filter(
		(e) => e.type === "message" && e.message?.role === "assistant",
	);
	assert.equal(asst.length, 0, "不落任何 assistant 消息");
	rmSync(cwd, { recursive: true, force: true });
});

// ---------------- M-A：宽进严出 + 验收报告喂回（取代 M2 幕后精修） ----------------

import { writeFileSync as wf } from "node:fs";
import { rebuildHistory, stateFromBranch, type BranchEntryLike } from "../src/stage/assemble.ts";

/** 在临时舞台上加一个带纪律块（禁词表）的预设 */
const addBannedWordPreset = (cwd: string) => {
	wf(
		join(cwd, "preset.json"),
		JSON.stringify({
			blocks: [{ id: "pol", channel: "system", enabled: true, content: '词汇黑名单 = { "闪过" }' }],
			samplers: {},
		}),
	);
	wf(join(cwd, "liyuan.config.json"), JSON.stringify({ card: "card.json", userName: "沈舟", preset: "preset.json" }));
};


test("引擎：直出正文如实交付，不因预设词表改写模型措辞", async () => {
	const { cwd, sm } = makeStage();
	addBannedWordPreset(cwd);
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		reg.setResponses([
			fauxAssistantMessage("她眼中闪过一丝冷意，收剑入鞘。"),
			fauxScribeEmpty(),
		]);
		const engine = await makeEngine(cwd, sm, reg.getModel("faux-rp"));
		await engine.performTurn("拔剑指向她。");

		const { history } = rebuildHistory(sm.getBranch() as BranchEntryLike[]);
		const finalText = history[history.length - 1].text;
		assert.ok(finalText.includes("闪过"), "模型拒改 → 保留现稿（引擎不替模型做决定）");
		assert.ok(!finalText.includes("就这样吧"), "收笔闲聊不进正文");
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});


// ---------------- M3：场记记账（R8 独占 + R4 账本=f(分支)） ----------------


const fauxScribe = (patch: Record<string, unknown>) => fauxAssistantMessage(JSON.stringify({ patch }));



test("引擎记账：中断的半拍不记账（半截正文不进账本）", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }], tokensPerSecond: 30 });
	try {
		reg.setResponses([
			fauxAssistantMessage("很长的一拍正文，慢慢地流出来，一句接一句，足够被中途打断的长度，再加一句压秤。"),
			fauxScribe({ time: "不该被记下的时间" }),
		]);
		let streamed = "";
		const engine = await makeEngine(cwd, sm, reg.getModel("faux-rp"), {
			onDelta: (kind, delta) => {
				if (kind !== "text") return;
				streamed += delta;
				if (streamed.length >= 8 && engine.isStreaming) engine.abort();
			},
		});
		await engine.performTurn("开演。");

		const snaps = (sm.getBranch() as Array<{ type?: string; customType?: string }>).filter(
			(e) => e.type === "custom" && e.customType === "rp-state",
		);
		assert.equal(snaps.length, 0, "中断拍不落账本快照");
		assert.equal(reg.getPendingResponseCount(), 1, "场记那一发根本没发出");
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

// ---------------- M3：台上检索工具循环（R2 查资料 + R6 动笔即收敛） ----------------








test("引擎循环：格式尾巴（状态栏占位+catsay）走 text 通道 → 并入定稿正文与持久化时间线", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		reg.setResponses([
			// 当前工具面已撤下 draft_write：正文经 text，查账后输出格式尾巴。
			fauxAssistantMessage(
				[
					fauxThinking("The user decides. Now the status bar and cat commentary."),
					{ type: "text", text: "暮色四合，两人到了溪桥。" },
					fauxToolCall("world_state_get", {}),
				],
				{ stopReason: "toolUse" },
			),
			// 尾巴轮：状态栏占位 + 咪咪点评（预设格式栈，不走 draft_write）
			fauxAssistantMessage(
				"<StatusPlaceHolderImpl/>\n\n<catsay>\n<details><summary>😼咪咪点评</summary>\n选天赋磨叽半天喵呜。\n</details>\n</catsay>",
			),
			fauxScribeEmpty(),
		]);
		const activities: string[] = [];
		let streamed = "";
		const engine = await makeEngine(cwd, sm, reg.getModel("faux-rp"), {
			onActivity: (d) => activities.push(d),
			onDelta: (kind, d) => {
				if (kind === "text") streamed += d;
			},
		});
		await engine.performTurn("往溪桥去。");

		const { history } = rebuildHistory(sm.getBranch() as BranchEntryLike[]);
		// 树上正文 = 用户面定稿：正文 + 状态栏占位 + 咪咪点评都在
		const branch = sm.getBranch() as Array<{
			type: string;
			message?: { role?: string; content?: Array<{ type?: string; text?: string }> };
		}>;
		const lastMsg = [...branch].reverse().find((e) => e.type === "message" && e.message?.role === "assistant");
		const treeText = (lastMsg?.message?.content ?? [])
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "")
			.join("");
		assert.ok(treeText.includes("暮色四合"), "正文在树上");
		assert.ok(treeText.includes("StatusPlaceHolderImpl"), "状态栏占位并入定稿——不再被过滤");
		assert.ok(treeText.includes("咪咪点评"), "咪咪点评并入定稿——不再被过滤");
		assert.ok(streamed.includes("咪咪点评"), "尾巴也流式上屏过");
		// 模型面历史仍整块剥 catsay（防往拍模仿）——「历史剥、树留」双语义各就位
		assert.ok(history[history.length - 1].text.includes("暮色四合"), "历史含正文");
		assert.ok(!history[history.length - 1].text.includes("咪咪点评"), "历史剥掉格式栈（往拍模仿源）");

		// 时间线随 details 持久化：resync/刷新后尾巴仍在
		const entry = branch.filter((e) => e.type === "message" && e.message?.content).pop();
		const timeline = entry?.message?.details?.rpTimeline as
			| Array<{ kind: string; text?: string; draft?: boolean }>
			| undefined;
		assert.ok(Array.isArray(timeline), "rpTimeline 落树持久化");
		const textSegs = (timeline ?? []).filter((s) => s.kind === "text");
		const tlText = textSegs.map((s) => s.text ?? "").join("\n\n");
		assert.ok(tlText.includes("咪咪点评"), "持久化时间线含尾巴");
		// 当前直出路径在停手时整段代收；格式内容随正文一起留在稿段中。
		assert.equal(textSegs.length, 1, "正文与格式尾巴完整代收");
		assert.ok(textSegs[0].draft === true && (textSegs[0].text ?? "").includes("暮色四合"), "稿段带 draft 标记");
		assert.ok((textSegs[0].text ?? "").includes("咪咪点评"), "格式尾巴不能因经过 pi 丢失");
		assert.ok(activities.some((a) => a.includes("代收")), "过程条照常");
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});



test("引擎：模型停手但无正文 → 收拍并通知，不擅自催告续轮", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		reg.setResponses([fauxAssistantMessage(""), fauxAssistantMessage("")]);
		const notices: string[] = [];
		let end: { error?: string } | null = null;
		const engine = await makeEngine(cwd, sm, reg.getModel("faux-rp"), {
			onNotify: (_l, t) => notices.push(t),
			onTurnEnd: (info) => (end = info),
		});
		await engine.performTurn("开演。");

		assert.ok(notices.some((t) => t.includes("未交出任何正文")), "空拍必须有人话通知");
		assert.equal((end as { error?: string } | null)?.error, "no-draft");
		const asst = (sm.getBranch() as Array<{ type: string; message?: { role?: string } }>).filter(
			(e) => e.type === "message" && e.message?.role === "assistant",
		);
		assert.equal(asst.length, 0, "空拍不落树");
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});


// ---------------- M4 长局压缩（引擎自管） ----------------

/** 写配置：压缩周期可调 */
const setCompactEvery = (cwd: string, everyNTurns: number) =>
	writeFileSync(
		join(cwd, "liyuan.config.json"),
		JSON.stringify({ card: "card.json", userName: "沈舟", compactEveryNTurns: everyNTurns }),
	);




test("引擎压缩：compactNow() 手动压缩不等周期；流式中拒绝", async () => {
	const { cwd, sm } = makeStage();
	setCompactEvery(cwd, 0); // 自动压缩关闭
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		const responses: unknown[] = [];
		for (let i = 1; i <= 8; i++) {
			responses.push(fauxAssistantMessage(`第 ${i} 拍的正文。${"云".repeat(1200)}`));
			responses.push(fauxScribeEmpty());
		}
		reg.setResponses(responses as never);
		const engine = await makeEngine(cwd, sm, reg.getModel("faux-rp"));
		for (let i = 1; i <= 8; i++) await engine.performTurn(`第 ${i} 拍我说的话。`);

		assert.equal(
			(sm.getBranch() as Array<{ customType?: string }>).filter((e) => e.customType === "rp-summary").length,
			0,
			"everyNTurns=0 时不自动压缩",
		);

		reg.setResponses([fauxAssistantMessage("## 前情提要\n手动压缩产出的摘要。")]);
		const r = await engine.compactNow();
		assert.equal(r.kind, "compacted");
		assert.equal(
			(sm.getBranch() as Array<{ customType?: string }>).filter((e) => e.customType === "rp-summary").length,
			1,
			"手动压缩落一条摘要",
		);
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("扮演压缩：拍压缩后指示器折算——contextUsage 刷新为压缩后的值（小于 pi 的压缩前值）", async () => {
	const { cwd, sm } = makeStage();
	setCompactEvery(cwd, 0); // 自动压缩关闭，只测手动压缩后的折算
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		const responses: unknown[] = [];
		for (let i = 1; i <= 8; i++) {
			responses.push(fauxAssistantMessage(`第 ${i} 拍的正文。${"云".repeat(1200)}`));
			responses.push(fauxScribeEmpty());
		}
		reg.setResponses(responses as never);
		const engine = await makeEngine(cwd, sm, reg.getModel("faux-rp"));
		for (let i = 1; i <= 8; i++) await engine.performTurn(`第 ${i} 拍我说的话。`);

		assert.equal(engine.contextUsage(), undefined, "未压缩时不给折算值——指示器用 pi 的实测占用");

		reg.setResponses([fauxAssistantMessage("## 前情提要\n手动压缩产出的摘要。")]);
		const r = await engine.compactNow();
		assert.equal(r.kind, "compacted");

		const folded = engine.contextUsage();
		assert.ok(folded, "拍压缩后指示器应给出折算值（否则右下角停在压缩前）");
		const piTokens = sessionByEngine.get(engine)!.getSessionStats().contextUsage?.tokens ?? 0;
		assert.ok(folded!.tokens > 0, "折算值为正");
		assert.ok(folded!.tokens < piTokens, `折算后 ${folded!.tokens} 应小于压缩前真实占用 ${piTokens}`);
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});



















// ---------------- P7：ask 工具（剧情共创决策） ----------------

test("ask：注入 askUser 才上清单；未注入则剔除（依赖缺失不上清单）", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		const ctxs: Array<{ tools?: Array<{ name: string }> }> = [];
		reg.setResponses([
			(ctx) => {
				ctxs.push(ctx as never);
				return fauxAssistantMessage("你好。");
			},
			fauxScribeEmpty(),
		]);
		const engine = await makeEngine(cwd, sm, reg.getModel("faux-rp"));
		await engine.performTurn("开演。");
		const names = (ctxs[0].tools ?? []).map((t) => t.name);
		assert.ok(!names.includes("ask"), "未注入 askUser 时 ask 不上清单");
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("ask：注入 askUser 时 ask 上清单", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		const ctxs: Array<{ tools?: Array<{ name: string }> }> = [];
		reg.setResponses([
			(ctx) => {
				ctxs.push(ctx as never);
				return fauxAssistantMessage("你好。");
			},
			fauxScribeEmpty(),
		]);
		const engine = await makePiEngine({
			cwd,
			sessionManager: sm,
			getModel: () => reg.getModel("faux-rp"),
			getAuth: async () => ({}),
			sideStreamFn: streamSimple as unknown as StageStreamFn,
			askUser: async () => "好",
		});
		await engine.performTurn("开演。");
		const names = (ctxs[0].tools ?? []).map((t) => t.name);
		assert.ok(names.includes("ask"), "注入 askUser 后 ask 在清单");
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});








/**
 * 旁路条目（RpConfig.sideModel → StageEngineDeps.getSideEntry）：
 * 场记/压缩不再跟随剧情模型，模型和思考档都取自连接配置里那一条条目。
 */
test("引擎：旁路调用走 sideEntry 的模型与它自己的档，并按它重取鉴权", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }, { id: "faux-side" }] });
	try {
		reg.setResponses(directBeat("云澜垂眸受了半礼。") as never);
		const calls: Array<{ id: string; reasoning: unknown }> = [];
		const authFor: string[] = [];
		const recording = ((model: { id: string }, ctx: unknown, options: { reasoning?: unknown }) => {
			calls.push({ id: model.id, reasoning: options?.reasoning });
			return (streamSimple as unknown as StageStreamFn)(model as never, ctx as never, options as never);
		}) as unknown as StageStreamFn;

		const engine = await makePiEngine({
			cwd,
			sessionManager: sm,
			getModel: () => reg.getModel("faux-rp") as never,
			getSideEntry: () => ({ model: reg.getModel("faux-side") as never, thinking: "off", label: "flash off" }),
			getAuth: async (m) => {
				authFor.push(String((m as { id: string }).id));
				return {};
			},
			sideStreamFn: recording,
			events: {},
		});
		await engine.performTurn("我上前行礼。");

		assert.ok(calls.some((c) => c.id === "faux-rp"), "台上仍走剧情模型");
		const side = calls.filter((c) => c.id === "faux-side");
		assert.ok(side.length > 0, "场记那一发走旁路条目的模型");
		assert.equal(side[0]!.reasoning, "off", "档取自那条条目，不是引擎自己定的");
		assert.ok(authFor.includes("faux-side"), "鉴权按旁路模型重取，不能沿用剧情模型的 key");
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

/** 回归：没配旁路条目时逐字旧行为——旁路仍跟随剧情模型，且不多取一次鉴权 */
test("引擎：未配旁路条目时旁路跟随剧情模型（旧行为不变）", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		reg.setResponses(directBeat("云澜垂眸受了半礼。") as never);
		const ids: string[] = [];
		let authCalls = 0;
		const recording = ((model: { id: string }, ctx: unknown, options: unknown) => {
			ids.push(model.id);
			return (streamSimple as unknown as StageStreamFn)(model as never, ctx as never, options as never);
		}) as unknown as StageStreamFn;

		const engine = await makePiEngine({
			cwd,
			sessionManager: sm,
			getModel: () => reg.getModel("faux-rp") as never,
			getAuth: async () => {
				authCalls++;
				return {};
			},
			sideStreamFn: recording,
			events: {},
		});
		await engine.performTurn("我上前行礼。");

		assert.ok(ids.length > 0 && ids.every((i) => i === "faux-rp"), "全部调用都走剧情模型");
		assert.equal(authCalls, 1, "只按剧情模型取一次鉴权（旁路没换模型就不该重取）");
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

/** 第四步：旁路要留下「思考了没有、思考了多久」的痕迹，否则用户无从判断 */
test("引擎：旁路每一发都出回执——思考字数与耗时", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }, { id: "faux-side" }] });
	try {
		reg.setResponses(directBeat("云澜垂眸受了半礼。") as never);
		const activity: string[] = [];
		const engine = await makePiEngine({
			cwd,
			sessionManager: sm,
			getModel: () => reg.getModel("faux-rp") as never,
			getSideEntry: () => ({ model: reg.getModel("faux-side") as never, thinking: "off", label: "flash off" }),
			getAuth: async () => ({}),
			sideStreamFn: streamSimple as unknown as StageStreamFn,
			events: { onActivity: (d) => activity.push(d) },
		});
		await engine.performTurn("我上前行礼。");

		const receipts = activity.filter((a) => a.includes("旁路"));
		assert.ok(receipts.length > 0, "旁路跑过就得留下回执");
		const r = receipts[0]!;
		assert.ok(r.includes("flash off"), "回执要指名是哪条条目");
		assert.match(r, /思考 \d+ 字/, "思考字数是这行存在的理由");
		assert.match(r, /\d+\.\ds/, "耗时也要有");
		assert.ok(r.includes("档 off"), "请求的档要写出来——它和实际思考字数对不上时才看得见问题");
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});



// ---------------- 回归 pi：真实钩子、会话树与工具循环 ----------------

const piDeps = (cwd: string, sm: SessionManager, model: unknown): Omit<StageEngineDeps, "getSession"> & { sessionManager: SessionManager } => ({
	cwd, sessionManager: sm, getModel: () => model as never,
	getAuth: async () => ({}), sideStreamFn: streamSimple as unknown as StageStreamFn,
});
const userEntries = (sm: SessionManager) => sm.getEntries().filter((entry) => entry.type === "message" && entry.message.role === "user");
const assertSessionAligned = (session: AgentSession) => {
	// pi assigns the live custom message and its tree entry separate timestamps.
	// A millisecond boundary is not a content/history mismatch; ordinary message timestamps still match exactly.
	const comparable = (messages: AgentSession["messages"]) => messages.map((message) => {
		if (message.role !== "custom") return message;
		const { timestamp, ...content } = message;
		return content;
	});
	assert.deepEqual(comparable(session.messages), comparable(session.sessionManager.buildSessionContext().messages), "树与 pi 内存必须一致");
};

test("旧工作模式会话：遗留条目读得回来，维护段不再进台前上下文，续演照常", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		// 造一条「工作模式时代」的分支：mode 条目 + 维护轮（user/assistant，带 liyuanMode）+ 原始过程条目
		sm.appendCustomEntry(CONVERSATION_MODE_TYPE, { mode: "authoring", source: "user" });
		sm.appendMessage({ role: "user", content: [{ type: "text", text: "AUTHOR_REQUEST_SENTINEL：把前端改一下。" }], timestamp: Date.now(), details: { liyuanMode: "authoring" } });
		sm.appendCustomEntry(CONVERSATION_PROCESS_TYPE, {
			requestId: "old-work-turn", mode: "authoring",
			message: { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "write", arguments: { path: "web/src/a.ts", content: "NATIVE_EDIT_SENTINEL" } }] },
		});
		sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "AUTHOR_REPORT_SENTINEL：改好了。" }], timestamp: Date.now(), details: { liyuanMode: "authoring", liyuanAuthoringReply: true } });
		sm.flush();
		assert.equal(conversationMode(sm.getBranch() as never), "authoring", "树上遗留的值照旧读得回来");

		const engine = await makePiEngine(piDeps(cwd, sm, reg.getModel("faux-rp")), false, true);
		assert.equal(engine.mode, "roleplay", "运行视图按扮演走——工作模式没有入口了");
		reg.setResponses([
			(ctx) => {
				assert.doesNotMatch(JSON.stringify(ctx.messages), /【写卡维护】|AUTHOR_REQUEST_SENTINEL|AUTHOR_REPORT_SENTINEL|NATIVE_EDIT_SENTINEL/, "维护段与工具过程都不进台前上下文");
				assert.ok(!ctx.tools.some((t: any) => ["conversation_mode", "lorebook_write"].includes(t.name)));
				return fauxAssistantMessage("她仍在山门旁等你。");
			},
			fauxScribeEmpty(),
		]);
		await engine.performTurn("走到山门前。");
		assert.match(rebuildHistory(sm.getBranch()).history.at(-1)!.text, /山门旁/);
		assert.doesNotMatch(JSON.stringify(rebuildHistory(sm.getBranch()).history), /AUTHOR_REQUEST_SENTINEL/, "维护文本不进 story 流");
		assert.match(JSON.stringify(authoringHistory(sm.getBranch())), /AUTHOR_REQUEST_SENTINEL.*NATIVE_EDIT_SENTINEL/s, "原始记录仍在共享会话里（旧会话读得回来）");
	} finally { reg.unregister(); rmSync(cwd, { recursive: true, force: true }); }
});

test("台前工具面：无 conversation_mode、无世界书写族；主模型保留记忆读写与演出读侧", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-tools-face-"));
	const cardDir = join(cwd, "cards", "云澜");
	mkdirSync(cardDir, { recursive: true });
	writeFileSync(join(cardDir, "云澜.json"), JSON.stringify({ data: { name: "云澜", description: "{{user}}的师姐", first_mes: "你来了。" } }));
	writeFileSync(join(cwd, "liyuan.config.json"), JSON.stringify({ card: "cards/云澜/云澜.json", userName: "沈舟" }));
	mkdirSync(join(cwd, ".liyuan"), { recursive: true });
	const sm = SessionManager.create(cwd, join(cwd, "sessions"));
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		const engine = await makePiEngine({
			...piDeps(cwd, sm, reg.getModel("faux-rp")),
			// 宿主件全给：工具下架只能因为「台上不注入世界书写族依赖」，不能是因为宿主没接
			loreHost: {
				write: () => null, update: () => null, remove: () => null,
				listMarked: () => [], listBooks: () => ({ books: [], mounted: [] }),
				createBook: () => null, mountBook: () => [],
			},
			setDisabledLore: () => 0,
			addMemory: async () => ({ added: 1, total: 1, chunks: 1 }),
			readMemory: () => undefined,
			listMemory: () => [],
			deleteMemory: () => true,
			loadPanels: () => ({}), writePanel: () => ({ ok: true, created: true, reopened: false, activeCount: 1, overLimit: false }), closePanel: () => ({ ok: true }),
			loadWorldline: () => ({ saves: [] }) as never,
			storeSave: () => null,
			askUser: async () => undefined,
		}, false, true);
		const seen: string[] = [];
		reg.setResponses([
			(ctx) => { seen.push(...ctx.tools.map((t: any) => t.name)); return fauxAssistantMessage("她点了点头。"); },
			fauxScribeEmpty(),
		]);
		await engine.performTurn("继续走。");
		for (const gone of ["conversation_mode", "lorebook_write", "lorebook_update", "lorebook_delete", "lorebook_create", "read", "write", "card_project"]) {
			assert.ok(!seen.includes(gone), `台上不该有 ${gone}`);
		}
		for (const kept of ["lorebook_search", "lorebook_read", "lorebook_list", "lorebook_files", "lorebook_toggle", "lorebook_mount", "memory_search", "memory_read", "memory_list", "memory_add", "memory_delete", "card_read", "world_state_get", "worldline_list", "worldline_store", "panel_write", "panel_read", "panel_close", "draft_write", "previous_draft_edit", "ask"]) {
			assert.ok(seen.includes(kept), `台上应当有 ${kept}`);
		}
	} finally { reg.unregister(); rmSync(cwd, { recursive: true, force: true }); }
});

test("副编剧原生工具：卡内静默、卡外先拒后批、本会话授权落树上；产出不进会话树", async () => {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "liyuan-bot-native-")));
	const cardDir = join(cwd, "cards", "云澜");
	mkdirSync(cardDir, { recursive: true });
	writeFileSync(join(cardDir, "云澜.json"), JSON.stringify({ data: { name: "云澜", description: "{{user}}的师姐", first_mes: "你来了。" } }));
	writeFileSync(join(cwd, "liyuan.config.json"), JSON.stringify({ card: "cards/云澜/云澜.json", userName: "沈舟" }));
	mkdirSync(join(cwd, ".liyuan"), { recursive: true });
	mkdirSync(join(cwd, "web", "src"), { recursive: true });
	writeFileSync(join(cwd, "web", "src", "a.ts"), "OUTSIDE_A_SENTINEL");
	const sm = SessionManager.create(cwd, join(cwd, "sessions"));
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	const calls = (...items: any[]) => fauxAssistantMessage(items, { stopReason: "toolUse" });
	const asked: string[] = [];
	const answers: string[] = [];
	const lastToolResult = (ctx: any) => ctx.messages.filter((m: any) => m.role === "toolResult").at(-1)?.content?.[0]?.text ?? "";
	try {
		const engine = await makePiEngine({
			...piDeps(cwd, sm, reg.getModel("faux-rp")),
			askUser: async (question) => { asked.push(question); return answers.shift(); },
		}, false, true);
		answers.push("拒绝", "本会话允许", "允许一次", "以后不再问「echo」（本卡）");
		reg.setResponses([
			(ctx) => { assert.ok(ctx.tools.some((t: any) => t.name === "read") && ctx.tools.some((t: any) => t.name === "write"), "原生七工具在副编剧面上"); return calls(fauxToolCall("write", { path: join(cardDir, "创作", "note.txt"), content: "INSIDE_SENTINEL" })); },
			(ctx) => { assert.equal(asked.length, 0, "卡内写入不问"); return calls(fauxToolCall("read", { path: join(cwd, "web", "src", "a.ts") })); },
			(ctx) => {
				assert.equal(asked.length, 1);
				assert.match(lastToolResult(ctx), /用户拒绝了本次读取/);
				assert.doesNotMatch(lastToolResult(ctx), /OUTSIDE_A_SENTINEL/, "被拒的读取不执行");
				return calls(fauxToolCall("read", { path: join(cwd, "web", "src", "a.ts") }));
			},
			(ctx) => {
				assert.equal(asked.length, 2);
				assert.match(lastToolResult(ctx), /OUTSIDE_A_SENTINEL/);
				return calls(fauxToolCall("bash", { command: "echo BOT_BASH_OK" }));
			},
			(ctx) => { assert.equal(asked.length, 3); assert.match(lastToolResult(ctx), /BOT_BASH_OK/); return calls(fauxToolCall("bash", { command: "echo BOT_BASH_AGAIN" })); },
			(ctx) => { assert.equal(asked.length, 4, "永久授权不再问"); assert.match(lastToolResult(ctx), /BOT_BASH_AGAIN/); return fauxAssistantMessage("前端看过了，卡里的笔记也写好了。"); },
		]);
		const r = await engine.botTurn("整理一下前端。");
		assert.deepEqual(r, {
			text: "前端看过了，卡里的笔记也写好了。",
			tools: [
				{ name: "write" },
				{ name: "read", isError: true },
				{ name: "read" },
				{ name: "bash" },
				{ name: "bash" },
			],
		});
		assert.equal(readFileSync(join(cardDir, "创作", "note.txt"), "utf8"), "INSIDE_SENTINEL");
		assert.match(asked[0]!, /请求读取：.*a\.ts[\s\S]*范围：web/);
		assert.deepEqual(asked[2]!, "请求执行命令（bash 不受卡目录限制）：\necho BOT_BASH_OK");
		assert.deepEqual(loadCardConfig(cardDir).sandboxBashAllow, ["echo"], "免问前缀落 卡.json（不是布尔）");
		assert.equal(loadCardConfig(cardDir).sandboxAllow, undefined, "本会话授权不落 卡.json");
		assert.ok(sm.getBranch().some((e: any) => e.type === "custom" && e.customType === "liyuan-sandbox" && e.data?.dir === join(cwd, "web")), "本会话授权在会话树上");
		// 隔离：副编剧的话与它的工具过程都不进会话树（树上只多了一条授权条目）
		assert.doesNotMatch(JSON.stringify(sm.getBranch()), /整理一下前端|前端看过了|INSIDE_SENTINEL/);

		// 命令黑名单（docs/PLAN-AGENT-BACK-TO-PI.md §二）：即使 bash 已永久授权，命中即拒、不弹选择卡
		writeFileSync(join(SANDBOX_AGENT_DIR, "BASH_DENYLIST.txt"), "echo BOT_DENY_ME\n", "utf8");
		try {
			reg.setResponses([
				() => calls(fauxToolCall("bash", { command: "echo BOT_DENY_ME" })),
				(ctx) => {
					assert.match(lastToolResult(ctx), /命令黑名单/, "命中黑名单的回执说明原因");
					assert.equal(asked.length, 4, "黑名单直接拒，不弹选择卡");
					return fauxAssistantMessage("那条命令被拦住了。");
				},
			]);
			assert.deepEqual(await engine.botTurn("跑一下那条命令。"), {
				text: "那条命令被拦住了。",
				tools: [{ name: "bash", isError: true }],
			});
		} finally {
			rmSync(join(SANDBOX_AGENT_DIR, "BASH_DENYLIST.txt"), { force: true });
		}

		// backendControl 关＝用户没给通用工具：副编剧面也不该有原生七工具（与台上、agent 模式同一开关）
		writeFileSync(join(cwd, "liyuan.config.json"), JSON.stringify({ card: "cards/云澜/云澜.json", userName: "沈舟", backendControl: false }));
		const off = await makePiEngine(piDeps(cwd, sm, reg.getModel("faux-rp")), false, true);
		reg.setResponses([(ctx) => {
			assert.ok(!ctx.tools.some((t: any) => ["read", "write", "edit", "bash", "grep", "find", "ls"].includes(t.name)), "backendControl 关时没有原生工具");
			assert.ok(ctx.tools.some((t: any) => t.name === "lorebook_search"), "资料工具照旧");
			return fauxAssistantMessage("那就不动文件了。");
		}]);
		assert.deepEqual(await off.botTurn("看一眼卡目录。"), { text: "那就不动文件了。" });
	} finally { reg.unregister(); rmSync(cwd, { recursive: true, force: true }); }
});

test("pi：工具过程持久化但扮演隐藏；重生成复用同一 user 并隔离旧分支", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		const contexts: any[] = [];
		reg.setResponses([
			fauxAssistantMessage([fauxThinking("先查账。"), fauxToolCall("world_state_get", {})], { stopReason: "toolUse" }),
			(ctx) => { contexts.push(ctx); return fauxAssistantMessage("她踏上旧桥。"); },
			fauxScribe({ location: "旧桥" }),
		]);
		const ends: any[] = [];
		const engine = await makePiEngine({ ...piDeps(cwd, sm, reg.getModel("faux-rp")), events: { onTurnEnd: (info) => ends.push(info) } });
		const session = sessionByEngine.get(engine)!;
		const events: string[] = [];
		session.subscribe((event) => events.push(event.type));
		await engine.performTurn("到桥边去。");
		assert.ok(ends[0]?.entryId && !ends[0]?.error);
		assert.equal(events.filter((type) => type === "agent_start").length, 1);
		assert.equal(events.filter((type) => type === "agent_end").length, 1);
		assert.equal(events.filter((type) => type === "tool_execution_start").length, 1);
		assert.ok(contexts[0].messages.some((message: any) => message.role === "toolResult" && JSON.stringify(message.content).includes("RAW:")));
		const user = userEntries(sm)[0]!;
		const variants = () => listReplyVariants(sm.getEntries().map((e) => ({ ...e, role: e.type === "message" ? e.message.role : undefined })), user.id, sm.getLeafId());
		assert.equal(variants().length, 1, "原始过程条目不打断回复变体寻址");
		assert.ok(sm.getBranch().some((e) => e.type === "custom" && e.customType === CONVERSATION_PROCESS_TYPE));
		assert.equal(sm.getBranch().filter((entry) => entry.type === "message" && entry.message.role === "toolResult").length, 0);
		assertSessionAligned(session);

		session.setLeaf(user.id);
		reg.setResponses([
			(ctx) => { contexts.push(ctx); return fauxAssistantMessage("她留在岸上。"); },
			fauxScribeEmpty(),
		]);
		await engine.regenerate();
		assert.ok(ends[1]?.entryId && !ends[1]?.error);
		assert.equal(userEntries(sm).length, 1, "重生成不能追加第二条用户输入");
		assert.equal(variants().length, 2, "两次生成各自保留原始过程与最终回复");
		assert.ok(!JSON.stringify(contexts[1].messages).includes("她踏上旧桥"), "旧回复不能进入新变体");
		assert.ok(!JSON.stringify(contexts[1].messages).includes("旧桥"), "旧变体的账本不能泄漏");
		assertSessionAligned(session);
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("引擎：导演备注随本拍装配送达、不落树、一次即焚（PLAN-DIRECTOR-NOTE）", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		const contexts: any[] = [];
		reg.setResponses([
			...directBeat((ctx) => { contexts.push(ctx); return fauxAssistantMessage("第一拍。"); }),
			...directBeat((ctx) => { contexts.push(ctx); return fauxAssistantMessage("第二拍。"); }),
		] as never);
		const engine = await makeEngine(cwd, sm, reg.getModel("faux-rp"));

		await engine.performTurn("我上前行礼。", "让她傲娇一点，别急着答应。");
		await engine.performTurn("我再走近一步。");

		const first = JSON.stringify(contexts[0].messages);
		const second = JSON.stringify(contexts[1].messages);
		assert.ok(first.includes("【导演备注】") && first.includes("让她傲娇一点"), "第一拍送模带备注");
		assert.ok(!second.includes("【导演备注】"), "备注一次即焚，下一拍不带");
		const users = (sm.getBranch() as any[]).filter((e) => e.type === "message" && e.message?.role === "user");
		assert.equal(users.length, 2, "两拍各一条原话");
		assert.ok(!JSON.stringify(users.map((e) => e.message.content)).includes("导演备注"), "树上只有原话，备注不落树");
		// 只作显示的记录：随回复落 details.rpNotes（前端在用户气泡下渲染备注小气泡；模型看不见）
		const asst = (sm.getBranch() as any[]).filter((e) => e.type === "message" && e.message?.role === "assistant");
		assert.deepEqual(asst[0]?.message?.details?.rpNotes, ["让她傲娇一点，别急着答应。"], "第一拍回复记下备注");
		assert.equal(asst[1]?.message?.details?.rpNotes, undefined, "无备注的拍不记");
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("引擎：重 roll 带导演备注（regenerate 路径），树上仍只有原话", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		const contexts: any[] = [];
		reg.setResponses(directBeat((ctx) => { contexts.push(ctx); return fauxAssistantMessage("第一版。"); }) as never);
		const engine = await makeEngine(cwd, sm, reg.getModel("faux-rp"));
		await engine.performTurn("我推开门。");

		// 重 roll：叶钉回 user（与 regenerateSwipe 同形），带备注再生成
		const session = sessionByEngine.get(engine)!;
		const user = (sm.getBranch() as any[]).find((e) => e.type === "message" && e.message?.role === "user");
		session.setLeaf(user.id);
		reg.setResponses(directBeat((ctx) => { contexts.push(ctx); return fauxAssistantMessage("第二版。"); }) as never);
		await engine.regenerate("更冷淡一些，别马上软化。");

		const rolled = JSON.stringify(contexts[1].messages);
		assert.ok(rolled.includes("【导演备注】") && rolled.includes("更冷淡一些"), "重 roll 送模带备注");
		const users = (sm.getBranch() as any[]).filter((e) => e.type === "message" && e.message?.role === "user");
		assert.equal(users.length, 1, "重 roll 不追加用户输入");
		assert.ok(!JSON.stringify(users[0].message.content).includes("导演备注"), "备注不落树");
		assert.equal(listReplyVariants(sm.getEntries().map((e) => ({ ...e, role: e.type === "message" ? e.message.role : undefined })), user.id, sm.getLeafId()).length, 2, "两条变体各自保留");
		// 记录挂在**变体**上：重 roll 出的新回复带自己的备注（切变体时气泡跟着变）
		const asst = (sm.getBranch() as any[]).filter((e) => e.type === "message" && e.message?.role === "assistant");
		assert.deepEqual(asst[asst.length - 1]?.message?.details?.rpNotes, ["更冷淡一些，别马上软化。"], "重 roll 变体记下备注");
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("pi：ask 等用户答复，后续工具顺序执行，答案经 toolResult 回喂", { timeout: 5000 }, async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	const entered = Promise.withResolvers<void>();
	const answer = Promise.withResolvers<string | undefined>();
	try {
		const contexts: any[] = [];
		reg.setResponses([
			fauxAssistantMessage([fauxToolCall("ask", { question: "走哪扇门？", options: ["东门", "西门"] }), fauxToolCall("world_state_get", {})], { stopReason: "toolUse" }),
			(ctx) => { contexts.push(ctx); return fauxAssistantMessage("她走向东门。"); },
			fauxScribeEmpty(),
		]);
		const engine = await makePiEngine({
			...piDeps(cwd, sm, reg.getModel("faux-rp")),
			askUser: async (_question, _options, signal) => {
				assert.ok(signal instanceof AbortSignal);
				entered.resolve();
				return answer.promise;
			},
		});
		const session = sessionByEngine.get(engine)!;
		const starts: string[] = [];
		session.subscribe((event) => { if (event.type === "tool_execution_start") starts.push(event.toolName); });
		const turn = engine.performTurn("让我选一扇门。");
		await entered.promise;
		assert.deepEqual(starts, ["ask"], "用户没有回答之前，不得越过 ask 执行后面的工具");
		answer.resolve("东门");
		await turn;
		assert.deepEqual(starts, ["ask", "world_state_get"]);
		const replies = contexts[0].messages.filter((message: any) => message.role === "toolResult");
		assert.ok(JSON.stringify(replies[0].content).includes("用户已作答：「东门」。"));
		assert.equal(replies[1].toolName, "world_state_get");
		assertSessionAligned(session);
	} finally {
		answer.resolve(undefined);
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("pi：ask 用户停止，不执行同批剩余工具，也不再请求模型", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		reg.setResponses([
			fauxAssistantMessage([fauxToolCall("ask", { question: "往哪走？", options: ["东", "西"] }), fauxToolCall("world_state_get", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("不该被请求的下一轮。"),
		]);
		const engine = await makePiEngine({ ...piDeps(cwd, sm, reg.getModel("faux-rp")), askUser: async () => undefined });
		await engine.performTurn("让我选择。");
		assert.equal(reg.getPendingResponseCount(), 1);
		const debug = sm.getBranch().find((entry) => entry.type === "custom" && entry.customType === "rp-text-debug") as any;
		assert.ok(debug);
		assert.equal(debug.data.beatLog.filter((row: any) => row.ev === "tool_call" && row.data.startsWith("world_state_get")).length, 0);
		assertSessionAligned(sessionByEngine.get(engine)!);
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("pi：等待 ask 时中断能传达信号，半拍不记账，下一拍可继续", { timeout: 5000 }, async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	const entered = Promise.withResolvers<void>();
	try {
		reg.setResponses([fauxAssistantMessage([fauxToolCall("ask", { question: "走吗？", options: ["走", "等"] })], { stopReason: "toolUse" })]);
		const ends: any[] = [];
		const engine = await makePiEngine({
			...piDeps(cwd, sm, reg.getModel("faux-rp")),
			askUser: async (_q, _o, signal) => new Promise((resolve) => {
				signal!.addEventListener("abort", () => resolve(undefined), { once: true });
				entered.resolve();
			}),
			events: { onTurnEnd: (info) => ends.push(info) },
		});
		const turn = engine.performTurn("让我决定。");
		await entered.promise;
		engine.abort();
		await turn;
		assert.equal(ends[0]?.aborted, true);
		assert.equal(sm.getBranch().filter((entry) => entry.type === "custom" && entry.customType === "rp-state").length, 0);
		reg.setResponses(directBeat("她等到天亮。") as never);
		await engine.performTurn("等到天亮。");
		assert.ok(ends[1]?.entryId && !ends[1]?.error);
		assertSessionAligned(sessionByEngine.get(engine)!);
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("项目级记忆与局部守则：主模型可写 记忆/*.md 与 MEMORY.md，同项目跨会话可见、跨项目物理隔离", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-chat-mem-"));
	const cardDir = join(cwd, "cards", "云澜");
	mkdirSync(cardDir, { recursive: true });
	writeFileSync(join(cardDir, "云澜.json"), JSON.stringify({ data: { name: "云澜", description: "{{user}}的师姐", first_mes: "你来了。" } }));
	writeFileSync(join(cwd, "liyuan.config.json"), JSON.stringify({ card: "cards/云澜/云澜.json", userName: "沈舟" }));
	mkdirSync(join(cwd, ".liyuan"), { recursive: true });
	const chat1SessDir = join(cardDir, "对话", "chat-1", "会话");
	const chat2SessDir = join(cardDir, "对话", "chat-2", "会话");
	mkdirSync(chat1SessDir, { recursive: true });
	mkdirSync(chat2SessDir, { recursive: true });
	writeFileSync(join(cardDir, "对话", "chat-1", "APPEND_SYSTEM.md"), "CHAT1_LOCAL_RULE_SENTINEL", "utf8");
	writeFileSync(join(cardDir, "对话", "chat-1", "前情提要.md"), "CHAT1_SUMMARY_SENTINEL", "utf8");
	const sm1a = SessionManager.create(cwd, chat1SessDir);
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		const engine1a = await makePiEngine(piDeps(cwd, sm1a, reg.getModel("faux-rp")), false, true);
		let sys1a = "";
		let msgs1a = "";
		reg.setResponses([
			fauxAssistantMessage([fauxToolCall("memory_add", { title: "东门之约", text: "明日清晨在东门等候沈舟。" })], { stopReason: "toolUse" }),
			(ctx) => {
				sys1a = String(ctx.systemPrompt ?? "");
				msgs1a = JSON.stringify(ctx.messages);
				return fauxAssistantMessage("她收起了信物。");
			},
			fauxScribeEmpty(),
		]);
		await engine1a.performTurn("记住东门的约定。");
		assert.match(sys1a, /CHAT1_LOCAL_RULE_SENTINEL/, "项目 1 装配含项目级局部守则");
		assert.match(msgs1a, /CHAT1_SUMMARY_SENTINEL/, "项目 1 新会话自动接力读取项目级前情提要.md");
		assert.ok(existsSync(join(cardDir, "对话", "chat-1", "记忆", "东门之约.md")), "主模型调用 memory_add 落成项目级 .md");
		assert.ok(existsSync(join(cardDir, "对话", "chat-1", "记忆", "MEMORY.md")), "自动维护项目级 MEMORY.md 索引");

		// 同一项目 chat-1 下新建第二个会话 sm1b：立即看到 MEMORY.md 索引、APPEND_SYSTEM.md 与 前情提要.md
		const sm1b = SessionManager.create(cwd, chat1SessDir);
		const engine1b = await makePiEngine(piDeps(cwd, sm1b, reg.getModel("faux-rp")), false, true);
		let sys1b = "";
		let msgs1b = "";
		reg.setResponses([
			(ctx) => {
				sys1b = String(ctx.systemPrompt ?? "");
				msgs1b = JSON.stringify(ctx.messages);
				return fauxAssistantMessage("她已在东门等候。");
			},
			fauxScribeEmpty(),
		]);
		await engine1b.performTurn("我来到东门。");
		assert.match(sys1b, /CHAT1_LOCAL_RULE_SENTINEL/, "同项目新会话继承局部守则");
		assert.match(sys1b, /东门之约\.md/, "同项目新会话常驻看到 MEMORY.md 索引");
		assert.match(msgs1b, /CHAT1_SUMMARY_SENTINEL/, "同项目新会话继承项目级前情提要");

		// 切换到同卡另一个项目 chat-2：完全隔离，不见 chat-1 的守则、MEMORY.md 与前情提要
		const sm2 = SessionManager.create(cwd, chat2SessDir);
		const engine2 = await makePiEngine(piDeps(cwd, sm2, reg.getModel("faux-rp")), false, true);
		let sys2 = "";
		let msgs2 = "";
		reg.setResponses([
			(ctx) => {
				sys2 = String(ctx.systemPrompt ?? "");
				msgs2 = JSON.stringify(ctx.messages);
				return fauxAssistantMessage("初次见面。");
			},
			fauxScribeEmpty(),
		]);
		await engine2.performTurn("你好。");
		assert.doesNotMatch(sys2, /CHAT1_LOCAL_RULE_SENTINEL|东门之约/, "不同项目间局部守则与 MEMORY.md 完全隔离");
		assert.doesNotMatch(msgs2, /CHAT1_SUMMARY_SENTINEL/, "不同项目间前情提要完全隔离");
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("pi：缺少稿件版本的调用由原生 schema 拒绝，模型可改走正文通道", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		let result: any;
		reg.setResponses([
			fauxAssistantMessage([fauxToolCall("draft_write", { content: "这份未受理的稿不应上屏。" })], { stopReason: "toolUse" }),
			(ctx) => { result = ctx.messages.findLast((message: any) => message.role === "toolResult"); return fauxAssistantMessage("她打开窗。"); },
			fauxScribeEmpty(),
		]);
		const engine = await makeEngine(cwd, sm, reg.getModel("faux-rp"));
		await engine.performTurn("继续。");
		assert.equal(result.isError, true);
		const history = rebuildHistory(sm.getBranch() as BranchEntryLike[]).history;
		assert.equal(history.at(-1)?.text, "她打开窗。");
		assertSessionAligned(sessionByEngine.get(engine)!);
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("pi：20 轮后撤工具，只再请求一次；不新增催告或续轮指令", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		let lastContext: any;
		reg.setResponses([
			...Array.from({ length: 20 }, () => fauxAssistantMessage([fauxToolCall("world_state_get", {})], { stopReason: "toolUse" })),
			(ctx) => { lastContext = ctx; return fauxAssistantMessage("天色已晚。"); },
			fauxScribeEmpty(),
		]);
		const engine = await makeEngine(cwd, sm, reg.getModel("faux-rp"));
		const session = sessionByEngine.get(engine)!;
		let calls = 0;
		session.subscribe((event) => { if (event.type === "tool_execution_start") calls++; });
		await engine.performTurn("看看周围。");
		assert.equal(calls, 20);
		assert.equal(lastContext.tools?.length ?? 0, 0);
		assert.equal(lastContext.messages.filter((message: any) => message.role === "user").length, 1, "只有本拍用户输入，未插入催告");
		assert.equal(reg.getPendingResponseCount(), 0);
		assertSessionAligned(session);
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("pi：撤工具后模型仍给工具调用，也在第 21 次回应停止", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		reg.setResponses([
			...Array.from({ length: 21 }, () => fauxAssistantMessage([fauxToolCall("world_state_get", {})], { stopReason: "toolUse" })),
			fauxAssistantMessage("这一发不该消耗。"),
		]);
		const engine = await makeEngine(cwd, sm, reg.getModel("faux-rp"));
		await engine.performTurn("看看周围。");
		assert.equal(reg.getPendingResponseCount(), 1);
		assertSessionAligned(sessionByEngine.get(engine)!);
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("pi：忙时排队的下一拍在前拍落树后装配", { timeout: 5000 }, async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	const entered = Promise.withResolvers<void>();
	const answer = Promise.withResolvers<string | undefined>();
	try {
		let secondContext: any;
		reg.setResponses([
			fauxAssistantMessage([fauxToolCall("ask", { question: "走吗？", options: ["走", "等"] })], { stopReason: "toolUse" }),
			fauxAssistantMessage("她跨过门槛。"), fauxScribe({ location: "门内" }),
			(ctx) => { secondContext = ctx; return fauxAssistantMessage("她停在廊下。"); }, fauxScribeEmpty(),
		]);
		const ends: any[] = [];
		const engine = await makePiEngine({ ...piDeps(cwd, sm, reg.getModel("faux-rp")),
			askUser: async () => { entered.resolve(); return answer.promise; },
			events: { onTurnEnd: info => ends.push(info) },
		});
		const first = engine.performTurn("往前走。");
		await entered.promise;
		await engine.performTurn("进门以后停下。");
		assert.equal(userEntries(sm).length, 1);
		answer.resolve("走");
		await first;
		assert.equal(ends.length, 2);
		assert.ok(ends.every(info => info.entryId && !info.error));
		assert.equal(userEntries(sm).length, 2);
		assert.ok(JSON.stringify(secondContext.messages).includes("她跨过门槛"));
		assert.ok(JSON.stringify(secondContext.messages).includes("门内"));
		assertSessionAligned(sessionByEngine.get(engine)!);
	} finally {
		answer.resolve(undefined);
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("pi：错误与空回复不存过程正文，后续拍仍可继续", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		const ends: any[] = [];
		const engine = await makePiEngine({ ...piDeps(cwd, sm, reg.getModel("faux-rp")), events: { onTurnEnd: info => ends.push(info) } });
		for (const response of [fauxAssistantMessage("", { stopReason: "error", errorMessage: "provider unavailable" }), fauxAssistantMessage("")]) {
			reg.setResponses([response]);
			await engine.performTurn("继续。");
			assertSessionAligned(sessionByEngine.get(engine)!);
		}
		assert.ok(ends[0].error.includes("provider unavailable"));
		assert.equal(ends[1].error, "no-draft");
		assert.equal(sm.getEntries().filter(entry => entry.type === "message" && entry.message.role === "assistant").length, 0);
		reg.setResponses(directBeat("雨停了。") as never);
		await engine.performTurn("等雨停。");
		assert.ok(ends[2].entryId && !ends[2].error);
		assertSessionAligned(sessionByEngine.get(engine)!);
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("pi SDK：真实 HTTP 请求保留 RP 上下文、采样参数、鉴权及原生工具续轮", { timeout: 15000 }, async () => {
	const { cwd, sm } = makeStage();
	const requests: any[] = [];
	const auth: unknown[] = [];
	const server = createServer(async (req, res) => {
		let raw = "";
		for await (const chunk of req) raw += chunk;
		requests.push(JSON.parse(raw));
		auth.push(req.headers.authorization);
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		const tool = requests.length === 1;
		const delta = tool
			? { role: "assistant", tool_calls: [{ index: 0, id: "call-native", type: "function", function: { name: "world_state_get", arguments: "{}" } }] }
			: { role: "assistant", content: "她收起了地图。" };
		for (const [part, reason] of [[delta, null], [{}, tool ? "tool_calls" : "stop"]]) {
			res.write(`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: "native-test", choices: [{ index: 0, delta: part, finish_reason: reason }] })}\n\n`);
		}
		res.end("data: [DONE]\n\n");
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	try {
		writeFileSync(join(cwd, "preset.json"), JSON.stringify({ blocks: [{ id: "style", channel: "system", enabled: true, content: "固定测试文案。" }], samplers: { temperature: 0.37, top_p: 0.71 } }));
		writeFileSync(join(cwd, "liyuan.config.json"), JSON.stringify({ card: "card.json", userName: "沈舟", preset: "preset.json" }));
		// 装载态不直接喂预设：正文经服务端同步落成卡档案里的（预设）条目（这里手写同一形态），采样参数仍从预设文档取
		writeFileSync(join(cwd, "AGENTS.md"), ["## style（预设）", "固定测试文案。", ""].join("\n"));
		const model = { ...getModel("openai", "gpt-4o-mini")!, api: "openai-completions", provider: "native-test", id: "native-test", baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` };
		const side: StageStreamFn = () => ({ async *[Symbol.asyncIterator]() { yield { type: "done", message: fauxScribeEmpty() }; }, result: async () => fauxScribeEmpty() });
		const ends: any[] = [];
		const engine = await makePiEngine({ ...piDeps(cwd, sm, model), sideStreamFn: side, events: { onTurnEnd: info => ends.push(info) } }, true);
		await engine.performTurn("收起地图。");
		assert.equal(ends[0].error, undefined);
		assert.ok(ends[0].entryId && !ends[0].error);
		assert.equal(requests.length, 2);
		assert.deepEqual(auth, ["Bearer test-key", "Bearer test-key"]);
		for (const body of requests) {
			assert.equal(body.temperature, 0.37);
			assert.equal(body.top_p, 0.71);
			assert.ok(body.tools.some((tool: any) => tool.function.name === "world_state_get"));
			assert.ok(JSON.stringify(body.messages).includes("固定测试文案"));
			assert.ok(JSON.stringify(body.messages).includes("收起地图"));
		}
		assert.ok(requests[1].messages.some((message: any) => message.role === "tool" && message.tool_call_id === "call-native"));
		assertSessionAligned(sessionByEngine.get(engine)!);
	} finally {
		await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("pi：媒体只在正文之后落一份，保留 toolCallId，下一拍不重放媒体工具过程", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		const call = fauxToolCall("show_html", { html: "<p>临时地图</p>", title: "地图" });
		let nextContext: any;
		reg.setResponses([
			fauxAssistantMessage([call], { stopReason: "toolUse" }),
			fauxAssistantMessage("她展开地图。"), fauxScribeEmpty(),
			(ctx) => { nextContext = ctx; return fauxAssistantMessage("她指向东面。"); }, fauxScribeEmpty(),
		]);
		const engine = await makePiEngine({ ...piDeps(cwd, sm, reg.getModel("faux-rp")), media: true });
		await engine.performTurn("给我看地图。");
		const messages = sm.getBranch().filter(entry => entry.type === "message");
		assert.deepEqual(messages.map(entry => entry.message.role), ["user", "assistant", "toolResult"]);
		const media = messages[2].message as any;
		assert.equal(media.toolCallId, call.id);
		assert.equal(media.details.rpHtml.html, "<p>临时地图</p>");
		assert.ok(sm.getBranch().findIndex(e => e.id === messages[1].id) > sm.getBranch().findIndex(e => e.id === messages[0].id));
		assertSessionAligned(sessionByEngine.get(engine)!);
		await engine.performTurn("东面有什么？");
		assert.ok(!nextContext.messages.some((message: any) => message.role === "toolResult"));
		assertSessionAligned(sessionByEngine.get(engine)!);
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("pi：reload 重绑同一会话的 RP 连接，之后仍走原生循环", async () => {
	const { cwd, sm } = makeStage();
	const model = getModel("anthropic", "claude-sonnet-4-5")!;
	const responses = [fauxAssistantMessage("她翻开第一页。"), fauxScribeEmpty(), fauxAssistantMessage("她翻到第二页。"), fauxScribeEmpty()];
	const stream: StageStreamFn = () => {
		const message = responses.shift()!;
		return { async *[Symbol.asyncIterator]() { yield { type: "done", message }; }, result: async () => message };
	};
	try {
		const ends: any[] = [];
		const engine = await makePiEngine({ ...piDeps(cwd, sm, model), sideStreamFn: stream, events: { onTurnEnd: info => ends.push(info) } });
		const session = sessionByEngine.get(engine)!;
		await engine.performTurn("打开书。");
		const before = getStageConnection(sm.getSessionId());
		assert.ok(before);
		await session.reload();
		assert.ok(getStageConnection(sm.getSessionId()));
		assert.notEqual(getStageConnection(sm.getSessionId()), before);
		await engine.performTurn("翻一页。");
		assert.ok(ends.every(info => info.entryId && !info.error));
		assert.equal(ends.length, 2);
		assertSessionAligned(session);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

const draftTool = (name: string, args: Record<string, unknown>) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });

test("第三刀·收笔遵循 pi 终止语义：单独调用不再续轮，混合批次仍能一致落稿", async () => {
	for (const mixed of [false, true]) {
		const { cwd, sm } = makeStage();
		const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
		try {
			let scribeSeen = false;
			reg.setResponses([
				draftTool("draft_write", { version: 0, content: "她合上了书。" }),
				fauxAssistantMessage([
					...(mixed ? [fauxToolCall("draft_read", {})] : []),
					fauxToolCall("draft_seal", { version: 1 }),
				], { stopReason: "toolUse" }),
				...(mixed ? [fauxAssistantMessage("")] : []),
				(ctx) => {
					assert.equal(ctx.tools?.length ?? 0, 0, "收笔之后应直接进入场记");
					scribeSeen = true;
					return fauxScribeEmpty();
				},
			]);
			const engine = await makePiEngine(piDeps(cwd, sm, reg.getModel("faux-rp")));
			await engine.performTurn("合上书。");
			assert.equal(scribeSeen, true);
			assert.equal(reg.state.callCount, mixed ? 4 : 3);
			assert.equal(engine.getWorkspace()?.phase, "sealed");
			assert.equal(rebuildHistory(sm.getBranch() as BranchEntryLike[]).history.at(-1)?.text, "她合上了书。");
			assertSessionAligned(sessionByEngine.get(engine)!);
		} finally { reg.unregister(); rmSync(cwd, { recursive: true, force: true }); }
	}
});

test("第三刀·原生循环：探索门禁、分段、ask 改道、精确修改与收笔共用同一工件", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		let gateResult: any, askResult: any;
		reg.setResponses([
			draftTool("beat_plan", { _: true, mode: "explore", steps: [{ id: "gate", text: "去西门" }] }),
			draftTool("draft_write", { version: 0, content: "探索期不应落笔" }),
			(ctx) => { gateResult = ctx.messages.findLast((m: any) => m.role === "toolResult"); return draftTool("beat_plan", { mode: "write" }); },
			draftTool("draft_write", { version: 0, content: "她停在路口。" }),
			draftTool("ask", { question: "往哪走？", options: ["东门", "西门"] }),
			(ctx) => { askResult = ctx.messages.findLast((m: any) => m.role === "toolResult"); return draftTool("beat_plan", { steps: [{ id: "gate", text: "去西门", status: "cancelled" }, { id: "east", text: "去东门", status: "in_progress" }] }); },
			draftTool("draft_append", { version: 1, content: "她向东门快走。" }),
			draftTool("draft_read", { _: true }),
			draftTool("draft_edit", { version: 2, edits: [{ old: "快走", new: "缓步而行" }] }),
			draftTool("draft_seal", { version: 3 }),
			fauxScribeEmpty(),
		]);
		const ends: any[] = [];
		let engine: StageEngine;
		engine = await makePiEngine({ ...piDeps(cwd, sm, reg.getModel("faux-rp")), askUser: async () => {
			assert.equal(engine.getWorkspace()?.draft, "她停在路口。");
			assert.equal(engine.getWorkspace()?.phase, "waiting");
			return "东门";
		}, events: { onTurnEnd: (info) => ends.push(info) } });
		await engine.performTurn("到路口再由我选方向。");
		assert.equal(gateResult.isError, true);
		assert.ok(JSON.stringify(askResult).includes("东门"));
		const ws = engine.getWorkspace()!;
		assert.equal(ws.draft, "她停在路口。\n\n她向东门缓步而行。");
		assert.equal(ws.phase, "sealed");
		assert.equal(ws.version, 3);
		assert.equal(ws.explicitWrites, 3);
		assert.equal(ws.directWrites, 0);
		assert.equal(ws.plan[1].status, "in_progress", "未勾完计划仍可收笔");
		assert.equal(ends[0].error, undefined);
		assert.equal(reg.getPendingResponseCount(), 0);
		assert.equal(rebuildHistory(sm.getBranch() as BranchEntryLike[]).history.at(-1)?.text, ws.draft);
		assert.equal(ws.timeline.filter((s) => s.kind === "text").map((s) => s.text).join(""), ws.draft);
		const activities = ws.timeline.flatMap((s) => s.kind === "tool" ? s.activities : []);
		assert.equal(activities.filter((a) => a.kind === "tool_start").length, activities.filter((a) => a.kind === "tool_end").length);
		assertSessionAligned(sessionByEngine.get(engine)!);
	} finally { reg.unregister(); rmSync(cwd, { recursive: true, force: true }); }
});

test("第三刀·参数流中停止：未执行的半段落盘，重新创建引擎仍可读取", async () => {
	for (const append of [false, true]) {
		const { cwd, sm } = makeStage();
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		let requests = 0;
		const partialText = "她拿起桌上的";
		const partial = fauxAssistantMessage([fauxToolCall(append ? "draft_append" : "draft_write", { version: append ? 1 : 0, content: partialText })], { stopReason: "aborted" });
		const stream: StageStreamFn = () => {
			requests++;
			if (append && requests === 1) {
				const first = draftTool("draft_write", { version: 0, content: "门开了。" });
				return { async *[Symbol.asyncIterator]() { yield { type: "done", message: first }; }, result: async () => first };
			}
			return { async *[Symbol.asyncIterator]() {
				yield { type: "start", partial: { ...partial, content: [], stopReason: "pending" } };
				await new Promise((resolve) => setTimeout(resolve, 270));
				yield { type: "toolcall_delta", contentIndex: 0, delta: partialText, partial };
				yield { type: "error", error: partial };
			}, result: async () => partial };
		};
		try {
			let engine: StageEngine;
			engine = await makePiEngine({ ...piDeps(cwd, sm, model), sideStreamFn: stream, events: { onWorkspace: (ws) => {
				if (ws.preview?.content === partialText) engine.abort();
			} } });
			await engine.performTurn("继续。");
			const ws = engine.getWorkspace()!;
			assert.equal(ws.draft, (append ? "门开了。\n\n" : "") + partialText);
			assert.equal(ws.phase, "stopped");
			assert.equal(ws.explicitWrites, append ? 1 : 0, "半截工具调用没有执行");
			assert.equal(ws.directWrites, 1, "中断文本由宿主保存，单独计数");
			assert.equal(requests, append ? 2 : 1, "停止后没有场记调用");
			assert.equal(rebuildHistory(sm.getBranch() as BranchEntryLike[]).history.at(-1)?.text, ws.draft);
			const reopened = new StageEngine({ ...piDeps(cwd, sm, model), getSession: () => sessionByEngine.get(engine)! as never });
			assert.deepEqual(reopened.getWorkspace(), ws);
		} finally { rmSync(cwd, { recursive: true, force: true }); }
	}
});

test("第三刀·探索直出不越过写入阶段，普通工具两侧的直接正文仍保留", async () => {
	const { cwd, sm } = makeStage(); const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		reg.setResponses([draftTool("beat_plan", { mode: "explore" }), fauxAssistantMessage("这里只是探索结论。")]);
		const engine = await makePiEngine(piDeps(cwd, sm, reg.getModel("faux-rp")));
		await engine.performTurn("先探索。");
		assert.equal(engine.getWorkspace()?.draft, "");
		assert.equal(engine.getWorkspace()?.version, 0);
		assert.equal(engine.getWorkspace()?.sealed, false);
		reg.setResponses([
			fauxAssistantMessage([{ type: "text", text: "她握住窗闩。" }, fauxToolCall("world_state_get", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("她推开窗。"), fauxScribeEmpty(),
		]);
		await engine.performTurn("继续演。");
		assert.equal(engine.getWorkspace()?.draft, "她握住窗闩。她推开窗。");
		assert.equal(engine.getWorkspace()?.timeline.filter((s) => s.kind === "text").map((s) => s.text).join(""), "她握住窗闩。她推开窗。");
	} finally { reg.unregister(); rmSync(cwd, { recursive: true, force: true }); }
});

test("第三刀·停止：ask 前已写文本保留，同批续写不执行，场记不运行", async () => {
	const { cwd, sm } = makeStage(); const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		reg.setResponses([
			draftTool("draft_write", { version: 0, content: "她打开了门。" }),
			fauxAssistantMessage([fauxToolCall("ask", { question: "进去吗？", options: ["进去", "等"] }), fauxToolCall("draft_append", { version: 1, content: "不该执行" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("不该请求"),
		]);
		const engine = await makePiEngine({ ...piDeps(cwd, sm, reg.getModel("faux-rp")), askUser: async () => undefined });
		await engine.performTurn("开门，等我决定。");
		assert.equal(engine.getWorkspace()?.draft, "她打开了门。");
		assert.equal(engine.getWorkspace()?.phase, "stopped");
		assert.equal(reg.getPendingResponseCount(), 1);
		assert.ok(!sm.getBranch().some((e) => e.type === "custom" && e.customType === "rp-state"));
		assertSessionAligned(sessionByEngine.get(engine)!);
	} finally { reg.unregister(); rmSync(cwd, { recursive: true, force: true }); }
});

test("第三刀·直出兼容：提问前的直接正文与回答后的直接续文都保存", async () => {
	const { cwd, sm } = makeStage(); const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		reg.setResponses([
			fauxAssistantMessage([{ type: "text", text: "她打开了门。" }, fauxToolCall("ask", { question: "进去吗？", options: ["进去", "等"] })], { stopReason: "toolUse" }),
			fauxAssistantMessage("她走进屋里。"), fauxScribeEmpty(),
		]);
		let engine: StageEngine;
		engine = await makePiEngine({ ...piDeps(cwd, sm, reg.getModel("faux-rp")), askUser: async () => {
			assert.equal(engine.getWorkspace()?.draft, "她打开了门。"); return "进去";
		} });
		await engine.performTurn("开门，等我决定。");
		assert.equal(engine.getWorkspace()?.draft, "她打开了门。\n\n她走进屋里。");
		assert.equal(engine.getWorkspace()?.phase, "sealed");
		assert.equal(engine.getWorkspace()?.explicitWrites, 0);
		assert.equal(reg.getPendingResponseCount(), 0);
	} finally { reg.unregister(); rmSync(cwd, { recursive: true, force: true }); }
});

test("第三刀·真实完成状态：写了稿但未收笔时保留工件，不用口头完成冒充收笔", async () => {
	const { cwd, sm } = makeStage(); const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		reg.setResponses([draftTool("draft_write", { version: 0, content: "她停在门外。" }), fauxAssistantMessage(""), fauxScribeEmpty()]);
		const ends: any[] = [];
		const engine = await makePiEngine({ ...piDeps(cwd, sm, reg.getModel("faux-rp")), events: { onTurnEnd: (info) => ends.push(info) } });
		await engine.performTurn("继续。");
		assert.equal(ends[0].error, "unsealed-draft");
		assert.equal(engine.getWorkspace()?.phase, "stopped");
		assert.equal(engine.getWorkspace()?.draft, "她停在门外。");
		assert.equal(reg.getPendingResponseCount(), 1, "不启动未收笔稿件的场记");
	} finally { reg.unregister(); rmSync(cwd, { recursive: true, force: true }); }
});

test("第三刀·等待时用户恢复版本：旧版本写入失败，模型读取新版本后继续", async () => {
	const { cwd, sm } = makeStage(); const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		let stale: any;
		reg.setResponses([
			draftTool("draft_write", { version: 0, content: "她留下了。" }),
			draftTool("draft_write", { version: 1, content: "她离开了。" }),
			draftTool("ask", { question: "接着走吗？", options: ["留下", "走"] }),
			draftTool("draft_append", { version: 2, content: "过期续写" }),
			(ctx) => { stale = ctx.messages.findLast((m: any) => m.role === "toolResult"); return draftTool("draft_read", {}); },
			draftTool("draft_append", { version: 3, content: "她坐到桌边。" }),
			draftTool("draft_seal", { version: 4 }), fauxScribeEmpty(),
		]);
		let engine: StageEngine;
		engine = await makePiEngine({ ...piDeps(cwd, sm, reg.getModel("faux-rp")), askUser: async () => {
			const ws = engine.getWorkspace()!;
			assert.equal(ws.version, 2);
			assert.equal(engine.restoreDraft(ws.id, 1, 2).version, 3);
			assert.equal(engine.getWorkspace()?.draft, "她留下了。");
			return "留下";
		} });
		await engine.performTurn("到门口等我决定。");
		assert.equal(stale.isError, true, JSON.stringify(stale));
		assert.equal(engine.getWorkspace()?.draft, "她留下了。\n\n她坐到桌边。");
		assert.equal(engine.getWorkspace()?.version, 4);
		assert.equal(engine.getWorkspace()?.phase, "sealed");
	} finally { reg.unregister(); rmSync(cwd, { recursive: true, force: true }); }
});

test("第三刀·用户恢复留档中断：重建引擎补记一次，未收笔状态不被抹掉", async () => {
	const { cwd, sm } = makeStage(); const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		reg.setResponses([draftTool("draft_write", { version: 0, content: "第一稿" }), draftTool("draft_write", { version: 1, content: "第二稿" }), fauxAssistantMessage("")]);
		const engine = await makePiEngine(piDeps(cwd, sm, reg.getModel("faux-rp")));
		await engine.performTurn("改稿。");
		const ws = engine.getWorkspace()!;
		const append = sm.appendCustomEntry.bind(sm);
		sm.appendCustomEntry = (type, data) => {
			if (type === "rp-draft-revision") throw new Error("模拟会话文件不可写");
			return append(type, data);
		};
		assert.throws(() => engine.restoreDraft(ws.id, 1, 2), /不可写/);
		sm.appendCustomEntry = append;
		const reopened = new StageEngine({ ...piDeps(cwd, sm, reg.getModel("faux-rp")), getSession: () => sessionByEngine.get(engine)! as never });
		assert.equal(reopened.getWorkspace()?.draft, "第一稿");
		assert.equal(reopened.getWorkspace()?.phase, "stopped");
		assert.equal(reopened.getWorkspace()?.version, 3);
		assert.equal(reopened.getWorkspace()?.restorePending, undefined);
		assert.equal(sm.getBranch().filter((e) => e.type === "custom" && e.customType === "rp-draft-revision").length, 1);
		assert.equal(rebuildHistory(sm.getBranch() as BranchEntryLike[]).history.at(-1)?.text, "第一稿");
	} finally { reg.unregister(); rmSync(cwd, { recursive: true, force: true }); }
});

test("上一拍·原生循环：连续回改同一回复、原文后半保留，续演上下文没有过期改稿指令", async () => {
	const { cwd, sm } = makeStage(), reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		const original = "她推开门。‘进来。’\n\n她把干椅子放在桌边。\n\n后半段：窗下那本旧簿仍旧摊着，门边的竹盘没有移动。";
		const ends: any[] = [], refreshes: string[] = [];
		reg.setResponses(directBeat(original));
		const engine = await makePiEngine({ ...piDeps(cwd, sm, reg.getModel("faux-rp")), events: {
			onTurnEnd: (info) => ends.push(info),
			onReplyRevised: (id) => { refreshes.push(id); assert.ok(rebuildHistory(sm.getBranch() as BranchEntryLike[]).history.at(-1)?.text.includes("来，里面坐。")); },
		} });
		await engine.performTurn("我敲了敲门。");
		const source = engine.getWorkspace()!, sourceStore = new DraftStore(draftDirectory(cwd, sm.getSessionDir(), sm.getSessionId()), source.id);
		const sourceBytes = readFileSync(sourceStore.file, "utf8");
		let expected = original;
		for (const [index, old, replacement] of [[0, "进来。", "来，里面坐。"], [1, "干椅子", "干净的椅子"]] as const) {
			reg.setResponses([
				fauxAssistantMessage([{ type: "text", text: "我先看看上一拍。" }, fauxToolCall("previous_draft_read", {})], { stopReason: "toolUse" }),
				(ctx) => {
					const read = ctx.messages.findLast((m: any) => m.role === "toolResult") as any;
					assert.equal(read.isError, false);
					const data = JSON.parse(read.content[0].text);
					assert.equal(data.content, expected);
					assert.equal(data.version, index + 1);
					return draftTool("previous_draft_edit", { version: data.version, edits: [{ old, new: replacement }] });
				},
				fauxScribe({ time: "修订不能推进的时刻" }),
			]);
			await engine.performTurn(`第${index + 1}次改稿请求：只改措辞，其余保留。`);
			expected = expected.replace(old, replacement);
			assert.equal(reg.getPendingResponseCount(), 1, "修订工具原生终止，不发另一条回复或场记");
			assert.equal(ends.at(-1).error, undefined);
			assert.equal(ends.at(-1).entryId, undefined);
			assert.equal(ends.at(-1).revisedEntryId, source.entryId);
			const ws = engine.getWorkspace()!;
			assert.equal(ws.draft, expected);
			assert.equal(ws.entryId, source.entryId);
			assert.equal(ws.version, index + 2);
			assert.equal(new DraftStore(draftDirectory(cwd, sm.getSessionDir(), sm.getSessionId()), ws.id).read()?.draft, expected);
			assert.equal(engine.getWorkspaces().filter((w) => w.entryId === source.entryId).length, 1, "只展示当前分支的有效稿件");
			assert.equal(sm.getBranch().filter((e) => e.type === "message" && e.message.role === "assistant").length, 1);
			assert.equal(sm.getBranch().filter((e) => e.type === "custom" && e.customType === "rp-state").length, 0);
			const history = rebuildHistory(sm.getBranch() as BranchEntryLike[]).history;
			assert.deepEqual(history.slice(-2).map((m) => m.text), ["我敲了敲门。", expected]);
			assert.deepEqual(history.filter((m) => m.role === "user").map((m) => m.text), ["我敲了敲门。"]);
			assert.equal(readFileSync(sourceStore.file, "utf8"), sourceBytes);
			assertSessionAligned(sessionByEngine.get(engine)!);
		}
		assert.deepEqual(refreshes, [source.entryId, source.entryId]);
		const reopened = new StageEngine({ ...piDeps(cwd, sm, reg.getModel("faux-rp")), getSession: () => sessionByEngine.get(engine)! as never });
		assert.equal(reopened.getWorkspace()?.draft, expected);
		reg.setResponses([
			(ctx) => {
				const texts = ctx.messages.filter((m: any) => m.role === "assistant").map((m: any) => m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(""));
				assert.ok(texts.includes(expected), "下一发模型收到修后的整拍，含后半段");
				assert.ok(!JSON.stringify(ctx.messages).includes("次改稿请求"));
				return fauxAssistantMessage("她翻到了下一页。");
			}, fauxScribeEmpty(),
		]);
		await engine.performTurn("接着翻下一页。");
		assert.equal(reg.getPendingResponseCount(), 0);
		assert.ok(ends.at(-1).entryId);
		assert.equal(ends.at(-1).revisedEntryId, undefined);
		assert.equal(sm.getBranch().filter((e) => e.type === "message" && e.message.role === "assistant").length, 2);
	} finally { reg.unregister(); rmSync(cwd, { recursive: true, force: true }); }
});

test("上一拍·世界线：从共享回复开两条分支，各自修订，返回原点仍是原稿", async () => {
	const { cwd, sm } = makeStage(), reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		reg.setResponses(directBeat("她合上书。后半段原样保留。"));
		const engine = await makePiEngine(piDeps(cwd, sm, reg.getModel("faux-rp")));
		await engine.performTurn("合上书。");
		const session = sessionByEngine.get(engine)!, rootLeaf = sm.getLeafId()!, original = engine.getWorkspace()!;
		const leaves: string[] = [], drafts: string[] = [];
		for (const next of ["册子", "书册"]) {
			session.setLeaf(rootLeaf);
			assert.equal(engine.getWorkspace()?.draft, original.draft);
			reg.setResponses([draftTool("previous_draft_read", {}), draftTool("previous_draft_edit", { version: 1, edits: [{ old: "书", new: next }] })]);
			await engine.performTurn(`只把书换成${next}。`);
			leaves.push(sm.getLeafId()!); drafts.push(engine.getWorkspace()!.id);
			assert.equal(engine.getWorkspace()?.draft, `她合上${next}。后半段原样保留。`);
		}
		assert.notEqual(drafts[0], drafts[1]);
		session.setLeaf(leaves[0]);
		assert.equal(engine.getWorkspace()?.id, drafts[0]);
		assert.equal(rebuildHistory(sm.getBranch() as BranchEntryLike[]).history.at(-1)?.text, "她合上册子。后半段原样保留。");
		assert.ok(!engine.getWorkspaces().some((w) => w.id === drafts[1]));
		session.setLeaf(rootLeaf);
		assert.equal(engine.getWorkspace()?.draft, original.draft);
		assert.equal(rebuildHistory(sm.getBranch() as BranchEntryLike[]).history.at(-1)?.text, original.draft);
	} finally { reg.unregister(); rmSync(cwd, { recursive: true, force: true }); }
});

test("上一拍·混合工具批次：成功修订后，额外直出和同批新稿不能变成另一拍", async () => {
	const { cwd, sm } = makeStage(), reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		reg.setResponses(directBeat("窗边有灯。后半还在。"));
		const engine = await makePiEngine(piDeps(cwd, sm, reg.getModel("faux-rp")));
		await engine.performTurn("环顾屋里。");
		reg.setResponses([
			draftTool("previous_draft_read", {}),
			fauxAssistantMessage([fauxToolCall("world_state_get", {}), fauxToolCall("previous_draft_edit", { version: 1, edits: [{ old: "窗边", new: "窗下" }] }), fauxToolCall("draft_append", { version: 2, content: "不该续写的故事。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("已修改，接下来她走出了门。"), fauxScribeEmpty(),
		]);
		await engine.performTurn("只润色上一拍，别推进。");
		assert.equal(engine.getWorkspace()?.draft, "窗下有灯。后半还在。");
		assert.equal(reg.getPendingResponseCount(), 1);
		assert.equal(sm.getBranch().filter((e) => e.type === "message" && e.message.role === "assistant").length, 1);
		assert.equal(rebuildHistory(sm.getBranch() as BranchEntryLike[]).history.at(-1)?.text, "窗下有灯。后半还在。");
	} finally { reg.unregister(); rmSync(cwd, { recursive: true, force: true }); }
});

test("上一拍·同步中断：修订稿先持久化，重建引擎只补记一次，不生成替代回复", async () => {
	const { cwd, sm } = makeStage(), reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		reg.setResponses(directBeat("她说：进来。后半段。"));
		const engine = await makePiEngine(piDeps(cwd, sm, reg.getModel("faux-rp")));
		await engine.performTurn("进门。");
		const source = engine.getWorkspace()!;
		const append = sm.appendCustomEntry.bind(sm);
		sm.appendCustomEntry = (type, data) => { if (type === "rp-draft-revision") throw new Error("模拟回执同步中断"); return append(type, data); };
		reg.setResponses([draftTool("previous_draft_read", {}), draftTool("previous_draft_edit", { version: 1, edits: [{ old: "进来", new: "请进" }] }), fauxAssistantMessage("同步尚未成功。")]);
		await engine.performTurn("只润色台词。");
		sm.appendCustomEntry = append;
		const reopened = new StageEngine({ ...piDeps(cwd, sm, reg.getModel("faux-rp")), getSession: () => sessionByEngine.get(engine)! as never });
		assert.equal(reopened.getWorkspace()?.draft, "她说：请进。后半段。");
		assert.equal(reopened.getWorkspace()?.restorePending, undefined);
		assert.equal(reopened.getWorkspace()?.entryId, source.entryId);
		assert.equal(sm.getBranch().filter((e) => e.type === "custom" && e.customType === "rp-draft-revision").length, 1);
		assert.equal(sm.getBranch().filter((e) => e.type === "message" && e.message.role === "assistant").length, 1);
		assert.equal(rebuildHistory(sm.getBranch() as BranchEntryLike[]).history.at(-1)?.text, "她说：请进。后半段。");
	} finally { reg.unregister(); rmSync(cwd, { recursive: true, force: true }); }
});

test("上一拍·停止：已成功落回原回复的修订保留，不追加半拍或记账", async () => {
	const { cwd, sm } = makeStage(), reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		reg.setResponses(directBeat("她说：进来。后半段。"));
		let engine: StageEngine;
		engine = await makePiEngine({ ...piDeps(cwd, sm, reg.getModel("faux-rp")), events: { onReplyRevised: () => engine.abort() } });
		await engine.performTurn("进门。");
		reg.setResponses([draftTool("previous_draft_read", {}), draftTool("previous_draft_edit", { version: 1, edits: [{ old: "进来", new: "请进" }] }), fauxScribeEmpty()]);
		await engine.performTurn("只润色台词。");
		assert.equal(engine.getWorkspace()?.phase, "sealed");
		assert.equal(engine.getWorkspace()?.draft, "她说：请进。后半段。");
		assert.equal(reg.getPendingResponseCount(), 1);
		assert.equal(sm.getBranch().filter((e) => e.type === "message" && e.message.role === "assistant").length, 1);
		const projected = applyDraftRevisions(sm.getBranch());
		assert.ok(JSON.stringify(projected.find((e) => e.type === "message" && e.message.role === "assistant")).includes("请进"));
	} finally { reg.unregister(); rmSync(cwd, { recursive: true, force: true }); }
});

test("上一拍·选择归属：ask 回答与原拍持久化，下一拍历史和读稿都保留实际用户决定", async () => {
	const { cwd, sm } = makeStage(), reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		const answer = "改变主意，先回屋取伞。";
		reg.setResponses([
			fauxAssistantMessage([{ type: "text", text: "她在路口等你。" }, fauxToolCall("ask", { question: "走哪边？", options: ["去渡口", "去石桥"] })], { stopReason: "toolUse" }),
			fauxAssistantMessage("她随你回了屋。"), fauxScribeEmpty(),
		]);
		const engine = await makePiEngine({ ...piDeps(cwd, sm, reg.getModel("faux-rp")), askUser: async () => answer });
		await engine.performTurn("到了路口让我选。");
		assert.deepEqual(engine.getWorkspace()?.choices, [{ question: "走哪边？", answer }]);
		const first = sm.getBranch().find((e) => e.type === "message" && e.message.role === "user") as any;
		assert.equal(first.message.content[0].text, "到了路口让我选。", "原始 user 仍只有一条原文");
		reg.setResponses([
			(ctx) => {
				assert.ok(ctx.messages.some((m: any) => m.role === "user" && JSON.stringify(m.content).includes(answer)), "选择作为历史用户输入进入下一发");
				return draftTool("previous_draft_read", {});
			},
			(ctx) => {
				const read = ctx.messages.findLast((m: any) => m.role === "toolResult") as any;
				const data = JSON.parse(read.content[0].text);
				assert.deepEqual(data.userChoices, [{ question: "走哪边？", answer }]);
				return draftTool("previous_draft_edit", { version: data.version, edits: [{ old: "路口", new: "岔路口" }] });
			},
		]);
		await engine.performTurn("只改第一句，其他不动。");
		assert.equal(engine.getWorkspace()?.draft, "她在岔路口等你。\n\n她随你回了屋。");
		assert.deepEqual(engine.getWorkspace()?.choices, [{ question: "走哪边？", answer }]);
		assert.equal(reg.getPendingResponseCount(), 0);
	} finally { reg.unregister(); rmSync(cwd, { recursive: true, force: true }); }
});

test("上一拍·发布守卫：落稿后切走分支，不把回执写到别的世界线", async () => {
	const { cwd, sm } = makeStage(), reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		let rootLeaf: string | undefined, editLeaf: string | undefined, switched = false, engine: StageEngine;
		reg.setResponses(directBeat("她点头。后半段。"));
		engine = await makePiEngine({ ...piDeps(cwd, sm, reg.getModel("faux-rp")), events: { onWorkspace: (ws) => {
			if (rootLeaf && ws.revision && ws.restorePending && !switched) {
				switched = true; editLeaf = sm.getLeafId()!;
				// Simulate a low-level host/tree change; AgentSession itself forbids UI navigation while streaming.
				sm.branch(rootLeaf);
			}
		} } });
		await engine.performTurn("点头。"); rootLeaf = sm.getLeafId()!;
		reg.setResponses([draftTool("previous_draft_read", {}), draftTool("previous_draft_edit", { version: 1, edits: [{ old: "点头", new: "颔首" }] }), fauxAssistantMessage("同步等待恢复。")]);
		await engine.performTurn("润色第一句。");
		assert.equal(switched, true);
		assert.equal(sm.getBranch().filter((e) => e.type === "custom" && e.customType === "rp-draft-revision").length, 0);
		assert.equal(rebuildHistory(sm.getBranch() as BranchEntryLike[]).history.at(-1)?.text, "她点头。后半段。");
		sessionByEngine.get(engine)!.setLeaf(editLeaf!);
		assert.equal(engine.getWorkspace()?.draft, "她颔首。后半段。");
		assert.equal(sm.getBranch().filter((e) => e.type === "custom" && e.customType === "rp-draft-revision").length, 1);
	} finally { reg.unregister(); rmSync(cwd, { recursive: true, force: true }); }
});

test("pi：瞬时错误自动重试（默认 5 次上限），半截断流清理后落树纯净正文", async () => {
	const { cwd, sm } = makeStage();
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	try {
		let clears = 0;
		let end: any = null;
		const engine = await makePiEngine({
			...piDeps(cwd, sm, reg.getModel("faux-rp")),
			events: {
				onStreamClear: () => clears++,
				onTurnEnd: (info) => (end = info),
			},
		});
		const session = sessionByEngine.get(engine)!;
		assert.equal(session.settingsManager.getRetrySettings().maxRetries, 5, "默认重试上限为 5 次");
		session.settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 5, baseDelayMs: 1 } });

		reg.setResponses([
			fauxAssistantMessage("半截残句不应保留", { stopReason: "error", errorMessage: "502 Bad Gateway" }),
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
			...directBeat("云散月明，她推窗望向山道。"),
		] as never);

		await engine.performTurn("推窗。");
		assert.ok(end && !end.error && end.entryId, "重试成功后应正常落树");
		assert.ok(clears >= 2, "每次报错重试前应清理前端半截流式缓冲");
		const msgEntries = sm.getBranch().filter((e) => e.type === "message" || (e.type === "custom" && e.customType === CONVERSATION_PROCESS_TYPE));
		const replies = sm.getBranch().filter((e) => e.type === "message" && e.message.role === "assistant") as any[];
		assert.equal(replies.length, 1);
		assert.equal(replies[0].message.content.find((c: any) => c.type === "text")?.text, "云散月明，她推窗望向山道。");
		assert.ok(!JSON.stringify(msgEntries).includes("半截残句不应保留"), "失败重试的半截残句不得混入定稿、时间线或过程记录");
		assertSessionAligned(session);
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

