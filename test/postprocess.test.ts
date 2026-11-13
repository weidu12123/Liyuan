import assert from "node:assert/strict";
import { test } from "node:test";

import {
	addFoldTags,
	addHistoryStripTags,
	classifyTag,
	cleanAssistantText,
	discoverFoldTagsFromTexts,
	displayAssistantText,
	extractHistoryStripTagsFromRegexScripts,
	extractScaffoldThinking,
	isHtmlDisplayPayload,
	prepareDisplayText,
	resetDisplayTagExtras,
} from "../src/postprocess.ts";
import { applySkinKeepingBody } from "../src/cardSkin.ts";
import { prepareScribeAssistantText } from "../src/stage/engine.ts";
import { splitRichContentParts } from "../web/src/richContentParts.ts";

test("结构块：分析 fold 删除，状态/plot unwrap 留正文（状态栏渲染归作者正则，非名单）", () => {
	const raw = `<descriptive_analysis>
1. 意图分析…
2. 好感8（陌路之人阶段）
</descriptive_analysis>

<normal_status>
\`\`\`yaml
『时间』: 次日清晨
\`\`\`
</normal_status>

<plot>

*她咬了一口葱油饼，动作微微一顿。*

「短剑在你自己的行囊里。」

</plot>`;
	const out = cleanAssistantText(raw);
	assert.ok(!out.includes("descriptive_analysis"), "分析块 fold：整块删");
	assert.ok(!out.includes("意图分析"));
	// normal_status 不再是 panel：标签 unwrap 剥掉，内容按正文留（送模历史里作者的
	// promptOnly 正则本会剥它——但那条通道尚未接，此处内容留在历史是已知遗留）
	assert.ok(!out.includes("<normal_status>"), "状态标签本身剥掉");
	assert.ok(!out.includes("<plot>"), "plot 标签剥掉");
	assert.ok(out.includes("*她咬了一口葱油饼"), "plot 内容保留");
	assert.ok(out.includes("「短剑在你自己的行囊里。」"));
});

test("悬挂开标签剥到末尾；无结构块的文本只做空白收敛", () => {
	assert.equal(cleanAssistantText("*正文。*\n<thinking>被截断的思考"), "*正文。*");
	assert.equal(cleanAssistantText("行尾空白   \n\n\n\n下一段。"), "行尾空白\n\n下一段。");
});

test("displayAssistantText：假思维链隐去，状态栏标签 unwrap 留内容，未知标签 unwrap", () => {
	const raw = `<draft_notes>
本轮分析：用户要润墨
</draft_notes>

### 正文

<content>
<!-- Prism: 第一人称视角 -->
文舒婉听话了。

<!-- Prism: 感官 -->
她拿起墨条。
</content>

<StatusBlock>
地点:御书房
姓名:文舒婉
</StatusBlock>`;
	const out = displayAssistantText(raw);
	assert.ok(!out.includes("draft_notes"), "草稿块应隐去");
	assert.ok(!out.includes("本轮分析"), "草稿内容应隐去");
	assert.ok(!out.includes("<content>"), "content 标签应拆掉");
	assert.ok(!out.includes("</content>"));
	assert.ok(!out.includes("Prism"), "HTML 注释应隐去");
	assert.ok(!out.includes("### 正文"), "分隔标题应隐去");
	// StatusBlock 不再是 panel：标签剥掉、内容留正文（作者写了正则才会渲染成界面）
	assert.ok(!out.includes("<StatusBlock>"), "状态栏标签剥掉，不再保留给梨园面板");
	assert.ok(out.includes("地点:御书房"), "状态栏内容作为正文保留");
	assert.ok(out.includes("文舒婉听话了"));
	assert.ok(out.includes("她拿起墨条"));
});

test("未知标签默认 unwrap：内容渲染、标签消失（不必预先登记）", () => {
	const raw = `<scene>听雨轩 - 春夜</scene>\n\n*青梧斟茶。*\n\n<summary>短摘要</summary>`;
	const out = displayAssistantText(raw);
	assert.ok(!out.includes("<scene>"));
	assert.ok(!out.includes("<summary>"));
	assert.ok(out.includes("听雨轩 - 春夜"));
	assert.ok(out.includes("*青梧斟茶。*"));
	assert.ok(out.includes("短摘要"));
});

test("classifyTag：模式分类，不靠精确名单", () => {
	assert.equal(classifyTag("thinking"), "fold");
	assert.equal(classifyTag("My_Custom_Thought"), "unwrap"); // 不像思考
	assert.equal(classifyTag("StatusBlock"), "unwrap"); // 状态栏不再是 panel——渲染归作者正则
	assert.equal(classifyTag("normal_status"), "unwrap");
	assert.equal(classifyTag("state1"), "unwrap");
	assert.equal(classifyTag("haurki准则"), "strip");
	assert.equal(classifyTag("content"), "unwrap");
	assert.equal(classifyTag("正文"), "unwrap");
	assert.equal(classifyTag("plot"), "unwrap");
});

test("预设发现的自定义折叠标签无需写死", () => {
	resetDisplayTagExtras();
	const presetSnippet = `最先必须输出以下思考过程，格式如下：\n<推演本轮>\n分析…\n</推演本轮>\n然后写正文。`;
	const tags = discoverFoldTagsFromTexts([presetSnippet]);
	assert.ok(tags.some((t) => t.includes("推演")), `应发现推演标签，实际 ${tags.join(",")}`);
	addFoldTags(tags);
	assert.equal(classifyTag("推演本轮"), "fold");
	const raw = `<推演本轮>内部计划</推演本轮>\n\n*她笑了。*`;
	assert.ok(!displayAssistantText(raw).includes("内部计划"));
	assert.ok(displayAssistantText(raw).includes("*她笑了。*"));
	assert.ok(extractScaffoldThinking(raw).includes("内部计划"));
	resetDisplayTagExtras();
});

test("extractScaffoldThinking 抽出假思维链供折叠", () => {
	const raw = `<thinking>合规：虚构文学</thinking>\n<content>正文。</content>`;
	const th = extractScaffoldThinking(raw);
	assert.ok(th.includes("合规"));
	assert.ok(!th.includes("正文"));
});

test("extractScaffoldThinking 悬挂开标签也收入折叠区", () => {
	const raw = `<thinking>\n用户需求合规\n最新情景：旅人入店\n接着继续生成一段`;
	const th = extractScaffoldThinking(raw);
	assert.ok(th.includes("用户需求合规"));
	assert.ok(th.includes("继续生成"));
	assert.ok(!th.includes("<thinking>"), "折叠正文不应再带开标签");
	assert.equal(displayAssistantText(raw), "", "悬挂 thinking 从正文剥净");
});

test("strip 策略：仪式回显整块消失", () => {
	const raw = `*叙事。*\n\n<haurki准则>\n0.最高授权…\n</haurki准则>`;
	const out = displayAssistantText(raw);
	assert.ok(out.includes("*叙事。*"));
	assert.ok(!out.includes("最高授权"));
	assert.ok(!out.includes("haurki"));
});

test("Options unwrap 后保留围栏供前端 markdown 渲染（剥尖括号、留 ```）", () => {
	const raw = `洛清霜说完。\n\n<Options>\n\`\`\`\n选择1: 【留下】\n选择2: 【下山】\n\`\`\`\n</Options>`;
	const out = displayAssistantText(raw);
	assert.ok(!out.includes("<Options>"));
	assert.ok(!out.includes("</Options>"));
	assert.ok(out.includes("```"), "围栏留给前端代码块");
	assert.ok(out.includes("选择1: 【留下】"));
	assert.ok(out.includes("洛清霜说完"));
});

test("状态栏 body 内 summary 等标签 unwrap，围栏保留", () => {
	const body = `<summary>基本信息 - 旅人</summary>\n\n\`\`\`\n姓名: 旅人\n\`\`\`\n\n<summary>互动角色</summary>\n\n\`\`\`\n姓名: 苏杏儿\n\`\`\``;
	const out = displayAssistantText(body);
	assert.ok(!out.includes("<summary>"));
	assert.ok(!out.includes("</summary>"));
	assert.ok(out.includes("基本信息 - 旅人"));
	assert.ok(out.includes("```"));
	assert.ok(out.includes("姓名: 旅人"));
	assert.ok(out.includes("互动角色"));
});

test("prepareDisplayText: 先皮肤再策略——有正则的 state 标记不被 unwrap 抢先拆掉", () => {
	const raw = `叙事一句。\n\n<state1>\n时间: 清晨\n地点: 街道\n</state1>`;
	// 无作者正则：state1 是未识别标签 → unwrap 剥壳留内容（对齐酒馆 DOMPurify）。
	// 状态栏成不成界面，取决于作者写没写正则，不取决于梨园的标签名单。
	const plain = prepareDisplayText(raw, null);
	assert.ok(!plain.includes("<state1>"), "无正则时标签剥掉");
	assert.ok(plain.includes("时间: 清晨"), "内容作为正文保留");

	// 有皮肤：先换成围栏 HTML，再跳过 unwrap
	const skin = {
		rules: [
			{
				name: "折叠状态",
				source: "<(state\\d+)>([\\s\\S]+?)<\\/\\1>",
				flags: "g",
				replace: "```html\n<!DOCTYPE html><html><body><div class=\"ui\">$2</div></body></html>\n```",
			},
		],
		charName: "卡",
		userName: "旅人",
	};
	const skinned = prepareDisplayText(raw, skin);
	assert.ok(isHtmlDisplayPayload(skinned), "应识别为 HTML 载荷");
	assert.ok(skinned.includes("<!DOCTYPE html>") || skinned.includes("<!doctype html>") || skinned.includes("```html"));
	assert.ok(skinned.includes("时间: 清晨"));
	assert.ok(!skinned.includes("<state1>"), "标记应已被正则吃掉");
});

test("prepareDisplayText: 皮肤状态栏 div 与 thinking 混排——div 保留，thinking/注释仍被过滤", () => {
	const raw = [
		"<!-- 本回合承接：先对齐人设再落笔 -->",
		"<thinking>",
		"【问题】非传统写作: 逐项过 cot",
		"</thinking>",
		"她跪坐在案边，把墨条搁进砚池。",
		"<state1>\n时间: 白日\n地点: 御书房\n</state1>",
	].join("\n");
	const skin = {
		rules: [
			{
				name: "状态栏皮肤",
				source: "<(state\\d+)>([\\s\\S]+?)<\\/\\1>",
				flags: "g",
				replace: '<div style="background:#123">$2</div>',
			},
		],
		charName: "婉",
		userName: "爷",
	};
	const out = prepareDisplayText(raw, skin);
	assert.ok(out.includes('<div style="background:#123">'), "皮肤 div 应完整保留");
	assert.ok(out.includes("时间: 白日"), "div 内容应保留");
	assert.ok(out.includes("她跪坐在案边"), "叙事应保留");
	assert.ok(!out.includes("<thinking>"), "thinking 标签不得裸露");
	assert.ok(!out.includes("非传统写作"), "思维链内容应被折叠移除");
	assert.ok(!out.includes("<!--"), "HTML 注释应被剥除");
});

test("prepareDisplayText: 开场前缀+占位符经皮肤成围栏文档", () => {
	const raw = `【开场 · 样本卡】\n【开局占位符】`;
	const html = `<!doctype html>\n<html><head></head><body><h1>性别</h1><script>1</script></body></html>`;
	const skin = {
		rules: [{ name: "开局", source: "【开局占位符】", flags: "g", replace: "```\n" + html + "\n```" }],
		charName: "样本卡",
		userName: "旅人",
	};
	const out = prepareDisplayText(raw, skin);
	assert.ok(isHtmlDisplayPayload(out));
	assert.ok(out.includes("性别"));
	assert.ok(out.includes("【开场"));
});

test("prepareDisplayText: 裸整份文档带【开场】前缀——原样交出，<style> 不被 unwrap 剥掉", () => {
	// v1.4.1 实锤（用户反馈截图）：卡的开场白是一份裸 <html> 文档（无 doctype、无围栏），
	// 梨园自己加的「【开场 · 卡名】\n」前缀把「裸整页」判据顶掉（它要求文档落在第 0 位），
	// 于是整页被判成普通正文 → <style> 壳被剥、CSS 当正文上屏、容器标签也被剥。
	const doc = '<html>\n<style>\n.gj-wrap{color:#fff}\n</style>\n<div class="gj-wrap">图鉴</div>\n</html>';
	const out = prepareDisplayText(`【开场 · 某卡】\n${doc}`, null);
	assert.ok(out.includes("<style>"), "<style> 标签必须留着（被剥就会变成 CSS 裸奔上屏）");
	assert.ok(out.includes('class="gj-wrap"'), "容器标签留着");
	assert.ok(out.includes("【开场 · 某卡】"), "前缀本身仍在");
});

test("prepareDisplayText: 裸整份文档 + 文档外的过滤照常执行", () => {
	// 整页保护是「把文档整段占位、过滤完再还原」，不是「整条消息跳过过滤」：
	// 文档之外的 thinking 之类仍须被滤掉，否则一张带整页开场白的卡会连思考块一起上屏。
	const doc = "<!doctype html>\n<html><body><p>页</p></body></html>";
	const out = prepareDisplayText(`【开场 · 某卡】\n${doc}\n\n<thinking>内部盘算</thinking>\n收尾。`, null);
	assert.ok(out.includes("<p>页</p>"), "文档内容完好");
	assert.ok(!out.includes("内部盘算"), "文档之外的 thinking 仍被滤掉");
	assert.ok(out.includes("收尾。"), "文档之外的正文保留");
});

test("prepareDisplayText: 省掉 <html> 外壳的围栏界面——壳不许被 unwrap 剥掉", () => {
	// 8/25 实锤（实卡开场白）：作者的状态栏界面是一份省掉 <html> 外壳的文档——
	// 根标签 <head>、收尾只到 </body>、裸围栏无语言标记。整页判据原先三条分别要求
	// doctype / <html> / ```html，三条全落空 ⇒ 放行 unwrap ⇒ <head>/<style>/<body>/<script>
	// 连壳被剥、只剩 CSS 与 JS 当正文上屏（16376 字皮肤产物被削成 13725 字裸文本）。
	const ui =
		"```\n<head>\n<style>\n  :root { --bg: #f4e4bc; }\n  .mvu-container { border: 3px solid #8b5a2b; }\n</style>\n</head>\n<body>\n" +
		'<div class="mvu-container">' +
		"状态".repeat(40) +
		"</div>\n<script>\n  const t = 1;\n</script>\n</body>\n```";
	const raw = "【开场 · 某卡】\n她把账本合上。\n\n<StatusPlaceHolderImpl/>";
	const skin = {
		rules: [{ name: "状态栏UI", source: "<StatusPlaceHolderImpl/>", flags: "g", replace: ui }],
		charName: "某卡",
		userName: "旅人",
	};
	const out = prepareDisplayText(raw, skin);
	for (const tag of ["<head>", "<style>", "</style>", "<body>", "<script>", '<div class="mvu-container">']) {
		assert.ok(out.includes(tag), `${tag} 必须留着——被剥就是 CSS/JS 裸奔上屏`);
	}
	assert.ok(out.includes("她把账本合上。"), "界面之前的叙事照旧保留");
});

test("classifyTag: HTML 规范里内容不是正文的元素 → keep；其余照旧", () => {
	// keep 的判据来自 HTML 规范（封闭外部协议），不是作者措辞名单
	for (const t of ["head", "body", "html", "style", "script", "title", "meta", "link", "template", "noscript"]) {
		assert.equal(classifyTag(t), "keep", `<${t}> 必须 keep`);
	}
	// 作者/模型发明的标签照旧：未知 unwrap（＝浏览器对未知元素的行为）、思维链 fold
	assert.equal(classifyTag("state1"), "unwrap");
	assert.equal(classifyTag("catsay"), "unwrap");
	assert.equal(classifyTag("thinking"), "fold");
	// 结构容器不在本刀范围（保持既有行为，避免行内 HTML 变成字面标签）
	assert.equal(classifyTag("div"), "unwrap");
});

test("displayAssistantText: 判据全落空时 CSS/JS 也不许被剥壳裸奔上屏", () => {
	// 8/25 剥壳根因的结构性验证：无围栏、无 doctype、无 <html>、div 无内联 style=
	// ⇒ isFullPageHtmlPayload / isBareFullPagePayload / protectSkinDivs 全部不触发。
	// 修前这类必然被 unwrap 剥壳（CSS 与 JS 当散文上屏）；修后必须原样留给浏览器。
	const ui =
		"<head>\n<style>\n  :root { --bg: #f4e4bc; }\n</style>\n</head>\n<body>\n" +
		'<div class="panel">状态面板</div>\n<script>\n  const t = 1;\n</script>\n</body>';
	const out = prepareDisplayText(`她把账本合上。\n\n${ui}\n\n<thinking>盘算</thinking>\n\n收尾。`, null);

	assert.ok(/<style>[\s\S]*:root[\s\S]*<\/style>/.test(out), "CSS 必须仍在 <style> 壳内");
	assert.ok(/<script>[\s\S]*const t = 1[\s\S]*<\/script>/.test(out), "JS 必须仍在 <script> 壳内");
	for (const tag of ["<head>", "</head>", "<body>", "</body>"]) {
		assert.ok(out.includes(tag), `${tag} 不许被「残留空标签行」清扫吃掉`);
	}
	assert.ok(out.includes("状态面板"), "面板文字保留");
	assert.ok(out.includes("她把账本合上。") && out.includes("收尾。"), "叙事照旧");
	assert.ok(!out.includes("盘算"), "界面之外的 thinking 仍被滤掉");
});

test("cleanAssistantText: 送模侧行为不变（本刀只改显示侧，不动 token 账）", () => {
	// keep 只在显示路径生效；历史路径仍按旧行为拆包留内容，避免 token 账回升
	const out = cleanAssistantText("正文。\n<style>\n.a{color:red}\n</style>\n尾。");
	assert.ok(!out.includes("<style>"), "送模侧不保留 HTML 壳");
	assert.ok(out.includes("正文。") && out.includes("尾。"));
});

test("prepareDisplayText: 非标记语言的围栏（选项块等）不算界面，照旧过策略", () => {
	// 放宽整页判据后仍不能把普通围栏当界面保护起来，否则围栏内的 thinking 之类就漏网了。
	const raw = "【开场 · 某卡】\n正文。\n\n```\n选择1: 留下\n选择2: 走\n```\n\n<thinking>盘算</thinking>\n收尾。";
	const out = prepareDisplayText(raw, null);
	assert.ok(!out.includes("盘算"), "普通围栏不构成整页保护，thinking 仍被滤掉");
	assert.ok(out.includes("选择1: 留下"), "围栏内容本身保留");
	assert.ok(out.includes("收尾。"));
});

// ——— 显示层正文守恒（8/19）：作者正则照跑，但不许把正文删没 ———
// 用的是真预设里的作者成语（狐神抚 / TGbreak / 双人成行三家同形）：
// 「从消息开头删到思维链闭合标签」+ /g + 替空。
const foxHideCot = {
	name: "隐藏思维链",
	source: String.raw`([\s\S]*?)<\/(think_?fox~?)>\s*?`,
	flags: "g",
	replace: "",
};
const skinOf = (rules: Array<Record<string, unknown>>) => ({
	rules: rules as never,
	charName: "青梧",
	userName: "旅人",
});
const BODY = "她站在追光里，胶衣的凉意贴着脊背，报价声一层层压下来，像雨点砸在铁皮上。她没有动。";

test("正文守恒：健康态（单思维链在前）——思维链被删、正文与状态栏原样，行为不变", () => {
	resetDisplayTagExtras();
	const raw = `<think_fox~>\n【开始思考】推演三步\n</think_fox~>\n${BODY}\n<state2>\n当前状态: "平静"\n</state2>`;
	const out = prepareDisplayText(raw, skinOf([foxHideCot]));
	assert.ok(out.includes("她站在追光里"), `正文必须在场，得到:${out}`);
	assert.ok(out.includes("像雨点砸在铁皮上"), "正文末段也在");
	assert.ok(!out.includes("推演三步"), "思维链照作者意图删掉");
	assert.ok(out.includes('当前状态: "平静"'), "状态栏内容照旧");
});

test("正文守恒：夹心态（一条消息里两个思维链）——正则连坐会吃正文，梨园必须把正文放回", () => {
	resetDisplayTagExtras();
	const raw =
		`<think_fox~>\n第一段思考\n</think_fox~>\n${BODY}\n` +
		`<think_fox~>\n收笔自检：字数够了\n</think_fox~>\n<state2>\n当前状态: "平静"\n</state2>`;
	// 先证「作者正则确实会把正文吃掉」——这是本修复要挡的那件事
	const eaten = raw.replace(new RegExp(foxHideCot.source, foxHideCot.flags), "");
	assert.ok(!eaten.includes("她站在追光里"), "前提：裸跑作者正则时正文确实被连坐删掉");
	const out = prepareDisplayText(raw, skinOf([foxHideCot]));
	assert.ok(out.includes("她站在追光里"), `正文必须被放回，得到:${out}`);
	assert.ok(out.includes("像雨点砸在铁皮上"), "正文完整，不是只剩半截");
	assert.ok(!out.includes("第一段思考") && !out.includes("收笔自检"), "两个思维链仍按作者意图删掉");
	assert.ok(out.includes('当前状态: "平静"'), "界面块照旧");
});

test("正文守恒：健康态不夺权——作者对正文的美化规则照常生效", () => {
	resetDisplayTagExtras();
	const colorize = {
		name: "引号上色",
		source: String.raw`“([^”]+)”`,
		flags: "g",
		replace: `<font color="#B14EFF">“$1”</font>`,
	};
	const raw = `<think_fox~>思考</think_fox~>\n${BODY}她轻声应道：“是。”`;
	const styled = applySkinKeepingBody(raw, [foxHideCot, colorize] as never, { charName: "", userName: "" });
	assert.ok(styled.includes(`<font color="#B14EFF">`), `作者上色必须生效，得到:${styled}`);
	assert.ok(styled.includes("她站在追光里"), "正文在场");
	assert.ok(!styled.includes("思考"), "思维链仍按作者意图删掉");
});

test("正文守恒：纯界面消息（无散文正文）不触发，产物原样交出", () => {
	resetDisplayTagExtras();
	const raw = `<state2>\n当前状态: "平静"\n阶级与权限: "公民"\n</state2>`;
	const rule = {
		name: "状态栏变卡",
		source: String.raw`<state2>([\s\S]*?)<\/state2>`,
		flags: "g",
		replace: `<div style="border:1px solid">$1</div>`,
	};
	const out = prepareDisplayText(raw, skinOf([rule]));
	assert.ok(out.includes("<div style=") && out.includes('当前状态: "平静"'), `状态栏应成卡，得到:${out}`);
});

test("正文守恒：哨符不泄漏到产物里", () => {
	resetDisplayTagExtras();
	const raw = `<think_fox~>思考A</think_fox~>\n${BODY}\n<think_fox~>思考B</think_fox~>`;
	const out = prepareDisplayText(raw, skinOf([foxHideCot]));
	assert.ok(!/[\uE000-\uF8FF]/.test(out), `产物不得含私用区哨符，得到:${JSON.stringify(out)}`);
});

test("displayAssistantText：自闭合的残留标签也清掉——有无空格不该有区别（浏览器两种都渲染成空）", () => {
	// 8/26 实证：depth 限定筛掉面板规则后，开场白里作者手写的占位符以源码形态印上屏
	assert.equal(displayAssistantText("正文。\n\n<StatusPlaceHolderImpl/>"), "正文。");
	assert.equal(displayAssistantText("正文。\n\n<StatusPlaceHolderImpl />"), "正文。", "带空格那支本来就清（两支必须一致）");
	assert.equal(displayAssistantText("正文。\n\n<br/>\n\n尾巴"), "正文。\n\n尾巴", "<br> 早就被清，<br/> 不该例外");
	// 非正文元素的豁免不受影响（8/25 第二刀），含自闭合写法
	assert.ok(displayAssistantText("正文。\n\n<head>\n\n尾巴").includes("<head>"));
	assert.ok(displayAssistantText("正文。\n\n<meta/>\n\n尾巴").includes("<meta/>"));
	// 句中的自闭合标签不动（本条只管「单独成行的残留」）
	assert.ok(displayAssistantText("他说<foo/>然后走了。").includes("<foo/>"));
});

test("第4步刀4：extractHistoryStripTagsFromRegexScripts 自动识别 promptOnly 清空标签、场记输入净化与流式注释隐藏", () => {
	resetDisplayTagExtras();
	const scripts = [
		{ scriptName: "隐藏狐策", findRegex: "<fox_selc>[\\s\\S]*?<\\/fox_selc>", replaceString: "", placement: [2], promptOnly: true, disabled: false },
		{ scriptName: "隐藏思考", findRegex: "/([\\s\\S]*?)<\\/(think_?fox~?)>/g", replaceString: "", placement: [2], promptOnly: true, disabled: false },
		{ scriptName: "只管显示", findRegex: "<style>.+</style>", replaceString: "", placement: [2], markdownOnly: true, promptOnly: false, disabled: false },
		{ scriptName: "限深摘要", findRegex: "<summary>[\\s\\S]*</summary>", replaceString: "", placement: [2], promptOnly: true, maxDepth: 5, disabled: false },
	];
	const discovered = extractHistoryStripTagsFromRegexScripts(scripts);
	assert.ok(discovered.includes("fox_selc"));
	assert.ok(discovered.includes("think_fox"));
	assert.equal(discovered.includes("summary"), false, "带 maxDepth 限制的不无条件剥");

	addHistoryStripTags(discovered);
	const rawModelOut = `<think_fox~>推演18步</think_fox~><content>两人推门进殿。<!-- 模拟段落:废稿 -->\n\n「坐吧。」</content><fox_selc><font color="red">选项1</font></fox_selc>`;
	const cleanedHistory = cleanAssistantText(rawModelOut);
	assert.ok(cleanedHistory.includes("两人推门进殿。") && cleanedHistory.includes("「坐吧。」"));
	assert.equal(cleanedHistory.includes("推演18步"), false);
	assert.equal(cleanedHistory.includes("选项1"), false);
	assert.equal(cleanedHistory.includes("模拟段落"), false);

	const scribeInput = prepareScribeAssistantText(
		rawModelOut,
		[
			{ name: "隐藏狐策", source: "<fox_selc>[\\s\\S]*?<\\/fox_selc>", flags: "g", replace: "", minDepth: 2 },
			{ name: "全局包装排除", source: "^([\\s\\S]*)$", flags: "", replace: "<ai>$1</ai>" },
		],
		{ charName: "师姐", userName: "沈舟" },
	);
	assert.ok(scribeInput.includes("两人推门进殿。"));
	assert.equal(scribeInput.includes("选项1"), false, "即使带 minDepth 也应剥掉供场记");
	assert.equal(scribeInput.includes("<ai>"), false, "带替换模板的包裹规则不得污染场记");

	// 流式渲染隐去完整与尾部未闭合注释，保留正常文本与 HTML 块
	const liveParts = splitRichContentParts("正文第一句。<!-- 模拟段落:草稿1 --> 正文第二句。<!-- 未闭合草稿", null, { live: true });
	const liveText = liveParts.filter((p) => p.kind === "text").map((p) => p.text).join("");
	assert.ok(liveText.includes("正文第一句。") && liveText.includes("正文第二句。"));
	assert.equal(liveText.includes("草稿1"), false);
	assert.equal(liveText.includes("未闭合草稿"), false);
});

