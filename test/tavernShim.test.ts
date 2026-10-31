import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildSrcDoc } from "../web/src/frameDoc.ts";
import {
	IFRAME_TAVERN_BRIDGE_SNIPPET,
	executeTriggerSlash,
	installEventBus,
	installParentTavernShim,
	parseSlashPipeline,
	registerTavernChatBridge,
} from "../web/src/tavernShim.ts";

test("IFRAME_TAVERN_BRIDGE_SNIPPET 自包含并暴露 TavernHelper/eventOn/triggerSlash", () => {
	assert.ok(IFRAME_TAVERN_BRIDGE_SNIPPET.startsWith("<script>"));
	assert.ok(IFRAME_TAVERN_BRIDGE_SNIPPET.includes("TavernHelper"));
	assert.ok(IFRAME_TAVERN_BRIDGE_SNIPPET.includes("eventOn"));
	assert.ok(IFRAME_TAVERN_BRIDGE_SNIPPET.includes("eventEmit"));
	assert.ok(IFRAME_TAVERN_BRIDGE_SNIPPET.includes("TheaterAPI"));
	assert.ok(IFRAME_TAVERN_BRIDGE_SNIPPET.includes("triggerSlash"));
});

test("parseSlashPipeline: 管道分段", () => {
	assert.deepEqual(parseSlashPipeline("/send hello|/trigger"), ["/send hello", "/trigger"]);
});

test("executeTriggerSlash: /send|/trigger 调用 sendPrompt", () => {
	let sent = "";
	let filled = "";
	registerTavernChatBridge({
		setInput: (t) => {
			filled = t;
		},
		sendPrompt: (t) => {
			sent = t;
		},
	});
	const r = executeTriggerSlash(
		"/send 姓名：旅人；出身：山村|/trigger",
		{
			setInput: (t) => {
				filled = t;
			},
			sendPrompt: (t) => {
				sent = t;
			},
		},
	);
	assert.equal(r.ok, true);
	assert.equal(r.triggered, true);
	assert.ok(sent.includes("旅人"));
	assert.equal(filled, ""); // 直发，不必先 setInput
	registerTavernChatBridge(null);
});

test("executeTriggerSlash: 仅 /send 填输入框", () => {
	let filled = "";
	const r = executeTriggerSlash("/send 只注入不发送", {
		setInput: (t) => {
			filled = t;
		},
		sendPrompt: () => {
			throw new Error("不应触发发送");
		},
	});
	assert.equal(r.ok, true);
	assert.equal(r.filledOnly, true);
	assert.equal(filled, "只注入不发送");
});

test("installEventBus: eventOn/eventEmit 可互通", () => {
	const target: {
		eventOn?: (n: string, cb: (...a: unknown[]) => void) => void;
		eventEmit?: (n: string, ...a: unknown[]) => void;
	} = {};
	installEventBus(target);
	let got = "";
	target.eventOn!("ping", (x) => {
		got = String(x);
	});
	target.eventEmit!("ping", "ok");
	assert.equal(got, "ok");
});

test("installParentTavernShim: generate 返回字符串 Promise", async () => {
	// jsdom-less: 模拟 window
	const g = globalThis as typeof globalThis & {
		window?: object;
		TavernHelper?: { generate: (p?: { user_input?: string }) => Promise<string>; stopAllGeneration: () => void };
		__liyuanTavernShimInstalled?: boolean;
	};
	const prev = g.window;
	const fakeWin: Record<string, unknown> = {};
	g.window = fakeWin;
	// 直接在 fake 上装（实现读 window）
	// 改用把 shim 装到 fakeWin 上：临时 patch
	const { installParentTavernShim: install } = await import("../web/src/tavernShim.ts");
	// re-install clean
	delete (fakeWin as { __liyuanTavernShimInstalled?: boolean }).__liyuanTavernShimInstalled;
	// installParentTavernShim uses global window
	Object.assign(g, { window: fakeWin });
	// Need install to use our fakeWin - it checks typeof window
	// In node, window may be undefined. Patch:
	(globalThis as unknown as { window: Record<string, unknown> }).window = fakeWin;
	delete fakeWin.__liyuanTavernShimInstalled;
	install();
	const th = fakeWin.TavernHelper as {
		generate: (p?: { user_input?: string }) => Promise<string>;
		stopAllGeneration: () => void;
	};
	assert.ok(th);
	const text = await th.generate({ user_input: "你好修仙" });
	assert.equal(typeof text, "string");
	assert.ok(text.includes("梨园") || text.includes("你好修仙"));
	th.stopAllGeneration();
	if (prev === undefined) delete (globalThis as { window?: unknown }).window;
	else (globalThis as { window: unknown }).window = prev;
});

test("buildSrcDoc scripts: 桥在卡内容之前", () => {
	const doc = buildSrcDoc("<!doctype html><html><head></head><body><script>window.__card=1</script></body></html>", true, true);
	const iBridge = doc.indexOf("TavernHelper");
	const iCard = doc.indexOf("__card");
	assert.ok(iBridge > 0 && iCard > 0 && iBridge < iCard, "垫片须先于卡脚本");
});

test("酒馆全局垫片：jQuery/lodash/变量系统/Mvu/waitGlobalInitialized 注入脚本帧", () => {
	const doc = buildSrcDoc(
		"<!doctype html><html><head></head><body><script>window.__card=1</script></body></html>",
		true,
		true,
	);
	const cardScriptStart = doc.indexOf("__card");
	// 按注入顺序：bridge → globals → 卡脚本
	assert.ok(doc.indexOf("jQuery v3.7.1") > 0 && doc.indexOf("jQuery v3.7.1") < cardScriptStart, "jQuery 源码在卡脚本前");
	assert.ok(doc.indexOf("getAllVariables") < cardScriptStart, "getAllVariables 在卡脚本前");
	assert.ok(doc.indexOf("waitGlobalInitialized") < cardScriptStart, "waitGlobalInitialized 在卡脚本前");
	assert.ok(doc.indexOf("Mvu") < cardScriptStart, "Mvu 壳在卡脚本前");

	// 静态帧不注入（省体积、无脚本不依赖）
	const staticDoc = buildSrcDoc("<!doctype html><html><head></head><body><div>x</div></body></html>", false, true);
	assert.ok(!staticDoc.includes("getAllVariables"), "静态帧不注入变量垫片");

	// MVU 卡界面形态：占位符替换出的 HTML + 脚本裸用 $/getAllVariables/Mvu
	const cardUi =
		"```html\n<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n<style>.nav-btn{display:inline-block;padding:4px 10px}</style>\n</head>\n<body>\n" +
		"<div class=\"nav-btn\" data-tab=\"protagonist\">主角状态</div>\n" +
		"<div class=\"nav-btn\" data-tab=\"simulator\">模拟器</div>\n" +
		"<script type=\"module\">\n" +
		"window.switchTab = function(tabId) {\n" +
		"  $('.nav-btn').removeClass('active');\n" +
		"  $(`[onclick=\"switchTab('${tabId}')\"]`).addClass('active');\n" +
		"};\n" +
		"async function init() {\n" +
		"  await waitGlobalInitialized('Mvu');\n" +
		"  const v = getAllVariables();\n" +
		"  const s = _.get(v, 'stat_data', {});\n" +
		"  $('#p-name').text((s.主角 || {}).姓名 || '未知');\n" +
		"  eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, () => {});\n" +
		"  switchTab('protagonist');\n" +
		"}\n" +
		"init();\n" +
		"</script>\n" +
		"</body>\n</html>\n";
	const full = buildSrcDoc(cardUi, true, true);
	const scriptBlocks = full.match(/<script[\s\S]*?<\/script>/gi) ?? [];
	const headBlock = scriptBlocks.slice(0, 3).join("\n");
	assert.ok(headBlock.includes("jQuery v3.7.1"), "jQuery 进入 head");
	assert.ok(headBlock.includes("g.Mvu"), "Mvu 壳进入 head");
	assert.ok(headBlock.includes("getAllVariables"), "变量系统垫片进入 head");
	assert.ok(headBlock.includes("getCurrentMessageId"), "getCurrentMessageId 进入 head");
	assert.ok(headBlock.includes("getMvuData"), "Mvu.getMvuData 进入 head");
	// 卡脚本本身完整（未被截断）
	assert.ok(full.includes("switchTab"), "卡脚本原文在场");
});

