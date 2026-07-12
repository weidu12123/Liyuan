/**
 * Photon image processing wrapper.
 *
 * This module provides a unified interface to @silvia-odwyer/photon-node that works in:
 * 1. Node.js (development, npm run build)
 * 2. Bun compiled binaries (standalone distribution)
 *
 * The challenge: photon-node's CJS entry uses fs.readFileSync(__dirname + '/photon_rs_bg.wasm')
 * which bakes the build machine's absolute path into Bun compiled binaries.
 *
 * Solution:
 * 1. Patch fs.readFileSync to redirect missing photon_rs_bg.wasm reads
 * 2. Copy photon_rs_bg.wasm next to the executable in build:binary
 */
import { createRequire } from "module";
import * as path from "path";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const fs = require("fs");
const WASM_FILENAME = "photon_rs_bg.wasm";
// Lazy-loaded photon module
let photonModule = null;
let loadPromise = null;
function pathOrNull(file) {
    if (typeof file === "string") {
        return file;
    }
    if (file instanceof URL) {
        return fileURLToPath(file);
    }
    return null;
}
function getFallbackWasmPaths() {
    const execDir = path.dirname(process.execPath);
    return [
        path.join(execDir, WASM_FILENAME),
        path.join(execDir, "photon", WASM_FILENAME),
        path.join(process.cwd(), WASM_FILENAME),
    ];
}
function patchPhotonWasmRead() {
    const originalReadFileSync = fs.readFileSync.bind(fs);
    const fallbackPaths = getFallbackWasmPaths();
    const mutableFs = fs;
    const patchedReadFileSync = ((...args) => {
        const [file, options] = args;
        const resolvedPath = pathOrNull(file);
        if (resolvedPath?.endsWith(WASM_FILENAME)) {
            try {
                return originalReadFileSync(...args);
            }
            catch (error) {
                const err = error;
                if (err?.code && err.code !== "ENOENT") {
                    throw error;
                }
                for (const fallbackPath of fallbackPaths) {
                    if (!fs.existsSync(fallbackPath)) {
                        continue;
                    }
                    if (options === undefined) {
                        return originalReadFileSync(fallbackPath);
                    }
                    return originalReadFileSync(fallbackPath, options);
                }
                throw error;
            }
        }
        return originalReadFileSync(...args);
    });
    try {
        mutableFs.readFileSync = patchedReadFileSync;
    }
    catch {
        Object.defineProperty(fs, "readFileSync", {
            value: patchedReadFileSync,
            writable: true,
            configurable: true,
        });
    }
    return () => {
        try {
            mutableFs.readFileSync = originalReadFileSync;
        }
        catch {
            Object.defineProperty(fs, "readFileSync", {
                value: originalReadFileSync,
                writable: true,
                configurable: true,
            });
        }
    };
}
/**
 * Load the photon module asynchronously.
 * Returns cached module on subsequent calls.
 */
export async function loadPhoton() {
    if (photonModule) {
        return photonModule;
    }
    if (loadPromise) {
        return loadPromise;
    }
    loadPromise = (async () => {
        const restoreReadFileSync = patchPhotonWasmRead();
        try {
            photonModule = await import("@silvia-odwyer/photon-node");
            return photonModule;
        }
        catch {
            photonModule = null;
            return photonModule;
        }
        finally {
            restoreReadFileSync();
        }
    })();
    return loadPromise;
}
//# sourceMappingURL=photon.js.map