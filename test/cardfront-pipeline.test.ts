/**
 * 端到端显示管线：卡 raw → displayRules → RichContent 真路径（splitRichContentParts）。
 * 作者正则先跑（applyCardSkin），产物是标准 HTML；梨园不再按标签名抠「统一状态卡」。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildCardFrontSnapshot, displayRules, extractRegexScripts } from "../src/cardfront.ts";
import { findLocalCard } from "./fixtures.ts";
import { prepareDisplayText } from "../src/postprocess.ts";
import { applyCardSkin } from "../web/src/cardSkin.ts";
import { isFullInterface, splitHtmlParts } from "../web/src/htmlEmbed.ts";
import { buildSrcDoc } from "../web/src/frameDoc.ts";
import { splitRichContentParts } from "../web/src/richContentParts.ts";

/** 开闭标签换皮形态：替换串内含 <status>，会误触发 isPanelTagName */
const skinScripts = [
	{
		scriptName: "状态栏开",
		findRegex: "/<StatusBlock>/gs",
		replaceString: '<div style="background-color: rgba(0, 0, 0, 0.5); border-radius: 8px;"><status>',
		placement: [2],
		disabled: false,
		markdownOnly: true,
		promptOnly: false,
		trimStrings: [],
	},
	{
		scriptName: "状态栏闭",
		findRegex: "/</StatusBlock>/gs",
		replaceString: "</status></div>",
		placement: [2],
		disabled: false,
		markdownOnly: true,
		promptOnly: false,
		trimStrings: [],
	},
];

const sampleRaw = {
	data: {
		name: "样本卡",
		extensions: { regex_scripts: skinScripts },
	},
};

const macros = { charName: "青梧", userName: "旅人" };

test("pipeline: 页面级 CSS 端到端——不再被 unwrap 剥成裸 CSS 上屏,整块进 iframe", () => {
	// 实卡状态栏美化形态：顶层 <style> + 自己的容器,无 doctype 无围栏。
	// 改动前实测：<style> 被 unwrap 剥掉 → 737 字 CSS 当正文上屏,容器 div 一起没了,只剩裸数值。
	const raw = {
		data: {
			name: "修真",
			extensions: {
				regex_scripts: [
					{
						scriptName: "[美化]状态栏",
						findRegex: "/<StatusBar>\\s*\\n([\\s\\S]*?)<\\/StatusBar>/gi",
						replaceString:
							'<style>\n.xzs{background:#eef}\n.xzs-b{white-space:pre-line}\n</style>\n<div class="xzs"><div class="xzs-b">$1</div></div>',
						placement: [2],
						disabled: false,
						markdownOnly: true,
						promptOnly: false,
					},
				],
			},
		},
	};
	const rules = displayRules(extractRegexScripts(raw));
	const skin = { rules, charName: "云澜", userName: "旅人" };
	const body = "他掐诀入定，识海翻涌。\n\n<StatusBar>\n境界：炼气三层\n灵石：320\n</StatusBar>";

	const displayed = prepareDisplayText(body, skin);
	const parts = splitRichContentParts(displayed, skin);
	const htmlParts = parts.filter((p) => p.kind === "html") as Array<{ kind: "html"; html: string }>;

	assert.equal(htmlParts.length, 1, "状态栏整块进一个帧");
	assert.ok(/<style/i.test(htmlParts[0].html), "<style> 必须进框——被剥掉就是 CSS 当正文上屏");
	assert.ok(/class="xzs"/.test(htmlParts[0].html), "容器结构也在框里(原来连 div 一起被剥)");
	assert.ok(htmlParts[0].html.includes("炼气三层"), "状态栏数值在框里");

	const textParts = parts.filter((p) => p.kind === "text") as Array<{ kind: "text"; text: string }>;
	const outside = textParts.map((p) => p.text).join("\n");
	assert.ok(outside.includes("他掐诀入定"), "叙事留在框外,照常走正文渲染");
	assert.ok(!outside.includes(".xzs{"), "CSS 不得留在正文里");
});

test("pipeline: 提取→应用→混排切分→无痕 srcdoc", () => {
	const rules = displayRules(extractRegexScripts(sampleRaw));
	assert.equal(rules.length, 2);

	const text = "雨停了。\n<StatusBlock>\nHP: 80\nMP: 20\n</StatusBlock>\n她抬头。";
	const skinned = applyCardSkin(text, rules, macros);
	assert.ok(!skinned.includes("<StatusBlock>"));
	assert.ok(skinned.includes('<div style="background-color: rgba(0, 0, 0, 0.5)'));
	assert.ok(skinned.includes("</status></div>"));

	const parts = splitHtmlParts(skinned);
	const htmlParts = parts.filter((p) => p.kind === "html");
	assert.equal(htmlParts.length, 1);
	if (htmlParts[0].kind === "html") {
		assert.ok(htmlParts[0].html.startsWith("<div"));
		assert.equal(htmlParts[0].scripts, false);
		const doc = buildSrcDoc(htmlParts[0].html, false, true);
		assert.ok(!doc.includes("PingFang"));
		assert.ok(doc.includes("background:transparent"));
		assert.ok(!doc.includes("<script>"));
	}
	assert.ok(parts.some((p) => p.kind === "text" && p.text.includes("雨停了")));
	assert.ok(parts.some((p) => p.kind === "text" && p.text.includes("她抬头")));
});

test("RichContent 真路径: 皮肤后 HTML 先认领,status 不撕碎 div", () => {
	const rules = displayRules(extractRegexScripts(sampleRaw));
	const text = "雨停了。\n<StatusBlock>\nHP: 80\nMP: 20\n</StatusBlock>\n她抬头。";
	const skin = { rules, ...macros };

	// 真路径（Messages.RichContent → splitRichContentParts）
	const parts = splitRichContentParts(text, skin);
	const htmls = parts.filter((p) => p.kind === "html");
	assert.equal(htmls.length, 1, "应保留单一 html 段(外层 div)");
	if (htmls[0].kind === "html") {
		assert.ok(htmls[0].html.startsWith("<div"));
		assert.ok(htmls[0].html.includes("<status>"));
		assert.ok(htmls[0].html.includes("HP: 80"));
		assert.ok(htmls[0].html.endsWith("</div>") || htmls[0].html.trimEnd().endsWith("</div>"));
		// 完整皮肤块进无痕 srcdoc
		const doc = buildSrcDoc(htmls[0].html, false, true);
		assert.ok(doc.includes("HP: 80"));
		assert.ok(!doc.includes("PingFang"));
	}
	assert.ok(parts.some((p) => p.kind === "text" && p.text.includes("雨停了")));
	assert.ok(parts.some((p) => p.kind === "text" && p.text.includes("她抬头")));
});

test("显示管线: 无作者正则时 StatusBlock 剥壳成裸文本(对齐酒馆,不画梨园灰框)", () => {
	const text = "前文\n<StatusBlock>\nHP: 80\n</StatusBlock>\n后文";
	// 服务端 prepareDisplayText 负责 unwrap（对齐酒馆 DOMPurify 剥未知标签）
	const displayed = prepareDisplayText(text, null);
	assert.ok(!displayed.includes("<StatusBlock>"), "标签本身剥掉");
	assert.ok(displayed.includes("HP: 80"), "状态栏内容作为正文保留");
	// 前端这层只负责不把它抠成梨园灰框（作者没写正则 → 无 html 段）
	const parts = splitRichContentParts(displayed, null);
	assert.equal(parts.filter((p) => p.kind === "html").length, 0, "无正则不出 html 段");
});

test("pipeline: 整楼界面判定", () => {
	const rules = displayRules(extractRegexScripts(sampleRaw));
	const onlySkin = applyCardSkin("<StatusBlock>\nHP: 1\n</StatusBlock>", rules, {
		charName: "x",
		userName: "y",
	});
	assert.equal(isFullInterface(onlySkin), true);
	assert.equal(isFullInterface(`旁白\n${onlySkin}`), false);
	// 真路径整楼也是单 html、无 status 段
	const parts = splitRichContentParts("<StatusBlock>\nHP: 1\n</StatusBlock>", {
		rules,
		charName: "x",
		userName: "y",
	});
	assert.equal(parts.length, 1);
	assert.equal(parts[0].kind, "html");
});

test("pipeline: 关闭皮肤=不应用规则时 StatusBlock 仍为文本段(html 层)", () => {
	const text = "<StatusBlock>\nHP: 80\n</StatusBlock>";
	// 无规则：自定义标签不触发 html 块切分（剥壳是服务端 unwrap 的活）
	const parts = splitHtmlParts(text);
	assert.equal(parts.length, 1);
	assert.equal(parts[0].kind, "text");
});

/** 实卡回归:带成对开闭状态栏标签的卡,一档皮肤绝对不能回落 StatusPanel */
test("实卡: first_mes/备选开场白 一律 html 皮肤、零 status 段", () => {
	// 判据是形状不是卡名:开场白里有 StatusBlock 占位、且卡自带换皮规则(见 test/fixtures.ts)
	const card = findLocalCard((c) => {
		const greetings = [
			String(c.data.first_mes ?? ""),
			...((Array.isArray(c.data.alternate_greetings) ? c.data.alternate_greetings : []) as unknown[]).map(String),
		];
		if (!greetings.some((t) => t.includes("StatusBlock"))) return false;
		return displayRules(extractRegexScripts(c.raw)).filter((r) => r.source.includes("StatusBlock")).length >= 2;
	});
	// 发行包与 clean clone 不带样本卡;有卡则必须全绿
	if (!card) return;
	const { raw, data } = card;
	const snap = buildCardFrontSnapshot(
		{ card: card.path, userName: "旅人" },
		raw as Record<string, unknown>,
		String(data.name ?? "样本卡"),
	);
	assert.equal(snap.enabled, true);
	assert.equal(snap.hasSkin, true);
	assert.ok(snap.rules.length >= 2, "至少两条 StatusBlock 开闭规则");

	const skin = { rules: snap.rules, charName: snap.charName, userName: snap.userName };
	const greetings = [
		String(data.first_mes ?? ""),
		...((Array.isArray(data.alternate_greetings) ? data.alternate_greetings : []) as unknown[]).map((g) =>
			String(g),
		),
	].filter((t) => t.includes("StatusBlock"));

	assert.ok(greetings.length >= 1, "开场白应含 StatusBlock");
	for (const text of greetings) {
		const parts = splitRichContentParts(text, skin);
		const statuses = parts.filter((p) => p.kind === "status");
		const htmls = parts.filter((p) => p.kind === "html");
		assert.equal(statuses.length, 0, "不得回落梨园 StatusPanel");
		assert.equal(htmls.length, 1, "作者皮肤应成单一 html 段");
		if (htmls[0].kind === "html") {
			// 断言换成形状不变量:换皮规则的替换串必带作者样式,不问是哪一张卡的什么颜色
			assert.ok(/\bstyle\s*=|rgba?\(/i.test(htmls[0].html), "须含作者自带样式");
			assert.ok(!htmls[0].html.includes("<StatusBlock"), "StatusBlock 开标签须被替换");
			assert.ok(!htmls[0].html.includes("</StatusBlock"), "StatusBlock 闭标签须被替换");
			// 原文换行必须还在 html 段里(后续靠 seamless pre-wrap 显示为多行)
			assert.ok(
				/\S\s*\n\s*\S/.test(htmls[0].html.replace(/\r\n/g, "\n")),
				"皮肤产物须保留状态栏各字段之间的换行,不能已压成一行",
			);
			const doc = buildSrcDoc(htmls[0].html, false, true);
			assert.ok(/\bstyle\s*=|rgba?\(/i.test(doc), "帧里仍带作者样式");
			assert.ok(!doc.includes("PingFang"), "无痕帧不得强塞宿主字体");
			assert.ok(doc.includes("white-space:pre-wrap"), "seamless 必须 pre-wrap,对齐酒馆多行状态栏");
		}
	}

	// 无作者正则时：不出 html 段（不画梨园灰框）；标签剥壳是服务端 prepareDisplayText 的活
	const bare = splitRichContentParts(greetings[0], null);
	assert.equal(bare.filter((p) => p.kind === "html").length, 0, "无正则不出 html 段");
});
