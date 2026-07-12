export declare const GITHUB_COPILOT_MODELS: {
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
//# sourceMappingURL=github-copilot.models.d.ts.map