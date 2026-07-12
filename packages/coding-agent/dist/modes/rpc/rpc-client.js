/**
 * RPC Client for programmatic access to the coding agent.
 *
 * Spawns the agent in RPC mode and provides a typed API for all operations.
 */
import { spawn } from "node:child_process";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.js";
// ============================================================================
// RPC Client
// ============================================================================
export class RpcClient {
    process = null;
    stopReadingStdout = null;
    eventListeners = [];
    pendingRequests = new Map();
    requestId = 0;
    stderr = "";
    exitError = null;
    options;
    constructor(options = {}) {
        this.options = options;
    }
    /**
     * Start the RPC agent process.
     */
    async start() {
        if (this.process) {
            throw new Error("Client already started");
        }
        this.exitError = null;
        const cliPath = this.options.cliPath ?? "dist/cli.js";
        const args = ["--mode", "rpc"];
        if (this.options.provider) {
            args.push("--provider", this.options.provider);
        }
        if (this.options.model) {
            args.push("--model", this.options.model);
        }
        if (this.options.args) {
            args.push(...this.options.args);
        }
        const childProcess = spawn("node", [cliPath, ...args], {
            cwd: this.options.cwd,
            env: { ...process.env, ...this.options.env },
            stdio: ["pipe", "pipe", "pipe"],
        });
        this.process = childProcess;
        // Collect stderr for debugging
        childProcess.stderr?.on("data", (data) => {
            this.stderr += data.toString();
            process.stderr.write(data);
        });
        childProcess.once("exit", (code, signal) => {
            if (this.process !== childProcess)
                return;
            const error = this.createProcessExitError(code, signal);
            this.exitError = error;
            this.rejectPendingRequests(error);
        });
        childProcess.once("error", (error) => {
            if (this.process !== childProcess)
                return;
            const processError = new Error(`Agent process error: ${error.message}. Stderr: ${this.stderr}`);
            this.exitError = processError;
            this.rejectPendingRequests(processError);
        });
        childProcess.stdin?.on("error", (error) => {
            if (this.process !== childProcess)
                return;
            const stdinError = this.exitError ?? new Error(`Agent process stdin error: ${error.message}. Stderr: ${this.stderr}`);
            this.exitError = stdinError;
            this.rejectPendingRequests(stdinError);
        });
        // Set up strict JSONL reader for stdout.
        this.stopReadingStdout = attachJsonlLineReader(childProcess.stdout, (line) => {
            this.handleLine(line);
        });
        // Wait a moment for process to initialize
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (this.process.exitCode !== null) {
            const error = this.exitError ?? this.createProcessExitError(this.process.exitCode, this.process.signalCode);
            this.exitError = error;
            throw error;
        }
    }
    /**
     * Stop the RPC agent process.
     */
    async stop() {
        if (!this.process)
            return;
        this.stopReadingStdout?.();
        this.stopReadingStdout = null;
        this.process.kill("SIGTERM");
        // Wait for process to exit
        await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.process?.kill("SIGKILL");
                resolve();
            }, 1000);
            this.process?.on("exit", () => {
                clearTimeout(timeout);
                resolve();
            });
        });
        this.process = null;
        this.pendingRequests.clear();
    }
    /**
     * Subscribe to agent events.
     */
    onEvent(listener) {
        this.eventListeners.push(listener);
        return () => {
            const index = this.eventListeners.indexOf(listener);
            if (index !== -1) {
                this.eventListeners.splice(index, 1);
            }
        };
    }
    /**
     * Get collected stderr output (useful for debugging).
     */
    getStderr() {
        return this.stderr;
    }
    // =========================================================================
    // Command Methods
    // =========================================================================
    /**
     * Send a prompt to the agent.
     * Returns immediately after sending; use onEvent() to receive streaming events.
     * Use waitForIdle() to wait for completion.
     */
    async prompt(message, images) {
        await this.send({ type: "prompt", message, images });
    }
    /**
     * Queue a steering message to interrupt the agent mid-run.
     */
    async steer(message, images) {
        await this.send({ type: "steer", message, images });
    }
    /**
     * Queue a follow-up message to be processed after the agent finishes.
     */
    async followUp(message, images) {
        await this.send({ type: "follow_up", message, images });
    }
    /**
     * Abort current operation.
     */
    async abort() {
        await this.send({ type: "abort" });
    }
    /**
     * Start a new session, optionally with parent tracking.
     * @param parentSession - Optional parent session path for lineage tracking
     * @returns Object with `cancelled: true` if an extension cancelled the new session
     */
    async newSession(parentSession) {
        const response = await this.send({ type: "new_session", parentSession });
        return this.getData(response);
    }
    /**
     * Get current session state.
     */
    async getState() {
        const response = await this.send({ type: "get_state" });
        return this.getData(response);
    }
    /**
     * Set model by provider and ID.
     */
    async setModel(provider, modelId) {
        const response = await this.send({ type: "set_model", provider, modelId });
        return this.getData(response);
    }
    /**
     * Cycle to next model.
     */
    async cycleModel() {
        const response = await this.send({ type: "cycle_model" });
        return this.getData(response);
    }
    /**
     * Get list of available models.
     */
    async getAvailableModels() {
        const response = await this.send({ type: "get_available_models" });
        return this.getData(response).models;
    }
    /**
     * Set thinking level.
     */
    async setThinkingLevel(level) {
        await this.send({ type: "set_thinking_level", level });
    }
    /**
     * Cycle thinking level.
     */
    async cycleThinkingLevel() {
        const response = await this.send({ type: "cycle_thinking_level" });
        return this.getData(response);
    }
    /**
     * Set steering mode.
     */
    async setSteeringMode(mode) {
        await this.send({ type: "set_steering_mode", mode });
    }
    /**
     * Set follow-up mode.
     */
    async setFollowUpMode(mode) {
        await this.send({ type: "set_follow_up_mode", mode });
    }
    /**
     * Compact session context.
     */
    async compact(customInstructions) {
        const response = await this.send({ type: "compact", customInstructions });
        return this.getData(response);
    }
    /**
     * Set auto-compaction enabled/disabled.
     */
    async setAutoCompaction(enabled) {
        await this.send({ type: "set_auto_compaction", enabled });
    }
    /**
     * Set auto-retry enabled/disabled.
     */
    async setAutoRetry(enabled) {
        await this.send({ type: "set_auto_retry", enabled });
    }
    /**
     * Abort in-progress retry.
     */
    async abortRetry() {
        await this.send({ type: "abort_retry" });
    }
    /**
     * Execute a bash command.
     */
    async bash(command) {
        const response = await this.send({ type: "bash", command });
        return this.getData(response);
    }
    /**
     * Abort running bash command.
     */
    async abortBash() {
        await this.send({ type: "abort_bash" });
    }
    /**
     * Get session statistics.
     */
    async getSessionStats() {
        const response = await this.send({ type: "get_session_stats" });
        return this.getData(response);
    }
    /**
     * Export session to HTML.
     */
    async exportHtml(outputPath) {
        const response = await this.send({ type: "export_html", outputPath });
        return this.getData(response);
    }
    /**
     * Switch to a different session file.
     * @returns Object with `cancelled: true` if an extension cancelled the switch
     */
    async switchSession(sessionPath) {
        const response = await this.send({ type: "switch_session", sessionPath });
        return this.getData(response);
    }
    /**
     * Fork from a specific message.
     * @returns Object with `text` (the message text) and `cancelled` (if extension cancelled)
     */
    async fork(entryId) {
        const response = await this.send({ type: "fork", entryId });
        return this.getData(response);
    }
    /**
     * Clone the current active branch into a new session.
     * @returns Object with `cancelled: true` if an extension cancelled the clone
     */
    async clone() {
        const response = await this.send({ type: "clone" });
        return this.getData(response);
    }
    /**
     * Get messages available for forking.
     */
    async getForkMessages() {
        const response = await this.send({ type: "get_fork_messages" });
        return this.getData(response).messages;
    }
    /**
     * Get session entries in append order, optionally only those after the `since` entry id.
     */
    async getEntries(since) {
        const response = await this.send({ type: "get_entries", since });
        return this.getData(response);
    }
    /**
     * Get the session entry tree.
     */
    async getTree() {
        const response = await this.send({ type: "get_tree" });
        return this.getData(response);
    }
    /**
     * Get text of last assistant message.
     */
    async getLastAssistantText() {
        const response = await this.send({ type: "get_last_assistant_text" });
        return this.getData(response).text;
    }
    /**
     * Set the session display name.
     */
    async setSessionName(name) {
        await this.send({ type: "set_session_name", name });
    }
    /**
     * Get all messages in the session.
     */
    async getMessages() {
        const response = await this.send({ type: "get_messages" });
        return this.getData(response).messages;
    }
    /**
     * Get available commands (extension commands, prompt templates, skills).
     */
    async getCommands() {
        const response = await this.send({ type: "get_commands" });
        return this.getData(response).commands;
    }
    // =========================================================================
    // Helpers
    // =========================================================================
    /**
     * Wait for agent to become idle (no streaming).
     * Resolves when agent_end event is received.
     */
    waitForIdle(timeout = 60000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                unsubscribe();
                reject(new Error(`Timeout waiting for agent to become idle. Stderr: ${this.stderr}`));
            }, timeout);
            const unsubscribe = this.onEvent((event) => {
                if (event.type === "agent_end") {
                    clearTimeout(timer);
                    unsubscribe();
                    resolve();
                }
            });
        });
    }
    /**
     * Collect events until agent becomes idle.
     */
    collectEvents(timeout = 60000) {
        return new Promise((resolve, reject) => {
            const events = [];
            const timer = setTimeout(() => {
                unsubscribe();
                reject(new Error(`Timeout collecting events. Stderr: ${this.stderr}`));
            }, timeout);
            const unsubscribe = this.onEvent((event) => {
                events.push(event);
                if (event.type === "agent_end") {
                    clearTimeout(timer);
                    unsubscribe();
                    resolve(events);
                }
            });
        });
    }
    /**
     * Send prompt and wait for completion, returning all events.
     */
    async promptAndWait(message, images, timeout = 60000) {
        const eventsPromise = this.collectEvents(timeout);
        await this.prompt(message, images);
        return eventsPromise;
    }
    // =========================================================================
    // Internal
    // =========================================================================
    handleLine(line) {
        try {
            const data = JSON.parse(line);
            // Check if it's a response to a pending request
            if (data.type === "response" && data.id && this.pendingRequests.has(data.id)) {
                const pending = this.pendingRequests.get(data.id);
                this.pendingRequests.delete(data.id);
                pending.resolve(data);
                return;
            }
            // Otherwise it's an event
            for (const listener of this.eventListeners) {
                listener(data);
            }
        }
        catch {
            // Ignore non-JSON lines
        }
    }
    createProcessExitError(code, signal) {
        return new Error(`Agent process exited (code=${code} signal=${signal}). Stderr: ${this.stderr}`);
    }
    rejectPendingRequests(error) {
        for (const pending of this.pendingRequests.values()) {
            pending.reject(error);
        }
        this.pendingRequests.clear();
    }
    async send(command) {
        const childProcess = this.process;
        const stdin = childProcess?.stdin;
        if (!childProcess || !stdin) {
            throw new Error("Client not started");
        }
        if (this.exitError) {
            throw this.exitError;
        }
        if (childProcess.exitCode !== null) {
            const error = this.createProcessExitError(childProcess.exitCode, childProcess.signalCode);
            this.exitError = error;
            throw error;
        }
        if (stdin.destroyed || !stdin.writable) {
            const error = new Error(`Agent process stdin is not writable. Stderr: ${this.stderr}`);
            this.exitError = error;
            throw error;
        }
        const id = `req_${++this.requestId}`;
        const fullCommand = { ...command, id };
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Timeout waiting for response to ${command.type}. Stderr: ${this.stderr}`));
            }, 30000);
            this.pendingRequests.set(id, {
                resolve: (response) => {
                    clearTimeout(timeout);
                    resolve(response);
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                },
            });
            try {
                stdin.write(serializeJsonLine(fullCommand));
            }
            catch (error) {
                const writeError = error instanceof Error ? error : new Error(String(error));
                const pending = this.pendingRequests.get(id);
                this.pendingRequests.delete(id);
                pending?.reject(writeError);
            }
        });
    }
    getData(response) {
        if (!response.success) {
            const errorResponse = response;
            throw new Error(errorResponse.error);
        }
        // Type assertion: we trust response.data matches T based on the command sent.
        // This is safe because each public method specifies the correct T for its command.
        const successResponse = response;
        return successResponse.data;
    }
}
//# sourceMappingURL=rpc-client.js.map