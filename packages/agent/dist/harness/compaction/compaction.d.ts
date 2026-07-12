import type { Model, Models, Usage } from "@liyuan/ai";
import type { AgentMessage, ThinkingLevel } from "../../types.ts";
import { CompactionError, type Result, type SessionTreeEntry } from "../types.ts";
import { type FileOperations } from "./utils.ts";
/** File-operation details stored on generated compaction entries. */
export interface CompactionDetails {
    /** Files read in the compacted history. */
    readFiles: string[];
    /** Files modified in the compacted history. */
    modifiedFiles: string[];
}
/** Generated compaction data ready to be persisted as a compaction entry. */
export interface CompactionResult<T = unknown> {
    /** Summary text that replaces compacted history in future context. */
    summary: string;
    /** Entry id where retained history starts. */
    firstKeptEntryId: string;
    /** Estimated context tokens before compaction. */
    tokensBefore: number;
    /** Optional implementation-specific details stored with the compaction entry. */
    details?: T;
}
/** Compaction thresholds and retention settings. */
export interface CompactionSettings {
    /** Enable automatic compaction decisions. */
    enabled: boolean;
    /** Tokens reserved for summary prompt and output. */
    reserveTokens: number;
    /** Approximate recent-context tokens to keep after compaction. */
    keepRecentTokens: number;
}
/** Default compaction settings used by the harness. */
export declare const DEFAULT_COMPACTION_SETTINGS: CompactionSettings;
/** Calculate total context tokens from provider usage. */
export declare function calculateContextTokens(usage: Usage): number;
/** Return usage from the last valid assistant message in session entries. */
export declare function getLastAssistantUsage(entries: SessionTreeEntry[]): Usage | undefined;
/** Estimated context-token usage for a message list. */
export interface ContextUsageEstimate {
    /** Estimated total context tokens. */
    tokens: number;
    /** Tokens reported by the most recent assistant usage block. */
    usageTokens: number;
    /** Estimated tokens after the most recent assistant usage block. */
    trailingTokens: number;
    /** Index of the message that provided usage, or null when none exists. */
    lastUsageIndex: number | null;
}
/** Estimate context tokens for messages using provider usage when available. */
export declare function estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate;
/** Return whether context usage exceeds the configured compaction threshold. */
export declare function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean;
/** Estimate token count for one message using a conservative character heuristic. */
export declare function estimateTokens(message: AgentMessage): number;
/** Find the user-visible message that starts the turn containing an entry. */
export declare function findTurnStartIndex(entries: SessionTreeEntry[], entryIndex: number, startIndex: number): number;
/** Cut point selected for compaction. */
export interface CutPointResult {
    /** Index of the first entry retained after compaction. */
    firstKeptEntryIndex: number;
    /** Index of the turn-start entry when the cut splits a turn, otherwise -1. */
    turnStartIndex: number;
    /** Whether the selected cut point splits an in-progress turn. */
    isSplitTurn: boolean;
}
/** Find the compaction cut point that keeps approximately the requested recent-token budget. */
export declare function findCutPoint(entries: SessionTreeEntry[], startIndex: number, endIndex: number, keepRecentTokens: number): CutPointResult;
export declare const SUMMARIZATION_SYSTEM_PROMPT = "You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.\n\nDo NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.";
/** Generate or update a conversation summary for compaction. */
export declare function generateSummary(currentMessages: AgentMessage[], models: Models, model: Model<any>, reserveTokens: number, signal?: AbortSignal, customInstructions?: string, previousSummary?: string, thinkingLevel?: ThinkingLevel): Promise<Result<string, CompactionError>>;
/** Prepared inputs for a compaction run. */
export interface CompactionPreparation {
    /** Entry id where retained history starts. */
    firstKeptEntryId: string;
    /** Messages summarized into the history summary. */
    messagesToSummarize: AgentMessage[];
    /** Prefix messages summarized separately when compaction splits a turn. */
    turnPrefixMessages: AgentMessage[];
    /** Whether compaction splits a turn. */
    isSplitTurn: boolean;
    /** Estimated context tokens before compaction. */
    tokensBefore: number;
    /** Previous compaction summary used for iterative updates. */
    previousSummary?: string;
    /** File operations extracted from summarized history. */
    fileOps: FileOperations;
    /** Settings used to prepare compaction. */
    settings: CompactionSettings;
}
/** Prepare session entries for compaction, or return undefined when compaction is not applicable. */
export declare function prepareCompaction(pathEntries: SessionTreeEntry[], settings: CompactionSettings): Result<CompactionPreparation | undefined, CompactionError>;
export { serializeConversation } from "./utils.ts";
/** Generate compaction summary data from prepared session history. */
export declare function compact(preparation: CompactionPreparation, models: Models, model: Model<any>, customInstructions?: string, signal?: AbortSignal, thinkingLevel?: ThinkingLevel): Promise<Result<CompactionResult, CompactionError>>;
//# sourceMappingURL=compaction.d.ts.map