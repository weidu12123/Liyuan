// 上传功能 e2e：上传一个含唯一标记的文本文件 → 校验 /uploads/ 回读 → 戏外让 agent
// 读上传文件复述标记（附件随消息 + 每轮【上传文件】速览让 agent 找得到文件）。
// 前提：服务器运行中（npm run web:new）。
const PORT = process.env.PORT ?? 7620;
const MARKER = `LIYUAN-UPLOAD-${Date.now().toString(36).toUpperCase()}`;
const t0 = Date.now();
const ts = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;

async function main() {
	// 1. 上传含标记的文本文件
	const name = "测试笔记.txt";
	const content = `这是一份上传测试文件。\n暗号：${MARKER}\n请在被问到时原样复述暗号。`;
	const up = await fetch(`http://localhost:${PORT}/api/upload?name=${encodeURIComponent(name)}`, {
		method: "POST",
		headers: { "content-type": "application/octet-stream" },
		body: Buffer.from(content, "utf8"),
	});
	const upJson = await up.json();
	if (!up.ok || !upJson.file) throw new Error(`上传失败：${JSON.stringify(upJson)}`);
	console.log(`${ts()} 上传成功 → ${upJson.file}（${upJson.size}）`);

	// 2. /uploads/ 回读校验
	const fname = upJson.file.replace(".rp-uploads/", "");
	const back = await fetch(`http://localhost:${PORT}/uploads/${encodeURIComponent(fname)}`);
	const backText = await back.text();
	const served = back.ok && backText.includes(MARKER);
	console.log(`${ts()} /uploads/ 回读：${served ? "✓" : "✗"}（HTTP ${back.status}）`);

	// 3. agent 读文件复述标记
	const prompt = `//戏外：我刚上传了一个文件 ${upJson.file}。请用 read 读它，把里面的暗号原样告诉我。不要问我，直接做。`;
	const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
	let read = false;
	let echoed = false;
	let sent = false;
	const bail = setTimeout(() => {
		console.error(`${ts()} ✗ 总超时（300s）`);
		process.exit(1);
	}, 300_000);

	ws.addEventListener("message", (ev) => {
		const f = JSON.parse(String(ev.data));
		switch (f.type) {
			case "hello":
				if (!sent) {
					sent = true;
					console.log(`${ts()} hello：会话 ${f.sessionId.slice(0, 8)}…`);
					ws.send(JSON.stringify({ type: "prompt", text: prompt }));
				}
				break;
			case "activity":
				if (f.activity.kind === "tool_end" && f.activity.name === "read") {
					read = true;
					console.log(`${ts()} 工具 ← read`);
				}
				break;
			case "message":
				if (f.message.role !== "user" && f.message.text.includes(MARKER)) echoed = true;
				if (f.message.role !== "user") console.log(`${ts()} 助手（${f.message.channel}）：${f.message.text.slice(0, 120)}`);
				break;
			case "agent":
				if (f.state === "end" && sent) {
					clearTimeout(bail);
					const ok = served && read && echoed;
					console.log(`${ts()} 断言：/uploads 回读=${served ? "✓" : "✗"} read=${read ? "✓" : "✗"} 暗号复述=${echoed ? "✓" : "✗"}`);
					console.log(ok ? `${ts()} ✓ 上传功能全链路通过` : `${ts()} ✗ 未通过`);
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
}

main().catch((e) => {
	console.error(`${ts()} ✗ ${e.message}`);
	process.exit(1);
});
