import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve as nodeResolvePath, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnProcessSync } from "./child-process.js";
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
/**
 * Resolve a path to its canonical (real) form, following symlinks.
 * Falls back to the raw path if resolution fails (e.g. the target does
 * not exist yet), so that callers never crash on missing filesystem
 * entries.
 */
export function canonicalizePath(path) {
    try {
        return realpathSync(path);
    }
    catch {
        return path;
    }
}
/**
 * Returns true if the value is NOT a package source (npm:, git:, etc.)
 * or a remote URL protocol. Bare names, relative paths, and file: URLs
 * are considered local.
 */
export function isLocalPath(value) {
    const trimmed = value.trim();
    // Known non-local prefixes. file: URLs are local paths and are intentionally resolved by resolvePath().
    if (trimmed.startsWith("npm:") ||
        trimmed.startsWith("git:") ||
        trimmed.startsWith("github:") ||
        trimmed.startsWith("http:") ||
        trimmed.startsWith("https:") ||
        trimmed.startsWith("ssh:")) {
        return false;
    }
    return true;
}
export function normalizePath(input, options = {}) {
    let normalized = options.trim ? input.trim() : input;
    if (options.normalizeUnicodeSpaces) {
        normalized = normalized.replace(UNICODE_SPACES, " ");
    }
    if (options.stripAtPrefix && normalized.startsWith("@")) {
        normalized = normalized.slice(1);
    }
    if (options.expandTilde ?? true) {
        const home = options.homeDir ?? homedir();
        if (normalized === "~")
            return home;
        if (normalized.startsWith("~/") || (process.platform === "win32" && normalized.startsWith("~\\"))) {
            return join(home, normalized.slice(2));
        }
    }
    if (/^file:\/\//.test(normalized)) {
        return fileURLToPath(normalized);
    }
    return normalized;
}
export function resolvePath(input, baseDir = process.cwd(), options = {}) {
    const normalized = normalizePath(input, options);
    const normalizedBaseDir = normalizePath(baseDir);
    return isAbsolute(normalized) ? nodeResolvePath(normalized) : nodeResolvePath(normalizedBaseDir, normalized);
}
export function getCwdRelativePath(filePath, cwd) {
    const resolvedCwd = resolvePath(cwd);
    const resolvedPath = resolvePath(filePath, resolvedCwd);
    const relativePath = relative(resolvedCwd, resolvedPath);
    const isInsideCwd = relativePath === "" ||
        (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
    return isInsideCwd ? relativePath || "." : undefined;
}
export function formatPathRelativeToCwdOrAbsolute(filePath, cwd) {
    const absolutePath = resolvePath(filePath, cwd);
    return (getCwdRelativePath(absolutePath, cwd) ?? absolutePath).split(sep).join("/");
}
export function markPathIgnoredByCloudSync(path) {
    const attrs = process.platform === "darwin"
        ? ["com.dropbox.ignored", "com.apple.fileprovider.ignore#P"]
        : process.platform === "linux"
            ? ["user.com.dropbox.ignored"]
            : [];
    for (const attr of attrs) {
        if (process.platform === "darwin") {
            spawnProcessSync("xattr", ["-w", attr, "1", path], { encoding: "utf-8", stdio: "ignore" });
        }
        else {
            spawnProcessSync("setfattr", ["-n", attr, "-v", "1", path], { encoding: "utf-8", stdio: "ignore" });
        }
    }
}
//# sourceMappingURL=paths.js.map