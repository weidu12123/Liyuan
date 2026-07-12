export function createSourceInfo(path, metadata) {
    return {
        path,
        source: metadata.source,
        scope: metadata.scope,
        origin: metadata.origin,
        baseDir: metadata.baseDir,
    };
}
export function createSyntheticSourceInfo(path, options) {
    return {
        path,
        source: options.source,
        scope: options.scope ?? "temporary",
        origin: options.origin ?? "top-level",
        baseDir: options.baseDir,
    };
}
//# sourceMappingURL=source-info.js.map