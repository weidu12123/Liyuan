/**
 * 在线更新：检查（GitHub releases/latest）→ 下载 zip → SHA256 校验 → 解压暂存 →
 * 写待应用标记；真正的文件替换由启动脚本在下次启动时执行（scripts/apply-update.mjs），
 * 运行中的进程绝不覆盖自己（借鉴 kiro.rs：替换交给没有文件占用的时机）。
 *
 * 网络纪律（国内直连 GitHub 常不通）：
 * - 检查只在启动后台跑一次 + 用户手动触发；短超时、静默失败，绝不拖慢启动
 * - 下载支持镜像前缀（如 https://ghproxy.net/），拼在资产 URL 前
 */

import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { DIRS } from "./paths.ts";
import { extractZipFile } from "./ziplite.ts";

/** 项目仓库（与主页 GitHub 徽标同源） */
const UPDATE_REPO = "weidu12123/Liyuan";
/** 暂存根：下载/解压/标记都在这里，失败清目录即回到干净态 */
export const UPDATE_DIR = `${DIRS.cache}/update`;
/** 待应用标记文件名（启动脚本据此触发覆盖） */
export const PENDING_FILE = "pending.json";

const CHECK_TIMEOUT_MS = 6000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
/** zip 体积上限（当前包 ~12MB，留裕量防异常响应占满磁盘） */
const MAX_ZIP_BYTES = 300 * 1024 * 1024;

export interface UpdateCheckResult {
	currentVersion: string;
	latestVersion: string | null;
	hasUpdate: boolean;
	/** release 名（如 "Liyuan Agent 1.1.2"） */
	releaseName?: string;
	/** release 正文（markdown，弹窗展示） */
	releaseNotes?: string;
	releaseUrl?: string;
	publishedAt?: string;
	/** 对应平台资产 */
	asset?: { name: string; url: string; size: number };
	/** SHA256SUMS.txt 资产 URL（没有则跳过校验并明示） */
	checksumsUrl?: string;
	/** 检查失败原因（静默降级：有值时 UI 不出提示，仅手动检查时展示） */
	error?: string;
}

export interface PendingUpdate {
	version: string;
	/** 解压后的 Liyuan 目录（绝对路径） */
	stagedDir: string;
	zipSha256: string;
	/** 校验方式：sha256sums=对过官方清单；none=release 未附清单 */
	verified: "sha256sums" | "none";
	downloadedAt: string;
}

/** 比较 semver（仅 x.y.z 数字段）：a<b 返回 -1 */
export function compareVersions(a: string, b: string): number {
	const pa = a.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
	const pb = b.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const x = pa[i] ?? 0;
		const y = pb[i] ?? 0;
		if (x !== y) return x < y ? -1 : 1;
	}
	return 0;
}

/** 当前平台的 release 资产名（与 pack-release.ps1 命名矩阵一致） */
export function platformAssetName(version: string, platform = process.platform): string {
	const plat = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux";
	return `Liyuan-${version.replace(/^v/, "")}-${plat}.zip`;
}

/** 镜像前缀拼接：前缀形如 https://ghproxy.net/，拼在完整 URL 前；空串直连 */
export function withMirror(url: string, mirror?: string): string {
	const m = (mirror ?? "").trim();
	if (!m) return url;
	return m.endsWith("/") ? m + url : `${m}/${url}`;
}

/** 检查最新 release。任何失败都吞进 result.error（调用方决定是否展示） */
export async function checkLatestRelease(currentVersion: string): Promise<UpdateCheckResult> {
	const base: UpdateCheckResult = { currentVersion, latestVersion: null, hasUpdate: false };
	try {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
		const resp = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
			headers: {
				accept: "application/vnd.github+json",
				"user-agent": "liyuan-update-checker",
			},
			signal: ctrl.signal,
		});
		clearTimeout(timer);
		if (!resp.ok) {
			return { ...base, error: `GitHub API ${resp.status}` };
		}
		const rel = (await resp.json()) as {
			tag_name?: string;
			name?: string;
			body?: string;
			html_url?: string;
			published_at?: string;
			assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>;
		};
		const latest = (rel.tag_name ?? "").replace(/^v/, "");
		if (!latest) return { ...base, error: "release 无 tag_name" };
		const hasUpdate = compareVersions(currentVersion, latest) < 0;
		const wantAsset = platformAssetName(latest);
		const assets = rel.assets ?? [];
		const asset = assets.find((a) => a.name === wantAsset);
		const sums = assets.find((a) => a.name === "SHA256SUMS.txt");
		return {
			currentVersion,
			latestVersion: latest,
			hasUpdate,
			releaseName: rel.name || undefined,
			releaseNotes: rel.body || undefined,
			releaseUrl: rel.html_url || undefined,
			publishedAt: rel.published_at || undefined,
			...(asset?.browser_download_url
				? { asset: { name: wantAsset, url: asset.browser_download_url, size: asset.size ?? 0 } }
				: {}),
			...(sums?.browser_download_url ? { checksumsUrl: sums.browser_download_url } : {}),
		};
	} catch (err) {
		const msg = err instanceof Error ? (err.name === "AbortError" ? `超时（${CHECK_TIMEOUT_MS / 1000}s）` : err.message) : String(err);
		return { ...base, error: `无法连接 GitHub：${msg}` };
	}
}

function sha256File(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** 从 SHA256SUMS.txt 文本里取某文件的期望哈希（GNU coreutils 格式） */
export function expectedHashFromSums(sumsText: string, filename: string): string | null {
	for (const line of sumsText.split(/\r?\n/)) {
		const m = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
		if (m && m[2].trim() === filename) return m[1].toLowerCase();
	}
	return null;
}

interface DownloadProgress {
	/** 已下载字节 */
	received: number;
	/** 总字节（响应未带 content-length 时为 0） */
	total: number;
}

/**
 * 下载并校验 + 解压暂存 + 写 pending 标记。
 * 全程在 <cwd>/.liyuan-cache/update/ 内；任何一步失败都清掉半成品后抛错。
 * onProgress 节流由调用方负责（这里每 chunk 都回调）。
 */
export async function downloadAndStage(opts: {
	cwd: string;
	check: UpdateCheckResult;
	mirror?: string;
	onProgress?: (p: DownloadProgress) => void;
	signal?: AbortSignal;
}): Promise<PendingUpdate> {
	const { cwd, check, mirror, onProgress, signal } = opts;
	if (!check.latestVersion || !check.asset) throw new Error("没有可下载的更新资产");
	const version = check.latestVersion;
	const updRoot = join(cwd, UPDATE_DIR);
	// 重下前清场：同目录只保留一份暂存
	rmSync(updRoot, { recursive: true, force: true });
	mkdirSync(updRoot, { recursive: true });
	const zipPath = join(updRoot, check.asset.name);

	try {
		// 1) 下载 zip（流式落盘，进度回调）
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
		const onOuterAbort = () => ctrl.abort();
		signal?.addEventListener("abort", onOuterAbort);
		let resp: Response;
		try {
			resp = await fetch(withMirror(check.asset.url, mirror), {
				headers: { "user-agent": "liyuan-updater" },
				signal: ctrl.signal,
			});
			if (!resp.ok || !resp.body) throw new Error(`下载失败 HTTP ${resp.status}`);
			const total = Number.parseInt(resp.headers.get("content-length") ?? "0", 10) || check.asset.size || 0;
			if (total > MAX_ZIP_BYTES) throw new Error(`更新包过大（${total} 字节），拒绝下载`);
			let received = 0;
			const counter = new TransformStreamCounter((n) => {
				received += n;
				if (received > MAX_ZIP_BYTES) ctrl.abort();
				onProgress?.({ received, total });
			});
			await pipeline(
				Readable.fromWeb(resp.body as import("node:stream/web").ReadableStream),
				counter.stream,
				createWriteStream(zipPath),
			);
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onOuterAbort);
		}

		// 2) SHA256 校验（release 带 SHA256SUMS.txt 才有基准；没有则明示未校验）
		let verified: PendingUpdate["verified"] = "none";
		const actual = sha256File(zipPath);
		if (check.checksumsUrl) {
			const sumsResp = await fetch(withMirror(check.checksumsUrl, mirror), {
				headers: { "user-agent": "liyuan-updater" },
			});
			if (!sumsResp.ok) throw new Error(`校验清单下载失败 HTTP ${sumsResp.status}`);
			const expected = expectedHashFromSums(await sumsResp.text(), check.asset.name);
			if (!expected) throw new Error(`SHA256SUMS.txt 里没有 ${check.asset.name} 的条目`);
			if (expected !== actual) {
				throw new Error(`SHA256 校验不符：期望 ${expected.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…`);
			}
			verified = "sha256sums";
		}

		// 3) 解压暂存（zip 内是 Liyuan/ 根目录）
		const stagedRoot = join(updRoot, "staged");
		await extractZip(zipPath, stagedRoot);
		const stagedDir = join(stagedRoot, "Liyuan");
		if (!existsSync(join(stagedDir, "package.json")) || !existsSync(join(stagedDir, "server", "main.ts"))) {
			throw new Error("更新包结构异常（缺 package.json / server/main.ts），已丢弃");
		}
		if (!existsSync(join(stagedDir, ".liyuan", "extensions", "roleplay.ts"))) {
			throw new Error("更新包缺扮演接线层（roleplay.ts），拒绝应用");
		}

		// 4) 写待应用标记（启动脚本读它决定是否覆盖）
		const pending: PendingUpdate = {
			version,
			stagedDir,
			zipSha256: actual,
			verified,
			downloadedAt: new Date().toISOString(),
		};
		writeFileSync(join(updRoot, PENDING_FILE), `${JSON.stringify(pending, null, "\t")}\n`, "utf8");
		// zip 校验解压完成即无用，删掉省一半磁盘
		rmSync(zipPath, { force: true });
		return pending;
	} catch (err) {
		rmSync(updRoot, { recursive: true, force: true });
		throw err;
	}
}

/** 读取待应用标记（无/损坏返回 null） */
export function readPendingUpdate(cwd: string): PendingUpdate | null {
	try {
		const p = join(cwd, UPDATE_DIR, PENDING_FILE);
		if (!existsSync(p)) return null;
		const j = JSON.parse(readFileSync(p, "utf8")) as PendingUpdate;
		if (!j?.version || !j?.stagedDir || !existsSync(j.stagedDir)) return null;
		return j;
	} catch {
		return null;
	}
}

/** 丢弃暂存的更新（用户点「取消」/ 检查发现暂存版已过期） */
export function discardPendingUpdate(cwd: string): void {
	rmSync(join(cwd, UPDATE_DIR), { recursive: true, force: true });
}

/** 字节计数透传流（fetch body → 文件 之间数进度） */
class TransformStreamCounter {
	stream: Transform;
	constructor(onChunk: (n: number) => void) {
		this.stream = new Transform({
			transform(chunk: Buffer, _enc, cb) {
				onChunk(chunk.length);
				cb(null, chunk);
			},
		});
	}
}

/** 解压 zip（无外部依赖：Windows 无 unzip；node 原生 zlib 解析，见 ziplite.ts） */
async function extractZip(zipPath: string, destDir: string): Promise<void> {
	extractZipFile(zipPath, destDir);
}
