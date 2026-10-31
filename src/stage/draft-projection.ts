import { applyDraftOps } from "../draft.ts";

/** Text revisions are append-only entries. World-state snapshots and tree position stay intact. */
export const DRAFT_REVISION_TYPE = "rp-draft-revision";

export interface DraftBranchEntry {
	id?: string;
	parentId?: string | null;
	type?: string;
	customType?: string;
	content?: unknown;
	details?: unknown;
	data?: unknown;
	message?: unknown;
}

interface DraftRevisionData {
	targetId: string;
	text: string;
	timeline?: unknown;
	draftId?: string;
	version?: number;
	phase?: string;
	/** A completed editing request, retained on screen but excluded from story context. */
	requestId?: string;
}

/** Recover older beats' answers from this harness's exact ask receipt protocol, never from prose. */
function recoverRecordedChoices<T extends DraftBranchEntry>(branch: T[]): T[] {
	const choices = new Map<string, Array<{ question: string; answer: string }>>();
	for (const e of branch) {
		if (e.type !== "custom" || e.customType !== "rp-text-debug" || !e.parentId) continue;
		const log = (e.data as { beatLog?: Array<{ ev?: string; data?: string }> } | undefined)?.beatLog;
		if (!Array.isArray(log)) continue;
		let question: string | undefined;
		const answers: Array<{ question: string; answer: string }> = [];
		for (const row of log) {
			if (typeof row.data !== "string" || !row.data.startsWith("ask: ")) continue;
			if (row.ev === "tool_call") {
				try { const call = JSON.parse(row.data.slice(5)); question = typeof call.question === "string" ? call.question : undefined; }
				catch { question = undefined; }
			} else if (row.ev === "tool_result") {
				const prefix = "ask: 用户已作答：「", suffix = /」。当前稿件版本 v\d+。$/.exec(row.data);
				if (question !== undefined && row.data.startsWith(prefix) && suffix) answers.push({ question, answer: row.data.slice(prefix.length, suffix.index) });
				question = undefined;
			}
		}
		if (answers.length) choices.set(e.parentId, answers);
	}
	return branch.map((e) => {
		const found = e.id ? choices.get(e.id) : undefined;
		const message = e.message as { role?: string; details?: Record<string, unknown> } | undefined;
		if (!found || e.type !== "message" || message?.role !== "assistant" || message.details?.rpChoices !== undefined) return e;
		return { ...e, message: { ...message, details: { ...message.details, rpChoices: found } } };
	});
}

export function applyDraftRevisions<T extends DraftBranchEntry>(branch: T[], options: { omitEditRequests?: boolean } = {}): T[] {
	branch = recoverRecordedChoices(branch);
	// Old patch messages must run before a full revision, and only once (not again in wire/history).
	if (branch.some((e) => e.type === "custom_message" && e.customType === "rp-draft-op")) {
		const stream = branch.map((entry) => ({
			...(entry.type === "message" ? entry.message as { role?: string; content?: unknown } :
				entry.type === "custom_message" ? { role: "custom", customType: entry.customType, content: entry.content } : {}),
			entry,
		}));
		branch = applyDraftOps(stream).messages.map(({ entry, content }) => entry.type === "message"
			? { ...entry, message: { ...entry.message as object, content } }
			: entry.type === "custom_message" ? { ...entry, content } : entry);
	}
	const revisions = new Map<string, DraftRevisionData>();
	const entries = new Map(branch.map((e) => [e.id, e]));
	const requests = new Set<string>();
	for (const e of branch) if (e.type === "custom" && e.customType === DRAFT_REVISION_TYPE) {
		const d = e.data as DraftRevisionData | undefined;
		const target = d?.targetId ? entries.get(d.targetId) : undefined;
		if (!target || typeof d?.text !== "string") continue;
		if (!(target.type === "message" && (target.message as { role?: string })?.role === "assistant") &&
			!(target.type === "custom_message" && target.customType === "rp-edited-reply")) continue;
		revisions.set(d.targetId, d);
		const request = d.requestId ? entries.get(d.requestId) : undefined;
		if (request?.type === "message" && (request.message as { role?: string })?.role === "user") requests.add(d.requestId!);
	}
	return branch.filter((e) => !options.omitEditRequests || !e.id || !requests.has(e.id)).map((e) => {
		const d = e.id ? revisions.get(e.id) : undefined;
		if (!d) return e;
		if (e.type === "custom_message") return { ...e, content: d.text, details: { ...e.details as object, rpTimeline: d.timeline, rpDraft: { id: d.draftId, version: d.version, phase: d.phase ?? "sealed" } } };
		const m = e.message as { role?: string; content?: Array<{ type: string }>; details?: Record<string, unknown> };
		const previousDraft = m.details?.rpDraft as { phase?: string } | undefined;
		return { ...e, message: { ...m, content: [...(Array.isArray(m.content) ? m.content.filter((c) => c.type === "thinking") : []), { type: "text", text: d.text }], details: { ...m.details, rpTimeline: d.timeline, rpDraft: { id: d.draftId, version: d.version, phase: d.phase ?? previousDraft?.phase ?? "sealed" } } } };
	});
}
