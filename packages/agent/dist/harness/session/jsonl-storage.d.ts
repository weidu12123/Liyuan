import type { FileSystem, JsonlSessionMetadata, SessionStorage, SessionTreeEntry } from "../types.ts";
type JsonlSessionStorageFileSystem = Pick<FileSystem, "readTextFile" | "readTextLines" | "writeFile" | "appendFile">;
export declare function loadJsonlSessionMetadata(fs: JsonlSessionStorageFileSystem, filePath: string): Promise<JsonlSessionMetadata>;
export declare class JsonlSessionStorage implements SessionStorage<JsonlSessionMetadata> {
    private readonly fs;
    private readonly filePath;
    private readonly metadata;
    private entries;
    private byId;
    private labelsById;
    private currentLeafId;
    private constructor();
    static open(fs: JsonlSessionStorageFileSystem, filePath: string): Promise<JsonlSessionStorage>;
    static create(fs: JsonlSessionStorageFileSystem, filePath: string, options: {
        cwd: string;
        sessionId: string;
        parentSessionPath?: string;
    }): Promise<JsonlSessionStorage>;
    getMetadata(): Promise<JsonlSessionMetadata>;
    getLeafId(): Promise<string | null>;
    setLeafId(leafId: string | null): Promise<void>;
    createEntryId(): Promise<string>;
    appendEntry(entry: SessionTreeEntry): Promise<void>;
    getEntry(id: string): Promise<SessionTreeEntry | undefined>;
    findEntries<TType extends SessionTreeEntry["type"]>(type: TType): Promise<Array<Extract<SessionTreeEntry, {
        type: TType;
    }>>>;
    getLabel(id: string): Promise<string | undefined>;
    getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]>;
    getEntries(): Promise<SessionTreeEntry[]>;
}
export {};
//# sourceMappingURL=jsonl-storage.d.ts.map