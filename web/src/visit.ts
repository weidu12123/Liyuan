/**
 * 访问分流：主页偏好 + 久未访问进主页，短间隔可续聊。
 * 只写本机 localStorage，不碰服务端。
 */

const VISIT_KEY = "liyuan.lastVisit";
/** 用户主动回主页后：刷新应停在主页，直到再次进入对话 */
const AT_HOME_KEY = "liyuan.atHome";

/** 超过该时长未访问 → 启动进主页（默认 30 分钟） */
export const HOME_IDLE_MS = 30 * 60 * 1000;

export function readLastVisit(): number {
	try {
		const n = Number(localStorage.getItem(VISIT_KEY) ?? 0);
		return Number.isFinite(n) && n > 0 ? n : 0;
	} catch {
		return 0;
	}
}

/** 记录一次访问时间（进入聊天 / 页面活跃时调用） */
export function touchVisit(ts = Date.now()): void {
	try {
		localStorage.setItem(VISIT_KEY, String(ts));
	} catch {
		/* private mode 等 */
	}
}

/** 是否停在主页（主动回主页后为 true，进对话后清掉） */
export function readAtHome(): boolean {
	try {
		return localStorage.getItem(AT_HOME_KEY) === "1";
	} catch {
		return false;
	}
}

export function setAtHome(on: boolean): void {
	try {
		if (on) localStorage.setItem(AT_HOME_KEY, "1");
		else localStorage.removeItem(AT_HOME_KEY);
	} catch {
		/* private mode 等 */
	}
}

/**
 * 启动是否应先进主页：
 * - 用户上次主动回主页且未再进对话 → 主页（刷新也停主页）
 * - 从未访问过 → 主页
 * - 距上次对话活跃超过 HOME_IDLE_MS → 主页
 * - 否则续聊
 */
export function shouldShowHomeOnBoot(now = Date.now()): boolean {
	if (readAtHome()) return true;
	const last = readLastVisit();
	if (!last) return true;
	return now - last >= HOME_IDLE_MS;
}
