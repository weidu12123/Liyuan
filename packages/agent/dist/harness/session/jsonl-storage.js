import { SessionError, toError } from "../types.js";
import { getFileSystemResultOrThrow } from "./repo-utils.js";
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
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function invalidSession(filePath, message, cause) {
    return new SessionError("invalid_session", `Invalid JSONL session file ${filePath}: ${message}`, cause);
}
function invalidEntry(filePath, lineNumber, message, cause) {
    return new SessionError("invalid_entry", `Invalid JSONL session file ${filePath}: line ${lineNumber} ${message}`, cause);
}
function parseHeaderLine(line, filePath) {
    let parsed;
    try {
        parsed = JSON.parse(line);
    }
    catch (error) {
        throw invalidSession(filePath, "first line is not a valid session header", toError(error));
    }
    if (!isRecord(parsed))
        throw invalidSession(filePath, "first line is not a valid session header");
    if (parsed.type !== "session")
        throw invalidSession(filePath, "first line is not a valid session header");
    if (parsed.version !== 3)
        throw invalidSession(filePath, "unsupported session version");
    if (typeof parsed.id !== "string" || !parsed.id)
        throw invalidSession(filePath, "session header is missing id");
    if (typeof parsed.timestamp !== "string" || !parsed.timestamp) {
        throw invalidSession(filePath, "session header is missing timestamp");
    }
    if (typeof parsed.cwd !== "string" || !parsed.cwd)
        throw invalidSession(filePath, "session header is missing cwd");
    if (parsed.parentSession !== undefined && typeof parsed.parentSession !== "string") {
        throw invalidSession(filePath, "session header parentSession must be a string");
    }
    return {
        type: "session",
        version: 3,
        id: parsed.id,
        timestamp: parsed.timestamp,
        cwd: parsed.cwd,
        parentSession: parsed.parentSession,
    };
}
function parseEntryLine(line, filePath, lineNumber) {
    let parsed;
    try {
        parsed = JSON.parse(line);
    }
    catch (error) {
        throw invalidEntry(filePath, lineNumber, "is not valid JSON", toError(error));
    }
    if (!isRecord(parsed))
        throw invalidEntry(filePath, lineNumber, "is not a valid session entry");
    if (typeof parsed.type !== "string")
        throw invalidEntry(filePath, lineNumber, "is missing entry type");
    if (typeof parsed.id !== "string" || !parsed.id)
        throw invalidEntry(filePath, lineNumber, "is missing entry id");
    if (parsed.parentId !== null && typeof parsed.parentId !== "string") {
        throw invalidEntry(filePath, lineNumber, "has invalid parentId");
    }
    if (typeof parsed.timestamp !== "string" || !parsed.timestamp) {
        throw invalidEntry(filePath, lineNumber, "is missing timestamp");
    }
    if (parsed.type === "leaf" && parsed.targetId !== null && typeof parsed.targetId !== "string") {
        throw invalidEntry(filePath, lineNumber, "has invalid targetId");
    }
    return parsed;
}
function leafIdAfterEntry(entry) {
    return entry.type === "leaf" ? entry.targetId : entry.id;
}
function headerToSessionMetadata(header, path) {
    return {
        id: header.id,
        createdAt: header.timestamp,
        cwd: header.cwd,
        path,
        parentSessionPath: header.parentSession,
    };
}
export async function loadJsonlSessionMetadata(fs, filePath) {
    const lines = getFileSystemResultOrThrow(await fs.readTextLines(filePath, { maxLines: 1 }), `Failed to read session header ${filePath}`);
    const line = lines[0];
    if (line?.trim())
        return headerToSessionMetadata(parseHeaderLine(line, filePath), filePath);
    throw invalidSession(filePath, "missing session header");
}
async function loadJsonlStorage(fs, filePath) {
    const content = getFileSystemResultOrThrow(await fs.readTextFile(filePath), `Failed to read session ${filePath}`);
    const lines = content.split("\n").filter((line) => line.trim());
    if (lines.length === 0) {
        throw invalidSession(filePath, "missing session header");
    }
    const header = parseHeaderLine(lines[0], filePath);
    const entries = [];
    let leafId = null;
    for (let i = 1; i < lines.length; i++) {
        const entry = parseEntryLine(lines[i], filePath, i + 1);
        entries.push(entry);
        leafId = leafIdAfterEntry(entry);
    }
    return { header, entries, leafId };
}
export class JsonlSessionStorage {
    fs;
    filePath;
    metadata;
    entries;
    byId;
    labelsById;
    currentLeafId;
    constructor(fs, filePath, header, entries, leafId) {
        this.fs = fs;
        this.filePath = filePath;
        this.metadata = headerToSessionMetadata(header, this.filePath);
        this.entries = entries;
        this.byId = new Map(entries.map((entry) => [entry.id, entry]));
        this.labelsById = buildLabelsById(entries);
        this.currentLeafId = leafId;
    }
    static async open(fs, filePath) {
        const loaded = await loadJsonlStorage(fs, filePath);
        return new JsonlSessionStorage(fs, filePath, loaded.header, loaded.entries, loaded.leafId);
    }
    static async create(fs, filePath, options) {
        const header = {
            type: "session",
            version: 3,
            id: options.sessionId,
            timestamp: new Date().toISOString(),
            cwd: options.cwd,
            parentSession: options.parentSessionPath,
        };
        getFileSystemResultOrThrow(await fs.writeFile(filePath, `${JSON.stringify(header)}\n`), `Failed to create session ${filePath}`);
        return new JsonlSessionStorage(fs, filePath, header, [], null);
    }
    async getMetadata() {
        return this.metadata;
    }
    async getLeafId() {
        if (this.currentLeafId !== null && !this.byId.has(this.currentLeafId)) {
            throw new SessionError("invalid_session", `Entry ${this.currentLeafId} not found`);
        }
        return this.currentLeafId;
    }
    async setLeafId(leafId) {
        if (leafId !== null && !this.byId.has(leafId)) {
            throw new SessionError("not_found", `Entry ${leafId} not found`);
        }
        const entry = {
            type: "leaf",
            id: generateEntryId(this.byId),
            parentId: this.currentLeafId,
            timestamp: new Date().toISOString(),
            targetId: leafId,
        };
        getFileSystemResultOrThrow(await this.fs.appendFile(this.filePath, `${JSON.stringify(entry)}\n`), `Failed to append session leaf ${entry.id}`);
        this.entries.push(entry);
        this.byId.set(entry.id, entry);
        this.currentLeafId = leafId;
    }
    async createEntryId() {
        return generateEntryId(this.byId);
    }
    async appendEntry(entry) {
        getFileSystemResultOrThrow(await this.fs.appendFile(this.filePath, `${JSON.stringify(entry)}\n`), `Failed to append session entry ${entry.id}`);
        this.entries.push(entry);
        this.byId.set(entry.id, entry);
        updateLabelCache(this.labelsById, entry);
        this.currentLeafId = leafIdAfterEntry(entry);
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
//# sourceMappingURL=jsonl-storage.js.map