/**
 * 会话文件的卡归属：整份读、取最后一条 `rp-card` 自描述条目。
 *
 * 为什么单独一个模块：这段扫描原先只活在 `server/main.ts`（`readSessionCard`，带 mtime 缓存），
 * 而解析活在 `server/wire.ts`。迁移器（`src/migrate-cards.ts`）要按卡给会话分组，也需要同一份
 * 判据——与其在 src/ 里再抄一遍（铁律三：不新增平行实现），不如把「怎么认一个会话属于哪张卡」
 * 收进一处。`server/wire.ts` 同名再导出，既有调用方不动。
 *
 * 为什么整份读：换卡 / 迁移 / 导入的重绑定行是 append 在当时的文件末尾的，会话继续长，
 * 这一行就漂到文件中部（issue #11：12MB 会话里标记在 36% 处，头尾各 64KB 的窗口读不到，
 * 头部旧卡路径生效，会话被列表静默过滤）。pi 的 `SessionManager.list` 本来就逐行整读每个
 * 会话文件，这里再整读一次、外加调用方的 mtime 缓存，成本不高于既有开销。
 */

import { readFileSync } from "node:fs";

export interface SessionCardInfo {
	/** 角色卡路径（写入时的原文，可能是相对/绝对、正反斜杠） */
	card: string;
	/** 卡显示名（写入时的快照，可能为空） */
	name: string;
	/** 绑定的剧情会话 id（助手会话对齐用） */
	storyId?: string;
}

/**
 * 从会话 JSONL 文本解析 `rp-card` 自描述条目（PLAN-PHASE3 §2.1）。
 * 取**最后一条**（换卡后会补写新标记；旧标记可能仍留在文件前部）。
 */
export function parseCardFromSessionHead(headText: string): SessionCardInfo | null {
	let found: SessionCardInfo | null = null;
	for (const line of headText.split(/\r?\n/)) {
		if (!line.includes('"rp-card"')) continue; // 快速跳过
		try {
			const e = JSON.parse(line) as {
				type?: unknown;
				customType?: unknown;
				data?: { card?: unknown; name?: unknown; storyId?: unknown };
			};
			if (e.type === "custom" && e.customType === "rp-card" && e.data && typeof e.data.card === "string") {
				found = {
					card: e.data.card,
					name: typeof e.data.name === "string" ? e.data.name : "",
					...(typeof e.data.storyId === "string" && e.data.storyId.trim()
						? { storyId: e.data.storyId.trim() }
						: {}),
				};
			}
		} catch {
			// 半行/损坏行跳过
		}
	}
	return found;
}

/** 这个会话文件属于哪张卡（认不出、读不到返回 null） */
export function readSessionCardInfo(path: string): SessionCardInfo | null {
	let text = "";
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return null;
	}
	return text ? parseCardFromSessionHead(text) : null;
}
