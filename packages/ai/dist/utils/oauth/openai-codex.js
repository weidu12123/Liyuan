/**
 * OpenAI Codex (ChatGPT OAuth) flow
 *
 * NOTE: This module uses Node.js crypto and http for the OAuth callback.
 * It is only intended for CLI use, not browser environments.
 */
// NEVER convert to top-level imports - breaks browser/Vite builds
let _randomBytes = null;
let _http = null;
if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
    import("node:crypto").then((m) => {
        _randomBytes = m.randomBytes;
    });
    import("node:http").then((m) => {
        _http = m;
    });
}
import { getProviderEnvValue } from "../provider-env.js";
import { pollOAuthDeviceCodeFlow } from "./device-code.js";
import { oauthErrorHtml, oauthSuccessHtml } from "./oauth-page.js";
import { generatePKCE } from "./pkce.js";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE_URL = "https://auth.openai.com";
const AUTHORIZE_URL = `${AUTH_BASE_URL}/oauth/authorize`;
const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;
const DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`;
const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;
const DEVICE_CODE_TIMEOUT_SECONDS = 15 * 60;
export const OPENAI_CODEX_BROWSER_LOGIN_METHOD = "browser";
export const OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD = "device_code";
const SCOPE = "openid profile email offline_access";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
function getCallbackHost() {
    return getProviderEnvValue("PI_OAUTH_CALLBACK_HOST") || "127.0.0.1";
}
function createState() {
    if (!_randomBytes) {
        throw new Error("OpenAI Codex OAuth is only available in Node.js environments");
    }
    return _randomBytes(16).toString("hex");
}
function parseAuthorizationInput(input) {
    const value = input.trim();
    if (!value)
        return {};
    try {
        const url = new URL(value);
        return {
            code: url.searchParams.get("code") ?? undefined,
            state: url.searchParams.get("state") ?? undefined,
        };
    }
    catch {
        // not a URL
    }
    if (value.includes("#")) {
        const [code, state] = value.split("#", 2);
        return { code, state };
    }
    if (value.includes("code=")) {
        const params = new URLSearchParams(value);
        return {
            code: params.get("code") ?? undefined,
            state: params.get("state") ?? undefined,
        };
    }
    return { code: value };
}
function decodeJwt(token) {
    try {
        const parts = token.split(".");
        if (parts.length !== 3)
            return null;
        const payload = parts[1] ?? "";
        const decoded = atob(payload);
        return JSON.parse(decoded);
    }
    catch {
        return null;
    }
}
async function fetchWithLoginCancellation(input, init) {
    try {
        return await fetch(input, init);
    }
    catch (error) {
        if (init.signal?.aborted) {
            throw new Error("Login cancelled");
        }
        throw error;
    }
}
async function readTokenResponse(response, operation) {
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`OpenAI Codex token ${operation} failed (${response.status}): ${text || response.statusText}`);
    }
    const rawJson = await response.json();
    const json = rawJson;
    if (!json?.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
        throw new Error(`OpenAI Codex token ${operation} response missing fields: ${JSON.stringify(json)}`);
    }
    return {
        access: json.access_token,
        refresh: json.refresh_token,
        expires: Date.now() + json.expires_in * 1000,
    };
}
async function exchangeAuthorizationCode(code, verifier, redirectUri = REDIRECT_URI, signal) {
    const response = await fetchWithLoginCancellation(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: CLIENT_ID,
            code,
            code_verifier: verifier,
            redirect_uri: redirectUri,
        }),
        signal,
    });
    return readTokenResponse(response, "exchange");
}
async function refreshAccessToken(refreshToken) {
    let response;
    try {
        response = await fetch(TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: refreshToken,
                client_id: CLIENT_ID,
            }),
        });
    }
    catch (error) {
        throw new Error(`OpenAI Codex token refresh error: ${error instanceof Error ? error.message : String(error)}`);
    }
    return readTokenResponse(response, "refresh");
}
async function startOpenAICodexDeviceAuth(signal) {
    const response = await fetchWithLoginCancellation(DEVICE_USER_CODE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: CLIENT_ID }),
        signal,
    });
    if (!response.ok) {
        if (response.status === 404) {
            throw new Error("OpenAI Codex device code login is not enabled for this server. Use browser login or verify the server URL.");
        }
        const responseBody = await response.text().catch(() => "");
        throw new Error(`OpenAI Codex device code request failed with status ${response.status}${responseBody ? `: ${responseBody}` : ""}`);
    }
    const rawJson = await response.json();
    const json = rawJson;
    const intervalSeconds = typeof json?.interval === "string" ? Number(json.interval.trim()) : json?.interval;
    if (!json?.device_auth_id ||
        !json.user_code ||
        typeof intervalSeconds !== "number" ||
        !Number.isFinite(intervalSeconds) ||
        intervalSeconds < 0) {
        throw new Error(`Invalid OpenAI Codex device code response: ${JSON.stringify(json)}`);
    }
    return {
        deviceAuthId: json.device_auth_id,
        userCode: json.user_code,
        intervalSeconds,
    };
}
async function pollOpenAICodexDeviceAuth(device, signal) {
    return pollOAuthDeviceCodeFlow({
        intervalSeconds: device.intervalSeconds,
        expiresInSeconds: DEVICE_CODE_TIMEOUT_SECONDS,
        signal,
        poll: async () => {
            const response = await fetchWithLoginCancellation(DEVICE_TOKEN_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    device_auth_id: device.deviceAuthId,
                    user_code: device.userCode,
                }),
                signal,
            });
            if (response.ok) {
                const rawJson = await response.json();
                const json = rawJson;
                if (!json?.authorization_code || !json.code_verifier) {
                    return {
                        status: "failed",
                        message: `Invalid OpenAI Codex device auth token response: ${JSON.stringify(json)}`,
                    };
                }
                return {
                    status: "complete",
                    value: { authorizationCode: json.authorization_code, codeVerifier: json.code_verifier },
                };
            }
            if (response.status === 403 || response.status === 404) {
                return { status: "pending" };
            }
            const responseBody = await response.text().catch(() => "");
            let errorCode;
            try {
                const json = JSON.parse(responseBody);
                const error = json?.error;
                errorCode = typeof error === "object" ? error?.code : error;
            }
            catch { }
            if (errorCode === "deviceauth_authorization_pending") {
                return { status: "pending" };
            }
            if (errorCode === "slow_down") {
                return { status: "slow_down" };
            }
            return {
                status: "failed",
                message: `OpenAI Codex device auth failed with status ${response.status}${responseBody ? `: ${responseBody}` : ""}`,
            };
        },
    });
}
async function createAuthorizationFlow(originator = "pi") {
    const { verifier, challenge } = await generatePKCE();
    const state = createState();
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", CLIENT_ID);
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("scope", SCOPE);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("id_token_add_organizations", "true");
    url.searchParams.set("codex_cli_simplified_flow", "true");
    url.searchParams.set("originator", originator);
    return { verifier, state, url: url.toString() };
}
function startLocalOAuthServer(state) {
    if (!_http) {
        throw new Error("OpenAI Codex OAuth is only available in Node.js environments");
    }
    let settleWait;
    const waitForCodePromise = new Promise((resolve) => {
        let settled = false;
        settleWait = (value) => {
            if (settled)
                return;
            settled = true;
            resolve(value);
        };
    });
    const server = _http.createServer((req, res) => {
        try {
            const url = new URL(req.url || "", "http://localhost");
            if (url.pathname !== "/auth/callback") {
                res.statusCode = 404;
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(oauthErrorHtml("Callback route not found."));
                return;
            }
            if (url.searchParams.get("state") !== state) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(oauthErrorHtml("State mismatch."));
                return;
            }
            const code = url.searchParams.get("code");
            if (!code) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(oauthErrorHtml("Missing authorization code."));
                return;
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(oauthSuccessHtml("OpenAI authentication completed. You can close this window."));
            settleWait?.({ code });
        }
        catch {
            res.statusCode = 500;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(oauthErrorHtml("Internal error while processing OAuth callback."));
        }
    });
    return new Promise((resolve) => {
        server
            .listen(1455, getCallbackHost(), () => {
            resolve({
                close: () => server.close(),
                cancelWait: () => {
                    settleWait?.(null);
                },
                waitForCode: () => waitForCodePromise,
            });
        })
            .on("error", (_err) => {
            settleWait?.(null);
            resolve({
                close: () => {
                    try {
                        server.close();
                    }
                    catch {
                        // ignore
                    }
                },
                cancelWait: () => { },
                waitForCode: async () => null,
            });
        });
    });
}
function getAccountId(accessToken) {
    const payload = decodeJwt(accessToken);
    const auth = payload?.[JWT_CLAIM_PATH];
    const accountId = auth?.chatgpt_account_id;
    return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
}
function credentialsFromToken(token) {
    const accountId = getAccountId(token.access);
    if (!accountId) {
        throw new Error("Failed to extract accountId from token");
    }
    return {
        access: token.access,
        refresh: token.refresh,
        expires: token.expires,
        accountId,
    };
}
async function exchangeAuthorizationCodeForCredentials(code, verifier, redirectUri, signal) {
    return credentialsFromToken(await exchangeAuthorizationCode(code, verifier, redirectUri, signal));
}
/**
 * Login with OpenAI Codex OAuth using the Codex device-code flow.
 */
export async function loginOpenAICodexDeviceCode(options) {
    const device = await startOpenAICodexDeviceAuth(options.signal);
    options.onDeviceCode({
        userCode: device.userCode,
        verificationUri: DEVICE_VERIFICATION_URI,
        intervalSeconds: device.intervalSeconds,
        expiresInSeconds: DEVICE_CODE_TIMEOUT_SECONDS,
    });
    const code = await pollOpenAICodexDeviceAuth(device, options.signal);
    return exchangeAuthorizationCodeForCredentials(code.authorizationCode, code.codeVerifier, DEVICE_REDIRECT_URI, options.signal);
}
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
export async function loginOpenAICodex(options) {
    const { verifier, state, url } = await createAuthorizationFlow(options.originator);
    const server = await startLocalOAuthServer(state);
    options.onAuth({ url, instructions: "A browser window should open. Complete login to finish." });
    let code;
    try {
        if (options.onManualCodeInput) {
            // Race between browser callback and manual input
            let manualCode;
            let manualError;
            const manualPromise = options
                .onManualCodeInput()
                .then((input) => {
                manualCode = input;
                server.cancelWait();
            })
                .catch((err) => {
                manualError = err instanceof Error ? err : new Error(String(err));
                server.cancelWait();
            });
            const result = await server.waitForCode();
            // If manual input was cancelled, throw that error
            if (manualError) {
                throw manualError;
            }
            if (result?.code) {
                // Browser callback won
                code = result.code;
            }
            else if (manualCode) {
                // Manual input won (or callback timed out and user had entered code)
                const parsed = parseAuthorizationInput(manualCode);
                if (parsed.state && parsed.state !== state) {
                    throw new Error("State mismatch");
                }
                code = parsed.code;
            }
            // If still no code, wait for manual promise to complete and try that
            if (!code) {
                await manualPromise;
                if (manualError) {
                    throw manualError;
                }
                if (manualCode) {
                    const parsed = parseAuthorizationInput(manualCode);
                    if (parsed.state && parsed.state !== state) {
                        throw new Error("State mismatch");
                    }
                    code = parsed.code;
                }
            }
        }
        else {
            // Original flow: wait for callback, then prompt if needed
            const result = await server.waitForCode();
            if (result?.code) {
                code = result.code;
            }
        }
        // Fallback to onPrompt if still no code
        if (!code) {
            const input = await options.onPrompt({
                message: "Paste the authorization code (or full redirect URL):",
            });
            const parsed = parseAuthorizationInput(input);
            if (parsed.state && parsed.state !== state) {
                throw new Error("State mismatch");
            }
            code = parsed.code;
        }
        if (!code) {
            throw new Error("Missing authorization code");
        }
        return exchangeAuthorizationCodeForCredentials(code, verifier, REDIRECT_URI);
    }
    finally {
        server.close();
    }
}
/**
 * Refresh OpenAI Codex OAuth token
 */
export async function refreshOpenAICodexToken(refreshToken) {
    return credentialsFromToken(await refreshAccessToken(refreshToken));
}
export const openaiCodexOAuth = {
    name: "OpenAI (ChatGPT Plus/Pro)",
    async login(callbacks) {
        const method = await callbacks.prompt({
            type: "select",
            message: "Select OpenAI Codex login method:",
            options: [
                { id: OPENAI_CODEX_BROWSER_LOGIN_METHOD, label: "Browser login (default)" },
                { id: OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD, label: "Device code login (headless)" },
            ],
        });
        if (method === OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD) {
            const credentials = await loginOpenAICodexDeviceCode({
                onDeviceCode: (info) => callbacks.notify({ type: "device_code", ...info }),
                signal: callbacks.signal,
            });
            return { ...credentials, type: "oauth" };
        }
        if (method !== OPENAI_CODEX_BROWSER_LOGIN_METHOD) {
            throw new Error(`Unknown OpenAI Codex login method: ${method}`);
        }
        // The manual_code prompt races the local callback server; abort it once
        // the flow settles so the UI can dismiss the pending input.
        const manualAbort = new AbortController();
        try {
            const credentials = await loginOpenAICodex({
                onAuth: (info) => callbacks.notify({ type: "auth_url", url: info.url, instructions: info.instructions }),
                onProgress: (message) => callbacks.notify({ type: "progress", message }),
                onPrompt: (prompt) => callbacks.prompt({ type: "text", message: prompt.message, placeholder: prompt.placeholder }),
                onManualCodeInput: () => callbacks.prompt({
                    type: "manual_code",
                    message: "Complete login in your browser, or paste the authorization code / redirect URL here:",
                    placeholder: REDIRECT_URI,
                    signal: manualAbort.signal,
                }),
            });
            return { ...credentials, type: "oauth" };
        }
        finally {
            manualAbort.abort();
        }
    },
    async refresh(credential) {
        return { ...(await refreshOpenAICodexToken(credential.refresh)), type: "oauth" };
    },
    async toAuth(credential) {
        return { apiKey: credential.access };
    },
};
export const openaiCodexOAuthProvider = {
    id: "openai-codex",
    name: "ChatGPT Plus/Pro (Codex Subscription)",
    usesCallbackServer: true,
    async login(callbacks) {
        const loginMethod = await callbacks.onSelect({
            message: "Select OpenAI Codex login method:",
            options: [
                { id: OPENAI_CODEX_BROWSER_LOGIN_METHOD, label: "Browser login (default)" },
                { id: OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD, label: "Device code login (headless)" },
            ],
        });
        if (!loginMethod) {
            throw new Error("Login cancelled");
        }
        if (loginMethod === OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD) {
            return loginOpenAICodexDeviceCode({
                onDeviceCode: callbacks.onDeviceCode,
                signal: callbacks.signal,
            });
        }
        if (loginMethod !== OPENAI_CODEX_BROWSER_LOGIN_METHOD) {
            throw new Error(`Unknown OpenAI Codex login method: ${loginMethod}`);
        }
        return loginOpenAICodex({
            onAuth: callbacks.onAuth,
            onPrompt: callbacks.onPrompt,
            onProgress: callbacks.onProgress,
            onManualCodeInput: callbacks.onManualCodeInput,
        });
    },
    async refreshToken(credentials) {
        return refreshOpenAICodexToken(credentials.refresh);
    },
    getApiKey(credentials) {
        return credentials.access;
    },
};
//# sourceMappingURL=openai-codex.js.map