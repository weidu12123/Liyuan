/**
 * agent 模式的稿子视图（docs/PLAN-AGENT-CODING.md §八）：中间是稿子，右栏是讨论。
 * 稿子＝正文/ 目录下的文件（hello 带目录、GET /api/story 带正文）；用户直接改稿＝写文件并立即落检查点
 * （POST /api/story/edit）；「历史」页签＝检查点列表＋逐文件 diff，两式恢复（只文件 / 文件和对话）。
 */
import { useEffect, useRef, useState } from "react";

import type { WireCheckpoint, WireStoryFile } from "../wire.ts";

export type StoryFileView = WireStoryFile & { text: string };
export interface StoryDiffFile { kind: "added" | "modified" | "renamed" | "removed"; name: string; from?: string; hunks: Array<{ op: " " | "-" | "+"; text: string }> }

const paragraphs = (text: string) =>
	text.split(/\n[\t ]*\n/).map((p) => p.trim()).filter(Boolean);

function Prose({ text }: { text: string }) {
	return (
		<>
			{paragraphs(text).map((p, i) => (
				<p key={i}>
					{p.split("\n").map((line, j, arr) => (
						<span key={j}>
							{line}
							{j < arr.length - 1 && <br />}
						</span>
					))}
				</p>
			))}
		</>
	);
}

function FileEditor({ file, busy, onSave, onCancel }: { file: StoryFileView; busy: boolean; onSave: (text: string) => Promise<void>; onCancel: () => void }) {
	const [text, setText] = useState(file.text);
	const [saving, setSaving] = useState(false);
	const ref = useRef<HTMLTextAreaElement>(null);
	useEffect(() => { ref.current?.focus(); }, []);
	const dirty = text !== file.text;
	return (
		<div className="story-editor">
			<textarea ref={ref} className="story-editor-text" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
			<div className="story-editor-row">
				<span className="story-editor-meta">{text.length} 字{dirty ? " · 未保存" : ""}</span>
				<button type="button" className="drawer-btn" onClick={onCancel} disabled={saving}>取消</button>
				<button
					type="button"
					className="drawer-btn spv2-modal-ok"
					disabled={saving || busy || !dirty || !text.trim()}
					onClick={async () => {
						setSaving(true);
						try { await onSave(text); } finally { setSaving(false); }
					}}
				>
					保存
				</button>
			</div>
		</div>
	);
}

const fmtTime = (ms: number) => {
	const d = new Date(ms);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const changeSummary = (c: WireCheckpoint["changed"]): string => {
	const parts: string[] = [];
	if (c.added.length) parts.push(`新增 ${c.added.length}`);
	if (c.modified.length) parts.push(`修改 ${c.modified.length}`);
	if (c.renamed.length) parts.push(`改名 ${c.renamed.length}`);
	if (c.removed.length) parts.push(`删除 ${c.removed.length}`);
	return parts.join(" · ") || "无改动";
};

function HistoryList({ checkpoints, busy, loadDiff, onRestore }: {
	checkpoints: WireCheckpoint[];
	busy: boolean;
	loadDiff: (id: string) => Promise<StoryDiffFile[]>;
	onRestore: (cp: WireCheckpoint, scope: "files" | "both") => void;
}) {
	const [openId, setOpenId] = useState<string | null>(null);
	const [diff, setDiff] = useState<{ id: string; files: StoryDiffFile[] } | null>(null);
	useEffect(() => {
		if (!openId) return;
		let live = true;
		void loadDiff(openId).then((files) => { if (live) setDiff({ id: openId, files }); }).catch(() => { if (live) setDiff({ id: openId, files: [] }); });
		return () => { live = false; };
	}, [openId, loadDiff]);
	if (!checkpoints.length) return <div className="story-empty">还没有检查点。每一轮改过稿子，梨园就保存一次。</div>;
	const latest = checkpoints[checkpoints.length - 1]!;
	return (
		<ol className="story-history">
			{[...checkpoints].reverse().map((cp) => (
				<li key={cp.id} className={`story-cp ${cp.author === "user" ? "story-cp-user" : ""} ${openId === cp.id ? "story-cp-open" : ""}`}>
					<button type="button" className="story-cp-head" onClick={() => setOpenId(openId === cp.id ? null : cp.id)}>
						<span className="story-cp-time">{fmtTime(cp.ts)}</span>
						<span className="story-cp-author">{cp.author === "user" ? "你" : "agent"}</span>
						<span className="story-cp-msg">{cp.message}</span>
						<span className="story-cp-sum">{changeSummary(cp.changed)}</span>
					</button>
					{openId === cp.id && (
						<div className="story-cp-body">
							{diff?.id !== cp.id ? <div className="story-cp-loading">读取中…</div> : diff.files.length === 0 ? <div className="story-cp-loading">无文件改动</div> : diff.files.map((f) => (
								<details key={f.name} className={`story-diff story-diff-${f.kind}`} open={f.kind !== "removed"}>
									<summary>
										<span className="story-diff-kind">{{ added: "新增", modified: "修改", renamed: "改名", removed: "删除" }[f.kind]}</span>
										{f.from ? `${f.from} → ${f.name}` : f.name}
									</summary>
									{f.hunks.length > 0 && (
										<pre className="story-diff-pre">
											{f.hunks.filter((h) => f.kind === "modified" ? true : h.op !== " ").map((h, i) => (
												<span key={i} className={`story-diff-line story-diff-${h.op === "+" ? "add" : h.op === "-" ? "del" : "ctx"}`}>{h.op} {h.text}{"\n"}</span>
											))}
										</pre>
									)}
								</details>
							))}
							<div className="story-cp-acts">
								<button type="button" className="story-act" disabled={busy || cp.id === latest.id} title="正文/ 回到这次改动之后的样子；讨论不动" onClick={() => onRestore(cp, "files")}>只恢复文件</button>
								{cp.turnId && (
									<button type="button" className="story-act" disabled={busy} title="文件回到这轮输入之前，讨论也截到那句输入之前" onClick={() => onRestore(cp, "both")}>文件和对话一起回到这轮之前</button>
								)}
							</div>
						</div>
					)}
				</li>
			))}
		</ol>
	);
}

export function StoryPane({
	files,
	checkpoints,
	focus,
	busy,
	onBack,
	onEdit,
	loadDiff,
	onRestore,
}: {
	/** null＝正文还在拉取 */
	files: StoryFileView[] | null;
	checkpoints: WireCheckpoint[];
	/** 讨论区检查点卡片点击：切到历史并展开它；或滚到某文件 */
	focus: { file?: string; checkpointId?: string; tick: number } | null;
	/** 生成中：编辑/恢复不可用 */
	busy: boolean;
	/** 手机页签：回到讨论 */
	onBack: () => void;
	/** 用户直接改稿（写文件并落检查点）；抛错＝失败提示 */
	onEdit: (file: StoryFileView, text: string) => Promise<void>;
	loadDiff: (id: string) => Promise<StoryDiffFile[]>;
	onRestore: (cp: WireCheckpoint, scope: "files" | "both") => void;
}) {
	const seen = useRef<Set<string>>(new Set());
	const [editing, setEditing] = useState<string | null>(null);
	const [tab, setTab] = useState<"text" | "history">("text");
	const fileId = (name: string) => `story-f-${encodeURIComponent(name)}`;
	const scrollTo = (id: string, smooth = true) => {
		document.getElementById(id)?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
	};
	useEffect(() => {
		if (!focus) return;
		if (focus.checkpointId) setTab("history");
		else if (focus.file) { setTab("text"); requestAnimationFrame(() => scrollTo(fileId(focus.file!))); }
	}, [focus]);
	// 新出现的文件：自动滚到它（恢复后目录变短不滚）
	useEffect(() => {
		if (!files) return;
		const fresh = files.filter((f) => !seen.current.has(f.name));
		seen.current = new Set(files.map((f) => f.name));
		const last = fresh.at(-1);
		if (last && fresh.length < files.length && tab === "text") requestAnimationFrame(() => scrollTo(fileId(last.name)));
		if (editing && !files.some((f) => f.name === editing)) setEditing(null);
	}, [files, editing, tab]);

	const total = files?.reduce((n, f) => n + f.chars, 0) ?? 0;
	return (
		<div className="story-pane-inner">
			<div className="story-head">
				<button type="button" className="story-back" onClick={onBack} aria-label="回到讨论">
					讨论
				</button>
				<span className="story-title">稿子</span>
				<span className="story-meta">{files ? `${files.length} 个文件 · ${total} 字` : "读取中…"}</span>
				<span className="story-tabs" role="tablist">
					<button type="button" role="tab" aria-selected={tab === "text"} className={`story-tab ${tab === "text" ? "story-tab-on" : ""}`} onClick={() => setTab("text")}>正文</button>
					<button type="button" role="tab" aria-selected={tab === "history"} className={`story-tab ${tab === "history" ? "story-tab-on" : ""}`} onClick={() => setTab("history")}>历史{checkpoints.length ? ` ${checkpoints.length}` : ""}</button>
				</span>
			</div>
			{tab === "history" ? (
				<div className="story-body">
					<HistoryList checkpoints={checkpoints} busy={busy} loadDiff={loadDiff} onRestore={onRestore} />
				</div>
			) : (
				<>
					{files && files.length > 0 && (
						<nav className="story-outline" aria-label="目录">
							{files.map((f, i) => (
								<button key={f.name} type="button" className="story-outline-item" onClick={() => scrollTo(fileId(f.name))} title={f.name}>
									<span className="story-outline-index">{i + 1}</span>
									<span className="story-outline-title">{f.title}</span>
								</button>
							))}
						</nav>
					)}
					<div className="story-body">
						{files && files.length === 0 && (
							<div className="story-empty">稿子还是空的。在右边讨论，agent 会把定稿写成文件放进来。</div>
						)}
						{files?.map((f, i) => (
							<article key={f.name} id={fileId(f.name)} className="story-chapter">
								<h2 className="story-chapter-head">
									<span className="story-chapter-no">{i + 1}</span>
									<span className="story-chapter-title">{f.title}</span>
									<span className="story-chapter-file" title={f.name}>{f.name}</span>
									<span className="story-chapter-chars">{f.chars} 字</span>
								</h2>
								{editing === f.name ? (
									<FileEditor
										file={f}
										busy={busy}
										onSave={async (text) => { await onEdit(f, text); setEditing(null); }}
										onCancel={() => setEditing(null)}
									/>
								) : (
									<>
										<Prose text={f.text} />
										<div className="story-chapter-acts">
											<button type="button" className="story-act" disabled={busy || editing !== null} onClick={() => setEditing(f.name)}>
												编辑
											</button>
										</div>
									</>
								)}
							</article>
						))}
					</div>
				</>
			)}
		</div>
	);
}
