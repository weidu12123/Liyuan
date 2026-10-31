/**
 * 扮演模式的旁路助手运行器（/btw）：基于 pi 原生 AgentSession + SessionManager.inMemory 的单槽草稿会话。
 *
 * - 独立于扮演主会话运行：不占 StageEngine.#busy、不落台前会话树、不产生磁盘 .jsonl；
 * - 过程内多轮上下文、工具调用循环、5 次报错自动重试、超窗口自动压缩均由 pi AgentSession 原生承担；
 * - 关闭（close）即销毁内存会话与临时沙箱授权，只保留已通过工具落盘的资产与卡片改动。
 */
import { existsSync, readFileSync } from "node:fs";
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
import { createSandboxGate, type SandboxGrants } from "../src/sandbox.ts";
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
	close(): Promise<void>;
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

export function createBtwRunner(deps: BtwRunnerDeps): BtwRunner {
	let session: AgentSession | null = null;
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

	const recordTool = (detail: string) => {
		if (liveReply) {
			liveReply.tools ??= [];
			liveReply.tools.push(detail);
		}
		deps.events?.onTool?.(detail);
	};

	const ensureSession = async (): Promise<AgentSession> => {
		if (session) return session;
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
						const defaultDir = event.toolName === "ls" ? (asm.cardDir ?? asm.chatDir) : (asm.chatDir ?? asm.cardDir);
						if (defaultDir) inputObj.path = defaultDir;
					}
					const gate = createSandboxGate({
						cwd: deps.cwd,
						config: asm.config,
						chatDir: asm.chatDir ?? undefined,
						sessionGrants: () => sessionGrants,
						rememberSession: (g) => {
							if ("dir" in g) sessionGrants.dirs.push(g.dir);
							else sessionGrants.bashAllow.push(g.bashPrefix);
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
				if (toolErrors.delete(event.toolCallId)) return { isError: true };
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

		const created = await createAgentSession({
			cwd: deps.cwd,
			agentDir: deps.agentDir,
			modelRuntime,
			settingsManager,
			resourceLoader,
			sessionManager: SessionManager.inMemory(deps.cwd),
			model,
			thinkingLevel,
		});
		session = created.session;
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
			return (session !== null && session.messages.some((m) => m.role === "user")) || transcript.length > 0;
		},
		get userTurnCount(): number {
			if (!session) return 0;
			return session.messages.filter((m) => m.role === "user").length;
		},
		snapshot(): WireBtwMsg[] {
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
			transcript.push({ role: "user", text: trimmed });
			liveReply = { role: "assistant", text: "", thinking: "", tools: [] };
			transcript.push(liveReply);
			deps.events?.onUser?.(trimmed);
			deps.events?.onStart?.();
			try {
				const s = await ensureSession();
				if (s.model?.id !== model.id || s.model?.provider !== model.provider) {
					await s.setModel(model);
				}
				if (s.thinkingLevel !== thinkingLevel) {
					s.setThinkingLevel(thinkingLevel);
				}
				await s.prompt(trimmed, { expandPromptTemplates: false });
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
		async close(): Promise<void> {
			activeAbort?.abort();
			const hadData = session !== null || transcript.length > 0;
			const s = session;
			session = null;
			activeKit = null;
			activeAssembly = null;
			activeToolNames = [];
			sessionGrants = { dirs: [], bashAllow: [] };
			lastError = undefined;
			transcript = [];
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
			if (hadData) deps.events?.onClear?.();
		},
	};
}
