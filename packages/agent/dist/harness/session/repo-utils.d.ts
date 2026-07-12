import { type FileError, type Result, type SessionMetadata, type SessionStorage, type SessionTreeEntry } from "../types.ts";
import { Session } from "./session.ts";
export declare function createSessionId(): string;
export declare function createTimestamp(): string;
export declare function toSession<TMetadata extends SessionMetadata>(storage: SessionStorage<TMetadata>): Session<TMetadata>;
export declare function getFileSystemResultOrThrow<TValue>(result: Result<TValue, FileError>, message: string): TValue;
export declare function getEntriesToFork(storage: SessionStorage, options: {
    entryId?: string;
    position?: "before" | "at";
}): Promise<SessionTreeEntry[]>;
//# sourceMappingURL=repo-utils.d.ts.map