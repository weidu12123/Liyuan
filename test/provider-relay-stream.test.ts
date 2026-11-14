import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, createAgentSession } from "@liyuan/agent-runtime";
import { registerFauxProvider } from "@liyuan/ai/compat";
import { fauxAssistantMessage, fauxToolCall } from "@liyuan/ai/providers/faux";
import roleplayExtension from "../.liyuan/extensions/roleplay.ts";
import { StageEngine, type AssistantMsgLike, type StageStreamEvent, type StageStreamFn } from "../src/stage/engine.ts";
import {
	classifyRelayFailure,
	flattenContextForPrefill,
	wrapRelayStreamFn,
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
			policy: { prefillMode: "auto", refusalRetry: true },
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

test("flattenContextForPrefill：清理 toolCall/toolResult 为纯文本资料并拼入末尾预填", () => {
	const flattened = flattenContextForPrefill(
		{
			systemPrompt: "SYS",
			tools: [{ name: "lorebook_search" }],
			messages: [
				{ role: "user", content: [{ type: "text", text: "推开殿门" }] },
				{ role: "assistant", content: [{ type: "toolCall", id: "t1", name: "lorebook_search", arguments: { query: "大殿" } }] },
				{ role: "toolResult", toolCallId: "t1", toolName: "lorebook_search", content: [{ type: "text", text: "大殿供奉寒玉盏。" }] },
			],
		},
		"OUTPUT\n<think_fox~>",
		{ id: "deepseek-chat", provider: "deepseek", api: "openai-completions" },
	);

	assert.equal(flattened.tools, undefined);
	assert.equal(flattened.messages.length, 2);
	const userMsg = flattened.messages[0] as { role: string; content: Array<{ text: string }> };
	const asstMsg = flattened.messages[1] as { role: string; content: Array<{ text: string }> };
	assert.equal(userMsg.role, "user");
	assert.ok(userMsg.content[0]!.text.includes("【本拍已核查资料】"));
	assert.ok(userMsg.content[0]!.text.includes("大殿供奉寒玉盏"));
	assert.ok(userMsg.content[0]!.text.includes("推开殿门"));
	assert.equal(asstMsg.role, "assistant");
	assert.equal(asstMsg.content[0]!.text, "OUTPUT\n<think_fox~>");
});

test("wrapRelayStreamFn：正常超过 360 字符直通；遇静默空回时透明切换 shield-head → flatten-prefill 恢复", async () => {
	const recordedAttempts: Array<{ tools: unknown; overlay: unknown; msgs: unknown[] }> = [];
	let currentOverlay: unknown = null;
	let callNo = 0;

	const baseFn: StageStreamFn = (_model, context) => {
		callNo++;
		recordedAttempts.push({
			tools: (context as { tools?: unknown }).tools,
			overlay: currentOverlay,
			msgs: context.messages,
		});
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
		policy: { refusalRetry: true, prefillMode: "auto" },
		trailingPrefillText: "OUTPUT\n<think_fox~>",
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
	assert.deepEqual(recordedAttempts[1]!.overlay, { trailingPrefillActive: false, overrideShieldMode: "head" });
	assert.equal(recordedAttempts[2]!.tools, undefined);
	assert.deepEqual(recordedAttempts[2]!.overlay, { trailingPrefillActive: true, overrideShieldMode: "head" });
});

test("StageEngine + roleplayExtension 端到端集成：先调 lorebook_search 查资料，末跳遇拒答后透明折算无工具+预填吐出正文并记账", async () => {
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
					{ identifier: "pf", name: "直出预填", role: "assistant", content: "OUTPUT\n<think_fox~>" },
				],
				prompt_order: [
					{
						character_id: 100001,
						order: [
							{ identifier: "chatHistory", enabled: true },
							{ identifier: "s1", enabled: true },
							{ identifier: "pf", enabled: true },
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
				relayPolicy: { prefillMode: "auto", refusalRetry: true, antiRouteShield: "off" },
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

		const callsSeen: Array<{ toolsCount: number; lastRole: string; lastText: string; userTexts: string; hasToolRole: boolean }> = [];
		const story = "她指尖轻轻摩挲着那枚青玉佩，低声道：「师尊当年留下这物，原是为了今日。」".repeat(12);

		reg.setResponses([
			// 第 1 跳：调 lorebook_search
			(ctx) => {
				const msgs = ctx.messages as Array<{ role: string; content: Array<{ text?: string }> }>;
				const last = msgs[msgs.length - 1]!;
				callsSeen.push({
					toolsCount: ctx.tools?.length ?? 0,
					lastRole: last.role,
					lastText: last.content.map((c) => c.text ?? "").join(""),
					userTexts: msgs.filter((m) => m.role === "user").map((m) => m.content.map((c) => c.text ?? "").join("")).join("\n"),
					hasToolRole: msgs.some((m) => m.role === "toolResult"),
				});
				return fauxAssistantMessage(fauxToolCall("lorebook_search", { query: "玉佩" }), {
					stopReason: "toolUse",
				});
			},
			// 第 2 跳（带 toolResult）：模拟静默拒答（空内容）
			(ctx) => {
				const msgs = ctx.messages as Array<{ role: string; content: Array<{ text?: string }> }>;
				const last = msgs[msgs.length - 1]!;
				callsSeen.push({
					toolsCount: ctx.tools?.length ?? 0,
					lastRole: last.role,
					lastText: last.content.map((c) => c.text ?? "").join(""),
					userTexts: msgs.filter((m) => m.role === "user").map((m) => m.content.map((c) => c.text ?? "").join("")).join("\n"),
					hasToolRole: msgs.some((m) => m.role === "toolResult"),
				});
				return fauxAssistantMessage("");
			},
			// 第 3 跳（shield-head 恢复）：模拟仍被拦截
			(ctx) => {
				const msgs = ctx.messages as Array<{ role: string; content: Array<{ text?: string }> }>;
				const last = msgs[msgs.length - 1]!;
				callsSeen.push({
					toolsCount: ctx.tools?.length ?? 0,
					lastRole: last.role,
					lastText: last.content.map((c) => c.text ?? "").join(""),
					userTexts: msgs.filter((m) => m.role === "user").map((m) => m.content.map((c) => c.text ?? "").join("")).join("\n"),
					hasToolRole: msgs.some((m) => m.role === "toolResult"),
				});
				return fauxAssistantMessage("抱歉，我无法提供此类内容。");
			},
			// 第 4 跳（自动折算无工具 + 预填）：成功写出长正文
			(ctx) => {
				const msgs = ctx.messages as Array<{ role: string; content: Array<{ text?: string }> }>;
				const last = msgs[msgs.length - 1]!;
				callsSeen.push({
					toolsCount: ctx.tools?.length ?? 0,
					lastRole: last.role,
					lastText: last.content.map((c) => c.text ?? "").join(""),
					userTexts: msgs.filter((m) => m.role === "user").map((m) => m.content.map((c) => c.text ?? "").join("")).join("\n"),
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
			assert.equal(callsSeen[3]!.toolsCount, 0, "第 4 跳预填恢复必须撤掉全部 tools");
			assert.equal(callsSeen[3]!.hasToolRole, false, "第 4 跳预填恢复不得残留 toolResult");
			assert.equal(callsSeen[3]!.lastRole, "assistant");
			assert.equal(callsSeen[3]!.lastText, "OUTPUT\n<think_fox~>");
			assert.ok(callsSeen[3]!.userTexts.includes("青玉佩乃师尊当年所赐信物"), "工具结果已无损折算进纯文本上下文");
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
