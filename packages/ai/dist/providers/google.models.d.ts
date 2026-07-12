export declare const GOOGLE_MODELS: {
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
//# sourceMappingURL=google.models.d.ts.map