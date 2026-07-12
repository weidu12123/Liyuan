import { type SessionMetadata, type SessionStorage, type SessionTreeEntry } from "../types.ts";
export declare class InMemorySessionStorage<TMetadata extends SessionMetadata = SessionMetadata> implements SessionStorage<TMetadata> {
    private readonly metadata;
    private entries;
    private byId;
    private labelsById;
    private leafId;
    constructor(options?: {
        entries?: SessionTreeEntry[];
        metadata?: TMetadata;
    });
    getMetadata(): Promise<TMetadata>;
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
//# sourceMappingURL=memory-storage.d.ts.map