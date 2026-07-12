import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.js";
import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.js";
import { createProvider } from "../models.js";
import { loadAnthropicOAuth } from "../utils/oauth/load.js";
import { ANTHROPIC_MODELS } from "./anthropic.models.js";
export function anthropicProvider() {
    return createProvider({
        id: "anthropic",
        name: "Anthropic",
        baseUrl: "https://api.anthropic.com",
        auth: {
            // ANTHROPIC_OAUTH_TOKEN takes precedence over ANTHROPIC_API_KEY
            apiKey: envApiKeyAuth("Anthropic API key", ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]),
            oauth: lazyOAuth({ name: "Anthropic (Claude Pro/Max)", load: loadAnthropicOAuth }),
        },
        models: Object.values(ANTHROPIC_MODELS),
        api: anthropicMessagesApi(),
    });
}
//# sourceMappingURL=anthropic.js.map