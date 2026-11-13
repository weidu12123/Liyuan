import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadCardFile } from "../src/card.ts";
import {
	compileStagePromptTemplates,
	createEjsContext,
	evalEjsTemplate,
	evalLoreEntryContent,
	evaluateDecoratorIf,
	getEjsSyntaxErrorInfo,
	parseWorldInfoDecorators,
} from "../src/ejs-engine.ts";
import { findInitVar, seedMvuIfNeeded } from "../src/mvu.ts";
import { renderForModel } from "../src/prompt-entries.ts";
import { defaultState } from "../src/state.ts";
import type { LorebookEntry, WorldState } from "../src/types.ts";

function findCardPng(dir: string): string | null {
	if (!existsSync(dir)) return null;
	const png = readdirSync(dir).find((f) => f.endsWith(".png"));
	return png ? join(dir, png) : null;
}

describe("ST-Prompt-Template EJS Engine (Knife 1)", () => {
	it("evaluates basic EJS tags, <%_ _%> whitespace slurping, print(), and <#escape-ejs>", async () => {
		const state = defaultState();
		state.mvu = { fame: 20, arousal: 60, 核心状态: { 快感值: [35, 100] } };
		const ctx = createEjsContext({ state, userName: "韩立", charName: "南宫婉" });

		const tpl = [
			"<%_ if (getvar('stat_data.fame', { defaults: 0 }) <= 30) { _%>",
			"【初涉江湖】",
			"<%_ } else { _%>",
			"【声名远播】",
			"<%_ } _%>",
			"快感:<%= getvar('stat_data.核心状态.快感值[0]') %>",
			"<% print('角色:' + charName) -%>",
			"<#escape-ejs><%= not_evaluated %><#/escape-ejs>",
		].join("\n");

		const out = await evalEjsTemplate(tpl, ctx);
		assert.ok(out.includes("【初涉江湖】"));
		assert.ok(!out.includes("【声名远播】"));
		assert.ok(out.includes("快感:35"));
		assert.ok(out.includes("角色:南宫婉"));
		assert.ok(out.includes("<%= not_evaluated %>"));
	});

	it("handles arrow functions (=>) and comparison operators (>) inside <% ... %> blocks", async () => {
		const state = defaultState();
		state.mvu = { items: ["筑基丹", "凝碧崖玉简", "青竹蜂云剑"] };
		const ctx = createEjsContext({ state });
		const tpl = `<% const filtered = (getvar('stat_data.items') || []).filter(x => x.length > 3); -%><%= filtered.join('、') %>`;
		const out = await evalEjsTemplate(tpl, ctx);
		assert.equal(out.trim(), "凝碧崖玉简、青竹蜂云剑");
	});

	it("pulls disabled worldinfo entries via await getwi(null, title) like 《道渊》v5.5.4", async () => {
		const entries: LorebookEntry[] = [
			{
				uid: 1,
				comment: "玄天界介绍",
				content: "玄天界乃下界三千大世界之一，主角：{{user}}。",
				keys: [],
				secondaryKeys: [],
				constant: true,
				enabled: false,
				selective: false,
				order: 100,
			},
			{
				uid: 2,
				comment: "玄天界灵石体系",
				content: "下品、中品、上品、极品灵石（当前境界：<%= getvar('stat_data.realm', { defaults: '炼气期' }) %>）。",
				keys: [],
				secondaryKeys: [],
				constant: true,
				enabled: false,
				selective: false,
				order: 101,
			},
		];
		const state = defaultState();
		state.mvu = { realm: "筑基中期" };
		const ctx = createEjsContext({ state, allLoreEntries: entries, userName: "林玄", charName: "道渊" });
		const switchTpl = `<%- await getwi(null, '玄天界介绍') -%>\n<%- await getwi(null, '玄天界灵石体系') -%>`;
		const out = await evalEjsTemplate(switchTpl, ctx);
		assert.ok(out.includes("玄天界乃下界三千大世界之一，主角：林玄。"));
		assert.ok(out.includes("当前境界：筑基中期"));
		assert.ok(ctx.__inlinedLoreUids.has(1));
		assert.ok(ctx.__inlinedLoreUids.has(2));
	});

	it("parses @@preprocessing, @@if, and @@endif like 《凡人修仙传_v1》 and 《母马之城》", async () => {
		const controllerEntry = {
			comment: "[系统]EJS·章节控制器",
			content: `@@preprocessing\n<%_ globalThis._fanrenSeg = '011-020'; _%>\n参考章节段:<%= globalThis._fanrenSeg %>`,
		};
		const seg1 = {
			comment: "[凡界篇剧情]第001-010章摘要",
			content: `@@if (typeof globalThis !== 'undefined' && globalThis._fanrenSeg === '001-010')\n七玄门开篇剧情\n@@endif`,
		};
		const seg2 = {
			comment: "[凡界篇剧情]第011-020章摘要",
			content: `@@if (typeof globalThis !== 'undefined' && globalThis._fanrenSeg === '011-020')\n墨大夫夺舍剧情\n@@endif`,
		};

		const ctx = createEjsContext({});
		const ctrlDec = parseWorldInfoDecorators(controllerEntry);
		assert.equal(ctrlDec.isPreprocessing, true);
		const ctrlOut = await evalEjsTemplate(ctrlDec.cleanContent, ctx);
		assert.equal(ctrlOut.trim(), "参考章节段:011-020");

		const seg1Dec = parseWorldInfoDecorators(seg1);
		const seg2Dec = parseWorldInfoDecorators(seg2);
		assert.equal(await evaluateDecoratorIf(seg1Dec.ifConditions, ctx), false);
		assert.equal(await evaluateDecoratorIf(seg2Dec.ifConditions, ctx), true);
		assert.equal(seg2Dec.cleanContent.trim(), "墨大夫夺舍剧情");
	});

	it("supports setvar, incvar, decvar, delvar, insvar, define, and injectPrompt/getPromptsInjected", async () => {
		const state = defaultState();
		state.mvu = { hp: 50, bag: ["铁剑"] };
		const ctx = createEjsContext({ state });

		const code = `<%_
			define('greet', function(who) { return '你好,' + who + '(' + this.getvar('stat_data.hp') + ')'; });
			incvar('stat_data.hp', 25, { max: 100 });
			insvar('stat_data.bag', '回春丹');
			injectPrompt('CoT', '步骤2', 20);
			injectPrompt('CoT', '步骤1', 10);
		_%><%= greet('师姐') %>|<%= getvar('stat_data.bag').join(',') %>|<%= getPromptsInjected('CoT') %>`;

		const out = await evalEjsTemplate(code, ctx);
		assert.equal(out, "你好,师姐(75)|铁剑,回春丹|步骤1\n步骤2");
		assert.equal(state.mvu?.hp, 75);
	});

	it("extracts [InitialVariables] and @@initial_variables in findInitVar", () => {
		const tree1 = findInitVar([
			{
				comment: "[InitialVariables] 角色初值",
				content: `{"哈基米": {"好感度": 10, "状态": "正常"}}`,
			},
		]);
		assert.deepEqual(tree1, { 哈基米: { 好感度: 10, 状态: "正常" } });

		const tree2 = findInitVar([
			{
				comment: "变量表",
				content: `@@initial_variables\n主角:\n  境界: 炼气一层\n  灵石: 100`,
			},
		]);
		assert.deepEqual(tree2, { 主角: { 境界: "炼气一层", 灵石: 100 } });

		const syntaxErr = getEjsSyntaxErrorInfo("<% if (a) { %>");
		assert.ok(syntaxErr.includes("<% if (a) { %>"));
		assert.equal(getEjsSyntaxErrorInfo("<% if (a) { %>ok<% } %>"), "");
	});

	it("compiles real cards (《道渊》, 《凡人修仙传_v1》, 《世子很凶》) via compileStagePromptTemplates", async () => {
		// 1. 《道渊》v5.2: 验证常驻开关 -内容控制开关-玄天界 (二选一) 通过 await getwi 拉取 9 大玄天界设定
		if (existsSync("cards/《道渊》v5.2/v5.2_1.png")) {
			const card = loadCardFile("cards/《道渊》v5.2/v5.2_1.png");
			const state = defaultState();
			const out = await compileStagePromptTemplates({
				cardAgentsRaw: "",
				cardAgentsRendered: "",
				entries: card.book,
				allLoreEntries: card.book,
				state,
				charName: card.name,
				userName: "测试修士",
			});
			const switchEntry = out.entries.find((e) => e.comment?.includes("-内容控制开关-玄天界"));
			assert.ok(switchEntry, "应找到玄天界开关条目");
			assert.ok(!switchEntry!.content.includes("getwi("), "getwi 调用应已被编译展开");
			assert.ok(switchEntry!.content.length > 1000, "应真实拉取出玄天界核心设定全文");
		}

		// 2. 《凡人修仙传_v1》: 验证 126 个 @@if 章节段只保留当前 _fanrenSeg 对应的那 1 段
		const fanrenPng = findCardPng("cards/凡人修仙传_v1");
		if (fanrenPng && existsSync("cards/凡人修仙传_v1/AGENTS.md")) {
			const card = loadCardFile(fanrenPng);
			const agentsRaw = readFileSync("cards/凡人修仙传_v1/AGENTS.md", "utf8");
			const state = seedMvuIfNeeded(defaultState(), card.book, "韩立", card.name, []) as WorldState;
			const out = await compileStagePromptTemplates({
				cardAgentsRaw: agentsRaw,
				cardAgentsRendered: renderForModel(agentsRaw),
				entries: card.book,
				allLoreEntries: card.book,
				state,
				charName: card.name,
				userName: "韩立",
			});
			assert.ok(!out.cardAgents.includes("@@if"), "编译后的 AGENTS.md 不应残留 @@if");
			assert.ok(!out.cardAgents.includes("@@preprocessing"), "编译后的 AGENTS.md 不应残留 @@preprocessing");
			assert.ok(!out.cardAgents.includes("<%"), "编译后的 AGENTS.md 不应残留未执行的 <% 标签");
			// 原本 7300+ 行（含 126 个章节段），过滤后应仅剩当前 001-010 章节段，长度大幅收敛
			assert.ok(out.cardAgents.length < agentsRaw.length * 0.25, `AGENTS.md 应大幅瘦身: ${out.cardAgents.length} vs ${agentsRaw.length}`);
		}

		// 3. 《世子很凶》: 验证 MVU 即时态势与动态人物 for 循环编译为干净中文态势
		const shiziPng = findCardPng("cards/《世子很凶》");
		if (shiziPng && existsSync("cards/《世子很凶》/AGENTS.md")) {
			const card = loadCardFile(shiziPng);
			const agentsRaw = readFileSync("cards/《世子很凶》/AGENTS.md", "utf8");
			const state = seedMvuIfNeeded(defaultState(), card.book, "赵景行", card.name, []) as WorldState;
			const out = await compileStagePromptTemplates({
				cardAgentsRaw: agentsRaw,
				cardAgentsRendered: renderForModel(agentsRaw),
				entries: card.book,
				allLoreEntries: card.book,
				state,
				charName: card.name,
				userName: "赵景行",
			});
			assert.ok(!out.cardAgents.includes("<%"), "《世子很凶》AGENTS.md 不应残留 <% 代码");
			assert.ok(out.cardAgents.includes("【时空经纬】："), "应输出编译后的【时空经纬】态势");
		}

		// 4. 《女尊宗门》: 验证绿灯人物条目在 lorebook_search 检索时动态编译境界字段
		const nvzunPng = findCardPng("cards/在表面光鲜尊贵实际全是宗主母畜的女尊宗门被当成了被宗主夺舍的新主人，我能扮演好主人并活下去吗？！");
		if (nvzunPng) {
			const card = loadCardFile(nvzunPng);
			const state = seedMvuIfNeeded(defaultState(), card.book, "谢普", card.name, []) as WorldState;
			const ejsCtx = createEjsContext({ state, allLoreEntries: card.book, charName: card.name, userName: "谢普" });
			const yewanjun = card.book.find((e) => e.comment === "叶婉君简介");
			assert.ok(yewanjun, "应找到叶婉君简介条目");
			const compiled = await evalLoreEntryContent(yewanjun!, ejsCtx, { charName: card.name, userName: "谢普" });
			assert.ok(!compiled.includes("<%"), "检索返回的叶婉君简介不应残留 <% 标签");
		}
	});
});
