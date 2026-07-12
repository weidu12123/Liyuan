export declare const DEEPSEEK_MODELS: {
    readonly "deepseek-v4-flash": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            requiresReasoningContentOnAssistantMessages: true;
            thinkingFormat: "deepseek";
        };
        reasoning: true;
        thinkingLevelMap: {
            minimal: null;
            low: null;
            medium: null;
            high: string;
            xhigh: string;
        };
        input: "text"[];
        cost: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
        };
        contextWindow: number;
        maxTokens: number;
    };
    readonly "deepseek-v4-pro": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            requiresReasoningContentOnAssistantMessages: true;
            thinkingFormat: "deepseek";
        };
        reasoning: true;
        thinkingLevelMap: {
            minimal: null;
            low: null;
            medium: null;
            high: string;
            xhigh: string;
        };
        input: "text"[];
        cost: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
        };
        contextWindow: number;
        maxTokens: number;
    };
};
//# sourceMappingURL=deepseek.models.d.ts.map