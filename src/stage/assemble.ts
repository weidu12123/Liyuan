/**
 * 台上装配器（PLAN-RP-HARNESS M1）——旧 director.ts 的转世。
 *
 * 职责：把「当前分支 + 素材」装配成一次 LLM 调用的完整上下文。
 * - system prompt 会话内字节稳定（R3，利于前缀缓存）；动态内容全走末端注入
 * - 历史 = f(分支)：往拍只留定稿正文（补丁已套、工具痕迹不存在），过程不进历史
 * - 世界状态 = f(分支)：从 rp-state 快照重建（R4）
 *
 * M3 起台上有三件只读检索工具（lorebook_search / memory_search / world_state_get），
 * 提示词在此声明用法纪律；写入类工具仍然没有（记账归场记独占，R8）。
 * 本模块纯函数、零 pi 依赖、可单测。
 */

import { applyMacros } from "../card.ts";
import { applyCardSkin } from "../cardSkin.ts";
import { applyDraftOps, type DraftMsgLike } from "../draft.ts";
import { cleanAssistantText } from "../postprocess.ts";
import { formatState, defaultState } from "../state.ts";
import { isBackstageText } from "../stance.ts";
import { storyBranch } from "../conversation-mode.ts";
import type { DisplayRule } from "../cardfront.ts";
import { hasDepthLimits, rulesAtDepth } from "../cardfront.ts";
import type { CharacterCard, LorebookEntry, MacroContext, RpConfig, WorldState } from "../types.ts";
import type { UserRules } from "../user-rules.ts";

// ---------------- 分支 → 历史 ----------------

/** 会话树条目的结构子集（不引 @liyuan/agent-runtime 类型，保持 src/ 独立） */
export interface BranchEntryLike {
	/** 树上条目 id（前情摘要用它锚定「覆盖到哪」） */
	id?: string;
	type?: string;
	customType?: string;
	content?: unknown;
	data?: unknown;
	display?: boolean;
	message?: { role?: string; content?: unknown; stopReason?: string; details?: Record<string, unknown> };
}

/** 装配产物里的一条历史消息（引擎再转 @liyuan/ai Message） */
export interface BeatMsg {
	role: "user" | "assistant";
	text: string;
}

const textOf = (content: unknown): string => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((p) =>
			p && typeof p === "object" && (p as { type?: unknown }).type === "text"
				? String((p as { text?: unknown }).text ?? "")
				: "",
		)
		.join("");
};

/** 叙事向 custom 消息 → 历史角色映射；不在表内的 custom 不进送模流 */
const CUSTOM_AS_ASSISTANT = new Set(["rp-greeting", "rp-edited-reply"]);
const CUSTOM_AS_USER = new Set(["rp-import"]);

export interface RebuiltHistory {
	history: BeatMsg[];
	/** 最后一条用户消息原文（postHistory 宏 / 求方向判定用） */
	lastUserText: string;
	/** 最后一条台上叙事文本（语言自愈检测源；开场白计入，幕后轮的回复不计） */
	lastNarrativeText: string;
	/** 前情提要：被摘要覆盖的早期剧情（rp-summary / 旧 compaction 条目）；无则 undefined */
	summary?: string;
}

/** 前情摘要的会话树条目类型（CustomEntry：不进 pi 上下文，装配由台上引擎自管） */
export const SUMMARY_ENTRY_TYPE = "rp-summary";

/** rp-summary 条目的 data 形状 */
export interface RpSummaryData {
	/** 接力摘要正文（已合并更早的摘要） */
	summary: string;
	/** 覆盖到哪条为止（含）——该条及其之前的条目不再进历史 */
	coversThroughId: string;
	/** 本次摘要覆盖的叙事拍数（过程条用） */
	turns?: number;
	/** 被摘要替换的原文字数（过程条用） */
	chars?: number;
	/** agent 模式：本摘要覆盖的稿子文件名（docs/PLAN-AGENT-CODING.md §七） */
	coveredFiles?: string[];
}

const summaryDataOf = (e: BranchEntryLike): RpSummaryData | null => {
	if (e.type !== "custom" || e.customType !== SUMMARY_ENTRY_TYPE) return null;
	const d = e.data as Partial<RpSummaryData> | undefined;
	if (!d || typeof d !== "object") return null;
	if (typeof d.summary !== "string" || !d.summary.trim()) return null;
	if (typeof d.coversThroughId !== "string" || !d.coversThroughId) return null;
	return d as RpSummaryData;
};

/**
 * 分支上生效的前情摘要 = **最后一条**摘要条目（每次压缩都把上一份合并进来，故后者全覆盖前者）。
 * 兼容旧会话里 pi 写的 `compaction` 条目：覆盖边界取 firstKeptEntryId 的前一条。
 * 返回 cut = 需要从历史里去掉的条目数（分支前缀长度）。
 */
export function activeSummary(branch: BranchEntryLike[]): { summary: string; cut: number } | null {
	for (let i = branch.length - 1; i >= 0; i--) {
		const e = branch[i];
		const data = summaryDataOf(e);
		if (data) {
			const at = branch.findIndex((x) => x.id === data.coversThroughId);
			// 覆盖锚点找不到（异常树）时退守到摘要条目自身之前
			return { summary: data.summary, cut: at >= 0 ? at + 1 : i };
		}
		// 旧会话：pi 的 compaction 条目（summary + firstKeptEntryId）
		if (e.type === "compaction") {
			const legacy = e as unknown as { summary?: unknown; firstKeptEntryId?: unknown };
			if (typeof legacy.summary !== "string" || !legacy.summary.trim()) continue;
			const keptAt =
				typeof legacy.firstKeptEntryId === "string"
					? branch.findIndex((x) => x.id === legacy.firstKeptEntryId)
					: -1;
			return { summary: legacy.summary, cut: keptAt >= 0 ? keptAt : i };
		}
	}
	return null;
}

/**
 * 分支条目 → 往拍历史。
 * 补丁（rp-draft-op）先套用；assistant 文本过 cleanAssistantText；
 * 工具调用/思考块/账本快照等过程条目一律不进历史（R3：装配时就不存在）。
 * 相邻同角色文本合并（API 安全）。
 *
 * promptRules：作者正则里 promptOnly / 破坏性那批（对齐酒馆送模侧，engine.js:352）。
 * 挂在**策略引擎之前**跑——cleanAssistantText 的 unwrap 会先拆掉 <w2g> 等标签，
 * 正则必须先于它应用（与显示层「禁止 unwrap 先于作者正则」同一条纪律）。
 *
 * 规则带 minDepth/maxDepth 时按深度筛（酒馆 depth：从最新往回数，0＝最新）。
 * **计数单位是合并后的历史条目**，不是分支上的原始 message：一拍在梨园是十几条
 * message（多轮工具＋多段正文），在酒馆眼里是一条消息；按原始条目数就会让一拍吃掉
 * 十几个 depth，作者写的 maxDepth:2 会连最新那条都落空。深度取自**正则之前**的
 * 分组（同酒馆按 coreChat 下标算），否则「规则清空了某条 → 条目数变了 → 深度变了」自我循环。
 *
 * M4：有 rp-summary 时，被覆盖的早期条目整段不进历史，改由 summary 字段回读为【前情提要】。
 */
export function rebuildHistory(branch: BranchEntryLike[], promptRules: DisplayRule[] = []): RebuiltHistory {
	branch = applyDraftRevisions(storyBranch(branch), { omitEditRequests: true });
	const active = activeSummary(branch);
	const live = active ? branch.slice(active.cut) : branch;

	// 1) 取叙事相关条目为 MsgLike 流（保留 rp-draft-op 供补丁函数消费）
	const stream: Array<DraftMsgLike & { _role: "user" | "assistant" }> = [];
	for (const e of live) {
		if (e.type === "message" && e.message) {
			const r = e.message.role;
			if (r === "user" || r === "assistant") {
				// A choice answered during the beat belongs to that beat's user input. Dropping
				// it makes the resulting continuation look like an unrequested model decision.
				const choices = e.message.details?.rpChoices;
				if (r === "assistant" && Array.isArray(choices)) {
					const answers = choices.filter((c) => typeof c?.answer === "string").map((c) => c.answer);
					for (let i = stream.length - 1; answers.length && i >= 0; i--) {
						if (stream[i]._role !== "user") continue;
						stream[i].content = [textOf(stream[i].content), ...answers].join("\n\n");
						break;
					}
				}
				stream.push({ role: r, content: e.message.content, _role: r });
			}
			continue;
		}
		if (e.type === "custom_message" && typeof e.customType === "string") {
			if (e.customType === "rp-draft-op") {
				stream.push({ role: "custom", customType: e.customType, content: e.content, _role: "assistant" });
			} else if (CUSTOM_AS_ASSISTANT.has(e.customType)) {
				stream.push({ role: "custom", customType: e.customType, content: e.content, _role: "assistant" });
			} else if (CUSTOM_AS_USER.has(e.customType)) {
				stream.push({ role: "custom", customType: e.customType, content: e.content, _role: "user" });
			}
			// 其余 custom（rp-audio 等展示件）不进送模流
		}
	}

	// 2) 套补丁（rp-draft-op 出流；assistant 文本被定点替换）
	const { messages: patched } = applyDraftOps(stream);

	// 2.5) 深度归属：按角色游程分组（＝第 3 步的相邻合并），组数即酒馆眼里的消息数
	const roleOf = (m: DraftMsgLike): "user" | "assistant" =>
		(m as { _role?: "user" | "assistant" })._role ?? (m.role === "user" ? "user" : "assistant");
	const needDepth = hasDepthLimits(promptRules);
	const groupOf: number[] = [];
	let groups = 0;
	if (needDepth) {
		let prevRole: "user" | "assistant" | null = null;
		for (const m of patched) {
			const role = roleOf(m);
			if (role !== prevRole) groups++;
			prevRole = role;
			groupOf.push(groups - 1);
		}
	}

	// 3) 转历史：清洗 + 空文过滤 + 相邻同角色合并
	const history: BeatMsg[] = [];
	for (let i = 0; i < patched.length; i++) {
		const m = patched[i];
		const role = roleOf(m);
		let text = textOf(m.content);
		// 送模侧作者正则（promptOnly/破坏性）剥「作者不想让模型看」的块——必须在策略引擎
		// **之前**跑：cleanAssistantText 的 unwrap 会先拆掉 <w2g> 等标签，晚了正则打空
		// （与显示层「禁止 unwrap 先于作者正则」同一条纪律）。
		const rules = needDepth ? rulesAtDepth(promptRules, groups - 1 - groupOf[i]) : promptRules;
		if (rules.length > 0) text = applyCardSkin(text, rules, { charName: "", userName: "" });
		if (role === "assistant") text = cleanAssistantText(text);
		text = text.trim();
		if (!text) continue;
		const prev = history[history.length - 1];
		if (prev && prev.role === role) {
			prev.text = `${prev.text}\n\n${text}`;
		} else {
			history.push({ role, text });
		}
	}

	// 4) 最后用户原文 + 最后台上叙事（幕后轮的回复不作语言检测源）
	let lastUserText = "";
	for (let i = history.length - 1; i >= 0; i--) {
		if (history[i].role === "user") {
			lastUserText = history[i].text;
			break;
		}
	}
	let lastNarrativeText = "";
	{
		let inBackstageTurn = false;
		for (const m of history) {
			if (m.role === "user") {
				inBackstageTurn = isBackstageText(m.text);
			} else if (!inBackstageTurn) {
				lastNarrativeText = m.text;
			}
		}
	}
	return { history, lastUserText, lastNarrativeText, ...(active ? { summary: active.summary } : {}) };
}

/** 世界状态 = f(分支)：最近一条 rp-state 快照；无快照 = 初始状态（R4 读侧） */
export function stateFromBranch(branch: BranchEntryLike[]): WorldState {
	branch = storyBranch(branch);
	for (let i = branch.length - 1; i >= 0; i--) {
		const e = branch[i];
		if (e.type === "custom" && e.customType === "rp-state" && e.data && typeof e.data === "object") {
			return { ...defaultState(), ...(e.data as Partial<WorldState>) };
		}
	}
	return defaultState();
}

// ---------------- system prompt（字节稳定） ----------------

export interface StageSystemOptions {
	card: CharacterCard;
	config: RpConfig;
	constantLore: LorebookEntry[];
	/**
	 * 用户规矩两级文件（刀2，src/user-rules.ts）：全局在前、卡级在后，原文直通
	 * （这是用户自己的话，不包装、不加引导语——铁律一）。
	 */
	userRules?: UserRules;
	/**
	 * 卡档案（刀3，src/card-agents.ts）：`cards/<卡>/AGENTS.md` 全文。
	 * 非空 ⇒ 文件为准，下方卡 sections（兜底段/蓝灯/卡作者附加指令）整组让位——
	 * 卡常驻内容只此一份，不双份。空 ⇒ 走今天的投影（遗留预设的 marker 归位照旧）。
	 */
	cardAgents?: string;
	/**
	 * 预设装配产物（历史前段）：原文、原序，marker 槽位已由预设作者的位置填入梨园材料。
	 * 它是 system prompt 的**主体**，排在最前——harness 骨架殿后（PLAN-PRESET-PIPELINES §四之四）。
	 */
	presetBefore?: string[];
	/**
	 * **真交了料**的 marker 槽位 id：梨园的材料确实进了预设作者指定的位置。
	 * 没进的槽位（旧格式预设无 marker、或声明了却没料）由梨园按兜底版式补上——
	 * 否则角色卡会整个丢失。判据是「填了」不是「声明了」，见 materials.ts 同名字段。
	 */
	filledMarkers?: Set<string>;
	/** false = 不声明工具协议（M1 前过渡形态；M3 起默认开） */
	tools?: boolean;
	/**
	 * MCP 外设工具（8/06 重接）：本会话已连接的 mcp__ 工具，空/省略＝只字不提。
	 * 进 system 而非每拍注入——会话内字节稳定，不破前缀缓存（与旧 director.ts 同位置）。
	 */
	mcpTools?: Array<{ name: string; description: string }>;
}

export function buildStageSystemPrompt({
	card,
	config,
	constantLore,
	userRules,
	cardAgents,
	presetBefore,
	filledMarkers,
	tools,
	mcpTools,
}: StageSystemOptions): string {
	const macro: MacroContext = { charName: card.name, userName: config.userName };
	const m = (s: string) => applyMacros(s, macro);
	const sections: string[] = [];
	const filled = filledMarkers ?? new Set<string>();
	// 卡档案（刀3，src/card-agents.ts）：文件在场 ⇒ 卡常驻内容以文件为准，下方卡 sections
	// 整组让位（一份不双份）；不在场 ⇒ 今天的投影原样走（遗留预设的 marker 归位照旧）。
	const agentsText = cardAgents && cardAgents.trim() ? cardAgents.trim() : "";

	// 预设装配段：原文原序，零 harness 引导语。卡/世界书/人设已在预设作者指定的槽位里。
	if (presetBefore && presetBefore.length > 0) sections.push(presetBefore.join("\n\n"));

	// 用户规矩（刀2）：pi 基座（SYSTEM.md/AGENTS.md 链）在前，这里是用户自己的话，
	// 原文直通两级文件（全局→卡级），位于遗留预设段之后、梨园装配段之前。
	for (const text of [userRules?.global, userRules?.card]) {
		if (text && text.trim()) sections.push(text.trim());
	}

	if (agentsText) {
		// 卡内容同源同规矩：{{char}}/{{user}} 宏与旧投影路径一样求值（生成物里带宏是常态）
		sections.push(m(agentsText));
	} else {
		// 2) 兜底：材料没进预设槽位的，梨园按自己的版式补——补的是位置，不是措辞之外的话。
		const charParts: string[] = [];
		if (!filled.has("charDescription") && card.description) charParts.push(m(card.description));
		if (!filled.has("charPersonality") && card.personality) charParts.push(`## 性格\n${m(card.personality)}`);
		if (!filled.has("scenario") && card.scenario) charParts.push(`## 当前场景\n${m(card.scenario)}`);
		if (!filled.has("dialogueExamples") && card.mesExample) {
			charParts.push(`## 对白示例（仅供文风与语气参考，不是已发生的剧情）\n${m(card.mesExample)}`);
		}
		if (charParts.length > 0) sections.push([`# 你扮演的角色：${card.name}`, ...charParts].join("\n\n"));
	}

	/**
	 * 用户是谁：**无条件出**（2026-09-02 用户定案「user 是谁、他的设定，必须无条件全量注入」）。
	 *
	 * 名字尤其省不得——梨园的消息流是裸 `role:"user"`（不像酒馆把发言人名字写进聊天记录），
	 * system 这一行是「用户扮演谁」到达模型的唯一通道；而 `personaDescription` 槽位只交人设正文，
	 * 名字（`config.userName`）和正文（`config.userPersona`）是两个字段，槽位只带得走后者。
	 * 此前这段挂在「预设没声明槽位」的条件上，实测三个真预设都声明了它、而人设正文常为空
	 * ⇒ 槽位无料、兜底又让位，整段消失，模型只能从预设作者的规则句里侧面拼出这个名字。
	 *
	 * 正文若已被槽位收走（filled ⇒ 已在预设作者指定的位置），此处不再重复同一份正文。
	 */
	const personaLines = [`# 用户扮演：${config.userName}`];
	if (!filled.has("personaDescription")) {
		personaLines.push(config.userPersona ? m(config.userPersona) : `（${config.userName} 的具体形象由用户在剧情中自行呈现）`);
	}
	sections.push(personaLines.join("\n"));

	if (!agentsText && !filled.has("worldInfoBefore") && !filled.has("worldInfoAfter") && constantLore.length > 0) {
		const loreText = constantLore.map((e) => `- ${e.comment ? `【${e.comment}】` : ""}${m(e.content)}`).join("\n");
		sections.push(`# 世界设定（常驻事实）\n${loreText}`);
	}

	// skill 全部走标准按需档（8/23）：名字+描述在 skill_read 的工具描述里，正文调了才加载。
	// 此处零常驻——resident 档退役，system 不再无差别塞 skill 正文。

	// MCP 外设（8/06 重接）：用户在「扩展能力 → MCP」接入的外部服务器。
	// 工具已在清单里，这里只说明它们是什么、以及 RP 语境下的三条纪律。
	// 措辞承自旧 director.ts（009e22e 换引擎时随 director 一起失联）。
	if (mcpTools && mcpTools.length > 0) {
		const index = mcpTools.map((t) => `- \`${t.name}\`：${t.description}`).join("\n");
		sections.push(
			`# MCP 外设（用户接入的外部工具）
以 \`mcp__\` 开头的工具来自用户接入的外部服务器（识图、搜索、浏览器等），**直接调用**即可。
- **只在剧情真需要时用**——它们是外部服务，不是演出的一部分；能靠设定和想象写出来的，就不要调。
- 调用结果**用户看不见**：要让用户知道的内容，必须由你写进正文。
- 工具报错就如实说，不要假装成功；不可逆或高风险操作（删文件、付款、发帖）先问用户。
当前可用：
${index}`,
		);
	}

	sections.push(
		`# 消息流约定
- 标注【开场】的消息是 ${card.name} 的既定开场白，剧情从那一刻继续。
- 标注【前情提要】的消息是更早剧情的接力摘要，是既定事实。
- 标注【世界状态】的消息是当前事实基准：剧情记忆与它冲突时，以状态为准并在叙事内自然圆回，绝不跳出剧情解释。
- 标注【登场名录】的消息是本局登场过的人物/地点/物品/剧情线全量名字与首次登场时间${tools !== false ? "，细节可用 `memory_search` 查" : ""}；名录之外的名字才是新登场。
- 标注【活跃面板】的消息是各面板的当前内容（用户可能手改过），其中事实为准。
- 标注【相关设定】【设定集索引】的消息都是设定条目的标题（前者本拍关键词命中，后者全库）${tools !== false ? "，正文用 `lorebook_search` 取" : ""}。
- 标注【剧情记忆】的消息是历史正文检索片段，按需取用，勿整段照抄。`,
	);

	if (!agentsText && card.systemPrompt) {
		sections.push(`# 卡作者附加指令（优先级最高）\n${m(card.systemPrompt)}`);
	}

	return sections.join("\n\n");
}

// ---------------- 末端注入（每拍动态） ----------------

/**
 * 设定集索引单行渲染的字符预算（超出按条目边界截断，补「等 N 条」）。
 *
 * 2000 ≈ 160 条标题（实测均长 12.5 字/条）。截断的代价是**永久性**的——名字没列出来，
 * 那条设定对模型就等于不存在，也就永远不会被 `lorebook_search` 取到；而多送的字相对
 * 蓝灯常驻每拍无条件的 25632 字只是零头。真超了还有 `lorebook_list` 兜底（台上可调）。
 */
const LORE_INDEX_MAX_CHARS = 2000;

/**
 * 设定集条目索引行：`共 N 条：标题A、标题B、……`；只出名字，无可列返回 undefined。
 *
 * **蓝灯（constant）不进索引**：它们的全文每拍常驻 system（# 世界设定），在索引里再报一遍
 * 名字是纯冗余，还挤占预算把绿灯挤出去——实测某本 53 启用条目的书里蓝灯标题占 140 字，
 * 正好顶掉 11 条绿灯。索引的用处是让模型知道**有什么是要检索才拿得到的**，蓝灯不属于那一类。
 */
export function formatLoreIndex(
	entries: Array<Pick<LorebookEntry, "comment" | "keys" | "enabled" | "constant">>,
): string | undefined {
	const titles: string[] = [];
	for (const e of entries) {
		if (e.enabled === false || e.constant) continue;
		const title = (e.comment || e.keys?.[0] || "").trim();
		if (title) titles.push(title);
	}
	if (titles.length === 0) return undefined;

	const shown: string[] = [];
	let used = 0;
	for (const t of titles) {
		if (used + t.length + 1 > LORE_INDEX_MAX_CHARS) break;
		shown.push(t);
		used += t.length + 1;
	}
	const rest = titles.length - shown.length;
	return `共 ${titles.length} 条：${shown.join("、")}${rest > 0 ? `……等（另 ${rest} 条未列出）` : ""}`;
}

export interface StageInjectionOptions {
	state: WorldState;
	activatedLore: LorebookEntry[];
	card: CharacterCard;
	config: RpConfig;
	/**
	 * off 挡：绿灯命中给**正文**而非标题。off 下模型没有原生思考通道、不会主动调
	 * lorebook_search，「给标题让它自己取」这条对 off 走不通（实测：off 拍思考里说了要检索
	 * 却零工具调用），只能用被动供料兜底——这正是酒馆原生的做法。thinking 挡不受影响。
	 */
	passiveLore?: boolean;
	/** 上一拍台上叙事语言与配置不符（harness 检测） */
	languageMismatch?: boolean;
	/** 卡档案在场（刀3）：postHistoryInstructions 已在卡 AGENTS.md 里，注入块让位（B8） */
	cardAgentsActive?: boolean;
	/** 活跃面板全文快照（formatPanelSnapshot 产出）或一行速览 */
	panelIndex?: string;
	/** 预设字数规则（extractDraftRules 提取）——纯事实一行，无落笔指令（P2） */
	wordRange?: { min: number; max: number };
	/** 设定集索引行（formatLoreIndex 产出） */
	loreIndex?: string;
	/** 登场名录索引行（formatRosterIndex 产出） */
	rosterIndex?: string;
	/** 剧情记忆召回块（向量库被动召回，受设置「每轮自动检索并注入模型」管辖；关或无命中则不出块） */
	memoryRecall?: string;
}

/**
 * 每拍注入消息流末端的动态内容（以 user 角色送达）。
 *
 * M-R1（PLAN-RECTIFY §2.2）：全部是事实块——数据带【标注】送达，语义在 system
 * 「消息流约定」里一次说清，不逐拍复述。【导演备注】容器解散：卡末端指令独立成块，
 * 主权兜底迁默认预设，「演完即停」由判定/谢幕的日程表达；【状态栏】【思考的用法】退场。
 */
export function buildStageInjection({
	state,
	activatedLore,
	card,
	config,
	languageMismatch,
	cardAgentsActive,
	panelIndex,
	wordRange,
	loreIndex,
	rosterIndex,
	memoryRecall,
	passiveLore,
}: StageInjectionOptions): string {
	const macro: MacroContext = { charName: card.name, userName: config.userName };
	const blocks: string[] = [];

	blocks.push(`【世界状态】\n${formatState(state)}`);

	if (rosterIndex) {
		blocks.push(`【登场名录】${rosterIndex}`);
	}

	if (panelIndex) {
		blocks.push(`【活跃面板】\n${panelIndex}`);
	}

	// 绿灯命中：**按档位分策略**（8/23 用户定案）。世界书这套是照抄酒馆的，而酒馆没有
	// 模型主动检索这回事——关键词命中就把正文塞进上下文是那个前提下的正解。
	// - thinking 挡：梨园有 lorebook_search，给正文＝替模型把检索做完了（实测模型读到就直接
	//   下结论「查了也没有」不再调工具），故只给标题＝给线索，正文由模型自己取。
	// - off 挡：模型没有原生思考通道、不会主动调工具（passiveLore），退回酒馆原生的被动供料，
	//   直接给命中条目的正文。
	if (activatedLore.length > 0) {
		if (passiveLore) {
			// off 挡：给命中条目的正文（酒馆原生被动供料）——模型不主动检索时的兜底
			const lore = activatedLore
				.map((e) => `- ${e.comment ? `【${e.comment}】` : ""}${applyMacros(e.content, macro)}`)
				.join("\n");
			blocks.push(`【相关设定】\n${lore}`);
		} else {
			// thinking 挡：给标题＝给线索，正文由模型自己 lorebook_search 取，检索这一环才闭得上
			const titles = activatedLore.map((e) => (e.comment || e.keys?.[0] || "").trim()).filter(Boolean);
			if (titles.length > 0) {
				blocks.push(`【相关设定】本拍命中 ${titles.length} 条：${titles.join("、")}`);
			}
		}
	}

	if (loreIndex) {
		blocks.push(`【设定集索引】${loreIndex}`);
	}

	// 【剧情记忆】：向量库被动召回。块的语义早已写在 system「消息流约定」里，
	// 此处只是把宣称过的通道接上——不加一句新话（铁律一）。
	if (memoryRecall) {
		blocks.push(`【剧情记忆】\n${memoryRecall}`);
	}

	// 卡末端指令：独立块（旧【导演备注】容器解散后的存留者——卡数据，原文直通）。
	// 卡档案在场 ⇒ 它已在 AGENTS.md 里（B8），这里不双份。
	if (card.postHistoryInstructions && !cardAgentsActive) {
		blocks.push(`【卡作者末端指令】\n${applyMacros(card.postHistoryInstructions, macro)}`);
	}

	blocks.push(`【语言】以${config.language}写叙事与对白（专有名词可保留原文）。`);

	// 字数一行：纯事实（无「朝这个量落笔」类指令）；无目标不出行
	if (wordRange) {
		blocks.push(`本拍约 ${wordRange.min}–${wordRange.max} 字`);
	}

	if (languageMismatch) {
		blocks.push(
			`【语言纠正】你上一拍使用了错误的语言。从本拍起，全部叙事与对白必须使用${config.language}（专有名词可保留原文）。这是硬性要求，立即纠正。`,
		);
	}

	return blocks.join("\n\n");
}

/**
 * 检测文本语言是否与目标语言失配。v0 只实现中文目标的检测
 * （其他语言返回 false，不误报）。用于 harness 级语言自愈。
 */
export function detectsLanguageMismatch(text: string, language: string): boolean {
	if (!/中文|汉语|chinese/i.test(language)) return false;
	const letters = text.match(/\p{L}/gu) ?? [];
	if (letters.length < 40) return false; // 样本太短不判定
	const cjk = letters.filter((ch) => /\p{Script=Han}/u.test(ch)).length;
	return cjk / letters.length < 0.3;
}
import { applyDraftRevisions } from "./draft-projection.ts";
