// 柱 3 知识库 e2e 驱动：连运行中实例，戏外指令让模型 codex_create 建库并 codex_write 写一条知识，
// 门禁卡（codex_write 落盘门禁）弹出后回「写入」，回合结束断言 .rp-codex/<库>.json 落盘含该条目。
// 用法：node scripts/drive-codex-test.mjs
import { existsSync, readFileSync } from "node:fs";

const PORT = process.env.PORT ?? 7620;
const LIB = `e2e图鉴${Date.now().toString(36)}`;
const MARK = `蚀骨兰${Date.now().toString(36)}`;
const prompt = `//请依次做两件事：1) 用 codex_create 创建一个知识库，名字就叫「${LIB}」；2) 用 codex_write 往这个库写一条知识，标题「${MARK}」，关键词 ["${MARK}"]，内容：「生于火山岩缝的赤色兰花，汁液可蚀铁。」不要问我，直接调用工具。`;

const codexFile = `.rp-codex/${LIB}.json`;
const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
let created = false;
let wrote = false;
let gateShown = false;
const t0 = Date.now();
const ts = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;

const bail = setTimeout(() => {
	console.error(`${ts()} ✗ 总超时（600s）`);
	process.exit(1);
}, 600_000);

const finish = () => {
	clearTimeout(bail);
	const onDisk = existsSync(codexFile) && readFileSync(codexFile, "utf8").includes(MARK);
	console.log(
		`${ts()} 断言：codex_create=${created ? "✓" : "✗"} 门禁卡=${gateShown ? "✓" : "（silent 档无卡）"} codex_write=${wrote ? "✓" : "✗"} 落盘=${onDisk ? "✓" : "✗"}（${codexFile}）`,
	);
	const ok = created && wrote && onDisk;
	console.log(ok ? `${ts()} ✓ 知识库全链路通过` : `${ts()} ✗ 知识库链路未通`);
	setTimeout(() => process.exit(ok ? 0 : 2), 300);
};

let sent = false;
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
		case "choice": {
			gateShown = true;
			console.log(`${ts()} ★ 门禁卡：「${f.question.slice(0, 120)}…」 选项=[${f.options.join("，")}]`);
			setTimeout(() => {
				console.log(`${ts()} → 应答：「写入」`);
				ws.send(JSON.stringify({ type: "choice_reply", id: f.id, value: "写入" }));
			}, 500);
			break;
		}
		case "activity":
			if (f.activity.kind === "tool_start" && f.activity.name.startsWith("codex_")) {
				console.log(`${ts()} 工具 → ${f.activity.name}`);
			}
			if (f.activity.kind === "tool_end" && f.activity.name.startsWith("codex_")) {
				console.log(`${ts()} 工具 ← ${f.activity.name}（isError=${f.activity.isError ?? false}）：${(f.activity.detail ?? "").slice(0, 120)}`);
				if (f.activity.name === "codex_create" && !f.activity.isError) created = true;
				if (f.activity.name === "codex_write" && !f.activity.isError) wrote = true;
			}
			break;
		case "message":
			if (f.message.channel === "backstage") console.log(`${ts()} 助手：${f.message.text.slice(0, 150)}`);
			break;
		case "agent":
			if (f.state === "end" && sent) {
				console.log(`${ts()} ── 回合结束`);
				finish();
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
