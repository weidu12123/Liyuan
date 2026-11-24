/**
 * 戏境状态栏面板（右侧分栏）：
 * 与左侧扮演正文完全平级、浑然一体的剧情设定总览。
 * 杜绝细碎气泡与悬浮框，采用优雅的文人长卷章节排版。
 */

import { apiPost, apiPut, type StatePatchResult } from "../api.ts";
import type { WorldState } from "../wire.ts";
import { IconRefresh, IconTrash } from "./icons.tsx";
import { ConfirmButton, useAction } from "./kit.tsx";
import { Editable, isEmptyState } from "./StatusStrip.tsx";
import { t } from "../i18n/index.ts";

export interface StatusPanelProps {
	state: WorldState | null;
	toast: (level: "info" | "warning" | "error", text: string) => void;
}

export function StatusPanel({ state, toast }: StatusPanelProps) {
	const { busy, run } = useAction(toast);

	const patch = (p: Record<string, unknown>) =>
		run(async () => {
			const r = await apiPut<StatePatchResult>("/api/state", { patch: p });
			for (const w of r.warnings) toast("warning", w);
		});

	const refresh = () =>
		run(async () => {
			const r = await apiPost<{ kind: string; applied?: string[]; reason?: string; error?: string }>("/api/state/refresh", {});
			if (r.kind === "applied") {
				toast("info", t("状态栏已更新（{n} 项变更）", { n: r.applied?.length ?? 0 }));
			} else if (r.kind === "failed") {
				toast("error", t("状态更新失败：{error}", { error: r.error ?? "" }));
			} else if (r.kind === "stale") {
				toast("warning", t("状态更新已丢弃（期间切换了分支）"));
			} else if (r.reason === "empty-patch") {
				toast("info", t("当前状态已是最新，无需更新"));
			} else if (r.reason === "busy") {
				toast("info", t("正在演出中，稍后再更新状态"));
			} else {
				toast("info", t("尚无可供分析的正文"));
			}
		});

	const num = (v: string, fallback: number): number => {
		const n = Number(v);
		return Number.isFinite(n) ? n : fallback;
	};

	const empty = !state || isEmptyState(state);
	const characters = Object.entries(state?.characters ?? {});
	const flags = Object.entries(state?.flags ?? {});
	const inventory = state?.inventory ?? [];
	const plotThreads = state?.plot_threads ?? [];

	return (
		<div className="status-panel">
			{empty && (
				<div className="sp-empty-banner">
					{t("随剧情展开，时间、地点、登场人物与随身行囊将由场记自动登记入册。")}
				</div>
			)}

			{/* ── 戏境时空 ── */}
			<section className="sp-section">
				<div className="sp-section-head">
					<span className="sp-section-title">{t("戏境时空")}</span>
					<button
						type="button"
						className="sp-refresh-btn"
						disabled={busy}
						onClick={refresh}
						title={t("基于最新剧情重新运行一轮场记以更新状态栏")}
					>
						<IconRefresh size={12} />
						<span>{busy ? t("更新中…") : t("手动更新")}</span>
					</button>
				</div>
				<div className="sp-section-body">
					<div className="sp-kv-row">
						<span className="sp-kv-key">{t("纪年时间")}</span>
						<span className="sp-kv-val">
							<Editable value={state?.time ?? ""} placeholder={t("（随剧情自动推进）")} onSave={(v) => patch({ time: v })} />
						</span>
					</div>
					<div className="sp-kv-row">
						<span className="sp-kv-key">{t("当前地点")}</span>
						<span className="sp-kv-val">
							<Editable value={state?.location ?? ""} placeholder={t("（当前场景所在）")} onSave={(v) => patch({ location: v })} />
						</span>
					</div>
				</div>
			</section>

			{/* ── 登场人物与羁绊 ── */}
			<section className="sp-section">
				<div className="sp-section-head">
					<span className="sp-section-title">{t("登场人物羁绊")}</span>
					{characters.length > 0 && <span className="sp-section-badge">{t("{n} 人在案", { n: characters.length })}</span>}
				</div>
				<div className="sp-section-body">
					{characters.length === 0 ? (
						<div className="sp-empty-hint">{t("暂无登场人物记录（随对话自然浮现）")}</div>
					) : (
						<div className="sp-char-stream">
							{characters.map(([name, c]) => (
								<div key={name} className="sp-char-entry">
									<div className="sp-char-meta-row">
										<span className="sp-char-name">{name}</span>
										<div className="sp-char-affinity-group">
											<span className="sp-char-affinity-label">{t("好感")}</span>
											<Editable
												value={String(c.affinity)}
												onSave={(v) => patch({ characters: { [name]: { affinity: num(v, c.affinity) } } })}
											/>
										</div>
										<ConfirmButton
											title={t("移除「{name}」的状态记录", { name })}
											aria-label={t("移除角色记录")}
											confirmText={t("移除")}
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
													? { left: "50%", width: `${Math.min(50, (c.affinity / 100) * 50)}%` }
													: { right: "50%", width: `${Math.min(50, (-c.affinity / 100) * 50)}%` }
											}
										/>
									</div>
									<div className="sp-char-desc-row">
										<span className="sp-desc-tag">{t("状态")}</span>
										<span className="sp-desc-text">
											<Editable value={c.status} placeholder={t("（当前神态/动作）")} onSave={(v) => patch({ characters: { [name]: { status: v } } })} />
										</span>
									</div>
									<div className="sp-char-desc-row">
										<span className="sp-desc-tag">{t("现处")}</span>
										<span className="sp-desc-text">
											<Editable
												value={c.at ?? ""}
												placeholder={t("（所在地）")}
												onSave={(v) => patch({ characters: { [name]: { at: v } } })}
											/>
										</span>
									</div>
									{c.notes && (
										<div className="sp-char-desc-row sp-notes-row">
											<span className="sp-desc-tag">{t("心境")}</span>
											<span className="sp-desc-text sp-notes-text">
												<Editable value={c.notes} placeholder={t("（心境与暗线）")} onSave={(v) => patch({ characters: { [name]: { notes: v } } })} />
											</span>
										</div>
									)}
								</div>
							))}
						</div>
					)}
				</div>
			</section>

			{/* ── 随身行囊 ── */}
			<section className="sp-section">
				<div className="sp-section-head">
					<span className="sp-section-title">{t("随身物品")}</span>
				</div>
				<div className="sp-section-body">
					<div className="sp-kv-row">
						<span className="sp-kv-key">{t("行囊持有")}</span>
						<span className="sp-kv-val">
							<Editable
								value={inventory.join("、")}
								placeholder={t("（无随身器物）")}
								onSave={(v) => patch({ inventory: v.split(/[、,，]/).map((s) => s.trim()).filter(Boolean) })}
							/>
						</span>
					</div>
				</div>
			</section>

			{/* ── 剧情主线与备忘 ── */}
			<section className="sp-section">
				<div className="sp-section-head">
					<span className="sp-section-title">{t("剧情风云线")}</span>
				</div>
				<div className="sp-section-body">
					<Editable
						multiline
						value={plotThreads.join("\n")}
						placeholder={t("（暂无活跃主支线，每行一条）")}
						onSave={(v) => patch({ plot_threads: v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) })}
					/>
				</div>
			</section>

			{/* ── 世态标记 ── */}
			{flags.length > 0 && (
				<section className="sp-section">
					<div className="sp-section-head">
						<span className="sp-section-title">{t("世态标记")}</span>
					</div>
					<div className="sp-section-body">
						{flags.map(([k, v]) => (
							<div key={k} className="sp-kv-row">
								<span className="sp-kv-key">{k}</span>
								<span className="sp-kv-val">
									<Editable value={v} onSave={(nv) => patch({ flags: { [k]: nv } })} />
									<ConfirmButton title={t("删除标记「{k}」", { k })} aria-label={t("删除标记")} confirmText={t("删除")} onConfirm={() => patch({ flags: { [k]: null } })}>
										<IconTrash size={12} />
									</ConfirmButton>
								</span>
							</div>
						))}
					</div>
				</section>
			)}

			<div className="sp-footer-hint">
				{t("数据随剧情自动归卷；点铅笔可随时勘校，改动随当前世界线分支留存与回退。")}
			</div>
		</div>
	);
}
