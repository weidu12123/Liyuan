import type { Api, Context, Model, SimpleStreamOptions, StreamOptions, ThinkingBudgets, ThinkingLevel } from "../types.ts";
export declare function clampMaxTokensToContext(model: Model<Api>, context: Context, maxTokens: number): number;
export declare function buildBaseOptions(model: Model<Api>, context: Context, options?: SimpleStreamOptions, apiKey?: string): StreamOptions;
export declare function clampReasoning(effort: ThinkingLevel | undefined): Exclude<ThinkingLevel, "xhigh"> | undefined;
export declare function adjustMaxTokensForThinking(baseMaxTokens: number | undefined, modelMaxTokens: number, reasoningLevel: ThinkingLevel, customBudgets?: ThinkingBudgets): {
    maxTokens: number;
    thinkingBudget: number;
};
//# sourceMappingURL=simple-options.d.ts.map