// 技能系统 e2e：验证 pi 原生 /skill:name 显式触发在 Web 路径可用。
// 前提：settings.json 已挂 skills:[".rp-skills"]；服务器运行中（npm run web / web:new）。
// 断言：发送 /skill:codex-生图 + 戏外提问 → 模型回答中出现技能正文独有的 Base URL
// （prompt 本身不含该串，出现 = 命令在 session.prompt 内被展开成 <skill> 块，全链路通）。
const PORT = process.env.PORT ?? 7620;
const MARKER = "codex.weidu.my";
const prompt = "/skill:codex-生图 //戏外：不要调用任何服务、不要生图。只用一句话回答：这份技能笔记里写的 Base URL 是什么？";

const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
let hit = false;
const t0 = Date.now();
const ts = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
const bail = setTimeout(() => {
	console.error(`${ts()} ✗ 总超时（300s）`);
	process.exit(1);
}, 300_000);

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
		case "message":
			if (f.message.role !== "user") {
				if (f.message.text.includes(MARKER)) hit = true;
				console.log(`${ts()} 助手（${f.message.channel}）：${f.message.text.slice(0, 200)}`);
			}
			break;
		case "agent":
			if (f.state === "end" && sent) {
				clearTimeout(bail);
				console.log(`${ts()} 断言：技能展开可见=${hit ? "✓" : "✗"}（回答含 ${MARKER}）`);
				console.log(hit ? `${ts()} ✓ /skill:name 显式触发通过` : `${ts()} ✗ 未通过`);
				setTimeout(() => process.exit(hit ? 0 : 2), 300);
			}
			break;
		case "error":
			console.log(`${ts()} [error] ${f.text}`);
			break;
	}
});
ws.addEventListener("error", (e) => {
	console.error(`${ts()} ✗ WS 错误：${e.message ?? e}`);
	process.exit(1);
});
