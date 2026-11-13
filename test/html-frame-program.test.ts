import assert from "node:assert/strict";
import test from "node:test";
import { buildSrcDoc, looksLikeProgramApp, programViewportHeight, resolveViewportUnits } from "../web/src/frameDoc.ts";
import { IFRAME_TAVERN_GLOBALS_SNIPPET } from "../web/src/tavernShim.ts";

test("programViewportHeight: 约 78vh 且有上下限", () => {
	assert.equal(programViewportHeight({ innerHeight: 1000 }), 780);
	assert.ok(programViewportHeight({ innerHeight: 400 }) >= 480);
	assert.ok(programViewportHeight({ innerHeight: 4000 }) <= 2400);
});

/** 开局创建器形态：根级接管 CSS + 100vh 容器 + fixed 星空层 */
const takeoverDoc =
	"<!doctype html><html><head><style>html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }" +
	"#main { width: 100%; height: 100vh; position: relative; }" +
	"#stars { position: fixed; inset: 0; }</style></head>" +
	"<body><div id=main><div id=stars></div></div><script>1</script></body></html>";

/** 另一种「开局创造角色」形态：根级接管 CSS 但全程无 position:fixed */
const takeoverNoFixed =
	"<!doctype html><html><head><style>html, body{height:100%;overflow:hidden}" +
	".stage{height:100vh}</style></head><body><div class=stage></div><script>1</script></body></html>";

/** MVU/XML 状态栏形态：大体积整页 + fixed 弹窗，但零 vh、根级无接管 CSS → 内容流 */
const statusBigDoc =
	"<!doctype html><html><head><style>.modal{position:fixed;inset:0;display:none}.card{width:100%}</style></head>" +
	"<body><div class=card>状态</div><script>" +
	"x".repeat(180_000) +
	"</script></body></html>";

test("looksLikeProgramApp: 视口接管 CSS / fixed+vh 才算；体积不作数", () => {
	assert.equal(looksLikeProgramApp("<div>hi</div>", true), false);
	// 旧「≥25KB 即程序卡」规则的回归钉：大体积裸文本/大状态栏不得锁 78vh（MVU 状态栏事故）
	assert.equal(looksLikeProgramApp("x".repeat(25_000), true), false);
	assert.equal(looksLikeProgramApp(statusBigDoc, true), false);
	assert.equal(looksLikeProgramApp(takeoverDoc, false), false, "scripts=false 一律非程序卡");
	// 短 doctype+script（状态栏）不得锁 78vh
	assert.equal(
		looksLikeProgramApp("<!doctype html><html><body><script>1</script></body></html>", true),
		false,
	);
	// 根级接管 CSS：有无 fixed 都认（实卡的两个开局创建器）
	assert.equal(looksLikeProgramApp(takeoverDoc, true), true);
	assert.equal(looksLikeProgramApp(takeoverNoFixed, true), true);
	// fixed 铺满 + 视口单位（body 内联样式，无根级 CSS 块）
	assert.equal(
		looksLikeProgramApp(
			"<!doctype html><html><body style='position:fixed;inset:0;height:100vh'><script>1</script></body></html>",
			true,
		),
		true,
	);
	// min-height:100vh 是「至少一屏」的内容流写法，不算接管
	assert.equal(
		looksLikeProgramApp(
			"<!doctype html><html><head><style>body{min-height:100%;overflow:hidden}</style></head><body><script>1</script></body></html>",
			true,
		),
		false,
	);
	// 实卡量级状态栏（约 11KB + script）不应当 program
	const statusLike =
		"<!doctype html><html><head></head><body><div class='card'>状态</div><script>" +
		"x".repeat(10_000) +
		"</script></body></html>";
	assert.equal(looksLikeProgramApp(statusLike, true), false);

	// 回归：状态栏内部带隐藏弹窗（.dy-overlay { position: fixed; inset: 0; height: var(--h, 100dvh); }）
	// 绝不能被误判为全屏接管程序卡而锁死 78vh
	const statusWithFixedVhModal =
		"<!doctype html><html><head><style>" +
		"body { margin: 0; padding: 10px 0; background-color: transparent; }" +
		".dy-missing-portrait-overlay { position: fixed; inset: 0; width: var(--w, 100vw); height: var(--h, 100dvh); }" +
		"</style></head><body><div class='card'>状态栏</div><script>1</script></body></html>";
	assert.equal(looksLikeProgramApp(statusWithFixedVhModal, true), false, "含 fixed+100dvh 弹窗的状态栏不得误判为 programApp");
});

test("HEIGHT_REPORTER_SNIPPET: 跳过 position:fixed 与 display:none 子节点，并注入 --TH-viewport-height（防全屏烟花 canvas 叠加 paddingBottom 无限拉长）", () => {
	const fireworkGreeting =
		"<html><head><style>" +
		"body { padding: 20px; min-height: 100vh; overflow: hidden; }" +
		"#fireworks-canvas { position: fixed; top: 0; left: 0; width: 100%; height: 100%; }" +
		"</style></head><body>" +
		"<canvas id='fireworks-canvas'></canvas>" +
		"<div class='info-card'>欢迎</div>" +
		"<script>1</script></body></html>";
	assert.equal(looksLikeProgramApp(fireworkGreeting, true), false);
	const doc = buildSrcDoc(fireworkGreeting, true, true);
	assert.ok(doc.includes("--TH-viewport-height"), "应注入酒馆助手 --TH-viewport-height 视口高度变量");
	assert.ok(doc.includes('cs.position==="fixed"'), "高度上报器应排除 position:fixed 子元素");
	assert.ok(doc.includes('cs.display==="none"'), "高度上报器应排除 display:none 子元素");
});

test("buildSrcDoc 接管型:不注入 height:auto 覆盖、不注入高度上报（接管型帧抖动/塌陷根修）", () => {
	const doc = buildSrcDoc(takeoverDoc, true, true);
	assert.ok(!doc.includes("height:auto!important"), "不得打断卡自己的 height:100% 链");
	assert.ok(!doc.includes("overflow:visible!important"), "不得掀开卡自己的 overflow:hidden");
	assert.ok(!doc.includes("liyuanFrameHeight"), "视口锁高，不上报内容高（防乒乓抖动）");
	assert.ok(doc.includes("background:transparent"), "透明兜底仍在");
	assert.ok(doc.includes("TavernHelper"), "垫片桥仍在");
});

test("buildSrcDoc 内容流大文档:保留 height:auto 覆盖与高度上报（MVU 状态栏）", () => {
	const doc = buildSrcDoc(statusBigDoc, true, true);
	assert.ok(doc.includes("height:auto!important"));
	assert.ok(doc.includes("liyuanFrameHeight"));
});

test("resolveViewportUnits: 样式里的 vh 折成真视口 px，正文文字不动", () => {
	// 折算：这是对作者本意的忠实翻译——酒馆里 vh 就是浏览器视口
	assert.equal(resolveViewportUnits("<style>.p{max-height:76vh}</style>", 1000), "<style>.p{max-height:760px}</style>");
	assert.equal(resolveViewportUnits("<style>.p{height:100dvh}</style>", 850), "<style>.p{height:850px}</style>");
	assert.equal(resolveViewportUnits('<div style="max-height:50vh">x</div>', 800), '<div style="max-height:400px">x</div>');
	// 正文里出现「76vh」这种字样不受影响（只在 <style> 与 style= 里替换）
	assert.equal(resolveViewportUnits("<p>写 76vh 就会被裁</p>", 1000), "<p>写 76vh 就会被裁</p>");
	// vw 不是高度单位，不碰
	assert.equal(resolveViewportUnits("<style>.h{font-size:clamp(28px,6.5vw,44px)}</style>", 1000), "<style>.h{font-size:clamp(28px,6.5vw,44px)}</style>");
	// 没有视口尺寸时原样返回（node 侧单测/SSR）
	assert.equal(resolveViewportUnits("<style>.p{max-height:76vh}</style>", 0), "<style>.p{max-height:76vh}</style>");
});

test("buildSrcDoc: 静态无痕帧折 vh；脚本帧不折（走上报器/锁视口）", () => {
	const doc = "<html><head><style>.p{max-height:76vh}</style></head><body><div>x</div></body></html>";
	assert.ok(buildSrcDoc(doc, false, true, 1000).includes("max-height:760px"), "静态无痕帧：折算");
	assert.ok(buildSrcDoc(doc, true, true, 1000).includes("max-height:76vh"), "脚本帧：不折");
	assert.ok(buildSrcDoc(doc, false, true).includes("max-height:76vh"), "未给视口尺寸：不折");
});

/**
 * 8/25 第五处判据（<head> 起头的状态栏界面）：省掉 `<html>` 外壳、根标签 `<head>` 的整份文档
 * 曾被当成正文片段，灌进片段 CSS 的 `white-space:pre-wrap` —— 作者源码的缩进换行
 * 全变可见空白，真 iframe 实测容器 455px 被撑到 1706px（头部与页签间整屏死白）。
 */
test("buildSrcDoc: <head>/<body> 起头的整份文档按文档灌 CSS，不得吃片段的 pre-wrap", () => {
	const headRooted = "<head><style>.box{padding:10px}</style></head><body><div class='box'>甲</div></body>";
	const headDoc = buildSrcDoc(headRooted, true, true);
	assert.ok(!headDoc.includes("white-space:pre-wrap"), "整份文档绝不能吃片段 CSS 的 pre-wrap");
	assert.ok(headDoc.includes("height:auto!important"), "走整页内容流分支");

	// 只写 <body> 的、以及 doctype 的，同样落在文档一侧
	assert.ok(!buildSrcDoc("<body><div>乙</div></body>", true, true).includes("white-space:pre-wrap"));
	assert.ok(!buildSrcDoc("<!doctype html><html><body>丙</body></html>", true, true).includes("white-space:pre-wrap"));

	// 反向：状态栏那类**片段**（div 起头）仍须保住「一行一项」的 pre-wrap
	const fragment = "<div class='sb'>血量 80\n体力 60</div>";
	assert.ok(buildSrcDoc(fragment, false, true).includes("white-space:pre-wrap"), "片段语义不能被这次放宽带走");
});

/**
 * 酒馆 public/style.css:135 全局 `* { box-sizing: border-box }`。
 * 作者照酒馆写 `width:100%` + padding + border，content-box 下会溢出容器
 * （实测 1280 视口 → 内容宽 1316px，横向滚动条 + 右侧被切）。
 */
test("buildSrcDoc: 补齐酒馆的 border-box 基底（作者写作时的宿主前提）", () => {
	for (const [label, html, scripts] of [
		["整页文档", "<head><style>.c{width:100%;padding:15px}</style></head><body><div class='c'>甲</div></body>", true],
		["片段", "<div style='width:100%;padding:15px'>乙</div>", false],
	] as const) {
		const doc = buildSrcDoc(html, scripts, true);
		assert.ok(/\*\{box-sizing:border-box\}/.test(doc), `${label}：须带 border-box 基底`);
	}
	// 接管型样式主权完全归卡，基底只给透明兜底——不在此列
	assert.ok(!/\*\{box-sizing:border-box\}/.test(buildSrcDoc(takeoverDoc, true, true)), "接管型不插手样式主权");
});

test("脚本注入不腐蚀 $ 序列：head 里的垫片(含 minified jQuery 的 $1/$&)按字面写入", () => {
	// 回归 8/27 某卡 7 页签状态栏：buildSrcDoc 曾用 `.replace(re, "<head$1>"+head)` 注入，
	// head 里 minified jQuery 的 `t.replace(rtrimCSS,"$1")` 被 String.replace 当替换模式
	// 解释成 `t.replace(rtrimCSS,"")`，破坏带尾随空白选择器的解析 → jQuery 事件委托
	// （.on(evt, sel, fn)）全废、卡的页签点不动。判据＝注入的垫片必须逐字出现在产物里。
	// 前提：垫片里确实含 String.replace 会特殊解释的 $ 序列（否则本测试形同虚设）
	assert.ok(/\$(\d|&|`|')/.test(IFRAME_TAVERN_GLOBALS_SNIPPET), "垫片应含 $ 序列，否则回归测试无意义");
	for (const [label, html] of [
		["<head> 开头", "<head><style>.x{color:red}</style></head><body><div>甲</div></body>"],
		["<html> 开头（无 head）", "<html><body><div>乙</div></body></html>"],
	] as const) {
		const doc = buildSrcDoc(html, true, true);
		assert.ok(
			doc.includes(IFRAME_TAVERN_GLOBALS_SNIPPET),
			`${label}：注入的垫片被腐蚀（$ 序列被 String.replace 当替换模式解释）`,
		);
	}
});
