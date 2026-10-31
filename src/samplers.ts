/**
 * 预设采样参数 → 请求体投影（对齐 SillyTavern Chat Completion 行为 + 厂商官方约束）。
 *
 * 哲学（与 ST public/scripts/openai.js generate_data 一致）：
 * - UI / 预设里温度、top_k、rep_pen 等**常驻全套**，原样保存在 preset.samplers；
 * - 真正发请求时按渠道 / 模型**投影**：核心 OpenAI 键默认带，扩展键只给认它们的源；
 * - 某些模型（o1/o3、Kimi k2.5+ / k3…）会剥掉采样字段，不是「丢掉用户配置」。
 *
 * Kimi 固定采样：官方 platform.kimi.ai models-overview 写明 k2.5/k2.6/k2.7/k3
 * 的 temperature/top_p/penalties 固定，传其它值会 4xx；ST 目前仅特判 k2.5，
 * 此处以官方为准覆盖 k3 等新模型（含 opencode 等中转上的同名 id）。
 *
 * 默认对未知自定义中转走 openai-core（与 ST 的 CUSTOM 默认一致：不盲塞 top_k）。
 */

/** OpenAI Chat Completions 基线键（ST generate_data 默认始终带） */
const CORE_SAMPLER_KEYS = [
	"temperature",
	"top_p",
	"frequency_penalty",
	"presence_penalty",
] as const;

/**
 * 扩展采样键（ST 只对 OpenRouter / Claude / 本地后端等追加）。
 * 自定义中转默认不发，避免 Kimi/部分代理因非标字段空回或 4xx。
 */
const EXTENDED_SAMPLER_KEYS = [
	"top_k",
	"repetition_penalty",
	"min_p",
	"top_a",
] as const;

type SamplerMap = Record<string, number>;

export type SamplerProfile =
	/** 仅核心 4 键（OpenAI / DeepSeek / 默认自定义中转） */
	| "openai-core"
	/** 核心 + top_k / min_p / repetition_penalty / top_a（OpenRouter 等） */
	| "openrouter-ext"
	/** 核心 + top_k（Anthropic Messages） */
	| "anthropic"
	/** 核心 + top_k / repetition_penalty / min_p（本地 textgen / vLLM / Ollama 等） */
	| "textgen-ext"
	/** 不发任何采样（o 系列、部分 Kimi 等） */
	| "none";

interface SamplerTarget {
	/** 连接配置里的 provider id（cpa / deepseek / openrouter / moonshotai…） */
	provider?: string;
	/** 模型 id */
	modelId?: string;
	/** API 基址，用于启发式识别中转 */
	baseUrl?: string;
	/** pi Model.api：openai-completions / anthropic-messages / … */
	api?: string;
	/**
	 * 连接级额外放行的键（对应 ST custom_include_body 里用户显式要的字段名）。
	 * 仅当预设里也有该数值键时才会写入。
	 */
	includeKeys?: string[];
	/** 连接级强制排除（对应 ST custom_exclude_body） */
	excludeKeys?: string[];
}

const CORE_SET = new Set<string>(CORE_SAMPLER_KEYS);
const EXT_OPENROUTER = new Set<string>([
	...CORE_SAMPLER_KEYS,
	"top_k",
	"min_p",
	"repetition_penalty",
	"top_a",
]);
const EXT_ANTHROPIC = new Set<string>([...CORE_SAMPLER_KEYS, "top_k"]);
const EXT_TEXTGEN = new Set<string>([...CORE_SAMPLER_KEYS, "top_k", "repetition_penalty", "min_p"]);

function lower(s: string | undefined): string {
	return (s ?? "").trim().toLowerCase();
}

/**
 * 模型级：不接受（或固定）采样参数 → 请求体完全不带。
 * 匹配 id 本体与带前缀的中转名（如 moonshotai/kimi-k3、opencode 上的 kimi-k3）。
 */
function modelForbidsSampling(modelId: string | undefined): boolean {
	const id = lower(modelId);
	if (!id) return false;
	// OpenAI o 系列 / OpenRouter 上的 openai/o1…
	if (/(^|\/)(o1|o3|o4)([.-]|$)/.test(id)) return true;
	// Kimi 固定采样族：
	// - k2.5：ST openai.js MOONSHOT 分支 delete 四键
	// - k2.6 / k2.7(-code) / k3：官方 models-overview「Cannot be modified / omit」
	//   ST 尚未收录 k3，但官方传非固定值会 invalid_request_error
	if (/kimi-k2\.(5|6|7)/.test(id)) return true;
	if (/kimi-k3([.\-/]|$)/.test(id)) return true;
	// gpt-5 非 chat-latest：ST 多数路径剥采样（简化对齐）
	if (/gpt-5/.test(id) && !/chat-latest/.test(id) && !/gpt-5\.(1|2|3|4)/.test(id)) return true;
	return false;
}

/**
 * 解析渠道画像。优先 api / provider 名，再用 baseUrl 启发式；
 * 未知自定义中转 → openai-core（安全默认，与 ST CUSTOM 一致）。
 */
export function resolveSamplerProfile(target: SamplerTarget): SamplerProfile {
	if (modelForbidsSampling(target.modelId)) return "none";

	const provider = lower(target.provider);
	const api = lower(target.api);
	const base = lower(target.baseUrl);

	if (api === "anthropic-messages" || provider === "anthropic") return "anthropic";

	if (
		provider === "openrouter" ||
		base.includes("openrouter.ai") ||
		base.includes("openrouter")
	) {
		return "openrouter-ext";
	}

	// 本地 / 类 text-completion 扩展源（ST 会发 top_k + rep_pen）
	const textgenProviders = new Set([
		"together",
		"chutes",
		"vllm",
		"ollama",
		"featherless",
		"infermaticai",
		"nanogpt",
		"electronhub",
		"fireworks",
		"groq",
		"huggingface",
		"cloudflare-workers-ai",
		"workers-ai",
	]);
	if (textgenProviders.has(provider)) return "textgen-ext";
	if (
		base.includes("together.ai") ||
		base.includes("featherless") ||
		base.includes("ollama") ||
		base.includes("localhost") ||
		base.includes("127.0.0.1")
	) {
		return "textgen-ext";
	}

	// DeepSeek 官方：ST 只动 top_p 下限，不追加 top_k
	if (provider === "deepseek" || base.includes("deepseek")) return "openai-core";

	// Moonshot / Kimi 渠道：旧版 / 可调温模型走核心键
	// （k2.5+、k3 等固定采样模型已在 modelForbidsSampling → none）
	if (
		provider === "moonshotai" ||
		provider === "moonshotai-cn" ||
		provider === "kimi-coding" ||
		provider.includes("moonshot") ||
		base.includes("moonshot") ||
		base.includes("kimi")
	) {
		return "openai-core";
	}

	// 官方 OpenAI / Azure
	if (
		provider === "openai" ||
		provider === "azure-openai-responses" ||
		base.includes("api.openai.com") ||
		base.includes("openai.azure.com")
	) {
		return "openai-core";
	}

	// MiniMax / ZAI 等：ST 有特例，但键仍偏核心
	if (provider === "minimax" || provider === "minimax-cn" || provider === "zai" || provider === "zai-coding-cn") {
		return "openai-core";
	}

	// 其它自定义中转（cpa、weidu、longcat 等）：与 ST CUSTOM 相同——默认只发核心 4 键
	// 用户若需要 top_k，用 includeKeys 显式放行
	return "openai-core";
}

function allowedKeysForProfile(profile: SamplerProfile): Set<string> {
	switch (profile) {
		case "none":
			return new Set();
		case "openai-core":
			return new Set(CORE_SET);
		case "openrouter-ext":
			return new Set(EXT_OPENROUTER);
		case "anthropic":
			return new Set(EXT_ANTHROPIC);
		case "textgen-ext":
			return new Set(EXT_TEXTGEN);
		default:
			return new Set(CORE_SET);
	}
}

function clamp(n: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, n));
}

/**
 * 对单个键做 ST 风格规范化。返回 undefined 表示不要写入请求体。
 */
function normalizeSamplerValue(
	key: string,
	value: number,
	target: SamplerTarget,
): number | undefined {
	if (!Number.isFinite(value)) return undefined;
	const provider = lower(target.provider);

	switch (key) {
		case "temperature": {
			// MiniMax：(0, 1]（ST minimax 分支）
			if (provider.includes("minimax")) {
				return clamp(value, Number.EPSILON, 1);
			}
			// LongCat 官方：temperature ∈ [0, 1]；>1 秒拒 400（非「太重」，是参数校验）
			if (
				provider.includes("longcat") ||
				lower(target.baseUrl).includes("longcat")
			) {
				return clamp(value, 0, 1);
			}
			// 常见范围 [0, 2]；超出仍写入但钳一下，避免离谱值
			return clamp(value, 0, 2);
		}
		case "top_p": {
			// DeepSeek：0 会出问题，ST 用 EPSILON
			if ((provider === "deepseek" || lower(target.baseUrl).includes("deepseek")) && value <= 0) {
				return Number.EPSILON;
			}
			// Cohere 风格 0.01–0.99；通用钳到 (0, 1]
			if (value <= 0) return Number.EPSILON;
			return clamp(value, Number.EPSILON, 1);
		}
		case "frequency_penalty":
		case "presence_penalty":
			// OpenAI 允许约 [-2, 2]；Cohere 更严，这里用宽钳
			return clamp(value, -2, 2);
		case "top_k": {
			// ST Workers/Chutes：>0 才发；0 表示「不用」
			if (value <= 0) return undefined;
			// Workers AI 上限 50；其它放宽到 200
			const max = provider.includes("worker") ? 50 : 200;
			return Math.min(Math.round(value), max);
		}
		case "repetition_penalty":
			// 1 = 无惩罚，常见合法；负数无意义
			if (value <= 0) return undefined;
			return value;
		case "min_p":
		case "top_a":
			if (value < 0) return undefined;
			return value;
		default:
			return value;
	}
}

/**
 * 将预设中的全套 samplers 投影为当前请求应携带的键值。
 * 不修改入参；预设文件里的值保持完整。
 */
export function projectSamplers(samplers: SamplerMap, target: SamplerTarget = {}): SamplerMap {
	if (!samplers || typeof samplers !== "object") return {};

	const profile = resolveSamplerProfile(target);
	const allowed = allowedKeysForProfile(profile);

	// 连接级 include：在预设也有该键时额外放行（ST custom_include_body）
	const include = new Set((target.includeKeys ?? []).map((k) => k.trim()).filter(Boolean));
	const exclude = new Set((target.excludeKeys ?? []).map((k) => k.trim()).filter(Boolean));

	const out: SamplerMap = {};
	for (const [key, raw] of Object.entries(samplers)) {
		if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
		if (exclude.has(key)) continue;
		const permitted = allowed.has(key) || include.has(key);
		if (!permitted) continue;
		const normalized = normalizeSamplerValue(key, raw, target);
		if (normalized === undefined) continue;
		out[key] = normalized;
	}
	return out;
}

/**
 * 把投影结果合并进 provider payload。
 * - 预设声明过、但本渠道不发的键：从 payload 删除（防止盲塞残留）
 * - 投影结果覆盖写入
 */
export function applyProjectedSamplers(
	payload: Record<string, unknown>,
	samplers: SamplerMap,
	target: SamplerTarget = {},
): Record<string, unknown> {
	const projected = projectSamplers(samplers, target);
	const profile = resolveSamplerProfile(target);
	const out: Record<string, unknown> = { ...payload };

	for (const key of Object.keys(samplers)) {
		if (!(key in projected)) delete out[key];
	}
	// 扩展键即使预设没写，也不该在 openai-core 渠道残留
	for (const key of EXTENDED_SAMPLER_KEYS) {
		if (!(key in projected)) delete out[key];
	}
	// none：引擎/payload 里可能已有 temperature 等默认值，按官方要求一并剥离
	if (profile === "none") {
		for (const key of CORE_SAMPLER_KEYS) {
			if (!(key in projected)) delete out[key];
		}
	}

	return { ...out, ...projected };
}
