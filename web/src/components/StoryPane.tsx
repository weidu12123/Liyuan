/**
 * agent 模式的稿子视图（docs/PLAN-AGENT-MODE.md §5.6）：中间是稿子，右栏是讨论。
 * 数据＝当前分支的章投影（hello 带目录、GET /api/story 带正文）；按章直接编辑走服务端同一条修订落点
 * （POST /api/story/edit，来源 user）；「回退到此章之后」＝树导航（story_rewind 帧）；写入中的章按流式预览
 * 挂在末尾（story_preview 帧，替换语义）。
 */
import { useEffect, useRef, useState } from "react";

import type { WireStoryChapter } from "../wire.ts";

export type StoryChapterView = WireStoryChapter & { text: string };

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

function ChapterEditor({ chapter, busy, onSave, onCancel }: { chapter: StoryChapterView; busy: boolean; onSave: (text: string) => Promise<void>; onCancel: () => void }) {
	const [text, setText] = useState(chapter.text);
	const [saving, setSaving] = useState(false);
	const ref = useRef<HTMLTextAreaElement>(null);
	useEffect(() => { ref.current?.focus(); }, []);
	const dirty = text !== chapter.text;
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
					保存为 v{chapter.version + 1}
				</button>
			</div>
		</div>
	);
}

export function StoryPane({
	chapters,
	preview,
	focus,
	busy,
	onBack,
	onEdit,
	onRewind,
}: {
	/** null＝正文还在拉取 */
	chapters: StoryChapterView[] | null;
	/** 写入中的章（story_append 参数流式预览） */
	preview: { text: string; title?: string } | null;
	/** 讨论区章卡片点击：滚到该章 */
	focus: { chapterId: string; tick: number } | null;
	/** 生成中：编辑/回退按钮不可用 */
	busy: boolean;
	/** 手机页签：回到讨论 */
	onBack: () => void;
	/** 用户按章直接编辑（全文替换成新版本）；抛错＝失败提示 */
	onEdit: (chapter: StoryChapterView, text: string) => Promise<void>;
	/** 回退到写入该章的那一轮之后 */
	onRewind: (chapter: StoryChapterView) => void;
}) {
	const seen = useRef<Set<string>>(new Set());
	const [editing, setEditing] = useState<string | null>(null);
	const scrollTo = (id: string, smooth = true) => {
		document.getElementById(id)?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
	};
	useEffect(() => {
		if (focus) scrollTo(`story-ch-${focus.chapterId}`);
	}, [focus]);
	// 新写入的章：自动滚到它（回退/分叉后的章目录变短不滚）
	useEffect(() => {
		if (!chapters) return;
		const fresh = chapters.filter((c) => !seen.current.has(c.chapterId));
		seen.current = new Set(chapters.map((c) => c.chapterId));
		const last = fresh.at(-1);
		if (last && fresh.length < chapters.length) requestAnimationFrame(() => scrollTo(`story-ch-${last.chapterId}`));
		if (editing && !chapters.some((c) => c.chapterId === editing)) setEditing(null);
	}, [chapters, editing]);
	// 流式预览：跟着末尾走
	useEffect(() => {
		if (preview?.text) requestAnimationFrame(() => scrollTo("story-ch-preview", false));
	}, [preview?.text.length]);

	const total = chapters?.reduce((n, c) => n + c.chars, 0) ?? 0;
	return (
		<div className="story-pane-inner">
			<div className="story-head">
				<button type="button" className="story-back" onClick={onBack} aria-label="回到讨论">
					讨论
				</button>
				<span className="story-title">稿子</span>
				<span className="story-meta">{chapters ? `${chapters.length} 章 · ${total} 字` : "读取中…"}</span>
			</div>
			{chapters && chapters.length > 0 && (
				<nav className="story-outline" aria-label="章目录">
					{chapters.map((c) => (
						<button key={c.chapterId} type="button" className="story-outline-item" onClick={() => scrollTo(`story-ch-${c.chapterId}`)} title={c.title}>
							<span className="story-outline-index">{c.index}</span>
							<span className="story-outline-title">{c.title || `第 ${c.index} 章`}</span>
						</button>
					))}
				</nav>
			)}
			<div className="story-body">
				{chapters && chapters.length === 0 && !preview?.text && (
					<div className="story-empty">稿子还是空的。在右边讨论，agent 会把定稿写进来。</div>
				)}
				{chapters?.map((c, i) => (
					<article key={`${c.chapterId}:${c.version}`} id={`story-ch-${c.chapterId}`} className="story-chapter">
						<h2 className="story-chapter-head">
							<span className="story-chapter-no">第 {c.index} 章</span>
							{c.title && <span className="story-chapter-title">{c.title}</span>}
							{c.version > 1 && <span className="story-chapter-ver" title={`第 ${c.version} 版`}>v{c.version}</span>}
							<span className="story-chapter-chars">{c.chars} 字</span>
						</h2>
						{editing === c.chapterId ? (
							<ChapterEditor
								chapter={c}
								busy={busy}
								onSave={async (text) => { await onEdit(c, text); setEditing(null); }}
								onCancel={() => setEditing(null)}
							/>
						) : (
							<>
								<Prose text={c.text} />
								<div className="story-chapter-acts">
									<button type="button" className="story-act" disabled={busy || editing !== null} onClick={() => setEditing(c.chapterId)}>
										编辑
									</button>
									{i < chapters.length - 1 && (
										<button
											type="button"
											className="story-act"
											disabled={busy || editing !== null}
											title="之后的章退出当前分支（文件与会话树都还在）；从这里继续写＝分叉"
											onClick={() => onRewind(c)}
										>
											回退到此章之后
										</button>
									)}
								</div>
							</>
						)}
					</article>
				))}
				{preview?.text && (
					<article id="story-ch-preview" className="story-chapter story-chapter-preview" aria-live="polite">
						<h2 className="story-chapter-head">
							<span className="story-chapter-no">第 {(chapters?.length ?? 0) + 1} 章</span>
							{preview.title && <span className="story-chapter-title">{preview.title}</span>}
							<span className="story-chapter-ver">写入中</span>
							<span className="story-chapter-chars">{preview.text.length} 字</span>
						</h2>
						<Prose text={preview.text} />
					</article>
				)}
			</div>
		</div>
	);
}
