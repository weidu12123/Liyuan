import { Mistral } from "@mistralai/mistralai";
import { calculateCost, clampThinkingLevel } from "../models.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { shortHash } from "../utils/hash.js";
import { parseStreamingJson } from "../utils/json-parse.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import { buildBaseOptions } from "./simple-options.js";
import { transformMessages } from "./transform-messages.js";
const MISTRAL_TOOL_CALL_ID_LENGTH = 9;
const MAX_MISTRAL_ERROR_BODY_CHARS = 4000;
/**
 * Stream responses from Mistral using `chat.stream`.
 */
export const stream = (model, context, options) => {
    const stream = new AssistantMessageEventStream();
    (async () => {
        const output = createOutput(model);
        try {
            const apiKey = options?.apiKey;
            if (!apiKey) {
                throw new Error(`No API key for provider: ${model.provider}`);
            }
            // Intentionally per-request: avoids shared SDK mutable state across concurrent consumers.
            const mistral = new Mistral({
                apiKey,
                serverURL: model.baseUrl,
            });
            const normalizeMistralToolCallId = createMistralToolCallIdNormalizer();
            const transformedMessages = transformMessages(context.messages, model, (id) => normalizeMistralToolCallId(id));
            let payload = buildChatPayload(model, context, transformedMessages, options);
            const nextPayload = await options?.onPayload?.(payload, model);
            if (nextPayload !== undefined) {
                payload = nextPayload;
            }
            const mistralStream = await mistral.chat.stream(payload, buildRequestOptions(model, options));
            stream.push({ type: "start", partial: output });
            await consumeChatStream(model, output, stream, mistralStream);
            if (options?.signal?.aborted) {
                throw new Error("Request was aborted");
            }
            if (output.stopReason === "aborted" || output.stopReason === "error") {
                throw new Error("An unknown error occurred");
            }
            stream.push({ type: "done", reason: output.stopReason, message: output });
            stream.end();
        }
        catch (error) {
            for (const block of output.content) {
                // partialArgs is only a streaming scratch buffer; never persist it.
                delete block.partialArgs;
            }
            output.stopReason = options?.signal?.aborted ? "aborted" : "error";
            output.errorMessage = formatMistralError(error);
            stream.push({ type: "error", reason: output.stopReason, error: output });
            stream.end();
        }
    })();
    return stream;
};
/**
 * Maps provider-agnostic `SimpleStreamOptions` to Mistral options.
 */
export const streamSimple = (model, context, options) => {
    const apiKey = options?.apiKey;
    if (!apiKey) {
        throw new Error(`No API key for provider: ${model.provider}`);
    }
    const base = buildBaseOptions(model, context, options, apiKey);
    const clampedReasoning = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
    const reasoning = clampedReasoning === "off" ? undefined : clampedReasoning;
    const shouldUseReasoning = model.reasoning && reasoning !== undefined;
    return stream(model, context, {
        ...base,
        promptMode: shouldUseReasoning && usesPromptModeReasoning(model) ? "reasoning" : undefined,
        reasoningEffort: shouldUseReasoning && usesReasoningEffort(model) ? mapReasoningEffort(model, reasoning) : undefined,
    });
};
function createOutput(model) {
    return {
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
}
function createMistralToolCallIdNormalizer() {
    const idMap = new Map();
    const reverseMap = new Map();
    return (id) => {
        const existing = idMap.get(id);
        if (existing)
            return existing;
        let attempt = 0;
        while (true) {
            const candidate = deriveMistralToolCallId(id, attempt);
            const owner = reverseMap.get(candidate);
            if (!owner || owner === id) {
                idMap.set(id, candidate);
                reverseMap.set(candidate, id);
                return candidate;
            }
            attempt++;
        }
    };
}
function deriveMistralToolCallId(id, attempt) {
    const normalized = id.replace(/[^a-zA-Z0-9]/g, "");
    if (attempt === 0 && normalized.length === MISTRAL_TOOL_CALL_ID_LENGTH)
        return normalized;
    const seedBase = normalized || id;
    const seed = attempt === 0 ? seedBase : `${seedBase}:${attempt}`;
    return shortHash(seed)
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, MISTRAL_TOOL_CALL_ID_LENGTH);
}
function formatMistralError(error) {
    if (error instanceof Error) {
        const sdkError = error;
        const statusCode = typeof sdkError.statusCode === "number" ? sdkError.statusCode : undefined;
        const bodyText = typeof sdkError.body === "string" ? sdkError.body.trim() : undefined;
        if (statusCode !== undefined && bodyText) {
            return `Mistral API error (${statusCode}): ${truncateErrorText(bodyText, MAX_MISTRAL_ERROR_BODY_CHARS)}`;
        }
        if (statusCode !== undefined)
            return `Mistral API error (${statusCode}): ${error.message}`;
        return error.message;
    }
    return safeJsonStringify(error);
}
function truncateErrorText(text, maxChars) {
    if (text.length <= maxChars)
        return text;
    return `${text.slice(0, maxChars)}... [truncated ${text.length - maxChars} chars]`;
}
function safeJsonStringify(value) {
    try {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? String(value) : serialized;
    }
    catch {
        return String(value);
    }
}
function buildRequestOptions(model, options) {
    const requestOptions = {
        retries: { strategy: "none" },
    };
    if (options?.signal)
        requestOptions.signal = options.signal;
    const headers = {};
    if (model.headers)
        Object.assign(headers, model.headers);
    if (options?.headers)
        Object.assign(headers, options.headers);
    // Mistral infrastructure uses `x-affinity` for KV-cache reuse (prefix caching).
    // Respect explicit caller-provided header values.
    if (shouldUsePromptCaching(options) && !headers["x-affinity"]) {
        headers["x-affinity"] = options.sessionId;
    }
    if (Object.keys(headers).length > 0) {
        requestOptions.headers = headers;
    }
    return requestOptions;
}
function buildChatPayload(model, context, messages, options) {
    const payload = {
        model: model.id,
        stream: true,
        messages: toChatMessages(messages, model.input.includes("image")),
    };
    if (context.tools?.length)
        payload.tools = toFunctionTools(context.tools);
    if (options?.temperature !== undefined)
        payload.temperature = options.temperature;
    if (options?.maxTokens !== undefined)
        payload.maxTokens = options.maxTokens;
    if (options?.toolChoice)
        payload.toolChoice = mapToolChoice(options.toolChoice);
    if (options?.promptMode)
        payload.promptMode = options.promptMode;
    if (options?.reasoningEffort)
        payload.reasoningEffort = options.reasoningEffort;
    if (shouldUsePromptCaching(options))
        payload.promptCacheKey = options.sessionId;
    if (context.systemPrompt) {
        payload.messages.unshift({
            role: "system",
            content: sanitizeSurrogates(context.systemPrompt),
        });
    }
    return payload;
}
function shouldUsePromptCaching(options) {
    return options?.cacheRetention !== "none" && !!options?.sessionId;
}
function getMistralCachedPromptTokens(usage, promptTokens) {
    const rawUsage = usage;
    const rawCachedTokens = rawUsage.promptTokensDetails?.cachedTokens ??
        rawUsage.prompt_tokens_details?.cached_tokens ??
        rawUsage.promptTokenDetails?.cachedTokens ??
        rawUsage.prompt_token_details?.cached_tokens ??
        rawUsage.numCachedTokens ??
        rawUsage.num_cached_tokens ??
        0;
    const cachedTokens = typeof rawCachedTokens === "number" && Number.isFinite(rawCachedTokens) ? rawCachedTokens : 0;
    return Math.min(promptTokens, Math.max(0, cachedTokens));
}
async function consumeChatStream(model, output, stream, mistralStream) {
    let currentBlock = null;
    const blocks = output.content;
    const blockIndex = () => blocks.length - 1;
    const toolBlocksByKey = new Map();
    const finishCurrentBlock = (block) => {
        if (!block)
            return;
        if (block.type === "text") {
            stream.push({
                type: "text_end",
                contentIndex: blockIndex(),
                content: block.text,
                partial: output,
            });
            return;
        }
        if (block.type === "thinking") {
            stream.push({
                type: "thinking_end",
                contentIndex: blockIndex(),
                content: block.thinking,
                partial: output,
            });
        }
    };
    for await (const event of mistralStream) {
        const chunk = event.data;
        // Mistral's streamed CompletionChunk carries an id field. Keep the first non-empty one,
        // mirroring how OpenAI-style streaming exposes a stable response identifier per stream.
        output.responseId ||= chunk.id;
        if (chunk.usage) {
            const promptTokens = chunk.usage.promptTokens || 0;
            const cachedPromptTokens = getMistralCachedPromptTokens(chunk.usage, promptTokens);
            output.usage.input = Math.max(0, promptTokens - cachedPromptTokens);
            output.usage.output = chunk.usage.completionTokens || 0;
            output.usage.cacheRead = cachedPromptTokens;
            output.usage.cacheWrite = 0;
            output.usage.totalTokens =
                chunk.usage.totalTokens ||
                    output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
            calculateCost(model, output.usage);
        }
        const choice = chunk.choices[0];
        if (!choice)
            continue;
        if (choice.finishReason) {
            output.stopReason = mapChatStopReason(choice.finishReason);
        }
        const delta = choice.delta;
        if (delta.content !== null && delta.content !== undefined) {
            const contentItems = typeof delta.content === "string" ? [delta.content] : delta.content;
            for (const item of contentItems) {
                if (typeof item === "string") {
                    const textDelta = sanitizeSurrogates(item);
                    if (!currentBlock || currentBlock.type !== "text") {
                        finishCurrentBlock(currentBlock);
                        currentBlock = { type: "text", text: "" };
                        output.content.push(currentBlock);
                        stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
                    }
                    currentBlock.text += textDelta;
                    stream.push({
                        type: "text_delta",
                        contentIndex: blockIndex(),
                        delta: textDelta,
                        partial: output,
                    });
                    continue;
                }
                if (item.type === "thinking") {
                    const deltaText = item.thinking
                        .map((part) => ("text" in part ? part.text : ""))
                        .filter((text) => text.length > 0)
                        .join("");
                    const thinkingDelta = sanitizeSurrogates(deltaText);
                    if (!thinkingDelta)
                        continue;
                    if (!currentBlock || currentBlock.type !== "thinking") {
                        finishCurrentBlock(currentBlock);
                        currentBlock = { type: "thinking", thinking: "" };
                        output.content.push(currentBlock);
                        stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
                    }
                    currentBlock.thinking += thinkingDelta;
                    stream.push({
                        type: "thinking_delta",
                        contentIndex: blockIndex(),
                        delta: thinkingDelta,
                        partial: output,
                    });
                    continue;
                }
                if (item.type === "text") {
                    const textDelta = sanitizeSurrogates(item.text);
                    if (!currentBlock || currentBlock.type !== "text") {
                        finishCurrentBlock(currentBlock);
                        currentBlock = { type: "text", text: "" };
                        output.content.push(currentBlock);
                        stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
                    }
                    currentBlock.text += textDelta;
                    stream.push({
                        type: "text_delta",
                        contentIndex: blockIndex(),
                        delta: textDelta,
                        partial: output,
                    });
                }
            }
        }
        const toolCalls = delta.toolCalls || [];
        for (const toolCall of toolCalls) {
            if (currentBlock) {
                finishCurrentBlock(currentBlock);
                currentBlock = null;
            }
            const callId = toolCall.id && toolCall.id !== "null"
                ? toolCall.id
                : deriveMistralToolCallId(`toolcall:${toolCall.index ?? 0}`, 0);
            const key = `${callId}:${toolCall.index || 0}`;
            const existingIndex = toolBlocksByKey.get(key);
            let block;
            if (existingIndex !== undefined) {
                const existing = output.content[existingIndex];
                if (existing?.type === "toolCall") {
                    block = existing;
                }
            }
            if (!block) {
                block = {
                    type: "toolCall",
                    id: callId,
                    name: toolCall.function.name,
                    arguments: {},
                    partialArgs: "",
                };
                output.content.push(block);
                toolBlocksByKey.set(key, output.content.length - 1);
                stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
            }
            const argsDelta = typeof toolCall.function.arguments === "string"
                ? toolCall.function.arguments
                : JSON.stringify(toolCall.function.arguments || {});
            block.partialArgs = (block.partialArgs || "") + argsDelta;
            block.arguments = parseStreamingJson(block.partialArgs);
            stream.push({
                type: "toolcall_delta",
                contentIndex: toolBlocksByKey.get(key),
                delta: argsDelta,
                partial: output,
            });
        }
    }
    finishCurrentBlock(currentBlock);
    for (const index of toolBlocksByKey.values()) {
        const block = output.content[index];
        if (block.type !== "toolCall")
            continue;
        const toolBlock = block;
        toolBlock.arguments = parseStreamingJson(toolBlock.partialArgs);
        // Finalize in-place and strip the scratch buffer so replay only
        // carries parsed arguments.
        delete toolBlock.partialArgs;
        stream.push({
            type: "toolcall_end",
            contentIndex: index,
            toolCall: toolBlock,
            partial: output,
        });
    }
}
function toFunctionTools(tools) {
    return tools.map((tool) => ({
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: stripSymbolKeys(tool.parameters),
            strict: false,
        },
    }));
}
function stripSymbolKeys(value) {
    if (Array.isArray(value)) {
        return value.map((item) => stripSymbolKeys(item));
    }
    if (value && typeof value === "object") {
        const result = {};
        for (const [key, entry] of Object.entries(value)) {
            result[key] = stripSymbolKeys(entry);
        }
        return result;
    }
    return value;
}
function toChatMessages(messages, supportsImages) {
    const result = [];
    for (const msg of messages) {
        if (msg.role === "user") {
            if (typeof msg.content === "string") {
                result.push({ role: "user", content: sanitizeSurrogates(msg.content) });
                continue;
            }
            const hadImages = msg.content.some((item) => item.type === "image");
            const content = msg.content
                .filter((item) => item.type === "text" || supportsImages)
                .map((item) => {
                if (item.type === "text")
                    return { type: "text", text: sanitizeSurrogates(item.text) };
                return { type: "image_url", imageUrl: `data:${item.mimeType};base64,${item.data}` };
            });
            if (content.length > 0) {
                result.push({ role: "user", content });
                continue;
            }
            if (hadImages && !supportsImages) {
                result.push({ role: "user", content: "(image omitted: model does not support images)" });
            }
            continue;
        }
        if (msg.role === "assistant") {
            const contentParts = [];
            const toolCalls = [];
            for (const block of msg.content) {
                if (block.type === "text") {
                    if (block.text.trim().length > 0) {
                        contentParts.push({ type: "text", text: sanitizeSurrogates(block.text) });
                    }
                    continue;
                }
                if (block.type === "thinking") {
                    if (block.thinking.trim().length > 0) {
                        contentParts.push({
                            type: "thinking",
                            thinking: [{ type: "text", text: sanitizeSurrogates(block.thinking) }],
                        });
                    }
                    continue;
                }
                toolCalls.push({
                    id: block.id,
                    type: "function",
                    function: { name: block.name, arguments: JSON.stringify(block.arguments || {}) },
                });
            }
            const assistantMessage = { role: "assistant" };
            if (contentParts.length > 0)
                assistantMessage.content = contentParts;
            if (toolCalls.length > 0)
                assistantMessage.toolCalls = toolCalls;
            if (contentParts.length > 0 || toolCalls.length > 0)
                result.push(assistantMessage);
            continue;
        }
        const toolContent = [];
        const textResult = msg.content
            .filter((part) => part.type === "text")
            .map((part) => (part.type === "text" ? sanitizeSurrogates(part.text) : ""))
            .join("\n");
        const hasImages = msg.content.some((part) => part.type === "image");
        const toolText = buildToolResultText(textResult, hasImages, supportsImages, msg.isError);
        toolContent.push({ type: "text", text: toolText });
        for (const part of msg.content) {
            if (!supportsImages)
                continue;
            if (part.type !== "image")
                continue;
            toolContent.push({
                type: "image_url",
                imageUrl: `data:${part.mimeType};base64,${part.data}`,
            });
        }
        result.push({
            role: "tool",
            toolCallId: msg.toolCallId,
            name: msg.toolName,
            content: toolContent,
        });
    }
    return result;
}
function buildToolResultText(text, hasImages, supportsImages, isError) {
    const trimmed = text.trim();
    const errorPrefix = isError ? "[tool error] " : "";
    if (trimmed.length > 0) {
        const imageSuffix = hasImages && !supportsImages ? "\n[tool image omitted: model does not support images]" : "";
        return `${errorPrefix}${trimmed}${imageSuffix}`;
    }
    if (hasImages) {
        if (supportsImages) {
            return isError ? "[tool error] (see attached image)" : "(see attached image)";
        }
        return isError
            ? "[tool error] (image omitted: model does not support images)"
            : "(image omitted: model does not support images)";
    }
    return isError ? "[tool error] (no tool output)" : "(no tool output)";
}
function usesReasoningEffort(model) {
    return model.id === "mistral-small-2603" || model.id === "mistral-small-latest" || model.id === "mistral-medium-3.5";
}
function usesPromptModeReasoning(model) {
    return model.reasoning && !usesReasoningEffort(model);
}
function mapReasoningEffort(model, level) {
    return (model.thinkingLevelMap?.[level] ?? "high");
}
function mapToolChoice(choice) {
    if (!choice)
        return undefined;
    if (choice === "auto" || choice === "none" || choice === "any" || choice === "required") {
        return choice;
    }
    return {
        type: "function",
        function: { name: choice.function.name },
    };
}
function mapChatStopReason(reason) {
    if (reason === null)
        return "stop";
    switch (reason) {
        case "stop":
            return "stop";
        case "length":
        case "model_length":
            return "length";
        case "tool_calls":
            return "toolUse";
        case "error":
            return "error";
        default:
            return "stop";
    }
}
//# sourceMappingURL=mistral-conversations.js.map