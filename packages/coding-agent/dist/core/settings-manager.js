import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import lockfile from "proper-lockfile";
import { CONFIG_DIR_NAME, getAgentDir } from "../config.js";
import { normalizePath, resolvePath } from "../utils/paths.js";
import { DEFAULT_HTTP_IDLE_TIMEOUT_MS, parseHttpIdleTimeoutMs } from "./http-dispatcher.js";
/** Deep merge settings: project/overrides take precedence, nested objects merge recursively */
function deepMergeSettings(base, overrides) {
    const result = { ...base };
    for (const key of Object.keys(overrides)) {
        const overrideValue = overrides[key];
        const baseValue = base[key];
        if (overrideValue === undefined) {
            continue;
        }
        // For nested objects, merge recursively
        if (typeof overrideValue === "object" &&
            overrideValue !== null &&
            !Array.isArray(overrideValue) &&
            typeof baseValue === "object" &&
            baseValue !== null &&
            !Array.isArray(baseValue)) {
            result[key] = { ...baseValue, ...overrideValue };
        }
        else {
            // For primitives and arrays, override value wins
            result[key] = overrideValue;
        }
    }
    return result;
}
function parseTimeoutSetting(value, settingName) {
    const timeoutMs = parseHttpIdleTimeoutMs(value);
    if (timeoutMs !== undefined) {
        return timeoutMs;
    }
    if (value !== undefined) {
        throw new Error(`Invalid ${settingName} setting: ${String(value)}`);
    }
    return undefined;
}
export class FileSettingsStorage {
    globalSettingsPath;
    projectSettingsPath;
    constructor(cwd, agentDir) {
        const resolvedCwd = resolvePath(cwd);
        const resolvedAgentDir = resolvePath(agentDir);
        this.globalSettingsPath = join(resolvedAgentDir, "settings.json");
        this.projectSettingsPath = join(resolvedCwd, CONFIG_DIR_NAME, "settings.json");
    }
    acquireLockSyncWithRetry(path) {
        const maxAttempts = 10;
        const delayMs = 20;
        let lastError;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return lockfile.lockSync(path, { realpath: false });
            }
            catch (error) {
                const code = typeof error === "object" && error !== null && "code" in error
                    ? String(error.code)
                    : undefined;
                if (code !== "ELOCKED" || attempt === maxAttempts) {
                    throw error;
                }
                lastError = error;
                const start = Date.now();
                while (Date.now() - start < delayMs) {
                    // Sleep synchronously to avoid changing callers to async.
                }
            }
        }
        throw lastError ?? new Error("Failed to acquire settings lock");
    }
    withLock(scope, fn) {
        const path = scope === "global" ? this.globalSettingsPath : this.projectSettingsPath;
        const dir = dirname(path);
        let release;
        try {
            // Only create directory and lock if file exists or we need to write
            const fileExists = existsSync(path);
            if (fileExists) {
                release = this.acquireLockSyncWithRetry(path);
            }
            const current = fileExists ? readFileSync(path, "utf-8") : undefined;
            const next = fn(current);
            if (next !== undefined) {
                // Only create directory when we actually need to write
                if (!existsSync(dir)) {
                    mkdirSync(dir, { recursive: true });
                }
                if (!release) {
                    release = this.acquireLockSyncWithRetry(path);
                }
                writeFileSync(path, next, "utf-8");
            }
        }
        finally {
            if (release) {
                release();
            }
        }
    }
}
export class InMemorySettingsStorage {
    global;
    project;
    withLock(scope, fn) {
        const current = scope === "global" ? this.global : this.project;
        const next = fn(current);
        if (next !== undefined) {
            if (scope === "global") {
                this.global = next;
            }
            else {
                this.project = next;
            }
        }
    }
}
export class SettingsManager {
    storage;
    globalSettings;
    projectSettings;
    settings;
    projectTrusted;
    modifiedFields = new Set(); // Track global fields modified during session
    modifiedNestedFields = new Map(); // Track global nested field modifications
    modifiedProjectFields = new Set(); // Track project fields modified during session
    modifiedProjectNestedFields = new Map(); // Track project nested field modifications
    globalSettingsLoadError = null; // Track if global settings file had parse errors
    projectSettingsLoadError = null; // Track if project settings file had parse errors
    writeQueue = Promise.resolve();
    errors;
    constructor(storage, initialGlobal, initialProject, globalLoadError = null, projectLoadError = null, initialErrors = [], projectTrusted = true) {
        this.storage = storage;
        this.globalSettings = initialGlobal;
        this.projectSettings = initialProject;
        this.projectTrusted = projectTrusted;
        this.globalSettingsLoadError = globalLoadError;
        this.projectSettingsLoadError = projectLoadError;
        this.errors = [...initialErrors];
        this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
    }
    /** Create a SettingsManager that loads from files */
    static create(cwd, agentDir = getAgentDir(), options = {}) {
        const storage = new FileSettingsStorage(cwd, agentDir);
        return SettingsManager.fromStorage(storage, options);
    }
    /** Create a SettingsManager from an arbitrary storage backend */
    static fromStorage(storage, options = {}) {
        const projectTrusted = options.projectTrusted ?? true;
        const globalLoad = SettingsManager.tryLoadFromStorage(storage, "global");
        const projectLoad = SettingsManager.tryLoadFromStorage(storage, "project", projectTrusted);
        const initialErrors = [];
        if (globalLoad.error) {
            initialErrors.push({ scope: "global", error: globalLoad.error });
        }
        if (projectLoad.error) {
            initialErrors.push({ scope: "project", error: projectLoad.error });
        }
        return new SettingsManager(storage, globalLoad.settings, projectLoad.settings, globalLoad.error, projectLoad.error, initialErrors, projectTrusted);
    }
    /** Create an in-memory SettingsManager (no file I/O) */
    static inMemory(settings = {}, options = {}) {
        const storage = new InMemorySettingsStorage();
        const initialSettings = SettingsManager.migrateSettings(structuredClone(settings));
        storage.withLock("global", () => JSON.stringify(initialSettings, null, 2));
        return SettingsManager.fromStorage(storage, options);
    }
    static loadFromStorage(storage, scope, projectTrusted = true) {
        if (scope === "project" && !projectTrusted) {
            return {};
        }
        let content;
        storage.withLock(scope, (current) => {
            content = current;
            return undefined;
        });
        if (!content) {
            return {};
        }
        const settings = JSON.parse(content);
        return SettingsManager.migrateSettings(settings);
    }
    static tryLoadFromStorage(storage, scope, projectTrusted = true) {
        try {
            return { settings: SettingsManager.loadFromStorage(storage, scope, projectTrusted), error: null };
        }
        catch (error) {
            return { settings: {}, error: error };
        }
    }
    /** Migrate old settings format to new format */
    static migrateSettings(settings) {
        // Migrate queueMode -> steeringMode
        if ("queueMode" in settings && !("steeringMode" in settings)) {
            settings.steeringMode = settings.queueMode;
            delete settings.queueMode;
        }
        // Migrate legacy websockets boolean -> transport enum
        if (!("transport" in settings) && typeof settings.websockets === "boolean") {
            settings.transport = settings.websockets ? "websocket" : "sse";
            delete settings.websockets;
        }
        // Migrate old skills object format to new array format
        if ("skills" in settings &&
            typeof settings.skills === "object" &&
            settings.skills !== null &&
            !Array.isArray(settings.skills)) {
            const skillsSettings = settings.skills;
            if (skillsSettings.enableSkillCommands !== undefined && settings.enableSkillCommands === undefined) {
                settings.enableSkillCommands = skillsSettings.enableSkillCommands;
            }
            if (Array.isArray(skillsSettings.customDirectories) && skillsSettings.customDirectories.length > 0) {
                settings.skills = skillsSettings.customDirectories;
            }
            else {
                delete settings.skills;
            }
        }
        // Migrate retry.maxDelayMs -> retry.provider.maxRetryDelayMs
        if ("retry" in settings &&
            typeof settings.retry === "object" &&
            settings.retry !== null &&
            !Array.isArray(settings.retry)) {
            const retrySettings = settings.retry;
            const providerSettings = typeof retrySettings.provider === "object" && retrySettings.provider !== null
                ? retrySettings.provider
                : undefined;
            if (typeof retrySettings.maxDelayMs === "number" &&
                (providerSettings?.maxRetryDelayMs === undefined || providerSettings?.maxRetryDelayMs === null)) {
                retrySettings.provider = {
                    ...(providerSettings ?? {}),
                    maxRetryDelayMs: retrySettings.maxDelayMs,
                };
            }
            delete retrySettings.maxDelayMs;
        }
        return settings;
    }
    getGlobalSettings() {
        return structuredClone(this.globalSettings);
    }
    getProjectSettings() {
        return structuredClone(this.projectSettings);
    }
    isProjectTrusted() {
        return this.projectTrusted;
    }
    setProjectTrusted(trusted) {
        if (this.projectTrusted === trusted) {
            return;
        }
        this.projectTrusted = trusted;
        this.modifiedProjectFields.clear();
        this.modifiedProjectNestedFields.clear();
        if (!trusted) {
            this.projectSettings = {};
            this.projectSettingsLoadError = null;
            this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
            return;
        }
        const projectLoad = SettingsManager.tryLoadFromStorage(this.storage, "project", trusted);
        this.projectSettings = projectLoad.settings;
        this.projectSettingsLoadError = projectLoad.error;
        if (projectLoad.error) {
            this.recordError("project", projectLoad.error);
        }
        this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
    }
    async reload() {
        await this.writeQueue;
        const globalLoad = SettingsManager.tryLoadFromStorage(this.storage, "global");
        if (!globalLoad.error) {
            this.globalSettings = globalLoad.settings;
            this.globalSettingsLoadError = null;
        }
        else {
            this.globalSettingsLoadError = globalLoad.error;
            this.recordError("global", globalLoad.error);
        }
        this.modifiedFields.clear();
        this.modifiedNestedFields.clear();
        this.modifiedProjectFields.clear();
        this.modifiedProjectNestedFields.clear();
        const projectLoad = SettingsManager.tryLoadFromStorage(this.storage, "project", this.projectTrusted);
        if (!projectLoad.error) {
            this.projectSettings = projectLoad.settings;
            this.projectSettingsLoadError = null;
        }
        else {
            this.projectSettingsLoadError = projectLoad.error;
            this.recordError("project", projectLoad.error);
        }
        this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
    }
    /** Apply additional overrides on top of current settings */
    applyOverrides(overrides) {
        this.settings = deepMergeSettings(this.settings, overrides);
    }
    /** Mark a global field as modified during this session */
    markModified(field, nestedKey) {
        this.modifiedFields.add(field);
        if (nestedKey) {
            if (!this.modifiedNestedFields.has(field)) {
                this.modifiedNestedFields.set(field, new Set());
            }
            this.modifiedNestedFields.get(field).add(nestedKey);
        }
    }
    /** Mark a project field as modified during this session */
    markProjectModified(field, nestedKey) {
        this.modifiedProjectFields.add(field);
        if (nestedKey) {
            if (!this.modifiedProjectNestedFields.has(field)) {
                this.modifiedProjectNestedFields.set(field, new Set());
            }
            this.modifiedProjectNestedFields.get(field).add(nestedKey);
        }
    }
    assertProjectTrustedForWrite() {
        if (!this.projectTrusted) {
            throw new Error("Project is not trusted; refusing to write project settings");
        }
    }
    recordError(scope, error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        this.errors.push({ scope, error: normalizedError });
    }
    clearModifiedScope(scope) {
        if (scope === "global") {
            this.modifiedFields.clear();
            this.modifiedNestedFields.clear();
            return;
        }
        this.modifiedProjectFields.clear();
        this.modifiedProjectNestedFields.clear();
    }
    enqueueWrite(scope, task) {
        this.writeQueue = this.writeQueue
            .then(() => {
            if (scope === "project") {
                this.assertProjectTrustedForWrite();
            }
            task();
            this.clearModifiedScope(scope);
        })
            .catch((error) => {
            this.recordError(scope, error);
        });
    }
    cloneModifiedNestedFields(source) {
        const snapshot = new Map();
        for (const [key, value] of source.entries()) {
            snapshot.set(key, new Set(value));
        }
        return snapshot;
    }
    persistScopedSettings(scope, snapshotSettings, modifiedFields, modifiedNestedFields) {
        this.storage.withLock(scope, (current) => {
            const currentFileSettings = current
                ? SettingsManager.migrateSettings(JSON.parse(current))
                : {};
            const mergedSettings = { ...currentFileSettings };
            for (const field of modifiedFields) {
                const value = snapshotSettings[field];
                if (modifiedNestedFields.has(field) && typeof value === "object" && value !== null) {
                    const nestedModified = modifiedNestedFields.get(field);
                    const baseNested = currentFileSettings[field] ?? {};
                    const inMemoryNested = value;
                    const mergedNested = { ...baseNested };
                    for (const nestedKey of nestedModified) {
                        mergedNested[nestedKey] = inMemoryNested[nestedKey];
                    }
                    mergedSettings[field] = mergedNested;
                }
                else {
                    mergedSettings[field] = value;
                }
            }
            return JSON.stringify(mergedSettings, null, 2);
        });
    }
    save() {
        this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
        if (this.globalSettingsLoadError) {
            return;
        }
        const snapshotGlobalSettings = structuredClone(this.globalSettings);
        const modifiedFields = new Set(this.modifiedFields);
        const modifiedNestedFields = this.cloneModifiedNestedFields(this.modifiedNestedFields);
        this.enqueueWrite("global", () => {
            this.persistScopedSettings("global", snapshotGlobalSettings, modifiedFields, modifiedNestedFields);
        });
    }
    saveProjectSettings(settings) {
        this.assertProjectTrustedForWrite();
        this.projectSettings = structuredClone(settings);
        this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
        if (this.projectSettingsLoadError) {
            return;
        }
        const snapshotProjectSettings = structuredClone(this.projectSettings);
        const modifiedFields = new Set(this.modifiedProjectFields);
        const modifiedNestedFields = this.cloneModifiedNestedFields(this.modifiedProjectNestedFields);
        this.enqueueWrite("project", () => {
            this.persistScopedSettings("project", snapshotProjectSettings, modifiedFields, modifiedNestedFields);
        });
    }
    updateProjectSettings(field, update) {
        this.assertProjectTrustedForWrite();
        const projectSettings = structuredClone(this.projectSettings);
        update(projectSettings);
        this.markProjectModified(field);
        this.saveProjectSettings(projectSettings);
    }
    async flush() {
        await this.writeQueue;
    }
    drainErrors() {
        const drained = [...this.errors];
        this.errors = [];
        return drained;
    }
    getLastChangelogVersion() {
        return this.settings.lastChangelogVersion;
    }
    setLastChangelogVersion(version) {
        this.globalSettings.lastChangelogVersion = version;
        this.markModified("lastChangelogVersion");
        this.save();
    }
    getSessionDir() {
        const sessionDir = this.settings.sessionDir;
        return sessionDir ? normalizePath(sessionDir) : sessionDir;
    }
    getDefaultProvider() {
        return this.settings.defaultProvider;
    }
    getDefaultModel() {
        return this.settings.defaultModel;
    }
    setDefaultProvider(provider) {
        this.globalSettings.defaultProvider = provider;
        this.markModified("defaultProvider");
        this.save();
    }
    setDefaultModel(modelId) {
        this.globalSettings.defaultModel = modelId;
        this.markModified("defaultModel");
        this.save();
    }
    setDefaultModelAndProvider(provider, modelId) {
        this.globalSettings.defaultProvider = provider;
        this.globalSettings.defaultModel = modelId;
        this.markModified("defaultProvider");
        this.markModified("defaultModel");
        this.save();
    }
    getSteeringMode() {
        return this.settings.steeringMode || "one-at-a-time";
    }
    setSteeringMode(mode) {
        this.globalSettings.steeringMode = mode;
        this.markModified("steeringMode");
        this.save();
    }
    getFollowUpMode() {
        return this.settings.followUpMode || "one-at-a-time";
    }
    setFollowUpMode(mode) {
        this.globalSettings.followUpMode = mode;
        this.markModified("followUpMode");
        this.save();
    }
    getThemeSetting() {
        const value = this.settings.theme;
        if (typeof value === "string")
            return value;
        return undefined;
    }
    getTheme() {
        const theme = this.getThemeSetting();
        return theme?.includes("/") ? undefined : theme;
    }
    setTheme(theme) {
        this.globalSettings.theme = theme;
        this.markModified("theme");
        this.save();
    }
    getDefaultThinkingLevel() {
        return this.settings.defaultThinkingLevel;
    }
    setDefaultThinkingLevel(level) {
        this.globalSettings.defaultThinkingLevel = level;
        this.markModified("defaultThinkingLevel");
        this.save();
    }
    getTransport() {
        return this.settings.transport ?? "auto";
    }
    setTransport(transport) {
        this.globalSettings.transport = transport;
        this.markModified("transport");
        this.save();
    }
    getCompactionEnabled() {
        return this.settings.compaction?.enabled ?? true;
    }
    setCompactionEnabled(enabled) {
        if (!this.globalSettings.compaction) {
            this.globalSettings.compaction = {};
        }
        this.globalSettings.compaction.enabled = enabled;
        this.markModified("compaction", "enabled");
        this.save();
    }
    getCompactionReserveTokens() {
        return this.settings.compaction?.reserveTokens ?? 16384;
    }
    getCompactionKeepRecentTokens() {
        return this.settings.compaction?.keepRecentTokens ?? 20000;
    }
    getCompactionSettings() {
        return {
            enabled: this.getCompactionEnabled(),
            reserveTokens: this.getCompactionReserveTokens(),
            keepRecentTokens: this.getCompactionKeepRecentTokens(),
        };
    }
    getBranchSummarySettings() {
        return {
            reserveTokens: this.settings.branchSummary?.reserveTokens ?? 16384,
            skipPrompt: this.settings.branchSummary?.skipPrompt ?? false,
        };
    }
    getBranchSummarySkipPrompt() {
        return this.settings.branchSummary?.skipPrompt ?? false;
    }
    getRetryEnabled() {
        return this.settings.retry?.enabled ?? true;
    }
    setRetryEnabled(enabled) {
        if (!this.globalSettings.retry) {
            this.globalSettings.retry = {};
        }
        this.globalSettings.retry.enabled = enabled;
        this.markModified("retry", "enabled");
        this.save();
    }
    getRetrySettings() {
        return {
            enabled: this.getRetryEnabled(),
            maxRetries: this.settings.retry?.maxRetries ?? 3,
            baseDelayMs: this.settings.retry?.baseDelayMs ?? 2000,
        };
    }
    getHttpIdleTimeoutMs() {
        return parseTimeoutSetting(this.settings.httpIdleTimeoutMs, "httpIdleTimeoutMs") ?? DEFAULT_HTTP_IDLE_TIMEOUT_MS;
    }
    setHttpIdleTimeoutMs(timeoutMs) {
        if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
            throw new Error(`Invalid httpIdleTimeoutMs setting: ${String(timeoutMs)}`);
        }
        this.globalSettings.httpIdleTimeoutMs = Math.floor(timeoutMs);
        this.markModified("httpIdleTimeoutMs");
        this.save();
    }
    getProviderRetrySettings() {
        return {
            timeoutMs: this.settings.retry?.provider?.timeoutMs,
            maxRetries: this.settings.retry?.provider?.maxRetries,
            maxRetryDelayMs: this.settings.retry?.provider?.maxRetryDelayMs ?? 60000,
        };
    }
    getWebSocketConnectTimeoutMs() {
        return parseTimeoutSetting(this.settings.websocketConnectTimeoutMs, "websocketConnectTimeoutMs");
    }
    getHideThinkingBlock() {
        return this.settings.hideThinkingBlock ?? false;
    }
    getExternalEditorCommand() {
        const configuredEditor = this.settings.externalEditor;
        if (typeof configuredEditor === "string" && configuredEditor.trim() !== "") {
            return configuredEditor;
        }
        const environmentEditor = process.env.VISUAL || process.env.EDITOR;
        if (environmentEditor) {
            return environmentEditor;
        }
        return process.platform === "win32" ? "notepad" : "nano";
    }
    setHideThinkingBlock(hide) {
        this.globalSettings.hideThinkingBlock = hide;
        this.markModified("hideThinkingBlock");
        this.save();
    }
    getShellPath() {
        return this.settings.shellPath;
    }
    setShellPath(path) {
        this.globalSettings.shellPath = path;
        this.markModified("shellPath");
        this.save();
    }
    getQuietStartup() {
        return this.settings.quietStartup ?? false;
    }
    setQuietStartup(quiet) {
        this.globalSettings.quietStartup = quiet;
        this.markModified("quietStartup");
        this.save();
    }
    getDefaultProjectTrust() {
        const value = this.globalSettings.defaultProjectTrust;
        return value === "always" || value === "never" ? value : "ask";
    }
    setDefaultProjectTrust(defaultProjectTrust) {
        this.globalSettings.defaultProjectTrust = defaultProjectTrust;
        this.markModified("defaultProjectTrust");
        this.save();
    }
    getShellCommandPrefix() {
        return this.settings.shellCommandPrefix;
    }
    setShellCommandPrefix(prefix) {
        this.globalSettings.shellCommandPrefix = prefix;
        this.markModified("shellCommandPrefix");
        this.save();
    }
    getNpmCommand() {
        return this.settings.npmCommand ? [...this.settings.npmCommand] : undefined;
    }
    setNpmCommand(command) {
        this.globalSettings.npmCommand = command ? [...command] : undefined;
        this.markModified("npmCommand");
        this.save();
    }
    getCollapseChangelog() {
        return this.settings.collapseChangelog ?? false;
    }
    setCollapseChangelog(collapse) {
        this.globalSettings.collapseChangelog = collapse;
        this.markModified("collapseChangelog");
        this.save();
    }
    getEnableInstallTelemetry() {
        return this.settings.enableInstallTelemetry ?? true;
    }
    setEnableInstallTelemetry(enabled) {
        this.globalSettings.enableInstallTelemetry = enabled;
        this.markModified("enableInstallTelemetry");
        this.save();
    }
    getEnableAnalytics() {
        return this.settings.enableAnalytics ?? false;
    }
    getTrackingId() {
        return this.settings.trackingId;
    }
    /** Set the analytics opt-in preference; generates a tracking identifier on first opt-in */
    setEnableAnalytics(enabled) {
        this.globalSettings.enableAnalytics = enabled;
        this.markModified("enableAnalytics");
        if (enabled && !this.globalSettings.trackingId) {
            this.globalSettings.trackingId = randomUUID();
            this.markModified("trackingId");
        }
        this.save();
    }
    getPackages() {
        return [...(this.settings.packages ?? [])];
    }
    setPackages(packages) {
        this.globalSettings.packages = packages;
        this.markModified("packages");
        this.save();
    }
    setProjectPackages(packages) {
        this.updateProjectSettings("packages", (settings) => {
            settings.packages = packages;
        });
    }
    getExtensionPaths() {
        return [...(this.settings.extensions ?? [])];
    }
    setExtensionPaths(paths) {
        this.globalSettings.extensions = paths;
        this.markModified("extensions");
        this.save();
    }
    setProjectExtensionPaths(paths) {
        this.updateProjectSettings("extensions", (settings) => {
            settings.extensions = paths;
        });
    }
    getSkillPaths() {
        return [...(this.settings.skills ?? [])];
    }
    setSkillPaths(paths) {
        this.globalSettings.skills = paths;
        this.markModified("skills");
        this.save();
    }
    setProjectSkillPaths(paths) {
        this.updateProjectSettings("skills", (settings) => {
            settings.skills = paths;
        });
    }
    getPromptTemplatePaths() {
        return [...(this.settings.prompts ?? [])];
    }
    setPromptTemplatePaths(paths) {
        this.globalSettings.prompts = paths;
        this.markModified("prompts");
        this.save();
    }
    setProjectPromptTemplatePaths(paths) {
        this.updateProjectSettings("prompts", (settings) => {
            settings.prompts = paths;
        });
    }
    getThemePaths() {
        return [...(this.settings.themes ?? [])];
    }
    setThemePaths(paths) {
        this.globalSettings.themes = paths;
        this.markModified("themes");
        this.save();
    }
    setProjectThemePaths(paths) {
        this.updateProjectSettings("themes", (settings) => {
            settings.themes = paths;
        });
    }
    getEnableSkillCommands() {
        return this.settings.enableSkillCommands ?? true;
    }
    setEnableSkillCommands(enabled) {
        this.globalSettings.enableSkillCommands = enabled;
        this.markModified("enableSkillCommands");
        this.save();
    }
    getThinkingBudgets() {
        return this.settings.thinkingBudgets;
    }
    getShowImages() {
        return this.settings.terminal?.showImages ?? true;
    }
    setShowImages(show) {
        if (!this.globalSettings.terminal) {
            this.globalSettings.terminal = {};
        }
        this.globalSettings.terminal.showImages = show;
        this.markModified("terminal", "showImages");
        this.save();
    }
    getImageWidthCells() {
        const width = this.settings.terminal?.imageWidthCells;
        if (typeof width !== "number" || !Number.isFinite(width)) {
            return 60;
        }
        return Math.max(1, Math.floor(width));
    }
    setImageWidthCells(width) {
        if (!this.globalSettings.terminal) {
            this.globalSettings.terminal = {};
        }
        this.globalSettings.terminal.imageWidthCells = Math.max(1, Math.floor(width));
        this.markModified("terminal", "imageWidthCells");
        this.save();
    }
    getClearOnShrink() {
        // Settings takes precedence, then env var, then default false
        if (this.settings.terminal?.clearOnShrink !== undefined) {
            return this.settings.terminal.clearOnShrink;
        }
        return process.env.PI_CLEAR_ON_SHRINK === "1";
    }
    setClearOnShrink(enabled) {
        if (!this.globalSettings.terminal) {
            this.globalSettings.terminal = {};
        }
        this.globalSettings.terminal.clearOnShrink = enabled;
        this.markModified("terminal", "clearOnShrink");
        this.save();
    }
    getShowTerminalProgress() {
        return this.settings.terminal?.showTerminalProgress ?? false;
    }
    setShowTerminalProgress(enabled) {
        if (!this.globalSettings.terminal) {
            this.globalSettings.terminal = {};
        }
        this.globalSettings.terminal.showTerminalProgress = enabled;
        this.markModified("terminal", "showTerminalProgress");
        this.save();
    }
    getImageAutoResize() {
        return this.settings.images?.autoResize ?? true;
    }
    setImageAutoResize(enabled) {
        if (!this.globalSettings.images) {
            this.globalSettings.images = {};
        }
        this.globalSettings.images.autoResize = enabled;
        this.markModified("images", "autoResize");
        this.save();
    }
    getBlockImages() {
        return this.settings.images?.blockImages ?? false;
    }
    setBlockImages(blocked) {
        if (!this.globalSettings.images) {
            this.globalSettings.images = {};
        }
        this.globalSettings.images.blockImages = blocked;
        this.markModified("images", "blockImages");
        this.save();
    }
    getEnabledModels() {
        return this.settings.enabledModels;
    }
    setEnabledModels(patterns) {
        this.globalSettings.enabledModels = patterns;
        this.markModified("enabledModels");
        this.save();
    }
    getDoubleEscapeAction() {
        return this.settings.doubleEscapeAction ?? "tree";
    }
    setDoubleEscapeAction(action) {
        this.globalSettings.doubleEscapeAction = action;
        this.markModified("doubleEscapeAction");
        this.save();
    }
    getTreeFilterMode() {
        const mode = this.settings.treeFilterMode;
        const valid = ["default", "no-tools", "user-only", "labeled-only", "all"];
        return mode && valid.includes(mode) ? mode : "default";
    }
    setTreeFilterMode(mode) {
        this.globalSettings.treeFilterMode = mode;
        this.markModified("treeFilterMode");
        this.save();
    }
    getShowHardwareCursor() {
        return this.settings.showHardwareCursor ?? process.env.PI_HARDWARE_CURSOR === "1";
    }
    setShowHardwareCursor(enabled) {
        this.globalSettings.showHardwareCursor = enabled;
        this.markModified("showHardwareCursor");
        this.save();
    }
    getEditorPaddingX() {
        return this.settings.editorPaddingX ?? 0;
    }
    setEditorPaddingX(padding) {
        this.globalSettings.editorPaddingX = Math.max(0, Math.min(3, Math.floor(padding)));
        this.markModified("editorPaddingX");
        this.save();
    }
    getOutputPad() {
        return this.settings.outputPad === 0 ? 0 : 1;
    }
    setOutputPad(padding) {
        this.globalSettings.outputPad = padding;
        this.markModified("outputPad");
        this.save();
    }
    getAutocompleteMaxVisible() {
        return this.settings.autocompleteMaxVisible ?? 5;
    }
    setAutocompleteMaxVisible(maxVisible) {
        this.globalSettings.autocompleteMaxVisible = Math.max(3, Math.min(20, Math.floor(maxVisible)));
        this.markModified("autocompleteMaxVisible");
        this.save();
    }
    getCodeBlockIndent() {
        return this.settings.markdown?.codeBlockIndent ?? "  ";
    }
    getWarnings() {
        return { ...(this.settings.warnings ?? {}) };
    }
    setWarnings(warnings) {
        this.globalSettings.warnings = { ...warnings };
        this.markModified("warnings");
        this.save();
    }
}
//# sourceMappingURL=settings-manager.js.map