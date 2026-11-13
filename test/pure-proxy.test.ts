import assert from "node:assert/strict";
import test from "node:test";
import {
	openaiToAnthropicBody,
	openaiToGeminiBody,
	resolveUpstreamRequest,
	translateAnthropicSseEvent,
	translateGeminiSseData,
} from "../src/stage/pure-proxy.ts";

test("pure-proxy：OpenAI 兼容渠道 100% 原样透传脚本自定义字段与鉴权头", () => {
	const req = resolveUpstreamRequest(
		{
			id: "gemini-2.5-pro",
			provider: "relay",
			api: "openai-completions",
			baseUrl: "https://relay.example.com/v1/",
			headers: { "x-custom": "1" },
		},
		{ apiKey: "sk-secret" },
		{
			model: "pg-gemini-2.5-pro",
			messages: [
				{ role: "system", content: "系统" },
				{ role: "assistant", content: "<think>", thoughtSignature: "skip_thought_signature_validator" },
			],
			tools: [{ type: "function", function: { name: "soliumbra_reply", description: "reply", parameters: {} } }],
			tool_choice: "required",
			toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["soliumbra_reply"] } },
			custom_include_body: "reasoning_effort: high",
			stream: true,
		},
	);

	assert.equal(req.protocol, "openai-passthrough");
	assert.equal(req.url, "https://relay.example.com/v1/chat/completions");
	assert.equal(req.headers.authorization, "Bearer sk-secret");
	assert.equal(req.headers["x-custom"], "1");
	assert.equal(req.body.model, "pg-gemini-2.5-pro");
	assert.equal(req.body.tool_choice, "required");
	assert.deepEqual(req.body.toolConfig, {
		functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["soliumbra_reply"] },
	});
	assert.equal(req.body.reasoning_effort, "high");
	assert.equal(req.body.custom_include_body, undefined);
});

test("pure-proxy：Anthropic 官网协议双向转换与 tool_use SSE 翻译", () => {
	const body = openaiToAnthropicBody(
		{
			messages: [
				{ role: "system", content: "系统指令" },
				{ role: "user", content: "开始" },
				{
					role: "assistant",
					content: "",
					tool_calls: [{ id: "c1", type: "function", function: { name: "soliumbra_reply", arguments: '{"a":1}' } }],
				},
				{ role: "tool", tool_call_id: "c1", content: "ok" },
			],
			tools: [{ type: "function", function: { name: "soliumbra_reply", description: "d", parameters: { type: "object" } } }],
			tool_choice: "required",
		},
		"claude-sonnet-4-6",
	);
	assert.equal(body.system, "系统指令");
	assert.deepEqual(body.tool_choice, { type: "any" });
	assert.equal((body.messages as unknown[]).length, 3);

	const startChunk = translateAnthropicSseEvent("content_block_start", {
		index: 0,
		content_block: { type: "tool_use", id: "tu_1", name: "soliumbra_reply" },
	});
	assert.ok(startChunk && startChunk.includes('"name":"soliumbra_reply"'));

	const deltaChunk = translateAnthropicSseEvent("content_block_delta", {
		index: 0,
		delta: { type: "input_json_delta", partial_json: '{"game_content":"' },
	});
	assert.ok(deltaChunk && deltaChunk.includes('\\"game_content\\":\\"'));
});

test("pure-proxy：Google Gemini 官网协议双向转换与 functionCall SSE 翻译", () => {
	const body = openaiToGeminiBody({
		messages: [
			{ role: "system", content: "sys" },
			{ role: "user", content: "hi" },
			{
				role: "assistant",
				content: "thinking",
				thoughtSignature: "sig_1",
				tool_calls: [{ id: "c1", function: { name: "context", arguments: '{"query":"sync"}' } }],
			},
			{ role: "tool", name: "context", content: "done" },
		],
		tools: [{ type: "function", function: { name: "context", description: "ctx", parameters: { type: "object" } } }],
		toolConfig: { functionCallingConfig: { mode: "ANY" } },
	});
	assert.deepEqual(body.toolConfig, { functionCallingConfig: { mode: "ANY" } });
	assert.equal((body.contents as unknown[]).length, 3);

	const gemChunk = translateGeminiSseData({
		candidates: [
			{
				content: { parts: [{ functionCall: { name: "soliumbra_reply", args: { game_content: "你好" } } }] },
				finishReason: "STOP",
			},
		],
	});
	assert.ok(gemChunk && gemChunk.includes('"name":"soliumbra_reply"') && gemChunk.includes('"finish_reason":"stop"'));
});
