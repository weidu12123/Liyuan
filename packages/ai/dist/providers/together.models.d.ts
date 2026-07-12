export declare const TOGETHER_MODELS: {
    readonly "MiniMaxAI/MiniMax-M2.7": {
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
        };
        reasoning: true;
        thinkingLevelMap: {
            off: null;
            minimal: null;
            low: null;
            medium: null;
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
    readonly "MiniMaxAI/MiniMax-M3": {
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
            thinkingFormat: "together";
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
        };
        reasoning: true;
        thinkingLevelMap: {
            minimal: null;
            low: null;
            medium: null;
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
    readonly "Qwen/Qwen2.5-7B-Instruct-Turbo": {
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
            thinkingFormat: "together";
            supportsStrictMode: false;
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
    readonly "Qwen/Qwen3-235B-A22B-Instruct-2507-tput": {
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
            thinkingFormat: "together";
            supportsStrictMode: false;
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
    readonly "Qwen/Qwen3.5-397B-A17B": {
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
            thinkingFormat: "together";
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
        };
        reasoning: true;
        thinkingLevelMap: {
            minimal: null;
            low: null;
            medium: null;
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
    readonly "Qwen/Qwen3.5-9B": {
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
            thinkingFormat: "together";
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
        };
        reasoning: true;
        thinkingLevelMap: {
            minimal: null;
            low: null;
            medium: null;
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
    readonly "Qwen/Qwen3.6-Plus": {
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
            thinkingFormat: "together";
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
        };
        reasoning: true;
        thinkingLevelMap: {
            minimal: null;
            low: null;
            medium: null;
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
    readonly "Qwen/Qwen3.7-Max": {
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
            thinkingFormat: "together";
            supportsStrictMode: false;
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
    readonly "deepseek-ai/DeepSeek-V4-Pro": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: true;
            maxTokensField: "max_tokens";
            thinkingFormat: "together";
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
        };
        reasoning: true;
        thinkingLevelMap: {
            minimal: null;
            low: null;
            medium: null;
            high: string;
            xhigh: null;
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
    readonly "essentialai/Rnj-1-Instruct": {
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
            thinkingFormat: "together";
            supportsStrictMode: false;
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
    readonly "google/gemma-4-31B-it": {
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
            thinkingFormat: "together";
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
        };
        reasoning: true;
        thinkingLevelMap: {
            minimal: null;
            low: null;
            medium: null;
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
    readonly "meta-llama/Llama-3.3-70B-Instruct-Turbo": {
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
            thinkingFormat: "together";
            supportsStrictMode: false;
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
    readonly "moonshotai/Kimi-K2.6": {
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
            thinkingFormat: "together";
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
        };
        reasoning: true;
        thinkingLevelMap: {
            minimal: null;
            low: null;
            medium: null;
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
    readonly "moonshotai/Kimi-K2.7-Code": {
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
            thinkingFormat: "together";
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
        };
        reasoning: true;
        thinkingLevelMap: {
            minimal: null;
            low: null;
            medium: null;
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
    readonly "nvidia/nemotron-3-ultra-550b-a55b": {
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
            thinkingFormat: "together";
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
        };
        reasoning: true;
        thinkingLevelMap: {
            minimal: null;
            low: null;
            medium: null;
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
    readonly "openai/gpt-oss-120b": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: true;
            maxTokensField: "max_tokens";
            thinkingFormat: "openai";
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
        };
        reasoning: true;
        thinkingLevelMap: {
            off: null;
            minimal: null;
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
    readonly "openai/gpt-oss-20b": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: true;
            maxTokensField: "max_tokens";
            thinkingFormat: "openai";
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
        };
        reasoning: true;
        thinkingLevelMap: {
            off: null;
            minimal: null;
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
    readonly "zai-org/GLM-5": {
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
            thinkingFormat: "together";
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
        };
        reasoning: true;
        thinkingLevelMap: {
            minimal: null;
            low: null;
            medium: null;
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
    readonly "zai-org/GLM-5.1": {
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
            thinkingFormat: "together";
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
        };
        reasoning: true;
        thinkingLevelMap: {
            minimal: null;
            low: null;
            medium: null;
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
    readonly "zai-org/GLM-5.2": {
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
            thinkingFormat: "together";
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
        };
        reasoning: true;
        thinkingLevelMap: {
            minimal: null;
            low: null;
            medium: null;
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
//# sourceMappingURL=together.models.d.ts.map