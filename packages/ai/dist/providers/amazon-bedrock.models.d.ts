export declare const AMAZON_BEDROCK_MODELS: {
    readonly "amazon.nova-2-lite-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "amazon.nova-lite-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "amazon.nova-micro-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "amazon.nova-pro-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "anthropic.claude-fable-5": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "anthropic.claude-haiku-4-5-20251001-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "anthropic.claude-opus-4-1-20250805-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "anthropic.claude-opus-4-5-20251101-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "anthropic.claude-opus-4-6-v1": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
        provider: string;
        baseUrl: string;
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
    readonly "anthropic.claude-opus-4-7": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
        provider: string;
        baseUrl: string;
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
    readonly "anthropic.claude-opus-4-8": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
        provider: string;
        baseUrl: string;
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
    readonly "anthropic.claude-sonnet-4-5-20250929-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "anthropic.claude-sonnet-4-6": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "anthropic.claude-sonnet-5": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "au.anthropic.claude-haiku-4-5-20251001-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "au.anthropic.claude-opus-4-6-v1": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
        provider: string;
        baseUrl: string;
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
    readonly "au.anthropic.claude-opus-4-8": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
        provider: string;
        baseUrl: string;
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
    readonly "au.anthropic.claude-sonnet-4-5-20250929-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "au.anthropic.claude-sonnet-4-6": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "au.anthropic.claude-sonnet-5": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "deepseek.r1-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "deepseek.v3-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "deepseek.v3.2": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "eu.anthropic.claude-fable-5": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "eu.anthropic.claude-haiku-4-5-20251001-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "eu.anthropic.claude-opus-4-5-20251101-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "eu.anthropic.claude-opus-4-6-v1": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
        provider: string;
        baseUrl: string;
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
    readonly "eu.anthropic.claude-opus-4-7": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
        provider: string;
        baseUrl: string;
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
    readonly "eu.anthropic.claude-opus-4-8": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
        provider: string;
        baseUrl: string;
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
    readonly "eu.anthropic.claude-sonnet-4-5-20250929-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "eu.anthropic.claude-sonnet-4-6": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "eu.anthropic.claude-sonnet-5": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "global.anthropic.claude-fable-5": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "global.anthropic.claude-haiku-4-5-20251001-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "global.anthropic.claude-opus-4-5-20251101-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "global.anthropic.claude-opus-4-6-v1": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
        provider: string;
        baseUrl: string;
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
    readonly "global.anthropic.claude-opus-4-7": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
        provider: string;
        baseUrl: string;
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
    readonly "global.anthropic.claude-opus-4-8": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
        provider: string;
        baseUrl: string;
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
    readonly "global.anthropic.claude-sonnet-4-5-20250929-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "global.anthropic.claude-sonnet-4-6": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "global.anthropic.claude-sonnet-5": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "google.gemma-3-27b-it": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "google.gemma-3-4b-it": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "jp.anthropic.claude-haiku-4-5-20251001-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "jp.anthropic.claude-opus-4-7": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
        provider: string;
        baseUrl: string;
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
    readonly "jp.anthropic.claude-opus-4-8": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
        provider: string;
        baseUrl: string;
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
    readonly "jp.anthropic.claude-sonnet-4-5-20250929-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "jp.anthropic.claude-sonnet-4-6": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "jp.anthropic.claude-sonnet-5": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "meta.llama3-1-70b-instruct-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "meta.llama3-1-8b-instruct-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "meta.llama3-3-70b-instruct-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "meta.llama4-maverick-17b-instruct-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "meta.llama4-scout-17b-instruct-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "minimax.minimax-m2": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "minimax.minimax-m2.1": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "minimax.minimax-m2.5": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "mistral.devstral-2-123b": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "mistral.magistral-small-2509": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "mistral.ministral-3-14b-instruct": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "mistral.ministral-3-3b-instruct": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "mistral.ministral-3-8b-instruct": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "mistral.mistral-large-3-675b-instruct": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "mistral.pixtral-large-2502-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "mistral.voxtral-mini-3b-2507": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "mistral.voxtral-small-24b-2507": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "moonshot.kimi-k2-thinking": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "moonshotai.kimi-k2.5": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "nvidia.nemotron-nano-12b-v2": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "nvidia.nemotron-nano-3-30b": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "nvidia.nemotron-nano-9b-v2": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "nvidia.nemotron-super-3-120b": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "openai.gpt-5.4": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
        provider: string;
        baseUrl: string;
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
    readonly "openai.gpt-5.5": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
        provider: string;
        baseUrl: string;
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
    readonly "openai.gpt-oss-120b": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "openai.gpt-oss-120b-1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "openai.gpt-oss-20b": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "openai.gpt-oss-20b-1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "openai.gpt-oss-safeguard-120b": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "openai.gpt-oss-safeguard-20b": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "qwen.qwen3-235b-a22b-2507-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "qwen.qwen3-32b-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "qwen.qwen3-coder-30b-a3b-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "qwen.qwen3-coder-480b-a35b-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "qwen.qwen3-coder-next": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "qwen.qwen3-next-80b-a3b": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "qwen.qwen3-vl-235b-a22b": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "us.anthropic.claude-fable-5": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "us.anthropic.claude-haiku-4-5-20251001-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "us.anthropic.claude-opus-4-1-20250805-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "us.anthropic.claude-opus-4-5-20251101-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "us.anthropic.claude-opus-4-6-v1": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
        provider: string;
        baseUrl: string;
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
    readonly "us.anthropic.claude-opus-4-7": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
        provider: string;
        baseUrl: string;
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
    readonly "us.anthropic.claude-opus-4-8": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
        provider: string;
        baseUrl: string;
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
    readonly "us.anthropic.claude-sonnet-4-5-20250929-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "us.anthropic.claude-sonnet-4-6": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "us.anthropic.claude-sonnet-5": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "us.deepseek.r1-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "us.meta.llama4-maverick-17b-instruct-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "us.meta.llama4-scout-17b-instruct-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "writer.palmyra-x4-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "writer.palmyra-x5-v1:0": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "xai.grok-4.3": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "zai.glm-4.7": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "zai.glm-4.7-flash": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
    readonly "zai.glm-5": {
        id: string;
        name: string;
        api: "bedrock-converse-stream";
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
};
//# sourceMappingURL=amazon-bedrock.models.d.ts.map