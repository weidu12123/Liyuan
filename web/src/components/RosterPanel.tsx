/**
 * 登场名录面板：追加式索引表（登场过就在案），侧栏面板形态（世界状态卡里放不下）。
 * 活跃条目由记账自动登记不可删；离场条目可删可改注。系统常驻：空表也渲染占位。
 */

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

export function RosterPanel({
	state,
	toast,
}: {
	state: WorldState | null;
	toast: (level: "info" | "warning" | "error", text: string) => void;
}) {
	const { run } = useAction(toast);
	const patch = (p: Record<string, unknown>) =>
		run(async () => {
			const r = await apiPut<StatePatchResult>("/api/state", { patch: p });
			for (const w of r.warnings) toast("warning", w);
		});

	const roster = state?.roster;
	const activeSets: Record<(typeof ROSTER_TABLES)[number]["key"], Set<string>> = {
		// 「在场」＝角色所在地与当前地点相同（CharacterState.at）。characters 是累积登记表，
		// 靠它的键判断会让每个出场过的人永远算在场——有了 at 才判得准。
		// 无 at 的旧数据按在场处理（不凭空把人判离场）。
		characters: new Set(
			Object.entries(state?.characters ?? {})
				.filter(([, c]) => !c.at || c.at === state?.location)
				.map(([name]) => name),
		),
		places: new Set(state?.location ? [state.location] : []),
		items: new Set(state?.inventory ?? []),
		events: new Set(state?.plot_threads ?? []),
	};
	const tables = ROSTER_TABLES.map((tb) => ({
		...tb,
		rows: Object.entries(roster?.[tb.key] ?? {}),
	}));

	return (
		<div className="roster-panel">
			{tables.map((tb) => (
				<section key={tb.key} className="roster-section">
					<div className="roster-section-head">
						<span className="roster-section-title">{t("{label}名录", { label: t(tb.label) })}</span>
						{tb.rows.length > 0 && <span className="roster-section-badge">{t("{n} 条在册", { n: tb.rows.length })}</span>}
					</div>
					{tb.rows.length === 0 ? (
						<div className="roster-empty">{t("暂无{label}记录（随剧情自动登记）", { label: t(tb.label) })}</div>
					) : (
						<div className="roster-rows">
							{tb.rows.map(([name, blurb]) => {
								const active = activeSets[tb.key].has(name);
								return (
									<div key={name} className={`roster-row ${active ? "" : "roster-gone"}`}>
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
								);
							})}
						</div>
					)}
				</section>
			))}
		</div>
	);
}

