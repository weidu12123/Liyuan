import { convertToLlm, createBranchSummaryMessage, createCompactionSummaryMessage, createCustomMessage, } from "../messages.js";
import { BranchSummaryError, err, ok, SessionError } from "../types.js";
import { estimateTokens, SUMMARIZATION_SYSTEM_PROMPT } from "./compaction.js";
import { computeFileLists, createFileOps, extractFileOpsFromMessage, formatFileOperations, serializeConversation, } from "./utils.js";
/** Collect entries that should be summarized before navigating to a different session tree entry. */
export async function collectEntriesForBranchSummary(session, oldLeafId, targetId) {
    if (!oldLeafId) {
        return { entries: [], commonAncestorId: null };
    }
    const oldPath = new Set((await session.getBranch(oldLeafId)).map((e) => e.id));
    const targetPath = await session.getBranch(targetId);
    let commonAncestorId = null;
    for (let i = targetPath.length - 1; i >= 0; i--) {
        if (oldPath.has(targetPath[i].id)) {
            commonAncestorId = targetPath[i].id;
            break;
        }
    }
    const entries = [];
    let current = oldLeafId;
    while (current && current !== commonAncestorId) {
        const entry = await session.getEntry(current);
        if (!entry)
            throw new SessionError("invalid_session", `Entry ${current} not found`);
        entries.push(entry);
        current = entry.parentId;
    }
    entries.reverse();
    return { entries, commonAncestorId };
}
function getMessageFromEntry(entry) {
    switch (entry.type) {
        case "message":
            if (entry.message.role === "toolResult")
                return undefined;
            return entry.message;
        case "custom_message":
            return createCustomMessage(entry.customType, entry.content, entry.display, entry.details, entry.timestamp);
        case "branch_summary":
            return createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp);
        case "compaction":
            return createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp);
        case "thinking_level_change":
        case "model_change":
        case "active_tools_change":
        case "custom":
        case "label":
        case "session_info":
        case "leaf":
            return undefined;
    }
}
/** Prepare branch entries for summarization within an optional token budget. */
export function prepareBranchEntries(entries, tokenBudget = 0) {
    const messages = [];
    const fileOps = createFileOps();
    let totalTokens = 0;
    for (const entry of entries) {
        if (entry.type === "branch_summary" && !entry.fromHook && entry.details) {
            const details = entry.details;
            if (Array.isArray(details.readFiles)) {
                for (const f of details.readFiles)
                    fileOps.read.add(f);
            }
            if (Array.isArray(details.modifiedFiles)) {
                for (const f of details.modifiedFiles) {
                    fileOps.edited.add(f);
                }
            }
        }
    }
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        const message = getMessageFromEntry(entry);
        if (!message)
            continue;
        extractFileOpsFromMessage(message, fileOps);
        const tokens = estimateTokens(message);
        if (tokenBudget > 0 && totalTokens + tokens > tokenBudget) {
            if (entry.type === "compaction" || entry.type === "branch_summary") {
                if (totalTokens < tokenBudget * 0.9) {
                    messages.unshift(message);
                    totalTokens += tokens;
                }
            }
            break;
        }
        messages.unshift(message);
        totalTokens += tokens;
    }
    return { messages, fileOps, totalTokens };
}
const BRANCH_SUMMARY_PREAMBLE = `The user explored a different conversation branch before returning here.
Summary of that exploration:

`;
const BRANCH_SUMMARY_PROMPT = `Create a structured summary of this conversation branch for context when returning later.

Use this EXACT format:

## Goal
[What was the user trying to accomplish in this branch?]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Work that was started but not finished]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [What should happen next to continue this work]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;
/** Generate a summary for abandoned branch entries. */
export async function generateBranchSummary(entries, options) {
    const { models, model, signal, customInstructions, replaceInstructions, reserveTokens = 16384 } = options;
    const contextWindow = model.contextWindow || 128000;
    const tokenBudget = contextWindow - reserveTokens;
    const { messages, fileOps } = prepareBranchEntries(entries, tokenBudget);
    if (messages.length === 0) {
        return ok({ summary: "No content to summarize", readFiles: [], modifiedFiles: [] });
    }
    const llmMessages = convertToLlm(messages);
    const conversationText = serializeConversation(llmMessages);
    let instructions;
    if (replaceInstructions && customInstructions) {
        instructions = customInstructions;
    }
    else if (customInstructions) {
        instructions = `${BRANCH_SUMMARY_PROMPT}\n\nAdditional focus: ${customInstructions}`;
    }
    else {
        instructions = BRANCH_SUMMARY_PROMPT;
    }
    const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${instructions}`;
    const summarizationMessages = [
        {
            role: "user",
            content: [{ type: "text", text: promptText }],
            timestamp: Date.now(),
        },
    ];
    const response = await models.completeSimple(model, { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages }, { signal, maxTokens: 2048 });
    if (response.stopReason === "aborted") {
        return err(new BranchSummaryError("aborted", response.errorMessage || "Branch summary aborted"));
    }
    if (response.stopReason === "error") {
        return err(new BranchSummaryError("summarization_failed", `Branch summary failed: ${response.errorMessage || "Unknown error"}`));
    }
    let summary = response.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
    summary = BRANCH_SUMMARY_PREAMBLE + summary;
    const { readFiles, modifiedFiles } = computeFileLists(fileOps);
    summary += formatFileOperations(readFiles, modifiedFiles);
    return ok({
        summary: summary || "No summary generated",
        readFiles,
        modifiedFiles,
    });
}
//# sourceMappingURL=branch-summarization.js.map