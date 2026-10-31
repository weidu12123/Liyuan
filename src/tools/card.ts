/**
 * 角色库族工具：card_read（读当前卡）、card_create（创建新卡，安全写）、card_list（卡库）、card_project（创作工程）。
 *
 * `card_create` 是**安全写**：创建新文件（同名拒写 + 写入后 loadCardFile 回读自检，
 * 解析失败 unlinkSync 回滚），不碰用户现有卡数据。
 */

import { errText, strArg, type ToolResult, type ToolSpec } from "./registry.ts";

/** 卡库一项（列举用；与 GET /api/cards 同源） */
interface CardLibItemLike {
	path: string;
	name: string;
	tags?: string[];
	fav?: boolean;
}

export interface CardDeps {
	/** 卡工程操作：agent 模式的资源服务。 */
	project?: (args: Record<string, unknown>) => Promise<unknown>;
	// ---- 读者 ----
	/** 读取当前装载的卡（字段级）；返回 null = 未装载卡 */
	readCard: () => { name: string; description?: string; personality?: string; scenario?: string;
		firstMes?: string; mesExample?: string; systemPrompt?: string; creatorNotes?: string;
		tags?: string[]; alternateGreetings?: string[] } | null;

	// ---- 创建者 ----
	/** 创建一张新角色卡（JSON CharaCard V3）；同名拒写。返回 (name, path) 或 null=同名已存在 */
	createCard?: (input: { name: string; description?: string; personality?: string; scenario?: string;
		firstMes: string; mesExample?: string; alternateGreetings?: string[] }) => { name: string; path: string } | null;

	// ---- 卡库 ----
	/** 卡库列表 + 当前卡路径 */
	listCards?: () => { cards: CardLibItemLike[]; current: string };
}

/**
 * 调用情境：诊断卡面内容——用户问「这张卡的描述是什么/有几个备选开场白」或
 * 需要根据卡面信息回答配置问题。类比 `lorebook_list`（给目录不给正文）。
 */
const cardRead: ToolSpec<CardDeps> = {
	name: "card_read",
	domain: "card",
	mode: "read",
	surfaces: ["stage", "authoring"],
	label: "读取角色卡",
	description: () =>
		"读取当前装载的角色卡字段（description/personality/scenario/first_mes/mes_example/system_prompt/creator_notes/tags/alternate_greetings）。" +
		"拿不准卡面某字段的内容时调用。",
	parameters: () => ({
		type: "object",
		properties: {},
		required: [],
	}),
	async run(_args, deps): Promise<ToolResult> {
		let card: ReturnType<CardDeps["readCard"]>;
		try {
			card = deps.readCard();
		} catch (err) {
			return { text: `读取角色卡失败：${errText(err)}` };
		}
		if (!card) return { text: "当前未装载角色卡。" };

		const text = [
			`角色卡「${card.name}」：`,
			card.description ? `**描述**：${card.description.slice(0, 2000)}` : "",
			card.personality ? `**性格**：${card.personality.slice(0, 1200)}` : "",
			card.scenario ? `**场景**：${card.scenario.slice(0, 1200)}` : "",
			card.firstMes ? `**开场白**：${card.firstMes.slice(0, 2000)}` : "",
			card.mesExample ? `**对话范例**：${card.mesExample.slice(0, 2000)}` : "",
			card.systemPrompt ? `**系统提示**：${card.systemPrompt.slice(0, 800)}` : "",
			card.creatorNotes ? `**作者注**：${card.creatorNotes.slice(0, 1200)}` : "",
			card.tags?.length ? `**标签**：${card.tags.join("、")}` : "",
			card.alternateGreetings?.length
				? `**备选开场白（${card.alternateGreetings.length} 条）**：\n${card.alternateGreetings.map((g, i) => `${i + 1}. ${g.slice(0, 200)}`).join("\n")}`
				: "",
		]
			.filter(Boolean)
			.join("\n\n");
		return { text, activity: "读卡" };
	},
};

/**
 * 调用情境：用户说「帮我做一张 X 的角色卡」。创建的是新文件（同名拒写），
 * 写入后回读自检——做出来的是什么，回执就报什么。
 */
const cardCreate: ToolSpec<CardDeps> = {
	name: "card_create",
	domain: "card",
	mode: "write",
	surfaces: ["authoring"],
	label: "创建角色卡",
	description: () =>
		"创建一张新角色卡（CharaCard V3 JSON）。同名卡已存在时拒写。用于用户要求做新卡时。" +
		"参数全部用剧情原语言填写。" +
		"写完后**不会自动切换到新卡**——请用户自行在卡库中打开。",
	parameters: () => ({
		type: "object",
		properties: {
			name: { type: "string", description: "卡名（也是文件名；不限语言）" },
			description: { type: "string", description: "外貌/背景描述" },
			personality: { type: "string", description: "性格特征" },
			scenario: { type: "string", description: "当前场景/处境" },
			first_mes: { type: "string", description: "开场白（必填，新会话的首条消息）" },
			mes_example: { type: "string", description: "对话范例（展示说话风格）" },
			alternate_greetings: {
				type: "array",
				items: { type: "string" },
				description: "备选开场白（多条，第一条即 first_mes 可不重复填）",
			},
		},
		required: ["name", "first_mes"],
	}),
	async run(args, deps): Promise<ToolResult> {
		if (!deps.createCard) return { text: "本环境不支持创建角色卡。" };

		const name = strArg(args, "name");
		if (!name) return { text: "缺少 name 参数（卡名 / 文件名）。" };

		const firstMes = strArg(args, "first_mes");
		if (!firstMes) return { text: "缺少 first_mes 参数（开场白，新会话首条消息）。" };

		const alternates = Array.isArray(args.alternate_greetings)
			? args.alternate_greetings.filter((g): g is string => typeof g === "string" && g.trim().length > 0).map((g) => g.trim())
			: [];

		let r: { name: string; path: string } | null;
		try {
			r = deps.createCard({
				name,
				...(strArg(args, "description") ? { description: strArg(args, "description") } : {}),
				...(strArg(args, "personality") ? { personality: strArg(args, "personality") } : {}),
				...(strArg(args, "scenario") ? { scenario: strArg(args, "scenario") } : {}),
				firstMes,
				...(strArg(args, "mes_example") ? { mesExample: strArg(args, "mes_example") } : {}),
				...(alternates.length ? { alternateGreetings: alternates } : {}),
			});
		} catch (err) {
			return { text: `创建角色卡失败：${errText(err)}` };
		}
		if (!r) return { text: `角色卡「${name}」已存在（同名卡拒写），请换一个名字。` };

		return {
			text:
				`已创建角色卡「${r.name}」（${r.path}）。` +
				`不会自动切换到此卡——请在卡库中手动打开。`,
			activity: `创建角色卡「${r.name}」`,
			details: { name: r.name, path: r.path },
		};
	},
};

/**
 * 调用情境：用户问「我有哪些角色卡」，或换卡之前先取路径。
 *
 * 卡库是「开局」的事，与一拍演出无关。
 */
const cardList: ToolSpec<CardDeps> = {
	name: "card_list",
	domain: "card",
	mode: "read",
	surfaces: ["authoring"],
	label: "列出卡库",
	description: () =>
		"列出卡库里的全部角色卡（卡名/标签/路径）并标出当前装载的是哪张。用于换卡前取路径、或答「我有哪些卡」。",
	parameters: () => ({
		type: "object",
		properties: {
			keyword: { type: "string", description: "只列卡名或标签含此字样的（缺省列全部）" },
		},
		required: [],
	}),
	async run(args, deps): Promise<ToolResult> {
		if (!deps.listCards) return { text: "本环境不支持列举卡库。" };

		let lib: { cards: CardLibItemLike[]; current: string };
		try {
			lib = deps.listCards();
		} catch (err) {
			return { text: `列举卡库失败：${errText(err)}` };
		}
		const kw = strArg(args, "keyword").toLowerCase();
		const list = kw
			? lib.cards.filter(
					(c) => c.name.toLowerCase().includes(kw) || (c.tags ?? []).some((t) => t.toLowerCase().includes(kw)),
				)
			: lib.cards;
		if (list.length === 0) {
			return { text: kw ? `卡库共 ${lib.cards.length} 张，无匹配「${kw}」的卡。` : "卡库是空的。", activity: "列卡库 · 0 张" };
		}
		const lines = list.map((c) => {
			const marks = [c.path === lib.current ? "**当前**" : "", c.fav ? "收藏" : ""].filter(Boolean).join("·");
			const tags = c.tags?.length ? `｜${c.tags.slice(0, 6).join("、")}` : "";
			return `- ${c.name}${marks ? `｜${marks}` : ""}${tags}｜${c.path}`;
		});
		return {
			text: `卡库${kw ? `含「${kw}」的` : ""} ${list.length}/${lib.cards.length} 张：\n${lines.join("\n")}`,
			activity: `列卡库 · ${list.length} 张`,
		};
	},
};

/** 创作工程由 agent 模式调用，共享服务负责资源映射、版本校验与回写。 */
export const cardProject: ToolSpec<CardDeps> = {
	name: "card_project",
	domain: "card",
	mode: "write",
	surfaces: ["authoring"],
	label: "卡创作工程",
	description: () =>
		"当前卡的唯一修改通道：创作工程。guide 读写卡手册（卡的构成、各操作的用法；file 读 references/ 分册：worldbook / greetings / mvu / ui-regex / scripts / preview / liyuan-runtime / export，动到哪个板块读哪份）；outline 按板块列目录（默认概览，传 section 读一个板块，full 读全部；每项有 key、path、facts）；inspect 列资源清单；" +
		"prepare 展开到创作目录；read 按资源 ID 读原文（raw 读基线原包，draft 读含未应用改动的草稿）；write 保存正文稿；" +
		"add 新增一项（kind：lore / greeting / regex / script，fields 给元数据，lore 与 script 可带 content）；remove / restore 按目录项 key 标记删除或撤销；" +
		"meta 按 key 改元数据（条目：comment / keys / secondary_keys / constant / enabled / selective / insertion_order / position / depth / role / probability；" +
		"正则：scriptName / placement / disabled / markdownOnly / promptOnly / minDepth / maxDepth；脚本：name / enabled；settings-meta：tags；book：name / description / scan_depth / token_budget / recursive_scanning）；" +
		"assign 把目录项归入板块；check 校验并组装；preview 在用户页面里渲染当前稿并回报错误与 DOM 摘要；apply 按 buildHash 应用且重载；undo 撤回最后一次应用；" +
		"discard 放弃全部未应用改动；rebase 在原卡被其他入口改动后重新同步并列出冲突。资源也可用原生文件工具编辑。此工程不修改卡档案 AGENTS.md。",
	parameters: () => ({
		type: "object",
		properties: {
			action: { type: "string", enum: ["guide", "outline", "inspect", "prepare", "read", "write", "add", "remove", "restore", "meta", "assign", "check", "preview", "apply", "undo", "discard", "rebase"] },
			file: { type: "string", description: "guide 可选：手册包内相对路径（如 references/mvu.md），省略读总册" },
			resource: { type: "string", description: "清单中的资源 ID；read 可用 raw / draft" },
			section: { type: "string", description: "板块 ID：settings / greetings / lore-knowledge / lore-constant / rules / mvu / ui / prompt-regex / scripts / ejs / deps / other" },
			full: { type: "boolean", description: "outline 时返回全部板块的全部项" },
			key: { type: "string", description: "remove / restore / meta / assign 必填：目录项的 key" },
			kind: { type: "string", enum: ["lore", "greeting", "regex", "script"], description: "add 必填" },
			fields: { type: "object", description: "add / meta 的字段" },
			text: { type: "string", description: "write 的完整新内容，原样保存" },
			version: { type: "string", description: "write 必填：最近读取资源返回的 hash" },
			buildHash: { type: "string", description: "apply 必填：最近 check 返回的 hash" },
			offset: { type: "number", description: "read 可选起始行，1 起" },
			limit: { type: "number", description: "read 可选行数，返回 nextOffset 时可续读" },
			message: { type: "string", description: "preview 可选：要渲染的消息正文，默认第一条开场" },
			greeting: { type: "number", description: "preview 可选：渲染第几条开场（0 = 默认开场）" },
			variables: { type: "object", description: "preview 可选：测试变量，默认卡内初值" },
			wait: { type: "number", description: "preview 可选：页面就绪后再观察多少毫秒，默认 3000" },
		},
		required: ["action"],
	}),
	async run(args, deps) {
		if (!deps.project) return { text: "本环境不支持卡创作工程", isError: true };
		try {
			const result = await deps.project(args);
			return { text: JSON.stringify(result, null, 2), details: result, activity: "卡创作工程" };
		} catch (error) {
			return { text: errText(error), isError: true };
		}
	},
};

/** 角色库族全部工具。 */
export const cardTools: ToolSpec<CardDeps>[] = [cardRead, cardCreate, cardList, cardProject];
