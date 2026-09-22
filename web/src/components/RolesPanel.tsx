/**
 * 角色板块（PLAN-FRONTEND-V2 §三 轨位 1）：一个壳，两页签。
 *
 * 「角色卡库」＝ AI 演谁，「用户角色」＝ 我演谁——两者都是跨会话的资产，
 * 本来就该一个板块两个视图。这里只做切换与保活，不碰 CardPanel / PersonaPanel
 * 各自的内部实现（刀 1 的口径：面板原样搬进抽屉）。
 *
 * 工坊入口挂在卡库这一侧：它编辑的就是当前这张卡，入口与对象放在一起。
 */

import { CardPanel } from "./CardPanel.tsx";
import { IconEdit } from "./icons.tsx";
import { PersonaPanel } from "./PersonaPanel.tsx";
import { t } from "../i18n/index.ts";

export type RolesTab = "card" | "persona";

export interface RolesPanelProps {
	tab: RolesTab;
	onTab?: (tab: RolesTab) => void;
	toast: (level: "info" | "warning" | "error", text: string) => void;
	/** 打开全屏角色卡工坊 */
	onOpenStudio?: () => void;
	/** 本板块是否正在显示（透传给 CardPanel 的 active） */
	active?: boolean;
	onEnterChat?: () => void;
	onGoHome?: () => void;
	onFrontChange?: () => void;
	/** 是否在 panel-head 中由外层统一托管 Tab（消除双重标题栏） */
	headerTabs?: boolean;
}

export function RolesPanel({
	tab,
	onTab,
	toast,
	onOpenStudio,
	active = true,
	onEnterChat,
	onGoHome,
	onFrontChange,
	headerTabs = false,
}: RolesPanelProps) {
	return (
		<div className="roles-panel">
			{!headerTabs && (
				<div className="roles-tabs" role="group" aria-label={t("角色")}>
					<button type="button" aria-pressed={tab === "card"} onClick={() => onTab?.("card")}>
						{t("角色卡库")}
					</button>
					<button type="button" aria-pressed={tab === "persona"} onClick={() => onTab?.("persona")}>
						{t("用户角色")}
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
			{/* 两侧都常挂：切回来时不重新「读取中」，与侧栏保活同规矩 */}
			<div className="roles-view" hidden={tab !== "card"} style={tab === "card" ? undefined : { display: "none" }}>
				<CardPanel
					toast={toast}
					active={active && tab === "card"}
					{...(onEnterChat ? { onEnterChat } : {})}
					{...(onGoHome ? { onGoHome } : {})}
					{...(onFrontChange ? { onFrontChange } : {})}
				/>
			</div>
			<div className="roles-view" hidden={tab !== "persona"} style={tab === "persona" ? undefined : { display: "none" }}>
				<PersonaPanel toast={toast} />
			</div>
		</div>
	);
}
