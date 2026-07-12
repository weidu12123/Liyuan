export declare const XIAOMI_TOKEN_PLAN_SGP_MODELS: {
    readonly "mimo-v2-omni": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            requiresReasoningContentOnAssistantMessages: true;
            thinkingFormat: "deepseek";
        };
        reasoning: true;
        input: ("image" | "text")[];
        cost: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
        };
        contextWindow: number;
        maxTokens: number;
    };
    readonly "mimo-v2-pro": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            requiresReasoningContentOnAssistantMessages: true;
            thinkingFormat: "deepseek";
        };
        reasoning: true;
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
    readonly "mimo-v2.5": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            requiresReasoningContentOnAssistantMessages: true;
            thinkingFormat: "deepseek";
        };
        reasoning: true;
        input: ("image" | "text")[];
        cost: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
        };
        contextWindow: number;
        maxTokens: number;
    };
    readonly "mimo-v2.5-pro": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            requiresReasoningContentOnAssistantMessages: true;
            thinkingFormat: "deepseek";
        };
        reasoning: true;
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
    readonly "mimo-v2.5-pro-ultraspeed": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            requiresReasoningContentOnAssistantMessages: true;
            thinkingFormat: "deepseek";
        };
        reasoning: true;
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
//# sourceMappingURL=xiaomi-token-plan-sgp.models.d.ts.map