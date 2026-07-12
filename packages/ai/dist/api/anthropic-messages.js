import Anthropic from "@anthropic-ai/sdk";
import { calculateCost } from "../models.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { headersToRecord } from "../utils/headers.js";
import { parseJsonWithRepair, parseStreamingJson } from "../utils/json-parse.js";
import { getProviderEnvValue } from "../utils/provider-env.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import { buildCopilotDynamicHeaders, hasCopilotVisionInput } from "./github-copilot-headers.js";
import { adjustMaxTokensForThinking, buildBaseOptions, clampMaxTokensToContext } from "./simple-options.js";
import { transformMessages } from "./transform-messages.js";
/**
 * Resolve cache retention preference.
 * Defaults to "short" and uses PI_CACHE_RETENTION for backward compatibility.
 */
function resolveCacheRetention(cacheRetention, env) {
    if (cacheRetention) {
        return cacheRetention;
    }
    if (getProviderEnvValue("PI_CACHE_RETENTION", env) === "long") {
        return "long";
    }
    return "short";
}
function getCacheControl(model, cacheRetention, env) {
    const retention = resolveCacheRetention(cacheRetention, env);
    if (retention === "none") {
        return { retention };
    }
    const ttl = retention === "long" && getAnthropicCompat(model).supportsLongCacheRetention ? "1h" : undefined;
    return {
        retention,
        cacheControl: { type: "ephemeral", ...(ttl && { ttl }) },
    };
}
// Stealth mode: Mimic Claude Code's tool naming exactly
const claudeCodeVersion = "2.1.75";
// Claude Code 2.x tool names (canonical casing)
// Source: https://cchistory.mariozechner.at/data/prompts-2.1.11.md
// To update: https://github.com/badlogic/cchistory
const claudeCodeTools = [
    "Read",
    "Write",
    "Edit",
    "Bash",
    "Grep",
    "Glob",
    "AskUserQuestion",
    "EnterPlanMode",
    "ExitPlanMode",
    "KillShell",
    "NotebookEdit",
    "Skill",
    "Task",
    "TaskOutput",
    "TodoWrite",
    "WebFetch",
    "WebSearch",
];
const ccToolLookup = new Map(claudeCodeTools.map((t) => [t.toLowerCase(), t]));
// Convert tool name to CC canonical casing if it matches (case-insensitive)
const toClaudeCodeName = (name) => ccToolLookup.get(name.toLowerCase()) ?? name;
const fromClaudeCodeName = (name, tools) => {
    if (tools && tools.length > 0) {
        const lowerName = name.toLowerCase();
        const matchedTool = tools.find((tool) => tool.name.toLowerCase() === lowerName);
        if (matchedTool)
            return matchedTool.name;
    }
    return name;
};
/**
 * Convert content blocks to Anthropic API format
 */
function convertContentBlocks(content) {
    // If only text blocks, return as concatenated string for simplicity
    const hasImages = content.some((c) => c.type === "image");
    if (!hasImages) {
        return sanitizeSurrogates(content.map((c) => c.text).join("\n"));
    }
    // If we have images, convert to content block array
    const blocks = content.map((block) => {
        if (block.type === "text") {
            return {
                type: "text",
                text: sanitizeSurrogates(block.text),
            };
        }
        return {
            type: "image",
            source: {
                type: "base64",
                media_type: block.mimeType,
                data: block.data,
            },
        };
    });
    // If only images (no text), add placeholder text block
    const hasText = blocks.some((b) => b.type === "text");
    if (!hasText) {
        blocks.unshift({
            type: "text",
            text: "(see attached image)",
        });
    }
    return blocks;
}
const FINE_GRAINED_TOOL_STREAMING_BETA = "fine-grained-tool-streaming-2025-05-14";
const INTERLEAVED_THINKING_BETA = "interleaved-thinking-2025-05-14";
function getAnthropicCompat(model) {
    return {
        supportsEagerToolInputStreaming: model.compat?.supportsEagerToolInputStreaming ?? true,
        supportsLongCacheRetention: model.compat?.supportsLongCacheRetention ?? true,
        sendSessionAffinityHeaders: model.compat?.sendSessionAffinityHeaders ?? false,
        supportsCacheControlOnTools: model.compat?.supportsCacheControlOnTools ?? true,
        supportsTemperature: model.compat?.supportsTemperature ?? true,
        allowEmptySignature: model.compat?.allowEmptySignature ?? false,
    };
}
function mergeHeaders(...headerSources) {
    const merged = {};
    for (const headers of headerSources) {
        if (headers) {
            Object.assign(merged, headers);
        }
    }
    return merged;
}
function hasHeader(headers, name) {
    if (!headers)
        return false;
    const expected = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === expected && value !== null && value.trim().length > 0)
            return true;
    }
    return false;
}
function assertRequestAuth(provider, apiKey, headers) {
    if (apiKey)
        return;
    if (hasHeader(headers, "authorization") ||
        hasHeader(headers, "x-api-key") ||
        hasHeader(headers, "cf-aig-authorization")) {
        return;
    }
    throw new Error(`No API key for provider: ${provider}`);
}
const ANTHROPIC_MESSAGE_EVENTS = new Set([
    "message_start",
    "message_delta",
    "message_stop",
    "content_block_start",
    "content_block_delta",
    "content_block_stop",
]);
function flushSseEvent(state) {
    if (!state.event && state.data.length === 0) {
        return null;
    }
    const event = {
        event: state.event,
        data: state.data.join("\n"),
        raw: [...state.raw],
    };
    state.event = null;
    state.data = [];
    state.raw = [];
    return event;
}
function decodeSseLine(line, state) {
    if (line === "") {
        return flushSseEvent(state);
    }
    state.raw.push(line);
    if (line.startsWith(":")) {
        return null;
    }
    const delimiterIndex = line.indexOf(":");
    const fieldName = delimiterIndex === -1 ? line : line.slice(0, delimiterIndex);
    let value = delimiterIndex === -1 ? "" : line.slice(delimiterIndex + 1);
    if (value.startsWith(" ")) {
        value = value.slice(1);
    }
    if (fieldName === "event") {
        state.event = value;
    }
    else if (fieldName === "data") {
        state.data.push(value);
    }
    return null;
}
function nextLineBreakIndex(text) {
    const carriageReturnIndex = text.indexOf("\r");
    const newlineIndex = text.indexOf("\n");
    if (carriageReturnIndex === -1) {
        return newlineIndex;
    }
    if (newlineIndex === -1) {
        return carriageReturnIndex;
    }
    return Math.min(carriageReturnIndex, newlineIndex);
}
function consumeLine(text) {
    const lineBreakIndex = nextLineBreakIndex(text);
    if (lineBreakIndex === -1) {
        return null;
    }
    let nextIndex = lineBreakIndex + 1;
    if (text[lineBreakIndex] === "\r" && text[nextIndex] === "\n") {
        nextIndex += 1;
    }
    return {
        line: text.slice(0, lineBreakIndex),
        rest: text.slice(nextIndex),
    };
}
async function* iterateSseMessages(body, signal) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const state = { event: null, data: [], raw: [] };
    let buffer = "";
    try {
        while (true) {
            if (signal?.aborted) {
                throw new Error("Request was aborted");
            }
            const { value, done } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            let consumed = consumeLine(buffer);
            while (consumed) {
                buffer = consumed.rest;
                const event = decodeSseLine(consumed.line, state);
                if (event) {
                    yield event;
                }
                consumed = consumeLine(buffer);
            }
        }
        buffer += decoder.decode();
        let consumed = consumeLine(buffer);
        while (consumed) {
            buffer = consumed.rest;
            const event = decodeSseLine(consumed.line, state);
            if (event) {
                yield event;
            }
            consumed = consumeLine(buffer);
        }
        if (buffer.length > 0) {
            const event = decodeSseLine(buffer, state);
            if (event) {
                yield event;
            }
        }
        const trailingEvent = flushSseEvent(state);
        if (trailingEvent) {
            yield trailingEvent;
        }
    }
    finally {
        reader.releaseLock();
    }
}
async function* iterateAnthropicEvents(response, signal) {
    if (!response.body) {
        throw new Error("Attempted to iterate over an Anthropic response with no body");
    }
    let sawMessageStart = false;
    let sawMessageEnd = false;
    for await (const sse of iterateSseMessages(response.body, signal)) {
        if (sse.event === "error") {
            throw new Error(sse.data);
        }
        if (!ANTHROPIC_MESSAGE_EVENTS.has(sse.event ?? "")) {
            continue;
        }
        try {
            const event = parseJsonWithRepair(sse.data);
            if (event.type === "message_start") {
                sawMessageStart = true;
            }
            else if (event.type === "message_stop") {
                sawMessageEnd = true;
            }
            yield event;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Could not parse Anthropic SSE event ${sse.event}: ${message}; data=${sse.data}; raw=${sse.raw.join("\\n")}`);
        }
    }
    if (sawMessageStart && !sawMessageEnd) {
        throw new Error("Anthropic stream ended before message_stop");
    }
}
export const stream = (model, context, options) => {
    const stream = new AssistantMessageEventStream();
    (async () => {
        const output = {
            role: "assistant",
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
            stopReason: "stop",
            timestamp: Date.now(),
        };
        try {
            let client;
            let isOAuth;
            if (options?.client) {
                client = options.client;
                isOAuth = false;
            }
            else {
                const apiKey = options?.apiKey;
                assertRequestAuth(model.provider, apiKey, options?.headers);
                let copilotDynamicHeaders;
                if (model.provider === "github-copilot") {
                    const hasImages = hasCopilotVisionInput(context.messages);
                    copilotDynamicHeaders = buildCopilotDynamicHeaders({
                        messages: context.messages,
                        hasImages,
                    });
                }
                const cacheRetention = resolveCacheRetention(options?.cacheRetention, options?.env);
                const cacheSessionId = cacheRetention === "none" ? undefined : options?.sessionId;
                const created = createClient(model, apiKey, options?.interleavedThinking ?? true, shouldUseFineGrainedToolStreamingBeta(model, context), options?.headers, copilotDynamicHeaders, cacheSessionId);
                client = created.client;
                isOAuth = created.isOAuthToken;
            }
            let params = buildParams(model, context, isOAuth, options);
            const nextParams = await options?.onPayload?.(params, model);
            if (nextParams !== undefined) {
                params = nextParams;
            }
            const requestOptions = {
                ...(options?.signal ? { signal: options.signal } : {}),
                ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
                maxRetries: options?.maxRetries ?? 0,
            };
            const response = await client.messages.create({ ...params, stream: true }, requestOptions).asResponse();
            await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
            stream.push({ type: "start", partial: output });
            const blocks = output.content;
            for await (const event of iterateAnthropicEvents(response, options?.signal)) {
                if (event.type === "message_start") {
                    output.responseId = event.message.id;
                    // Capture initial token usage from message_start event
                    // This ensures we have input token counts even if the stream is aborted early
                    output.usage.input = event.message.usage.input_tokens || 0;
                    output.usage.output = event.message.usage.output_tokens || 0;
                    output.usage.cacheRead = event.message.usage.cache_read_input_tokens || 0;
                    output.usage.cacheWrite = event.message.usage.cache_creation_input_tokens || 0;
                    output.usage.cacheWrite1h = event.message.usage.cache_creation?.ephemeral_1h_input_tokens || 0;
                    // Anthropic doesn't provide total_tokens, compute from components
                    output.usage.totalTokens =
                        output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
                    calculateCost(model, output.usage);
                }
                else if (event.type === "content_block_start") {
                    if (event.content_block.type === "text") {
                        const block = {
                            type: "text",
                            text: "",
                            index: event.index,
                        };
                        output.content.push(block);
                        stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
                    }
                    else if (event.content_block.type === "thinking") {
                        const block = {
                            type: "thinking",
                            thinking: "",
                            thinkingSignature: "",
                            index: event.index,
                        };
                        output.content.push(block);
                        stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
                    }
                    else if (event.content_block.type === "redacted_thinking") {
                        const block = {
                            type: "thinking",
                            thinking: "[Reasoning redacted]",
                            thinkingSignature: event.content_block.data,
                            redacted: true,
                            index: event.index,
                        };
                        output.content.push(block);
                        stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
                    }
                    else if (event.content_block.type === "tool_use") {
                        const block = {
                            type: "toolCall",
                            id: event.content_block.id,
                            name: isOAuth
                                ? fromClaudeCodeName(event.content_block.name, context.tools)
                                : event.content_block.name,
                            arguments: event.content_block.input ?? {},
                            partialJson: "",
                            index: event.index,
                        };
                        output.content.push(block);
                        stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
                    }
                }
                else if (event.type === "content_block_delta") {
                    if (event.delta.type === "text_delta") {
                        const index = blocks.findIndex((b) => b.index === event.index);
                        const block = blocks[index];
                        if (block && block.type === "text") {
                            block.text += event.delta.text;
                            stream.push({
                                type: "text_delta",
                                contentIndex: index,
                                delta: event.delta.text,
                                partial: output,
                            });
                        }
                    }
                    else if (event.delta.type === "thinking_delta") {
                        const index = blocks.findIndex((b) => b.index === event.index);
                        const block = blocks[index];
                        if (block && block.type === "thinking") {
                            block.thinking += event.delta.thinking;
                            stream.push({
                                type: "thinking_delta",
                                contentIndex: index,
                                delta: event.delta.thinking,
                                partial: output,
                            });
                        }
                    }
                    else if (event.delta.type === "input_json_delta") {
                        const index = blocks.findIndex((b) => b.index === event.index);
                        const block = blocks[index];
                        if (block && block.type === "toolCall") {
                            block.partialJson += event.delta.partial_json;
                            block.arguments = parseStreamingJson(block.partialJson);
                            stream.push({
                                type: "toolcall_delta",
                                contentIndex: index,
                                delta: event.delta.partial_json,
                                partial: output,
                            });
                        }
                    }
                    else if (event.delta.type === "signature_delta") {
                        const index = blocks.findIndex((b) => b.index === event.index);
                        const block = blocks[index];
                        if (block && block.type === "thinking") {
                            block.thinkingSignature = block.thinkingSignature || "";
                            block.thinkingSignature += event.delta.signature;
                        }
                    }
                }
                else if (event.type === "content_block_stop") {
                    const index = blocks.findIndex((b) => b.index === event.index);
                    const block = blocks[index];
                    if (block) {
                        delete block.index;
                        if (block.type === "text") {
                            stream.push({
                                type: "text_end",
                                contentIndex: index,
                                content: block.text,
                                partial: output,
                            });
                        }
                        else if (block.type === "thinking") {
                            stream.push({
                                type: "thinking_end",
                                contentIndex: index,
                                content: block.thinking,
                                partial: output,
                            });
                        }
                        else if (block.type === "toolCall") {
                            block.arguments = parseStreamingJson(block.partialJson);
                            // Finalize in-place and strip the scratch buffer so replay only
                            // carries parsed arguments.
                            delete block.partialJson;
                            stream.push({
                                type: "toolcall_end",
                                contentIndex: index,
                                toolCall: block,
                                partial: output,
                            });
                        }
                    }
                }
                else if (event.type === "message_delta") {
                    if (event.delta.stop_reason) {
                        const stopReasonResult = mapStopReason(event.delta.stop_reason, event.delta.stop_details);
                        output.stopReason = stopReasonResult.stopReason;
                        if (stopReasonResult.errorMessage) {
                            output.errorMessage = stopReasonResult.errorMessage;
                        }
                    }
                    // Only update usage fields if present (not null).
                    // Preserves input_tokens from message_start when proxies omit it in message_delta.
                    if (event.usage.input_tokens != null) {
                        output.usage.input = event.usage.input_tokens;
                    }
                    if (event.usage.output_tokens != null) {
                        output.usage.output = event.usage.output_tokens;
                    }
                    if (event.usage.cache_read_input_tokens != null) {
                        output.usage.cacheRead = event.usage.cache_read_input_tokens;
                    }
                    if (event.usage.cache_creation_input_tokens != null) {
                        output.usage.cacheWrite = event.usage.cache_creation_input_tokens;
                    }
                    // Anthropic reports reasoning tokens in `output_tokens_details.thinking_tokens` on the
                    // final message_delta usage (a subset of output_tokens). SDK 0.91.1 omits the field from
                    // its Usage type, so read it through a narrow cast. Verified against the live API.
                    const thinkingTokens = event.usage
                        .output_tokens_details?.thinking_tokens;
                    if (thinkingTokens != null) {
                        output.usage.reasoning = thinkingTokens;
                    }
                    // Anthropic doesn't provide total_tokens, compute from components
                    output.usage.totalTokens =
                        output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
                    calculateCost(model, output.usage);
                }
            }
            if (options?.signal?.aborted) {
                throw new Error("Request was aborted");
            }
            if (output.stopReason === "aborted" || output.stopReason === "error") {
                throw new Error(output.errorMessage || "An unknown error occurred");
            }
            stream.push({ type: "done", reason: output.stopReason, message: output });
            stream.end();
        }
        catch (error) {
            for (const block of output.content) {
                delete block.index;
                // partialJson is only a streaming scratch buffer; never persist it.
                delete block.partialJson;
            }
            output.stopReason = options?.signal?.aborted ? "aborted" : "error";
            output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
            stream.push({ type: "error", reason: output.stopReason, error: output });
            stream.end();
        }
    })();
    return stream;
};
/**
 * Map ThinkingLevel to Anthropic effort levels for adaptive thinking.
 * Note: effort "max" is only valid on Opus 4.6, while Opus 4.7+ and Fable 5 support "xhigh".
 */
function mapThinkingLevelToEffort(model, level) {
    const mapped = level ? model.thinkingLevelMap?.[level] : undefined;
    if (typeof mapped === "string")
        return mapped;
    switch (level) {
        case "minimal":
        case "low":
            return "low";
        case "medium":
            return "medium";
        case "high":
            return "high";
        default:
            return "high";
    }
}
export const streamSimple = (model, context, options) => {
    assertRequestAuth(model.provider, options?.apiKey, options?.headers);
    const base = buildBaseOptions(model, context, options, options?.apiKey);
    if (!options?.reasoning) {
        return stream(model, context, { ...base, thinkingEnabled: false });
    }
    // For models with adaptive thinking: use an effort level.
    // For older models: use budget-based thinking.
    if (model.compat?.forceAdaptiveThinking === true) {
        const effort = mapThinkingLevelToEffort(model, options.reasoning);
        return stream(model, context, {
            ...base,
            thinkingEnabled: true,
            effort,
        });
    }
    // Undefined means the caller did not request an output cap; let the helper use the model cap.
    // Do not coerce to 0 here, or the thinking budget would become the entire max_tokens value.
    const adjusted = adjustMaxTokensForThinking(base.maxTokens, model.maxTokens, options.reasoning, options.thinkingBudgets);
    const maxTokens = clampMaxTokensToContext(model, context, adjusted.maxTokens);
    return stream(model, context, {
        ...base,
        maxTokens,
        thinkingEnabled: true,
        thinkingBudgetTokens: Math.min(adjusted.thinkingBudget, Math.max(0, maxTokens - 1024)),
    });
};
function isOAuthToken(apiKey) {
    return apiKey.includes("sk-ant-oat");
}
function createClient(model, apiKey, interleavedThinking, useFineGrainedToolStreamingBeta, optionsHeaders, dynamicHeaders, sessionId) {
    // Adaptive thinking models have interleaved thinking built in, so skip the beta header.
    const needsInterleavedBeta = interleavedThinking && model.compat?.forceAdaptiveThinking !== true;
    const betaFeatures = [];
    if (useFineGrainedToolStreamingBeta) {
        betaFeatures.push(FINE_GRAINED_TOOL_STREAMING_BETA);
    }
    if (needsInterleavedBeta) {
        betaFeatures.push(INTERLEAVED_THINKING_BETA);
    }
    // Copilot: Bearer auth, selective betas.
    if (model.provider === "github-copilot") {
        const client = new Anthropic({
            apiKey: null,
            authToken: apiKey ?? null,
            baseURL: model.baseUrl,
            dangerouslyAllowBrowser: true,
            defaultHeaders: mergeHeaders({
                accept: "application/json",
                "anthropic-dangerous-direct-browser-access": "true",
                ...(betaFeatures.length > 0 ? { "anthropic-beta": betaFeatures.join(",") } : {}),
            }, model.headers, dynamicHeaders, optionsHeaders),
        });
        return { client, isOAuthToken: false };
    }
    // OAuth: Bearer auth, Claude Code identity headers
    if (apiKey && isOAuthToken(apiKey)) {
        const client = new Anthropic({
            apiKey: null,
            authToken: apiKey,
            baseURL: model.baseUrl,
            dangerouslyAllowBrowser: true,
            defaultHeaders: mergeHeaders({
                accept: "application/json",
                "anthropic-dangerous-direct-browser-access": "true",
                "anthropic-beta": ["claude-code-20250219", "oauth-2025-04-20", ...betaFeatures].join(","),
                "user-agent": `claude-cli/${claudeCodeVersion}`,
                "x-app": "cli",
            }, model.headers, optionsHeaders),
        });
        return { client, isOAuthToken: true };
    }
    // API key or header-owned auth.
    const sessionAffinityHeaders = sessionId && getAnthropicCompat(model).sendSessionAffinityHeaders ? { "x-session-affinity": sessionId } : {};
    const defaultHeaders = mergeHeaders({
        accept: "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
        ...(betaFeatures.length > 0 ? { "anthropic-beta": betaFeatures.join(",") } : {}),
    }, sessionAffinityHeaders, model.headers, optionsHeaders);
    const client = new Anthropic({
        apiKey: apiKey ?? null,
        authToken: null,
        baseURL: model.baseUrl,
        dangerouslyAllowBrowser: true,
        defaultHeaders,
    });
    return { client, isOAuthToken: false };
}
function buildParams(model, context, isOAuthToken, options) {
    const { cacheControl } = getCacheControl(model, options?.cacheRetention, options?.env);
    const compat = getAnthropicCompat(model);
    const params = {
        model: model.id,
        messages: convertMessages(context.messages, model, isOAuthToken, cacheControl, compat.allowEmptySignature),
        max_tokens: options?.maxTokens ?? model.maxTokens,
        stream: true,
    };
    // For OAuth tokens, we MUST include Claude Code identity
    if (isOAuthToken) {
        params.system = [
            {
                type: "text",
                text: "You are Claude Code, Anthropic's official CLI for Claude.",
                ...(cacheControl ? { cache_control: cacheControl } : {}),
            },
        ];
        if (context.systemPrompt) {
            params.system.push({
                type: "text",
                text: sanitizeSurrogates(context.systemPrompt),
                ...(cacheControl ? { cache_control: cacheControl } : {}),
            });
        }
    }
    else if (context.systemPrompt) {
        // Add cache control to system prompt for non-OAuth tokens
        params.system = [
            {
                type: "text",
                text: sanitizeSurrogates(context.systemPrompt),
                ...(cacheControl ? { cache_control: cacheControl } : {}),
            },
        ];
    }
    // Temperature is incompatible with extended thinking and unsupported on Claude Opus 4.7+.
    if (options?.temperature !== undefined && !options?.thinkingEnabled && compat.supportsTemperature) {
        params.temperature = options.temperature;
    }
    if (context.tools && context.tools.length > 0) {
        params.tools = convertTools(context.tools, isOAuthToken, compat.supportsEagerToolInputStreaming, compat.supportsCacheControlOnTools ? cacheControl : undefined);
    }
    // Configure thinking mode: adaptive, budget-based, or explicitly disabled.
    if (model.reasoning) {
        if (options?.thinkingEnabled) {
            // Default to "summarized" so Opus 4.7 and Mythos Preview behave like
            // older Claude 4 models (whose API default is also "summarized").
            const display = options.thinkingDisplay ?? "summarized";
            if (model.compat?.forceAdaptiveThinking === true) {
                // Adaptive thinking: Claude decides when and how much to think.
                params.thinking = { type: "adaptive", display };
                if (options.effort) {
                    // The Anthropic SDK types can lag newly supported effort values such as "xhigh".
                    params.output_config =
                        options.effort === "xhigh"
                            ? { effort: options.effort }
                            : { effort: options.effort };
                }
            }
            else {
                // Budget-based thinking for older models
                params.thinking = {
                    type: "enabled",
                    budget_tokens: options.thinkingBudgetTokens || 1024,
                    display,
                };
            }
        }
        else if (options?.thinkingEnabled === false && model.thinkingLevelMap?.off !== null) {
            params.thinking = { type: "disabled" };
        }
    }
    if (options?.metadata) {
        const userId = options.metadata.user_id;
        if (typeof userId === "string") {
            params.metadata = { user_id: userId };
        }
    }
    if (options?.toolChoice) {
        if (typeof options.toolChoice === "string") {
            params.tool_choice = { type: options.toolChoice };
        }
        else {
            params.tool_choice = options.toolChoice;
        }
    }
    return params;
}
// Normalize tool call IDs to match Anthropic's required pattern and length
function normalizeToolCallId(id) {
    return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}
function convertMessages(messages, model, isOAuthToken, cacheControl, allowEmptySignature = false) {
    const params = [];
    // Transform messages for cross-provider compatibility
    const transformedMessages = transformMessages(messages, model, normalizeToolCallId);
    for (let i = 0; i < transformedMessages.length; i++) {
        const msg = transformedMessages[i];
        if (msg.role === "user") {
            if (typeof msg.content === "string") {
                if (msg.content.trim().length > 0) {
                    params.push({
                        role: "user",
                        content: sanitizeSurrogates(msg.content),
                    });
                }
            }
            else {
                const blocks = msg.content.map((item) => {
                    if (item.type === "text") {
                        return {
                            type: "text",
                            text: sanitizeSurrogates(item.text),
                        };
                    }
                    else {
                        return {
                            type: "image",
                            source: {
                                type: "base64",
                                media_type: item.mimeType,
                                data: item.data,
                            },
                        };
                    }
                });
                const filteredBlocks = blocks.filter((b) => {
                    if (b.type === "text") {
                        return b.text.trim().length > 0;
                    }
                    return true;
                });
                if (filteredBlocks.length === 0)
                    continue;
                params.push({
                    role: "user",
                    content: filteredBlocks,
                });
            }
        }
        else if (msg.role === "assistant") {
            const blocks = [];
            for (const block of msg.content) {
                if (block.type === "text") {
                    if (block.text.trim().length === 0)
                        continue;
                    blocks.push({
                        type: "text",
                        text: sanitizeSurrogates(block.text),
                    });
                }
                else if (block.type === "thinking") {
                    // Redacted thinking: pass the opaque payload back as redacted_thinking
                    if (block.redacted) {
                        blocks.push({
                            type: "redacted_thinking",
                            data: block.thinkingSignature,
                        });
                        continue;
                    }
                    if (block.thinking.trim().length === 0)
                        continue;
                    // If thinking signature is missing/empty (e.g., from aborted stream),
                    // convert to plain text for Anthropic. Some compatible providers emit
                    // and accept empty signatures, so let marked models preserve the block.
                    if (!block.thinkingSignature || block.thinkingSignature.trim().length === 0) {
                        blocks.push(allowEmptySignature
                            ? {
                                type: "thinking",
                                thinking: sanitizeSurrogates(block.thinking),
                                signature: "",
                            }
                            : {
                                type: "text",
                                text: sanitizeSurrogates(block.thinking),
                            });
                    }
                    else {
                        blocks.push({
                            type: "thinking",
                            thinking: sanitizeSurrogates(block.thinking),
                            signature: block.thinkingSignature,
                        });
                    }
                }
                else if (block.type === "toolCall") {
                    blocks.push({
                        type: "tool_use",
                        id: block.id,
                        name: isOAuthToken ? toClaudeCodeName(block.name) : block.name,
                        input: block.arguments ?? {},
                    });
                }
            }
            if (blocks.length === 0)
                continue;
            params.push({
                role: "assistant",
                content: blocks,
            });
        }
        else if (msg.role === "toolResult") {
            // Collect all consecutive toolResult messages, needed for z.ai Anthropic endpoint
            const toolResults = [];
            // Add the current tool result
            toolResults.push({
                type: "tool_result",
                tool_use_id: msg.toolCallId,
                content: convertContentBlocks(msg.content),
                is_error: msg.isError,
            });
            // Look ahead for consecutive toolResult messages
            let j = i + 1;
            while (j < transformedMessages.length && transformedMessages[j].role === "toolResult") {
                const nextMsg = transformedMessages[j]; // We know it's a toolResult
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: nextMsg.toolCallId,
                    content: convertContentBlocks(nextMsg.content),
                    is_error: nextMsg.isError,
                });
                j++;
            }
            // Skip the messages we've already processed
            i = j - 1;
            // Add a single user message with all tool results
            params.push({
                role: "user",
                content: toolResults,
            });
        }
    }
    // Add cache_control to the last user message to cache conversation history
    if (cacheControl && params.length > 0) {
        const lastMessage = params[params.length - 1];
        if (lastMessage.role === "user") {
            if (Array.isArray(lastMessage.content)) {
                const lastBlock = lastMessage.content[lastMessage.content.length - 1];
                if (lastBlock &&
                    (lastBlock.type === "text" || lastBlock.type === "image" || lastBlock.type === "tool_result")) {
                    lastBlock.cache_control = cacheControl;
                }
            }
            else if (typeof lastMessage.content === "string") {
                lastMessage.content = [
                    {
                        type: "text",
                        text: lastMessage.content,
                        cache_control: cacheControl,
                    },
                ];
            }
        }
    }
    return params;
}
function shouldUseFineGrainedToolStreamingBeta(model, context) {
    return !!context.tools?.length && !getAnthropicCompat(model).supportsEagerToolInputStreaming;
}
function convertTools(tools, isOAuthToken, supportsEagerToolInputStreaming, cacheControl) {
    if (!tools)
        return [];
    return tools.map((tool, index) => {
        const schema = tool.parameters;
        return {
            name: isOAuthToken ? toClaudeCodeName(tool.name) : tool.name,
            description: tool.description,
            ...(supportsEagerToolInputStreaming ? { eager_input_streaming: true } : {}),
            input_schema: {
                type: "object",
                properties: schema.properties ?? {},
                required: schema.required ?? [],
            },
            ...(cacheControl && index === tools.length - 1 ? { cache_control: cacheControl } : {}),
        };
    });
}
function mapStopReason(reason, stopDetails) {
    switch (reason) {
        case "end_turn":
            return { stopReason: "stop" };
        case "max_tokens":
            return { stopReason: "length" };
        case "tool_use":
            return { stopReason: "toolUse" };
        case "refusal":
            return {
                stopReason: "error",
                errorMessage: stopDetails?.explanation || `The model refused to complete the request`,
            };
        case "pause_turn": // Stop is good enough -> resubmit
            return { stopReason: "stop" };
        case "stop_sequence":
            return { stopReason: "stop" }; // We don't supply stop sequences, so this should never happen
        case "sensitive": // Content flagged by safety filters (not yet in SDK types)
            return { stopReason: "error" };
        default:
            // Handle unknown stop reasons gracefully (API may add new values)
            throw new Error(`Unhandled stop reason: ${reason}`);
    }
}
//# sourceMappingURL=anthropic-messages.js.map