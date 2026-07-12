export class ModelsError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = "ModelsError";
        this.code = code;
    }
}
/**
 * Auth resolution shared by the `Models` and `ImagesModels` collections.
 * A stored credential owns the provider: ambient/env is consulted only when
 * nothing is stored. No silent env fallback after a failed refresh or for a
 * credential type without a matching handler.
 */
export async function resolveProviderAuth(provider, model, credentials, authContext, overrides) {
    const requestAuthContext = overrides?.env ? overlayEnvAuthContext(authContext, overrides.env) : authContext;
    if (overrides?.apiKey !== undefined && provider.auth.apiKey) {
        return resolveApiKey(requestAuthContext, provider.auth.apiKey, model, {
            type: "api_key",
            key: overrides.apiKey,
            env: overrides.env,
        });
    }
    const stored = await readCredential(credentials, provider.id);
    if (stored) {
        if (stored.type === "oauth" && provider.auth.oauth) {
            return resolveStoredOAuth(credentials, provider.id, provider.auth.oauth, stored);
        }
        if (stored.type === "api_key" && provider.auth.apiKey) {
            const credential = overrides?.env ? { ...stored, env: { ...stored.env, ...overrides.env } } : stored;
            return resolveApiKey(requestAuthContext, provider.auth.apiKey, model, credential);
        }
        return undefined;
    }
    // Ambient (env vars, AWS profiles, ADC files).
    return provider.auth.apiKey ? resolveApiKey(requestAuthContext, provider.auth.apiKey, model, undefined) : undefined;
}
function overlayEnvAuthContext(base, env) {
    return {
        env: async (name) => env[name] || (await base.env(name)),
        fileExists: (path) => base.fileExists(path),
    };
}
/**
 * OAuth resolution with double-checked locking (same pattern as today's
 * AuthStorage): valid tokens cost zero locks; expired tokens lock, re-check
 * expiry under the lock, refresh once globally, and persist the rotated
 * credential before release.
 */
async function resolveStoredOAuth(credentials, providerId, oauth, stored) {
    let credential = stored;
    if (Date.now() >= credential.expires) {
        // Optimistic check said expired; the authoritative check runs under the lock.
        let post;
        try {
            post = await credentials.modify(providerId, async (current) => {
                if (current?.type !== "oauth")
                    return undefined; // logged out meanwhile
                if (Date.now() < current.expires)
                    return undefined; // another process/request refreshed
                try {
                    return await oauth.refresh(current);
                }
                catch (error) {
                    throw new ModelsError("oauth", `OAuth refresh failed for ${providerId}`, { cause: error });
                }
            });
        }
        catch (error) {
            if (error instanceof ModelsError)
                throw error;
            throw new ModelsError("auth", `Credential store modify failed for ${providerId}`, { cause: error });
        }
        if (post?.type !== "oauth")
            return undefined; // logged out meanwhile
        credential = post;
    }
    try {
        return { auth: await oauth.toAuth(credential), source: "OAuth" };
    }
    catch (error) {
        throw new ModelsError("oauth", `OAuth auth derivation failed for ${providerId}`, { cause: error });
    }
}
async function resolveApiKey(authContext, apiKey, model, credential) {
    try {
        return await apiKey.resolve({ model, ctx: authContext, credential });
    }
    catch (error) {
        throw new ModelsError("auth", `API key auth failed for provider ${model.provider}`, { cause: error });
    }
}
async function readCredential(credentials, providerId) {
    try {
        return await credentials.read(providerId);
    }
    catch (error) {
        throw new ModelsError("auth", `Credential store read failed for ${providerId}`, { cause: error });
    }
}
//# sourceMappingURL=resolve.js.map