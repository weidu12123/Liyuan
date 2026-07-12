/**
 * GitHub Copilot OAuth flow
 */
import { GITHUB_COPILOT_MODELS } from "../../providers/github-copilot.models.js";
import { pollOAuthDeviceCodeFlow } from "./device-code.js";
const decode = (s) => atob(s);
const CLIENT_ID = decode("SXYxLmI1MDdhMDhjODdlY2ZlOTg=");
const COPILOT_HEADERS = {
    "User-Agent": "GitHubCopilotChat/0.35.0",
    "Editor-Version": "vscode/1.107.0",
    "Editor-Plugin-Version": "copilot-chat/0.35.0",
    "Copilot-Integration-Id": "vscode-chat",
};
const COPILOT_API_VERSION = "2026-06-01";
export function normalizeDomain(input) {
    const trimmed = input.trim();
    if (!trimmed)
        return null;
    try {
        const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
        return url.hostname;
    }
    catch {
        return null;
    }
}
function getUrls(domain) {
    return {
        deviceCodeUrl: `https://${domain}/login/device/code`,
        accessTokenUrl: `https://${domain}/login/oauth/access_token`,
        copilotTokenUrl: `https://api.${domain}/copilot_internal/v2/token`,
    };
}
/**
 * Parse the proxy-ep from a Copilot token and convert to API base URL.
 * Token format: tid=...;exp=...;proxy-ep=proxy.individual.githubcopilot.com;...
 * Returns API URL like https://api.individual.githubcopilot.com
 */
function getBaseUrlFromToken(token) {
    const match = token.match(/proxy-ep=([^;]+)/);
    if (!match)
        return null;
    const proxyHost = match[1];
    // Convert proxy.xxx to api.xxx
    const apiHost = proxyHost.replace(/^proxy\./, "api.");
    return `https://${apiHost}`;
}
export function getGitHubCopilotBaseUrl(token, enterpriseDomain) {
    // If we have a token, extract the base URL from proxy-ep
    if (token) {
        const urlFromToken = getBaseUrlFromToken(token);
        if (urlFromToken)
            return urlFromToken;
    }
    // Fallback for enterprise or if token parsing fails
    if (enterpriseDomain)
        return `https://copilot-api.${enterpriseDomain}`;
    return "https://api.individual.githubcopilot.com";
}
function asRecord(value) {
    return value && typeof value === "object" ? value : undefined;
}
function isSelectableCopilotModel(item) {
    const policy = asRecord(item.policy);
    const capabilities = asRecord(item.capabilities);
    const supports = asRecord(capabilities?.supports);
    return item.model_picker_enabled === true && policy?.state !== "disabled" && supports?.tool_calls !== false;
}
function parseAvailableCopilotModelIds(raw) {
    const data = asRecord(raw)?.data;
    if (!Array.isArray(data)) {
        throw new Error("Invalid Copilot models response");
    }
    const ids = [];
    for (const rawItem of data) {
        const item = asRecord(rawItem);
        const id = item?.id;
        if (typeof id === "string" && item && isSelectableCopilotModel(item)) {
            ids.push(id);
        }
    }
    return ids;
}
async function fetchAvailableGitHubCopilotModelIds(copilotToken, enterpriseDomain) {
    const baseUrl = getGitHubCopilotBaseUrl(copilotToken, enterpriseDomain);
    const raw = await fetchJson(`${baseUrl}/models`, {
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${copilotToken}`,
            ...COPILOT_HEADERS,
            "X-GitHub-Api-Version": COPILOT_API_VERSION,
        },
        signal: AbortSignal.timeout(5000),
    });
    return parseAvailableCopilotModelIds(raw);
}
async function fetchJson(url, init) {
    const response = await fetch(url, init);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status} ${response.statusText}: ${text}`);
    }
    return response.json();
}
async function startDeviceFlow(domain) {
    const urls = getUrls(domain);
    const data = await fetchJson(urls.deviceCodeUrl, {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "GitHubCopilotChat/0.35.0",
        },
        body: new URLSearchParams({
            client_id: CLIENT_ID,
            scope: "read:user",
        }),
    });
    if (!data || typeof data !== "object") {
        throw new Error("Invalid device code response");
    }
    const deviceCode = data.device_code;
    const userCode = data.user_code;
    const verificationUri = data.verification_uri;
    const interval = data.interval;
    const expiresIn = data.expires_in;
    if (typeof deviceCode !== "string" ||
        typeof userCode !== "string" ||
        typeof verificationUri !== "string" ||
        (interval !== undefined && typeof interval !== "number") ||
        typeof expiresIn !== "number") {
        throw new Error("Invalid device code response fields");
    }
    // The verification URI is opened in the user's browser and to prevent `open` from
    // opening an executable or similar, we force it to be a URL.
    let parsedUri;
    try {
        parsedUri = new URL(verificationUri);
    }
    catch {
        throw new Error("Untrusted verification_uri in device code response");
    }
    if (parsedUri.protocol !== "https:" && parsedUri.protocol !== "http:") {
        throw new Error("Untrusted verification_uri in device code response");
    }
    return {
        device_code: deviceCode,
        user_code: userCode,
        verification_uri: parsedUri.href,
        interval,
        expires_in: expiresIn,
    };
}
async function pollForGitHubAccessToken(domain, device, signal) {
    const urls = getUrls(domain);
    return pollOAuthDeviceCodeFlow({
        intervalSeconds: device.interval,
        expiresInSeconds: device.expires_in,
        signal,
        poll: async () => {
            const raw = await fetchJson(urls.accessTokenUrl, {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": "GitHubCopilotChat/0.35.0",
                },
                body: new URLSearchParams({
                    client_id: CLIENT_ID,
                    device_code: device.device_code,
                    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                }),
            });
            if (raw && typeof raw === "object" && typeof raw.access_token === "string") {
                return { status: "complete", value: raw.access_token };
            }
            if (raw && typeof raw === "object" && typeof raw.error === "string") {
                const { error, error_description: description } = raw;
                if (error === "authorization_pending") {
                    return { status: "pending" };
                }
                if (error === "slow_down") {
                    return { status: "slow_down" };
                }
                const descriptionSuffix = description ? `: ${description}` : "";
                return { status: "failed", message: `Device flow failed: ${error}${descriptionSuffix}` };
            }
            return { status: "failed", message: "Invalid device token response" };
        },
    });
}
async function refreshGitHubCopilotAccessToken(refreshToken, enterpriseDomain) {
    const domain = enterpriseDomain || "github.com";
    const urls = getUrls(domain);
    const raw = await fetchJson(urls.copilotTokenUrl, {
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${refreshToken}`,
            ...COPILOT_HEADERS,
        },
    });
    if (!raw || typeof raw !== "object") {
        throw new Error("Invalid Copilot token response");
    }
    const token = raw.token;
    const expiresAt = raw.expires_at;
    if (typeof token !== "string" || typeof expiresAt !== "number") {
        throw new Error("Invalid Copilot token response fields");
    }
    return {
        refresh: refreshToken,
        access: token,
        expires: expiresAt * 1000 - 5 * 60 * 1000,
        enterpriseUrl: enterpriseDomain,
    };
}
/**
 * Refresh GitHub Copilot token
 */
export async function refreshGitHubCopilotToken(refreshToken, enterpriseDomain) {
    const credentials = await refreshGitHubCopilotAccessToken(refreshToken, enterpriseDomain);
    return {
        ...credentials,
        availableModelIds: await fetchAvailableGitHubCopilotModelIds(credentials.access, enterpriseDomain),
    };
}
/**
 * Enable a model for the user's GitHub Copilot account.
 * This is required for some models (like Claude, Grok) before they can be used.
 */
async function enableGitHubCopilotModel(token, modelId, enterpriseDomain) {
    const baseUrl = getGitHubCopilotBaseUrl(token, enterpriseDomain);
    const url = `${baseUrl}/models/${modelId}/policy`;
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
                ...COPILOT_HEADERS,
                "openai-intent": "chat-policy",
                "x-interaction-type": "chat-policy",
            },
            body: JSON.stringify({ state: "enabled" }),
        });
        return response.ok;
    }
    catch {
        return false;
    }
}
/**
 * Enable all known GitHub Copilot models that may require policy acceptance.
 * Called after successful login to ensure all models are available.
 */
async function enableAllGitHubCopilotModels(token, enterpriseDomain, onProgress) {
    const models = Object.values(GITHUB_COPILOT_MODELS);
    await Promise.all(models.map(async (model) => {
        const success = await enableGitHubCopilotModel(token, model.id, enterpriseDomain);
        onProgress?.(model.id, success);
    }));
}
/**
 * Login with GitHub Copilot OAuth (device code flow)
 *
 * @param options.onDeviceCode - Callback with URL and user code
 * @param options.onPrompt - Callback to prompt user for input
 * @param options.onProgress - Optional progress callback
 * @param options.signal - Optional AbortSignal for cancellation
 */
export async function loginGitHubCopilot(options) {
    const input = await options.onPrompt({
        message: "GitHub Enterprise URL/domain (blank for github.com)",
        placeholder: "company.ghe.com",
        allowEmpty: true,
    });
    if (options.signal?.aborted) {
        throw new Error("Login cancelled");
    }
    const trimmed = input.trim();
    const enterpriseDomain = normalizeDomain(input);
    if (trimmed && !enterpriseDomain) {
        throw new Error("Invalid GitHub Enterprise URL/domain");
    }
    const domain = enterpriseDomain || "github.com";
    const device = await startDeviceFlow(domain);
    options.onDeviceCode({
        userCode: device.user_code,
        verificationUri: device.verification_uri,
        intervalSeconds: device.interval,
        expiresInSeconds: device.expires_in,
    });
    const githubAccessToken = await pollForGitHubAccessToken(domain, device, options.signal);
    const credentials = await refreshGitHubCopilotAccessToken(githubAccessToken, enterpriseDomain ?? undefined);
    // Enable all models after successful login
    options.onProgress?.("Enabling models...");
    await enableAllGitHubCopilotModels(credentials.access, enterpriseDomain ?? undefined);
    // Fetch availability after policy enable so newly enabled models are included,
    // while unavailable models are still filtered out.
    return {
        ...credentials,
        availableModelIds: await fetchAvailableGitHubCopilotModelIds(credentials.access, enterpriseDomain ?? undefined),
    };
}
function copilotEnterpriseDomain(credential) {
    const enterpriseUrl = credential.enterpriseUrl;
    if (typeof enterpriseUrl !== "string" || !enterpriseUrl)
        return undefined;
    return normalizeDomain(enterpriseUrl) ?? undefined;
}
export const githubCopilotOAuth = {
    name: "GitHub Copilot",
    async login(callbacks) {
        const credentials = await loginGitHubCopilot({
            onDeviceCode: (info) => callbacks.notify({ type: "device_code", ...info }),
            onPrompt: (prompt) => callbacks.prompt({ type: "text", message: prompt.message, placeholder: prompt.placeholder }),
            onProgress: (message) => callbacks.notify({ type: "progress", message }),
            signal: callbacks.signal,
        });
        return { ...credentials, type: "oauth" };
    },
    async refresh(credential) {
        return {
            ...(await refreshGitHubCopilotToken(credential.refresh, copilotEnterpriseDomain(credential))),
            type: "oauth",
        };
    },
    /** Per-credential baseUrl from the token's proxy endpoint replaces the old `modifyModels` rewriting. */
    async toAuth(credential) {
        return {
            apiKey: credential.access,
            baseUrl: getGitHubCopilotBaseUrl(credential.access, copilotEnterpriseDomain(credential)),
        };
    },
};
export const githubCopilotOAuthProvider = {
    id: "github-copilot",
    name: "GitHub Copilot",
    async login(callbacks) {
        return loginGitHubCopilot({
            onDeviceCode: callbacks.onDeviceCode,
            onPrompt: callbacks.onPrompt,
            onProgress: callbacks.onProgress,
            signal: callbacks.signal,
        });
    },
    async refreshToken(credentials) {
        const creds = credentials;
        return refreshGitHubCopilotToken(creds.refresh, creds.enterpriseUrl);
    },
    getApiKey(credentials) {
        return credentials.access;
    },
    modifyModels(models, credentials) {
        const creds = credentials;
        const domain = creds.enterpriseUrl ? (normalizeDomain(creds.enterpriseUrl) ?? undefined) : undefined;
        const baseUrl = getGitHubCopilotBaseUrl(creds.access, domain);
        // Older stored Pi auth entries do not have account-specific model IDs yet;
        // keep their existing generated-catalog behavior until the next refresh/login.
        const availableModelIds = "availableModelIds" in creds ? new Set(creds.availableModelIds) : undefined;
        return models.flatMap((m) => {
            if (m.provider !== "github-copilot")
                return [m];
            if (availableModelIds && !availableModelIds.has(m.id))
                return [];
            return [{ ...m, baseUrl }];
        });
    },
};
//# sourceMappingURL=github-copilot.js.map