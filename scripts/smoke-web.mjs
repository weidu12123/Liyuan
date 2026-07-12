// Web 冒烟：起 server → WS 连接 → hello（含 state/stats）→ sessions（卡过滤）断言。
// 默认不调用 LLM（续接最近会话：验证「打开即写 rp-card」）；加 --full 用 --new 开新会话
// 并跑一次真实 prompt 往返（pi 在首条 assistant 回复时才整体落盘，顺带验证 rp-card 随之物化）。
// 用法：node scripts/smoke-web.mjs [--full]
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 7621;
const FULL = process.argv.includes("--full");
const fail = (msg) => {
	console.error(`✗ ${msg}`);
	child?.kill();
	process.exit(1);
};

console.log(`── 启动 server（${FULL ? "--new 新会话" : "续接最近会话"}）…`);
const child = spawn(process.execPath, FULL ? ["server/main.ts", "--new"] : ["server/main.ts"], {
	cwd: appDir,
	env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" },
});
child.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
child.on("exit", (code) => {
	if (!done) fail(`server 提前退出（code ${code}）`);
});
let done = false;

const watchdog = setTimeout(() => fail("总超时（300s）"), 300_000);

// 等健康检查就绪
let health;
for (let i = 0; i < 120; i++) {
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
console.log(`── healthz ok：会话 ${health.sessionId.slice(0, 8)}… 角色「${health.char}」`);

// WS 连接与帧断言
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
	// F1：hello 必须带 state 与 stats
	const hello = await waitFor((f) => f.type === "hello", 10_000, "hello");
	if (!hello.charName || !Array.isArray(hello.messages)) fail("hello 帧缺字段");
	if (!hello.state || typeof hello.state !== "object" || !("plot_threads" in hello.state)) fail("hello.state 缺失或形状不对");
	if (hello.stats !== null && typeof hello.stats?.totalTokens !== "number") fail("hello.stats 形状不对");
	console.log(`── hello ok：char=${hello.charName} 历史 ${hello.messages.length} 条 · state 就绪 · stats=${hello.stats ? "有" : "null"}`);

	// F1：sessions 按卡过滤。注意 pi 惰性落盘：空的新会话不在列表（--full 模式下
	// 要等首条回复后才出现），所以只在默认模式（续接非空会话）断言 current 与卡标记。
	ws.send(JSON.stringify({ type: "sessions" }));
	const sess = await waitFor((f) => f.type === "sessions", 10_000, "sessions");
	const marked = sess.list.filter((s) => !s.legacy).length;
	const legacy = sess.list.filter((s) => s.legacy).length;
	const bad = sess.list.find((s) => !s.legacy && !s.cardName);
	if (bad) fail(`列表项 ${bad.id.slice(0, 8)} 既无 cardName 又非 legacy`);
	console.log(`── sessions ok：本卡 ${marked} 个 · 未标记旧会话 ${legacy} 个`);
	if (!FULL) {
		const current = sess.list.find((s) => s.current);
		if (!current) fail("续接模式下列表里没有 current 会话");
		if (current.legacy) fail("当前会话未被 rp-card 标记——扩展打开即写失败？");
		console.log(`── rp-card ok：当前会话卡名「${current.cardName}」`);
	}

	if (FULL) {
		ws.send(JSON.stringify({ type: "prompt", text: "（连通性测试）请只用一句话回应我的到来。" }));
		await waitFor((f) => f.type === "message" && f.message?.channel === "user", 5_000, "用户回显");
		console.log("── 用户回显 ok");

		await waitFor((f) => f.type === "agent" && f.state === "start", 30_000, "agent start");
		const reply = await waitFor((f) => f.type === "message" && f.message?.channel === "narrative", 240_000, "叙事回复");
		const deltas = frames.filter((f) => f.type === "delta" && f.kind === "text").length;
		await waitFor((f) => f.type === "agent" && f.state === "end", 60_000, "agent end");
		const gotStats = frames.some((f) => f.type === "stats");

		console.log(`── 流式 ok：${deltas} 个 text_delta · 回合后 stats 帧=${gotStats ? "有" : "无"}`);
		console.log(`── 回复：${reply.message.text.slice(0, 100).replace(/\n/g, " ")}…`);
		if (deltas < 2) fail("流式增量少于 2，疑似非流式");
		if (!gotStats) fail("agent_end 后未收到 stats 帧");

		// 首条回复已落盘：新会话此刻应带 rp-card 出现在列表
		frames.length = 0;
		ws.send(JSON.stringify({ type: "sessions" }));
		const sess2 = await waitFor((f) => f.type === "sessions", 10_000, "sessions(二次)");
		const cur2 = sess2.list.find((s) => s.current);
		if (!cur2) fail("首条回复后新会话仍不在列表");
		if (!cur2.cardName) fail("新会话落盘后无 rp-card 标记");
		console.log(`── rp-card ok：新会话落盘即标记「${cur2.cardName}」`);
	}

	console.log(`\n✓ 冒烟通过（${FULL ? "含 LLM 往返" : "无 LLM，加 --full 可全测"}）`);
	done = true;
	clearTimeout(watchdog);
	ws.close();
	child.kill();
	process.exit(0);
} catch (err) {
	fail(err.message);
}
