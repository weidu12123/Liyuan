/**
 * 台上媒体交付（8/06 重接）：show_image / show_audio / show_video / show_html / tts。
 *
 * 背景与 MCP 同源——这批工具原本只挂在 `.liyuan/extensions/roleplay.ts`（pi.registerTool），
 * 009e22e 换引擎后台上不可达。**消费端一直健在**（server/wire.ts:344-394 认
 * `details.rpImage/rpAudio/rpVideo/rpHtml`，src/activity-format.ts 备好过程条文案），
 * 断的只是生产端——收货的人在岗，发货的人没了。
 *
 * 交付契约（必须与 wire.ts 逐字对齐，否则前端收不到）：
 * - show_image → `details.rpImage  = { src, caption? }`
 * - show_audio → `details.rpAudio  = { src, caption? }`
 * - tts        → `details.rpAudio  = { src, caption }`（与 show_audio 同一通道）
 * - show_video → `details.rpVideo  = { src, caption? }`
 * - show_html  → `details.rpHtml   = { html, title?, scripts }`
 * 且 `isError !== true`——wire 层对出错结果一律不出媒体帧。
 *
 * 本地文件一律复制进 `.liyuan-media/`（内容寻址命名）后以 `/media/<hash>.<ext>` 交付：
 * 会话可携带展示历史，原文件删了也不影响回看。
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";

import { dir } from "../paths.ts";
import { importLocalAudio, loadTtsConfig, saveAudioBuffer, synthesizeSpeech, ttsConfigHint } from "../tts.ts";

/** 与 StageTool 同形（裸 JSON Schema，不经 typebox） */
export interface MediaStageTool {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

/** 与 tools.ts 的工具结果同形，另带 details（wire 层据此出媒体帧） */
export interface MediaStageResult {
	text: string;
	activity?: string;
	isError?: boolean;
	details?: Record<string, unknown>;
}

const STR = { type: "string" } as const;

const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"];
const AUDIO_EXTS = [".mp3", ".wav", ".ogg", ".m4a", ".webm", ".aac", ".flac"];
const VIDEO_EXTS = [".mp4", ".webm", ".mov", ".mkv", ".ogv", ".m4v"];

const MAX_HTML = 500_000;

const isHttp = (s: string): boolean => /^https?:\/\//i.test(s);
const resolveLocal = (cwd: string, p: string): string => (isAbsolute(p) ? p : join(cwd, p));

/**
 * 本机文件 → `/media/<md5>.<ext>`。内容寻址：同一文件反复展示只存一份。
 * 返回 null 表示校验失败（不存在/格式不支持），调用方回错误结果。
 */
function importToMedia(cwd: string, source: string, allowed: string[]): { src: string } | { error: string } {
	const abs = resolveLocal(cwd, source);
	if (!existsSync(abs)) return { error: `文件不存在：${abs}` };
	const ext = extname(abs).toLowerCase();
	if (!allowed.includes(ext)) return { error: `不支持的格式：${ext || "（无扩展名）"}（支持 ${allowed.join(" ")}）` };
	const mediaDir = dir(cwd, "media");
	mkdirSync(mediaDir, { recursive: true });
	const name = `${createHash("md5").update(readFileSync(abs)).digest("hex").slice(0, 16)}${ext}`;
	const dest = join(mediaDir, name);
	if (!existsSync(dest)) copyFileSync(abs, dest);
	return { src: `/media/${name}` };
}

/**
 * 媒体工具清单。tts 需要服务端 TTS 环境——**未配置就不上清单**
 * （依赖缺失的工具不上清单：工具存在却恒回「本环境不支持」是最糟形态，模型会反复试）。
 */
export function mediaStageTools(_language: string, opts?: { tts?: boolean }): MediaStageTool[] {
	const tools: MediaStageTool[] = [
		{
			name: "show_image",
			description:
				`把一张图片交付到对话里给用户看（显示在正文下方，与正文明确区隔）。` +
				`用户要图（你刚用外部服务生成的、或本机已有的）就用它交付——**不要只把链接当文字贴出来**，那样用户看不到图。` +
				`source 给 http(s) 图片地址，或本机图片路径（${IMAGE_EXTS.join("/")}）。`,
			parameters: {
				type: "object",
				properties: {
					source: { ...STR, description: "http(s) 图片地址，或本机图片文件路径" },
					caption: { ...STR, description: "图片下方的简短说明（可选）" },
				},
				required: ["source"],
			},
		},
		{
			name: "show_audio",
			description:
				`在对话里放一个音频播放器交付声音文件（配乐/音效/已有配音）。` +
				`同样**不要只贴链接**。文字转语音请用 tts，不是本工具。` +
				`source 给 http(s) 音频地址，或本机音频路径（${AUDIO_EXTS.join("/")}）。`,
			parameters: {
				type: "object",
				properties: {
					source: { ...STR, description: "http(s) 音频地址，或本机音频文件路径" },
					caption: { ...STR, description: "播放器下方的简短标签（可选）" },
				},
				required: ["source"],
			},
		},
		{
			name: "show_video",
			description:
				`在对话里放一个视频播放器交付短视频。同样**不要只贴链接**。` +
				`source 给 http(s) 视频地址，或本机视频路径（${VIDEO_EXTS.join("/")}）。`,
			parameters: {
				type: "object",
				properties: {
					source: { ...STR, description: "http(s) 视频地址，或本机视频文件路径" },
					caption: { ...STR, description: "播放器下方的简短说明（可选）" },
				},
				required: ["source"],
			},
		},
		{
			name: "show_html",
			description:
				`在对话流里嵌入一小块自定义 HTML 界面（手机短信框、状态卡、小地图、简易互动组件等），` +
				`显示在正文下方并与正文区隔。传完整 HTML（片段或整份文档均可）。` +
				`界面需要 JavaScript 时把 scripts 设为 true（在沙箱 iframe 里跑，碰不到宿主页面）。` +
				`**别把 HTML 源码当正文写出来**——那样用户看到的是一堆标签。` +
				`侧栏常驻面板请用 panel_write，不是本工具。`,
			parameters: {
				type: "object",
				properties: {
					html: { ...STR, description: "要渲染的 HTML 文档或片段" },
					title: { ...STR, description: "框上方的简短标题（可选）" },
					scripts: { type: "boolean", description: "true=允许 iframe 内执行 JS（仍在沙箱内）；默认 false" },
				},
				required: ["html"],
			},
		},
	];
	if (opts?.tts) {
		tools.push({
			name: "tts",
			description:
				`文字转语音：把一段台词/旁白合成语音，并在对话里放出播放器。` +
				`用户要求配音/朗读/生成语音时用。一次给一段话，别把整章丢进来。`,
			parameters: {
				type: "object",
				properties: {
					text: { ...STR, description: "要朗读的文字（一段台词或旁白，不要整章）" },
					caption: { ...STR, description: "播放器下方的标签（可选）" },
					voice: { ...STR, description: "音色 id（供应商支持时，如 alloy / nova）" },
				},
				required: ["text"],
			},
		});
	}
	return tools;
}

/** 台上媒体工具名（引擎据此路由） */
export function mediaStageToolNames(opts?: { tts?: boolean }): Set<string> {
	return new Set(mediaStageTools("中文", opts).map((t) => t.name));
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * 执行一次媒体工具。工具名不属本族返回 null（调用方回落其他派发）。
 * cwd 用于解析本机路径与定位 .liyuan-media/。
 */
export async function runMediaStageTool(
	cwd: string,
	name: string,
	args: Record<string, unknown>,
): Promise<MediaStageResult | null> {
	const caption = str(args.caption).trim();

	switch (name) {
		case "show_image":
		case "show_audio":
		case "show_video": {
			const kindMap = {
				show_image: { label: "图片", exts: IMAGE_EXTS, key: "rpImage", done: "图片已在对话中展示给用户。" },
				show_audio: { label: "音频", exts: AUDIO_EXTS, key: "rpAudio", done: "音频已在对话中展示给用户（可播放）。" },
				show_video: { label: "视频", exts: VIDEO_EXTS, key: "rpVideo", done: "视频已在对话中展示给用户（可播放）。" },
			} as const;
			const kind = kindMap[name];
			const source = str(args.source).trim();
			if (!source) return { text: `${kind.label}交付失败：source 不能为空。`, isError: true };

			let src: string;
			if (isHttp(source)) {
				src = source;
			} else if (name === "show_audio") {
				// 音频复用 tts.ts 的落盘（与 tts 产物同目录同命名规则）
				const abs = resolveLocal(cwd, source);
				if (!existsSync(abs)) return { text: `音频文件不存在：${abs}`, isError: true };
				const ext = extname(abs).toLowerCase();
				if (!AUDIO_EXTS.includes(ext)) {
					return { text: `不支持的音频格式：${ext || "（无扩展名）"}`, isError: true };
				}
				src = importLocalAudio(cwd, abs, ext).src;
			} else {
				const r = importToMedia(cwd, source, kind.exts);
				if ("error" in r) return { text: `${kind.label}交付失败：${r.error}`, isError: true };
				src = r.src;
			}
			return {
				text: kind.done,
				activity: `${kind.label}已交付`,
				details: { [kind.key]: { src, ...(caption ? { caption } : {}) } },
			};
		}

		case "show_html": {
			const html = str(args.html);
			if (!html.trim()) return { text: "html 不能为空。", isError: true };
			if (html.length > MAX_HTML) {
				return { text: `html 过大（${html.length} 字符，上限 ${MAX_HTML}）。`, isError: true };
			}
			const title = str(args.title).trim();
			return {
				text: "HTML 界面已在对话中展示给用户。",
				activity: title ? `已展示界面「${title}」` : "已展示 HTML 界面",
				details: {
					rpHtml: { html, ...(title ? { title } : {}), scripts: args.scripts === true },
				},
			};
		}

		case "tts": {
			const text = str(args.text).trim();
			if (!text) return { text: "text 不能为空。", isError: true };
			const cfg = loadTtsConfig();
			if (!cfg) return { text: ttsConfigHint(), isError: true };
			try {
				const voice = str(args.voice).trim();
				const { buffer, ext } = await synthesizeSpeech(cfg, text, { ...(voice ? { voice } : {}) });
				const saved = saveAudioBuffer(cwd, buffer, ext);
				return {
					text: `已生成语音并展示（${saved.bytes} 字节）。`,
					activity: "语音已生成并交付",
					// tts 与 show_audio 共用 rpAudio 通道；caption 缺省用原文前 40 字
					details: { rpAudio: { src: saved.src, caption: caption || text.slice(0, 40) } },
				};
			} catch (err) {
				return { text: err instanceof Error ? err.message : String(err), isError: true };
			}
		}

		default:
			return null;
	}
}
