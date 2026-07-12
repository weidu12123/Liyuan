export declare const CLOUDFLARE_WORKERS_AI_MODELS: {
    readonly "@cf/google/gemma-4-26b-a4b-it": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
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
    readonly "@cf/ibm-granite/granite-4.0-h-micro": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsLongCacheRetention: false;
            sendSessionAffinityHeaders: true;
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
    readonly "@cf/meta/llama-3.3-70b-instruct-fp8-fast": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsLongCacheRetention: false;
            sendSessionAffinityHeaders: true;
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
    readonly "@cf/meta/llama-4-scout-17b-16e-instruct": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsLongCacheRetention: false;
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
    readonly "@cf/mistralai/mistral-small-3.1-24b-instruct": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
            supportsLongCacheRetention: false;
            sendSessionAffinityHeaders: true;
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
    readonly "@cf/moonshotai/kimi-k2.6": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
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
    readonly "@cf/moonshotai/kimi-k2.7-code": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
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
    readonly "@cf/nvidia/nemotron-3-120b-a12b": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
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
    readonly "@cf/openai/gpt-oss-120b": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
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
    readonly "@cf/openai/gpt-oss-20b": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
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
    readonly "@cf/qwen/qwen3-30b-a3b-fp8": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
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
    readonly "@cf/zai-org/glm-4.7-flash": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
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
    readonly "@cf/zai-org/glm-5.2": {
        id: string;
        name: string;
        api: "openai-completions";
        provider: string;
        baseUrl: string;
        compat: {
            supportsStore: false;
            supportsDeveloperRole: false;
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
//# sourceMappingURL=cloudflare-workers-ai.models.d.ts.map