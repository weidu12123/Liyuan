/**
 * agent 模式的稿子视图（docs/PLAN-AGENT-MODE.md §5.6）：中间是稿子，右栏是讨论。
 * 数据＝当前分支的章投影（hello 带目录、GET /api/story 带正文）；章级编辑与导出归刀 3。
 */
import { useEffect, useRef } from "react";

import type { WireStoryChapter } from "../wire.ts";

export type StoryChapterView = WireStoryChapter & { text: string };

const paragraphs = (text: string) =>
	text.split(/\n[\t ]*\n/).map((p) => p.trim()).filter(Boolean);

export function StoryPane({
	chapters,
	focus,
	onBack,
}: {
	/** null＝正文还在拉取 */
	chapters: StoryChapterView[] | null;
	/** 讨论区章卡片点击：滚到该章 */
	focus: { chapterId: string; tick: number } | null;
	/** 手机页签：回到讨论 */
	onBack: () => void;
}) {
	const bodyRef = useRef<HTMLDivElement>(null);
	const seen = useRef<Set<string>>(new Set());
	const scrollTo = (chapterId: string, smooth = true) => {
		document.getElementById(`story-ch-${chapterId}`)?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
	};
	useEffect(() => {
		if (focus) scrollTo(focus.chapterId);
	}, [focus]);
	// 新写入的章：自动滚到它（回退/分叉后的章目录变短不滚）
	useEffect(() => {
		if (!chapters) return;
		const fresh = chapters.filter((c) => !seen.current.has(c.chapterId));
		seen.current = new Set(chapters.map((c) => c.chapterId));
		const last = fresh.at(-1);
		if (last && fresh.length < chapters.length) requestAnimationFrame(() => scrollTo(last.chapterId));
	}, [chapters]);

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
						<button key={c.chapterId} type="button" className="story-outline-item" onClick={() => scrollTo(c.chapterId)} title={c.title}>
							<span className="story-outline-index">{c.index}</span>
							<span className="story-outline-title">{c.title || `第 ${c.index} 章`}</span>
						</button>
					))}
				</nav>
			)}
			<div className="story-body" ref={bodyRef}>
				{chapters && chapters.length === 0 && (
					<div className="story-empty">稿子还是空的。在右边讨论，agent 会把定稿写进来。</div>
				)}
				{chapters?.map((c) => (
					<article key={`${c.chapterId}:${c.version}`} id={`story-ch-${c.chapterId}`} className="story-chapter">
						<h2 className="story-chapter-head">
							<span className="story-chapter-no">第 {c.index} 章</span>
							{c.title && <span className="story-chapter-title">{c.title}</span>}
							{c.version > 1 && <span className="story-chapter-ver" title={`第 ${c.version} 版`}>v{c.version}</span>}
							<span className="story-chapter-chars">{c.chars} 字</span>
						</h2>
						{paragraphs(c.text).map((p, i) => (
							<p key={i}>
								{p.split("\n").map((line, j, arr) => (
									<span key={j}>
										{line}
										{j < arr.length - 1 && <br />}
									</span>
								))}
							</p>
						))}
					</article>
				))}
			</div>
		</div>
	);
}
