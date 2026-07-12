import type { AssistantMessage } from "../types.ts";
/**
 * Classifies whether a failed assistant message looks like a transient provider
 * or transport error, so callers can decide if the last assistant turn should be
 * restarted.
 *
 * This does not implement retry policy. Callers should first handle context
 * overflow separately, then apply their own retry budget, backoff, and reporting
 * before restarting the assistant turn.
 */
export declare function isRetryableAssistantError(message: AssistantMessage): boolean;
//# sourceMappingURL=retry.d.ts.map