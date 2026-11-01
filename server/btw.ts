/**
 * 扮演模式的旁路助手运行器（/btw）：基于 pi 原生 AgentSession + SessionManager 的项目级独立持久会话。
 *
 * - 与扮演主会话（主演）完全隔离：主演不知道助手存在、看不到助手上下文；
 * - 助手拥有自己持久化的 pi 会话生命周期（落盘于当前项目 `<chatDir>/助手/*.jsonl`），
 *   推进下一拍台前剧情、切换项目或重启服务均不丢失上下文与已读文件回执；
 * - 过程内多轮上下文、工具调用循环、5 次报错自动重试、超窗口自动压缩均由 pi AgentSession 原生承担；
 * - 显式执行 clear（/btw clear）才在当前项目新开一条空白助手会话。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	type AgentSession,
	type ExtensionFactory,
	type ModelRuntime,
	type SettingsManager,
} from "@liyuan/agent-runtime";

import { formatToolStartDetail } from "../src/activity-format.ts";
import { t } from "../src/i18n/index.ts";
import { CHAT_BTW_SESSIONS_DIR } from "../src/paths.ts";
import {
	createSandboxGate,
	filterSandboxToolContent,
	SANDBOX_GRANT_TYPE,
	sandboxGrantsFromBranch,
	sandboxScope,
	type SandboxGrants,
} from "../src/sandbox.ts";
import { prependToFirstUser } from "../src/stage/btw.ts";
import type { StageEngine } from "../src/stage/engine.ts";
import type { WireBtwMsg } from "./wire.ts";

export interface BtwRunnerDeps {
	cwd: string;
	agentDir: string;
	stage: StageEngine;
	getServices: () => { modelRuntime: ModelRuntime; settingsManager: SettingsManager };
	getModelState: () => { model: AgentSession["model"]; thinkingLevel: AgentSession["thinkingLevel"] };
	events?: {
		onUser?: (text: string) => void;
		onStart?: () => void;
		onDelta?: (kind: "text" | "thinking", delta: string) => void;
		onTool?: (detail: string) => void;
		onNotify?: (level: "info" | "warning" | "error", text: string) => void;
		onEnd?: (info: { aborted: boolean; error?: string }) => void;
		onClear?: () => void;
	};
}

export interface BtwRunner {
	readonly isStreaming: boolean;
	readonly hasSession: boolean;
	readonly userTurnCount: number;
	snapshot(): WireBtwMsg[];
	prompt(text: string): Promise<{ aborted: boolean; error?: string }>;
	abort(): Promise<void>;
	/** 在当前项目新建一条空白助手会话（重置上下文） */
	clear(): Promise<void>;
	/** 别名：兼容既有调用方 */
	close(): Promise<void>;
	/** 主会话切换项目/角色卡时同步重绑到对应项目的助手会话（不清空磁盘历史） */
	syncProject(): Promise<void>;
	/** 进程退出时仅释放内存句柄 */
	dispose(): Promise<void>;
}

const shippedSystemSkeleton = (): string => {
	try {
		return readFileSync(new URL("../assets/SYSTEM.md", import.meta.url), "utf8").trim();
	} catch {
		return "";
	}
};

function readBaseSkeleton(agentDir: string): string {
	const custom = join(agentDir, "SYSTEM.md");
	if (existsSync(custom)) {
		try {
			const text = readFileSync(custom, "utf8").trim();
			if (text) return text;
		} catch {
			// fall through to shipped skeleton
		}
	}
	return shippedSystemSkeleton();
}

/** 从 pi 会话分支重建前端/CLI 展示用的对话快照（合并同轮连续 assistant 工具步与正文） */
function rebuildTranscriptFromBranch(branch: ReadonlyArray<Record<string, unknown>>): WireBtwMsg[] {
	const out: WireBtwMsg[] = [];
	let curAssistant: WireBtwMsg | null = null;
	let fallbackTools: string[] = [];

	for (const entry of branch) {
		if (entry.type === "custom" && entry.customType === "btw-tools" && curAssistant && Array.isArray(entry.data)) {
			curAssistant.tools = entry.data.filter((x): x is string => typeof x === "string" && x.length > 0);
			fallbackTools = [];
			continue;
		}
		if (entry.type !== "message" || !entry.message || typeof entry.message !== "object") continue;
		const msg = entry.message as { role?: unknown; content?: unknown; stopReason?: unknown; errorMessage?: unknown };
		if (msg.role === "user") {
			if (curAssistant && (!curAssistant.tools || curAssistant.tools.length === 0) && fallbackTools.length > 0) {
				curAssistant.tools = fallbackTools;
			}
			curAssistant = null;
			fallbackTools = [];
			const text = extractUserText(msg.content).trim();
			if (text) out.push({ role: "user", text });
		} else if (msg.role === "assistant") {
			if (!curAssistant) {
				curAssistant = { role: "assistant", text: "", thinking: "", tools: [] };
				out.push(curAssistant);
			}
			const parts = Array.isArray(msg.content) ? (msg.content as Array<Record<string, unknown>>) : [];
			for (const p of parts) {
				if (!p || typeof p !== "object") continue;
				if (p.type === "text" && typeof p.text === "string" && p.text) {
					curAssistant.text = curAssistant.text ? `${curAssistant.text}${p.text}` : p.text;
				} else if (p.type === "thinking" && typeof p.thinking === "string" && p.thinking) {
					curAssistant.thinking = `${curAssistant.thinking ?? ""}${p.thinking}`;
				} else if (p.type === "toolCall" && typeof p.name === "string") {
					const args = p.arguments && typeof p.arguments === "object" ? (p.arguments as Record<string, unknown>) : {};
					const detail = formatToolStartDetail(p.name, args) || p.name;
					fallbackTools.push(detail);
				}
			}
			if (msg.stopReason === "error" && !curAssistant.text.trim()) {
				const errText = typeof msg.errorMessage === "string" && msg.errorMessage ? msg.errorMessage : "provider error";
				curAssistant.text = `（生成失败：${errText}）`; // i18n-ignore：回落文案
			}
		}
	}
	if (curAssistant && (!curAssistant.tools || curAssistant.tools.length === 0) && fallbackTools.length > 0) {
		curAssistant.tools = fallbackTools;
	}
	return out;
}

function extractUserText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((p) => (p && typeof p === "object" && (p as { type?: unknown }).type === "text" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
		.join("");
}

export function createBtwRunner(deps: BtwRunnerDeps): BtwRunner {
	let session: AgentSession | null = null;
	let boundSessionDir: string | null = null;
	let unsubscribe: (() => void) | null = null;
	let sessionGrants: SandboxGrants = { dirs: [], bashAllow: [] };
	let busy = false;
	let activeAbort: AbortController | null = null;
	let activeKit: ReturnType<StageEngine["btwToolkit"]> | null = null;
	let activeAssembly: ReturnType<StageEngine["btwAssembly"]> | null = null;
	let activeToolNames: string[] = [];
	let lastError: string | undefined;
	let transcript: WireBtwMsg[] = [];
	let liveReply: WireBtwMsg | null = null;

	const resolveBtwSessionDir = (): string => {
		const { chatDir } = deps.stage.btwAssembly();
		const dir = chatDir ? join(chatDir, CHAT_BTW_SESSIONS_DIR) : join(deps.cwd, ".liyuan", CHAT_BTW_SESSIONS_DIR);
		mkdirSync(dir, { recursive: true });
		return dir;
	};

	/** 确保内存中的 transcript 与当前项目磁盘上的最近助手会话同步（即使尚未实例化 AgentSession） */
	const syncTranscriptIfIdle = (): void => {
		if (busy || session?.isStreaming) return;
		const targetDir = resolveBtwSessionDir();
		if (session && boundSessionDir === targetDir) return;
		if (!session && boundSessionDir === targetDir) return;
		// 目标项目目录发生变化且当前不在流式：卸载旧会话并从新目录恢复快照
		if (session) {
			unsubscribe?.();
			unsubscribe = null;
			session.dispose();
			session = null;
		}
		boundSessionDir = targetDir;
		const sm = SessionManager.continueRecent(deps.cwd, targetDir);
		const branch = sm.getBranch() as unknown as Array<Record<string, unknown>>;
		transcript = rebuildTranscriptFromBranch(branch);
		sessionGrants = sandboxGrantsFromBranch(branch as never);
	};

	const recordTool = (detail: string) => {
		if (liveReply) {
			liveReply.tools ??= [];
			liveReply.tools.push(detail);
		}
		deps.events?.onTool?.(detail);
	};

	const teardownSessionInstance = async (): Promise<void> => {
		activeAbort?.abort();
		const s = session;
		session = null;
		activeKit = null;
		activeAssembly = null;
		activeToolNames = [];
		lastError = undefined;
		liveReply = null;
		unsubscribe?.();
		unsubscribe = null;
		if (s) {
			try {
				if (s.isStreaming) await s.abort();
			} catch {
				// ignore abort errors during teardown
			}
			s.dispose();
		}
	};

	const ensureSession = async (forceFresh = false): Promise<AgentSession> => {
		const targetDir = resolveBtwSessionDir();
		if (session && boundSessionDir === targetDir && !forceFresh) return session;
		if (session) await teardownSessionInstance();

		const { modelRuntime, settingsManager } = deps.getServices();
		const { model, thinkingLevel } = deps.getModelState();
		const toolErrors = new Set<string>();

		const registerKitTools = (pi: Parameters<ExtensionFactory>[0], applyActive: boolean) => {
			const kit = deps.stage.btwToolkit({
				onActivity: (detail) => recordTool(detail),
				onAskStop: () => {
					activeAbort?.abort();
					void session?.abort();
				},
			});
			activeKit = kit;
			for (const tool of kit.tools) {
				pi.registerTool({
					...tool,
					label: tool.name,
					parameters: tool.parameters as never,
					executionMode: "sequential",
					async execute(id, input, signal) {
						const cur = activeKit ?? kit;
						const result = await cur.execute(tool.name, id, input as Record<string, unknown>, signal);
						if (result.isError) toolErrors.add(id);
						return {
							content: result.content,
							details: result.details,
							...(result.terminate ? { terminate: true } : {}),
						};
					},
				});
			}
			activeToolNames = [...new Set([...kit.tools.map((x) => x.name), ...kit.nativeNames])];
			if (applyActive) pi.setActiveTools(activeToolNames);
		};

		const btwExtension: ExtensionFactory = (pi) => {
			registerKitTools(pi, false);

			pi.on("before_agent_start", () => {
				registerKitTools(pi, true);
				const asm = deps.stage.btwAssembly();
				activeAssembly = asm;
				const skeleton = readBaseSkeleton(deps.agentDir);
				const systemPrompt = skeleton ? `${skeleton}\n\n${asm.systemPrompt}` : asm.systemPrompt;
				return { systemPrompt };
			});

			pi.on("context", (event) => {
				const stageBlock = (activeAssembly ?? deps.stage.btwAssembly()).stageBlock;
				return { messages: prependToFirstUser(event.messages, stageBlock) as typeof event.messages };
			});

			pi.on("tool_call", async (event) => {
				if (!activeToolNames.includes(event.toolName)) {
					return { block: true, reason: "此工具在旁路助手中不可用。" }; // i18n-ignore：模型回执
				}
				const kit = activeKit;
				const asm = activeAssembly ?? deps.stage.btwAssembly();
				if (kit?.nativeNames.includes(event.toolName)) {
					const inputObj = event.input as Record<string, unknown>;
					// 无参目录探测（ls / find / grep 未指定 path）默认落在当前卡目录或项目目录内，
					// 避免退回最外层数据根误触发「整个工程根（含其他卡）」沙箱申请或扫到同卡其他子项目。
					if (
						(event.toolName === "ls" || event.toolName === "find" || event.toolName === "grep") &&
						(inputObj.path === undefined || (typeof inputObj.path === "string" && inputObj.path.trim() === ""))
					) {
						const defaultDir = asm.chatDir ?? asm.cardDir;
						if (defaultDir) inputObj.path = defaultDir;
					}
					const gate = createSandboxGate({
						cwd: deps.cwd,
						config: asm.config,
						chatDir: asm.chatDir ?? undefined,
						sessionGrants: () => sessionGrants,
						rememberSession: (g) => {
							if ("dir" in g) {
								sessionGrants.dirs.push(g.dir);
								session?.sessionManager.appendCustomEntry(SANDBOX_GRANT_TYPE, { dir: g.dir });
							} else {
								sessionGrants.bashAllow.push(g.bashPrefix);
							}
						},
						ask: kit.askUser ? (q, opts) => kit.askUser!(q, opts, activeAbort?.signal) : undefined,
						onStop: () => {
							activeAbort?.abort();
							void session?.abort();
						},
					});
					const blockReason = await gate(event.toolName, event.input as Record<string, unknown>);
					if (blockReason) return { block: true, reason: blockReason };
					const summary = formatToolStartDetail(event.toolName, event.input);
					if (summary) recordTool(summary);
				}
				return undefined;
			});

			pi.on("tool_result", (event) => {
				const asm = activeAssembly ?? deps.stage.btwAssembly();
				const nextContent = filterSandboxToolContent(
					event.toolName,
					(event.input ?? {}) as Record<string, unknown>,
					event.content,
					sandboxScope(deps.cwd, asm.config, asm.chatDir ?? undefined),
				);
				const isError = toolErrors.delete(event.toolCallId);
				if (nextContent || isError) {
					return {
						...(nextContent ? { content: nextContent as typeof event.content } : {}),
						...(isError ? { isError: true } : {}),
					};
				}
				return undefined;
			});
		};

		const resourceLoader = new DefaultResourceLoader({
			cwd: deps.cwd,
			agentDir: deps.agentDir,
			settingsManager,
			noExtensions: true,
			noContextFiles: true,
			noPromptTemplates: true,
			noThemes: true,
			appendSystemPromptOverride: () => [],
			extensionFactories: [btwExtension],
		});
		await resourceLoader.reload();

		const sessionManager = forceFresh
			? SessionManager.create(deps.cwd, targetDir)
			: SessionManager.continueRecent(deps.cwd, targetDir);

		const created = await createAgentSession({
			cwd: deps.cwd,
			agentDir: deps.agentDir,
			modelRuntime,
			settingsManager,
			resourceLoader,
			sessionManager,
			model,
			thinkingLevel,
		});
		session = created.session;
		boundSessionDir = targetDir;
		const branch = session.sessionManager.getBranch() as unknown as Array<Record<string, unknown>>;
		transcript = rebuildTranscriptFromBranch(branch);
		sessionGrants = sandboxGrantsFromBranch(branch as never);

		unsubscribe = session.subscribe((event) => {
			if (event.type === "message_update") {
				const sub = event.assistantMessageEvent;
				if ((sub.type === "text_delta" || sub.type === "thinking_delta") && sub.delta) {
					const kind = sub.type === "text_delta" ? "text" : "thinking";
					if (liveReply) {
						if (kind === "text") liveReply.text += sub.delta;
						else liveReply.thinking = `${liveReply.thinking ?? ""}${sub.delta}`;
					}
					deps.events?.onDelta?.(kind, sub.delta);
				}
			} else if (event.type === "message_end") {
				if (event.message.role === "assistant" && event.message.stopReason === "error") {
					lastError = event.message.errorMessage || "provider error";
				}
			} else if (event.type === "auto_retry_start") {
				recordTool(`请求失败，正在自动重试（第 ${event.attempt}/${event.maxAttempts} 次）…`); // i18n-ignore：过程日志
			}
		});
		return session;
	};

	return {
		get isStreaming(): boolean {
			return busy || session?.isStreaming === true;
		},
		get hasSession(): boolean {
			syncTranscriptIfIdle();
			return (session !== null && session.messages.some((m) => m.role === "user")) || transcript.some((m) => m.role === "user");
		},
		get userTurnCount(): number {
			syncTranscriptIfIdle();
			if (session) return session.messages.filter((m) => m.role === "user").length;
			return transcript.filter((m) => m.role === "user").length;
		},
		snapshot(): WireBtwMsg[] {
			syncTranscriptIfIdle();
			return transcript.map((m) => ({
				role: m.role,
				text: m.text,
				...(m.thinking ? { thinking: m.thinking } : {}),
				...(m.tools?.length ? { tools: [...m.tools] } : {}),
			}));
		},
		async prompt(text: string): Promise<{ aborted: boolean; error?: string }> {
			const trimmed = text.trim();
			if (!trimmed) return { aborted: false };
			if (busy || session?.isStreaming) {
				deps.events?.onNotify?.("warning", t("旁路助手正在回复中，请稍候或使用 /btw stop 停止"));
				return { aborted: false, error: "busy" };
			}
			const { model, thinkingLevel } = deps.getModelState();
			if (!model) {
				const msg = t("尚未配置剧情模型——请先在「连接」面板选择模型");
				deps.events?.onNotify?.("error", msg);
				return { aborted: false, error: "no-model" };
			}

			busy = true;
			lastError = undefined;
			activeAbort = new AbortController();
			try {
				const s = await ensureSession(false);
				transcript.push({ role: "user", text: trimmed });
				liveReply = { role: "assistant", text: "", thinking: "", tools: [] };
				transcript.push(liveReply);
				deps.events?.onUser?.(trimmed);
				deps.events?.onStart?.();
				if (s.model?.id !== model.id || s.model?.provider !== model.provider) {
					await s.setModel(model);
				}
				if (s.thinkingLevel !== thinkingLevel) {
					s.setThinkingLevel(thinkingLevel);
				}
				await s.prompt(trimmed, { expandPromptTemplates: false });
				if (liveReply?.tools?.length) {
					s.sessionManager.appendCustomEntry("btw-tools", [...liveReply.tools]);
				}
				s.sessionManager.flush();
				const aborted = activeAbort.signal.aborted;
				if (lastError && !aborted) {
					if (liveReply && !liveReply.text.trim()) {
						liveReply.text = `（生成失败：${lastError}）`; // i18n-ignore：回落文案
					}
					deps.events?.onNotify?.("error", t("旁路助手生成失败：{error}", { error: lastError }));
				}
				await activeKit?.afterTurn?.();
				const info = { aborted, ...(lastError && !aborted ? { error: lastError } : {}) };
				deps.events?.onEnd?.(info);
				return info;
			} catch (err) {
				const aborted = activeAbort.signal.aborted;
				const msg = err instanceof Error ? err.message : String(err);
				if (liveReply && !liveReply.text.trim() && !aborted) {
					liveReply.text = `（生成失败：${msg}）`; // i18n-ignore：回落文案
				}
				if (!aborted) deps.events?.onNotify?.("error", t("旁路助手生成失败：{error}", { error: msg }));
				const info = { aborted, ...(!aborted ? { error: msg } : {}) };
				deps.events?.onEnd?.(info);
				return info;
			} finally {
				liveReply = null;
				busy = false;
				activeAbort = null;
			}
		},
		async abort(): Promise<void> {
			activeAbort?.abort();
			if (session?.isStreaming) {
				await session.abort();
			}
		},
		async clear(): Promise<void> {
			const targetDir = resolveBtwSessionDir();
			let hadDiskFiles = false;
			try {
				for (const f of readdirSync(targetDir)) {
					if (f.endsWith(".jsonl")) {
						hadDiskFiles = true;
						rmSync(join(targetDir, f), { force: true });
					}
				}
			} catch {
				// ignore remove errors
			}
			const hadData = session !== null || transcript.length > 0 || hadDiskFiles;
			await teardownSessionInstance();
			boundSessionDir = targetDir;
			sessionGrants = { dirs: [], bashAllow: [] };
			transcript = [];
			if (hadData) deps.events?.onClear?.();
		},
		async close(): Promise<void> {
			await this.clear();
		},
		async syncProject(): Promise<void> {
			const targetDir = resolveBtwSessionDir();
			if (boundSessionDir === targetDir) return;
			await teardownSessionInstance();
			boundSessionDir = targetDir;
			const sm = SessionManager.continueRecent(deps.cwd, targetDir);
			const branch = sm.getBranch() as unknown as Array<Record<string, unknown>>;
			transcript = rebuildTranscriptFromBranch(branch);
			sessionGrants = sandboxGrantsFromBranch(branch as never);
		},
		async dispose(): Promise<void> {
			await teardownSessionInstance();
			boundSessionDir = null;
			transcript = [];
		},
	};
}
