import assert from "node:assert/strict";
import test from "node:test";
import { toWireMsg } from "../server/wire.ts";
import { buildSrcDoc, escapeScriptEndTags, HEIGHT_REPORTER_SNIPPET } from "../web/src/frameDoc.ts";
import { looksLikeHtmlDocument, splitHtmlParts } from "../web/src/htmlEmbed.ts";

const names = { charName: "角色", userName: "用户" };

test("show_html toolResult -> html channel", () => {
	const w = toWireMsg(
		{
			role: "toolResult",
			toolName: "show_html",
			content: [{ type: "text", text: "ok" }],
			details: {
				rpHtml: {
					html: '<div class="phone">hi</div>',
					title: "微信",
					scripts: true,
				},
			},
		},
		names,
	);
	assert.ok(w);
	assert.equal(w!.channel, "html");
	assert.equal(w!.html, '<div class="phone">hi</div>');
	assert.equal(w!.text, "微信");
	assert.equal(w!.scripts, true);
});

test("show_html error / empty skip", () => {
	assert.equal(
		toWireMsg(
			{ role: "toolResult", toolName: "show_html", isError: true, details: { rpHtml: { html: "x" } } },
			names,
		),
		null,
	);
	assert.equal(
		toWireMsg({ role: "toolResult", toolName: "show_html", details: { rpHtml: { html: "  " } } }, names),
		null,
	);
});

test("fenced html splits", () => {
	const parts = splitHtmlParts("旁白\n```html\n<div>短信</div>\n```\n继续");
	assert.equal(parts.filter((p) => p.kind === "html").length, 1);
	const h = parts.find((p) => p.kind === "html");
	assert.ok(h && h.kind === "html" && h.html.includes("短信"));
});

test("scripts fence", () => {
	const parts = splitHtmlParts("```html scripts\n<button id=b>x</button>\n```");
	assert.equal(parts[0].kind, "html");
	if (parts[0].kind === "html") assert.equal(parts[0].scripts, true);
});

test("full document", () => {
	assert.equal(looksLikeHtmlDocument("<!DOCTYPE html><html></html>"), true);
	const parts = splitHtmlParts("<!DOCTYPE html><html><body>开场</body></html>");
	assert.equal(parts.length, 1);
	assert.equal(parts[0].kind, "html");
});

test("buildSrcDoc seamless 片段:不强制字体,保留换行(状态栏 div)", () => {
	const doc = buildSrcDoc("<div>x</div>", false, true);
	assert.ok(!doc.includes("PingFang"));
	assert.ok(doc.includes("background:transparent"));
	// 皮肤 StatusBlock 等多行纯文本进 div 后,必须 pre-wrap 才与酒馆一致
	assert.ok(doc.includes("white-space:pre-wrap"), "片段 seamless 必须保留换行");
	assert.ok(!doc.includes("liyuanFrameHeight"), "静态 seamless 不靠 postMessage 报高");
});

test("buildSrcDoc seamless 整页文档:不得 pre-wrap(避免毁掉卡布局)", () => {
	const doc = buildSrcDoc("<!doctype html><html><head></head><body><div>app</div></body></html>", true, true);
	assert.ok(doc.includes("background:transparent"));
	assert.ok(!doc.includes("white-space:pre-wrap"), "整页文档不能强塞 pre-wrap");
	assert.ok(doc.includes("liyuanFrameHeight"));
});

test("buildSrcDoc seamless 脚本帧:注入高度上报(内容盒量高,非 documentElement 100vh)", () => {
	const doc = buildSrcDoc("<div>x</div>", true, true);
	assert.ok(doc.includes("liyuanFrameHeight"));
	assert.ok(doc.includes("ResizeObserver"));
	assert.ok(doc.includes("contentH") || doc.includes("getBoundingClientRect"), "须按子节点量高");
	// 整页 seamless 须打断 100vh 反馈
	const full = buildSrcDoc("<!doctype html><html><body><div id=app>x</div></body></html>", true, true);
	assert.ok(full.includes("min-height:0") || full.includes("min-height:0!important"));
});

test("buildSrcDoc 非 seamless:行为与旧版一致(仍带基础字体)", () => {
	const doc = buildSrcDoc("<div>x</div>", false, false);
	assert.ok(doc.includes("PingFang"));
});

test("HEIGHT_REPORTER_SNIPPET 是自包含 script", () => {
	assert.ok(HEIGHT_REPORTER_SNIPPET.startsWith("<script>"));
	assert.ok(HEIGHT_REPORTER_SNIPPET.endsWith("</script>"));
});

test("脚本帧 srcdoc:CSP 含 script-src + 注入 TavernHelper 垫片桥", () => {
	const scriptDoc = buildSrcDoc("<div>x</div>", true, true);
	const staticSeamless = buildSrcDoc("<div>x</div>", false, true);
	assert.ok(scriptDoc.includes("script-src"));
	assert.ok(scriptDoc.includes("TavernHelper"), "须注入助手垫片桥");
	assert.ok(scriptDoc.includes("eventOn"), "须注入 eventOn");
	assert.ok(!staticSeamless.includes("script-src"));
	// 静态 seamless 不注入脚本
	assert.ok(!staticSeamless.includes("<script>"));
});

test("escapeScriptEndTags: 不得毁掉真实 </script> 闭合标签", () => {
	const html = "<script>const x = 1</script><div>ok</div>";
	const out = escapeScriptEndTags(html);
	assert.ok(out.includes("</script>"), "真实闭合标签必须保留");
	const doc = buildSrcDoc(html, true, true);
	const opens = (doc.match(/<script\b/gi) || []).length;
	const closes = (doc.match(/<\/script>/gi) || []).length;
	assert.ok(closes >= 2, "桥+用户脚本都要有未转义闭合");
	assert.ok(opens >= closes - 1, "open/close 大致配平");
});

test("escapeScriptEndTags: 模板字符串内 </script> 须转义，防主脚本截断", () => {
	const html =
		"<script>const page = `<html><body><script>x</script></body></html>`;\nconst ok = 1;</script>";
	const out = escapeScriptEndTags(html);
	assert.ok(out.includes("<\\/script>"), "正文内须写成 <\\/script>");
	assert.ok(out.includes("ok = 1;</script>") || /ok = 1;\s*<\/script>/.test(out));
	const doc = buildSrcDoc(html, true, true);
	assert.ok(doc.includes("ok = 1"), "截断后会丢掉后半段");
});

test("buildSrcDoc: 高度垫片插在最后一个 </body>，不进脚本模板", () => {
	const html = `<!doctype html><html><head></head><body>
<script>const t = \`<body>\${x}</body></html>\`;</script>
<div id="app">ok</div>
</body></html>`;
	const doc = buildSrcDoc(html, true, true);
	const appIdx = doc.indexOf('id="app"');
	const reporterIdx = doc.indexOf("liyuanFrameHeight");
	assert.ok(appIdx > 0 && reporterIdx > appIdx, "量高脚本须在真 body 内容之后");
	const tpl = doc.indexOf("const t");
	const tplEnd = doc.indexOf("</script>", tpl);
	const mid = doc.slice(tpl, tplEnd);
	assert.ok(!mid.includes("liyuanFrameHeight"), "不得插入脚本模板内部");
});

test("escapeScriptEndTags: 脚本含正则字面量 /'/g 时不得吞掉真实 </script> 导致后续 <script> 报 SyntaxError", () => {
	const html = `<!doctype html><html><body>
<script>
const safeName = newName.replace(/'/g, "\\\\'");
const cmd = \`_.assign('角色', '\${safeName}')\`;
</script>
<script>
loadBasicInfo();
</script>
</body></html>`;
	const out = escapeScriptEndTags(html);
	assert.equal((out.match(/<\/script>/gi) || []).length, 2, "两个真实 </script> 闭合标签都必须保留，不得被转义为 <\\/script>");
	assert.ok(!out.includes("<\\/script>"));
});


