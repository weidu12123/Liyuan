/**
 * 梨园桌面版 staging（docs/PLAN-DESKTOP.md §四）：把产品运行树装进 desktop/app/。
 *
 * 排除纪律与 scripts/pack-release.ps1 成对——改本文件必看那份（反向亦然）。
 * 本脚本用**正向清单**（只拷列出的东西），泄漏面天然收窄；末尾的产物检查是第二道保险。
 * 拷完后在 app/ 内 npm ci --omit=dev 产出自包含 node_modules，并把 @liyuan 的 file:
 * 链接替换为实体拷贝（electron-builder 不会替我们解析符号链接）。
 *
 * 用法：node scripts/stage-desktop.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "desktop", "app");

const log = (msg) => console.log(`[stage] ${msg}`);
const die = (msg) => {
	console.error(`[stage] 失败：${msg}`);
	process.exit(1);
};

// ---------- 通用拷贝（自实现 walker：可控排除，且绕开 fs.cpSync 的非 ASCII 目录崩溃坑） ----------

const JUNK_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
const isJunk = (name) =>
	JUNK_FILES.has(name) || name.endsWith(".log") || name.endsWith(".bak") || name.endsWith(".tsbuildinfo");

/** 递归拷目录。skipDirs(dir 相对路径)＝整目录跳过；skipFile(file 相对路径)＝单文件跳过 */
function copyTree(from, to, { skipDirs, skipFile } = {}) {
	let files = 0;
	const walk = (src, dst, rel) => {
		fs.mkdirSync(dst, { recursive: true });
		for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
			const relPath = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				if (skipDirs?.(relPath)) continue;
				walk(path.join(src, entry.name), path.join(dst, entry.name), relPath);
			} else if (entry.isFile()) {
				if (isJunk(entry.name) || skipFile?.(relPath)) continue;
				fs.copyFileSync(path.join(src, entry.name), path.join(dst, entry.name));
				files++;
			}
		}
	};
	walk(from, to, "");
	return files;
}

function copyFile(from, to) {
	fs.mkdirSync(path.dirname(to), { recursive: true });
	fs.copyFileSync(from, to);
}

// ---------- 清场 ----------
// 不删 app/ 目录本身（开发者 shell/杀软可能占着目录句柄导致 EPERM），只清子项＋重试
fs.mkdirSync(appDir, { recursive: true });
for (const entry of fs.readdirSync(appDir)) {
	fs.rmSync(path.join(appDir, entry), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = rootPkg.version ?? "0.0.0";

// ---------- 正向清单拷贝 ----------

let total = 0;

// 代码与内核（packages：不带走 test 与 .map —— 与 pack-release.ps1 同一对排除）
const neverDirs = (p) => p === "node_modules" || p.split("/").pop() === "test";
total += copyTree(path.join(root, "server"), path.join(appDir, "server"), { skipDirs: neverDirs });
total += copyTree(path.join(root, "src"), path.join(appDir, "src"), { skipDirs: neverDirs });
total += copyTree(path.join(root, "packages"), path.join(appDir, "packages"), {
	skipDirs: neverDirs,
	skipFile: (p) => p.endsWith(".map"),
});

// 前端产物（随仓库提交）
total += copyTree(path.join(root, "web", "dist"), path.join(appDir, "web", "dist"));

// 产品接线层（唯一允许进 .liyuan/ 的东西；v1.0.0-v1.1.0 曾因漏它发布过空壳）
fs.mkdirSync(path.join(appDir, ".liyuan", "extensions"), { recursive: true });
for (const f of fs.readdirSync(path.join(root, ".liyuan", "extensions"))) {
	if (f.endsWith(".ts")) {
		copyFile(path.join(root, ".liyuan", "extensions", f), path.join(appDir, ".liyuan", "extensions", f));
		total++;
	}
}

// 种子源资产：提示词槽位底座、内置技能、默认卡（只带 default_*，绝不带社区/私人卡）
// 槽位底座＝assets 根下的 *.md（SYSTEM.md / APPEND_SYSTEM.md / AUTHORING.md…），按规则整取：
// 它们是模块按 import.meta.url 直接读的产品文件，**漏一个就是一个 ENOENT**——1.6.0 桌面版
// 漏了 AUTHORING.md，工作模式提示词读不到，每一拍开演都失败。加槽位文件不必再来这里改名单。
const promptSlots = fs.readdirSync(path.join(root, "assets"), { withFileTypes: true })
	.filter((e) => e.isFile() && (e.name.endsWith(".md") || e.name.endsWith(".txt")))
	.map((e) => e.name);
for (const f of promptSlots) {
	copyFile(path.join(root, "assets", f), path.join(appDir, "assets", f));
	total++;
}
total += copyTree(path.join(root, "assets", "skills"), path.join(appDir, "assets", "skills"));
for (const f of fs.readdirSync(path.join(root, "assets", "cards"))) {
	if (f.startsWith("default_") && f.endsWith(".json")) {
		copyFile(path.join(root, "assets", "cards", f), path.join(appDir, "assets", "cards", f));
		total++;
	}
}
// 空库目录（数据根播种要的形状；运行时也会 mkdir，这里保证包内自洽）
for (const d of ["assets/lorebooks", "assets/presets"]) fs.mkdirSync(path.join(appDir, ...d.split("/")), { recursive: true });

// 清单与许可（示例配置是数据根首启播种的种子源，desktop/main.mjs 消费）
for (const f of [
	"package.json",
	"package-lock.json",
	"LICENSE",
	"liyuan.config.example.json",
	"liyuan.agent.example.json",
]) {
	if (fs.existsSync(path.join(root, f))) {
		copyFile(path.join(root, f), path.join(appDir, f));
		total++;
	}
}

// 桌面壳本体
copyFile(path.join(root, "desktop", "main.mjs"), path.join(appDir, "main.mjs"));
total++;
log(`产品树装入 ${appDir}（${total} 个文件）`);

// ---------- 依赖：app 内自包含 node_modules ----------

log("npm ci --omit=dev（stage 内自包含；需要网络）…");
// 单串命令必须走 shell：win32 上 npm 是 .cmd（Node ≥24 禁止无 shell 直跑），
// POSIX 上无 shell 时整串会被当成一个可执行文件名（ENOENT）——两边都要 shell；参数是静态串无注入面
const ci = spawnSync("npm ci --omit=dev", {
	cwd: appDir,
	stdio: "inherit",
	shell: true,
});
if (ci.status !== 0 || ci.error) die(`npm ci 失败${ci.error ? `：${ci.error.message}` : ""}`);

// electron-updater 只被桌面壳（app/main.mjs）用到，不进根 package.json（源码包用户不需要）。
// 不用 --no-save/--no-package-lock：CI 的 npm 10（node 22）在该组合下 arborist 崩溃
// （Cannot read properties of null (reading 'edgesOut')）——app/ 是一次性 staging 目录，
// 让 npm 照常写 manifest/lock 无妨；版本钉死与本机产物一致
const upd = spawnSync("npm install electron-updater@6.8.0 --omit=dev", {
	cwd: appDir,
	stdio: "inherit",
	shell: true,
});
if (upd.status !== 0 || upd.error) die(`electron-updater 安装失败${upd.error ? `：${upd.error.message}` : ""}`);
log("electron-updater → app/node_modules（桌面壳自动更新）");

// file: 依赖是符号链接 → 替换为实体拷贝（目标必须落在 app/packages 内）
const scope = path.join(appDir, "node_modules", "@liyuan");
if (fs.existsSync(scope)) {
	for (const name of fs.readdirSync(scope)) {
		const p = path.join(scope, name);
		if (!fs.lstatSync(p).isSymbolicLink()) continue;
		const target = fs.realpathSync(p);
		if (!target.startsWith(path.join(appDir, "packages"))) die(`@liyuan/${name} 链接指向包外：${target}`);
		fs.rmSync(p);
		const copied = copyTree(target, p);
		log(`@liyuan/${name} 链接 → 实体拷贝（${copied} 文件）`);
	}
}

// ---------- 应用清单：app/package.json 补 main 与 author（electron-builder 以它为入口） ----------
// 必须在 npm ci 之后改：ci 要拿与 lock 完全一致的 package.json
{
	const appPkgPath = path.join(appDir, "package.json");
	const appPkg = JSON.parse(fs.readFileSync(appPkgPath, "utf8"));
	appPkg.main = "main.mjs";
	appPkg.author ??= { name: "weidu12123" };
	// 打包器按依赖图修剪 node_modules：只在磁盘上放 electron-updater 不够（--no-save 不进清单，
	// 会被当 extraneous 剔出产品树——9/13 实弹踩过），必须在这里显式声明才会保留
	appPkg.dependencies = { ...appPkg.dependencies, "electron-updater": "^6.8.0" };
	fs.writeFileSync(appPkgPath, `${JSON.stringify(appPkg, null, "\t")}\n`, "utf8");
}

// ---------- 产物检查（pack-release.ps1 Test-ReleaseZip 的同族检查） ----------

const mustExist = [
	".liyuan/extensions/roleplay.ts",
	"server/mcp/vision-server.mjs",
	"server/main.ts",
	"src/paths.ts",
	"packages/ai/src/providers/data/.manifest.json",
	"packages/ai/dist/providers/data/.manifest.json",
	"web/dist/index.html",
	"main.mjs",
	"package.json",
	"liyuan.config.example.json",
	"liyuan.agent.example.json",
	"node_modules/ws",
	"node_modules/jiti",
	"node_modules/@modelcontextprotocol/sdk",
	"node_modules/electron-updater",
	"node_modules/@liyuan/agent-runtime/package.json",
];
for (const rel of mustExist) {
	if (!fs.existsSync(path.join(appDir, rel))) die(`缺件：${rel}（桌面版会启动失败）`);
}
// 提示词槽位底座按规则复检（同一份清单来源——列名单才会漏，见上面的拷贝注释）
for (const f of promptSlots) {
	if (!fs.existsSync(path.join(appDir, "assets", f))) die(`缺件：assets/${f}（提示词会读不到，开演即失败）`);
}
// @liyuan/agent-runtime 必须是实体目录不是残留链接
if (fs.lstatSync(path.join(appDir, "node_modules/@liyuan/agent-runtime")).isSymbolicLink()) {
	die("@liyuan/agent-runtime 仍是符号链接");
}

const mustAbsent = [
	"cards",
	"test",
	"docs",
	"scripts",
	"liyuan.config.json",
	"liyuan.agent.json",
	"liyuan.agent.meta.json",
	".liyuan-personas.json",
	".liyuan-mcp.json",
	".liyuan/settings.json",
	".liyuan-cache",
	".liyuan-media",
	".liyuan-memory",
	".liyuan-state",
	".liyuan-uploads",
	"assets/personas",
	"CLAUDE.md",
	"AGENTS.md",
	"start.bat",
	"start.sh",
	"Dockerfile",
];
for (const rel of mustAbsent) {
	if (fs.existsSync(path.join(appDir, rel))) die(`泄漏：app/${rel} 不该进桌面包`);
}
for (const f of fs.readdirSync(path.join(appDir, "assets", "presets"))) {
	die(`泄漏：assets/presets/${f}（预设库是用户数据）`);
}
for (const f of fs.readdirSync(path.join(appDir, "assets", "cards"))) {
	if (!f.startsWith("default_")) die(`泄漏：assets/cards/${f}（只许 default_*）`);
}
for (const f of fs.readdirSync(appDir)) {
	if (f.startsWith("_")) die(`泄漏：dev 脚手架 ${f}`);
}

// ---------- 汇总 ----------

let bytes = 0;
const measure = (dir) => {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) measure(p);
		else if (e.isFile()) bytes += fs.statSync(p).size;
	}
};
measure(appDir);
log(`完成：v${version}，${(bytes / 1024 / 1024).toFixed(1)} MB → desktop/app/`);
