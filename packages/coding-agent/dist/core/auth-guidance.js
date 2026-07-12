import { join } from "node:path";
import { getDocsPath } from "../config.js";
const UNKNOWN_PROVIDER = "unknown";
export function getProviderLoginHelp() {
    return [
        "Use /login to log into a provider via OAuth or API key. See:",
        `  ${join(getDocsPath(), "providers.md")}`,
        `  ${join(getDocsPath(), "models.md")}`,
    ].join("\n");
}
export function formatNoModelsAvailableMessage() {
    return `No models available. ${getProviderLoginHelp()}`;
}
export function formatNoModelSelectedMessage() {
    return `No model selected.\n\n${getProviderLoginHelp()}\n\nThen use /model to select a model.`;
}
export function formatNoApiKeyFoundMessage(provider) {
    const providerDisplay = provider === UNKNOWN_PROVIDER ? "the selected model" : provider;
    return `No API key found for ${providerDisplay}.\n\n${getProviderLoginHelp()}`;
}
//# sourceMappingURL=auth-guidance.js.map