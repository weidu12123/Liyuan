/**
 * 台上检索工具（PLAN-RP-HARNESS M3，R2 工作区 = 稿纸 + 世界）。
 *
 * 对标 Claude Code 的 Read/Grep：动笔前查资料，不靠脑补。
 * 世界书族（lorebook_*）与向量库族（memory_*）已迁入统一工具层
 * （`src/tools/`，PLAN-RP-TOOLING M-D1~M-D3）；本模块只剩 world_state_get
 * 与 skill_read，外加统一层的装配与派发入口。
 *
 * 封顶 MAX_LOOKUPS 次/拍：模型输出正文即视为动笔，工具循环自然结束。
 *
 * 工具 schema 与执行分离：schema 是纯数据（引擎装配进 Context.tools），
 * 执行依赖注入（检索函数），因此本模块可离线单测。
 */

import { runUnifiedStageTool, unifiedStageTools } from "../tools/adapters/stage.ts";
import type { LoreDeps, LoreHitLike } from "../tools/lore.ts";
import type { MemoryDeps, MemoryHitLike } from "../tools/memory.ts";
import type { CardDeps } from "../tools/card.ts";
import type { WorldlineDeps } from "../tools/worldline.ts";
import type { PanelDeps } from "../tools/panels.ts";
import type { WorldState } from "../types.ts";

/** 一拍内最多允许的检索次数（超出后撤掉工具，强制动笔） */
export const MAX_LOOKUPS = 3;

/** agent 循环安全阀（PLAN-RP-AGENT-EXEC §2.3）：开放式循环的轮数上限，触阀以现稿定稿 */
// 8/09 提额：ask 接回 + 续写出口后，正常一拍可达 12+ 轮（规划/3段/3勾/修/ask/重拟/续写…）——
// 12 轮在实弹中被正常演出耗尽（安全阀吞掉了第三段与状态栏）。20 = 正常上限 × 安全余量。
export const MAX_ROUNDS = 20;

/** @liyuan/ai Tool 的结构子集（parameters 用裸 JSON Schema，避免 src/ 依赖 typebox） */
export interface StageTool {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	mode?: "read" | "write";
}

/** 命中形（M-D1/M-D3 起由统一工具层定义，此处再导出保持既有引用不变） */
export type { LoreHitLike, MemoryHitLike };

/**
 * 台上工具执行依赖。五族（世界书 / 向量库 / 角色库 / 世界线 / 面板）由统一工具层
 * 定义，此处继承——一处增减、全链路同步。台上的可用工具按注入函数的存在性过滤。
 */
export interface StageToolDeps extends LoreDeps, MemoryDeps, CardDeps, WorldlineDeps, Partial<PanelDeps> {
	/** 世界状态账本（getState 必在；formatState 用于展示） */
	getState: () => WorldState;
	formatState: (s: WorldState) => string;
	/** skill 内容解析（名称制）：skills/ 文件优先，拆层 D/E 进口包兜底；未注入＝无 skill_read 工具 */
	getSkill?: (name: string, file?: string, start?: number, end?: number) => string | undefined;
}

const STR = { type: "string" } as const;

/**
 * 工具清单（纯数据）。language 用于把「用哪种语言查」写进描述。
 * deps 给出时按注入情况过滤统一层工具（依赖缺失的不上清单，见 adapters/stage.ts）。
 */
export function stageTools(language: string, deps?: StageToolDeps): StageTool[] {
	return [
		// 世界书族（M-D1/M-D2）与向量库族（M-D3）已迁入统一工具层：一份实现多面共用
		...unifiedStageTools(language, deps),
		{
			name: "world_state_get",
			mode: "read",
			description: "读取当前世界状态账本（时间/地点/人物好感与状态/物品归属/标记/剧情线）。拿不准既定事实时调用。",
			parameters: { type: "object", properties: {}, required: [] },
		},
	];
}

/**
 * skill 读取工具：按名读取 skill 全文。**标准 agent skill 形态**（8/23 用户定案：
 * 「回归最本初的模样，对梨园与 Claude Code 一般无二」）——列表给 `名字：描述`，模型看描述
 * 自己决定读不读，读了才把全文加载进当拍。
 *
 * ⚠ 描述**必须带上**：此前只给名字（`可读：ask判断`），模型无从判断何时该读，实测 8/19
 * 之后零调用。description 是它唯一的判断依据（frontmatter 里必填，扫描时早就解析了，
 * 只是没传过来）。
 *
 * 关键性质：工具结果**不落历史**（rebuildHistory 只留定稿正文）——内容只活在当拍，
 * 谢幕即蒸发＝按需加载、用完即走。skills 为空时不要注册本工具（不凭空点名）。
 */
export function skillReadTool(language: string, skills: Array<{ name: string; description: string }>): StageTool {
	return {
		name: "skill_read",
		mode: "read",
		description:
			`按名读取一个 skill 的全文（${language}）。可读：\n` +
			skills.map((s) => `- ${s.name}：${s.description}`).join("\n"),
		parameters: {
			type: "object",
			properties: {
				name: { type: "string", enum: skills.map((s) => s.name), description: "要读取的 skill 名" },
				file: { type: "string", description: "包内引用文件的相对路径；省略读取 SKILL.md。只读取文本，不执行代码。" },
				start: { type: "integer", minimum: 0 },
				end: { type: "integer", minimum: 0 },
			},
			required: ["name"],
		},
	};
}

/**
 * 本拍稿件、上一拍修订、可选计划与用户提问的工具协议。
 * 记账归封笔后的场记旁路（scribe-run.ts），台上零世界写入工具。
 */
export function writeTools(language: string): StageTool[] {
	const version = { type: "integer", minimum: 0, description: "最近读取/写入回执的版本；空稿初始为 0。版本冲突时重新读取。" };
	// Gateways may pad objects with no required fields. Surplus root keys have no effect;
	// declared fields, nested plan items, and all versioned writes still undergo native validation.
	const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, ...(required.length ? { additionalProperties: false } : {}) });
	return [
		{
			name: "draft_write", mode: "write",
			description: "创建或全量替换本拍稿件，内容即时向用户展示并持久保存。写入不等于收笔；局部修改用 draft_edit，续写用 draft_append，完成用 draft_seal。简单回应也可直接输出。",
			parameters: schema({ version, content: { ...STR, description: "完整稿件原文，保留所有格式与空白" } }, ["version", "content"]),
		},
		{
			name: "draft_append", mode: "write",
			description: "在当前稿件末尾续写一段并展示。默认与上文隔一个空行；separator 可指定精确连接字符。不会收笔。",
			parameters: schema({ version, content: STR, separator: { ...STR, description: "默认两个换行；允许空串" } }, ["version", "content"]),
		},
		{
			name: "draft_read", mode: "read", description: "读取本拍稿件与版本。start/end 是从 0 开始的 UTF-16 字符偏移，end 不含；省略即全文。返回的 content 是精确原文。",
			parameters: schema({ start: { type: "integer", minimum: 0 }, end: { type: "integer", minimum: 0 } }, []),
		},
		{
			name: "draft_search", mode: "read", description: "在本拍稿件中按字面检索。hits 保留原文标点和空白，可直接用作 draft_edit.old；返回版本及命中总数。",
			parameters: schema({ query: STR, limit: { type: "integer", minimum: 1, maximum: 50 } }, ["query"]),
		},
		{
			name: "draft_edit", mode: "write", description: "按唯一原文引用批量修改当前稿件。全部引用都基于同一版本；任一处缺失、重复、重叠或版本冲突则整批不改。允许首尾空白/等长标点的有限匹配，回执报告匹配级别。",
			parameters: schema({ version, edits: { type: "array", minItems: 1, items: schema({ old: STR, new: STR }, ["old", "new"]) } }, ["version", "edits"]),
		},
		{
			name: "draft_seal", mode: "write", description: "完整正文与所需格式内容都写入后，最后单独调用，将本拍当前版本收笔并交给定稿与场记流程。不检查文风、字数或计划完成度；收笔后不能再改本拍稿件。",
			parameters: schema({ version }, ["version"]),
		},
		{
			name: "previous_draft_read", mode: "read", description: "读取当前分支上一拍已定稿回复的精确原文与版本，供回改。省略 start/end 即全文；偏移为从 0 开始的 UTF-16 字符，end 不含。不能选更早的拍次。",
			parameters: schema({ start: { type: "integer", minimum: 0 }, end: { type: "integer", minimum: 0 } }, []),
		},
		{
			name: "previous_draft_edit", mode: "write", description: "按 previous_draft_read 的版本和唯一原文引用，原位修订上一拍回复；未引用部分保留，任一冲突则整批不改。只修正文，不重算账本或记忆；本拍已有新稿时不可用。单独调用，成功即结束本次请求，界面显示修后的原回复。",
			parameters: schema({ version, edits: { type: "array", minItems: 1, items: schema({ old: STR, new: STR }, ["old", "new"]) } }, ["version", "edits"]),
		},
		{
			name: "beat_plan", mode: "write", description: "按需要列出或调整本拍短计划。steps 是完整新清单，用稳定 id 更新/勾选/取消；省略 steps 则保留。mode=explore 只允许读取、提问和计划，mode=write 开放写入。计划可随正文与用户回答修改，简单回应无需计划。空参数读取现计划。",
			parameters: schema({ mode: { type: "string", enum: ["explore", "write"] }, steps: { type: "array", maxItems: 20, items: schema({ id: STR, text: STR, status: { type: "string", enum: ["pending", "in_progress", "done", "cancelled"] } }, ["text"]) } }, []),
		},
		{
			name: "ask",
			mode: "read",
			description:
				"剧情共创决策（P7 接回）：把该由用户拍板的选择交给用户。两种触发：\n" +
				"① **主动触发**（随时，含第 1 轮）：用户输入本身在求方向/递笔（「接下来去找谁」「怎么办」" +
				"「给个选项」「让我选」）——这不需要上文支撑，直接问。\n" +
				"② **未定变量**（任何一拍）：用户这句输入引出的未定变量——取不同值这拍走向会" +
				"明显分岔（如：买下用户的人性格温和还是残暴，决定整拍怎么演）、且卡与世界书查不到——" +
				"先问用户定下来再演。一次一问，多个变量只问最关键的。" +
				"判断是**动态的**：变量不因「新」而重要——新人物的性格/身份不是全都要问，洞府里不是每件资源" +
				"都值得问；不分岔的自己顺着演，不事事上报。禁止代写用户身份的完整档案、禁止替用户定重大变量。\n" +
				`给出 2~4 个具体、可落地、彼此不同的选项（${language}），用户作答后按答案继续演。\n` +
				"用户点了停止 = 笔还给用户，本拍就此收束。\n" +
				"**选择框分流**：用户预设自带选择框格式（如 <w2g>）时，岔路与回合末选项**按预设格式写进正文**，" +
				"不要调本工具；只有预设没有选择框格式时才用 ask。",
			parameters: {
				type: "object",
				properties: {
					question: { ...STR, description: "要交给用户定夺的问题（一句话说清当前局面）" },
					options: {
						type: "array",
						description: "2~4 个具体选项（可落地、彼此不同）",
						items: { ...STR, description: "一个选项" },
					},
				},
				required: ["question", "options"],
			},
		},
	];
}

export interface ToolRunResult {
	/** 回给模型的 toolResult 文本 */
	text: string;
	/** 过程条短句（无则不出条） */
	activity?: string;
	details?: unknown;
	isError?: boolean;
}

/**
 * 执行一次工具调用。未知工具名/参数缺失都返回可读文本（不抛，不打断本拍）。
 * language 供统一工具层装配上下文（M-D1）；省略时按中文。
 */
export async function runStageTool(
	deps: StageToolDeps,
	name: string,
	args: Record<string, unknown>,
	language = "中文",
): Promise<ToolRunResult> {
	// 统一工具层优先（PLAN-RP-TOOLING M-D1/M-D3）：世界书族与向量库族由那一份实现作答
	const unified = await runUnifiedStageTool(deps, name, args, language);
	if (unified) return unified;

	if (name === "skill_read") {
		const skillName = typeof args.name === "string" ? args.name.trim() : "";
		let text: string | undefined;
		try { text = skillName ? deps.getSkill?.(skillName, typeof args.file === "string" ? args.file : undefined, args.start as number | undefined, args.end as number | undefined) : undefined; }
		catch (e) { return { text: e instanceof Error ? e.message : String(e), isError: true }; }
		if (!text) {
			return { text: `没有名为「${skillName}」的 skill。按已有理解直接动笔即可。` };
		}
		return {
			text: `【skill·${skillName}】\n\n${text}`,
			activity: `读 skill「${skillName}」`,
		};
	}

	if (name === "world_state_get") {
		const s = deps.getState();
		return { text: `${deps.formatState(s)}\n\nRAW:\n${JSON.stringify(s)}`, activity: "查账本" };
	}

	return { text: `未知工具 ${name}——本拍可用：lorebook_search / memory_search / world_state_get。` };
}
