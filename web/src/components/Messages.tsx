/**
 * 聊天区消息渲染：ST 式文档流（名字行 + 正文，无左右对齐）+ 过程条。
 *
 * D10 显示层纪律：narrative/thinking 文本原样呈现，排版（*动作*斜体、"对白"着色）
 * 只是 CSS 级装饰，不改写任何字符；前端绝不生成正文。
 * 过程条是元信息层（agent 工作过程），与正文明确区隔。
 */

import { useEffect, useState } from "react";
import { attachmentUrl, splitAttachments } from "../attachments.ts";
import { splitHtmlParts } from "../htmlEmbed.ts";
import { looksLikeYamlBlock, splitStatusParts, statusLabel, stripYamlFence } from "../statusBlocks.ts";
import type { WireActivity, WireChoice, WireMsg } from "../wire.ts";
import { HtmlFrame } from "./HtmlFrame.tsx";
import {
	IconChevronLeft,
	IconChevronRight,
	IconCopy,
	IconEdit,
	IconPin,
	IconRedo,
	IconSpeaker,
	IconTrash,
	IconUndo,
} from "./icons.tsx";

/** 点击页内放大的图片（lightbox）：点图开遮罩、点遮罩或 Esc 关闭；不跳新窗口 */
export function ZoomImg({ src, alt, title }: { src: string; alt: string; title?: string }) {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open]);
	return (
		<>
			<img src={src} alt={alt} title={title} loading="lazy" className="zoomable" onClick={() => setOpen(true)} />
			{open && (
				<div className="lightbox" onClick={() => setOpen(false)}>
					<img src={src} alt={alt} />
				</div>
			)}
		</>
	);
}

/** 本地消息：wire 消息 + 客户端挂载的当轮过程活动（v0 不持久化，刷新即失） */
export interface ChatMsg extends WireMsg {
	activities?: WireActivity[];
}

export const TOOL_LABELS: Record<string, string> = {
	lorebook_search: "检索世界书",
	world_state_get: "核对世界状态",
	world_state_update: "记录状态",
	lorebook_write: "写入设定集",
	show_image: "展示插图",
	show_audio: "展示音频",
	show_video: "展示视频",
	show_html: "展示 HTML",
	tts: "文生音",
	skill_save: "沉淀技能",
	panel_write: "更新面板",
	panel_read: "查看面板",
	panel_close: "收起面板",
	bash: "执行命令",
	read: "读取文件",
	write: "写入文件",
	edit: "编辑文件",
	grep: "检索文件内容",
	find: "查找文件",
	ls: "列目录",
};

export const toolLabel = (name: string) => {
	if (TOOL_LABELS[name]) return TOOL_LABELS[name];
	// MCP：mcp__server__tool → MCP · tool
	if (name.startsWith("mcp__")) {
		const rest = name.slice("mcp__".length);
		const i = rest.indexOf("__");
		const tool = i >= 0 ? rest.slice(i + 2) : rest;
		return tool ? `MCP · ${tool}` : name;
	}
	return name;
};

/** RP 排版：*动作* → 斜体，"对白"/“对白”/「对白」 → 着色。纯呈现，不改字符。 */
function renderRp(text: string) {
	const parts = text.split(/(\*[^*\n]+\*|"[^"\n]+"|“[^”\n]+”|「[^」\n]+」)/g);
	return parts.map((p, i) => {
		if (p.startsWith("*") && p.endsWith("*")) return <em key={i}>{p.slice(1, -1)}</em>;
		if (/^["“「]/.test(p)) return <span key={i} className="q">{p}</span>;
		return <span key={i}>{p}</span>;
	});
}

export function Paragraphs({ text }: { text: string }) {
	return (
		<>
			{text.split(/\n{2,}/).map((para, i) => (
				<p key={i}>
					{para.split("\n").map((line, j, arr) => (
						<span key={j}>
							{renderRp(line)}
							{j < arr.length - 1 && <br />}
						</span>
					))}
				</p>
			))}
		</>
	);
}

/** 角色卡状态栏面板（normal_status / special_status 等） */
function StatusPanel({ tag, body }: { tag: string; body: string }) {
	const yaml = looksLikeYamlBlock(body);
	const content = yaml ? stripYamlFence(body) : body;
	return (
		<aside className={`st-block st-block-${tag}`} data-tag={tag}>
			<header className="st-block-head">{statusLabel(tag)}</header>
			{yaml ? <pre className="st-block-yaml">{content}</pre> : <div className="st-block-body"><Paragraphs text={content} /></div>}
		</aside>
	);
}

/** 一段纯文本：再拆 HTML 围栏 / 整页 HTML */
function TextWithHtml({ text }: { text: string }) {
	const parts = splitHtmlParts(text);
	if (parts.length === 1 && parts[0].kind === "text") {
		return <Paragraphs text={parts[0].text} />;
	}
	return (
		<>
			{parts.map((p, i) => {
				if (p.kind === "html") return <HtmlFrame key={i} html={p.html} scripts={p.scripts} />;
				if (p.kind === "text" && p.text.trim()) return <Paragraphs key={i} text={p.text} />;
				return null;
			})}
		</>
	);
}

/**
 * 正文渲染：
 * 1) 角色卡状态标签 → 面板
 * 2) ```html / 整段 HTML 文档 → 沙箱预览
 * 3) 其余 RP 排版
 */
export function RichContent({ text }: { text: string }) {
	const statusParts = splitStatusParts(text);
	const onlyPlain =
		statusParts.length === 1 && statusParts[0].kind === "text" && !splitHtmlParts(statusParts[0].text).some((p) => p.kind === "html");
	if (onlyPlain) {
		return <Paragraphs text={statusParts[0].kind === "text" ? statusParts[0].text : text} />;
	}
	return (
		<>
			{statusParts.map((p, i) => {
				if (p.kind === "status") return <StatusPanel key={i} tag={p.tag} body={p.body} />;
				if (p.kind === "text" && p.text.trim()) return <TextWithHtml key={i} text={p.text} />;
				return null;
			})}
		</>
	);
}

/** 模型思维链：折叠呈现（模型原始输出，与正文明确区隔） */
export function ThinkingBlock({ text, live }: { text: string; live?: boolean }) {
	return (
		<details className="thinking">
			<summary className={live ? "pulse" : undefined}>思维链{live ? "…" : ""}</summary>
			<div className="thinking-body">
				<Paragraphs text={text} />
			</div>
		</details>
	);
}

/** 过程条 v0：本轮 agent 工作过程的折叠行（codex 式过程退场但可回看） */
export function ActivityBar({ activities }: { activities: WireActivity[] }) {
	const calls = activities.filter((a) => a.kind === "tool_start").length;
	if (calls === 0) return null;
	return (
		<details className="turn-activity">
			<summary>
				过程 · 工具调用 ×{calls}
			</summary>
			<ul>
				{activities.map((a, i) =>
					a.kind === "tool_start" ? (
						<li key={i} className="ta-call">
							{toolLabel(a.name)}
							{a.detail && <span className="ta-detail">{a.detail}</span>}
						</li>
					) : (
						<li key={i} className={`ta-result ${a.isError ? "ta-error" : ""}`}>
							{a.isError ? "出错" : "结果"}
							{a.detail && <span className="ta-detail">{a.detail}</span>}
						</li>
					),
				)}
			</ul>
		</details>
	);
}

/** 戏外中间步骤（正文+活动，折叠区内使用） */
function BackstageStep({ msg }: { msg: ChatMsg }) {
	return (
		<div className="bs-step">
			{msg.thinking && <ThinkingBlock text={msg.thinking} />}
			<RichContent text={msg.text} />
			{msg.activities && msg.activities.length > 0 && <ActivityBar activities={msg.activities} />}
		</div>
	);
}

/**
 * 戏外轮分组（codex 式过程-成品分离，2026-07-10 用户定调）：
 * 同一轮的中间步骤全部折进「过程」，只露最终报告；最终报告本身可折叠——
 * 最新一轮默认展开，翻历史时旧轮默认收起。
 */
export function BackstageGroup({
	msgs,
	fallbackName,
	open,
	avatarUrl,
}: {
	msgs: ChatMsg[];
	fallbackName: string;
	open: boolean;
	avatarUrl?: string | null;
}) {
	const final = msgs[msgs.length - 1];
	const mid = msgs.slice(0, -1);
	const toolCount = msgs.reduce((n, m) => n + (m.activities?.filter((a) => a.kind === "tool_start").length ?? 0), 0);
	const name = final.name || fallbackName;
	return (
		<div className="msg msg-backstage">
			<div className="msg-head">
				<MsgAvatar src={avatarUrl} name={name} kind="char" />
				<span className="msg-name">{name}</span>
				<span className="chip chip-backstage">助手</span>
			</div>
			{mid.length > 0 && (
				<details className="turn-activity">
					<summary>
						过程 · 中间步骤 ×{mid.length}
						{toolCount > 0 && ` · 工具调用 ×${toolCount}`}
					</summary>
					{mid.map((m, i) => (
						<BackstageStep key={i} msg={m} />
					))}
				</details>
			)}
			<details className="bs-final" open={open}>
				<summary>{open ? "回复" : `回复：${firstLine(final.text)}`}</summary>
				{final.thinking && <ThinkingBlock text={final.thinking} />}
				<RichContent text={final.text} />
				{final.activities && final.activities.length > 0 && <ActivityBar activities={final.activities} />}
			</details>
		</div>
	);
}

const firstLine = (text: string) => {
	const line = text.split("\n").find((l) => l.trim()) ?? "";
	return line.length > 60 ? `${line.slice(0, 60)}…` : line;
};

/**
 * 剧情决策选择卡（Phase 4 柱 1）。两种形态同一组件：
 * - live（onReply 传入且未决）：可点选项、自由输入、停止；
 * - 留痕（choice.answer / choice.stopped，或无 onReply）：置灰只读，标注结果。
 * D10 合规：选择卡是"事前参与"的创作决策界面，不是正文——岔路口本身也是剧情资产。
 */
export function ChoiceCard({ choice, onReply }: { choice: WireChoice; onReply?: (r: { value?: string; stop?: boolean }) => void }) {
	const [custom, setCustom] = useState("");
	const resolved = choice.answer !== undefined || choice.stopped === true;
	const live = !!onReply && !resolved;

	return (
		<div className={`choice-card ${resolved ? "choice-done" : ""}`}>
			<div className="choice-q">{choice.question}</div>
			{choice.options.length > 0 && (
				<div className="choice-options">
					{choice.options.map((opt, i) => {
						const picked = choice.answer === opt;
						return (
							<button
								key={i}
								className={`choice-opt ${picked ? "picked" : ""}`}
								disabled={!live}
								onClick={live ? () => onReply?.({ value: opt }) : undefined}
							>
								<span className="choice-idx">{i + 1}</span>
								{opt}
							</button>
						);
					})}
				</div>
			)}
			{live ? (
				<div className="choice-custom">
					<input
						type="text"
						value={custom}
						placeholder={choice.placeholder ?? "或自己写一个…"}
						onChange={(e) => setCustom(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.nativeEvent.isComposing && custom.trim()) {
								e.preventDefault();
								onReply?.({ value: custom.trim() });
							}
						}}
					/>
					<button className="choice-send" disabled={!custom.trim()} onClick={() => onReply?.({ value: custom.trim() })}>
						提交
					</button>
					<button className="choice-stop" onClick={() => onReply?.({ stop: true })} title="停止本回合，收回主导权">
						停止
					</button>
				</div>
			) : (
				<div className="choice-result">
					{choice.stopped ? (
						<span className="choice-stopped">已停止本回合</span>
					) : choice.answer !== undefined && !choice.options.includes(choice.answer) ? (
						<span className="choice-answered">你的回答：{choice.answer}</span>
					) : choice.answer !== undefined ? (
						<span className="choice-answered">已选择</span>
					) : (
						<span className="choice-answered">已应答</span>
					)}
				</div>
			)}
		</div>
	);
}

/** 消息头像：有图用图，否则字首圆形 */
export function MsgAvatar({
	src,
	name,
	kind = "char",
}: {
	src?: string | null;
	name: string;
	kind?: "user" | "char";
}) {
	const letter = (name || "？").trim().slice(0, 1) || "？";
	if (src) {
		return (
			<span className={`msg-avatar msg-avatar-${kind} has-img`} aria-hidden="true">
				<img src={src} alt="" />
			</span>
		);
	}
	return (
		<span className={`msg-avatar msg-avatar-${kind}`} aria-hidden="true">
			{letter}
		</span>
	);
}

export interface BubbleEditState {
	draft: string;
	/** 用户改稿后点「重新生成」；agent 改稿后点「重新生成」= 采用改写 / 再生成 */
	onChange: (v: string) => void;
	onCancel: () => void;
	onSubmit: () => void;
	/** 提交按钮文案旁注 */
	submitLabel?: string;
}

/** ST 式回复变体：左右箭头；在末条点右 = 再生成（保留旧变体） */
export interface BubbleSwipe {
	index: number;
	total: number;
	onPrev: () => void;
	onNext: () => void;
}

export interface BubbleProps {
	msg: ChatMsg;
	floor?: number;
	fallbackName: string;
	/** 角色卡立绘 / 用户身份头像 URL */
	avatarUrl?: string | null;
	/** 尾部操作 */
	onReroll?: () => void;
	onEdit?: () => void;
	/** 回退到本条之前（含本条之后的剧情） */
	onRewind?: () => void;
	/** 删除本轮 / 删除最后角色回复 */
	onDelete?: () => void;
	onCopy?: (text: string) => void;
	/** 在当前剧情点存档（世界线钉） */
	onStore?: () => void;
	/** 为这段正文文生音 */
	onTts?: (text: string) => void;
	ttsBusy?: boolean;
	/** 开场白切换（仅会话未开聊时） */
	greetingSwitch?: { index: number; total: number; onPrev: () => void; onNext: () => void };
	/** 角色回复变体（ST 箭头；与 greetingSwitch 可同时存在于不同消息） */
	swipe?: BubbleSwipe;
	/** 本条正处于编辑：正文区变输入框，下方「放弃 / 重新生成」 */
	edit?: BubbleEditState;
}

export function Bubble({
	msg,
	floor,
	fallbackName,
	avatarUrl,
	onReroll,
	onEdit,
	onRewind,
	onDelete,
	onCopy,
	onStore,
	onTts,
	ttsBusy,
	greetingSwitch,
	swipe,
	edit,
}: BubbleProps) {
	if (msg.channel === "info") {
		return <div className="info-line">{msg.text}</div>;
	}
	if (msg.channel === "choice") {
		// 留痕的决策选择卡（重放）：置灰只读，标注结果（D10：岔路口是剧情资产）
		return msg.choice ? <ChoiceCard choice={msg.choice} /> : null;
	}
	if (msg.channel === "image") {
		// 插图（agent 经 show_image 交付）：舞台美术，与正文明确区隔（D10 合规：元信息层）
		return (
			<figure className="msg-image">
				<ZoomImg src={msg.src ?? ""} alt={msg.text || "插图"} />
				{msg.text && <figcaption>{msg.text}</figcaption>}
			</figure>
		);
	}
	if (msg.channel === "audio") {
		// 音频（show_audio / tts / 气泡配音）：元交付，可播放
		return (
			<figure className="msg-audio">
				<audio controls preload="metadata" src={msg.src ?? ""}>
					你的浏览器不支持音频播放
				</audio>
				{msg.text && <figcaption>{msg.text}</figcaption>}
			</figure>
		);
	}
	if (msg.channel === "video") {
		// 视频（show_video）：舞台美术，与正文区隔（D10）
		return (
			<figure className="msg-video">
				<video controls preload="metadata" playsInline src={msg.src ?? ""}>
					你的浏览器不支持视频播放
				</video>
				{msg.text && <figcaption>{msg.text}</figcaption>}
			</figure>
		);
	}
	if (msg.channel === "html") {
		// 对话流 HTML 底座（show_html）：与正文区隔的可渲染界面
		if (!msg.html?.trim()) return null;
		return <HtmlFrame html={msg.html} title={msg.text} scripts={msg.scripts === true} />;
	}
	if (msg.channel === "backstage") {
		// 戏外回复（助手答疑/办事）：排版明确区隔于叙事（PLAN-PHASE3 §6.1 显示通道）
		const name = msg.name || fallbackName;
		return (
			<div className="msg msg-backstage">
				<div className="msg-head">
					<MsgAvatar src={avatarUrl} name={name} kind="char" />
					<span className="msg-name">{name}</span>
					<span className="chip chip-backstage">助手</span>
				</div>
				{msg.thinking && <ThinkingBlock text={msg.thinking} />}
				<RichContent text={msg.text} />
				{msg.activities && msg.activities.length > 0 && <ActivityBar activities={msg.activities} />}
			</div>
		);
	}
	if (msg.channel === "import") {
		return (
			<details className="import-block">
				<summary>导入的聊天记录（点开查看）</summary>
				<RichContent text={msg.text} />
			</details>
		);
	}
	const isUser = msg.channel === "user";
	// 用户消息尾行的附件（附件随消息模型）：图片直接进对话显示，文件显示名+类型
	const { body, attachments } = isUser ? splitAttachments(msg.text) : { body: msg.text, attachments: [] };
	const name = msg.name || fallbackName;
	const editing = !!edit;
	return (
		<div
			className={`msg ${isUser ? "msg-user" : "msg-char"} ${isUser && msg.backstage ? "msg-user-backstage" : ""} ${editing ? "msg-editing" : ""}`}
		>
			<div className="msg-head">
				<MsgAvatar src={avatarUrl} name={name} kind={isUser ? "user" : "char"} />
				<span className={`msg-name ${isUser ? "" : "msg-name-char"}`}>{name}</span>
				{msg.channel === "greeting" && <span className="chip">开场白</span>}
				{editing && <span className="chip chip-edit">编辑中</span>}
				{floor !== undefined && <span className="floor">#{floor}</span>}
			</div>
			{msg.thinking && !editing && <ThinkingBlock text={msg.thinking} />}
			{editing ? (
				<div className="msg-edit-box">
					<textarea
						className="msg-edit-ta"
						value={edit.draft}
						onChange={(e) => edit.onChange(e.target.value)}
						rows={Math.min(16, Math.max(4, edit.draft.split("\n").length + 1))}
						autoFocus
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								e.preventDefault();
								edit.onCancel();
							}
						}}
					/>
					<div className="msg-edit-actions">
						<button type="button" className="drawer-btn" onClick={edit.onCancel}>
							放弃
						</button>
						<button
							type="button"
							className="drawer-btn save-btn"
							disabled={!edit.draft.trim()}
							onClick={edit.onSubmit}
							title={edit.submitLabel ?? "确认修改"}
						>
							重新生成
						</button>
					</div>
				</div>
			) : (
				<>
					{body && (isUser ? <Paragraphs text={body} /> : <RichContent text={body} />)}
					{attachments.length > 0 && (
						<div className="msg-attach">
							{attachments.map((a) =>
								a.image ? (
									<span key={a.file} className="msg-attach-img">
										<ZoomImg src={attachmentUrl(a)} alt={a.label} title={a.file} />
									</span>
								) : (
									<a key={a.file} href={attachmentUrl(a)} target="_blank" rel="noreferrer" className="file-chip" title={a.file}>
										<span className="file-ext">{(a.name.split(".").pop() ?? "?").toUpperCase()}</span>
										{a.label}
									</a>
								),
							)}
						</div>
					)}
					{msg.activities && msg.activities.length > 0 && <ActivityBar activities={msg.activities} />}
					{(onReroll || onEdit || onRewind || onDelete || onCopy || onStore || onTts || greetingSwitch || swipe) && (
						<div className="msg-actions">
							{/* 开场白快速切换：不进详情页 */}
							{greetingSwitch && (
								<span className="msg-variant-switch msg-greeting-switch" title="切换备选开场白（无需打开角色卡详情）">
									<button
										type="button"
										className="msg-variant-btn"
										onClick={greetingSwitch.onPrev}
										disabled={greetingSwitch.total <= 1}
										aria-label="上一条开场白"
									>
										<IconChevronLeft size={16} />
									</button>
									<span className="msg-variant-idx">
										开场 {greetingSwitch.index + 1}/{greetingSwitch.total}
									</span>
									<button
										type="button"
										className="msg-variant-btn"
										onClick={greetingSwitch.onNext}
										disabled={greetingSwitch.total <= 1}
										aria-label="下一条开场白"
									>
										<IconChevronRight size={16} />
									</button>
								</span>
							)}
							{/* ST 式回复变体：‹ n/m ›；末条点右 = 再生成，旧变体保留，仅当前进上下文，不写世界线 */}
							{swipe && (
								<span className="msg-variant-switch msg-swipe-switch" title="回复变体：仅当前选中进入模型；点右在末条时再生成">
									<button
										type="button"
										className="msg-variant-btn"
										onClick={swipe.onPrev}
										disabled={swipe.total > 0 && swipe.index <= 0}
										aria-label="上一条变体"
									>
										<IconChevronLeft size={16} />
									</button>
									<span className="msg-variant-idx">
										{swipe.total > 0 ? `${swipe.index + 1}/${swipe.total}` : "1/1"}
									</span>
									<button
										type="button"
										className="msg-variant-btn msg-variant-btn-gen"
										onClick={swipe.onNext}
										aria-label={
											swipe.total === 0 || swipe.index >= swipe.total - 1
												? "生成新变体"
												: "下一条变体"
										}
										title={
											swipe.total === 0 || swipe.index >= swipe.total - 1
												? "生成新回复（原回复保留为变体）"
												: "下一条变体"
										}
									>
										<IconChevronRight size={16} />
									</button>
								</span>
							)}
							{onRewind && (
								<button className="act" onClick={onRewind} title="回退到此条之前（之后的剧情进会话树旁支）">
									<IconUndo size={13} /> 回退
								</button>
							)}
							{onReroll && (
								<button className="act" onClick={onReroll} title="再生成一条变体（原回复保留；等同末条点右箭头）">
									<IconRedo size={13} /> 生成
								</button>
							)}
							{onEdit && (
								<button className="act" onClick={onEdit} title="在本条内修改文案">
									<IconEdit size={13} /> 修改
								</button>
							)}
							{onDelete && (
								<button className="act" onClick={onDelete} title="删除本轮或最后角色回复">
									<IconTrash size={13} /> 删除
								</button>
							)}
							{onCopy && (
								<button className="act" onClick={() => onCopy(msg.text)} title="复制正文">
									<IconCopy size={13} /> 复制
								</button>
							)}
							{onStore && (
								<button className="act" onClick={onStore} title="在当前剧情点存档（世界线节点）">
									<IconPin size={13} /> 存档
								</button>
							)}
							{onTts && (
								<button
									className="act"
									disabled={ttsBusy || !msg.text.trim()}
									onClick={() => onTts(msg.text)}
									title="文生音：为这段正文生成语音并显示播放器"
								>
									<IconSpeaker size={13} /> {ttsBusy ? "配音中…" : "配音"}
								</button>
							)}
						</div>
					)}
				</>
			)}
		</div>
	);
}
