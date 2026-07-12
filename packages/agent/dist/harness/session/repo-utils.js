import { SessionError, } from "../types.js";
import { Session } from "./session.js";
import { uuidv7 } from "./uuid.js";
export function createSessionId() {
    return uuidv7();
}
export function createTimestamp() {
    return new Date().toISOString();
}
export function toSession(storage) {
    return new Session(storage);
}
export function getFileSystemResultOrThrow(result, message) {
    if (!result.ok) {
        const code = result.error.code === "not_found" ? "not_found" : "storage";
        throw new SessionError(code, `${message}: ${result.error.message}`, result.error);
    }
    return result.value;
}
export async function getEntriesToFork(storage, options) {
    if (!options.entryId)
        return storage.getEntries();
    const target = await storage.getEntry(options.entryId);
    if (!target) {
        throw new SessionError("invalid_fork_target", `Entry ${options.entryId} not found`);
    }
    let effectiveLeafId;
    if ((options.position ?? "before") === "at") {
        effectiveLeafId = target.id;
    }
    else {
        if (target.type !== "message" || target.message.role !== "user") {
            throw new SessionError("invalid_fork_target", `Entry ${options.entryId} is not a user message`);
        }
        effectiveLeafId = target.parentId;
    }
    return storage.getPathToRoot(effectiveLeafId);
}
//# sourceMappingURL=repo-utils.js.map