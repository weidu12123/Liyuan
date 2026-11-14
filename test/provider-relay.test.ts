import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPresetDoc } from "../src/preset-doc.ts";
import { extractPresetRelayMeta } from "../src/stage/preset-relay-meta.ts";
import {
	GEMINI_SAFETY_SETTINGS,
	applyAntiRouteShield,
	applyChatHistorySquashInArray,
	applyRelayHeaders,
	applyRelayPayload,
	shouldInjectGoogleSafety,
	squashSystemMessagesInArray,
	supportsTrailingPrefill,
} from "../src/stage/provider-relay.ts";

test("extractPresetRelayMeta：对本地真实预设零 JS 执行准确提取声明字段", () => {
	const load = (fn: string) =>
		loadPresetDoc(JSON.parse(readFileSync(join(process.cwd(), "assets/presets", fn), "utf8")), fn);

	const mj5 = extractPresetRelayMeta(load("梦鲸思客V5-1030-exp.json"));
	assert.equal(mj5.squashSystemMessages, true);
	assert.equal(mj5.reasoningEffort, "low");
	assert.equal(mj5.chatHistorySquash?.type, "squash_into_one");
	assert.equal(mj5.chatHistorySquash?.squashRole, "user");

	const doubleWalk = extractPresetRelayMeta(load("双人成行v10.0—青云上-(1).json"));
	assert.equal(doubleWalk.rawAssistantPrefill, "思考已结束。");

	const tgb = extractPresetRelayMeta(load("TGbreak😺V2.1.6.json"));
	assert.equal(tgb.squashSystemMessages, true);
});

test("shouldInjectGoogleSafety：严格只在 Google 原生 contents 形态注入，OpenAI 兼容体绝不盲塞", () => {
	const googleNativePayload = {
		model: "gemini-2.5-pro",
		contents: [{ role: "user", parts: [{ text: "hello" }] }],
		config: {},
	};
	assert.equal(
		shouldInjectGoogleSafety(googleNativePayload, { id: "gemini-2.5-pro", api: "google-generative-ai" }),
		true,
	);
	assert.equal(
		shouldInjectGoogleSafety(
			googleNativePayload,
			{ id: "gemini-2.5-pro", api: "google-generative-ai" },
			{ googleSafetyOff: false },
		),
		false,
	);

	// 即使模型名称带 gemini，只要走 OpenAI messages 形态，绝不注入 safetySettings（防中转 400）
	const openAiRelayPayload = {
		model: "gemini-2.5-pro",
		messages: [{ role: "user", content: "hello" }],
	};
	assert.equal(
		shouldInjectGoogleSafety(openAiRelayPayload, { id: "gemini-2.5-pro", provider: "google", api: "openai-completions" }),
		false,
	);

	const patchedGoogle = applyRelayPayload(googleNativePayload, { id: "gemini-2.5-pro", api: "google-generative-ai" });
	assert.ok(patchedGoogle);
	assert.deepEqual((patchedGoogle.config as { safetySettings?: unknown }).safetySettings, GEMINI_SAFETY_SETTINGS);

	const patchedOpenAi = applyRelayPayload(openAiRelayPayload, { id: "gemini-2.5-pro", api: "openai-completions" });
	assert.equal(patchedOpenAi, undefined);
});

test("supportsTrailingPrefill：覆盖 Claude 4.6+、思考态、OpenAI GPT 与 DeepSeek/Kimi 协议门控", () => {
	assert.equal(supportsTrailingPrefill({ id: "claude-sonnet-4-6", api: "anthropic-messages" }).supported, false);
	assert.equal(supportsTrailingPrefill({ id: "claude-opus-4-6", api: "anthropic-messages" }).supported, false);
	assert.equal(
		supportsTrailingPrefill({ id: "claude-sonnet-4-5", api: "anthropic-messages" }, { hasThinking: true }).supported,
		false,
	);
	assert.equal(
		supportsTrailingPrefill({ id: "claude-sonnet-4-5", api: "anthropic-messages" }, { hasThinking: false }).supported,
		true,
	);
	assert.equal(supportsTrailingPrefill({ id: "gpt-4o", provider: "openai", api: "openai-completions" }).supported, false);
	assert.equal(supportsTrailingPrefill({ id: "gpt-5", api: "openai-responses" }).supported, false);

	const dsCap = supportsTrailingPrefill({ id: "deepseek-chat", provider: "deepseek", api: "openai-completions" });
	assert.equal(dsCap.supported, true);
	assert.equal(dsCap.applyPartialFlag, true);

	const kimiCap = supportsTrailingPrefill({ id: "kimi-k2", provider: "moonshot", api: "openai-completions" });
	assert.equal(kimiCap.supported, true);
	assert.equal(kimiCap.applyPartialFlag, true);

	const geminiCap = supportsTrailingPrefill({ id: "gemini-2.5-flash", api: "google-generative-ai" });
	assert.equal(geminiCap.supported, true);
});

test("squashSystemMessagesInArray & applyChatHistorySquashInArray：压平连续 system 并安全跳过 tool 段落", () => {
	const squashedSys = squashSystemMessagesInArray([
		{ role: "system", content: "系统一" },
		{ role: "system", content: "系统二" },
		{ role: "user", content: "你好" },
	]);
	assert.equal(squashedSys.length, 2);
	assert.equal(squashedSys[0]!.content, "系统一\n\n系统二");

	const msgs = [
		{ role: "system", content: "底盘" },
		{ role: "user", content: "问句1" },
		{ role: "assistant", content: "答句1" },
		{ role: "user", content: "当前输入" },
	];
	const rule = {
		type: "squash_into_one" as const,
		squashRole: "user" as const,
		userPrefix: "<u>",
		userSuffix: "</u>",
		assistantPrefix: "<a>",
		assistantSuffix: "</a>",
		systemPrefix: "<s>",
		systemSuffix: "</s>",
		delimiter: "\n",
	};
	const res = applyChatHistorySquashInArray(msgs, rule);
	assert.equal(res.length, 2);
	assert.equal(res[0]!.role, "user");
	assert.ok(String(res[0]!.content).includes("<s>底盘</s>\n<u>问句1</u>\n<a>答句1</a>"));
	assert.equal(res[1]!.content, "当前输入");
});

test("applyAntiRouteShield：head/deep 仅混淆普通文本，严守 tool、tool_calls、预填与受保护块边界", () => {
	const payload = {
		messages: [
			{ role: "system", content: "第一段系统指示" },
			{ role: "user", content: "<system-reminder>受保护系统提醒</system-reminder>" },
			{ role: "assistant", content: "工具调用旁白", tool_calls: [{ id: "c1" }] },
			{ role: "tool", tool_call_id: "c1", content: "工具结果原文" },
			{ role: "user", content: "最后一轮提问" },
			{ role: "assistant", content: "OUTPUT\n<think_fox~>" },
		],
	};
	const shielded = applyAntiRouteShield(payload, "openai-completions", "deep", { hasTrailingPrefill: true });
	const out = shielded.messages as Array<Record<string, unknown>>;
	assert.match(String(out[0]!.content), /^<!-- [a-z0-9 ]+ -->\n第一段系统指示/);
	assert.equal(out[1]!.content, "<system-reminder>受保护系统提醒</system-reminder>");
	assert.equal(out[2]!.content, "工具调用旁白");
	assert.equal(out[3]!.content, "工具结果原文");
	assert.match(String(out[4]!.content), /^<!-- [a-z0-9 ]+ -->\n最后一轮提问\n<!-- [a-z0-9 ]+ -->$/);
	assert.equal(out[5]!.content, "OUTPUT\n<think_fox~>");
});

test("applyRelayHeaders & applyRelayPayload：自定义头/体增删、无工具末尾预填 partial 标记", () => {
	const headers: Record<string, string> = { "content-type": "application/json" };
	applyRelayHeaders(
		headers,
		{ customIncludeHeaders: { "x-relay-tag": "liyuan" } },
		{ "x-model-extra": "v2" },
	);
	assert.equal(headers["x-relay-tag"], "liyuan");
	assert.equal(headers["x-model-extra"], "v2");

	const payload = {
		model: "deepseek-chat",
		messages: [
			{ role: "system", content: "Sys1" },
			{ role: "system", content: "Sys2" },
			{ role: "user", content: "开始" },
			{ role: "assistant", content: "<think>" },
		],
		store: true,
		extra: { dropMe: 123, keepMe: 456 },
	};
	const out = applyRelayPayload(
		payload,
		{ id: "deepseek-chat", provider: "deepseek", api: "openai-completions", reasoning: true },
		{
			policy: {
				squashSystemMessages: true,
				customIncludeBody: { top_k: 40 },
				customExcludeBody: ["store", "extra.dropMe"],
			},
			presetMeta: { squashSystemMessages: false, reasoningEffort: "low" },
			trailingPrefillActive: true,
		},
	);
	assert.ok(out);
	const msgs = out.messages as Array<Record<string, unknown>>;
	assert.equal(msgs.length, 3);
	assert.equal(msgs[0]!.content, "Sys1\n\nSys2");
	assert.equal(msgs[2]!.partial, true);
	assert.equal(msgs[2]!.prefix, true);
	assert.equal(out.top_k, 40);
	assert.equal(out.reasoning_effort, "low");
	assert.equal("store" in out, false);
	assert.equal("dropMe" in (out.extra as Record<string, unknown>), false);
	assert.equal((out.extra as Record<string, unknown>).keepMe, 456);
});
