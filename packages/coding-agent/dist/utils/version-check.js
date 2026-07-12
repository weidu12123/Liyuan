import { compare, valid } from "semver";
import { getPiUserAgent } from "./pi-user-agent.js";
const LATEST_VERSION_URL = "https://pi.dev/api/latest-version";
const DEFAULT_VERSION_CHECK_TIMEOUT_MS = 10000;
export function comparePackageVersions(leftVersion, rightVersion) {
    const left = valid(leftVersion.trim());
    const right = valid(rightVersion.trim());
    if (!left || !right) {
        return undefined;
    }
    return compare(left, right);
}
export function isNewerPackageVersion(candidateVersion, currentVersion) {
    const comparison = comparePackageVersions(candidateVersion, currentVersion);
    if (comparison !== undefined) {
        return comparison > 0;
    }
    return candidateVersion.trim() !== currentVersion.trim();
}
export async function getLatestPiRelease(currentVersion, options = {}) {
    if (process.env.PI_SKIP_VERSION_CHECK || process.env.PI_OFFLINE)
        return undefined;
    const response = await fetch(LATEST_VERSION_URL, {
        headers: {
            "User-Agent": getPiUserAgent(currentVersion),
            accept: "application/json",
        },
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_VERSION_CHECK_TIMEOUT_MS),
    });
    if (!response.ok)
        return undefined;
    const data = (await response.json());
    if (typeof data.version !== "string" || !data.version.trim()) {
        return undefined;
    }
    const packageName = typeof data.packageName === "string" && data.packageName.trim() ? data.packageName.trim() : undefined;
    const note = typeof data.note === "string" && data.note.trim() ? data.note.trim() : undefined;
    return {
        version: data.version.trim(),
        packageName,
        ...(note ? { note } : {}),
    };
}
export async function getLatestPiVersion(currentVersion, options = {}) {
    return (await getLatestPiRelease(currentVersion, options))?.version;
}
export async function checkForNewPiVersion(currentVersion) {
    try {
        const latestRelease = await getLatestPiRelease(currentVersion);
        if (latestRelease && isNewerPackageVersion(latestRelease.version, currentVersion)) {
            return latestRelease;
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=version-check.js.map