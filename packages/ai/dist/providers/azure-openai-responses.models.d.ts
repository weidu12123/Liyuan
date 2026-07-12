export declare const AZURE_OPENAI_RESPONSES_MODELS: {
    readonly "gpt-4": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
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
    readonly "gpt-4-turbo": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: false;
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
    readonly "gpt-4.1": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: false;
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
    readonly "gpt-4.1-mini": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: false;
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
    readonly "gpt-4.1-nano": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: false;
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
    readonly "gpt-4o": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: false;
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
    readonly "gpt-4o-2024-05-13": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: false;
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
    readonly "gpt-4o-2024-08-06": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: false;
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
    readonly "gpt-4o-2024-11-20": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: false;
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
    readonly "gpt-4o-mini": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: false;
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
    readonly "gpt-5": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
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
    readonly "gpt-5-chat-latest": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: false;
        thinkingLevelMap: {
            off: null;
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
    readonly "gpt-5-codex": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
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
    readonly "gpt-5-mini": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
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
    readonly "gpt-5-nano": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
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
    readonly "gpt-5-pro": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
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
    readonly "gpt-5.1": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
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
    readonly "gpt-5.1-chat-latest": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
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
    readonly "gpt-5.1-codex": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
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
    readonly "gpt-5.1-codex-max": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
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
    readonly "gpt-5.1-codex-mini": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
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
    readonly "gpt-5.2": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
            xhigh: string;
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
    readonly "gpt-5.2-chat-latest": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
            xhigh: string;
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
    readonly "gpt-5.2-codex": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
            xhigh: string;
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
    readonly "gpt-5.2-pro": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
            xhigh: string;
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
    readonly "gpt-5.3-chat-latest": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: false;
        thinkingLevelMap: {
            off: null;
            xhigh: string;
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
    readonly "gpt-5.3-codex": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
            xhigh: string;
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
    readonly "gpt-5.3-codex-spark": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
            xhigh: string;
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
    readonly "gpt-5.4": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
            xhigh: string;
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
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
            xhigh: string;
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
    readonly "gpt-5.4-nano": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
            xhigh: string;
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
    readonly "gpt-5.4-pro": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
            xhigh: string;
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
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
            xhigh: string;
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
    readonly "gpt-5.5-pro": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
            xhigh: string;
            minimal: null;
            low: null;
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
    readonly "gpt-5.6": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
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
    readonly "gpt-5.6-luna": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
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
    readonly "gpt-5.6-sol": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
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
    readonly "gpt-5.6-terra": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
        reasoning: true;
        thinkingLevelMap: {
            off: null;
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
    readonly "gpt-realtime-2.1": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
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
    readonly o1: {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
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
    readonly "o1-pro": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
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
    readonly o3: {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
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
    readonly "o3-deep-research": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
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
    readonly "o3-mini": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
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
    readonly "o3-pro": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
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
    readonly "o4-mini": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
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
    readonly "o4-mini-deep-research": {
        id: string;
        name: string;
        api: "azure-openai-responses";
        provider: string;
        baseUrl: string;
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
};
//# sourceMappingURL=azure-openai-responses.models.d.ts.map