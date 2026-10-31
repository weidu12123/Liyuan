/**
 * 嵌入：local（零依赖哈希）| cloud（OpenAI 兼容 /v1/embeddings）
 * 与剧情连接配置分离，仅用 memory.cloudEmbed。
 */

import type { EmbedMode, MemoryCloudEmbed } from "./types.ts";

const LOCAL_EMBED_DIM = 256;

function hash32(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

function l2Normalize(v: number[]): number[] {
	let norm = 0;
	for (const x of v) norm += x * x;
	norm = Math.sqrt(norm) || 1;
	return v.map((x) => x / norm);
}

/** 本地：字符 bigram + 码点哈希 */
export function embedTextLocal(text: string, dim = LOCAL_EMBED_DIM): number[] {
	const v = new Float64Array(dim);
	const t = text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
	if (!t) return Array.from(v);

	for (let i = 0; i < t.length; i++) {
		const tok = t[i]!;
		const h = hash32(`u:${tok}`);
		v[h % dim]! += 1;
		v[(h >>> 8) % dim]! += 0.5;
	}
	for (let i = 0; i < t.length - 1; i++) {
		const tok = t.slice(i, i + 2);
		const h = hash32(`b:${tok}`);
		v[h % dim]! += 1.2;
	}
	for (const w of t.split(/[^\p{L}\p{N}]+/u)) {
		if (w.length < 2) continue;
		const h = hash32(`w:${w}`);
		v[h % dim]! += 1.5;
	}

	return l2Normalize(Array.from(v));
}

export function cosine(a: number[], b: number[]): number {
	const n = Math.min(a.length, b.length);
	let s = 0;
	for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
	return s;
}

function normalizeBaseUrl(baseUrl: string): string {
	let u = baseUrl.trim().replace(/\/+$/, "");
	// 允许用户写成 …/v1/embeddings
	if (u.endsWith("/embeddings")) u = u.slice(0, -"/embeddings".length);
	return u;
}

/**
 * 云端：POST {baseUrl}/embeddings
 * body: { model, input: string | string[] }
 * 兼容 OpenAI / 多数中转。
 */
export async function embedTextsCloud(
	texts: string[],
	cloud: MemoryCloudEmbed,
): Promise<number[][]> {
	const inputs = texts.map((t) => t.trim()).filter(Boolean);
	if (!inputs.length) return [];
	const base = normalizeBaseUrl(cloud.baseUrl || "");
	const key = (cloud.apiKey || "").trim();
	const model = (cloud.model || "").trim();
	if (!base) throw new Error("云端 embedding：请填写 Base URL");
	if (!key) throw new Error("云端 embedding：请填写 API Key");
	if (!model) throw new Error("云端 embedding：请填写模型名");

	const url = `${base}/embeddings`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${key}`,
		},
		body: JSON.stringify({
			model,
			input: inputs.length === 1 ? inputs[0] : inputs,
		}),
	});
	const raw = await res.text();
	if (!res.ok) {
		throw new Error(`云端 embedding HTTP ${res.status}：${raw.slice(0, 240)}`);
	}
	let data: { data?: Array<{ embedding?: number[]; index?: number }> };
	try {
		data = JSON.parse(raw) as typeof data;
	} catch {
		throw new Error("云端 embedding：响应不是 JSON");
	}
	const rows = Array.isArray(data.data) ? data.data : [];
	if (!rows.length) throw new Error("云端 embedding：空 data");
	// 按 index 排序（若有）
	rows.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
	const out: number[][] = [];
	for (const row of rows) {
		if (!Array.isArray(row.embedding) || !row.embedding.length) {
			throw new Error("云端 embedding：缺少 embedding 数组");
		}
		out.push(l2Normalize(row.embedding.map(Number)));
	}
	if (out.length !== inputs.length) {
		// 部分中转只回一条：广播禁止，严格要求条数一致
		throw new Error(`云端 embedding：期望 ${inputs.length} 条向量，得到 ${out.length}`);
	}
	return out;
}

export type EmbedContext = {
	mode: EmbedMode;
	cloud: MemoryCloudEmbed;
};

/** 按配置嵌入（单条） */
export async function embedOne(text: string, ctx: EmbedContext): Promise<number[]> {
	const t = text.trim();
	if (!t) return embedTextLocal("");
	if (ctx.mode === "cloud") {
		const [v] = await embedTextsCloud([t], ctx.cloud);
		return v ?? embedTextLocal(t);
	}
	return embedTextLocal(t);
}

/** 按配置批量嵌入 */
export async function embedMany(texts: string[], ctx: EmbedContext): Promise<number[][]> {
	const cleaned = texts.map((t) => t.trim()).filter(Boolean);
	if (!cleaned.length) return [];
	if (ctx.mode === "cloud") return embedTextsCloud(cleaned, ctx.cloud);
	return cleaned.map((t) => embedTextLocal(t));
}
