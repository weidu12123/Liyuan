/**
 * agent 预览通道：把当前创作稿交给连接中的页面渲染，收回错误、交互与 DOM 摘要。
 *
 * 产品不带 headless 浏览器；用户的页面就是渲染器，它反映的才是真实运行环境。
 * 请求/回报的挂起形状与 askChoice 相同：广播一帧，等第一份回报或超时。
 */
import type { CardProjectBuild, CardProjectPreview } from "../src/card-authoring-types.ts";

export interface CardPreviewRequest {
	id: string;
	data: CardProjectPreview;
	message: string;
	variables: Record<string, unknown>;
	/** 页面就绪后再观察多少毫秒 */
	wait: number;
}
interface CardPreviewEvent { level: string; source: string; message: string }
export interface CardPreviewReport {
	id: string;
	ready: boolean;
	events: CardPreviewEvent[];
}
interface CardPreviewFrame {
	source: string;
	text?: string;
	elements?: number;
	tags?: Record<string, number>;
	images?: number;
	brokenImages?: number;
	height?: number;
}
interface CardPreviewResult {
	ok: boolean;
	ready: boolean;
	message: string;
	errors: string[];
	warnings: string[];
	actions: string[];
	frames: CardPreviewFrame[];
	build: Pick<CardProjectBuild, "changed" | "errors" | "added" | "removed" | "meta">;
	note?: string;
}

const clampWait = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? Math.min(15000, Math.max(500, Math.floor(v))) : 3000;
const record = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** 组装一次预览请求（消息/变量/等待时长的取值规则在这一处） */
export function buildCardPreviewRequest(id: string, data: CardProjectPreview, args: Record<string, unknown>): CardPreviewRequest {
	const greeting = typeof args.greeting === "number" && Number.isInteger(args.greeting) ? args.greeting : 0;
	const fallback = data.greetings[greeting] ?? data.greetings[0] ?? "";
	const message = typeof args.message === "string" && args.message ? args.message : fallback;
	return { id, data, message, variables: record(args.variables) ?? data.variables, wait: clampWait(args.wait) };
}

/** 页面回报 → 工具回执。DOM 摘要按帧来源归并，错误/警告/交互各成一列。 */
export function summarizeCardPreview(request: CardPreviewRequest, report: CardPreviewReport | null): CardPreviewResult {
	const build = { changed: request.data.build.changed, errors: request.data.build.errors, added: request.data.build.added, removed: request.data.build.removed, meta: request.data.build.meta };
	const base = { message: request.message.length > 200 ? request.message.slice(0, 200) + "…" : request.message, build };
	if (!report) return { ...base, ok: false, ready: false, errors: [], warnings: [], actions: [], frames: [], note: "页面没有在限时内回报预览结果" };
	const errors: string[] = [], warnings: string[] = [], actions: string[] = [];
	const frames = new Map<string, CardPreviewFrame>();
	for (const e of report.events) {
		const text = e.message.length > 4000 ? e.message.slice(0, 4000) + "…" : e.message;
		if (e.level === "error") errors.push(`${e.source}：${text}`);
		else if (e.level === "warning") warnings.push(`${e.source}：${text}`);
		else if (e.level === "action") actions.push(`${e.source}：${text}`);
		else if (e.level === "dom") {
			try {
				const parsed = record(JSON.parse(e.message));
				if (parsed) frames.set(e.source, { source: e.source, ...parsed } as CardPreviewFrame);
			} catch { /* 摘要坏了只当没有 */ }
		}
	}
	return { ...base, ok: report.ready && errors.length === 0 && build.errors.length === 0, ready: report.ready, errors, warnings, actions, frames: [...frames.values()] };
}

/** 挂起表：一次请求等第一份回报；超时按 null 收敛 */
export class CardPreviewHub {
	#pending = new Map<string, { request: CardPreviewRequest; resolve: (r: CardPreviewReport | null) => void; timer: NodeJS.Timeout }>();
	#seq = 0;
	readonly #send: (request: CardPreviewRequest) => number;
	constructor(send: (request: CardPreviewRequest) => number) { this.#send = send; }

	nextId(): string { return `p${Date.now().toString(36)}-${++this.#seq}`; }

	run(request: CardPreviewRequest, timeoutMs = request.wait + 20_000): Promise<CardPreviewResult> {
		return new Promise((resolve) => {
			const finish = (report: CardPreviewReport | null) => resolve(summarizeCardPreview(request, report));
			const timer = setTimeout(() => { if (this.#pending.delete(request.id)) finish(null); }, timeoutMs);
			this.#pending.set(request.id, { request, resolve: finish, timer });
			if (this.#send(request) === 0) {
				clearTimeout(timer);
				this.#pending.delete(request.id);
				resolve({ ...summarizeCardPreview(request, null), note: "没有连接的页面，无法运行预览；请在浏览器打开梨园后重试" });
			}
		});
	}

	/** 页面回报；重复或过期的回报返回 false */
	settle(report: CardPreviewReport): boolean {
		const p = this.#pending.get(report.id);
		if (!p) return false;
		clearTimeout(p.timer);
		this.#pending.delete(report.id);
		p.resolve(report);
		return true;
	}

	/** 新页面连上时补发未决请求 */
	pending(): CardPreviewRequest[] { return [...this.#pending.values()].map(p => p.request); }
}
