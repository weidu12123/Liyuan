/**
 * 世界书协议判定（刀4，docs/PLAN-AGENT-SLOTS.md §六解法 1）：运行时正则退场，
 * 装配只执行**判定数据**——每本书旁边一份 `<书名>.判定.json`，人能读能改能删。
 *
 * 判定文件由两个时机产出（正则降级为数据生产工具，不再每拍隐形跑）：
 * - 导入时（lorebooks/import、卡内嵌书导入）自动跑一遍 detectProtocol 落盘
 * - 手动（POST /api/lorebooks/declare）：重新检查/重新生成
 *
 * 没有判定文件的书 ⇒ **不过滤**：没有数据就没有动作，不做隐形兜底——
 * 手工把文件拷进 assets/lorebooks 的用户自己负责补一次判定（书单里可见状态）。
 * 模型判断（解法 2）已在卡档案生成路径就位（刀3）；此处保持确定性判断，
 * 未来导入端点换模型声明时只改 writeDeclaration 的生产者，消费者不动。
 *
 * stripMvuRuleEntries 不在此列：它的判据是**归属**（场记的变量规则），不是作者措辞。
 *
 * 纯函数 + 零模块级可变状态（jiti 二相性红线），可单测。
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { detectProtocol, type ProtocolDrop } from "./protocol-detect.ts";
import { loadLorebookFile } from "./lorebook.ts";
import type { LorebookEntry } from "./types.ts";

/** 判定文件后缀：挂在书文件旁边（`<书名>.json` → `<书名>.json.判定.json`） */
const DECLARATION_SUFFIX = ".判定.json";

export function declarationPathFor(bookPath: string): string {
	return `${bookPath}${DECLARATION_SUFFIX}`;
}

/** 判定文件里的单条记录 */
interface DeclarationEntry {
	uid: number;
	title: string;
	chars: number;
	family: string;
	label: string;
	signals: string[];
}

interface LorebookDeclaration {
	version: 1;
	declaredAt: string;
	/** 判定依据（生产方式），报告用 */
	method: string;
	entries: DeclarationEntry[];
}

export function readDeclaration(bookPath: string): LorebookDeclaration | null {
	const file = declarationPathFor(bookPath);
	if (!existsSync(file)) return null;
	try {
		const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<LorebookDeclaration>;
		if (raw?.version !== 1 || !Array.isArray(raw.entries)) return null;
		return raw as LorebookDeclaration;
	} catch {
		return null;
	}
}

/**
 * 应用判定：命中 uid 的条目置 enabled:false（与用户停用同一效果——
 * constant 注入、关键词激活、lorebook_search 三条通道一致让位）。
 * 判定为空/文件缺失 ⇒ 原样返回（没有数据就没有动作）。
 */
export function applyDeclarations(
	entries: LorebookEntry[],
	declaration: LorebookDeclaration | null,
): { entries: LorebookEntry[]; dropped: ProtocolDrop[] } {
	if (!declaration || declaration.entries.length === 0) return { entries, dropped: [] };
	const declared = new Map(declaration.entries.map((d) => [d.uid, d]));
	const kept: LorebookEntry[] = [];
	const dropped: ProtocolDrop[] = [];
	for (const e of entries) {
		const hit = declared.get(e.uid);
		if (!hit || !e.enabled) {
			kept.push(e);
			continue;
		}
		dropped.push({
			title: e.comment || e.keys?.[0] || `uid${e.uid}`,
			channel: "lorebook",
			chars: e.content.length,
			family: hit.family,
			label: hit.label,
			signals: hit.signals,
		});
		kept.push({ ...e, enabled: false });
	}
	return { entries: kept, dropped };
}

/**
 * 产出一本书的判定文件（确定性正则判断；生产者可换成模型声明，见模块头注）。
 * 返回落盘的判定；书不存在/无可判条目时返回 null（不产出空文件）。
 */
export function writeDeclarationFromDetection(bookPath: string): LorebookDeclaration | null {
	if (!existsSync(bookPath)) return null;
	const entries = loadLorebookFile(bookPath);
	const hits: DeclarationEntry[] = [];
	for (const e of entries) {
		if (!e.enabled) continue;
		const v = detectProtocol(e.content ?? "", e.comment ?? "");
		if (!v.family) continue;
		hits.push({
			uid: e.uid,
			title: e.comment || e.keys?.[0] || `uid${e.uid}`,
			chars: (e.content ?? "").length,
			family: v.family,
			label: v.label ?? v.family,
			signals: v.signals,
		});
	}
	if (hits.length === 0) return null;
	const declaration: LorebookDeclaration = {
		version: 1,
		declaredAt: new Date().toISOString(),
		method: "detect-protocol@import",
		entries: hits,
	};
	writeFileSync(declarationPathFor(bookPath), `${JSON.stringify(declaration, null, "\t")}\n`, "utf8");
	return declaration;
}

/** 删除判定（用户改判的退路）：删掉文件即回到「不过滤」 */
export function removeDeclaration(bookPath: string): void {
	const file = declarationPathFor(bookPath);
	if (existsSync(file)) unlinkSync(file);
}
