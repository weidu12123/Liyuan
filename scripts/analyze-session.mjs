// A/B 记分辅助：解析 pi 会话 JSONL，输出轮次、节拍时间线、工具使用、token 用量与状态文件。
// 用法：node scripts/analyze-session.mjs [sessionFile]（缺省取最新会话）
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function newestSession() {
	const dir = join(homedir(), ".pi", "agent", "sessions", "--E--silly-agent-app--");
	const files = readdirSync(dir)
		.filter((f) => f.endsWith(".jsonl"))
		.map((f) => join(dir, f))
		.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
	return files[0];
}

const file = process.argv[2] ?? newestSession();
const lines = readFileSync(file, "utf8")
	.split("\n")
	.filter(Boolean)
	.map((l) => {
		try {
			return JSON.parse(l);
		} catch {
			return null;
		}
	})
	.filter(Boolean);

let sessionId = "";
let model = "";
let compactions = 0;
const toolCalls = {};
const userTurns = [];
let assistantChars = 0;
let thinkingChars = 0;
const usage = { input: 0, output: 0, cacheRead: 0, cost: 0 };

const textOf = (content) =>
	typeof content === "string"
		? content
		: Array.isArray(content)
			? content.map((p) => (typeof p?.text === "string" ? p.text : "")).join("")
			: "";

for (const e of lines) {
	if (e.type === "session") sessionId = e.id;
	if (e.type === "model_change") model = `${e.provider}/${e.modelId}`;
	if (e.type === "compaction") compactions++;
	if (e.type !== "message") continue;
	const m = e.message ?? {};
	if (m.role === "user") {
		userTurns.push(textOf(m.content).replace(/\s+/g, " ").slice(0, 80));
	} else if (m.role === "assistant") {
		for (const p of m.content ?? []) {
			if (p?.type === "toolCall") toolCalls[p.name] = (toolCalls[p.name] ?? 0) + 1;
			if (p?.type === "text") assistantChars += (p.text ?? "").length;
			if (p?.type === "thinking") thinkingChars += (p.thinking ?? "").length;
		}
		const u = m.usage;
		if (u) {
			usage.input += u.input ?? 0;
			usage.output += u.output ?? 0;
			usage.cacheRead += u.cacheRead ?? 0;
			usage.cost += u.cost?.total ?? 0;
		}
	}
}

console.log(`会话: ${file}`);
console.log(`模型: ${model || "(默认)"}  压缩次数: ${compactions}`);
console.log(`用户轮次: ${userTurns.length}`);
userTurns.forEach((t, i) => console.log(`  ${String(i + 1).padStart(2)}. ${t}`));
console.log(`工具调用: ${JSON.stringify(toolCalls)}`);
console.log(`正文字符: ${assistantChars}  思考字符: ${thinkingChars}`);
console.log(
	`用量: input ${usage.input}  output ${usage.output}  cacheRead ${usage.cacheRead}  cost $${usage.cost.toFixed(4)}`,
);

const stateFile = join(appDir, ".rp-state", `${sessionId}.json`);
if (existsSync(stateFile)) {
	console.log(`\n世界状态 (${stateFile}):`);
	console.log(readFileSync(stateFile, "utf8"));
} else {
	console.log(`\n（无状态文件: ${stateFile}）`);
}
