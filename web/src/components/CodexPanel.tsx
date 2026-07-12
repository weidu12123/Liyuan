/**
 * 知识库面板：跨对话设定库。
 *
 * 交互：
 * - 点库名 / 整行 → 展开或收起
 * - 展开后才出现：添加条目、条目列表（查看）、改名/导出/删库
 * - 不会一点名字就进「新建条目」
 */

import { useEffect, useMemo, useState } from "react";
import {
	apiDelete,
	apiGet,
	apiPost,
	downloadJson,
	type CodexEntryView,
	type CodexInfo,
} from "../api.ts";
import { IconChevronDown, IconPencil, IconPlus, IconTrash } from "./icons.tsx";
import { ConfirmButton, Field, PanelStatus, SearchInput, Toggle, useAction, usePanelData } from "./kit.tsx";

function EntryCard({
	e,
	busy,
	onDelete,
}: {
	e: CodexEntryView;
	busy: boolean;
	onDelete: (fp: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const long = e.content.length > 120;
	const preview = long && !open ? `${e.content.slice(0, 120).trimEnd()}…` : e.content;
	return (
		<div className="codex-entry">
			<div className="codex-entry-head">
				<span className="codex-entry-name">{e.name}</span>
				<span className="lore-meta">{e.chars || e.content.length} 字</span>
				<ConfirmButton
					className="act"
					disabled={busy}
					confirmText="确认删除"
					title="删除这条"
					onConfirm={() => onDelete(e.fingerprint)}
				>
					<IconTrash size={12} />
				</ConfirmButton>
			</div>
			<div className={`codex-entry-body ${open || !long ? "open" : ""}`}>{preview}</div>
			{long && (
				<button type="button" className="act codex-entry-more" onClick={() => setOpen((v) => !v)}>
					{open ? "收起" : "展开全文"}
				</button>
			)}
		</div>
	);
}

function CodexRow({
	c,
	busy,
	toast,
	onChanged,
}: {
	c: CodexInfo;
	busy: boolean;
	toast: (level: "info" | "warning" | "error", text: string) => void;
	onChanged: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [entries, setEntries] = useState<CodexEntryView[] | null>(null);
	const [loadingEntries, setLoadingEntries] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [renaming, setRenaming] = useState(false);
	const [newName, setNewName] = useState(c.name);
	const [adding, setAdding] = useState(false);
	const [entryName, setEntryName] = useState("");
	const [entryInfo, setEntryInfo] = useState("");
	const { run, busy: rowBusy } = useAction(toast);
	const locked = busy || rowBusy;

	const loadEntries = async (force = false) => {
		if (entries !== null && !force) return;
		setLoadingEntries(true);
		try {
			const r = await apiGet<{ entries: CodexEntryView[] }>(`/api/codex/entries?name=${encodeURIComponent(c.name)}`);
			setEntries(r.entries);
			setErr(null);
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
		} finally {
			setLoadingEntries(false);
		}
	};

	useEffect(() => {
		if (!open) {
			// 收起时关掉添加表单，避免下次展开还停在「新建」
			setAdding(false);
			setRenaming(false);
			return;
		}
		void loadEntries(true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, c.entryCount, c.name]);

	const setMounted = (mounted: boolean) =>
		run(async () => {
			await apiPost("/api/codex/mount", { name: c.name, mounted });
			setTimeout(onChanged, 600);
		}, mounted ? `挂载中：${c.name}` : `卸载中：${c.name}`);

	const rename = () =>
		run(async () => {
			await apiPost("/api/codex/rename", { name: c.name, newName: newName.trim() });
			setRenaming(false);
			onChanged();
		}, "已重命名");

	const remove = () =>
		run(async () => {
			await apiDelete(`/api/codex?name=${encodeURIComponent(c.name)}`);
			onChanged();
		});

	const doExport = async () => {
		try {
			const r = await apiGet<{ name: string; json: unknown }>(`/api/codex/export?name=${encodeURIComponent(c.name)}`);
			downloadJson(`${r.name}.json`, r.json);
			toast("info", "已导出为世界书 JSON");
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		}
	};

	const addEntry = () =>
		run(async () => {
			const r = await apiPost<{ ok: true; duplicate?: boolean }>(`/api/codex/entries`, {
				codex: c.name,
				name: entryName.trim(),
				info: entryInfo.trim(),
			});
			setEntryName("");
			setEntryInfo("");
			setAdding(false);
			await loadEntries(true);
			onChanged();
			if (r.duplicate) toast("warning", "内容与已有条目重复，未重复写入");
		}, "已添加");

	const deleteEntry = (fp: string) =>
		run(async () => {
			await apiDelete(`/api/codex/entries?codex=${encodeURIComponent(c.name)}&fp=${encodeURIComponent(fp)}`);
			await loadEntries(true);
			onChanged();
		}, "已删除条目");

	const toggleOpen = () => setOpen((v) => !v);

	return (
		<div className={`codex-card ${open ? "open" : ""}`}>
			{/* 折叠态：只显示名字行 + 挂载；点名字 = 展开，绝不进新建 */}
			<div className="codex-card-top">
				<button
					type="button"
					className="codex-expand-btn"
					aria-expanded={open}
					onClick={toggleOpen}
					title={open ? "收起" : "展开：查看 / 添加条目"}
				>
					<span className={`codex-chevron ${open ? "open" : ""}`} aria-hidden>
						<IconChevronDown size={16} />
					</span>
					<span className="codex-card-name">{c.name}</span>
					<span className="codex-count-chip">{c.entryCount} 条</span>
					<span className="codex-expand-hint">{open ? "收起" : "展开"}</span>
				</button>
				<label
					className="expose-toggle"
					title={c.mounted ? "卸载：本对话不再检索该库" : "挂载：并入本对话检索"}
					onClick={(e) => e.stopPropagation()}
				>
					<span className="expose-label">{c.mounted ? "已挂载" : "未挂载"}</span>
					<Toggle checked={c.mounted} disabled={locked} onChange={(v) => setMounted(v)} />
				</label>
			</div>

			{/* 展开后：先工具栏（添加 / 查看就是列表本身），再列表或添加表单 */}
			{open && (
				<div className="codex-card-body">
					{c.description && <div className="codex-card-desc">{c.description}</div>}

					<div className="codex-card-actions">
						{!adding ? (
							<button
								type="button"
								className="drawer-btn codex-action-primary"
								disabled={locked}
								onClick={() => setAdding(true)}
							>
								<IconPlus size={13} /> 添加条目
							</button>
						) : (
							<span className="codex-adding-label">正在添加…</span>
						)}
						<button
							type="button"
							className="act"
							disabled={c.mounted || locked}
							title={c.mounted ? "已挂载的库先卸载再改名" : "重命名"}
							onClick={() => {
								setNewName(c.name);
								setRenaming(true);
							}}
						>
							<IconPencil size={12} /> 改名
						</button>
						<button type="button" className="act" onClick={() => void doExport()}>
							导出
						</button>
						<ConfirmButton
							disabled={locked || c.mounted}
							title={c.mounted ? "已挂载的库先卸载再删除" : "删除整库（不可恢复）"}
							confirmText="确认删除"
							onConfirm={() => void remove()}
						>
							<IconTrash size={12} /> 删库
						</ConfirmButton>
					</div>

					{renaming && (
						<div className="panel-row codex-rename-row">
							<input
								className="panel-search"
								value={newName}
								autoFocus
								onChange={(e) => setNewName(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && newName.trim()) void rename();
									if (e.key === "Escape") setRenaming(false);
								}}
							/>
							<button className="drawer-btn" disabled={locked || !newName.trim()} onClick={() => void rename()}>
								确定
							</button>
							<button className="drawer-btn" onClick={() => setRenaming(false)}>
								取消
							</button>
						</div>
					)}

					{adding && (
						<div className="codex-add-form">
							<div className="field-hint">只需填名字和信息；系统会自动生成检索关键词。</div>
							<Field label="名字">
								<input
									className="panel-search"
									placeholder="如：赤髓·蚀骨兰"
									value={entryName}
									autoFocus
									onChange={(e) => setEntryName(e.target.value)}
								/>
							</Field>
							<Field label="信息">
								<textarea
									className="panel-search codex-info-input"
									rows={4}
									placeholder="这条设定的具体内容…"
									value={entryInfo}
									onChange={(e) => setEntryInfo(e.target.value)}
								/>
							</Field>
							<div className="panel-row">
								<button
									className="drawer-btn save-btn"
									disabled={locked || !entryName.trim() || !entryInfo.trim()}
									onClick={() => void addEntry()}
								>
									保存
								</button>
								<button
									className="drawer-btn"
									disabled={locked}
									onClick={() => {
										setAdding(false);
										setEntryName("");
										setEntryInfo("");
									}}
								>
									取消
								</button>
							</div>
						</div>
					)}

					<div className="codex-entries-wrap">
						<div className="codex-section-label">条目列表</div>
						{err && <div className="panel-error">{err}</div>}
						{loadingEntries && entries === null && <div className="sp-empty">加载中…</div>}
						{entries !== null && entries.length === 0 && !adding && (
							<div className="sp-empty">
								还没有条目。
								<button type="button" className="drawer-btn codex-empty-add" disabled={locked} onClick={() => setAdding(true)}>
									<IconPlus size={13} /> 添加第一条
								</button>
							</div>
						)}
						{entries !== null && entries.length > 0 && (
							<div className="codex-entries">
								{entries.map((e) => (
									<EntryCard key={e.fingerprint} e={e} busy={locked} onDelete={deleteEntry} />
								))}
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

export function CodexPanel({ toast }: { toast: (level: "info" | "warning" | "error", text: string) => void }) {
	const { data, error, loading, reload } = usePanelData(
		() => apiGet<{ mounted: string[]; codexes: CodexInfo[] }>("/api/codex"),
		{ watchAgent: true, cacheKey: "/api/codex" },
	);
	const { busy, run } = useAction(toast);
	const [query, setQuery] = useState("");
	const [creating, setCreating] = useState(false);
	const [name, setName] = useState("");
	const [desc, setDesc] = useState("");

	const create = () =>
		run(async () => {
			await apiPost("/api/codex", { name: name.trim(), description: desc.trim() });
			setName("");
			setDesc("");
			setCreating(false);
			reload();
		});

	const list = useMemo(() => {
		const q = query.trim().toLowerCase();
		const src = data?.codexes ?? [];
		if (!q) return src;
		return src.filter((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
	}, [data, query]);

	return (
		<div className="panel-body">
			<PanelStatus loading={loading} error={error} hasData={!!data} />
			{data && (
				<section className="sp-section">
					<h4>知识库（{data.codexes.length}）</h4>
					<div className="field-hint">
						点库名展开 → 再「添加条目」或浏览列表。挂载后并入本对话检索；扮演中也可让 AI 写入。
					</div>
					{!creating ? (
						<button className="drawer-btn" onClick={() => setCreating(true)}>
							<IconPlus size={13} /> 新建知识库
						</button>
					) : (
						<div className="provider-edit">
							<input
								className="panel-search"
								placeholder="库名（如 九州风物志）"
								value={name}
								autoFocus
								onChange={(e) => setName(e.target.value)}
							/>
							<input className="panel-search" placeholder="一句话描述（可选）" value={desc} onChange={(e) => setDesc(e.target.value)} />
							<div className="panel-row">
								<button className="drawer-btn" disabled={busy || !name.trim()} onClick={() => void create()}>
									创建
								</button>
								<button className="drawer-btn" onClick={() => setCreating(false)}>
									取消
								</button>
							</div>
						</div>
					)}
					{data.codexes.length > 3 && <SearchInput value={query} onChange={setQuery} placeholder="搜索知识库…" />}
					{data.codexes.length === 0 && <div className="sp-empty">还没有知识库——点「新建」，或在对话里让 AI 建一个。</div>}
					<div className="codex-list">
						{list.map((c) => (
							<CodexRow key={c.name} c={c} busy={busy} toast={toast} onChanged={reload} />
						))}
					</div>
				</section>
			)}
		</div>
	);
}
