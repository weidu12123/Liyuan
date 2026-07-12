/**
 * Model registry - manages built-in and custom models, provides API key resolution.
 */
import { type Api, type AssistantMessageEventStream, type Context, type Model, type OAuthProviderInterface, type SimpleStreamOptions } from "@liyuan/ai/compat";
import type { AuthStatus, AuthStorage } from "./auth-storage.ts";
import { clearConfigValueCache } from "./resolve-config-value.ts";
export type ResolvedRequestAuth = {
    ok: true;
    apiKey?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
} | {
    ok: false;
    error: string;
};
/** Clear the config value command cache. Exported for testing. */
export declare const clearApiKeyCache: typeof clearConfigValueCache;
/**
 * Model registry - loads and manages models, resolves API keys via AuthStorage.
 */
export declare class ModelRegistry {
    private models;
    private providerRequestConfigs;
    private modelRequestHeaders;
    private registeredProviders;
    private loadError;
    readonly authStorage: AuthStorage;
    private modelsJsonPath;
    private constructor();
    static create(authStorage: AuthStorage, modelsJsonPath?: string): ModelRegistry;
    static inMemory(authStorage: AuthStorage): ModelRegistry;
    /**
     * Reload models from disk (built-in + custom from models.json).
     */
    refresh(): void;
    /**
     * Get any error from loading models.json (undefined if no error).
     */
    getError(): string | undefined;
    private loadModels;
    /** Load built-in models and apply provider/model overrides */
    private loadBuiltInModels;
    /** Merge custom models into built-in list by provider+id (custom wins on conflicts). */
    private mergeCustomModels;
    private loadCustomModels;
    private validateConfig;
    private parseModels;
    /**
     * Get all models (built-in + custom).
     * If models.json had errors, returns only built-in models.
     */
    getAll(): Model<Api>[];
    /**
     * Get only models that have auth configured.
     * This is a fast check that doesn't refresh OAuth tokens.
     */
    getAvailable(): Model<Api>[];
    /**
     * Find a model by provider and ID.
     */
    find(provider: string, modelId: string): Model<Api> | undefined;
    /**
     * Get API key for a model.
     */
    hasConfiguredAuth(model: Model<Api>): boolean;
    private getModelRequestKey;
    private storeProviderRequestConfig;
    private storeModelHeaders;
    /**
     * Get API key and request headers for a model.
     */
    getApiKeyAndHeaders(model: Model<Api>): Promise<ResolvedRequestAuth>;
    /**
     * Return auth status for a provider, including request auth configured in models.json.
     * This intentionally does not execute command-backed config values.
     */
    getProviderAuthStatus(provider: string): AuthStatus;
    /**
     * Get display name for a provider.
     */
    getProviderDisplayName(provider: string): string;
    /**
     * Get API key for a provider.
     */
    getApiKeyForProvider(provider: string): Promise<string | undefined>;
    /**
     * Check if a model is using OAuth credentials (subscription).
     */
    isUsingOAuth(model: Model<Api>): boolean;
    /**
     * Register a provider dynamically (from extensions).
     *
     * If provider has models: replaces all existing models for this provider.
     * If provider has only baseUrl/headers: overrides existing models' URLs.
     * If provider has oauth: registers OAuth provider for /login support.
     */
    registerProvider(providerName: string, config: ProviderConfigInput): void;
    /**
     * Unregister a previously registered provider.
     *
     * Removes the provider from the registry and reloads models from disk so that
     * built-in models overridden by this provider are restored to their original state.
     * Also resets dynamic OAuth and API stream registrations before reapplying
     * remaining dynamic providers.
     * Has no effect if the provider was never registered.
     */
    unregisterProvider(providerName: string): void;
    /**
     * Upsert a provider config into registeredProviders.
     * If the provider is already registered, defined values in the incoming config
     * override existing ones; undefined values are preserved from the stored config.
     * If the provider is not registered, the incoming config is stored as-is.
     */
    private upsertRegisteredProvider;
    private validateProviderConfig;
    private applyProviderConfig;
}
/**
 * Input type for registerProvider API.
 */
export interface ProviderConfigInput {
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    api?: Api;
    streamSimple?: (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream;
    headers?: Record<string, string>;
    authHeader?: boolean;
    /** OAuth provider for /login support */
    oauth?: Omit<OAuthProviderInterface, "id">;
    models?: Array<{
        id: string;
        name: string;
        api?: Api;
        baseUrl?: string;
        reasoning: boolean;
        thinkingLevelMap?: Model<Api>["thinkingLevelMap"];
        input: ("text" | "image")[];
        cost: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
        };
        contextWindow: number;
        maxTokens: number;
        headers?: Record<string, string>;
        compat?: Model<Api>["compat"];
    }>;
}
//# sourceMappingURL=model-registry.d.ts.map