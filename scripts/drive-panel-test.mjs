// 柱 2 自建面板 e2e 驱动：连上运行中的 7620 实例，发一条要求建面板的指令，
// 断言 hello 帧带 panels 字段、panels 帧推送到达且含新面板。
// 用法：node scripts/drive-panel-test.mjs ["<prompt>"]
const PORT = process.env.PORT ?? 7620;
const prompt =
	process.argv[2] ??
	"（帮我建一个「装备库」面板，把我目前身上的物品列进去；之后剧情里物品有增减要随时更新这个面板）";

const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
let agentStarted = false;
let helloHasPanels = false;
let panelsFrame = false;
let panelNames = [];
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
				helloHasPanels = Array.isArray(f.panels);
				console.log(
					`${ts()} hello：会话 ${f.sessionId.slice(0, 8)}… 历史 ${f.messages.length} 条，面板字段=${helloHasPanels ? `✓（现有 ${f.panels.length} 个）` : "✗ 缺失"}`,
				);
				ws.send(JSON.stringify({ type: "prompt", text: prompt }));
			}
			break;
		case "panels":
			panelsFrame = true;
			panelNames = f.panels.map((p) => `${p.name}(${p.kind})`);
			console.log(`${ts()} ★ panels 帧：${panelNames.join("、") || "（空）"}`);
			break;
		case "activity":
			if (f.activity.name.startsWith("panel_")) {
				console.log(`${ts()} 工具 ${f.activity.kind === "tool_start" ? "→" : "←"} ${f.activity.name} ${f.activity.detail ?? ""}`);
			}
			break;
		case "agent":
			if (f.state === "start") agentStarted = true;
			if (f.state === "end" && agentStarted) {
				// panels 帧经 fs.watch 去抖（200ms），回合结束后再等一拍
				setTimeout(() => {
					console.log(`${ts()} ── agent 回合结束`);
					console.log(
						`${ts()} 结果：hello带panels=${helloHasPanels ? "✓" : "✗"} panels帧=${panelsFrame ? "✓" : "✗"} 面板=[${panelNames.join("、")}]`,
					);
					clearTimeout(bail);
					process.exit(helloHasPanels && panelsFrame && panelNames.length > 0 ? 0 : 2);
				}, 1500);
			}
			break;
		case "notify":
			console.log(`${ts()} notify(${f.level})：${f.text.split("\n")[0]}`);
			break;
	}
});
