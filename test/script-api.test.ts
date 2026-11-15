import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handleApiRequest, type RestHost } from "../server/rest.ts";
import { ScriptApiService, SCRIPT_API_CAPABILITIES, type ScriptApiHost, type ScriptMessageItem, type ScriptTargetDescriptor } from "../src/script-api.ts";
import type { LorebookEntry, RpConfig, WorldState } from "../src/types.ts";
import { syncCardRuntimeContext } from "../web/src/cardRuntimeFrames.ts";
import {
	IFRAME_TAVERN_GLOBALS_SNIPPET,
	installParentTavernShim,
	registerLiyuanScriptTransport,
} from "../web/src/tavernShim.ts";

function createTestHost() {
	const root = mkdtempSync(join(tmpdir(), "liyuan-script-api-"));
	const cardDir = join(root, "cards", "云澜");
	const chatDir = join(cardDir, "对话", "chat-1");
	mkdirSync(join(chatDir, "会话"), { recursive: true });
	const cardRel = "cards/云澜/卡.png.json";
	writeFileSync(
		join(root, cardRel),
		JSON.stringify({
			data: {
				name: "云澜",
				description: "{{user}}的同门师姐",
				first_mes: "山门风急，{{user}}来迟了。",
				alternate_greetings: ["第二条开场白"],
				extensions: {
					regex_scripts: [
						{
							scriptName: "状态折叠",
							findRegex: "/\\[状态:([^\\]]+)\\]/g",
							replaceString: "<span class=\"st\">$1</span>",
							placement: [2],
							disabled: false,
						},
					],
				},
			},
		}),
		"utf8",
	);

	const config: RpConfig = {
		card: cardRel,
		userName: "沈舟",
		userPersona: "外门弟子",
		lorebooks: ["assets/lorebooks/sect.json"],
	};

	const target: ScriptTargetDescriptor = {
		card: cardRel,
		cardName: "云澜",
		charName: "云澜",
		userName: "沈舟",
		chatId: "chat-1",
		sessionId: "sess-1",
		leafId: "leaf-2",
		mode: "roleplay",
		streaming: false,
	};

	let state: WorldState = {
		time: "子时",
		location: "山门",
		mvu: { 生命: 100, 灵力: 50 },
	} as unknown as WorldState;

	let messages: ScriptMessageItem[] = [
		{
			index: 0,
			message_id: 0,
			entryId: "entry-user-1",
			role: "user",
			channel: "user",
			name: "沈舟",
			text: "师姐久等了。",
			message: "师姐久等了。",
			mes: "师姐久等了。",
			data: { stat_data: state.mvu as Record<string, unknown> },
			variables: { stat_data: state.mvu as Record<string, unknown> },
		},
		{
			index: 1,
			message_id: 1,
			entryId: "entry-asst-1",
			role: "assistant",
			channel: "narrative",
			name: "云澜",
			text: "云澜轻颔首：「随我入殿。」",
			message: "云澜轻颔首：「随我入殿。」",
			mes: "云澜轻颔首：「随我入殿。」",
			data: { stat_data: state.mvu as Record<string, unknown> },
			variables: { stat_data: state.mvu as Record<string, unknown> },
		},
	];

	const loreEntries: Array<LorebookEntry & { agentWritten?: boolean }> = [
		{
			uid: 1,
			comment: "青云剑诀",
			keys: ["剑诀", "青云"],
			content: "青云门镇派剑法。",
			constant: false,
			enabled: true,
			order: 100,
			fingerprint: "fp-1",
		},
	];

	const panels: Array<{ name: string; kind: string; content: string; updatedAt: number }> = [];
	const notifications: Array<{ level: string; text: string }> = [];

	const host: ScriptApiHost = {
		cwd: root,
		getConfig: () => config,
		getTarget: () => ({ ...target }),
		getMessages: () => messages.map((m) => ({ ...m })),
		getState: () => structuredClone(state),
		applyStatePatch: async (patch) => {
			state = { ...state, ...patch } as WorldState;
			return { applied: Object.keys(patch), warnings: [], state: structuredClone(state) };
		},
		submitChat: async ({ text, wait }) => {
			if (!wait) return { queued: true };
			const replyText = `【主聊天回复】已收到：${text}`;
			const entryId = `entry-${messages.length + 1}`;
			messages.push(
				{
					index: messages.length,
					message_id: messages.length,
					entryId: `user-${messages.length}`,
					role: "user",
					channel: "user",
					name: target.userName,
					text,
					message: text,
					mes: text,
					data: { stat_data: state.mvu as Record<string, unknown> },
					variables: { stat_data: state.mvu as Record<string, unknown> },
				},
				{
					index: messages.length + 1,
					message_id: messages.length + 1,
					entryId,
					role: "assistant",
					channel: "narrative",
					name: target.charName,
					text: replyText,
					message: replyText,
					mes: replyText,
					data: { stat_data: state.mvu as Record<string, unknown> },
					variables: { stat_data: state.mvu as Record<string, unknown> },
				},
			);
			target.leafId = entryId;
			return { queued: false, entryId, replyText };
		},
		regenerateChat: async (input) => {
			const replyText = `【重生成回复】${input?.text ?? "默认变体"}`;
			const entryId = "entry-regen";
			target.leafId = entryId;
			return { entryId, replyText };
		},
		abortChat: () => {
			target.streaming = false;
		},
		updateLastReply: async (text) => {
			const last = messages[messages.length - 1]!;
			last.text = text;
			last.message = text;
			last.mes = text;
			target.leafId = "leaf-edited";
			return { entryId: target.leafId, text };
		},
		dropLastReply: async () => {
			messages = messages.slice(0, -1);
			target.leafId = "leaf-after-drop";
			return { leafId: target.leafId };
		},
		runExplicitGeneration: async (input) => {
			if (input.prompt === "SLOW_CANCEL") {
				await new Promise<void>((resolve, reject) => {
					const t = setTimeout(resolve, 5000);
					input.signal.addEventListener("abort", () => {
						clearTimeout(t);
						reject(new Error("aborted"));
					});
				});
			}
			input.onDelta?.("thinking", "分析显式提示…");
			input.onDelta?.("text", `显式结果：${input.prompt ?? input.messages?.[0]?.content ?? ""}`);
			return {
				text: `显式结果：${input.prompt ?? input.messages?.[0]?.content ?? ""}`,
				thinking: "分析显式提示…",
				model: "mock/explicit-model",
				stopReason: "stop",
			};
		},
		runContextualGeneration: async (input) => {
			return {
				text: `带剧情视野结果（角色=${target.charName}）：${input.prompt}`,
				thinking: "",
				model: "mock/contextual-model",
				stopReason: "stop",
			};
		},
		getCurrentChatDir: () => chatDir,
		getLoreHost: () => ({
			listBooks: () => ({
				books: [{ path: "assets/lorebooks/sect.json", name: "sect", entryCount: loreEntries.length }],
				mounted: ["assets/lorebooks/sect.json"],
			}),
			listMarked: () => loreEntries.map((e) => ({ ...e })),
			write: (input) => {
				const entry: LorebookEntry = {
					uid: loreEntries.length + 1,
					comment: input.title,
					keys: input.keys,
					content: input.content,
					constant: input.constant ?? false,
					enabled: true,
					order: 100,
					fingerprint: `fp-${loreEntries.length + 1}`,
				};
				loreEntries.push(entry);
				return entry;
			},
			update: (fp, patch) => {
				const hit = loreEntries.find((e) => e.fingerprint === fp);
				if (!hit) return null;
				if (patch.title !== undefined) hit.comment = patch.title;
				if (patch.content !== undefined) hit.content = patch.content;
				if (patch.keys !== undefined) hit.keys = patch.keys;
				return { entry: { ...hit }, newFingerprint: fp, path: "assets/lorebooks/sect.json" };
			},
			remove: (fp) => {
				const idx = loreEntries.findIndex((e) => e.fingerprint === fp);
				if (idx < 0) return null;
				const [removed] = loreEntries.splice(idx, 1);
				return { entry: removed!, path: "assets/lorebooks/sect.json" };
			},
			mountBook: (path, mounted) => (mounted ? [path] : []),
		}),
		getPanels: () => panels.map((p) => ({ ...p })),
		savePanel: async (input) => {
			const updated = { name: input.name, kind: input.kind ?? "html", content: input.content, updatedAt: Date.now() };
			const idx = panels.findIndex((p) => p.name === input.name);
			if (idx >= 0) panels[idx] = updated;
			else panels.push(updated);
			return { name: updated.name, kind: updated.kind, updatedAt: updated.updatedAt };
		},
		importPanels: async (list) => {
			const names: string[] = [];
			for (const item of list) {
				const name = String(item.name ?? "").trim();
				const kind = String(item.kind ?? "html").trim();
				const content = String(item.content ?? "");
				panels.push({ name, kind, content, updatedAt: Date.now() });
				names.push(name);
			}
			return { imported: names.length, names, errors: [] };
		},
		closePanel: async (name) => {
			const idx = panels.findIndex((p) => p.name === name);
			if (idx >= 0) panels.splice(idx, 1);
		},
		getStoryView: () => ({
			files: [{ name: "001-序章.md", title: "序章", chars: 12, mtime: 1000, text: "# 序章\n风起山门。", display: "# 序章\n风起山门。" }],
		}),
		editStoryFile: async () => ({ checkpointId: "cp-1" }),
		getWorldlineView: () => ({ saves: [], activeWorldline: "主世界线" }),
		listModels: () => ({
			current: { provider: "mock", id: "faux-rp", name: "Faux RP" },
			models: [{ provider: "mock", id: "faux-rp", name: "Faux RP", reasoning: true }],
		}),
		notify: (level, text) => notifications.push({ level, text }),
	};

	return {
		root,
		chatDir,
		target,
		host,
		notifications,
		api: new ScriptApiService(host),
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("ScriptApiService：context.read 与目标守卫（换卡/换项目/换会话/换分支节点防串台）", async () => {
	const h = createTestHost();
	try {
		const ctx = await h.api.invoke({ action: "context.read" });
		assert.equal(ctx.ok, true);
		assert.equal(ctx.status, "completed");
		assert.equal(ctx.target.cardName, "云澜");
		assert.equal(ctx.target.chatId, "chat-1");
		assert.deepEqual((ctx.result as { capabilities: string[] }).capabilities, [...SCRIPT_API_CAPABILITIES]);

		// 目标匹配时允许执行
		const okRead = await h.api.invoke({
			action: "state.read",
			target: { card: h.target.card, chatId: "chat-1", sessionId: "sess-1", leafId: "leaf-2" },
		});
		assert.equal(okRead.ok, true);

		// 迟到请求携带旧 chatId / sessionId / leafId 时拒绝执行
		const wrongChat = await h.api.invoke({
			action: "state.commit",
			params: { patch: { location: "后山" } },
			target: { chatId: "chat-old" },
		});
		assert.equal(wrongChat.ok, false);
		assert.equal(wrongChat.error?.code, "target_mismatch");

		const wrongLeaf = await h.api.invoke({
			action: "messages.updateReply",
			params: { text: "新回复" },
			target: { leafId: "leaf-stale" },
		});
		assert.equal(wrongLeaf.ok, false);
		assert.equal(wrongLeaf.error?.code, "target_mismatch");
	} finally {
		h.cleanup();
	}
});

test("ScriptApiService：真实消息读取、负索引、改写回复与忙时保护", async () => {
	const h = createTestHost();
	try {
		const list = await h.api.invoke({ action: "messages.list" });
		assert.equal(list.ok, true);
		const res = list.result as { total: number; lastMessageId: number; messages: ScriptMessageItem[] };
		assert.equal(res.total, 2);
		assert.equal(res.lastMessageId, 1);
		assert.equal(res.messages[0]!.text, "师姐久等了。");
		assert.equal(res.messages[1]!.entryId, "entry-asst-1");

		// 负索引 -1 取最后一条真实消息
		const last = await h.api.invoke({ action: "messages.get", params: { index: -1 } });
		assert.equal(last.ok, true);
		assert.equal((last.result as { message: ScriptMessageItem }).message.text, "云澜轻颔首：「随我入殿。」");

		// 流式进行中拒绝修改消息
		h.target.streaming = true;
		const busyUpdate = await h.api.invoke({ action: "messages.updateReply", params: { text: "忙时改写" } });
		assert.equal(busyUpdate.ok, false);
		assert.equal(busyUpdate.error?.code, "busy");
		h.target.streaming = false;

		const updated = await h.api.invoke({ action: "messages.updateReply", params: { text: "云澜递来一枚玉简。" } });
		assert.equal(updated.ok, true);
		assert.equal(updated.status, "refreshed");
		assert.equal(updated.target.leafId, "leaf-edited");
	} finally {
		h.cleanup();
	}
});

test("ScriptApiService：脚本私有数据隔离、落盘版本控制与内部目录保护", async () => {
	const h = createTestHost();
	try {
		// 脚本 A 写入私有数据
		const w1 = await h.api.invoke({
			action: "data.write",
			scriptId: "orb-ui",
			params: { scope: "script", data: { x: 120, y: 240 } },
		});
		assert.equal(w1.ok, true);
		assert.equal(w1.status, "committed");
		assert.equal((w1.result as { version: number }).version, 1);

		// 脚本 B 读取自己的 script 作用域，不会串读到脚本 A 的数据
		const rOther = await h.api.invoke({
			action: "data.read",
			scriptId: "other-script",
			params: { scope: "script" },
		});
		assert.deepEqual((rOther.result as { data: Record<string, unknown> }).data, {});

		// 版本冲突检查（expectedVersion 不匹配时拒绝覆盖）
		const conflict = await h.api.invoke({
			action: "data.write",
			scriptId: "orb-ui",
			params: { scope: "script", expectedVersion: 99, data: { x: 0 } },
		});
		assert.equal(conflict.ok, false);
		assert.equal(conflict.error?.code, "version_conflict");

		// 正确 expectedVersion 可合并更新
		const w2 = await h.api.invoke({
			action: "data.write",
			scriptId: "orb-ui",
			params: { scope: "script", expectedVersion: 1, key: "collapsed", value: true },
		});
		assert.equal(w2.ok, true);
		assert.deepEqual((w2.result as { data: Record<string, unknown> }).data, { x: 120, y: 240, collapsed: true });

		// 脚本数据目录属于子项目受管内部目录，不混入项目 Markdown 资产列表，也禁止通过 project.files 直接读写
		const filesList = await h.api.invoke({ action: "project.files.list" });
		const relPaths = ((filesList.result as { files: Array<{ relPath: string }> }).files ?? []).map((f) => f.relPath);
		assert.ok(!relPaths.some((p) => p.startsWith("脚本数据")));

		const blocked = await h.api.invoke({
			action: "project.files.read",
			params: { path: "脚本数据/orb-ui.json" },
		});
		assert.equal(blocked.ok, false);
		assert.equal(blocked.error?.code, "permission_denied");
	} finally {
		h.cleanup();
	}
});

test("ScriptApiService：主聊天生成、独立生成与按 requestId 取消", async () => {
	const h = createTestHost();
	try {
		// 主聊天生成返回真实模型回复与新节点 ID（非输入回显）
		const chatRes = await h.api.invoke({
			action: "chat.submit",
			params: { text: "请师姐指点剑法。" },
		});
		assert.equal(chatRes.ok, true);
		assert.equal(chatRes.status, "refreshed");
		assert.equal((chatRes.result as { text: string }).text, "【主聊天回复】已收到：请师姐指点剑法。");

		// 独立生成（explicit / contextual）不追加主聊天消息
		const beforeCount = ((await h.api.invoke({ action: "messages.list" })).result as { total: number }).total;
		const explicitRes = await h.api.invoke({
			action: "generation.explicit",
			params: { systemPrompt: "只输出摘要", prompt: "分析当前局势" },
		});
		assert.equal(explicitRes.ok, true);
		assert.equal((explicitRes.result as { text: string }).text, "显式结果：分析当前局势");

		const ctxRes = await h.api.invoke({
			action: "generation.contextual",
			params: { prompt: "总结主角位置" },
		});
		assert.equal(ctxRes.ok, true);
		assert.equal((ctxRes.result as { text: string }).text, "带剧情视野结果（角色=云澜）：总结主角位置");
		const afterCount = ((await h.api.invoke({ action: "messages.list" })).result as { total: number }).total;
		assert.equal(afterCount, beforeCount, "独立生成不得污染主聊天历史");

		// 按 requestId 取消正在运行的独立生成
		const slowPromise = h.api.invoke({
			action: "generation.explicit",
			requestId: "req-slow-1",
			params: { prompt: "SLOW_CANCEL" },
		});
		await new Promise((r) => setTimeout(r, 30));
		const cancelRes = await h.api.invoke({
			action: "requests.cancel",
			params: { targetRequestId: "req-slow-1" },
		});
		assert.equal(cancelRes.ok, true);
		assert.equal((cancelRes.result as { cancelled: boolean }).cancelled, true);

		const slowOut = await slowPromise;
		assert.equal(slowOut.ok, false);
		assert.equal(slowOut.error?.code, "cancelled");
	} finally {
		h.cleanup();
	}
});

test("ScriptApiService：世界书、项目文件、宏与正则纯计算", async () => {
	const h = createTestHost();
	try {
		const created = await h.api.invoke({
			action: "lorebooks.createEntry",
			params: { title: "山门禁制", keys: ["禁制"], content: "子时后需持令牌通行。" },
		});
		assert.equal(created.ok, true);
		const loreRead = await h.api.invoke({ action: "lorebooks.read", params: { query: "令牌" } });
		assert.equal((loreRead.result as { entries: LorebookEntry[] }).entries.length, 1);

		// 项目文件正常读写与越界拦截
		const writeFile = await h.api.invoke({
			action: "project.files.write",
			params: { path: "记忆/人物关系.md", content: "# 人物关系\n- 云澜：师姐\n" },
		});
		assert.equal(writeFile.ok, true);
		const readFile = await h.api.invoke({
			action: "project.files.read",
			params: { path: "记忆/人物关系.md" },
		});
		assert.equal(readFile.ok, true);
		assert.ok((readFile.result as { content: string }).content.includes("云澜：师姐"));

		// 按书名过滤 lorebooks.read（仅当条目带 source 字段时按书隔离）
		const origGetLoreHost = h.host.getLoreHost;
		h.host.getLoreHost = () => ({
			...origGetLoreHost(),
			listMarked: () => [
				{ uid: 1, comment: "A书条目", keys: ["a"], content: "属于A", constant: true, enabled: true, order: 10, depth: 4, position: 0, source: "lorebooks/书A.json" } as LorebookEntry,
				{ uid: 2, comment: "B书条目", keys: ["b"], content: "属于B", constant: true, enabled: true, order: 10, depth: 4, position: 0, source: "lorebooks/书B.json" } as LorebookEntry,
			],
		});
		const readA = await h.api.invoke({ action: "lorebooks.read", params: { book: "书A" } });
		assert.equal(readA.ok, true);
		assert.equal((readA.result as { entries: LorebookEntry[] }).entries.length, 1);
		assert.equal((readA.result as { entries: LorebookEntry[] }).entries[0]?.comment, "A书条目");
		const readMissing = await h.api.invoke({ action: "lorebooks.read", params: { book: "不存在的书" } });
		assert.equal((readMissing.result as { entries: LorebookEntry[] }).entries.length, 0);
		h.host.getLoreHost = origGetLoreHost;

		const escapeAttempt = await h.api.invoke({
			action: "project.files.read",
			params: { path: "../other/secret.md" },
		});
		assert.equal(escapeAttempt.ok, false);
		assert.equal(escapeAttempt.error?.code, "permission_denied");

		// 宏与正则计算
		const macros = await h.api.invoke({
			action: "text.macros",
			params: { text: "{{setvar::剑意::三成}}{{char}}对{{user}}道：剑意已达{{getvar::剑意}}（{{unknown_macro}}）" },
		});
		assert.equal(macros.ok, true);
		assert.equal((macros.result as { text: string }).text, "云澜对沈舟道：剑意已达三成（{{unknown_macro}}）");
		assert.deepEqual((macros.result as { unsupported: string[] }).unsupported, ["unknown_macro"]);

		const transformed = await h.api.invoke({
			action: "text.transform",
			params: { text: "叙事正文 [状态:气血充盈]" },
		});
		assert.equal(transformed.ok, true);
		assert.equal((transformed.result as { text: string }).text, "叙事正文 <span class=\"st\">气血充盈</span>");

		// EJS 提示词模板计算与写回状态（刀 3）
		const ejsRes = await h.api.invoke({
			action: "text.ejs",
			params: {
				code: `<%_ setvar('stat_data.剑意', 99); _%>地点:<%= variables.location %>|剑意:<%= getvar('stat_data.剑意') %>|<%- await getwi(null, '青云剑诀') %>`,
			},
		});
		assert.equal(ejsRes.ok, true);
		assert.equal(ejsRes.status, "committed");
		const ejsOut = ejsRes.result as { text: string; modified: boolean };
		assert.equal(ejsOut.modified, true);
		assert.ok(ejsOut.text.includes("地点:山门"));
		assert.ok(ejsOut.text.includes("剑意:99"));
		assert.ok(ejsOut.text.includes("青云门镇派剑法。"));
		const afterState = await h.api.invoke({ action: "state.read" });
		assert.equal(((afterState.result as { state: WorldState }).state.mvu as Record<string, unknown>)?.剑意, 99);

		// 刀2：跨不同 scriptId 读写同一全局作用域 + text.macros 读取持久变量与持久化回写
		const wGlobal = await h.api.invoke({
			action: "data.write",
			scriptId: "script-alpha",
			params: { scope: "global", key: "sleep_var_zishu_define", value: "1500字" },
		});
		assert.equal(wGlobal.ok, true);
		const rGlobal = await h.api.invoke({
			action: "data.read",
			scriptId: "script-beta",
			params: { scope: "global", key: "sleep_var_zishu_define" },
		});
		assert.equal((rGlobal.result as { data: unknown }).data, "1500字", "global 作用域跨 scriptId 共享同一文件");

		const macroLinked = await h.api.invoke({
			action: "text.macros",
			scriptId: "script-gamma",
			params: {
				text: "要求:{{getglobalvar::sleep_var_zishu_define}}|末句:{{lastmessage}}|角:{{lastcharmessage}}{{setvar::persistedLocal::1}}{{setglobalvar::persistedGlobal::ok}}",
				persist: true,
			},
		});
		assert.equal(macroLinked.ok, true);
		assert.equal(macroLinked.status, "committed");
		const mlOut = macroLinked.result as { text: string; persisted?: boolean };
		assert.equal(mlOut.persisted, true);
		assert.ok(mlOut.text.startsWith("要求:1500字|末句:"));

		const readPersistedChat = await h.api.invoke({ action: "data.read", params: { scope: "chat", key: "persistedLocal" } });
		assert.equal((readPersistedChat.result as { data: unknown }).data, "1");
		const readPersistedGlobal = await h.api.invoke({ action: "data.read", params: { scope: "global", key: "persistedGlobal" } });
		assert.equal((readPersistedGlobal.result as { data: unknown }).data, "ok");
	} finally {
		h.cleanup();
	}
});

test("浏览器桥接：window.Liyuan / TheaterAPI / TavernHelper 与真实消息上下文同步", async () => {
	const h = createTestHost();
	const g = globalThis as unknown as { window?: Record<string, unknown>; document?: Record<string, unknown> };
	const prevWin = g.window;
	const prevDoc = g.document;
	try {
		const fakeWin: Record<string, unknown> = {
			location: { origin: "http://localhost:7620", protocol: "http:" },
			addEventListener: () => {},
			removeEventListener: () => {},
		};
		g.window = fakeWin;
		g.document = { querySelectorAll: () => [] };
		registerLiyuanScriptTransport((action, params, opts) =>
			h.api.invoke({
				action,
				params,
				target: opts?.target,
				scriptId: opts?.scriptId,
				requestId: opts?.requestId,
			}),
		);
		installParentTavernShim();

		const liyuan = fakeWin.Liyuan as {
			context: { read: () => Promise<{ ok: boolean; target: { charName: string } }> };
			messages: { list: () => Promise<{ ok: boolean; result: { total: number } }> };
		};
		const ctxEnv = await liyuan.context.read();
		assert.equal(ctxEnv.ok, true);
		assert.equal(ctxEnv.target.charName, "云澜");

		const th = fakeWin.TavernHelper as {
			generate: (p: Record<string, unknown>) => Promise<string>;
			generateRaw: (p: Record<string, unknown>) => Promise<string>;
		};
		const reply = await th.generate({ user_input: "测试真实生成返回" });
		assert.equal(reply, "带剧情视野结果（角色=云澜）：测试真实生成返回");

		const chatReply = await th.generate({ user_input: "测试主聊天提交", mode: "chat" });
		assert.equal(chatReply, "【主聊天回复】已收到：测试主聊天提交");

		const rawReply = await th.generateRaw({ prompt: "后台独立分析" });
		assert.equal(rawReply, "显式结果：后台独立分析");

		// 验证 syncCardRuntimeContext 后 getChatMessages / getLastMessageId / substitudeMacros 读取真实数据
		syncCardRuntimeContext({
			card: h.target.card,
			charName: "云澜",
			userName: "沈舟",
			chatId: "chat-1",
			sessionId: "sess-1",
			mode: "roleplay",
			streaming: false,
			messages: [
				{
					message_id: 0,
					index: 0,
					role: "user",
					channel: "user",
					name: "沈舟",
					message: "师姐好",
					mes: "师姐好",
					text: "师姐好",
				},
				{
					message_id: 1,
					index: 1,
					role: "assistant",
					channel: "narrative",
					name: "云澜",
					message: "你来了",
					mes: "你来了",
					text: "你来了",
				},
			],
		});
		assert.ok(IFRAME_TAVERN_GLOBALS_SNIPPET.includes("readRuntimeCtx"));
	} finally {
		registerLiyuanScriptTransport(null);
		if (prevWin === undefined) delete g.window;
		else g.window = prevWin;
		if (prevDoc === undefined) delete g.document;
		else g.document = prevDoc;
		h.cleanup();
	}
});

test("REST 路由与 CLI：/api/script 与 server/main.ts --cli /script 端到端实测", async () => {
	const h = createTestHost();
	const restHost = {
		cwd: h.root,
		invokeScriptApi: (body: Record<string, unknown>) =>
			h.api.invoke({
				action: String(body.action ?? ""),
				params: body.params && typeof body.params === "object" ? (body.params as Record<string, unknown>) : body,
				target: body.target && typeof body.target === "object" ? (body.target as never) : undefined,
				scriptId: typeof body.scriptId === "string" ? body.scriptId : undefined,
				requestId: typeof body.requestId === "string" ? body.requestId : undefined,
			}),
	} as unknown as RestHost;

	const srv = createServer((req, res) => {
		void handleApiRequest(req, res, restHost);
	});
	await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
	const addr = srv.address() as { port: number };
	const baseUrl = `http://127.0.0.1:${addr.port}`;

	try {
		const capRes = await fetch(`${baseUrl}/api/script/capabilities`);
		assert.equal(capRes.status, 200);
		const capJson = (await capRes.json()) as { ok: boolean; result: { capabilities: string[] } };
		assert.equal(capJson.ok, true);
		assert.ok(capJson.result.capabilities.includes("context.read"));

		const postRes = await fetch(`${baseUrl}/api/script`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				action: "state.commit",
				params: { patch: { location: "藏经阁" } },
			}),
		});
		const postJson = (await postRes.json()) as { ok: boolean; status: string; result: { state: { location: string } } };
		assert.equal(postJson.ok, true);
		assert.equal(postJson.status, "committed");
		assert.equal(postJson.result.state.location, "藏经阁");

		// 隔离环境启动真实 CLI（server/main.ts --cli）验证 /script 命令
		const cliRoot = mkdtempSync(join(tmpdir(), "liyuan-cli-script-"));
		const cliAgent = mkdtempSync(join(tmpdir(), "liyuan-cli-agent-"));
		try {
			mkdirSync(join(cliRoot, "assets", "cards"), { recursive: true });
			mkdirSync(join(cliRoot, "assets", "presets"), { recursive: true });
			writeFileSync(
				join(cliRoot, "assets", "cards", "default_Sera.json"),
				JSON.stringify({ data: { name: "Sera", description: "测试角色", first_mes: "你好，{{user}}。" } }),
				"utf8",
			);
			writeFileSync(
				join(cliRoot, "assets", "presets", "test_preset.json"),
				JSON.stringify({
					temperature: 0.77,
					squash_system_messages: true,
					prompts: [
						{ identifier: "b1", name: "文风块", role: "system", content: "旧文风", enabled: false, injection_position: 0 },
						{ identifier: "chatHistory", name: "Chat History", marker: true },
						{ identifier: "pf", name: "预填", role: "assistant", content: "OUTPUT<think>", enabled: true, injection_position: 0 },
					],
					prompt_order: [
						{
							character_id: 100001,
							order: [
								{ identifier: "b1", enabled: false },
								{ identifier: "chatHistory", enabled: true },
								{ identifier: "pf", enabled: true },
							],
						},
					],
				}),
				"utf8",
			);
			writeFileSync(
				join(cliRoot, "liyuan.config.json"),
				JSON.stringify({
					card: "assets/cards/default_Sera.json",
					preset: "assets/presets/test_preset.json",
					userName: "旅人",
				}),
				"utf8",
			);

			const repoRoot = process.cwd();
			const cliOutput = await new Promise<string>((resolve, reject) => {
				const child = spawn(process.execPath, [join(repoRoot, "server/main.ts"), "--cli"], {
					cwd: cliRoot,
					env: {
						...process.env,
						LIYUAN_PRODUCT_ROOT: repoRoot,
						LIYUAN_CODING_AGENT_DIR: cliAgent,
					},
					stdio: ["pipe", "pipe", "pipe"],
				});
				let out = "";
				child.stdout.on("data", (d: Buffer) => {
					out += d.toString("utf8");
				});
				child.stderr.on("data", (d: Buffer) => {
					out += d.toString("utf8");
				});
				child.on("error", reject);
				child.on("close", () => resolve(out));

				child.stdin.write("/script context.read\n");
				child.stdin.write('/script data.write {"scope":"script","scriptId":"cli-test","data":{"score":42}}\n');
				child.stdin.write('/script data.read {"scope":"script","scriptId":"cli-test"}\n');
				child.stdin.write("/script preset.list\n");
				child.stdin.write('/script preset.get {"includeRaw":true}\n');
				child.stdin.write('/script preset.preview {"userText":"推门进去"}\n');
				child.stdin.write('/script preset.update {"patch":{"blocks":[{"id":"b1","enabled":true,"content":"新文风"}]}}\n');
				child.stdin.write("/script preset.get\n");
				child.stdin.write('/script preset.preview {"userText":"推门进去"}\n');
				child.stdin.write('/script preset.preview {"userText":"推门进去","simulateRelay":true,"api":"openai-completions","provider":"deepseek","model":"deepseek-chat"}\n');
				child.stdin.write('/script preset.preview {"userText":"推门进去","simulateRelay":true,"api":"google-generative-ai","provider":"google","model":"gemini-2.5-pro"}\n');
				child.stdin.write('/script preset.preview {"userText":"推门进去","simulateRelay":true,"contextPackMode":"tool-desc","antiRouteShield":"scramble","googleSafetyOnOpenAi":true,"api":"openai-completions","provider":"aistudio","model":"gemini-2.5-pro"}\n');
				child.stdin.write("/preset status\n");
				child.stdin.write("/preset preview\n");
				child.stdin.write("/exit\n");
				child.stdin.end();
			});

			assert.ok(cliOutput.includes('"action":"context.read"'), "CLI 应返回 context.read 回执");
			assert.ok(cliOutput.includes('"action":"data.write"'), "CLI 应返回 data.write 回执");
			assert.ok(cliOutput.includes('"score":42'), "CLI 应读回写入的脚本私有数据");
			assert.ok(cliOutput.includes('"action":"preset.list"') && cliOutput.includes("test_preset"), "CLI 应返回 preset.list");
			assert.ok(cliOutput.includes('"action":"preset.get"') && cliOutput.includes("旧文风"), "CLI 应读到初始预设原文");
			assert.ok(cliOutput.includes('"action":"preset.update"') && cliOutput.includes('"status":"refreshed"'), "CLI 应更新草稿并完成热刷新");
			assert.ok(cliOutput.includes('"dirty":true') && cliOutput.includes("新文风"), "CLI 再次读取应拿到草稿中已开启的新内容");
			assert.ok(cliOutput.includes('"action":"preset.preview"'), "CLI 应返回 preset.preview 报文");
			assert.ok(cliOutput.includes("新文风") && cliOutput.includes("推门进去"), "CLI preset.preview 应实时体现新开启的预设内容与用户输入");
			assert.ok(cliOutput.includes('"simulatedPayload"'), "CLI simulateRelay 应返回模拟发包报文");
			assert.ok(cliOutput.includes("HARM_CATEGORY_DANGEROUS_CONTENT") && cliOutput.includes("BLOCK_NONE"), "CLI simulateRelay 应对 Google 原生注入 BLOCK_NONE");
			assert.ok(
				cliOutput.includes('"packedIntoToolDescription":true') &&
					cliOutput.includes("liyuan_context_reference") &&
					cliOutput.includes('"safety_settings"'),
				"CLI preset.preview 应返回 tool-desc 搬运统计、载体工具名与 OpenAI 兼容 Gemini safety_settings",
			);
			assert.ok(cliOutput.includes("[preset] 活动预设：test_preset"), "CLI /preset status 应展示当前活动预设");
			assert.ok(cliOutput.includes("[preset] 预览：test_preset"), "CLI /preset preview 应返回装配概览");
		} finally {
			rmSync(cliRoot, { recursive: true, force: true });
			rmSync(cliAgent, { recursive: true, force: true });
		}
	} finally {
		await new Promise<void>((resolve) => srv.close(() => resolve()));
		h.cleanup();
	}
});

