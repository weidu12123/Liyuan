import OpenAI from "openai";
import { clampThinkingLevel } from "../models.js";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { headersToRecord } from "../utils/headers.js";
import { getProviderEnvValue } from "../utils/provider-env.js";
import { buildCopilotDynamicHeaders, hasCopilotVisionInput } from "./github-copilot-headers.js";
import { clampOpenAIPromptCacheKey } from "./openai-prompt-cache.js";
import { convertResponsesMessages, convertResponsesTools, processResponsesStream } from "./openai-responses-shared.js";
import { buildBaseOptions } from "./simple-options.js";
const OPENAI_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);
function hasHeader(headers, name) {
    if (!headers)
        return false;
    const expected = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === expected && value !== null && value.trim().length > 0)
            return true;
    }
    return false;
}
function getClientApiKey(provider, apiKey, headers) {
    if (apiKey)
        return apiKey;
    if (hasHeader(headers, "authorization") || hasHeader(headers, "cf-aig-authorization"))
        return "unused";
    throw new Error(`No API key for provider: ${provider}`);
}
/**
 * Resolve cache retention preference.
 * Defaults to "short" and uses PI_CACHE_RETENTION for backward compatibility.
 */
function resolveCacheRetention(cacheRetention, env) {
    if (cacheRetention) {
        return cacheRetention;
    }
    if (getProviderEnvValue("PI_CACHE_RETENTION", env) === "long") {
        return "long";
    }
    return "short";
}
function getCompat(model) {
    return {
        supportsDeveloperRole: model.compat?.supportsDeveloperRole ?? true,
        sendSessionIdHeader: model.compat?.sendSessionIdHeader ?? true,
        supportsLongCacheRetention: model.compat?.supportsLongCacheRetention ?? true,
    };
}
function getPromptCacheRetention(compat, cacheRetention) {
    return cacheRetention === "long" && compat.supportsLongCacheRetention ? "24h" : undefined;
}
function formatOpenAIResponsesError(error) {
    return formatProviderError(normalizeProviderError(error), "OpenAI API error");
}
/**
 * Generate function for OpenAI Responses API
 */
export const stream = (model, context, options) => {
    const stream = new AssistantMessageEventStream();
    // Start async processing
    (async () => {
        const output = {
            role: "assistant",
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop",
            timestamp: Date.now(),
        };
        try {
            // Create OpenAI client
            const apiKey = getClientApiKey(model.provider, options?.apiKey, options?.headers);
            const cacheRetention = resolveCacheRetention(options?.cacheRetention, options?.env);
            const cacheSessionId = cacheRetention === "none" ? undefined : options?.sessionId;
            const client = createClient(model, context, apiKey, options?.headers, cacheSessionId);
            let params = buildParams(model, context, options);
            const nextParams = await options?.onPayload?.(params, model);
            if (nextParams !== undefined) {
                params = nextParams;
            }
            const requestOptions = {
                ...(options?.signal ? { signal: options.signal } : {}),
                ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
                maxRetries: options?.maxRetries ?? 0,
            };
            const { data: openaiStream, response } = await client.responses.create(params, requestOptions).withResponse();
            await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
            stream.push({ type: "start", partial: output });
            await processResponsesStream(openaiStream, output, stream, model, {
                serviceTier: options?.serviceTier,
                applyServiceTierPricing: (usage, serviceTier) => applyServiceTierPricing(usage, serviceTier, model),
            });
            if (options?.signal?.aborted) {
                throw new Error("Request was aborted");
            }
            if (output.stopReason === "aborted" || output.stopReason === "error") {
                throw new Error("An unknown error occurred");
            }
            stream.push({ type: "done", reason: output.stopReason, message: output });
            stream.end();
        }
        catch (error) {
            for (const block of output.content) {
                delete block.index;
                // partialJson is only a streaming scratch buffer; never persist it.
                delete block.partialJson;
            }
            output.stopReason = options?.signal?.aborted ? "aborted" : "error";
            output.errorMessage = formatOpenAIResponsesError(error);
            stream.push({ type: "error", reason: output.stopReason, error: output });
            stream.end();
        }
    })();
    return stream;
};
export const streamSimple = (model, context, options) => {
    getClientApiKey(model.provider, options?.apiKey, options?.headers);
    const base = buildBaseOptions(model, context, options, options?.apiKey);
    const clampedReasoning = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
    const reasoningEffort = clampedReasoning === "off" ? undefined : clampedReasoning;
    return stream(model, context, {
        ...base,
        reasoningEffort,
    });
};
function createClient(model, context, apiKey, optionsHeaders, sessionId) {
    const compat = getCompat(model);
    const headers = { ...model.headers };
    if (model.provider === "github-copilot") {
        const hasImages = hasCopilotVisionInput(context.messages);
        const copilotHeaders = buildCopilotDynamicHeaders({
            messages: context.messages,
            hasImages,
        });
        Object.assign(headers, copilotHeaders);
    }
    if (sessionId) {
        if (compat.sendSessionIdHeader) {
            headers.session_id = sessionId;
        }
        headers["x-client-request-id"] = sessionId;
    }
    // Merge options headers last so they can override defaults
    if (optionsHeaders) {
        Object.assign(headers, optionsHeaders);
    }
    return new OpenAI({
        apiKey,
        baseURL: model.baseUrl,
        dangerouslyAllowBrowser: true,
        defaultHeaders: headers,
    });
}
function buildParams(model, context, options) {
    const messages = convertResponsesMessages(model, context, OPENAI_TOOL_CALL_PROVIDERS);
    const cacheRetention = resolveCacheRetention(options?.cacheRetention, options?.env);
    const compat = getCompat(model);
    const params = {
        model: model.id,
        input: messages,
        stream: true,
        prompt_cache_key: cacheRetention === "none" ? undefined : clampOpenAIPromptCacheKey(options?.sessionId),
        prompt_cache_retention: getPromptCacheRetention(compat, cacheRetention),
        store: false,
    };
    if (options?.maxTokens) {
        params.max_output_tokens = options?.maxTokens;
    }
    if (options?.temperature !== undefined) {
        params.temperature = options?.temperature;
    }
    if (options?.serviceTier !== undefined) {
        params.service_tier = options.serviceTier;
    }
    if (context.tools && context.tools.length > 0) {
        params.tools = convertResponsesTools(context.tools);
    }
    if (model.reasoning) {
        if (options?.reasoningEffort || options?.reasoningSummary) {
            const effort = options?.reasoningEffort
                ? (model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort)
                : "medium";
            params.reasoning = {
                effort: effort,
                summary: options?.reasoningSummary || "auto",
            };
            params.include = ["reasoning.encrypted_content"];
        }
        else if (model.provider !== "github-copilot" && model.thinkingLevelMap?.off !== null) {
            params.reasoning = {
                effort: (model.thinkingLevelMap?.off ?? "none"),
            };
        }
    }
    return params;
}
function getServiceTierCostMultiplier(model, serviceTier) {
    switch (serviceTier) {
        case "flex":
            return 0.5;
        case "priority":
            return model.id === "gpt-5.5" ? 2.5 : 2;
        default:
            return 1;
    }
}
function applyServiceTierPricing(usage, serviceTier, model) {
    const multiplier = getServiceTierCostMultiplier(model, serviceTier);
    if (multiplier === 1)
        return;
    usage.cost.input *= multiplier;
    usage.cost.output *= multiplier;
    usage.cost.cacheRead *= multiplier;
    usage.cost.cacheWrite *= multiplier;
    usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}
//# sourceMappingURL=openai-responses.js.map