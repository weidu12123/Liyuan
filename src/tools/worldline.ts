/**
 * 世界线族工具（PLAN-RP-TOOLING M-D5）。
 *
 * 合一前零工具——世界线操作全是 UI 命令（/store /back /rewind）或 REST 端点。
 * 此处首开工具化。
 *
 * ## 写侧语义
 *
 * - `worldline_store`：在当前剧情节点创建 rp-save 存档点。是**安全写**——只往树里追加
 *   `rp-save` custom 条目，不删不改任何现有条目。存档后继续演，不中断。
 *   台上开放，但**落点推迟到封笔之后**：台上调用发生在本拍生成中，此刻叶位还是用户那条
 *   输入，钉在这里的存档回退过去只有输入没有回复；且钉档要与账本/面板快照对齐，
 *   那两件封笔后才有正确值。引擎把请求排到场记之后执行（场记刚写完 rp-state，
 *   面板写入时已自快照）——那正是全局唯一对齐的时刻。
 * - 回退不对模型开放：台上 back 即便推迟到封笔后也怪——模型刚写完一拍，树就跳走，
 *   这一拍当场变成旁支。回退是「两拍之间」的动作，且留哪条时间线是用户的主权决定。
 *
 * ## 「新开世界线」是怎么发生的
 *
 * 没有「新建世界线」这个动作——`planNewSave` 按**树的形状**自动判：
 * 回到旧存档、走出与既有后续不同的路、再 store，那一次 store 就自动分出新线。
 * 所以 agent 能开世界线 = agent 能 store（分叉是结构结论，不是谁下的命令）。
 *
 * ## 门禁
 *
 * `worldline_store` 是写侧，但**不挂门禁**。
 * 理由：存档是时间轴快照——不覆写用户数据（不像 lorebook_write 改设定集），
 * 不跨会话污染（不像 memory_add 写进本对话的检索库），且全可逆
 * （回退后的旧后续可再导航回去；softDelete 只是软删）。
 */

import { errText, intArg, strArg, type ToolResult, type ToolSpec } from "./registry.ts";

/** 存档视图子集（不依赖 worldline.ts 全形，便于离线单测） */
interface WorldlineSaveLite {
	id: string;
	name: string;
	worldlineId: string;
	worldlineName: string;
	createdAt: number;
	onCurrentBranch: boolean;
	entryId: string;
}

export interface WorldlineViewLite {
	saves: WorldlineSaveLite[];
	currentSaveId: string | null;
}

export interface WorldlineDeps {
	/**
	 * 返回全部存档的世界线视图（含已软删过滤 + 分支归属）。
	 * 宿主用 `flattenWorldlineSaves(buildWorldlineView(extractSaves(...)))` 摊平后注入——
	 * 树形按线分组是展示面的形状，工具面要的是一张按时间排的表。
	 */
	loadWorldline?: () => WorldlineViewLite;
	/**
	 * 创建存档（在当前叶位写 rp-save 条目并落盘 meta）。
	 * 返回新建的存档摘要；null = 无叶位可存。
	 * `deferred: true` = 请求已受理但要等封笔后才真正钉下（台上如此），
	 * 此时 worldlineName 尚不可知——分线与否由钉档那一刻的树形决定。
	 */
	storeSave?: (name: string) => { id: string; name: string; worldlineName: string; deferred?: boolean } | null;
}

const formatTime = (ts: number): string => {
	const d = new Date(ts);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * 调用情境：用户/剧情到了「值得存档」的节点——一个篇章结束、关键决策后、
 * 或用户说「在这里存个档」。
 *
 * 读侧 `worldline_list` 给目录。
 */
const worldlineStore: ToolSpec<WorldlineDeps> = {
	name: "worldline_store",
	domain: "worldline",
	mode: "write",
	surfaces: ["stage"],
	label: "创建存档",
	description: (ctx) =>
		"在当前剧情节点钉一个存档点。不删不改任何现有内容，存完继续正常推进。" +
		(ctx.surface === "stage" ? "存档点落在本拍演完之后，先把正文写完。" : "") +
		"用在关键抉择前后、篇章收束处，或用户说「在这里存个档」时。存档名可选，缺省为时间戳。" +
		"存档本身不产生新世界线——只有回到旧存档、走出不同的后续、再存档，才会分出新线。",
	parameters: () => ({
		type: "object",
		properties: {
			name: { type: "string", description: "存档名（缺省自动生成「X月/X日 HH:MM」格式）" },
		},
		required: [],
	}),
	async run(args, deps, ctx): Promise<ToolResult> {
		if (!deps.storeSave) return { text: "本环境不支持创建存档。" };

		const name = strArg(args, "name");
		let r: { id: string; name: string; worldlineName: string; deferred?: boolean } | null;
		try {
			r = deps.storeSave(name);
		} catch (err) {
			return { text: `创建存档失败：${errText(err)}` };
		}
		if (!r) return { text: "无法创建存档（无当前叶位）。" };

		// 台上是推迟执行（封笔后才钉），此刻分不分线尚未可知——回执就不能冒充「已存」
		if (r.deferred) {
			return {
				text:
					ctx.surface === "stage"
						? `已受理：本拍演完后在这里钉下存档【${r.name}】。之后从这里走出不同的路再存档，会自动分出新世界线。`
						: `已把存档【${r.name}】提交给剧情侧执行（正在生成中则排到本轮结束）。实际存档名与所属世界线以钉下那一刻为准——要确认随后调 worldline_list。`,
				activity: `存档「${r.name}」`,
				details: { name: r.name, deferred: true },
			};
		}
		return {
			text:
				`已存档【${r.name}】（${r.worldlineName}）。` +
				`之后走不同的路再存会自动分叉出新世界线；回退到旧存档用 /back 命令。`,
			activity: `存档「${r.name}」`,
			details: { id: r.id, name: r.name, worldlineName: r.worldlineName },
		};
	},
};

/**
 * 调用情境（D-T3）：诊断时间轴——用户问「我存了几个档/哪条世界线」或
 * 要回退到某个存档点前先确认它的名字。
 *
 * 台上也开放：存档表是**只读**的，任何时刻取都对；台上此前一件世界线工具都没有，
 * 用户在台上问「刚才存的那个档叫什么」时模型只能瞎猜。
 * （原注「台上拿不到分支树数据」已不成立——`sm.getBranch()` 引擎里到处在用。）
 */
const worldlineList: ToolSpec<WorldlineDeps> = {
	name: "worldline_list",
	domain: "worldline",
	mode: "read",
	surfaces: ["stage"],
	label: "列出世界线/存档",
	description: (ctx) =>
		"列出全部存档与世界线（按时间排序、标明当前分支归属）。" +
		(ctx.surface === "stage"
			? "用户问「存过哪些档」「现在在哪个存档之后」时调用；存档只是锚点，不含正文。"
			: "用于诊断「有过哪些存档」「当前在哪个存档之后」。" +
				"要看具体存档点的剧情内容请用 story_read（存档只是锚点，不含正文）。"),
	parameters: () => ({
		type: "object",
		properties: {
			limit: { type: "number", description: "最多列几条存档（默认 20，最近优先）" },
		},
		required: [],
	}),
	async run(args, deps, ctx): Promise<ToolResult> {
		if (!deps.loadWorldline) return { text: "本环境不支持查看世界线。" };

		let view: WorldlineViewLite;
		try {
			view = deps.loadWorldline();
		} catch (err) {
			return { text: `读取世界线失败：${errText(err)}` };
		}
		// 台上没有 worldline_store（见文件头「写侧语义」），别指一个它调不到的工具
		if (!view.saves.length) {
			return {
				text: `尚无存档（用 ${ctx.surface === "stage" ? "/store 命令" : "worldline_store 或 /store"} 创建第一个存档点）。`,
			};
		}

		// 倒序（最新在前），封顶
		const limit = intArg(args, "limit", 20, 1, 100);
		const recent = view.saves.slice(-limit).reverse();
		const lines = recent.map((s) => {
			const cur = s.id === view.currentSaveId ? " ← 当前" : "";
			const branch = s.onCurrentBranch ? "★本分支" : "○其他分支";
			return `- [${s.id}] **${s.name}**｜${s.worldlineName}｜${formatTime(s.createdAt)}｜${branch}${cur}`;
		});
		const head = `共 ${view.saves.length} 个存档（${recent.length} 条）：`;
		return {
			text: `${head}\n${lines.join("\n")}`,
			activity: `列世界线 · ${recent.length} 条`,
			details: { total: view.saves.length, currentSaveId: view.currentSaveId },
		};
	},
};

/** 世界线族全部工具（store/list；回退与删除不对模型开放） */
export const worldlineTools: ToolSpec<WorldlineDeps>[] = [worldlineStore, worldlineList];
