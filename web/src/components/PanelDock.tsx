/**
 * 面板坞：agent 自建面板清单（顶栏中央「面板」下拉内容）。
 */

import { useRef, useState } from "react";
import { apiDelete, apiPost } from "../api.ts";
import type { RpPanel } from "../wire.ts";
import { IconDownload, IconRoster, IconTrash } from "./icons.tsx";
import { ConfirmButton } from "./kit.tsx";
import { t } from "../i18n/index.ts";

const KIND_LABEL: Record<string, string> = { markdown: "文档", svg: "图形", html: "网页" }; // i18n-ignore：用时经 t() 翻

export interface PanelDockProps {
	panels: RpPanel[];
	charName: string;
	onOpen: (name: string) => void;
	toast: (level: "info" | "warning" | "error", text: string) => void;
	variant?: "dropdown" | "composer";
	activeAgent?: string | null;
	/** 打开系统内置的登场名录面板（常驻行，与 agent 自建面板并列但不可增删） */
	onOpenRoster?: () => void;
	/** 名录面板当前是否展开（常驻行高亮用） */
	rosterActive?: boolean;
}

export function PanelDock({
	panels,
	charName,
	onOpen,
	toast,
	variant = "dropdown",
	activeAgent = null,
	onOpenRoster,
	rosterActive = false,
}: PanelDockProps) {
	const fileRef = useRef<HTMLInputElement>(null);
	const [busy, setBusy] = useState(false);

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
			if (r.errors?.length) toast("warning", t("导入完成但有失败：\n{errors}", { errors: r.errors.join("\n") }));
			if (r.names?.[0]) onOpen(r.names[0]);
		} catch (err) {
			toast("error", t("导入失败：{err}", { err: err instanceof Error ? err.message : String(err) }));
		}
	};

	const removePanel = async (name: string) => {
		if (busy) return;
		setBusy(true);
		try {
			await apiDelete(`/api/panels?name=${encodeURIComponent(name)}`);
			// 成功 toast 由 REST notify 推送；列表经 WS panels 帧更新
		} catch (err) {
			toast("error", err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={`panel-dock-body panel-dock-${variant}`}>
			{/* 系统内置面板：常驻，不随会话有无记录出现消失，也不可增删导出 */}
			{onOpenRoster && (
				<div className="dock-list dock-list-system">
					<div className={`dock-row dock-row-system ${rosterActive ? "current" : ""}`}>
						<button type="button" className="dock-name" onClick={onOpenRoster}>
							<IconRoster size={14} />
							{t("登场名录")}
							<span className="dock-kind">{t("系统")}</span>
						</button>
					</div>
				</div>
			)}
			<div className="field-hint" style={{ marginBottom: 10 }}>
				{t("本会话里由 {charName} 搭建的面板。点名称在侧栏打开；可导入 / 导出社区格式。", { charName })}
			</div>
			{panels.length === 0 && (
				<div className="sp-empty">{t("还没有面板——剧情需要时角色会自己搭，也可以从文件导入。")}</div>
			)}
			<div className="dock-list">
				{panels.map((p) => (
					<div key={p.name} className={`dock-row ${activeAgent === p.name ? "current" : ""}`}>
						<button type="button" className="dock-name" onClick={() => onOpen(p.name)}>
							{p.name}
							<span className="dock-kind">{KIND_LABEL[p.kind] ? t(KIND_LABEL[p.kind]) : p.kind}</span>
						</button>
						<button
							type="button"
							className="dock-act"
							title={t("导出此面板")}
							aria-label={t("导出此面板")}
							onClick={() => exportPanels([p], p.name)}
						>
							<IconDownload size={14} />
						</button>
						<ConfirmButton
							className="dock-act"
							disabled={busy}
							title={t("删除此面板")}
							aria-label={t("删除面板「{name}」", { name: p.name })}
							confirmText={t("确认删除")}
							onConfirm={() => void removePanel(p.name)}
						>
							<IconTrash size={14} />
						</ConfirmButton>
					</div>
				))}
			</div>
			<div className="dock-foot">
				<button type="button" className="drawer-btn" onClick={() => fileRef.current?.click()}>
					{t("导入")}
				</button>
				{panels.length > 0 && (
					<button type="button" className="drawer-btn" onClick={() => exportPanels(panels, charName || t("面板"))}>
						{t("全部导出")}
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
