/**
 * agent 模式的稿子视图（docs/PLAN-AGENT-CODING.md §八）：中间是稿子，右栏是讨论。
 * 稿子＝正文/ 目录下的文件（hello 带目录、GET /api/story 带正文）；用户直接改稿＝写文件并立即落检查点
 * （POST /api/story/edit）；「历史」页签＝检查点列表＋逐文件 diff，两式恢复（只文件 / 文件和对话）。
 */
import { useEffect, useRef, useState } from "react";

import type { WireCheckpoint, WireStoryFile } from "../wire.ts";
import { RichContent, type SkinProp } from "./Messages.tsx";
import { IconChevronLeft, IconChevronRight } from "./icons.tsx";
import { t } from "../i18n/index.ts";

/** text＝原文（编辑框用）；display＝服务端按扮演同一条链上过皮肤的上屏正文 */
export type StoryFileView = WireStoryFile & { text: string; display: string };
export interface StoryDiffFile { kind: "added" | "modified" | "renamed" | "removed"; name: string; from?: string; hunks: Array<{ op: " " | "-" | "+"; text: string }> }

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
				<span className="story-editor-meta">{t("{n} 字", { n: text.length })}{dirty ? t(" · 未保存") : ""}</span>
				<button type="button" className="drawer-btn" onClick={onCancel} disabled={saving}>{t("取消")}</button>
				<button
					type="button"
					className="drawer-btn spv2-modal-ok"
					disabled={saving || busy || !dirty || !text.trim()}
					onClick={async () => {
						setSaving(true);
						try { await onSave(text); } finally { setSaving(false); }
					}}
				>
					{t("保存")}
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
	if (c.added.length) parts.push(t("新增 {n}", { n: c.added.length }));
	if (c.modified.length) parts.push(t("修改 {n}", { n: c.modified.length }));
	if (c.renamed.length) parts.push(t("改名 {n}", { n: c.renamed.length }));
	if (c.removed.length) parts.push(t("删除 {n}", { n: c.removed.length }));
	return parts.join(" · ") || t("无改动");
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
	if (!checkpoints.length) return <div className="story-empty">{t("还没有检查点。每一轮改过正文，梨园就保存一次。")}</div>;
	const latest = checkpoints[checkpoints.length - 1]!;
	return (
		<ol className="story-history">
			{[...checkpoints].reverse().map((cp) => (
				<li key={cp.id} className={`story-cp ${cp.author === "user" ? "story-cp-user" : ""} ${openId === cp.id ? "story-cp-open" : ""}`}>
					<button type="button" className="story-cp-head" onClick={() => setOpenId(openId === cp.id ? null : cp.id)}>
						<span className="story-cp-time">{fmtTime(cp.ts)}</span>
						<span className="story-cp-author">{cp.author === "user" ? t("你") : "agent"}</span>
						<span className="story-cp-msg">{cp.message}</span>
						<span className="story-cp-sum">{changeSummary(cp.changed)}</span>
					</button>
					{openId === cp.id && (
						<div className="story-cp-body">
							{diff?.id !== cp.id ? <div className="story-cp-loading">{t("读取中…")}</div> : diff.files.length === 0 ? <div className="story-cp-loading">{t("无文件改动")}</div> : diff.files.map((f) => (
								<details key={f.name} className={`story-diff story-diff-${f.kind}`} open={f.kind !== "removed"}>
									<summary>
										<span className="story-diff-kind">{t({ added: "新增", modified: "修改", renamed: "改名", removed: "删除" }[f.kind])}</span>{/* i18n-ignore：表值经 t() 翻 */}
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
								<button type="button" className="story-act" disabled={busy || cp.id === latest.id} title={t("正文/ 回到这次改动之后的样子；讨论不动")} onClick={() => onRestore(cp, "files")}>{t("只恢复文件")}</button>
								{cp.turnId && (
									<button type="button" className="story-act" disabled={busy} title={t("文件回到这轮输入之前，讨论也截到那句输入之前")} onClick={() => onRestore(cp, "both")}>{t("文件和对话一起回到这轮之前")}</button>
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
	skin,
	focus,
	busy,
	onBack,
	chatCollapsed,
	onToggleChat,
	onEdit,
	loadDiff,
	onRestore,
}: {
	/** null＝正文还在拉取 */
	files: StoryFileView[] | null;
	checkpoints: WireCheckpoint[];
	/** 一档卡皮肤（与扮演气泡同一份）：display 已在服务端上过皮肤，这里只用于 RichContent 的宏与二次判定（同气泡） */
	skin: SkinProp | null;
	/** 讨论区检查点卡片点击：切到历史并展开它；或滚到某文件 */
	focus: { file?: string; checkpointId?: string; tick: number } | null;
	/** 生成中：编辑/恢复不可用 */
	busy: boolean;
	/** 手机：滑回讨论那一页 */
	onBack: () => void;
	/** 桌面：讨论栏收起/展开 */
	chatCollapsed: boolean;
	onToggleChat: () => void;
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
				<button type="button" className="story-back" onClick={onBack} aria-label={t("回到讨论")}>
					{t("讨论")}
				</button>
				<span className="story-title">{t("正文")}</span>
				<span className="story-meta">{files ? t("{n} 个文件 · {chars} 字", { n: files.length, chars: total }) : t("读取中…")}</span>
				<span className="story-tabs" role="tablist">
					<button type="button" role="tab" aria-selected={tab === "text"} className={`story-tab ${tab === "text" ? "story-tab-on" : ""}`} onClick={() => setTab("text")}>{t("正文")}</button>
					<button type="button" role="tab" aria-selected={tab === "history"} className={`story-tab ${tab === "history" ? "story-tab-on" : ""}`} onClick={() => setTab("history")}>{t("历史")}{checkpoints.length ? ` ${checkpoints.length}` : ""}</button>
				</span>
				<button
					type="button"
					className="story-chat-toggle"
					onClick={onToggleChat}
					aria-expanded={!chatCollapsed}
					title={chatCollapsed ? t("展开讨论") : t("收起讨论")}
					aria-label={chatCollapsed ? t("展开讨论") : t("收起讨论")}
				>
					{chatCollapsed ? <IconChevronLeft size={15} /> : <IconChevronRight size={15} />}
				</button>
			</div>
			{tab === "history" ? (
				<div className="story-body">
					<HistoryList checkpoints={checkpoints} busy={busy} loadDiff={loadDiff} onRestore={onRestore} />
				</div>
			) : (
				<>
					{files && files.length > 0 && (
						<nav className="story-outline" aria-label={t("目录")}>
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
							<div className="story-empty">{t("正文还是空的。在右边讨论，agent 会把定稿写入文件。")}</div>
						)}
						{files?.map((f, i) => (
							<article key={f.name} id={fileId(f.name)} className="story-chapter">
								<h2 className="story-chapter-head">
									<span className="story-chapter-no">{i + 1}</span>
									<span className="story-chapter-title">{f.title}</span>
									<span className="story-chapter-file" title={f.name}>{f.name}</span>
									<span className="story-chapter-chars">{t("{n} 字", { n: f.chars })}</span>
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
										{/* 与扮演气泡同一条渲染链：服务端 prepareDisplayText（皮肤/MVU/整页保护）→ 前端 HTML 帧 → Markdown/RP 行内 */}
										<RichContent text={f.display} skin={skin} />
										<div className="story-chapter-acts">
											<button type="button" className="story-act" disabled={busy || editing !== null} onClick={() => setEditing(f.name)}>
												{t("编辑")}
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
