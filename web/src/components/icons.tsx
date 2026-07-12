/**
 * 内联 SVG 图标库(lucide 线形风格,ISC 许可的开源 path 数据)。
 * 统一 24 viewBox / currentColor / 1.75 描边——图标颜色随文字色走,主题令牌可控。
 * 顶栏 12 个面板入口 + 全部功能图标都从这里出,严禁 emoji 当图标。
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps & { children: React.ReactNode }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.75}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...rest}
		>
			{children}
		</svg>
	);
}

/* ── 顶栏面板入口 ── */

export const IconSessions = (p: IconProps) => (
	<Icon {...p}>
		<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" />
		<path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
	</Icon>
);

export const IconApi = (p: IconProps) => (
	<Icon {...p}>
		<path d="M12 22v-5" />
		<path d="M9 8V2" />
		<path d="M15 8V2" />
		<path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
	</Icon>
);

export const IconModel = (p: IconProps) => (
	<Icon {...p}>
		<rect x="4" y="4" width="16" height="16" rx="2" />
		<rect x="9" y="9" width="6" height="6" />
		<path d="M15 2v2" />
		<path d="M15 20v2" />
		<path d="M2 15h2" />
		<path d="M2 9h2" />
		<path d="M20 15h2" />
		<path d="M20 9h2" />
		<path d="M9 2v2" />
		<path d="M9 20v2" />
	</Icon>
);

export const IconPreset = (p: IconProps) => (
	<Icon {...p}>
		<line x1="21" x2="14" y1="4" y2="4" />
		<line x1="10" x2="3" y1="4" y2="4" />
		<line x1="21" x2="12" y1="12" y2="12" />
		<line x1="8" x2="3" y1="12" y2="12" />
		<line x1="21" x2="16" y1="20" y2="20" />
		<line x1="12" x2="3" y1="20" y2="20" />
		<line x1="14" x2="14" y1="2" y2="6" />
		<line x1="8" x2="8" y1="10" y2="14" />
		<line x1="16" x2="16" y1="18" y2="22" />
	</Icon>
);

export const IconSettings = (p: IconProps) => (
	<Icon {...p}>
		<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
		<circle cx="12" cy="12" r="3" />
	</Icon>
);

export const IconSkills = (p: IconProps) => (
	<Icon {...p}>
		<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
		<path d="M20 3v4" />
		<path d="M22 5h-4" />
	</Icon>
);

export const IconCard = (p: IconProps) => (
	<Icon {...p}>
		<path d="M18 21a6 6 0 0 0-12 0" />
		<circle cx="12" cy="11" r="4" />
		<rect width="18" height="18" x="3" y="3" rx="2" />
	</Icon>
);

export const IconLorebook = (p: IconProps) => (
	<Icon {...p}>
		<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
		<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
	</Icon>
);

export const IconCodex = (p: IconProps) => (
	<Icon {...p}>
		<path d="m16 6 4 14" />
		<path d="M12 6v14" />
		<path d="M8 8v12" />
		<path d="M4 4v16" />
	</Icon>
);

export const IconPersona = (p: IconProps) => (
	<Icon {...p}>
		<circle cx="12" cy="8" r="5" />
		<path d="M20 21a8 8 0 0 0-16 0" />
	</Icon>
);

export const IconStatus = (p: IconProps) => (
	<Icon {...p}>
		<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
	</Icon>
);

export const IconUploads = (p: IconProps) => (
	<Icon {...p}>
		<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
	</Icon>
);

/** 世界线 / 时间线 */
export const IconWorldline = (p: IconProps) => (
	<Icon {...p}>
		<circle cx="6" cy="6" r="2.5" />
		<circle cx="18" cy="12" r="2.5" />
		<circle cx="6" cy="18" r="2.5" />
		<path d="M8.5 7.5 15.5 11" />
		<path d="M8.5 16.5 15.5 13" />
	</Icon>
);

/* ── 功能图标 ── */

export const IconClose = (p: IconProps) => (
	<Icon {...p}>
		<path d="M18 6 6 18" />
		<path d="m6 6 12 12" />
	</Icon>
);

export const IconSend = (p: IconProps) => (
	<Icon {...p}>
		<path d="m5 12 7-7 7 7" />
		<path d="M12 19V5" />
	</Icon>
);

export const IconStop = (p: IconProps) => (
	<Icon {...p}>
		<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none" />
	</Icon>
);

export const IconAttach = (p: IconProps) => (
	<Icon {...p}>
		<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
	</Icon>
);

/** 存档钉 */
export const IconPin = (p: IconProps) => (
	<Icon {...p}>
		<path d="M12 17v5" />
		<path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
	</Icon>
);

/** 配音 / 扬声器 */
export const IconSpeaker = (p: IconProps) => (
	<Icon {...p}>
		<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
		<path d="M16 9a5 5 0 0 1 0 6" />
		<path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
	</Icon>
);

export const IconDock = (p: IconProps) => (
	<Icon {...p}>
		<rect width="7" height="7" x="3" y="3" rx="1" />
		<rect width="7" height="7" x="14" y="3" rx="1" />
		<rect width="7" height="7" x="14" y="14" rx="1" />
		<rect width="7" height="7" x="3" y="14" rx="1" />
	</Icon>
);

export const IconDownload = (p: IconProps) => (
	<Icon {...p}>
		<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
		<path d="m7 10 5 5 5-5" />
		<path d="M12 15V3" />
	</Icon>
);

export const IconTrash = (p: IconProps) => (
	<Icon {...p}>
		<path d="M3 6h18" />
		<path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
		<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
		<line x1="10" x2="10" y1="11" y2="17" />
		<line x1="14" x2="14" y1="11" y2="17" />
	</Icon>
);

export const IconRedo = (p: IconProps) => (
	<Icon {...p}>
		<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
		<path d="M21 3v5h-5" />
		<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
		<path d="M8 16H3v5" />
	</Icon>
);

export const IconEdit = (p: IconProps) => (
	<Icon {...p}>
		<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
		<path d="m15 5 4 4" />
	</Icon>
);

export const IconCopy = (p: IconProps) => (
	<Icon {...p}>
		<rect width="14" height="14" x="8" y="8" rx="2" />
		<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
	</Icon>
);

export const IconChevronDown = (p: IconProps) => (
	<Icon {...p}>
		<path d="m6 9 6 6 6-6" />
	</Icon>
);

export const IconChevronLeft = (p: IconProps) => (
	<Icon {...p}>
		<path d="m15 18-6-6 6-6" />
	</Icon>
);

export const IconChevronRight = (p: IconProps) => (
	<Icon {...p}>
		<path d="m9 18 6-6-6-6" />
	</Icon>
);

/** 回退 / 撤销 */
export const IconUndo = (p: IconProps) => (
	<Icon {...p}>
		<path d="M3 7v6h6" />
		<path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.7 2.9L3 13" />
	</Icon>
);

/** GitHub Mark */
export const IconGithub = (p: IconProps) => (
	<Icon {...p}>
		<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
		<path d="M9 18c-4.51 2-5-2-7-2" />
	</Icon>
);

export const IconPlay = (p: IconProps) => (
	<Icon {...p}>
		<path d="M6 4.5 19 12 6 19.5z" />
	</Icon>
);

export const IconRefresh = (p: IconProps) => (
	<Icon {...p}>
		<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
		<path d="M21 3v5h-5" />
		<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
		<path d="M8 16H3v5" />
	</Icon>
);

export const IconStar = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
	<Icon {...p} fill={filled ? "currentColor" : "none"}>
		<path d="M11.53 3.05a.53.53 0 0 1 .94 0l2.31 4.68a.53.53 0 0 0 .4.29l5.16.75a.53.53 0 0 1 .3.9l-3.74 3.65a.53.53 0 0 0-.15.46l.88 5.14a.53.53 0 0 1-.76.56l-4.62-2.43a.53.53 0 0 0-.49 0l-4.62 2.43a.53.53 0 0 1-.76-.56l.88-5.14a.53.53 0 0 0-.15-.46L3.36 9.67a.53.53 0 0 1 .3-.9l5.16-.75a.53.53 0 0 0 .4-.29z" />
	</Icon>
);

export const IconPencil = (p: IconProps) => (
	<Icon {...p}>
		<path d="M21.17 6.83a2.12 2.12 0 0 0-3-3L4 18v3h3z" />
		<path d="m14 6 4 4" />
	</Icon>
);

export const IconGrid = (p: IconProps) => (
	<Icon {...p}>
		<rect x="3" y="3" width="7" height="7" rx="1" />
		<rect x="14" y="3" width="7" height="7" rx="1" />
		<rect x="3" y="14" width="7" height="7" rx="1" />
		<rect x="14" y="14" width="7" height="7" rx="1" />
	</Icon>
);

export const IconList = (p: IconProps) => (
	<Icon {...p}>
		<path d="M8 6h13" />
		<path d="M8 12h13" />
		<path d="M8 18h13" />
		<path d="M3 6h.01" />
		<path d="M3 12h.01" />
		<path d="M3 18h.01" />
	</Icon>
);

export const IconBell = (p: IconProps) => (
	<Icon {...p}>
		<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
		<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
	</Icon>
);

export const IconPuzzle = (p: IconProps) => (
	<Icon {...p}>
		<path d="M19.4 14a1.9 1.9 0 0 0 0 -3.8h-1.5V7.4a1.9 1.9 0 0 0-1.9-1.9h-2.8V4a1.9 1.9 0 0 0-3.8 0v1.5H6.6a1.9 1.9 0 0 0-1.9 1.9v2.8H3.2a1.9 1.9 0 0 0 0 3.8h1.5v2.8a1.9 1.9 0 0 0 1.9 1.9h2.8v1.5a1.9 1.9 0 0 0 3.8 0v-1.5h2.8a1.9 1.9 0 0 0 1.9-1.9V14z" />
	</Icon>
);

export const IconBack = (p: IconProps) => (
	<Icon {...p}>
		<path d="m12 19-7-7 7-7" />
		<path d="M19 12H5" />
	</Icon>
);

export const IconPlus = (p: IconProps) => (
	<Icon {...p}>
		<path d="M12 5v14" />
		<path d="M5 12h14" />
	</Icon>
);

export const IconCheck = (p: IconProps) => (
	<Icon {...p}>
		<path d="M20 6 9 17l-5-5" />
	</Icon>
);
