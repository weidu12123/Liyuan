import type { ImageContent, Message, TextContent } from "@liyuan/ai";
import type { AgentMessage } from "../types.ts";
export declare const COMPACTION_SUMMARY_PREFIX = "The conversation history before this point was compacted into the following summary:\n\n<summary>\n";
export declare const COMPACTION_SUMMARY_SUFFIX = "\n</summary>";
export declare const BRANCH_SUMMARY_PREFIX = "The following is a summary of a branch that this conversation came back from:\n\n<summary>\n";
export declare const BRANCH_SUMMARY_SUFFIX = "</summary>";
export interface BashExecutionMessage {
    role: "bashExecution";
    command: string;
    output: string;
    exitCode: number | undefined;
    cancelled: boolean;
    truncated: boolean;
    fullOutputPath?: string;
    timestamp: number;
    excludeFromContext?: boolean;
}
export interface CustomMessage<T = unknown> {
    role: "custom";
    customType: string;
    content: string | (TextContent | ImageContent)[];
    display: boolean;
    details?: T;
    timestamp: number;
}
export interface BranchSummaryMessage {
    role: "branchSummary";
    summary: string;
    fromId: string;
    timestamp: number;
}
export interface CompactionSummaryMessage {
    role: "compactionSummary";
    summary: string;
    tokensBefore: number;
    timestamp: number;
}
declare module "../types.ts" {
    interface CustomAgentMessages {
        bashExecution: BashExecutionMessage;
        custom: CustomMessage;
        branchSummary: BranchSummaryMessage;
        compactionSummary: CompactionSummaryMessage;
    }
}
export declare function bashExecutionToText(msg: BashExecutionMessage): string;
export declare function createBranchSummaryMessage(summary: string, fromId: string, timestamp: string): BranchSummaryMessage;
export declare function createCompactionSummaryMessage(summary: string, tokensBefore: number, timestamp: string): CompactionSummaryMessage;
export declare function createCustomMessage(customType: string, content: string | (TextContent | ImageContent)[], display: boolean, details: unknown | undefined, timestamp: string): CustomMessage;
export declare function convertToLlm(messages: AgentMessage[]): Message[];
//# sourceMappingURL=messages.d.ts.map