import { createRequire } from "module";
import { dirname, join } from "path";
import { pathToFileURL } from "url";
const moduleRequire = createRequire(import.meta.url);
const executableDirRequire = createRequire(pathToFileURL(join(dirname(process.execPath), "package.json")).href);
const hasDisplay = process.platform !== "linux" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
export function loadClipboardNative(requires = [moduleRequire, executableDirRequire]) {
    for (const requireClipboard of requires) {
        try {
            return requireClipboard("@mariozechner/clipboard");
        }
        catch {
            // Try the next resolution root.
        }
    }
    return null;
}
const clipboard = !process.env.TERMUX_VERSION && hasDisplay ? loadClipboardNative() : null;
export { clipboard };
//# sourceMappingURL=clipboard-native.js.map