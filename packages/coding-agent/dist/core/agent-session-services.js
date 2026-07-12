import { join } from "node:path";
import { getAgentDir } from "../config.js";
import { resolvePath } from "../utils/paths.js";
import { AuthStorage } from "./auth-storage.js";
import { ModelRegistry } from "./model-registry.js";
import { DefaultResourceLoader, } from "./resource-loader.js";
import { createAgentSession } from "./sdk.js";
import { SettingsManager } from "./settings-manager.js";
function applyExtensionFlagValues(resourceLoader, extensionFlagValues) {
    if (!extensionFlagValues) {
        return [];
    }
    const diagnostics = [];
    const extensionsResult = resourceLoader.getExtensions();
    const registeredFlags = new Map();
    for (const extension of extensionsResult.extensions) {
        for (const [name, flag] of extension.flags) {
            registeredFlags.set(name, { type: flag.type });
        }
    }
    const unknownFlags = [];
    for (const [name, value] of extensionFlagValues) {
        const flag = registeredFlags.get(name);
        if (!flag) {
            unknownFlags.push(name);
            continue;
        }
        if (flag.type === "boolean") {
            extensionsResult.runtime.flagValues.set(name, true);
            continue;
        }
        if (typeof value === "string") {
            extensionsResult.runtime.flagValues.set(name, value);
            continue;
        }
        diagnostics.push({
            type: "error",
            message: `Extension flag "--${name}" requires a value`,
        });
    }
    if (unknownFlags.length > 0) {
        diagnostics.push({
            type: "error",
            message: `Unknown option${unknownFlags.length === 1 ? "" : "s"}: ${unknownFlags.map((name) => `--${name}`).join(", ")}`,
        });
    }
    return diagnostics;
}
/**
 * Create cwd-bound runtime services.
 *
 * Returns services plus diagnostics. It does not create an AgentSession.
 */
export async function createAgentSessionServices(options) {
    const cwd = resolvePath(options.cwd);
    const agentDir = options.agentDir ? resolvePath(options.agentDir) : getAgentDir();
    const authStorage = options.authStorage ?? AuthStorage.create(join(agentDir, "auth.json"));
    const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
    const modelRegistry = options.modelRegistry ?? ModelRegistry.create(authStorage, join(agentDir, "models.json"));
    const resourceLoader = new DefaultResourceLoader({
        ...(options.resourceLoaderOptions ?? {}),
        cwd,
        agentDir,
        settingsManager,
    });
    await resourceLoader.reload(options.resourceLoaderReloadOptions);
    const diagnostics = [];
    const extensionsResult = resourceLoader.getExtensions();
    for (const { name, config, extensionPath } of extensionsResult.runtime.pendingProviderRegistrations) {
        try {
            modelRegistry.registerProvider(name, config);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            diagnostics.push({
                type: "error",
                message: `Extension "${extensionPath}" error: ${message}`,
            });
        }
    }
    extensionsResult.runtime.pendingProviderRegistrations = [];
    diagnostics.push(...applyExtensionFlagValues(resourceLoader, options.extensionFlagValues));
    return {
        cwd,
        agentDir,
        authStorage,
        settingsManager,
        modelRegistry,
        resourceLoader,
        diagnostics,
    };
}
/**
 * Create an AgentSession from previously created services.
 *
 * This keeps session creation separate from service creation so callers can
 * resolve model, thinking, tools, and other session inputs against the target
 * cwd before constructing the session.
 */
export async function createAgentSessionFromServices(options) {
    return createAgentSession({
        cwd: options.services.cwd,
        agentDir: options.services.agentDir,
        authStorage: options.services.authStorage,
        settingsManager: options.services.settingsManager,
        modelRegistry: options.services.modelRegistry,
        resourceLoader: options.services.resourceLoader,
        sessionManager: options.sessionManager,
        model: options.model,
        thinkingLevel: options.thinkingLevel,
        scopedModels: options.scopedModels,
        tools: options.tools,
        excludeTools: options.excludeTools,
        noTools: options.noTools,
        customTools: options.customTools,
        sessionStartEvent: options.sessionStartEvent,
    });
}
//# sourceMappingURL=agent-session-services.js.map