// 柱 1 决策门禁 e2e 驱动：连上运行中的 7620 实例，发一条容易触发决策点的戏内指令，
// 等 choice 帧（选择卡）出现后自动回一个选项，确认 choice_resolved + 叙事继续。
// 用法：node scripts/drive-choice-test.mjs ["<prompt>"]
const PORT = process.env.PORT ?? 7620;
const prompt =
	process.argv[2] ??
	"一位重要的新角色即将登场，会长期影响剧情。在把她写定之前，请先征求我的意见再落笔。";

const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
let agentStarted = false;
let asked = false;
let resolved = false;
let narrativeAfter = false;
const t0 = Date.now();
const ts = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;

const bail = setTimeout(() => {
	console.error(`${ts()} ✗ 总超时（600s）`);
	process.exit(1);
}, 600_000);

ws.addEventListener("open", () => console.log(`${ts()} 已连接`));
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
				console.log(
					`${ts()} 结果：询问=${asked ? "✓" : "✗"} 收敛=${resolved ? "✓" : "✗"} 应答后有叙事=${narrativeAfter ? "✓" : "✗"}`,
				);
				clearTimeout(bail);
				setTimeout(() => process.exit(asked && resolved ? 0 : 2), 500);
			}
			break;
		case "choice":
			asked = true;
			console.log(`${ts()} ★ 选择卡：问「${f.question}」`);
			f.options.forEach((o, i) => console.log(`        ${i + 1}. ${o}`));
			// 自动挑第一个选项应答（1s 后，模拟用户思考）
			setTimeout(() => {
				console.log(`${ts()} → 应答：选「${f.options[0]}」`);
				ws.send(JSON.stringify({ type: "choice_reply", id: f.id, value: f.options[0] }));
			}, 1000);
			break;
		case "choice_resolved":
			resolved = true;
			console.log(`${ts()} 选择卡已收敛（answer=${f.answer ?? ""} stopped=${f.stopped ?? false}）`);
			break;
		case "activity":
			if (f.activity.kind === "tool_start") console.log(`${ts()} 工具 → ${f.activity.name} ${f.activity.detail ?? ""}`);
			break;
		case "message":
			if (f.message.channel === "narrative") {
				if (resolved) narrativeAfter = true;
				console.log(`${ts()} 叙事：${f.message.text.slice(0, 160)}`);
			} else if (f.message.channel === "choice") {
				console.log(`${ts()} 留痕选择卡帧：${JSON.stringify(f.message.choice)}`);
			}
			break;
		case "notify":
			console.log(`${ts()} [${f.level}] ${f.text.slice(0, 160)}`);
			break;
		case "error":
			console.log(`${ts()} [error] ${f.text}`);
			break;
	}
});
