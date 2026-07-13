/** 面板共用件：数据加载 hook + 表单原子（与纯白主题令牌配套的类名在 app.css） */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { apiGetPeek, runWithPanelFetchBypass } from "../api.ts";
import { IconClose } from "./icons.tsx";

/**
 * 面板刷新上下文（横切基建 §1 数据时效）：App 在每轮 agent 结束时递增 tick。
 * usePanelData 传 { watchAgent: true } 的面板（技能库/知识库/世界书/上传区——agent 会写的资产）
 * 随之自动重拉；带草稿表单的面板（设置/用户角色/预设）不 opt-in，避免打字被清。
 *
 * 另有 {@link bumpWatchPanels}：角色卡导入配套世界书等「非 agent 回合」的资产写入后调用，
 * 让已保活挂载的 watchAgent 面板立刻重拉（不必等用户刷新网页）。
 */
export const PanelRefreshContext = createContext(0);

/** watchAgent 面板额外订阅的外部 bump（与 agentTick 正交） */
let watchBumpEpoch = 0;
const watchBumpListeners = new Set<(n: number) => void>();

/** 通知所有 watchAgent 面板重拉数据（导入挂载世界书、外部写资产后调用） */
export function bumpWatchPanels(): void {
	watchBumpEpoch += 1;
	for (const l of watchBumpListeners) l(watchBumpEpoch);
}

export interface PanelData<T> {
	data: T | null;
	error: string | null;
	loading: boolean;
	reload: () => void;
}

/**
 * 面板数据装载。
 * - cacheKey：与 apiGet 路径一致时，首帧从内存缓存同步水合（无「读取中」闪烁）
 * - 已有 data：后台静默刷新，不挡 UI（ST 式常驻）
 * - 每次 effect 拉数走网络（bypass 缓存），缓存只服务 peek 秒开
 */
export function usePanelData<T>(
	loader: () => Promise<T>,
	opts?: { watchAgent?: boolean; /** 与 apiGet 路径一致，用于同步水合 */ cacheKey?: string },
): PanelData<T> {
	const cacheKey = opts?.cacheKey;
	const seeded = cacheKey ? apiGetPeek<T>(cacheKey) : null;
	const [data, setData] = useState<T | null>(() => seeded);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(() => seeded == null);
	const [tick, setTick] = useState(0);
	const [watchBump, setWatchBump] = useState(0);
	const agentTick = useContext(PanelRefreshContext);
	const effectiveAgentTick = opts?.watchAgent ? agentTick + watchBump : 0;
	const hasDataRef = useRef(seeded != null);
	const loaderRef = useRef(loader);
	loaderRef.current = loader;

	useEffect(() => {
		if (!opts?.watchAgent) return;
		const onBump = (n: number) => setWatchBump(n);
		watchBumpListeners.add(onBump);
		return () => {
			watchBumpListeners.delete(onBump);
		};
	}, [opts?.watchAgent]);

	useEffect(() => {
		let alive = true;
		// 缓存可能在挂载后被预热写入：再 peek 一次（仅尚无 data 时）
		if (!hasDataRef.current && cacheKey) {
			const again = apiGetPeek<T>(cacheKey);
			if (again != null) {
				setData(again);
				hasDataRef.current = true;
				setLoading(false);
			}
		}
		const silent = hasDataRef.current;
		if (!silent) setLoading(true);
		setError(null);
		// 始终走网络：避免「reload / 右上角刷新 / agentTick」仍命中陈旧 GET 缓存
		runWithPanelFetchBypass(() => loaderRef.current())
			.then((d) => {
				if (alive) {
					setData(d);
					hasDataRef.current = true;
				}
			})
			.catch((e: unknown) => {
				if (alive) setError(e instanceof Error ? e.message : String(e));
			})
			.finally(() => {
				if (alive) setLoading(false);
			});
		return () => {
			alive = false;
		};
	}, [tick, effectiveAgentTick, cacheKey]);

	const reload = useCallback(() => setTick((t) => t + 1), []);
	return { data, error, loading, reload };
}

/** 异步动作按钮状态：防重入 + 错误回显 */
export function useAction(toast?: (level: "info" | "warning" | "error", text: string) => void) {
	const [busy, setBusy] = useState(false);
	const run = useCallback(
		async (fn: () => Promise<void>, doneText?: string) => {
			if (busy) return;
			setBusy(true);
			try {
				await fn();
				if (doneText) toast?.("info", doneText);
			} catch (e) {
				toast?.("error", e instanceof Error ? e.message : String(e));
			} finally {
				setBusy(false);
			}
		},
		[busy, toast],
	);
	return { busy, run };
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
	return (
		<label className="field">
			<span className="field-label">{label}</span>
			{children}
			{hint && <span className="field-hint">{hint}</span>}
		</label>
	);
}

export function PanelStatus({
	loading,
	error,
	/** 已有内容时不盖整页「读取中」，仅无数据的首拉才挡 */
	hasData,
}: {
	loading: boolean;
	error: string | null;
	hasData?: boolean;
}) {
	if (error) return <div className="panel-error">{error}</div>;
	if (loading && !hasData) return <div className="sp-empty">读取中…</div>;
	return null;
}

export function Toggle({
	checked,
	onChange,
	disabled,
	title,
}: {
	checked: boolean;
	onChange: (v: boolean) => void;
	disabled?: boolean;
	title?: string;
}) {
	return (
		<button
			type="button"
			className={`toggle ${checked ? "on" : ""}`}
			disabled={disabled}
			title={title}
			onClick={() => onChange(!checked)}
			aria-pressed={checked}
		>
			<span className="toggle-knob" />
		</button>
	);
}

/**
 * 二击确认按钮（危险操作统一件）：首击进入待确认态（变警示色、文案换 confirmText），
 * 3 秒内再击才执行；超时或失焦还原。删除类操作一律用它，不弹对话框。
 */
export function ConfirmButton({
	onConfirm,
	children,
	confirmText = "再点一次确认",
	className = "act",
	disabled,
	title,
	"aria-label": ariaLabel,
}: {
	onConfirm: () => void;
	children: React.ReactNode;
	confirmText?: string;
	className?: string;
	disabled?: boolean;
	title?: string;
	"aria-label"?: string;
}) {
	const [arming, setArming] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);
	const click = () => {
		if (!arming) {
			setArming(true);
			timer.current = setTimeout(() => setArming(false), 3000);
			return;
		}
		if (timer.current) clearTimeout(timer.current);
		setArming(false);
		onConfirm();
	};
	return (
		<button
			type="button"
			className={`${className} ${arming ? "confirm-arming" : ""}`}
			disabled={disabled}
			title={title}
			aria-label={ariaLabel}
			onClick={click}
			onBlur={() => {
				if (timer.current) clearTimeout(timer.current);
				setArming(false);
			}}
		>
			{arming ? confirmText : children}
		</button>
	);
}

/** 搜索框（带清空钮）：受控组件，清空即回调空串 */
export function SearchInput({
	value,
	onChange,
	placeholder,
	onEnter,
}: {
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	onEnter?: () => void;
}) {
	return (
		<div className="search-wrap">
			<input
				className="panel-search"
				type="text"
				placeholder={placeholder}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") onEnter?.();
					if (e.key === "Escape" && value) onChange("");
				}}
			/>
			{value && (
				<button type="button" className="search-clear" aria-label="清空搜索" onClick={() => onChange("")}>
					<IconClose size={13} />
				</button>
			)}
		</div>
	);
}

/** 数值参数：滑条＋数字框联动（拖动粗调、键入精调，双向同步） */
export function SliderField({
	label,
	hint,
	value,
	min,
	max,
	step = 1,
	onChange,
}: {
	label: string;
	hint?: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	onChange: (v: number) => void;
}) {
	const clamp = (n: number) => Math.min(max, Math.max(min, n));
	return (
		<div className="field">
			<span className="field-label">{label}</span>
			<div className="slider-row">
				<input
					type="range"
					className="slider"
					min={min}
					max={max}
					step={step}
					value={value}
					onChange={(e) => onChange(Number(e.target.value))}
				/>
				<input
					className="panel-search num"
					type="number"
					min={min}
					max={max}
					step={step}
					value={value}
					onChange={(e) => {
						const n = Number(e.target.value);
						if (Number.isFinite(n)) onChange(clamp(n));
					}}
				/>
			</div>
			{hint && <span className="field-hint">{hint}</span>}
		</div>
	);
}
