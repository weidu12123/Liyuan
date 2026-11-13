import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
	applySPresetToolsAndInjections,
	extractSPresetConfig,
	runSPresetChatSquash,
	runSPresetFinalRequestProcessing,
	runSPresetOutputPreprocessing,
} from "../web/src/spreset.ts";

test("SPreset 执行器：对真实 Meowssiah_1.9.12.json 跑通 ChatSquash → ToolBindings → FinalRequestProcessing → OutputPreprocessing 全链路", async () => {
	const candidatePaths = [
		"E:/新建文件夹 (14)/新建文件夹 (6)/Meowssiah_1.9.12.json",
		"assets/presets/Meowssiah_1.9.12.json",
	];
	const targetPath = candidatePaths.find((p) => existsSync(p));
	assert.ok(targetPath, "至少应存在一份 Meowssiah_1.9.12.json 夹具");

	const presetRaw = JSON.parse(readFileSync(targetPath!, "utf8")) as Record<string, unknown>;
	const spConfig = extractSPresetConfig(presetRaw);
	assert.ok(spConfig, "应从 SPresetSettings / extensions.SPreset 提取出配置");

	const inputMsgs = [
		{
			role: "system" as const,
			content:
				"<|sep|><|merge|>小猫之神会使用reply工具回复<run_tool_replacement>\n|小猫之神|哼哼，大家好喵！\n|用户|请开始游戏<<<|catgodml|registerPart:game_content:互动剧情正文>>><<<|catgodml|setLastMessage:我推开神殿大门>>>",
		},
		{ role: "user" as const, content: "我推开神殿大门" },
		{ role: "assistant" as const, content: "<think>" },
	];

	// 1. ChatSquash 压平与角色切分
	const squashed = runSPresetChatSquash(inputMsgs, spConfig, { charName: "小猫之神", userName: "旅人" });
	assert.equal(squashed.length, 1);
	assert.ok(String(squashed[0]!.content).includes('"role": "soliumbra"'), "squashed_post_script 应重写伪多轮角色");

	// 2. ToolBindings 注入 soliumbra_reply
	const reqPayload = applySPresetToolsAndInjections(
		{ model: "gemini-2.5-pro", messages: squashed, stream: true },
		spConfig,
	);
	const toolNames = (reqPayload.tools as Array<{ function: { name: string } }>).map((t) => t.function.name);
	assert.ok(toolNames.includes("soliumbra_reply"), "ToolBindings 应注册 soliumbra_reply");

	// 3. FinalRequestProcessing 解析 <run_tool_replacement> 伪造多轮工具流与 context 工具
	const finalReq = await runSPresetFinalRequestProcessing(reqPayload, spConfig);
	const finalToolNames = (finalReq.tools as Array<{ function: { name: string } }>).map((t) => t.function.name);
	assert.ok(finalToolNames.includes("context"), "FinalRequestProcessing 应注入 context 工具承载全部历史");
	const contextTool = (finalReq.tools as Array<{ function: { name: string; description: string } }>).find(
		(t) => t.function.name === "context",
	)!;
	assert.ok(contextTool.function.description.includes("SoliUmbra World Context Registry"));
	assert.ok(contextTool.function.description.includes("我推开神殿大门"));

	const finalMsgs = finalReq.messages as Array<{ role: string; tool_calls?: unknown[]; content?: string }>;
	assert.equal(finalMsgs.length, 8, "应构造 8 轮伪造 Agent 工具调用对话历史");
	assert.ok(finalMsgs.some((m) => Array.isArray(m.tool_calls) && m.tool_calls.length > 0));
	assert.equal(finalReq.tool_choice, "required");

	// 4. OutputPreprocessing 在流式半截及最终态把 soliumbra_reply 工具调用消费解包成正文标签
	const stateRef = { current: {} };
	const streamPartial = runSPresetOutputPreprocessing(
		[
			{
				id: "call_1",
				type: "function",
				function: {
					name: "soliumbra_reply",
					arguments: '{"think_nya":"小猫在思考喵…","game_content":"神殿大门轰然开启',
				},
			},
		],
		"",
		spConfig,
		stateRef,
		false,
	);
	assert.equal(streamPartial.consumedToolCalls, true);
	assert.ok(streamPartial.text.includes("<think_nya>\n小猫在思考喵…\n</think_nya>"));
	assert.ok(streamPartial.text.includes("<game>\n神殿大门轰然开启\n</game>"));
});
