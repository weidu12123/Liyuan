/**
 * skill 库编辑器（8/12 定案：预设不再产 skill，预设面板 skill 页签让位给真 skill 库）。
 *
 * 读写 /api/stage-skills —— 与引擎 scanSkillFiles 是同一份 `skills/<目录>/SKILL.md`：
 * 保存后下一拍装载即生效（引擎每拍现读）；常驻=全文每拍随 system，拉取=进 L1 索引由模型
 * 按需 skill_read。没有第二套「面板专用」存储。
 */

import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../api.ts";
import { ConfirmButton, Toggle } from "./kit.tsx";
import { t } from "../i18n/index.ts";

type Scope = "global" | "card";
type StageSkill = { dir: string; name: string; description: string; chars: number; body: string; disabled: boolean; scope: Scope; shadowed?: boolean };
type EditState = { dir: string | null; name: string; description: string; body: string; scope: Scope };

export function SkillLibrary({ toast }: { toast: (level: "info" | "warning" | "error", text: string) => void }) {
	const [skills, setSkills] = useState<StageSkill[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [edit, setEdit] = useState<EditState | null>(null);
	const [busy, setBusy] = useState(false);
	const [defaultScope, setDefaultScope] = useState<Scope>("global");

	const reload = useCallback(async () => {
		try {
			const r = await apiGet<{ skills: StageSkill[]; defaultScope: Scope }>("/api/stage-skills");
			setSkills(r.skills);
			setDefaultScope(r.defaultScope);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}, []);
	useEffect(() => {
		void reload();
	}, [reload]);

	const save = async () => {
		if (!edit) return;
		setBusy(true);
		try {
			await apiPost("/api/stage-skills", {
				dir: edit.dir ?? undefined,
				scope: edit.scope,
				name: edit.name,
				description: edit.description,
				body: edit.body,
			});
			toast("info", t("已保存，下一拍装载即生效"));
			setEdit(null);
			await reload();
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	/** 对模型隐身开关（与「办事笔记」那栏同一个键 disable-model-invocation）：整条重存，正文原样带回 */
	const setExposed = async (s: StageSkill, exposed: boolean) => {
		setBusy(true);
		try {
			await apiPost("/api/stage-skills", {
				dir: s.dir,
				scope: s.scope,
				name: s.name,
				description: s.description,
				body: s.body,
				disabled: !exposed,
			});
			await reload();
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	const remove = async (dir: string, scope: Scope) => {
		setBusy(true);
		try {
			await apiDelete(`/api/stage-skills?dir=${encodeURIComponent(dir)}&scope=${scope}`);
			toast("info", t("已删除「{name}」", { name: dir }));
			if (edit?.dir === dir && edit.scope === scope) setEdit(null);
			await reload();
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	const renderForm = () => {
		if (!edit) return null;
		return (
			<div className="skill-edit-form">
				<label className="field-label">{t("适用范围")}</label>
				<select aria-label={t("技能适用范围")} value={edit.scope} disabled={busy || edit.dir !== null} onChange={(e) => setEdit({ ...edit, scope: e.target.value as Scope })}>
					{defaultScope === "card" && <option value="card">{t("当前角色卡")}</option>}
					<option value="global">{t("所有角色卡")}</option>
				</select>
				<label className="field-label">{t("名称（模型用它点名 skill_read）")}</label>
				<input
					className="panel-search"
					value={edit.name}
					disabled={busy}
					placeholder={t("如：打斗、我的文风")}
					onChange={(e) => setEdit({ ...edit, name: e.target.value })}
				/>
				<label className="field-label" style={{ marginTop: 8 }}>
					{t("简要说明（检索触发面）")}
				</label>
				<input
					className="panel-search"
					value={edit.description}
					disabled={busy}
					placeholder={t("只写什么时候用（触发场面）；别写做法摘要——模型会照摘要走捷径不读正文")}
					onChange={(e) => setEdit({ ...edit, description: e.target.value })}
				/>
				<label className="field-label" style={{ marginTop: 8 }}>
					{t("正文")}
				</label>
				<textarea
					className="panel-search ta preset-block-ta"
					rows={14}
					spellCheck={false}
					value={edit.body}
					disabled={busy}
					placeholder={t("写给模型看的正文：何时用/怎么写/一两段示范。Markdown。")}
					onChange={(e) => setEdit({ ...edit, body: e.target.value })}
				/>
				<div className="panel-row list-toolbar skill-edit-acts">
					<button className="drawer-btn save-btn" disabled={busy} onClick={() => void save()}>
						{t("保存")}
					</button>
					<button className="drawer-btn" disabled={busy} onClick={() => setEdit(null)}>
						{t("取消")}
					</button>
				</div>
			</div>
		);
	};

	return (
		<section className="sp-section">
			<div className="new-skill">
				<button
					className="drawer-btn"
					disabled={busy || !!edit}
						onClick={() => setEdit({ dir: null, name: "", description: "", body: "", scope: defaultScope })}
				>
					{t("＋ 新建 skill")}
				</button>
			</div>
			{error && <div className="panel-error">{error}</div>}
			{skills && skills.length === 0 && !edit && (
				<div className="sp-empty">{t("还没有 skill。点「新建」写第一个（写作方法/场面写法/文风示范都可以）。")}</div>
			)}
			{/* 新建表单在顶部；编辑既有项时表单内联到那一行的位置（不用翻回顶部） */}
			{edit && edit.dir === null && renderForm()}
			{skills?.map((s) =>
					edit && edit.dir === s.dir && edit.scope === s.scope ? (
						<div key={`${s.scope}:${s.dir}`}>{renderForm()}</div>
					) : (
						<div key={`${s.scope}:${s.dir}`} className="skill-lib-row">
						<div className="skill-lib-main">
							<span className="lore-title">
								{s.name}
							</span>
							<span className="lore-meta">
									{s.scope === "card" ? t("当前卡") : t("全局")}{s.shadowed ? t(" · 当前卡已覆盖") : ""} · {s.description} · {t("{n} 字", { n: s.chars.toLocaleString() })}
							</span>
						</div>
						<label className="expose-toggle" title={t("开＝名字与说明上 skill_read 清单，剧情模型按需读；关＝对模型隐身（本页仍在，随时开回来）")}>
							<span className="expose-label">{s.disabled ? t("已隐藏") : t("已暴露")}</span>
							<Toggle checked={!s.disabled} disabled={busy || !!edit} onChange={(v) => void setExposed(s, v)} />
						</label>
						<div className="preset-block-acts">
							<button
								className="act"
								disabled={busy || !!edit}
									onClick={() => setEdit({ dir: s.dir, name: s.name, description: s.description, body: s.body, scope: s.scope })}
							>
								{t("编辑")}
							</button>
								<ConfirmButton className="act" disabled={busy || !!edit} confirmText={t("确认删除")} onConfirm={() => void remove(s.dir, s.scope)}>
								{t("删除")}
							</ConfirmButton>
						</div>
					</div>
				),
			)}
		</section>
	);
}
