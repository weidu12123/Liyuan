#!/usr/bin/env node
/**
 * 梨园内置视觉 MCP（随发布包走）：给无视觉能力的主模型补一双眼睛。
 * 仿 zai-mcp-server：stdio 传输，把图片交给任意 OpenAI 兼容的视觉模型分析，返回文字。
 *
 * 配置（env，可在 扩展 → MCP → 内置 里编辑 JSON 填写）：
 *   LIYUAN_VISION_BASE_URL   OpenAI 兼容 API 地址（如 https://api.example.com/v1）
 *   LIYUAN_VISION_API_KEY    API Key
 *   LIYUAN_VISION_MODEL      视觉模型 id（须支持图片输入）
 *   LIYUAN_VISION_MAX_TOKENS 可选，默认 2048
 *   LIYUAN_VISION_TIMEOUT_MS 可选，默认 90000
 *
 * stdio 纪律：stdout 只走 MCP 协议，日志一律 stderr。
 */

import { readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const MAX_IMAGE_MB = 12;

const MIME_BY_EXT = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".bmp": "image/bmp",
	".avif": "image/avif",
};

function log(msg) {
	process.stderr.write(`[liyuan-vision] ${msg}\n`);
}

function envConfig() {
	const baseUrl = (process.env.LIYUAN_VISION_BASE_URL ?? "").trim();
	const apiKey = (process.env.LIYUAN_VISION_API_KEY ?? "").trim();
	const model = (process.env.LIYUAN_VISION_MODEL ?? "").trim();
	const maxTokens = Number.parseInt(process.env.LIYUAN_VISION_MAX_TOKENS ?? "", 10);
	const timeoutMs = Number.parseInt(process.env.LIYUAN_VISION_TIMEOUT_MS ?? "", 10);
	return {
		baseUrl,
		apiKey,
		model,
		maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 2048,
		timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 90_000,
	};
}

/** base url → chat/completions 完整地址（容忍带不带 /v1、末尾斜杠、直接给全路径） */
function completionsUrl(baseUrl) {
	const b = baseUrl.replace(/\/+$/, "");
	if (/\/chat\/completions$/.test(b)) return b;
	return `${b}/chat/completions`;
}

const IS_EN = process.env.LIYUAN_UI_LOCALE === "en";

function missingConfigError() {
	const c = envConfig();
	const missing = [];
	if (!c.baseUrl) missing.push("LIYUAN_VISION_BASE_URL");
	if (!c.apiKey) missing.push("LIYUAN_VISION_API_KEY");
	if (!c.model) missing.push("LIYUAN_VISION_MODEL");
	if (missing.length === 0) return null;
	if (IS_EN) {
		return (
			`Vision MCP is not configured (missing ${missing.join(" / ")}).\n` +
			`Open Extensions -> MCP -> Built-in -> Vision -> Edit, and set in JSON env:\n` +
			`  LIYUAN_VISION_BASE_URL=OpenAI-compatible API URL (e.g. https://api.example.com/v1)\n` +
			`  LIYUAN_VISION_API_KEY=your API key\n` +
			`  LIYUAN_VISION_MODEL=vision-capable model id\n` +
			`Save and re-toggle it for this session to take effect.`
		);
	}
	return (
		`视觉 MCP 尚未配置（缺 ${missing.join(" / ")}）。\n` +
		`请在 扩展 → MCP → 内置 → 视觉识图 → 编辑，在 JSON 的 env 里填入：\n` +
		`  LIYUAN_VISION_BASE_URL=OpenAI 兼容 API 地址（如 https://api.example.com/v1）\n` +
		`  LIYUAN_VISION_API_KEY=你的 key\n` +
		`  LIYUAN_VISION_MODEL=支持图片输入的模型 id\n` +
		`保存后重开一次本对话的开关即可生效。`
	);
}

/** 图片源 → chat.completions 的 image_url 内容块。本地文件读入转 data URI；URL / data: 直接透传 */
function toImageContent(source) {
	const s = String(source ?? "").trim();
	if (!s) throw new Error(IS_EN ? "image_source is empty" : "image_source 为空");
	if (s.startsWith("data:")) return { type: "image_url", image_url: { url: s } };
	if (/^https?:\/\//i.test(s)) return { type: "image_url", image_url: { url: s } };
	const abs = resolve(process.cwd(), s);
	let st;
	try {
		st = statSync(abs);
	} catch {
		throw new Error(IS_EN ? `Image file not found: ${abs}` : `图片文件不存在：${abs}`);
	}
	if (!st.isFile()) throw new Error(IS_EN ? `Not a file: ${abs}` : `不是文件：${abs}`);
	if (st.size > MAX_IMAGE_MB * 1024 * 1024) {
		throw new Error(
			IS_EN
				? `Image exceeds ${MAX_IMAGE_MB}MB (${(st.size / 1024 / 1024).toFixed(1)}MB): ${abs}`
				: `图片超过 ${MAX_IMAGE_MB}MB（${(st.size / 1024 / 1024).toFixed(1)}MB）：${abs}`,
		);
	}
	const data = readFileSync(abs);
	const mime = MIME_BY_EXT[extname(abs).toLowerCase()] ?? sniffMime(data) ?? "image/png";
	return { type: "image_url", image_url: { url: `data:${mime};base64,${data.toString("base64")}` } };
}

/** 无扩展名时按魔数猜 mime */
function sniffMime(buf) {
	if (buf.length < 12) return null;
	if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
	if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
	if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
	if (buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
	return null;
}

/** 调视觉模型（OpenAI chat/completions）。网络/5xx 失败自动重试一次 */
async function visionCompletion(systemPrompt, userContent) {
	const cfgErr = missingConfigError();
	if (cfgErr) throw new Error(cfgErr);
	const c = envConfig();
	const url = completionsUrl(c.baseUrl);
	const body = JSON.stringify({
		model: c.model,
		stream: false,
		max_tokens: c.maxTokens,
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userContent },
		],
	});

	let lastErr = null;
	for (let attempt = 0; attempt < 2; attempt++) {
		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(), c.timeoutMs);
		try {
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.apiKey}` },
				body,
				signal: ac.signal,
			});
			clearTimeout(timer);
			if (!res.ok) {
				const text = (await res.text().catch(() => "")).slice(0, 600);
				const err = new Error(IS_EN ? `Vision API HTTP ${res.status}: ${text || res.statusText}` : `视觉 API HTTP ${res.status}：${text || res.statusText}`);
				// 4xx 是配置/请求问题，重试无意义
				if (res.status < 500) throw err;
				lastErr = err;
				continue;
			}
			const json = await res.json();
			const msg = json?.choices?.[0]?.message;
			const content =
				typeof msg?.content === "string"
					? msg.content
					: Array.isArray(msg?.content)
						? msg.content.map((p) => (typeof p?.text === "string" ? p.text : "")).join("")
						: "";
			if (!content.trim()) throw new Error(IS_EN ? "Vision API returned empty content" : "视觉 API 返回为空（无 message.content）");
			return content.trim();
		} catch (e) {
			clearTimeout(timer);
			if (e?.name === "AbortError") {
				lastErr = new Error(IS_EN ? `Vision API timed out (${c.timeoutMs}ms): ${url}` : `视觉 API 超时（${c.timeoutMs}ms）：${url}`);
				continue;
			}
			// 明确的 HTTP 4xx / 配置错误直接抛
			if (e instanceof Error && /HTTP 4\d\d|尚未配置|not configured/.test(e.message)) throw e;
			lastErr = e instanceof Error ? e : new Error(String(e));
		}
	}
	throw lastErr ?? new Error(IS_EN ? "Vision API call failed" : "视觉 API 调用失败");
}

const ANALYZE_SYSTEM = IS_EN
	? "You are a precise vision analysis assistant. Inspect the image carefully and answer the user's question in English (or the language of their prompt). Be concrete (appearance/clothing/pose, scene, text, composition, style, colors as relevant); state uncertainty explicitly rather than fabricating."
	: "你是一个精确的视觉分析助手。仔细观察图片，用中文回答使用者的问题。" +
		"描述要具体（人物外貌/服饰/姿态、场景、文字、构图、风格、颜色等按需覆盖），不确定的内容明确说不确定，不要编造。";

const OCR_SYSTEM = IS_EN
	? "You are an OCR assistant. Extract all visible text from the image verbatim, preserving layout structure (paragraphs/tables/lists) without translating, summarizing, or commenting. Use ⍰ for illegible characters. If there is no text, reply: (no text in image)."
	: "你是一个 OCR 助手。逐字提取图片中的全部可见文字，保持原有排版结构（段落/表格/列表），" +
		"不翻译、不概括、不添加评论。无法辨认的字用 ⍰ 占位。若图中没有文字，回答：（图中无文字）。";

const TOOLS = [
	{
		name: "analyze_image",
		description: IS_EN
			? "Inspect an image with a vision model and return a text description. Use whenever the main model lacks vision and needs to understand an image (user uploads, character portraits, generated art, screenshots). image_source accepts a local path (e.g. .liyuan-uploads/xxx.png), http(s) URL, or data URI; use image_sources for comparing multiple images."
			: "看图 / 识图：把图片交给视觉模型分析并返回文字描述。主模型没有视觉能力时，凡需要理解图片内容（用户发来的图、角色卡立绘、生成结果、截图等）都用这个。" +
				"image_source 支持本地路径（如 .liyuan-uploads/xxx.png）、http(s) URL 或 data URI；多图对比用 image_sources。",
		inputSchema: {
			type: "object",
			properties: {
				image_source: { type: "string", description: IS_EN ? "Image source: local file path / http(s) URL / data URI" : "图片来源：本地文件路径 / http(s) URL / data URI" },
				image_sources: {
					type: "array",
					items: { type: "string" },
					description: IS_EN ? "Optional: analyze multiple images together (alternative or addition to image_source)" : "可选：多张图片一起分析（与 image_source 二选一或并用）",
				},
				prompt: { type: "string", description: IS_EN ? "What to analyze: the more specific, the more useful the output" : "要分析什么：描述得越具体，返回越有用" },
			},
			required: ["prompt"],
		},
	},
	{
		name: "extract_image_text",
		description: IS_EN
			? "OCR: extract visible text from an image verbatim (preserving layout, without summarizing). image_source accepts a local path / http(s) URL / data URI."
			: "OCR：逐字提取图片中的文字（保持排版，不概括）。image_source 支持本地路径 / http(s) URL / data URI。",
		inputSchema: {
			type: "object",
			properties: {
				image_source: { type: "string", description: IS_EN ? "Image source: local file path / http(s) URL / data URI" : "图片来源：本地文件路径 / http(s) URL / data URI" },
			},
			required: ["image_source"],
		},
	},
];

function textResult(text, isError = false) {
	return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

async function handleAnalyze(args) {
	const sources = [];
	if (typeof args?.image_source === "string" && args.image_source.trim()) sources.push(args.image_source);
	if (Array.isArray(args?.image_sources)) {
		for (const s of args.image_sources) if (typeof s === "string" && s.trim()) sources.push(s);
	}
	if (sources.length === 0) return textResult(IS_EN ? "Missing image_source (or image_sources)" : "缺少 image_source（或 image_sources）", true);
	const prompt = typeof args?.prompt === "string" && args.prompt.trim()
		? args.prompt.trim()
		: (IS_EN ? "Describe the contents of this image in detail." : "详细描述这张图片的内容。");
	const content = [...sources.map(toImageContent), { type: "text", text: prompt }];
	const out = await visionCompletion(ANALYZE_SYSTEM, content);
	return textResult(out);
}

async function handleOcr(args) {
	const src = typeof args?.image_source === "string" ? args.image_source : "";
	const content = [toImageContent(src), { type: "text", text: IS_EN ? "Extract all text from this image." : "提取图片中的全部文字。" }];
	const out = await visionCompletion(OCR_SYSTEM, content);
	return textResult(out);
}

const server = new Server({ name: "liyuan-vision", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
	const { name, arguments: args } = req.params;
	try {
		if (name === "analyze_image") return await handleAnalyze(args ?? {});
		if (name === "extract_image_text") return await handleOcr(args ?? {});
		return textResult(IS_EN ? `Unknown tool: ${name}` : `未知工具：${name}`, true);
	} catch (e) {
		return textResult(e instanceof Error ? e.message : String(e), true);
	}
});

const transport = new StdioServerTransport();
await server.connect(transport);
log("ready (stdio)");
