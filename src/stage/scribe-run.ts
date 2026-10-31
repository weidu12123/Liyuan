/**
 * 场记调度（PLAN-RP-HARNESS M3，R8 记账独占 + R9 叶守卫）。
 *
 * 定稿之后一次旁路调用：读【当前账本 + 本拍对白】→ 出 patch → applyPatch →
 * rp-state 快照落树。台上零世界写入工具，主演只通过正文（含状态栏）表达状态变化。
 *
 * 叶守卫：旁路调用是异步的，期间用户可能 swipe/rewind/切世界线。落树前核对叶位置，
 * 变了就整体丢弃本次记账——快照绝不能写到导航后的分支上（8/02 账本泄漏事故的结构性解法）。
 * 丢弃是安全的：账本 = f(分支)（R4），新分支自会从它自己的最近快照重建。
 *
 * 纯函数 + 注入依赖，零 pi 依赖、可单测。
 */

import { applyPatch, canonicalizeCharacterKeys, saveState } from "../state.ts";
import { buildScribeTurnPrompt, parseScribeResult } from "../scribe.ts";
import { applyMvuPatch } from "../mvu.ts";
import type { WorldState } from "../types.ts";

/** 场记快照的会话树条目类型（CustomEntry，不进 LLM 上下文） */
export const STATE_ENTRY_TYPE = "rp-state";

export interface ScribeRunDeps {
	/** 旁路文本调用：返回文本，或 {error} */
	sideText: (systemPrompt: string, userText: string) => Promise<string | { error: string }>;
	/** 记账落树（CustomEntry：data 存整份账本快照） */
	appendStateEntry: (state: WorldState) => void;
	/** 叶守卫读数：调用前后各取一次，不等则丢弃 */
	getLeafId: () => string | null;
	/** 磁盘缓存路径（.liyuan-state/<sessionId>.json）；给出则落盘（server fs.watch → state 帧） */
	stateFile?: string;
	onActivity?: (detail: string) => void;
}

interface ScribeRunInput {
	/** 本拍开演前的账本（= f(分支)） */
	state: WorldState;
	userText: string;
	/** 本拍定稿正文（补丁已套） */
	assistantText: string;
	charName: string;
	userName: string;
	/**
	 * MVU 卡的「变量更新规则」原文（卡作者所写，来自世界书条目）。
	 * 树本身在 state.mvu；给出规则让场记判断哪些值该动。非 MVU 卡不传。
	 */
	mvuRules?: string;
}

type ScribeRunOutcome =
	| { kind: "skipped"; reason: string }
	| { kind: "stale" }
	| { kind: "failed"; error: string }
	| { kind: "applied"; state: WorldState; applied: string[] };

/**
 * 一拍记账。调用方保证：只对干净收笔的台上拍调用（中断半拍/戏外轮不记账）。
 * 任何失败都只跳过本拍记账，不影响正文——账本滞后一拍可由下拍补上。
 */
export async function runScribeTurn(deps: ScribeRunDeps, input: ScribeRunInput): Promise<ScribeRunOutcome> {
	const { state, userText, assistantText, charName, userName, mvuRules } = input;
	if (!assistantText.trim()) return { kind: "skipped", reason: "no-text" };

	const leafBefore = deps.getLeafId();
	// MVU 卡（state.mvu 有树）才把树+规则喂给场记，让它连 mvu_patch 一起判断；非 MVU 卡 prompt 逐字如旧
	const mvu = state.mvu && typeof state.mvu === "object" ? { tree: state.mvu, rules: mvuRules } : undefined;
	// 声明了数据的活跃面板才进 prompt；一个都没有时 prompt 逐字如旧
	const panels = Object.entries(state.panelData ?? {})
		.filter(([, tree]) => tree && typeof tree === "object" && Object.keys(tree).length > 0)
		.map(([name, tree]) => ({ name, tree }));
	const prompt = buildScribeTurnPrompt({ state, userText, assistantText, charName, userName, mvu, panels });
	const resp = await deps.sideText(prompt.systemPrompt, prompt.userText);
	if (typeof resp !== "string") return { kind: "failed", error: resp.error };

	const parsed = parseScribeResult(resp);
	if (!parsed) {
		// 短响应直接给全文（多半是格式跑偏）；长响应给尾部（多半是 maxTokens 截断）
		const flat = resp.trim().replace(/\s+/g, " ");
		const detail = flat.length <= 400 ? flat : `…${flat.slice(-160)}`;
		return { kind: "failed", error: `输出不可解析（${resp.length} 字）：${detail}` };
	}
	// 三个补丁都空才算无变化——账本没动但树/面板动了也要记（如只是面板上的一个计数变了）
	const mvuHasChanges = !!parsed.mvuPatch && Object.keys(parsed.mvuPatch).length > 0;
	const panelHasChanges = !!parsed.panelPatch && Object.keys(parsed.panelPatch).length > 0;
	if (Object.keys(parsed.patch).length === 0 && !mvuHasChanges && !panelHasChanges) {
		return { kind: "skipped", reason: "empty-patch" };
	}

	// R9 叶守卫：调用期间树动过（swipe/rewind/切线）→ 整体丢弃
	if (deps.getLeafId() !== leafBefore) {
		deps.onActivity?.("记账已丢弃（本拍期间切换了分支）");
		return { kind: "stale" };
	}

	const knownNames = [charName, userName, ...Object.keys(state.characters)];
	const result = applyPatch(state, canonicalizeCharacterKeys(parsed.patch, knownNames));
	// MVU 树补丁：套进 result.state.mvu（applyPatch 已 structuredClone，改这份不碰入参 state）。
	// 判断在场记模型（给出 path→值），落值由 applyMvuPatch 死板执行——不碰任何卡方言。
	if (mvuHasChanges && result.state.mvu && typeof result.state.mvu === "object") {
		const mv = applyMvuPatch(result.state.mvu, parsed.mvuPatch!);
		result.state.mvu = mv.tree;
		result.applied.push(...mv.applied.map((a) => `mvu:${a}`));
	}
	// 面板数据补丁：同一套落值方式，只是按面板分桶。
	// **只更新已存在的面板**——场记凭空报一个面板名多半是幻觉，不给它建面板的权力。
	if (panelHasChanges) {
		const existing = result.state.panelData ?? {};
		const next: Record<string, Record<string, unknown>> = { ...existing };
		for (const [name, flat] of Object.entries(parsed.panelPatch!)) {
			const before = existing[name];
			if (!before || typeof before !== "object") continue;
			if (!flat || Object.keys(flat).length === 0) continue;
			const pv = applyMvuPatch(before, flat);
			next[name] = pv.tree;
			result.applied.push(...pv.applied.map((a) => `面板[${name}]:${a}`));
		}
		result.state.panelData = next;
	}
	deps.appendStateEntry(result.state);
	if (deps.stateFile) {
		try {
			saveState(deps.stateFile, result.state);
		} catch {
			// 缓存写失败不影响树上快照（账本权威在树，磁盘只是缓存）
		}
	}
	if (result.applied.length > 0) deps.onActivity?.(`记账 ${summarizeApplied(result.applied)}`);
	return { kind: "applied", state: result.state, applied: result.applied };
}

/** 过程条用的记账摘要：条数 + 前两条中文化字段名 */
function summarizeApplied(applied: string[]): string {
	const label = (s: string): string => {
		if (s.startsWith("time")) return "时间";
		if (s.startsWith("location")) return "地点";
		if (s.startsWith("characters.")) return s.slice("characters.".length).split(" ")[0];
		if (s.startsWith("flags.")) return s.slice("flags.".length).split(" ")[0];
		if (s.startsWith("inventory")) return "物品";
		if (s.startsWith("plot_threads")) return "剧情线";
		return s.split(" ")[0];
	};
	const names = [...new Set(applied.map(label))];
	const shown = names.slice(0, 3).join("、");
	return names.length > 3 ? `${shown} 等 ${names.length} 项` : shown;
}
