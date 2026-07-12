export declare const ANTHROPIC_MODELS: {
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
//# sourceMappingURL=anthropic.models.d.ts.map