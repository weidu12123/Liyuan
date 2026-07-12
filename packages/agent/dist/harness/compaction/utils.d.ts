import type { Message } from "@liyuan/ai";
import type { AgentMessage } from "../../types.ts";
/** File paths touched by a session branch or compaction range. */
export interface FileOperations {
    /** Files read but not necessarily modified. */
    read: Set<string>;
    /** Files written by full-file write operations. */
    written: Set<string>;
    /** Files modified by edit operations. */
    edited: Set<string>;
}
/** Create an empty file-operation accumulator. */
export declare function createFileOps(): FileOperations;
/** Add file operations from assistant tool calls to an accumulator. */
export declare function extractFileOpsFromMessage(message: AgentMessage, fileOps: FileOperations): void;
/** Compute sorted read-only and modified file lists from accumulated operations. */
export declare function computeFileLists(fileOps: FileOperations): {
    readFiles: string[];
    modifiedFiles: string[];
};
/** Format file lists as summary metadata tags. */
export declare function formatFileOperations(readFiles: string[], modifiedFiles: string[]): string;
/** Serialize LLM messages to plain text for summarization prompts. */
export declare function serializeConversation(messages: Message[]): string;
//# sourceMappingURL=utils.d.ts.map