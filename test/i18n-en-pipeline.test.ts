import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildImportBlock } from "../src/chatlog.ts";
import { localizedCommands } from "../src/commands.ts";
import { applyDraftEdits } from "../src/draft.ts";
import { buildGreeting } from "../src/greeting.ts";
import { setUiLocale } from "../src/i18n/index.ts";
import { formatPanelSnapshot } from "../src/panels.ts";
import { buildDeclarePrompt, buildProcessPrompt, declareTranslateReport } from "../src/preset-declare.ts";
import { describeAsk, sandboxScope, sandboxVerdict } from "../src/sandbox.ts";
import { buildLoreAliasPrompt, buildRpSummaryPrompt, buildScribeTurnPrompt } from "../src/scribe.ts";
import { agentSystemPrompt, AGENT_ASK_TOOL, AGENT_SCREENSHOT_TOOL, buildAgentStateBlock } from "../src/stage/agent.ts";
import { buildStageInjection, buildStageSystemPrompt, formatLoreIndex } from "../src/stage/assemble.ts";
import { authoringTools } from "../src/stage/authoring.ts";
import { btwSystemPrompt, buildBtwCardBrief, buildBtwStageBlock, resolveBtwPersonaTemplates } from "../src/stage/btw.ts";
import { agentHistory, buildDiscussionSummaryPrompt, serializeDiscussion } from "../src/stage/discussion.ts";
import { mediaStageTools } from "../src/stage/media-stage.ts";
import { packContextIntoToolDescription } from "../src/stage/provider-relay.ts";
import { describeChange, formatStoryIndex } from "../src/stage/story-history.ts";
import { skillReadTool, stageTools, writeTools } from "../src/stage/tools.ts";
import { createWorkspace, runWriteTool } from "../src/stage/workspace.ts";
import { defaultState, formatRosterIndex, formatState } from "../src/state.ts";
import { checkWriteGate } from "../src/tools/gate.ts";
import { readLocalizedGlobalSlot, shippedSlotPrompt, type ShippedSlotName } from "../src/user-rules.ts";
import type { CharacterCard, RpConfig } from "../src/types.ts";

const HAN = /[㐀-鿿豈-﫿]/;
/** 允许出现在英文输出中的磁盘目录/文件名协议（docs/PLAN-I18N.md 定案不动磁盘协议） */
const stripDiskProtocol = (s: string): string =>
	s
		.replace(/正文\//g, "")
		.replace(/记忆\/\*\.md/g, "")
		.replace(/记忆\//g, "")
		.replace(/局\/[^\s`"')]+/g, "")
		.replace(/记忆\.md/g, "")
		.replace(/常驻摘要\.md/g, "")
		.replace(/预设声明-\*\.json/g, "");

const assertNoHan = (label: string, text: string) => {
	const cleaned = stripDiskProtocol(text);
	const m = HAN.exec(cleaned);
	assert.equal(
		m,
		null,
		`${label} still contains Chinese characters near: "${m ? cleaned.slice(Math.max(0, m.index - 20), m.index + 40) : ""}"`,
	);
};

test("en full pipeline: shipped global .md templates switch automatically when unmodified and preserve custom edits", () => {
	const dir = mkdtempSync(join(tmpdir(), "liyuan-i18n-slots-"));
	try {
		const slots: ShippedSlotName[] = ["SYSTEM.md", "APPEND_SYSTEM.md", "AGENT_APPEND_SYSTEM.md", "BTW_APPEND_SYSTEM.md"];
		setUiLocale("en");
		for (const slot of slots) {
			const enText = shippedSlotPrompt(slot, "en");
			assert.ok(enText.trim().length > 20, `${slot} en template should be non-empty`);
			assertNoHan(`shippedSlotPrompt(${slot}, en)`, enText);

			// 盘上存中文原版（未手改）→ 切英文自动返回英文正本
			const zhText = shippedSlotPrompt(slot, "zh");
			const p = join(dir, slot);
			writeFileSync(p, zhText, "utf8");
			assert.equal(readLocalizedGlobalSlot(p, slot).trim(), enText.trim());

			// 用户手改后 → 绝不覆盖
			const custom = `${zhText}\nCustom user rule.`;
			writeFileSync(p, custom, "utf8");
			assert.equal(readLocalizedGlobalSlot(p, slot), custom);
		}
	} finally {
		setUiLocale("zh");
		rmSync(dir, { recursive: true, force: true });
	}
});

test("en full pipeline: roleplay / agent / btw / scribe / preset / tools emit zero Chinese", () => {
	setUiLocale("en");
	try {
		const card: CharacterCard = {
			name: "Lyra",
			description: "An astronomer in the clockwork citadel.",
			personality: "Curious and dry-witted.",
			scenario: "Observatory tower at midnight.",
			firstMes: "Look at the southern lens, {{user}}.",
			mesExample: "{{char}}: The stars never lie.",
			systemPrompt: "Keep dialogue crisp.",
			postHistoryInstructions: "Stay in character.",
			creatorNotes: "",
			tags: ["sci-fi"],
			alternateGreetings: ["Another evening on the roof."],
			book: [],
		};
		const config: RpConfig = {
			card: "cards/lyra/card.json",
			userName: "Alex",
			userPersona: "Apprentice cartographer.",
			language: "English",
			uiLanguage: "en",
			compactEveryNTurns: 30,
			historyWindow: 40,
			loreMaxHits: 5,
			loreBudgetChars: 8000,
		};
		const state = {
			...defaultState(),
			time: "Day 1 Midnight",
			location: "Observatory",
			characters: { Lyra: { affinity: 12, status: "Focused", notes: "Holding brass astrolabe", at: "" } },
			inventory: ["Star chart (held by Alex)"],
			flags: { eclipse_started: "true" },
			plot_threads: ["Investigate the missing lens"],
			roster: {
				characters: { Lyra: "Day 1" },
				places: { Observatory: "Day 1" },
				items: { "Star chart": "Day 1" },
				events: { "Investigate the missing lens": "Day 1" },
			},
		};

		// 1. Roleplay assembly & state/roster/panels/greeting/import
		const sys = buildStageSystemPrompt({
			card,
			config,
			constantLore: [{ uid: 1, comment: "Citadel", keys: ["citadel"], content: "Built atop a ridge.", constant: true, enabled: true }],
			userRules: {
				global: shippedSlotPrompt("APPEND_SYSTEM.md", "en"),
				agent: shippedSlotPrompt("AGENT_APPEND_SYSTEM.md", "en"),
				btw: shippedSlotPrompt("BTW_APPEND_SYSTEM.md", "en"),
				card: "",
			},
			mcpTools: [{ name: "mcp__vision__analyze_image", description: "Inspect an image" }],
		});
		assertNoHan("buildStageSystemPrompt", sys);

		const loreIdx = formatLoreIndex([{ comment: "Astrolabe", keys: ["astrolabe"], enabled: true, constant: false }]);
		assert.ok(loreIdx);
		assertNoHan("formatLoreIndex", loreIdx);

		const rosterIdx = formatRosterIndex(state);
		assertNoHan("formatRosterIndex", rosterIdx);
		assertNoHan("formatState", formatState(state));

		const panelSnap = formatPanelSnapshot({
			Map: { name: "Map", kind: "markdown", content: "North tower", updatedAt: 1 },
		});
		assert.ok(panelSnap);
		assertNoHan("formatPanelSnapshot", panelSnap);

		const inj = buildStageInjection({
			state,
			activatedLore: [{ uid: 2, comment: "Astrolabe", keys: ["astrolabe"], content: "Brass relic.", constant: false, enabled: true }],
			card,
			config,
			panelIndex: panelSnap,
			wordRange: { min: 400, max: 800 },
			loreIndex: loreIdx,
			rosterIndex: rosterIdx,
			memoryRecall: "Earlier they met on the stairs.",
			directorNote: "Keep the pacing tense.",
		});
		assertNoHan("buildStageInjection", inj);
		assertNoHan("buildGreeting", buildGreeting(card, config));
		assertNoHan(
			"buildImportBlock",
			buildImportBlock({
				summary: "They met at dusk.",
				recentTurns: [{ name: "Lyra", role: "assistant", text: "Welcome." }],
				charName: "Lyra",
				userName: "Alex",
			}),
		);

		// 2. Agent mode & discussion compaction
		assertNoHan(
			"agentSystemPrompt",
			agentSystemPrompt({
				cwd: "/tmp/proj",
				cardPath: "cards/lyra/card.json",
				chatDir: "/tmp/proj/chat1",
				storyDir: "/tmp/proj/chat1/story",
				macro: { charName: "Lyra", userName: "Alex" },
			}),
		);
		assertNoHan(
			"buildAgentStateBlock",
			buildAgentStateBlock({
				state,
				rosterIndex: rosterIdx,
				summary: "Chapter 1 set the stage.",
				files: [{ name: "001-Opening.md", chars: 1200, mtime: Date.now() }],
			}),
		);
		assertNoHan("formatStoryIndex", formatStoryIndex([{ name: "001-Opening.md", chars: 1200, mtime: Date.now() }]));
		assertNoHan("describeChange", describeChange({ added: ["001.md"], modified: ["002.md"], renamed: [["a.md", "b.md"]], removed: ["003.md"] }));
		assertNoHan("AGENT_ASK_TOOL", JSON.stringify(AGENT_ASK_TOOL));
		assertNoHan("AGENT_SCREENSHOT_TOOL", JSON.stringify(AGENT_SCREENSHOT_TOOL));

		const discHistory = agentHistory([
			{ id: "s1", type: "custom", customType: "liyuan-discussion-summary", data: { summary: "Agreed on tone.", firstKeptEntryId: "m1" } },
			{ id: "m1", type: "message", message: { role: "user", content: "Continue chapter 2." } },
		]);
		assertNoHan("agentHistory", JSON.stringify(discHistory));
		assertNoHan(
			"serializeDiscussion",
			serializeDiscussion([
				{ role: "user", content: "Edit opening" },
				{ role: "assistant", content: [{ type: "text", text: "Sure." }, { type: "toolCall", name: "read", arguments: { path: "001.md" } }] },
				{ role: "toolResult", toolName: "read", content: "Once upon a time." },
			]),
		);
		const discPrompt = buildDiscussionSummaryPrompt({ conversationText: "User: hi", previousSummary: "Old summary" });
		assertNoHan("buildDiscussionSummaryPrompt.system", discPrompt.systemPrompt);
		assertNoHan("buildDiscussionSummaryPrompt.user", discPrompt.userText);

		// 3. Side assistant (/btw)
		const btwTemplates = resolveBtwPersonaTemplates(undefined, "en");
		assertNoHan("resolveBtwPersonaTemplates", JSON.stringify(btwTemplates));
		const brief = buildBtwCardBrief({ card, userName: "Alex", userPersona: config.userPersona, macro: { charName: "Lyra", userName: "Alex" } });
		assertNoHan("buildBtwCardBrief", brief);
		assertNoHan(
			"btwSystemPrompt",
			btwSystemPrompt({
				cwd: "/tmp/proj",
				cardPath: config.card,
				chatDir: "/tmp/proj/chat1",
				cardBrief: brief,
				macro: { charName: "Lyra", userName: "Alex" },
			}),
		);
		assertNoHan(
			"buildBtwStageBlock",
			buildBtwStageBlock({
				state,
				rosterIndex: rosterIdx,
				summary: "Recap text.",
				history: [{ role: "user", text: "Hello" }, { role: "assistant", text: "Hi there." }],
				charName: "Lyra",
				userName: "Alex",
			}),
		);

		// 4. Scribe / summary / alias / preset declaration
		const scribePrompt = buildScribeTurnPrompt({
			state,
			userText: "I check the lens.",
			assistantText: "Lyra adjusts the focus.",
			charName: "Lyra",
			userName: "Alex",
			mvu: { tree: { hp: 10 }, rules: "Decrease hp on injury." },
			panels: [{ name: "Map", tree: { floor: 2 } }],
		});
		assertNoHan("buildScribeTurnPrompt.system", scribePrompt.systemPrompt);
		assertNoHan("buildScribeTurnPrompt.user", scribePrompt.userText);

		const rpSum = buildRpSummaryPrompt({
			conversationText: "Alex: Hi\nLyra: Hello",
			stateSnapshot: formatState(state),
			previousSummary: "Earlier summary.",
			language: "English",
			userName: "Alex",
		});
		assertNoHan("buildRpSummaryPrompt.system", rpSum.systemPrompt);
		assertNoHan("buildRpSummaryPrompt.user", rpSum.userText);

		const aliasPrompt = buildLoreAliasPrompt([{ uid: 1, keys: ["astrolabe"], comment: "Astrolabe", excerpt: "A brass device." }]);
		assertNoHan("buildLoreAliasPrompt.system", aliasPrompt.systemPrompt);
		assertNoHan("buildLoreAliasPrompt.user", aliasPrompt.userText);

		const declPrompt = buildDeclarePrompt(
			[{ id: "p1", name: "Main", role: "system", where: "before", text: "Write vividly." }],
			{ preset: "DemoPreset" },
		);
		assertNoHan("buildDeclarePrompt.system", declPrompt.systemPrompt);
		assertNoHan("buildDeclarePrompt.user", declPrompt.userText);
		const procPrompt = buildProcessPrompt(
			[{ source: "block", id: "p1", name: "Main", role: "system", where: "before", text: "Write vividly." }],
			{ preset: "DemoPreset" },
		);
		assertNoHan("buildProcessPrompt.system", procPrompt.systemPrompt);
		assertNoHan("buildProcessPrompt.user", procPrompt.userText);
		assertNoHan(
			"declareTranslateReport",
			declareTranslateReport(
				{ name: "DemoPreset", entries: [], samplers: {}, raw: {} as never },
				{
					appendMarkdown: "",
					agentsSection: "Rule",
					lines: [{ identifier: "p1", name: "Main", chars: 10, action: "agents", station: "writing", note: "prose rule" }],
					samplers: {},
					usesLastUserMessage: [],
					unsupportedMacros: [],
				},
				{ version: 1, preset: "DemoPreset", createdAt: "2026-11-21", entries: [] },
				"assets/presets/demo.json",
			),
		);

		// 5. All tool schemas & key receipts
		const allTools = [
			...stageTools("English", {
				searchLore: () => [],
				listLore: () => [],
				fingerprint: (s) => s,
				toggleLore: () => 0,
				listBooks: () => ({ books: [], mounted: [] }),
				mountBook: () => [],
				createBook: () => null,
				writeLore: () => null,
				updateLore: () => null,
				deleteLore: () => null,
				searchMemory: async () => [],
				addMemory: async () => ({ added: 0, total: 0, chunks: 0 }),
				listMemory: () => [],
				deleteMemory: () => false,
				readMemory: () => undefined,
				updateMemory: () => ({ ref: "x", version: "1", text: "" }),
				readCard: () => card,
				loadWorldline: () => ({ saves: [], currentSaveId: null }),
				storeSave: () => null,
				loadPanels: () => ({}),
				writePanel: () => ({ ok: true, created: true, reopened: false, activeCount: 1, overLimit: false }),
				closePanel: () => ({ ok: true }),
				getState: () => state,
				formatState,
			}),
			skillReadTool("English", [{ name: "dice", description: "Roll dice" }]),
			...writeTools("English"),
			...mediaStageTools("English", { tts: true }),
			...authoringTools("English", {
				readCard: () => card,
				createCard: () => null,
				listCards: () => ({ cards: [], current: "" }),
				project: async () => ({}),
			}),
		];
		assertNoHan("allTools schemas", JSON.stringify(allTools));

		const ws = createWorkspace();
		const wr = runWriteTool(ws, { rules: {}, userName: "Alex", charName: "Lyra" }, "draft_write", { version: 0, content: "Stars glowed." });
		assertNoHan("runWriteTool(draft_write)", `${wr.text} | ${wr.activity ?? ""}`);
		const badEdit = applyDraftEdits("Stars glowed.", [{ old: "nonexistent", new: "x" }]);
		assertNoHan("applyDraftEdits error", badEdit.details.join("\n"));

		const gateRes = checkWriteGate({ toolName: "memory_add", lastUserText: "hello", creationMode: "ask" });
		assert.equal(gateRes.allow, false);
		if (!gateRes.allow) assertNoHan("checkWriteGate", gateRes.reason);

		const scope = sandboxScope("/tmp/liyuan", { card: "cards/lyra/card.json" });
		const verdict = sandboxVerdict("bash", { command: "echo hi" }, scope, { dirs: [], bashAllow: [] });
		if (verdict.kind === "ask-bash") {
			const askCard = describeAsk(verdict, scope);
			assertNoHan("sandbox describeAsk", JSON.stringify(askCard));
		}

		const packed = packContextIntoToolDescription(
			{
				messages: [
					{ role: "system", content: "System instructions for the run." },
					{ role: "user", content: "First turn." },
					{ role: "assistant", content: "First reply." },
					{ role: "user", content: "Second turn." },
				],
			},
			"openai-completions",
		);
		assert.equal(packed.packed, true);
		assertNoHan("packContextIntoToolDescription", JSON.stringify(packed.payload));

		// 6. Commands
		assertNoHan("localizedCommands(en)", JSON.stringify(localizedCommands("en")));
	} finally {
		setUiLocale("zh");
	}
});
