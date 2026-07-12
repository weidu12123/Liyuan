/** Create an empty file-operation accumulator. */
export function createFileOps() {
    return {
        read: new Set(),
        written: new Set(),
        edited: new Set(),
    };
}
/** Add file operations from assistant tool calls to an accumulator. */
export function extractFileOpsFromMessage(message, fileOps) {
    if (message.role !== "assistant")
        return;
    if (!("content" in message) || !Array.isArray(message.content))
        return;
    for (const block of message.content) {
        if (typeof block !== "object" || block === null)
            continue;
        if (!("type" in block) || block.type !== "toolCall")
            continue;
        if (!("arguments" in block) || !("name" in block))
            continue;
        const args = block.arguments;
        if (!args)
            continue;
        const path = typeof args.path === "string" ? args.path : undefined;
        if (!path)
            continue;
        switch (block.name) {
            case "read":
                fileOps.read.add(path);
                break;
            case "write":
                fileOps.written.add(path);
                break;
            case "edit":
                fileOps.edited.add(path);
                break;
        }
    }
}
/** Compute sorted read-only and modified file lists from accumulated operations. */
export function computeFileLists(fileOps) {
    const modified = new Set([...fileOps.edited, ...fileOps.written]);
    const readOnly = [...fileOps.read].filter((f) => !modified.has(f)).sort();
    const modifiedFiles = [...modified].sort();
    return { readFiles: readOnly, modifiedFiles };
}
/** Format file lists as summary metadata tags. */
export function formatFileOperations(readFiles, modifiedFiles) {
    const sections = [];
    if (readFiles.length > 0) {
        sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
    }
    if (modifiedFiles.length > 0) {
        sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
    }
    if (sections.length === 0)
        return "";
    return `\n\n${sections.join("\n\n")}`;
}
const TOOL_RESULT_MAX_CHARS = 2000;
function safeJsonStringify(value) {
    try {
        return JSON.stringify(value) ?? "undefined";
    }
    catch {
        return "[unserializable]";
    }
}
function truncateForSummary(text, maxChars) {
    if (text.length <= maxChars)
        return text;
    const truncatedChars = text.length - maxChars;
    return `${text.slice(0, maxChars)}\n\n[... ${truncatedChars} more characters truncated]`;
}
/** Serialize LLM messages to plain text for summarization prompts. */
export function serializeConversation(messages) {
    const parts = [];
    for (const msg of messages) {
        if (msg.role === "user") {
            const content = typeof msg.content === "string"
                ? msg.content
                : msg.content
                    .filter((c) => c.type === "text")
                    .map((c) => c.text)
                    .join("");
            if (content)
                parts.push(`[User]: ${content}`);
        }
        else if (msg.role === "assistant") {
            const textParts = [];
            const thinkingParts = [];
            const toolCalls = [];
            for (const block of msg.content) {
                if (block.type === "text") {
                    textParts.push(block.text);
                }
                else if (block.type === "thinking") {
                    thinkingParts.push(block.thinking);
                }
                else if (block.type === "toolCall") {
                    const args = block.arguments;
                    const argsStr = Object.entries(args)
                        .map(([k, v]) => `${k}=${safeJsonStringify(v)}`)
                        .join(", ");
                    toolCalls.push(`${block.name}(${argsStr})`);
                }
            }
            if (thinkingParts.length > 0) {
                parts.push(`[Assistant thinking]: ${thinkingParts.join("\n")}`);
            }
            if (textParts.length > 0) {
                parts.push(`[Assistant]: ${textParts.join("\n")}`);
            }
            if (toolCalls.length > 0) {
                parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
            }
        }
        else if (msg.role === "toolResult") {
            const content = msg.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("");
            if (content) {
                parts.push(`[Tool result]: ${truncateForSummary(content, TOOL_RESULT_MAX_CHARS)}`);
            }
        }
    }
    return parts.join("\n\n");
}
//# sourceMappingURL=utils.js.map