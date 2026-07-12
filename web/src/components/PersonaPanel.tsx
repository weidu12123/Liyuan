/**
 * 用户角色面板：多身份管理 + ST 式头像（导入图片 → 方形裁剪 → 上传）。
 */

import { useEffect, useRef, useState } from "react";
import {
	apiDelete,
	apiGet,
	apiPost,
	apiPut,
	personaAvatarUrl,
	type PersonaInfo,
	type PersonasResponse,
	type RpConfigView,
} from "../api.ts";
import { IconPlus, IconTrash } from "./icons.tsx";
import { AvatarCropModal } from "./AvatarCropModal.tsx";
import { ConfirmButton, Field, PanelStatus, Toggle, useAction, usePanelData } from "./kit.tsx";

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
				<img src={personaAvatarUrl(p.id, bust ?? p.avatar)} alt="" />
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
	const config = usePanelData(() => apiGet<{ config: RpConfigView }>("/api/config"), { cacheKey: "/api/config" });
	const { busy, run } = useAction(toast);

	const active = data?.personas.find((p) => p.id === data.activeId) ?? null;

	const [name, setName] = useState("");
	const [persona, setPersona] = useState("");
	const [dirty, setDirty] = useState(false);
	const [avatarBust, setAvatarBust] = useState(0);
	useEffect(() => {
		if (active) {
			setName(active.name);
			setPersona(active.persona);
			setDirty(false);
		}
	}, [active?.id, active?.name, active?.persona]); // eslint-disable-line react-hooks/exhaustive-deps

	const [displayName, setDisplayName] = useState("");
	const [displayDirty, setDisplayDirty] = useState(false);
	useEffect(() => {
		if (config.data) {
			setDisplayName(config.data.config.displayName ?? "");
			setDisplayDirty(false);
		}
	}, [config.data]);

	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState("");
	const fileRef = useRef<HTMLInputElement>(null);
	const [cropFile, setCropFile] = useState<File | null>(null);
	const [uploading, setUploading] = useState(false);

	const selectPersona = (p: PersonaInfo) =>
		run(async () => {
			// softRefresh：热更新身份，不整会话 reload
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
		}, "已创建并切换");

	const remove = (p: PersonaInfo) =>
		run(async () => {
			await apiDelete(`/api/personas?id=${encodeURIComponent(p.id)}`);
			reload();
		}, `已删除：${p.name}`);

	const saveActive = () =>
		run(async () => {
			if (!active) return;
			await apiPut("/api/personas", { id: active.id, name: name.trim(), persona });
			reload();
		}, "已保存");

	const setLock = (locked: boolean) =>
		run(async () => {
			if (!active) return;
			await apiPost("/api/personas/select", { id: active.id, lockToCard: locked });
			reload();
		}, locked ? "已锁定到当前角色卡" : "已解除锁定");

	const saveDisplayName = () =>
		run(async () => {
			await apiPut("/api/config", { displayName: displayName.trim() });
			config.reload();
		}, "已保存并重载会话");

	const onPickFile = (file: File | undefined) => {
		if (!file) return;
		if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type) && !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
			toast("error", "请选择图片文件（PNG / JPG / WebP）");
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
			const data = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok || data.error) throw new Error(data.error || `上传失败（HTTP ${res.status}）`);
			setCropFile(null);
			setAvatarBust(Date.now());
			reload();
			toast("info", "头像已更新");
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
		}, "已清除头像");

	return (
		<div className="panel-body">
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
					<section className="sp-section">
						<h4>我的身份（{data.personas.length}）</h4>
						<div className="field-hint">
							你以谁的身份在玩（剧情中的 {"{{user}}"}）。点选即切换；可设置头像（导入图片并裁剪）。
						</div>
						<div className="persona-list">
							{data.personas.map((p) => (
								<div key={p.id} className={`persona-row ${p.id === data.activeId ? "current" : ""}`}>
									<button className="persona-pick" disabled={busy} onClick={() => p.id !== data.activeId && selectPersona(p)}>
										<PersonaAvatar p={p} bust={p.id === active?.id ? avatarBust : undefined} />
										<span className="persona-info">
											<span className="persona-name">
												{p.name}
												{p.id === data.current && <span className="chip">默认</span>}
												{p.id === data.lockedForCard && <span className="chip chip-constant">本卡锁定</span>}
											</span>
											{p.persona && <span className="session-preview">{p.persona.slice(0, 50)}</span>}
										</span>
									</button>
									{data.personas.length > 1 && (
										<ConfirmButton disabled={busy} title={`删除「${p.name}」`} aria-label="删除身份" confirmText="确认删除" onConfirm={() => remove(p)}>
											<IconTrash size={13} />
										</ConfirmButton>
									)}
								</div>
							))}
						</div>
						{!creating ? (
							<button className="drawer-btn" onClick={() => setCreating(true)}>
								<IconPlus size={13} /> 新建身份
							</button>
						) : (
							<div className="panel-row">
								<input
									className="panel-search"
									placeholder="名字…"
									value={newName}
									autoFocus
									onChange={(e) => setNewName(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter" && newName.trim()) void create();
										if (e.key === "Escape") setCreating(false);
									}}
								/>
								<button className="drawer-btn" disabled={busy || !newName.trim()} onClick={() => void create()}>
									创建
								</button>
							</div>
						)}
					</section>

					{active && (
						<section className="sp-section">
							<h4>当前身份</h4>
							<div className="persona-avatar-edit">
								<PersonaAvatar p={{ ...active, name }} bust={avatarBust} size="lg" />
								<div className="persona-avatar-acts">
									<button type="button" className="drawer-btn" disabled={busy || uploading} onClick={() => fileRef.current?.click()}>
										{active.avatar ? "更换头像" : "导入头像"}
									</button>
									{active.avatar && (
										<button type="button" className="drawer-btn" disabled={busy || uploading} onClick={() => void clearAvatar()}>
											清除头像
										</button>
									)}
									<div className="field-hint">从相册选图 → 拖动/缩放裁剪 → 保存为圆形头像</div>
								</div>
							</div>
							<Field label="名字" hint="即剧情中的 {{user}}，场记与提示词都用它">
								<input
									className="panel-search"
									value={name}
									onChange={(e) => {
										setName(e.target.value);
										setDirty(true);
									}}
								/>
							</Field>
							<Field label="人设（可选）" hint="身份、外貌、背景……会进入角色卡的设定区">
								<textarea
									className="panel-search ta"
									rows={5}
									value={persona}
									onChange={(e) => {
										setPersona(e.target.value);
										setDirty(true);
									}}
								/>
							</Field>
							<button className="drawer-btn" disabled={busy || !dirty || !name.trim()} onClick={saveActive}>
								{dirty ? "保存并重载会话" : "已保存"}
							</button>
							<div className="toggle-row">
								<span>锁定到当前角色卡</span>
								<Toggle checked={data.lockedForCard === active.id} disabled={busy} onChange={(v) => setLock(v)} />
							</div>
							<div className="field-hint">锁定后，切到这张卡时自动使用该身份（其他卡仍用全局默认）。</div>
						</section>
					)}

					<section className="sp-section">
						<h4>对方显示名覆盖</h4>
						<Field label="显示名（可选）" hint="仅界面显示；适用于卡名是剧本标题而非角色名的场景卡">
							<input
								className="panel-search"
								placeholder="留空使用卡名"
								value={displayName}
								onChange={(e) => {
									setDisplayName(e.target.value);
									setDisplayDirty(true);
								}}
							/>
						</Field>
						<button className="drawer-btn" disabled={busy || !displayDirty} onClick={saveDisplayName}>
							{displayDirty ? "保存并重载会话" : "已保存"}
						</button>
					</section>
				</>
			)}
		</div>
	);
}
