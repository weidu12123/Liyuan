import { EventEmitter } from "node:events";
import * as undici from "undici";
export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000;
export const HTTP_IDLE_TIMEOUT_CHOICES = [
    { label: "30 sec", timeoutMs: 30_000 },
    { label: "1 min", timeoutMs: 60_000 },
    { label: "2 min", timeoutMs: 120_000 },
    { label: "5 min", timeoutMs: 300_000 },
    { label: "disabled", timeoutMs: 0 },
];
const originalGlobalFetch = globalThis.fetch;
let installedGlobalFetch;
export function parseHttpIdleTimeoutMs(value) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.toLowerCase() === "disabled") {
            return 0;
        }
        if (trimmed.length === 0) {
            return undefined;
        }
        return parseHttpIdleTimeoutMs(Number(trimmed));
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return undefined;
    }
    return Math.floor(value);
}
export function formatHttpIdleTimeoutMs(timeoutMs) {
    const choice = HTTP_IDLE_TIMEOUT_CHOICES.find((item) => item.timeoutMs === timeoutMs);
    if (choice) {
        return choice.label;
    }
    return `${timeoutMs / 1000} sec`;
}
export function applyHttpProxySettings(httpProxy) {
    const proxy = httpProxy?.trim();
    if (!proxy)
        return;
    process.env.HTTP_PROXY ??= proxy;
    process.env.HTTPS_PROXY ??= proxy;
}
const ignoreUndiciDispatcherError = (_error) => { };
// Undici can emit an internal Client "error" while terminating a mid-stream
// fetch body. The body stream still rejects through reader.read(); this listener
// only prevents EventEmitter's unhandled "error" special case from crashing pi.
function withUndiciErrorListener(dispatcher) {
    if (dispatcher instanceof EventEmitter) {
        EventEmitter.prototype.on.call(dispatcher, "error", ignoreUndiciDispatcherError);
    }
    return dispatcher;
}
function createUndiciClient(origin, options) {
    return withUndiciErrorListener(new undici.Client(origin, options));
}
function createUndiciOriginDispatcher(origin, options) {
    const dispatcherOptions = options;
    if (dispatcherOptions.connections === 1) {
        return createUndiciClient(origin, dispatcherOptions);
    }
    return withUndiciErrorListener(new undici.Pool(origin, {
        ...dispatcherOptions,
        factory: createUndiciClient,
    }));
}
export function configureHttpDispatcher(timeoutMs = DEFAULT_HTTP_IDLE_TIMEOUT_MS) {
    const normalizedTimeoutMs = parseHttpIdleTimeoutMs(timeoutMs);
    if (normalizedTimeoutMs === undefined) {
        throw new Error(`Invalid HTTP idle timeout: ${String(timeoutMs)}`);
    }
    const dispatcher = withUndiciErrorListener(new undici.EnvHttpProxyAgent({
        allowH2: false,
        bodyTimeout: normalizedTimeoutMs,
        headersTimeout: normalizedTimeoutMs,
        clientFactory: createUndiciClient,
        factory: createUndiciOriginDispatcher,
    }));
    undici.setGlobalDispatcher(dispatcher);
    // Keep fetch and the dispatcher on the same undici implementation. Node 26.0's
    // bundled fetch can otherwise consume compressed responses through npm undici's
    // dispatcher without decompressing them, causing response.json() failures.
    // If a caller replaced fetch after module load, preserve that deliberate override.
    const shouldInstallGlobals = installedGlobalFetch === undefined
        ? globalThis.fetch === originalGlobalFetch
        : globalThis.fetch === installedGlobalFetch;
    if (shouldInstallGlobals) {
        undici.install?.();
        installedGlobalFetch = globalThis.fetch;
    }
}
//# sourceMappingURL=http-dispatcher.js.map