export declare const CLOUDFLARE_AI_GATEWAY_MODELS: {
    readonly "claude-3-5-haiku": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
        };
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
    readonly "claude-3-haiku": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
        };
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
    readonly "claude-3-opus": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
        };
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
    readonly "claude-3-sonnet": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
        };
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
    readonly "claude-3.5-haiku": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
        };
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
    readonly "claude-3.5-sonnet": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
        };
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
    readonly "claude-fable-5": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            forceAdaptiveThinking: true;
        };
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
    readonly "claude-haiku-4-5": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
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
    readonly "claude-opus-4": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
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
    readonly "claude-opus-4-1": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
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
    readonly "claude-opus-4-5": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
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
    readonly "claude-opus-4-6": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            forceAdaptiveThinking: true;
        };
        reasoning: true;
        thinkingLevelMap: {
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
    readonly "claude-opus-4-7": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            forceAdaptiveThinking: true;
            supportsTemperature: false;
        };
        reasoning: true;
        thinkingLevelMap: {
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
    readonly "claude-opus-4-8": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            forceAdaptiveThinking: true;
            supportsTemperature: false;
        };
        reasoning: true;
        thinkingLevelMap: {
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
    readonly "claude-sonnet-4": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
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
    readonly "claude-sonnet-4-5": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
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
    readonly "claude-sonnet-4-6": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            forceAdaptiveThinking: true;
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
    readonly "claude-sonnet-5": {
        id: string;
        name: string;
        api: "anthropic-messages";
        provider: string;
        baseUrl: string;
        compat: {
            sendSessionAffinityHeaders: true;
            forceAdaptiveThinking: true;
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
    readonly "gpt-4": {
        id: string;
        name: string;
        api: "openai-responses";
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
        api: "openai-responses";
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
        api: "openai-responses";
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
        api: "openai-responses";
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
    readonly "gpt-5.1": {
        id: string;
        name: string;
        api: "openai-responses";
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
        api: "openai-responses";
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
        api: "openai-responses";
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
        api: "openai-responses";
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
    readonly "gpt-5.3-codex": {
        id: string;
        name: string;
        api: "openai-responses";
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
        api: "openai-responses";
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
        api: "openai-responses";
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
    readonly o1: {
        id: string;
        name: string;
        api: "openai-responses";
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
        api: "openai-responses";
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
        api: "openai-responses";
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
        api: "openai-responses";
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
        api: "openai-responses";
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
    readonly "workers-ai/@cf/moonshotai/kimi-k2.5": {
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
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
            sendSessionAffinityHeaders: true;
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
    readonly "workers-ai/@cf/moonshotai/kimi-k2.6": {
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
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
            sendSessionAffinityHeaders: true;
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
    readonly "workers-ai/@cf/nvidia/nemotron-3-120b-a12b": {
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
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
            sendSessionAffinityHeaders: true;
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
    readonly "workers-ai/@cf/zai-org/glm-4.7-flash": {
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
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
            sendSessionAffinityHeaders: true;
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
//# sourceMappingURL=cloudflare-ai-gateway.models.d.ts.map