import { SessionError, } from "../types.js";
import { uuidv7 } from "./uuid.js";
function updateLabelCache(labelsById, entry) {
    if (entry.type !== "label")
        return;
    const label = entry.label?.trim();
    if (label) {
        labelsById.set(entry.targetId, label);
    }
    else {
        labelsById.delete(entry.targetId);
    }
}
function buildLabelsById(entries) {
    const labelsById = new Map();
    for (const entry of entries) {
        updateLabelCache(labelsById, entry);
    }
    return labelsById;
}
function generateEntryId(byId) {
    for (let i = 0; i < 100; i++) {
        const id = uuidv7().slice(0, 8);
        if (!byId.has(id))
            return id;
    }
    return uuidv7();
}
function leafIdAfterEntry(entry) {
    return entry.type === "leaf" ? entry.targetId : entry.id;
}
export class InMemorySessionStorage {
    metadata;
    entries;
    byId;
    labelsById;
    leafId;
    constructor(options) {
        this.entries = options?.entries ? [...options.entries] : [];
        this.byId = new Map(this.entries.map((entry) => [entry.id, entry]));
        this.labelsById = buildLabelsById(this.entries);
        this.leafId = null;
        for (const entry of this.entries)
            this.leafId = leafIdAfterEntry(entry);
        if (this.leafId !== null && !this.byId.has(this.leafId)) {
            throw new SessionError("invalid_session", `Entry ${this.leafId} not found`);
        }
        this.metadata = options?.metadata ?? { id: uuidv7(), createdAt: new Date().toISOString() };
    }
    async getMetadata() {
        return this.metadata;
    }
    async getLeafId() {
        if (this.leafId !== null && !this.byId.has(this.leafId)) {
            throw new SessionError("invalid_session", `Entry ${this.leafId} not found`);
        }
        return this.leafId;
    }
    async setLeafId(leafId) {
        if (leafId !== null && !this.byId.has(leafId)) {
            throw new SessionError("not_found", `Entry ${leafId} not found`);
        }
        const entry = {
            type: "leaf",
            id: generateEntryId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
            targetId: leafId,
        };
        this.entries.push(entry);
        this.byId.set(entry.id, entry);
        this.leafId = leafId;
    }
    async createEntryId() {
        return generateEntryId(this.byId);
    }
    async appendEntry(entry) {
        this.entries.push(entry);
        this.byId.set(entry.id, entry);
        updateLabelCache(this.labelsById, entry);
        this.leafId = leafIdAfterEntry(entry);
    }
    async getEntry(id) {
        return this.byId.get(id);
    }
    async findEntries(type) {
        return this.entries.filter((entry) => entry.type === type);
    }
    async getLabel(id) {
        return this.labelsById.get(id);
    }
    async getPathToRoot(leafId) {
        if (leafId === null)
            return [];
        const path = [];
        let current = this.byId.get(leafId);
        if (!current)
            throw new SessionError("not_found", `Entry ${leafId} not found`);
        while (current) {
            path.unshift(current);
            if (!current.parentId)
                break;
            const parent = this.byId.get(current.parentId);
            if (!parent)
                throw new SessionError("invalid_session", `Entry ${current.parentId} not found`);
            current = parent;
        }
        return path;
    }
    async getEntries() {
        return [...this.entries];
    }
}
//# sourceMappingURL=memory-storage.js.map