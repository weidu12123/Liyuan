/**
 * 角色板块（角色卡库/日常档案 ⇄ 角色卡工坊 ⇄ 用户角色）。
 *
 * 「角色卡库」＝ AI 演谁，「用户角色」＝ 我演谁；
 * 点角色档案右上角「角色卡工坊」原地切入 00–09 全量工坊视图（并由外层自动收起左侧栏让出宽度）。
 */

import { CardPanel } from "./CardPanel.tsx";
import { CardStudio } from "./CardStudio.tsx";
import { IconEdit } from "./icons.tsx";
import { BtwRolePanel, PersonaPanel } from "./PersonaPanel.tsx";
import { t } from "../i18n/index.ts";

export type RolesTab = "card" | "persona" | "btw";

export interface RolesPanelProps {
	tab: RolesTab;
	onTab?: (tab: RolesTab) => void;
	toast: (level: "info" | "warning" | "error", text: string) => void;
	onBtwProfileChange?: (profile: { name: string; avatar?: string; bust: number }) => void;
	/** 是否处于 00–09 写卡工坊视图 */
	studioOpen?: boolean;
	/** 打开角色卡工坊视图 */
	onOpenStudio?: () => void;
	/** 从工坊返回日常人物档案 */
	onBackFromStudio?: () => void;
	/** 从工坊直接关闭整个角色面板回到对话 */
	onCloseStudioPanel?: () => void;
	/** 工坊应用变更后的回调 */
	onStudioApplied?: () => void;
	/** 本板块是否正在显示（透传给 CardPanel 的 active） */
	active?: boolean;
	onEnterChat?: () => void;
	onGoHome?: () => void;
	onFrontChange?: () => void;
	/** 是否在 panel-head 中由外层统一托管 Tab（消除双重标题栏） */
	headerTabs?: boolean;
	lorePickerOpen?: boolean;
	onToggleLorePicker?: () => void;
}

export function RolesPanel({
	tab,
	onTab,
	toast,
	onBtwProfileChange,
	studioOpen = false,
	onOpenStudio,
	onBackFromStudio,
	onCloseStudioPanel,
	onStudioApplied,
	active = true,
	onEnterChat,
	onGoHome,
	onFrontChange,
	headerTabs = false,
	lorePickerOpen,
	onToggleLorePicker,
}: RolesPanelProps) {
	return (
		<div className="roles-panel">
			{!headerTabs && !studioOpen && (
				<div className="roles-tabs" role="group" aria-label={t("角色")}>
					<button type="button" aria-pressed={tab === "card"} onClick={() => onTab?.("card")}>
						{t("角色卡库")}
					</button>
					<button type="button" aria-pressed={tab === "persona"} onClick={() => onTab?.("persona")}>
						{t("用户角色")}
					</button>
					<button type="button" aria-pressed={tab === "btw"} onClick={() => onTab?.("btw")}>
						{t("助手")}
					</button>
					{tab === "card" && onOpenStudio && (
						<button
							type="button"
							className="roles-studio"
							title={t("角色卡工坊")}
							aria-label={t("打开角色卡工坊")}
							onClick={onOpenStudio}
						>
							<IconEdit size={15} />
						</button>
					)}
				</div>
			)}
			{studioOpen ? (
				<div className="roles-view">
					<CardStudio
						{...(onBackFromStudio ? { onBack: onBackFromStudio } : {})}
						onClose={onCloseStudioPanel ?? (() => onBackFromStudio?.())}
						onApplied={() => {
							onStudioApplied?.();
							onFrontChange?.();
						}}
					/>
				</div>
			) : (
				<>
					{/* 三侧都常挂：切回来时不重新「读取中」，与侧栏保活同规矩 */}
					<div className="roles-view" hidden={tab !== "card"} style={tab === "card" ? undefined : { display: "none" }}>
						<CardPanel
							toast={toast}
							active={active && tab === "card"}
							{...(onOpenStudio ? { onOpenStudio } : {})}
							{...(onEnterChat ? { onEnterChat } : {})}
							{...(onGoHome ? { onGoHome } : {})}
							{...(onFrontChange ? { onFrontChange } : {})}
							lorePickerOpen={lorePickerOpen}
							onToggleLorePicker={onToggleLorePicker}
						/>
					</div>
					<div className="roles-view" hidden={tab !== "persona"} style={tab === "persona" ? undefined : { display: "none" }}>
						<PersonaPanel toast={toast} />
					</div>
					<div className="roles-view" hidden={tab !== "btw"} style={tab === "btw" ? undefined : { display: "none" }}>
						<BtwRolePanel toast={toast} onProfileChange={onBtwProfileChange} />
					</div>
				</>
			)}
		</div>
	);
}
