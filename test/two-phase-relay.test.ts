import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, createAgentSession } from "@liyuan/agent-runtime";
import { registerFauxProvider } from "@liyuan/ai/compat";
import { fauxAssistantMessage } from "@liyuan/ai/providers/faux";
import roleplayExtension from "../.liyuan/extensions/roleplay.ts";
import { StageEngine, type BrowserRelayTurnInput } from "../src/stage/engine.ts";
import { extractToolBridgeOutputText } from "../web/src/tavernStreamPipeline.ts";

async function createStageWithPreset(presetRaw: Record<string, unknown> | null, configExtra: Record<string, unknown> = {}) {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-2phase-"));
	const reg = registerFauxProvider({ models: [{ id: "faux-rp" }] });
	mkdirSync(join(cwd, "assets", "cards"), { recursive: true });
	mkdirSync(join(cwd, "assets", "presets"), { recursive: true });
	mkdirSync(join(cwd, "assets", "lorebooks"), { recursive: true });
	writeFileSync(
		join(cwd, "assets", "cards", "c.json"),
		JSON.stringify({
			data: {
				name: "青梧",
				description: "听雨轩掌柜。",
				first_mes: "请喝茶。",
				character_book: {
					entries: [
						{ uid: 1, comment: "玄铁令", keys: ["令牌", "玄铁令"], content: "玄铁令乃掌门亲授之物。", constant: false, enabled: true, insertion_order: 100 },
					],
				},
			},
		}),
	);
	writeFileSync(
		join(cwd, "assets", "lorebooks", "b.json"),
		JSON.stringify({
			entries: {
				"1": { uid: 1, comment: "玄铁令", key: ["令牌", "玄铁令"], content: "玄铁令乃掌门亲授之物。", constant: false, disable: false, order: 100 },
			},
		}),
	);
	if (presetRaw) {
		writeFileSync(join(cwd, "assets", "presets", "p.json"), JSON.stringify(presetRaw));
	}
	writeFileSync(
		join(cwd, "liyuan.config.json"),
		JSON.stringify({
			card: "assets/cards/c.json",
			lorebooks: ["assets/lorebooks/b.json"],
			...(presetRaw ? { preset: "assets/presets/p.json" } : {}),
			presetMode: "liyuan",
			userName: "沈舟",
			...configExtra,
		}),
	);

	const sm = SessionManager.inMemory(cwd);
	const model = reg.getModel("faux-rp");
	const agentDir = join(cwd, ".pi-test");
	mkdirSync(agentDir, { recursive: true });
	const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null });
	modelRuntime.registerProvider(String(model.provider), { api: model.api, baseUrl: model.baseUrl, apiKey: "k", models: [model as never] });
	await modelRuntime.setRuntimeApiKey(String(model.provider), "k");
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
	return {
		cwd,
		sm,
		session,
		reg,
		cleanup: async () => {
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			session.dispose();
			reg.unregister();
			rmSync(cwd, { recursive: true, force: true });
		},
	};
}

test("刀3&刀4 · direct 普通纯文本预设零影响：完全不走 relayModelTurn，原生直连跑完", async () => {
	const env = await createStageWithPreset({
		prompts: [{ identifier: "main", name: "文风", role: "system", content: "语言自然简练。" }],
		prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
	});
	try {
		let relayCalled = 0;
		const engine = new StageEngine({
			cwd: env.cwd,
			getSession: () => env.session as never,
			getModel: () => env.session.model as never,
			getAuth: async () => ({ apiKey: "k" }),
			getThinking: () => "off",
			sideStreamFn: env.session.modelRuntime.streamSimple.bind(env.session.modelRuntime) as never,
			relayModelTurn: async () => {
				relayCalled++;
				return null;
			},
		});
		env.reg.setResponses([fauxAssistantMessage("青梧点头示意。"), fauxAssistantMessage('{"patch":{}}')]);
		const end = await engine.performTurn("我坐下喝茶。");
		assert.equal(end.error, undefined);
		assert.equal(relayCalled, 0, "普通直连预设绝不触发中转");
	} finally {
		await env.cleanup();
	}
});

test("刀4 · two-phase-bridge 两段流转：Phase 1 查世界书→enter_writing_phase→Phase 2 保留预填与暗号走中转出正文并入同一时间线", async () => {
	const env = await createStageWithPreset({
		extensions: {
			SPreset: {
				ToolBindings: {
					soliumbra_reply: { enabled: true, form: { name: "soliumbra_reply", parameters: [] } },
				},
				FinalRequestProcessing: { enabled: true, script: "({ request }) => request" },
			},
		},
		prompts: [
			{ identifier: "chatHistory", name: "Chat History", marker: true, role: "system", content: "" },
			{
				identifier: "after1",
				name: "格式",
				role: "system",
				content: "<<<|catgodml|registerPart:game:<game></game>>>>正文用<game>包裹。",
			},
			{ identifier: "pf", name: "预填", role: "assistant", content: "OUTPUT <think_fox~>" },
		],
		prompt_order: [
			{
				character_id: 100001,
				order: [
					{ identifier: "chatHistory", enabled: true },
					{ identifier: "after1", enabled: true },
					{ identifier: "pf", enabled: true },
				],
			},
		],
	});
	try {
		const relayLogs: Array<{ phase: string; toolsCount: number; messages: Array<Record<string, unknown>> }> = [];
		let exploreStep = 0;
		let scribeInput = "";
		env.reg.setResponses([
			(ctx) => {
				scribeInput = JSON.stringify(ctx.messages);
				return fauxAssistantMessage('{"patch":{"location":"听雨轩"}}');
			},
		]);

		const engine = new StageEngine({
			cwd: env.cwd,
			getSession: () => env.session as never,
			getModel: () => env.session.model as never,
			getAuth: async () => ({ apiKey: "k" }),
			getThinking: () => "off",
			sideStreamFn: env.session.modelRuntime.streamSimple.bind(env.session.modelRuntime) as never,
			relayModelTurn: async (input: BrowserRelayTurnInput) => {
				relayLogs.push({
					phase: input.phase,
					toolsCount: input.tools?.length ?? 0,
					messages: input.messages,
				});
				if (input.phase === "explore") {
					exploreStep++;
					if (exploreStep === 1) {
						return {
							text: "",
							thinking: "",
							stopReason: "toolUse",
							toolCalls: [{ id: "c_lore", name: "lorebook_search", arguments: { query: "玄铁令" } }],
						};
					}
					return {
						text: "过渡旁白不应进定稿",
						thinking: "",
						stopReason: "toolUse",
						toolCalls: [{ id: "c_enter", name: "enter_writing_phase", arguments: { notes: "已查实玄铁令乃掌门亲授" } }],
					};
				}
				// Phase 2 compose
				input.onDelta("thinking", "Phase2深度思考");
				input.onDelta("text", "<game>她接过玄铁令，目光一凝。</game>");
				return {
					text: "<game>她接过玄铁令，目光一凝。</game>",
					thinking: "Phase2深度思考",
					stopReason: "stop",
				};
			},
		});

		const end = await engine.performTurn("我亮出玄铁令。");
		assert.equal(end.error, undefined);
		assert.equal(relayLogs.length, 3, "Phase 1 两轮 + Phase 2 一轮共 3 次中转");

		// 检查 Phase 1 explore 携带真工具且不带假工具暗号和末尾预填
		assert.equal(relayLogs[0]!.phase, "explore");
		assert.ok(relayLogs[0]!.toolsCount > 0, "Phase 1 必须开放梨园真工具");
		const p1Text = JSON.stringify(relayLogs[0]!.messages);
		assert.equal(p1Text.includes("<<<|catgodml|"), false, "Phase 1 剥除假工具暗号");
		assert.equal(p1Text.includes("OUTPUT <think_fox~>"), false, "Phase 1 剥除末尾 prefill");

		// 检查 Phase 2 compose 撤掉真工具、保留假工具暗号和末尾 assistant 预填、并注入 Phase 1 查得资料
		const p2 = relayLogs[2]!;
		assert.equal(p2.phase, "compose");
		assert.equal(p2.toolsCount, 0, "Phase 2 必须撤掉全部梨园工具");
		const p2Tail = p2.messages[p2.messages.length - 1]!;
		assert.equal(p2Tail.role, "assistant", "Phase 2 末条必须保留预设原装 assistant 预填");
		assert.equal(p2Tail.content, "OUTPUT <think_fox~>");
		const p2All = JSON.stringify(p2.messages);
		assert.ok(p2All.includes("<<<|catgodml|registerPart:game:"), "Phase 2 保留假工具暗号供脚本消费");
		assert.ok(p2All.includes("玄铁令乃掌门亲授之物"), "Phase 1 查回的世界书内容准确进入 Phase 2");
		assert.ok(p2All.includes("已查实玄铁令乃掌门亲授"), "enter_writing_phase notes 进入 Phase 2");

		// 检查最终落树为单一完整回复且含完整时间线（Phase 1 工具活动 + Phase 2 思考/正文），无过渡旁白泄漏
		const msgs = env.sm.getBranch().filter((e: any) => e.type === "message") as Array<{ message: { role: string; content: Array<{ text?: string }>; details?: { rpTimeline?: Array<{ kind: string }> } } }>;
		const lastAsst = msgs[msgs.length - 1]!.message;
		assert.equal(lastAsst.role, "assistant");
		const savedText = lastAsst.content.find((c) => c.text)?.text ?? "";
		assert.equal(savedText, "<game>她接过玄铁令，目光一凝。</game>");
		assert.equal(savedText.includes("过渡旁白不应进定稿"), false);
		const tl = lastAsst.details?.rpTimeline ?? [];
		assert.ok(tl.some((s) => s.kind === "tool"), "时间线保留 Phase 1 工具步骤");
		assert.ok(tl.some((s) => s.kind === "thinking"), "时间线保留 Phase 2 思考");
		assert.ok(scribeInput.includes("她接过玄铁令，目光一凝。"), "场记收到净化后的 Phase 2 正文");
	} finally {
		await env.cleanup();
	}
});

test("刀4 · 无浏览器连接时（relayModelTurn 返回 null）自动退回 Node 原生直连，绝不卡死", async () => {
	const env = await createStageWithPreset({
		prompts: [
			{ identifier: "chatHistory", name: "Chat History", marker: true, role: "system", content: "" },
			{ identifier: "pf", name: "预填", role: "assistant", content: "OUTPUT:" },
		],
		prompt_order: [{ character_id: 100001, order: [{ identifier: "chatHistory", enabled: true }, { identifier: "pf", enabled: true }] }],
	});
	try {
		const engine = new StageEngine({
			cwd: env.cwd,
			getSession: () => env.session as never,
			getModel: () => env.session.model as never,
			getAuth: async () => ({ apiKey: "k" }),
			getThinking: () => "off",
			sideStreamFn: env.session.modelRuntime.streamSimple.bind(env.session.modelRuntime) as never,
			relayModelTurn: async () => null, // 模拟无浏览器客户端连接
		});
		env.reg.setResponses([fauxAssistantMessage("Node直连兜底回复。"), fauxAssistantMessage('{"patch":{}}')]);
		const end = await engine.performTurn("测试无浏览器降级。");
		assert.equal(end.error, undefined);
		const msgs = env.sm.getBranch().filter((e: any) => e.type === "message") as Array<{ message: { role: string; content: Array<{ text?: string }> } }>;
		assert.equal(msgs[msgs.length - 1]!.message.content.find((c) => c.text)?.text, "Node直连兜底回复。");
	} finally {
		await env.cleanup();
	}
});

test("刀4 · Phase 1 切到 Phase 2 时浏览器掉线（compose 返回 null）自动去预填走 Node 原生兜底", async () => {
	const env = await createStageWithPreset({
		prompts: [
			{ identifier: "chatHistory", name: "Chat History", marker: true, role: "system", content: "" },
			{ identifier: "pf", name: "预填", role: "assistant", content: "OUTPUT:" },
		],
		prompt_order: [{ character_id: 100001, order: [{ identifier: "chatHistory", enabled: true }, { identifier: "pf", enabled: true }] }],
	});
	try {
		let fallbackCtxMessages: unknown[] = [];
		const origFn = (env.session as any).agent.streamFunction;
		(env.session as any).agent.streamFunction = (model: any, ctx: any, opts: any) => {
			fallbackCtxMessages = ctx.messages;
			return origFn(model, ctx, opts);
		};
		const engine = new StageEngine({
			cwd: env.cwd,
			getSession: () => env.session as never,
			getModel: () => env.session.model as never,
			getAuth: async () => ({ apiKey: "k" }),
			getThinking: () => "off",
			sideStreamFn: env.session.modelRuntime.streamSimple.bind(env.session.modelRuntime) as never,
			relayModelTurn: async (input: BrowserRelayTurnInput) => {
				if (input.phase === "explore") {
					return {
						text: "",
						thinking: "",
						stopReason: "toolUse",
						toolCalls: [{ id: "c_enter2", name: "enter_writing_phase", arguments: { notes: "准备交稿" } }],
					};
				}
				return null; // Phase 2 时浏览器断连
			},
		});
		env.reg.setResponses([fauxAssistantMessage("Phase2断连兜底正文。"), fauxAssistantMessage('{"patch":{}}')]);
		const end = await engine.performTurn("测试Phase2掉线兜底。");
		assert.equal(end.error, undefined);
		const lastFallbackMsg = fallbackCtxMessages[fallbackCtxMessages.length - 1] as { role?: string } | undefined;
		assert.notEqual(lastFallbackMsg?.role, "assistant", "Node兜底时绝不保留末尾 assistant 预填");
		const msgs = env.sm.getBranch().filter((e: any) => e.type === "message") as Array<{ message: { role: string; content: Array<{ text?: string }> } }>;
		assert.equal(msgs[msgs.length - 1]!.message.content.find((c) => c.text)?.text, "Phase2断连兜底正文。");
	} finally {
		await env.cleanup();
	}
});

test("刀3 · tavernStreamPipeline 流式抽取工具桥接参数（适配《梦鲸 V5》publish_story outputPaths）", () => {
	const partialJson = '{"dream_think":"<dream_think>推演A","story":"';
	const presetRaw = {
		extensions: {
			tool_output_bridge: {
				separator: "\n\n",
				tools: [
					{
						name: "publish_story",
						outputPaths: ["dream_think", "story"],
					},
				],
			},
		},
	};
	const mid = extractToolBridgeOutputText(
		[{ name: "publish_story", function: { name: "publish_story", arguments: partialJson } }],
		presetRaw,
	);
	assert.equal(mid, "<dream_think>推演A");

	const fullJson = '{"dream_think":"<dream_think>推演A</dream_think>","story":"<dream_plot>正文</dream_plot>"}';
	const full = extractToolBridgeOutputText(
		[{ name: "publish_story", function: { name: "publish_story", arguments: fullJson } }],
		presetRaw,
	);
	assert.equal(full, "<dream_think>推演A</dream_think>\n\n<dream_plot>正文</dream_plot>");
});

test("刀3&刀4 · channel-proxy 仅开压平或请求级脚本：单轮直出经由浏览器中转，保持真工具开放且不切 Phase 2", async () => {
	const env = await createStageWithPreset({
		squash_system_messages: true,
		prompts: [{ identifier: "main", name: "文风", role: "system", content: "语言简洁。" }],
		prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
	});
	try {
		const relayLogs: Array<{ phase: string; toolsCount: number; squash?: boolean }> = [];
		const engine = new StageEngine({
			cwd: env.cwd,
			getSession: () => env.session as never,
			getModel: () => env.session.model as never,
			getAuth: async () => ({ apiKey: "k" }),
			getThinking: () => "off",
			sideStreamFn: env.session.modelRuntime.streamSimple.bind(env.session.modelRuntime) as never,
			relayModelTurn: async (input: BrowserRelayTurnInput) => {
				relayLogs.push({
					phase: input.phase,
					toolsCount: input.tools?.length ?? 0,
					squash: input.presetMeta.squashSystemMessages,
				});
				input.onDelta("text", "单轮压平中转正文。");
				return { text: "单轮压平中转正文。", thinking: "", stopReason: "stop" };
			},
		});
		env.reg.setResponses([fauxAssistantMessage('{"patch":{}}')]);
		const end = await engine.performTurn("测试单轮透传中转。");
		assert.equal(end.error, undefined);
		assert.equal(relayLogs.length, 1);
		assert.equal(relayLogs[0]!.phase, "explore");
		assert.ok(relayLogs[0]!.toolsCount > 0, "channel-proxy 保留全部梨园真工具");
		assert.equal(relayLogs[0]!.squash, true);
	} finally {
		await env.cleanup();
	}
});
