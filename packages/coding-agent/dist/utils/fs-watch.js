import { watch } from "node:fs";
export const FS_WATCH_RETRY_DELAY_MS = 5000;
export function closeWatcher(watcher) {
    if (!watcher) {
        return;
    }
    try {
        watcher.close();
    }
    catch {
        // Ignore watcher close errors
    }
}
export function watchWithErrorHandler(path, listener, onError) {
    try {
        const watcher = watch(path, listener);
        watcher.on("error", onError);
        return watcher;
    }
    catch {
        onError();
        return null;
    }
}
//# sourceMappingURL=fs-watch.js.map