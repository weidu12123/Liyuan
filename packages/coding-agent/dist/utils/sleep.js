/**
 * Sleep helper that respects abort signal.
 */
export function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error("Aborted"));
            return;
        }
        const timeout = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            clearTimeout(timeout);
            reject(new Error("Aborted"));
        });
    });
}
//# sourceMappingURL=sleep.js.map