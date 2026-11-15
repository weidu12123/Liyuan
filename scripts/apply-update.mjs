/**
 * 启动时应用暂存更新（由 start.bat / start.sh 在 node server 启动前调用）。
 *
 * 契约：
 * - 只认 .liyuan-cache/update/pending.json（由 src/update.ts downloadAndStage 写入）
 * - **白名单覆盖**：只替换下方 CODE_PATHS 里的代码路径；用户数据（liyuan.config.json、
 *   liyuan.agent.json、assets/cards、assets/lorebooks、cards/（卡＝工作空间，含每张卡的
 *   卡级配置与全部子项目的会话/账本）、全部 .liyuan-* 数据目录、
 *   node_modules）绝不触碰
 * - 覆盖前把旧代码备份到 .liyuan-cache/backup-<旧版本>/（同白名单），失败按备份回滚
 * - package.json 依赖有变时删 node_modules/.liyuan-deps-ok 标记，启动脚本据此重跑 npm install
 * - 成败都清 pending（失败留 update-failed.log），绝不让启动死循环
 *
 * 退出码恒为 0：更新失败不阻断启动（旧版本继续可用）。
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const cwd = process.cwd();
const UPDATE_DIR = join(cwd, ".liyuan-cache", "update");
const PENDING = join(UPDATE_DIR, "pending.json");

/**
 * 代码路径白名单（相对项目根）。与 pack-release.ps1 的发布树一致：
 * 新增顶层代码目录时两处同步改。
 * 注意 assets 不在白名单里——它整棵是用户素材区，只由下面两个规则函数按名同步：
 * default_* 示例卡，与提示词槽位底座（根下 *.md）。用户自己的卡/世界书/预设永不覆盖。
 */
const CODE_PATHS = [
	"server",
	"src",
	"packages",
	"scripts",
	"web/dist",
	"web/src",
	"web/index.html",
	"web/package.json",
	"web/tsconfig.json",
	"web/vite.config.ts",
	".liyuan/extensions",
	"deploy",
	"docs",
	"package.json",
	"package-lock.json",
	"start.bat",
	"start.sh",
	"start.command",
	"Dockerfile",
	"docker-compose.yml",
	"README.md",
	"LICENSE",
	"RELEASE.txt",
	"liyuan.config.example.json",
	"liyuan.agent.example.json",
];

/** assets 下只同步官方示例卡（default_ 前缀），不碰用户素材 */
function syncDefaultCards(stagedDir) {
	const src = join(stagedDir, "assets", "cards");
	if (!existsSync(src)) return;
	const dst = join(cwd, "assets", "cards");
	mkdirSync(dst, { recursive: true });
	for (const f of readdirSafe(src)) {
		if (!f.startsWith("default_")) continue;
		cpSync(join(src, f), join(dst, f), { force: true });
	}
}

/**
 * assets 根下的 *.md ＝ 提示词槽位底座（SYSTEM.md / APPEND_SYSTEM.md / AUTHORING.md…）。
 * 它们是模块按 import.meta.url 直接读的产品文件，不是用户素材（用户的活件在 <agentDir>），
 * 所以按规则整取——**更新一次就该拿到一次**。漏掉的代价是模块读不到文件：1.6.0 桌面版漏了
 * AUTHORING.md，每一拍开演都 ENOENT；原地更新若也不同步，1.5.x 升上来的安装会撞同一个坑。
 */
function syncPromptSlots(stagedDir) {
	const dst = join(cwd, "assets");
	mkdirSync(dst, { recursive: true });
	for (const f of readdirSafe(join(stagedDir, "assets"))) {
		if (!f.endsWith(".md") && !f.endsWith(".txt")) continue;
		const from = join(stagedDir, "assets", f);
		try {
			if (statSync(from).isDirectory()) continue;
		} catch {
			continue;
		}
		cpSync(from, join(dst, f), { force: true });
	}
}

function readdirSafe(p) {
	try {
		return readdirSync(p);
	} catch {
		return [];
	}
}

function log(msg) {
	console.log(`[liyuan-update] ${msg}`);
}

function main() {
	if (!existsSync(PENDING)) return; // 无待应用更新：静默直过

	let pending;
	try {
		pending = JSON.parse(readFileSync(PENDING, "utf8"));
	} catch {
		rmSync(UPDATE_DIR, { recursive: true, force: true });
		return;
	}
	const staged = pending?.stagedDir;
	if (!staged || !existsSync(staged) || !existsSync(join(staged, "package.json"))) {
		log("暂存目录缺失，放弃本次更新");
		rmSync(UPDATE_DIR, { recursive: true, force: true });
		return;
	}

	let oldVer = "unknown";
	let oldDeps = "";
	let newDeps = "";
	try {
		const oldPkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
		oldVer = oldPkg.version ?? "unknown";
		oldDeps = JSON.stringify(oldPkg.dependencies ?? {}) + JSON.stringify(oldPkg.devDependencies ?? {});
	} catch {
		/* 保守继续 */
	}
	try {
		const newPkg = JSON.parse(readFileSync(join(staged, "package.json"), "utf8"));
		newDeps = JSON.stringify(newPkg.dependencies ?? {}) + JSON.stringify(newPkg.devDependencies ?? {});
	} catch {
		/* ignore */
	}

	log(`应用更新 v${oldVer} → v${pending.version} …`);

	// 1) 备份旧代码（同白名单；已有同名备份先清）
	const backupDir = join(cwd, ".liyuan-cache", `backup-${oldVer}`);
	rmSync(backupDir, { recursive: true, force: true });
	const backedUp = [];
	try {
		for (const rel of CODE_PATHS) {
			const from = join(cwd, rel);
			if (!existsSync(from)) continue;
			const to = join(backupDir, rel);
			mkdirSync(dirname(to), { recursive: true });
			cpSync(from, to, { recursive: true, force: true });
			backedUp.push(rel);
		}
	} catch (err) {
		log(`备份失败，放弃更新（旧版本原样保留）：${err?.message ?? err}`);
		rmSync(backupDir, { recursive: true, force: true });
		rmSync(UPDATE_DIR, { recursive: true, force: true });
		return;
	}

	// 2) 白名单覆盖（staged → cwd）；失败按备份回滚
	try {
		for (const rel of CODE_PATHS) {
			const from = join(staged, rel);
			if (!existsSync(from)) continue; // 新包没有的路径：保留旧的（如 RELEASE.txt 平台差异）
			const to = join(cwd, rel);
			// 目录先删后拷，避免旧版残留文件（改名/删除的模块）叠加
			rmSync(to, { recursive: true, force: true });
			mkdirSync(dirname(to), { recursive: true });
			cpSync(from, to, { recursive: true, force: true });
		}
		syncDefaultCards(staged);
		syncPromptSlots(staged);
	} catch (err) {
		log(`覆盖失败，回滚到 v${oldVer}：${err?.message ?? err}`);
		try {
			for (const rel of backedUp) {
				const from = join(backupDir, rel);
				const to = join(cwd, rel);
				rmSync(to, { recursive: true, force: true });
				mkdirSync(dirname(to), { recursive: true });
				cpSync(from, to, { recursive: true, force: true });
			}
			log("回滚完成，旧版本可用");
		} catch (rbErr) {
			log(`!! 回滚也失败了：${rbErr?.message ?? rbErr}`);
			log(`!! 手工恢复：把 ${backupDir} 下的目录拷回项目根`);
		}
		try {
			writeFileSync(join(cwd, ".liyuan-cache", "update-failed.log"), String(err?.stack ?? err), "utf8");
		} catch {
			/* ignore */
		}
		rmSync(UPDATE_DIR, { recursive: true, force: true });
		return;
	}

	// 3) 依赖变化 → 写标记，启动脚本看到即重跑 npm install（装完由脚本删）
	if (oldDeps && newDeps && oldDeps !== newDeps) {
		log("依赖有变化，启动时将重新 npm install");
		try {
			writeFileSync(join(cwd, ".liyuan-cache", "needs-npm-install"), pending.version, "utf8");
		} catch {
			/* 标记写不进就靠 node_modules 缺包时的报错兜底 */
		}
	}

	// 4) 清 pending，留备份（下一次更新时才清上一份）
	rmSync(UPDATE_DIR, { recursive: true, force: true });
	log(`更新完成：现在是 v${pending.version}（旧版备份在 .liyuan-cache/backup-${oldVer}）`);
}

main();
