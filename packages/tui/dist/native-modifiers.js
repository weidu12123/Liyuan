import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
const cjsRequire = createRequire(import.meta.url);
let nativeModifiersHelper;
function isNativeModifiersHelper(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const candidate = value.isModifierPressed;
    return typeof candidate === "function";
}
function loadNativeModifiersHelper() {
    if (nativeModifiersHelper !== undefined)
        return nativeModifiersHelper ?? undefined;
    nativeModifiersHelper = null;
    if (process.platform !== "darwin")
        return undefined;
    const arch = process.arch;
    if (arch !== "x64" && arch !== "arm64")
        return undefined;
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const nativePath = path.join("native", "darwin", "prebuilds", `darwin-${arch}`, "darwin-modifiers.node");
    const candidates = [
        path.join(moduleDir, "..", nativePath),
        path.join(moduleDir, nativePath),
        path.join(path.dirname(process.execPath), nativePath),
    ];
    for (const modulePath of candidates) {
        try {
            const helper = cjsRequire(modulePath);
            if (isNativeModifiersHelper(helper)) {
                nativeModifiersHelper = helper;
                return helper;
            }
        }
        catch {
            // Try the next possible packaging location.
        }
    }
    return undefined;
}
export function isNativeModifierPressed(key) {
    const helper = loadNativeModifiersHelper();
    if (!helper)
        return false;
    try {
        return helper.isModifierPressed(key) === true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=native-modifiers.js.map