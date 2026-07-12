// 通用探针：node scripts/probe-backstage.mjs "<消息>" —— 连 WS 发一条消息，收帧到本轮结束，
// 打印回复通道、正文与工具活动（F3 验收用）。
import WebSocket from "ws";

const text = process.argv[2] ?? "（一句话确认：你收到场外发言了吗？）";
const ws = new WebSocket("ws://localhost:7620/ws");
const frames = [];
let done = false;

const finish = (reason) => {
	if (done) return;
	done = true;
	console.log("=== 探针结果（" + reason + "）===");
	for (const f of frames) {
		if (f.type === "message" && f.message.channel !== "user") {
			console.log(`--- ${f.message.channel} ---`);
			console.log(f.message.text.slice(0, 800));
		}
		if (f.type === "activity") {
			console.log(`[活动] ${f.activity.kind} ${f.activity.name} ${String(f.activity.detail ?? "").slice(0, 220)}`);
		}
		if (f.type === "notify") console.log(`[通知/${f.level}] ${f.text.slice(0, 200)}`);
		if (f.type === "error") console.log(`[错误] ${f.text}`);
	}
	ws.close();
	process.exit(0);
};

ws.on("open", () => setTimeout(() => ws.send(JSON.stringify({ type: "prompt", text })), 500));
ws.on("message", (data) => {
	try {
		const f = JSON.parse(String(data));
		frames.push(f);
		if (f.type === "agent" && f.state === "end") setTimeout(() => finish("本轮结束"), 1200);
	} catch {}
});
setTimeout(() => finish("超时 180s"), 180000);
