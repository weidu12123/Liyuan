import assert from "node:assert/strict";
import { test } from "node:test";

import {
	assembleForDeclare,
	assembleForDeclareWithEjs,
	buildDeclarePrompt,
	buildProcessPrompt,
	compiledPieces,
	compilePreset,
	compilePresetWithEjs,
	declarePieces,
	parseDeclareResponse,
	parseProcessResponse,
	parseProcessResponseWithError,
	presetFingerprint,
	processIntoEntries,
	stripPresetEntries,
	translatePresetWithDeclaration,
	translatePresetWithDeclarationAsync,
	type PresetDeclaration,
} from "../src/preset-declare.ts";
import { parsePromptEntries } from "../src/prompt-entries.ts";
import { loadPresetDoc } from "../src/preset-doc.ts";

/** 最小酒馆预设：身份/文风/包装/思考/格式/关闭块/末条预填，marker 全套 */
const rawPreset: Record<string, unknown> = {
	prompts: [
		{ identifier: "main", name: "身份", role: "system", content: "你是资深写手。" },
		{ identifier: "style", name: "文风", role: "system", content: "文风：白描为主。" },
		{ identifier: "w1", name: "包装开", role: "system", content: "<Lore>" },
		{ identifier: "worldInfoBefore", name: "World Info (before)", marker: true },
		{ identifier: "chatHistory", name: "Chat History", marker: true },
		{ identifier: "w2", name: "包装闭", role: "system", content: "</Lore>" },
		{ identifier: "cot", name: "思考", role: "system", content: "用 <thinking> 包裹逐项自检后输出。" },
		{ identifier: "fmt", name: "格式", role: "system", content: "正文用 <content> 包裹。" },
		{ identifier: "off", name: "关闭的", role: "system", content: "不该出现" },
		{ identifier: "pf", name: "预填", role: "assistant", content: "好，开始。" },
	],
	prompt_order: [
		{
			character_id: 100001,
			order: [
				{ identifier: "main", enabled: true },
				{ identifier: "style", enabled: true },
				{ identifier: "w1", enabled: true },
				{ identifier: "worldInfoBefore", enabled: true },
				{ identifier: "chatHistory", enabled: true },
				{ identifier: "w2", enabled: true },
				{ identifier: "cot", enabled: true },
				{ identifier: "fmt", enabled: true },
				{ identifier: "off", enabled: false },
				{ identifier: "pf", enabled: true },
			],
		},
	],
};

const doc = loadPresetDoc(rawPreset, "测试预设");
const assembled = assembleForDeclare(doc, { charName: "角色", userName: "用户" });

test("declarePieces：排除 marker 与末条 assistant 预填，保留文档序", () => {
	const pieces = declarePieces(assembled);
	assert.deepEqual(
		pieces.map((p) => p.id),
		["main", "style", "w1", "w2", "cot", "fmt"],
	);
	assert.equal(pieces[0].where, "before");
	assert.equal(pieces[4].where, "after"); // cot 在 chatHistory 之后
});

test("buildDeclarePrompt：带标识符、站别判据与输出格式，且明确收窄停用范围保住混合破限与常规思考排版", () => {
	const { systemPrompt, userText } = buildDeclarePrompt(declarePieces(assembled), {
		preset: "测试预设",
	});
	assert.match(systemPrompt, /identity/);
	assert.match(systemPrompt, /拿不准的分段一律 writing/);
	assert.match(systemPrompt, /即使混有思考规划或标签说明也必须保留/);
	assert.match(systemPrompt, /只许思考或输出一次/);
	assert.match(systemPrompt, /\{"id"/);
	assert.match(systemPrompt, /id 为段头编号/);
	assert.ok(!userText.includes("main"));
	assert.match(userText, /⟦1｜system｜历史前｜身份⟧/);
	assert.match(userText, /资深写手/);
});

test("parseDeclareResponse：合法站别收下；未知站别落 writing；漏声明的段落落 writing", () => {
	const pieces = declarePieces(assembled);
	const resp = [
		"```json",
		"[",
		'{"id":"main","station":"identity","note":"破限身份"},',
		'{"id":"style","station":"writing"},',
		'{"id":"w1","station":"wrapper"},',
		'{"id":"cot","station":"thinking"},',
		'{"id":"fmt","station":"bogus"}',
		"]",
		"```",
	].join("\n");
	const parsed = parseDeclareResponse(resp, pieces);
	// w2 漏声明、fmt 站别非法 → 都保守落 writing
	assert.equal(parsed.entries.find((e) => e.identifier === "w2")?.station, "writing");
	assert.equal(parsed.entries.find((e) => e.identifier === "fmt")?.station, "writing");
	assert.equal(parsed.entries.find((e) => e.identifier === "main")?.station, "identity");
	assert.equal(parsed.entries.find((e) => e.identifier === "cot")?.station, "thinking");
	assert.deepEqual(parsed.defaulted, ["w2", "fmt"]);
	assert.equal(parsed.declared, 4);
	assert.equal(parsed.errors.length, 1);
	assert.equal(parsed.entries.find((e) => e.identifier === "fmt")?.sourceHash, undefined);
});

test("translatePresetWithDeclaration：逐块（预设）条目，机制段关闭条目；未启用块只入账不取内容", () => {
	const pieces = declarePieces(assembled);
	const parsed = parseDeclareResponse(
		JSON.stringify([
			{ id: "main", station: "identity" },
			{ id: "style", station: "writing" },
			{ id: "w1", station: "wrapper" },
			{ id: "w2", station: "wrapper" },
			{ id: "cot", station: "thinking" },
			{ id: "fmt", station: "output" },
		]),
		pieces,
	);
	const declaration: PresetDeclaration = {
		version: 1,
		preset: "测试预设",
		createdAt: "2026-09-12T00:00:00.000Z",
		entries: parsed.entries,
	};
	const r = translatePresetWithDeclaration(doc, declaration, { charName: "角色", userName: "用户" });

	// APPEND：# 预设提示词（预设）标题条目 ＋ 身份活条目——全部带来源，重转译可整体剥掉
	assert.match(r.appendMarkdown, /^# 预设提示词（预设）/);
	assert.match(r.appendMarkdown, /## 身份（预设）/);
	assert.match(r.appendMarkdown, /资深写手/);
	assert.ok(!r.appendMarkdown.includes("白描"));
	assert.ok(parsePromptEntries(r.appendMarkdown).every((e) => e.source?.kind === "preset"));
	assert.equal(stripPresetEntries(r.appendMarkdown), "", "产物全是预设条目 ⇒ 剥净");

	// AGENTS：文风活条目；机制块关闭条目；预设里关着的块＝上游开关的结果，不落任何形态
	assert.match(r.agentsSection, /## 文风（预设）/);
	assert.match(r.agentsSection, /白描/);
	assert.match(r.agentsSection, /<!--\n## 思考（预设）/);
	assert.match(r.agentsSection, /<!--\n## 格式（预设）/);
	assert.ok(!r.agentsSection.includes("不该出现"));
	assert.ok(!r.agentsSection.includes("资深写手"));
	assert.ok(!r.agentsSection.includes("<Lore>")); // wrapper 不落任何形态

	// 条目引擎能解析产物：来源全是 preset，关闭的机制条目 enabled=false 且不进送模
	const entries = parsePromptEntries(r.agentsSection);
	assert.deepEqual(
		entries.map((e) => [e.title, e.source?.kind, e.enabled]),
		[
			["文风", "preset", true],
			["思考", "preset", false],
			["格式", "preset", false],
		],
	);

	// 去向账
	const byAction = (a: string) => r.lines.filter((l) => l.action === a).map((l) => l.identifier);
	assert.deepEqual(byAction("append"), ["main"]);
	assert.deepEqual(byAction("agents"), ["style"]);
	assert.deepEqual(byAction("wrapper"), ["w1", "w2"]);
	assert.deepEqual(byAction("disabled"), ["cot", "fmt"]);
	assert.deepEqual(byAction("skipped-disabled"), ["off"]);
	assert.deepEqual(byAction("dropped-prefill"), ["pf"]);
	assert.deepEqual(byAction("skipped-marker"), ["worldInfoBefore"]);
});

test("translatePresetWithDeclaration：预设开关拨动后重编译，产物跟着变（选项在上游）", () => {
	const flipped = JSON.parse(JSON.stringify(rawPreset)) as typeof rawPreset;
	const order = (flipped.prompt_order as Array<{ order: Array<{ identifier: string; enabled: boolean }> }>)[0].order;
	for (const o of order) {
		if (o.identifier === "off") o.enabled = true;
		if (o.identifier === "style") o.enabled = false;
	}
	const doc2 = loadPresetDoc(flipped, "测试预设");
	const pieces = declarePieces(assembleForDeclare(doc2, { charName: "角色", userName: "用户" }));
	assert.ok(pieces.some((p) => p.id === "off") && !pieces.some((p) => p.id === "style"));
	const parsed = parseDeclareResponse(JSON.stringify([{ id: "off", station: "writing" }]), pieces);
	const r = translatePresetWithDeclaration(
		doc2,
		{ version: 1, preset: "测试预设", createdAt: "2026-09-12T00:00:00.000Z", entries: parsed.entries },
		{ charName: "角色", userName: "用户" },
	);
	assert.match(r.agentsSection, /## 关闭的（预设）\n\n不该出现/);
	assert.ok(!r.agentsSection.includes("白描"));
});

test("stripPresetEntries：剥掉（预设）来源条目（含注释态），保留用户自己的与世界书来源的", () => {
	const mixed = [
		"# 我的档案",
		"",
		"## 世界观（预设）",
		"",
		"预设内容。",
		"",
		"<!--",
		"## 轻小说文风（预设）",
		"",
		"关闭的选项。",
		"-->",
		"",
		"## 门派（世界书·大世界）",
		"",
		"世界书内容。",
		"",
		"## 用户自己的条目",
		"",
		"用户内容。",
		"",
	].join("\n");
	const stripped = stripPresetEntries(mixed);
	const entries = parsePromptEntries(stripped);
	assert.deepEqual(
		entries.map((e) => e.name),
		["我的档案", "门派（世界书·大世界）", "用户自己的条目"],
	);
	assert.ok(stripped.includes("用户内容"));
	assert.ok(stripped.includes("世界书内容"));
	assert.ok(!stripped.includes("预设内容"));
	assert.ok(!stripped.includes("轻小说文风"));
});

// ---------------- 机制二：模型处理（2026-09-14 与声明并存、按预设自选） ----------------

test("compilePreset：{{char}}/{{user}} 留占位，指纹对开关/内容敏感；处理提示词用标签段契约", () => {
	const rawWithUser = JSON.parse(JSON.stringify(rawPreset)) as typeof rawPreset;
	rawWithUser.prompts[0].content = "你是资深写手，为{{user}}执笔。";
	const pieces = compiledPieces(compilePreset(loadPresetDoc(rawWithUser, "测试预设")));
	assert.ok(pieces.some((p) => p.text.includes("{{user}}")));

	const fp1 = presetFingerprint(doc);
	const flipped = JSON.parse(JSON.stringify(rawPreset)) as typeof rawPreset;
	const order = (flipped.prompt_order as Array<{ order: Array<{ identifier: string; enabled: boolean }> }>)[0].order;
	for (const o of order) if (o.identifier === "off") o.enabled = true;
	assert.notEqual(presetFingerprint(loadPresetDoc(flipped, "测试预设")), fp1, "开关变化指纹必须变");

	const p = buildProcessPrompt(pieces, { preset: "测试预设" });
	assert.ok(p.systemPrompt.includes("<identity>"));
	assert.ok(p.systemPrompt.includes("<dropped>"));
	assert.ok(!p.systemPrompt.includes("输出 JSON"), "正文不再要求装进 JSON 字符串");
	assert.ok(p.userText.includes("⟦片段1"));
});

test("parseProcessResponse：标签段契约——正文分行、裸引号天然无恙；JSON 兜底（含裸换行/裸引号/尾逗号修复）", () => {
	// 实弹病样（爱用"～""呢" 裸引号＋多行正文）在标签段下根本不经转义，原样保留
	const tagged = [
		"好的：",
		"<identity>",
		"口吻：慵懒、软糯、妩媚，尾音适当拖长，爱用\"～\"\"呢\"\"嘛\"\"啦\"",
		"态度：不解释、不争辩。",
		"</identity>",
		"",
		"<writing>",
		"## 人称视角",
		"本轮使用第二人称叙述。",
		"</writing>",
		"",
		"<dropped>",
		"- 上下文结束标签——材料包装：包裹内容槽位标签",
		"- 狐言狐语",
		"</dropped>",
	].join("\n");
	const r = parseProcessResponse(tagged);
	assert.ok(r);
	assert.equal(r.identity, '口吻：慵懒、软糯、妩媚，尾音适当拖长，爱用"～""呢""嘛""啦"\n态度：不解释、不争辩。');
	assert.equal(r.writing, "## 人称视角\n本轮使用第二人称叙述。");
	assert.deepEqual(r.dropped, [
		{ name: "上下文结束标签", reason: "材料包装：包裹内容槽位标签" },
		{ name: "狐言狐语", reason: "" },
	]);

	// JSON 兜底：合法 JSON 直收
	const good = parseProcessResponse('{"identity":"你是作家。","writing":"白描。","dropped":[{"name":"思考","reason":"思考协议"}]}');
	assert.ok(good);
	assert.deepEqual(good.dropped, [{ name: "思考", reason: "思考协议" }]);
	// 裸换行（实弹主死因）修复
	const bareNewline = parseProcessResponse('{\n"identity": "你是作家。\n第一条守则。",\n"writing": "w",\n"dropped": []\n}');
	assert.ok(bareNewline);
	assert.equal(bareNewline.identity, "你是作家。\n第一条守则。");
	// 裸引号（实弹第二例）＋尾逗号修复
	const bareQuote = parseProcessResponse('{"identity":"爱用"～""呢"之后离开",\n"writing":"w","dropped":[{"name":"n","reason":"r",},],}');
	assert.ok(bareQuote);
	// 病样解析失败时带出报错文案（失败留档用）
	const bad = parseProcessResponseWithError("抱歉我不能");
	assert.equal(bad.value, null);
	assert.match(bad.parseError ?? "", /标签段/);
});

test("processIntoEntries：两条固定条目、占位按卡求值、空产物不落条目", () => {
	const r = processIntoEntries(
		{ identity: "你是为{{user}}执笔的作家。\n## 作家信条\n专注。", writing: "文风：白描为主。" },
		{ charName: "云澜", userName: "明月" },
	);
	const appendEntries = parsePromptEntries(r.appendMarkdown);
	assert.equal(appendEntries.length, 1);
	assert.equal(appendEntries[0].name, "预设提示词（预设）");
	assert.ok(appendEntries[0].content.includes("为明月执笔"));
	assert.ok(appendEntries[0].content.includes("＃ 作家信条"), "正文里的 # 标题被转义，不割裂条目");

	const agentsEntries = parsePromptEntries(r.agentsSection);
	assert.equal(agentsEntries.length, 1);
	assert.equal(agentsEntries[0].name, "预设写作规则（预设）");

	// 换卡：占位符按新卡求值，条目名不变；空产物不落条目
	const r2 = processIntoEntries({ identity: "为{{user}}执笔。", writing: "" }, { charName: "大乾", userName: "怀瑾" });
	assert.ok(r2.appendMarkdown.includes("为怀瑾执笔"));
	assert.equal(r2.agentsSection, "");
});

test("EJS + authorScripts 接入：异步编译与转译支持条件分支与预设变量，普通块仍与原版逐字节一致", async () => {
	const ejsPresetRaw: Record<string, unknown> = {
		prompts: [
			{
				identifier: "id_block",
				name: "身份",
				role: "system",
				content: "为{{char}}与{{user}}执笔。",
			},
			{
				identifier: "ejs_style",
				name: "条件文风",
				role: "system",
				content: "<% if (getvar('pov') === 'second') { %>使用第二人称。<% } else { %>使用第三人称。<% } %>",
			},
			{
				identifier: "chatHistory",
				name: "Chat History",
				marker: true,
			},
			{
				identifier: "pf",
				name: "预填",
				role: "assistant",
				content: "OUTPUT",
			},
		],
		prompt_order: [
			{
				character_id: 100001,
				order: [
					{ identifier: "id_block", enabled: true },
					{ identifier: "ejs_style", enabled: true },
					{ identifier: "chatHistory", enabled: true },
					{ identifier: "pf", enabled: true },
				],
			},
		],
		extensions: {
			tavern_helper: {
				variables: { pov: "second" },
			},
		},
	};
	const ejsDoc = loadPresetDoc(ejsPresetRaw, "EJS测试预设");
	const pieces = declarePieces(await compilePresetWithEjs(ejsDoc));
	assert.equal(pieces.length, 2, "预填位剔除，剩余身份与条件文风 2 段");
	assert.equal(pieces[0]!.text, "为{{char}}与{{user}}执笔。", "全局声明阶段保留占位符");
	assert.equal(pieces[1]!.text, "使用第二人称。", "EJS 读取 authorScripts 变量并展开分支");

	const decl: PresetDeclaration = {
		version: 1,
		preset: "EJS测试预设",
		createdAt: "2026-11-14T00:00:00.000Z",
		entries: [
			{ identifier: "id_block", name: "身份", role: "system", where: "before", chars: 15, station: "identity" },
			{ identifier: "ejs_style", name: "条件文风", role: "system", where: "before", chars: 7, station: "writing" },
		],
	};
	const tr = await translatePresetWithDeclarationAsync(ejsDoc, decl, { charName: "云澜", userName: "沈舟" });
	assert.ok(tr.appendMarkdown.includes("为云澜与沈舟执笔。"));
	assert.ok(tr.agentsSection.includes("## 条件文风（预设）\n\n使用第二人称。"));
	assert.equal(tr.lines.some((l) => l.action === "dropped-prefill"), true);
});

