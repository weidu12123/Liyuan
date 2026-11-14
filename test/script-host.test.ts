/**
 * 页面级脚本宿主文档（scriptHostDoc）与作用域变量垫片。
 *
 * 这一层的价值不在「拼出的字符串长什么样」，而在几条**不能退的约束**：
 * 垫片必须先于加载器（作者第一行就裸用 $/errorCatched）、作者代码不许拼进 HTML
 * （字面量 `</script>` 会截断）、CSP 与消息级脚本帧同一份、sandbox 必须含 same-origin
 * （否则 parent.document 抛错、球挂进 0×0 隐藏帧＝用户什么也看不见）。
 *
 * 真浏览器行为（球挂到父页、拖动、台账回收）不在这里断言——那要真 DOM，
 * 靠 `_probe-orb-live.mjs` + playwright 实证（本轮四个真实悬浮球逐个过）。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SCRIPT_FRAME_CSP } from "../web/src/frameDoc.ts";
import {
	AUTHOR_SCRIPTS_GLOBAL,
	PRESET_FRAME_SOURCE_URL_MARKER,
	SCRIPT_HOST_SANDBOX,
	buildScriptHostDoc,
	isBlockedExternalScriptNode,
	isCallFromPresetFrameStack,
	scriptFrameMeta,
} from "../web/src/scriptHostDoc.ts";
import { IFRAME_TAVERN_BRIDGE_SNIPPET, IFRAME_TAVERN_GLOBALS_SNIPPET } from "../web/src/tavernShim.ts";

test("宿主文档：垫片在加载器之前（作者第一行就裸用 $ / errorCatched）", () => {
	const doc = buildScriptHostDoc();
	const shimAt = doc.indexOf("errorCatched");
	const loaderAt = doc.indexOf(AUTHOR_SCRIPTS_GLOBAL);
	assert.ok(shimAt > 0, "垫片应在文档里");
	assert.ok(loaderAt > 0, "加载器应在文档里");
	assert.ok(shimAt < loaderAt, "垫片必须先于加载器");
});

test("宿主文档：作者代码不拼进 HTML，只留同源读取入口", () => {
	const doc = buildScriptHostDoc();
	// 加载器靠 parent 上的全局取清单，再用 textContent 建 script —— 不经 HTML 解析
	assert.ok(doc.includes(AUTHOR_SCRIPTS_GLOBAL));
	assert.ok(doc.includes("textContent"));
	assert.ok(doc.includes("createElement"));
});

test("宿主文档：CSP 与消息级脚本帧同一份（放开一处忘另一处的老病）", () => {
	assert.ok(buildScriptHostDoc().includes(SCRIPT_FRAME_CSP));
});

test("宿主文档：自身不显示内容（透明、不滚）", () => {
	const doc = buildScriptHostDoc();
	assert.ok(/background:transparent/.test(doc));
	assert.ok(/overflow:hidden/.test(doc));
});

test("宿主 sandbox 必须含 same-origin —— 否则 parent.document 抛错、球挂进隐藏帧", () => {
	assert.ok(SCRIPT_HOST_SANDBOX.includes("allow-scripts"));
	assert.ok(SCRIPT_HOST_SANDBOX.includes("allow-same-origin"));
});

test("宿主文档幂等：同一函数两次调用逐字相同（帧只因清单变化而重启）", () => {
	assert.equal(buildScriptHostDoc(), buildScriptHostDoc());
});

// ---- 作用域变量：红线在垫片源码里就该看得见 ----

test("垫片支持全作用域变量读写（chat/message/script/character/preset/global/extension）并同步 Liyuan.data.write", () => {
	const s = IFRAME_TAVERN_GLOBALS_SNIPPET;
	assert.ok(s.includes("insertOrAssignVariables"));
	assert.ok(s.includes("replaceVariables"));
	assert.ok(s.includes("updateVariablesWith"));
	assert.ok(s.includes("insertVariables"));
	assert.ok(s.includes("deleteVariable"));
	assert.ok(s.includes("registerVariableSchema"));
	assert.ok(s.includes("liyuan.authorVars."));
	assert.ok(s.includes('g.Liyuan.call("data.write"'));
	assert.ok(s.includes('g.Liyuan.call("state.commit"'));
});

test("垫片补上 toastr（作者唯一反馈渠道；缺它是 ReferenceError）", () => {
	const s = IFRAME_TAVERN_GLOBALS_SNIPPET;
	assert.ok(s.includes("g.toastr="));
	assert.ok(s.includes("__liyuanToast"));
});

test("getVariables 按作用域分流：global/script 走自留地，其余仍读账本树", () => {
	const s = IFRAME_TAVERN_GLOBALS_SNIPPET;
	const at = s.indexOf("g.getVariables=function");
	assert.ok(at > 0);
	const body = s.slice(at, at + 300);
	assert.ok(body.includes("__liyuanAuthorVarsRead"));
	assert.ok(body.includes("getAllVariables"));
});

test("刀4 · 多帧独立宿主命名、单帧精准隔离执行与父页外链 <script src> 拦截判据", () => {
	const metaPreset = scriptFrameMeta({ id: "p1", source: "preset", content: "console.log(1);" });
	const metaCard = scriptFrameMeta({ id: "c1", source: "card", content: "console.log(2);" });
	assert.equal(metaPreset.frameId, "TH-script--preset--p1");
	assert.equal(metaCard.frameId, "TH-script--card--c1");
	assert.notEqual(metaPreset.reactKey, metaCard.reactKey);

	// 外链脚本拦阻判据（SPreset 类第三方注入拦截）
	assert.equal(
		isBlockedExternalScriptNode({ tagName: "SCRIPT", getAttribute: (k: string) => (k === "src" ? "https://jnai2d9kgnbs6xzx5c.com/regex_bind/inject.js" : null) }, "http://127.0.0.1:7620"),
		true,
	);
	assert.equal(
		isBlockedExternalScriptNode({ tagName: "SCRIPT", src: "//cdn.example.com/x.js" }, "http://127.0.0.1:7620"),
		true,
	);
	assert.equal(
		isBlockedExternalScriptNode({ tagName: "SCRIPT", src: "http://127.0.0.1:7620/assets/app.js" }, "http://127.0.0.1:7620"),
		false,
	);
	assert.equal(
		isBlockedExternalScriptNode({ tagName: "SCRIPT", src: "blob:http://127.0.0.1:7620/uuid" }, "http://127.0.0.1:7620"),
		false,
	);
	assert.equal(
		isBlockedExternalScriptNode({ tagName: "DIV", src: "https://example.com" }, "http://127.0.0.1:7620"),
		false,
	);

	// 模拟两帧同源运行：各自读取 parent.__liyuanAuthorScripts，帧 p1 只执行 p1、帧 c1 只执行 c1，异步 getScriptId() 不串台
	const docHtml = buildScriptHostDoc();
	const lastScriptStart = docHtml.lastIndexOf("<script>");
	const lastScriptEnd = docHtml.lastIndexOf("</script>");
	const loaderCode = docHtml.slice(lastScriptStart + 8, lastScriptEnd);

	const sharedScripts = [
		{ id: "p1", source: "preset", name: "预设脚本", content: "setTimeout(() => { window.__asyncSid = getScriptId(); }, 5);" },
		{ id: "c1", source: "card", name: "卡脚本", content: "setTimeout(() => { window.__asyncSid = getScriptId(); }, 5);" },
	];

	const runFrame = async (frameKey: string, frameId: string) => {
		const insertedScripts: Array<{ sid: string | null; text: string }> = [];
		const fakeBody = {
			appendChild: (el: { getAttribute: (k: string) => string | null; textContent: string }) => {
				insertedScripts.push({ sid: el.getAttribute("data-liyuan-author-script"), text: el.textContent });
			},
		};
		const fakeDoc = {
			createElement: () => {
				const attrs: Record<string, string> = {};
				return {
					type: "",
					textContent: "",
					setAttribute: (k: string, v: string) => {
						attrs[k] = v;
					},
					getAttribute: (k: string) => attrs[k] ?? null,
				};
			},
			body: fakeBody,
		};
		const parentWin = {
			[AUTHOR_SCRIPTS_GLOBAL]: sharedScripts,
			postMessage: () => {},
		};
		const fakeWin: Record<string, unknown> = {
			name: frameId,
			frameElement: {
				id: frameId,
				getAttribute: (k: string) => (k === "data-liyuan-script-key" ? frameKey : null),
			},
			document: fakeDoc,
			setTimeout,
		};
		fakeWin.parent = parentWin;
		fakeWin.window = fakeWin;
		new Function("window", "document", "setTimeout", `${IFRAME_TAVERN_BRIDGE_SNIPPET.replace(/^<script>|<\/script>$/g, "")}\n${IFRAME_TAVERN_GLOBALS_SNIPPET.replace(/^<script>|<\/script>$/g, "")}\n${loaderCode}`)(fakeWin, fakeDoc, setTimeout);
		return { insertedScripts, fakeWin };
	};

	const r1 = runFrame("preset:p1", "TH-script--preset--p1");
	const r2 = runFrame("card:c1", "TH-script--card--c1");
	return Promise.all([r1, r2]).then(([f1, f2]) => {
		assert.deepEqual(f1.insertedScripts.map((x) => x.sid), ["p1"], "帧 p1 只注入自身脚本 p1");
		assert.deepEqual(f2.insertedScripts.map((x) => x.sid), ["c1"], "帧 c1 只注入自身脚本 c1");
		assert.equal(f1.fakeWin.__liyuanCurrentScriptId, "p1");
		assert.equal(f2.fakeWin.__liyuanCurrentScriptId, "c1");
	});
});

test("禁用第5块DOM守卫：预设帧注入带 sourceURL 标记，且栈帧识别不误伤卡帧或父页", () => {
	const docHtml = buildScriptHostDoc();
	assert.ok(docHtml.includes(PRESET_FRAME_SOURCE_URL_MARKER));

	const presetStack = `Error\n    at mount (<anonymous>:613:76)\n    at ${PRESET_FRAME_SOURCE_URL_MARKER}/p1.mjs:675:3`;
	const cardStack = "Error\n    at mountCardHud (about:srcdoc:44:9)";
	const appStack = "Error\n    at render (http://127.0.0.1:7620/assets/index.js:100:3)";

	assert.equal(isCallFromPresetFrameStack(presetStack), true);
	assert.equal(isCallFromPresetFrameStack(cardStack), false);
	assert.equal(isCallFromPresetFrameStack(appStack), false);
	assert.equal(isCallFromPresetFrameStack(undefined), false);
});
