import { createBranchSummaryMessage, createCompactionSummaryMessage, createCustomMessage } from "../messages.js";
import { SessionError } from "../types.js";
export function buildSessionContext(pathEntries) {
    let thinkingLevel = "off";
    let model = null;
    let activeToolNames = null;
    let compaction = null;
    for (const entry of pathEntries) {
        if (entry.type === "thinking_level_change") {
            thinkingLevel = entry.thinkingLevel;
        }
        else if (entry.type === "model_change") {
            model = { provider: entry.provider, modelId: entry.modelId };
        }
        else if (entry.type === "message" && entry.message.role === "assistant") {
            model = { provider: entry.message.provider, modelId: entry.message.model };
        }
        else if (entry.type === "active_tools_change") {
            activeToolNames = [...entry.activeToolNames];
        }
        else if (entry.type === "compaction") {
            compaction = entry;
        }
    }
    const messages = [];
    const appendMessage = (entry) => {
        if (entry.type === "message") {
            messages.push(entry.message);
        }
        else if (entry.type === "custom_message") {
            messages.push(createCustomMessage(entry.customType, entry.content, entry.display, entry.details, entry.timestamp));
        }
        else if (entry.type === "branch_summary" && entry.summary) {
            messages.push(createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp));
        }
    };
    if (compaction) {
        messages.push(createCompactionSummaryMessage(compaction.summary, compaction.tokensBefore, compaction.timestamp));
        const compactionIdx = pathEntries.findIndex((e) => e.type === "compaction" && e.id === compaction.id);
        let foundFirstKept = false;
        for (let i = 0; i < compactionIdx; i++) {
            const entry = pathEntries[i];
            if (entry.id === compaction.firstKeptEntryId)
                foundFirstKept = true;
            if (foundFirstKept)
                appendMessage(entry);
        }
        for (let i = compactionIdx + 1; i < pathEntries.length; i++) {
            appendMessage(pathEntries[i]);
        }
    }
    else {
        for (const entry of pathEntries) {
            appendMessage(entry);
        }
    }
    return { messages, thinkingLevel, model, activeToolNames };
}
export class Session {
    storage;
    constructor(storage) {
        this.storage = storage;
    }
    getMetadata() {
        return this.storage.getMetadata();
    }
    getStorage() {
        return this.storage;
    }
    getLeafId() {
        return this.storage.getLeafId();
    }
    getEntry(id) {
        return this.storage.getEntry(id);
    }
    getEntries() {
        return this.storage.getEntries();
    }
    async getBranch(fromId) {
        const leafId = fromId ?? (await this.storage.getLeafId());
        return this.storage.getPathToRoot(leafId);
    }
    async buildContext() {
        return buildSessionContext(await this.getBranch());
    }
    getLabel(id) {
        return this.storage.getLabel(id);
    }
    async getSessionName() {
        const entries = await this.storage.findEntries("session_info");
        return entries[entries.length - 1]?.name?.trim() || undefined;
    }
    async appendTypedEntry(entry) {
        await this.storage.appendEntry(entry);
        return entry.id;
    }
    async appendMessage(message) {
        return this.appendTypedEntry({
            type: "message",
            id: await this.storage.createEntryId(),
            parentId: await this.storage.getLeafId(),
            timestamp: new Date().toISOString(),
            message,
        });
    }
    async appendThinkingLevelChange(thinkingLevel) {
        return this.appendTypedEntry({
            type: "thinking_level_change",
            id: await this.storage.createEntryId(),
            parentId: await this.storage.getLeafId(),
            timestamp: new Date().toISOString(),
            thinkingLevel,
        });
    }
    async appendModelChange(provider, modelId) {
        return this.appendTypedEntry({
            type: "model_change",
            id: await this.storage.createEntryId(),
            parentId: await this.storage.getLeafId(),
            timestamp: new Date().toISOString(),
            provider,
            modelId,
        });
    }
    async appendActiveToolsChange(activeToolNames) {
        return this.appendTypedEntry({
            type: "active_tools_change",
            id: await this.storage.createEntryId(),
            parentId: await this.storage.getLeafId(),
            timestamp: new Date().toISOString(),
            activeToolNames: [...activeToolNames],
        });
    }
    async appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromHook) {
        return this.appendTypedEntry({
            type: "compaction",
            id: await this.storage.createEntryId(),
            parentId: await this.storage.getLeafId(),
            timestamp: new Date().toISOString(),
            summary,
            firstKeptEntryId,
            tokensBefore,
            details,
            fromHook,
        });
    }
    async appendCustomEntry(customType, data) {
        return this.appendTypedEntry({
            type: "custom",
            id: await this.storage.createEntryId(),
            parentId: await this.storage.getLeafId(),
            timestamp: new Date().toISOString(),
            customType,
            data,
        });
    }
    async appendCustomMessageEntry(customType, content, display, details) {
        return this.appendTypedEntry({
            type: "custom_message",
            id: await this.storage.createEntryId(),
            parentId: await this.storage.getLeafId(),
            timestamp: new Date().toISOString(),
            customType,
            content,
            display,
            details,
        });
    }
    async appendLabel(targetId, label) {
        if (!(await this.storage.getEntry(targetId))) {
            throw new SessionError("not_found", `Entry ${targetId} not found`);
        }
        return this.appendTypedEntry({
            type: "label",
            id: await this.storage.createEntryId(),
            parentId: await this.storage.getLeafId(),
            timestamp: new Date().toISOString(),
            targetId,
            label,
        });
    }
    async appendSessionName(name) {
        const sanitizedName = name.replace(/[\r\n]+/g, " ").trim();
        return this.appendTypedEntry({
            type: "session_info",
            id: await this.storage.createEntryId(),
            parentId: await this.storage.getLeafId(),
            timestamp: new Date().toISOString(),
            name: sanitizedName,
        });
    }
    async moveTo(entryId, summary) {
        if (entryId !== null && !(await this.storage.getEntry(entryId))) {
            throw new SessionError("not_found", `Entry ${entryId} not found`);
        }
        await this.storage.setLeafId(entryId);
        if (!summary)
            return undefined;
        return this.appendTypedEntry({
            type: "branch_summary",
            id: await this.storage.createEntryId(),
            parentId: entryId,
            timestamp: new Date().toISOString(),
            fromId: entryId ?? "root",
            summary: summary.summary,
            details: summary.details,
            fromHook: summary.fromHook,
        });
    }
}
//# sourceMappingURL=session.js.map