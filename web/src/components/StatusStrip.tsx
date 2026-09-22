/**
 * 世界状态拆分：
 * - StatusStrip：输入框上方，一行生效摘要（时间·地点），点开可编辑
 * - SessionStatsBar：输入框下方，消息数 / token / 上下文占用（不计费）
 */

import { useEffect, useRef, useState } from "react";
import { apiPut, type StatePatchResult } from "../api.ts";
import type { WireStats, WorldState } from "../wire.ts";
import { IconChevronDown, IconPencil, IconTrash } from "./icons.tsx";
import { ConfirmButton, useAction } from "./kit.tsx";
import { t } from "../i18n/index.ts";

/** 行内编辑：点击铅笔→输入框（回车保存 / Esc 取消） */
export function Editable({
	value,
	placeholder,
	onSave,
	multiline,
}: {
	value: string;
	placeholder?: string;
	onSave: (v: string) => void;
	multiline?: boolean;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(value);
	const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
	useEffect(() => {
		if (editing) {
			setDraft(value);
			ref.current?.focus();
		}
	}, [editing, value]);
	if (!editing) {
		return (
			<span className="editable">
				<span className={value ? "" : "editable-empty"}>{value || placeholder || t("（未记录）")}</span>
				<button type="button" className="act edit-pen" title={t("编辑")} aria-label={t("编辑")} onClick={() => setEditing(true)}>
					<IconPencil size={12} />
				</button>
			</span>
		);
	}
	const commit = () => {
		setEditing(false);
		if (draft !== value) onSave(draft);
	};
	const keyHandler = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && (!multiline || !e.shiftKey)) {
			e.preventDefault();
			commit();
		}
		if (e.key === "Escape") setEditing(false);
	};
	return multiline ? (
		<textarea
			ref={ref as React.RefObject<HTMLTextAreaElement>}
			className="panel-search ta"
			rows={3}
			value={draft}
			onChange={(e) => setDraft(e.target.value)}
			onKeyDown={keyHandler}
			onBlur={commit}
		/>
	) : (
		<input
			ref={ref as React.RefObject<HTMLInputElement>}
			className="panel-search rename-input"
			value={draft}
			onChange={(e) => setDraft(e.target.value)}
			onKeyDown={keyHandler}
			onBlur={commit}
		/>
	);
}

export const isEmptyState = (s: WorldState) =>
	!s.time &&
	!s.location &&
	Object.keys(s.characters).length === 0 &&
	s.inventory.length === 0 &&
	Object.keys(s.flags).length === 0 &&
	s.plot_threads.length === 0;


const fmtK = (n: number) => {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
	if (n >= 10_000) return `${Math.round(n / 1000)}k`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
};

/** 输入框下方：会话用量（无费用） */
export function SessionStatsBar({ stats }: { stats: WireStats | null }) {
	if (!stats) return null;
	const msgs = stats.userMessages + stats.assistantMessages;
	const win = stats.contextWindow && stats.contextWindow > 0 ? stats.contextWindow : null;
	const used = typeof stats.contextTokens === "number" && stats.contextTokens >= 0 ? stats.contextTokens : null;
	// 累计 = 本分支各轮 input+output+cache 相加（每轮都会重发 system，会比「上下文」大很多）
	// 上下文 = 上一轮请求的 prompt 侧占用（不含生成输出）
	const ctxLabel =
		stats.contextPercent !== null
			? win
				? t("上下文 {pct}%（{used} / {win}）", { pct: Math.round(stats.contextPercent), used: used != null ? fmtK(used) : "?", win: fmtK(win) })
				: t("上下文 {pct}%", { pct: Math.round(stats.contextPercent) })
			: null;
	const parts = [
		t("{n} 条消息", { n: msgs }),
		t("累计 {tokens}", { tokens: fmtK(stats.totalTokens) }),
		ctxLabel,
	].filter(Boolean);
	const title = [
		t("累计：本会话各轮请求 token 相加（每轮重发 system+历史，数字会远大于单次上下文）"),
		win
			? t("上下文：上一轮装进模型窗口的 prompt 量 / 窗口 {win}（不含回复输出；连接面板可改窗口）", { win: fmtK(win) })
			: t("上下文：当前窗口占用"),
	].join("\n");
	return (
		<div className="session-stats-bar" title={title}>
			{parts.join(" · ")}
		</div>
	);
}

/** 输入框上方：生效的世界状态（一行摘要，点击展开右侧状态栏） */
export function StatusStrip({
	state,
	toast,
	onOpenPanel,
	active = false,
}: {
	state: WorldState | null;
	toast: (level: "info" | "warning" | "error", text: string) => void;
	onOpenPanel?: () => void;
	active?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const { run } = useAction(toast);

	const patch = (p: Record<string, unknown>) =>
		run(async () => {
			const r = await apiPut<StatePatchResult>("/api/state", { patch: p });
			for (const w of r.warnings) toast("warning", w);
		});

	const num = (v: string, fallback: number): number => {
		const n = Number(v);
		return Number.isFinite(n) ? n : fallback;
	};

	const empty = !state || isEmptyState(state);
	const summary = empty
		? t("世界状态（随对话自动记录）")
		: [state.time, state.location].filter(Boolean).join(" · ") || t("世界状态");

	const isOpen = onOpenPanel ? active : open;
	const handleClick = () => {
		if (onOpenPanel) {
			onOpenPanel();
		} else {
			setOpen((v) => !v);
		}
	};

	return (
		<div className={`status-strip ${isOpen ? "open" : ""}`}>
			<button type="button" className="status-strip-bar" onClick={handleClick} aria-expanded={isOpen}>
				<span className={`status-strip-text ${empty ? "faint" : ""}`}>{summary}</span>
				<IconChevronDown size={14} className={`strip-caret ${isOpen ? "up" : ""}`} />
			</button>
			{!onOpenPanel && open && (
				<div className="status-card">
					<div className="kv">
						<span className="kv-k">{t("时间")}</span>
						<span className="kv-v">
							<Editable value={state?.time ?? ""} onSave={(v) => patch({ time: v })} />
						</span>
					</div>
					<div className="kv">
						<span className="kv-k">{t("地点")}</span>
						<span className="kv-v">
							<Editable value={state?.location ?? ""} onSave={(v) => patch({ location: v })} />
						</span>
					</div>
					{Object.entries(state?.characters ?? {}).map(([name, c]) => (
						<div key={name} className="sp-char">
							<div className="sp-char-head">
								<span className="sp-char-name">{name}</span>
								<span className="sp-affinity">
									{t("好感")}{" "}
									<Editable
										value={String(c.affinity)}
										onSave={(v) => patch({ characters: { [name]: { affinity: num(v, c.affinity) } } })}
									/>
								</span>
								<ConfirmButton
									title={t("移除「{name}」的状态记录", { name })}
									aria-label={t("移除角色记录")}
									confirmText={t("确认移除")}
									onConfirm={() => patch({ characters: { [name]: null } })}
								>
									<IconTrash size={12} />
								</ConfirmButton>
							</div>
							<div className="affinity-bar" aria-hidden="true">
								<div className="affinity-mid" />
								<div
									className={`affinity-fill ${c.affinity < 0 ? "neg" : ""}`}
									style={
										c.affinity >= 0
											? { left: "50%", width: `${(c.affinity / 100) * 50}%` }
											: { right: "50%", width: `${(-c.affinity / 100) * 50}%` }
									}
								/>
							</div>
							<div className="sp-char-line">
								<Editable value={c.status} placeholder={t("（状态）")} onSave={(v) => patch({ characters: { [name]: { status: v } } })} />
							</div>
							<div className="sp-char-line">
								<Editable
									value={c.at ?? ""}
									placeholder={t("（所在地）")}
									onSave={(v) => patch({ characters: { [name]: { at: v } } })}
								/>
							</div>
							<div className="sp-char-line sp-notes">
								<Editable value={c.notes} placeholder={t("（备注）")} onSave={(v) => patch({ characters: { [name]: { notes: v } } })} />
							</div>
						</div>
					))}
					<div className="kv">
						<span className="kv-k">{t("物品")}</span>
						<span className="kv-v">
							<Editable
								value={(state?.inventory ?? []).join("、")}
								placeholder={t("（空）")}
								onSave={(v) => patch({ inventory: v.split(/[、,，]/).map((s) => s.trim()).filter(Boolean) })}
							/>
						</span>
					</div>
					{Object.entries(state?.flags ?? {}).map(([k, v]) => (
						<div key={k} className="kv">
							<span className="kv-k">{k}</span>
							<span className="kv-v">
								<Editable value={v} onSave={(nv) => patch({ flags: { [k]: nv } })} />
								<ConfirmButton title={t("删除标记「{k}」", { k })} aria-label={t("删除标记")} confirmText={t("确认")} onConfirm={() => patch({ flags: { [k]: null } })}>
									<IconTrash size={12} />
								</ConfirmButton>
							</span>
						</div>
					))}
					<div className="sp-threads">
						<div className="kv-k">{t("剧情线")}</div>
						<Editable
							multiline
							value={(state?.plot_threads ?? []).join("\n")}
							placeholder={t("（每行一条）")}
							onSave={(v) => patch({ plot_threads: v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) })}
						/>
					</div>
					<div className="field-hint">{t("点铅笔可直接改；你的账本你说了算，改动随剧情分支走（回退会跟着回退）。登场名录已独立成面板（输入框工具区「名录」）。")}</div>
				</div>
			)}
		</div>
	);
}
