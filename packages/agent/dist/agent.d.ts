import { type ImageContent, type Message, type SimpleStreamOptions, type ThinkingBudgets, type Transport } from "@liyuan/ai/compat";
import type { AfterToolCallContext, AfterToolCallResult, AgentEvent, AgentLoopTurnUpdate, AgentMessage, AgentState, BeforeToolCallContext, BeforeToolCallResult, PrepareNextTurnContext, QueueMode, StreamFn, ToolExecutionMode } from "./types.ts";
export type { QueueMode } from "./types.ts";
/** Options for constructing an {@link Agent}. */
export interface AgentOptions {
    initialState?: Partial<Omit<AgentState, "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">>;
    convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
    transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
    streamFn?: StreamFn;
    getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
    onPayload?: SimpleStreamOptions["onPayload"];
    onResponse?: SimpleStreamOptions["onResponse"];
    beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
    afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
    prepareNextTurn?: (signal?: AbortSignal) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;
    prepareNextTurnWithContext?: (context: PrepareNextTurnContext, signal?: AbortSignal) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;
    steeringMode?: QueueMode;
    followUpMode?: QueueMode;
    sessionId?: string;
    thinkingBudgets?: ThinkingBudgets;
    transport?: Transport;
    maxRetryDelayMs?: number;
    toolExecution?: ToolExecutionMode;
}
/**
 * Stateful wrapper around the low-level agent loop.
 *
 * `Agent` owns the current transcript, emits lifecycle events, executes tools,
 * and exposes queueing APIs for steering and follow-up messages.
 */
export declare class Agent {
    private _state;
    private readonly listeners;
    private readonly steeringQueue;
    private readonly followUpQueue;
    convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
    transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
    streamFn: StreamFn;
    getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
    onPayload?: SimpleStreamOptions["onPayload"];
    onResponse?: SimpleStreamOptions["onResponse"];
    beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
    afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
    prepareNextTurn?: (signal?: AbortSignal) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;
    prepareNextTurnWithContext?: (context: PrepareNextTurnContext, signal?: AbortSignal) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;
    private activeRun?;
    /** Session identifier forwarded to providers for cache-aware backends. */
    sessionId?: string;
    /** Optional per-level thinking token budgets forwarded to the stream function. */
    thinkingBudgets?: ThinkingBudgets;
    /** Preferred transport forwarded to the stream function. */
    transport: Transport;
    /** Optional cap for provider-requested retry delays. */
    maxRetryDelayMs?: number;
    /** Tool execution strategy for assistant messages that contain multiple tool calls. */
    toolExecution: ToolExecutionMode;
    constructor(options?: AgentOptions);
    /**
     * Subscribe to agent lifecycle events.
     *
     * Listener promises are awaited in subscription order and are included in
     * the current run's settlement. Listeners also receive the active abort
     * signal for the current run.
     *
     * `agent_end` is the final emitted event for a run, but the agent does not
     * become idle until all awaited listeners for that event have settled.
     */
    subscribe(listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void): () => void;
    /**
     * Current agent state.
     *
     * Assigning `state.tools` or `state.messages` copies the provided top-level array.
     */
    get state(): AgentState;
    /** Controls how queued steering messages are drained. */
    set steeringMode(mode: QueueMode);
    get steeringMode(): QueueMode;
    /** Controls how queued follow-up messages are drained. */
    set followUpMode(mode: QueueMode);
    get followUpMode(): QueueMode;
    /** Queue a message to be injected after the current assistant turn finishes. */
    steer(message: AgentMessage): void;
    /** Queue a message to run only after the agent would otherwise stop. */
    followUp(message: AgentMessage): void;
    /** Remove all queued steering messages. */
    clearSteeringQueue(): void;
    /** Remove all queued follow-up messages. */
    clearFollowUpQueue(): void;
    /** Remove all queued steering and follow-up messages. */
    clearAllQueues(): void;
    /** Returns true when either queue still contains pending messages. */
    hasQueuedMessages(): boolean;
    /** Active abort signal for the current run, if any. */
    get signal(): AbortSignal | undefined;
    /** Abort the current run, if one is active. */
    abort(): void;
    /**
     * Resolve when the current run and all awaited event listeners have finished.
     *
     * This resolves after `agent_end` listeners settle.
     */
    waitForIdle(): Promise<void>;
    /** Clear transcript state, runtime state, and queued messages. */
    reset(): void;
    /** Start a new prompt from text, a single message, or a batch of messages. */
    prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
    prompt(input: string, images?: ImageContent[]): Promise<void>;
    /** Continue from the current transcript. The last message must be a user or tool-result message. */
    continue(): Promise<void>;
    private normalizePromptInput;
    private runPromptMessages;
    private runContinuation;
    private createContextSnapshot;
    private createLoopConfig;
    private runWithLifecycle;
    private handleRunFailure;
    private finishRun;
    private processEvents;
}
//# sourceMappingURL=agent.d.ts.map