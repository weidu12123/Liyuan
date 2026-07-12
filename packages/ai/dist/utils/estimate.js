const CHARS_PER_TOKEN = 4;
const ESTIMATED_IMAGE_CHARS = 4800;
export function calculateContextTokens(usage) {
    return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}
function safeJsonStringify(value) {
    try {
        return JSON.stringify(value) ?? "undefined";
    }
    catch {
        return "[unserializable]";
    }
}
function estimateTextAndImageContentChars(content) {
    if (typeof content === "string")
        return content.length;
    let chars = 0;
    for (const block of content)
        chars += block.type === "text" ? block.text.length : ESTIMATED_IMAGE_CHARS;
    return chars;
}
export function estimateTextTokens(text) {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}
export function estimateTextAndImageContentTokens(content) {
    return Math.ceil(estimateTextAndImageContentChars(content) / CHARS_PER_TOKEN);
}
export function estimateMessageTokens(message) {
    let chars = 0;
    if (message.role === "user")
        return estimateTextAndImageContentTokens(message.content);
    if (message.role === "toolResult")
        return estimateTextAndImageContentTokens(message.content);
    for (const block of message.content) {
        if (block.type === "text") {
            chars += block.text.length;
        }
        else if (block.type === "thinking") {
            chars += block.thinking.length;
        }
        else {
            chars += block.name.length + safeJsonStringify(block.arguments).length;
        }
    }
    return Math.ceil(chars / CHARS_PER_TOKEN);
}
function getLastAssistantUsageInfo(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message.role !== "assistant")
            continue;
        const assistant = message;
        if (assistant.stopReason === "aborted" || assistant.stopReason === "error")
            continue;
        if (calculateContextTokens(assistant.usage) > 0)
            return { usage: assistant.usage, index: i };
    }
    return undefined;
}
function estimateMessages(messages) {
    const usageInfo = getLastAssistantUsageInfo(messages);
    if (usageInfo) {
        const usageTokens = calculateContextTokens(usageInfo.usage);
        let trailingTokens = 0;
        for (let i = usageInfo.index + 1; i < messages.length; i++) {
            trailingTokens += estimateMessageTokens(messages[i]);
        }
        return { tokens: usageTokens + trailingTokens, usageTokens, trailingTokens, lastUsageIndex: usageInfo.index };
    }
    let tokens = 0;
    for (const message of messages)
        tokens += estimateMessageTokens(message);
    return { tokens, usageTokens: 0, trailingTokens: tokens, lastUsageIndex: null };
}
function isMessageArray(value) {
    return Array.isArray(value);
}
export function estimateContextTokens(context) {
    if (isMessageArray(context))
        return estimateMessages(context);
    const estimate = estimateMessages(context.messages);
    if (estimate.lastUsageIndex !== null)
        return estimate;
    let prefixTokens = context.systemPrompt ? estimateTextTokens(context.systemPrompt) : 0;
    if (context.tools && context.tools.length > 0) {
        prefixTokens += estimateTextTokens(safeJsonStringify(context.tools));
    }
    return {
        tokens: estimate.tokens + prefixTokens,
        usageTokens: estimate.usageTokens,
        trailingTokens: estimate.trailingTokens + prefixTokens,
        lastUsageIndex: estimate.lastUsageIndex,
    };
}
//# sourceMappingURL=estimate.js.map