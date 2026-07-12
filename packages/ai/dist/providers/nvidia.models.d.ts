export declare const NVIDIA_MODELS: {
    readonly "meta/llama-3.1-70b-instruct": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
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
    readonly "meta/llama-3.1-8b-instruct": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
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
    readonly "meta/llama-3.2-11b-vision-instruct": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
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
    readonly "meta/llama-3.2-90b-vision-instruct": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
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
    readonly "meta/llama-3.3-70b-instruct": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
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
    readonly "minimaxai/minimax-m3": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            supportsStrictMode: false;
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
    readonly "mistralai/mistral-large-3-675b-instruct-2512": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            supportsStrictMode: false;
            supportsLongCacheRetention: false;
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
    readonly "mistralai/mistral-small-4-119b-2603": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            supportsStrictMode: false;
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
    readonly "moonshotai/kimi-k2.6": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            supportsStrictMode: false;
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
    readonly "nvidia/nemotron-3-nano-30b-a3b": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            supportsStrictMode: false;
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
    readonly "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            supportsStrictMode: false;
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
    readonly "nvidia/nemotron-3-super-120b-a12b": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            supportsStrictMode: false;
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
    readonly "nvidia/nemotron-3-ultra-550b-a55b": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            supportsStrictMode: false;
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
    readonly "nvidia/nvidia-nemotron-nano-9b-v2": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            supportsStrictMode: false;
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
    readonly "openai/gpt-oss-120b": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            supportsStrictMode: false;
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
    readonly "openai/gpt-oss-20b": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            supportsStrictMode: false;
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
    readonly "qwen/qwen3.5-122b-a10b": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            supportsStrictMode: false;
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
    readonly "stepfun-ai/step-3.5-flash": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            supportsStrictMode: false;
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
    readonly "stepfun-ai/step-3.7-flash": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            supportsStrictMode: false;
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
    readonly "z-ai/glm-5.2": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        headers: {
            "NVCF-POLL-SECONDS": string;
        };
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsReasoningEffort: false;
            maxTokensField: "max_tokens";
            supportsStrictMode: false;
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
};
//# sourceMappingURL=nvidia.models.d.ts.map