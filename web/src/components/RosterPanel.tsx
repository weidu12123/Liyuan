/**
 * 登场名录面板：追加式索引表（登场过就在案），侧栏面板形态（世界状态卡里放不下）。
 * 活跃条目由记账自动登记不可删；离场条目可删可改注。系统常驻：空表也渲染占位。
 */

import { useState } from "react";
import { apiPut, type StatePatchResult } from "../api.ts";
import type { WorldState } from "../wire.ts";
import { IconTrash } from "./icons.tsx";
import { ConfirmButton, useAction } from "./kit.tsx";
import { Editable } from "./StatusStrip.tsx";
import { t } from "../i18n/index.ts";

/** 四表的展示配置：label + 判断条目当前是否活跃 */
const ROSTER_TABLES = [
	{ key: "characters", label: "人物", activeMark: "在场", goneMark: "已离场" }, // i18n-ignore：用时 t()
	{ key: "places", label: "地点", activeMark: "此处", goneMark: "去过" }, // i18n-ignore：用时 t()
	{ key: "items", label: "物品", activeMark: "持有", goneMark: "已失去" }, // i18n-ignore：用时 t()
	{ key: "events", label: "事件", activeMark: "进行中", goneMark: "已了结" }, // i18n-ignore：用时 t()
] as const;

type RosterKey = (typeof ROSTER_TABLES)[number]["key"];

export function RosterPanel({
	state,
	toast,
}: {
	state: WorldState | null;
	toast: (level: "info" | "warning" | "error", text: string) => void;
}) {
	const { run } = useAction(toast);
	const [merging, setMerging] = useState<{ table: RosterKey; from: string; to: string } | null>(null);
	const patch = (p: Record<string, unknown>, okMsg?: string) =>
		run(async () => {
			const r = await apiPut<StatePatchResult>("/api/state", { patch: p });
			for (const w of r.warnings) toast("warning", w);
			if (okMsg && r.warnings.length === 0) toast("info", okMsg);
		});

	const roster = state?.roster;
	const activeSets: Record<RosterKey, Set<string>> = {
		// 「在场」＝角色未离开当前地点（at 为空或与当前 location 相同）。
		characters: new Set(
			Object.entries(state?.characters ?? {})
				.filter(([, c]) => !c.at || c.at === state?.location)
				.map(([name]) => name),
		),
		places: new Set(state?.location ? [state.location] : []),
		items: new Set(state?.inventory ?? []),
		events: new Set(state?.plot_threads ?? []),
	};
	const tables = ROSTER_TABLES.map((tb) => {
		const rows = Object.entries(roster?.[tb.key] ?? {});
		const goneNames = rows.map(([name]) => name).filter((name) => !activeSets[tb.key].has(name));
		return { ...tb, rows, goneNames };
	});

	return (
		<div className="roster-panel">
			{tables.map((tb) => (
				<section key={tb.key} className="roster-section">
					<div className="roster-section-head">
						<span className="roster-section-title">{t("{label}名录", { label: t(tb.label) })}</span>
						<span className="roster-section-actions">
							{tb.goneNames.length > 0 && (
								<ConfirmButton
									className="roster-clear-btn"
									title={t("一键移除本栏全部非活跃条目（共 {n} 条）", { n: tb.goneNames.length })}
									confirmText={t("确认清理 {n} 条", { n: tb.goneNames.length })}
									onConfirm={() => {
										const del: Record<string, null> = {};
										for (const n of tb.goneNames) del[n] = null;
										void patch(
											{ roster: { [tb.key]: del } },
											t("已清理 {n} 条非活跃名录条目", { n: tb.goneNames.length }),
										);
									}}
								>
									{t("清理非活跃")}
								</ConfirmButton>
							)}
							{tb.rows.length > 0 && <span className="roster-section-badge">{t("{n} 条在册", { n: tb.rows.length })}</span>}
						</span>
					</div>
					{tb.rows.length === 0 ? (
						<div className="roster-empty">{t("暂无{label}记录（随剧情自动登记）", { label: t(tb.label) })}</div>
					) : (
						<div className="roster-rows">
							{tb.rows.map(([name, blurb]) => {
								const active = activeSets[tb.key].has(name);
								const others = tb.rows.map(([n]) => n).filter((n) => n !== name);
								const isMerging = merging?.table === tb.key && merging.from === name;
								return (
									<div key={name} className="roster-item-wrap">
										<div className={`roster-row ${active ? "" : "roster-gone"}`}>
											<span className="roster-name" title={name}>
												{name}
											</span>
											<span className="roster-blurb">
												<Editable
													value={blurb}
													placeholder={t("（登场时间）")}
													onSave={(v) => patch({ roster: { [tb.key]: { [name]: v } } })}
												/>
											</span>
											<span className={`roster-mark ${active ? "on" : ""}`}>{active ? t(tb.activeMark) : t(tb.goneMark)}</span>
											{others.length > 0 && (
												<button
													type="button"
													className="roster-merge-trigger"
													title={t("将「{name}」合并到另一条目", { name })}
													onClick={() =>
														setMerging(
															isMerging ? null : { table: tb.key, from: name, to: others[0]! },
														)
													}
												>
													{t("合并")}
												</button>
											)}
											{!active && (
												<ConfirmButton
													title={t("从名录移除「{name}」", { name })}
													aria-label={t("从名录移除")}
													confirmText={t("删除")}
													onConfirm={() => patch({ roster: { [tb.key]: { [name]: null } } })}
												>
													<IconTrash size={12} />
												</ConfirmButton>
											)}
										</div>
										{isMerging && merging && (
											<div className="roster-merge-bar">
												<span className="roster-merge-label">{t("合并到")}</span>
												<select
													className="roster-merge-select"
													value={merging.to}
													onChange={(e) => setMerging({ ...merging, to: e.target.value })}
												>
													{others.map((target) => (
														<option key={target} value={target}>
															{target}
														</option>
													))}
												</select>
												<button
													type="button"
													className="roster-merge-confirm"
													onClick={() => {
														const { table, from, to } = merging;
														setMerging(null);
														void patch(
															{ roster: { merge: [{ table, from, to }] } },
															t("已将「{from}」合并到「{to}」", { from, to }),
														);
													}}
												>
													{t("确定")}
												</button>
												<button
													type="button"
													className="roster-merge-cancel"
													onClick={() => setMerging(null)}
												>
													{t("取消")}
												</button>
											</div>
										)}
									</div>
								);
							})}
						</div>
					)}
				</section>
			))}
		</div>
	);
}

