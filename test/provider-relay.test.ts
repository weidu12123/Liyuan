import test from "node:test";
import assert from "node:assert/strict";
import { loadPresetDoc } from "../src/preset-doc.ts";
import { extractPresetRelayMeta } from "../src/stage/preset-relay-meta.ts";
import {
	CARRIER_TOOL_NAME,
	GEMINI_SAFETY_SETTINGS,
	applyAntiRouteShield,
	applyChatHistorySquashInArray,
	applyInputScrambleToString,
	applyRelayHeaders,
	applyRelayPayload,
	applySamplingJitter,
	packContextIntoToolDescription,
	shouldInjectGoogleSafety,
	shouldInjectOpenAiGeminiSafety,
	squashSystemMessagesInArray,
} from "../src/stage/provider-relay.ts";

test("extractPresetRelayMeta：对预设声明字段零 JS 执行准确提取", () => {
	const presetA = loadPresetDoc(
		{
			squash_system_messages: true,
			reasoning_effort: "low",
			extensions: {
				tavern_helper: {
					scripts: [
						{
							enabled: true,
							data: {
								chat_history: { type: "squash_into_one", squash_role: "user" },
							},
						},
					],
				},
			},
		},
		"preset-a.json",
	);
	const metaA = extractPresetRelayMeta(presetA);
	assert.equal(metaA.squashSystemMessages, true);
	assert.equal(metaA.reasoningEffort, "low");
	assert.equal(metaA.chatHistorySquash?.type, "squash_into_one");
	assert.equal(metaA.chatHistorySquash?.squashRole, "user");

	const presetB = loadPresetDoc({ squash_system_messages: true, reasoning_effort: "auto" }, "preset-b.json");
	const metaB = extractPresetRelayMeta(presetB);
	assert.equal(metaB.squashSystemMessages, true);
	assert.equal(metaB.reasoningEffort, undefined);
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

test("applyAntiRouteShield：head/deep 仅混淆普通文本，严守 tool、tool_calls 与受保护块边界", () => {
	const payload = {
		messages: [
			{ role: "system", content: "第一段系统指示" },
			{ role: "user", content: "<system-reminder>受保护系统提醒</system-reminder>" },
			{ role: "assistant", content: "工具调用旁白", tool_calls: [{ id: "c1" }] },
			{ role: "tool", tool_call_id: "c1", content: "工具结果原文" },
			{ role: "user", content: "最后一轮提问" },
		],
	};
	const shielded = applyAntiRouteShield(payload, "openai-completions", "deep");
	const out = shielded.messages as Array<Record<string, unknown>>;
	assert.match(String(out[0]!.content), /^<!-- [a-z0-9 ]+ -->\n第一段系统指示/);
	assert.equal(out[1]!.content, "<system-reminder>受保护系统提醒</system-reminder>");
	assert.equal(out[2]!.content, "工具调用旁白");
	assert.equal(out[3]!.content, "工具结果原文");
	assert.match(String(out[4]!.content), /^<!-- [a-z0-9 ]+ -->\n最后一轮提问\n<!-- [a-z0-9 ]+ -->$/);
});

test("applyRelayHeaders & applyRelayPayload：自定义头/体增删与系统消息合并", () => {
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
		},
	);
	assert.ok(out);
	const msgs = out.messages as Array<Record<string, unknown>>;
	assert.equal(msgs.length, 2);
	assert.equal(msgs[0]!.content, "Sys1\n\nSys2");
	assert.equal(out.top_k, 40);
	assert.equal(out.reasoning_effort, "low");
	assert.equal("store" in out, false);
	assert.equal("dropMe" in (out.extra as Record<string, unknown>), false);
	assert.equal((out.extra as Record<string, unknown>).keepMe, 456);
});

test("applyRelayPayload：tool_choice（draft_write / required）在 OpenAI、Anthropic（清思考）与 Google 原生体准确落位", () => {
	// 1. OpenAI completions：锁 draft_write
	const oai = applyRelayPayload(
		{
			model: "gemini-4-argon",
			messages: [{ role: "user", content: "hi" }],
			tools: [{ type: "function", function: { name: "draft_write", parameters: {} } }],
		},
		{ id: "gemini-4-argon", provider: "aistudio", api: "openai-completions" },
		{ forcedToolChoice: { kind: "tool", name: "draft_write" } },
	);
	assert.deepEqual(oai?.tool_choice, { type: "function", function: { name: "draft_write" } });

	// 2. Anthropic messages：锁工具时剥除冲突的 thinking/output_config
	const ant = applyRelayPayload(
		{
			model: "claude-sonnet-4-6",
			messages: [{ role: "user", content: "hi" }],
			tools: [{ name: "draft_write", input_schema: {} }],
			thinking: { type: "enabled", budget_tokens: 2048 },
			output_config: { effort: "high" },
		},
		{ id: "claude-sonnet-4-6", provider: "anthropic", api: "anthropic-messages" },
		{ forcedToolChoice: { kind: "tool", name: "draft_write" } },
	);
	assert.deepEqual(ant?.tool_choice, { type: "tool", name: "draft_write" });
	assert.equal("thinking" in (ant ?? {}), false);
	assert.equal("output_config" in (ant ?? {}), false);

	// 3. Google 原生：写入 toolConfig.functionCallingConfig.ANY
	const goo = applyRelayPayload(
		{
			model: "gemini-2.5-pro",
			contents: [{ role: "user", parts: [{ text: "hi" }] }],
			config: { tools: [{ functionDeclarations: [{ name: "draft_write" }] }] },
		},
		{ id: "gemini-2.5-pro", provider: "google", api: "google-generative-ai" },
		{ forcedToolChoice: { kind: "tool", name: "draft_write" } },
	);
	const cfg = goo?.config as Record<string, unknown>;
	assert.deepEqual(cfg.toolConfig, {
		functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["draft_write"] },
	});
});

test("applyInputScrambleToString：保护标签/代码/宏/标识符，按规则表与无词表滑窗无损打断散文", () => {
	const zwsp = String.fromCharCode(0x200b);
	const input = [
		"<system-reminder>内部提醒不要打断原词</system-reminder>",
		"<scene id=\"night\">今夜的剧情描写与测试文本很长，还有 forbidden 英文长词以及 `draft_write` 代码和 {{char}} 占位符。</scene>",
		"```json\n{\"sensitive\": \"forbidden\"}\n```",
		"普通散文中的禁止词汇应当替换。",
	].join("\n");

	const out = applyInputScrambleToString(
		input,
		{
			splits: ["描写"],
			replacements: [{ from: "禁止词汇", to: "替代词" }],
		},
		{ scramble: true },
	);

	assert.ok(out.includes("<system-reminder>内部提醒不要打断原词</system-reminder>"), "system-reminder 必须原样保留");
	assert.ok(out.includes("<scene id=\"night\">"), "XML 开标签原样保留");
	assert.ok(out.includes("</scene>"), "XML 闭标签原样保留");
	assert.ok(out.includes("`draft_write`"), "行内代码与工具名不得被插入零宽");
	assert.ok(out.includes("{{char}}"), "未展开宏不得破坏");
	assert.ok(out.includes("```json\n{\"sensitive\": \"forbidden\"}\n```"), "代码块原样保留");
	assert.ok(out.includes(`描${zwsp}写`), "用户 splits 规则应在首字后插 U+200B");
	assert.ok(out.includes("替代词") && !out.includes("禁止词汇"), "用户 replacements 应生效");
	assert.ok(out.includes(`forb${zwsp}idden`), "独立英文长词应在中点打断");
	assert.ok(!out.includes("剧情描写与测试"), "连续中文散文应按步长插入 U+200B");
	assert.equal(out.replaceAll(zwsp, "").includes("今夜的剧情描写"), true, "去掉 U+200B 后语义无损");

	// 写作模式路径与章节文件名严禁被插入 U+200B
	const agentInput = [
		"当前项目资产目录（工作目录）：C:\\workspace\\Liyuan\\cards\\测试卡甲\\对话\\d5b1",
		"稿子目录：/data/cards/测试卡甲/正文",
		"005-觉醒时刻与初次交锋.md　4200 字　2026-11-08 10:20",
		"参考网址：https://example.com/longsegment/path",
		"后续规矩是所有门徒都需要遵循这条古老约束条件。",
	].join("\n");
	const agentOut = applyInputScrambleToString(agentInput, undefined, { scramble: true });
	assert.ok(agentOut.includes("C:\\workspace\\Liyuan\\cards\\测试卡甲\\对话\\d5b1"), "Windows 路径不得插入 U+200B");
	assert.ok(agentOut.includes("/data/cards/测试卡甲/正文"), "Unix 路径不得插入 U+200B");
	assert.ok(agentOut.includes("005-觉醒时刻与初次交锋.md"), "章节 .md 文件名不得插入 U+200B");
	assert.ok(agentOut.includes("https://example.com/longsegment/path"), "URL 不得插入 U+200B");
	assert.ok(agentOut.includes(zwsp), "正文提示句应正常完成 U+200B 打断");
});

test("packContextIntoToolDescription：四协议打包搬运进载体工具且严守当拍/工具链/预填/溢出边界", () => {
	const zwsp = String.fromCharCode(0x200b);

	// 1. OpenAI Completions：搬走 system 与早期纯文本历史，保留最后 user 与当前拍活跃工具往返
	const oaiPayload = {
		model: "gemini-2.5-pro",
		messages: [
			{ role: "system", content: "完整角色卡世界观设定与长篇写作规则描述，内容超过四十字边界。" },
			{ role: "user", content: "第一轮历史用户输入" },
			{ role: "assistant", content: "第一轮历史模型回复" },
			{ role: "user", content: "当前拍用户输入" },
			{ role: "assistant", content: "", tool_calls: [{ id: "tc1", type: "function", function: { name: "lorebook_search" } }] },
			{ role: "tool", tool_call_id: "tc1", content: "检索命中的设定条目" },
		],
		tools: [{ type: "function", function: { name: "draft_write", parameters: {} } }],
	};
	const packedOai = packContextIntoToolDescription(oaiPayload, "openai-completions", {
		scramble: true,
		relayRules: { splits: [], replacements: [{ from: "世界观", to: "背景观" }] },
	});
	assert.equal(packedOai.packed, true);
	const oaiMsgs = packedOai.payload.messages as Array<Record<string, unknown>>;
	assert.equal(oaiMsgs.length, 4, "仅保留锚定 system + 当前拍 user + assistant(tool_calls) + tool");
	assert.equal(oaiMsgs[0]!.role, "system");
	assert.ok(String(oaiMsgs[0]!.content).includes(CARRIER_TOOL_NAME));
	assert.equal(oaiMsgs[1]!.content, "当前拍用户输入");
	assert.equal(oaiMsgs[3]!.role, "tool");
	const oaiTools = packedOai.payload.tools as Array<{ function: { name: string; description: string } }>;
	assert.equal(oaiTools[0]!.function.name, CARRIER_TOOL_NAME);
	const descJsonStr = oaiTools[0]!.function.description.split("\n").slice(1).join("\n");
	const parsedJson = JSON.parse(descJsonStr) as { system: string; history: Array<{ role: string; content: string }> };
	assert.ok(parsedJson.system.replaceAll(zwsp, "").includes("背景观"), "JSON 内部文本已完成替身+无损打断且 JSON 可正常解析");
	assert.equal(parsedJson.history.length, 2);

	// 2. Anthropic：保留 OAuth 首段声明与嵌套 tool_use/tool_result 块
	const antPayload = {
		model: "claude-sonnet-4-5",
		system: [
			{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
			{ type: "text", text: "超长角色设定与剧本规矩正文，内容超过四十字以触发打包搬运逻辑。" },
		],
		messages: [
			{ role: "user", content: [{ type: "text", text: "历史轮一" }] },
			{ role: "assistant", content: [{ type: "text", text: "历史答一" }] },
			{ role: "user", content: [{ type: "text", text: "本拍用户输入" }] },
			{ role: "assistant", content: [{ type: "tool_use", id: "u1", name: "draft_write", input: {} }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "u1", content: "ok" }] },
		],
	};
	const packedAnt = packContextIntoToolDescription(antPayload, "anthropic");
	assert.equal(packedAnt.packed, true);
	const antSys = packedAnt.payload.system as Array<{ text: string }>;
	assert.equal(antSys[0]!.text, "You are Claude Code, Anthropic's official CLI for Claude.");
	assert.ok(antSys[1]!.text.includes(CARRIER_TOOL_NAME));
	assert.equal((packedAnt.payload.messages as unknown[]).length, 3, "当前拍 user + tool_use + user(tool_result) 必须全留");

	// 4. Google 原生：保留 functionCall/functionResponse 并沿用 parametersJsonSchema
	const gooPayload = {
		model: "gemini-3-pro",
		config: {
			systemInstruction: "足够长的系统设定正文，超过四十字阈值以便测试 Google 原生打包机制。",
			tools: [{ functionDeclarations: [{ name: "draft_write", parametersJsonSchema: { type: "object" } }] }],
		},
		contents: [
			{ role: "user", parts: [{ text: "早期提问" }] },
			{ role: "model", parts: [{ text: "早期回答" }] },
			{ role: "user", parts: [{ text: "当前轮提问" }] },
		],
	};
	const packedGoo = packContextIntoToolDescription(gooPayload, "google");
	assert.equal(packedGoo.packed, true);
	assert.equal((packedGoo.payload.contents as unknown[]).length, 1);
	const gTools = ((packedGoo.payload.config as Record<string, unknown>).tools as Array<{ functionDeclarations: Array<Record<string, unknown>> }>);
	assert.equal(gTools[0]!.functionDeclarations[0]!.name, CARRIER_TOOL_NAME);
	assert.ok("parametersJsonSchema" in gTools[0]!.functionDeclarations[0]!);

	// 5. OpenAI Responses：同时支持 input 前置 developer/system 与 history 迁移
	const respPayload = {
		model: "gpt-5",
		input: [
			{ role: "developer", content: "长篇系统开发指令说明文本，需要搬运进工具描述以绕过输入审查。" },
			{ role: "user", content: [{ type: "input_text", text: "旧问题" }] },
			{ type: "message", role: "assistant", content: [{ type: "output_text", text: "旧回答" }] },
			{ role: "user", content: [{ type: "input_text", text: "当前新问题" }] },
		],
	};
	const packedResp = packContextIntoToolDescription(respPayload, "openai-responses");
	assert.equal(packedResp.packed, true);
	assert.equal((packedResp.payload.input as unknown[]).length, 2);

	// 6. 容量上限溢出保护：超出 maxChars 的最早历史留回原 messages 而不静默丢弃
	const overflowRes = packContextIntoToolDescription(
		{
			messages: [
				{ role: "system", content: "系统设定长句，确保达到打包下限阈值并保留容量空间。" },
				{ role: "user", content: "很早的历史第一句内容需要留回原位不能丢失" },
				{ role: "assistant", content: "较新历史回复" },
				{ role: "user", content: "最新提问" },
			],
		},
		"openai-completions",
		{ maxChars: 130 },
	);
	assert.equal(overflowRes.packed, true);
	const ovMsgs = overflowRes.payload.messages as Array<{ content: string }>;
	assert.ok(
		ovMsgs.some((m) => m.content === "很早的历史第一句内容需要留回原位不能丢失"),
		"超出上限的最早历史必须留回原 messages",
	);

	// 7. 历史已完成轮次中的 tool_calls/tool 必须随前序一并折叠进载体工具，绝不残留在 messages[] 破坏角色交替（对齐 d5b1 多轮写作场景）
	const multiTurnWithOldTools = {
		model: "gemini-3.8-flash-high",
		messages: [
			{ role: "system", content: "完整写作系统设定长正文，确保达到打包下限。" },
			{ role: "user", content: "先查一下设定" },
			{ role: "assistant", content: "", tool_calls: [{ id: "old1", type: "function", function: { name: "lorebook_search" } }] },
			{ role: "tool", tool_call_id: "old1", content: "包含敏感历史设定词的超大工具检索结果：".repeat(60) },
			{ role: "assistant", content: "已查完旧设定。" },
			{ role: "user", content: "现在开始当前拍续写" },
			{ role: "assistant", content: "", tool_calls: [{ id: "cur1", type: "function", function: { name: "read" } }] },
			{ role: "tool", tool_call_id: "cur1", content: "当前拍刚读到的原文内容" },
		],
	};
	const packedMulti = packContextIntoToolDescription(multiTurnWithOldTools, "openai-completions", { scramble: true });
	assert.equal(packedMulti.packed, true);
	const multiMsgs = packedMulti.payload.messages as Array<Record<string, unknown>>;
	assert.equal(multiMsgs.length, 4, "仅允许保留 system_anchor + 当前拍 user + 当前拍 tool_calls + 当前拍 tool");
	assert.equal(multiMsgs[1]!.role, "user");
	assert.ok(String(multiMsgs[1]!.content).includes("现在开始当前拍续写"));
	assert.equal(multiMsgs[2]!.role, "assistant");
	assert.equal(multiMsgs[3]!.content, "当前拍刚读到的原文内容");
	const multiDesc = (packedMulti.payload.tools as Array<{ function: { description: string } }>)[0]!.function.description;
	const multiJson = JSON.parse(multiDesc.split("\n").slice(1).join("\n")) as { history: Array<{ role: string; content: string }> };
	assert.ok(multiJson.history.some((h) => h.role === "tool_note" && h.content.includes("已折叠")), "超长历史工具回执应被折叠截断并收进载体 JSON");

	// 8. 传入相同 shieldSeed 时多次调用生成字节完全一致，保障同拍工具往返命中 Prefix Cache；换种子后变化
	const cachePayload = {
		model: "gemini-2.5-pro",
		temperature: 0.85,
		messages: [
			{
				role: "system",
				content: [
					"超长角色设定正文第一段，包含背景故事、人物关系与规则说明。".repeat(6),
					"",
					"超长角色设定正文第二段，包含多行段落细节与状态规范要求。".repeat(6),
					"",
					"超长角色设定正文第三段，确保触发段落空行间的滑窗注释注入。".repeat(6),
				].join("\n"),
			},
			{ role: "user", content: "第一轮提问" },
			{ role: "assistant", content: "第一轮回复" },
			{ role: "user", content: "当前拍输入" },
		],
	};
	const runA = applyRelayPayload(cachePayload, { id: "gemini-2.5-pro", api: "openai-completions" }, {
		policy: { contextPackMode: "tool-desc", antiRouteShield: "scramble" },
		shieldSeed: 123456,
		relayRules: { splits: [], replacements: [] },
	});
	const runB = applyRelayPayload(cachePayload, { id: "gemini-2.5-pro", api: "openai-completions" }, {
		policy: { contextPackMode: "tool-desc", antiRouteShield: "scramble" },
		shieldSeed: 123456,
		relayRules: { splits: [], replacements: [] },
	});
	const runC = applyRelayPayload(cachePayload, { id: "gemini-2.5-pro", api: "openai-completions" }, {
		policy: { contextPackMode: "tool-desc", antiRouteShield: "scramble" },
		shieldSeed: 789012,
		relayRules: { splits: [], replacements: [] },
	});
	assert.deepEqual(runA?.tools, runB?.tools, "同拍相同 shieldSeed 必须产出字节完全一致的 tools[0] 以命中前缀缓存");
	assert.deepEqual(runA?.messages, runB?.messages, "同拍相同 shieldSeed 必须产出字节完全一致的 messages");
	assert.equal(runA?.temperature, runB?.temperature, "同拍相同 shieldSeed 保持采样值稳定");
	assert.notDeepEqual(runA?.tools, runC?.tools, "跨拍不同 shieldSeed 必须产出不同的工具内滑窗注释与防路由指纹");
	assert.notDeepEqual(runA?.messages, runC?.messages, "跨拍不同 shieldSeed 必须产出不同的消息头尾注释");
});

test("shouldInjectOpenAiGeminiSafety & applySamplingJitter & applyRelayPayload 组合校验", () => {
	const payload = {
		model: "gemini-2.5-pro",
		messages: [
			{ role: "system", content: "角色扮演系统的完整核心背景说明与规则正文，确保长度超过打包阈值。" },
			{ role: "user", content: "请继续演绎下一段。" },
		],
		temperature: 0.9,
		top_p: 0.95,
		openrouter_allow_fallbacks: true,
	};

	// 默认不往 OpenAI 兼容网关塞 safety_settings
	assert.equal(
		shouldInjectOpenAiGeminiSafety(payload, { id: "gemini-2.5-pro", api: "openai-completions" }, {}),
		false,
	);
	// 显式开启 googleSafetyOnOpenAi 且未被停用时注入
	assert.equal(
		shouldInjectOpenAiGeminiSafety(
			payload,
			{ id: "gemini-2.5-pro", api: "openai-completions" },
			{ googleSafetyOnOpenAi: true },
		),
		true,
	);
	assert.equal(
		shouldInjectOpenAiGeminiSafety(
			payload,
			{ id: "gemini-2.5-pro", api: "openai-completions" },
			{ googleSafetyOnOpenAi: true },
			true,
		),
		false,
	);

	// Anthropic 启用 thinking 时不微扰 temperature
	const antThinking = applySamplingJitter(
		{ model: "claude-sonnet-4-5", temperature: 1, thinking: { type: "enabled", budget_tokens: 2048 } },
		"anthropic",
	);
	assert.equal(antThinking.changed, false);

	const out = applyRelayPayload(
		payload,
		{ id: "gemini-2.5-pro", api: "openai-completions" },
		{
			policy: {
				contextPackMode: "tool-desc",
				antiRouteShield: "scramble",
				googleSafetyOnOpenAi: true,
			},
			relayRules: { splits: [], replacements: [] },
		},
	);
	assert.ok(out);
	assert.deepEqual(out.safety_settings, GEMINI_SAFETY_SETTINGS);
	assert.equal(out.openrouter_allow_fallbacks, false);
	assert.notEqual(out.temperature, 0.9);
	assert.ok(Math.abs((out.temperature as number) - 0.9) <= 0.0021);
	assert.equal((out.tools as Array<{ function: { name: string } }>)[0]!.function.name, CARRIER_TOOL_NAME);
});

