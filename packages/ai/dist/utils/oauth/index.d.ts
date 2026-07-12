/**
 * OAuth credential management for AI providers.
 *
 * This module handles login, token refresh, and credential storage
 * for OAuth-based providers:
 * - Anthropic (Claude Pro/Max)
 * - GitHub Copilot
 */
export { anthropicOAuthProvider, loginAnthropic, refreshAnthropicToken } from "./anthropic.ts";
export * from "./device-code.ts";
export { getGitHubCopilotBaseUrl, githubCopilotOAuthProvider, loginGitHubCopilot, normalizeDomain, refreshGitHubCopilotToken, } from "./github-copilot.ts";
export { loginOpenAICodex, loginOpenAICodexDeviceCode, OPENAI_CODEX_BROWSER_LOGIN_METHOD, OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD, openaiCodexOAuthProvider, refreshOpenAICodexToken, } from "./openai-codex.ts";
export * from "./types.ts";
import type { OAuthCredentials, OAuthProviderId, OAuthProviderInfo, OAuthProviderInterface } from "./types.ts";
/**
 * Get an OAuth provider by ID
 */
export declare function getOAuthProvider(id: OAuthProviderId): OAuthProviderInterface | undefined;
/**
 * Register a custom OAuth provider
 */
export declare function registerOAuthProvider(provider: OAuthProviderInterface): void;
/**
 * Unregister an OAuth provider.
 *
 * If the provider is built-in, restores the built-in implementation.
 * Custom providers are removed completely.
 */
export declare function unregisterOAuthProvider(id: string): void;
/**
 * Reset OAuth providers to built-ins.
 */
export declare function resetOAuthProviders(): void;
/**
 * Get all registered OAuth providers
 */
export declare function getOAuthProviders(): OAuthProviderInterface[];
/**
 * @deprecated Use getOAuthProviders() which returns OAuthProviderInterface[]
 */
export declare function getOAuthProviderInfoList(): OAuthProviderInfo[];
/**
 * Refresh token for any OAuth provider.
 * @deprecated Use getOAuthProvider(id).refreshToken() instead
 */
export declare function refreshOAuthToken(providerId: OAuthProviderId, credentials: OAuthCredentials): Promise<OAuthCredentials>;
/**
 * Get API key for a provider from OAuth credentials.
 * Automatically refreshes expired tokens.
 *
 * @returns API key string and updated credentials, or null if no credentials
 * @throws Error if refresh fails
 */
export declare function getOAuthApiKey(providerId: OAuthProviderId, credentials: Record<string, OAuthCredentials>): Promise<{
    newCredentials: OAuthCredentials;
    apiKey: string;
} | null>;
//# sourceMappingURL=index.d.ts.map