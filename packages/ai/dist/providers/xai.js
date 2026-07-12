import { openAICompletionsApi } from "../api/openai-completions.lazy.js";
import { envApiKeyAuth } from "../auth/helpers.js";
import { createProvider } from "../models.js";
import { XAI_MODELS } from "./xai.models.js";
export function xaiProvider() {
    return createProvider({
        id: "xai",
        name: "xAI",
        baseUrl: "https://api.x.ai/v1",
        auth: { apiKey: envApiKeyAuth("xAI API key", ["XAI_API_KEY"]) },
        models: Object.values(XAI_MODELS),
        api: openAICompletionsApi(),
    });
}
//# sourceMappingURL=xai.js.map