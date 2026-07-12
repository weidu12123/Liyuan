export const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;
export const COMPACTION_SUMMARY_SUFFIX = `
</summary>`;
export const BRANCH_SUMMARY_PREFIX = `The following is a summary of a branch that this conversation came back from:

<summary>
`;
export const BRANCH_SUMMARY_SUFFIX = `</summary>`;
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
        summary,
        tokensBefore,
        timestamp: new Date(timestamp).getTime(),
    };
}
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
export function convertToLlm(messages) {
    return messages
        .map((m) => {
        switch (m.role) {
            case "bashExecution":
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
                return undefined;
        }
    })
        .filter((m) => m !== undefined);
}
//# sourceMappingURL=messages.js.map