/**
 * 上传区面板：两个板块
 * - 我的上传（.liyuan-uploads/）：用户上传的素材，可再附到消息
 * - 本地图片（.liyuan-media/）：AI show_image 等落盘的图
 *
 * 「附到消息」只把已有路径放进待发送条，不会二次上传；发送后 AI 用 read 读文件夹里已有文件。
 */

import { useMemo, useRef, useState } from "react";
import { apiDelete, apiGet, uploadFile, type UploadInfo, type UploadsResponse } from "../api.ts";
import { attachmentUrl, toAttachmentView } from "../attachments.ts";
import { IconDownload, IconTrash, IconUploads } from "./icons.tsx";
import { ConfirmButton, PanelStatus, SearchInput, useAction, usePanelData } from "./kit.tsx";

type UploadSort = "recent" | "size" | "name";
type UploadFilter = "all" | "image" | "file";

const SORT_KEY = "liyuan.uploads.sort";
const sizeToBytes = (s: string): number => {
	const m = /^([\d.]+)\s*(B|KB|MB|GB)?$/i.exec(s.trim());
	if (!m) return 0;
	const mult = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[(m[2] ?? "B").toLowerCase()] ?? 1;
	return Number(m[1]) * mult;
};

function sortFilterList(list: UploadInfo[], query: string, sort: UploadSort, filter: UploadFilter): UploadInfo[] {
	const q = query.trim().toLowerCase();
	let out = list.filter((u) => {
		const isImg = toAttachmentView(u.file).image;
		return (!q || u.name.toLowerCase().includes(q)) && (filter === "all" || (filter === "image") === isImg);
	});
	out = [...out].sort((a, b) =>
		sort === "recent" ? b.mtimeMs - a.mtimeMs : sort === "size" ? sizeToBytes(b.size) - sizeToBytes(a.size) : a.name.localeCompare(b.name),
	);
	return out;
}

function ItemGrid({
	items,
	bulk,
	selected,
	busy,
	onToggle,
	onAttach,
	onRemove,
	canDelete,
}: {
	items: UploadInfo[];
	bulk: boolean;
	selected: Set<string>;
	busy: boolean;
	onToggle: (file: string) => void;
	onAttach: (u: UploadInfo) => void;
	onRemove: (u: UploadInfo) => void;
	canDelete: boolean;
}) {
	const images = items.filter((u) => toAttachmentView(u.file).image);
	const files = items.filter((u) => !toAttachmentView(u.file).image);

	return (
		<>
			{images.length > 0 && (
				<div className="upload-grid">
					{images.map((u) => (
						<div key={u.file} className={`upload-cell ${bulk && selected.has(u.file) ? "sel" : ""}`}>
							{bulk ? (
								<button type="button" className="upload-cell-btn" onClick={() => onToggle(u.file)}>
									<img src={attachmentUrl(toAttachmentView(u.file))} alt={u.name} loading="lazy" />
									<span className="upload-check">{selected.has(u.file) ? "✓" : ""}</span>
								</button>
							) : (
								<>
									<img src={attachmentUrl(toAttachmentView(u.file))} alt={u.name} loading="lazy" />
									<div className="upload-cell-acts">
										<button type="button" className="act" title="附到消息（不重新上传）" onClick={() => onAttach(u)}>
											附到消息
										</button>
										<a className="act" href={attachmentUrl(toAttachmentView(u.file))} target="_blank" rel="noreferrer" aria-label="查看">
											<IconDownload size={12} />
										</a>
										{canDelete && (
											<ConfirmButton confirmText="确认" disabled={busy} aria-label="删除" onConfirm={() => onRemove(u)}>
												<IconTrash size={12} />
											</ConfirmButton>
										)}
									</div>
									<div className="upload-cell-name" title={u.name}>
										{toAttachmentView(u.file).label}
									</div>
								</>
							)}
						</div>
					))}
				</div>
			)}
			{files.map((u) => {
				const view = toAttachmentView(u.file);
				return (
					<div key={u.file} className={`upload-row ${bulk && selected.has(u.file) ? "sel" : ""}`}>
						{bulk && <input type="checkbox" checked={selected.has(u.file)} onChange={() => onToggle(u.file)} />}
						<span className="file-ext">{(u.name.split(".").pop() ?? "?").toUpperCase()}</span>
						<div className="upload-info">
							<div className="upload-name" title={u.file}>
								{view.label}
							</div>
							<div className="lore-meta">
								{u.size} · {new Date(u.mtimeMs).toLocaleString()}
							</div>
						</div>
						{!bulk && (
							<div className="upload-acts">
								<button type="button" className="act" title="附到消息（不重新上传）" onClick={() => onAttach(u)}>
									附到消息
								</button>
								<a className="act" href={attachmentUrl(view)} target="_blank" rel="noreferrer" title="下载" aria-label="下载">
									<IconDownload size={14} />
								</a>
								{canDelete && (
									<ConfirmButton disabled={busy} title="删除" aria-label="删除" confirmText="确认删除" onConfirm={() => onRemove(u)}>
										<IconTrash size={14} />
									</ConfirmButton>
								)}
							</div>
						)}
					</div>
				);
			})}
		</>
	);
}

export function UploadsPanel({
	toast,
	onAttach,
}: {
	toast: (level: "info" | "warning" | "error", text: string) => void;
	onAttach: (u: UploadInfo) => void;
}) {
	const { data, error, loading, reload } = usePanelData(
		() => apiGet<UploadsResponse>("/api/uploads"),
		{ watchAgent: true, cacheKey: "/api/uploads" },
	);
	const { busy, run } = useAction(toast);
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<UploadSort>(() => (localStorage.getItem(SORT_KEY) as UploadSort) || "recent");
	const [filter, setFilter] = useState<UploadFilter>("all");
	const [bulk, setBulk] = useState(false);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [uploading, setUploading] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	const setSortP = (s: UploadSort) => {
		setSort(s);
		localStorage.setItem(SORT_KEY, s);
	};

	const myUploads = useMemo(
		() => sortFilterList(data?.uploads ?? [], query, sort, filter),
		[data?.uploads, query, sort, filter],
	);
	// 本地图片区只有图；过滤选「文件」时不显示
	const mediaList = useMemo(() => {
		if (filter === "file") return [];
		return sortFilterList(data?.media ?? [], query, sort, "image");
	}, [data?.media, query, sort, filter]);

	const remove = (u: UploadInfo) =>
		run(async () => {
			await apiDelete(`/api/uploads?file=${encodeURIComponent(u.file)}`);
			reload();
		}, `已删除：${u.name}`);

	const removeSelected = () =>
		run(async () => {
			for (const file of selected) {
				try {
					await apiDelete(`/api/uploads?file=${encodeURIComponent(file)}`);
				} catch {
					// 单个失败继续
				}
			}
			setSelected(new Set());
			setBulk(false);
			reload();
		}, "已删除所选");

	const doUpload = async (fl: FileList | File[]) => {
		setUploading(true);
		try {
			for (const f of Array.from(fl)) {
				try {
					await uploadFile(f);
				} catch (e) {
					toast("error", `「${f.name}」上传失败：${e instanceof Error ? e.message : String(e)}`);
				}
			}
			reload();
		} finally {
			setUploading(false);
			if (fileRef.current) fileRef.current.value = "";
		}
	};

	const toggleSel = (file: string) =>
		setSelected((s) => {
			const next = new Set(s);
			if (next.has(file)) next.delete(file);
			else next.add(file);
			return next;
		});

	const total = (data?.uploads.length ?? 0) + (data?.media.length ?? 0);

	return (
		<div
			className="panel-body"
			onDragOver={(e) => e.preventDefault()}
			onDrop={(e) => {
				e.preventDefault();
				if (e.dataTransfer.files.length > 0) void doUpload(e.dataTransfer.files);
			}}
		>
			<PanelStatus loading={loading} error={error} hasData={!!data} />
			{data && (
				<>
					<div className="field-hint" style={{ marginBottom: 8 }}>
						「附到消息」只引用已有路径，<strong>不会再次上传</strong>；发送后 AI 直接 read 文件夹里的文件。
					</div>
					<div className="panel-row list-toolbar">
						<button className="drawer-btn" disabled={uploading} onClick={() => fileRef.current?.click()}>
							<IconUploads size={13} /> {uploading ? "上传中…" : "上传到「我的」"}
						</button>
						<select className="panel-search" value={sort} onChange={(e) => setSortP(e.target.value as UploadSort)} aria-label="排序">
							<option value="recent">最近</option>
							<option value="size">大小</option>
							<option value="name">名字</option>
						</select>
						<select className="panel-search" value={filter} onChange={(e) => setFilter(e.target.value as UploadFilter)} aria-label="类型过滤">
							<option value="all">全部</option>
							<option value="image">图片</option>
							<option value="file">文件</option>
						</select>
						<button
							type="button"
							className={`drawer-btn ${bulk ? "active" : ""}`}
							onClick={() => {
								setBulk((v) => !v);
								setSelected(new Set());
							}}
						>
							{bulk ? "退出" : "批量"}
						</button>
						<input
							ref={fileRef}
							type="file"
							multiple
							hidden
							onChange={(e) => {
								if (e.target.files?.length) void doUpload(e.target.files);
							}}
						/>
					</div>
					{total > 6 && <SearchInput value={query} onChange={setQuery} placeholder="搜索文件名…" />}
					{bulk && selected.size > 0 && (
						<div className="panel-row">
							<ConfirmButton className="drawer-btn" disabled={busy} confirmText={`确认删除 ${selected.size} 个`} onConfirm={removeSelected}>
								删除所选（{selected.size}）
							</ConfirmButton>
						</div>
					)}

					<section className="sp-section">
						<h4>我的上传（{data.uploads.length}）</h4>
						<div className="field-hint">上传区 · 你上传的素材，跨会话可用</div>
						{data.uploads.length === 0 && <div className="sp-empty">还没有上传。拖文件进面板，或点上方「上传到我的」。</div>}
						{myUploads.length === 0 && data.uploads.length > 0 && <div className="sp-empty">没有匹配的文件。</div>}
						<ItemGrid
							items={myUploads}
							bulk={bulk}
							selected={selected}
							busy={busy}
							onToggle={toggleSel}
							onAttach={onAttach}
							onRemove={remove}
							canDelete
						/>
					</section>

					<section className="sp-section">
						<h4>本地图片（{data.media.length}）</h4>
						<div className="field-hint">本地出图 · AI 展示/生成后落盘的图，同样可「附到消息」再引用</div>
						{data.media.length === 0 && <div className="sp-empty">还没有本地出图。对话里 AI 用 show_image 展示后会出现在这里。</div>}
						{mediaList.length === 0 && data.media.length > 0 && <div className="sp-empty">没有匹配的图片。</div>}
						<ItemGrid
							items={mediaList}
							bulk={bulk}
							selected={selected}
							busy={busy}
							onToggle={toggleSel}
							onAttach={onAttach}
							onRemove={remove}
							canDelete
						/>
					</section>
				</>
			)}
		</div>
	);
}
