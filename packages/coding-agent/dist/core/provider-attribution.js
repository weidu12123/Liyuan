import { isInstallTelemetryEnabled } from "./telemetry.js";
const OPENROUTER_HOST = "openrouter.ai";
const NVIDIA_NIM_HOST = "integrate.api.nvidia.com";
const CLOUDFLARE_API_HOST = "api.cloudflare.com";
const CLOUDFLARE_AI_GATEWAY_HOST = "gateway.ai.cloudflare.com";
const OPENCODE_HOST = "opencode.ai";
const VERCEL_GATEWAY_HOST = "ai-gateway.vercel.sh";
function matchesHost(baseUrl, expectedHost) {
    try {
        return new URL(baseUrl).hostname === expectedHost;
    }
    catch {
        return false;
    }
}
function isOpenRouterModel(model) {
    return model.provider === "openrouter" || model.baseUrl.includes(OPENROUTER_HOST);
}
function isNvidiaNimModel(model) {
    return model.provider === "nvidia" || matchesHost(model.baseUrl, NVIDIA_NIM_HOST);
}
function isCloudflareModel(model) {
    return (model.provider === "cloudflare-workers-ai" ||
        model.provider === "cloudflare-ai-gateway" ||
        matchesHost(model.baseUrl, CLOUDFLARE_API_HOST) ||
        matchesHost(model.baseUrl, CLOUDFLARE_AI_GATEWAY_HOST));
}
function isVercelGatewayModel(model) {
    return model.provider === "vercel-ai-gateway" || matchesHost(model.baseUrl, VERCEL_GATEWAY_HOST);
}
function getDefaultAttributionHeaders(model, settingsManager) {
    if (!isInstallTelemetryEnabled(settingsManager)) {
        return undefined;
    }
    if (isOpenRouterModel(model)) {
        return {
            "HTTP-Referer": "https://pi.dev",
            "X-OpenRouter-Title": "pi",
            "X-OpenRouter-Categories": "cli-agent",
        };
    }
    if (isNvidiaNimModel(model)) {
        return {
            "X-BILLING-INVOKE-ORIGIN": "Pi",
        };
    }
    if (isCloudflareModel(model)) {
        return {
            "User-Agent": "pi-coding-agent",
        };
    }
    if (isVercelGatewayModel(model)) {
        return {
            "http-referer": "https://pi.dev",
            "x-title": "pi",
        };
    }
    return undefined;
}
function getSessionHeaders(model, sessionId) {
    if (!sessionId)
        return undefined;
    if (model.provider !== "opencode" &&
        model.provider !== "opencode-go" &&
        !matchesHost(model.baseUrl, OPENCODE_HOST)) {
        return undefined;
    }
    return { "x-opencode-session": sessionId, "x-opencode-client": "pi" };
}
export function mergeProviderAttributionHeaders(model, settingsManager, sessionId, ...headerSources) {
    const merged = {
        ...getSessionHeaders(model, sessionId),
        ...getDefaultAttributionHeaders(model, settingsManager),
    };
    for (const headers of headerSources) {
        if (headers) {
            Object.assign(merged, headers);
        }
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
}
//# sourceMappingURL=provider-attribution.js.map