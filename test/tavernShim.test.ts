import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { buildSrcDoc } from "../web/src/frameDoc.ts";
import {
	IFRAME_TAVERN_BRIDGE_SNIPPET,
	IFRAME_TAVERN_GLOBALS_SNIPPET,
	executeTriggerSlash,
	iframe_events,
	installEventBus,
	installParentTavernShim,
	parseSlashPipeline,
	registerLiyuanScriptTransport,
	registerTavernChatBridge,
	tavern_events,
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

function stripScriptTags(snippet: string): string {
	return snippet.replace(/^<script>/i, "").replace(/<\/script>$/i, "");
}

function createIframeSandbox(opts?: {
	iframeName?: string;
	parentWin?: Record<string, unknown>;
	messages?: Array<{ message_id: number; role: "user" | "assistant"; name: string; message: string; text: string }>;
	mvuStatData?: Record<string, unknown>;
	onRpc?: (action: string, params: Record<string, unknown>, rpcOpts: Record<string, unknown>) => Promise<unknown>;
}) {
	const storage = new Map<string, string>();
	const rpcCalls: Array<{ action: string; params: Record<string, unknown>; opts: Record<string, unknown> }> = [];
	const parentSharedGlobals: Record<string, unknown> = {};
	const runtimeCtx = {
		card: "xianxia.png",
		charName: "苏瑶",
		userName: "韩立",
		chatId: "chat-01",
		sessionId: "sess-01",
		mode: "roleplay",
		streaming: false,
		presetName: "NY-1.4.5",
		worldbooks: ["修仙界设定集"],
		displayRules: [{ pattern: "<hide>[\\s\\S]*?</hide>", flags: "g", replace: "", enabled: true }],
		messages: opts?.messages ?? [
			{ message_id: 0, role: "assistant", name: "苏瑶", message: "第0楼开场白", text: "第0楼开场白" },
			{ message_id: 1, role: "user", name: "韩立", message: "第1楼玩家提问", text: "第1楼玩家提问" },
			{ message_id: 2, role: "assistant", name: "苏瑶", message: "第2楼最新回复", text: "第2楼最新回复" },
		],
	};

	const parentWin: Record<string, unknown> = opts?.parentWin ?? {
		__liyuanRuntimeContext: runtimeCtx,
		__liyuanVariables: { stat_data: opts?.mvuStatData ?? { 境界: "筑基", 灵石: 100 } },
		__liyuanSharedGlobals: parentSharedGlobals,
		Liyuan: {
			call: async (action: string, params: Record<string, unknown> = {}, rpcOpts: Record<string, unknown> = {}) => {
				rpcCalls.push({ action, params, opts: rpcOpts });
				if (opts?.onRpc) {
					return await opts.onRpc(action, params, rpcOpts);
				}
				return { ok: true, action, requestId: "req_1", result: {} };
			},
		},
		postMessage: () => {},
	};

	const sandbox: Record<string, unknown> = {
		name: opts?.iframeName ?? "TH-script--card--main_ui",
		frameElement: {
			id: opts?.iframeName ?? "TH-script--card--main_ui",
			getAttribute: (attr: string) => {
				if (attr === "data-liyuan-message-id") {
					const m = /^TH-message--(\d+)--/.exec(opts?.iframeName ?? "");
					return m ? m[1] : null;
				}
				return null;
			},
		},
		parent: parentWin,
		localStorage: {
			getItem: (k: string) => storage.get(k) ?? null,
			setItem: (k: string, v: string) => {
				storage.set(k, String(v));
			},
		},
		addEventListener: () => {},
		setTimeout,
		clearTimeout,
		console,
		Date,
		Math,
		JSON,
		Promise,
		Map,
		Set,
		Array,
		Object,
		String,
		Number,
		Boolean,
		RegExp,
		Error,
		TypeError,
		parseInt,
		parseFloat,
		isNaN,
		isFinite,
		encodeURIComponent,
	};
	sandbox.window = sandbox;
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(stripScriptTags(IFRAME_TAVERN_BRIDGE_SNIPPET), sandbox);
	vm.runInContext(stripScriptTags(IFRAME_TAVERN_GLOBALS_SNIPPET), sandbox);
	return { win: sandbox as Record<string, any>, rpcCalls, parentWin };
}

test("刀2：帧身份（getIframeName / getScriptId / 消息帧真实 getCurrentMessageId）与 SillyTavern.getContext()", async () => {
	const scriptFrame = createIframeSandbox({ iframeName: "TH-script--card--status_orb" });
	assert.equal(scriptFrame.win.getIframeName(), "TH-script--card--status_orb");
	assert.equal(scriptFrame.win.getScriptId(), "status_orb");
	assert.equal(scriptFrame.win.getLastMessageId(), 2);
	// 脚本帧调 getCurrentMessageId 回落到最新楼层 2
	assert.equal(scriptFrame.win.getCurrentMessageId(), 2);

	// 第 0 楼的消息气泡帧调 getCurrentMessageId 必须返回 0，不能误返回最新楼层 2
	const msgFrame0 = createIframeSandbox({
		iframeName: "TH-message--0--0_r1",
		parentWin: scriptFrame.parentWin,
	});
	assert.equal(msgFrame0.win.getCurrentMessageId(), 0);
	assert.equal(msgFrame0.win.getMessageId(), 0);

	// SillyTavern.getContext() 动态投影
	const stCtx = scriptFrame.win.SillyTavern.getContext();
	assert.equal(stCtx.name1, "韩立");
	assert.equal(stCtx.name2, "苏瑶");
	assert.equal(stCtx.chat.length, 3);
	assert.equal(stCtx.chat[0].mes, "第0楼开场白");
	assert.equal(stCtx.chat[1].is_user, true);
	assert.equal(stCtx.event_types.MESSAGE_RECEIVED, "message_received");

	// initializeGlobal 与 waitGlobalInitialized 跨帧握手
	scriptFrame.win.initializeGlobal("CustomEngine", { ready: true, version: 3 });
	const resolved = await msgFrame0.win.waitGlobalInitialized("CustomEngine", 200);
	assert.deepEqual(resolved, { ready: true, version: 3 });
	assert.equal(msgFrame0.win.CustomEngine.version, 3);
});

test("刀3：变量系统全7类作用域、深合并、同步/异步 updateVariablesWith 与 deleteVariable", async () => {
	const { win, rpcCalls } = createIframeSandbox({
		mvuStatData: { 境界: "筑基", 灵石: 100, 背包: ["回春丹"] },
	});

	// 1. insertOrAssignVariables 深合并（不丢失原有 境界 字段，数组直接替换）
	const afterAssign = win.insertOrAssignVariables(
		{ stat_data: { 灵石: 250, 背包: ["筑基丹", "灵剑"] }, 额外标记: "已触发" },
		{ type: "chat" },
	);
	assert.equal(afterAssign.stat_data.境界, "筑基");
	assert.equal(afterAssign.stat_data.灵石, 250);
	assert.deepEqual(afterAssign.stat_data.背包, ["筑基丹", "灵剑"]);
	assert.equal(afterAssign.额外标记, "已触发");

	// 确认触发了服务端 data.write 与 state.commit
	assert.ok(rpcCalls.some((c) => c.action === "data.write" && c.params.scope === "chat"));
	assert.ok(rpcCalls.some((c) => c.action === "state.commit"));

	// 2. 同步 updateVariablesWith 直接返回对象，异步 updater 返回 Promise
	const syncRes = win.updateVariablesWith((vars: any) => {
		vars.stat_data.灵石 += 50;
		return vars;
	}, { type: "chat" });
	assert.equal(syncRes.stat_data.灵石, 300);

	const asyncRes = await win.updateVariablesWith(async (vars: any) => {
		vars.stat_data.灵石 += 100;
		return vars;
	}, { type: "chat" });
	assert.equal(asyncRes.stat_data.灵石, 400);

	// 3. insertVariables 只插入不存在的键，不覆盖已有键
	const afterInsert = win.insertVariables(
		{ 额外标记: "不应覆盖", 新键: "首次插入" },
		{ type: "chat" },
	);
	assert.equal(afterInsert.额外标记, "已触发");
	assert.equal(afterInsert.新键, "首次插入");

	// 4. deleteVariable 按路径删除并返回 { variables, delete_occurred }
	const delRes = win.deleteVariable("stat_data.背包", { type: "chat" });
	assert.equal(delRes.delete_occurred, true);
	assert.equal(delRes.variables.stat_data.背包, undefined);
	assert.equal(delRes.variables.stat_data.境界, "筑基");
});

test("刀4：tavern_events / iframe_events 常量、优先级队列、{ stop } 句柄与消息楼层号整形", async () => {
	const { win } = createIframeSandbox();
	assert.equal(win.tavern_events.MESSAGE_RECEIVED, "message_received");
	assert.equal(win.iframe_events.GENERATION_ENDED, "js_generation_ended");

	const order: string[] = [];
	win.eventOn(tavern_events.MESSAGE_RECEIVED, (id: unknown) => {
		order.push(`normal:${typeof id}:${id}`);
	});
	win.eventMakeFirst(tavern_events.MESSAGE_RECEIVED, (id: unknown) => {
		order.push(`first:${typeof id}:${id}`);
	});
	const lastStop = win.eventMakeLast(tavern_events.MESSAGE_RECEIVED, () => {
		order.push("last");
	});
	win.eventOnce(tavern_events.MESSAGE_RECEIVED, () => {
		order.push("once");
	});

	// 传入字符串 "2"，应被自动转为 number 2
	await win.eventEmit(tavern_events.MESSAGE_RECEIVED, "2", "normal");
	assert.deepEqual(order, ["first:number:2", "normal:number:2", "last", "once"]);

	// 停止 last 监听器后再次触发，once 与 last 均不再执行
	lastStop.stop();
	order.length = 0;
	await win.eventEmit(tavern_events.MESSAGE_RECEIVED, 3, "normal");
	assert.deepEqual(order, ["first:number:3", "normal:number:3"]);
});

test("刀5：getChatMessages 字符串范围（'0-{{lastMessageId}}' / '-1'）、世界书 CRUD 与后台独立 generate", async () => {
	const { win, rpcCalls } = createIframeSandbox({
		onRpc: async (action, params) => {
			if (action === "generation.contextual" || action === "generation.explicit") {
				return {
					ok: true,
					action,
					requestId: "gen_1",
					result: { text: `后台生成结果：${params.prompt}`, thinking: "思考过程" },
				};
			}
			if (action === "lorebooks.read") {
				return {
					ok: true,
					action,
					requestId: "lb_1",
					result: {
						entries: [
							{
								uid: 1,
								comment: "青云门山门",
								keys: ["青云门", "山门"],
								content: "青云门位于东胜神洲。",
								constant: false,
								enabled: true,
								fingerprint: "fp_qingyun",
							},
						],
					},
				};
			}
			return { ok: true, action, requestId: "ok", result: {} };
		},
	});

	// 1. getChatMessages("-1") 与 "{{lastMessageId}}" 必须精确拿到第 2 楼，绝不能误取第 0 楼
	const latestByNeg = win.getChatMessages("-1");
	assert.equal(latestByNeg.length, 1);
	assert.equal(latestByNeg[0].message_id, 2);
	assert.equal(latestByNeg[0].message, "第2楼最新回复");

	const latestByMacro = win.getChatMessages("{{lastMessageId}}");
	assert.equal(latestByMacro.length, 1);
	assert.equal(latestByMacro[0].message_id, 2);

	const fullRange = win.getChatMessages("0-{{lastMessageId}}");
	assert.equal(fullRange.length, 3);

	const onlyUser = win.getChatMessages("0-{{lastMessageId}}", { role: "user" });
	assert.equal(onlyUser.length, 1);
	assert.equal(onlyUser[0].name, "韩立");

	// 2. setChatMessage 修改最新楼层正文应同步调用 Liyuan.messages.updateReply
	await win.setChatMessage("改写后的第2楼正文", 2);
	assert.equal(win.getChatMessages(-1)[0].message, "改写后的第2楼正文");
	assert.ok(rpcCalls.some((c) => c.action === "messages.updateReply" && c.params.text === "改写后的第2楼正文"));

	// 3. TavernHelper.generate 默认走 generation.contextual（不污染主聊天 chat.submit）
	registerLiyuanScriptTransport(async (action, params) => {
		rpcCalls.push({ action, params: params ?? {}, opts: {} });
		return {
			ok: true,
			action,
			requestId: "gen_parent",
			result: { text: `父页独立生成：${params?.prompt}`, thinking: "" },
		};
	});
	try {
		const genText = await win.TavernHelper.generate({ user_input: "请输出状态栏 JSON", should_stream: true });
		assert.equal(genText, "后台生成结果：请输出状态栏 JSON");
		assert.ok(rpcCalls.some((c) => c.action === "generation.contextual"));
		assert.ok(!rpcCalls.some((c) => c.action === "chat.submit"));
	} finally {
		registerLiyuanScriptTransport(null);
	}

	// 4. 世界书读取与 updateWorldbookWith
	const wb = await win.getWorldbook("修仙界设定集");
	assert.equal(wb.length, 1);
	assert.equal(wb[0].name, "青云门山门");
	assert.deepEqual(wb[0].strategy.keys, ["青云门", "山门"]);

	await win.updateWorldbookWith("修仙界设定集", (entries: any[]) => {
		entries[0].content = "青云门已开启护山大阵。";
		return entries;
	});
	assert.ok(
		rpcCalls.some(
			(c) =>
				c.action === "lorebooks.updateEntry" &&
				c.params.fingerprint === "fp_qingyun" &&
				c.params.content === "青云门已开启护山大阵。",
		),
	);

	// 5. 宏与正则格式化
	assert.equal(win.substitudeMacros("{{user}}对{{char}}说（楼层{{lastMessageId}}）"), "韩立对苏瑶说（楼层2）");
	assert.equal(win.formatAsTavernRegexedString("正文<hide>隐藏内容</hide>保留", "ai_output", "display"), "正文保留");
});

test("全集核销：内置原版 lodash / zod v4 / YAML、JS-Slash-Runner 4.12.1 全 19 模块导出表与 registerMvuSchema", async () => {
	const { win } = createIframeSandbox();

	// 1. 原版 lodash (_) 链式包装与高频方法
	assert.equal(typeof win._, "function");
	assert.deepEqual(
		JSON.parse(
			JSON.stringify(
				win._({ a: 1 })
					.set("b.c", [10, 20, 30])
					.value(),
			),
		),
		{ a: 1, b: { c: [10, 20, 30] } },
	);
	assert.deepEqual(JSON.parse(JSON.stringify(win._.toPath("a.b[0].c"))), ["a", "b", "0", "c"]);
	assert.deepEqual(JSON.parse(JSON.stringify(win._.dropRight(["a", "b", "c"]))), ["a", "b"]);

	// 2. 原版 zod v4 (z & z.z) + YAML
	assert.equal(typeof win.z?.object, "function");
	assert.equal(typeof win.z?.z?.ZodObject, "function");
	assert.equal(typeof win.YAML?.parse, "function");
	assert.deepEqual(JSON.parse(JSON.stringify(win.YAML.parse("hp: 100\nmp: 50"))), { hp: 100, mp: 50 });

	// 3. registerMvuSchema（支持 .prefault() 与 .transform() 派生计算）
	const schema = win.z.object({
		状态: win.z
			.object({
				处女状态: win.z.boolean().prefault(true),
				堕落值: win.z.coerce.number().prefault(55),
				_堕落阶段: win.z.number().prefault(1),
			})
			.transform((data: any) => {
				data._堕落阶段 = data.堕落值 <= 40 ? 1 : data.堕落值 <= 80 ? 2 : 3;
				return data;
			})
			.prefault({}),
	});
	win.registerMvuSchema(schema);
	const afterSchema = win.getAllVariables();
	assert.equal(afterSchema.stat_data.状态.处女状态, true);
	assert.equal(afterSchema.stat_data.状态.堕落值, 55);
	assert.equal(afterSchema.stat_data.状态._堕落阶段, 2);

	// 4. Mvu.events 真实常量与方法
	assert.equal(win.Mvu.events.VARIABLE_INITIALIZED, "mag_variable_initialized");
	assert.equal(win.Mvu.events.VARIABLE_UPDATE_STARTED, "mag_variable_update_started");
	assert.equal(win.Mvu.events.VARIABLE_UPDATE_ENDED, "mag_variable_update_ended");
	assert.equal(win.Mvu.isDuringExtraAnalysis(), false);
	assert.equal(typeof win.SillyTavern.getCurrentChatId, "function");
	assert.equal(win.SillyTavern.getCurrentChatId(), "chat-01");

	// 5. injectPrompts 返回 { uninject } 并支持 once 自动清理
	const inj = win.injectPrompts([{ id: "test_inj", position: "in_chat", depth: 0, role: "system", content: "提示" }], {
		once: true,
	});
	assert.equal(typeof inj?.uninject, "function");
	assert.equal(win.__liyuanInjectedPrompts.has("test_inj"), true);
	await win.eventEmit(win.tavern_events.GENERATION_ENDED, 2);
	assert.equal(win.__liyuanInjectedPrompts.has("test_inj"), false);

	// 6. JS-Slash-Runner 4.12.1 src/function/index.ts 全导出表 100% 存在性核销
	const requiredExports = [
		"_th_impl",
		"_bind",
		"audioEnable",
		"audioImport",
		"audioMode",
		"audioPlay",
		"audioSelect",
		"playAudio",
		"pauseAudio",
		"getAudioList",
		"replaceAudioList",
		"appendAudioList",
		"getAudioSettings",
		"setAudioSettings",
		"getCurrentAudio",
		"builtin",
		"getCharacterNames",
		"getCharacterIds",
		"getCurrentCharacterName",
		"getCurrentCharacterId",
		"createCharacter",
		"createOrReplaceCharacter",
		"deleteCharacter",
		"getCharacter",
		"replaceCharacter",
		"updateCharacterWith",
		"getChatMessages",
		"setChatMessages",
		"setChatMessage",
		"createChatMessages",
		"deleteChatMessages",
		"rotateChatMessages",
		"formatAsDisplayedMessage",
		"retrieveDisplayedMessage",
		"refreshOneMessage",
		"tavern_events",
		"iframe_events",
		"isAdmin",
		"getTavernHelperExtensionId",
		"getExtensionType",
		"getExtensionStatus",
		"getExtensionInstallationInfo",
		"isInstalledExtension",
		"installExtension",
		"uninstallExtension",
		"reinstallExtension",
		"updateExtension",
		"getTavernFile",
		"uploadTavernFile",
		"deleteTavernFile",
		"importRawCharacter",
		"importRawPreset",
		"importRawChat",
		"importRawWorldbook",
		"importRawTavernRegex",
		"injectPrompts",
		"uninjectPrompts",
		"builtin_prompt_default_order",
		"getModelList",
		"getProxyPresetNames",
		"generate",
		"generateRaw",
		"stopGenerationById",
		"stopAllGeneration",
		"initializeGlobal",
		"waitGlobalInitialized",
		"getLorebookEntries",
		"replaceLorebookEntries",
		"updateLorebookEntriesWith",
		"setLorebookEntries",
		"createLorebookEntries",
		"createLorebookEntry",
		"deleteLorebookEntries",
		"deleteLorebookEntry",
		"getLorebookSettings",
		"setLorebookSettings",
		"getCharLorebooks",
		"setCurrentCharLorebooks",
		"getLorebooks",
		"deleteLorebook",
		"createLorebook",
		"getCurrentCharPrimaryLorebook",
		"getChatLorebook",
		"setChatLorebook",
		"getOrCreateChatLorebook",
		"isPresetNormalPrompt",
		"isPresetSystemPrompt",
		"isPresetPlaceholderPrompt",
		"default_preset",
		"getPresetNames",
		"getLoadedPresetName",
		"loadPreset",
		"createPreset",
		"createOrReplacePreset",
		"deletePreset",
		"renamePreset",
		"getPreset",
		"replacePreset",
		"updatePresetWith",
		"setPreset",
		"getPersonaNames",
		"getPersonaIds",
		"getCurrentPersonaName",
		"getCurrentPersonaId",
		"getPersonaAvatarPath",
		"createPersona",
		"createOrReplacePersona",
		"deletePersona",
		"getPersona",
		"replacePersona",
		"updatePersonaWith",
		"RawCharacter",
		"getCharData",
		"getCharAvatarPath",
		"getChatHistoryBrief",
		"getChatHistoryDetail",
		"registerMacroLike",
		"unregisterMacroLike",
		"getAllEnabledScriptButtons",
		"getScriptTrees",
		"replaceScriptTrees",
		"updateScriptTreesWith",
		"triggerSlash",
		"triggerSlashWithResult",
		"formatAsTavernRegexedString",
		"isCharacterTavernRegexesEnabled",
		"getTavernRegexes",
		"replaceTavernRegexes",
		"updateTavernRegexesWith",
		"substitudeMacros",
		"getLastMessageId",
		"errorCatched",
		"getMessageId",
		"registerVariableSchema",
		"getVariables",
		"replaceVariables",
		"updateVariablesWith",
		"insertOrAssignVariables",
		"deleteVariable",
		"insertVariables",
		"getTavernHelperVersion",
		"getFrontendVersion",
		"updateTavernHelper",
		"updateFrontendVersion",
		"getTavernVersion",
		"getWorldbookNames",
		"getGlobalWorldbookNames",
		"rebindGlobalWorldbooks",
		"getCharWorldbookNames",
		"rebindCharWorldbooks",
		"getChatWorldbookName",
		"rebindChatWorldbook",
		"getOrCreateChatWorldbook",
		"createWorldbook",
		"createOrReplaceWorldbook",
		"deleteWorldbook",
		"getWorldbook",
		"replaceWorldbook",
		"updateWorldbookWith",
		"createWorldbookEntries",
		"deleteWorldbookEntries",
	];
	for (const key of requiredExports) {
		assert.notEqual(win.TavernHelper[key], undefined, `TavernHelper.${key} should be defined`);
	}

	// 7. Mvu.parseMessage 真实解析 _.set / _.add / _.insert / _.remove 与 JSONPatch
	const parsedMvu = await win.Mvu.parseMessage(
		`<UpdateVariable>\n_.set('状态.地点', '仙界');\n_.add('状态.堕落值', 15);\n</UpdateVariable>`,
		{ stat_data: { 状态: { 地点: "玄天界", 堕落值: 55 } } },
	);
	assert.equal(parsedMvu.stat_data.状态.地点, "仙界");
	assert.equal(parsedMvu.stat_data.状态.堕落值, 70);

	const parsedJsonPatch = await win.Mvu.parseMessage(
		`<JSONPatch>[{"op":"replace","path":"/状态/地点","value":"紫霄宫"},{"op":"delta","path":"/状态/堕落值","value":10}]</JSONPatch>`,
		parsedMvu,
	);
	assert.equal(parsedJsonPatch.stat_data.状态.地点, "紫霄宫");
	assert.equal(parsedJsonPatch.stat_data.状态.堕落值, 80);

	// 8. 多脚本事件监听回调内 getScriptId() 保持注册时的脚本身份（防异步串台）
	const seenSids: string[] = [];
	win.__liyuanCurrentScriptId = "script_alpha";
	win.eventOn("custom_ping", () => seenSids.push(win.getScriptId()));
	win.__liyuanCurrentScriptId = "script_beta";
	win.eventOn("custom_ping", () => seenSids.push(win.getScriptId()));
	win.__liyuanCurrentScriptId = "script_gamma";
	await win.eventEmit("custom_ping");
	assert.deepEqual(seenSids, ["script_alpha", "script_beta"]);
});

test("提示词模板：window.EjsTemplate (evalTemplate / 小写 evaltemplate / prepareContext / getvar / setvar)", async () => {
	const { win } = createIframeSandbox({
		charName: "抓根宝",
		userName: "龙裔",
		mvuStatData: {
			PlayerData: { level: 15, magicka: 220 },
			fame: 45,
		},
	});

	assert.ok(win.EjsTemplate, "window.EjsTemplate 应存在");
	assert.equal(typeof win.EjsTemplate.evalTemplate, "function");
	assert.equal(typeof win.EjsTemplate.evaltemplate, "function", "应兼容《上古卷轴5》小写 evaltemplate 别名");
	assert.equal(typeof win.EjsTemplate.prepareContext, "function");

	// 1. 复现《上古卷轴5·天际模拟器》脚本调用方式：prepareContext + 小写 evaltemplate
	const ctx = await win.EjsTemplate.prepareContext({ bonus: 30 });
	const skillDesc = await win.EjsTemplate.evaltemplate(
		`造成 <%= (getvar('stat_data.PlayerData.level') * 2 + bonus) %> 点火焰伤害（当前名望：<%- getvar('stat_data.fame') > 30 ? '声名鹊起' : '籍籍无名' %>）`,
		ctx,
	);
	assert.equal(skillDesc.trim(), "造成 60 点火焰伤害（当前名望：声名鹊起）");

	// 2. 验证在模板内调用 setvar / incvar 修改变量并同步回 getAllVariables
	const out2 = await win.EjsTemplate.evalTemplate(
		`<%_ incvar('stat_data.PlayerData.magicka', 80); define('fmtName', function(){ return this.userName + '@' + this.charName; }); _%><%= fmtName() %>:<%= getvar('stat_data.PlayerData.magicka') %>`,
	);
	assert.equal(out2, "韩立@苏瑶:300");
	assert.equal(win.getAllVariables().stat_data.PlayerData.magicka, 300);

	// 3. 验证语法检查与 Features 接口
	const errInfo = await win.EjsTemplate.getSyntaxErrorInfo("<% if (unclosed { %>");
	assert.ok(errInfo.length > 0);
	const okInfo = await win.EjsTemplate.getSyntaxErrorInfo("<%= 1 + 1 %>");
	assert.equal(okInfo, "");
	assert.equal(win.EjsTemplate.getFeatures().enabled, true);
});

test("第3步·预设三通道 A/B/C、正则查询、global/preset 变量与 reasoning 管理器完整联调", async () => {
	// 构造轻量级真实感 DOM（验证通道 C 原地复用 <li> 与 classList 翻转）
	class MiniClassList {
		#set = new Set<string>();
		constructor(init = "") {
			init.split(/\s+/).filter(Boolean).forEach((c) => this.#set.add(c));
		}
		contains(c: string) {
			return this.#set.has(c);
		}
		add(...cs: string[]) {
			cs.forEach((c) => this.#set.add(c));
		}
		remove(...cs: string[]) {
			cs.forEach((c) => this.#set.delete(c));
		}
		toString() {
			return [...this.#set].join(" ");
		}
	}
	class MiniElement {
		tagName: string;
		id = "";
		children: MiniElement[] = [];
		attrs = new Map<string, string>();
		listeners = new Map<string, Array<() => void>>();
		textContent = "";
		style = { cssText: "" };
		ownerDocument: MiniDocument;
		#classList = new MiniClassList();
		constructor(tag: string, doc: MiniDocument) {
			this.tagName = tag.toUpperCase();
			this.ownerDocument = doc;
		}
		get className() {
			return this.#classList.toString();
		}
		set className(v: string) {
			this.#classList = new MiniClassList(v);
		}
		get classList() {
			return this.#classList;
		}
		setAttribute(k: string, v: string) {
			this.attrs.set(k, String(v));
			if (k === "id") this.id = String(v);
		}
		getAttribute(k: string) {
			return this.attrs.get(k) ?? null;
		}
		appendChild(ch: MiniElement) {
			const idx = this.children.indexOf(ch);
			if (idx >= 0) this.children.splice(idx, 1);
			this.children.push(ch);
			return ch;
		}
		remove() {
			/* no-op in mini test */
		}
		addEventListener(ev: string, fn: () => void) {
			const list = this.listeners.get(ev) ?? [];
			list.push(fn);
			this.listeners.set(ev, list);
		}
		click() {
			for (const fn of this.listeners.get("click") ?? []) fn();
		}
		querySelector(sel: string): MiniElement | null {
			const match = (el: MiniElement): boolean => {
				if (sel.startsWith("#")) return el.id === sel.slice(1);
				if (sel.startsWith(".")) return el.classList.contains(sel.slice(1));
				if (sel.startsWith("[") && sel.endsWith("]")) return el.attrs.has(sel.slice(1, -1));
				return false;
			};
			for (const ch of this.children) {
				if (match(ch)) return ch;
				const sub = ch.querySelector(sel);
				if (sub) return sub;
			}
			return null;
		}
	}
	class MiniDocument {
		readyState = "complete";
		body: MiniElement;
		constructor() {
			this.body = new MiniElement("body", this);
		}
		createElement(tag: string) {
			return new MiniElement(tag, this);
		}
		getElementById(id: string) {
			return this.body.querySelector(`#${id}`);
		}
		querySelector(sel: string) {
			return this.body.querySelector(sel);
		}
	}

	const miniDoc = new MiniDocument();
	const rpcCalls: Array<{ action: string; params: Record<string, unknown> }> = [];
	const presetRaw = {
		temperature: 0.88,
		prompts: [
			{ identifier: "main", name: "Main", role: "system", content: "主规则", system_prompt: true, marker: false },
			{ identifier: "style1", name: "文风·古韵", role: "system", content: "古风描写", system_prompt: false, marker: false },
			{
				identifier: "deep1",
				name: "深度提醒",
				role: "user",
				content: "保持人称",
				system_prompt: false,
				marker: false,
				injection_position: 1,
				injection_depth: 2,
				injection_order: 333,
			},
			{ identifier: "chatHistory", name: "Chat History", role: "system", system_prompt: true, marker: true },
		],
		prompt_order: [
			{
				character_id: 100001,
				order: [
					{ identifier: "main", enabled: true },
					{ identifier: "style1", enabled: true },
					{ identifier: "deep1", enabled: false },
					{ identifier: "chatHistory", enabled: true },
				],
			},
		],
		extensions: {
			regex_scripts: [
				{
					id: "r1",
					scriptName: "TGbreak V2.1.6 校验",
					findRegex: "/foo/g",
					replaceString: "bar",
					trimStrings: [],
					placement: [2],
					disabled: false,
					markdownOnly: true,
					promptOnly: false,
					runOnEdit: true,
				},
			],
			tavern_helper: {
				scripts: [{ id: "big_ui", content: "x".repeat(20000), enabled: true }],
				variables: { wave_mode: "novel" },
			},
		},
	};

	const parentWin: Record<string, unknown> = {
		document: miniDoc,
		__liyuanRuntimeContext: {
			card: "c.png",
			charName: "云澜",
			userName: "沈舟",
			chatId: "chat-1",
			sessionId: "sess-1",
			mode: "roleplay",
			streaming: false,
			presetName: "TGbreak😺V2.1.6",
			presetNames: ["TGbreak😺V2.1.6", "梦鲸思客V5-1030-exp"],
			presetRaw,
			worldbooks: [],
			displayRules: [],
			scriptVars: {
				global: { sleep_var_zishu_define: "1600字" },
				preset: { preset_flag: "on" },
				chat: {},
			},
			messages: [{ message_id: 0, role: "assistant", name: "云澜", message: "你好", text: "你好" }],
		},
		Liyuan: {
			call: async (action: string, params: Record<string, unknown> = {}) => {
				rpcCalls.push({ action, params });
				return { ok: true, action, result: {} };
			},
		},
		postMessage: () => {},
	};
	parentWin.window = parentWin;
	parentWin.globalThis = parentWin;
	parentWin.addEventListener = () => {};
	parentWin.setTimeout = setTimeout;
	parentWin.clearTimeout = clearTimeout;
	parentWin.console = console;
	parentWin.Date = Date;
	parentWin.Math = Math;
	parentWin.JSON = JSON;
	parentWin.Promise = Promise;
	parentWin.Map = Map;
	parentWin.Set = Set;
	parentWin.Array = Array;
	parentWin.Object = Object;
	parentWin.String = String;
	parentWin.Number = Number;
	parentWin.Boolean = Boolean;
	parentWin.RegExp = RegExp;
	parentWin.Error = Error;
	parentWin.TypeError = TypeError;
	parentWin.parseInt = parseInt;
	parentWin.parseFloat = parseFloat;
	parentWin.isNaN = isNaN;
	parentWin.isFinite = isFinite;
	parentWin.encodeURIComponent = encodeURIComponent;

	// 在父页跑 globals，再在子帧跑 bridge + globals
	vm.createContext(parentWin);
	vm.runInContext(stripScriptTags(IFRAME_TAVERN_GLOBALS_SNIPPET), parentWin);

	const { win } = createIframeSandbox({
		iframeName: "TH-script--preset--orb_v2",
		parentWin,
	});

	// 1. 变量读取：global 与 preset 合并了服务端同步数据与预设自带 variables
	assert.equal(win.getVariables({ type: "global" }).sleep_var_zishu_define, "1600字");
	assert.equal(win.getVariables({ type: "preset" }).wave_mode, "novel");
	assert.equal(win.getVariables({ type: "preset" }).preset_flag, "on");

	// 2. 通道 A：预设名称、toPreset、getTavernRegexes({ type: 'preset' }) 与 reasoning 管理器
	assert.equal(win.getLoadedPresetName(), "TGbreak😺V2.1.6");
	assert.deepEqual([...win.getPresetNames()], ["in_use", "TGbreak😺V2.1.6", "梦鲸思客V5-1030-exp"]);
	const pView = win.getPreset("in_use");
	assert.equal(pView.settings.temperature, 0.88);
	assert.equal(pView.prompts.length, 4);
	assert.deepEqual(JSON.parse(JSON.stringify(pView.prompts.find((p: any) => p.id === "deep1")?.position)), {
		type: "in_chat",
		depth: 2,
		order: 333,
	});
	assert.equal(pView.extensions.regex_scripts[0].script_name, "TGbreak V2.1.6 校验");

	const presetRegexes = win.getTavernRegexes({ type: "preset", name: "in_use" });
	assert.equal(presetRegexes.length, 1);
	assert.equal(presetRegexes[0].script_name, "TGbreak V2.1.6 校验");
	assert.equal(presetRegexes[0].enabled, true);

	const reasoningMgr = win.SillyTavern.getContext().getPresetManager("reasoning");
	assert.equal(reasoningMgr.apiId, "reasoning");
	assert.equal(reasoningMgr.getSelectedPresetName(), "Default");

	// 3. 通道 B：chatCompletionSettings 严格保持同一引用（《我即浪潮》强校验），builtin.promptManager.render 刷新 DOM
	const stCtx1 = win.SillyTavern.getContext();
	const stCtx2 = win.SillyTavern.getContext();
	assert.strictEqual(stCtx1.chatCompletionSettings, stCtx2.chatCompletionSettings);
	assert.equal(typeof win.builtin.promptManager.render, "function");
	assert.equal(typeof (parentWin as any).builtin.promptManager.render, "function");

	// 通道 C：隐藏 #completion_prompt_manager_list 原地存在并可按 li[data-pm-identifier] 操作
	const ul = miniDoc.getElementById("completion_prompt_manager_list")!;
	assert.ok(ul, "父页应挂载隐藏 #completion_prompt_manager_list");
	const liStyle1 = ul.children.find((el) => el.getAttribute("data-pm-identifier") === "style1")!;
	const liDeep1 = ul.children.find((el) => el.getAttribute("data-pm-identifier") === "deep1")!;
	assert.ok(liStyle1 && !liStyle1.classList.contains("completion_prompt_manager_prompt_disabled"));
	assert.ok(liDeep1 && liDeep1.classList.contains("completion_prompt_manager_prompt_disabled"));
	assert.equal(liStyle1.querySelector(".prompt-manager-name")?.getAttribute("data-pm-name"), "文风·古韵");

	// 点击 .prompt-manager-toggle-action 应原地翻转 class 并保持同一 <li> 实例（触发 MutationObserver）
	liStyle1.querySelector(".prompt-manager-toggle-action")!.click();
	assert.ok(liStyle1.classList.contains("completion_prompt_manager_prompt_disabled"), "点击切换后应加上 disabled 类");
	assert.strictEqual(
		ul.children.find((el) => el.getAttribute("data-pm-identifier") === "style1"),
		liStyle1,
		"必须原地复用 li 节点，不能整棵销毁重绘",
	);
	assert.equal(win.getPreset("in_use").prompts.find((p: any) => p.id === "style1")?.enabled, false);

	// 等待通道 C 防抖写回落到 Liyuan.preset.update，且不包含未变动的 20KB tavern_helper.scripts
	await new Promise((r) => setTimeout(r, 120));
	const updateCall = rpcCalls.find((c) => c.action === "preset.update");
	assert.ok(updateCall, "通道 C 开关点击应触发 Liyuan.preset.update");
	const patch = updateCall!.params.patch as Record<string, any>;
	assert.ok(Array.isArray(patch.order));
	assert.equal(patch.order.find((o: any) => o.identifier === "style1")?.enabled, false);
	assert.ok(!JSON.stringify(patch).includes("xxxxxxxx"), "增量补丁不得重复序列化未变的 tavern_helper.scripts");

	// 4. 通道 A：updatePresetWith 写回并刷新隐藏 DOM
	rpcCalls.length = 0;
	await win.updatePresetWith("in_use", (p: any) => {
		const target = p.prompts.find((x: any) => x.id === "deep1");
		target.enabled = true;
		return p;
	});
	assert.ok(!liDeep1.classList.contains("completion_prompt_manager_prompt_disabled"), "通道 A 更新应同步移除隐藏 DOM 的 disabled 类");
	assert.ok(rpcCalls.some((c) => c.action === "preset.update"));

	// 5. 通道 B：原地改 chatCompletionSettings + saveSettingsDebounced
	rpcCalls.length = 0;
	stCtx1.chatCompletionSettings.prompts[1].content = "现代白描";
	stCtx1.saveSettingsDebounced();
	await new Promise((r) => setTimeout(r, 120));
	const bCall = rpcCalls.find((c) => c.action === "preset.update");
	assert.ok(bCall, "saveSettingsDebounced 应落盘变更的 prompts 内容");
	assert.equal((bCall!.params.patch as any).prompts?.[0]?.content, "现代白描");
});



