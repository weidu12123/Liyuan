export declare const OPENAI_CODEX_MODELS: {
    readonly "gpt-5.3-codex-spark": {
        id: string;
        name: string;
        api: "openai-codex-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            xhigh: string;
            minimal: string;
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
    readonly "gpt-5.4": {
        id: string;
        name: string;
        api: "openai-codex-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            xhigh: string;
            minimal: string;
        };
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
    readonly "gpt-5.4-mini": {
        id: string;
        name: string;
        api: "openai-codex-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            xhigh: string;
            minimal: string;
        };
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
    readonly "gpt-5.5": {
        id: string;
        name: string;
        api: "openai-codex-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            xhigh: string;
            minimal: string;
        };
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
};
//# sourceMappingURL=openai-codex.models.d.ts.map