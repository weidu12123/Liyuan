/**
 * 卡档案 AGENTS.md（刀3，docs/PLAN-AGENT-SLOTS.md §七）：卡的常驻内容住进
 * `cards/<卡>/AGENTS.md`——卡四字段、card.systemPrompt、蓝灯常驻、postHistoryInstructions。
 *
 * 两态一判据（文件存在与否）：
 * - **存在 ⇒ 文件为准**：装配把文件整段顶替卡 sections（marker 材料同步让位，不双份）；
 *   卡作者是谁不重要了——文件是给「扮演 agent」读的常驻说明，人能改、agent 能维护。
 * - **不存在 ⇒ 维持今天的投影**（per-slot 兜底 + 蓝灯段，遗留预设的 marker 归位照旧），
 *   编辑器用横幅告知「当前是自动投影」，生成按钮把投影全文发给助手整理成文件。
 *
 * `projectCardToAgents` 是**投影全文**（无视 filledMarkers 的完整渲染）——它不是装配的
 * 投影路径（那条留在 assemble.ts 一字不动），它服务两处：前端「对照投影」diff 的基准、
 * 助手生成 AGENTS.md 的素材（harness 负责提取数据，模型负责取舍判断——状态栏版式保留、
 * 插件协议指令剔除，判断落成看得见的文件，铁律三）。
 *
 * 纯函数 + 零模块级可变状态（jiti 二相性红线），可单测。
 */
import type { CharacterCard, LorebookEntry, MacroContext, RpConfig } from "./types.ts";
import { applyMacros } from "./card.ts";
import { lorebookSourceSuffix, uniqueEntryName } from "./prompt-entries.ts";

/** 卡档案文件名（pi 生态通用名；住在卡文件夹根） */
export const CARD_AGENTS_FILE = "AGENTS.md";

export function cardAgentsPath(cardDir: string): string {
	return `${cardDir.replace(/[\\/]$/, "")}/${CARD_AGENTS_FILE}`;
}

export function projectCardToAgents(
	card: CharacterCard,
	constantLore: LorebookEntry[],
	config: RpConfig,
	opts: {
		/**
		 * 条目所属挂载书的标签（src/lorebook.ts bookOfEntries）。给了就把来源写进小节标题
		 * `## 标题（世界书·书名）`——档案建立后，条目引擎据此认来源、按挂载状态取舍。
		 */
		bookOf?: (entry: LorebookEntry) => string | undefined;
	} = {},
): string {
	const macro: MacroContext = { charName: card.name, userName: config.userName };
	const m = (s: string) => applyMacros(s, macro);
	const parts: string[] = [];

	parts.push(`# 你扮演的角色：${card.name}`);
	if (card.description) parts.push(m(card.description));
	if (card.personality) parts.push(`## 性格\n${m(card.personality)}`);
	if (card.scenario) parts.push(`## 当前场景\n${m(card.scenario)}`);
	if (card.mesExample) parts.push(`## 对白示例（仅供文风与语气参考，不是已发生的剧情）\n${m(card.mesExample)}`);
	if (card.systemPrompt) parts.push(`# 卡作者附加指令\n${m(card.systemPrompt)}`);

	if (constantLore.length > 0) {
		const used = new Set<string>();
		parts.push(
			`# 世界设定（常驻事实）\n${constantLore
				.map((e) => {
					const book = opts.bookOf?.(e);
					// 有来源书的条目必须有标题行——没有标题就没有条目，来源标注无处可挂
					const title = (e.comment || e.keys?.[0] || (book ? `条目 ${e.uid}` : "")).trim();
					if (book) {
						const entryText = `## ${uniqueEntryName(title, lorebookSourceSuffix(book), used)}\n${m(e.content)}`;
						return e.enabled === false ? `<!--\n${entryText}\n-->` : entryText;
					}
					const heading = title ? `## ${title}\n` : "";
					return `${heading}${m(e.content)}`;
				})
				.join("\n\n")}`,
		);
	}

	if (card.postHistoryInstructions) {
		parts.push(`# 卡作者末端指令\n${m(card.postHistoryInstructions)}`);
	}

	return parts.join("\n\n");
}
