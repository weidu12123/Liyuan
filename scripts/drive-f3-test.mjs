// F3 验收驱动：连上正在运行的 7620 实例，以用户身份发一条戏外生图指令，
// 记录全部 wire 帧（工具活动/图片帧/最终报告），agent_end 后退出。
// 用法：node scripts/drive-f3-test.mjs "<prompt>" [--wait-image]
const PORT = process.env.PORT ?? 7620;
const prompt = process.argv[2];
if (!prompt) {
	console.error("用法：node scripts/drive-f3-test.mjs \"<prompt>\"");
	process.exit(1);
}

const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
let agentStarted = false;
const t0 = Date.now();
const ts = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;

const bail = setTimeout(() => {
	console.error(`${ts()} ✗ 总超时（600s）`);
	process.exit(1);
}, 600_000);

ws.addEventListener("open", () => {
	console.log(`${ts()} 已连接，发送指令…`);
});
ws.addEventListener("error", (e) => {
	console.error(`${ts()} ✗ WS 错误：${e.message ?? e}`);
	process.exit(1);
});

let sent = false;
ws.addEventListener("message", (ev) => {
	const f = JSON.parse(String(ev.data));
	switch (f.type) {
		case "hello":
			if (!sent) {
				sent = true;
				console.log(`${ts()} hello：会话 ${f.sessionId.slice(0, 8)}… 历史 ${f.messages.length} 条`);
				ws.send(JSON.stringify({ type: "prompt", text: prompt }));
			}
			break;
		case "agent":
			if (f.state === "start") agentStarted = true;
			if (f.state === "end" && agentStarted) {
				console.log(`${ts()} ── agent 回合结束`);
				clearTimeout(bail);
				setTimeout(() => process.exit(0), 500);
			}
			break;
		case "activity":
			if (f.activity.kind === "tool_start") console.log(`${ts()} 工具 → ${f.activity.name} ${f.activity.detail ?? ""}`);
			else console.log(`${ts()} 结果 ← ${f.activity.isError ? "✗" : "✓"} ${(f.activity.detail ?? "").slice(0, 150)}`);
			break;
		case "message":
			if (f.message.channel === "image") console.log(`${ts()} ★ 图片帧：src=${f.message.src} caption=「${f.message.text}」`);
			else if (f.message.channel === "backstage") console.log(`${ts()} 助手回复：${f.message.text.slice(0, 400)}`);
			else if (f.message.channel === "narrative") console.log(`${ts()} 叙事：${f.message.text.slice(0, 200)}`);
			break;
		case "notify":
			console.log(`${ts()} [${f.level}] ${f.text.slice(0, 200)}`);
			break;
		case "error":
			console.log(`${ts()} [error] ${f.text}`);
			break;
	}
});
