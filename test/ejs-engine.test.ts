import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	compileStagePromptTemplates,
	createEjsContext,
	evalEjsTemplate,
	evalLoreEntryContent,
	evaluateDecoratorIf,
	getEjsSyntaxErrorInfo,
	parseWorldInfoDecorators,
} from "../src/ejs-engine.ts";
import { findInitVar } from "../src/mvu.ts";
import { renderForModel } from "../src/prompt-entries.ts";
import { defaultState } from "../src/state.ts";
import type { LorebookEntry } from "../src/types.ts";

describe("ST-Prompt-Template EJS Engine (Knife 1)", () => {
	it("evaluates basic EJS tags, <%_ _%> whitespace slurping, print(), and <#escape-ejs>", async () => {
		const state = defaultState();
		state.mvu = { fame: 20, energy: 60, 核心状态: { 灵力值: [35, 100] } };
		const ctx = createEjsContext({ state, userName: "沈舟", charName: "青梧" });

		const tpl = [
			"<%_ if (getvar('stat_data.fame', { defaults: 0 }) <= 30) { _%>",
			"【初涉江湖】",
			"<%_ } else { _%>",
			"【声名远播】",
			"<%_ } _%>",
			"灵力:<%= getvar('stat_data.核心状态.灵力值[0]') %>",
			"<% print('角色:' + charName) -%>",
			"<#escape-ejs><%= not_evaluated %><#/escape-ejs>",
		].join("\n");

		const out = await evalEjsTemplate(tpl, ctx);
		assert.ok(out.includes("【初涉江湖】"));
		assert.ok(!out.includes("【声名远播】"));
		assert.ok(out.includes("灵力:35"));
		assert.ok(out.includes("角色:青梧"));
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

	it("pulls disabled worldinfo entries via await getwi(null, title)", async () => {
		const entries: LorebookEntry[] = [
			{
				uid: 1,
				comment: "青云界介绍",
				content: "青云界乃下界三千世界之一，主角：{{user}}。",
				keys: [],
				secondaryKeys: [],
				constant: true,
				enabled: false,
				selective: false,
				order: 100,
			},
			{
				uid: 2,
				comment: "青云界灵石体系",
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
		const ctx = createEjsContext({ state, allLoreEntries: entries, userName: "沈舟", charName: "青梧" });
		const switchTpl = `<%- await getwi(null, '青云界介绍') -%>\n<%- await getwi(null, '青云界灵石体系') -%>`;
		const out = await evalEjsTemplate(switchTpl, ctx);
		assert.ok(out.includes("青云界乃下界三千世界之一，主角：沈舟。"));
		assert.ok(out.includes("当前境界：筑基中期"));
		assert.ok(ctx.__inlinedLoreUids.has(1));
		assert.ok(ctx.__inlinedLoreUids.has(2));
	});

	it("parses @@preprocessing, @@if, and @@endif conditional chapter blocks", async () => {
		const controllerEntry = {
			comment: "[系统]EJS·章节控制器",
			content: `@@preprocessing\n<%_ globalThis._chapterSeg = '011-020'; _%>\n参考章节段:<%= globalThis._chapterSeg %>`,
		};
		const seg1 = {
			comment: "[初卷剧情]第001-010章摘要",
			content: `@@if (typeof globalThis !== 'undefined' && globalThis._chapterSeg === '001-010')\n山门开篇剧情\n@@endif`,
		};
		const seg2 = {
			comment: "[初卷剧情]第011-020章摘要",
			content: `@@if (typeof globalThis !== 'undefined' && globalThis._chapterSeg === '011-020')\n秘境试炼剧情\n@@endif`,
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
		assert.equal(seg2Dec.cleanContent.trim(), "秘境试炼剧情");
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

	it("compiles conditional lorebooks, AGENTS templates, and dynamic entries via compileStagePromptTemplates", async () => {
		const entries: LorebookEntry[] = [
			{
				uid: 1,
				comment: "章节控制器",
				content: "@@preprocessing\n<%_ globalThis._arc = 'arc1'; _%>",
				keys: [],
				secondaryKeys: [],
				constant: true,
				enabled: true,
				selective: false,
				order: 10,
			},
			{
				uid: 2,
				comment: "第一卷摘要",
				content: "@@if (globalThis._arc === 'arc1')\n第一卷正文设定：青云山脉。\n@@endif",
				keys: [],
				secondaryKeys: [],
				constant: true,
				enabled: true,
				selective: false,
				order: 20,
			},
			{
				uid: 3,
				comment: "第二卷摘要",
				content: "@@if (globalThis._arc === 'arc2')\n第二卷正文设定：沧海群岛。\n@@endif",
				keys: [],
				secondaryKeys: [],
				constant: true,
				enabled: true,
				selective: false,
				order: 30,
			},
			{
				uid: 4,
				comment: "隐藏档案",
				content: "内部补充设定：主角当前境界 <%= getvar('stat_data.realm', { defaults: '筑基' }) %>",
				keys: [],
				secondaryKeys: [],
				constant: false,
				enabled: false,
				selective: false,
				order: 40,
			},
		];
		const state = defaultState();
		state.mvu = { realm: "金丹" };
		const rawAgents = [
			"# 角色档案",
			"",
			"## 第一卷摘要",
			"@@if (globalThis._arc === 'arc1')",
			"第一卷核心设定。",
			"@@endif",
			"",
			"## 第二卷摘要",
			"@@if (globalThis._arc === 'arc2')",
			"第二卷核心设定。",
			"@@endif",
			"",
			"## 态势",
			"【时空经纬】：<%= getvar('stat_data.realm') %> · <%- await getwi(null, '隐藏档案') -%>",
		].join("\n");
		const out = await compileStagePromptTemplates({
			cardAgentsRaw: rawAgents,
			cardAgentsRendered: renderForModel(rawAgents),
			entries,
			allLoreEntries: entries,
			state,
			charName: "青梧",
			userName: "沈舟",
		});
		assert.ok(!out.cardAgents.includes("<%"));
		assert.ok(out.cardAgents.includes("第一卷核心设定"));
		assert.ok(!out.cardAgents.includes("第二卷核心设定"));
		assert.ok(out.cardAgents.includes("【时空经纬】：金丹 · 内部补充设定：主角当前境界 金丹"));
		const kept = out.entries.filter((e) => e.enabled).map((e) => e.comment);
		assert.ok(kept.includes("第一卷摘要"));
		assert.ok(!kept.includes("第二卷摘要"));

		const dynEntry: LorebookEntry = {
			uid: 5,
			comment: "NPC简介",
			content: "当前状态：<%= getvar('stat_data.realm') %>",
			keys: ["NPC"],
			secondaryKeys: [],
			constant: false,
			enabled: true,
			selective: false,
			order: 50,
		};
		const ejsCtx = createEjsContext({ state, allLoreEntries: entries, charName: "青梧", userName: "沈舟" });
		const compiled = await evalLoreEntryContent(dynEntry, ejsCtx, { charName: "青梧", userName: "沈舟" });
		assert.equal(compiled.trim(), "当前状态：金丹");
	});
});
