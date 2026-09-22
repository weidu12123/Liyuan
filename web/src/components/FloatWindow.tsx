/**
 * 悬浮窗：梨园自有面板的第三种形态（另两种是左栏 / 右栏）。
 *
 * 存在理由不是「更好看」，而是侧栏宽度被布局写死——`.side` 的宽度是
 * `max(300px, (100% - 聊天列宽) / 2 - 26px)`，1920 的屏上算出来 434px，一个又高又窄的条。
 * 世界线那张分叉图每多一层存档就宽 112px 且不缩放，名录四张表在窄栏里只能纵向排队。
 * 这类「要横向铺开」的面板需要一块自己的画布，于是有了这个壳。
 *
 * ## 它只管壳，不管内容
 * 标题栏 + 拖动 + 缩放 + 位置记忆，仅此而已。里面渲染什么由调用方给 children，
 * 与左右栏共用同一批面板组件——所以这里没有任何一个面板的名字。
 *
 * ## z-index 60 是算出来的，不是随手填的
 * 现有分层：顶栏 50 < **本窗 60** < tooltip 80 < 世界线节点菜单 90 < 居中弹窗 200 < 登录闸 1000。
 * 落在 60 才能同时满足两件事：盖住顶栏（否则窗口拖到上面会被顶栏切掉），
 * 又让窗口内面板自己弹出的菜单/弹窗照常盖在它上面（世界线的回档菜单就是 90）。
 * 作者卡的悬浮球用到 9999/2147483647，在本窗之上——那是作者的地盘，不去覆盖它。
 *
 * ## 手机上它不是窗，是抽屉
 * 窄屏没有「浮」的余地，但**铺满整屏是另一个极端**：剧情、顶栏、输入框会被一起盖掉，
 * 看一眼名录就等于离开对话，而这几个面板恰恰是要边看剧情边对照的。
 * 所以窄屏走底部抽屉，且**是让位不是盖住**：抽屉的高度写在 `:root` 的
 * `--floatwin-sheet-h` 上，`.app` 自己 `100dvh - 那个值`（见 app.css 的断点段），
 * 于是上半屏是一个完整可用的对话——消息区被压矮，**输入栏原样留着，能一边看面板一边打字**。
 * 两种形态共用同一套拖动代码，只是自由度不同——桌面两个（位置/尺寸），手机一个（高度）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { IconClose, IconRefresh } from "./icons.tsx";
import { readUiJson, writeUiJson } from "../uiStore.ts";
import { t } from "../i18n/index.ts";

export interface FloatRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** 最小尺寸：再小就没有「铺开」的意义了，且标题栏会挤成一团 */
const MIN_W = 420;
const MIN_H = 280;
/** 窗口至少留这么多在视口内，保证标题栏永远抓得到（拖出屏幕外就再也拖不回来了） */
const KEEP_VISIBLE = 120;

const storeKey = (id: string) => `liyuan.float.${id}`;

function readRect(id: string): FloatRect | null {
	const v = readUiJson<Partial<FloatRect>>(storeKey(id));
	if (!v) return null;
	if (typeof v.x !== "number" || typeof v.y !== "number") return null;
	if (typeof v.w !== "number" || typeof v.h !== "number") return null;
	return { x: v.x, y: v.y, w: v.w, h: v.h };
}

const writeRect = (id: string, r: FloatRect): void => writeUiJson(storeKey(id), r);

/** 默认铺开一块够宽的画布；小屏按视口收 */
function defaultRect(): FloatRect {
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const w = Math.max(MIN_W, Math.min(1040, vw - 48));
	const h = Math.max(MIN_H, Math.min(660, vh - 120));
	return { x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2), w, h };
}

/** 把窗口按当前视口夹回可见范围（开窗时、以及浏览器窗口变小时） */
function clamp(r: FloatRect): FloatRect {
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const w = Math.max(MIN_W, Math.min(r.w, vw - 16));
	const h = Math.max(MIN_H, Math.min(r.h, vh - 16));
	return {
		w,
		h,
		x: Math.min(Math.max(r.x, KEEP_VISIBLE - w), vw - KEEP_VISIBLE),
		y: Math.min(Math.max(r.y, 0), vh - 44),
	};
}

/* ---------- 手机形态：底部抽屉 ---------- */

/** 与 app.css 的抽屉断点、App.tsx 的 mobileRef 是同一个数 */
const MOBILE_MQ = "(max-width: 999px)";
const isMobile = (): boolean => typeof matchMedia !== "undefined" && matchMedia(MOBILE_MQ).matches;

/**
 * 抽屉高度的记忆键。**所有面板共用一个**，理由有两条：
 * 「抽屉拉多高」是一次性的手感偏好，不是某个面板的属性；而且共用意味着窄屏永远不写
 * `liyuan.float.<id>`——否则手机上一拖，桌面那份位置记忆就被一个窄屏尺寸覆盖了。
 */
const SHEET_KEY = "liyuan.float.sheetH";
/** 再矮就只剩标题栏，没有内容可看了 */
const MIN_SHEET = 200;
/**
 * 抽屉最高时，上方仍必须放得下一个**能用**的对话：顶栏 47 + 输入栏约 131 + 两三条消息的余量。
 * 这个下限就是抽屉「让位而不是盖住」的全部意思——留不下输入栏，就等于退回全屏那个毛病。
 */
const APP_MIN_H = 300;
/** 往下甩到这个高度以下，意图就不是「拉矮」而是「收起」 */
const SHEET_DISMISS = 120;

/** 视口高度当参数传而不在里面读 window：这条夹取是纯算术，看得出来就查得出来 */
function clampSheetH(h: number, vh: number): number {
	return Math.max(MIN_SHEET, Math.min(h, Math.max(MIN_SHEET, vh - APP_MIN_H)));
}
const defaultSheetH = (vh: number): number => clampSheetH(Math.round(vh * 0.5), vh);

/** 读回记住的抽屉高度；没记过就用缺省。视口高度在这一处取 */
const readSheetH = (): number => {
	const vh = window.innerHeight;
	return clampSheetH(readUiJson<number>(SHEET_KEY) ?? defaultSheetH(vh), vh);
};

/**
 * 抽屉高度是 CSS 的输入，挂在 `:root` 上而不是本元素的 inline style——
 * 因为读它的有两个人：本窗的 `height`，和 `.app` 的 `100dvh - 它`。一份值，两处读。
 */
const SHEET_VAR = "--floatwin-sheet-h";

/** 本窗的层级；与 app.css 的 `.floatwin { z-index }` 是同一个数，改一处要改两处 */
const Z_INDEX = 60;

/**
 * 当前是否有比本窗更高的层开着（面板自己弹的菜单、裁图、灯箱、登录闸……）。
 * 有的话 Esc 归它，不该越过它把整个窗口关掉。
 * 判据是**层级**不是名字——窗内渲染什么面板本组件并不知道，也不该知道。
 */
function hasHigherLayer(): boolean {
	for (const el of document.querySelectorAll("body *")) {
		const cs = getComputedStyle(el);
		if (cs.position !== "fixed" && cs.position !== "absolute") continue;
		if (cs.visibility === "hidden" || cs.display === "none") continue;
		const z = Number(cs.zIndex);
		if (Number.isFinite(z) && z > Z_INDEX) return true;
	}
	return false;
}

export function FloatWindow({
	id,
	title,
	icon,
	onRefresh,
	onClose,
	children,
}: {
	/** 位置记忆的键；同一个面板重开回到上次的位置 */
	id: string;
	title: string;
	icon?: React.ReactNode;
	onRefresh?: () => void;
	onClose: () => void;
	children: React.ReactNode;
}) {
	const [rect, setRect] = useState<FloatRect>(() => clamp(readRect(id) ?? defaultRect()));
	const rectRef = useRef(rect);
	rectRef.current = rect;
	/** 窄屏形态；随视口变化（转屏、桌面缩窗）实时跟着切 */
	const [mobile, setMobile] = useState(isMobile);
	const mobileRef = useRef(mobile);
	mobileRef.current = mobile;
	/** 抽屉高度（仅手机用）。共用一个键，故不随 id 变 */
	const [sheetH, setSheetH] = useState<number>(() => readSheetH());
	const sheetRef = useRef(sheetH);
	sheetRef.current = sheetH;
	/** 一次拖动/缩放的起点；null = 空闲。`dismiss` 只在抽屉上用：松手时是收起还是记高度 */
	const dragRef = useRef<{
		mode: "move" | "size";
		px: number;
		py: number;
		base: FloatRect;
		baseH: number;
		dismiss: boolean;
	} | null>(null);

	// 换面板 = 换记忆键，读它自己的位置
	useEffect(() => {
		setRect(clamp(readRect(id) ?? defaultRect()));
	}, [id]);

	// 形态跟着断点走。判断断点用 matchMedia 的 change 而不是搭 resize 的车——
	// 它只在真正跨过 999px 时响一次，且不依赖 resize 有没有及时发（App.tsx 的 mobileRef 同写法）
	useEffect(() => {
		if (typeof matchMedia === "undefined") return;
		const mq = matchMedia(MOBILE_MQ);
		const sync = () => setMobile(mq.matches);
		sync();
		mq.addEventListener("change", sync);
		return () => mq.removeEventListener("change", sync);
	}, []);

	// 视口变小可能把本窗挤出视口，夹回来；抽屉高度同理（转屏后可能超过新的上限）
	useEffect(() => {
		const onResize = () => {
			setRect((r) => clamp(r));
			setSheetH((h) => clampSheetH(h, window.innerHeight));
		};
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (hasHigherLayer()) return;
			onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	// 抽屉高度交给 CSS：本窗按它定高，`.app` 按 `100dvh - 它` 让位。
	// 窗一关（或切回桌面）就撤掉，`.app` 自己回到满屏——收口在这一个 effect 里，
	// 不必让 App 知道有个抽屉存在。
	useEffect(() => {
		const root = document.documentElement;
		if (!mobile) {
			root.style.removeProperty(SHEET_VAR);
			return;
		}
		root.style.setProperty(SHEET_VAR, `${sheetH}px`);
		return () => {
			root.style.removeProperty(SHEET_VAR);
		};
	}, [mobile, sheetH]);

	const startDrag = useCallback((mode: "move" | "size") => (e: React.PointerEvent) => {
		// 只接左键/触摸；标题栏上的按钮自己 stopPropagation，不会走到这里
		if (e.button !== 0) return;
		e.preventDefault();
		dragRef.current = {
			mode,
			px: e.clientX,
			py: e.clientY,
			base: rectRef.current,
			baseH: sheetRef.current,
			dismiss: false,
		};
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
	}, []);

	const onMove = useCallback((e: React.PointerEvent) => {
		const d = dragRef.current;
		if (!d) return;
		const dx = e.clientX - d.px;
		const dy = e.clientY - d.py;
		// 抽屉只有一个自由度：高度。往上拖变高、往下拖变矮（宽度由视口定死，没得调）
		if (mobileRef.current) {
			const raw = d.baseH - dy;
			d.dismiss = raw < SHEET_DISMISS;
			setSheetH(clampSheetH(raw, window.innerHeight));
			return;
		}
		setRect(
			clamp(
				d.mode === "move"
					? { ...d.base, x: d.base.x + dx, y: d.base.y + dy }
					: { ...d.base, w: d.base.w + dx, h: d.base.h + dy },
			),
		);
	}, []);

	const endDrag = useCallback(
		(e: React.PointerEvent) => {
			const d = dragRef.current;
			if (!d) return;
			dragRef.current = null;
			try {
				(e.currentTarget as Element).releasePointerCapture(e.pointerId);
			} catch {
				/* 指针已释放 */
			}
			if (mobileRef.current) {
				// 往下甩过头 = 收起（移动端抽屉的通用手势）。这一下不记高度，
				// 否则下次开出来只剩一条缝，用户会以为面板坏了
				if (d.dismiss) {
					setSheetH(readSheetH());
					onClose();
					return;
				}
				writeUiJson(SHEET_KEY, sheetRef.current);
				return;
			}
			// 落笔时才写盘：拖动过程每帧都写会把 localStorage 打满
			writeRect(id, rectRef.current);
		},
		[id, onClose],
	);

	return (
		<div
			className={`floatwin ${mobile ? "as-sheet" : ""}`}
			role="dialog"
			aria-label={title}
			// rect 一直发，手机上由 CSS 的 !important 盖掉。
			// **不能改成「手机时不发」**：CSS 断点是同步翻的，这个 mobile 是事件到达后才翻的，
			// 中间那一帧两边都不管几何，窗口会瞬间塌成无尺寸。
			// 至于窄屏尺寸污染桌面记忆——那是**写盘**的问题，堵在 endDrag 里（手机分支不写 rect）。
			style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
		>
			<div
				className="floatwin-head"
				onPointerDown={startDrag("move")}
				onPointerMove={onMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
			>
				<span className="floatwin-title">
					{icon}
					{title}
				</span>
				<span className="floatwin-actions" onPointerDown={(e) => e.stopPropagation()}>
					{onRefresh && (
						<button className="icon-btn" onClick={onRefresh} title={t("刷新")} aria-label={t("刷新面板")}>
							<IconRefresh size={15} />
						</button>
					)}
					<button className="icon-btn" onClick={onClose} title={t("关闭")} aria-label={t("关闭悬浮窗")}>
						<IconClose size={16} />
					</button>
				</span>
			</div>
			<div className="floatwin-body">{children}</div>
			<div
				className="floatwin-grip"
				role="presentation"
				title={t("拖动缩放")}
				onPointerDown={startDrag("size")}
				onPointerMove={onMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
			/>
		</div>
	);
}
