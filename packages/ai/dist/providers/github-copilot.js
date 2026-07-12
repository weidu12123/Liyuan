import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.js";
import { openAICompletionsApi } from "../api/openai-completions.lazy.js";
import { openAIResponsesApi } from "../api/openai-responses.lazy.js";
import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.js";
import { createProvider } from "../models.js";
import { loadGitHubCopilotOAuth } from "../utils/oauth/load.js";
import { GITHUB_COPILOT_MODELS } from "./github-copilot.models.js";
export function githubCopilotProvider() {
    return createProvider({
        id: "github-copilot",
        name: "GitHub Copilot",
        baseUrl: "https://api.individual.githubcopilot.com",
        auth: {
            apiKey: envApiKeyAuth("GitHub Copilot token", ["COPILOT_GITHUB_TOKEN"]),
            oauth: lazyOAuth({ name: "GitHub Copilot", load: loadGitHubCopilotOAuth }),
        },
        models: Object.values(GITHUB_COPILOT_MODELS),
        api: {
            "anthropic-messages": anthropicMessagesApi(),
            "openai-completions": openAICompletionsApi(),
            "openai-responses": openAIResponsesApi(),
        },
    });
}
//# sourceMappingURL=github-copilot.js.map