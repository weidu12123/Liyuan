import { useEffect, useState } from "react";
import type { DraftView } from "../wire.ts";
import { t } from "../i18n/index.ts";

type Revision = { version: number; text: string; reason: string; at: number };
const phases = { exploring: "探索中", writing: "写作中", waiting: "等待回答", sealed: "已收笔", stopped: "已停止，稿件已保存", error: "发生错误，稿件已保存" }; // i18n-ignore：用时经 t() 翻
const marks = { pending: "○", in_progress: "◐", done: "✓", cancelled: "—" };

export function DraftPanel({ workspace, revisions, busy, onInspect, onRestore }: {
	workspace: DraftView; revisions?: Revision[]; busy: boolean;
	onInspect: () => void; onRestore: (version: number) => void;
}) {
	const [selected, setSelected] = useState(workspace.version);
	useEffect(() => setSelected(workspace.version), [workspace.id, workspace.version]);
	const text = selected === workspace.version ? workspace.draft : revisions?.find((r) => r.version === selected)?.text;
	const preview = workspace.preview?.version === workspace.version ? workspace.preview : undefined;
	const pendingText = preview?.name === "draft_append" ? workspace.draft + (workspace.draft ? preview.separator ?? "\n\n" : "") + preview.content : preview?.content;
	return <details className="draft-panel" onToggle={(e) => { if (e.currentTarget.open) onInspect(); }}>
		<summary>{workspace.revision ? t("上一拍修订") : t("本拍稿件")} · {t(phases[workspace.phase])} · v{workspace.version}</summary>
		{workspace.plan.length > 0 && <ol className="draft-plan">{workspace.plan.map((step) => <li key={step.id} data-status={step.status}><span aria-label={step.status}>{marks[step.status]}</span> {step.text}</li>)}</ol>}
		{workspace.revisions.length > 0 && <>
			<label>{t("查看版本")} <select value={selected} onChange={(e) => { setSelected(Number(e.target.value)); onInspect(); }}>
				{workspace.revisions.map((r) => <option key={r.version} value={r.version}>v{r.version} · {new Date(r.at).toLocaleTimeString()}</option>)}
			</select></label>
			<textarea aria-label={t("稿件版本原文")} readOnly value={text ?? t("正在读取…")} rows={8} />
			<button type="button" disabled={text === undefined || selected === workspace.version || (busy && workspace.phase !== "waiting")} onClick={() => onRestore(selected)}>{t("恢复此版本")}</button>
			<small>{t("恢复会新增一个文本版本；世界线与账本不回退。")}</small>
		</>}
			{pendingText && <label>{t("未完成稿件（尚未形成新版本）")}<textarea aria-label={t("未完成稿件")} readOnly value={pendingText} rows={8} /></label>}
		{workspace.context && <details><summary>{t("上下文用量")}</summary><small>{t("{messages} 条消息，{chars} 个字符；本次移除了 {pruned} 份重复或过期的工具结果正文，共 {prunedChars} 个字符。此数为字符量，不是计费 token。", { messages: workspace.context.messages, chars: workspace.context.chars.toLocaleString(), pruned: workspace.context.prunedResults, prunedChars: workspace.context.prunedChars.toLocaleString() })}</small></details>}
	</details>;
}
