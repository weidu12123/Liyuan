/** Beat-local, versioned text. pi owns the loop; this module owns artifact transactions. */

import { randomUUID } from "node:crypto";
import { applyDraftEdits, locateEdit, searchDraft, type DraftEditItem, type DraftRules } from "../draft.ts";

export type BeatMode = "explore" | "write";
export type BeatPhase = "exploring" | "writing" | "waiting" | "sealed" | "stopped" | "error";
export interface BeatStep { id: string; text: string; status: "pending" | "in_progress" | "done" | "cancelled" }
export interface DraftRevision { version: number; text: string; reason: string; at: number }

export interface TurnWorkspace {
	id: string;
	sessionId: string;
	parentId: string | null;
	userId?: string;
	entryId?: string;
	/** This workspace revises an existing reply; it does not create a new story beat. */
	revision?: { targetId: string; requestId: string; sourceDraftId?: string; sourceVersion: number };
	/** Recovery journal for a text revision whose session receipt has not been flushed yet. */
	restorePending?: boolean;
	version: number;
	mode: BeatMode;
	phase: BeatPhase;
	plan: BeatStep[];
	/** Answers made inside this beat are user input, not disposable tool chatter. */
	choices?: Array<{ question: string; answer: string }>;
	revisions: DraftRevision[];
	updatedAt: number;
	/** Uncommitted argument/text stream, retained for interruption/restart recovery. */
	preview?: { name: "draft_write" | "draft_append" | "direct"; content: string; version: number; separator?: string };
	context?: { messages: number; chars: number; toolChars: number; prunedChars: number; prunedResults: number };
	/** 当前稿（draft_write 全量替换语义；draft_append 追加语义） */
	draft: string;
	/** 已封笔（M-E）：正文写完了（8/10 起封笔只是状态切换，不触发任何检验） */
	sealed: boolean;
	/** 交稿次数（含宽进严出代收） */
	writes: number;
	explicitWrites: number;
	directWrites: number;
	/** draft_append 追加段数（M-E KPI：分段续写是否真发生） */
	appends: number;
	/** draft_edit 成功套用的次数（M-B KPI：定点改稿是否真替代了全文重交） */
	edits: number;
	/** 本拍事实读取次数（lorebook / memory / world_state_get；不含 skill_read）。仅作观测。 */
	lookups: number;
	/**
	 * 本拍面板写入次数（panel_write / panel_close 调用计数，engine 维护）。
	 */
	panelWrites: number;
	/**
	 * 本拍时间线（思考/工具/正文按**发生顺序**）。
	 *
	 * 定稿只落最后一稿正文，中间轮的思考与工具轨迹本会丢失——但用户要看的
	 * 正是「思考→工具→正文→思考」这条链。故在此按序记档，落树时随 details
	 * 持久化，刷新与 resync 后仍在。
	 */
	timeline: TurnSegment[];
	/**
	 * 稿外直出文本（engine 每轮更新）：首轮直出＋稿落地前的 text 通道产出中，
	 * 未被代收进稿的部分。seal 回执把它作为事实补认——不回喂原文、不给指令，
	 * 处置（draft_edit 补进去 / 当旁白不理）归模型判断。
	 */
	strayText?: string;
	/**
	 * 本拍的媒体交付（show_image/audio/video/html、tts，8/06 重接）。
	 *
	 * wire 层只把树上的 `role:"toolResult"` 条目翻成媒体帧，而台上引擎落树时
	 * 剥离工具轨迹——故媒体结果在此收集，谢幕后随正文一起落成 toolResult 条目，
	 * 让 live 推送与刷新重放走同一条路径。
	 */
	mediaDeliveries?: Array<{ toolName: string; toolCallId?: string; details: Record<string, unknown>; text: string }>;
}

/** 时间线段：与前端 web/src/timeline.ts 的 TurnSegment 同构（跨边界只走 JSON） */
export type TurnSegment =
	| { kind: "thinking"; text: string }
	/** draft=true 标记「这段是工作区稿件」，重交/改稿时原地替换而非叠加 */
	| { kind: "text"; text: string; draft?: boolean }
	| { kind: "tool"; activities: Array<{ kind: string; name: string; detail?: string; isError?: boolean; change?: unknown }> };

export function createWorkspace(identity: Partial<Pick<TurnWorkspace, "id" | "sessionId" | "parentId" | "userId">> = {}): TurnWorkspace {
	return {
		id: identity.id ?? randomUUID(), sessionId: identity.sessionId ?? "memory", parentId: identity.parentId ?? null,
		...(identity.userId ? { userId: identity.userId } : {}),
		version: 0, mode: "write", phase: "writing", plan: [], revisions: [], updatedAt: Date.now(),
		draft: "",
		sealed: false,
		writes: 0,
		explicitWrites: 0,
		directWrites: 0,
		appends: 0,
		edits: 0,
		lookups: 0,
		panelWrites: 0,
		timeline: [],
	};
}

/** 时间线追加：同类并入末段（连续工具聚成一组），异类开新段 */
export function recordSegment(
	ws: TurnWorkspace,
	seg:
		| { kind: "thinking"; text: string }
		| { kind: "text"; text: string }
		| { kind: "tool"; activity: { kind: string; name: string; detail?: string; isError?: boolean } },
): void {
	const last = ws.timeline[ws.timeline.length - 1];
	if (seg.kind === "tool") {
		if (last && last.kind === "tool") last.activities.push(seg.activity);
		else ws.timeline.push({ kind: "tool", activities: [seg.activity] });
		return;
	}
	if (!seg.text) return;
	// text 记档（尾巴流式等，无 draft 标记）不并入稿段——稿段是 draft_append/resync
	// 维护的作品分段，尾巴黏进去会让「稿段拼接 ≠ 现稿」，定稿分段同构随之失效。
	const mergeable = last && last.kind === seg.kind && !(last.kind === "text" && last.draft === true);
	if (mergeable) last.text += seg.text;
	else ws.timeline.push({ kind: seg.kind, text: seg.text });
}

/**
 * 定稿时间线（8/09 输出形式定案：分段同构——重放形态 = 流式形态）。
 *
 * 常态：稿段（draft=true，= 屏上一段段长出来的故事）原位保留；finalText 相对现稿
 * 多出的尾巴（状态栏 / catsay，text 通道直出）收成独立末段。落树正文 finalText 与
 * 时间线正文（稿段拼接 + 尾巴段）内容一致，且分段结构与用户流式所见相同。
 *
 * 兜底：无稿（直出正文路径）或稿段与现稿脱同步时，退回「全文单段放首个 text 位置」
 * 的塌段形态——内容正确优先于形态。
 */
export function finalTimeline(ws: TurnWorkspace, finalText: string): TurnSegment[] {
	// 分段同构（8/09 输出形式定案）：定稿保持稿段原位——重放形态 = 流式形态。
	// mergeFinalText 的产物必为「稿全文」或「稿全文 + 尾巴」，故 startsWith 成立时
	// 尾巴 = 稿之后的部分（状态栏等 text 通道产出），收成独立末段（不带 draft）。
	// 非稿 text 段（尾巴的流式记档）丢弃——内容已归并进尾巴段，避免重复。
	const draft = ws.draft;
	const draftSegs = ws.timeline.filter(
		(s): s is Extract<TurnSegment, { kind: "text" }> => s.kind === "text" && s.draft === true,
	);
	const joined = draftSegs.map((s) => s.text).join("");
	if (draft && finalText.startsWith(draft) && joined === draft) {
		const tail = finalText.slice(draft.length);
		const out: TurnSegment[] = [];
		for (const s of ws.timeline) {
			if (s.kind === "tool") {
				if (s.activities.length > 0) out.push(s);
				continue;
			}
			if (s.kind === "text") {
				if (s.draft === true && s.text.trim()) out.push(s);
				continue;
			}
			if (s.text.trim().length > 0) out.push(s);
		}
		if (tail) out.push({ kind: "text", text: tail });
		return out;
	}
	// 兜底（无稿 / 直出代收 / 稿段与现稿脱同步）：全文单段放首个 text 位置（旧行为）
	const out: TurnSegment[] = [];
	let textPlaced = false;
	for (const s of ws.timeline) {
		if (s.kind === "tool") {
			if (s.activities.length > 0) out.push(s);
			continue;
		}
		if (s.kind === "text") {
			if (!textPlaced) {
				textPlaced = true;
				out.push({ kind: "text", text: finalText, draft: true });
			}
			continue;
		}
		if (s.text.trim().length > 0) out.push(s);
	}
	if (!textPlaced && finalText.trim()) out.push({ kind: "text", text: finalText, draft: true });
	return out;
}

/**
 * 稿件入时间线：**替换**已记的稿，而不是再追加一段。
 *
 * 多稿重交（M-B 实弹的 882→849→838）与定点改稿都作用在同一份稿上，
 * 逐次追加会让同一段正文在屏上叠出几份（EXEC §4.5.4 记的重复上屏欠账）。
	 * 故摘掉此前稿段，把最新稿放回首个稿段位置；思考与工具轨迹保留。
 */
function replaceDraftSegment(ws: TurnWorkspace, content: string): void {
	const first = ws.timeline.findIndex((s) => s.kind === "text" && s.draft === true);
	ws.timeline = ws.timeline.filter((s) => !(s.kind === "text" && s.draft === true));
	ws.timeline.splice(first < 0 ? ws.timeline.length : first, 0, { kind: "text", text: content, draft: true });
}

/**
 * 稿件按空行切段——分段的**同源算法**：时间线重切（下方 resyncDraftSegments）、
 * 引擎的 draft_resync 帧（修复后前端原位替换稿段）都用它，保证前后端看到同一套分段。
 */
export function splitDraftSegments(draft: string): string[] {
	return draft.match(/[\s\S]+?(?:\n[\t ]*\n|$)/g) ?? [];
}

export interface WorkspaceDeps {
	rules: DraftRules;
	userName: string;
	charName: string;
	/** Called before the in-memory commit. Throwing leaves both draft and revision unchanged. */
	persist?: (next: TurnWorkspace) => void;
	reload?: () => TurnWorkspace | undefined;
	file?: string;
}

export interface WriteToolResult {
	/** 回给模型的 toolResult 文本 */
	text: string;
	/** 过程条短句（无则不出条） */
	activity?: string;
	/** true = 本次调用是有效交稿/记账（引擎统计与流转用） */
	ok: boolean;
	isError?: boolean;
	details?: Record<string, unknown>;
}

/**
 * 封笔事实（8/10 验收整体退役后仅存的回执信息）：稿外直出补认一行。
 * 禁词/比喻/句式的匹配统计连同 checkDraft 已全部删除——落笔之后 harness
 * 不对稿件内容说任何话；质量投资全在落笔前（预设原文＋素材＋思考空间）。
 */
export function commitWorkspace(ws: TurnWorkspace, deps: WorkspaceDeps, next: TurnWorkspace): void {
	next.updatedAt = Date.now();
	deps.persist?.(next);
	Object.assign(ws, next);
	if (!next.preview) delete ws.preview;
	if (!next.restorePending) delete ws.restorePending;
}

export function reviseDraft(ws: TurnWorkspace, text: string, reason: string, force = false): void {
	if (!force && text === ws.draft && ws.version > 0) return;
	ws.draft = text;
	ws.version++;
	ws.revisions.push({ version: ws.version, text, reason, at: Date.now() });
	delete ws.preview;
}

/** Preserve the chronological paragraph/tool layout when an edit crosses paragraph boundaries. */
function editTimeline(ws: TurnWorkspace, text: string, edits: DraftEditItem[]): void {
	const spans = edits.map((edit) => {
		const match = locateEdit(ws.draft, edit.old);
		if (match.ok === false) throw new Error(match.error);
		return { ...match.at, length: edit.new.length };
	}).sort((a, b) => a.start - b.start);
	const map = (pos: number) => {
		let delta = 0;
		for (const s of spans) {
			if (pos <= s.start) break;
			if (pos < s.end) return s.start + delta + s.length;
			delta += s.length - (s.end - s.start);
		}
		return pos + delta;
	};
	let cursor = 0;
	for (const s of ws.timeline) if (s.kind === "text" && s.draft) {
		const end = cursor + s.text.length;
		s.text = text.slice(map(cursor), map(end));
		cursor = end;
	}
	if (cursor !== ws.draft.length) replaceDraftSegment(ws, text);
}

/** User-only operation. Never registered as a model tool. */
export function restoreDraftVersion(ws: TurnWorkspace, deps: WorkspaceDeps, version: number, expectedVersion: number): void {
	if (expectedVersion !== ws.version) throw new Error(`稿件版本已变为 v${ws.version}，请刷新后再恢复。`);
	const prior = ws.revisions.find((r) => r.version === version);
	if (!prior) throw new Error("该稿件版本不存在。");
	const next = structuredClone(ws);
	reviseDraft(next, prior.text, `user_restore:v${version}`, true);
	next.timeline = next.timeline.filter((s) => s.kind !== "text" || s.draft);
	replaceDraftSegment(next, prior.text);
	commitWorkspace(ws, deps, next);
}

export function workspaceToolBlock(ws: TurnWorkspace, name: string, mode?: "read" | "write"): string | undefined {
	if (ws.revision && (mode !== "read" || name === "ask")) return "上一拍修订已完成，本次请求不能继续写入或提问。";
	if (name === "beat_plan" || name === "ask") return undefined;
	if (ws.mode === "explore" && mode !== "read") return "当前为探索阶段；beat_plan(mode=write) 后才能写入。";
	if (ws.sealed && mode !== "read") return "当前稿已收笔，不能继续写入。";
	return undefined;
}

export function runWriteTool(
	ws: TurnWorkspace,
	deps: WorkspaceDeps,
	name: string,
	args: Record<string, unknown>,
	internal: boolean | "capture" = false,
): WriteToolResult {
	const fail = (text: string): WriteToolResult => ({ text, ok: false, isError: true, details: { draftId: ws.id, version: ws.version } });
	const receipt = (text: string, activity?: string): WriteToolResult => ({ text, activity, ok: true,
		details: { draftId: ws.id, version: ws.version, phase: ws.phase, ...(deps.file ? { file: deps.file } : {}) } });
	try {
		if ((name === "draft_read" || name === "draft_search") && deps.reload) {
			const latest = deps.reload();
			if (latest) {
				if (latest.id !== ws.id || latest.sessionId !== ws.sessionId) return fail("稿件身份不匹配。");
				Object.assign(ws, latest);
			}
		}
		if (name === "draft_read") {
			const start = args.start === undefined ? 0 : Number(args.start);
			const end = args.end === undefined ? ws.draft.length : Number(args.end);
			if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > ws.draft.length) return fail("start/end 必须是稿件范围内的字符偏移（从 0 开始，end 不含）。");
			return receipt(JSON.stringify({ version: ws.version, start, end, total: ws.draft.length, content: ws.draft.slice(start, end) }), "读现稿");
		}
		if (name === "draft_search") {
			if (typeof args.query !== "string" || !args.query.trim()) return fail("query 不能为空。");
			const result = searchDraft(ws.draft, args.query, Math.max(1, Math.min(50, Number(args.limit) || 8)));
			return receipt(JSON.stringify({ version: ws.version, ...result }), "查现稿");
		}
		if (name === "beat_plan") {
			const next = structuredClone(ws);
			if (args.mode !== undefined) {
				if (args.mode !== "explore" && args.mode !== "write") return fail("mode 须为 explore 或 write。");
				if (ws.sealed) return fail("当前稿已收笔。");
				next.mode = args.mode;
				next.phase = args.mode === "explore" ? "exploring" : "writing";
			}
			if (args.steps !== undefined) {
				if (!Array.isArray(args.steps) || args.steps.length > 20) return fail("steps 须为不超过 20 项的数组。");
				const ids = new Set<string>();
				next.plan = args.steps.map((s: Record<string, unknown>, i: number) => {
					if (!s || typeof s.text !== "string" || !s.text.trim()) throw new Error("计划项 text 不能为空。");
					const id = typeof s.id === "string" && s.id ? s.id : String(i + 1);
					if (ids.has(id)) throw new Error("计划项 id 不可重复。");
					ids.add(id);
					const status = s.status ?? "pending";
					if (!["pending", "in_progress", "done", "cancelled"].includes(String(status))) throw new Error("计划项 status 无效。");
					return { id, text: s.text, status: status as BeatStep["status"] };
				});
			}
			commitWorkspace(ws, deps, next);
			return receipt(JSON.stringify({ mode: ws.mode, steps: ws.plan, version: ws.version }), "更新本拍计划");
		}
		if (!["draft_write", "draft_append", "draft_edit", "draft_seal"].includes(name)) return fail(`未知稿件工具 ${name}。`);
		if (!internal) {
			const block = workspaceToolBlock(ws, name, "write");
			if (block) return fail(block);
			if (args.version !== ws.version) return fail(`版本冲突：当前为 v${ws.version}，收到 ${String(args.version)}。本次未修改；draft_read 可读取当前版本。`);
		}
		const next = structuredClone(ws);
		let activity = "";
		let detail = "";
		if (name !== "draft_seal") {
			if (internal) next.directWrites++; else next.explicitWrites++;
		}
		if (name === "draft_seal") {
			if (!ws.draft.trim()) return fail("工作区还没有稿件。");
			next.sealed = true; next.phase = "sealed"; activity = "收笔";
		} else if (name === "draft_edit") {
			if (!Array.isArray(args.edits)) return fail("edits 须为 old/new 数组。");
			const result = applyDraftEdits(ws.draft, args.edits as DraftEditItem[]);
			if (!result.ok) return fail(result.details.join("\n"));
			editTimeline(next, result.text!, args.edits as DraftEditItem[]);
			reviseDraft(next, result.text!, name); next.edits++;
			activity = `改稿 ${args.edits.length} 处`; detail = result.details.join("\n");
		} else {
			if (typeof args.content !== "string" || !args.content.trim()) return fail("content 不能为空。");
			if (name === "draft_append") {
				const separator = ws.draft ? (typeof args.separator === "string" ? args.separator : "\n\n") : "";
				const chunk = separator + args.content;
				reviseDraft(next, ws.draft + chunk, name); next.appends++;
				next.timeline.push({ kind: "text", text: chunk, draft: true });
				activity = "续写一段";
			} else {
				reviseDraft(next, args.content, internal ? "direct" : name); next.writes++;
				replaceDraftSegment(next, args.content); activity = internal ? "直出正文已保存" : "写入现稿";
			}
			if (internal === true) { next.sealed = true; next.phase = "sealed"; }
		}
		// Non-draft text is a transient response stream, not another copy of the committed artifact.
		if (name !== "draft_seal") next.timeline = next.timeline.filter((s) => s.kind !== "text" || s.draft);
		delete next.preview;
		commitWorkspace(ws, deps, next);
		return receipt(`${activity}，v${ws.version}（${ws.phase}）。${detail ? "\n" + detail : ""}`, activity);
	} catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
}
