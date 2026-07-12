import type { FileSystem, JsonlSessionCreateOptions, JsonlSessionListOptions, JsonlSessionMetadata, JsonlSessionRepoApi, Session } from "../types.ts";
type JsonlSessionRepoFileSystem = Pick<FileSystem, "cwd" | "absolutePath" | "joinPath" | "readTextFile" | "readTextLines" | "writeFile" | "appendFile" | "listDir" | "exists" | "createDir" | "remove">;
export declare class JsonlSessionRepo implements JsonlSessionRepoApi {
    private readonly fs;
    private readonly sessionsRootInput;
    private sessionsRoot;
    constructor(options: {
        fs: JsonlSessionRepoFileSystem;
        sessionsRoot: string;
    });
    private getSessionsRoot;
    private getSessionDir;
    private createSessionFilePath;
    create(options: JsonlSessionCreateOptions): Promise<Session<JsonlSessionMetadata>>;
    open(metadata: JsonlSessionMetadata): Promise<Session<JsonlSessionMetadata>>;
    list(options?: JsonlSessionListOptions): Promise<JsonlSessionMetadata[]>;
    delete(metadata: JsonlSessionMetadata): Promise<void>;
    fork(sourceMetadata: JsonlSessionMetadata, options: JsonlSessionCreateOptions & {
        entryId?: string;
        position?: "before" | "at";
        id?: string;
    }): Promise<Session<JsonlSessionMetadata>>;
    private listSessionDirs;
}
export {};
//# sourceMappingURL=jsonl-repo.d.ts.map