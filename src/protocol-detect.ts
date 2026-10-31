/**
 * 外部插件协议识别（PLAN-RP-AGENT-EXEC M-C2 / docs/PRESET-SPLIT-TAXONOMY.md H 类）。
 *
 * 酒馆生态里，卡与世界书常自带**第三方插件协议**：一段提示词要求模型
 * 「回复末尾必须输出 <UpdateVariable> + JSON Patch」之类，指望酒馆装了对应插件去解析。
 * 梨园没有这些解析器——梨园是 agent 直接调 world_state_update 记账。于是模型每拍
 * 收到两条互斥强制令（协议「必须输出」vs draft_write「纯剧情文字」），后果实测三条：
 * 首拍 31% 思考（纠结听谁 + 手写 Patch）、正文污染（落树带 <UpdateVariable> 块，
 * 无人消费）、双份记账。这与预设里的 H 类「脑内 harness」是同一种东西——
 * **梨园原生机制已覆盖其功能，故整体退场**。
 *
 * 与 preset-split 的分工：preset-split 管**预设通道**（块名→拆层表，手工校准）；
 * 本模块管**世界书/卡内嵌通道**（无块名可依，按内容签名识别，任意社区卡通解）。
 *
 * 判定纪律（实测校准，2026-08-04 全 10 本世界书 + 9 张卡扫描）：
 *   - **多签名共现**才判死：真协议条目命中 2~8 个信号，正常设定条目命中 0 个；
 *     但单签名（如 stat_data、「每次回复必须」）在正常设定里也可能出现，单独不足为凭。
 *   - 标题带 `[mvu_update]` 这类**插件自己的命名约定**是强信号，可单独成立。
 *   - **整条退场，不做逐行摘**：原型验证过逐行摘协议行，某世界书 uid227/229 摘完仍剩 63%
 *     且剩的还是协议（YAML 式协议的结构语义跨行，行级判据抓不住）。而 MVU 条目里的
 *     数值表/境界表在该书**另有专条常驻**（境界 #10 / 具体数值 #17 / 灵根 #18），
 *     整条丢不损失设定。宁可漏判（留着＝现状），不可误判（丢真设定）。
 *
 * 纯函数 + 常量表，零模块级可变状态（jiti 二象性红线），可单测。
 */

/** 一条协议签名：命中即计一票 */
interface ProtocolSignal {
	id: string;
	re: RegExp;
	/** 强信号：单独命中即可判定（插件专属命名，正常设定不会出现） */
	strong?: boolean;
}

/**
 * 协议家族。新增家族＝往这里加一组签名——判定逻辑不必改。
 * 每条签名的注释写清「为什么它不会误伤正常世界观内容」。
 */
interface ProtocolFamily {
	/** 家族标识，进装配报告 */
	key: string;
	/** 人类可读名（报告与日志） */
	label: string;
	signals: ProtocolSignal[];
}

const PROTOCOL_FAMILIES: ProtocolFamily[] = [
	{
		key: "mvu",
		label: "MVU 变量插件",
		signals: [
			// 插件专属标签：正常世界观不会要求输出这些标签
			{ id: "tag:UpdateVariable", re: /<\s*\/?\s*UpdateVariable\s*>/i, strong: true },
			{ id: "tag:JSONPatch", re: /<\s*\/?\s*JSONPatch\s*>/i, strong: true },
			{ id: "name:mvu_update", re: /\[\s*mvu_update\s*\]/i, strong: true },
			// 插件宏：酒馆前端消费的变量宏
			{ id: "macro:message_variable", re: /\{\{\s*(get|set|format)_message_variable\s*::/i, strong: true },
			{ id: "tag:status_current_variables", re: /<\s*\/?\s*status_current_variables\s*>/i, strong: true },
			// 以下为弱信号：单独可能出现在正常内容里，需与他者共现
			{ id: "tag:Analysis", re: /<\s*\/?\s*Analysis\s*>/i },
			{ id: "rfc6902", re: /RFC\s*6902|JSON\s*Patch|JSONPatch/i },
			{ id: "op:verbs", re: /"?\bop"?\s*[:：]\s*"?(replace|delta|insert|remove|move)\b/i },
			{ id: "op:path", re: /"path"\s*[:：]|\bpath\b.{0,24}leading slash/i },
			{ id: "var:stat_data", re: /\bstat_data\b/i },
			{ id: "mandate:endOfReply", re: /(inserted?\s+to\s+the\s+end\s+of\s+reply|cannot\s+be\s+omitted|output\s+the\s+update\s+(analysis|commands))/i },
			{ id: "mvu:word", re: /\bMVU\b/ },
		],
	},
	{
		key: "tabledb",
		label: "SP·数据库/表格插件",
		signals: [
			{ id: "tag:tableEdit", re: /<\s*\/?\s*tableEdit\s*>/i, strong: true },
			{ id: "tag:tableEdit-fn", re: /\b(insertRow|updateRow|deleteRow)\s*\(/, strong: true },
			{ id: "db:TavernDB", re: /TavernDB|AutoCardUpdater/i, strong: true },
			{ id: "db:mandate", re: /(每次回复|回复末尾).{0,20}(表格|table)/i },
		],
	},
];

/** 一条内容的协议判定结果 */
interface ProtocolVerdict {
	/** 命中的家族 key；null＝不是协议 */
	family: string | null;
	label?: string;
	/** 命中的信号 id（报告/日志用，便于事后核对为什么判死） */
	signals: string[];
}

const NO_HIT: ProtocolVerdict = { family: null, signals: [] };

/**
 * 判一段内容（世界书条目正文、卡字段等）是否为外部插件协议。
 * 门槛：**任一强信号** 或 **≥2 个信号共现**。title 参与判定（插件常在标题打自己的标记）。
 */
export function detectProtocol(content: string, title = ""): ProtocolVerdict {
	if (!content || !content.trim()) return NO_HIT;
	const text = `${title}\n${content}`;
	for (const family of PROTOCOL_FAMILIES) {
		const hits = family.signals.filter((s) => s.re.test(text));
		if (hits.length === 0) continue;
		const strong = hits.some((h) => h.strong);
		if (strong || hits.length >= 2) {
			return { family: family.key, label: family.label, signals: hits.map((h) => h.id) };
		}
	}
	return NO_HIT;
}

/** 便捷判定（不关心命中细节时用） */
export const isProtocolContent = (content: string, title = ""): boolean => detectProtocol(content, title).family !== null;

/** 被判死的条目记录（进装配报告 / 日志） */
export interface ProtocolDrop {
	/** 条目标题（comment 或首个关键词） */
	title: string;
	/** 来源通道 */
	channel: "lorebook" | "card";
	chars: number;
	family: string;
	label: string;
	signals: string[];
}

interface LoreLike {
	uid: number;
	comment: string;
	keys: string[];
	content: string;
	enabled: boolean;
}

/**
 * 从条目集合里剔除协议条目（不修改原数组）。
 * 返回过滤后的条目 + 被剔除者的记录。已 disabled 的条目不重复记账。
 */
export function stripProtocolEntries<T extends LoreLike>(
	entries: T[],
	channel: "lorebook" | "card" = "lorebook",
): { entries: T[]; dropped: ProtocolDrop[] } {
	const kept: T[] = [];
	const dropped: ProtocolDrop[] = [];
	for (const e of entries) {
		if (!e.enabled) {
			kept.push(e);
			continue;
		}
		const v = detectProtocol(e.content, e.comment);
		if (!v.family) {
			kept.push(e);
			continue;
		}
		dropped.push({
			title: e.comment || e.keys?.[0] || `uid${e.uid}`,
			channel,
			chars: e.content.length,
			family: v.family,
			label: v.label ?? v.family,
			signals: v.signals,
		});
		// 退场＝置 enabled false：constant 注入、关键词激活、lorebook_search 三条通道
		// 都尊重 enabled，一处置死全线生效（与 applyDisabledLore 同机制）。
		kept.push({ ...e, enabled: false });
	}
	return { entries: kept, dropped };
}
