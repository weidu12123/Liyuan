import { calculateCost } from "../models.js";
import { shortHash } from "../utils/hash.js";
import { parseStreamingJson } from "../utils/json-parse.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import { transformMessages } from "./transform-messages.js";
// =============================================================================
// Utilities
// =============================================================================
function encodeTextSignatureV1(id, phase) {
    const payload = { v: 1, id };
    if (phase)
        payload.phase = phase;
    return JSON.stringify(payload);
}
function parseTextSignature(signature) {
    if (!signature)
        return undefined;
    if (signature.startsWith("{")) {
        try {
            const parsed = JSON.parse(signature);
            if (parsed.v === 1 && typeof parsed.id === "string") {
                if (parsed.phase === "commentary" || parsed.phase === "final_answer") {
                    return { id: parsed.id, phase: parsed.phase };
                }
                return { id: parsed.id };
            }
        }
        catch {
            // Fall through to legacy plain-string handling.
        }
    }
    return { id: signature };
}
// =============================================================================
// Message conversion
// =============================================================================
export function convertResponsesMessages(model, context, allowedToolCallProviders, options) {
    const messages = [];
    const normalizeIdPart = (part) => {
        const sanitized = part.replace(/[^a-zA-Z0-9_-]/g, "_");
        const normalized = sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized;
        return normalized.replace(/_+$/, "");
    };
    const buildForeignResponsesItemId = (itemId) => {
        const normalized = `fc_${shortHash(itemId)}`;
        return normalized.length > 64 ? normalized.slice(0, 64) : normalized;
    };
    const normalizeToolCallId = (id, _targetModel, source) => {
        if (!allowedToolCallProviders.has(model.provider))
            return normalizeIdPart(id);
        if (!id.includes("|"))
            return normalizeIdPart(id);
        const [callId, itemId] = id.split("|");
        const normalizedCallId = normalizeIdPart(callId);
        const isForeignToolCall = source.provider !== model.provider || source.api !== model.api;
        let normalizedItemId = isForeignToolCall ? buildForeignResponsesItemId(itemId) : normalizeIdPart(itemId);
        // OpenAI Responses API requires item id to start with "fc"
        if (!normalizedItemId.startsWith("fc_")) {
            normalizedItemId = normalizeIdPart(`fc_${normalizedItemId}`);
        }
        return `${normalizedCallId}|${normalizedItemId}`;
    };
    const transformedMessages = transformMessages(context.messages, model, normalizeToolCallId);
    const includeSystemPrompt = options?.includeSystemPrompt ?? true;
    if (includeSystemPrompt && context.systemPrompt) {
        const compat = model.compat;
        const role = model.reasoning && compat?.supportsDeveloperRole !== false ? "developer" : "system";
        messages.push({
            role,
            content: sanitizeSurrogates(context.systemPrompt),
        });
    }
    let msgIndex = 0;
    for (const msg of transformedMessages) {
        if (msg.role === "user") {
            if (typeof msg.content === "string") {
                messages.push({
                    role: "user",
                    content: [{ type: "input_text", text: sanitizeSurrogates(msg.content) }],
                });
            }
            else {
                const content = msg.content.map((item) => {
                    if (item.type === "text") {
                        return {
                            type: "input_text",
                            text: sanitizeSurrogates(item.text),
                        };
                    }
                    return {
                        type: "input_image",
                        detail: "auto",
                        image_url: `data:${item.mimeType};base64,${item.data}`,
                    };
                });
                if (content.length === 0)
                    continue;
                messages.push({
                    role: "user",
                    content,
                });
            }
        }
        else if (msg.role === "assistant") {
            const output = [];
            const assistantMsg = msg;
            const isDifferentModel = assistantMsg.model !== model.id &&
                assistantMsg.provider === model.provider &&
                assistantMsg.api === model.api;
            let textBlockIndex = 0;
            for (const block of msg.content) {
                if (block.type === "thinking") {
                    if (block.thinkingSignature) {
                        const reasoningItem = JSON.parse(block.thinkingSignature);
                        output.push(reasoningItem);
                    }
                }
                else if (block.type === "text") {
                    const textBlock = block;
                    const parsedSignature = parseTextSignature(textBlock.textSignature);
                    const fallbackMessageId = textBlockIndex === 0 ? `msg_pi_${msgIndex}` : `msg_pi_${msgIndex}_${textBlockIndex}`;
                    textBlockIndex++;
                    // OpenAI requires id to be max 64 characters
                    let msgId = parsedSignature?.id;
                    if (!msgId) {
                        msgId = fallbackMessageId;
                    }
                    else if (msgId.length > 64) {
                        msgId = `msg_${shortHash(msgId)}`;
                    }
                    output.push({
                        type: "message",
                        role: "assistant",
                        content: [{ type: "output_text", text: sanitizeSurrogates(textBlock.text), annotations: [] }],
                        status: "completed",
                        id: msgId,
                        phase: parsedSignature?.phase,
                    });
                }
                else if (block.type === "toolCall") {
                    const toolCall = block;
                    const [callId, itemIdRaw] = toolCall.id.split("|");
                    let itemId = itemIdRaw;
                    // For different-model messages, set id to undefined to avoid pairing validation.
                    // OpenAI tracks which fc_xxx IDs were paired with rs_xxx reasoning items.
                    // By omitting the id, we avoid triggering that validation (like cross-provider does).
                    if (isDifferentModel && itemId?.startsWith("fc_")) {
                        itemId = undefined;
                    }
                    output.push({
                        type: "function_call",
                        id: itemId,
                        call_id: callId,
                        name: toolCall.name,
                        arguments: JSON.stringify(toolCall.arguments),
                    });
                }
            }
            if (output.length === 0)
                continue;
            messages.push(...output);
        }
        else if (msg.role === "toolResult") {
            const textResult = msg.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n");
            const hasImages = msg.content.some((c) => c.type === "image");
            const hasText = textResult.length > 0;
            const [callId] = msg.toolCallId.split("|");
            let output;
            if (hasImages && model.input.includes("image")) {
                const contentParts = [];
                if (hasText) {
                    contentParts.push({
                        type: "input_text",
                        text: sanitizeSurrogates(textResult),
                    });
                }
                for (const block of msg.content) {
                    if (block.type === "image") {
                        contentParts.push({
                            type: "input_image",
                            detail: "auto",
                            image_url: `data:${block.mimeType};base64,${block.data}`,
                        });
                    }
                }
                output = contentParts;
            }
            else {
                output = sanitizeSurrogates(hasText ? textResult : "(see attached image)");
            }
            messages.push({
                type: "function_call_output",
                call_id: callId,
                output,
            });
        }
        msgIndex++;
    }
    return messages;
}
// =============================================================================
// Tool conversion
// =============================================================================
export function convertResponsesTools(tools, options) {
    const strict = options?.strict === undefined ? false : options.strict;
    return tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters, // TypeBox already generates JSON Schema
        strict,
    }));
}
export async function processResponsesStream(openaiStream, output, stream, model, options) {
    let sawTerminalResponseEvent = false;
    const outputSlots = new Map();
    const getSlot = (outputIndex, type) => {
        const slot = outputSlots.get(outputIndex);
        return slot?.type === type ? slot : undefined;
    };
    const createSlot = (outputIndex, item) => {
        if (item.type === "reasoning") {
            const block = { type: "thinking", thinking: "" };
            output.content.push(block);
            const slot = {
                type: "thinking",
                block,
                contentIndex: output.content.length - 1,
            };
            outputSlots.set(outputIndex, slot);
            stream.push({ type: "thinking_start", contentIndex: slot.contentIndex, partial: output });
            return slot;
        }
        if (item.type === "message") {
            const block = { type: "text", text: "" };
            output.content.push(block);
            const slot = { type: "text", block, contentIndex: output.content.length - 1 };
            outputSlots.set(outputIndex, slot);
            stream.push({ type: "text_start", contentIndex: slot.contentIndex, partial: output });
            return slot;
        }
        if (item.type === "function_call") {
            const block = {
                type: "toolCall",
                id: `${item.call_id}|${item.id}`,
                name: item.name,
                arguments: {},
                partialJson: item.arguments || "",
            };
            output.content.push(block);
            const slot = {
                type: "toolCall",
                block,
                contentIndex: output.content.length - 1,
            };
            outputSlots.set(outputIndex, slot);
            stream.push({ type: "toolcall_start", contentIndex: slot.contentIndex, partial: output });
            return slot;
        }
        return undefined;
    };
    const getOrCreateSlot = (outputIndex, item) => {
        return outputSlots.get(outputIndex) ?? createSlot(outputIndex, item);
    };
    const finalizeResponse = (response) => {
        sawTerminalResponseEvent = true;
        if (response?.id) {
            output.responseId = response.id;
        }
        if (response?.usage) {
            const cachedTokens = response.usage.input_tokens_details?.cached_tokens || 0;
            output.usage = {
                // OpenAI includes cached tokens in input_tokens, so subtract to get non-cached input
                input: (response.usage.input_tokens || 0) - cachedTokens,
                output: response.usage.output_tokens || 0,
                cacheRead: cachedTokens,
                cacheWrite: 0,
                reasoning: response.usage.output_tokens_details?.reasoning_tokens || 0,
                totalTokens: response.usage.total_tokens || 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            };
        }
        calculateCost(model, output.usage);
        if (options?.applyServiceTierPricing) {
            const serviceTier = options.resolveServiceTier
                ? options.resolveServiceTier(response?.service_tier, options.serviceTier)
                : (response?.service_tier ?? options.serviceTier);
            options.applyServiceTierPricing(output.usage, serviceTier);
        }
        // Map status to stop reason
        output.stopReason = mapStopReason(response?.status);
        if (output.content.some((b) => b.type === "toolCall") && output.stopReason === "stop") {
            output.stopReason = "toolUse";
        }
    };
    for await (const event of openaiStream) {
        if (event.type === "response.created") {
            output.responseId = event.response.id;
        }
        else if (event.type === "response.output_item.added") {
            createSlot(event.output_index, event.item);
        }
        else if (event.type === "response.reasoning_summary_text.delta") {
            const slot = getSlot(event.output_index, "thinking");
            if (!slot)
                continue;
            slot.block.thinking += event.delta;
            stream.push({
                type: "thinking_delta",
                contentIndex: slot.contentIndex,
                delta: event.delta,
                partial: output,
            });
        }
        else if (event.type === "response.reasoning_summary_part.done") {
            const slot = getSlot(event.output_index, "thinking");
            if (!slot)
                continue;
            slot.block.thinking += "\n\n";
            stream.push({
                type: "thinking_delta",
                contentIndex: slot.contentIndex,
                delta: "\n\n",
                partial: output,
            });
        }
        else if (event.type === "response.reasoning_text.delta") {
            const slot = getSlot(event.output_index, "thinking");
            if (!slot)
                continue;
            slot.block.thinking += event.delta;
            stream.push({
                type: "thinking_delta",
                contentIndex: slot.contentIndex,
                delta: event.delta,
                partial: output,
            });
        }
        else if (event.type === "response.output_text.delta") {
            const slot = getSlot(event.output_index, "text");
            if (!slot)
                continue;
            slot.block.text += event.delta;
            stream.push({
                type: "text_delta",
                contentIndex: slot.contentIndex,
                delta: event.delta,
                partial: output,
            });
        }
        else if (event.type === "response.refusal.delta") {
            const slot = getSlot(event.output_index, "text");
            if (!slot)
                continue;
            slot.block.text += event.delta;
            stream.push({
                type: "text_delta",
                contentIndex: slot.contentIndex,
                delta: event.delta,
                partial: output,
            });
        }
        else if (event.type === "response.function_call_arguments.delta") {
            const slot = getSlot(event.output_index, "toolCall");
            if (!slot)
                continue;
            slot.block.partialJson += event.delta;
            slot.block.arguments = parseStreamingJson(slot.block.partialJson);
            stream.push({
                type: "toolcall_delta",
                contentIndex: slot.contentIndex,
                delta: event.delta,
                partial: output,
            });
        }
        else if (event.type === "response.function_call_arguments.done") {
            const slot = getSlot(event.output_index, "toolCall");
            if (!slot)
                continue;
            const previousPartialJson = slot.block.partialJson;
            slot.block.partialJson = event.arguments;
            slot.block.arguments = parseStreamingJson(slot.block.partialJson);
            if (event.arguments.startsWith(previousPartialJson)) {
                const delta = event.arguments.slice(previousPartialJson.length);
                if (delta.length > 0) {
                    stream.push({
                        type: "toolcall_delta",
                        contentIndex: slot.contentIndex,
                        delta,
                        partial: output,
                    });
                }
            }
        }
        else if (event.type === "response.output_item.done") {
            const item = event.item;
            const slot = getOrCreateSlot(event.output_index, item);
            if (item.type === "reasoning" && slot?.type === "thinking") {
                const summaryText = item.summary?.map((s) => s.text).join("\n\n") || "";
                const contentText = item.content?.map((c) => c.text).join("\n\n") || "";
                slot.block.thinking = summaryText || contentText || slot.block.thinking;
                slot.block.thinkingSignature = JSON.stringify(item);
                stream.push({
                    type: "thinking_end",
                    contentIndex: slot.contentIndex,
                    content: slot.block.thinking,
                    partial: output,
                });
                outputSlots.delete(event.output_index);
            }
            else if (item.type === "message" && slot?.type === "text") {
                slot.block.text = item.content?.map((c) => (c.type === "output_text" ? c.text : c.refusal)).join("") || "";
                slot.block.textSignature = encodeTextSignatureV1(item.id, item.phase ?? undefined);
                stream.push({
                    type: "text_end",
                    contentIndex: slot.contentIndex,
                    content: slot.block.text,
                    partial: output,
                });
                outputSlots.delete(event.output_index);
            }
            else if (item.type === "function_call" && slot?.type === "toolCall") {
                slot.block.arguments = parseStreamingJson(item.arguments || slot.block.partialJson || "{}");
                // Finalize in-place and strip the scratch buffer so replay only
                // carries parsed arguments.
                delete slot.block.partialJson;
                stream.push({
                    type: "toolcall_end",
                    contentIndex: slot.contentIndex,
                    toolCall: slot.block,
                    partial: output,
                });
                outputSlots.delete(event.output_index);
            }
        }
        else if (event.type === "response.completed" || event.type === "response.incomplete") {
            finalizeResponse(event.response);
        }
        else if (event.type === "error") {
            throw new Error(`Error Code ${event.code}: ${event.message}` || "Unknown error");
        }
        else if (event.type === "response.failed") {
            sawTerminalResponseEvent = true;
            const error = event.response?.error;
            const details = event.response?.incomplete_details;
            const msg = error
                ? `${error.code || "unknown"}: ${error.message || "no message"}`
                : details?.reason
                    ? `incomplete: ${details.reason}`
                    : "Unknown error (no error details in response)";
            throw new Error(msg);
        }
    }
    if (!sawTerminalResponseEvent) {
        throw new Error("OpenAI Responses stream ended before a terminal response event");
    }
}
function mapStopReason(status) {
    if (!status)
        return "stop";
    switch (status) {
        case "completed":
            return "stop";
        case "incomplete":
            return "length";
        case "failed":
        case "cancelled":
            return "error";
        // These two are wonky ...
        case "in_progress":
        case "queued":
            return "stop";
        default: {
            const _exhaustive = status;
            throw new Error(`Unhandled stop reason: ${_exhaustive}`);
        }
    }
}
//# sourceMappingURL=openai-responses-shared.js.map