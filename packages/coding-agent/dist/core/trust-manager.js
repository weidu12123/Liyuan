import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { CONFIG_DIR_NAME } from "../config.js";
import { canonicalizePath, resolvePath } from "../utils/paths.js";
const TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES = [
    "settings.json",
    "extensions",
    "skills",
    "prompts",
    "themes",
    "SYSTEM.md",
    "APPEND_SYSTEM.md",
];
function normalizeCwd(cwd) {
    return canonicalizePath(resolvePath(cwd));
}
function findNearestTrustEntry(data, cwd) {
    let currentDir = normalizeCwd(cwd);
    while (true) {
        const value = data[currentDir];
        if (value === true || value === false) {
            return { path: currentDir, decision: value };
        }
        const parentDir = dirname(currentDir);
        if (parentDir === currentDir) {
            return null;
        }
        currentDir = parentDir;
    }
}
export function getProjectTrustParentPath(cwd) {
    const trustPath = normalizeCwd(cwd);
    const parentDir = dirname(trustPath);
    return parentDir === trustPath ? undefined : parentDir;
}
export function getProjectTrustOptions(cwd, options) {
    const trustPath = normalizeCwd(cwd);
    const trustOptions = [
        { label: "Trust", trusted: true, updates: [{ path: trustPath, decision: true }], savedPath: trustPath },
    ];
    const parentPath = getProjectTrustParentPath(cwd);
    if (parentPath !== undefined) {
        trustOptions.push({
            label: `Trust parent folder (${parentPath})`,
            trusted: true,
            updates: [
                { path: parentPath, decision: true },
                { path: trustPath, decision: null },
            ],
            savedPath: parentPath,
        });
    }
    if (options?.includeSessionOnly) {
        trustOptions.push({ label: "Trust (this session only)", trusted: true, updates: [] });
    }
    trustOptions.push({
        label: "Do not trust",
        trusted: false,
        updates: [{ path: trustPath, decision: false }],
        savedPath: trustPath,
    });
    if (options?.includeSessionOnly) {
        trustOptions.push({ label: "Do not trust (this session only)", trusted: false, updates: [] });
    }
    return trustOptions;
}
function readTrustFile(path) {
    if (!existsSync(path)) {
        return {};
    }
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(path, "utf-8"));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read trust store ${path}: ${message}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`Invalid trust store ${path}: expected an object`);
    }
    const data = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (value !== true && value !== false && value !== null) {
            throw new Error(`Invalid trust store ${path}: value for ${JSON.stringify(key)} must be true, false, or null`);
        }
        data[key] = value;
    }
    return data;
}
function writeTrustFile(path, data) {
    const sorted = {};
    for (const key of Object.keys(data).sort()) {
        const value = data[key];
        if (value === true || value === false || value === null) {
            sorted[key] = value;
        }
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`, "utf-8");
}
function acquireTrustLockSync(path) {
    const trustDir = dirname(path);
    mkdirSync(trustDir, { recursive: true });
    const maxAttempts = 10;
    const delayMs = 20;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return lockfile.lockSync(trustDir, { realpath: false, lockfilePath: `${path}.lock` });
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
                // Sleep synchronously to avoid changing trust store callers to async.
            }
        }
    }
    if (lastError instanceof Error) {
        throw lastError;
    }
    throw new Error("Failed to acquire trust store lock");
}
function withTrustFileLock(path, fn) {
    const release = acquireTrustLockSync(path);
    try {
        return fn();
    }
    finally {
        release();
    }
}
/**
 * Returns true when cwd has project-local resources that must be gated by
 * project trust: trust-requiring entries under cwd/.pi, or .agents/skills in
 * cwd or one of its ancestors. Returns false when no such project resources
 * exist. The user/global ~/.agents/skills directory is always treated as a
 * trusted user resource and is ignored here, even when cwd is $HOME.
 */
export function hasTrustRequiringProjectResources(cwd) {
    const homeDir = canonicalizePath(resolvePath(process.env.HOME || homedir()));
    const userAgentsSkillsDir = join(homeDir, ".agents", "skills");
    let currentDir = canonicalizePath(resolvePath(cwd));
    const configDir = join(currentDir, CONFIG_DIR_NAME);
    if (TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES.some((entry) => existsSync(join(configDir, entry)))) {
        return true;
    }
    while (true) {
        const agentsSkillsDir = join(currentDir, ".agents", "skills");
        if (agentsSkillsDir !== userAgentsSkillsDir && existsSync(agentsSkillsDir)) {
            return true;
        }
        const parentDir = dirname(currentDir);
        if (parentDir === currentDir) {
            return false;
        }
        currentDir = parentDir;
    }
}
export class ProjectTrustStore {
    trustPath;
    constructor(agentDir) {
        this.trustPath = join(resolvePath(agentDir), "trust.json");
    }
    get(cwd) {
        return this.getEntry(cwd)?.decision ?? null;
    }
    getEntry(cwd) {
        return withTrustFileLock(this.trustPath, () => {
            const data = readTrustFile(this.trustPath);
            return findNearestTrustEntry(data, cwd);
        });
    }
    set(cwd, decision) {
        this.setMany([{ path: cwd, decision }]);
    }
    setMany(decisions) {
        withTrustFileLock(this.trustPath, () => {
            const data = readTrustFile(this.trustPath);
            for (const { path, decision } of decisions) {
                const key = normalizeCwd(path);
                if (decision === null) {
                    delete data[key];
                }
                else {
                    data[key] = decision;
                }
            }
            writeTrustFile(this.trustPath, data);
        });
    }
}
//# sourceMappingURL=trust-manager.js.map