/**
 * Anthropic OAuth flow (Claude Pro/Max)
 *
 * NOTE: This module uses Node.js http.createServer for the OAuth callback server.
 * It is only intended for CLI use, not browser environments.
 */
import type { OAuthAuth } from "../../auth/types.ts";
import type { OAuthCredentials, OAuthPrompt, OAuthProviderInterface } from "./types.ts";
/**
 * Login with Anthropic OAuth (authorization code + PKCE)
 */
export declare function loginAnthropic(options: {
    onAuth: (info: {
        url: string;
        instructions?: string;
    }) => void;
    onPrompt: (prompt: OAuthPrompt) => Promise<string>;
    onProgress?: (message: string) => void;
    onManualCodeInput?: () => Promise<string>;
}): Promise<OAuthCredentials>;
/**
 * Refresh Anthropic OAuth token
 */
export declare function refreshAnthropicToken(refreshToken: string): Promise<OAuthCredentials>;
export declare const anthropicOAuth: OAuthAuth;
export declare const anthropicOAuthProvider: OAuthProviderInterface;
//# sourceMappingURL=anthropic.d.ts.map