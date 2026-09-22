/**
 * 梨园桌面版 Electron 主进程（docs/PLAN-DESKTOP.md）。
 *
 * 双根布局：
 * - 产品根（只读，随包）：server/ src/ packages/ web/dist assets/ .liyuan/extensions/ node_modules
 * - 数据根（可写，用户可见）：cards/ 配置 skills/ assets 活副本 .liyuan-* 运行目录
 * server 以子进程运行：ELECTRON_RUN_AS_NODE=1 把本进程二进制当纯 Node 用（VS Code 同款手法），
 * cwd＝数据根，产品根经 LIYUAN_PRODUCT_ROOT 告知（server/main.ts 只在三处消费）。
 *
 * dev（--dev 或未打包）：产品根＝仓库根；数据根＝仓库根（两根合一，行为与 node server/main.ts
 * 一致）。LIYUAN_DESKTOP_DATA_ROOT 可在 dev 或冒烟里显式指定数据根以测双根分离路径。
 */
import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes("--dev") || !app.isPackaged;

/** 产品树根（含 server/src/packages/web-dist/assets 的那一层）；打包后＝resources/app 即 stage 原样 */
const productRoot = dev ? path.resolve(__dirname, "..") : app.getAppPath();

// ---------- 界面语言（docs/PLAN-I18N.md 刀 5）----------
// 壳的对话框与菜单跟数据根里 liyuan.config.json 的 uiLanguage 走；数据根还没定（首启）时按系统语言。
// 菜单在起窗时建一次，网页里切换语言后壳的菜单要下次启动才换（已知限制）。
const DESKTOP_EN = {
	"选择梨园数据目录": "Choose the Liyuan data folder",
	"角色卡、会话、记忆与配置都保存在这个目录里，可整体拷贝迁移。": "Character cards, sessions, memory and settings live in this folder; copy it as a whole to move.",
	"选这里": "Use this folder",
	"欢迎使用梨园": "Welcome to Liyuan",
	"角色卡、会话、记忆与配置将保存在「数据目录」": "Character cards, sessions, memory and settings will be stored in the data folder",
	"默认位置：{def}\n\n数据目录可整体拷贝迁移，重装梨园不影响数据。\n以后可在「文件」菜单更改位置。": "Default location: {def}\n\nThe data folder can be copied as a whole; reinstalling Liyuan does not touch it.\nYou can change the location later from the File menu.",
	"就用默认位置": "Use default",
	"选择其他位置": "Choose another",
	"退出": "Quit",
	"梨园": "Liyuan",
	"数据目录不存在：\n{saved}": "Data folder not found:\n{saved}",
	"目录可能被移动或删除。重新选择已有目录可继续用原有数据；选新目录则从零开始。": "The folder may have been moved or deleted. Pick the existing folder to keep your data, or a new one to start fresh.",
	"重新选择…": "Choose again…",
	"服务进程意外退出（代码 {code}）。": "The service process exited unexpectedly (code {code}).",
	"日志：{log}": "Log: {log}",
	"重启服务": "Restart service",
	"服务进程已退出（详见日志）": "The service process has exited (see the log)",
	"等待服务就绪超时": "Timed out waiting for the service",
	"更改数据目录": "Change data folder",
	"把角色卡、会话与记忆的存放位置换到新目录。": "Move where character cards, sessions and memory are stored.",
	"原目录的数据不会自动搬移——需要保留就把原目录整体拷贝到新位置后再切换。\n新目录缺什么会自动补种默认资产。": "Data in the current folder is not moved automatically; copy the whole folder to the new location first if you want to keep it.\nMissing defaults are seeded into the new folder.",
	"继续…": "Continue…",
	"取消": "Cancel",
	"切换数据目录后服务重启失败：{err}\n\n日志：{log}": "The service failed to restart after changing the data folder: {err}\n\nLog: {log}",
	"已是最新版本（v{v}）。": "You are on the latest version (v{v}).",
	"好": "OK",
	"梨园更新": "Liyuan update",
	"新版本 v{v} 已下载就绪。": "Version v{v} has been downloaded.",
	"当前 v{v}。重启并安装大约需要几秒。\n角色卡、会话与配置都在数据目录，不受影响。": "Current version v{v}. Restarting to install takes a few seconds.\nCharacter cards, sessions and settings live in the data folder and are not affected.",
	"重启并安装": "Restart and install",
	"以后再说": "Later",
	"检查更新失败。": "Update check failed.",
	"{err}\n\n也可以到发布页手动下载新版。": "{err}\n\nYou can also download the new version from the releases page.",
	"加载中…": "Loading…",
	"文件": "File",
	"打开数据目录": "Open data folder",
	"更改数据目录…": "Change data folder…",
	"视图": "View",
	"重新载入": "Reload",
	"开发者工具": "Developer tools",
	"帮助": "Help",
	"检查更新…": "Check for updates…",
	"关于": "About",
	"梨园 Liyuan v{v}": "Liyuan v{v}",
	"数据目录：{dir}": "Data folder: {dir}",
	"梨园启动失败": "Liyuan failed to start",
	"{err}\n\n{log}": "{err}\n\n{log}",
};
let uiLocale = "zh";
function detectUiLocale(dataRoot) {
	try {
		const cfg = JSON.parse(fs.readFileSync(path.join(dataRoot, "liyuan.config.json"), "utf8"));
		if (cfg.uiLanguage === "zh" || cfg.uiLanguage === "en") return cfg.uiLanguage;
	} catch {
		/* 没配置或没数据根：按系统语言 */
	}
	return (app.getLocale?.() || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}
/** 同 web/src/i18n：键＝中文原文，占位符 {name}，缺条目回落中文 */
function t(zh, vars) {
	const out = uiLocale === "en" && DESKTOP_EN[zh] !== undefined ? DESKTOP_EN[zh] : zh;
	return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : out;
}
const logLine = () => (dev ? "" : t("日志：{log}", { log: logPath() }));

// ---------- 数据根 ----------

const desktopConfigFile = () => path.join(app.getPath("userData"), "desktop.json");

function readSavedDataRoot() {
	try {
		const cfg = JSON.parse(fs.readFileSync(desktopConfigFile(), "utf8"));
		return typeof cfg.dataRoot === "string" ? cfg.dataRoot : null;
	} catch {
		return null;
	}
}

function saveDataRoot(dir) {
	fs.mkdirSync(app.getPath("userData"), { recursive: true });
	fs.writeFileSync(desktopConfigFile(), `${JSON.stringify({ dataRoot: dir }, null, "\t")}\n`, "utf8");
}

async function pickDataRoot() {
	const docs = app.getPath("documents") || app.getPath("home");
	const { canceled, filePaths } = await dialog.showOpenDialog({
		title: t("选择梨园数据目录"),
		message: t("角色卡、会话、记忆与配置都保存在这个目录里，可整体拷贝迁移。"),
		defaultPath: path.join(docs, "Liyuan"),
		properties: ["openDirectory", "createDirectory", "dontAddToRecent"],
		buttonLabel: t("选这里"),
	});
	if (canceled || !filePaths?.[0]) return null;
	saveDataRoot(filePaths[0]);
	return filePaths[0];
}

/** 首启（无指针）：带说明的一步——默认位置一键开始，换位置才进文件夹选择 */
async function firstRunDataRoot() {
	const docs = app.getPath("documents") || app.getPath("home");
	const def = path.join(docs, "Liyuan");
	const choice = dialog.showMessageBoxSync({
		type: "question",
		title: t("欢迎使用梨园"),
		message: t("角色卡、会话、记忆与配置将保存在「数据目录」"),
		detail: t("默认位置：{def}\n\n数据目录可整体拷贝迁移，重装梨园不影响数据。\n以后可在「文件」菜单更改位置。", { def }),
		buttons: [t("就用默认位置"), t("选择其他位置"), t("退出")],
		defaultId: 0,
		cancelId: 2,
	});
	if (choice === 2) return null;
	if (choice === 0) {
		saveDataRoot(def);
		return def;
	}
	return await pickDataRoot();
}

async function resolveDataRoot() {
	if (process.env.LIYUAN_DESKTOP_DATA_ROOT) return process.env.LIYUAN_DESKTOP_DATA_ROOT;
	if (dev) return productRoot;
	const saved = readSavedDataRoot();
	if (saved && fs.existsSync(saved)) return saved;
	if (saved) {
		// 指针在、目录没了：明确告知，不静默重建（数据主权在用户）
		const choice = dialog.showMessageBoxSync({
			type: "warning",
			title: t("梨园"),
			message: t("数据目录不存在：\n{saved}", { saved }),
			detail: t("目录可能被移动或删除。重新选择已有目录可继续用原有数据；选新目录则从零开始。"),
			buttons: [t("重新选择…"), t("退出")],
			defaultId: 0,
			cancelId: 1,
		});
		return choice === 0 ? await pickDataRoot() : null;
	}
	return await firstRunDataRoot();
}

// ---------- 播种（PLAN-DESKTOP §四：覆盖同步＝产品持有的种子源；缺失才种＝用户持有） ----------

function copyTree(from, to) {
	fs.mkdirSync(to, { recursive: true });
	for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
		const src = path.join(from, entry.name);
		const dst = path.join(to, entry.name);
		if (entry.isDirectory()) copyTree(src, dst);
		else if (entry.isFile()) copyFileIfChanged(src, dst);
	}
}

function copyFileIfChanged(src, dst) {
	fs.mkdirSync(path.dirname(dst), { recursive: true });
	try {
		if (fs.readFileSync(src).equals(fs.readFileSync(dst))) return;
	} catch {
		/* 目标不存在 */
	}
	fs.copyFileSync(src, dst);
}

function seedDataRoot(dataRoot) {
	if (path.resolve(dataRoot) === path.resolve(productRoot)) return; // 两根合一（dev）：仓库本身就是完整布局
	const prod = (rel) => path.join(productRoot, rel);
	const data = (rel) => path.join(dataRoot, rel);

	// 覆盖同步（只是种子源；活件在 ~/.liyuan/agent 与 skills/，播过即用户持有）
	for (const rel of ["assets/SYSTEM.md", "assets/APPEND_SYSTEM.md", "assets/AGENT_APPEND_SYSTEM.md"]) {
		if (fs.existsSync(prod(rel))) copyFileIfChanged(prod(rel), data(rel));
	}
	if (fs.existsSync(prod("assets/skills"))) copyTree(prod("assets/skills"), data("assets/skills"));

	// 缺失才种（用户可删默认卡；配置与库播过即用户持有）
	const defaults = fs.existsSync(prod("assets/cards"))
		? fs.readdirSync(prod("assets/cards")).filter((f) => f.startsWith("default_") && f.endsWith(".json"))
		: [];
	for (const f of defaults) {
		if (!fs.existsSync(data(path.join("assets/cards", f)))) {
			copyFileIfChanged(prod(path.join("assets/cards", f)), data(path.join("assets/cards", f)));
		}
	}
	copyIfMissing(prod("liyuan.config.example.json"), data("liyuan.config.json"));
	copyIfMissing(prod("liyuan.agent.example.json"), data("liyuan.agent.json"));
	for (const rel of ["cards", "assets/lorebooks", "assets/presets"]) fs.mkdirSync(data(rel), { recursive: true });
}

function copyIfMissing(src, dst) {
	if (!fs.existsSync(src) || fs.existsSync(dst)) return;
	fs.mkdirSync(path.dirname(dst), { recursive: true });
	fs.copyFileSync(src, dst);
}

// ---------- 端口 ----------

function portInUse(port) {
	return new Promise((resolve) => {
		const srv = net.createServer();
		srv.once("error", () => resolve(true));
		srv.once("listening", () => srv.close(() => resolve(false)));
		// 显式绑 0.0.0.0：与 server 的绑定族一致。不写 host 会绑 ::（IPv6），
		// Windows 上 IPv4:port 被占时 :: 仍可能绑定成功 → 误判空闲 → server 起来就 EADDRINUSE
		srv.listen(port, "0.0.0.0");
	});
}

function freePort() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.once("error", reject);
		srv.listen(0, "127.0.0.1", () => {
			const port = srv.address().port;
			srv.close(() => resolve(port));
		});
	});
}

async function pickPort() {
	const preferred = Number(process.env.PORT) || 7620;
	return (await portInUse(preferred)) ? await freePort() : preferred;
}

// ---------- server 子进程 ----------

let serverProc = null;
let serverPort = 0;
let quitting = false;
let logFd = null;
let dataRootResolved = "";

const logPath = () => path.join(dataRootResolved, ".liyuan-cache", "desktop.log");

function openLog() {
	const dir = path.join(dataRootResolved, ".liyuan-cache");
	fs.mkdirSync(dir, { recursive: true });
	try {
		if (fs.statSync(logPath()).size > 5 * 1024 * 1024) fs.rmSync(logPath()); // 简单轮转
	} catch {
		/* 无旧日志 */
	}
	return fs.openSync(logPath(), "a");
}

function killServer() {
	const pid = serverProc?.pid;
	if (!pid) return;
	if (process.platform === "win32") {
		spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }); // 带上子孙（vision MCP、bash）
	} else {
		try {
			process.kill(-pid, "SIGTERM"); // detached 建了新进程组，组杀
		} catch {
			try {
				serverProc.kill("SIGTERM");
			} catch {
				/* 已退出 */
			}
		}
	}
	serverProc = null;
}

function spawnServer(dataRoot) {
	const split = path.resolve(dataRoot) !== path.resolve(productRoot);
	const env = {
		...process.env,
		ELECTRON_RUN_AS_NODE: "1",
		PORT: String(serverPort),
		...(split ? { LIYUAN_PRODUCT_ROOT: productRoot } : {}),
		...(!dev ? { LIYUAN_DESKTOP: "1" } : {}),
	};
	const stdio = dev ? "inherit" : ["ignore", "pipe", "pipe"];
	serverProc = spawn(process.execPath, [path.join(productRoot, "server", "main.ts")], {
		cwd: dataRoot,
		env,
		stdio,
		detached: process.platform !== "win32",
	});
	if (!dev) {
		logFd = openLog();
		const write = (chunk) => {
			try {
				fs.writeSync(logFd, chunk);
			} catch {
				/* 盘满等：丢日志不杀服务 */
			}
		};
		serverProc.stdout?.on("data", write);
		serverProc.stderr?.on("data", write);
	}
	serverProc.on("exit", (code) => {
		serverProc = null;
		if (quitting) return;
		const choice = dialog.showMessageBoxSync({
			type: "error",
			title: t("梨园"),
			message: t("服务进程意外退出（代码 {code}）。", { code }),
			detail: logLine(),
			buttons: [t("重启服务"), t("退出")],
			defaultId: 0,
			cancelId: 1,
		});
		if (choice === 0) void restart();
		else app.quit();
	});
}

function waitHealthy(timeoutMs = 90_000) {
	const started = Date.now();
	return new Promise((resolve, reject) => {
		const ping = () => {
			if (serverProc === null) return reject(new Error(t("服务进程已退出（详见日志）")));
			const req = http.get({ host: "127.0.0.1", port: serverPort, path: "/healthz", timeout: 3000 }, (res) => {
				res.resume();
				if (res.statusCode === 200) resolve();
				else retry();
			});
			req.on("timeout", () => req.destroy(new Error("timeout")));
			req.on("error", retry);
		};
		const retry = () => {
			if (Date.now() - started > timeoutMs) return reject(new Error(t("等待服务就绪超时")));
			setTimeout(ping, 400);
		};
		ping();
	});
}

async function restart() {
	killServer();
	serverPort = await pickPort();
	spawnServer(dataRootResolved);
	await waitHealthy();
	if (win) win.loadURL(serverUrl());
}

/**
 * 更改数据目录：重指指针＋按新根重启服务。原目录数据不自动搬移——
 * 数据根是透明目录，需要保留就整体拷贝到新位置再切换（与「卡空间物理迁移」同一哲学）。
 */
async function changeDataRoot() {
	const choice = dialog.showMessageBoxSync({
		type: "question",
		title: t("更改数据目录"),
		message: t("把角色卡、会话与记忆的存放位置换到新目录。"),
		detail: t("原目录的数据不会自动搬移——需要保留就把原目录整体拷贝到新位置后再切换。\n新目录缺什么会自动补种默认资产。"),
		buttons: [t("继续…"), t("取消")],
		defaultId: 0,
		cancelId: 1,
	});
	if (choice !== 0) return;
	const picked = await pickDataRoot();
	if (!picked) return;
	dataRootResolved = picked;
	seedDataRoot(picked);
	uiLocale = detectUiLocale(picked);
	try {
		await restart();
	} catch (err) {
		dialog.showErrorBox(
			t("梨园"),
			t("切换数据目录后服务重启失败：{err}\n\n日志：{log}", { err: err instanceof Error ? err.message : String(err), log: logPath() }),
		);
		app.quit();
	}
}

const serverUrl = () => `http://127.0.0.1:${serverPort}/`;

// ---------- 自动更新（electron-updater；docs/PLAN-DESKTOP.md §更新） ----------
// 只有两类形态启用：win NSIS 安装版（exe 同目录有卸载器）与 linux AppImage。
// mac 未签名（Squirrel 拒绝替换签名不一致的 app）、win 便携 zip（解压运行无安装器语义）不启用——菜单指路发布页。
// LIYUAN_UPDATE_URL：把更新源指到自建/镜像（generic provider，目录下放 latest*.yml 与安装包）。
// LIYUAN_UPDATE_OFF=1：全关（冒烟环境用）。
const RELEASES_URL = "https://github.com/weidu12123/Liyuan/releases/latest";
let autoUpdater = null;
let manualCheck = false; // 菜单手动触发：结果（含失败）要弹框；启动自动检查全程静默

async function setupAutoUpdate() {
	if (process.env.LIYUAN_UPDATE_OFF === "1") return;
	if (process.platform === "darwin") return; // 未签名，自动更新必败
	if (process.platform === "win32" && !fs.existsSync(path.join(path.dirname(process.execPath), "Uninstall Liyuan.exe"))) {
		return; // 便携 zip 解压形态：没有卸载器，静默装会把用户「升级」成安装版，不干
	}
	if (process.platform === "linux" && !process.env.APPIMAGE) return;
	try {
		const mod = await import("electron-updater");
		autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater ?? null;
	} catch {
		return; // 装载失败（形态异常等）：菜单回落指路，绝不影响启动
	}
	if (!autoUpdater) return;
	autoUpdater.autoDownload = true; // 发现新版后台静默下载，不打扰；就绪后才询问安装
	autoUpdater.autoInstallOnAppQuit = false; // 只有点「重启并安装」才装，退出时不偷装
	if (process.env.LIYUAN_UPDATE_URL)
		autoUpdater.setFeedURL({ provider: "generic", url: process.env.LIYUAN_UPDATE_URL });
	autoUpdater.on("update-not-available", () => {
		if (manualCheck) {
			manualCheck = false;
			void dialog.showMessageBox({
				type: "info",
				title: t("梨园"),
				message: t("已是最新版本（v{v}）。", { v: app.getVersion() }),
				buttons: [t("好")],
			});
		}
	});
	autoUpdater.on("update-downloaded", (info) => {
		const choice = dialog.showMessageBoxSync({
			type: "question",
			title: t("梨园更新"),
			message: t("新版本 v{v} 已下载就绪。", { v: info.version }),
			detail: t("当前 v{v}。重启并安装大约需要几秒。\n角色卡、会话与配置都在数据目录，不受影响。", { v: app.getVersion() }),
			buttons: [t("重启并安装"), t("以后再说")],
			defaultId: 0,
			cancelId: 1,
		});
		if (choice === 0) {
			killServer(); // NSIS 要覆盖的文件正被 server 子进程占用（同一 exe 二进制）
			autoUpdater.quitAndInstall(true, true);
		}
	});
	autoUpdater.on("error", (err) => {
		if (manualCheck) {
			manualCheck = false;
			void dialog.showMessageBox({
				type: "warning",
				title: t("梨园"),
				message: t("检查更新失败。"),
				detail: t("{err}\n\n也可以到发布页手动下载新版。", { err: err instanceof Error ? err.message : String(err) }),
				buttons: [t("好")],
			});
		}
		// 自动检查静默失败：网络不通是常态，不弹窗
	});
	// 启动后延迟检查：错开冷启动（起服务、播种、首窗）的高峰
	setTimeout(() => {
		void autoUpdater.checkForUpdates().catch(() => {});
	}, 15_000);
}

/** 菜单入口：启用态走真检查，未启用形态指路发布页 */
function checkUpdates() {
	if (!autoUpdater) return void shell.openExternal(RELEASES_URL);
	manualCheck = true;
	void autoUpdater.checkForUpdates().catch(() => {});
}

// ---------- 窗口与菜单 ----------

let win = null;

function buildSplash() {
	let logoSrc = "";
	try {
		const p = path.join(productRoot, "web", "dist", "logo-128.png");
		if (fs.existsSync(p)) {
			logoSrc = `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;
		}
	} catch {}
	// 兜底 SVG：若万一未找到文件，保持相同尺寸与梨园朱砂花造型
	if (!logoSrc) {
		logoSrc =
			"data:image/svg+xml," +
			encodeURIComponent(
				`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">` +
					`<rect width="64" height="64" rx="14" fill="#1e1a18"/>` +
					`<path d="M32 10c-1 8-8 12-8 20 0 6 4 10 8 12 4-2 8-6 8-12 0-8-7-12-8-20z" fill="#c4bbb1"/>` +
					`<path d="M22 42c4 6 10 8 10 8s6-2 10-8" stroke="#e25a3c" stroke-width="2.5" stroke-linecap="round"/>` +
					`</svg>`,
			);
	}
	const html =
		`<!doctype html><html lang="${uiLocale === "zh" ? "zh-CN" : "en"}"><head><meta charset="utf-8"><title>${t("梨园")}</title>` +
		`<style>` +
		`*{box-sizing:border-box;margin:0;padding:0}` +
		`html,body{width:100%;height:100%;overflow:hidden;background:#141110;color:#c4bbb1;` +
		`font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei","Noto Sans SC",sans-serif;` +
		`-webkit-user-select:none;user-select:none}` +
		`.splash{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px}` +
		`.splash-logo{width:80px;height:80px;border-radius:18px;box-shadow:0 8px 32px rgba(0,0,0,0.45),0 2px 8px rgba(0,0,0,0.3);display:block}` +
		`.splash-loading{display:flex;align-items:center;gap:9px;font-size:13px;letter-spacing:0.18em;color:#9a9188}` +
		`.splash-dot{width:6px;height:6px;border-radius:50%;background:#e25a3c;animation:splash-pulse 1.8s ease-in-out infinite}` +
		`@keyframes splash-pulse{0%,100%{opacity:0.3;transform:scale(0.85)}50%{opacity:1;transform:scale(1.15);box-shadow:0 0 8px rgba(226,90,60,0.6)}}` +
		`</style></head>` +
		`<body><main class="splash">` +
		`<img class="splash-logo" src="${logoSrc}" alt="${t("梨园")}" />` +
		`<div class="splash-loading"><span class="splash-dot"></span><span>${t("加载中…")}</span></div>` +
		`</main></body></html>`;
	return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

function createWindow() {
	win = new BrowserWindow({
		width: 1280,
		height: 820,
		minWidth: 940,
		minHeight: 600,
		backgroundColor: "#141110",
		title: t("梨园"),
		autoHideMenuBar: true, // 菜单栏默认隐藏（Alt 呼出）——2026-09-12 用户反馈
	});
	win.loadURL(buildSplash());
	win.on("closed", () => {
		win = null;
	});
	// 外链一律给系统浏览器；页内导航只许自家 origin
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:/i.test(url)) void shell.openExternal(url);
		return { action: "deny" };
	});
	win.webContents.on("will-navigate", (event, url) => {
		if (!url.startsWith(`http://127.0.0.1:${serverPort}`)) {
			event.preventDefault();
			if (/^https?:/i.test(url)) void shell.openExternal(url);
		}
	});
}

function buildMenu() {
	const template = [
		{
			label: t("文件"),
			submenu: [
				{ label: t("打开数据目录"), click: () => void shell.openPath(dataRootResolved) },
				{ label: t("更改数据目录…"), click: () => void changeDataRoot() },
				{ type: "separator" },
				{ label: t("退出"), role: "quit" },
			],
		},
		{
			label: t("视图"),
			submenu: [
				{ label: t("重新载入"), accelerator: "CmdOrCtrl+R", click: () => win?.webContents.reload() },
				{ label: t("开发者工具"), accelerator: "F12", click: () => win?.webContents.toggleDevTools() },
			],
		},
		{
			label: t("帮助"),
			submenu: [
				{
					label: t("检查更新…"),
					click: () => checkUpdates(),
				},
				{
					label: t("关于"),
					click: () =>
						void dialog.showMessageBox({
							type: "info",
							title: t("梨园"),
							message: t("梨园 Liyuan v{v}", { v: app.getVersion() }),
							detail: t("数据目录：{dir}", { dir: dataRootResolved }),
							buttons: [t("好")],
						}),
				},
			],
		},
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- 主流程 ----------

async function bootstrap() {
	await app.whenReady();
	uiLocale = detectUiLocale(dev ? productRoot : readSavedDataRoot() || "");
	createWindow(); // 先有窗（启动页在场），再谈数据目录——首启对话有上下文，不裸弹
	const dataRoot = await resolveDataRoot();
	if (!dataRoot) {
		app.quit();
		return;
	}
	dataRootResolved = dataRoot;
	seedDataRoot(dataRoot);
	uiLocale = detectUiLocale(dataRoot);
	buildMenu();
	void setupAutoUpdate();
	try {
		serverPort = await pickPort();
		spawnServer(dataRoot);
		await waitHealthy();
		if (win) win.loadURL(serverUrl());
	} catch (err) {
		dialog.showErrorBox(
			t("梨园启动失败"),
			t("{err}\n\n{log}", { err: err instanceof Error ? err.message : String(err), log: logLine() }),
		);
		app.quit();
	}
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
} else {
	app.on("second-instance", () => {
		if (win) {
			if (win.isMinimized()) win.restore();
			win.focus();
		}
	});

	void bootstrap().catch((err) => {
		dialog.showErrorBox(t("梨园启动失败"), String(err));
		app.quit();
	});

	app.on("window-all-closed", () => {
		// 桌面版窗口即服务：关窗即收摊（macOS 同此，v1 不留后台）
		quitting = true;
		killServer();
		app.quit();
	});
	app.on("before-quit", () => {
		quitting = true;
		killServer();
	});
}
