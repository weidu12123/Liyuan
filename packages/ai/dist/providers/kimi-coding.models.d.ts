export declare const KIMI_CODING_MODELS: {
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
//# sourceMappingURL=kimi-coding.models.d.ts.map