// 柱 3 跨对话挂载 e2e：在一个全新会话中 codex_mount 已存在的库，lorebook_search 检索其中条目。
// 用法：node scripts/drive-codex-mount-test.mjs <库名> <检索词>
const PORT = process.env.PORT ?? 7620;
const LIB = process.argv[2];
const TERM = process.argv[3];
if (!LIB || !TERM) {
	console.error("用法：node scripts/drive-codex-mount-test.mjs <库名> <检索词>");
	process.exit(1);
}
const prompt = `//请先用 codex_mount 挂载知识库「${LIB}」，然后用 lorebook_search 检索「${TERM}」，把检索到的内容原样告诉我。不要问我，直接做。`;

const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
let mounted = false;
let searched = false;
let reported = false;
const t0 = Date.now();
const ts = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
const bail = setTimeout(() => {
	console.error(`${ts()} ✗ 总超时（600s）`);
	process.exit(1);
}, 600_000);

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
		case "activity":
			if (f.activity.kind === "tool_end") {
				console.log(`${ts()} 工具 ← ${f.activity.name}（isError=${f.activity.isError ?? false}）：${(f.activity.detail ?? "").slice(0, 100)}`);
				if (f.activity.name === "codex_mount" && !f.activity.isError) mounted = true;
				if (f.activity.name === "lorebook_search" && (f.activity.detail ?? "").includes(TERM)) searched = true;
			}
			break;
		case "message":
			if (f.message.channel === "backstage") {
				if (f.message.text.includes("蚀铁") || f.message.text.includes(TERM)) reported = true;
				console.log(`${ts()} 助手：${f.message.text.slice(0, 150)}`);
			}
			break;
		case "agent":
			if (f.state === "end" && sent) {
				clearTimeout(bail);
				console.log(`${ts()} 断言：挂载=${mounted ? "✓" : "✗"} 检索命中=${searched ? "✓" : "✗"} 正文复述=${reported ? "✓" : "✗"}`);
				const ok = mounted && searched && reported;
				console.log(ok ? `${ts()} ✓ 跨对话挂载检索通过` : `${ts()} ✗ 未通过`);
				setTimeout(() => process.exit(ok ? 0 : 2), 300);
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
