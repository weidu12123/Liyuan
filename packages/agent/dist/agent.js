import { streamSimple, } from "@liyuan/ai/compat";
import { runAgentLoop, runAgentLoopContinue } from "./agent-loop.js";
function defaultConvertToLlm(messages) {
    return messages.filter((message) => message.role === "user" || message.role === "assistant" || message.role === "toolResult");
}
const EMPTY_USAGE = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const DEFAULT_MODEL = {
    id: "unknown",
    name: "unknown",
    api: "unknown",
    provider: "unknown",
    baseUrl: "",
    reasoning: false,
    input: [],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 0,
    maxTokens: 0,
};
function createMutableAgentState(initialState) {
    let tools = initialState?.tools?.slice() ?? [];
    let messages = initialState?.messages?.slice() ?? [];
    return {
        systemPrompt: initialState?.systemPrompt ?? "",
        model: initialState?.model ?? DEFAULT_MODEL,
        thinkingLevel: initialState?.thinkingLevel ?? "off",
        get tools() {
            return tools;
        },
        set tools(nextTools) {
            tools = nextTools.slice();
        },
        get messages() {
            return messages;
        },
        set messages(nextMessages) {
            messages = nextMessages.slice();
        },
        isStreaming: false,
        streamingMessage: undefined,
        pendingToolCalls: new Set(),
        errorMessage: undefined,
    };
}
class PendingMessageQueue {
    messages = [];
    mode;
    constructor(mode) {
        this.mode = mode;
    }
    enqueue(message) {
        this.messages.push(message);
    }
    hasItems() {
        return this.messages.length > 0;
    }
    drain() {
        if (this.mode === "all") {
            const drained = this.messages.slice();
            this.messages = [];
            return drained;
        }
        const first = this.messages[0];
        if (!first) {
            return [];
        }
        this.messages = this.messages.slice(1);
        return [first];
    }
    clear() {
        this.messages = [];
    }
}
/**
 * Stateful wrapper around the low-level agent loop.
 *
 * `Agent` owns the current transcript, emits lifecycle events, executes tools,
 * and exposes queueing APIs for steering and follow-up messages.
 */
export class Agent {
    _state;
    listeners = new Set();
    steeringQueue;
    followUpQueue;
    convertToLlm;
    transformContext;
    streamFn;
    getApiKey;
    onPayload;
    onResponse;
    beforeToolCall;
    afterToolCall;
    prepareNextTurn;
    prepareNextTurnWithContext;
    activeRun;
    /** Session identifier forwarded to providers for cache-aware backends. */
    sessionId;
    /** Optional per-level thinking token budgets forwarded to the stream function. */
    thinkingBudgets;
    /** Preferred transport forwarded to the stream function. */
    transport;
    /** Optional cap for provider-requested retry delays. */
    maxRetryDelayMs;
    /** Tool execution strategy for assistant messages that contain multiple tool calls. */
    toolExecution;
    constructor(options = {}) {
        this._state = createMutableAgentState(options.initialState);
        this.convertToLlm = options.convertToLlm ?? defaultConvertToLlm;
        this.transformContext = options.transformContext;
        this.streamFn = options.streamFn ?? streamSimple;
        this.getApiKey = options.getApiKey;
        this.onPayload = options.onPayload;
        this.onResponse = options.onResponse;
        this.beforeToolCall = options.beforeToolCall;
        this.afterToolCall = options.afterToolCall;
        this.prepareNextTurn = options.prepareNextTurn;
        this.prepareNextTurnWithContext = options.prepareNextTurnWithContext;
        this.steeringQueue = new PendingMessageQueue(options.steeringMode ?? "one-at-a-time");
        this.followUpQueue = new PendingMessageQueue(options.followUpMode ?? "one-at-a-time");
        this.sessionId = options.sessionId;
        this.thinkingBudgets = options.thinkingBudgets;
        this.transport = options.transport ?? "auto";
        this.maxRetryDelayMs = options.maxRetryDelayMs;
        this.toolExecution = options.toolExecution ?? "parallel";
    }
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
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    /**
     * Current agent state.
     *
     * Assigning `state.tools` or `state.messages` copies the provided top-level array.
     */
    get state() {
        return this._state;
    }
    /** Controls how queued steering messages are drained. */
    set steeringMode(mode) {
        this.steeringQueue.mode = mode;
    }
    get steeringMode() {
        return this.steeringQueue.mode;
    }
    /** Controls how queued follow-up messages are drained. */
    set followUpMode(mode) {
        this.followUpQueue.mode = mode;
    }
    get followUpMode() {
        return this.followUpQueue.mode;
    }
    /** Queue a message to be injected after the current assistant turn finishes. */
    steer(message) {
        this.steeringQueue.enqueue(message);
    }
    /** Queue a message to run only after the agent would otherwise stop. */
    followUp(message) {
        this.followUpQueue.enqueue(message);
    }
    /** Remove all queued steering messages. */
    clearSteeringQueue() {
        this.steeringQueue.clear();
    }
    /** Remove all queued follow-up messages. */
    clearFollowUpQueue() {
        this.followUpQueue.clear();
    }
    /** Remove all queued steering and follow-up messages. */
    clearAllQueues() {
        this.clearSteeringQueue();
        this.clearFollowUpQueue();
    }
    /** Returns true when either queue still contains pending messages. */
    hasQueuedMessages() {
        return this.steeringQueue.hasItems() || this.followUpQueue.hasItems();
    }
    /** Active abort signal for the current run, if any. */
    get signal() {
        return this.activeRun?.abortController.signal;
    }
    /** Abort the current run, if one is active. */
    abort() {
        this.activeRun?.abortController.abort();
    }
    /**
     * Resolve when the current run and all awaited event listeners have finished.
     *
     * This resolves after `agent_end` listeners settle.
     */
    waitForIdle() {
        return this.activeRun?.promise ?? Promise.resolve();
    }
    /** Clear transcript state, runtime state, and queued messages. */
    reset() {
        this._state.messages = [];
        this._state.isStreaming = false;
        this._state.streamingMessage = undefined;
        this._state.pendingToolCalls = new Set();
        this._state.errorMessage = undefined;
        this.clearFollowUpQueue();
        this.clearSteeringQueue();
    }
    async prompt(input, images) {
        if (this.activeRun) {
            throw new Error("Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.");
        }
        const messages = this.normalizePromptInput(input, images);
        await this.runPromptMessages(messages);
    }
    /** Continue from the current transcript. The last message must be a user or tool-result message. */
    async continue() {
        if (this.activeRun) {
            throw new Error("Agent is already processing. Wait for completion before continuing.");
        }
        const lastMessage = this._state.messages[this._state.messages.length - 1];
        if (!lastMessage) {
            throw new Error("No messages to continue from");
        }
        if (lastMessage.role === "assistant") {
            const queuedSteering = this.steeringQueue.drain();
            if (queuedSteering.length > 0) {
                await this.runPromptMessages(queuedSteering, { skipInitialSteeringPoll: true });
                return;
            }
            const queuedFollowUps = this.followUpQueue.drain();
            if (queuedFollowUps.length > 0) {
                await this.runPromptMessages(queuedFollowUps);
                return;
            }
            throw new Error("Cannot continue from message role: assistant");
        }
        await this.runContinuation();
    }
    normalizePromptInput(input, images) {
        if (Array.isArray(input)) {
            return input;
        }
        if (typeof input !== "string") {
            return [input];
        }
        const content = [{ type: "text", text: input }];
        if (images && images.length > 0) {
            content.push(...images);
        }
        return [{ role: "user", content, timestamp: Date.now() }];
    }
    async runPromptMessages(messages, options = {}) {
        await this.runWithLifecycle(async (signal) => {
            await runAgentLoop(messages, this.createContextSnapshot(), this.createLoopConfig(options), (event) => this.processEvents(event), signal, this.streamFn);
        });
    }
    async runContinuation() {
        await this.runWithLifecycle(async (signal) => {
            await runAgentLoopContinue(this.createContextSnapshot(), this.createLoopConfig(), (event) => this.processEvents(event), signal, this.streamFn);
        });
    }
    createContextSnapshot() {
        return {
            systemPrompt: this._state.systemPrompt,
            messages: this._state.messages.slice(),
            tools: this._state.tools.slice(),
        };
    }
    createLoopConfig(options = {}) {
        let skipInitialSteeringPoll = options.skipInitialSteeringPoll === true;
        return {
            model: this._state.model,
            reasoning: this._state.thinkingLevel === "off" ? undefined : this._state.thinkingLevel,
            sessionId: this.sessionId,
            onPayload: this.onPayload,
            onResponse: this.onResponse,
            transport: this.transport,
            thinkingBudgets: this.thinkingBudgets,
            maxRetryDelayMs: this.maxRetryDelayMs,
            toolExecution: this.toolExecution,
            beforeToolCall: this.beforeToolCall,
            afterToolCall: this.afterToolCall,
            prepareNextTurn: this.prepareNextTurnWithContext || this.prepareNextTurn
                ? async (context) => {
                    if (this.prepareNextTurnWithContext) {
                        return await this.prepareNextTurnWithContext(context, this.signal);
                    }
                    return await this.prepareNextTurn?.(this.signal);
                }
                : undefined,
            convertToLlm: this.convertToLlm,
            transformContext: this.transformContext,
            getApiKey: this.getApiKey,
            getSteeringMessages: async () => {
                if (skipInitialSteeringPoll) {
                    skipInitialSteeringPoll = false;
                    return [];
                }
                return this.steeringQueue.drain();
            },
            getFollowUpMessages: async () => this.followUpQueue.drain(),
        };
    }
    async runWithLifecycle(executor) {
        if (this.activeRun) {
            throw new Error("Agent is already processing.");
        }
        const abortController = new AbortController();
        let resolvePromise = () => { };
        const promise = new Promise((resolve) => {
            resolvePromise = resolve;
        });
        this.activeRun = { promise, resolve: resolvePromise, abortController };
        this._state.isStreaming = true;
        this._state.streamingMessage = undefined;
        this._state.errorMessage = undefined;
        try {
            await executor(abortController.signal);
        }
        catch (error) {
            await this.handleRunFailure(error, abortController.signal.aborted);
        }
        finally {
            this.finishRun();
        }
    }
    async handleRunFailure(error, aborted) {
        const failureMessage = {
            role: "assistant",
            content: [{ type: "text", text: "" }],
            api: this._state.model.api,
            provider: this._state.model.provider,
            model: this._state.model.id,
            usage: EMPTY_USAGE,
            stopReason: aborted ? "aborted" : "error",
            errorMessage: error instanceof Error ? error.message : String(error),
            timestamp: Date.now(),
        };
        await this.processEvents({ type: "message_start", message: failureMessage });
        await this.processEvents({ type: "message_end", message: failureMessage });
        await this.processEvents({ type: "turn_end", message: failureMessage, toolResults: [] });
        await this.processEvents({ type: "agent_end", messages: [failureMessage] });
    }
    finishRun() {
        this._state.isStreaming = false;
        this._state.streamingMessage = undefined;
        this._state.pendingToolCalls = new Set();
        this.activeRun?.resolve();
        this.activeRun = undefined;
    }
    /**
     * Reduce internal state for a loop event, then await listeners.
     *
     * `agent_end` only means no further loop events will be emitted. The run is
     * considered idle later, after all awaited listeners for `agent_end` finish
     * and `finishRun()` clears runtime-owned state.
     */
    async processEvents(event) {
        switch (event.type) {
            case "message_start":
                this._state.streamingMessage = event.message;
                break;
            case "message_update":
                this._state.streamingMessage = event.message;
                break;
            case "message_end":
                this._state.streamingMessage = undefined;
                this._state.messages.push(event.message);
                break;
            case "tool_execution_start": {
                const pendingToolCalls = new Set(this._state.pendingToolCalls);
                pendingToolCalls.add(event.toolCallId);
                this._state.pendingToolCalls = pendingToolCalls;
                break;
            }
            case "tool_execution_end": {
                const pendingToolCalls = new Set(this._state.pendingToolCalls);
                pendingToolCalls.delete(event.toolCallId);
                this._state.pendingToolCalls = pendingToolCalls;
                break;
            }
            case "turn_end":
                if (event.message.role === "assistant" && event.message.errorMessage) {
                    this._state.errorMessage = event.message.errorMessage;
                }
                break;
            case "agent_end":
                this._state.streamingMessage = undefined;
                break;
        }
        const signal = this.activeRun?.abortController.signal;
        if (!signal) {
            throw new Error("Agent listener invoked outside active run");
        }
        for (const listener of this.listeners) {
            await listener(event, signal);
        }
    }
}
//# sourceMappingURL=agent.js.map