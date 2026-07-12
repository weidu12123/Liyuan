import { estimateContextTokens } from "../utils/estimate.js";
const CONTEXT_SAFETY_TOKENS = 4096;
const MIN_MAX_TOKENS = 1;
export function clampMaxTokensToContext(model, context, maxTokens) {
    if (model.contextWindow <= 0)
        return Math.max(MIN_MAX_TOKENS, maxTokens);
    const available = model.contextWindow - estimateContextTokens(context).tokens - CONTEXT_SAFETY_TOKENS;
    return Math.min(maxTokens, Math.max(MIN_MAX_TOKENS, available));
}
export function buildBaseOptions(model, context, options, apiKey) {
    return {
        temperature: options?.temperature,
        maxTokens: clampMaxTokensToContext(model, context, options?.maxTokens ?? model.maxTokens),
        signal: options?.signal,
        apiKey: apiKey || options?.apiKey,
        transport: options?.transport,
        cacheRetention: options?.cacheRetention,
        sessionId: options?.sessionId,
        headers: options?.headers,
        onPayload: options?.onPayload,
        onResponse: options?.onResponse,
        timeoutMs: options?.timeoutMs,
        websocketConnectTimeoutMs: options?.websocketConnectTimeoutMs,
        maxRetries: options?.maxRetries,
        maxRetryDelayMs: options?.maxRetryDelayMs,
        metadata: options?.metadata,
        env: options?.env,
    };
}
export function clampReasoning(effort) {
    return effort === "xhigh" ? "high" : effort;
}
export function adjustMaxTokensForThinking(
// Undefined means no explicit caller cap. Use the model cap and fit thinking inside it.
baseMaxTokens, modelMaxTokens, reasoningLevel, customBudgets) {
    const defaultBudgets = {
        minimal: 1024,
        low: 2048,
        medium: 8192,
        high: 16384,
    };
    const budgets = { ...defaultBudgets, ...customBudgets };
    const minOutputTokens = 1024;
    const level = clampReasoning(reasoningLevel);
    let thinkingBudget = budgets[level];
    const maxTokens = baseMaxTokens === undefined ? modelMaxTokens : Math.min(baseMaxTokens + thinkingBudget, modelMaxTokens);
    if (maxTokens <= thinkingBudget) {
        thinkingBudget = Math.max(0, maxTokens - minOutputTokens);
    }
    return { maxTokens, thinkingBudget };
}
//# sourceMappingURL=simple-options.js.map