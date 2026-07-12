import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.js";
import { openAICompletionsApi } from "../api/openai-completions.lazy.js";
import { openAIResponsesApi } from "../api/openai-responses.lazy.js";
import { createProvider } from "../models.js";
import { CLOUDFLARE_AI_GATEWAY_MODELS } from "./cloudflare-ai-gateway.models.js";
import { cloudflareAIGatewayAuth } from "./cloudflare-auth.js";
export function cloudflareAIGatewayProvider() {
    return createProvider({
        id: "cloudflare-ai-gateway",
        name: "Cloudflare AI Gateway",
        auth: { apiKey: cloudflareAIGatewayAuth() },
        models: Object.values(CLOUDFLARE_AI_GATEWAY_MODELS),
        api: {
            "anthropic-messages": anthropicMessagesApi(),
            "openai-completions": openAICompletionsApi(),
            "openai-responses": openAIResponsesApi(),
        },
    });
}
//# sourceMappingURL=cloudflare-ai-gateway.js.map