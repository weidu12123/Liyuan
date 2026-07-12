/**
 * OpenAI Codex (ChatGPT OAuth) flow
 *
 * NOTE: This module uses Node.js crypto and http for the OAuth callback.
 * It is only intended for CLI use, not browser environments.
 */
import type { OAuthAuth } from "../../auth/types.ts";
import type { OAuthCredentials, OAuthDeviceCodeInfo, OAuthPrompt, OAuthProviderInterface } from "./types.ts";
export declare const OPENAI_CODEX_BROWSER_LOGIN_METHOD = "browser";
export declare const OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD = "device_code";
/**
 * Login with OpenAI Codex OAuth using the Codex device-code flow.
 */
export declare function loginOpenAICodexDeviceCode(options: {
    onDeviceCode: (info: OAuthDeviceCodeInfo) => void;
    signal?: AbortSignal;
}): Promise<OAuthCredentials>;
/**
 * Login with OpenAI Codex OAuth
 *
 * @param options.onAuth - Called with URL and instructions when auth starts
 * @param options.onPrompt - Called to prompt user for manual code paste (fallback if no onManualCodeInput)
 * @param options.onProgress - Optional progress messages
 * @param options.onManualCodeInput - Optional promise that resolves with user-pasted code.
 *                                    Races with browser callback - whichever completes first wins.
 *                                    Useful for showing paste input immediately alongside browser flow.
 * @param options.originator - OAuth originator parameter (defaults to "pi")
 */
export declare function loginOpenAICodex(options: {
    onAuth: (info: {
        url: string;
        instructions?: string;
    }) => void;
    onPrompt: (prompt: OAuthPrompt) => Promise<string>;
    onProgress?: (message: string) => void;
    onManualCodeInput?: () => Promise<string>;
    originator?: string;
}): Promise<OAuthCredentials>;
/**
 * Refresh OpenAI Codex OAuth token
 */
export declare function refreshOpenAICodexToken(refreshToken: string): Promise<OAuthCredentials>;
export declare const openaiCodexOAuth: OAuthAuth;
export declare const openaiCodexOAuthProvider: OAuthProviderInterface;
//# sourceMappingURL=openai-codex.d.ts.map