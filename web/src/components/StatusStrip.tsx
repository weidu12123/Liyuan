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
				<span className={value ? "" : "editable-empty"}>{value || placeholder || "（未记录）"}</span>
				<button type="button" className="act edit-pen" title="编辑" aria-label="编辑" onClick={() => setEditing(true)}>
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

const isEmptyState = (s: WorldState) =>
	!s.time &&
	!s.location &&
	Object.keys(s.characters).length === 0 &&
	s.inventory.length === 0 &&
	Object.keys(s.flags).length === 0 &&
	s.plot_threads.length === 0;

/** 输入框下方：会话用量（无费用） */
export function SessionStatsBar({ stats }: { stats: WireStats | null }) {
	if (!stats) return null;
	const msgs = stats.userMessages + stats.assistantMessages;
	const parts = [
		`${msgs} 条消息`,
		`${stats.totalTokens.toLocaleString()} token`,
		stats.contextPercent !== null ? `上下文 ${Math.round(stats.contextPercent)}%` : null,
	].filter(Boolean);
	return (
		<div className="session-stats-bar" title="本会话用量（费用不显示，难以精确）">
			{parts.join(" · ")}
		</div>
	);
}

/** 输入框上方：生效的世界状态（一行摘要，展开可编辑） */
export function StatusStrip({
	state,
	toast,
}: {
	state: WorldState | null;
	toast: (level: "info" | "warning" | "error", text: string) => void;
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
		? "世界状态（随对话自动记录）"
		: [state.time, state.location].filter(Boolean).join(" · ") || "世界状态";

	return (
		<div className={`status-strip ${open ? "open" : ""}`}>
			<button type="button" className="status-strip-bar" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
				<span className={`status-strip-text ${empty ? "faint" : ""}`}>{summary}</span>
				<IconChevronDown size={14} className={`strip-caret ${open ? "up" : ""}`} />
			</button>
			{open && (
				<div className="status-card">
					<div className="kv">
						<span className="kv-k">时间</span>
						<span className="kv-v">
							<Editable value={state?.time ?? ""} onSave={(v) => patch({ time: v })} />
						</span>
					</div>
					<div className="kv">
						<span className="kv-k">地点</span>
						<span className="kv-v">
							<Editable value={state?.location ?? ""} onSave={(v) => patch({ location: v })} />
						</span>
					</div>
					{Object.entries(state?.characters ?? {}).map(([name, c]) => (
						<div key={name} className="sp-char">
							<div className="sp-char-head">
								<span className="sp-char-name">{name}</span>
								<span className="sp-affinity">
									好感{" "}
									<Editable
										value={String(c.affinity)}
										onSave={(v) => patch({ characters: { [name]: { affinity: num(v, c.affinity) } } })}
									/>
								</span>
								<ConfirmButton
									title={`移除「${name}」的状态记录`}
									aria-label="移除角色记录"
									confirmText="确认移除"
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
								<Editable value={c.status} placeholder="（状态）" onSave={(v) => patch({ characters: { [name]: { status: v } } })} />
							</div>
							<div className="sp-char-line sp-notes">
								<Editable value={c.notes} placeholder="（备注）" onSave={(v) => patch({ characters: { [name]: { notes: v } } })} />
							</div>
						</div>
					))}
					<div className="kv">
						<span className="kv-k">物品</span>
						<span className="kv-v">
							<Editable
								value={(state?.inventory ?? []).join("、")}
								placeholder="（空）"
								onSave={(v) => patch({ inventory: v.split(/[、,，]/).map((s) => s.trim()).filter(Boolean) })}
							/>
						</span>
					</div>
					{Object.entries(state?.flags ?? {}).map(([k, v]) => (
						<div key={k} className="kv">
							<span className="kv-k">{k}</span>
							<span className="kv-v">
								<Editable value={v} onSave={(nv) => patch({ flags: { [k]: nv } })} />
								<ConfirmButton title={`删除标记「${k}」`} aria-label="删除标记" confirmText="确认" onConfirm={() => patch({ flags: { [k]: null } })}>
									<IconTrash size={12} />
								</ConfirmButton>
							</span>
						</div>
					))}
					<div className="sp-threads">
						<div className="kv-k">剧情线</div>
						<Editable
							multiline
							value={(state?.plot_threads ?? []).join("\n")}
							placeholder="（每行一条）"
							onSave={(v) => patch({ plot_threads: v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) })}
						/>
					</div>
					<div className="field-hint">点铅笔可直接改；你的账本你说了算，改动随剧情分支走（回退会跟着回退）。</div>
				</div>
			)}
		</div>
	);
}
