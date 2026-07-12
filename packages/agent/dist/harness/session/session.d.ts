import type { ImageContent, TextContent } from "@liyuan/ai";
import type { AgentMessage } from "../../types.ts";
import type { SessionContext, SessionMetadata, SessionStorage, SessionTreeEntry } from "../types.ts";
export declare function buildSessionContext(pathEntries: SessionTreeEntry[]): SessionContext;
export declare class Session<TMetadata extends SessionMetadata = SessionMetadata> {
    private storage;
    constructor(storage: SessionStorage<TMetadata>);
    getMetadata(): Promise<TMetadata>;
    getStorage(): SessionStorage<TMetadata>;
    getLeafId(): Promise<string | null>;
    getEntry(id: string): Promise<SessionTreeEntry | undefined>;
    getEntries(): Promise<SessionTreeEntry[]>;
    getBranch(fromId?: string): Promise<SessionTreeEntry[]>;
    buildContext(): Promise<SessionContext>;
    getLabel(id: string): Promise<string | undefined>;
    getSessionName(): Promise<string | undefined>;
    private appendTypedEntry;
    appendMessage(message: AgentMessage): Promise<string>;
    appendThinkingLevelChange(thinkingLevel: string): Promise<string>;
    appendModelChange(provider: string, modelId: string): Promise<string>;
    appendActiveToolsChange(activeToolNames: string[]): Promise<string>;
    appendCompaction<T = unknown>(summary: string, firstKeptEntryId: string, tokensBefore: number, details?: T, fromHook?: boolean): Promise<string>;
    appendCustomEntry(customType: string, data?: unknown): Promise<string>;
    appendCustomMessageEntry<T = unknown>(customType: string, content: string | (TextContent | ImageContent)[], display: boolean, details?: T): Promise<string>;
    appendLabel(targetId: string, label: string | undefined): Promise<string>;
    appendSessionName(name: string): Promise<string>;
    moveTo(entryId: string | null, summary?: {
        summary: string;
        details?: unknown;
        fromHook?: boolean;
    }): Promise<string | undefined>;
}
//# sourceMappingURL=session.d.ts.map