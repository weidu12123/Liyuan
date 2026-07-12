export declare const FIREWORKS_MODELS: {
    readonly "accounts/fireworks/models/deepseek-v4-flash": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            supportsEagerToolInputStreaming: false;
            supportsCacheControlOnTools: false;
            supportsLongCacheRetention: false;
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
    readonly "accounts/fireworks/models/deepseek-v4-pro": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            supportsEagerToolInputStreaming: false;
            supportsCacheControlOnTools: false;
            supportsLongCacheRetention: false;
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
    readonly "accounts/fireworks/models/glm-5p1": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            supportsEagerToolInputStreaming: false;
            supportsCacheControlOnTools: false;
            supportsLongCacheRetention: false;
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
    readonly "accounts/fireworks/models/glm-5p2": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
        };
        reasoning: true;
        thinkingLevelMap: {
            off: string;
            minimal: null;
            low: string;
            medium: string;
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
    readonly "accounts/fireworks/models/gpt-oss-120b": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            supportsEagerToolInputStreaming: false;
            supportsCacheControlOnTools: false;
            supportsLongCacheRetention: false;
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
    readonly "accounts/fireworks/models/gpt-oss-20b": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            supportsEagerToolInputStreaming: false;
            supportsCacheControlOnTools: false;
            supportsLongCacheRetention: false;
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
    readonly "accounts/fireworks/models/kimi-k2p6": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            supportsEagerToolInputStreaming: false;
            supportsCacheControlOnTools: false;
            supportsLongCacheRetention: false;
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
    readonly "accounts/fireworks/models/kimi-k2p7-code": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            supportsEagerToolInputStreaming: false;
            supportsCacheControlOnTools: false;
            supportsLongCacheRetention: false;
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
    readonly "accounts/fireworks/models/minimax-m2p7": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            supportsEagerToolInputStreaming: false;
            supportsCacheControlOnTools: false;
            supportsLongCacheRetention: false;
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
    readonly "accounts/fireworks/models/minimax-m3": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            supportsEagerToolInputStreaming: false;
            supportsCacheControlOnTools: false;
            supportsLongCacheRetention: false;
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
    readonly "accounts/fireworks/models/qwen3p7-plus": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            supportsEagerToolInputStreaming: false;
            supportsCacheControlOnTools: false;
            supportsLongCacheRetention: false;
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
    readonly "accounts/fireworks/routers/glm-5p1-fast": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            supportsEagerToolInputStreaming: false;
            supportsCacheControlOnTools: false;
            supportsLongCacheRetention: false;
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
    readonly "accounts/fireworks/routers/glm-5p2-fast": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            supportsEagerToolInputStreaming: false;
            supportsCacheControlOnTools: false;
            supportsLongCacheRetention: false;
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
    readonly "accounts/fireworks/routers/kimi-k2p6-fast": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            supportsEagerToolInputStreaming: false;
            supportsCacheControlOnTools: false;
            supportsLongCacheRetention: false;
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
    readonly "accounts/fireworks/routers/kimi-k2p6-turbo": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            supportsEagerToolInputStreaming: false;
            supportsCacheControlOnTools: false;
            supportsLongCacheRetention: false;
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
    readonly "accounts/fireworks/routers/kimi-k2p7-code-fast": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            supportsEagerToolInputStreaming: false;
            supportsCacheControlOnTools: false;
            supportsLongCacheRetention: false;
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
};
//# sourceMappingURL=fireworks.models.d.ts.map