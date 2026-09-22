/**
 * 长局压缩（PLAN-RP-HARNESS M4，R3 上下文 = f(分支)）。
 *
 * 台上引擎自管压缩：攒够 N 拍就把早期剧情交给旁路模型写一份接力摘要，
 * 落 rp-summary 快照（CustomEntry）；装配时 rebuildHistory 读回为【前情提要】，
 * 被覆盖的条目整段不进上下文——裁剪不是「减法」，而是装配时就不存在。
 *
 * 为什么不再用 session.compact()：旧路径压的是 pi 的 AgentSession 消息副本，
 * 看不全引擎写进树的东西（rp-draft-op 补丁、rp-state 快照、引擎直落的 assistant），
 * 于是长局压不动。压缩权跟着上下文权走——谁装配，谁压缩。
 *
 * 三条纪律：
 * - **保留最近 K 拍原文**：摘要只接早期剧情，续演点仍是逐字的近拍（防剧情倒退，契约 §5）；
 * - **合并旧摘要**：每次把上一份摘要并进新摘要，故分支上永远只有「最后一条摘要」生效；
 * - **叶守卫（R9）**：旁路调用期间 swipe/rewind 则整体丢弃——摘要绝不能落到导航后的分支上。
 *
 * 被裁正文在落摘要前**完整归档进剧情库**（memory_search 可召回细节）：
 * 摘要管连续性，归档管细节，两者互补。
 */

import {
	rebuildHistory,
	activeSummary,
	SUMMARY_ENTRY_TYPE,
	type BranchEntryLike,
	type RpSummaryData,
} from "./assemble.ts";
import { buildRpSummaryPrompt } from "../scribe.ts";
import { formatState } from "../state.ts";
import { applyDraftRevisions } from "./draft-projection.ts";
import { listStoryFiles } from "./story-history.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { storyBranch } from "../conversation-mode.ts";
import type { WorldState } from "../types.ts";

export { SUMMARY_ENTRY_TYPE };
export type { RpSummaryData };

/** 压缩后原样保留的最近拍数（续演点必须逐字，摘要只接更早的剧情） */
export const KEEP_RECENT_BEATS = 6;

/** 可裁正文的字数地板：低于此值不值得烧一次旁路调用（自动压缩用） */
export const MIN_COMPACT_CHARS = 2000;

/**
 * 手动压缩（/compact）的字数地板。用户明确点了压缩，就不该拿「攒得还不够多」
 * 把人挡回去——只要真有可裁的早期剧情就压。仍留一个下限：几百字的开局压了等于没压。
 */
export const MANUAL_MIN_COMPACT_CHARS = 500;

export interface CompactPlan {
	/** 覆盖到此条目为止（含）——装配时该条及之前不进历史 */
	coversThroughId: string;
	/** 待摘要的条目（已按分支顺序；agent 模式为空——正文在文件里） */
	covered: BranchEntryLike[];
	/** agent 模式：摘要落地后覆盖的全部文件名（含更早摘要已覆盖的） */
	coveredFiles?: string[];
	/** 覆盖的叙事拍数（用户消息条数） */
	turns: number;
	/** 序列化后的待摘要正文 */
	conversationText: string;
	/** 更早剧情的既有摘要（合并进本次摘要） */
	previousSummary?: string;
}

export interface PlanCompactionOptions {
	/** 每 N 个叙事拍压缩一次；<=0 关闭 */
	everyNTurns: number;
	userName: string;
	charName: string;
	/** 保留最近拍数（缺省 KEEP_RECENT_BEATS） */
	keepRecentBeats?: number;
	/** 可裁正文字数地板（缺省 MIN_COMPACT_CHARS） */
	minChars?: number;
	/** 稿子目录（agent 模式，docs/PLAN-AGENT-CODING.md §七）：单位从「拍」换成「文件」，正文从文件读 */
	storyDir?: string;
}

/**
 * 序列化待摘要区间为对话文本。走 rebuildHistory 同一条路：
 * 补丁已套、过程条目不存在——摘要读到的与模型当时读到的是同一份正文。
 *
 * 先剔掉区间内的摘要条目：二次压缩时，上一份 rp-summary 会落在待摘要区间内，
 * 而它的 coversThroughId 指向的条目早已被裁走——rebuildHistory 找不到锚点便退守到
 * 「摘要条目之前全裁」，反而把本次要摘的正文全丢了。旧摘要的内容不靠这条路带回，
 * 由 previousSummary 单独入提示词。
 */
export function serializeForSummary(entries: BranchEntryLike[], userName: string, charName: string): string {
	const bodyOnly = entries.filter(
		(e) => e.type !== "compaction" && !(e.type === "custom" && e.customType === SUMMARY_ENTRY_TYPE),
	);
	const { history } = rebuildHistory(bodyOnly);
	return history.map((m) => `${m.role === "user" ? userName : charName}：${m.text}`).join("\n\n");
}

/**
 * 压缩判定 + 切点计算（纯函数）。
 * 触发条件：分支上「活着的」叙事拍数 ≥ 保留拍数 + 周期，且可裁正文够长。
 * 返回 null = 本拍不压缩。
 */
export function planCompaction(branch: BranchEntryLike[], opts: PlanCompactionOptions): CompactPlan | null {
	if (opts.storyDir !== undefined) return planFileCompaction(branch, opts, opts.storyDir);
	branch = applyDraftRevisions(storyBranch(branch), { omitEditRequests: true });
	const keep = opts.keepRecentBeats ?? KEEP_RECENT_BEATS;
	const minChars = opts.minChars ?? MIN_COMPACT_CHARS;
	if (!Number.isFinite(opts.everyNTurns) || opts.everyNTurns <= 0) return null;

	// 已被上一份摘要覆盖的前缀不再参与
	const active = activeSummary(branch);
	const live = active ? branch.slice(active.cut) : branch;

	// 拍的边界 = 用户消息；最近 keep 拍原样保留
	const beatStarts: number[] = [];
	for (let i = 0; i < live.length; i++) {
		const e = live[i];
		if (e.type === "message" && e.message?.role === "user") beatStarts.push(i);
	}
	if (beatStarts.length < keep + opts.everyNTurns) return null;

	const cutAt = beatStarts[beatStarts.length - keep];
	if (cutAt <= 0) return null;
	const covered = live.slice(0, cutAt);
	const coversThroughId = covered[covered.length - 1]?.id;
	if (!coversThroughId) return null; // 无 id 的条目（异常树）不敢下刀

	const conversationText = serializeForSummary(covered, opts.userName, opts.charName);
	if (conversationText.length < minChars) return null;

	return {
		coversThroughId,
		covered,
		turns: beatStarts.length - keep,
		conversationText,
		...(active ? { previousSummary: active.summary } : {}),
	};
}

/**
 * agent 模式（docs/PLAN-AGENT-CODING.md §七）：单位是文件不是拍。上下文里没有正文，「到期」＝按文件名序排在最后
 * keep 个文件之外、且还没被摘要覆盖过的正文攒够字数。摘要条目记 coveredFiles（文件名）；改名/新插的文件不在
 * 名单里就重新算活的（多摘一次不丢）。coversThroughId 取分支末条，只为满足 activeSummary 的锚点。
 */
function planFileCompaction(branch: BranchEntryLike[], opts: PlanCompactionOptions, storyDir: string): CompactPlan | null {
	const keep = opts.keepRecentBeats ?? KEEP_RECENT_BEATS;
	const minChars = opts.minChars ?? MIN_COMPACT_CHARS;
	if (!Number.isFinite(opts.everyNTurns) || opts.everyNTurns <= 0) return null;

	const active = activeSummary(branch);
	const coveredNames = new Set(latestCoveredFiles(branch));
	const files = listStoryFiles(storyDir);
	const candidates = files.slice(0, Math.max(0, files.length - keep)).filter((f) => !coveredNames.has(f.name));
	if (!candidates.length) return null;

	const parts: string[] = [];
	for (const f of candidates) {
		try { parts.push(`${f.name}\n\n${readFileSync(join(storyDir, f.name), "utf8")}`); } catch { continue; }
	}
	const conversationText = parts.join("\n\n");
	if (conversationText.length < minChars) return null;

	const last = branch[branch.length - 1];
	if (!last?.id) return null;
	return {
		coversThroughId: last.id,
		covered: [],
		coveredFiles: [...coveredNames, ...candidates.map((f) => f.name)],
		turns: candidates.length,
		conversationText,
		...(active ? { previousSummary: active.summary } : {}),
	};
}

function latestCoveredFiles(branch: BranchEntryLike[]): string[] {
	for (let i = branch.length - 1; i >= 0; i--) {
		const e = branch[i]!;
		if (e.type !== "custom" || e.customType !== SUMMARY_ENTRY_TYPE) continue;
		const d = e.data as Partial<RpSummaryData> | undefined;
		return Array.isArray(d?.coveredFiles) ? d.coveredFiles.filter((x): x is string => typeof x === "string") : [];
	}
	return [];
}

export interface CompactRunDeps {
	/** 旁路文本调用：返回文本，或 {error} */
	sideText: (systemPrompt: string, userText: string) => Promise<string | { error: string }>;
	/** 摘要落树（CustomEntry：不进 pi 上下文，装配由引擎自管） */
	appendSummaryEntry: (data: RpSummaryData) => void;
	/** 叶守卫读数：调用前后各取一次，不等则丢弃 */
	getLeafId: () => string | null;
	/** 被裁正文归档进剧情库（供 memory_search 召回细节）；失败只丢召回能力 */
	archive?: (text: string) => Promise<void>;
	onActivity?: (detail: string) => void;
}

export interface CompactRunInput {
	branch: BranchEntryLike[];
	state: WorldState;
	language: string;
	userName: string;
	charName: string;
	everyNTurns: number;
	keepRecentBeats?: number;
	minChars?: number;
	/** 稿子目录（agent 模式；给了就按文件计划） */
	storyDir?: string;
}

export type CompactOutcome =
	| { kind: "skipped"; reason: string }
	| { kind: "stale" }
	| { kind: "failed"; error: string }
	| { kind: "compacted"; summary: string; turns: number; chars: number };

/**
 * 一次压缩。任何失败都只跳过本次压缩，不影响正文——下一拍会再判一次。
 * 调用方保证：只对干净收笔的台上拍调用（中断半拍/戏外轮不压缩）。
 */
export async function runCompaction(deps: CompactRunDeps, input: CompactRunInput): Promise<CompactOutcome> {
	const plan = planCompaction(input.branch, {
		everyNTurns: input.everyNTurns,
		userName: input.userName,
		charName: input.charName,
		keepRecentBeats: input.keepRecentBeats,
		minChars: input.minChars,
		...(input.storyDir !== undefined ? { storyDir: input.storyDir } : {}),
	});
	if (!plan) return { kind: "skipped", reason: "not-due" };

	const leafBefore = deps.getLeafId();
	deps.onActivity?.(`正在压缩前情（${plan.turns} 拍 · ${plan.conversationText.length} 字）…`);

	const prompt = buildRpSummaryPrompt({
		conversationText: plan.conversationText,
		stateSnapshot: formatState(input.state),
		previousSummary: plan.previousSummary,
		language: input.language,
		userName: input.userName,
	});
	const resp = await deps.sideText(prompt.systemPrompt, prompt.userText);
	if (typeof resp !== "string") return { kind: "failed", error: resp.error };
	const summary = resp.trim();
	if (!summary) return { kind: "failed", error: "摘要为空" };

	// R9 叶守卫：调用期间树动过（swipe/rewind/切线）→ 整体丢弃
	if (deps.getLeafId() !== leafBefore) {
		deps.onActivity?.("压缩已丢弃（本拍期间切换了分支）");
		return { kind: "stale" };
	}

	// 归档先于落摘要：正文一旦被摘要覆盖就不再进上下文，细节只能靠剧情库召回
	if (deps.archive) {
		try {
			await deps.archive(plan.conversationText);
		} catch {
			// 归档失败不挡压缩（只丢细节召回能力，连续性仍由摘要保底）
		}
	}

	deps.appendSummaryEntry({
		summary,
		coversThroughId: plan.coversThroughId,
		turns: plan.turns,
		chars: plan.conversationText.length,
		...(plan.coveredFiles ? { coveredFiles: plan.coveredFiles } : {}),
	});
	deps.onActivity?.(`前情已压缩：${plan.turns} 拍 ${plan.conversationText.length} 字 → 摘要 ${summary.length} 字`);
	return { kind: "compacted", summary, turns: plan.turns, chars: plan.conversationText.length };
}
