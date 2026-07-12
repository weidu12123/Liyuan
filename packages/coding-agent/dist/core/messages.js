/**
 * Custom message types and transformers for the coding agent.
 *
 * Extends the base AgentMessage type with coding-agent specific message types,
 * and provides a transformer to convert them to LLM-compatible messages.
 */
export const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;
export const COMPACTION_SUMMARY_SUFFIX = `
</summary>`;
export const BRANCH_SUMMARY_PREFIX = `The following is a summary of a branch that this conversation came back from:

<summary>
`;
export const BRANCH_SUMMARY_SUFFIX = `</summary>`;
/**
 * Convert a BashExecutionMessage to user message text for LLM context.
 */
export function bashExecutionToText(msg) {
    let text = `Ran \`${msg.command}\`\n`;
    if (msg.output) {
        text += `\`\`\`\n${msg.output}\n\`\`\``;
    }
    else {
        text += "(no output)";
    }
    if (msg.cancelled) {
        text += "\n\n(command cancelled)";
    }
    else if (msg.exitCode !== null && msg.exitCode !== undefined && msg.exitCode !== 0) {
        text += `\n\nCommand exited with code ${msg.exitCode}`;
    }
    if (msg.truncated && msg.fullOutputPath) {
        text += `\n\n[Output truncated. Full output: ${msg.fullOutputPath}]`;
    }
    return text;
}
export function createBranchSummaryMessage(summary, fromId, timestamp) {
    return {
        role: "branchSummary",
        summary,
        fromId,
        timestamp: new Date(timestamp).getTime(),
    };
}
export function createCompactionSummaryMessage(summary, tokensBefore, timestamp) {
    return {
        role: "compactionSummary",
        summary: summary,
        tokensBefore,
        timestamp: new Date(timestamp).getTime(),
    };
}
/** Convert CustomMessageEntry to AgentMessage format */
export function createCustomMessage(customType, content, display, details, timestamp) {
    return {
        role: "custom",
        customType,
        content,
        display,
        details,
        timestamp: new Date(timestamp).getTime(),
    };
}
/**
 * Transform AgentMessages (including custom types) to LLM-compatible Messages.
 *
 * This is used by:
 * - Agent's transormToLlm option (for prompt calls and queued messages)
 * - Compaction's generateSummary (for summarization)
 * - Custom extensions and tools
 */
export function convertToLlm(messages) {
    return messages
        .map((m) => {
        switch (m.role) {
            case "bashExecution":
                // Skip messages excluded from context (!! prefix)
                if (m.excludeFromContext) {
                    return undefined;
                }
                return {
                    role: "user",
                    content: [{ type: "text", text: bashExecutionToText(m) }],
                    timestamp: m.timestamp,
                };
            case "custom": {
                const content = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
                return {
                    role: "user",
                    content,
                    timestamp: m.timestamp,
                };
            }
            case "branchSummary":
                return {
                    role: "user",
                    content: [{ type: "text", text: BRANCH_SUMMARY_PREFIX + m.summary + BRANCH_SUMMARY_SUFFIX }],
                    timestamp: m.timestamp,
                };
            case "compactionSummary":
                return {
                    role: "user",
                    content: [
                        { type: "text", text: COMPACTION_SUMMARY_PREFIX + m.summary + COMPACTION_SUMMARY_SUFFIX },
                    ],
                    timestamp: m.timestamp,
                };
            case "user":
            case "assistant":
            case "toolResult":
                return m;
            default:
                // biome-ignore lint/correctness/noSwitchDeclarations: fine
                const _exhaustiveCheck = m;
                return undefined;
        }
    })
        .filter((m) => m !== undefined);
}
//# sourceMappingURL=messages.js.map