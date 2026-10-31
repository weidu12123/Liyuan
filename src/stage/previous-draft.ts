/** A fixed previous-reply editor. It never accepts a historical entry selector. */
import { isBackstageText } from "../stance.ts";
import { storyBranch } from "../conversation-mode.ts";
import { applyDraftRevisions, type DraftBranchEntry } from "./draft-projection.ts";
import { DraftStore } from "./draft-store.ts";
import { commitWorkspace, finalTimeline, runWriteTool, type TurnWorkspace, type WorkspaceDeps, type WriteToolResult } from "./workspace.ts";

const textOf = (content: unknown): string => typeof content === "string" ? content : Array.isArray(content)
	? content.filter((c) => c?.type === "text").map((c) => c.text ?? "").join("") : "";

interface PreviousReply {
	entryId: string;
	text: string;
	version: number;
	draftId?: string;
	phase: string;
	timeline?: unknown;
	choices?: TurnWorkspace["choices"];
}

/** The last story reply, including legacy replies without a workspace. A stopped reply is not skipped. */
export function previousReply(branch: DraftBranchEntry[]): PreviousReply | undefined {
	let latest: PreviousReply | undefined;
	let backstage = false;
	for (const e of applyDraftRevisions(storyBranch(branch), { omitEditRequests: true })) {
		const m = e.type === "message" ? e.message as { role?: string; content?: unknown; stopReason?: string; details?: Record<string, unknown> } : undefined;
		if (m?.role === "user") backstage = isBackstageText(textOf(m.content));
		const edited = e.type === "custom_message" && e.customType === "rp-edited-reply";
		if (!e.id || backstage || (m?.role !== "assistant" && !edited)) continue;
		if (m?.stopReason === "toolUse" || (Array.isArray(m?.content) && m.content.some((c) => c?.type === "toolCall"))) continue;
		const text = textOf(edited ? e.content : m?.content);
		if (!text.trim()) continue;
		const details = (edited ? e.details : m?.details) as Record<string, unknown> | undefined;
		const draft = details?.rpDraft as { id?: string; version?: number; phase?: string } | undefined;
		latest = { entryId: e.id, text, draftId: draft?.id,
			version: Number.isInteger(draft?.version) && draft!.version! > 0 ? draft!.version! : 1,
			phase: draft?.phase ?? (m?.stopReason === "aborted" || m?.stopReason === "error" || m?.stopReason === "length" ? "stopped" : "sealed"),
			timeline: details?.rpTimeline, choices: Array.isArray(details?.rpChoices) ? details.rpChoices : undefined };
	}
	return latest;
}

type Snapshot = { reply: PreviousReply; source?: TurnWorkspace; fingerprint: string };

export class PreviousDraftEditor {
	readonly #targetId: string | undefined;
	#observed?: Snapshot;
	readonly getBranch: () => DraftBranchEntry[];
	readonly directory: string;
	constructor(getBranch: () => DraftBranchEntry[], directory: string) {
		this.getBranch = getBranch;
		this.directory = directory;
		this.#targetId = previousReply(getBranch())?.entryId;
	}

	#snapshot(ws: TurnWorkspace): Snapshot {
		const branch = this.getBranch();
		if (!ws.userId || !branch.some((e) => e.id === ws.userId && e.type === "message" && (e.message as { role?: string })?.role === "user")) throw new Error("当前请求已不在此分支，未修改上一拍。");
		const reply = previousReply(branch);
		if (!reply || !this.#targetId) throw new Error("当前分支没有可修订的上一拍回复。");
		if (reply.entryId !== this.#targetId) throw new Error("上一拍已变化，本次请求不能改到另一拍。");
		if (reply.phase !== "sealed") throw new Error("上一拍尚未收笔，不能作为已定稿正文回改。");
		const stored = reply.draftId ? new DraftStore(this.directory, reply.draftId).read() : undefined;
		const source = stored?.sessionId === ws.sessionId ? stored : undefined;
		return { reply, source, fingerprint: JSON.stringify({ reply, source }) };
	}

	run(ws: TurnWorkspace, deps: WorkspaceDeps, name: string, args: Record<string, unknown>): WriteToolResult {
		const fail = (text: string): WriteToolResult => ({ ok: false, isError: true, text });
		try {
			if (name === "previous_draft_read") {
				const snapshot = this.#snapshot(ws);
				const view = { ...ws, draft: snapshot.reply.text, version: snapshot.reply.version };
				const result = runWriteTool(view, { ...deps, persist: undefined, reload: undefined, file: undefined }, "draft_read", args);
				const choices = snapshot.reply.choices ?? snapshot.source?.choices;
				if (result.ok && choices?.length) result.text = JSON.stringify({ ...JSON.parse(result.text), userChoices: choices });
				if (result.ok) this.#observed = snapshot;
				return { ...result, activity: result.ok ? "读取上一拍原稿" : undefined, details: { targetId: snapshot.reply.entryId, version: snapshot.reply.version } };
			}
			if (name !== "previous_draft_edit") return fail(`未知上一拍工具 ${name}。`);
			if (ws.revision || ws.draft) return fail("本次请求已有稿件，不能同时回改上一拍。");
			if (ws.mode !== "write") return fail("当前为探索阶段，尚未开放写入。");
			if (!this.#observed) return fail("尚未读取上一拍原稿；previous_draft_read 可读取原文与版本。");
			const snapshot = this.#snapshot(ws);
			if (snapshot.fingerprint !== this.#observed.fingerprint || args.version !== snapshot.reply.version) return fail("上一拍版本已变化，本次未修改；previous_draft_read 可重新读取。");
			const { reply, source } = snapshot;
			// Copy on write: the original artifact may be shared by sibling worldlines.
			const next = structuredClone(ws);
			next.draft = reply.text;
			next.version = reply.version;
			next.choices = structuredClone(reply.choices ?? source?.choices);
			next.revisions = structuredClone(source?.revisions.filter((r) => r.version <= reply.version) ?? []);
			if (next.revisions.at(-1)?.version !== reply.version || next.revisions.at(-1)?.text !== reply.text) {
				next.revisions = next.revisions.filter((r) => r.version < reply.version);
				next.revisions.push({ version: reply.version, text: reply.text, reason: "previous_reply", at: source?.updatedAt ?? Date.now() });
			}
			const timeline = reply.timeline ?? (source?.draft === reply.text ? source.timeline : undefined);
			next.timeline = Array.isArray(timeline) ? structuredClone(timeline) : [];
			next.timeline = next.timeline.map((s) => s.kind === "text" ? { ...s, draft: true } : s);
			next.timeline = finalTimeline(next, reply.text);
			const edited = runWriteTool(next, { ...deps, persist: undefined, reload: undefined }, "draft_edit", args);
			if (!edited.ok) return edited;
			if (!next.draft.trim()) return fail("上一拍修订不能清空整篇正文。");
			if (next.version !== reply.version) next.revisions.at(-1)!.reason = name;
			next.sealed = true; next.phase = "sealed";
			next.entryId = reply.entryId;
			next.revision = { targetId: reply.entryId, requestId: ws.userId!, sourceDraftId: reply.draftId, sourceVersion: reply.version };
			next.restorePending = true;
			commitWorkspace(ws, deps, next);
			return { ...edited, text: `上一拍已修订，v${next.version}。`, activity: "修订上一拍原稿", details: { targetId: reply.entryId, draftId: ws.id, version: ws.version } };
		} catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
	}
}
