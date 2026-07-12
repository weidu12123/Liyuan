/**
 * 文生音：OpenAI 兼容 /v1/audio/speech + 本地 .liyuan-audio/ 落盘（纯函数侧，零 pi 依赖）。
 *
 * 配置（任选其一即可）：
 * - LIYUAN_TTS_BASE_URL + LIYUAN_TTS_API_KEY
 * - 或 OPENAI_API_KEY（base 默认 https://api.openai.com/v1）
 * 可选：LIYUAN_TTS_MODEL（默认 tts-1）、LIYUAN_TTS_VOICE（默认 alloy）
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface TtsConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
	voice: string;
}

export function loadTtsConfig(env: NodeJS.ProcessEnv = process.env): TtsConfig | null {
	const apiKey = (env.LIYUAN_TTS_API_KEY || env.OPENAI_API_KEY || "").trim();
	if (!apiKey) return null;
	const rawBase = (env.LIYUAN_TTS_BASE_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
	// 允许用户填到 /v1 或不带 /v1
	const baseUrl = rawBase.endsWith("/v1") ? rawBase : `${rawBase}/v1`;
	return {
		baseUrl,
		apiKey,
		model: (env.LIYUAN_TTS_MODEL || "tts-1").trim(),
		voice: (env.LIYUAN_TTS_VOICE || "alloy").trim(),
	};
}

export function ttsConfigHint(): string {
	return "未配置文生音。请设置环境变量 LIYUAN_TTS_API_KEY（或 OPENAI_API_KEY），可选 LIYUAN_TTS_BASE_URL / LIYUAN_TTS_MODEL / LIYUAN_TTS_VOICE。也可用外部技能生成音频文件后调用 show_audio 交付。";
}

/** 调用 OpenAI 兼容 speech API，返回音频二进制（默认 mp3） */
export async function synthesizeSpeech(
	config: TtsConfig,
	text: string,
	opts?: { voice?: string; model?: string },
): Promise<{ buffer: Buffer; ext: string }> {
	const input = text.trim();
	if (!input) throw new Error("配音文本为空");
	if (input.length > 4096) throw new Error("配音文本过长（最多约 4096 字），请分段");

	const url = `${config.baseUrl}/audio/speech`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			authorization: `Bearer ${config.apiKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model: opts?.model || config.model,
			voice: opts?.voice || config.voice,
			input,
			response_format: "mp3",
		}),
	});
	if (!res.ok) {
		const errText = await res.text().catch(() => "");
		throw new Error(`TTS 请求失败 HTTP ${res.status}${errText ? `：${errText.slice(0, 200)}` : ""}`);
	}
	const ab = await res.arrayBuffer();
	return { buffer: Buffer.from(ab), ext: ".mp3" };
}

export function audioDir(cwd: string): string {
	return join(cwd, ".liyuan-audio");
}

/** 内容寻址写入 .liyuan-audio/，返回可供前端使用的 /audio/ 路径 */
export function saveAudioBuffer(cwd: string, buffer: Buffer, ext = ".mp3"): { fileName: string; src: string; bytes: number } {
	const dir = audioDir(cwd);
	mkdirSync(dir, { recursive: true });
	const hash = createHash("md5").update(buffer).digest("hex").slice(0, 16);
	const safeExt = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
	const fileName = `${hash}${safeExt}`;
	const abs = join(dir, fileName);
	if (!existsSync(abs)) writeFileSync(abs, buffer);
	return { fileName, src: `/audio/${fileName}`, bytes: buffer.length };
}

/** 复制已有本地文件进 .liyuan-audio（show_audio 用） */
export function importLocalAudio(cwd: string, absPath: string, ext: string): { fileName: string; src: string } {
	const buffer = readFileSync(absPath);
	return saveAudioBuffer(cwd, buffer, ext);
}

/** 无内容时的占位名（测试用） */
export function randomAudioName(ext = ".mp3"): string {
	return `${randomBytes(8).toString("hex")}${ext}`;
}
