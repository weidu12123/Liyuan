/**
 * 梨园内置向量记忆（设置面板一等公民，非 Skill/MCP 栏）。
 * 两库：
 *  - narrative 剧情库：仅 agent 自动写入，合并入库（少条数）
 *  - external 额外库：导入文件 + 手动向量化（每条独立条目，可管理删除）
 * 嵌入：本地规则 / 云端专用 embedding（与 RP 连接分离）
 * 数据作用域：角色卡 + 对话会话
 */

type MemoryStoreKind = "narrative" | "external" | "custom";

/**
 * 记忆数据作用域（与世界状态 / 面板同款：按会话隔离）。
 * sessionId = 当前对话；card = 角色卡路径（相对或绝对均可，内部会归一化）。
 */
export interface MemoryScope {
	sessionId: string;
	card?: string;
	/**
	 * 子项目目录（`cards/<卡>/对话/<id>/`）。给了就把向量库落在子项目里
	 * （`<子项目>/向量记忆/stores/…`），一个子项目一份；没给＝老布局，
	 * 仍按 `<cardHash10>__<sessionId>` 落在全局 `.liyuan-memory/scopes/` 下。
	 */
	chatDir?: string;
}

/** 嵌入模式：local=本机规则；cloud=OpenAI 兼容 embeddings 接口 */
export type EmbedMode = "local" | "cloud";

export interface MemoryCloudEmbed {
	/** 如 https://api.openai.com/v1 或中转 …/v1（不要带 /embeddings） */
	baseUrl: string;
	apiKey: string;
	/** 如 text-embedding-3-small */
	model: string;
}

export interface MemoryStoreConfig {
	id: string;
	name: string;
	kind: MemoryStoreKind;
	/** 单库开关（总开关关闭时全部不写不搜） */
	enabled: boolean;
	/**
	 * 仅 narrative：每隔多少次「助手叙事完成」合并入库。
	 * 1=每轮；3=每 3 轮；0=不自动写。剧情库禁止手动/导入。
	 */
	everyNTurns: number;
	/** 单库最大条数，超则丢最旧 */
	maxChunks: number;
}

export interface MemoryConfig {
	version: 1;
	/** 总开关：关=服务空转，不读写 */
	enabled: boolean;
	/** 检索默认条数（试检索 / 每轮注入） */
	searchTopK: number;
	/**
	 * 每轮剧情开始前，用用户本轮输入检索已启用库并注入【剧情记忆】。
	 * 总开关关闭时无效。
	 */
	injectOnTurn: boolean;
	/** 嵌入模式 */
	embedMode: EmbedMode;
	/** 云端 embedding（仅 embedMode=cloud；与剧情模型配置完全分离） */
	cloudEmbed: MemoryCloudEmbed;
	stores: MemoryStoreConfig[];
	/** 作用域维度计数：scopeId → 累计 agent_end 次数 */
	turnCounters?: Record<string, number>;
}

export interface MemoryChunkMeta {
	sessionId?: string;
	card?: string;
	source?: "narrative" | "import" | "manual" | "archive";
	title?: string;
	/** 导入文件名 */
	fileName?: string;
	/** 写入时的嵌入模式，检索时混用会质量差 */
	embedMode?: EmbedMode;
	embedModel?: string;
	/** 合并入库次数（剧情库） */
	mergeCount?: number;
	/**
	 * 归档时所在的会话树节点 id（剧情库专用，8/29 补）。
	 * 向量库此前只按 {卡, 会话} 存，没有分支这一维——重roll/rewind 丢弃的那一拍照样入库，
	 * 下一拍又被召回，模型于是把废弃分支当「上一拍」续写。树/账本/面板本来都是 f(分支)，
	 * 这里补上同一坐标：只有该节点仍在当前分支的祖先链上，这条记忆才可见。
	 * 老条目无此字段 → 一律放行（见 service.ts 的 onCurrentBranch）。
	 */
	nodeId?: string;
	/** 最后更新时间 ISO */
	updatedAt?: string;
}

export interface MemoryChunk {
	id: string;
	text: string;
	/** L2 归一化向量 */
	embedding: number[];
	meta: MemoryChunkMeta;
	createdAt: string;
}

/** 列表用（不回传 embedding，省流量） */
export interface MemoryChunkListItem {
	id: string;
	text: string;
	textLen: number;
	meta: MemoryChunkMeta;
	createdAt: string;
}

export interface MemorySearchHit {
	id: string;
	text: string;
	score: number;
	meta: MemoryChunkMeta;
	createdAt: string;
}

export interface MemoryStoreStats {
	id: string;
	name: string;
	kind: MemoryStoreKind;
	enabled: boolean;
	everyNTurns: number;
	chunkCount: number;
	maxChunks: number;
}

export const DEFAULT_CLOUD_EMBED: MemoryCloudEmbed = {
	baseUrl: "https://api.openai.com/v1",
	apiKey: "",
	model: "text-embedding-3-small",
};

/** 剧情合并条目的软上限（字），超则新开一条 */
export const NARRATIVE_MERGE_MAX_CHARS = 1800;

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
	version: 1,
	enabled: false,
	searchTopK: 5,
	injectOnTurn: true,
	embedMode: "local",
	cloudEmbed: { ...DEFAULT_CLOUD_EMBED },
	stores: [
		{
			id: "narrative",
			name: "剧情数据库",
			kind: "narrative",
			enabled: true,
			everyNTurns: 3,
			maxChunks: 200,
		},
		{
			id: "external",
			name: "额外数据库",
			kind: "external",
			enabled: true,
			everyNTurns: 0,
			maxChunks: 5000,
		},
	],
	turnCounters: {},
};
