/**
 * 面板坞：agent 自建面板清单（顶栏中央「面板」下拉内容）。
 */

import { useRef } from "react";
import { apiPost } from "../api.ts";
import type { RpPanel } from "../wire.ts";
import { IconDownload } from "./icons.tsx";

const KIND_LABEL: Record<string, string> = { markdown: "文档", svg: "图形", html: "网页" };

export interface PanelDockProps {
	panels: RpPanel[];
	charName: string;
	onOpen: (name: string) => void;
	toast: (level: "info" | "warning" | "error", text: string) => void;
	variant?: "dropdown" | "composer";
	activeAgent?: string | null;
}

export function PanelDock({
	panels,
	charName,
	onOpen,
	toast,
	variant = "dropdown",
	activeAgent = null,
}: PanelDockProps) {
	const fileRef = useRef<HTMLInputElement>(null);

	const exportPanels = (list: RpPanel[], label: string) => {
		const data = {
			format: "liyuan-panels",
			version: 1,
			exported: new Date().toISOString(),
			card: charName,
			panels: list.map(({ name, kind, content }) => ({ name, kind, content })),
		};
		const blob = new Blob([JSON.stringify(data, null, "\t")], { type: "application/json" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `${label}.liyuan-panels.json`;
		a.click();
		URL.revokeObjectURL(a.href);
	};

	const importFile = async (file: File) => {
		try {
			const body: unknown = JSON.parse(await file.text());
			const r = await apiPost<{ imported: number; names: string[]; errors: string[] }>("/api/panels/import", body);
			if (r.errors?.length) toast("warning", `导入完成但有失败：\n${r.errors.join("\n")}`);
			if (r.names?.[0]) onOpen(r.names[0]);
		} catch (err) {
			toast("error", `导入失败：${err instanceof Error ? err.message : String(err)}`);
		}
	};

	return (
		<div className={`panel-dock-body panel-dock-${variant}`}>
			<div className="field-hint" style={{ marginBottom: 10 }}>
				本会话里由 {charName} 搭建的面板。点名称在侧栏打开；可导入 / 导出社区格式。
			</div>
			{panels.length === 0 && (
				<div className="sp-empty">还没有面板——剧情需要时角色会自己搭，也可以从文件导入。</div>
			)}
			<div className="dock-list">
				{panels.map((p) => (
					<div key={p.name} className={`dock-row ${activeAgent === p.name ? "current" : ""}`}>
						<button type="button" className="dock-name" onClick={() => onOpen(p.name)}>
							{p.name}
							<span className="dock-kind">{KIND_LABEL[p.kind] ?? p.kind}</span>
						</button>
						<button
							type="button"
							className="dock-act"
							title="导出此面板"
							aria-label="导出此面板"
							onClick={() => exportPanels([p], p.name)}
						>
							<IconDownload size={14} />
						</button>
					</div>
				))}
			</div>
			<div className="dock-foot">
				<button type="button" className="drawer-btn" onClick={() => fileRef.current?.click()}>
					导入
				</button>
				{panels.length > 0 && (
					<button type="button" className="drawer-btn" onClick={() => exportPanels(panels, charName || "面板")}>
						全部导出
					</button>
				)}
			</div>
			<input
				ref={fileRef}
				type="file"
				accept=".json,application/json"
				hidden
				onChange={(e) => {
					const f = e.target.files?.[0];
					if (f) void importFile(f);
					e.target.value = "";
				}}
			/>
		</div>
	);
}
