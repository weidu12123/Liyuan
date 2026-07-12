var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
/**
 * Loads an OAuth flow module through a variable specifier so bundlers cannot
 * follow the import into Node-only flow code (`node:http` callback servers,
 * `node:crypto` PKCE). The `.ts`/`.js` rewrite keeps the trick working from
 * both source and built output.
 */
const importOAuthModule = (specifier) => {
    const runtimeSpecifier = import.meta.url.endsWith(".js") ? specifier.replace(/\.ts$/, ".js") : specifier;
    return import(__rewriteRelativeImportExtension(runtimeSpecifier));
};
export const loadAnthropicOAuth = async () => (await importOAuthModule("./anthropic.ts")).anthropicOAuth;
export const loadOpenAICodexOAuth = async () => (await importOAuthModule("./openai-codex.ts")).openaiCodexOAuth;
export const loadGitHubCopilotOAuth = async () => (await importOAuthModule("./github-copilot.ts")).githubCopilotOAuth;
//# sourceMappingURL=load.js.map