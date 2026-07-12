import { lazyStream } from "./api/lazy.js";
import { defaultProviderAuthContext as defaultAuthContext } from "./auth/context.js";
import { InMemoryCredentialStore } from "./auth/credential-store.js";
import { ModelsError, resolveProviderAuth } from "./auth/resolve.js";
export { ModelsError } from "./auth/resolve.js";
class ModelsImpl {
    providers = new Map();
    credentials;
    authContext;
    constructor(options) {
        this.credentials = options?.credentials ?? new InMemoryCredentialStore();
        this.authContext = options?.authContext ?? defaultAuthContext();
    }
    setProvider(provider) {
        this.providers.set(provider.id, provider);
    }
    deleteProvider(id) {
        this.providers.delete(id);
    }
    clearProviders() {
        this.providers.clear();
    }
    getProviders() {
        return Array.from(this.providers.values());
    }
    getProvider(id) {
        return this.providers.get(id);
    }
    getModels(provider) {
        if (provider !== undefined) {
            const entry = this.providers.get(provider);
            if (!entry)
                return [];
            try {
                return entry.getModels();
            }
            catch {
                return [];
            }
        }
        const models = [];
        for (const entry of this.providers.values()) {
            try {
                models.push(...entry.getModels());
            }
            catch {
                // Best-effort: ill-behaved providers yield no models.
            }
        }
        return models;
    }
    getModel(provider, id) {
        return this.getModels(provider).find((model) => model.id === id);
    }
    async refresh(provider) {
        if (provider !== undefined) {
            const entry = this.providers.get(provider);
            if (!entry?.refreshModels)
                return;
            try {
                await entry.refreshModels();
            }
            catch (error) {
                if (error instanceof ModelsError)
                    throw error;
                throw new ModelsError("model_source", `Model refresh failed for ${provider}`, { cause: error });
            }
            return;
        }
        // Cannot reject: the async mapper turns even sync throws from ill-behaved
        // providers into rejections, and allSettled captures all of them.
        await Promise.allSettled(Array.from(this.providers.values(), async (entry) => entry.refreshModels?.()));
    }
    async getAuth(model) {
        const provider = this.providers.get(model.provider);
        if (!provider)
            return undefined;
        return resolveProviderAuth(provider, model, this.credentials, this.authContext);
    }
    requireProvider(model) {
        const provider = this.providers.get(model.provider);
        if (!provider) {
            throw new ModelsError("provider", `Unknown provider: ${model.provider}`);
        }
        return provider;
    }
    async applyAuth(model, options) {
        const resolution = await resolveProviderAuth(this.requireProvider(model), model, this.credentials, this.authContext, {
            apiKey: options?.apiKey,
            env: options?.env,
        });
        const auth = resolution?.auth;
        if (!auth)
            return { requestModel: model, requestOptions: options };
        const requestModel = auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;
        // Explicit request options win per-field; headers/env merge per key.
        const apiKey = options?.apiKey ?? auth.apiKey;
        const headers = auth.headers || options?.headers ? { ...auth.headers, ...options?.headers } : undefined;
        const env = resolution.env || options?.env ? { ...(resolution.env ?? {}), ...(options?.env ?? {}) } : undefined;
        const requestOptions = { ...options, apiKey, headers, env };
        return { requestModel, requestOptions };
    }
    stream(model, context, options) {
        return lazyStream(model, async () => {
            const provider = this.requireProvider(model);
            const { requestModel, requestOptions } = await this.applyAuth(model, options);
            return provider.stream(requestModel, context, requestOptions);
        });
    }
    async complete(model, context, options) {
        return this.stream(model, context, options).result();
    }
    streamSimple(model, context, options) {
        return lazyStream(model, async () => {
            const provider = this.requireProvider(model);
            const { requestModel, requestOptions } = await this.applyAuth(model, options);
            return provider.streamSimple(requestModel, context, requestOptions);
        });
    }
    async completeSimple(model, context, options) {
        return this.streamSimple(model, context, options).result();
    }
}
export function createModels(options) {
    return new ModelsImpl(options);
}
/**
 * Builds a provider from parts. Built-in provider factories and models.json
 * custom providers both go through this. A single `api` streams all models;
 * an `api` map dispatches on `model.api`, and a model whose api has no entry
 * produces a stream error.
 */
export function createProvider(input) {
    let models = input.models;
    let inflightRefresh;
    const refreshModels = input.refreshModels;
    const single = typeof input.api.stream === "function" ? input.api : undefined;
    const byApi = single ? undefined : input.api;
    const apiFor = (model) => single ?? byApi?.[model.api];
    const dispatch = (model, run) => {
        const streams = apiFor(model);
        if (!streams) {
            return lazyStream(model, async () => {
                throw new ModelsError("stream", `Provider ${input.id} has no API implementation for "${model.api}"`);
            });
        }
        return run(streams);
    };
    return {
        id: input.id,
        name: input.name ?? input.id,
        baseUrl: input.baseUrl,
        headers: input.headers,
        auth: input.auth,
        getModels: () => models,
        refreshModels: refreshModels
            ? () => {
                inflightRefresh ??= (async () => {
                    try {
                        models = await refreshModels();
                    }
                    finally {
                        inflightRefresh = undefined;
                    }
                })();
                return inflightRefresh;
            }
            : undefined,
        stream: (model, context, options) => dispatch(model, (streams) => streams.stream(model, context, options)),
        streamSimple: (model, context, options) => dispatch(model, (streams) => streams.streamSimple(model, context, options)),
    };
}
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
export function hasApi(model, api) {
    return model.api === api;
}
export function calculateCost(model, usage) {
    // Anthropic charges 2x base input for 1h cache writes.
    const longWrite = usage.cacheWrite1h ?? 0;
    const shortWrite = usage.cacheWrite - longWrite;
    usage.cost.input = (model.cost.input / 1000000) * usage.input;
    usage.cost.output = (model.cost.output / 1000000) * usage.output;
    usage.cost.cacheRead = (model.cost.cacheRead / 1000000) * usage.cacheRead;
    usage.cost.cacheWrite = (model.cost.cacheWrite * shortWrite + model.cost.input * 2 * longWrite) / 1000000;
    usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
    return usage.cost;
}
const EXTENDED_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];
export function getSupportedThinkingLevels(model) {
    if (!model.reasoning)
        return ["off"];
    return EXTENDED_THINKING_LEVELS.filter((level) => {
        const mapped = model.thinkingLevelMap?.[level];
        if (mapped === null)
            return false;
        if (level === "xhigh")
            return mapped !== undefined;
        return true;
    });
}
export function clampThinkingLevel(model, level) {
    const availableLevels = getSupportedThinkingLevels(model);
    if (availableLevels.includes(level))
        return level;
    const requestedIndex = EXTENDED_THINKING_LEVELS.indexOf(level);
    if (requestedIndex === -1)
        return availableLevels[0] ?? "off";
    for (let i = requestedIndex; i < EXTENDED_THINKING_LEVELS.length; i++) {
        const candidate = EXTENDED_THINKING_LEVELS[i];
        if (availableLevels.includes(candidate))
            return candidate;
    }
    for (let i = requestedIndex - 1; i >= 0; i--) {
        const candidate = EXTENDED_THINKING_LEVELS[i];
        if (availableLevels.includes(candidate))
            return candidate;
    }
    return availableLevels[0] ?? "off";
}
/**
 * Check if two models are equal by comparing both their id and provider.
 * Returns false if either model is null or undefined.
 */
export function modelsAreEqual(a, b) {
    if (!a || !b)
        return false;
    return a.id === b.id && a.provider === b.provider;
}
//# sourceMappingURL=models.js.map