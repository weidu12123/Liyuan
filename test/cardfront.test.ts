import assert from "node:assert/strict";
import test from "node:test";
import { expandSkinReplacement } from "../src/cardSkin.ts";
import { htmlLooksInteractive } from "../web/src/htmlEmbed.ts";
import {
	buildCardFrontSnapshot,
	displayRules,
	extractRegexScripts,
	hasDepthLimits,
	isSkinEnabled,
	promptRules,
	rulesAtDepth,
	setSkinEnabled,
	type DisplayRule,
} from "../src/cardfront.ts";

/** 开闭标签换皮的实卡形态(内联夹具,不读盘,测试自包含) */
const skinScript = {
	scriptName: "状态栏",
	findRegex: "/<StatusBlock>/gs",
	replaceString: '<div style="background-color: rgba(0, 0, 0, 0.5);"><status>',
	placement: [2],
	disabled: false,
	markdownOnly: true,
	promptOnly: false,
	trimStrings: [],
};
/** promptOnly 清理向规则:显示层必须排除 */
const promptOnlyScript = {
	scriptName: "删除描写分析",
	findRegex: "/<descriptive_analysis>[\\s\\S]*</descriptive_analysis>/gm",
	replaceString: "",
	placement: [2],
	disabled: false,
	markdownOnly: false,
	promptOnly: true,
	trimStrings: [],
};

test("extractRegexScripts: data.extensions 与顶层 extensions 都认,缺失返回空", () => {
	assert.equal(extractRegexScripts({ data: { extensions: { regex_scripts: [skinScript] } } }).length, 1);
	assert.equal(extractRegexScripts({ extensions: { regex_scripts: [skinScript] } }).length, 1);
	assert.deepEqual(extractRegexScripts({ name: "x" }), []);
	assert.deepEqual(extractRegexScripts({ data: { extensions: { regex_scripts: "bad" } } }), []);
});

test("displayRules: 显示向保留,promptOnly/disabled/非AI输出排除", () => {
	const rules = displayRules([
		skinScript,
		promptOnlyScript,
		{ ...skinScript, scriptName: "已停用", disabled: true },
		{ ...skinScript, scriptName: "只管用户输入", placement: [1] },
	]);
	assert.equal(rules.length, 1);
	assert.equal(rules[0].name, "状态栏");
	assert.equal(rules[0].source, "<StatusBlock>");
	assert.equal(rules[0].flags, "gs");
	assert.ok(rules[0].replace.startsWith("<div"));
});

test("promptRules: 送模侧收 promptOnly 与破坏性，排除 markdownOnly/disabled/非AI输出", () => {
	const pr = promptRules([
		skinScript, // markdownOnly → 送模侧不收
		promptOnlyScript, // promptOnly → 收
		{ ...skinScript, scriptName: "破坏性", markdownOnly: false, promptOnly: false, findRegex: "<w2g>([\\s\\S]*?)<\\/w2g>" }, // 两个only都没勾 → 收
		{ ...skinScript, scriptName: "已停用", disabled: true },
		{ ...skinScript, scriptName: "只管用户输入", placement: [1] },
	]);
	assert.deepEqual(
		pr.map((r) => r.name),
		["删除描写分析", "破坏性"],
		"markdownOnly/disabled/非AI输出排除，promptOnly 与破坏性收",
	);
	assert.equal(pr[0].replace, "", "替换串原样带下去");
});

test("displayRules: 裸模式串(无 /…/ 包裹)按字面正则源处理", () => {
	const rules = displayRules([{ ...skinScript, findRegex: "<StatusBlock>" }]);
	assert.equal(rules.length, 1);
	assert.equal(rules[0].source, "<StatusBlock>");
	assert.equal(rules[0].flags, "g"); // 无声明时默认 g,保证全文替换
});

test("displayRules: 非法正则跳过不抛", () => {
	const warnings: string[] = [];
	const oldWarn = console.warn;
	try {
		console.warn = (...args) => warnings.push(args.join(" "));
		const rules = displayRules([{ ...skinScript, findRegex: "/([unclosed/g" }, skinScript]);
		assert.equal(rules.length, 1);
		assert.ok(warnings.some((w) => w.includes("正则无法解析")));
	} finally {
		console.warn = oldWarn;
	}
});

test("displayRules: trimStrings 随规则带下去(不再整条丢),在替换时对捕获组生效", () => {
	const rules = displayRules([{ ...skinScript, trimStrings: ["x", ""] }]);
	assert.equal(rules.length, 1, "有 trimStrings 的规则必须收下——整条丢会让作者的渲染凭空消失");
	assert.deepEqual(rules[0].trim, ["x"], "空串滤掉，其余原样带下去");
	assert.equal(displayRules([{ ...skinScript, trimStrings: [] }])[0].trim, undefined, "空数组不带 trim 字段");
});

test("trimStrings 语义与 ST filterString 同义:只削代入的捕获组,不动模板字面", () => {
	// ST engine.js:457 —— 对代入替换串的那段文本逐条 replaceAll 删除
	assert.equal(expandSkinReplacement("[$1]", "整段", ["a删b删c"], ["删"]), "[abc]");
	assert.equal(expandSkinReplacement("{{match}}", "前删后", [], ["删"]), "前后");
	assert.equal(expandSkinReplacement("$&", "前删后", [], ["删"]), "前后");
	// 模板里的字面文本不受影响——只有代入的部分被削
	assert.equal(expandSkinReplacement("删[$1]删", "m", ["x"], ["删"]), "删[x]删");
	// 无 trim 时行为与改动前逐字一致
	assert.equal(expandSkinReplacement("[$1]", "m", ["a删b"]), "[a删b]");
});

test("buildCardFrontSnapshot: 预设自带 regex_scripts 一并收下,且排在卡规则之前", () => {
	// 酒馆三源顺序 GLOBAL → PRESET → SCOPED(engine.js:108-133);梨园无 GLOBAL
	const cardRaw = { data: { name: "卡", extensions: { regex_scripts: [{ ...skinScript, scriptName: "卡的" }] } } };
	const presetRaw = { prompts: [], extensions: { regex_scripts: [{ ...skinScript, scriptName: "预设的" }] } };

	const both = buildCardFrontSnapshot({ card: "c.png", userName: "u" }, cardRaw, "卡", presetRaw);
	assert.deepEqual(
		both.rules.map((r) => r.name),
		["预设的", "卡的"],
		"预设规则必须在前——后一条吃的是前一条的产物",
	);

	// 只有预设有正则:也算有皮肤(此前预设那份从未被读过,状态栏只能靠名字名单猜)
	const presetOnly = buildCardFrontSnapshot({ card: "c.png", userName: "u" }, null, "", presetRaw);
	assert.equal(presetOnly.hasSkin, true);
	assert.deepEqual(presetOnly.rules.map((r) => r.name), ["预设的"]);

	// 不传预设 = 改动前的行为,逐字不变
	const cardOnly = buildCardFrontSnapshot({ card: "c.png", userName: "u" }, cardRaw, "卡");
	assert.deepEqual(cardOnly.rules.map((r) => r.name), ["卡的"]);
});

test("skin 开关:默认开,cardSkinOff 关,setSkinEnabled 幂等往返", () => {
	const cfg = { card: "assets/cards/a.png" } as never;
	assert.equal(isSkinEnabled({ card: "assets/cards/a.png" }, "assets/cards/a.png"), true);
	const off = setSkinEnabled(cfg, "assets/cards/a.png", false);
	assert.equal(isSkinEnabled(off, "assets/cards/a.png"), false);
	const on = setSkinEnabled(off, "assets/cards/a.png", true);
	assert.equal(isSkinEnabled(on, "assets/cards/a.png"), true);
	assert.deepEqual(on.cardSkinOff, []);
});

test("displayRules: substituteRegex 非零的规则正常提取并携带 substituteRegex 模式", () => {
	const rules1 = displayRules([{ ...skinScript, substituteRegex: 1 }]);
	assert.equal(rules1.length, 1);
	assert.equal(rules1[0].substituteRegex, 1);
	const rules2 = displayRules([{ ...skinScript, substituteRegex: 2 }]);
	assert.equal(rules2.length, 1);
	assert.equal(rules2[0].substituteRegex, 2);
});

test("displayRules: minDepth/maxDepth 随规则带下去;越界/非数按酒馆同判当无限定", () => {
	// 有效：min ≥ -1、max ≥ 0（含 0 与 -1 这两个边界）
	assert.equal(displayRules([{ ...skinScript, minDepth: 3 }])[0].minDepth, 3);
	assert.equal(displayRules([{ ...skinScript, maxDepth: 0 }])[0].maxDepth, 0);
	assert.equal(displayRules([{ ...skinScript, minDepth: -1 }])[0].minDepth, -1);
	assert.equal(displayRules([{ ...skinScript, minDepth: 0, maxDepth: 999 }])[0].maxDepth, 999);
	// 无效（ST engine.js:363-371 的守卫不通过）→ 不带字段＝无限定
	assert.equal(displayRules([{ ...skinScript, maxDepth: -1 }])[0].maxDepth, undefined);
	assert.equal(displayRules([{ ...skinScript, minDepth: -2 }])[0].minDepth, undefined);
	assert.equal(displayRules([{ ...skinScript, minDepth: null, maxDepth: null }])[0].minDepth, undefined);
	assert.equal(displayRules([{ ...skinScript, minDepth: "x" }])[0].minDepth, undefined);
	// 送模侧同一份解析口径
	assert.equal(promptRules([{ ...promptOnlyScript, minDepth: 3 }])[0].minDepth, 3);
});

test("rulesAtDepth: 深度筛选逐条件对齐酒馆;depth 未知则不筛", () => {
	const mk = (name: string, d: Partial<DisplayRule>): DisplayRule => ({
		name,
		source: "x",
		flags: "g",
		replace: "y",
		...d,
	});
	const min3 = mk("隐藏历史", { minDepth: 3 });
	const max2 = mk("折叠新的", { maxDepth: 2 });
	const plain = mk("无限定", {});
	const all = [min3, max2, plain];
	const namesAt = (depth?: number) => rulesAtDepth(all, depth).map((r) => r.name);

	// depth 0-2＝最新三条：只渲染，不删除
	assert.deepEqual(namesAt(0), ["折叠新的", "无限定"]);
	assert.deepEqual(namesAt(2), ["折叠新的", "无限定"], "maxDepth:2 的边界内");
	// depth ≥3＝更旧：只删除，不渲染（严格互补，无重叠）
	assert.deepEqual(namesAt(3), ["隐藏历史", "无限定"], "minDepth:3 的边界");
	assert.deepEqual(namesAt(99), ["隐藏历史", "无限定"]);
	// 无限定的规则任何深度都在
	assert.deepEqual(rulesAtDepth([plain], 50), [plain]);
	// depth 未知 → 原样返回（REST 快照、整楼界面判定等不遍历序列的调用点行为不变）
	assert.deepEqual(namesAt(undefined), ["隐藏历史", "折叠新的", "无限定"]);
	assert.equal(rulesAtDepth(all), all, "不筛时连新数组都不造");
	// max=0 只落在最新那条
	assert.deepEqual(rulesAtDepth([mk("仅最新", { maxDepth: 0 })], 0).length, 1);
	assert.deepEqual(rulesAtDepth([mk("仅最新", { maxDepth: 0 })], 1).length, 0);
});

test("hasDepthLimits: 有没有深度限定决定要不要为算 depth 多走一遍", () => {
	const base: DisplayRule = { name: "a", source: "x", flags: "g", replace: "y" };
	assert.equal(hasDepthLimits([base]), false);
	assert.equal(hasDepthLimits([base, { ...base, maxDepth: 2 }]), true);
	assert.equal(hasDepthLimits([{ ...base, minDepth: 0 }]), true, "min=0 也是限定,别被 falsy 吃掉");
	assert.equal(hasDepthLimits([]), false);
});

/** 页面级 CSS：顶层 <style>/<script> 的替换串（实卡 [美化]状态栏 形态） */
const pageScopedScript = {
	scriptName: "[美化]状态栏",
	findRegex: "/<StatusBar>([\\s\\S]*?)<\\/StatusBar>/gi",
	replaceString: '<style>\n.xzs-b{white-space:pre-line}\n</style>\n<div class="xzs"><div class="xzs-b">$1</div></div>',
	placement: [2],
	disabled: false,
	markdownOnly: true,
	promptOnly: false,
};

test("页面级 <style>: 替换串包成围栏整份文档,样式与结构同框(两种顺序都认)", () => {
	const styleFirst = displayRules([pageScopedScript])[0].replace;
	assert.match(styleFirst, /```html\n<!DOCTYPE html>/, "合成围栏整份文档,走现成 iframe 通道");
	assert.match(styleFirst, /^\n\n```html/, "围栏必须落在行首——替换点可能在句中");
	const doc = /```html\n([\s\S]*?)\n```/.exec(styleFirst)?.[1] ?? "";
	assert.ok(/<style/.test(doc) && /class="xzs"/.test(doc), "样式与结构必须同框,分家了样式就管不到结构");
	assert.ok(doc.includes("$1"), "捕获组占位符原样保留,展开仍归 applyCardSkin");

	// 实卡常见形态:div 在前、style 在后(实测 6 条里 4 条是这个顺序)
	const styleLast = displayRules([
		{ ...pageScopedScript, replaceString: '<div class="mvu">$1</div>\n<style>.mvu{color:red}</style>' },
	])[0].replace;
	const doc2 = /```html\n([\s\S]*?)\n```/.exec(styleLast)?.[1] ?? "";
	assert.ok(/class="mvu"/.test(doc2) && /<style/.test(doc2), "顺序颠倒也整段包进同一份文档——顺序不是判据");
});

test("页面级: 连续顶层节点整段包一份;<script> 剔掉不进框(不靠一次 CSS 修复给预设 JS 发权限)", () => {
	// 双人成行 CoT-简约美化-YO 形态:style → 注释 → details → script 四节点
	const rule = displayRules([
		{
			...pageScopedScript,
			replaceString:
				'<style>.c{color:#000}</style>\n<!-- MODULE: HTML_CARD -->\n<details class="c">$1</details>\n<script>window.parent.document</script>',
		},
	])[0];
	assert.equal(rule.replace.match(/```html/g)?.length, 1, "四个节点包成一份文档,不是四个 iframe");
	const doc = /```html\n([\s\S]*?)\n```/.exec(rule.replace)?.[1] ?? "";
	assert.ok(/<style/.test(doc), "样式在内");
	assert.ok(/<details/.test(doc), "注释没把段截断,details 也在内");
	// HtmlFrame 在 seamless+有脚本时给的 sandbox 含 allow-same-origin(可读父页 DOM)。
	// 这些脚本今天也不执行(被 unwrap 成裸文本),不该因为修 CSS 就获得页面级权限。
	assert.ok(!/<script/i.test(doc), "<script> 不进合成文档");
	assert.ok(!doc.includes("window.parent"), "脚本正文也不留(否则又是裸 JS 上屏)");
	assert.equal(htmlLooksInteractive(doc), false, "合成的帧必须是静态的——这是 sandbox 不带 same-origin 的前提");
});

test("页面级: 带内联 on*= 事件的部件不接,原样留给老路径(宁可维持现状,不悄悄发权限)", () => {
	const withHandler = '<style>.c{color:red}</style>\n<div class="c" onclick="alert(1)">$1</div>';
	assert.equal(displayRules([{ ...pageScopedScript, replaceString: withHandler }])[0].replace, withHandler);
});

test("页面级: 认形态不认名字——内联 style= / 已围栏 / 裸整份文档 / 嵌套 style 一律不动", () => {
	const same = (replaceString: string, why: string) => {
		assert.equal(displayRules([{ ...pageScopedScript, replaceString }])[0].replace, replaceString, why);
	};
	same('<div style="color:red">$1</div>', "内联 style= 属性不是 <style> 元素(15 条内联规则走老路)");
	same("```html\n<!DOCTYPE html>\n<html><body><style>.a{}</style><div>$1</div></body></html>\n```", "已围栏:现成通道已认领");
	same("<!DOCTYPE html><html><body><style>.a{}</style>$1</body></html>", "裸整份文档:同上");
	same('<div class="wrap"><style>.a{}</style>$1</div>', "style 嵌在 div 内部＝不是顶层,是它自己的事");
	same("『$1』", "纯文本替换");
	same("<div>$1", "未闭合不成元素,宁缺毋错");
});

test("页面级: 只在显示侧成立——promptRules 不许把围栏文档塞进送模历史", () => {
	const pr = promptRules([{ ...pageScopedScript, markdownOnly: false, promptOnly: true }]);
	assert.equal(pr.length, 1);
	assert.ok(!pr[0].replace.includes("```"), "送模历史里出现围栏整份文档＝把界面喂给模型当范文");
	assert.equal(pr[0].replace, pageScopedScript.replaceString, "送模侧逐字不改");
});

test("buildCardFrontSnapshot: hello/REST 同源载荷", () => {
	const raw = { data: { name: "样本卡", extensions: { regex_scripts: [skinScript] } } };
	const snap = buildCardFrontSnapshot(
		{ card: "assets/cards/a.png", userName: "旅人" },
		raw,
		"样本卡",
	);
	assert.equal(snap.enabled, true);
	assert.equal(snap.hasSkin, true);
	assert.equal(snap.rules.length, 1);
	assert.equal(snap.charName, "样本卡");
	assert.equal(snap.userName, "旅人");

	const off = buildCardFrontSnapshot(
		{ card: "assets/cards/a.png", cardSkinOff: ["assets/cards/a.png"], userName: "旅人" },
		raw,
		"样本卡",
	);
	assert.equal(off.enabled, false);
	assert.equal(off.hasSkin, true); // 卡上有皮;前端用 enabled 决定是否应用
	assert.equal(off.rules.length, 1);

	const empty = buildCardFrontSnapshot({ card: "x", userName: "u" }, null, "");
	assert.equal(empty.hasSkin, false);
	assert.deepEqual(empty.rules, []);
});
