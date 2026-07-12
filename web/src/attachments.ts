/**
 * 附件随消息：文件已落盘后，路径清单附在消息尾行。
 * 支持两类目录：
 * - .liyuan-uploads/  用户上传
 * - .liyuan-media/    AI show_image 等本地图片
 * 附到消息 = 只写路径，不再次上传；agent 用 read 读已有文件。
 */

export interface AttachmentView {
	/** 相对服务端 cwd 的路径 */
	file: string;
	/** 目录内文件名 */
	name: string;
	/** 显示名 */
	label: string;
	image: boolean;
	/** 来源目录 */
	kind: "upload" | "media";
}

const PREFIX = "（附件：";
const SUFFIX = "）";
export const UPLOAD_DIR = ".liyuan-uploads/";
export const MEDIA_DIR = ".liyuan-media/";
/** 历史消息兼容 */
export const UPLOAD_DIR_LEGACY = ".rp-uploads/";
export const MEDIA_DIR_LEGACY = ".rp-media/";
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

export function isAttachPath(file: string): boolean {
	return (
		file.startsWith(UPLOAD_DIR) ||
		file.startsWith(MEDIA_DIR) ||
		file.startsWith(UPLOAD_DIR_LEGACY) ||
		file.startsWith(MEDIA_DIR_LEGACY)
	);
}

export function toAttachmentView(file: string): AttachmentView {
	let name = file;
	let kind: AttachmentView["kind"] = "upload";
	if (file.startsWith(UPLOAD_DIR) || file.startsWith(UPLOAD_DIR_LEGACY)) {
		name = file.startsWith(UPLOAD_DIR) ? file.slice(UPLOAD_DIR.length) : file.slice(UPLOAD_DIR_LEGACY.length);
		kind = "upload";
	} else if (file.startsWith(MEDIA_DIR) || file.startsWith(MEDIA_DIR_LEGACY)) {
		name = file.startsWith(MEDIA_DIR) ? file.slice(MEDIA_DIR.length) : file.slice(MEDIA_DIR_LEGACY.length);
		kind = "media";
	}
	return {
		file,
		name,
		label: kind === "upload" ? name.replace(/^\d{8}-\d{6}-/, "") : name,
		image: IMAGE_RE.test(name),
		kind,
	};
}

/** 附件 HTTP 地址（与 static 托管一致） */
export function attachmentUrl(a: AttachmentView): string {
	if (a.kind === "media" || a.file.startsWith(MEDIA_DIR)) {
		return `/media/${a.name.split("/").map(encodeURIComponent).join("/")}`;
	}
	return `/uploads/${encodeURIComponent(a.name)}`;
}

/** 组装消息尾行 */
export function buildAttachmentLine(files: string[]): string {
	return `${PREFIX}${files.join("、")}${SUFFIX}`;
}

/** 拆出正文与附件（末行不是合法附件行时原样返回） */
export function splitAttachments(text: string): { body: string; attachments: AttachmentView[] } {
	const lines = text.split("\n");
	const last = lines[lines.length - 1]?.trim() ?? "";
	if (last.startsWith(PREFIX) && last.endsWith(SUFFIX)) {
		const items = last
			.slice(PREFIX.length, last.length - SUFFIX.length)
			.split("、")
			.map((s) => s.trim())
			.filter(Boolean);
		if (items.length > 0 && items.every(isAttachPath)) {
			return { body: lines.slice(0, -1).join("\n").trimEnd(), attachments: items.map(toAttachmentView) };
		}
	}
	return { body: text, attachments: [] };
}
