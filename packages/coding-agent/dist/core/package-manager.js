import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
function getEnv() {
    if (process.platform !== "linux" || Object.keys(process.env).length > 0) {
        return process.env;
    }
    try {
        const data = readFileSync("/proc/self/environ", "utf-8");
        const env = {};
        for (const entry of data.split("\0")) {
            const idx = entry.indexOf("=");
            if (idx > 0) {
                env[entry.slice(0, idx)] = entry.slice(idx + 1);
            }
        }
        return env;
    }
    catch {
        return process.env;
    }
}
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { globSync } from "glob";
import ignore from "ignore";
import { minimatch } from "minimatch";
import { maxSatisfying, rcompare, satisfies, valid, validRange } from "semver";
import { CONFIG_DIR_NAME } from "../config.js";
import { spawnProcess, spawnProcessSync } from "../utils/child-process.js";
import { parseGitUrl } from "../utils/git.js";
import { canonicalizePath, isLocalPath, markPathIgnoredByCloudSync, resolvePath } from "../utils/paths.js";
import { isStdoutTakenOver } from "./output-guard.js";
const NETWORK_TIMEOUT_MS = 10000;
const UPDATE_CHECK_CONCURRENCY = 4;
const GIT_UPDATE_CONCURRENCY = 4;
function isOfflineModeEnabled() {
    const value = process.env.PI_OFFLINE;
    if (!value)
        return false;
    return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}
function isExactNpmVersion(version) {
    return valid(version ?? "") !== null;
}
function getNpmVersionRange(version) {
    return version ? (validRange(version) ?? undefined) : undefined;
}
/**
 * Compute a numeric precedence rank for a resource based on its metadata.
 * Lower rank = higher precedence. Used to sort resolved resources so that
 * name-collision resolution ("first wins") produces the correct outcome.
 *
 * Precedence (highest to lowest):
 *   0  project + settings entry (source: "local", scope: "project")
 *   1  project + auto-discovered (source: "auto", scope: "project")
 *   2  user + settings entry (source: "local", scope: "user")
 *   3  user + auto-discovered (source: "auto", scope: "user")
 *   4  package resource (origin: "package")
 */
function resourcePrecedenceRank(m) {
    if (m.origin === "package")
        return 4;
    const scopeBase = m.scope === "project" ? 0 : 2;
    return scopeBase + (m.source === "local" ? 0 : 1);
}
const RESOURCE_TYPES = ["extensions", "skills", "prompts", "themes"];
const FILE_PATTERNS = {
    extensions: /\.(ts|js)$/,
    skills: /\.md$/,
    prompts: /\.md$/,
    themes: /\.json$/,
};
const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"];
function toPosixPath(p) {
    return p.split(sep).join("/");
}
function getHomeDir() {
    return process.env.HOME || homedir();
}
export function getExtensionTempFolder(agentDir) {
    const tempFolder = join(agentDir, "tmp", "extensions");
    mkdirSync(tempFolder, { recursive: true, mode: 0o700 });
    chmodSync(tempFolder, 0o700);
    return tempFolder;
}
function prefixIgnorePattern(line, prefix) {
    const trimmed = line.trim();
    if (!trimmed)
        return null;
    if (trimmed.startsWith("#") && !trimmed.startsWith("\\#"))
        return null;
    let pattern = line;
    let negated = false;
    if (pattern.startsWith("!")) {
        negated = true;
        pattern = pattern.slice(1);
    }
    else if (pattern.startsWith("\\!")) {
        pattern = pattern.slice(1);
    }
    if (pattern.startsWith("/")) {
        pattern = pattern.slice(1);
    }
    const prefixed = prefix ? `${prefix}${pattern}` : pattern;
    return negated ? `!${prefixed}` : prefixed;
}
function addIgnoreRules(ig, dir, rootDir) {
    const relativeDir = relative(rootDir, dir);
    const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : "";
    for (const filename of IGNORE_FILE_NAMES) {
        const ignorePath = join(dir, filename);
        if (!existsSync(ignorePath))
            continue;
        try {
            const content = readFileSync(ignorePath, "utf-8");
            const patterns = content
                .split(/\r?\n/)
                .map((line) => prefixIgnorePattern(line, prefix))
                .filter((line) => Boolean(line));
            if (patterns.length > 0) {
                ig.add(patterns);
            }
        }
        catch { }
    }
}
function isPattern(s) {
    return s.startsWith("!") || s.startsWith("+") || s.startsWith("-") || s.includes("*") || s.includes("?");
}
function isOverridePattern(s) {
    return s.startsWith("!") || s.startsWith("+") || s.startsWith("-");
}
function hasGlobPattern(s) {
    return s.includes("*") || s.includes("?");
}
function splitPatterns(entries) {
    const plain = [];
    const patterns = [];
    for (const entry of entries) {
        if (isPattern(entry)) {
            patterns.push(entry);
        }
        else {
            plain.push(entry);
        }
    }
    return { plain, patterns };
}
function collectFiles(dir, filePattern, skipNodeModules = true, ignoreMatcher, rootDir) {
    const files = [];
    if (!existsSync(dir))
        return files;
    const root = rootDir ?? dir;
    const ig = ignoreMatcher ?? ignore();
    addIgnoreRules(ig, dir, root);
    try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith("."))
                continue;
            if (skipNodeModules && entry.name === "node_modules")
                continue;
            const fullPath = join(dir, entry.name);
            let isDir = entry.isDirectory();
            let isFile = entry.isFile();
            if (entry.isSymbolicLink()) {
                try {
                    const stats = statSync(fullPath);
                    isDir = stats.isDirectory();
                    isFile = stats.isFile();
                }
                catch {
                    continue;
                }
            }
            const relPath = toPosixPath(relative(root, fullPath));
            const ignorePath = isDir ? `${relPath}/` : relPath;
            if (ig.ignores(ignorePath))
                continue;
            if (isDir) {
                files.push(...collectFiles(fullPath, filePattern, skipNodeModules, ig, root));
            }
            else if (isFile && filePattern.test(entry.name)) {
                files.push(fullPath);
            }
        }
    }
    catch {
        // Ignore errors
    }
    return files;
}
function collectSkillEntries(dir, mode, ignoreMatcher, rootDir) {
    const entries = [];
    if (!existsSync(dir))
        return entries;
    const root = rootDir ?? dir;
    const ig = ignoreMatcher ?? ignore();
    addIgnoreRules(ig, dir, root);
    try {
        const dirEntries = readdirSync(dir, { withFileTypes: true });
        for (const entry of dirEntries) {
            if (entry.name !== "SKILL.md") {
                continue;
            }
            const fullPath = join(dir, entry.name);
            let isFile = entry.isFile();
            if (entry.isSymbolicLink()) {
                try {
                    isFile = statSync(fullPath).isFile();
                }
                catch {
                    continue;
                }
            }
            const relPath = toPosixPath(relative(root, fullPath));
            if (isFile && !ig.ignores(relPath)) {
                entries.push(fullPath);
                return entries;
            }
        }
        for (const entry of dirEntries) {
            if (entry.name.startsWith("."))
                continue;
            if (entry.name === "node_modules")
                continue;
            const fullPath = join(dir, entry.name);
            let isDir = entry.isDirectory();
            let isFile = entry.isFile();
            if (entry.isSymbolicLink()) {
                try {
                    const stats = statSync(fullPath);
                    isDir = stats.isDirectory();
                    isFile = stats.isFile();
                }
                catch {
                    continue;
                }
            }
            const relPath = toPosixPath(relative(root, fullPath));
            if (mode === "pi" && dir === root && isFile && entry.name.endsWith(".md") && !ig.ignores(relPath)) {
                entries.push(fullPath);
                continue;
            }
            if (!isDir)
                continue;
            if (ig.ignores(`${relPath}/`))
                continue;
            entries.push(...collectSkillEntries(fullPath, mode, ig, root));
        }
    }
    catch {
        // Ignore errors
    }
    return entries;
}
function collectAutoSkillEntries(dir, mode) {
    return collectSkillEntries(dir, mode);
}
function findGitRepoRoot(startDir) {
    let dir = resolve(startDir);
    while (true) {
        if (existsSync(join(dir, ".git"))) {
            return dir;
        }
        const parent = dirname(dir);
        if (parent === dir) {
            return null;
        }
        dir = parent;
    }
}
function collectAncestorAgentsSkillDirs(startDir) {
    const skillDirs = [];
    const resolvedStartDir = resolve(startDir);
    const gitRepoRoot = findGitRepoRoot(resolvedStartDir);
    let dir = resolvedStartDir;
    while (true) {
        skillDirs.push(join(dir, ".agents", "skills"));
        if (gitRepoRoot && dir === gitRepoRoot) {
            break;
        }
        const parent = dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }
    return skillDirs;
}
function collectAutoPromptEntries(dir) {
    const entries = [];
    if (!existsSync(dir))
        return entries;
    const ig = ignore();
    addIgnoreRules(ig, dir, dir);
    try {
        const dirEntries = readdirSync(dir, { withFileTypes: true });
        for (const entry of dirEntries) {
            if (entry.name.startsWith("."))
                continue;
            if (entry.name === "node_modules")
                continue;
            const fullPath = join(dir, entry.name);
            let isFile = entry.isFile();
            if (entry.isSymbolicLink()) {
                try {
                    isFile = statSync(fullPath).isFile();
                }
                catch {
                    continue;
                }
            }
            const relPath = toPosixPath(relative(dir, fullPath));
            if (ig.ignores(relPath))
                continue;
            if (isFile && entry.name.endsWith(".md")) {
                entries.push(fullPath);
            }
        }
    }
    catch {
        // Ignore errors
    }
    return entries;
}
function collectAutoThemeEntries(dir) {
    const entries = [];
    if (!existsSync(dir))
        return entries;
    const ig = ignore();
    addIgnoreRules(ig, dir, dir);
    try {
        const dirEntries = readdirSync(dir, { withFileTypes: true });
        for (const entry of dirEntries) {
            if (entry.name.startsWith("."))
                continue;
            if (entry.name === "node_modules")
                continue;
            const fullPath = join(dir, entry.name);
            let isFile = entry.isFile();
            if (entry.isSymbolicLink()) {
                try {
                    isFile = statSync(fullPath).isFile();
                }
                catch {
                    continue;
                }
            }
            const relPath = toPosixPath(relative(dir, fullPath));
            if (ig.ignores(relPath))
                continue;
            if (isFile && entry.name.endsWith(".json")) {
                entries.push(fullPath);
            }
        }
    }
    catch {
        // Ignore errors
    }
    return entries;
}
function readPiManifestFile(packageJsonPath) {
    try {
        const content = readFileSync(packageJsonPath, "utf-8");
        const pkg = JSON.parse(content);
        return pkg.pi ?? null;
    }
    catch {
        return null;
    }
}
function resolveExtensionEntries(dir) {
    const packageJsonPath = join(dir, "package.json");
    if (existsSync(packageJsonPath)) {
        const manifest = readPiManifestFile(packageJsonPath);
        if (manifest?.extensions?.length) {
            const entries = [];
            for (const extPath of manifest.extensions) {
                const resolvedExtPath = resolve(dir, extPath);
                if (existsSync(resolvedExtPath)) {
                    entries.push(resolvedExtPath);
                }
            }
            if (entries.length > 0) {
                return entries;
            }
        }
    }
    const indexTs = join(dir, "index.ts");
    const indexJs = join(dir, "index.js");
    if (existsSync(indexTs)) {
        return [indexTs];
    }
    if (existsSync(indexJs)) {
        return [indexJs];
    }
    return null;
}
function collectAutoExtensionEntries(dir) {
    const entries = [];
    if (!existsSync(dir))
        return entries;
    // First check if this directory itself has explicit extension entries (package.json or index)
    const rootEntries = resolveExtensionEntries(dir);
    if (rootEntries) {
        return rootEntries;
    }
    // Otherwise, discover extensions from directory contents
    const ig = ignore();
    addIgnoreRules(ig, dir, dir);
    try {
        const dirEntries = readdirSync(dir, { withFileTypes: true });
        for (const entry of dirEntries) {
            if (entry.name.startsWith("."))
                continue;
            if (entry.name === "node_modules")
                continue;
            const fullPath = join(dir, entry.name);
            let isDir = entry.isDirectory();
            let isFile = entry.isFile();
            if (entry.isSymbolicLink()) {
                try {
                    const stats = statSync(fullPath);
                    isDir = stats.isDirectory();
                    isFile = stats.isFile();
                }
                catch {
                    continue;
                }
            }
            const relPath = toPosixPath(relative(dir, fullPath));
            const ignorePath = isDir ? `${relPath}/` : relPath;
            if (ig.ignores(ignorePath))
                continue;
            if (isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
                entries.push(fullPath);
            }
            else if (isDir) {
                const resolvedEntries = resolveExtensionEntries(fullPath);
                if (resolvedEntries) {
                    entries.push(...resolvedEntries);
                }
            }
        }
    }
    catch {
        // Ignore errors
    }
    return entries;
}
/**
 * Collect resource files from a directory based on resource type.
 * Extensions use smart discovery (index.ts in subdirs), others use recursive collection.
 */
function collectResourceFiles(dir, resourceType) {
    if (resourceType === "skills") {
        return collectSkillEntries(dir, "pi");
    }
    if (resourceType === "extensions") {
        return collectAutoExtensionEntries(dir);
    }
    return collectFiles(dir, FILE_PATTERNS[resourceType]);
}
function matchesAnyPattern(filePath, patterns, baseDir) {
    const rel = toPosixPath(relative(baseDir, filePath));
    const name = basename(filePath);
    const filePathPosix = toPosixPath(filePath);
    const isSkillFile = name === "SKILL.md";
    const parentDir = isSkillFile ? dirname(filePath) : undefined;
    const parentRel = isSkillFile ? toPosixPath(relative(baseDir, parentDir)) : undefined;
    const parentName = isSkillFile ? basename(parentDir) : undefined;
    const parentDirPosix = isSkillFile ? toPosixPath(parentDir) : undefined;
    return patterns.some((pattern) => {
        const normalizedPattern = toPosixPath(pattern);
        if (minimatch(rel, normalizedPattern) ||
            minimatch(name, normalizedPattern) ||
            minimatch(filePathPosix, normalizedPattern)) {
            return true;
        }
        if (!isSkillFile)
            return false;
        return (minimatch(parentRel, normalizedPattern) ||
            minimatch(parentName, normalizedPattern) ||
            minimatch(parentDirPosix, normalizedPattern));
    });
}
function normalizeExactPattern(pattern) {
    const normalized = pattern.startsWith("./") || pattern.startsWith(".\\") ? pattern.slice(2) : pattern;
    return toPosixPath(normalized);
}
function matchesAnyExactPattern(filePath, patterns, baseDir) {
    if (patterns.length === 0)
        return false;
    const rel = toPosixPath(relative(baseDir, filePath));
    const name = basename(filePath);
    const filePathPosix = toPosixPath(filePath);
    const isSkillFile = name === "SKILL.md";
    const parentDir = isSkillFile ? dirname(filePath) : undefined;
    const parentRel = isSkillFile ? toPosixPath(relative(baseDir, parentDir)) : undefined;
    const parentDirPosix = isSkillFile ? toPosixPath(parentDir) : undefined;
    return patterns.some((pattern) => {
        const normalized = normalizeExactPattern(pattern);
        if (normalized === rel || normalized === filePathPosix) {
            return true;
        }
        if (!isSkillFile)
            return false;
        return normalized === parentRel || normalized === parentDirPosix;
    });
}
function getOverridePatterns(entries) {
    return entries.filter((pattern) => pattern.startsWith("!") || pattern.startsWith("+") || pattern.startsWith("-"));
}
function isEnabledByOverrides(filePath, patterns, baseDir) {
    const overrides = getOverridePatterns(patterns);
    const excludes = overrides.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));
    const forceIncludes = overrides.filter((pattern) => pattern.startsWith("+")).map((pattern) => pattern.slice(1));
    const forceExcludes = overrides.filter((pattern) => pattern.startsWith("-")).map((pattern) => pattern.slice(1));
    let enabled = true;
    if (excludes.length > 0 && matchesAnyPattern(filePath, excludes, baseDir)) {
        enabled = false;
    }
    if (forceIncludes.length > 0 && matchesAnyExactPattern(filePath, forceIncludes, baseDir)) {
        enabled = true;
    }
    if (forceExcludes.length > 0 && matchesAnyExactPattern(filePath, forceExcludes, baseDir)) {
        enabled = false;
    }
    return enabled;
}
/**
 * Apply patterns to paths and return a Set of enabled paths.
 * Pattern types:
 * - Plain patterns: include matching paths
 * - `!pattern`: exclude matching paths
 * - `+path`: force-include exact path (overrides exclusions)
 * - `-path`: force-exclude exact path (overrides force-includes)
 */
function applyPatterns(allPaths, patterns, baseDir) {
    const includes = [];
    const excludes = [];
    const forceIncludes = [];
    const forceExcludes = [];
    for (const p of patterns) {
        if (p.startsWith("+")) {
            forceIncludes.push(p.slice(1));
        }
        else if (p.startsWith("-")) {
            forceExcludes.push(p.slice(1));
        }
        else if (p.startsWith("!")) {
            excludes.push(p.slice(1));
        }
        else {
            includes.push(p);
        }
    }
    // Step 1: Apply includes (or all if no includes)
    let result;
    if (includes.length === 0) {
        result = [...allPaths];
    }
    else {
        result = allPaths.filter((filePath) => matchesAnyPattern(filePath, includes, baseDir));
    }
    // Step 2: Apply excludes
    if (excludes.length > 0) {
        result = result.filter((filePath) => !matchesAnyPattern(filePath, excludes, baseDir));
    }
    // Step 3: Force-include (add back from allPaths, overriding exclusions)
    if (forceIncludes.length > 0) {
        for (const filePath of allPaths) {
            if (!result.includes(filePath) && matchesAnyExactPattern(filePath, forceIncludes, baseDir)) {
                result.push(filePath);
            }
        }
    }
    // Step 4: Force-exclude (remove even if included or force-included)
    if (forceExcludes.length > 0) {
        result = result.filter((filePath) => !matchesAnyExactPattern(filePath, forceExcludes, baseDir));
    }
    return new Set(result);
}
export class DefaultPackageManager {
    cwd;
    agentDir;
    settingsManager;
    globalNpmRoot;
    globalNpmRootCommandKey;
    progressCallback;
    constructor(options) {
        this.cwd = resolvePath(options.cwd);
        this.agentDir = resolvePath(options.agentDir);
        this.settingsManager = options.settingsManager;
    }
    setProgressCallback(callback) {
        this.progressCallback = callback;
    }
    addSourceToSettings(source, options) {
        const scope = options?.local ? "project" : "user";
        const currentSettings = scope === "project" ? this.settingsManager.getProjectSettings() : this.settingsManager.getGlobalSettings();
        const currentPackages = currentSettings.packages ?? [];
        const normalizedSource = this.normalizePackageSourceForSettings(source, scope);
        const matchIndex = currentPackages.findIndex((existing) => this.packageSourcesMatch(existing, source, scope));
        if (matchIndex !== -1) {
            const existing = currentPackages[matchIndex];
            if (this.getPackageSourceString(existing) === normalizedSource) {
                return false;
            }
            const nextPackages = [...currentPackages];
            nextPackages[matchIndex] =
                typeof existing === "string" ? normalizedSource : { ...existing, source: normalizedSource };
            if (scope === "project") {
                this.settingsManager.setProjectPackages(nextPackages);
            }
            else {
                this.settingsManager.setPackages(nextPackages);
            }
            return true;
        }
        const nextPackages = [...currentPackages, normalizedSource];
        if (scope === "project") {
            this.settingsManager.setProjectPackages(nextPackages);
        }
        else {
            this.settingsManager.setPackages(nextPackages);
        }
        return true;
    }
    removeSourceFromSettings(source, options) {
        const scope = options?.local ? "project" : "user";
        const currentSettings = scope === "project" ? this.settingsManager.getProjectSettings() : this.settingsManager.getGlobalSettings();
        const currentPackages = currentSettings.packages ?? [];
        const nextPackages = currentPackages.filter((existing) => !this.packageSourcesMatch(existing, source, scope));
        const changed = nextPackages.length !== currentPackages.length;
        if (!changed) {
            return false;
        }
        if (scope === "project") {
            this.settingsManager.setProjectPackages(nextPackages);
        }
        else {
            this.settingsManager.setPackages(nextPackages);
        }
        return true;
    }
    getInstalledPath(source, scope) {
        const parsed = this.parseSource(source);
        if (parsed.type === "npm") {
            const path = this.getNpmInstallPath(parsed, scope);
            return existsSync(path) ? path : undefined;
        }
        if (parsed.type === "git") {
            const path = this.getGitInstallPath(parsed, scope);
            return existsSync(path) ? path : undefined;
        }
        if (parsed.type === "local") {
            const baseDir = this.getBaseDirForScope(scope);
            const path = this.resolvePathFromBase(parsed.path, baseDir);
            return existsSync(path) ? path : undefined;
        }
        return undefined;
    }
    emitProgress(event) {
        this.progressCallback?.(event);
    }
    async withProgress(action, source, message, operation) {
        this.emitProgress({ type: "start", action, source, message });
        try {
            await operation();
            this.emitProgress({ type: "complete", action, source });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.emitProgress({ type: "error", action, source, message: errorMessage });
            throw error;
        }
    }
    async resolve(onMissing) {
        const accumulator = this.createAccumulator();
        const globalSettings = this.settingsManager.getGlobalSettings();
        const projectSettings = this.settingsManager.getProjectSettings();
        // Collect all packages with scope (project first so cwd resources win collisions)
        const allPackages = [];
        for (const pkg of projectSettings.packages ?? []) {
            allPackages.push({ pkg, scope: "project" });
        }
        for (const pkg of globalSettings.packages ?? []) {
            allPackages.push({ pkg, scope: "user" });
        }
        // Dedupe: project scope wins over global for same package identity
        const packageSources = this.dedupePackages(allPackages);
        await this.resolvePackageSources(packageSources, accumulator, onMissing);
        const globalBaseDir = this.agentDir;
        const projectBaseDir = join(this.cwd, CONFIG_DIR_NAME);
        for (const resourceType of RESOURCE_TYPES) {
            const target = this.getTargetMap(accumulator, resourceType);
            const globalEntries = (globalSettings[resourceType] ?? []);
            const projectEntries = (projectSettings[resourceType] ?? []);
            this.resolveLocalEntries(projectEntries, resourceType, target, {
                source: "local",
                scope: "project",
                origin: "top-level",
            }, projectBaseDir);
            this.resolveLocalEntries(globalEntries, resourceType, target, {
                source: "local",
                scope: "user",
                origin: "top-level",
            }, globalBaseDir);
        }
        this.addAutoDiscoveredResources(accumulator, globalSettings, projectSettings, globalBaseDir, projectBaseDir);
        return this.toResolvedPaths(accumulator);
    }
    async resolveExtensionSources(sources, options) {
        const accumulator = this.createAccumulator();
        const scope = options?.temporary ? "temporary" : options?.local ? "project" : "user";
        const packageSources = sources.map((source) => ({ pkg: source, scope }));
        await this.resolvePackageSources(packageSources, accumulator);
        return this.toResolvedPaths(accumulator);
    }
    listConfiguredPackages() {
        const globalSettings = this.settingsManager.getGlobalSettings();
        const projectSettings = this.settingsManager.getProjectSettings();
        const configuredPackages = [];
        for (const pkg of globalSettings.packages ?? []) {
            const source = typeof pkg === "string" ? pkg : pkg.source;
            configuredPackages.push({
                source,
                scope: "user",
                filtered: typeof pkg === "object",
                installedPath: this.getInstalledPath(source, "user"),
            });
        }
        for (const pkg of projectSettings.packages ?? []) {
            const source = typeof pkg === "string" ? pkg : pkg.source;
            configuredPackages.push({
                source,
                scope: "project",
                filtered: typeof pkg === "object",
                installedPath: this.getInstalledPath(source, "project"),
            });
        }
        return configuredPackages;
    }
    async install(source, options) {
        const parsed = this.parseSource(source);
        const scope = options?.local ? "project" : "user";
        this.assertProjectTrustedForScope(scope);
        await this.withProgress("install", source, `Installing ${source}...`, async () => {
            if (parsed.type === "npm") {
                await this.installNpm(parsed, scope, false);
                return;
            }
            if (parsed.type === "git") {
                await this.installGit(parsed, scope);
                return;
            }
            if (parsed.type === "local") {
                const resolved = this.resolvePath(parsed.path);
                if (!existsSync(resolved)) {
                    throw new Error(`Path does not exist: ${resolved}`);
                }
                return;
            }
            throw new Error(`Unsupported install source: ${source}`);
        });
    }
    async installAndPersist(source, options) {
        await this.install(source, options);
        this.addSourceToSettings(source, options);
    }
    async remove(source, options) {
        const parsed = this.parseSource(source);
        const scope = options?.local ? "project" : "user";
        this.assertProjectTrustedForScope(scope);
        await this.withProgress("remove", source, `Removing ${source}...`, async () => {
            if (parsed.type === "npm") {
                await this.uninstallNpm(parsed, scope);
                return;
            }
            if (parsed.type === "git") {
                await this.removeGit(parsed, scope);
                return;
            }
            if (parsed.type === "local") {
                return;
            }
            throw new Error(`Unsupported remove source: ${source}`);
        });
    }
    async removeAndPersist(source, options) {
        await this.remove(source, options);
        return this.removeSourceFromSettings(source, options);
    }
    async update(source) {
        const globalSettings = this.settingsManager.getGlobalSettings();
        const projectSettings = this.settingsManager.getProjectSettings();
        const identity = source ? this.getPackageIdentity(source) : undefined;
        let matched = false;
        const updateSources = [];
        for (const pkg of globalSettings.packages ?? []) {
            const sourceStr = typeof pkg === "string" ? pkg : pkg.source;
            if (identity && this.getPackageIdentity(sourceStr, "user") !== identity)
                continue;
            matched = true;
            updateSources.push({ source: sourceStr, scope: "user" });
        }
        for (const pkg of projectSettings.packages ?? []) {
            const sourceStr = typeof pkg === "string" ? pkg : pkg.source;
            if (identity && this.getPackageIdentity(sourceStr, "project") !== identity)
                continue;
            matched = true;
            updateSources.push({ source: sourceStr, scope: "project" });
        }
        if (source && !matched) {
            throw new Error(this.buildNoMatchingPackageMessage(source, [
                ...(globalSettings.packages ?? []),
                ...(projectSettings.packages ?? []),
            ]));
        }
        await this.updateConfiguredSources(updateSources);
    }
    async updateConfiguredSources(sources) {
        if (isOfflineModeEnabled() || sources.length === 0) {
            return;
        }
        const npmCandidates = [];
        const gitCandidates = [];
        for (const entry of sources) {
            const parsed = this.parseSource(entry.source);
            // Pinned npm versions are fixed. Pinned git refs are configured checkout targets,
            // so include them to reconcile an existing clone when the configured ref changes.
            if (parsed.type === "npm") {
                if (!parsed.pinned) {
                    npmCandidates.push({ ...entry, parsed });
                }
            }
            else if (parsed.type === "git") {
                gitCandidates.push({ ...entry, parsed });
            }
        }
        const npmCheckTasks = npmCandidates.map((entry) => async () => ({
            entry,
            shouldUpdate: await this.shouldUpdateNpmSource(entry.parsed, entry.scope),
        }));
        const npmCheckResults = await this.runWithConcurrency(npmCheckTasks, UPDATE_CHECK_CONCURRENCY);
        const userNpmUpdates = [];
        const projectNpmUpdates = [];
        for (const result of npmCheckResults) {
            if (!result.shouldUpdate) {
                continue;
            }
            if (result.entry.scope === "user") {
                userNpmUpdates.push(result.entry);
            }
            else {
                projectNpmUpdates.push(result.entry);
            }
        }
        const tasks = [];
        if (userNpmUpdates.length > 0) {
            tasks.push(this.updateNpmBatch(userNpmUpdates, "user"));
        }
        if (projectNpmUpdates.length > 0) {
            tasks.push(this.updateNpmBatch(projectNpmUpdates, "project"));
        }
        if (gitCandidates.length > 0) {
            const gitTasks = gitCandidates.map((entry) => async () => this.withProgress("update", entry.source, `Updating ${entry.source}...`, async () => {
                await this.updateGit(entry.parsed, entry.scope);
            }));
            tasks.push(this.runWithConcurrency(gitTasks, GIT_UPDATE_CONCURRENCY).then(() => { }));
        }
        await Promise.all(tasks);
    }
    async shouldUpdateNpmSource(source, scope) {
        const installedPath = this.getManagedNpmInstallPath(source, scope);
        const installedVersion = existsSync(installedPath) ? this.getInstalledNpmVersion(installedPath) : undefined;
        if (!installedVersion) {
            return true;
        }
        try {
            const targetVersion = await this.getLatestNpmVersion(source.version ? source.spec : source.name, source.range);
            return targetVersion !== installedVersion;
        }
        catch {
            // Preserve existing update behavior when version lookup fails.
            return true;
        }
    }
    async updateNpmBatch(sources, scope) {
        if (sources.length === 0) {
            return;
        }
        const sourceLabel = sources.length === 1 ? sources[0].source : `${scope} npm packages`;
        const message = sources.length === 1 ? `Updating ${sources[0].source}...` : `Updating ${scope} npm packages...`;
        const specs = sources.map((entry) => (entry.parsed.version ? entry.parsed.spec : `${entry.parsed.name}@latest`));
        await this.withProgress("update", sourceLabel, message, async () => {
            await this.installNpmBatch(specs, scope);
        });
    }
    async installNpmBatch(specs, scope) {
        const installRoot = this.getNpmInstallRoot(scope, false);
        this.ensureNpmProject(installRoot);
        await this.runNpmCommand(this.getNpmInstallArgs(specs, installRoot));
    }
    async checkForAvailableUpdates() {
        if (isOfflineModeEnabled()) {
            return [];
        }
        const globalSettings = this.settingsManager.getGlobalSettings();
        const projectSettings = this.settingsManager.getProjectSettings();
        const allPackages = [];
        for (const pkg of projectSettings.packages ?? []) {
            allPackages.push({ pkg, scope: "project" });
        }
        for (const pkg of globalSettings.packages ?? []) {
            allPackages.push({ pkg, scope: "user" });
        }
        const packageSources = this.dedupePackages(allPackages);
        const checks = packageSources
            .filter((entry) => entry.scope !== "temporary")
            .map((entry) => async () => {
            const source = typeof entry.pkg === "string" ? entry.pkg : entry.pkg.source;
            const parsed = this.parseSource(source);
            if (parsed.type === "local" || parsed.pinned) {
                return undefined;
            }
            if (parsed.type === "npm") {
                const installedPath = this.getNpmInstallPath(parsed, entry.scope);
                if (!existsSync(installedPath)) {
                    return undefined;
                }
                const hasUpdate = await this.npmHasAvailableUpdate(parsed, installedPath);
                if (!hasUpdate) {
                    return undefined;
                }
                return {
                    source,
                    displayName: parsed.name,
                    type: "npm",
                    scope: entry.scope,
                };
            }
            const installedPath = this.getGitInstallPath(parsed, entry.scope);
            if (!existsSync(installedPath)) {
                return undefined;
            }
            const hasUpdate = await this.gitHasAvailableUpdate(installedPath);
            if (!hasUpdate) {
                return undefined;
            }
            return {
                source,
                displayName: `${parsed.host}/${parsed.path}`,
                type: "git",
                scope: entry.scope,
            };
        });
        const results = await this.runWithConcurrency(checks, UPDATE_CHECK_CONCURRENCY);
        return results.filter((result) => result !== undefined);
    }
    async resolvePackageSources(sources, accumulator, onMissing) {
        for (const { pkg, scope } of sources) {
            const sourceStr = typeof pkg === "string" ? pkg : pkg.source;
            const filter = typeof pkg === "object" ? pkg : undefined;
            const parsed = this.parseSource(sourceStr);
            const metadata = { source: sourceStr, scope, origin: "package" };
            if (parsed.type === "local") {
                const baseDir = this.getBaseDirForScope(scope);
                this.resolveLocalExtensionSource(parsed, accumulator, filter, metadata, baseDir);
                continue;
            }
            const installMissing = async () => {
                if (isOfflineModeEnabled()) {
                    return false;
                }
                if (!onMissing) {
                    await this.installParsedSource(parsed, scope);
                    return true;
                }
                const action = await onMissing(sourceStr);
                if (action === "skip")
                    return false;
                if (action === "error")
                    throw new Error(`Missing source: ${sourceStr}`);
                await this.installParsedSource(parsed, scope);
                return true;
            };
            if (parsed.type === "npm") {
                let installedPath = this.getNpmInstallPath(parsed, scope);
                const needsInstall = !existsSync(installedPath) || !(await this.installedNpmMatchesConfiguredVersion(parsed, installedPath));
                if (needsInstall) {
                    const installed = await installMissing();
                    if (!installed)
                        continue;
                    installedPath = this.getNpmInstallPath(parsed, scope);
                }
                metadata.baseDir = installedPath;
                this.collectPackageResources(installedPath, accumulator, filter, metadata);
                continue;
            }
            if (parsed.type === "git") {
                const installedPath = this.getGitInstallPath(parsed, scope);
                if (!existsSync(installedPath)) {
                    const installed = await installMissing();
                    if (!installed)
                        continue;
                }
                else if (scope === "temporary" && !parsed.pinned && !isOfflineModeEnabled()) {
                    await this.refreshTemporaryGitSource(parsed, sourceStr);
                }
                metadata.baseDir = installedPath;
                this.collectPackageResources(installedPath, accumulator, filter, metadata);
            }
        }
    }
    resolveLocalExtensionSource(source, accumulator, filter, metadata, baseDir) {
        const resolved = this.resolvePathFromBase(source.path, baseDir);
        if (!existsSync(resolved)) {
            return;
        }
        try {
            const stats = statSync(resolved);
            if (stats.isFile()) {
                metadata.baseDir = dirname(resolved);
                this.addResource(accumulator.extensions, resolved, metadata, true);
                return;
            }
            if (stats.isDirectory()) {
                metadata.baseDir = resolved;
                const resources = this.collectPackageResources(resolved, accumulator, filter, metadata);
                if (!resources) {
                    this.addResource(accumulator.extensions, resolved, metadata, true);
                }
            }
        }
        catch {
            return;
        }
    }
    async installParsedSource(parsed, scope) {
        if (parsed.type === "npm") {
            await this.installNpm(parsed, scope, scope === "temporary");
            return;
        }
        if (parsed.type === "git") {
            await this.installGit(parsed, scope);
            return;
        }
    }
    getPackageSourceString(pkg) {
        return typeof pkg === "string" ? pkg : pkg.source;
    }
    getSourceMatchKeyForInput(source) {
        const parsed = this.parseSource(source);
        if (parsed.type === "npm") {
            return `npm:${parsed.name}`;
        }
        if (parsed.type === "git") {
            return `git:${parsed.host}/${parsed.path}`;
        }
        return `local:${this.resolvePath(parsed.path)}`;
    }
    getSourceMatchKeyForSettings(source, scope) {
        const parsed = this.parseSource(source);
        if (parsed.type === "npm") {
            return `npm:${parsed.name}`;
        }
        if (parsed.type === "git") {
            return `git:${parsed.host}/${parsed.path}`;
        }
        const baseDir = this.getBaseDirForScope(scope);
        return `local:${this.resolvePathFromBase(parsed.path, baseDir)}`;
    }
    buildNoMatchingPackageMessage(source, configuredPackages) {
        const suggestion = this.findSuggestedConfiguredSource(source, configuredPackages);
        if (!suggestion) {
            return `No matching package found for ${source}`;
        }
        return `No matching package found for ${source}. Did you mean ${suggestion}?`;
    }
    findSuggestedConfiguredSource(source, configuredPackages) {
        const trimmedSource = source.trim();
        const suggestions = new Set();
        for (const pkg of configuredPackages) {
            const sourceStr = this.getPackageSourceString(pkg);
            const parsed = this.parseSource(sourceStr);
            if (parsed.type === "npm") {
                if (trimmedSource === parsed.name || trimmedSource === parsed.spec) {
                    suggestions.add(sourceStr);
                }
                continue;
            }
            if (parsed.type === "git") {
                const shorthand = `${parsed.host}/${parsed.path}`;
                const shorthandWithRef = parsed.ref ? `${shorthand}@${parsed.ref}` : undefined;
                if (trimmedSource === shorthand || (shorthandWithRef && trimmedSource === shorthandWithRef)) {
                    suggestions.add(sourceStr);
                }
            }
        }
        return suggestions.values().next().value;
    }
    packageSourcesMatch(existing, inputSource, scope) {
        const left = this.getSourceMatchKeyForSettings(this.getPackageSourceString(existing), scope);
        const right = this.getSourceMatchKeyForInput(inputSource);
        return left === right;
    }
    normalizePackageSourceForSettings(source, scope) {
        const parsed = this.parseSource(source);
        if (parsed.type !== "local") {
            return source;
        }
        const baseDir = this.getBaseDirForScope(scope);
        const resolved = this.resolvePath(parsed.path);
        const rel = relative(baseDir, resolved);
        return rel || ".";
    }
    parseSource(source) {
        if (source.startsWith("npm:")) {
            const spec = source.slice("npm:".length).trim();
            const { name, version } = this.parseNpmSpec(spec);
            return {
                type: "npm",
                spec,
                name,
                version,
                range: getNpmVersionRange(version),
                pinned: isExactNpmVersion(version),
            };
        }
        if (isLocalPath(source)) {
            return { type: "local", path: source };
        }
        // Try parsing as git URL
        const gitParsed = parseGitUrl(source);
        if (gitParsed) {
            return gitParsed;
        }
        return { type: "local", path: source };
    }
    async installedNpmMatchesConfiguredVersion(source, installedPath) {
        const installedVersion = this.getInstalledNpmVersion(installedPath);
        if (!installedVersion) {
            return false;
        }
        return source.range ? satisfies(installedVersion, source.range) : true;
    }
    async npmHasAvailableUpdate(source, installedPath) {
        if (isOfflineModeEnabled()) {
            return false;
        }
        const installedVersion = this.getInstalledNpmVersion(installedPath);
        if (!installedVersion) {
            return false;
        }
        try {
            const targetVersion = await this.getLatestNpmVersion(source.version ? source.spec : source.name, source.range);
            return targetVersion !== installedVersion;
        }
        catch {
            return false;
        }
    }
    getInstalledNpmVersion(installedPath) {
        const packageJsonPath = join(installedPath, "package.json");
        if (!existsSync(packageJsonPath))
            return undefined;
        try {
            const content = readFileSync(packageJsonPath, "utf-8");
            const pkg = JSON.parse(content);
            return pkg.version;
        }
        catch {
            return undefined;
        }
    }
    async getLatestNpmVersion(packageSpec, range) {
        const npmCommand = this.getNpmCommand();
        const stdout = await this.runCommandCapture(npmCommand.command, [...npmCommand.args, "view", packageSpec, "version", "--json"], { cwd: this.cwd, timeoutMs: NETWORK_TIMEOUT_MS });
        const raw = stdout.trim();
        if (!raw)
            throw new Error("Empty response from npm view");
        const parsed = JSON.parse(raw);
        if (typeof parsed === "string") {
            return parsed;
        }
        if (Array.isArray(parsed)) {
            const versions = parsed.filter((value) => typeof value === "string" && value.length > 0);
            const latest = range ? maxSatisfying(versions, range) : [...versions].sort(rcompare)[0];
            if (latest)
                return latest;
        }
        throw new Error("Unexpected response from npm view");
    }
    async gitHasAvailableUpdate(installedPath) {
        if (isOfflineModeEnabled()) {
            return false;
        }
        try {
            const localHead = await this.runCommandCapture("git", ["rev-parse", "HEAD"], {
                cwd: installedPath,
                timeoutMs: NETWORK_TIMEOUT_MS,
            });
            const remoteHead = await this.getRemoteGitHead(installedPath);
            return localHead.trim() !== remoteHead.trim();
        }
        catch {
            return false;
        }
    }
    async getRemoteGitHead(installedPath) {
        const upstreamRef = await this.getGitUpstreamRef(installedPath);
        if (upstreamRef) {
            const remoteHead = await this.runGitRemoteCommand(installedPath, ["ls-remote", "origin", upstreamRef]);
            const match = remoteHead.match(/^([0-9a-f]{40})\s+/m);
            if (match?.[1]) {
                return match[1];
            }
        }
        const remoteHead = await this.runGitRemoteCommand(installedPath, ["ls-remote", "origin", "HEAD"]);
        const match = remoteHead.match(/^([0-9a-f]{40})\s+HEAD$/m);
        if (!match?.[1]) {
            throw new Error("Failed to determine remote HEAD");
        }
        return match[1];
    }
    async getLocalGitUpdateTarget(installedPath) {
        try {
            const upstream = await this.runCommandCapture("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], {
                cwd: installedPath,
                timeoutMs: NETWORK_TIMEOUT_MS,
            });
            const trimmedUpstream = upstream.trim();
            if (!trimmedUpstream.startsWith("origin/")) {
                throw new Error(`Unsupported upstream remote: ${trimmedUpstream}`);
            }
            const branch = trimmedUpstream.slice("origin/".length);
            if (!branch) {
                throw new Error("Missing upstream branch name");
            }
            const head = await this.runCommandCapture("git", ["rev-parse", "@{upstream}"], {
                cwd: installedPath,
                timeoutMs: NETWORK_TIMEOUT_MS,
            });
            return {
                ref: "@{upstream}",
                head,
                fetchArgs: [
                    "fetch",
                    "--prune",
                    "--no-tags",
                    "origin",
                    `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
                ],
            };
        }
        catch {
            await this.runCommand("git", ["remote", "set-head", "origin", "-a"], { cwd: installedPath }).catch(() => { });
            const head = await this.runCommandCapture("git", ["rev-parse", "origin/HEAD"], {
                cwd: installedPath,
                timeoutMs: NETWORK_TIMEOUT_MS,
            });
            const originHeadRef = await this.runCommandCapture("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
                cwd: installedPath,
                timeoutMs: NETWORK_TIMEOUT_MS,
            }).catch(() => "");
            const branch = originHeadRef.trim().replace(/^refs\/remotes\/origin\//, "");
            if (branch) {
                return {
                    ref: "origin/HEAD",
                    head,
                    fetchArgs: [
                        "fetch",
                        "--prune",
                        "--no-tags",
                        "origin",
                        `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
                    ],
                };
            }
            return {
                ref: "origin/HEAD",
                head,
                fetchArgs: ["fetch", "--prune", "--no-tags", "origin", "+HEAD:refs/remotes/origin/HEAD"],
            };
        }
    }
    async getGitUpstreamRef(installedPath) {
        try {
            const upstream = await this.runCommandCapture("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], {
                cwd: installedPath,
                timeoutMs: NETWORK_TIMEOUT_MS,
            });
            const trimmed = upstream.trim();
            if (!trimmed.startsWith("origin/")) {
                return undefined;
            }
            const branch = trimmed.slice("origin/".length);
            return branch ? `refs/heads/${branch}` : undefined;
        }
        catch {
            return undefined;
        }
    }
    runGitRemoteCommand(installedPath, args) {
        return this.runCommandCapture("git", args, {
            cwd: installedPath,
            timeoutMs: NETWORK_TIMEOUT_MS,
            env: {
                GIT_TERMINAL_PROMPT: "0",
            },
        });
    }
    async runWithConcurrency(tasks, limit) {
        if (tasks.length === 0) {
            return [];
        }
        const results = new Array(tasks.length);
        let nextIndex = 0;
        const workerCount = Math.max(1, Math.min(limit, tasks.length));
        const worker = async () => {
            while (true) {
                const index = nextIndex;
                nextIndex += 1;
                if (index >= tasks.length) {
                    return;
                }
                results[index] = await tasks[index]();
            }
        };
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        return results;
    }
    /**
     * Get a unique identity for a package, ignoring version/ref.
     * Used to detect when the same package is in both global and project settings.
     * For git packages, uses normalized host/path to ensure SSH and HTTPS URLs
     * for the same repository are treated as identical.
     */
    getPackageIdentity(source, scope) {
        const parsed = this.parseSource(source);
        if (parsed.type === "npm") {
            return `npm:${parsed.name}`;
        }
        if (parsed.type === "git") {
            // Use host/path for identity to normalize SSH and HTTPS
            return `git:${parsed.host}/${parsed.path}`;
        }
        if (scope) {
            const baseDir = this.getBaseDirForScope(scope);
            return `local:${this.resolvePathFromBase(parsed.path, baseDir)}`;
        }
        return `local:${this.resolvePath(parsed.path)}`;
    }
    /**
     * Dedupe packages: if same package identity appears in both global and project,
     * keep only the project one (project wins).
     */
    dedupePackages(packages) {
        const seen = new Map();
        for (const entry of packages) {
            const sourceStr = typeof entry.pkg === "string" ? entry.pkg : entry.pkg.source;
            const identity = this.getPackageIdentity(sourceStr, entry.scope);
            const existing = seen.get(identity);
            if (!existing) {
                seen.set(identity, entry);
            }
            else if (entry.scope === "project" && existing.scope === "user") {
                // Project wins over user
                seen.set(identity, entry);
            }
            // If existing is project and new is global, keep existing (project)
            // If both are same scope, keep first one
        }
        return Array.from(seen.values());
    }
    parseNpmSpec(spec) {
        const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
        if (!match) {
            return { name: spec };
        }
        const name = match[1] ?? spec;
        const version = match[2];
        return { name, version };
    }
    assertProjectTrustedForScope(scope) {
        if (scope === "project" && !this.settingsManager.isProjectTrusted()) {
            throw new Error("Project is not trusted; refusing to access project package storage");
        }
    }
    getNpmCommand() {
        const configuredCommand = this.settingsManager.getNpmCommand();
        if (!configuredCommand || configuredCommand.length === 0) {
            return { command: "npm", args: [] };
        }
        const [command, ...args] = configuredCommand;
        if (!command) {
            throw new Error("Invalid npmCommand: first array entry must be a non-empty command");
        }
        return { command, args };
    }
    getPackageManagerName() {
        const npmCommand = this.getNpmCommand();
        const commandParts = [npmCommand.command, ...npmCommand.args];
        const separatorIndex = commandParts.lastIndexOf("--");
        const packageManagerCommand = separatorIndex >= 0 ? commandParts[separatorIndex + 1] : npmCommand.command;
        return packageManagerCommand ? basename(packageManagerCommand).replace(/\.(cmd|exe)$/i, "") : "";
    }
    async runNpmCommand(args, options) {
        const npmCommand = this.getNpmCommand();
        await this.runCommand(npmCommand.command, [...npmCommand.args, ...args], options);
    }
    getGitDependencyInstallArgs() {
        const configuredCommand = this.settingsManager.getNpmCommand();
        if (configuredCommand && configuredCommand.length > 0) {
            return ["install"];
        }
        return ["install", "--omit=dev"];
    }
    runNpmCommandSync(args) {
        const npmCommand = this.getNpmCommand();
        return this.runCommandSync(npmCommand.command, [...npmCommand.args, ...args]);
    }
    getNpmInstallArgs(specs, installRoot) {
        const packageManagerName = this.getPackageManagerName();
        // Extension packages run inside pi and resolve pi APIs through loader aliases/virtual modules.
        // Disable peer dependency resolution for managed installs (npm's --legacy-peer-deps, and
        // equivalent bun/pnpm settings) so package managers do not install or solve host-provided
        // @liyuan/* peers. Stale auto-installed peers can otherwise block updates.
        if (packageManagerName === "bun") {
            return ["install", ...specs, "--cwd", installRoot, "--omit=peer"];
        }
        if (packageManagerName === "pnpm") {
            return [
                "install",
                ...specs,
                "--prefix",
                installRoot,
                "--config.auto-install-peers=false",
                "--config.strict-peer-dependencies=false",
                "--config.strict-dep-builds=false",
            ];
        }
        return ["install", ...specs, "--prefix", installRoot, "--legacy-peer-deps"];
    }
    async installNpm(source, scope, temporary) {
        const installRoot = this.getNpmInstallRoot(scope, temporary);
        this.ensureNpmProject(installRoot);
        await this.runNpmCommand(this.getNpmInstallArgs([source.spec], installRoot));
    }
    async uninstallNpm(source, scope) {
        const installRoot = this.getNpmInstallRoot(scope, false);
        if (!existsSync(installRoot)) {
            return;
        }
        if (this.getPackageManagerName() === "bun") {
            await this.runNpmCommand(["uninstall", source.name, "--cwd", installRoot]);
            return;
        }
        await this.runNpmCommand(["uninstall", source.name, "--prefix", installRoot]);
    }
    async installGit(source, scope) {
        const targetDir = this.getGitInstallPath(source, scope);
        if (existsSync(targetDir)) {
            if (source.ref) {
                await this.ensureGitRef(targetDir, ["fetch", "origin", source.ref], "FETCH_HEAD");
                return;
            }
            const target = await this.getLocalGitUpdateTarget(targetDir);
            await this.ensureGitRef(targetDir, target.fetchArgs, target.ref);
            return;
        }
        const gitRoot = this.getGitInstallRoot(scope);
        if (gitRoot) {
            this.ensureGitIgnore(gitRoot);
        }
        mkdirSync(dirname(targetDir), { recursive: true });
        await this.runCommand("git", ["clone", source.repo, targetDir]);
        if (source.ref) {
            await this.runCommand("git", ["checkout", source.ref], { cwd: targetDir });
        }
        const packageJsonPath = join(targetDir, "package.json");
        if (existsSync(packageJsonPath)) {
            await this.runNpmCommand(this.getGitDependencyInstallArgs(), { cwd: targetDir });
        }
    }
    async updateGit(source, scope) {
        const targetDir = this.getGitInstallPath(source, scope);
        if (!existsSync(targetDir)) {
            await this.installGit(source, scope);
            return;
        }
        if (source.ref) {
            await this.ensureGitRef(targetDir, ["fetch", "origin", source.ref], "FETCH_HEAD");
            return;
        }
        const target = await this.getLocalGitUpdateTarget(targetDir);
        await this.ensureGitRef(targetDir, target.fetchArgs, target.ref);
    }
    async ensureGitRef(targetDir, fetchArgs, ref) {
        // Fetch only the ref we will reset to, avoiding unrelated branch/tag noise.
        await this.runCommand("git", fetchArgs, { cwd: targetDir });
        const localHead = await this.runCommandCapture("git", ["rev-parse", "HEAD"], {
            cwd: targetDir,
            timeoutMs: NETWORK_TIMEOUT_MS,
        });
        const commitRef = `${ref}^{commit}`;
        const targetHead = await this.runCommandCapture("git", ["rev-parse", commitRef], {
            cwd: targetDir,
            timeoutMs: NETWORK_TIMEOUT_MS,
        });
        if (localHead.trim() === targetHead.trim()) {
            return;
        }
        await this.runCommand("git", ["reset", "--hard", commitRef], { cwd: targetDir });
        // Clean untracked files (extensions should be pristine)
        await this.runCommand("git", ["clean", "-fdx"], { cwd: targetDir });
        const packageJsonPath = join(targetDir, "package.json");
        if (existsSync(packageJsonPath)) {
            await this.runNpmCommand(this.getGitDependencyInstallArgs(), { cwd: targetDir });
        }
    }
    async refreshTemporaryGitSource(source, sourceStr) {
        if (isOfflineModeEnabled()) {
            return;
        }
        try {
            await this.withProgress("pull", sourceStr, `Refreshing ${sourceStr}...`, async () => {
                await this.updateGit(source, "temporary");
            });
        }
        catch {
            // Keep cached temporary checkout if refresh fails.
        }
    }
    async removeGit(source, scope) {
        const targetDir = this.getGitInstallPath(source, scope);
        if (!existsSync(targetDir))
            return;
        rmSync(targetDir, { recursive: true, force: true });
        this.pruneEmptyGitParents(targetDir, this.getGitInstallRoot(scope));
    }
    pruneEmptyGitParents(targetDir, installRoot) {
        if (!installRoot)
            return;
        const resolvedRoot = resolve(installRoot);
        let current = dirname(targetDir);
        while (current.startsWith(resolvedRoot) && current !== resolvedRoot) {
            if (!existsSync(current)) {
                current = dirname(current);
                continue;
            }
            const entries = readdirSync(current);
            if (entries.length > 0) {
                break;
            }
            try {
                rmSync(current, { recursive: true, force: true });
            }
            catch {
                break;
            }
            current = dirname(current);
        }
    }
    ensureNpmProject(installRoot) {
        if (!existsSync(installRoot)) {
            mkdirSync(installRoot, { recursive: true });
        }
        markPathIgnoredByCloudSync(installRoot);
        this.ensureGitIgnore(installRoot);
        const packageJsonPath = join(installRoot, "package.json");
        if (!existsSync(packageJsonPath)) {
            const pkgJson = { name: "pi-extensions", private: true };
            writeFileSync(packageJsonPath, JSON.stringify(pkgJson, null, 2), "utf-8");
        }
    }
    ensureGitIgnore(dir) {
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        const ignorePath = join(dir, ".gitignore");
        if (!existsSync(ignorePath)) {
            writeFileSync(ignorePath, "*\n!.gitignore\n", "utf-8");
        }
    }
    getNpmInstallRoot(scope, temporary) {
        if (temporary) {
            return this.getTemporaryDir("npm");
        }
        if (scope === "project") {
            this.assertProjectTrustedForScope(scope);
            return join(this.cwd, CONFIG_DIR_NAME, "npm");
        }
        return join(this.agentDir, "npm");
    }
    getGlobalNpmRoot() {
        const npmCommand = this.getNpmCommand();
        const commandKey = [npmCommand.command, ...npmCommand.args].join("\0");
        if (this.globalNpmRoot && this.globalNpmRootCommandKey === commandKey) {
            return this.globalNpmRoot;
        }
        if (this.getPackageManagerName() === "bun") {
            const binDir = this.runNpmCommandSync(["pm", "bin", "-g"]).trim();
            this.globalNpmRoot = join(dirname(binDir), "install", "global", "node_modules");
        }
        else {
            this.globalNpmRoot = this.runNpmCommandSync(["root", "-g"]).trim();
        }
        this.globalNpmRootCommandKey = commandKey;
        return this.globalNpmRoot;
    }
    getPnpmGlobalPackagePath(packageName) {
        if (this.getPackageManagerName() !== "pnpm") {
            return undefined;
        }
        const output = this.runNpmCommandSync(["list", "-g", "--depth", "0", "--json"]);
        const entries = JSON.parse(output);
        for (const entry of entries) {
            const path = entry.dependencies?.[packageName]?.path;
            if (path)
                return path;
        }
        return undefined;
    }
    getManagedNpmInstallPath(source, scope) {
        if (scope === "temporary") {
            return join(this.getTemporaryDir("npm"), "node_modules", source.name);
        }
        if (scope === "project") {
            this.assertProjectTrustedForScope(scope);
            return join(this.cwd, CONFIG_DIR_NAME, "npm", "node_modules", source.name);
        }
        return join(this.agentDir, "npm", "node_modules", source.name);
    }
    getLegacyGlobalNpmInstallPath(source) {
        try {
            return this.getPnpmGlobalPackagePath(source.name) ?? join(this.getGlobalNpmRoot(), source.name);
        }
        catch {
            return undefined;
        }
    }
    getNpmInstallPath(source, scope) {
        const managedPath = this.getManagedNpmInstallPath(source, scope);
        if (scope !== "user" || existsSync(managedPath)) {
            return managedPath;
        }
        const legacyPath = this.getLegacyGlobalNpmInstallPath(source);
        return legacyPath && existsSync(legacyPath) ? legacyPath : managedPath;
    }
    getGitInstallPath(source, scope) {
        if (scope === "temporary") {
            return this.getTemporaryDir(`git-${source.host}`, source.path);
        }
        const installRoot = this.getGitInstallRoot(scope);
        if (!installRoot) {
            throw new Error("Missing git install root");
        }
        return this.resolveManagedPath(installRoot, source.host, source.path);
    }
    getGitInstallRoot(scope) {
        if (scope === "temporary") {
            return undefined;
        }
        if (scope === "project") {
            this.assertProjectTrustedForScope(scope);
            return join(this.cwd, CONFIG_DIR_NAME, "git");
        }
        return join(this.agentDir, "git");
    }
    getTemporaryDir(prefix, suffix) {
        const root = this.resolveManagedPath(getExtensionTempFolder(this.agentDir), prefix);
        const hash = createHash("sha256")
            .update(`${prefix}-${suffix ?? ""}`)
            .digest("hex")
            .slice(0, 8);
        return this.resolveManagedPath(root, hash, suffix ?? "");
    }
    resolveManagedPath(root, ...parts) {
        const resolvedRoot = resolve(root);
        const resolvedPath = resolve(resolvedRoot, ...parts);
        if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${sep}`)) {
            throw new Error(`Refusing to use path outside package install root: ${resolvedPath}`);
        }
        return resolvedPath;
    }
    getBaseDirForScope(scope) {
        if (scope === "project") {
            this.assertProjectTrustedForScope(scope);
            return join(this.cwd, CONFIG_DIR_NAME);
        }
        if (scope === "user") {
            return this.agentDir;
        }
        return this.cwd;
    }
    resolvePath(input) {
        return resolvePath(input, this.cwd, { homeDir: getHomeDir(), trim: true });
    }
    resolvePathFromBase(input, baseDir) {
        return resolvePath(input, baseDir, { homeDir: getHomeDir(), trim: true });
    }
    collectPackageResources(packageRoot, accumulator, filter, metadata) {
        if (filter) {
            for (const resourceType of RESOURCE_TYPES) {
                const patterns = filter[resourceType];
                const target = this.getTargetMap(accumulator, resourceType);
                if (patterns !== undefined) {
                    this.applyPackageFilter(packageRoot, patterns, resourceType, target, metadata);
                }
                else {
                    this.collectDefaultResources(packageRoot, resourceType, target, metadata);
                }
            }
            return true;
        }
        const manifest = this.readPiManifest(packageRoot);
        if (manifest) {
            for (const resourceType of RESOURCE_TYPES) {
                const entries = manifest[resourceType];
                this.addManifestEntries(entries, packageRoot, resourceType, this.getTargetMap(accumulator, resourceType), metadata);
            }
            return true;
        }
        let hasAnyDir = false;
        for (const resourceType of RESOURCE_TYPES) {
            const dir = join(packageRoot, resourceType);
            if (existsSync(dir)) {
                // Collect all files from the directory (all enabled by default)
                const files = collectResourceFiles(dir, resourceType);
                for (const f of files) {
                    this.addResource(this.getTargetMap(accumulator, resourceType), f, metadata, true);
                }
                hasAnyDir = true;
            }
        }
        return hasAnyDir;
    }
    collectDefaultResources(packageRoot, resourceType, target, metadata) {
        const manifest = this.readPiManifest(packageRoot);
        const entries = manifest?.[resourceType];
        if (entries) {
            this.addManifestEntries(entries, packageRoot, resourceType, target, metadata);
            return;
        }
        const dir = join(packageRoot, resourceType);
        if (existsSync(dir)) {
            // Collect all files from the directory (all enabled by default)
            const files = collectResourceFiles(dir, resourceType);
            for (const f of files) {
                this.addResource(target, f, metadata, true);
            }
        }
    }
    applyPackageFilter(packageRoot, userPatterns, resourceType, target, metadata) {
        const { allFiles } = this.collectManifestFiles(packageRoot, resourceType);
        if (userPatterns.length === 0) {
            // Empty array explicitly disables all resources of this type
            for (const f of allFiles) {
                this.addResource(target, f, metadata, false);
            }
            return;
        }
        // Apply user patterns
        const enabledByUser = applyPatterns(allFiles, userPatterns, packageRoot);
        for (const f of allFiles) {
            const enabled = enabledByUser.has(f);
            this.addResource(target, f, metadata, enabled);
        }
    }
    /**
     * Collect all files from a package for a resource type, applying manifest patterns.
     * Returns { allFiles, enabledByManifest } where enabledByManifest is the set of files
     * that pass the manifest's own patterns.
     */
    collectManifestFiles(packageRoot, resourceType) {
        const manifest = this.readPiManifest(packageRoot);
        const entries = manifest?.[resourceType];
        if (entries && entries.length > 0) {
            const allFiles = this.collectFilesFromManifestEntries(entries, packageRoot, resourceType);
            const manifestPatterns = entries.filter(isOverridePattern);
            const enabledByManifest = manifestPatterns.length > 0 ? applyPatterns(allFiles, manifestPatterns, packageRoot) : new Set(allFiles);
            return { allFiles: Array.from(enabledByManifest), enabledByManifest };
        }
        const conventionDir = join(packageRoot, resourceType);
        if (!existsSync(conventionDir)) {
            return { allFiles: [], enabledByManifest: new Set() };
        }
        const allFiles = collectResourceFiles(conventionDir, resourceType);
        return { allFiles, enabledByManifest: new Set(allFiles) };
    }
    readPiManifest(packageRoot) {
        const packageJsonPath = join(packageRoot, "package.json");
        if (!existsSync(packageJsonPath)) {
            return null;
        }
        try {
            const content = readFileSync(packageJsonPath, "utf-8");
            const pkg = JSON.parse(content);
            return pkg.pi ?? null;
        }
        catch {
            return null;
        }
    }
    addManifestEntries(entries, root, resourceType, target, metadata) {
        if (!entries)
            return;
        const allFiles = this.collectFilesFromManifestEntries(entries, root, resourceType);
        const patterns = entries.filter(isOverridePattern);
        const enabledPaths = applyPatterns(allFiles, patterns, root);
        for (const f of allFiles) {
            if (enabledPaths.has(f)) {
                this.addResource(target, f, metadata, true);
            }
        }
    }
    collectFilesFromManifestEntries(entries, root, resourceType) {
        const sourceEntries = entries.filter((entry) => !isOverridePattern(entry));
        const resolved = sourceEntries.flatMap((entry) => {
            if (!hasGlobPattern(entry)) {
                return [resolve(root, entry)];
            }
            return globSync(entry, {
                cwd: root,
                absolute: true,
                dot: false,
                nodir: false,
            }).map((match) => resolve(match));
        });
        return this.collectFilesFromPaths(resolved, resourceType);
    }
    resolveLocalEntries(entries, resourceType, target, metadata, baseDir) {
        if (entries.length === 0)
            return;
        // Collect all files from plain entries (non-pattern entries)
        const { plain, patterns } = splitPatterns(entries);
        const resolvedPlain = plain.map((p) => this.resolvePathFromBase(p, baseDir));
        const allFiles = this.collectFilesFromPaths(resolvedPlain, resourceType);
        // Determine which files are enabled based on patterns
        const enabledPaths = applyPatterns(allFiles, patterns, baseDir);
        // Add all files with their enabled state
        for (const f of allFiles) {
            this.addResource(target, f, metadata, enabledPaths.has(f));
        }
    }
    addAutoDiscoveredResources(accumulator, globalSettings, projectSettings, globalBaseDir, projectBaseDir) {
        const userMetadata = {
            source: "auto",
            scope: "user",
            origin: "top-level",
            baseDir: globalBaseDir,
        };
        const projectMetadata = {
            source: "auto",
            scope: "project",
            origin: "top-level",
            baseDir: projectBaseDir,
        };
        const userOverrides = {
            extensions: (globalSettings.extensions ?? []),
            skills: (globalSettings.skills ?? []),
            prompts: (globalSettings.prompts ?? []),
            themes: (globalSettings.themes ?? []),
        };
        const projectOverrides = {
            extensions: (projectSettings.extensions ?? []),
            skills: (projectSettings.skills ?? []),
            prompts: (projectSettings.prompts ?? []),
            themes: (projectSettings.themes ?? []),
        };
        const userDirs = {
            extensions: join(globalBaseDir, "extensions"),
            skills: join(globalBaseDir, "skills"),
            prompts: join(globalBaseDir, "prompts"),
            themes: join(globalBaseDir, "themes"),
        };
        const projectDirs = {
            extensions: join(projectBaseDir, "extensions"),
            skills: join(projectBaseDir, "skills"),
            prompts: join(projectBaseDir, "prompts"),
            themes: join(projectBaseDir, "themes"),
        };
        const userAgentsSkillsDir = join(getHomeDir(), ".agents", "skills");
        const projectTrusted = this.settingsManager.isProjectTrusted();
        const projectAgentsSkillDirs = projectTrusted
            ? collectAncestorAgentsSkillDirs(this.cwd).filter((dir) => resolve(dir) !== resolve(userAgentsSkillsDir))
            : [];
        const addResources = (resourceType, paths, metadata, overrides, baseDir) => {
            const target = this.getTargetMap(accumulator, resourceType);
            for (const path of paths) {
                const enabled = isEnabledByOverrides(path, overrides, baseDir);
                this.addResource(target, path, metadata, enabled);
            }
        };
        if (projectTrusted) {
            // Project extensions from .pi/
            addResources("extensions", collectAutoExtensionEntries(projectDirs.extensions), projectMetadata, projectOverrides.extensions, projectBaseDir);
            // Project skills from .pi/
            addResources("skills", collectAutoSkillEntries(projectDirs.skills, "pi"), projectMetadata, projectOverrides.skills, projectBaseDir);
        }
        // Project skills from .agents/ (each with its own baseDir)
        for (const agentsSkillsDir of projectAgentsSkillDirs) {
            const agentsBaseDir = dirname(agentsSkillsDir); // the .agents directory
            const agentsMetadata = {
                ...projectMetadata,
                baseDir: agentsBaseDir,
            };
            addResources("skills", collectAutoSkillEntries(agentsSkillsDir, "agents"), agentsMetadata, projectOverrides.skills, agentsBaseDir);
        }
        if (projectTrusted) {
            addResources("prompts", collectAutoPromptEntries(projectDirs.prompts), projectMetadata, projectOverrides.prompts, projectBaseDir);
            addResources("themes", collectAutoThemeEntries(projectDirs.themes), projectMetadata, projectOverrides.themes, projectBaseDir);
        }
        // User extensions from ~/.pi/agent/
        addResources("extensions", collectAutoExtensionEntries(userDirs.extensions), userMetadata, userOverrides.extensions, globalBaseDir);
        // User skills from ~/.pi/agent/
        addResources("skills", collectAutoSkillEntries(userDirs.skills, "pi"), userMetadata, userOverrides.skills, globalBaseDir);
        // User skills from ~/.agents/ (with its own baseDir)
        const userAgentsBaseDir = dirname(userAgentsSkillsDir);
        const userAgentsMetadata = {
            ...userMetadata,
            baseDir: userAgentsBaseDir,
        };
        addResources("skills", collectAutoSkillEntries(userAgentsSkillsDir, "agents"), userAgentsMetadata, userOverrides.skills, userAgentsBaseDir);
        addResources("prompts", collectAutoPromptEntries(userDirs.prompts), userMetadata, userOverrides.prompts, globalBaseDir);
        addResources("themes", collectAutoThemeEntries(userDirs.themes), userMetadata, userOverrides.themes, globalBaseDir);
    }
    collectFilesFromPaths(paths, resourceType) {
        const files = [];
        for (const p of paths) {
            if (!existsSync(p))
                continue;
            try {
                const stats = statSync(p);
                if (stats.isFile()) {
                    files.push(p);
                }
                else if (stats.isDirectory()) {
                    files.push(...collectResourceFiles(p, resourceType));
                }
            }
            catch {
                // Ignore errors
            }
        }
        return files;
    }
    getTargetMap(accumulator, resourceType) {
        switch (resourceType) {
            case "extensions":
                return accumulator.extensions;
            case "skills":
                return accumulator.skills;
            case "prompts":
                return accumulator.prompts;
            case "themes":
                return accumulator.themes;
            default:
                throw new Error(`Unknown resource type: ${resourceType}`);
        }
    }
    addResource(map, path, metadata, enabled) {
        if (!path)
            return;
        if (!map.has(path)) {
            map.set(path, { metadata, enabled });
        }
    }
    createAccumulator() {
        return {
            extensions: new Map(),
            skills: new Map(),
            prompts: new Map(),
            themes: new Map(),
        };
    }
    toResolvedPaths(accumulator) {
        const mapToResolved = (entries) => {
            const resolved = Array.from(entries.entries()).map(([path, { metadata, enabled }]) => ({
                path,
                enabled,
                metadata,
            }));
            resolved.sort((a, b) => resourcePrecedenceRank(a.metadata) - resourcePrecedenceRank(b.metadata));
            const seen = new Set();
            return resolved.filter((entry) => {
                const canonicalPath = canonicalizePath(entry.path);
                if (seen.has(canonicalPath))
                    return false;
                seen.add(canonicalPath);
                return true;
            });
        };
        return {
            extensions: mapToResolved(accumulator.extensions),
            skills: mapToResolved(accumulator.skills),
            prompts: mapToResolved(accumulator.prompts),
            themes: mapToResolved(accumulator.themes),
        };
    }
    spawnCommand(command, args, options) {
        const env = getEnv();
        return spawnProcess(command, args, {
            cwd: options?.cwd,
            stdio: isStdoutTakenOver() ? ["ignore", 2, 2] : "inherit",
            env,
        });
    }
    spawnCaptureCommand(command, args, options) {
        const baseEnv = getEnv();
        const env = options?.env ? { ...baseEnv, ...options.env } : baseEnv;
        return spawnProcess(command, args, {
            cwd: options?.cwd,
            stdio: ["ignore", "pipe", "pipe"],
            env,
        });
    }
    runCommandCapture(command, args, options) {
        return new Promise((resolvePromise, reject) => {
            const child = this.spawnCaptureCommand(command, args, options);
            let stdout = "";
            let stderr = "";
            let timedOut = false;
            const timeout = typeof options?.timeoutMs === "number"
                ? setTimeout(() => {
                    timedOut = true;
                    child.kill();
                }, options.timeoutMs)
                : undefined;
            child.stdout?.on("data", (data) => {
                stdout += data.toString();
            });
            child.stderr?.on("data", (data) => {
                stderr += data.toString();
            });
            child.once("error", (error) => {
                if (timeout)
                    clearTimeout(timeout);
                reject(error);
            });
            child.once("close", (code, signal) => {
                if (timeout)
                    clearTimeout(timeout);
                if (timedOut) {
                    reject(new Error(`${command} ${args.join(" ")} timed out after ${options?.timeoutMs}ms`));
                    return;
                }
                if (code === 0) {
                    resolvePromise(stdout.trim());
                    return;
                }
                const exitStatus = code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
                reject(new Error(`${command} ${args.join(" ")} failed with ${exitStatus}: ${stderr || stdout}`));
            });
        });
    }
    runCommand(command, args, options) {
        return new Promise((resolvePromise, reject) => {
            const child = this.spawnCommand(command, args, options);
            child.on("error", reject);
            child.on("exit", (code) => {
                if (code === 0) {
                    resolvePromise();
                }
                else {
                    reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
                }
            });
        });
    }
    runCommandSync(command, args) {
        const env = getEnv();
        const result = spawnProcessSync(command, args, {
            stdio: ["ignore", "pipe", "pipe"],
            encoding: "utf-8",
            env,
        });
        if (result.error || result.status !== 0) {
            throw new Error(`Failed to run ${command} ${args.join(" ")}: ${result.error?.message || result.stderr || result.stdout}`);
        }
        return (result.stdout || result.stderr || "").trim();
    }
}
//# sourceMappingURL=package-manager.js.map