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
	SCRIPT_HOST_SANDBOX,
	buildScriptHostDoc,
} from "../web/src/scriptHostDoc.ts";
import { IFRAME_TAVERN_GLOBALS_SNIPPET } from "../web/src/tavernShim.ts";

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
