/**
 * ST 式回复变体（swipe）：在同一条用户消息下，会话树里并列的多条子树。
 *
 * 语义（与世界线解耦）：
 * - 仅树指针切换 + 再生成，不写 /store，不产生世界线分叉。
 * - LLM 只看当前 leaf→根路径（SessionManager.buildSessionContext），故 agent 永远只见最终选中的变体。
 * - 世界线分叉仍只在「回档后再走出不同路并 /store」时发生（见 worldline.ts）。
 *
 * 本文件零 pi 依赖，可单测。
 */

export interface SwipeEntry {
	id: string;
	parentId: string | null;
	type: string;
	/** message 条目上的 role */
	role?: string;
	/** custom_message / message.customType */
	customType?: string;
	timestamp?: string;
}

export interface SwipeVariant {
	/** 用户消息的直接子节点（该变体子树根） */
	rootId: string;
	/** 该变体子树当前应导航到的叶（优先当前 leaf 所在路径，否则时间最新叶） */
	leafId: string;
}

/** 是否可作为「角色回复变体」的子树根（挂在 user 下的 sibling） */
export function isReplyVariantRoot(e: SwipeEntry): boolean {
	if (e.type === "message") {
		if (e.role === "assistant") return true;
		// 用户手改回复 / 偶发挂在 user 下的 custom 展示
		if (e.role === "custom" && (e.customType === "rp-edited-reply" || e.customType === "rp-greeting")) {
			return true;
		}
		return false;
	}
	// pi custom_message 条目（appendCustomMessageEntry）
	if (e.type === "custom_message") {
		return e.customType === "rp-edited-reply" || e.customType === "rp-greeting" || !e.customType;
	}
	return false;
}

const byTime = (a: SwipeEntry, b: SwipeEntry) => {
	const ta = a.timestamp ?? "";
	const tb = b.timestamp ?? "";
	if (ta !== tb) return ta < tb ? -1 : 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

export function childrenOf(entries: SwipeEntry[], parentId: string | null): SwipeEntry[] {
	return entries.filter((e) => e.parentId === parentId).sort(byTime);
}

/** 从 root 出发的子树内所有 id（含 root） */
export function subtreeIds(entries: SwipeEntry[], rootId: string): Set<string> {
	const kids = new Map<string | null, SwipeEntry[]>();
	for (const e of entries) {
		const list = kids.get(e.parentId) ?? [];
		list.push(e);
		kids.set(e.parentId, list);
	}
	const out = new Set<string>();
	const stack = [rootId];
	while (stack.length) {
		const id = stack.pop()!;
		if (out.has(id)) continue;
		out.add(id);
		for (const c of kids.get(id) ?? []) stack.push(c.id);
	}
	return out;
}

/**
 * 变体子树应导航到的 leaf：
 * - 若 currentLeaf 在该子树内，用 currentLeaf（保持用户在该变体内的位置）
 * - 否则取子树中「无子节点」的节点里时间最新的一个；若都有子则取时间最新节点
 */
export function leafOfVariant(entries: SwipeEntry[], rootId: string, currentLeaf: string | null): string {
	const ids = subtreeIds(entries, rootId);
	if (currentLeaf && ids.has(currentLeaf)) return currentLeaf;

	const inTree = entries.filter((e) => ids.has(e.id));
	const hasChild = new Set(inTree.map((e) => e.parentId).filter((p): p is string => !!p && ids.has(p)));
	// parentId 在子树内 ⇒ 该 parent 有子；leaf = 子树内且没有任何子树内 child 的节点
	const childParent = new Set<string>();
	for (const e of inTree) {
		if (e.parentId && ids.has(e.parentId)) childParent.add(e.parentId);
	}
	const leaves = inTree.filter((e) => !childParent.has(e.id));
	const pool = leaves.length > 0 ? leaves : inTree;
	pool.sort(byTime);
	return pool[pool.length - 1]?.id ?? rootId;
}

/** 某用户消息下的全部回复变体（按时间序 = swipe 序号） */
export function listReplyVariants(
	entries: SwipeEntry[],
	userEntryId: string,
	currentLeaf: string | null,
): SwipeVariant[] {
	const roots = childrenOf(entries, userEntryId).filter(isReplyVariantRoot);
	return roots.map((r) => ({
		rootId: r.id,
		leafId: leafOfVariant(entries, r.id, currentLeaf),
	}));
}

/** 当前 leaf 落在哪一个变体；不在则 -1 */
export function currentVariantIndex(variants: SwipeVariant[], currentLeaf: string | null, entries: SwipeEntry[]): number {
	if (!currentLeaf || variants.length === 0) return -1;
	for (let i = 0; i < variants.length; i++) {
		const ids = subtreeIds(entries, variants[i].rootId);
		if (ids.has(currentLeaf)) return i;
	}
	return -1;
}

/**
 * 从当前分支条目中找「最后一条剧情用户消息」的 entry id。
 * branch 为 getBranch() 根→叶序；isBackstage 由调用方提供（戏外轮不参与 swipe）。
 */
export function lastStoryUserEntryId(
	branch: Array<{ id: string; type: string; role?: string; text?: string }>,
	isBackstage: (text: string) => boolean,
): string | null {
	for (let i = branch.length - 1; i >= 0; i--) {
		const e = branch[i];
		if (e.type !== "message" || e.role !== "user") continue;
		if (isBackstage(e.text ?? "")) continue;
		return e.id;
	}
	return null;
}

export interface SwipeMeta {
	/** 0-based */
	index: number;
	total: number;
	/** 变体导航用：父用户消息 entry id */
	userEntryId: string;
	/** 各变体 leaf id（与 index 对齐） */
	leafIds: string[];
}

/** 给当前分支上「紧跟某用户消息的那条角色展示」挂上 swipe 元数据时用 */
export function swipeMetaForUser(
	entries: SwipeEntry[],
	userEntryId: string,
	currentLeaf: string | null,
): SwipeMeta | null {
	const variants = listReplyVariants(entries, userEntryId, currentLeaf);
	if (variants.length === 0) {
		// 尚无回复：total=0，UI 仍可点「右」生成第一条
		return { index: 0, total: 0, userEntryId, leafIds: [] };
	}
	let idx = currentVariantIndex(variants, currentLeaf, entries);
	if (idx < 0) idx = variants.length - 1;
	return {
		index: idx,
		total: variants.length,
		userEntryId,
		leafIds: variants.map((v) => v.leafId),
	};
}
