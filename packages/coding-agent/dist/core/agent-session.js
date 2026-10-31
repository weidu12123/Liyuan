/**
 * AgentSession - Core abstraction for agent lifecycle and session management.
 *
 * This class is shared between all run modes (interactive, print, rpc).
 * It encapsulates:
 * - Agent state access
 * - Event subscription with automatic session persistence
 * - Model and thinking level management
 * - Compaction (manual and auto)
 * - Bash execution
 * - Session switching and branching
 *
 * Modes use this class and add their own I/O layer on top.
 */
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { contentText } from "@liyuan/ai";
import { clampThinkingLevel, cleanupSessionResources, getSupportedThinkingLevels, isContextOverflow, isRecoverableLength, isRetryableAssistantError, modelsAreEqual, resetApiProviders, streamSimple, } from "@liyuan/ai/compat";
import { getThemeByName, theme } from "../modes/interactive/theme/theme.js";
import { stripFrontmatter } from "../utils/frontmatter.js";
import { sleep } from "../utils/sleep.js";
import { normalizeToolResultImages } from "../utils/tool-result-images.js";
import { formatNoApiKeyFoundMessage, formatNoModelSelectedMessage } from "./auth-guidance.js";
import { executeBashWithOperations } from "./bash-executor.js";
import { calculateContextTokens, collectEntriesForBranchSummary, compact, estimateContextTokens, estimateTokens, generateBranchSummary, prepareCompaction, shouldCompact, } from "./compaction/index.js";
import { DEFAULT_THINKING_LEVEL, THINKING_LEVEL_OPTIONS } from "./defaults.js";
import { exportSessionToHtml } from "./export-html/index.js";
import { createToolHtmlRenderer } from "./export-html/tool-renderer.js";
import { ExtensionRunner, wrapRegisteredTools, } from "./extensions/index.js";
import { emitSessionShutdownEvent } from "./extensions/runner.js";
import { ModelRegistry } from "./model-registry.js";
import { expandPromptTemplate } from "./prompt-templates.js";
import { exportSessionToJsonl } from "./session-export.js";
import { getLatestCompactionEntry } from "./session-manager.js";
import { createSyntheticSourceInfo } from "./source-info.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { createLocalBashOperations } from "./tools/bash.js";
import { createAllToolDefinitions } from "./tools/index.js";
import { createToolDefinitionFromAgentTool } from "./tools/tool-definition-wrapper.js";
import { addUsageToTotals, createUsageTotals } from "./usage-totals.js";
/**
 * Parse a skill block from message text.
 * Returns null if the text doesn't contain a skill block.
 */
export function parseSkillBlock(text) {
    const match = text.match(/^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/);
    if (!match)
        return null;
    return {
        name: match[1],
        location: match[2],
        content: match[3],
        userMessage: match[4]?.trim() || undefined,
    };
}
// ============================================================================
// Types
// ============================================================================
function withoutDeletedHeaders(headers) {
    return headers
        ? Object.fromEntries(Object.entries(headers).filter((entry) => entry[1] !== null))
        : undefined;
}
function estimateMessagesTokens(messages) {
    let tokens = 0;
    for (const message of messages) {
        tokens += estimateTokens(message);
    }
    return tokens;
}
// ============================================================================
// Constants
// ============================================================================
// ============================================================================
// AgentSession Class
// ============================================================================
export class AgentSession {
    agent;
    sessionManager;
    settingsManager;
    _scopedModels;
    // Event subscription state
    _unsubscribeAgent;
    _eventListeners = [];
    _isAgentRunActive = false;
    _idleWaitPromise;
    _resolveIdleWait;
    /** Tracks pending steering messages for UI display. Removed when delivered. */
    _steeringMessages = [];
    /** Tracks pending follow-up messages for UI display. Removed when delivered. */
    _followUpMessages = [];
    /** Messages queued to be included with the next user prompt as context ("asides"). */
    _pendingNextTurnMessages = [];
    /** Context-only custom messages queued during a run, flushed once the current turn's tool results are in. */
    _pendingCustomMessages = [];
    // Compaction state
    _compactionAbortController = undefined;
    _autoCompactionAbortController = undefined;
    _overflowRecoveryAttempted = false;
    // Branch summarization state
    _branchSummaryAbortController = undefined;
    // Retry state
    _retryAbortController = undefined;
    _retryAttempt = 0;
    // Bash execution state
    _bashAbortControllers = new Set();
    _pendingBashMessages = [];
    // Extension system
    _extensionRunner;
    _turnIndex = 0;
    _resourceLoader;
    _customTools;
    _baseToolDefinitions = new Map();
    _cwd;
    _extensionRunnerRef;
    _initialActiveToolNames;
    _allowedToolNames;
    _excludedToolNames;
    _baseToolsOverride;
    _sessionStartEvent;
    _extensionUIContext;
    _extensionMode = "print";
    _extensionCommandContextActions;
    _extensionAbortHandler;
    _extensionShutdownHandler;
    _extensionErrorListener;
    _extensionErrorUnsubscriber;
    _modelRuntime;
    // Tool registry for extension getTools/setTools
    _toolRegistry = new Map();
    _toolDefinitions = new Map();
    _toolPromptSnippets = new Map();
    _toolPromptGuidelines = new Map();
    // Base system prompt (without extension appends) - used to apply fresh appends each turn
    _baseSystemPrompt = "";
    _baseSystemPromptOptions;
    _systemPromptOverride;
    constructor(config) {
        this.agent = config.agent;
        this.sessionManager = config.sessionManager;
        this.settingsManager = config.settingsManager;
        this._scopedModels = config.scopedModels ?? [];
        this._resourceLoader = config.resourceLoader;
        this._customTools = config.customTools ?? [];
        this._cwd = config.cwd;
        this._modelRuntime = config.modelRuntime;
        this._extensionRunnerRef = config.extensionRunnerRef;
        this._initialActiveToolNames = config.initialActiveToolNames;
        this._allowedToolNames = config.allowedToolNames ? new Set(config.allowedToolNames) : undefined;
        this._excludedToolNames = config.excludedToolNames ? new Set(config.excludedToolNames) : undefined;
        this._baseToolsOverride = config.baseToolsOverride;
        this._sessionStartEvent = config.sessionStartEvent ?? { type: "session_start", reason: "startup" };
        // Always subscribe to agent events for internal handling
        // (session persistence, extensions, auto-compaction, retry logic)
        this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
        this._installAgentToolHooks();
        this._installAgentNextTurnRefresh();
        this._buildRuntime({
            activeToolNames: this._initialActiveToolNames,
            includeAllExtensionTools: true,
        });
    }
    get modelRuntime() {
        return this._modelRuntime;
    }
    async _getRequiredRequestAuth(model) {
        let result;
        try {
            result = await this._modelRuntime.getAuth(model);
        }
        catch (error) {
            const cause = error instanceof Error ? error.cause : undefined;
            if (cause instanceof Error && cause.message === "authHeader requires a resolved API key") {
                throw new Error(formatNoApiKeyFoundMessage(model.provider));
            }
            throw error;
        }
        if (result && (result.auth.apiKey || result.auth.headers)) {
            const requestModel = result.auth.baseUrl ? { ...model, baseUrl: result.auth.baseUrl } : model;
            return {
                model: requestModel,
                apiKey: result.auth.apiKey,
                headers: withoutDeletedHeaders(result.auth.headers),
                env: result.env,
            };
        }
        const isOAuth = this._modelRuntime.isUsingOAuth(model.provider);
        if (isOAuth) {
            throw new Error(`Authentication failed for "${model.provider}". ` +
                `Credentials may have expired or network is unavailable. ` +
                `Run '/login ${model.provider}' to re-authenticate.`);
        }
        throw new Error(formatNoApiKeyFoundMessage(model.provider));
    }
    async _getSummarizationRequestAuth(model) {
        if (this.agent.streamFunction === streamSimple) {
            return this._getRequiredRequestAuth(model);
        }
        try {
            const result = await this._modelRuntime.getAuth(model);
            if (!result)
                return { model };
            const requestModel = result.auth.baseUrl ? { ...model, baseUrl: result.auth.baseUrl } : model;
            return {
                model: requestModel,
                apiKey: result.auth.apiKey,
                headers: withoutDeletedHeaders(result.auth.headers),
                env: result.env,
            };
        }
        catch {
            return { model };
        }
    }
    /**
     * Install tool hooks once on the Agent instance.
     *
     * The callbacks read `this._extensionRunner` at execution time, so extension reload swaps in the
     * new runner without reinstalling hooks. Extension-specific tool wrappers are still used to adapt
     * registered tool execution to the extension context. Tool call and tool result interception now
     * happens here instead of in wrappers.
     */
    _installAgentToolHooks() {
        this.agent.beforeToolCall = async ({ toolCall, args }) => {
            const runner = this._extensionRunner;
            if (!runner.hasHandlers("tool_call")) {
                return undefined;
            }
            try {
                return await runner.emitToolCall({
                    type: "tool_call",
                    toolName: toolCall.name,
                    toolCallId: toolCall.id,
                    input: args,
                });
            }
            catch (err) {
                if (err instanceof Error) {
                    throw err;
                }
                throw new Error(`Extension failed, blocking execution: ${String(err)}`);
            }
        };
        this.agent.afterToolCall = async ({ toolCall, args, result, isError }) => {
            const runner = this._extensionRunner;
            const hookResult = runner.hasHandlers("tool_result")
                ? await runner.emitToolResult({
                    type: "tool_result",
                    toolName: toolCall.name,
                    toolCallId: toolCall.id,
                    input: args,
                    content: result.content,
                    details: result.details,
                    isError,
                    usage: result.usage,
                })
                : undefined;
            const content = hookResult?.content ?? result.content ?? [];
            // Runs after the extension hook so images injected or replaced by extensions are normalized too.
            const normalizedContent = await normalizeToolResultImages(content, {
                autoResizeImages: this.settingsManager.getImageAutoResize(),
            });
            if (!hookResult && normalizedContent === content) {
                return undefined;
            }
            return {
                content: normalizedContent,
                details: hookResult?.details,
                isError: hookResult?.isError ?? isError,
                usage: hookResult?.usage,
            };
        };
    }
    async _compactBeforeNextAssistantResponse(context) {
        const model = this.model;
        const settings = this.settingsManager.getCompactionSettings();
        if (!model ||
            model.contextWindow <= 0 ||
            !shouldCompact(estimateContextTokens(context.messages).tokens, model.contextWindow, settings)) {
            return context;
        }
        await this._runAutoCompaction("threshold", false);
        return {
            ...context,
            messages: this.agent.state.messages.slice(),
        };
    }
    _installAgentNextTurnRefresh() {
        const previousPrepareNextTurnWithContext = this.agent.prepareNextTurnWithContext ??
            (this.agent.prepareNextTurn
                ? async (_turn, signal) => await this.agent.prepareNextTurn?.(signal)
                : undefined);
        this.agent.prepareNextTurnWithContext = async (turn, signal) => {
            const context = await this._compactBeforeNextAssistantResponse(turn.context);
            const previousSnapshot = await previousPrepareNextTurnWithContext?.({ ...turn, context }, signal);
            const nextContext = previousSnapshot?.context ?? context;
            return {
                ...previousSnapshot,
                context: {
                    ...nextContext,
                    systemPrompt: this._systemPromptOverride ?? this._baseSystemPrompt,
                    tools: this.agent.state.tools.slice(),
                },
                model: this.agent.state.model,
                thinkingLevel: this.agent.state.thinkingLevel,
            };
        };
    }
    // =========================================================================
    // Event Subscription
    // =========================================================================
    /** Emit an event to all listeners */
    _emit(event) {
        for (const l of this._eventListeners) {
            l(event);
        }
    }
    _emitQueueUpdate() {
        this._emit({
            type: "queue_update",
            steering: [...this._steeringMessages],
            followUp: [...this._followUpMessages],
        });
    }
    async _emitSessionCompactFailed(event) {
        if (this._extensionRunner.hasHandlers("session_compact_failed")) {
            await this._extensionRunner.emit({ type: "session_compact_failed", ...event });
        }
    }
    _getIdleWaitPromise() {
        if (!this._idleWaitPromise) {
            this._idleWaitPromise = new Promise((resolve) => {
                this._resolveIdleWait = resolve;
            });
        }
        return this._idleWaitPromise;
    }
    _resolveIdleWaitIfIdle() {
        if (this._isAgentRunActive || !this._resolveIdleWait) {
            return;
        }
        const resolve = this._resolveIdleWait;
        this._idleWaitPromise = undefined;
        this._resolveIdleWait = undefined;
        resolve();
    }
    async _emitAgentSettled() {
        this._isAgentRunActive = false;
        try {
            await this._extensionRunner.emit({ type: "agent_settled" });
            this._emit({ type: "agent_settled" });
        }
        finally {
            this._resolveIdleWaitIfIdle();
        }
    }
    // Track last assistant message for auto-compaction check
    _lastAssistantMessage = undefined;
    _transientMessages = new Set();
    _discardTransientMessages() {
        if (this._transientMessages.size > 0) {
            this.agent.state.messages = this.agent.state.messages.filter((message) => !this._transientMessages.has(message));
        }
    }
    /** Internal handler for agent events - shared by subscribe and reconnect */
    _handleAgentEvent = async (event) => {
        // When a user message starts, check if it's from either queue and remove it BEFORE emitting
        // This ensures the UI sees the updated queue state
        if (event.type === "message_start" && event.message.role === "user") {
            this._overflowRecoveryAttempted = false;
            const messageText = contentText(event.message.content, "");
            if (messageText) {
                // Check steering queue first
                const steeringIndex = this._steeringMessages.indexOf(messageText);
                if (steeringIndex !== -1) {
                    this._steeringMessages.splice(steeringIndex, 1);
                    this._emitQueueUpdate();
                }
                else {
                    // Check follow-up queue
                    const followUpIndex = this._followUpMessages.indexOf(messageText);
                    if (followUpIndex !== -1) {
                        this._followUpMessages.splice(followUpIndex, 1);
                        this._emitQueueUpdate();
                    }
                }
            }
        }
        const willRetry = event.type === "agent_end" ? this._willRetryAfterAgentEnd(event) : false;
        // Transient provider/tool messages belong to this run, not the next one.
        // Keep event.messages intact so agent_end can reduce the completed work,
        // and keep prior transient tool exchanges in agent.state.messages while retrying.
        if (event.type === "agent_end" && !willRetry)
            this._discardTransientMessages();
        // Emit to extensions first
        await this._emitExtensionEvent(event);
        // Notify all listeners
        this._emit(event.type === "agent_end" ? { ...event, willRetry } : event);
        if (event.type === "agent_end" && !willRetry)
            this._transientMessages.clear();
        // Handle session persistence
        if (event.type === "message_end") {
            const isTransient = this._transientMessages.has(event.message);
            if (!isTransient) {
                // Check if this is a custom message from extensions
                if (event.message.role === "custom") {
                    // Persist as CustomMessageEntry
                    this.sessionManager.appendCustomMessageEntry(event.message.customType, event.message.content, event.message.display, event.message.details);
                }
                else if (event.message.role === "user" ||
                    event.message.role === "assistant" ||
                    event.message.role === "toolResult") {
                    // Regular LLM message - persist as SessionMessageEntry
                    this.sessionManager.appendMessage(event.message);
                }
            }
            // Other message types (bashExecution, compactionSummary, branchSummary) are persisted elsewhere
            // Track assistant message for retry and auto-compaction (checked on agent_end)
            if (event.message.role === "assistant") {
                const assistantMsg = event.message;
                this._lastAssistantMessage =
                    isTransient && assistantMsg.stopReason !== "error" ? undefined : assistantMsg;
                if (assistantMsg.stopReason !== "error" && assistantMsg.stopReason !== "length") {
                    this._overflowRecoveryAttempted = false;
                }
                // Reset retry counter immediately on successful assistant response
                // This prevents accumulation across multiple LLM calls within a turn
                if (assistantMsg.stopReason !== "error" && this._retryAttempt > 0) {
                    this._emit({
                        type: "auto_retry_end",
                        success: true,
                        attempt: this._retryAttempt,
                    });
                    this._retryAttempt = 0;
                }
            }
        }
        // A turn ends after its assistant message and every tool result has been appended,
        // so this is the first point in the run where a context-only custom message can be
        // inserted without landing between a tool call and its result. Flushing after the
        // extension and listener dispatch above also picks up messages that turn_end
        // handlers queued.
        if (event.type === "turn_end") {
            this._flushPendingCustomMessages();
        }
    };
    _willRetryAfterAgentEnd(event) {
        const settings = this.settingsManager.getRetrySettings();
        if (!settings.enabled || this._retryAttempt >= settings.maxRetries) {
            return false;
        }
        for (let i = event.messages.length - 1; i >= 0; i--) {
            const message = event.messages[i];
            if (message.role === "assistant") {
                return this._isRetryableError(message);
            }
        }
        return false;
    }
    /** Find the last assistant message in agent state (including aborted ones) */
    _findLastAssistantMessage() {
        const messages = this.agent.state.messages;
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === "assistant") {
                return msg;
            }
        }
        return undefined;
    }
    _replaceMessageInPlace(target, replacement) {
        // Agent-core stores the finalized message object in its state before emitting message_end.
        // SessionManager persistence happens later in _handleAgentEvent() with event.message.
        // Mutating this object in place keeps agent state, later turn/agent events, listeners,
        // and the eventual SessionManager.appendMessage(event.message) persistence in sync.
        if (target === replacement) {
            return;
        }
        const targetRecord = target;
        for (const key of Object.keys(targetRecord)) {
            delete targetRecord[key];
        }
        Object.assign(targetRecord, replacement);
    }
    /** Emit extension events based on agent events */
    async _emitExtensionEvent(event) {
        if (event.type === "agent_start") {
            this._turnIndex = 0;
            await this._extensionRunner.emit({ type: "agent_start" });
        }
        else if (event.type === "agent_end") {
            await this._extensionRunner.emit({
                type: "agent_end",
                messages: event.messages,
                willRetry: this._willRetryAfterAgentEnd(event),
            });
        }
        else if (event.type === "turn_start") {
            const extensionEvent = {
                type: "turn_start",
                turnIndex: this._turnIndex,
                timestamp: Date.now(),
            };
            await this._extensionRunner.emit(extensionEvent);
        }
        else if (event.type === "turn_end") {
            const extensionEvent = {
                type: "turn_end",
                turnIndex: this._turnIndex,
                message: event.message,
                toolResults: event.toolResults,
            };
            await this._extensionRunner.emit(extensionEvent);
            this._turnIndex++;
        }
        else if (event.type === "message_start") {
            const extensionEvent = {
                type: "message_start",
                message: event.message,
            };
            await this._extensionRunner.emit(extensionEvent);
        }
        else if (event.type === "message_update") {
            const extensionEvent = {
                type: "message_update",
                message: event.message,
                assistantMessageEvent: event.assistantMessageEvent,
            };
            await this._extensionRunner.emit(extensionEvent);
        }
        else if (event.type === "message_end") {
            const extensionEvent = {
                type: "message_end",
                message: event.message,
            };
            const result = await this._extensionRunner.emitMessageEnd(extensionEvent);
            if (result?.message) {
                const replacement = result.message;
                // Untyped extension handlers can return messages with null/missing content;
                // normalize so it never enters agent state or session history.
                const normalized = (replacement.role === "user" ||
                    replacement.role === "assistant" ||
                    replacement.role === "toolResult" ||
                    replacement.role === "custom") &&
                    replacement.content == null
                    ? { ...replacement, content: [] }
                    : replacement;
                this._replaceMessageInPlace(event.message, normalized);
            }
            if (result?.persist === false)
                this._transientMessages.add(event.message);
        }
        else if (event.type === "tool_execution_start") {
            const extensionEvent = {
                type: "tool_execution_start",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.args,
            };
            await this._extensionRunner.emit(extensionEvent);
        }
        else if (event.type === "tool_execution_update") {
            const extensionEvent = {
                type: "tool_execution_update",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.args,
                partialResult: event.partialResult,
            };
            await this._extensionRunner.emit(extensionEvent);
        }
        else if (event.type === "tool_execution_end") {
            const extensionEvent = {
                type: "tool_execution_end",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                result: event.result,
                isError: event.isError,
            };
            await this._extensionRunner.emit(extensionEvent);
        }
    }
    /**
     * Subscribe to agent events.
     * Session persistence is handled internally (saves messages on message_end).
     * Multiple listeners can be added. Returns unsubscribe function for this listener.
     */
    subscribe(listener) {
        this._eventListeners.push(listener);
        // Return unsubscribe function for this specific listener
        return () => {
            const index = this._eventListeners.indexOf(listener);
            if (index !== -1) {
                this._eventListeners.splice(index, 1);
            }
        };
    }
    /** Disconnect from agent events during disposal. */
    _disconnectFromAgent() {
        if (this._unsubscribeAgent) {
            this._unsubscribeAgent();
            this._unsubscribeAgent = undefined;
        }
    }
    /**
     * Remove all listeners and disconnect from agent.
     * Call this when completely done with the session.
     */
    dispose() {
        try {
            this.abortRetry();
            this.abortCompaction();
            this.abortBranchSummary();
            this.abortBash();
            this.agent.abort();
        }
        catch {
            // Dispose must succeed even if an abort hook throws.
        }
        this._extensionRunner.invalidate("This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().");
        this._disconnectFromAgent();
        this._eventListeners = [];
        cleanupSessionResources(this.sessionId);
    }
    // =========================================================================
    // Read-only State Access
    // =========================================================================
    /** Full agent state */
    get state() {
        return this.agent.state;
    }
    /** Current model (may be undefined if not yet selected) */
    get model() {
        return this.agent.state.model;
    }
    /** Current thinking level */
    get thinkingLevel() {
        return this.agent.state.thinkingLevel;
    }
    /** Whether the session is currently processing an agent run or post-run continuation. */
    get isStreaming() {
        return this._isAgentRunActive;
    }
    /** Whether the session has no active agent run, retry, auto-compaction, or queued continuation. */
    get isIdle() {
        return !this._isAgentRunActive;
    }
    /** Current effective system prompt (includes any per-turn extension modifications) */
    get systemPrompt() {
        return this.agent.state.systemPrompt;
    }
    /** Current retry attempt (0 if not retrying) */
    get retryAttempt() {
        return this._retryAttempt;
    }
    /**
     * Get the names of currently active tools.
     * Returns the names of tools currently set on the agent.
     */
    getActiveToolNames() {
        return this.agent.state.tools.map((t) => t.name);
    }
    /**
     * Get all configured tools with name, description, parameter schema, prompt guidelines, and source metadata.
     */
    getAllTools() {
        return Array.from(this._toolDefinitions.values()).map(({ definition, sourceInfo }) => ({
            name: definition.name,
            description: definition.description,
            parameters: definition.parameters,
            promptGuidelines: definition.promptGuidelines,
            sourceInfo,
        }));
    }
    getToolDefinition(name) {
        return this._toolDefinitions.get(name)?.definition;
    }
    /**
     * Set active tools by name.
     * Only tools in the registry can be enabled. Unknown tool names are ignored.
     * Also rebuilds the system prompt to reflect the new tool set.
     * Changes take effect on the next agent turn.
     */
    setActiveToolsByName(toolNames) {
        const tools = [];
        const validToolNames = [];
        for (const name of toolNames) {
            const tool = this._toolRegistry.get(name);
            if (tool) {
                tools.push(tool);
                validToolNames.push(name);
            }
        }
        this.agent.state.tools = tools;
        // Rebuild base system prompt with new tool set
        this._baseSystemPrompt = this._rebuildSystemPrompt(validToolNames);
        this.agent.state.systemPrompt = this._systemPromptOverride ?? this._baseSystemPrompt;
    }
    /** Change the current run's prompt at the next native model boundary. No new loop or message. */
    setTurnSystemPrompt(systemPrompt) {
        this._systemPromptOverride = systemPrompt;
        this.agent.state.systemPrompt = systemPrompt;
    }
    /** Whether compaction or branch summarization is currently running */
    get isCompacting() {
        return (this._autoCompactionAbortController !== undefined ||
            this._compactionAbortController !== undefined ||
            this._branchSummaryAbortController !== undefined);
    }
    /** All messages including custom types like BashExecutionMessage */
    get messages() {
        return this.agent.state.messages;
    }
    /** Current steering mode */
    get steeringMode() {
        return this.agent.steeringMode;
    }
    /** Current follow-up mode */
    get followUpMode() {
        return this.agent.followUpMode;
    }
    /** Current session file path, or undefined if sessions are disabled */
    get sessionFile() {
        return this.sessionManager.getSessionFile();
    }
    /** Current session ID */
    get sessionId() {
        return this.sessionManager.getSessionId();
    }
    /** Current session display name, if set */
    get sessionName() {
        return this.sessionManager.getSessionName();
    }
    /** Scoped models for cycling (from --models flag) */
    get scopedModels() {
        return this._scopedModels;
    }
    /** Update scoped models for cycling */
    setScopedModels(scopedModels) {
        this._scopedModels = scopedModels;
    }
    /** File-based prompt templates */
    get promptTemplates() {
        return this._resourceLoader.getPrompts().prompts;
    }
    _normalizePromptSnippet(text) {
        if (!text)
            return undefined;
        const oneLine = text
            .replace(/[\r\n]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        return oneLine.length > 0 ? oneLine : undefined;
    }
    _normalizePromptGuidelines(guidelines) {
        if (!guidelines || guidelines.length === 0) {
            return [];
        }
        const unique = new Set();
        for (const guideline of guidelines) {
            const normalized = guideline.trim();
            if (normalized.length > 0) {
                unique.add(normalized);
            }
        }
        return Array.from(unique);
    }
    _rebuildSystemPrompt(toolNames) {
        const validToolNames = toolNames.filter((name) => this._toolRegistry.has(name));
        const toolSnippets = {};
        const promptGuidelines = [];
        for (const name of validToolNames) {
            const snippet = this._toolPromptSnippets.get(name);
            if (snippet) {
                toolSnippets[name] = snippet;
            }
            const toolGuidelines = this._toolPromptGuidelines.get(name);
            if (toolGuidelines) {
                promptGuidelines.push(...toolGuidelines);
            }
        }
        const loaderSystemPrompt = this._resourceLoader.getSystemPrompt();
        const loaderAppendSystemPrompt = this._resourceLoader.getAppendSystemPrompt();
        const appendSystemPrompt = loaderAppendSystemPrompt.length > 0 ? loaderAppendSystemPrompt.join("\n\n") : undefined;
        const loadedSkills = this._resourceLoader.getSkills().skills;
        const loadedContextFiles = this._resourceLoader.getAgentsFiles().agentsFiles;
        this._baseSystemPromptOptions = {
            cwd: this._cwd,
            skills: loadedSkills,
            contextFiles: loadedContextFiles,
            customPrompt: loaderSystemPrompt,
            appendSystemPrompt,
            selectedTools: validToolNames,
            toolSnippets,
            promptGuidelines,
        };
        return buildSystemPrompt(this._baseSystemPromptOptions);
    }
    // =========================================================================
    // Prompting
    // =========================================================================
    async _runAgentPrompt(messages) {
        this._isAgentRunActive = true;
        try {
            await this.agent.prompt(messages);
            while (await this._handlePostAgentRun()) {
                await this.agent.continue();
            }
        }
        finally {
            this._discardTransientMessages();
            this._transientMessages.clear();
            this._systemPromptOverride = undefined;
            this._flushPendingBashMessages();
            this._flushPendingCustomMessages();
            await this._emitAgentSettled();
        }
    }
    async _handlePostAgentRun() {
        const msg = this._lastAssistantMessage;
        this._lastAssistantMessage = undefined;
        if (!msg) {
            return false;
        }
        const isTransient = this._transientMessages.has(msg);
        if (this._isRetryableError(msg) && (await this._prepareRetry(msg))) {
            return true;
        }
        if (msg.stopReason === "error" && this._retryAttempt > 0) {
            this._emit({
                type: "auto_retry_end",
                success: false,
                attempt: this._retryAttempt,
                finalError: msg.errorMessage,
            });
            this._retryAttempt = 0;
        }
        if (!isTransient && (await this._checkCompaction(msg))) {
            return true;
        }
        // The agent loop drains both queues before emitting agent_end. Any messages
        // here were queued by agent_end extension handlers and need a continuation.
        return this.agent.hasQueuedMessages();
    }
    /**
     * Send a prompt to the agent.
     * - Handles extension commands (registered via pi.registerCommand) immediately, even during streaming
     * - Expands file-based prompt templates by default
     * - During streaming, queues via steer() or followUp() based on streamingBehavior option
     * - Validates model and API key before sending (when not streaming)
     * @throws Error if streaming and no streamingBehavior specified
     * @throws Error if no model selected or no API key available (when not streaming)
     */
    async prompt(text, options) {
        const expandPromptTemplates = options?.expandPromptTemplates ?? true;
        const preflightResult = options?.preflightResult;
        let messages;
        try {
            // Handle extension commands first (execute immediately, even during streaming)
            // Extension commands manage their own LLM interaction via pi.sendMessage()
            if (expandPromptTemplates && text.startsWith("/")) {
                const handled = await this._tryExecuteExtensionCommand(text);
                if (handled) {
                    // Extension command executed, no prompt to send
                    preflightResult?.(true);
                    return;
                }
            }
            if (this._compactionAbortController !== undefined) {
                throw new Error("Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.");
            }
            // Emit input event for extension interception (before skill/template expansion)
            let currentText = text;
            let currentImages = options?.images;
            if (this._extensionRunner.hasHandlers("input")) {
                const inputResult = await this._extensionRunner.emitInput(currentText, currentImages, options?.source ?? "interactive", this.isStreaming ? options?.streamingBehavior : undefined);
                if (inputResult.action === "handled") {
                    preflightResult?.(true);
                    return;
                }
                if (inputResult.action === "transform") {
                    currentText = inputResult.text;
                    currentImages = inputResult.images ?? currentImages;
                }
            }
            // Expand skill commands (/skill:name args) and prompt templates (/template args)
            let expandedText = currentText;
            if (expandPromptTemplates) {
                expandedText = this._expandSkillCommand(expandedText);
                expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);
            }
            // If streaming, queue via steer() or followUp() based on option
            if (this.isStreaming) {
                if (!options?.streamingBehavior) {
                    throw new Error("Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.");
                }
                if (options.streamingBehavior === "followUp") {
                    await this._queueFollowUp(expandedText, currentImages);
                }
                else {
                    await this._queueSteer(expandedText, currentImages);
                }
                preflightResult?.(true);
                return;
            }
            // Flush any pending bash and custom messages before the new prompt
            this._flushPendingBashMessages();
            this._flushPendingCustomMessages();
            // Validate model
            if (!this.model) {
                throw new Error(formatNoModelSelectedMessage());
            }
            const hasConfiguredAuth = this._modelRuntime.hasConfiguredAuth(this.model.provider) ||
                (await this._modelRuntime.checkAuth(this.model.provider)) !== undefined;
            if (!hasConfiguredAuth) {
                const isOAuth = this._modelRuntime.isUsingOAuth(this.model.provider);
                if (isOAuth) {
                    throw new Error(`Authentication failed for "${this.model.provider}". ` +
                        `Credentials may have expired or network is unavailable. ` +
                        `Run '/login ${this.model.provider}' to re-authenticate.`);
                }
                throw new Error(formatNoApiKeyFoundMessage(this.model.provider));
            }
            // Check if we need to compact before sending (catches aborted responses).
            // The user's new prompt is sent below, so do not call agent.continue() here.
            const lastAssistant = this._findLastAssistantMessage();
            if (lastAssistant) {
                await this._checkCompaction(lastAssistant, false);
            }
            // Build messages array (custom message if any, then user message)
            messages = [];
            // Add user message
            const userContent = [{ type: "text", text: expandedText }];
            if (currentImages) {
                userContent.push(...currentImages);
            }
            if (options?.reuseUserMessage) {
                const leafId = this.sessionManager.getLeafId();
                const leaf = leafId ? this.sessionManager.getEntry(leafId) : undefined;
                if (leaf?.type !== "message" || leaf.message.role !== "user" ||
                    contentText(leaf.message.content, "") !== expandedText || currentImages?.length) {
                    throw new Error("reuseUserMessage requires the unchanged user message at the current leaf");
                }
                this.setLeaf(leafId);
                this._overflowRecoveryAttempted = false;
            }
            else {
                messages.push({
                    role: "user",
                    content: userContent,
                    timestamp: Date.now(),
                });
            }
            // Inject any pending "nextTurn" messages as context alongside the user message
            for (const msg of this._pendingNextTurnMessages) {
                messages.push(msg);
            }
            this._pendingNextTurnMessages = [];
            // Emit before_agent_start extension event
            const result = await this._extensionRunner.emitBeforeAgentStart(expandedText, currentImages, this._baseSystemPrompt, this._baseSystemPromptOptions);
            // Add all custom messages from extensions
            if (result?.messages) {
                for (const msg of result.messages) {
                    messages.push({
                        role: "custom",
                        customType: msg.customType,
                        // Untyped extensions can pass null/missing content; normalize at ingestion.
                        content: msg.content ?? [],
                        display: msg.display,
                        details: msg.details,
                        timestamp: Date.now(),
                    });
                }
            }
            // Apply extension-modified system prompt, or reset to base
            if (result?.systemPrompt !== undefined) {
                this._systemPromptOverride = result.systemPrompt;
                this.agent.state.systemPrompt = result.systemPrompt;
            }
            else {
                // Ensure we're using the base prompt (in case previous turn had modifications)
                this._systemPromptOverride = undefined;
                this.agent.state.systemPrompt = this._baseSystemPrompt;
            }
        }
        catch (error) {
            preflightResult?.(false);
            throw error;
        }
        if (!messages) {
            return;
        }
        preflightResult?.(true);
        await this._runAgentPrompt(messages);
    }
    /** Record an already-produced message in both durable and in-memory history. Does not start a turn. */
    appendMessage(message) {
        const id = this.sessionManager.appendMessage(message);
        this.agent.state.messages.push(message);
        return id;
    }
    /** Select an exact leaf without putting user/custom messages into the editor. */
    setLeaf(entryId) {
        if (this.isStreaming)
            throw new Error("Cannot change the session leaf while streaming");
        if (entryId === null)
            this.sessionManager.resetLeaf();
        else
            this.sessionManager.branch(entryId);
        this.agent.state.messages = this.sessionManager.buildSessionContext().messages;
    }
    /**
     * Try to execute an extension command. Returns true if command was found and executed.
     */
    async _tryExecuteExtensionCommand(text) {
        // Parse command name and args
        const spaceIndex = text.indexOf(" ");
        const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
        const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);
        const command = this._extensionRunner.getCommand(commandName);
        if (!command)
            return false;
        // Get command context from extension runner (includes session control methods)
        const ctx = this._extensionRunner.createCommandContext();
        try {
            await command.handler(args, ctx);
            return true;
        }
        catch (err) {
            // Emit error via extension runner
            this._extensionRunner.emitError({
                extensionPath: `command:${commandName}`,
                event: "command",
                error: err instanceof Error ? err.message : String(err),
            });
            return true;
        }
    }
    /**
     * Expand skill commands (/skill:name args) to their full content.
     * Returns the expanded text, or the original text if not a skill command or skill not found.
     * Emits errors via extension runner if file read fails.
     */
    _expandSkillCommand(text) {
        if (!text.startsWith("/skill:"))
            return text;
        const spaceIndex = text.indexOf(" ");
        const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
        const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();
        const skill = this.resourceLoader.getSkills().skills.find((s) => s.name === skillName);
        if (!skill)
            return text; // Unknown skill, pass through
        try {
            const content = readFileSync(skill.filePath, "utf-8");
            const body = stripFrontmatter(content).trim();
            const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
            return args ? `${skillBlock}\n\n${args}` : skillBlock;
        }
        catch (err) {
            // Emit error like extension commands do
            this._extensionRunner.emitError({
                extensionPath: skill.filePath,
                event: "skill_expansion",
                error: err instanceof Error ? err.message : String(err),
            });
            return text; // Return original on error
        }
    }
    /**
     * Queue a steering message while the agent is running.
     * Delivered after the current assistant turn finishes executing its tool calls,
     * before the next LLM call.
     * Expands skill commands and prompt templates. Errors on extension commands.
     * @param images Optional image attachments to include with the message
     * @throws Error if text is an extension command
     */
    async steer(text, images) {
        // Check for extension commands (cannot be queued)
        if (text.startsWith("/")) {
            this._throwIfExtensionCommand(text);
        }
        // Expand skill commands and prompt templates
        let expandedText = this._expandSkillCommand(text);
        expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);
        await this._queueSteer(expandedText, images);
    }
    /**
     * Queue a follow-up message to be processed after the agent finishes.
     * Delivered only when agent has no more tool calls or steering messages.
     * Expands skill commands and prompt templates. Errors on extension commands.
     * @param images Optional image attachments to include with the message
     * @throws Error if text is an extension command
     */
    async followUp(text, images) {
        // Check for extension commands (cannot be queued)
        if (text.startsWith("/")) {
            this._throwIfExtensionCommand(text);
        }
        // Expand skill commands and prompt templates
        let expandedText = this._expandSkillCommand(text);
        expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);
        await this._queueFollowUp(expandedText, images);
    }
    /**
     * Internal: Queue a steering message (already expanded, no extension command check).
     */
    async _queueSteer(text, images) {
        this._steeringMessages.push(text);
        this._emitQueueUpdate();
        const content = [{ type: "text", text }];
        if (images) {
            content.push(...images);
        }
        this.agent.steer({
            role: "user",
            content,
            timestamp: Date.now(),
        });
    }
    /**
     * Internal: Queue a follow-up message (already expanded, no extension command check).
     */
    async _queueFollowUp(text, images) {
        this._followUpMessages.push(text);
        this._emitQueueUpdate();
        const content = [{ type: "text", text }];
        if (images) {
            content.push(...images);
        }
        this.agent.followUp({
            role: "user",
            content,
            timestamp: Date.now(),
        });
    }
    /**
     * Throw an error if the text is an extension command.
     */
    _throwIfExtensionCommand(text) {
        const spaceIndex = text.indexOf(" ");
        const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
        const command = this._extensionRunner.getCommand(commandName);
        if (command) {
            throw new Error(`Extension command "/${commandName}" cannot be queued. Use prompt() or execute the command when not streaming.`);
        }
    }
    /**
     * Send a custom message to the session. Creates a CustomMessageEntry.
     *
     * Handles four cases:
     * - Streaming: queues message, processed when loop pulls from queue
     * - Streaming + triggerTurn false: appended to state/session once the current turn ends
     * - Not streaming + triggerTurn: appends to state/session, starts new turn
     * - Not streaming + no trigger: appends to state/session, no turn
     *
     * @param message Custom message with customType, content, display, details
     * @param options.triggerTurn If true and not streaming, triggers a new LLM turn
     * @param options.deliverAs Delivery mode: "steer", "followUp", or "nextTurn"
     */
    async sendCustomMessage(message, options) {
        const appMessage = {
            role: "custom",
            customType: message.customType,
            // Untyped extensions can pass null/missing content; normalize at ingestion.
            content: message.content ?? [],
            display: message.display,
            details: message.details,
            timestamp: Date.now(),
        };
        if (options?.deliverAs === "nextTurn") {
            this._pendingNextTurnMessages.push(appMessage);
        }
        else if (this.isStreaming && options?.triggerTurn !== false) {
            if (options?.deliverAs === "followUp") {
                this.agent.followUp(appMessage);
            }
            else {
                this.agent.steer(appMessage);
            }
        }
        else if (options?.triggerTurn) {
            await this._runAgentPrompt(appMessage);
        }
        else if (this.isStreaming) {
            // Appending now would put the message between an assistant tool call and its
            // result, which providers that validate message order reject on replay. Defer
            // to the end of the turn. Nothing is emitted yet: message events must not
            // describe messages the session tree does not contain.
            this._pendingCustomMessages.push(appMessage);
        }
        else {
            this._appendCustomMessage(appMessage);
        }
    }
    _appendCustomMessage(appMessage) {
        this.agent.state.messages.push(appMessage);
        this.sessionManager.appendCustomMessageEntry(appMessage.customType, appMessage.content, appMessage.display, appMessage.details);
        this._emit({ type: "message_start", message: appMessage });
        this._emit({ type: "message_end", message: appMessage });
    }
    /**
     * Append custom messages queued while the agent was running.
     * Called once the current turn's tool results are in agent state and session history.
     */
    _flushPendingCustomMessages() {
        if (this._pendingCustomMessages.length === 0)
            return;
        const pending = this._pendingCustomMessages;
        this._pendingCustomMessages = [];
        for (const appMessage of pending) {
            this._appendCustomMessage(appMessage);
        }
    }
    /**
     * Send a user message to the agent. Always triggers a turn.
     * When the agent is streaming, use deliverAs to specify how to queue the message.
     *
     * @param content User message content (string or content array)
     * @param options.deliverAs Delivery mode when streaming: "steer" or "followUp"
     * @param options.expandPromptTemplates Whether to dispatch extension commands and expand skill commands and prompt templates. Default: false.
     */
    async sendUserMessage(content, options) {
        // Normalize content to text string + optional images
        let text;
        let images;
        if (typeof content === "string") {
            text = content;
        }
        else {
            const textParts = [];
            images = [];
            for (const part of content) {
                if (part.type === "text") {
                    textParts.push(part.text);
                }
                else {
                    images.push(part);
                }
            }
            text = textParts.join("\n");
            if (images.length === 0)
                images = undefined;
        }
        await this.prompt(text, {
            expandPromptTemplates: options?.expandPromptTemplates ?? false,
            streamingBehavior: options?.deliverAs,
            images,
            source: "extension",
        });
    }
    /**
     * Clear all queued messages and return them.
     * Useful for restoring to editor when user aborts.
     * @returns Object with steering and followUp arrays
     */
    clearQueue() {
        const steering = [...this._steeringMessages];
        const followUp = [...this._followUpMessages];
        this._steeringMessages = [];
        this._followUpMessages = [];
        this.agent.clearAllQueues();
        this._emitQueueUpdate();
        return { steering, followUp };
    }
    /** Number of pending messages (includes both steering and follow-up) */
    get pendingMessageCount() {
        return this._steeringMessages.length + this._followUpMessages.length;
    }
    /** Get pending steering messages (read-only) */
    getSteeringMessages() {
        return this._steeringMessages;
    }
    /** Get pending follow-up messages (read-only) */
    getFollowUpMessages() {
        return this._followUpMessages;
    }
    get resourceLoader() {
        return this._resourceLoader;
    }
    /**
     * Abort current operation and wait for agent to become idle.
     * Also cancels compaction/bash side-runs and drops queued steer/follow-ups
     * so Stop cannot be followed by a spontaneous extra turn.
     * Caps wait so a hung provider stream cannot leave Stop blocked forever.
     */
    async abort() {
        this.abortRetry();
        this.abortCompaction();
        this.abortBranchSummary();
        this.abortBash();
        // Drop queued prompts first — otherwise aborting the stream can still
        // drain follow-ups and look like "stop doesn't work".
        this.clearQueue();
        this.agent.abort();
        let timer;
        try {
            await Promise.race([
                this.waitForIdle(),
                new Promise((resolve) => { timer = setTimeout(resolve, 8_000); }),
            ]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    async waitForIdle() {
        if (this.isIdle) {
            return;
        }
        await this._getIdleWaitPromise();
    }
    // =========================================================================
    // Model Management
    // =========================================================================
    async _emitModelSelect(nextModel, previousModel, source) {
        if (modelsAreEqual(previousModel, nextModel))
            return;
        await this._extensionRunner.emit({
            type: "model_select",
            model: nextModel,
            previousModel,
            source,
        });
    }
    /**
     * Set model directly.
     * Validates that auth is configured and saves to the session transcript.
     * Persists to global defaults only when options.persist is true.
     * @throws Error if no auth is configured for the model
     */
    async setModel(model, options = {}) {
        if (!(await this._modelRuntime.checkAuth(model.provider))) {
            throw new Error(`No API key for ${model.provider}/${model.id}`);
        }
        const previousModel = this.model;
        const thinkingLevel = this._getThinkingLevelForModelSwitch(model);
        this.agent.state.model = model;
        this.sessionManager.appendModelChange(model.provider, model.id);
        if (options.persist) {
            this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
            this._addPersistedDefaultToNonEmptyScope(model);
        }
        // Apply thinking level for the new model.
        // Per-model thinking level overrides take priority over the global default.
        // Model persistence does not implicitly rewrite the global thinking default.
        this.setThinkingLevel(thinkingLevel);
        await this._emitModelSelect(model, previousModel, "set");
    }
    _addPersistedDefaultToNonEmptyScope(model) {
        if (this._scopedModels.length === 0)
            return;
        if (this._scopedModels.some((scoped) => modelsAreEqual(scoped.model, model)))
            return;
        this._scopedModels = [...this._scopedModels, { model }];
        const enabledModels = this.settingsManager.getEnabledModels();
        if (!enabledModels?.length)
            return;
        const modelReference = `${model.provider}/${model.id}`;
        if (enabledModels.some((pattern) => pattern.toLowerCase() === modelReference.toLowerCase()))
            return;
        this.settingsManager.setEnabledModels([...enabledModels, modelReference]);
    }
    /**
     * Cycle to next/previous model.
     * Uses scoped models (from --models flag) if available, otherwise all available models.
     * @param direction - "forward" (default) or "backward"
     * @returns The new model info, or undefined if only one model available
     */
    async cycleModel(direction = "forward", options = {}) {
        if (this._scopedModels.length > 0) {
            return this._cycleScopedModel(direction, options);
        }
        return this._cycleAvailableModel(direction, options);
    }
    async _cycleScopedModel(direction, options) {
        const availableIds = new Set(this._modelRuntime.getAvailableSnapshot().map((model) => `${model.provider}\0${model.id}`));
        const scopedModels = this._scopedModels.filter((scoped) => availableIds.has(`${scoped.model.provider}\0${scoped.model.id}`));
        if (scopedModels.length <= 1)
            return undefined;
        const currentModel = this.model;
        let currentIndex = scopedModels.findIndex((sm) => modelsAreEqual(sm.model, currentModel));
        if (currentIndex === -1)
            currentIndex = 0;
        const len = scopedModels.length;
        const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
        const next = scopedModels[nextIndex];
        const thinkingLevel = this._getThinkingLevelForModelSwitch(next.model, next.thinkingLevel);
        // Apply model
        this.agent.state.model = next.model;
        this.sessionManager.appendModelChange(next.model.provider, next.model.id);
        if (options.persist) {
            this.settingsManager.setDefaultModelAndProvider(next.model.provider, next.model.id);
            this._addPersistedDefaultToNonEmptyScope(next.model);
        }
        // Apply thinking level for the new model.
        // - Explicit scoped model thinking level overrides defaults
        // - Per-model thinking level overrides take priority over the global default
        // setThinkingLevel clamps to model capabilities.
        // Model persistence does not implicitly rewrite the global thinking default.
        this.setThinkingLevel(thinkingLevel);
        await this._emitModelSelect(next.model, currentModel, "cycle");
        return { model: next.model, thinkingLevel: this.thinkingLevel, isScoped: true };
    }
    async _cycleAvailableModel(direction, options) {
        const availableModels = this._modelRuntime.getAvailableSnapshot();
        if (availableModels.length <= 1)
            return undefined;
        const currentModel = this.model;
        let currentIndex = availableModels.findIndex((m) => modelsAreEqual(m, currentModel));
        if (currentIndex === -1)
            currentIndex = 0;
        const len = availableModels.length;
        const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
        const nextModel = availableModels[nextIndex];
        const thinkingLevel = this._getThinkingLevelForModelSwitch(nextModel);
        this.agent.state.model = nextModel;
        this.sessionManager.appendModelChange(nextModel.provider, nextModel.id);
        if (options.persist) {
            this.settingsManager.setDefaultModelAndProvider(nextModel.provider, nextModel.id);
            this._addPersistedDefaultToNonEmptyScope(nextModel);
        }
        // Apply thinking level for the new model.
        // Model persistence does not implicitly rewrite the global thinking default.
        this.setThinkingLevel(thinkingLevel);
        await this._emitModelSelect(nextModel, currentModel, "cycle");
        return { model: nextModel, thinkingLevel: this.thinkingLevel, isScoped: false };
    }
    // =========================================================================
    // Thinking Level Management
    // =========================================================================
    /**
     * Set thinking level.
     * Clamps to model capabilities based on available thinking levels.
     * Saves the clamped level to the session transcript only if the level actually changes.
     * Persists the requested level to global defaults only when options.persist is true.
     */
    setThinkingLevel(level, options = {}) {
        const availableLevels = this.getAvailableThinkingLevels();
        const effectiveLevel = availableLevels.includes(level) ? level : this._clampThinkingLevel(level, availableLevels);
        // Only persist if actually changing
        const previousLevel = this.agent.state.thinkingLevel;
        const isChanging = effectiveLevel !== previousLevel;
        this.agent.state.thinkingLevel = effectiveLevel;
        if (options.persist) {
            this.settingsManager.setDefaultThinkingLevel(level);
        }
        if (isChanging) {
            this.sessionManager.appendThinkingLevelChange(effectiveLevel);
            this._emit({ type: "thinking_level_changed", level: effectiveLevel });
            void this._extensionRunner.emit({
                type: "thinking_level_select",
                level: effectiveLevel,
                previousLevel,
            });
        }
    }
    /**
     * Cycle to next thinking level.
     * @returns New level, or undefined if model doesn't support thinking
     */
    cycleThinkingLevel(options = {}) {
        if (!this.supportsThinking())
            return undefined;
        const levels = this.getAvailableThinkingLevels();
        const currentIndex = levels.indexOf(this.thinkingLevel);
        const nextIndex = (currentIndex + 1) % levels.length;
        const nextLevel = levels[nextIndex];
        this.setThinkingLevel(nextLevel, options);
        return nextLevel;
    }
    /**
     * Get available thinking levels for current model.
     * The provider will clamp to what the specific model supports internally.
     */
    getAvailableThinkingLevels() {
        if (!this.model)
            return [...THINKING_LEVEL_OPTIONS];
        return getSupportedThinkingLevels(this.model);
    }
    /**
     * Check if current model supports thinking/reasoning.
     */
    supportsThinking() {
        return !!this.model?.reasoning;
    }
    _getThinkingLevelForModelSwitch(targetModel, explicitLevel) {
        if (explicitLevel !== undefined) {
            return explicitLevel;
        }
        // Per-model default takes priority when switching to a model that has one
        if (targetModel) {
            const perModel = this.settingsManager.getModelThinkingLevel(targetModel.provider, targetModel.id);
            if (perModel !== undefined) {
                return perModel;
            }
        }
        return this.settingsManager.getDefaultThinkingLevel() ?? this.thinkingLevel ?? DEFAULT_THINKING_LEVEL;
    }
    _clampThinkingLevel(level, _availableLevels) {
        return this.model ? clampThinkingLevel(this.model, level) : "off";
    }
    // =========================================================================
    // Queue Mode Management
    // =========================================================================
    syncQueueModesFromSettings() {
        this.agent.steeringMode = this.settingsManager.getSteeringMode();
        this.agent.followUpMode = this.settingsManager.getFollowUpMode();
    }
    /**
     * Set steering message mode.
     * Saves to settings.
     */
    setSteeringMode(mode) {
        this.agent.steeringMode = mode;
        this.settingsManager.setSteeringMode(mode);
    }
    /**
     * Set follow-up message mode.
     * Saves to settings.
     */
    setFollowUpMode(mode) {
        this.agent.followUpMode = mode;
        this.settingsManager.setFollowUpMode(mode);
    }
    // =========================================================================
    // Compaction
    // =========================================================================
    /** Generate Pi's built-in compaction summary for manual and automatic compaction. */
    async _runDefaultCompaction(preparation, requestModel, apiKey, headers, customInstructions, signal, env, reason) {
        return compact(preparation, requestModel, apiKey, headers, customInstructions, signal, this.thinkingLevel, this.agent.streamFunction, env, this.settingsManager.getRetrySettings(), this._summarizationRetryCallbacks({ source: "compaction", reason }), undefined);
    }
    /**
     * Manually compact the session context.
     *
     * This is the manual entry point used by `/compact`, RPC, and extensions. It is
     * separate from automatic threshold/overflow compaction, which enters through
     * `_checkCompaction()` and `_runAutoCompaction()`. After preparation and the
     * `session_before_compact` hook, both paths call the lower-level `compact()`
     * function imported from `./compaction/index.ts`, unless the hook cancels or
     * supplies a custom result.
     *
     * Aborts the current agent operation first. Manual compaction never retries or
     * continues the interrupted agent turn.
     *
     * @param customInstructions Optional instructions for the compaction summary
     */
    async compact(customInstructions) {
        await this.abort();
        this._compactionAbortController = new AbortController();
        this._emit({ type: "compaction_start", reason: "manual" });
        let fromExtension = false;
        try {
            if (!this.model) {
                throw new Error(formatNoModelSelectedMessage());
            }
            const { model: requestModel, apiKey, headers, env } = await this._getSummarizationRequestAuth(this.model);
            const pathEntries = this.sessionManager.getBranch();
            const settings = this.settingsManager.getCompactionSettings();
            const preparation = prepareCompaction(pathEntries, settings);
            if (!preparation) {
                // Check why we can't compact
                const lastEntry = pathEntries[pathEntries.length - 1];
                if (lastEntry?.type === "compaction") {
                    throw new Error("Already compacted");
                }
                throw new Error("Nothing to compact (session too small)");
            }
            let extensionCompaction;
            if (this._extensionRunner.hasHandlers("session_before_compact")) {
                const result = (await this._extensionRunner.emit({
                    type: "session_before_compact",
                    preparation,
                    branchEntries: pathEntries,
                    customInstructions,
                    reason: "manual",
                    willRetry: false,
                    signal: this._compactionAbortController.signal,
                }));
                if (result?.cancel) {
                    throw new Error("Compaction cancelled");
                }
                if (result?.compaction) {
                    extensionCompaction = result.compaction;
                    fromExtension = true;
                }
            }
            let summary;
            let firstKeptEntryId;
            let tokensBefore;
            let usage;
            let details;
            if (extensionCompaction) {
                // Extension provided compaction content
                summary = extensionCompaction.summary;
                firstKeptEntryId = extensionCompaction.firstKeptEntryId;
                tokensBefore = extensionCompaction.tokensBefore;
                usage = extensionCompaction.usage;
                details = extensionCompaction.details;
            }
            else {
                // Shared default summary generator, also used by automatic compaction.
                const result = await this._runDefaultCompaction(preparation, requestModel, apiKey, headers, customInstructions, this._compactionAbortController.signal, env, "manual");
                summary = result.summary;
                firstKeptEntryId = result.firstKeptEntryId;
                tokensBefore = result.tokensBefore;
                usage = result.usage;
                details = result.details;
            }
            if (this._compactionAbortController.signal.aborted) {
                throw new Error("Compaction cancelled");
            }
            this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromExtension, usage);
            const newEntries = this.sessionManager.getEntries();
            const sessionContext = this.sessionManager.buildSessionContext();
            this.agent.state.messages = sessionContext.messages;
            const estimatedTokensAfter = estimateMessagesTokens(sessionContext.messages);
            // Get the saved compaction entry for the extension event
            const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === summary);
            if (this._extensionRunner && savedCompactionEntry) {
                await this._extensionRunner.emit({
                    type: "session_compact",
                    compactionEntry: savedCompactionEntry,
                    fromExtension,
                    reason: "manual",
                    willRetry: false,
                });
            }
            const compactionResult = {
                summary,
                firstKeptEntryId,
                tokensBefore,
                estimatedTokensAfter,
                usage,
                details,
            };
            // compaction_end listeners may submit queued prompts, so expose idle state before notifying them.
            this._compactionAbortController = undefined;
            this._emit({
                type: "compaction_end",
                reason: "manual",
                result: compactionResult,
                aborted: false,
                willRetry: false,
            });
            return compactionResult;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const aborted = message === "Compaction cancelled" || (error instanceof Error && error.name === "AbortError");
            const errorMessage = aborted ? undefined : `Compaction failed: ${message}`;
            this._compactionAbortController = undefined;
            this._emit({
                type: "compaction_end",
                reason: "manual",
                result: undefined,
                aborted,
                willRetry: false,
                errorMessage,
            });
            await this._emitSessionCompactFailed({
                reason: "manual",
                errorMessage,
                aborted,
                willRetry: false,
                fromExtension,
            });
            throw error;
        }
        finally {
            this._compactionAbortController = undefined;
        }
    }
    /**
     * Cancel in-progress compaction (manual or auto).
     */
    abortCompaction() {
        this._compactionAbortController?.abort();
        this._autoCompactionAbortController?.abort();
    }
    /**
     * Cancel in-progress branch summarization.
     */
    abortBranchSummary() {
        this._branchSummaryAbortController?.abort();
    }
    /**
     * Dispatch automatic compaction after `agent_end` or before prompt submission.
     * Manual compaction does not call this method; it enters through `compact()`.
     *
     * Automatic cases:
     * 1. Overflow with retry: a context-overflow error or recoverable length stop;
     *    remove the failed assistant message, compact, and retry the turn once.
     * 2. Overflow without retry: a successful response exceeded the configured
     *    context window; compact but preserve the completed response.
     * 3. Threshold without retry: valid or estimated context usage crossed the
     *    configured threshold; compact without retrying the completed response.
     *
     * Each case calls `_runAutoCompaction()`. After preparation and the
     * `session_before_compact` hook, that method calls the lower-level `compact()`
     * function imported from `./compaction/index.ts`, unless the hook cancels or
     * supplies a custom result.
     *
     * @param assistantMessage The assistant message to check
     * @param skipAbortedCheck If false, include aborted messages (for pre-prompt check). Default: true
     * @returns Whether the post-run loop should call `agent.continue()` for overflow recovery or queued messages
     */
    async _checkCompaction(assistantMessage, skipAbortedCheck = true) {
        const settings = this.settingsManager.getCompactionSettings();
        if (!settings.enabled)
            return false;
        // Skip if message was aborted (user cancelled) - unless skipAbortedCheck is false
        if (skipAbortedCheck && assistantMessage.stopReason === "aborted")
            return false;
        const contextWindow = this.model?.contextWindow ?? 0;
        // Skip overflow check if the message came from a different model.
        // This handles the case where user switched from a smaller-context model (e.g. opus)
        // to a larger-context model (e.g. codex) - the overflow error from the old model
        // shouldn't trigger compaction for the new model.
        const sameModel = this.model && assistantMessage.provider === this.model.provider && assistantMessage.model === this.model.id;
        // Skip compaction checks if this assistant message is older than the latest
        // compaction boundary. This prevents a stale pre-compaction usage/error
        // from retriggering compaction on the first prompt after compaction.
        const compactionEntry = getLatestCompactionEntry(this.sessionManager.getBranch());
        const assistantIsFromBeforeCompaction = compactionEntry !== null && assistantMessage.timestamp <= new Date(compactionEntry.timestamp).getTime();
        if (assistantIsFromBeforeCompaction) {
            return false;
        }
        // Automatic cases 1 and 2: context overflow.
        // A length stop is recoverable when output ended below the model's original desired limit,
        // independent of the configured context size or any context-clamped provider request limit.
        const contextOverflow = sameModel && isContextOverflow(assistantMessage, contextWindow);
        const recoverableLength = sameModel && isRecoverableLength(assistantMessage, this.model?.maxTokens ?? 0);
        if (contextOverflow || recoverableLength) {
            const willRetry = assistantMessage.stopReason !== "stop";
            // Case 2: the response completed successfully. Compact, but do not retry because
            // agent.continue() cannot continue from a completed assistant response.
            if (!willRetry) {
                return await this._runAutoCompaction("overflow", false);
            }
            if (this._overflowRecoveryAttempted) {
                const errorMessage = contextOverflow
                    ? "Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model."
                    : "Truncated response recovery failed after one compact-and-retry attempt.";
                this._emit({
                    type: "compaction_end",
                    reason: "overflow",
                    result: undefined,
                    aborted: false,
                    willRetry: false,
                    errorMessage,
                });
                await this._emitSessionCompactFailed({
                    reason: "overflow",
                    errorMessage,
                    aborted: false,
                    willRetry: false,
                    fromExtension: false,
                });
                return false;
            }
            // Case 1: remove the failed or truncated message from agent state, compact, and
            // retry once. The message remains in session history but is excluded from retry context.
            this._overflowRecoveryAttempted = true;
            const messages = this.agent.state.messages;
            if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
                this.agent.state.messages = messages.slice(0, -1);
            }
            return await this._runAutoCompaction("overflow", willRetry);
        }
        // Case 3: threshold compaction without retry.
        // For error messages or all-zero usage messages, estimate from the last valid response.
        // This ensures sessions that hit persistent API errors (e.g. 529) or malformed zero-usage
        // responses can still compact and do not reset context accounting.
        let contextTokens;
        const directContextTokens = assistantMessage.usage ? calculateContextTokens(assistantMessage.usage) : 0;
        if (assistantMessage.stopReason === "error" || directContextTokens === 0) {
            const messages = this.agent.state.messages;
            const estimate = estimateContextTokens(messages);
            // Without provider usage, estimate.tokens is the pure message-size estimate.
            // Only usage-backed estimates need the stale pre-compaction check.
            if (estimate.lastUsageIndex !== null) {
                // Verify the usage source is post-compaction. Kept pre-compaction messages
                // have stale usage reflecting the old (larger) context and would falsely
                // trigger compaction right after one just finished.
                const usageMsg = messages[estimate.lastUsageIndex];
                if (compactionEntry &&
                    usageMsg.role === "assistant" &&
                    usageMsg.timestamp <= new Date(compactionEntry.timestamp).getTime()) {
                    return false;
                }
            }
            contextTokens = estimate.tokens;
        }
        else {
            contextTokens = directContextTokens;
        }
        if (shouldCompact(contextTokens, contextWindow, settings)) {
            return await this._runAutoCompaction("threshold", false);
        }
        return false;
    }
    /**
     * Execute threshold or overflow compaction. Manual compaction uses
     * `AgentSession.compact()` instead. Both paths call the lower-level `compact()`
     * function imported from `./compaction/index.ts` after preparation and extension
     * interception.
     *
     * @param reason Automatic trigger selected by `_checkCompaction()`
     * @param willRetry Whether to continue the interrupted turn after overflow compaction
     * @returns Whether the post-run loop should call `agent.continue()`
     */
    async _runAutoCompaction(reason, willRetry) {
        const settings = this.settingsManager.getCompactionSettings();
        let started = false;
        let fromExtension = false;
        try {
            if (!this.model) {
                return false;
            }
            const { model: requestModel, apiKey, headers, env } = await this._getSummarizationRequestAuth(this.model);
            const pathEntries = this.sessionManager.getBranch();
            const preparation = prepareCompaction(pathEntries, settings);
            if (!preparation) {
                return false;
            }
            this._emit({ type: "compaction_start", reason });
            this._autoCompactionAbortController = new AbortController();
            started = true;
            let extensionCompaction;
            if (this._extensionRunner.hasHandlers("session_before_compact")) {
                const extensionResult = (await this._extensionRunner.emit({
                    type: "session_before_compact",
                    preparation,
                    branchEntries: pathEntries,
                    customInstructions: undefined,
                    reason,
                    willRetry,
                    signal: this._autoCompactionAbortController.signal,
                }));
                if (extensionResult?.cancel) {
                    this._emit({
                        type: "compaction_end",
                        reason,
                        result: undefined,
                        aborted: true,
                        willRetry: false,
                    });
                    await this._emitSessionCompactFailed({
                        reason,
                        aborted: true,
                        willRetry: false,
                        fromExtension: false,
                    });
                    return false;
                }
                if (extensionResult?.compaction) {
                    extensionCompaction = extensionResult.compaction;
                    fromExtension = true;
                }
            }
            let summary;
            let firstKeptEntryId;
            let tokensBefore;
            let usage;
            let details;
            if (extensionCompaction) {
                // Extension provided compaction content
                summary = extensionCompaction.summary;
                firstKeptEntryId = extensionCompaction.firstKeptEntryId;
                tokensBefore = extensionCompaction.tokensBefore;
                usage = extensionCompaction.usage;
                details = extensionCompaction.details;
            }
            else {
                // Shared default summary generator, also used by manual compaction.
                const compactResult = await this._runDefaultCompaction(preparation, requestModel, apiKey, headers, undefined, this._autoCompactionAbortController.signal, env, reason);
                summary = compactResult.summary;
                firstKeptEntryId = compactResult.firstKeptEntryId;
                tokensBefore = compactResult.tokensBefore;
                usage = compactResult.usage;
                details = compactResult.details;
            }
            if (this._autoCompactionAbortController.signal.aborted) {
                this._emit({
                    type: "compaction_end",
                    reason,
                    result: undefined,
                    aborted: true,
                    willRetry: false,
                });
                await this._emitSessionCompactFailed({
                    reason,
                    aborted: true,
                    willRetry: false,
                    fromExtension,
                });
                return false;
            }
            this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromExtension, usage);
            const newEntries = this.sessionManager.getEntries();
            const sessionContext = this.sessionManager.buildSessionContext();
            this.agent.state.messages = sessionContext.messages;
            const estimatedTokensAfter = estimateMessagesTokens(sessionContext.messages);
            // Get the saved compaction entry for the extension event
            const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === summary);
            if (this._extensionRunner && savedCompactionEntry) {
                await this._extensionRunner.emit({
                    type: "session_compact",
                    compactionEntry: savedCompactionEntry,
                    fromExtension,
                    reason,
                    willRetry,
                });
            }
            const result = {
                summary,
                firstKeptEntryId,
                tokensBefore,
                estimatedTokensAfter,
                usage,
                details,
            };
            this._emit({ type: "compaction_end", reason, result, aborted: false, willRetry });
            if (willRetry) {
                const messages = this.agent.state.messages;
                const lastMsg = messages[messages.length - 1];
                // The overflow response was persisted on message_end before _checkCompaction() removed it
                // from agent state. Rebuilding state from the new compaction can restore that kept entry,
                // leaving an assistant as the final message. agent.continue() rejects that state, so remove
                // the retriable error or truncated-length response again before continuing the interrupted turn.
                if (lastMsg?.role === "assistant" && (lastMsg.stopReason === "error" || lastMsg.stopReason === "length")) {
                    this.agent.state.messages = messages.slice(0, -1);
                }
                return true;
            }
            // Auto-compaction can complete while follow-up/steering/custom messages are waiting.
            // Continue once so queued messages are delivered.
            return this.agent.hasQueuedMessages();
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : "compaction failed";
            if (started) {
                const formattedErrorMessage = reason === "overflow"
                    ? `Context overflow recovery failed: ${errorMessage}`
                    : `Auto-compaction failed: ${errorMessage}`;
                this._emit({
                    type: "compaction_end",
                    reason,
                    result: undefined,
                    aborted: false,
                    willRetry: false,
                    errorMessage: formattedErrorMessage,
                });
                await this._emitSessionCompactFailed({
                    reason,
                    errorMessage: formattedErrorMessage,
                    aborted: false,
                    willRetry: false,
                    fromExtension,
                });
            }
            return false;
        }
        finally {
            this._autoCompactionAbortController = undefined;
        }
    }
    /**
     * Toggle auto-compaction setting.
     */
    setAutoCompactionEnabled(enabled) {
        this.settingsManager.setCompactionEnabled(enabled);
    }
    /** Whether auto-compaction is enabled */
    get autoCompactionEnabled() {
        return this.settingsManager.getCompactionEnabled();
    }
    async bindExtensions(bindings) {
        if (bindings.uiContext !== undefined) {
            this._extensionUIContext = bindings.uiContext;
        }
        if (bindings.mode !== undefined) {
            this._extensionMode = bindings.mode;
        }
        if (bindings.commandContextActions !== undefined) {
            this._extensionCommandContextActions = bindings.commandContextActions;
        }
        if (bindings.abortHandler !== undefined) {
            this._extensionAbortHandler = bindings.abortHandler;
        }
        if (bindings.shutdownHandler !== undefined) {
            this._extensionShutdownHandler = bindings.shutdownHandler;
        }
        if (bindings.onError !== undefined) {
            this._extensionErrorListener = bindings.onError;
        }
        this._applyExtensionBindings(this._extensionRunner);
        await this._extensionRunner.emit(this._sessionStartEvent);
        await this.extendResourcesFromExtensions(this._sessionStartEvent.reason === "reload" ? "reload" : "startup");
    }
    async extendResourcesFromExtensions(reason) {
        if (!this._extensionRunner.hasHandlers("resources_discover")) {
            return;
        }
        const { skillPaths, promptPaths, themePaths } = await this._extensionRunner.emitResourcesDiscover(this._cwd, reason);
        if (skillPaths.length === 0 && promptPaths.length === 0 && themePaths.length === 0) {
            return;
        }
        const extensionPaths = {
            skillPaths: this.buildExtensionResourcePaths(skillPaths),
            promptPaths: this.buildExtensionResourcePaths(promptPaths),
            themePaths: this.buildExtensionResourcePaths(themePaths),
        };
        this._resourceLoader.extendResources(extensionPaths);
        this._baseSystemPrompt = this._rebuildSystemPrompt(this.getActiveToolNames());
        this.agent.state.systemPrompt = this._baseSystemPrompt;
    }
    buildExtensionResourcePaths(entries) {
        return entries.map((entry) => {
            const source = this.getExtensionSourceLabel(entry.extensionPath);
            const baseDir = entry.extensionPath.startsWith("<") ? undefined : dirname(entry.extensionPath);
            return {
                path: entry.path,
                metadata: {
                    source,
                    scope: "temporary",
                    origin: "top-level",
                    baseDir,
                },
            };
        });
    }
    getExtensionSourceLabel(extensionPath) {
        if (extensionPath.startsWith("<")) {
            return `extension:${extensionPath.replace(/[<>]/g, "")}`;
        }
        const base = basename(extensionPath);
        const name = base.replace(/\.(ts|js)$/, "");
        return `extension:${name}`;
    }
    _applyExtensionBindings(runner) {
        runner.setUIContext(this._extensionUIContext, this._extensionMode);
        runner.bindCommandContext(this._extensionCommandContextActions);
        this._extensionErrorUnsubscriber?.();
        this._extensionErrorUnsubscriber = this._extensionErrorListener
            ? runner.onError(this._extensionErrorListener)
            : undefined;
    }
    _refreshCurrentModelFromRegistry() {
        const currentModel = this.model;
        if (!currentModel) {
            return;
        }
        const refreshedModel = this._modelRuntime.getModel(currentModel.provider, currentModel.id);
        if (!refreshedModel || refreshedModel === currentModel) {
            return;
        }
        this.agent.state.model = refreshedModel;
    }
    _bindExtensionCore(runner) {
        const getCommands = () => {
            const extensionCommands = runner.getRegisteredCommands().map((command) => ({
                name: command.invocationName,
                description: command.description,
                source: "extension",
                sourceInfo: command.sourceInfo,
            }));
            const templates = this.promptTemplates.map((template) => ({
                name: template.name,
                description: template.description,
                source: "prompt",
                sourceInfo: template.sourceInfo,
            }));
            const skills = this._resourceLoader.getSkills().skills.map((skill) => ({
                name: `skill:${skill.name}`,
                description: skill.description,
                source: "skill",
                sourceInfo: skill.sourceInfo,
            }));
            return [...extensionCommands, ...templates, ...skills];
        };
        runner.bindCore({
            sendMessage: (message, options) => {
                this.sendCustomMessage(message, options).catch((err) => {
                    runner.emitError({
                        extensionPath: "<runtime>",
                        event: "send_message",
                        error: err instanceof Error ? err.message : String(err),
                    });
                });
            },
            sendUserMessage: (content, options) => {
                this.sendUserMessage(content, options).catch((err) => {
                    runner.emitError({
                        extensionPath: "<runtime>",
                        event: "send_user_message",
                        error: err instanceof Error ? err.message : String(err),
                    });
                });
            },
            appendEntry: (customType, data) => {
                const entryId = this.sessionManager.appendCustomEntry(customType, data);
                const entry = this.sessionManager.getEntry(entryId);
                if (entry) {
                    this._emit({ type: "entry_appended", entry });
                }
            },
            setSessionName: (name) => {
                this.setSessionName(name);
            },
            getSessionName: () => {
                return this.sessionManager.getSessionName();
            },
            setLabel: (entryId, label) => {
                this.sessionManager.appendLabelChange(entryId, label);
            },
            getActiveTools: () => this.getActiveToolNames(),
            getAllTools: () => this.getAllTools(),
            setActiveTools: (toolNames) => this.setActiveToolsByName(toolNames),
            refreshTools: () => this._refreshToolRegistry(),
            getCommands,
            setModel: async (model) => {
                if (!this._modelRuntime.hasConfiguredAuth(model.provider))
                    return false;
                await this.setModel(model);
                return true;
            },
            getThinkingLevel: () => this.thinkingLevel,
            setThinkingLevel: (level) => this.setThinkingLevel(level),
        }, {
            getModel: () => this.model,
            getScopedModels: () => this._scopedModels,
            isIdle: () => this.isIdle,
            isProjectTrusted: () => this.settingsManager.isProjectTrusted(),
            getSignal: () => this.agent.signal,
            abort: () => {
                if (this._extensionAbortHandler) {
                    this._extensionAbortHandler();
                    return;
                }
                void this.abort();
            },
            hasPendingMessages: () => this.pendingMessageCount > 0,
            shutdown: () => {
                this._extensionShutdownHandler?.();
            },
            getContextUsage: () => this.getContextUsage(),
            compact: (options) => {
                void (async () => {
                    try {
                        const result = await this.compact(options?.customInstructions);
                        options?.onComplete?.(result);
                    }
                    catch (error) {
                        const err = error instanceof Error ? error : new Error(String(error));
                        options?.onError?.(err);
                    }
                })();
            },
            getSystemPrompt: () => this.systemPrompt,
            getSystemPromptOptions: () => this._baseSystemPromptOptions,
        }, {
            registerProvider: (name, config) => {
                this._modelRuntime.registerProvider(name, config);
                this._refreshCurrentModelFromRegistry();
            },
            registerNativeProvider: (provider) => {
                this._modelRuntime.registerNativeProvider(provider);
                this._refreshCurrentModelFromRegistry();
            },
            unregisterProvider: (name) => {
                this._modelRuntime.unregisterProvider(name);
                this._refreshCurrentModelFromRegistry();
            },
        });
    }
    _refreshToolRegistry(options) {
        const previousRegistryNames = new Set(this._toolRegistry.keys());
        const previousActiveToolNames = this.getActiveToolNames();
        const allowedToolNames = this._allowedToolNames;
        const excludedToolNames = this._excludedToolNames;
        const isAllowedTool = (name) => (!allowedToolNames || allowedToolNames.has(name)) && !excludedToolNames?.has(name);
        const registeredTools = this._extensionRunner.getAllRegisteredTools();
        const allCustomTools = [
            ...registeredTools,
            ...this._customTools.map((definition) => ({
                definition,
                sourceInfo: createSyntheticSourceInfo(`<sdk:${definition.name}>`, { source: "sdk" }),
            })),
        ].filter((tool) => isAllowedTool(tool.definition.name));
        const definitionRegistry = new Map(Array.from(this._baseToolDefinitions.entries())
            .filter(([name]) => isAllowedTool(name))
            .map(([name, definition]) => [
            name,
            {
                definition,
                sourceInfo: createSyntheticSourceInfo(`<builtin:${name}>`, { source: "builtin" }),
            },
        ]));
        for (const tool of allCustomTools) {
            definitionRegistry.set(tool.definition.name, {
                definition: tool.definition,
                sourceInfo: tool.sourceInfo,
            });
        }
        this._toolDefinitions = definitionRegistry;
        this._toolPromptSnippets = new Map(Array.from(definitionRegistry.values())
            .map(({ definition }) => {
            const snippet = this._normalizePromptSnippet(definition.promptSnippet);
            return snippet ? [definition.name, snippet] : undefined;
        })
            .filter((entry) => entry !== undefined));
        this._toolPromptGuidelines = new Map(Array.from(definitionRegistry.values())
            .map(({ definition }) => {
            const guidelines = this._normalizePromptGuidelines(definition.promptGuidelines);
            return guidelines.length > 0 ? [definition.name, guidelines] : undefined;
        })
            .filter((entry) => entry !== undefined));
        const runner = this._extensionRunner;
        const wrappedExtensionTools = wrapRegisteredTools(allCustomTools, runner);
        const wrappedBuiltInTools = wrapRegisteredTools(Array.from(this._baseToolDefinitions.values())
            .filter((definition) => isAllowedTool(definition.name))
            .map((definition) => ({
            definition,
            sourceInfo: createSyntheticSourceInfo(`<builtin:${definition.name}>`, { source: "builtin" }),
        })), runner);
        const toolRegistry = new Map(wrappedBuiltInTools.map((tool) => [tool.name, tool]));
        for (const tool of wrappedExtensionTools) {
            toolRegistry.set(tool.name, tool);
        }
        this._toolRegistry = toolRegistry;
        const nextActiveToolNames = (options?.activeToolNames ? [...options.activeToolNames] : [...previousActiveToolNames]).filter((name) => isAllowedTool(name));
        if (allowedToolNames) {
            for (const toolName of this._toolRegistry.keys()) {
                if (allowedToolNames.has(toolName)) {
                    nextActiveToolNames.push(toolName);
                }
            }
        }
        else if (options?.includeAllExtensionTools) {
            for (const tool of wrappedExtensionTools) {
                nextActiveToolNames.push(tool.name);
            }
        }
        else if (!options?.activeToolNames) {
            for (const toolName of this._toolRegistry.keys()) {
                if (!previousRegistryNames.has(toolName)) {
                    nextActiveToolNames.push(toolName);
                }
            }
        }
        this.setActiveToolsByName([...new Set(nextActiveToolNames)]);
    }
    _buildRuntime(options) {
        const autoResizeImages = this.settingsManager.getImageAutoResize();
        const shellCommandPrefix = this.settingsManager.getShellCommandPrefix();
        const shellPath = this.settingsManager.getShellPath();
        const baseToolDefinitions = this._baseToolsOverride
            ? Object.fromEntries(Object.entries(this._baseToolsOverride).map(([name, tool]) => [
                name,
                createToolDefinitionFromAgentTool(tool),
            ]))
            : createAllToolDefinitions(this._cwd, {
                read: { autoResizeImages },
                bash: { commandPrefix: shellCommandPrefix, shellPath },
            });
        this._baseToolDefinitions = new Map(Object.entries(baseToolDefinitions).map(([name, tool]) => [name, tool]));
        const extensionsResult = this._resourceLoader.getExtensions();
        if (options.flagValues) {
            for (const [name, value] of options.flagValues) {
                extensionsResult.runtime.flagValues.set(name, value);
            }
        }
        this._extensionRunner = new ExtensionRunner(extensionsResult.extensions, extensionsResult.runtime, this._cwd, this.sessionManager, new ModelRegistry(this._modelRuntime));
        if (this._extensionRunnerRef) {
            this._extensionRunnerRef.current = this._extensionRunner;
        }
        this._bindExtensionCore(this._extensionRunner);
        this._applyExtensionBindings(this._extensionRunner);
        const defaultActiveToolNames = this._baseToolsOverride
            ? Object.keys(this._baseToolsOverride)
            : ["read", "bash", "edit", "write"];
        const baseActiveToolNames = options.activeToolNames ?? defaultActiveToolNames;
        this._refreshToolRegistry({
            activeToolNames: baseActiveToolNames,
            includeAllExtensionTools: options.includeAllExtensionTools,
        });
    }
    async reload(options) {
        const oldRunner = this._extensionRunner;
        const previousFlagValues = oldRunner.getFlagValues();
        await emitSessionShutdownEvent(oldRunner, { type: "session_shutdown", reason: "reload" });
        oldRunner.invalidate();
        await this.settingsManager.reload();
        this.syncQueueModesFromSettings();
        resetApiProviders();
        await this._resourceLoader.reload();
        this._buildRuntime({
            activeToolNames: this.getActiveToolNames(),
            flagValues: previousFlagValues,
            includeAllExtensionTools: true,
        });
        const hasBindings = this._extensionUIContext ||
            this._extensionCommandContextActions ||
            this._extensionShutdownHandler ||
            this._extensionErrorListener;
        if (hasBindings) {
            await options?.beforeSessionStart?.();
            await this._extensionRunner.emit({ type: "session_start", reason: "reload" });
            await this.extendResourcesFromExtensions("reload");
        }
    }
    // =========================================================================
    // Auto-Retry
    // =========================================================================
    /**
     * Check if an error is retryable (overloaded, rate limit, server errors).
     * Context overflow errors are NOT retryable (handled by compaction instead).
     */
    _isRetryableError(message) {
        // Context overflow is handled by compaction, not retry.
        if (isContextOverflow(message, this.model?.contextWindow ?? 0))
            return false;
        return isRetryableAssistantError(message);
    }
    /**
     * Retry policy + callbacks shared by compaction and branch-summary summarization calls.
     * Uses the same `settings.retry` budget/backoff as agent-turn retries so a single transient
     * stream drop no longer fails the whole operation. `source` carries the context
     * the TUI needs to render the retry and recreate the underlying indicator.
     */
    _summarizationRetryCallbacks(source) {
        return {
            onRetryScheduled: (attempt, maxAttempts, delayMs, errorMessage) => {
                this._emit({
                    type: "summarization_retry_scheduled",
                    attempt,
                    maxAttempts,
                    delayMs,
                    errorMessage,
                });
            },
            onRetryAttemptStart: () => {
                this._emit({
                    type: "summarization_retry_attempt_start",
                    ...source,
                });
            },
            onRetryFinished: () => {
                this._emit({ type: "summarization_retry_finished" });
            },
        };
    }
    /**
     * Prepare a retryable error for continuation with exponential backoff.
     * @returns true if the caller should continue the agent, false otherwise
     */
    async _prepareRetry(message) {
        const settings = this.settingsManager.getRetrySettings();
        if (!settings.enabled) {
            return false;
        }
        this._retryAttempt++;
        if (this._retryAttempt > settings.maxRetries) {
            // Preserve the completed attempt count so post-run handling can emit the final failure.
            this._retryAttempt--;
            return false;
        }
        const delayMs = settings.baseDelayMs * 2 ** (this._retryAttempt - 1);
        this._emit({
            type: "auto_retry_start",
            attempt: this._retryAttempt,
            maxAttempts: settings.maxRetries,
            delayMs,
            errorMessage: message.errorMessage || "Unknown error",
        });
        // Remove error message from agent state (keep in session for history)
        const messages = this.agent.state.messages;
        if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
            this._transientMessages.delete(messages[messages.length - 1]);
            this.agent.state.messages = messages.slice(0, -1);
        }
        // Wait with exponential backoff (abortable)
        this._retryAbortController = new AbortController();
        try {
            await sleep(delayMs, this._retryAbortController.signal);
        }
        catch {
            // Aborted during sleep - emit end event so UI can clean up
            const attempt = this._retryAttempt;
            this._retryAttempt = 0;
            this._emit({
                type: "auto_retry_end",
                success: false,
                attempt,
                finalError: "Retry cancelled",
            });
            return false;
        }
        finally {
            this._retryAbortController = undefined;
        }
        return true;
    }
    /**
     * Cancel in-progress retry.
     */
    abortRetry() {
        this._retryAbortController?.abort();
    }
    /** Whether auto-retry is currently in progress */
    get isRetrying() {
        return this._retryAbortController !== undefined;
    }
    /** Whether auto-retry is enabled */
    get autoRetryEnabled() {
        return this.settingsManager.getRetryEnabled();
    }
    /**
     * Toggle auto-retry setting.
     */
    setAutoRetryEnabled(enabled) {
        this.settingsManager.setRetryEnabled(enabled);
    }
    // =========================================================================
    // Bash Execution
    // =========================================================================
    /**
     * Execute a bash command.
     * Adds result to agent context and session.
     * @param command The bash command to execute
     * @param onChunk Optional streaming callback for output
     * @param options.excludeFromContext If true, command output won't be sent to LLM (!! prefix)
     * @param options.id Optional identifier included in bash execution update events
     * @param options.operations Custom BashOperations for remote execution
     */
    async executeBash(command, onChunk, options) {
        const abortController = new AbortController();
        this._bashAbortControllers.add(abortController);
        // Apply command prefix if configured (e.g., "shopt -s expand_aliases" for alias support)
        const prefix = this.settingsManager.getShellCommandPrefix();
        const shellPath = this.settingsManager.getShellPath();
        const resolvedCommand = prefix ? `${prefix}\n${command}` : command;
        try {
            const result = await executeBashWithOperations(resolvedCommand, this.sessionManager.getCwd(), options?.operations ?? createLocalBashOperations({ shellPath }), {
                onChunk: (delta) => {
                    onChunk?.(delta);
                    this._emit({ type: "bash_execution_update", id: options?.id, delta });
                },
                signal: abortController.signal,
            });
            this.recordBashResult(command, result, options);
            return result;
        }
        finally {
            this._bashAbortControllers.delete(abortController);
        }
    }
    /**
     * Record a bash execution result in session history.
     * Used by executeBash and by extensions that handle bash execution themselves.
     */
    recordBashResult(command, result, options) {
        const bashMessage = {
            role: "bashExecution",
            command,
            output: result.output,
            exitCode: result.exitCode,
            cancelled: result.cancelled,
            truncated: result.truncated,
            fullOutputPath: result.fullOutputPath,
            timestamp: Date.now(),
            excludeFromContext: options?.excludeFromContext,
        };
        // If agent is streaming, defer adding to avoid breaking tool_use/tool_result ordering
        if (this.isStreaming) {
            // Queue for later - will be flushed on agent_end
            this._pendingBashMessages.push(bashMessage);
        }
        else {
            // Add to agent state immediately
            this.agent.state.messages.push(bashMessage);
            // Save to session
            this.sessionManager.appendMessage(bashMessage);
        }
    }
    /**
     * Cancel running bash command.
     */
    abortBash() {
        for (const abortController of [...this._bashAbortControllers]) {
            abortController.abort();
        }
    }
    /** Whether a bash command is currently running */
    get isBashRunning() {
        return this._bashAbortControllers.size > 0;
    }
    /** Whether there are pending bash messages waiting to be flushed */
    get hasPendingBashMessages() {
        return this._pendingBashMessages.length > 0;
    }
    /**
     * Flush pending bash messages to agent state and session.
     * Called after agent turn completes to maintain proper message ordering.
     */
    _flushPendingBashMessages() {
        if (this._pendingBashMessages.length === 0)
            return;
        for (const bashMessage of this._pendingBashMessages) {
            // Add to agent state
            this.agent.state.messages.push(bashMessage);
            // Save to session
            this.sessionManager.appendMessage(bashMessage);
        }
        this._pendingBashMessages = [];
    }
    // =========================================================================
    // Session Management
    // =========================================================================
    /**
     * Set a display name for the current session.
     */
    setSessionName(name) {
        this.sessionManager.appendSessionInfo(name);
        const event = { type: "session_info_changed", name: this.sessionManager.getSessionName() };
        this._emit(event);
        void this._extensionRunner.emit(event);
    }
    // =========================================================================
    // Tree Navigation
    // =========================================================================
    /**
     * Navigate to a different node in the session tree.
     * Unlike fork() which creates a new session file, this stays in the same file.
     *
     * @param targetId The entry ID to navigate to
     * @param options.summarize Whether user wants to summarize abandoned branch
     * @param options.customInstructions Custom instructions for summarizer
     * @param options.replaceInstructions If true, customInstructions replaces the default prompt
     * @param options.label Label to attach to the branch summary entry
     * @returns Result with editorText (if user message) and cancelled status
     */
    async navigateTree(targetId, options = {}) {
        if (this.isStreaming) {
            throw new Error("Wait for the current response to finish before navigating the session tree.");
        }
        const oldLeafId = this.sessionManager.getLeafId();
        // No-op if already at target
        if (targetId === oldLeafId) {
            return { cancelled: false };
        }
        // Model required for summarization
        if (options.summarize && !this.model) {
            throw new Error("No model available for summarization");
        }
        const targetEntry = this.sessionManager.getEntry(targetId);
        if (!targetEntry) {
            throw new Error(`Entry ${targetId} not found`);
        }
        // Collect entries to summarize (from old leaf to common ancestor)
        const { entries: entriesToSummarize, commonAncestorId } = collectEntriesForBranchSummary(this.sessionManager, oldLeafId, targetId);
        // Prepare event data - mutable so extensions can override
        let customInstructions = options.customInstructions;
        let replaceInstructions = options.replaceInstructions;
        let label = options.label;
        const preparation = {
            targetId,
            oldLeafId,
            commonAncestorId,
            entriesToSummarize,
            userWantsSummary: options.summarize ?? false,
            customInstructions,
            replaceInstructions,
            label,
        };
        // Set up abort controller for summarization
        this._branchSummaryAbortController = new AbortController();
        try {
            let extensionSummary;
            let fromExtension = false;
            // Emit session_before_tree event
            if (this._extensionRunner.hasHandlers("session_before_tree")) {
                const result = (await this._extensionRunner.emit({
                    type: "session_before_tree",
                    preparation,
                    signal: this._branchSummaryAbortController.signal,
                }));
                if (result?.cancel) {
                    return { cancelled: true };
                }
                if (result?.summary && options.summarize) {
                    extensionSummary = result.summary;
                    fromExtension = true;
                }
                // Allow extensions to override instructions and label
                if (result?.customInstructions !== undefined) {
                    customInstructions = result.customInstructions;
                }
                if (result?.replaceInstructions !== undefined) {
                    replaceInstructions = result.replaceInstructions;
                }
                if (result?.label !== undefined) {
                    label = result.label;
                }
            }
            // Run default summarizer if needed
            let summaryText;
            let summaryDetails;
            let summaryUsage;
            if (options.summarize && entriesToSummarize.length > 0 && !extensionSummary) {
                const model = this.model;
                const { model: requestModel, apiKey, headers, env } = await this._getSummarizationRequestAuth(model);
                const branchSummarySettings = this.settingsManager.getBranchSummarySettings();
                const result = await generateBranchSummary(entriesToSummarize, {
                    model: requestModel,
                    apiKey,
                    headers,
                    env,
                    signal: this._branchSummaryAbortController.signal,
                    customInstructions,
                    replaceInstructions,
                    reserveTokens: branchSummarySettings.reserveTokens,
                    streamFn: this.agent.streamFunction,
                    retry: this.settingsManager.getRetrySettings(),
                    callbacks: this._summarizationRetryCallbacks({ source: "branchSummary" }),
                });
                if (result.aborted) {
                    return { cancelled: true, aborted: true };
                }
                if (result.error) {
                    throw new Error(result.error);
                }
                summaryText = result.summary;
                summaryUsage = result.usage;
                summaryDetails = {
                    readFiles: result.readFiles || [],
                    modifiedFiles: result.modifiedFiles || [],
                };
            }
            else if (extensionSummary) {
                summaryText = extensionSummary.summary;
                summaryDetails = extensionSummary.details;
                summaryUsage = extensionSummary.usage;
            }
            // Determine the new leaf position based on target type
            let newLeafId;
            let editorText;
            if (targetEntry.type === "message" && targetEntry.message.role === "user") {
                // User message: leaf = parent (null if root), text goes to editor
                newLeafId = targetEntry.parentId;
                editorText = contentText(targetEntry.message.content, "");
            }
            else if (targetEntry.type === "custom_message") {
                // Custom message: leaf = parent (null if root), text goes to editor
                newLeafId = targetEntry.parentId;
                editorText = contentText(targetEntry.content, "");
            }
            else {
                // Non-user message: leaf = selected node
                newLeafId = targetId;
            }
            // Switch leaf (with or without summary)
            // Summary is attached at the navigation target position (newLeafId), not the old branch
            let summaryEntry;
            if (summaryText) {
                // Create summary at target position (can be null for root)
                const summaryId = this.sessionManager.branchWithSummary(newLeafId, summaryText, summaryDetails, fromExtension, summaryUsage);
                summaryEntry = this.sessionManager.getEntry(summaryId);
                // Attach label to the summary entry
                if (label) {
                    this.sessionManager.appendLabelChange(summaryId, label);
                }
            }
            else if (newLeafId === null) {
                // No summary, navigating to root - reset leaf
                this.sessionManager.resetLeaf();
            }
            else {
                // No summary, navigating to non-root
                this.sessionManager.branch(newLeafId);
            }
            // Attach label to target entry when not summarizing (no summary entry to label)
            if (label && !summaryText) {
                this.sessionManager.appendLabelChange(targetId, label);
            }
            // Update agent state
            const sessionContext = this.sessionManager.buildSessionContext();
            this.agent.state.messages = sessionContext.messages;
            // Emit session_tree event
            await this._extensionRunner.emit({
                type: "session_tree",
                newLeafId: this.sessionManager.getLeafId(),
                oldLeafId,
                summaryEntry,
                fromExtension: summaryText ? fromExtension : undefined,
            });
            // Emit to custom tools
            return { editorText, cancelled: false, summaryEntry };
        }
        finally {
            this._branchSummaryAbortController = undefined;
        }
    }
    /**
     * Get all user messages from session for fork selector.
     */
    getUserMessagesForForking() {
        const entries = this.sessionManager.getEntries();
        const result = [];
        for (const entry of entries) {
            if (entry.type !== "message")
                continue;
            if (entry.message.role !== "user")
                continue;
            const text = contentText(entry.message.content, "");
            if (text) {
                result.push({ entryId: entry.id, text });
            }
        }
        return result;
    }
    /**
     * Get session statistics. Aggregates over ALL session entries (including
     * history that was compacted away), so token/cost totals reflect what was
     * actually billed across the session.
     */
    getSessionStats() {
        let userMessages = 0;
        let assistantMessages = 0;
        let toolResults = 0;
        let totalMessages = 0;
        let toolCalls = 0;
        const usageTotals = createUsageTotals();
        for (const entry of this.sessionManager.getEntries()) {
            if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
                addUsageToTotals(usageTotals, entry.usage);
            }
            if (entry.type !== "message")
                continue;
            totalMessages++;
            const message = entry.message;
            if (message.role === "user") {
                userMessages++;
            }
            else if (message.role === "toolResult") {
                toolResults++;
                if (message.usage) {
                    addUsageToTotals(usageTotals, message.usage);
                }
            }
            else if (message.role === "assistant") {
                assistantMessages++;
                const assistantMsg = message;
                if (Array.isArray(assistantMsg.content)) {
                    toolCalls += assistantMsg.content.filter((c) => c.type === "toolCall").length;
                }
                addUsageToTotals(usageTotals, assistantMsg.usage);
            }
        }
        return {
            sessionFile: this.sessionFile,
            sessionId: this.sessionId,
            userMessages,
            assistantMessages,
            toolCalls,
            toolResults,
            totalMessages,
            tokens: {
                input: usageTotals.input,
                output: usageTotals.output,
                cacheRead: usageTotals.cacheRead,
                cacheWrite: usageTotals.cacheWrite,
                total: usageTotals.input + usageTotals.output + usageTotals.cacheRead + usageTotals.cacheWrite,
            },
            cost: usageTotals.cost,
            contextUsage: this.getContextUsage(),
        };
    }
    getContextUsage() {
        const model = this.model;
        if (!model)
            return undefined;
        const contextWindow = model.contextWindow ?? 0;
        if (contextWindow <= 0)
            return undefined;
        // After compaction, the last assistant usage reflects pre-compaction context size.
        // We can only trust usage from an assistant that responded after the latest compaction.
        // If no such assistant exists, context token count is unknown until the next LLM response.
        const branchEntries = this.sessionManager.getBranch();
        const latestCompaction = getLatestCompactionEntry(branchEntries);
        if (latestCompaction) {
            // Check if there's a valid assistant usage after the compaction boundary
            const compactionIndex = branchEntries.lastIndexOf(latestCompaction);
            let hasPostCompactionUsage = false;
            for (let i = branchEntries.length - 1; i > compactionIndex; i--) {
                const entry = branchEntries[i];
                if (entry.type === "message" && entry.message.role === "assistant") {
                    const assistant = entry.message;
                    if (assistant.stopReason !== "aborted" && assistant.stopReason !== "error") {
                        const contextTokens = calculateContextTokens(assistant.usage);
                        if (contextTokens > 0) {
                            hasPostCompactionUsage = true;
                            break;
                        }
                    }
                }
            }
            if (!hasPostCompactionUsage) {
                return { tokens: null, contextWindow, percent: null };
            }
        }
        const estimate = estimateContextTokens(this.messages);
        const percent = (estimate.tokens / contextWindow) * 100;
        return {
            tokens: estimate.tokens,
            contextWindow,
            percent,
        };
    }
    /**
     * Export session to HTML.
     * @param outputPath Optional output path (defaults to session directory)
     * @param options Optional export presentation settings
     * @returns Path to exported file
     */
    async exportToHtml(outputPath, options = {}) {
        const themeName = [options.themeName, this.settingsManager.getTheme()].find((candidate) => candidate !== undefined && getThemeByName(candidate) !== undefined);
        // Create tool renderer if we have an extension runner (for custom tool HTML rendering)
        const toolRenderer = createToolHtmlRenderer({
            getToolDefinition: (name) => this.getToolDefinition(name),
            theme,
            cwd: this.sessionManager.getCwd(),
        });
        return await exportSessionToHtml(this.sessionManager, this.state, {
            outputPath,
            themeName,
            toolRenderer,
        });
    }
    /**
     * Export the current session branch to a JSONL file.
     * Writes the session header followed by all entries on the current branch path.
     * @param outputPath Target file path. If omitted, generates a timestamped file in cwd.
     * @returns The resolved output file path.
     */
    exportToJsonl(outputPath) {
        return exportSessionToJsonl(this.sessionManager, outputPath);
    }
    // =========================================================================
    // Utilities
    // =========================================================================
    /**
     * Get text content of last assistant message.
     * Useful for /copy command.
     * @returns Text content, or undefined if no assistant message exists
     */
    getLastAssistantText() {
        const lastAssistant = this.messages
            .slice()
            .reverse()
            .find((m) => {
            if (m.role !== "assistant")
                return false;
            const msg = m;
            // Skip aborted messages with no content
            if (msg.stopReason === "aborted" && msg.content.length === 0)
                return false;
            return true;
        });
        if (!lastAssistant)
            return undefined;
        let text = "";
        for (const content of lastAssistant.content) {
            if (content.type === "text") {
                text += content.text;
            }
        }
        return text.trim() || undefined;
    }
    // =========================================================================
    // Extension System
    // =========================================================================
    createReplacedSessionContext() {
        const context = Object.defineProperties({}, Object.getOwnPropertyDescriptors(this._extensionRunner.createCommandContext()));
        context.sendMessage = (message, options) => this.sendCustomMessage(message, options);
        context.sendUserMessage = (content, options) => this.sendUserMessage(content, options);
        return context;
    }
    /**
     * Check if extensions have handlers for a specific event type.
     */
    hasExtensionHandlers(eventType) {
        return this._extensionRunner.hasHandlers(eventType);
    }
    /**
     * Get the extension runner (for setting UI context and error handlers).
     */
    get extensionRunner() {
        return this._extensionRunner;
    }
}
//# sourceMappingURL=agent-session.js.map