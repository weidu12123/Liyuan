import { type Provider } from "../models.ts";
import type { AssistantMessage, Context, Model, SimpleStreamOptions, StreamFunction, StreamOptions, TextContent, ThinkingContent, ToolCall } from "../types.ts";
export interface FauxModelDefinition {
    id: string;
    name?: string;
    reasoning?: boolean;
    input?: ("text" | "image")[];
    cost?: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    };
    contextWindow?: number;
    maxTokens?: number;
}
export type FauxContentBlock = TextContent | ThinkingContent | ToolCall;
export declare function fauxText(text: string): TextContent;
export declare function fauxThinking(thinking: string): ThinkingContent;
export declare function fauxToolCall(name: string, arguments_: ToolCall["arguments"], options?: {
    id?: string;
}): ToolCall;
export declare function fauxAssistantMessage(content: string | FauxContentBlock | FauxContentBlock[], options?: {
    stopReason?: AssistantMessage["stopReason"];
    errorMessage?: string;
    responseId?: string;
    timestamp?: number;
}): AssistantMessage;
export type FauxResponseFactory = (context: Context, options: StreamOptions | undefined, state: {
    callCount: number;
}, model: Model<string>) => AssistantMessage | Promise<AssistantMessage>;
export type FauxResponseStep = AssistantMessage | FauxResponseFactory;
export interface RegisterFauxProviderOptions {
    api?: string;
    provider?: string;
    models?: FauxModelDefinition[];
    tokensPerSecond?: number;
    tokenSize?: {
        min?: number;
        max?: number;
    };
}
export interface FauxProviderRegistration {
    api: string;
    models: [Model<string>, ...Model<string>[]];
    getModel(): Model<string>;
    getModel(modelId: string): Model<string> | undefined;
    state: {
        callCount: number;
    };
    setResponses: (responses: FauxResponseStep[]) => void;
    appendResponses: (responses: FauxResponseStep[]) => void;
    getPendingResponseCount: () => number;
    unregister: () => void;
}
export interface FauxProviderHandle {
    provider: Provider;
    api: string;
    models: [Model<string>, ...Model<string>[]];
    getModel(): Model<string>;
    getModel(modelId: string): Model<string> | undefined;
    state: {
        callCount: number;
    };
    setResponses: (responses: FauxResponseStep[]) => void;
    appendResponses: (responses: FauxResponseStep[]) => void;
    getPendingResponseCount: () => number;
}
export declare function createFauxCore(options: RegisterFauxProviderOptions): {
    api: string;
    provider: string;
    models: [Model<string>, ...Model<string>[]];
    stream: StreamFunction<string, StreamOptions>;
    streamSimple: StreamFunction<string, SimpleStreamOptions>;
    getModel: {
        (): Model<string>;
        (requestedModelId: string): Model<string> | undefined;
    };
    state: {
        callCount: number;
    };
    setResponses(responses: FauxResponseStep[]): void;
    appendResponses(responses: FauxResponseStep[]): void;
    getPendingResponseCount(): number;
};
/**
 * Faux provider for tests built on explicit `Models` collections:
 *
 * ```ts
 * const faux = fauxProvider();
 * const models = createModels();
 * models.setProvider(faux.provider);
 * faux.setResponses([fauxAssistantMessage("hi")]);
 * ```
 */
export declare function fauxProvider(options?: RegisterFauxProviderOptions): FauxProviderHandle;
//# sourceMappingURL=faux.d.ts.map