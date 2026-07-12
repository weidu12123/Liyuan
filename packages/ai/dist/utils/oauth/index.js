/**
 * OAuth credential management for AI providers.
 *
 * This module handles login, token refresh, and credential storage
 * for OAuth-based providers:
 * - Anthropic (Claude Pro/Max)
 * - GitHub Copilot
 */
// Anthropic
export { anthropicOAuthProvider, loginAnthropic, refreshAnthropicToken } from "./anthropic.js";
export * from "./device-code.js";
// GitHub Copilot
export { getGitHubCopilotBaseUrl, githubCopilotOAuthProvider, loginGitHubCopilot, normalizeDomain, refreshGitHubCopilotToken, } from "./github-copilot.js";
// OpenAI Codex (ChatGPT OAuth)
export { loginOpenAICodex, loginOpenAICodexDeviceCode, OPENAI_CODEX_BROWSER_LOGIN_METHOD, OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD, openaiCodexOAuthProvider, refreshOpenAICodexToken, } from "./openai-codex.js";
export * from "./types.js";
// ============================================================================
// Provider Registry
// ============================================================================
import { anthropicOAuthProvider } from "./anthropic.js";
import { githubCopilotOAuthProvider } from "./github-copilot.js";
import { openaiCodexOAuthProvider } from "./openai-codex.js";
const BUILT_IN_OAUTH_PROVIDERS = [
    anthropicOAuthProvider,
    githubCopilotOAuthProvider,
    openaiCodexOAuthProvider,
];
const oauthProviderRegistry = new Map(BUILT_IN_OAUTH_PROVIDERS.map((provider) => [provider.id, provider]));
/**
 * Get an OAuth provider by ID
 */
export function getOAuthProvider(id) {
    return oauthProviderRegistry.get(id);
}
/**
 * Register a custom OAuth provider
 */
export function registerOAuthProvider(provider) {
    oauthProviderRegistry.set(provider.id, provider);
}
/**
 * Unregister an OAuth provider.
 *
 * If the provider is built-in, restores the built-in implementation.
 * Custom providers are removed completely.
 */
export function unregisterOAuthProvider(id) {
    const builtInProvider = BUILT_IN_OAUTH_PROVIDERS.find((provider) => provider.id === id);
    if (builtInProvider) {
        oauthProviderRegistry.set(id, builtInProvider);
        return;
    }
    oauthProviderRegistry.delete(id);
}
/**
 * Reset OAuth providers to built-ins.
 */
export function resetOAuthProviders() {
    oauthProviderRegistry.clear();
    for (const provider of BUILT_IN_OAUTH_PROVIDERS) {
        oauthProviderRegistry.set(provider.id, provider);
    }
}
/**
 * Get all registered OAuth providers
 */
export function getOAuthProviders() {
    return Array.from(oauthProviderRegistry.values());
}
/**
 * @deprecated Use getOAuthProviders() which returns OAuthProviderInterface[]
 */
export function getOAuthProviderInfoList() {
    return getOAuthProviders().map((p) => ({
        id: p.id,
        name: p.name,
        available: true,
    }));
}
// ============================================================================
// High-level API (uses provider registry)
// ============================================================================
/**
 * Refresh token for any OAuth provider.
 * @deprecated Use getOAuthProvider(id).refreshToken() instead
 */
export async function refreshOAuthToken(providerId, credentials) {
    const provider = getOAuthProvider(providerId);
    if (!provider) {
        throw new Error(`Unknown OAuth provider: ${providerId}`);
    }
    return provider.refreshToken(credentials);
}
/**
 * Get API key for a provider from OAuth credentials.
 * Automatically refreshes expired tokens.
 *
 * @returns API key string and updated credentials, or null if no credentials
 * @throws Error if refresh fails
 */
export async function getOAuthApiKey(providerId, credentials) {
    const provider = getOAuthProvider(providerId);
    if (!provider) {
        throw new Error(`Unknown OAuth provider: ${providerId}`);
    }
    let creds = credentials[providerId];
    if (!creds) {
        return null;
    }
    // Refresh if expired
    if (Date.now() >= creds.expires) {
        try {
            creds = await provider.refreshToken(creds);
        }
        catch (_error) {
            throw new Error(`Failed to refresh OAuth token for ${providerId}`);
        }
    }
    const apiKey = provider.getApiKey(creds);
    return { newCredentials: creds, apiKey };
}
//# sourceMappingURL=index.js.map