import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";

import { loadCardConfig } from "../src/cardspace.ts";
import {
	addPermanentGrant, createSandboxGate, describeAsk, grantUnit, NATIVE_TOOL_ACCESS, permanentGrants, realExisting,
	SANDBOX_GRANT_TYPE, sandboxGrantsFromBranch, sandboxScope, sandboxVerdict, type SandboxGrants,
} from "../src/sandbox.ts";
import { AUTHORING_NATIVE_TOOLS } from "../src/stage/authoring.ts";

/** 沙箱每拍读 <agentDir>/BASH_DENYLIST.txt：本文件把 agentDir 指到临时目录，不读用户本机 */
const AGENT_DIR = realpathSync(mkdtempSync(join(tmpdir(), "liyuan-sandbox-agent-")));
process.env.LIYUAN_CODING_AGENT_DIR = AGENT_DIR;
after(() => rmSync(AGENT_DIR, { recursive: true, force: true }));

const NO_GRANTS: SandboxGrants = { dirs: [], bashAllow: [] };

/** 工程根：一张卡库里的卡 + 另一张卡 + 公共库 + 梨园自己的代码 + 根下配置文件 */
function makeWorkspace() {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "liyuan-sandbox-")));
	const cardDir = join(cwd, "cards", "云澜");
	mkdirSync(join(cardDir, "对话"), { recursive: true });
	writeFileSync(join(cardDir, "云澜.json"), JSON.stringify({ data: { name: "云澜", description: "师姐" } }));
	mkdirSync(join(cwd, "cards", "其他", "对话"), { recursive: true });
	writeFileSync(join(cwd, "cards", "其他", "其他.json"), JSON.stringify({ data: { name: "其他" } }));
	writeFileSync(join(cwd, "cards", "其他", "对话", "x.jsonl"), "");
	mkdirSync(join(cwd, "assets", "lorebooks"), { recursive: true });
	writeFileSync(join(cwd, "assets", "lorebooks", "书.json"), "{}");
	mkdirSync(join(cwd, "web", "src"), { recursive: true });
	writeFileSync(join(cwd, "web", "src", "a.ts"), "");
	writeFileSync(join(cwd, "liyuan.config.json"), JSON.stringify({ card: "cards/云澜/云澜.json" }));
	const config = { card: "cards/云澜/云澜.json", lorebooks: ["assets/lorebooks/书.json"] };
	return { cwd, cardDir, config, scope: sandboxScope(cwd, config) };
}

test("沙箱：原生工具清单与沙箱映射是同一份", () => {
	assert.deepEqual([...AUTHORING_NATIVE_TOOLS].sort(), Object.keys(NATIVE_TOOL_ACCESS).sort());
});

test("沙箱：允许集＝卡目录＋创作目录；只读根＝公共库＋挂载的书", () => {
	const { cwd, cardDir, scope } = makeWorkspace();
	try {
		assert.equal(scope.cardDir, cardDir);
		assert.ok(scope.roots.includes(cardDir));
		assert.ok(scope.roots.includes(join(cardDir, "创作")), "创作目录在卡目录里，也进允许集");
		assert.ok(scope.readRoots.includes(join(cwd, "assets", "lorebooks")));
		assert.ok(scope.readRoots.includes(join(cwd, "skills")));
		assert.ok(scope.readRoots.includes(join(cwd, "assets", "lorebooks", "书.json")), "挂载的书文件跟着进只读根");
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("沙箱判定：卡内自由、公共库只读、其余申请；bash 与非原生工具", () => {
	const { cwd, cardDir, scope } = makeWorkspace();
	try {
		const v = (tool: string, input: Record<string, unknown>, grants = NO_GRANTS) => sandboxVerdict(tool, input, scope, grants);
		assert.deepEqual(v("read", { path: join(cardDir, "云澜.json") }), { kind: "allow" });
		assert.deepEqual(v("write", { path: join(cardDir, "创作", "新目录", "新文件.txt") }), { kind: "allow" }, "尚不存在的卡内路径照样放行");
		assert.deepEqual(v("read", { path: "cards/云澜/对话" }), { kind: "allow" }, "相对路径按工作目录解析");
		assert.deepEqual(v("read", { path: "assets/lorebooks/书.json" }), { kind: "allow" }, "公共库可读");
		const w = v("write", { path: "assets/lorebooks/书.json" });
		assert.equal(w.kind, "ask", "公共库不可写");
		assert.equal(w.kind === "ask" && w.unit, join(cwd, "assets", "lorebooks"), "assets 下授权到第二层");
		const web = v("read", { path: "web/src/a.ts" });
		assert.equal(web.kind === "ask" && web.unit, join(cwd, "web"), "工程根内授权到顶层目录");
		const other = v("read", { path: "cards/其他/对话/x.jsonl" });
		assert.equal(other.kind === "ask" && other.unit, join(cwd, "cards", "其他"), "别的卡：授权到那张卡");
		const cfg = v("read", { path: "liyuan.config.json" });
		assert.equal(cfg.kind === "ask" && cfg.unit, join(cwd, "liyuan.config.json"), "根下单个文件只批那个文件");
		const root = v("ls", {});
		assert.equal(root.kind === "ask" && root.unit, cwd, "不带 path 的 ls ＝ 工程根");
		const escaped = v("read", { path: "cards/云澜/../其他/其他.json" });
		assert.equal(escaped.kind, "ask", ".. 逃不出卡目录");
		const outside = v("read", { path: join(dirname(cwd), "别处", "x.txt") });
		assert.equal(outside.kind === "ask" && outside.unit, join(dirname(cwd), "别处"), "工程根外按所在目录授权");
		assert.deepEqual(v("read", { path: "web/src/b.ts" }, { dirs: [join(cwd, "web")], bashAllow: [] }), { kind: "allow" }, "已授权目录之内放行");
		assert.deepEqual(v("read", { path: "liyuan.config.json" }, { dirs: [join(cwd, "liyuan.config.json")], bashAllow: [] }), { kind: "allow" }, "文件级授权");
		assert.deepEqual(v("bash", { command: "ls" }), { kind: "ask-bash", command: "ls" });
		assert.deepEqual(v("bash", { command: "ls" }, { dirs: [], bashAllow: ["ls"] }), { kind: "allow" }, "免问前缀命中");
		assert.equal(v("bash", { command: "ls -la" }, { dirs: [], bashAllow: ["ls"] }).kind, "allow", "前缀按词边界，后面带参数照样命中");
		assert.equal(v("bash", { command: "lsblk" }, { dirs: [], bashAllow: ["ls"] }).kind, "ask-bash", "词边界：lsblk 不是 ls");
		assert.equal(v("bash", { command: "cd /tmp && ls" }, { dirs: [], bashAllow: ["ls"] }).kind, "ask-bash", "逐段判：cd 没被授权就不放行整条");
		assert.equal(v("bash", { command: "cd /tmp && ls" }, { dirs: [], bashAllow: ["ls", "cd"] }).kind, "allow", "每段都命中才免问");
		assert.equal(v("bash", { command: "git status" }, { dirs: [], bashAllow: ["git status"] }).kind, "allow", "多词前缀");
		assert.deepEqual(v("card_project", { action: "prepare" }), { kind: "allow" }, "梨园工具不归沙箱管");
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("沙箱判定：卡内的符号链接指向卡外＝卡外", (t) => {
	const { cwd, cardDir, scope } = makeWorkspace();
	try {
		const link = join(cardDir, "偷渡");
		try {
			symlinkSync(join(cwd, "web"), link, "junction");
		} catch {
			t.skip("本机建不了符号链接");
			return;
		}
		assert.ok(existsSync(join(link, "src", "a.ts")));
		const v = sandboxVerdict("read", { path: join(link, "src", "a.ts") }, scope, NO_GRANTS);
		assert.equal(v.kind, "ask");
		assert.equal(v.kind === "ask" && v.unit, join(cwd, "web"), "按真实位置授权");
		assert.equal(realExisting(join(link, "src", "新文件.ts")), join(cwd, "web", "src", "新文件.ts"), "不存在的尾巴接在真实祖先后面");
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("沙箱判定：命令黑名单优先于 bash 授权（任何授权越不过 deny）", () => {
	const { cwd, scope } = makeWorkspace();
	try {
		const granted: SandboxGrants = { dirs: [], bashAllow: ["ls", "rm"] };
		const hit = sandboxVerdict("bash", { command: "rm -rf /etc" }, scope, granted);
		assert.equal(hit.kind, "deny");
		assert.match(hit.kind === "deny" ? hit.reason : "", /命令黑名单/);
		assert.deepEqual(sandboxVerdict("bash", { command: "ls" }, scope, granted), { kind: "allow" });
		assert.equal(sandboxVerdict("bash", { command: "rm -rf /var/log" }, scope, granted).kind, "allow", "边界外不误伤");
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("沙箱授权单位：目录本身、cards 根、assets 根", () => {
	const { cwd } = makeWorkspace();
	try {
		assert.equal(grantUnit(cwd, join(cwd, "web")), join(cwd, "web"));
		assert.equal(grantUnit(cwd, join(cwd, "cards", "其他")), join(cwd, "cards", "其他"));
		assert.equal(grantUnit(cwd, join(cwd, "cards")), join(cwd, "cards"), "列卡库本身：单位就是卡库（文案另行提醒）");
		assert.equal(grantUnit(cwd, join(cwd, "assets", "lorebooks", "书.json")), join(cwd, "assets", "lorebooks"));
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("沙箱授权数据：会话树条目重放；永久授权落 卡.json（相对路径正斜杠）", () => {
	const { cwd, cardDir } = makeWorkspace();
	try {
		const branch = [
			{ type: "message", message: { role: "user" } },
			{ type: "custom", customType: SANDBOX_GRANT_TYPE, data: { dir: join(cwd, "web") } },
			{ type: "custom", customType: "liyuan-mode", data: { mode: "authoring" } },
			{ type: "custom", customType: SANDBOX_GRANT_TYPE, data: { bash: true } },
		];
		assert.deepEqual(sandboxGrantsFromBranch(branch), { dirs: [join(cwd, "web")], bashAllow: [] }, "旧条目的 bash 布尔读时忽略（收缩）");
		assert.deepEqual(permanentGrants(cwd, cardDir), { dirs: [], bashAllow: [] });
		assert.deepEqual(permanentGrants(cwd, undefined), { dirs: [], bashAllow: [] }, "不在卡库里的卡没有永久授权");
		addPermanentGrant(cwd, cardDir, { dir: join(cwd, "web") });
		addPermanentGrant(cwd, cardDir, { dir: join(cwd, "web") });
		addPermanentGrant(cwd, cardDir, { dir: join(dirname(cwd), "别处") });
		addPermanentGrant(cwd, cardDir, { bashPrefix: "git status" });
		addPermanentGrant(cwd, cardDir, { bashPrefix: "git status" });
		const saved = loadCardConfig(cardDir);
		assert.deepEqual(saved.sandboxAllow, ["web", join(dirname(cwd), "别处")], "根内相对、根外绝对、不重复");
		assert.deepEqual(saved.sandboxBashAllow, ["git status"], "免问前缀落 卡.json，不重复");
		assert.deepEqual(permanentGrants(cwd, cardDir), { dirs: [join(cwd, "web"), join(dirname(cwd), "别处")], bashAllow: ["git status"] });
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("沙箱申请文案：范围与选项；不在卡库里的卡没有「永久」", () => {
	const { cwd, scope } = makeWorkspace();
	try {
		const card = describeAsk({ kind: "ask", tool: "read", target: join(cwd, "web", "src", "a.ts"), unit: join(cwd, "web") }, scope);
		assert.equal(card.question, `请求读取：${join("web", "src", "a.ts")}\n范围：web`);
		assert.deepEqual(card.options.map((o) => o.label), ["允许一次", "本会话允许", "永久允许（本卡）", "拒绝"]);
		assert.deepEqual(card.grant, { dir: join(cwd, "web") });
		const root = describeAsk({ kind: "ask", tool: "ls", target: cwd, unit: cwd }, scope);
		assert.match(root.question, /整个工程根（含其他卡）/);
		const bash = describeAsk({ kind: "ask-bash", command: "rm -rf /" }, scope);
		assert.match(bash.question, /不受卡目录限制/);
		assert.deepEqual(bash.options.map((o) => o.label), ["允许一次", "以后不再问「rm」（本卡）", "拒绝"]);
		assert.deepEqual(bash.grant, { bashPrefix: "rm" });
		const bashLegacy = describeAsk({ kind: "ask-bash", command: "npm test" }, { ...scope, cardDir: undefined });
		assert.deepEqual(bashLegacy.options.map((o) => o.label), ["允许一次", "拒绝"], "没有 卡.json 可落永久前缀");
		const legacy = describeAsk({ kind: "ask", tool: "read", target: join(cwd, "web", "src", "a.ts"), unit: join(cwd, "web") }, { ...scope, cardDir: undefined });
		assert.deepEqual(legacy.options.map((o) => o.label), ["允许一次", "本会话允许", "拒绝"]);
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("沙箱门：无法询问一律拒绝；四种答复各归其位；停止交还", async () => {
	const { cwd, cardDir, config } = makeWorkspace();
	try {
		const remembered: unknown[] = [];
		let stopped = 0;
		const answers: Array<string | undefined> = [];
		const asked: Array<{ question: string; options: string[] }> = [];
		const make = (ask?: boolean) => createSandboxGate({
			cwd, config,
			sessionGrants: () => ({ dirs: remembered.flatMap((g) => (g as { dir?: string }).dir ? [(g as { dir: string }).dir] : []), bashAllow: [] }),
			rememberSession: (g) => remembered.push(g),
			ask: ask ? async (question, options) => { asked.push({ question, options }); return answers.shift(); } : undefined,
			onStop: () => { stopped++; },
		});
		const mute = make(false);
		assert.equal(await mute("read", { path: join(cardDir, "云澜.json") }), undefined, "卡内不问");
		assert.match((await mute("read", { path: "web/src/a.ts" }))!, /无法询问/);

		const gate = make(true);
		answers.push("拒绝");
		assert.match((await gate("read", { path: "web/src/a.ts" }))!, /用户拒绝了本次读取/);
		answers.push("允许一次");
		assert.equal(await gate("read", { path: "web/src/a.ts" }), undefined);
		assert.equal(remembered.length, 0, "允许一次不留痕");
		answers.push("本会话允许");
		assert.equal(await gate("edit", { path: "web/src/a.ts" }), undefined);
		assert.deepEqual(remembered, [{ dir: join(cwd, "web") }]);
		assert.equal(await gate("read", { path: "web/src/b.ts" }), undefined, "同单位不再问");
		assert.equal(asked.length, 3);
		answers.push("以后不再问「echo」（本卡）");
		assert.equal(await gate("bash", { command: "echo hi" }), undefined);
		assert.deepEqual(loadCardConfig(cardDir).sandboxBashAllow, ["echo"], "免问前缀落 卡.json");
		assert.equal(await gate("bash", { command: "echo again" }), undefined, "永久前缀现读");
		assert.equal(asked.length, 4, "命中前缀不再问");
		answers.push("允许一次");
		assert.equal(await gate("bash", { command: "rm -rf x" }), undefined, "另一条前缀要再问一次");
		assert.equal(asked.length, 5);
		assert.match((await gate("bash", { command: "rm -rf /etc" }))!, /命令黑名单/);
		assert.equal(asked.length, 5, "deny 不经过选择卡");
		answers.push("随便打的字");
		assert.match((await gate("write", { path: "liyuan.config.json" }))!, /用户拒绝/, "自由输入＝拒绝");
		answers.push(undefined);
		assert.equal(await gate("write", { path: "liyuan.config.json" }), "用户已停止。");
		assert.equal(stopped, 1);
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("沙箱：不在卡库里的卡以卡文件所在目录为界", () => {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "liyuan-sandbox-legacy-")));
	try {
		writeFileSync(join(cwd, "card.json"), JSON.stringify({ data: { name: "云澜" } }));
		const scope = sandboxScope(cwd, { card: "card.json" });
		assert.equal(scope.cardDir, undefined);
		assert.deepEqual(sandboxVerdict("write", { path: join(cwd, "anything", "here.txt") }, scope, NO_GRANTS), { kind: "allow" });
		assert.equal(sandboxVerdict("read", { path: join(dirname(cwd), "x.txt") }, scope, NO_GRANTS).kind, "ask");
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("沙箱：turboMode 开启后完全放行跨目录读写与 bash，不再询问", async () => {
	const { cwd, config } = makeWorkspace();
	try {
		let askedCount = 0;
		const gate = createSandboxGate({
			cwd,
			config: { ...config, turboMode: true },
			sessionGrants: () => NO_GRANTS,
			rememberSession: () => {},
			ask: async () => { askedCount++; return "拒绝"; },
			onStop: () => {},
		});
		assert.equal(await gate("read", { path: "web/src/a.ts" }), undefined);
		assert.equal(await gate("write", { path: "web/src/a.ts" }), undefined);
		assert.equal(await gate("bash", { command: "echo turbo" }), undefined);
		assert.equal(askedCount, 0);
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

