export declare const MODELS: {
    readonly "amazon-bedrock": {
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
    readonly "ant-ling": {
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
    readonly anthropic: {
        readonly "claude-fable-5": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            compat: {
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
        readonly "claude-haiku-4-5-20251001": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "claude-opus-4-1": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "claude-opus-4-1-20250805": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "claude-opus-4-5": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "claude-opus-4-5-20251101": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "claude-opus-4-6": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            compat: {
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
        readonly "claude-sonnet-4-5": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "claude-sonnet-4-5-20250929": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "claude-sonnet-4-6": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            compat: {
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
    };
    readonly "azure-openai-responses": {
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
    readonly cerebras: {
        readonly "gemma-4-31b": {
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
        readonly "gpt-oss-120b": {
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
        readonly "zai-glm-4.7": {
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
    readonly "cloudflare-ai-gateway": {
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
    readonly "cloudflare-workers-ai": {
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
    readonly deepseek: {
        readonly "deepseek-v4-flash": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                requiresReasoningContentOnAssistantMessages: true;
                thinkingFormat: "deepseek";
            };
            reasoning: true;
            thinkingLevelMap: {
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
        readonly "deepseek-v4-pro": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                requiresReasoningContentOnAssistantMessages: true;
                thinkingFormat: "deepseek";
            };
            reasoning: true;
            thinkingLevelMap: {
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
    readonly fireworks: {
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
    readonly "github-copilot": {
        readonly "claude-fable-5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
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
        readonly "claude-haiku-4.5": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            compat: {
                supportsEagerToolInputStreaming: false;
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
        readonly "claude-opus-4.5": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
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
        readonly "claude-opus-4.6": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            compat: {
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
        readonly "claude-opus-4.7": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            compat: {
                forceAdaptiveThinking: true;
                supportsTemperature: false;
            };
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
        readonly "claude-opus-4.8": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            compat: {
                forceAdaptiveThinking: true;
                supportsTemperature: false;
            };
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
        readonly "claude-sonnet-4": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            compat: {
                supportsEagerToolInputStreaming: false;
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
        readonly "claude-sonnet-4.5": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            compat: {
                supportsEagerToolInputStreaming: false;
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
        readonly "claude-sonnet-4.6": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            compat: {
                forceAdaptiveThinking: true;
            };
            reasoning: true;
            thinkingLevelMap: {
                minimal: string;
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
        readonly "claude-sonnet-5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
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
        readonly "gemini-2.5-pro": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
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
        readonly "gemini-3-flash-preview": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
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
        readonly "gemini-3.1-pro-preview": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
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
        readonly "gemini-3.5-flash": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
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
        readonly "gpt-4.1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
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
        readonly "gpt-5-mini": {
            id: string;
            name: string;
            api: "openai-responses";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            reasoning: true;
            thinkingLevelMap: {
                off: null;
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
        readonly "gpt-5.2": {
            id: string;
            name: string;
            api: "openai-responses";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            reasoning: true;
            thinkingLevelMap: {
                off: null;
                minimal: string;
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
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            reasoning: true;
            thinkingLevelMap: {
                off: null;
                minimal: string;
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
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            reasoning: true;
            thinkingLevelMap: {
                off: null;
                minimal: string;
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
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            reasoning: true;
            thinkingLevelMap: {
                off: null;
                minimal: string;
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
            api: "openai-responses";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            reasoning: true;
            thinkingLevelMap: {
                off: null;
                minimal: string;
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
            api: "openai-responses";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            reasoning: true;
            thinkingLevelMap: {
                off: null;
                minimal: string;
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
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            reasoning: true;
            thinkingLevelMap: {
                off: null;
                minimal: string;
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
        readonly "gpt-5.6-luna": {
            id: string;
            name: string;
            api: "openai-responses";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            reasoning: true;
            thinkingLevelMap: {
                off: null;
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
        readonly "gpt-5.6-sol": {
            id: string;
            name: string;
            api: "openai-responses";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            reasoning: true;
            thinkingLevelMap: {
                off: null;
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
        readonly "gpt-5.6-terra": {
            id: string;
            name: string;
            api: "openai-responses";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            reasoning: true;
            thinkingLevelMap: {
                off: null;
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
        readonly "kimi-k2.7-code": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
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
        readonly "mai-code-1-flash-picker": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
                "Editor-Version": string;
                "Editor-Plugin-Version": string;
                "Copilot-Integration-Id": string;
            };
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
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
    readonly google: {
        readonly "gemini-2.0-flash": {
            id: string;
            name: string;
            api: "google-generative-ai";
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
        readonly "gemini-2.0-flash-lite": {
            id: string;
            name: string;
            api: "google-generative-ai";
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
        readonly "gemini-2.5-flash": {
            id: string;
            name: string;
            api: "google-generative-ai";
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
        readonly "gemini-2.5-flash-lite": {
            id: string;
            name: string;
            api: "google-generative-ai";
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
        readonly "gemini-2.5-pro": {
            id: string;
            name: string;
            api: "google-generative-ai";
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
        readonly "gemini-3-flash-preview": {
            id: string;
            name: string;
            api: "google-generative-ai";
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
        readonly "gemini-3-pro-preview": {
            id: string;
            name: string;
            api: "google-generative-ai";
            provider: string;
            baseUrl: string;
            reasoning: true;
            thinkingLevelMap: {
                off: null;
                minimal: null;
                low: string;
                medium: null;
                high: string;
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
        readonly "gemini-3.1-flash-lite": {
            id: string;
            name: string;
            api: "google-generative-ai";
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
        readonly "gemini-3.1-flash-lite-preview": {
            id: string;
            name: string;
            api: "google-generative-ai";
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
        readonly "gemini-3.1-pro-preview": {
            id: string;
            name: string;
            api: "google-generative-ai";
            provider: string;
            baseUrl: string;
            reasoning: true;
            thinkingLevelMap: {
                off: null;
                minimal: null;
                low: string;
                medium: null;
                high: string;
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
        readonly "gemini-3.1-pro-preview-customtools": {
            id: string;
            name: string;
            api: "google-generative-ai";
            provider: string;
            baseUrl: string;
            reasoning: true;
            thinkingLevelMap: {
                off: null;
                minimal: null;
                low: string;
                medium: null;
                high: string;
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
        readonly "gemini-3.5-flash": {
            id: string;
            name: string;
            api: "google-generative-ai";
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
        readonly "gemini-flash-latest": {
            id: string;
            name: string;
            api: "google-generative-ai";
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
        readonly "gemini-flash-lite-latest": {
            id: string;
            name: string;
            api: "google-generative-ai";
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
        readonly "gemma-4-26b-a4b-it": {
            id: string;
            name: string;
            api: "google-generative-ai";
            provider: string;
            baseUrl: string;
            reasoning: true;
            thinkingLevelMap: {
                off: null;
                minimal: string;
                low: null;
                medium: null;
                high: string;
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
        readonly "gemma-4-31b-it": {
            id: string;
            name: string;
            api: "google-generative-ai";
            provider: string;
            baseUrl: string;
            reasoning: true;
            thinkingLevelMap: {
                off: null;
                minimal: string;
                low: null;
                medium: null;
                high: string;
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
    readonly "google-vertex": {
        readonly "gemini-2.5-flash": {
            id: string;
            name: string;
            api: "google-vertex";
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
        readonly "gemini-2.5-flash-lite": {
            id: string;
            name: string;
            api: "google-vertex";
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
        readonly "gemini-2.5-pro": {
            id: string;
            name: string;
            api: "google-vertex";
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
        readonly "gemini-3-flash-preview": {
            id: string;
            name: string;
            api: "google-vertex";
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
        readonly "gemini-3.1-flash-lite": {
            id: string;
            name: string;
            api: "google-vertex";
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
        readonly "gemini-3.1-pro-preview": {
            id: string;
            name: string;
            api: "google-vertex";
            provider: string;
            baseUrl: string;
            reasoning: true;
            thinkingLevelMap: {
                off: null;
                minimal: null;
                low: string;
                medium: null;
                high: string;
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
        readonly "gemini-3.1-pro-preview-customtools": {
            id: string;
            name: string;
            api: "google-vertex";
            provider: string;
            baseUrl: string;
            reasoning: true;
            thinkingLevelMap: {
                off: null;
                minimal: null;
                low: string;
                medium: null;
                high: string;
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
        readonly "gemini-3.5-flash": {
            id: string;
            name: string;
            api: "google-vertex";
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
        readonly "gemini-flash-latest": {
            id: string;
            name: string;
            api: "google-vertex";
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
        readonly "gemini-flash-lite-latest": {
            id: string;
            name: string;
            api: "google-vertex";
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
    };
    readonly groq: {
        readonly "llama-3.1-8b-instant": {
            id: string;
            name: string;
            api: "openai-completions";
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
        readonly "llama-3.3-70b-versatile": {
            id: string;
            name: string;
            api: "openai-completions";
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
        readonly "meta-llama/llama-4-scout-17b-16e-instruct": {
            id: string;
            name: string;
            api: "openai-completions";
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
        readonly "openai/gpt-oss-120b": {
            id: string;
            name: string;
            api: "openai-completions";
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
        readonly "openai/gpt-oss-20b": {
            id: string;
            name: string;
            api: "openai-completions";
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
        readonly "openai/gpt-oss-safeguard-20b": {
            id: string;
            name: string;
            api: "openai-completions";
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
        readonly "qwen/qwen3-32b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            reasoning: true;
            thinkingLevelMap: {
                minimal: null;
                low: null;
                medium: null;
                high: string;
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
    readonly huggingface: {
        readonly "MiniMaxAI/MiniMax-M2": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "MiniMaxAI/MiniMax-M2.1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "MiniMaxAI/MiniMax-M2.5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "MiniMaxAI/MiniMax-M2.7": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "MiniMaxAI/MiniMax-M3": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "Qwen/Qwen3-235B-A22B": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "Qwen/Qwen3-235B-A22B-Thinking-2507": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "Qwen/Qwen3-32B": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "Qwen/Qwen3-Coder-30B-A3B-Instruct": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "Qwen/Qwen3-Coder-480B-A35B-Instruct": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "Qwen/Qwen3-Coder-Next": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "Qwen/Qwen3-Next-80B-A3B-Instruct": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "Qwen/Qwen3-Next-80B-A3B-Thinking": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "Qwen/Qwen3.5-122B-A10B": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "Qwen/Qwen3.5-27B": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "Qwen/Qwen3.5-35B-A3B": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "Qwen/Qwen3.5-397B-A17B": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "Qwen/Qwen3.5-9B": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "Qwen/Qwen3.6-27B": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "Qwen/Qwen3.6-35B-A3B": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "XiaomiMiMo/MiMo-V2-Flash": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "XiaomiMiMo/MiMo-V2.5-Pro": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "deepseek-ai/DeepSeek-R1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "deepseek-ai/DeepSeek-R1-0528": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "deepseek-ai/DeepSeek-V3.2": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "deepseek-ai/DeepSeek-V4-Flash": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "deepseek-ai/DeepSeek-V4-Pro": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "google/gemma-4-26B-A4B-it": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "google/gemma-4-31B-it": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "meta-llama/Llama-3.3-70B-Instruct": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "moonshotai/Kimi-K2-Instruct": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "moonshotai/Kimi-K2-Instruct-0905": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "moonshotai/Kimi-K2-Thinking": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "moonshotai/Kimi-K2.5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "moonshotai/Kimi-K2.6": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "moonshotai/Kimi-K2.7-Code": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "openai/gpt-oss-120b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
            compat: {
                supportsDeveloperRole: false;
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
        readonly "stepfun-ai/Step-3.5-Flash": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "stepfun-ai/Step-3.7-Flash": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "zai-org/GLM-4.5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "zai-org/GLM-4.5-Air": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "zai-org/GLM-4.5V": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "zai-org/GLM-4.6": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "zai-org/GLM-4.7": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "zai-org/GLM-4.7-Flash": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "zai-org/GLM-5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "zai-org/GLM-5.1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
        readonly "zai-org/GLM-5.2": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
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
    readonly "kimi-coding": {
        readonly k2p7: {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
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
        readonly "kimi-for-coding": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
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
        readonly "kimi-k2-thinking": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            headers: {
                "User-Agent": string;
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
    readonly minimax: {
        readonly "MiniMax-M2.7": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "MiniMax-M2.7-highspeed": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "MiniMax-M3": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
    readonly "minimax-cn": {
        readonly "MiniMax-M2.7": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "MiniMax-M2.7-highspeed": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "MiniMax-M3": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
    readonly mistral: {
        readonly "codestral-latest": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "devstral-2512": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "devstral-latest": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "devstral-medium-2507": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "devstral-medium-latest": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "devstral-small-2505": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "devstral-small-2507": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "labs-devstral-small-2512": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "magistral-medium-latest": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "magistral-small": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "ministral-3b-latest": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "ministral-8b-latest": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "mistral-large-2411": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "mistral-large-2512": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "mistral-large-latest": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "mistral-medium-2505": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "mistral-medium-2508": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "mistral-medium-2604": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "mistral-medium-3.5": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "mistral-medium-latest": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "mistral-nemo": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "mistral-small-2506": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "mistral-small-2603": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "mistral-small-latest": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "open-mistral-7b": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "open-mistral-nemo": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "open-mixtral-8x22b": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "open-mixtral-8x7b": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "pixtral-12b": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
        readonly "pixtral-large-latest": {
            id: string;
            name: string;
            api: "mistral-conversations";
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
    };
    readonly moonshotai: {
        readonly "kimi-k2-0711-preview": {
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
                thinkingFormat: "deepseek";
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
        readonly "kimi-k2-0905-preview": {
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
                thinkingFormat: "deepseek";
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
        readonly "kimi-k2-thinking": {
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
        readonly "kimi-k2-thinking-turbo": {
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
        readonly "kimi-k2-turbo-preview": {
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
                thinkingFormat: "deepseek";
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
        readonly "kimi-k2.5": {
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
        readonly "kimi-k2.6": {
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
        readonly "kimi-k2.7-code": {
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
                thinkingFormat: "deepseek";
            };
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
        readonly "kimi-k2.7-code-highspeed": {
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
                thinkingFormat: "deepseek";
            };
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
    };
    readonly "moonshotai-cn": {
        readonly "kimi-k2-0711-preview": {
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
                thinkingFormat: "deepseek";
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
        readonly "kimi-k2-0905-preview": {
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
                thinkingFormat: "deepseek";
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
        readonly "kimi-k2-thinking": {
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
        readonly "kimi-k2-thinking-turbo": {
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
        readonly "kimi-k2-turbo-preview": {
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
                thinkingFormat: "deepseek";
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
        readonly "kimi-k2.5": {
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
        readonly "kimi-k2.6": {
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
        readonly "kimi-k2.7-code": {
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
                thinkingFormat: "deepseek";
            };
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
        readonly "kimi-k2.7-code-highspeed": {
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
                thinkingFormat: "deepseek";
            };
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
    };
    readonly nvidia: {
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
    readonly openai: {
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
        readonly "gpt-4.1": {
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
        readonly "gpt-4.1-mini": {
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
        readonly "gpt-4.1-nano": {
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
        readonly "gpt-4o-2024-05-13": {
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
        readonly "gpt-4o-2024-08-06": {
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
        readonly "gpt-4o-2024-11-20": {
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
        readonly "gpt-5": {
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
        readonly "gpt-5-chat-latest": {
            id: string;
            name: string;
            api: "openai-responses";
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
        readonly "gpt-5-mini": {
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
        readonly "gpt-5-nano": {
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
        readonly "gpt-5-pro": {
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
        readonly "gpt-5.1": {
            id: string;
            name: string;
            api: "openai-responses";
            provider: string;
            baseUrl: string;
            reasoning: true;
            thinkingLevelMap: {
                off: string;
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
        readonly "gpt-5.1-codex-max": {
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
        readonly "gpt-5.1-codex-mini": {
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
                off: string;
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
        readonly "gpt-5.2-pro": {
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
        readonly "gpt-5.3-chat-latest": {
            id: string;
            name: string;
            api: "openai-responses";
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
            api: "openai-responses";
            provider: string;
            baseUrl: string;
            reasoning: true;
            thinkingLevelMap: {
                off: string;
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
                off: string;
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
            api: "openai-responses";
            provider: string;
            baseUrl: string;
            reasoning: true;
            thinkingLevelMap: {
                off: string;
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
            api: "openai-responses";
            provider: string;
            baseUrl: string;
            reasoning: true;
            thinkingLevelMap: {
                off: string;
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
                off: string;
                xhigh: string;
                minimal: null;
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
            api: "openai-responses";
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
        readonly "gpt-5.6-luna": {
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
        readonly "gpt-5.6-sol": {
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
        readonly "gpt-5.6-terra": {
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
        readonly "gpt-realtime-2.1": {
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
        readonly "o1-pro": {
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
        readonly "o3-deep-research": {
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
        readonly "o4-mini-deep-research": {
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
    };
    readonly "openai-codex": {
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
    readonly opencode: {
        readonly "big-pickle": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
        readonly "claude-fable-5": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            compat: {
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
        readonly "deepseek-v4-flash": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
                supportsLongCacheRetention: false;
                requiresReasoningContentOnAssistantMessages: true;
            };
            reasoning: true;
            thinkingLevelMap: {
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
        readonly "deepseek-v4-flash-free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
                requiresReasoningContentOnAssistantMessages: true;
            };
            reasoning: true;
            thinkingLevelMap: {
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
        readonly "deepseek-v4-pro": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
                supportsLongCacheRetention: false;
                requiresReasoningContentOnAssistantMessages: true;
            };
            reasoning: true;
            thinkingLevelMap: {
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
        readonly "gemini-3-flash": {
            id: string;
            name: string;
            api: "google-generative-ai";
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
        readonly "gemini-3.1-pro": {
            id: string;
            name: string;
            api: "google-generative-ai";
            provider: string;
            baseUrl: string;
            reasoning: true;
            thinkingLevelMap: {
                off: null;
                minimal: null;
                low: string;
                medium: null;
                high: string;
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
        readonly "gemini-3.5-flash": {
            id: string;
            name: string;
            api: "google-generative-ai";
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
        readonly "glm-5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
        readonly "glm-5.1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
        readonly "glm-5.2": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
        readonly "gpt-5": {
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
        readonly "gpt-5-codex": {
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
        readonly "gpt-5-nano": {
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
        readonly "gpt-5.1-codex-max": {
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
        readonly "gpt-5.1-codex-mini": {
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
        readonly "gpt-5.4-mini": {
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
        readonly "gpt-5.4-nano": {
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
        readonly "gpt-5.4-pro": {
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
        readonly "gpt-5.5-pro": {
            id: string;
            name: string;
            api: "openai-responses";
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
        readonly "gpt-5.6-luna": {
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
        readonly "gpt-5.6-sol": {
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
        readonly "gpt-5.6-terra": {
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
        readonly "grok-4.5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
        readonly "grok-build-0.1": {
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
            };
            reasoning: true;
            thinkingLevelMap: {
                off: null;
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
        readonly "hy3-free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
        readonly "kimi-k2.5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
        readonly "kimi-k2.6": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                thinkingFormat: "deepseek";
                supportsReasoningEffort: false;
                maxTokensField: "max_tokens";
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
        readonly "kimi-k2.7-code": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
        readonly "mimo-v2.5-free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
        readonly "minimax-m2.5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
        readonly "minimax-m2.7": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
        readonly "minimax-m3": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
        readonly "nemotron-3-ultra-free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
        readonly "north-mini-code-free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
        readonly "qwen3.5-plus": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "qwen3.6-plus": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
    readonly "opencode-go": {
        readonly "deepseek-v4-flash": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
                requiresReasoningContentOnAssistantMessages: true;
                thinkingFormat: "deepseek";
            };
            reasoning: true;
            thinkingLevelMap: {
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
        readonly "deepseek-v4-pro": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
                requiresReasoningContentOnAssistantMessages: true;
                thinkingFormat: "deepseek";
            };
            reasoning: true;
            thinkingLevelMap: {
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
        readonly "glm-5.1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
        readonly "glm-5.2": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
        readonly "kimi-k2.6": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                thinkingFormat: "deepseek";
                supportsReasoningEffort: false;
                maxTokensField: "max_tokens";
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
        readonly "kimi-k2.7-code": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
        readonly "mimo-v2.5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
        readonly "minimax-m2.7": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                maxTokensField: "max_tokens";
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
        readonly "minimax-m3": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "qwen3.6-plus": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                thinkingFormat: "qwen";
                maxTokensField: "max_tokens";
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
        readonly "qwen3.7-max": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "qwen3.7-plus": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
    readonly openrouter: {
        readonly "ai21/jamba-large-1.7": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "aion-labs/aion-2.0": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "aion-labs/aion-3.0": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "aion-labs/aion-3.0-mini": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "amazon/nova-2-lite-v1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "amazon/nova-lite-v1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "amazon/nova-micro-v1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "amazon/nova-premier-v1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "amazon/nova-pro-v1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "anthropic/claude-3-haiku": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
                cacheControlFormat: "anthropic";
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
        readonly "anthropic/claude-fable-5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
                cacheControlFormat: "anthropic";
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
        readonly "anthropic/claude-haiku-4.5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
                cacheControlFormat: "anthropic";
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
        readonly "anthropic/claude-opus-4": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
                cacheControlFormat: "anthropic";
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
        readonly "anthropic/claude-opus-4.1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
                cacheControlFormat: "anthropic";
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
        readonly "anthropic/claude-opus-4.5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
                cacheControlFormat: "anthropic";
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
        readonly "anthropic/claude-opus-4.6": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
                cacheControlFormat: "anthropic";
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
        readonly "anthropic/claude-opus-4.7": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
                cacheControlFormat: "anthropic";
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
        readonly "anthropic/claude-opus-4.7-fast": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
                cacheControlFormat: "anthropic";
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
        readonly "anthropic/claude-opus-4.8": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
                cacheControlFormat: "anthropic";
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
        readonly "anthropic/claude-opus-4.8-fast": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
                cacheControlFormat: "anthropic";
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
        readonly "anthropic/claude-sonnet-4": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
                cacheControlFormat: "anthropic";
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
        readonly "anthropic/claude-sonnet-4.5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
                cacheControlFormat: "anthropic";
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
        readonly "anthropic/claude-sonnet-4.6": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
                cacheControlFormat: "anthropic";
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
        readonly "anthropic/claude-sonnet-5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
                cacheControlFormat: "anthropic";
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
        readonly "arcee-ai/trinity-large-thinking": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "arcee-ai/virtuoso-large": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly auto: {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "bytedance-seed/seed-1.6": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "bytedance-seed/seed-1.6-flash": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "bytedance-seed/seed-2.0-lite": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "bytedance-seed/seed-2.0-mini": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "cohere/command-r-08-2024": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "cohere/command-r-plus-08-2024": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "cohere/north-mini-code:free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "deepseek/deepseek-chat": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "deepseek/deepseek-chat-v3-0324": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "deepseek/deepseek-chat-v3.1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "deepseek/deepseek-r1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "deepseek/deepseek-r1-0528": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "deepseek/deepseek-v3.1-terminus": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "deepseek/deepseek-v3.2": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "deepseek/deepseek-v3.2-exp": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "deepseek/deepseek-v4-flash": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
                requiresReasoningContentOnAssistantMessages: true;
            };
            reasoning: true;
            thinkingLevelMap: {
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
        readonly "deepseek/deepseek-v4-pro": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
                requiresReasoningContentOnAssistantMessages: true;
            };
            reasoning: true;
            thinkingLevelMap: {
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
        readonly "google/gemini-2.5-flash": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "google/gemini-2.5-flash-lite": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "google/gemini-2.5-pro": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "google/gemini-2.5-pro-preview": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "google/gemini-2.5-pro-preview-05-06": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "google/gemini-3-flash-preview": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "google/gemini-3-pro-image": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "google/gemini-3.1-flash-lite": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "google/gemini-3.1-flash-lite-preview": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "google/gemini-3.1-pro-preview": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "google/gemini-3.1-pro-preview-customtools": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "google/gemini-3.5-flash": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "google/gemma-3-12b-it": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "google/gemma-3-27b-it": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "google/gemma-4-26b-a4b-it": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "google/gemma-4-26b-a4b-it:free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "google/gemma-4-31b-it": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "google/gemma-4-31b-it:free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "ibm-granite/granite-4.1-8b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "inception/mercury-2": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
            };
            reasoning: true;
            thinkingLevelMap: {
                off: null;
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
        readonly "inclusionai/ling-2.6-1t": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "inclusionai/ling-2.6-flash": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "inclusionai/ring-2.6-1t": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "kwaipilot/kat-coder-pro-v2": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "liquid/lfm-2.5-1.2b-thinking:free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "meta-llama/llama-3.1-70b-instruct": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "meta-llama/llama-3.1-8b-instruct": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "meta-llama/llama-3.3-70b-instruct": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "meta-llama/llama-3.3-70b-instruct:free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "meta-llama/llama-4-maverick": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "meta-llama/llama-4-scout": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "minimax/minimax-m1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "minimax/minimax-m2": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "minimax/minimax-m2.1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "minimax/minimax-m2.5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "minimax/minimax-m2.7": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "minimax/minimax-m3": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "mistralai/codestral-2508": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "mistralai/devstral-2512": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "mistralai/ministral-14b-2512": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "mistralai/ministral-3b-2512": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "mistralai/ministral-8b-2512": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "mistralai/mistral-large": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "mistralai/mistral-large-2407": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "mistralai/mistral-large-2512": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "mistralai/mistral-medium-3": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "mistralai/mistral-medium-3-5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "mistralai/mistral-medium-3.1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "mistralai/mistral-nemo": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "mistralai/mistral-saba": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "mistralai/mistral-small-2603": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "mistralai/mistral-small-3.2-24b-instruct": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "mistralai/mixtral-8x22b-instruct": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "mistralai/voxtral-small-24b-2507": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "moonshotai/kimi-k2": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "moonshotai/kimi-k2-0905": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "moonshotai/kimi-k2-thinking": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "moonshotai/kimi-k2.5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
                requiresReasoningContentOnAssistantMessages: true;
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
        readonly "moonshotai/kimi-k2.7-code": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "nex-agi/nex-n2-mini": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "nex-agi/nex-n2-pro": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "nvidia/llama-3.3-nemotron-super-49b-v1.5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "nvidia/nemotron-3-nano-30b-a3b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "nvidia/nemotron-3-nano-30b-a3b:free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "nvidia/nemotron-3-super-120b-a12b:free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "nvidia/nemotron-3-ultra-550b-a55b:free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "nvidia/nemotron-nano-12b-v2-vl:free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "nvidia/nemotron-nano-9b-v2:free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-3.5-turbo": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-3.5-turbo-0613": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-3.5-turbo-16k": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-4": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-4-turbo": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-4-turbo-preview": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-4.1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-4.1-mini": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-4.1-nano": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-4o": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-4o-2024-05-13": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-4o-2024-08-06": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-4o-2024-11-20": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-4o-mini": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-4o-mini-2024-07-18": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5-codex": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5-mini": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5-nano": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5-pro": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.1-chat": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.1-codex": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.1-codex-max": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.1-codex-mini": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.2": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.2-chat": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
            };
            reasoning: false;
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
        readonly "openai/gpt-5.2-codex": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.2-pro": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.3-chat": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
            };
            reasoning: false;
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
        readonly "openai/gpt-5.3-codex": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.4": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.4-mini": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.4-nano": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.4-pro": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.5-pro": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
            };
            reasoning: true;
            thinkingLevelMap: {
                xhigh: string;
                off: null;
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
        readonly "openai/gpt-5.6-luna": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.6-luna-pro": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.6-sol": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.6-sol-pro": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.6-terra": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-5.6-terra-pro": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-audio": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-audio-mini": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-chat-latest": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-oss-120b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-oss-120b:free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-oss-20b:free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/gpt-oss-safeguard-20b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/o1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/o3": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/o3-deep-research": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/o3-mini": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/o3-mini-high": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/o3-pro": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/o4-mini": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/o4-mini-deep-research": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openai/o4-mini-high": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                thinkingFormat: "openrouter";
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
        readonly "openrouter/auto": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "openrouter/free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "openrouter/fusion": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "poolside/laguna-m.1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "poolside/laguna-m.1:free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "poolside/laguna-xs-2.1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "poolside/laguna-xs-2.1:free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen-2.5-72b-instruct": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen-2.5-7b-instruct": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen-plus": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen-plus-2025-07-28": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen-plus-2025-07-28:thinking": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-14b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-235b-a22b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-235b-a22b-2507": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-235b-a22b-thinking-2507": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-30b-a3b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-30b-a3b-instruct-2507": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-30b-a3b-thinking-2507": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-32b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-8b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-coder": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-coder-30b-a3b-instruct": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-coder-flash": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-coder-next": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-coder-plus": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-coder:free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-max": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-max-thinking": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-next-80b-a3b-instruct": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-next-80b-a3b-instruct:free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-next-80b-a3b-thinking": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-vl-235b-a22b-instruct": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-vl-235b-a22b-thinking": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-vl-30b-a3b-instruct": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-vl-30b-a3b-thinking": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-vl-32b-instruct": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-vl-8b-instruct": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3-vl-8b-thinking": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3.5-122b-a10b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3.5-27b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3.5-35b-a3b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3.5-397b-a17b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3.5-9b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3.5-flash-02-23": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3.5-plus-02-15": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3.5-plus-20260420": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3.6-27b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3.6-35b-a3b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3.6-flash": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3.6-max-preview": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3.6-plus": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3.7-max": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "qwen/qwen3.7-plus": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "rekaai/reka-edge": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "relace/relace-search": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "sakana/fugu-ultra": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "sao10k/l3.1-euryale-70b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "stepfun/step-3.5-flash": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "stepfun/step-3.7-flash": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "tencent/hy3": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "tencent/hy3-preview": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "tencent/hy3:free": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "thedrummer/unslopnemo-12b": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "upstage/solar-pro-3": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "x-ai/grok-4.20": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "x-ai/grok-4.3": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "x-ai/grok-4.5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "x-ai/grok-build-0.1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "xiaomi/mimo-v2.5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "xiaomi/mimo-v2.5-pro": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "z-ai/glm-4.5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "z-ai/glm-4.5-air": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "z-ai/glm-4.5v": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "z-ai/glm-4.6": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "z-ai/glm-4.6v": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "z-ai/glm-4.7": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "z-ai/glm-4.7-flash": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "z-ai/glm-5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "z-ai/glm-5-turbo": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "z-ai/glm-5.1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "z-ai/glm-5.2": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
            };
            reasoning: true;
            thinkingLevelMap: {
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
        readonly "z-ai/glm-5v-turbo": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "~anthropic/claude-fable-latest": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "~anthropic/claude-haiku-latest": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "~anthropic/claude-opus-latest": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "~anthropic/claude-sonnet-latest": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "~google/gemini-flash-latest": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "~google/gemini-pro-latest": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "~moonshotai/kimi-latest": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "~openai/gpt-latest": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "~openai/gpt-mini-latest": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
        readonly "~x-ai/grok-latest": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsDeveloperRole: false;
                thinkingFormat: "openrouter";
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
    readonly together: {
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
    readonly "vercel-ai-gateway": {
        readonly "alibaba/qwen-3-14b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen-3-235b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen-3-30b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen-3-32b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen-3.6-max-preview": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen3-235b-a22b-thinking": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen3-coder": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen3-coder-30b-a3b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen3-coder-next": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen3-coder-plus": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen3-max": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen3-max-preview": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen3-max-thinking": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen3-next-80b-a3b-instruct": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen3-next-80b-a3b-thinking": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen3-vl-235b-a22b-instruct": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen3-vl-instruct": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen3-vl-thinking": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen3.5-flash": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen3.5-plus": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen3.6-27b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen3.6-plus": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen3.7-max": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "alibaba/qwen3.7-plus": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "amazon/nova-2-lite": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "amazon/nova-lite": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "amazon/nova-micro": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "amazon/nova-pro": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "anthropic/claude-3-haiku": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "anthropic/claude-3.5-haiku": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "anthropic/claude-fable-5": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            compat: {
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
        readonly "anthropic/claude-haiku-4.5": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "anthropic/claude-opus-4": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "anthropic/claude-opus-4.1": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "anthropic/claude-opus-4.5": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "anthropic/claude-opus-4.6": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            compat: {
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
        readonly "anthropic/claude-opus-4.7": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            compat: {
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
        readonly "anthropic/claude-opus-4.8": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            compat: {
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
        readonly "anthropic/claude-sonnet-4": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "anthropic/claude-sonnet-4.5": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "anthropic/claude-sonnet-4.6": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            compat: {
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
        readonly "anthropic/claude-sonnet-5": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            compat: {
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
        readonly "arcee-ai/trinity-large-preview": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "arcee-ai/trinity-large-thinking": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "arcee-ai/trinity-mini": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "bytedance/seed-1.6": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "bytedance/seed-1.8": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "cohere/command-a": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "deepseek/deepseek-r1": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "deepseek/deepseek-v3": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "deepseek/deepseek-v3.1": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "deepseek/deepseek-v3.1-terminus": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "deepseek/deepseek-v3.2": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "deepseek/deepseek-v3.2-thinking": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "deepseek/deepseek-v4-flash": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "deepseek/deepseek-v4-pro": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "google/gemini-2.5-flash": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "google/gemini-2.5-flash-lite": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "google/gemini-2.5-pro": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "google/gemini-3-flash": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "google/gemini-3-pro-preview": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "google/gemini-3.1-flash-lite": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "google/gemini-3.1-flash-lite-preview": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "google/gemini-3.1-pro-preview": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "google/gemini-3.5-flash": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "google/gemma-4-26b-a4b-it": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "google/gemma-4-31b-it": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "inception/mercury-2": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "inception/mercury-coder-small": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "interfaze/interfaze-beta": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "kwaipilot/kat-coder-air-v2.5": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "kwaipilot/kat-coder-pro-v1": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "kwaipilot/kat-coder-pro-v2": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "kwaipilot/kat-coder-pro-v2.5": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "meituan/longcat-flash-chat": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "meituan/longcat-flash-thinking-2601": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "meta/llama-3.1-70b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "meta/llama-3.1-8b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "meta/llama-3.2-11b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "meta/llama-3.2-90b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "meta/llama-3.3-70b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "meta/llama-4-maverick": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "meta/llama-4-scout": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "meta/muse-spark-1.1": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "minimax/minimax-m2": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "minimax/minimax-m2.1": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "minimax/minimax-m2.1-lightning": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "minimax/minimax-m2.5": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "minimax/minimax-m2.5-highspeed": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "minimax/minimax-m2.7": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "minimax/minimax-m2.7-highspeed": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "minimax/minimax-m3": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "mistral/codestral": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "mistral/devstral-2": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "mistral/devstral-small": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "mistral/devstral-small-2": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "mistral/magistral-medium": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "mistral/magistral-small": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "mistral/ministral-14b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "mistral/ministral-3b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "mistral/ministral-8b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "mistral/mistral-large-3": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "mistral/mistral-medium": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "mistral/mistral-medium-3.5": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "mistral/mistral-nemo": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "mistral/mistral-small": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "mistral/pixtral-12b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "mistral/pixtral-large": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "moonshotai/kimi-k2": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "moonshotai/kimi-k2-thinking": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "moonshotai/kimi-k2.5": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "moonshotai/kimi-k2.6": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "moonshotai/kimi-k2.7-code": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "moonshotai/kimi-k2.7-code-highspeed": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "nvidia/nemotron-3-nano-30b-a3b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "nvidia/nemotron-3-super-120b-a12b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "nvidia/nemotron-3-ultra-550b-a55b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "nvidia/nemotron-nano-12b-v2-vl": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "nvidia/nemotron-nano-9b-v2": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-3.5-turbo": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-4-turbo": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-4.1": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-4.1-mini": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-4.1-nano": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-4o": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-4o-mini": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5-chat": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5-codex": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5-mini": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5-nano": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5-pro": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5.1-codex": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5.1-codex-max": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5.1-codex-mini": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5.1-instant": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5.1-thinking": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5.2": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5.2-chat": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            reasoning: false;
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
        readonly "openai/gpt-5.2-codex": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5.2-pro": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5.3-chat": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            reasoning: false;
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
        readonly "openai/gpt-5.3-codex": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5.4": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5.4-mini": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5.4-nano": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5.4-pro": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5.5": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5.5-pro": {
            id: string;
            name: string;
            api: "anthropic-messages";
            provider: string;
            baseUrl: string;
            reasoning: true;
            thinkingLevelMap: {
                xhigh: string;
                off: null;
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
        readonly "openai/gpt-5.6-luna": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5.6-sol": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-5.6-terra": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-oss-120b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-oss-20b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/gpt-oss-safeguard-20b": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/o1": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/o3": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/o3-deep-research": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/o3-mini": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/o3-pro": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "openai/o4-mini": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "sakana/fugu-ultra": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "stepfun/step-3.5-flash": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "stepfun/step-3.7-flash": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "xai/grok-4.1-fast-non-reasoning": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "xai/grok-4.1-fast-reasoning": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "xai/grok-4.20-multi-agent": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "xai/grok-4.20-multi-agent-beta": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "xai/grok-4.20-non-reasoning": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "xai/grok-4.20-non-reasoning-beta": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "xai/grok-4.20-reasoning": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "xai/grok-4.20-reasoning-beta": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "xai/grok-4.3": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "xai/grok-4.5": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "xai/grok-build-0.1": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "xiaomi/mimo-v2-flash": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "xiaomi/mimo-v2-pro": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "xiaomi/mimo-v2.5": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "xiaomi/mimo-v2.5-pro": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "zai/glm-4.5": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "zai/glm-4.5-air": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "zai/glm-4.5v": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "zai/glm-4.6": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "zai/glm-4.6v": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "zai/glm-4.6v-flash": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "zai/glm-4.7": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "zai/glm-4.7-flash": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "zai/glm-4.7-flashx": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "zai/glm-5": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "zai/glm-5-turbo": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "zai/glm-5.1": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "zai/glm-5.2": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "zai/glm-5.2-fast": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
        readonly "zai/glm-5v-turbo": {
            id: string;
            name: string;
            api: "anthropic-messages";
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
    readonly xai: {
        readonly "grok-3": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
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
        readonly "grok-3-fast": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
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
        readonly "grok-4.20-0309-non-reasoning": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
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
        readonly "grok-4.20-0309-reasoning": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
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
        readonly "grok-4.3": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
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
        readonly "grok-4.5": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
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
        readonly "grok-build-0.1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
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
        readonly "grok-code-fast-1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
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
    };
    readonly xiaomi: {
        readonly "mimo-v2-flash": {
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
    readonly "xiaomi-token-plan-ams": {
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
    readonly "xiaomi-token-plan-cn": {
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
    readonly "xiaomi-token-plan-sgp": {
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
    readonly zai: {
        readonly "glm-4.5-air": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
                thinkingFormat: "zai";
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
        readonly "glm-4.7": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
                thinkingFormat: "zai";
                zaiToolStream: true;
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
        readonly "glm-5-turbo": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
                thinkingFormat: "zai";
                zaiToolStream: true;
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
        readonly "glm-5.1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
                thinkingFormat: "zai";
                zaiToolStream: true;
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
        readonly "glm-5.2": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: true;
                thinkingFormat: "zai";
                zaiToolStream: true;
            };
            reasoning: true;
            thinkingLevelMap: {
                minimal: null;
                low: string;
                medium: string;
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
        readonly "glm-5v-turbo": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
                thinkingFormat: "zai";
                zaiToolStream: true;
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
    readonly "zai-coding-cn": {
        readonly "glm-4.5-air": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
                thinkingFormat: "zai";
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
        readonly "glm-4.7": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
                thinkingFormat: "zai";
                zaiToolStream: true;
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
        readonly "glm-5-turbo": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
                thinkingFormat: "zai";
                zaiToolStream: true;
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
        readonly "glm-5.1": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
                thinkingFormat: "zai";
                zaiToolStream: true;
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
        readonly "glm-5.2": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: true;
                thinkingFormat: "zai";
                zaiToolStream: true;
            };
            reasoning: true;
            thinkingLevelMap: {
                minimal: null;
                low: string;
                medium: string;
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
        readonly "glm-5v-turbo": {
            id: string;
            name: string;
            api: "openai-completions";
            provider: string;
            baseUrl: string;
            compat: {
                supportsStore: false;
                supportsDeveloperRole: false;
                supportsReasoningEffort: false;
                thinkingFormat: "zai";
                zaiToolStream: true;
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
};
//# sourceMappingURL=models.generated.d.ts.map