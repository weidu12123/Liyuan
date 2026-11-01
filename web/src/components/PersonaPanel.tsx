/**
 * 用户角色面板（与角色卡同款宣纸名帖风格）：
 * 上半区紧凑身份切换架 + 下半区当前身份名帖与只读优先的人设书页（点编辑才进文本框）。
 */

import { useEffect, useRef, useState } from "react";
import {
	apiDelete,
	apiGet,
	apiGetCacheClear,
	apiPost,
	apiPut,
	personaAvatarUrl,
	type PersonaInfo,
	type PersonasResponse,
	type RpConfigView,
} from "../api.ts";
import { IconPlus, IconTrash } from "./icons.tsx";
import { AvatarCropModal } from "./AvatarCropModal.tsx";
import { bumpWatchPanels, ConfirmButton, PanelStatus, Toggle, useAction, usePanelData } from "./kit.tsx";
import { t } from "../i18n/index.ts";

function PersonaAvatar({
	p,
	bust,
	size = "sm",
}: {
	p: Pick<PersonaInfo, "id" | "name" | "avatar">;
	bust?: number;
	size?: "sm" | "lg";
}) {
	const cls = size === "lg" ? "persona-avatar persona-avatar-lg" : "persona-avatar";
	if (p.avatar) {
		return (
			<span className={`${cls} has-img`} aria-hidden="true">
				<img src={personaAvatarUrl(p.id, bust)} alt="" />
			</span>
		);
	}
	return (
		<span className={cls} aria-hidden="true">
			{(p.name || "？").slice(0, 1)}
		</span>
	);
}

export function PersonaPanel({ toast }: { toast: (level: "info" | "warning" | "error", text: string) => void }) {
	const { data, error, loading, reload } = usePanelData(() => apiGet<PersonasResponse>("/api/personas"), { cacheKey: "/api/personas" });
	const { busy, run } = useAction(toast);

	const active = data?.personas.find((p) => p.id === data.activeId) ?? null;

	const [editingName, setEditingName] = useState(false);
	const [nameDraft, setNameDraft] = useState("");
	const [editingPersona, setEditingPersona] = useState(false);
	const [personaDraft, setPersonaDraft] = useState("");
	const [avatarBust, setAvatarBust] = useState(0);

	useEffect(() => {
		if (active) {
			setNameDraft(active.name);
			setPersonaDraft(active.persona);
			setEditingName(false);
			setEditingPersona(false);
		}
	}, [active?.id, active?.name, active?.persona]);

	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState("");
	const fileRef = useRef<HTMLInputElement>(null);
	const [cropFile, setCropFile] = useState<File | null>(null);
	const [uploading, setUploading] = useState(false);

	const selectPersona = (p: PersonaInfo) =>
		run(async () => {
			await apiPost("/api/personas/select", { id: p.id });
			reload();
		});

	const create = () =>
		run(async () => {
			const r = await apiPost<{ id: string }>("/api/personas", { name: newName.trim() });
			await apiPost("/api/personas/select", { id: r.id });
			setNewName("");
			setCreating(false);
			reload();
		}, t("已创建并切换"));

	const remove = (p: PersonaInfo) =>
		run(async () => {
			await apiDelete(`/api/personas?id=${encodeURIComponent(p.id)}`);
			reload();
		}, t("已删除：{name}", { name: p.name }));

	const saveName = () =>
		run(async () => {
			if (!active || !nameDraft.trim()) return;
			await apiPut("/api/personas", { id: active.id, name: nameDraft.trim(), persona: active.persona });
			setEditingName(false);
			reload();
		}, t("已保存"));

	const savePersona = () =>
		run(async () => {
			if (!active) return;
			await apiPut("/api/personas", { id: active.id, name: active.name, persona: personaDraft });
			setEditingPersona(false);
			reload();
		}, t("已保存"));

	const setLock = (locked: boolean) =>
		run(async () => {
			if (!active) return;
			await apiPost("/api/personas/select", { id: active.id, lockToCard: locked });
			reload();
		}, locked ? t("已锁定到当前角色卡") : t("已解除锁定"));

	const onPickFile = (file: File | undefined) => {
		if (!file) return;
		if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type) && !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
			toast("error", t("请选择图片文件（PNG / JPG / WebP）"));
			return;
		}
		setCropFile(file);
	};

	const uploadCropped = async (blob: Blob) => {
		if (!active) return;
		setUploading(true);
		try {
			const res = await fetch(`/api/personas/avatar?id=${encodeURIComponent(active.id)}`, {
				method: "POST",
				headers: { "content-type": "image/png" },
				body: blob,
			});
			const resData = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok || resData.error) throw new Error(resData.error || t("上传失败（HTTP {status}）", { status: res.status }));
			setCropFile(null);
			setAvatarBust(Date.now());
			reload();
			toast("info", t("头像已更新"));
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setUploading(false);
		}
	};

	const clearAvatar = () =>
		run(async () => {
			if (!active) return;
			await apiDelete(`/api/personas/avatar?id=${encodeURIComponent(active.id)}`);
			setAvatarBust(Date.now());
			reload();
		}, t("已清除头像"));

	return (
		<div className="panel-body rc-panel-body">
			{cropFile && (
				<AvatarCropModal
					file={cropFile}
					busy={uploading}
					onCancel={() => !uploading && setCropFile(null)}
					onConfirm={(blob) => void uploadCropped(blob)}
				/>
			)}
			<input
				ref={fileRef}
				type="file"
				accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp"
				hidden
				onChange={(e) => {
					onPickFile(e.target.files?.[0]);
					e.target.value = "";
				}}
			/>
			<PanelStatus loading={loading} error={error} hasData={!!data} />
			{data && (
				<>
					{/* 上半区：身份切换架 */}
					<section className="rc-shelf">
						<div className="up-shelf-head">
							<span className="up-shelf-title">{t("我的身份（{n}）", { n: data.personas.length })}</span>
							{!creating && (
								<button type="button" className="rc-btn rc-btn-primary" onClick={() => setCreating(true)}>
									<IconPlus size={12} />
									<span>{t("新建身份")}</span>
								</button>
							)}
						</div>

						{creating && (
							<div className="rc-display-edit">
								<input
									className="rc-inline-input"
									placeholder={t("名字…")}
									value={newName}
									autoFocus
									onChange={(e) => setNewName(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter" && newName.trim()) void create();
										if (e.key === "Escape") setCreating(false);
									}}
								/>
								<button type="button" className="rc-btn rc-btn-primary" disabled={busy || !newName.trim()} onClick={() => void create()}>
									{t("创建")}
								</button>
								<button type="button" className="rc-btn" onClick={() => setCreating(false)}>
									{t("取消")}
								</button>
							</div>
						)}

						<div className="rc-roster">
							{data.personas.map((p) => {
								const isCur = p.id === data.activeId;
								return (
									<div key={p.id} className={`rc-mini-card ${isCur ? "current" : ""}`}>
										<button
											type="button"
											className="rc-mini-pick"
											disabled={busy}
											onClick={() => !isCur && void selectPersona(p)}
										>
											<PersonaAvatar p={p} bust={p.id === active?.id ? avatarBust : undefined} />
											<div className="rc-mini-meta">
												<span className="rc-mini-name">{p.name}</span>
												<span className="rc-mini-sub">
													{p.id === data.lockedForCard ? (
														<span className="rc-cur-dot">{t("本卡锁定")}</span>
													) : p.id === data.current ? (
														t("默认")
													) : p.persona ? (
														p.persona.slice(0, 18)
													) : (
														t("当前身份")
													)}
												</span>
											</div>
										</button>
										{data.personas.length > 1 && (
											<div className="rc-mini-acts">
												<ConfirmButton
													className="rc-mini-icon rc-mini-del"
													disabled={busy}
													title={t("删除「{name}」", { name: p.name })}
													aria-label={t("删除身份")}
													confirmText="×"
													onConfirm={() => void remove(p)}
												>
													<IconTrash size={11} />
												</ConfirmButton>
											</div>
										)}
									</div>
								);
							})}
						</div>
					</section>

					{/* 下半区：当前身份宣纸名帖 + 人设书页 */}
					{active && (
						<div className="rc-dossier">
							<section className="rc-hero-card">
								<div className="rc-hero-main">
									<PersonaAvatar p={active} bust={avatarBust} size="lg" />
									<div className="rc-hero-info">
										{!editingName ? (
											<div className="rc-hero-head-row">
												<h3 className="rc-hero-name" title={active.name}>{active.name}</h3>
												<button
													type="button"
													className="rc-link-btn"
													onClick={() => {
														setNameDraft(active.name);
														setEditingName(true);
													}}
													title={t("即剧情中的 {{user}}，场记与提示词都用它")}
												>
													{t("编辑")}
												</button>
											</div>
										) : (
											<div className="rc-display-edit">
												<input
													className="rc-inline-input"
													value={nameDraft}
													autoFocus
													onChange={(e) => setNameDraft(e.target.value)}
													onKeyDown={(e) => {
														if (e.key === "Enter" && nameDraft.trim()) void saveName();
														if (e.key === "Escape") setEditingName(false);
													}}
												/>
												<button
													type="button"
													className="rc-btn rc-btn-primary"
													disabled={busy || !nameDraft.trim()}
													onClick={() => void saveName()}
												>
													{t("保存")}
												</button>
												<button type="button" className="rc-btn" onClick={() => setEditingName(false)}>
													{t("取消")}
												</button>
											</div>
										)}

										<div className="up-avatar-row">
											<button
												type="button"
												className="rc-btn"
												disabled={busy || uploading}
												onClick={() => fileRef.current?.click()}
												title={t("从相册选图 → 拖动/缩放裁剪 → 保存为圆形头像")}
											>
												{active.avatar ? t("更换头像") : t("导入头像")}
											</button>
											{active.avatar && (
												<button
													type="button"
													className="rc-btn"
													disabled={busy || uploading}
													onClick={() => void clearAvatar()}
												>
													{t("清除头像")}
												</button>
											)}
										</div>
									</div>
								</div>

								<div className="rc-hero-foot">
									<span
										className="rc-skin-toggle"
										title={t("锁定后，切到这张卡时自动使用该身份（其他卡仍用全局默认）。")}
									>
										{t("锁定到当前角色卡")}
									</span>
									<Toggle
										checked={data.lockedForCard === active.id}
										disabled={busy}
										onChange={(v) => void setLock(v)}
									/>
								</div>
							</section>

							<section className="rc-sheet-card">
								<div className="rc-sheet-pane">
									<div className="rc-field-subhead">
										<span className="up-sheet-title">
											{t("人设（可选）")}
											<span className="rc-char-count" style={{ marginLeft: 6 }}>
												{active.persona.trim() ? t("（{n} 字）", { n: active.persona.length }) : t("（空）")}
											</span>
										</span>
										{!editingPersona && active.persona.trim() && (
											<button
												type="button"
												className="rc-link-btn"
												onClick={() => {
													setPersonaDraft(active.persona);
													setEditingPersona(true);
												}}
											>
												{t("编辑")}
											</button>
										)}
									</div>

									{editingPersona ? (
										<div className="rc-editor-box">
											<textarea
												className="panel-search ta"
												rows={8}
												placeholder={t("身份、外貌、背景……会进入角色卡的设定区")}
												value={personaDraft}
												onChange={(e) => setPersonaDraft(e.target.value)}
											/>
											<div className="rc-editor-actions">
												<button
													type="button"
													className="rc-btn rc-btn-primary"
													disabled={busy}
													onClick={() => void savePersona()}
												>
													{t("保存并重载会话")}
												</button>
												<button
													type="button"
													className="rc-btn"
													disabled={busy}
													onClick={() => setEditingPersona(false)}
												>
													{t("取消")}
												</button>
											</div>
										</div>
									) : active.persona.trim() ? (
										<div className="rc-prose">{active.persona}</div>
									) : (
										<div className="rc-empty-field">
											<button
												type="button"
												className="card-empty-field-btn"
												onClick={() => {
													setPersonaDraft("");
													setEditingPersona(true);
												}}
											>
												{t("＋ {title}", { title: t("人设（可选）") })}
											</button>
										</div>
									)}
								</div>
							</section>
						</div>
					)}
				</>
			)}
		</div>
	);
}

const BTW_PERSONA_TEMPLATES = [
	{
		id: "sharp",
		label: () => t("犀利搭子"),
		content:
			"你是用户的看戏搭子与幕后共创朋友，和用户站在同一边聊戏。\n眼光敏锐、直率真诚，有一说一，不端着架子也不说客服套话。\n用自然直接的聊天口吻交流，不用括号或星号演动作旁白；闲聊吐槽时简短利落，拆解剧情或查改设定时条理清晰、直奔重点。", // i18n-ignore：模型提示词模板
	},
	{
		id: "gentle",
		label: () => t("温柔共创"),
		content:
			"你是陪伴用户沉浸看戏与共创故事的贴心搭子，温柔真诚、善解人意。\n无论用户想吐槽剧情、放飞脑洞还是微调设定，都会温和接住并捕捉其中的闪光点往下推演。\n用自然亲切的聊天口吻交流，不用括号或星号演动作旁白，聊起天来轻松温暖、细致周到。", // i18n-ignore：模型提示词模板
	},
	{
		id: "scholar",
		label: () => t("严谨考据"),
		content:
			"你是本局故事的幕后设定顾问与世界观考据搭档，逻辑严密、实事求是。\n对时间线冲突、人物弧光与设定前后一致性极其敏锐；说话干脆利落不讲废话，擅长把零散灵感整理成结构严密的设定与大纲。", // i18n-ignore：模型提示词模板
	},
] as const;

export function BtwRolePanel({
	toast,
	onProfileChange,
}: {
	toast: (level: "info" | "warning" | "error", text: string) => void;
	onProfileChange?: (profile: { name: string; avatar?: string; bust: number }) => void;
}) {
	const cfg = usePanelData(() => apiGet<{ config: RpConfigView }>("/api/config"), { cacheKey: "/api/config", watchPanels: true });
	const { busy, run } = useAction(toast);

	const btwName = cfg.data?.config.btwName?.trim() || t("助手");
	const btwAvatar = cfg.data?.config.btwAvatar;
	const savedPersona = cfg.data?.config.btwPersona?.trim() ?? "";
	const effectivePersona = savedPersona || BTW_PERSONA_TEMPLATES[0].content;

	const [editingName, setEditingName] = useState(false);
	const [nameDraft, setNameDraft] = useState("");
	const [editingPrompt, setEditingPrompt] = useState(false);
	const [promptDraft, setPromptDraft] = useState("");
	const [avatarBust, setAvatarBust] = useState(0);
	const fileRef = useRef<HTMLInputElement>(null);
	const [cropFile, setCropFile] = useState<File | null>(null);
	const [uploading, setUploading] = useState(false);

	useEffect(() => {
		if (!editingPrompt) setPromptDraft(effectivePersona);
	}, [effectivePersona, editingPrompt]);

	const saveName = () =>
		run(async () => {
			const trimmed = nameDraft.trim() || t("助手");
			await apiPut("/api/config", { btwName: trimmed });
			setEditingName(false);
			apiGetCacheClear("/api/config");
			cfg.reload();
			bumpWatchPanels();
			onProfileChange?.({ name: trimmed, avatar: btwAvatar, bust: avatarBust });
		}, t("已保存"));

	const savePersonaText = (text: string) =>
		run(async () => {
			const trimmed = text.trim();
			await apiPut("/api/config", { btwPersona: trimmed });
			setEditingPrompt(false);
			apiGetCacheClear("/api/config");
			cfg.reload();
			bumpWatchPanels();
			toast("info", t("已保存"));
		});

	const onPickFile = (file: File | undefined) => {
		if (!file) return;
		if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type) && !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
			toast("error", t("请选择图片文件（PNG / JPG / WebP）"));
			return;
		}
		setCropFile(file);
	};

	const uploadCropped = async (blob: Blob) => {
		setUploading(true);
		try {
			const res = await fetch("/api/personas/avatar?id=__btw__", {
				method: "POST",
				headers: { "content-type": "image/png" },
				body: blob,
			});
			const resData = (await res.json().catch(() => ({}))) as { error?: string; avatar?: string };
			if (!res.ok || resData.error) throw new Error(resData.error || t("上传失败（HTTP {status}）", { status: res.status }));
			const nextBust = Date.now();
			setCropFile(null);
			setAvatarBust(nextBust);
			apiGetCacheClear("/api/config");
			cfg.reload();
			bumpWatchPanels();
			onProfileChange?.({ name: btwName, avatar: resData.avatar || "assets/personas/__btw__.png", bust: nextBust });
			toast("info", t("头像已更新"));
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setUploading(false);
		}
	};

	const clearAvatar = () =>
		run(async () => {
			await apiDelete("/api/personas/avatar?id=__btw__");
			const nextBust = Date.now();
			setAvatarBust(nextBust);
			apiGetCacheClear("/api/config");
			cfg.reload();
			bumpWatchPanels();
			onProfileChange?.({ name: btwName, avatar: undefined, bust: nextBust });
		}, t("已清除头像"));

	return (
		<div className="panel-body rc-panel-body">
			{cropFile && (
				<AvatarCropModal
					file={cropFile}
					busy={uploading}
					onCancel={() => !uploading && setCropFile(null)}
					onConfirm={(blob) => void uploadCropped(blob)}
				/>
			)}
			<input
				ref={fileRef}
				type="file"
				accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp"
				hidden
				onChange={(e) => {
					onPickFile(e.target.files?.[0]);
					e.target.value = "";
				}}
			/>
			<PanelStatus loading={cfg.loading} error={cfg.error} hasData={!!cfg.data} />
			{cfg.data && (
				<div className="rc-dossier">
					<section className="rc-hero-card">
						<div className="rc-hero-main">
							<PersonaAvatar p={{ id: "__btw__", name: btwName, avatar: btwAvatar }} bust={avatarBust} size="lg" />
							<div className="rc-hero-info">
								{!editingName ? (
									<div className="rc-hero-head-row">
										<h3 className="rc-hero-name" title={btwName}>{btwName}</h3>
										<button
											type="button"
											className="rc-link-btn"
											onClick={() => {
												setNameDraft(btwName);
												setEditingName(true);
											}}
											title={t("在输入框输入 @{name} 即可唤出旁路助手", { name: btwName })}
										>
											{t("编辑")}
										</button>
									</div>
								) : (
									<div className="rc-display-edit">
										<input
											className="rc-inline-input"
											value={nameDraft}
											autoFocus
											onChange={(e) => setNameDraft(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter" && nameDraft.trim()) void saveName();
												if (e.key === "Escape") setEditingName(false);
											}}
										/>
										<button
											type="button"
											className="rc-btn rc-btn-primary"
											disabled={busy || !nameDraft.trim()}
											onClick={() => void saveName()}
										>
											{t("保存")}
										</button>
										<button type="button" className="rc-btn" onClick={() => setEditingName(false)}>
											{t("取消")}
										</button>
									</div>
								)}

								<div className="up-avatar-row">
									<button
										type="button"
										className="rc-btn"
										disabled={busy || uploading}
										onClick={() => fileRef.current?.click()}
										title={t("从相册选图 → 拖动/缩放裁剪 → 保存为圆形头像")}
									>
										{btwAvatar ? t("更换头像") : t("导入头像")}
									</button>
									{btwAvatar && (
										<button
											type="button"
											className="rc-btn"
											disabled={busy || uploading}
											onClick={() => void clearAvatar()}
										>
											{t("清除头像")}
										</button>
									)}
								</div>
							</div>
						</div>

						<div className="rc-hero-foot">
							<span className="rc-skin-toggle">
								{t("在输入框输入 @{name} 即可唤出旁路助手", { name: btwName })}
							</span>
						</div>
					</section>

					<section className="rc-sheet-card">
						<div className="rc-sheet-pane">
							<div className="rc-field-subhead">
								<span className="up-sheet-title">
									{t("性格设定")}
									<span className="rc-char-count" style={{ marginLeft: 6 }}>
										{t("（{n} 字）", { n: effectivePersona.length })}
									</span>
								</span>
								{!editingPrompt && (
									<button
										type="button"
										className="rc-link-btn"
										onClick={() => {
											setPromptDraft(effectivePersona);
											setEditingPrompt(true);
										}}
									>
										{t("编辑")}
									</button>
								)}
							</div>

							<div className="up-avatar-row" style={{ marginBottom: 10 }}>
								{BTW_PERSONA_TEMPLATES.map((tpl) => {
									const isCurrent = effectivePersona.trim() === tpl.content.trim();
									return (
										<button
											key={tpl.id}
											type="button"
											className={`rc-btn ${isCurrent ? "rc-btn-primary" : ""}`}
											disabled={busy}
											onClick={() => {
												if (editingPrompt) {
													setPromptDraft(tpl.content);
												} else {
													void savePersonaText(tpl.content);
												}
											}}
										>
											{tpl.label()}
										</button>
									);
								})}
							</div>

							{editingPrompt ? (
								<div className="rc-editor-box">
									<textarea
										className="panel-search ta"
										rows={8}
										placeholder={t("助手的性格特点、说话口吻与点评风格（留空恢复默认性格）")}
										value={promptDraft}
										onChange={(e) => setPromptDraft(e.target.value)}
									/>
									<div className="rc-editor-actions">
										<button
											type="button"
											className="rc-btn rc-btn-primary"
											disabled={busy}
											onClick={() => void savePersonaText(promptDraft)}
										>
											{t("保存")}
										</button>
										<button
											type="button"
											className="rc-btn"
											disabled={busy}
											onClick={() => setEditingPrompt(false)}
										>
											{t("取消")}
										</button>
									</div>
								</div>
							) : (
								<div className="rc-prose">{effectivePersona}</div>
							)}
						</div>
					</section>
				</div>
			)}
		</div>
	);
}
