export declare const ANT_LING_MODELS: {
    readonly "Ling-2.6-1T": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            thinkingFormat: "ant-ling";
            supportsLongCacheRetention: false;
        };
        reasoning: false;
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
    readonly "Ling-2.6-flash": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            thinkingFormat: "ant-ling";
            supportsLongCacheRetention: false;
        };
        reasoning: false;
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
    readonly "Ring-2.6-1T": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            thinkingFormat: "ant-ling";
            supportsLongCacheRetention: false;
        };
        reasoning: true;
        thinkingLevelMap: {
            off: null;
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
//# sourceMappingURL=ant-ling.models.d.ts.map