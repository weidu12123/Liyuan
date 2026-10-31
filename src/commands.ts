/**
 * `/` 命令清单——单一事实来源（PLAN-PHASE3 §6.3：三入口一操作集的「键盘入口」）。
 * 扩展注册命令、server 的 GET /api/commands、Web 输入框补全都从这里读，
 * 新增命令只改这一处。本文件零依赖（领域层纪律）。
 */

export interface CommandMeta {
	/** 命令名（不含斜杠） */
	name: string;
	/** 用法示意（含斜杠与参数占位） */
	usage: string;
	/** 一句话说明（同时用作扩展 registerCommand 的 description） */
	description: string;
	/** 是否需要参数（补全后是否留在输入框等待补参） */
	takesArgs: boolean;
	/** 适用模式：缺省为 "roleplay"；"agent" 仅 agent 模式可见；"all" 两者均可见 */
	mode?: "roleplay" | "agent" | "all";
}

export const RP_COMMANDS: CommandMeta[] = [
	{
		name: "save",
		usage: "/save [存档名]",
		description: "【正文】为当前正文与讨论保存一个检查点快照（省略则用默认说明）",
		takesArgs: true,
		mode: "agent",
	},
	{
		name: "restore",
		usage: "/restore",
		description: "【正文】回退到上一个检查点（正文文件与讨论一起回退到该轮之前）",
		takesArgs: false,
		mode: "agent",
	},
	{
		name: "reroll",
		usage: "/reroll [编辑后的消息]",
		description: "再生成一条回复变体（同用户消息下保留旧回复；给参则改写你的输入后重来）",
		takesArgs: true,
		mode: "roleplay",
	},
	{
		name: "note",
		usage: "/note [导演备注]",
		description: "导演备注：写一句戏外指示，影响下一拍的演出或重 roll；不进入剧情历史（无参清除）",
		takesArgs: true,
		mode: "roleplay",
	},
	{
		name: "swipe",
		usage: "/swipe [prev|next|new]",
		description: "切换回复变体（prev/next；在末条 next=再生成；new=强制再生成）。不产生世界线",
		takesArgs: true,
		mode: "roleplay",
	},
	{
		name: "rewind",
		usage: "/rewind [N]",
		description: "回退 N 个用户轮（默认 1；撤销本轮讨论与正文改动）",
		takesArgs: true,
		mode: "all",
	},
	{
		name: "drop",
		usage: "/drop",
		description: "删掉最后一条角色回复或讨论（保留你的上一条输入，可改后再发）",
		takesArgs: false,
		mode: "all",
	},
	{
		name: "editreply",
		usage: "/editreply <正文>",
		description: "把最后一条角色回复改写成给定正文（不调用模型；原回复留在会话树）",
		takesArgs: true,
		mode: "roleplay",
	},
	{
		name: "greeting",
		usage: "/greeting [N|next|prev]",
		description: "切换开场白（会话未开聊时可即时替换；已开聊则记入下次新会话）",
		takesArgs: true,
		mode: "roleplay",
	},
	{
		name: "branch",
		usage: "/branch",
		description: "从当前剧情点开新分支（新会话文件，原线完整保留）",
		takesArgs: false,
		mode: "roleplay",
	},
	{
		name: "compact",
		usage: "/compact [额外说明]",
		description: "压缩较早对话为剧情向摘要，腾出上下文（可选附加摘要侧重点）",
		takesArgs: true,
		mode: "all",
	},
	{
		name: "store",
		usage: "/store [存档名]",
		description: "在当前剧情点钉一个存档（世界线节点 / 检查点快照）；省略名称则用默认名",
		takesArgs: true,
		mode: "all",
	},
	{
		name: "back",
		usage: "/back [存档名]",
		description: "回档到存档点（省略则回当前线上最近存档）；账本随树同步",
		takesArgs: true,
		mode: "roleplay",
	},
	{
		name: "line",
		usage: "/line",
		description: "查看世界线与存档时间线",
		takesArgs: false,
		mode: "roleplay",
	},
	{
		name: "state",
		usage: "/state",
		description: "查看当前世界状态与正文目录",
		takesArgs: false,
		mode: "all",
	},
	{
		name: "lore",
		usage: "/lore <关键词>",
		description: "检索世界书条目（检验某个说法能否命中设定）",
		takesArgs: true,
		mode: "roleplay",
	},
	{
		name: "import",
		usage: "/import <聊天.jsonl> [正文标签名]",
		description: "导入 ST 聊天记录续玩（解析→清洗→摘要→建账）",
		takesArgs: true,
		mode: "roleplay",
	},
	{
		name: "rp",
		usage: "/rp",
		description: "切换角色扮演模式（关闭后恢复 coding 工具）",
		takesArgs: false,
		mode: "roleplay",
	},
];

export const findCommand = (name: string): CommandMeta | undefined => RP_COMMANDS.find((c) => c.name === name);
