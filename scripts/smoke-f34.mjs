// F3-4 冒烟：图片通道 + 技能沉淀（真实 LLM 调用）。
// 起独立 server（--new，端口 7622）→ WS 发戏外指令让模型调 show_image + skill_save →
// 断言 image 消息帧、/media/ 可取回图片、技能文件落盘。探针技能文件测毕删除。
// 用法：node scripts/smoke-f34.mjs
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 7622;
const SKILL_FILE = join(appDir, ".rp-skills", "test-探针技能.md");
const fail = (msg) => {
	console.error(`✗ ${msg}`);
	child?.kill();
	process.exit(1);
};

console.log("── 启动 server（--new）…");
const child = spawn(process.execPath, ["server/main.ts", "--new"], {
	cwd: appDir,
	env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" },
});
child.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
let done = false;
child.on("exit", (code) => {
	if (!done) fail(`server 提前退出（code ${code}}）`);
});
const watchdog = setTimeout(() => fail("总超时（300s）"), 300_000);

let health;
for (let i = 0; i < 60; i++) {
	try {
		const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
		if (res.ok) {
			health = await res.json();
			break;
		}
	} catch {}
	await new Promise((r) => setTimeout(r, 1000));
}
if (!health) fail("healthz 60s 未就绪");
console.log(`── healthz ok：角色「${health.char}」`);

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
const frames = [];
const waiters = [];
ws.addEventListener("message", (ev) => {
	const f = JSON.parse(String(ev.data));
	frames.push(f);
	for (const w of [...waiters]) {
		if (w.match(f)) {
			waiters.splice(waiters.indexOf(w), 1);
			w.resolve(f);
		}
	}
});
const waitFor = (match, ms, what) =>
	new Promise((resolve, reject) => {
		const hit = frames.find(match);
		if (hit) return resolve(hit);
		const w = { match, resolve };
		waiters.push(w);
		setTimeout(() => {
			if (waiters.includes(w)) reject(new Error(`等待 ${what} 超时（${ms}ms）`));
		}, ms);
	});

try {
	await waitFor((f) => f.type === "hello", 10_000, "hello");
	ws.send(
		JSON.stringify({
			type: "prompt",
			text: "// 请依次做两件事然后一句话报告：1) 用 show_image 工具展示本机图片 assets/brand/logo.png，caption 写「测试插图」；2) 用 skill_save 工具保存技能：name 填 test-探针技能，description 填 e2e 探针用可删，content 填「# 测试探针写入」。",
		}),
	);
	await waitFor((f) => f.type === "agent" && f.state === "start", 30_000, "agent start");

	// 图片通道：image 消息帧（工具结果翻译）应在回合内到达
	const img = await waitFor((f) => f.type === "message" && f.message?.channel === "image", 240_000, "image 消息帧");
	if (!img.message.src) fail("image 帧缺 src");
	console.log(`── image 帧 ok：src=${img.message.src} caption=「${img.message.text}」`);

	// /media/ 取回图片本体
	if (img.message.src.startsWith("/media/")) {
		const res = await fetch(`http://127.0.0.1:${PORT}${img.message.src}`);
		if (!res.ok) fail(`/media 取图失败：${res.status}`);
		const type = res.headers.get("content-type") ?? "";
		if (!type.startsWith("image/")) fail(`/media Content-Type 不是图片：${type}`);
		console.log(`── /media ok：${res.status} ${type}，${(await res.arrayBuffer()).byteLength} 字节`);
	}

	await waitFor((f) => f.type === "agent" && f.state === "end", 240_000, "agent end");

	// 技能沉淀：文件落盘且 frontmatter 完整
	if (!existsSync(SKILL_FILE)) fail(`技能文件未落盘：${SKILL_FILE}`);
	const skill = readFileSync(SKILL_FILE, "utf8");
	if (!/name: test-探针技能/.test(skill) || !/description: /.test(skill)) fail("技能文件 frontmatter 不完整");
	console.log("── skill_save ok：.rp-skills/test-探针技能.md 已落盘");

	// 刷新重放：重连 WS，hello 历史里应仍有 image 消息（toolResult 翻译路径）
	const ws2 = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
	const hello2 = await new Promise((resolve, reject) => {
		ws2.addEventListener("message", (ev) => {
			const f = JSON.parse(String(ev.data));
			if (f.type === "hello") resolve(f);
		});
		setTimeout(() => reject(new Error("二次 hello 超时")), 10_000);
	});
	const replayImg = hello2.messages.find((m) => m.channel === "image");
	if (!replayImg || !replayImg.src) fail("刷新重放的历史里没有 image 消息");
	console.log("── 重放 ok：hello 历史含 image 消息");
	ws2.close();

	console.log("\n✓ F3-4 冒烟通过（图片通道 + 技能沉淀）");
	done = true;
	clearTimeout(watchdog);
	rmSync(SKILL_FILE, { force: true }); // 探针技能清理（真实技能不受影响）
	ws.close();
	child.kill();
	process.exit(0);
} catch (err) {
	fail(err.message);
}
