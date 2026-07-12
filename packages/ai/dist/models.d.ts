import type { AuthContext, AuthResult, CredentialStore, ProviderAuth } from "./auth/types.ts";
import type { Api, ApiStreamOptions, AssistantMessage, AssistantMessageEventStream, Context, Model, ModelThinkingLevel, ProviderHeaders, ProviderStreams, SimpleStreamOptions, Usage } from "./types.ts";
export { type AuthModel, ModelsError, type ModelsErrorCode } from "./auth/resolve.ts";
/**
 * A provider is the concrete runtime unit. It owns id/name/base metadata,
 * auth methods, model listing, and stream behavior.
 *
 * `TApi` lets concrete provider factories declare which APIs their models
 * use (e.g. `openaiProvider(): Provider<"openai-responses" | "openai-completions">`),
 * giving typed model lists to direct factory users. Inside a `Models`
 * collection providers are held as `Provider<Api>`.
 */
export interface Provider<TApi extends Api = Api> {
    readonly id: string;
    readonly name: string;
    readonly baseUrl?: string;
    readonly headers?: ProviderHeaders;
    /**
     * Required: at least one of `apiKey`/`oauth`. Every provider has auth
     * semantics — even providers with only ambient credentials (env vars, AWS
     * profiles, ADC files) and keyless local servers provide `apiKey` auth
     * whose `resolve()` reports whether the provider is configured.
     * `Models.getAuth()` returns undefined when the provider is unconfigured.
     */
    readonly auth: ProviderAuth;
    /**
     * Current known models, sync. Static providers return their catalog;
     * dynamic providers return the list as of the last `refreshModels()`
     * (empty before the first). Must not throw; `Models` treats a throwing
     * implementation as having no models.
     */
    getModels(): readonly Model<TApi>[];
    /**
     * Dynamic providers only: fetch and update the model list. Side-effect-free
     * discovery (no loading/downloading); provider-specific model lifecycle
     * belongs in app commands. Concurrent calls share one in-flight fetch.
     * May reject (network); on rejection the model list stays at its last-known
     * state and a later call retries.
     */
    refreshModels?(): Promise<void>;
    stream<T extends TApi>(model: Model<T>, context: Context, options?: ApiStreamOptions<T>): AssistantMessageEventStream;
    streamSimple(model: Model<TApi>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
}
/**
 * Runtime collection of providers plus auth application and stream
 * convenience. Providers own stream behavior; `Models` resolves auth and
 * delegates each request to the provider that owns the model.
 */
export interface Models {
    getProviders(): readonly Provider[];
    getProvider(id: string): Provider | undefined;
    /**
     * Sync read of last-known models from one provider or all providers.
     * Best-effort: a provider whose `getModels()` throws yields no models.
     */
    getModels(provider?: string): readonly Model<Api>[];
    /**
     * Sync runtime model lookup against last-known lists. Dynamic model lists
     * are typed as `Model<Api>`; narrow with the `hasApi()` type guard.
     */
    getModel(provider: string, id: string): Model<Api> | undefined;
    /**
     * Ask dynamic providers to re-fetch their model lists. With a provider id,
     * rejects with `ModelsError` ("model_source") on that provider's fetch
     * failure; without one, refreshes all providers concurrently best-effort.
     * Static providers (no `refreshModels`) are no-ops.
     */
    refresh(provider?: string): Promise<void>;
    /**
     * Resolve request auth for a model. Includes a source label for status UI.
     * Resolves `undefined` when the provider is unknown or unconfigured.
     * Rejects with `ModelsError`: code "oauth" when a token refresh fails (the
     * stored credential is preserved for retry; re-login fixes it), code "auth"
     * when api-key resolution or the credential store fails. Request paths
     * surface rejections as stream errors; status/availability UIs catch them
     * and render "needs re-login" instead of treating them as unconfigured.
     */
    getAuth(model: Model<Api>): Promise<AuthResult | undefined>;
    stream<TApi extends Api>(model: Model<TApi>, context: Context, options?: ApiStreamOptions<TApi>): AssistantMessageEventStream;
    complete<TApi extends Api>(model: Model<TApi>, context: Context, options?: ApiStreamOptions<TApi>): Promise<AssistantMessage>;
    streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
    completeSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): Promise<AssistantMessage>;
}
export interface MutableModels extends Models {
    /** Upsert/replace by provider.id. Provider ids are unique. */
    setProvider(provider: Provider): void;
    deleteProvider(id: string): void;
    clearProviders(): void;
}
export interface CreateModelsOptions {
    credentials?: CredentialStore;
    authContext?: AuthContext;
}
export declare function createModels(options?: CreateModelsOptions): MutableModels;
export interface CreateProviderOptions<TApi extends Api = Api> {
    id: string;
    /** Display name. Default: `id`. */
    name?: string;
    baseUrl?: string;
    headers?: ProviderHeaders;
    /** Required — every provider has auth semantics, even ambient/keyless ones. */
    auth: ProviderAuth;
    /** Initial model list (empty for purely dynamic providers). */
    models: readonly Model<TApi>[];
    /**
     * Dynamic providers: fetch the current list. Stored on success; concurrent
     * calls share one in-flight fetch. May reject: the stored list then stays
     * at its last-known state, the rejection propagates to the caller of
     * `refreshModels()` (wrapped as ModelsError "model_source" by
     * `Models.refresh(provider)`), and a later call retries.
     */
    refreshModels?: () => Promise<readonly Model<TApi>[]>;
    /** Single implementation, or map keyed by `model.api` for mixed-API providers. */
    api: ProviderStreams | Partial<Record<TApi, ProviderStreams>>;
}
/**
 * Builds a provider from parts. Built-in provider factories and models.json
 * custom providers both go through this. A single `api` streams all models;
 * an `api` map dispatches on `model.api`, and a model whose api has no entry
 * produces a stream error.
 */
export declare function createProvider<TApi extends Api = Api>(input: CreateProviderOptions<TApi>): Provider<TApi>;
/**
 * Runtime-checked narrowing for dynamically looked-up models:
 *
 * ```ts
 * const model = models.getModel("anthropic", "claude-opus-4-7");
 * if (model && hasApi(model, "anthropic-messages")) {
 *   // model: Model<"anthropic-messages">, stream options fully typed
 * }
 * ```
 */
export declare function hasApi<TApi extends Api>(model: Model<Api>, api: TApi): model is Model<TApi>;
export declare function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Usage["cost"];
export declare function getSupportedThinkingLevels<TApi extends Api>(model: Model<TApi>): ModelThinkingLevel[];
export declare function clampThinkingLevel<TApi extends Api>(model: Model<TApi>, level: ModelThinkingLevel): ModelThinkingLevel;
/**
 * Check if two models are equal by comparing both their id and provider.
 * Returns false if either model is null or undefined.
 */
export declare function modelsAreEqual<TApi extends Api>(a: Model<TApi> | null | undefined, b: Model<TApi> | null | undefined): boolean;
//# sourceMappingURL=models.d.ts.map