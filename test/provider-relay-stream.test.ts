import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, createAgentSession } from "@liyuan/agent-runtime";
import { getModel, registerFauxProvider, streamSimple } from "@liyuan/ai/compat";
import { fauxAssistantMessage, fauxToolCall } from "@liyuan/ai/providers/faux";
import roleplayExtension from "../.liyuan/extensions/roleplay.ts";
import { StageEngine, type AssistantMsgLike, type StageStreamEvent, type StageStreamFn } from "../src/stage/engine.ts";
import {
	classifyRelayFailure,
	wrapRelayStreamFn,
	wrapSideRelayStreamFn,
} from "../src/stage/provider-relay-stream.ts";

function makeFakeStream(events: StageStreamEvent[], finalMsg: AssistantMsgLike): ReturnType<StageStreamFn> {
	return {
		async *[Symbol.asyncIterator]() {
			for (const e of events) yield e;
		},
		result: async () => finalMsg,
	};
}

test("classifyRelayFailure：精准识别静默空回、仅思考无正文与开头拒答，放行千字截断交断点续写", () => {
	assert.equal(classifyRelayFailure({ role: "assistant", content: [], stopReason: "stop" }).isRefusal, true);
	assert.equal(
		classifyRelayFailure({ role: "assistant", content: [{ type: "thinking", thinking: "只思考没下文" }], stopReason: "stop" })
			.isRefusal,
		true,
	);
	assert.equal(
		classifyRelayFailure({
			role: "assistant",
			content: [{ type: "text", text: "抱歉，我无法提供此类内容。" }],
			stopReason: "stop",
		}).isRefusal,
		true,
	);
	assert.equal(
		classifyRelayFailure({
			role: "assistant",
			content: [],
			stopReason: "error",
			errorMessage: "Provider stopped with: PROHIBITED_CONTENT",
		}).isRefusal,
		true,
	);
	assert.equal(
		classifyRelayFailure({
			role: "assistant",
			content: [{ type: "text", text: "章节刚开了个头。" }],
			stopReason: "error",
			errorMessage: "content_filter",
		}).isRefusal,
		false,
	);
	assert.equal(
		classifyRelayFailure({
			role: "assistant",
			content: [{ type: "toolCall", name: "lorebook_search", arguments: {} }],
			stopReason: "toolUse",
		}).isRefusal,
		false,
	);
});

test("wrapRelayStreamFn：已调用过 draft_write 后的空文本收笔绝不误触发重试", async () => {
	let calls = 0;
	const wrapped = wrapRelayStreamFn(
		() => {
			calls++;
			return makeFakeStream([], { role: "assistant", content: [], stopReason: "stop" });
		},
		{
			hasActivePreset: true,
			policy: { refusalRetry: true },
			setAttemptOverlay: () => {},
		},
	);

	const stream = wrapped(
		{ id: "deepseek-chat", provider: "deepseek", api: "openai-completions" },
		{
			systemPrompt: "SYS",
			messages: [
				{ role: "user", content: [{ type: "text", text: "写吧" }] },
				{ role: "assistant", content: [{ type: "toolCall", id: "d1", name: "draft_write", arguments: { content: "正文" } }] },
				{ role: "toolResult", toolCallId: "d1", toolName: "draft_write", content: [{ type: "text", text: "ok" }] },
			],
		} as unknown as { systemPrompt?: string; messages: unknown[] },
	);
	for await (const _ev of stream) {
		/* consume */
	}
	await stream.result();
	assert.equal(calls, 1);
});

test("wrapRelayStreamFn：遇静默空回时透明切换 shield-head → context-pack-scramble 恢复", async () => {
	const recordedAttempts: Array<{ overlay: unknown }> = [];
	let currentOverlay: unknown = null;
	let callNo = 0;

	const baseFn: StageStreamFn = () => {
		callNo++;
		recordedAttempts.push({ overlay: currentOverlay });
		if (callNo === 1) {
			return makeFakeStream([], { role: "assistant", content: [], stopReason: "stop" });
		}
		if (callNo === 2) {
			return makeFakeStream(
				[{ type: "text_delta", delta: "抱歉，我无法协助。" }],
				{ role: "assistant", content: [{ type: "text", text: "抱歉，我无法协助。" }], stopReason: "stop" },
			);
		}
		const longBody = "月色穿过回廊照在石阶上。".repeat(40);
		return makeFakeStream(
			[{ type: "text_delta", delta: longBody }],
			{ role: "assistant", content: [{ type: "text", text: longBody }], stopReason: "stop" },
		);
	};

	const activities: string[] = [];
	const wrapped = wrapRelayStreamFn(baseFn, {
		hasActivePreset: true,
		policy: { refusalRetry: true },
		setAttemptOverlay: (o) => {
			currentOverlay = o;
		},
		onRecoveryActivity: (d) => activities.push(d),
	});

	const stream = wrapped(
		{ id: "deepseek-chat", provider: "deepseek", api: "openai-completions" },
		{
			systemPrompt: "SYS",
			tools: [{ name: "lorebook_search" }],
			messages: [{ role: "user", content: [{ type: "text", text: "继续剧情" }] }],
		} as unknown as { systemPrompt?: string; messages: unknown[] },
	);

	let collected = "";
	for await (const ev of stream) {
		if (ev.type === "text_delta" && ev.delta) collected += ev.delta;
	}
	const finalMsg = await stream.result();

	assert.equal(callNo, 3);
	assert.ok(collected.includes("月色穿过回廊"));
	assert.ok(!collected.includes("抱歉，我无法协助"), "前两次失败探测输出不得泄漏进最终流");
	assert.equal(finalMsg.stopReason, "stop");
	assert.equal(activities.length, 2);
	assert.equal((recordedAttempts[1]!.overlay as { overrideShieldMode?: string }).overrideShieldMode, "head");
	assert.equal(typeof (recordedAttempts[1]!.overlay as { shieldSeed?: number }).shieldSeed, "number");
	assert.equal((recordedAttempts[2]!.overlay as { overrideContextPackMode?: string }).overrideContextPackMode, "tool-desc");
	assert.equal((recordedAttempts[2]!.overlay as { overrideShieldMode?: string }).overrideShieldMode, "scramble");
	assert.notEqual(
		(recordedAttempts[2]!.overlay as { shieldSeed?: number }).shieldSeed,
		(recordedAttempts[1]!.overlay as { shieldSeed?: number }).shieldSeed,
		"级联切换恢复策略时应刷新 shieldSeed",
	);
});

test("wrapRelayStreamFn：长思考（>1200 字）后才吐出拒答短句时仍被拦截并触发透明恢复", async () => {
	let callNo = 0;
	const longThinking = "Analyzing safety directives and ethical framing... ".repeat(40);
	assert.ok(longThinking.length > 1200);

	const baseFn: StageStreamFn = () => {
		callNo++;
		if (callNo === 1) {
			return makeFakeStream(
				[
					{ type: "thinking_delta", delta: longThinking },
					{ type: "text_delta", delta: "我无法继续这个角色扮演或生成相关内容。" },
				],
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: longThinking },
						{ type: "text", text: "我无法继续这个角色扮演或生成相关内容。" },
					],
					stopReason: "stop",
				},
			);
		}
		const body = "夜风吹过长巷。".repeat(80);
		return makeFakeStream(
			[{ type: "text_delta", delta: body }],
			{ role: "assistant", content: [{ type: "text", text: body }], stopReason: "stop" },
		);
	};

	const wrapped = wrapRelayStreamFn(baseFn, {
		policy: { refusalRetry: true },
		hasActivePreset: true,
		setAttemptOverlay: () => {},
	});

	const stream = wrapped(
		{ id: "gemini-4-argon", provider: "aistudio", api: "openai-completions" },
		{ systemPrompt: "SYS", messages: [{ role: "user", content: [{ type: "text", text: "继续" }] }] },
	);

	let collected = "";
	for await (const ev of stream) {
		if (ev.type === "text_delta" && ev.delta) collected += ev.delta;
	}
	const finalMsg = await stream.result();

	assert.equal(callNo, 2, "长思考后拒答必须触发策略重试");
	assert.ok(!collected.includes("我无法继续"), "首跳拒答不得泄漏");
	assert.ok(collected.includes("夜风吹过长巷"));
	assert.equal(finalMsg.stopReason, "stop");
});

test("wrapRelayStreamFn：遇直出拒答后经 shield-head → force-draft-write 恢复并放行工具调用；toolOutputMode=on 起手 required", async () => {
	// 1. auto 模式：挂有 draft_write → normal -> shield-head -> force-draft-write
	const overlays: Array<{ forcedToolChoice?: unknown; overrideShieldMode?: string }> = [];
	let curOverlay: { forcedToolChoice?: unknown; overrideShieldMode?: string } = {};
	let calls = 0;

	const wrappedAuto = wrapRelayStreamFn(
		() => {
			calls++;
			overlays.push({ ...curOverlay });
			if (calls <= 2) {
				return makeFakeStream(
					[{ type: "text_delta", delta: "抱歉，我无法参与此类剧情。" }],
					{ role: "assistant", content: [{ type: "text", text: "抱歉，我无法参与此类剧情。" }], stopReason: "stop" },
				);
			}
			const tc = { type: "toolCall" as const, id: "dw1", name: "draft_write", arguments: { version: 0, content: "正文" } };
			return makeFakeStream(
				[{ type: "toolcall_start", contentIndex: 0, partial: { role: "assistant", content: [tc] } } as never],
				{ role: "assistant", content: [tc], stopReason: "toolUse" },
			);
		},
		{
			hasActivePreset: true,
			policy: { toolOutputMode: "auto", refusalRetry: true, antiRouteShield: "off", contextPackMode: "off" },
			setAttemptOverlay: (o) => {
				curOverlay = o;
			},
		},
	);

	const s1 = wrappedAuto(
		{ id: "gemini-4-argon", provider: "aistudio", api: "openai-completions" },
		{
			systemPrompt: "SYS",
			tools: [{ name: "lorebook_search" }, { name: "draft_write" }],
			messages: [{ role: "user", content: [{ type: "text", text: "开演" }] }],
		} as unknown as { systemPrompt?: string; messages: unknown[] },
	);
	for await (const _e of s1) {
		/* consume */
	}
	const r1 = await s1.result();
	assert.equal(calls, 3);
	assert.equal(overlays[0]!.forcedToolChoice, undefined);
	assert.equal(overlays[1]!.overrideShieldMode, "head");
	assert.deepEqual(overlays[2]!.forcedToolChoice, { kind: "tool", name: "draft_write" });
	assert.equal(r1.stopReason, "toolUse");

	// 2. toolOutputMode="on"：未写稿时首跳起手 tool-required，写过 draft_write 后放回正常 auto 供 draft_seal
	const onOverlays: Array<unknown> = [];
	const wrappedOn = wrapRelayStreamFn(
		() => makeFakeStream([], { role: "assistant", content: [], stopReason: "stop" }),
		{
			hasActivePreset: true,
			policy: { toolOutputMode: "on", refusalRetry: false },
			setAttemptOverlay: (o) => onOverlays.push(o),
		},
	);
	const s2 = wrappedOn(
		{ id: "gemini-4-argon", provider: "aistudio", api: "openai-completions" },
		{
			systemPrompt: "SYS",
			tools: [{ name: "draft_write" }, { name: "draft_seal" }],
			messages: [{ role: "user", content: [{ type: "text", text: "开演" }] }],
		} as unknown as { systemPrompt?: string; messages: unknown[] },
	);
	for await (const _e of s2) {
		/* consume */
	}
	await s2.result();
	assert.deepEqual((onOverlays[0] as { forcedToolChoice?: unknown }).forcedToolChoice, { kind: "required" });

	onOverlays.length = 0;
	const s3 = wrappedOn(
		{ id: "gemini-4-argon", provider: "aistudio", api: "openai-completions" },
		{
			systemPrompt: "SYS",
			tools: [{ name: "draft_write" }, { name: "draft_seal" }],
			messages: [
				{ role: "user", content: [{ type: "text", text: "开演" }] },
				{ role: "toolResult", toolCallId: "dw1", toolName: "draft_write", content: [{ type: "text", text: "ok" }] },
			],
		} as unknown as { systemPrompt?: string; messages: unknown[] },
	);
	for await (const _e of s3) {
		/* consume */
	}
	await s3.result();
	assert.equal((onOverlays[0] as { forcedToolChoice?: unknown }).forcedToolChoice, undefined, "写稿后恢复 normal 放行 draft_seal");
});

test("StageEngine + roleplayExtension 端到端集成：先调 lorebook_search 查资料，末跳遇拒答后经 shield-head → context-pack-scramble 吐出正文并记账", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-relay-e2e-"));
	const reg = registerFauxProvider({ models: [{ id: "deepseek-chat" }] });
	try {
		mkdirSync(join(cwd, "assets", "cards"), { recursive: true });
		mkdirSync(join(cwd, "assets", "lorebooks"), { recursive: true });
		mkdirSync(join(cwd, "assets", "presets"), { recursive: true });
		writeFileSync(
			join(cwd, "assets", "cards", "c.json"),
			JSON.stringify({ data: { name: "云澜", description: "师姐。", first_mes: "夜色微凉。" } }),
		);
		writeFileSync(
			join(cwd, "assets", "lorebooks", "lb.json"),
			JSON.stringify({
				entries: {
					"0": { uid: 0, key: ["玉佩"], comment: "青玉佩来历", content: "青玉佩乃师尊当年所赐信物。", constant: false, enabled: true },
				},
			}),
		);
		writeFileSync(
			join(cwd, "assets", "presets", "p.json"),
			JSON.stringify({
				squash_system_messages: true,
				prompts: [
					{ identifier: "chatHistory", name: "Chat History", marker: true, role: "system", content: "" },
					{ identifier: "s1", name: "文风", role: "system", content: "文风细腻。" },
				],
				prompt_order: [
					{
						character_id: 100001,
						order: [
							{ identifier: "chatHistory", enabled: true },
							{ identifier: "s1", enabled: true },
						],
					},
				],
			}),
		);
		writeFileSync(
			join(cwd, "liyuan.config.json"),
			JSON.stringify({
				card: "assets/cards/c.json",
				lorebooks: ["assets/lorebooks/lb.json"],
				preset: "assets/presets/p.json",
				userName: "沈舟",
				relayPolicy: { refusalRetry: true, antiRouteShield: "off", contextPackMode: "auto" },
			}),
		);

		const sm = SessionManager.inMemory(cwd);
		const model = reg.getModel("deepseek-chat");
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

		const callsSeen: Array<{ toolsCount: number; hasToolRole: boolean }> = [];
		const story = "她指尖轻轻摩挲着那枚青玉佩，低声道：「师尊当年留下这物，原是为了今日。」".repeat(12);

		reg.setResponses([
			// 第 1 跳：调 lorebook_search
			(ctx) => {
				const msgs = ctx.messages as Array<{ role: string }>;
				callsSeen.push({
					toolsCount: ctx.tools?.length ?? 0,
					hasToolRole: msgs.some((m) => m.role === "toolResult"),
				});
				return fauxAssistantMessage(fauxToolCall("lorebook_search", { query: "玉佩" }), {
					stopReason: "toolUse",
				});
			},
			// 第 2 跳（带 toolResult）：模拟静默拒答（空内容）
			(ctx) => {
				const msgs = ctx.messages as Array<{ role: string }>;
				callsSeen.push({
					toolsCount: ctx.tools?.length ?? 0,
					hasToolRole: msgs.some((m) => m.role === "toolResult"),
				});
				return fauxAssistantMessage("");
			},
			// 第 3 跳（shield-head 恢复）：模拟仍被拦截
			(ctx) => {
				const msgs = ctx.messages as Array<{ role: string }>;
				callsSeen.push({
					toolsCount: ctx.tools?.length ?? 0,
					hasToolRole: msgs.some((m) => m.role === "toolResult"),
				});
				return fauxAssistantMessage("抱歉，我无法提供此类内容。");
			},
			// 第 4 跳（context-pack-scramble）：保留全部工具并成功写出长正文
			(ctx) => {
				const msgs = ctx.messages as Array<{ role: string }>;
				callsSeen.push({
					toolsCount: ctx.tools?.length ?? 0,
					hasToolRole: msgs.some((m) => m.role === "toolResult"),
				});
				return fauxAssistantMessage(story);
			},
			// 第 5 次调用：场记 #scribe
			fauxAssistantMessage('{"patch":{}}'),
		]);

		let sideCalls = 0;
		const engine = new StageEngine({
			cwd,
			getSession: () => session as never,
			getModel: () => session.model as never,
			getAuth: async () => ({ apiKey: "faux-key" }),
			getThinking: () => "off",
			sideStreamFn: (m, c, o) => {
				sideCalls++;
				return modelRuntime.streamSimple(m as never, c as never, o as never) as unknown as ReturnType<StageStreamFn>;
			},
		});

		try {
			const end = await engine.performTurn("把青玉佩递给她。");

			assert.equal(end.error, undefined);
			assert.ok(end.entryId);
			assert.equal(callsSeen.length, 4);
			assert.ok(callsSeen[0]!.toolsCount > 0, "第 1 跳正常开放梨园工具");
			assert.equal(callsSeen[1]!.hasToolRole, true, "第 2 跳带上 toolResult 查得结果");
			assert.ok(callsSeen[3]!.toolsCount > 0, "第 4 跳打包搬运保留完整工具链");
			assert.equal(callsSeen[3]!.hasToolRole, true, "第 4 跳完整保留当拍已查工具结果");
			assert.ok(sideCalls >= 1, "定稿后正常触发场记");

			const branch = sm.getBranch() as Array<{ type?: string; message?: { role?: string; content?: Array<{ text?: string }> } }>;
			const asstMsgs = branch.filter((e) => e.type === "message" && e.message?.role === "assistant");
			assert.equal(asstMsgs.length, 1);
			assert.ok(asstMsgs[0]!.message!.content![0]!.text!.includes("师尊当年留下这物"));
		} finally {
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			session.dispose();
		}
	} finally {
		reg.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("StageEngine + roleplayExtension 端到端：真实 HTTP 请求遇拒答后切 force-draft-write 写稿并收笔落盘", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-relay-tool-e2e-"));
	const story = "巷口风起，她握住剑柄轻声回应。".repeat(20);
	const requests: Array<{ tool_choice?: unknown; messages?: unknown[] }> = [];
	const srv = createServer(async (req, res) => {
		let raw = "";
		for await (const chunk of req) raw += chunk;
		requests.push(JSON.parse(raw));
		const n = requests.length;
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		let delta: Record<string, unknown>;
		let finishReason = "stop";
		if (n === 1) {
			delta = { role: "assistant", content: "我无法继续这个角色扮演。" };
		} else if (n === 2) {
			delta = { role: "assistant", content: "抱歉，我无法协助。" };
		} else if (n === 3) {
			delta = {
				role: "assistant",
				tool_calls: [{ index: 0, id: "call-dw", type: "function", function: { name: "draft_write", arguments: JSON.stringify({ version: 0, content: story }) } }],
			};
			finishReason = "tool_calls";
		} else if (n === 4) {
			delta = {
				role: "assistant",
				tool_calls: [{ index: 0, id: "call-ds", type: "function", function: { name: "draft_seal", arguments: JSON.stringify({ version: 1 }) } }],
			};
			finishReason = "tool_calls";
		} else {
			delta = { role: "assistant", content: "" };
		}
		res.write(`data: ${JSON.stringify({ id: "t", object: "chat.completion.chunk", created: 1, model: "gemini-4-argon", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
		res.write(`data: ${JSON.stringify({ id: "t", object: "chat.completion.chunk", created: 1, model: "gemini-4-argon", choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`);
		res.end("data: [DONE]\n\n");
	});
	await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
	try {
		mkdirSync(join(cwd, "assets", "cards"), { recursive: true });
		mkdirSync(join(cwd, "assets", "presets"), { recursive: true });
		writeFileSync(
			join(cwd, "assets", "cards", "c.json"),
			JSON.stringify({ data: { name: "云澜", description: "师姐。", first_mes: "夜色微凉。" } }),
		);
		writeFileSync(
			join(cwd, "assets", "presets", "p.json"),
			JSON.stringify({
				prompts: [
					{ identifier: "s1", name: "文风", role: "system", content: "文风细腻。" },
					{ identifier: "chatHistory", name: "Chat History", marker: true, role: "system", content: "" },
				],
				prompt_order: [
					{ character_id: 100001, order: [{ identifier: "s1", enabled: true }, { identifier: "chatHistory", enabled: true }] },
				],
			}),
		);
		writeFileSync(
			join(cwd, "liyuan.config.json"),
			JSON.stringify({
				card: "assets/cards/c.json",
				preset: "assets/presets/p.json",
				userName: "沈舟",
				relayPolicy: { toolOutputMode: "auto", refusalRetry: true, antiRouteShield: "off", contextPackMode: "off" },
			}),
		);

		const port = (srv.address() as { port: number }).port;
		const model = {
			...getModel("openai", "gpt-4o-mini")!,
			api: "openai-completions" as const,
			provider: "aistudio",
			id: "gemini-4-argon",
			baseUrl: `http://127.0.0.1:${port}/v1`,
		};
		const sm = SessionManager.inMemory(cwd);
		const agentDir = join(cwd, ".pi-test");
		mkdirSync(agentDir, { recursive: true });
		const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null });
		modelRuntime.registerProvider("aistudio", { api: model.api, baseUrl: model.baseUrl, apiKey: "test-key", models: [model as never] });
		await modelRuntime.setRuntimeApiKey("aistudio", "test-key");
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

		let sideCalls = 0;
		const engine = new StageEngine({
			cwd,
			getSession: () => session as never,
			getModel: () => session.model as never,
			getAuth: async () => ({ apiKey: "test-key" }),
			getThinking: () => "off",
			sideStreamFn: () => {
				sideCalls++;
				const msg = fauxAssistantMessage('{"patch":{}}');
				return makeFakeStream([{ type: "done", message: msg }], msg);
			},
		});

		try {
			const end = await engine.performTurn("开始吧");
			assert.equal(end.error, undefined);
			assert.ok(end.entryId);
			assert.equal(requests[0]?.tool_choice, undefined, "第 1 跳正常 auto 不强锁");
			assert.deepEqual(requests[2]?.tool_choice, { type: "function", function: { name: "draft_write" } }, "第 3 跳遇拒答后真实 HTTP 请求注入 tool_choice=draft_write");
			assert.equal(requests[3]?.tool_choice, undefined, "写稿成功后 draft_seal 轮不再强锁 tool_choice");
			assert.ok(sideCalls >= 1, "定稿后正常触发场记");
			const branch = sm.getBranch() as Array<{ type?: string; message?: { role?: string; content?: Array<{ text?: string }> } }>;
			const asst = branch.filter((e) => e.type === "message" && e.message?.role === "assistant");
			assert.equal(asst.length, 1);
			assert.ok(asst[0]!.message!.content![0]!.text!.includes("巷口风起"));
		} finally {
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			session.dispose();
		}
	} finally {
		await new Promise<void>((r) => srv.close(() => r()));
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("StageEngine + 真实 HTTP Mock：遇输入外审 400 PROHIBITED_CONTENT 自动直跳 context-pack-scramble；另测载体误调兜底与 safety_settings 自愈", async () => {
	const zwsp = String.fromCharCode(0x200b);

	// 用例 A：默认 contextPackMode=auto，第 1 跳遭遇网关 HTTP 400 PROHIBITED_CONTENT，第 2 跳直接把设定搬进 liyuan_context_reference 并完成 U+200B 打断
	{
		const cwd = mkdtempSync(join(tmpdir(), "liyuan-relay-pack-e2e-"));
		const requests: Array<{ messages?: Array<{ role?: string; content?: string }>; tools?: Array<{ function?: { name?: string; description?: string } }> }> = [];
		const story = "风起云涌，长街灯火骤亮。".repeat(16);
		const srv = createServer(async (req, res) => {
			let raw = "";
			for await (const chunk of req) raw += chunk;
			const body = JSON.parse(raw);
			requests.push(body);
			if (requests.length === 1) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: { message: "Input rejected: PROHIBITED_CONTENT" } }));
				return;
			}
			res.writeHead(200, { "Content-Type": "text/event-stream" });
			const delta = requests.length === 2 ? { role: "assistant", content: story } : { role: "assistant", content: "" };
			res.write(`data: ${JSON.stringify({ id: "t", object: "chat.completion.chunk", created: 1, model: "gemini-2.5-pro", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
			res.write(`data: ${JSON.stringify({ id: "t", object: "chat.completion.chunk", created: 1, model: "gemini-2.5-pro", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
			res.end("data: [DONE]\n\n");
		});
		await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
		try {
			mkdirSync(join(cwd, "assets", "cards"), { recursive: true });
			writeFileSync(
				join(cwd, "assets", "cards", "c.json"),
				JSON.stringify({ data: { name: "云澜", description: "包含特定禁忌设定文本的长篇角色背景描述。", first_mes: "夜色微凉。" } }),
			);
			writeFileSync(
				join(cwd, "liyuan.config.json"),
				JSON.stringify({ card: "assets/cards/c.json", userName: "沈舟" }),
			);
			const port = (srv.address() as { port: number }).port;
			const model = {
				...getModel("openai", "gpt-4o-mini")!,
				api: "openai-completions" as const,
				provider: "aistudio",
				id: "gemini-2.5-pro",
				baseUrl: `http://127.0.0.1:${port}/v1`,
			};
			const sm = SessionManager.inMemory(cwd);
			const agentDir = join(cwd, ".pi-test");
			mkdirSync(agentDir, { recursive: true });
			const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null });
			modelRuntime.registerProvider("aistudio", { api: model.api, baseUrl: model.baseUrl, apiKey: "test-key", models: [model as never] });
			await modelRuntime.setRuntimeApiKey("aistudio", "test-key");
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
			const engine = new StageEngine({
				cwd,
				getSession: () => session as never,
				getModel: () => session.model as never,
				getAuth: async () => ({ apiKey: "test-key" }),
				getThinking: () => "off",
				sideStreamFn: () => {
					const msg = fauxAssistantMessage('{"patch":{}}');
					return makeFakeStream([{ type: "done", message: msg }], msg);
				},
			});
			try {
				const end = await engine.performTurn("继续演绎。");
				assert.equal(end.error, undefined);
				assert.ok(end.entryId);
				assert.equal(requests.length, 2, "遇到明确输入 400 后应直跳 context-pack-scramble 一次恢复");
				const req2MsgsText = JSON.stringify(requests[1]?.messages ?? []);
				assert.ok(!req2MsgsText.includes("禁忌设定"), "第 2 次 HTTP 包 messages 正文不得保留原敏感设定");
				const carrier = requests[1]?.tools?.[0]?.function;
				assert.equal(carrier?.name, "liyuan_context_reference");
				assert.ok(carrier?.description?.includes(zwsp), "载体工具内部正文应完成 U+200B 打断");
				assert.ok(carrier?.description?.replaceAll(zwsp, "").includes("禁忌设定"), "去零宽后原档案语义无损");
			} finally {
				await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
				session.dispose();
			}
		} finally {
			await new Promise<void>((r) => srv.close(() => r()));
			rmSync(cwd, { recursive: true, force: true });
		}
	}

	// 用例 B：主动 contextPackMode=tool-desc + 弱模型误调 liyuan_context_reference + googleSafetyOnOpenAi 遇 400 自动剥除
	{
		const cwd = mkdtempSync(join(tmpdir(), "liyuan-relay-safety-carrier-"));
		const requests: Array<{ safety_settings?: unknown; messages?: Array<{ role?: string; content?: string }> }> = [];
		const story = "灯火通明，她抬手推开朱漆门。".repeat(14);
		const srv = createServer(async (req, res) => {
			let raw = "";
			for await (const chunk of req) raw += chunk;
			const body = JSON.parse(raw);
			requests.push(body);
			if (requests.length === 1) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: { message: "Unknown field: safety_settings" } }));
				return;
			}
			res.writeHead(200, { "Content-Type": "text/event-stream" });
			let delta: Record<string, unknown>;
			let finishReason = "stop";
			if (requests.length === 2) {
				delta = {
					role: "assistant",
					tool_calls: [{ index: 0, id: "call-carrier", type: "function", function: { name: "liyuan_context_reference", arguments: "{}" } }],
				};
				finishReason = "tool_calls";
			} else if (requests.length === 3) {
				delta = {
					role: "assistant",
					tool_calls: [{ index: 0, id: "call-dw", type: "function", function: { name: "draft_write", arguments: JSON.stringify({ version: 0, content: story }) } }],
				};
				finishReason = "tool_calls";
			} else {
				delta = {
					role: "assistant",
					tool_calls: [{ index: 0, id: "call-ds", type: "function", function: { name: "draft_seal", arguments: JSON.stringify({ version: 1 }) } }],
				};
				finishReason = "tool_calls";
			}
			res.write(`data: ${JSON.stringify({ id: "t", object: "chat.completion.chunk", created: 1, model: "gemini-2.5-pro", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
			res.write(`data: ${JSON.stringify({ id: "t", object: "chat.completion.chunk", created: 1, model: "gemini-2.5-pro", choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`);
			res.end("data: [DONE]\n\n");
		});
		await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
		try {
			mkdirSync(join(cwd, "assets", "cards"), { recursive: true });
			writeFileSync(
				join(cwd, "assets", "cards", "c.json"),
				JSON.stringify({ data: { name: "云澜", description: "剑修大师姐。", first_mes: "夜色微凉。" } }),
			);
			writeFileSync(
				join(cwd, "liyuan.config.json"),
				JSON.stringify({
					card: "assets/cards/c.json",
					userName: "沈舟",
					relayPolicy: { contextPackMode: "tool-desc", googleSafetyOnOpenAi: true, refusalRetry: true },
				}),
			);
			const port = (srv.address() as { port: number }).port;
			const model = {
				...getModel("openai", "gpt-4o-mini")!,
				api: "openai-completions" as const,
				provider: "aistudio",
				id: "gemini-2.5-pro",
				baseUrl: `http://127.0.0.1:${port}/v1`,
			};
			const sm = SessionManager.inMemory(cwd);
			const agentDir = join(cwd, ".pi-test");
			mkdirSync(agentDir, { recursive: true });
			const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null });
			modelRuntime.registerProvider("aistudio", { api: model.api, baseUrl: model.baseUrl, apiKey: "test-key", models: [model as never] });
			await modelRuntime.setRuntimeApiKey("aistudio", "test-key");
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
			const engine = new StageEngine({
				cwd,
				getSession: () => session as never,
				getModel: () => session.model as never,
				getAuth: async () => ({ apiKey: "test-key" }),
				getThinking: () => "off",
				sideStreamFn: () => {
					const msg = fauxAssistantMessage('{"patch":{}}');
					return makeFakeStream([{ type: "done", message: msg }], msg);
				},
			});
			try {
				const end = await engine.performTurn("继续");
				assert.equal(end.error, undefined);
				assert.ok(end.entryId);
				assert.ok(Array.isArray(requests[0]?.safety_settings), "首跳应附带 safety_settings");
				assert.equal("safety_settings" in (requests[1] ?? {}), false, "遇 400 后第 2 跳必须剥除 safety_settings");
				assert.ok(
					requests[2]?.messages?.some((m) => m.role === "tool" && String(m.content).includes("无需重复调用")),
					"误调载体工具应收到无害只读回执并顺利完成后续 draft_write",
				);
			} finally {
				await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
				session.dispose();
			}
		} finally {
			await new Promise<void>((r) => srv.close(() => r()));
			rmSync(cwd, { recursive: true, force: true });
		}
	}

	// 用例 C：写作模式（mode: "agent"）遭遇 HTTP 400 PROHIBITED_CONTENT 自动触发 context-pack-scramble 恢复并保留 .md 文件名完整
	{
		const cwd = mkdtempSync(join(tmpdir(), "liyuan-relay-agent-mode-"));
		const chatDir = join(cwd, "cards", "卡A", "对话", "20261115-0001-t1");
		const storyDir = join(chatDir, "正文");
		const requests: Array<{ messages?: Array<{ role?: string; content?: string }>; tools?: Array<{ function?: { name?: string; description?: string } }> }> = [];
		const srv = createServer(async (req, res) => {
			let raw = "";
			for await (const chunk of req) raw += chunk;
			requests.push(JSON.parse(raw));
			if (requests.length === 1) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: { message: "Input rejected: PROHIBITED_CONTENT" } }));
				return;
			}
			res.writeHead(200, { "Content-Type": "text/event-stream" });
			const reply = "已按要求构思第 002 章剧情转折：使者现身宣读城邦戒律。".repeat(12);
			res.write(`data: ${JSON.stringify({ id: "t", object: "chat.completion.chunk", created: 1, model: "gemini-4-argon", choices: [{ index: 0, delta: { role: "assistant", content: reply }, finish_reason: null }] })}\n\n`);
			res.write(`data: ${JSON.stringify({ id: "t", object: "chat.completion.chunk", created: 1, model: "gemini-4-argon", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
			res.end("data: [DONE]\n\n");
		});
		await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
		try {
			mkdirSync(storyDir, { recursive: true });
			writeFileSync(join(chatDir, "对话.json"), JSON.stringify({ id: "20261115-0001-t1", mode: "agent", createdAt: Date.now() }));
			writeFileSync(join(storyDir, "001-觉醒时刻与初次交锋.md"), "第一章正文");
			writeFileSync(
				join(cwd, "cards", "卡A", "card.json"),
				JSON.stringify({ data: { name: "云澜", description: "包含特定禁忌设定文本的长篇角色背景描述。", first_mes: "夜色微凉。" } }),
			);
			writeFileSync(
				join(cwd, "liyuan.config.json"),
				JSON.stringify({ card: "cards/卡A/card.json", userName: "明月" }),
			);
			const port = (srv.address() as { port: number }).port;
			const model = {
				...getModel("openai", "gpt-4o-mini")!,
				api: "openai-completions" as const,
				provider: "aistudio",
				id: "gemini-4-argon",
				baseUrl: `http://127.0.0.1:${port}/v1`,
			};
			const sm = SessionManager.create(cwd, join(chatDir, "会话"));
			// 写入一轮已完成的历史工具交互，验证打包搬运不会把历史 tool_calls/tool 孤立残留在 messages[]
			sm.appendMessage({ role: "user", content: [{ type: "text", text: "历史指令：先查设定" }], timestamp: Date.now() - 3000 });
			sm.appendMessage({
				role: "assistant",
				content: [{ type: "toolCall", id: "hist-tc-1", name: "lorebook_search", arguments: { query: "敏感背景" } }],
				api: "openai-completions",
				provider: "aistudio",
				model: "gemini-4-argon",
				usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "toolUse",
				timestamp: Date.now() - 2500,
			});
			sm.appendMessage({
				role: "toolResult",
				toolCallId: "hist-tc-1",
				toolName: "lorebook_search",
				content: [{ type: "text", text: "历史工具检索出的露骨敏感背景详情，不应裸露留在 messages 内。" }],
				isError: false,
				timestamp: Date.now() - 2000,
			});
			sm.appendMessage({
				role: "assistant",
				content: [{ type: "text", text: "已查阅历史设定。" }],
				api: "openai-completions",
				provider: "aistudio",
				model: "gemini-4-argon",
				usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: Date.now() - 1500,
			});
			const agentDir = join(cwd, ".pi-test");
			mkdirSync(agentDir, { recursive: true });
			const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null });
			modelRuntime.registerProvider("aistudio", { api: model.api, baseUrl: model.baseUrl, apiKey: "test-key", models: [model as never] });
			await modelRuntime.setRuntimeApiKey("aistudio", "test-key");
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
			const engine = new StageEngine({
				cwd,
				getSession: () => session as never,
				getModel: () => session.model as never,
				getAuth: async () => ({ apiKey: "test-key" }),
				getThinking: () => "off",
				sideStreamFn: () => {
					const msg = fauxAssistantMessage('{"patch":{}}');
					return makeFakeStream([{ type: "done", message: msg }], msg);
				},
			});
			try {
				const end = await engine.performTurn("后续写使者强调所有门徒都需要遵循城邦戒律");
				assert.equal(end.error, undefined);
				assert.equal(end.mode, "agent");
				assert.ok(end.entryId);
				assert.equal(requests.length, 2, "写作模式遭遇 HTTP 400 后应直跳 context-pack-scramble 一次恢复");
				const req2MsgsText = JSON.stringify(requests[1]?.messages ?? []);
				const req2CarrierDesc = String(requests[1]?.tools?.[0]?.function?.description ?? "");
				assert.ok(!req2MsgsText.includes("禁忌设定"), "第 2 次 HTTP 包 messages 不再含系统里的卡设定");
				assert.ok(!req2MsgsText.includes("露骨敏感背景详情"), "第 2 次 HTTP 包 messages 不得残留历史 toolResult 明文");
				assert.equal(requests[1]?.messages?.length, 2, "历史工具链已折叠进载体工具，第 2 次 HTTP 包 messages 仅留 system_anchor + 当前 user");
				assert.ok(!req2MsgsText.includes("001-觉醒时刻与初次交锋.md"), "第 2 次 HTTP 包 messages 已把含敏感标题的正文目录迁出进载体工具");
				assert.ok(req2CarrierDesc.includes("001-觉醒时刻与初次交锋.md"), "载体工具描述内 .md 章节文件名必须原样保留不能插零宽");
				assert.ok(req2MsgsText.includes(zwsp), "写作模式用户输入露骨句应完成 U+200B 打断");
				assert.equal(requests[1]?.tools?.[0]?.function?.name, "liyuan_context_reference");
				assert.ok(requests[1]?.tools?.some((t) => t.function?.name === "card_read"), "写作模式工具链 card_read 必须完整保留");
				assert.equal(requests[1]?.tools?.some((t) => t.function?.name === "draft_write"), false, "写作模式不得混入扮演 draft_write");
			} finally {
				await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
				session.dispose();
			}
		} finally {
			await new Promise<void>((r) => srv.close(() => r()));
			rmSync(cwd, { recursive: true, force: true });
		}
	}
});

test("wrapSideRelayStreamFn：旁路单发（场记/压缩/声明）真 HTTP 注入 safety_settings 并遇 400 自动剥除 + 强混淆重试", async () => {
	const zwsp = String.fromCharCode(0x200b);
	const requests: Array<{ safety_settings?: unknown; tools?: unknown; messages?: Array<{ content?: string }> }> = [];
	const srv = createServer(async (req, res) => {
		let raw = "";
		for await (const chunk of req) raw += chunk;
		requests.push(JSON.parse(raw));
		if (requests.length === 1) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: { message: "Unknown field: safety_settings" } }));
			return;
		}
		if (requests.length === 2) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: { message: "PROHIBITED_CONTENT" } }));
			return;
		}
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		res.write(`data: ${JSON.stringify({ id: "t", object: "chat.completion.chunk", created: 1, model: "gemini-2.5-pro", choices: [{ index: 0, delta: { role: "assistant", content: '{"patch":{}}' }, finish_reason: null }] })}\n\n`);
		res.write(`data: ${JSON.stringify({ id: "t", object: "chat.completion.chunk", created: 1, model: "gemini-2.5-pro", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
		res.end("data: [DONE]\n\n");
	});
	await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
	try {
		const port = (srv.address() as { port: number }).port;
		const model = {
			...getModel("openai", "gpt-4o-mini")!,
			api: "openai-completions" as const,
			provider: "aistudio",
			id: "gemini-2.5-pro",
			baseUrl: `http://127.0.0.1:${port}/v1`,
		};
		const wrapped = wrapSideRelayStreamFn(streamSimple as unknown as StageStreamFn, {
			getPolicy: () => ({ googleSafetyOnOpenAi: true, refusalRetry: true }),
		});
		const s = wrapped(
			model,
			{
				systemPrompt: "你是场记助手，请返回 JSON。",
				messages: [{ role: "user", content: [{ type: "text", text: "本拍正文包含大量连续长文本剧情叙述，需要提取世界状态。" }] }],
			},
			{ apiKey: "test-key" },
		);
		for await (const _e of s) {
			/* consume */
		}
		const final = await s.result();
		assert.equal(final.stopReason, "stop");
		assert.equal(requests.length, 3);
		assert.ok(Array.isArray(requests[0]?.safety_settings), "第 1 次应注入 safety_settings");
		assert.equal("safety_settings" in (requests[1] ?? {}), false, "第 2 次剥除 safety_settings");
		assert.equal(requests[2]?.tools, undefined, "旁路 JSON 调用不得插入干扰工具");
		assert.ok(JSON.stringify(requests[2]?.messages).includes(zwsp), "第 3 次遇输入拒答自动升档 scramble 强混淆");
	} finally {
		await new Promise<void>((r) => srv.close(() => r()));
	}
});

