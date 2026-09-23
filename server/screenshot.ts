/**
 * 截图通道：agent 要看当前画面时，广播一帧给连接中的页面，页面把渲染好的稿子
 * 截成 PNG 回报。挂起形状与 CardPreviewHub 相同：广播一帧，等第一份回报或超时。
 * 截的是用户浏览器里真实渲染的那一页（含卡皮肤、mermaid、主题），不是服务端重渲。
 */
export interface ScreenshotRequest {
	id: string;
	/** 只截这一章（文件名）；缺省＝整页稿子 */
	file?: string;
}
export interface ScreenshotReport {
	id: string;
	/** PNG 的 base64；空＝页面没截到 */
	png: string;
	width: number;
	height: number;
	note?: string;
}

export class ScreenshotHub {
	#pending = new Map<string, { request: ScreenshotRequest; resolve: (r: ScreenshotReport | null) => void; timer: NodeJS.Timeout }>();
	#seq = 0;
	readonly #send: (request: ScreenshotRequest) => number;
	constructor(send: (request: ScreenshotRequest) => number) { this.#send = send; }

	nextId(): string { return `s${Date.now().toString(36)}-${++this.#seq}`; }

	run(request: ScreenshotRequest, timeoutMs = 20_000): Promise<ScreenshotReport | null> {
		return new Promise((resolve) => {
			const timer = setTimeout(() => { if (this.#pending.delete(request.id)) resolve(null); }, timeoutMs);
			this.#pending.set(request.id, { request, resolve, timer });
			if (this.#send(request) === 0) {
				clearTimeout(timer);
				this.#pending.delete(request.id);
				resolve(null);
			}
		});
	}

	/** 页面回报；重复或过期的回报返回 false */
	settle(report: ScreenshotReport): boolean {
		const p = this.#pending.get(report.id);
		if (!p) return false;
		clearTimeout(p.timer);
		this.#pending.delete(report.id);
		p.resolve(report);
		return true;
	}

	/** 新页面连上时补发未决请求 */
	pending(): ScreenshotRequest[] { return [...this.#pending.values()].map((p) => p.request); }
}
