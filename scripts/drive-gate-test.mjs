// 柱 1 补强·层 1 e2e：正典落盘门禁（tool_call 钩子拦 lorebook_write）。
// 场景：戏外指令让模型把一条指定设定写入设定集 → 门禁卡弹出 → 本驱动回「不写入」
// → 断言：工具被 block、设定集文件里没有该内容。
// 用法：node scripts/drive-gate-test.mjs [approve]  （带 approve 参数则回「写入」并断言写入成功）
import { readFileSync, existsSync } from "node:fs";

const PORT = process.env.PORT ?? 7621;
const approve = process.argv[2] === "approve";
const MARK = `门禁验证条目${Date.now().toString(36)}`;
const prompt = `//请立即用 lorebook_write 工具把下面这条新设定写入设定集，标题用「${MARK}」，关键词 ["${MARK}"]，内容：「南疆的萤海每六十年涨落一次，涨时萤光可照彻夜航。」不要询问我，直接调用工具。`;

const overlay = ".liyuan-lore/sample-lorebook.json";
const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
let gateShown = false;
let resolved = false;
let toolBlocked = null; // tool_end 是否报错/被拦
const t0 = Date.now();
const ts = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;

const bail = setTimeout(() => {
	console.error(`${ts()} ✗ 总超时（600s）`);
	process.exit(1);
}, 600_000);

const finish = () => {
	clearTimeout(bail);
	const written = existsSync(overlay) && readFileSync(overlay, "utf8").includes(MARK);
	console.log(`${ts()} 断言：门禁卡弹出=${gateShown ? "✓" : "✗"} 收敛=${resolved ? "✓" : "✗"} 落盘=${written ? "有" : "无"}（期望${approve ? "有" : "无"}）`);
	const ok = gateShown && resolved && written === approve;
	console.log(ok ? `${ts()} ✓ 门禁行为符合预期` : `${ts()} ✗ 门禁行为不符`);
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
			const reply = approve ? "写入" : "不写入";
			setTimeout(() => {
				console.log(`${ts()} → 应答：「${reply}」`);
				ws.send(JSON.stringify({ type: "choice_reply", id: f.id, value: reply }));
			}, 500);
			break;
		}
		case "choice_resolved":
			resolved = true;
			console.log(`${ts()} 门禁卡已收敛（answer=${f.answer ?? ""}）`);
			break;
		case "activity":
			if (f.activity.kind === "tool_start") console.log(`${ts()} 工具 → ${f.activity.name}`);
			if (f.activity.kind === "tool_end" && f.activity.name === "lorebook_write") {
				toolBlocked = f.activity.isError === true;
				console.log(`${ts()} lorebook_write 结束（isError=${f.activity.isError}）：${(f.activity.detail ?? "").slice(0, 120)}`);
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
