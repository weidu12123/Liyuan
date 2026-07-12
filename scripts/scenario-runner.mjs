// 剧本跑测器：通过 RPC 模式驱动一场完整的多轮 RP（含压缩与探针），
// 用于 Phase 1 的 S1/S2/S3 自证，以及后续任何提示词/harness 改动的回归测试。
// 用法：node scripts/scenario-runner.mjs [scenario.json] [--model provider/id]
// 输出：控制台进度 + assets/ab-test/agent-run.md 完整记录
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const modelIdx = argv.indexOf("--model");
const model = modelIdx >= 0 ? argv[modelIdx + 1] : "deepseek/deepseek-v4-flash";
const scenarioPath = argv.find((a) => a.endsWith(".json")) ?? join(appDir, "assets", "ab-test", "scenario.json");
const scenario = JSON.parse(readFileSync(scenarioPath, "utf8"));

// 测试期临时调低压缩阈值：默认 keepRecentTokens=20000，短剧本会话达不到，
// compact 会以 "session too small" 失败，S3 探针就测不到真实压缩。跑完恢复原设置。
// 1200 而非 3000：中文短回复的估算 token 偏低（chars/4 启发式），3000 曾放空一整场（run-04）。
const settingsPath = join(appDir, ".liyuan", "settings.json");
const settingsBackup = readFileSync(settingsPath, "utf8");
writeFileSync(
	settingsPath,
	JSON.stringify({ ...JSON.parse(settingsBackup), compaction: { keepRecentTokens: 1200 } }, null, "\t"),
	"utf8",
);
const restoreSettings = () => {
	try {
		writeFileSync(settingsPath, settingsBackup, "utf8");
	} catch {}
};
process.on("exit", restoreSettings);

// 使用本地 fork 的 liyuan-agent（file:../liyuan-runtime），扩展在 .liyuan/extensions/
const child = spawn(
	"npx",
	["liyuan-agent", "--mode", "rpc", "-e", ".liyuan/extensions/roleplay.ts", "--model", model],
	{
		cwd: appDir,
		shell: process.platform === "win32",
		env: process.env,
	},
);
child.stderr.on("data", (d) => process.stderr.write(d));
child.on("exit", (code) => {
	if (!finished) {
		console.error(`liyuan-agent 进程提前退出（code ${code}）`);
		process.exit(1);
	}
});

let finished = false;
let buffer = "";
const waiters = [];
let lastAssistantText = "";
let currentTools = [];

const textOf = (content) =>
	Array.isArray(content)
		? content
				.filter((p) => p?.type === "text" && typeof p.text === "string")
				.map((p) => p.text)
				.join("\n")
		: typeof content === "string"
			? content
			: "";

child.stdout.on("data", (chunk) => {
	buffer += chunk.toString("utf8");
	let idx;
	// 协议规定：只以 \n 分帧（不用 readline）
	while ((idx = buffer.indexOf("\n")) !== -1) {
		const line = buffer.slice(0, idx).replace(/\r$/, "");
		buffer = buffer.slice(idx + 1);
		if (!line.trim()) continue;
		let evt;
		try {
			evt = JSON.parse(line);
		} catch {
			continue;
		}
		if (evt.type === "message_end" && evt.message?.role === "assistant") {
			const t = textOf(evt.message.content);
			if (t) lastAssistantText = t;
		}
		if (evt.type === "tool_execution_start") {
			currentTools.push(evt.toolName ?? evt.name ?? "?");
		}
		for (const w of [...waiters]) {
			if (w.match(evt)) {
				waiters.splice(waiters.indexOf(w), 1);
				w.resolve(evt);
			}
		}
	}
});

const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
const waitFor = (match, ms, what) =>
	new Promise((resolve, reject) => {
		const w = { match, resolve };
		waiters.push(w);
		setTimeout(() => {
			if (waiters.includes(w)) {
				waiters.splice(waiters.indexOf(w), 1);
				reject(new Error(`等待 ${what} 超时（${ms}ms）`));
			}
		}, ms);
	});

const records = [];
let commandCount = 0;
async function run() {
	// 等扩展与会话就绪（首个事件即可视作进程活着；直接小睡后开打）
	await new Promise((r) => setTimeout(r, 8000));
	let turn = 0;
	for (const step of scenario.steps) {
		if (step.say) {
			turn++;
			currentTools = [];
			lastAssistantText = "";
			console.log(`\n── 第 ${turn} 轮 [${step.label ?? ""}]`);
			console.log(`> ${step.say}`);
			send({ id: `t${turn}`, type: "prompt", message: step.say });
			await waitFor((e) => e.type === "agent_end", 300000, `第 ${turn} 轮 agent_end`);
			console.log(`< ${lastAssistantText.slice(0, 120).replace(/\n/g, " ")}…`);
			console.log(`  [工具: ${currentTools.join(", ") || "无"}]`);
			records.push({ turn, label: step.label ?? "", say: step.say, reply: lastAssistantText, tools: [...currentTools] });
		} else if ("compact" in step) {
			console.log(`\n── 压缩上下文…`);
			send({ id: "compact", type: "compact", ...(step.compact ? { customInstructions: step.compact } : {}) });
			const resp = await waitFor((e) => e.type === "response" && e.command === "compact", 300000, "compact 响应");
			if (resp.success === false) {
				throw new Error(`压缩失败：${resp.error}——S3 探针无效，中止本次运行`);
			}
			const d = resp.data ?? {};
			console.log(`  tokens ${d.tokensBefore} → ~${d.estimatedTokensAfter}`);
			records.push({ compact: true, tokensBefore: d.tokensBefore, tokensAfter: d.estimatedTokensAfter, summary: d.summary });
		} else if (step.command) {
			// 斜杠命令（如 /import）：prompt 通道送达，扩展命令执行完毕后才回响应
			console.log(`\n── 命令 ${step.command}`);
			const id = `cmd${++commandCount}`;
			send({ id, type: "prompt", message: step.command });
			const resp = await waitFor((e) => e.type === "response" && e.id === id, 300000, `命令 ${step.command} 响应`);
			if (resp.success === false) {
				throw new Error(`命令失败：${resp.error}`);
			}
			console.log(`  完成`);
			records.push({ command: step.command });
		}
	}
	finished = true;

	const md = [
		`# 自证剧本运行记录`,
		`模型：${model}  时间：${new Date().toISOString()}  剧本：${scenarioPath}`,
		"",
		...records.map((r) =>
			r.compact
				? `## ⟲ 上下文压缩\ntokens ${r.tokensBefore} → ~${r.tokensAfter}\n\n<details><summary>摘要</summary>\n\n${r.summary ?? ""}\n\n</details>\n`
				: r.command
					? `## ⌘ ${r.command}\n`
					: `## 第 ${r.turn} 轮 [${r.label}]\n> 用户：${r.say}\n\n${r.reply}\n\n\`工具: ${r.tools.join(", ") || "无"}\`\n`,
		),
	].join("\n");
	writeFileSync(join(appDir, "assets", "ab-test", "agent-run.md"), md, "utf8");
	console.log(`\n完成。记录已写入 assets/ab-test/agent-run.md`);
	child.kill();
	process.exit(0);
}

run().catch((err) => {
	console.error(`运行失败：${err.message}`);
	child.kill();
	process.exit(1);
});
