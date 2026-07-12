import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.js";
import { openAICompletionsApi } from "../api/openai-completions.lazy.js";
import { envApiKeyAuth } from "../auth/helpers.js";
import { createProvider } from "../models.js";
import { OPENCODE_GO_MODELS } from "./opencode-go.models.js";
export function opencodeGoProvider() {
    return createProvider({
        id: "opencode-go",
        name: "OpenCode Zen Go",
        auth: { apiKey: envApiKeyAuth("OpenCode API key", ["OPENCODE_API_KEY"]) },
        models: Object.values(OPENCODE_GO_MODELS),
        api: {
            "anthropic-messages": anthropicMessagesApi(),
            "openai-completions": openAICompletionsApi(),
        },
    });
}
//# sourceMappingURL=opencode-go.js.map