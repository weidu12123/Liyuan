/**
 * 剧情扩展内存同步（进程内直达，不经 /panelsync 命令桥）。
 *
 * 背景：面板/账本落盘后，若再用 handlePrompt("/panelsync") 收编，
 * 在剧情回合中会 followUp 排队 → 死锁。
 * roleplay 在 session_start 注册回调；server 写盘后直接调用。
 *
 * 【双模块陷阱】（8/23 实证修复）roleplay 由 jiti 加载（tryNative:false），
 * server/main 走 Node 原生 ESM，两边对本文件各得一份 module scope。回调若存在
 * 模块级 `let` 里，扩展 register 写进 A、server 调用读 B 的 null ⇒ 整个同步是
 * **静默 no-op**：用户在面板/世界状态编辑窗改的东西落了盘，却永远不进会话树的
 * `rp-state`/`rp-panels` 快照，而引擎每拍读的是快照（stateFromBranch）——
 * 症状就是「编辑无法保存」。故槽位必须挂 globalThis，与
 * `src/mcp.ts` 同一模式。
 *
 * 实证：原生实例注册回调后自调 → 执行；jiti 实例调用同名函数 → 无反应；
 * `native === viaJiti` 为 false。
 */

type SyncFn = () => void;

interface SyncSlot {
	panelSync: SyncFn | null;
	stateSync: SyncFn | null;
}

const SLOT_KEY = "__liyuanStorySync__";

function slot(): SyncSlot {
	const g = globalThis as typeof globalThis & { [SLOT_KEY]?: SyncSlot };
	if (!g[SLOT_KEY]) {
		g[SLOT_KEY] = { panelSync: null, stateSync: null };
	}
	return g[SLOT_KEY];
}

export function registerStoryPanelSync(fn: SyncFn | null): void {
	slot().panelSync = fn;
}

export function registerStoryStateSync(fn: SyncFn | null): void {
	slot().stateSync = fn;
}

/** 从磁盘收编剧情扩展的面板内存 + 树快照（无注册时 no-op） */
export function syncStoryPanelsFromDisk(): void {
	try {
		slot().panelSync?.();
	} catch {
		// 扩展未就绪时忽略；下轮 context 仍会从盘读
	}
}

/** 从磁盘收编剧情扩展的世界状态内存 + 树快照 */
export function syncStoryStateFromDisk(): void {
	try {
		slot().stateSync?.();
	} catch {
		// ignore
	}
}
