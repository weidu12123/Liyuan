/**
 * Proxy stream function for apps that route LLM calls through a server.
 * The server manages auth and proxies requests to LLM providers.
 */
// Internal import for JSON parsing utility
import { EventStream, parseStreamingJson, } from "@liyuan/ai";
// Create stream class matching ProxyMessageEventStream
class ProxyMessageEventStream extends EventStream {
    constructor() {
        super((event) => event.type === "done" || event.type === "error", (event) => {
            if (event.type === "done")
                return event.message;
            if (event.type === "error")
                return event.error;
            throw new Error("Unexpected event type");
        });
    }
}
/**
 * Stream function that proxies through a server instead of calling LLM providers directly.
 * The server strips the partial field from delta events to reduce bandwidth.
 * We reconstruct the partial message client-side.
 *
 * Use this as the `streamFn` option when creating an Agent that needs to go through a proxy.
 *
 * @example
 * ```typescript
 * const agent = new Agent({
 *   streamFn: (model, context, options) =>
 *     streamProxy(model, context, {
 *       ...options,
 *       authToken: await getAuthToken(),
 *       proxyUrl: "https://genai.example.com",
 *     }),
 * });
 * ```
 */
function buildProxyRequestOptions(options) {
    return {
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        reasoning: options.reasoning,
        cacheRetention: options.cacheRetention,
        sessionId: options.sessionId,
        headers: options.headers,
        metadata: options.metadata,
        transport: options.transport,
        thinkingBudgets: options.thinkingBudgets,
        maxRetryDelayMs: options.maxRetryDelayMs,
    };
}
export function streamProxy(model, context, options) {
    const stream = new ProxyMessageEventStream();
    (async () => {
        // Initialize the partial message that we'll build up from events
        const partial = {
            role: "assistant",
            stopReason: "stop",
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            timestamp: Date.now(),
        };
        let reader;
        const abortHandler = () => {
            if (reader) {
                reader.cancel("Request aborted by user").catch(() => { });
            }
        };
        if (options.signal) {
            options.signal.addEventListener("abort", abortHandler);
        }
        try {
            const response = await fetch(`${options.proxyUrl}/api/stream`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${options.authToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model,
                    context,
                    options: buildProxyRequestOptions(options),
                }),
                signal: options.signal,
            });
            if (!response.ok) {
                let errorMessage = `Proxy error: ${response.status} ${response.statusText}`;
                try {
                    const errorData = (await response.json());
                    if (errorData.error) {
                        errorMessage = `Proxy error: ${errorData.error}`;
                    }
                }
                catch {
                    // Couldn't parse error response
                }
                throw new Error(errorMessage);
            }
            reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                if (options.signal?.aborted) {
                    throw new Error("Request aborted by user");
                }
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        const data = line.slice(6).trim();
                        if (data) {
                            const proxyEvent = JSON.parse(data);
                            const event = processProxyEvent(proxyEvent, partial);
                            if (event) {
                                stream.push(event);
                            }
                        }
                    }
                }
            }
            if (options.signal?.aborted) {
                throw new Error("Request aborted by user");
            }
            stream.end();
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const reason = options.signal?.aborted ? "aborted" : "error";
            partial.stopReason = reason;
            partial.errorMessage = errorMessage;
            stream.push({
                type: "error",
                reason,
                error: partial,
            });
            stream.end();
        }
        finally {
            if (options.signal) {
                options.signal.removeEventListener("abort", abortHandler);
            }
        }
    })();
    return stream;
}
/**
 * Process a proxy event and update the partial message.
 */
function processProxyEvent(proxyEvent, partial) {
    switch (proxyEvent.type) {
        case "start":
            return { type: "start", partial };
        case "text_start":
            partial.content[proxyEvent.contentIndex] = { type: "text", text: "" };
            return { type: "text_start", contentIndex: proxyEvent.contentIndex, partial };
        case "text_delta": {
            const content = partial.content[proxyEvent.contentIndex];
            if (content?.type === "text") {
                content.text += proxyEvent.delta;
                return {
                    type: "text_delta",
                    contentIndex: proxyEvent.contentIndex,
                    delta: proxyEvent.delta,
                    partial,
                };
            }
            throw new Error("Received text_delta for non-text content");
        }
        case "text_end": {
            const content = partial.content[proxyEvent.contentIndex];
            if (content?.type === "text") {
                content.textSignature = proxyEvent.contentSignature;
                return {
                    type: "text_end",
                    contentIndex: proxyEvent.contentIndex,
                    content: content.text,
                    partial,
                };
            }
            throw new Error("Received text_end for non-text content");
        }
        case "thinking_start":
            partial.content[proxyEvent.contentIndex] = { type: "thinking", thinking: "" };
            return { type: "thinking_start", contentIndex: proxyEvent.contentIndex, partial };
        case "thinking_delta": {
            const content = partial.content[proxyEvent.contentIndex];
            if (content?.type === "thinking") {
                content.thinking += proxyEvent.delta;
                return {
                    type: "thinking_delta",
                    contentIndex: proxyEvent.contentIndex,
                    delta: proxyEvent.delta,
                    partial,
                };
            }
            throw new Error("Received thinking_delta for non-thinking content");
        }
        case "thinking_end": {
            const content = partial.content[proxyEvent.contentIndex];
            if (content?.type === "thinking") {
                content.thinkingSignature = proxyEvent.contentSignature;
                return {
                    type: "thinking_end",
                    contentIndex: proxyEvent.contentIndex,
                    content: content.thinking,
                    partial,
                };
            }
            throw new Error("Received thinking_end for non-thinking content");
        }
        case "toolcall_start":
            partial.content[proxyEvent.contentIndex] = {
                type: "toolCall",
                id: proxyEvent.id,
                name: proxyEvent.toolName,
                arguments: {},
                partialJson: "",
            };
            return { type: "toolcall_start", contentIndex: proxyEvent.contentIndex, partial };
        case "toolcall_delta": {
            const content = partial.content[proxyEvent.contentIndex];
            if (content?.type === "toolCall") {
                content.partialJson += proxyEvent.delta;
                content.arguments = parseStreamingJson(content.partialJson) || {};
                partial.content[proxyEvent.contentIndex] = { ...content }; // Trigger reactivity
                return {
                    type: "toolcall_delta",
                    contentIndex: proxyEvent.contentIndex,
                    delta: proxyEvent.delta,
                    partial,
                };
            }
            throw new Error("Received toolcall_delta for non-toolCall content");
        }
        case "toolcall_end": {
            const content = partial.content[proxyEvent.contentIndex];
            if (content?.type === "toolCall") {
                delete content.partialJson;
                return {
                    type: "toolcall_end",
                    contentIndex: proxyEvent.contentIndex,
                    toolCall: content,
                    partial,
                };
            }
            return undefined;
        }
        case "done":
            partial.stopReason = proxyEvent.reason;
            partial.usage = proxyEvent.usage;
            return { type: "done", reason: proxyEvent.reason, message: partial };
        case "error":
            partial.stopReason = proxyEvent.reason;
            partial.errorMessage = proxyEvent.errorMessage;
            partial.usage = proxyEvent.usage;
            return { type: "error", reason: proxyEvent.reason, error: partial };
        default: {
            const _exhaustiveCheck = proxyEvent;
            console.warn(`Unhandled proxy event type: ${proxyEvent.type}`);
            return undefined;
        }
    }
}
//# sourceMappingURL=proxy.js.map