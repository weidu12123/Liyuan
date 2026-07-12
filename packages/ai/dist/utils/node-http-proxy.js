import { getProviderEnvValue } from "./provider-env.js";
const DEFAULT_PROXY_PORTS = {
    ftp: 21,
    gopher: 70,
    http: 80,
    https: 443,
    ws: 80,
    wss: 443,
};
function getProxyEnv(key, env) {
    const lowercaseKey = key.toLowerCase();
    const uppercaseKey = key.toUpperCase();
    return (env?.[lowercaseKey] ||
        env?.[uppercaseKey] ||
        getProviderEnvValue(lowercaseKey) ||
        getProviderEnvValue(uppercaseKey) ||
        "");
}
function parseProxyTargetUrl(targetUrl) {
    if (targetUrl instanceof URL) {
        return targetUrl;
    }
    try {
        return new URL(targetUrl);
    }
    catch {
        return undefined;
    }
}
function shouldProxyHostname(hostname, port, env) {
    const noProxy = getProxyEnv("no_proxy", env).toLowerCase();
    if (!noProxy) {
        return true;
    }
    if (noProxy === "*") {
        return false;
    }
    return noProxy.split(/[,\s]/).every((proxy) => {
        if (!proxy) {
            return true;
        }
        const parsedProxy = proxy.match(/^(.+):(\d+)$/);
        let proxyHostname = parsedProxy ? parsedProxy[1] : proxy;
        const proxyPort = parsedProxy ? Number.parseInt(parsedProxy[2], 10) : 0;
        if (proxyPort && proxyPort !== port) {
            return true;
        }
        if (!/^[.*]/.test(proxyHostname)) {
            return hostname !== proxyHostname;
        }
        if (proxyHostname.startsWith("*")) {
            proxyHostname = proxyHostname.slice(1);
        }
        return !hostname.endsWith(proxyHostname);
    });
}
function getProxyForUrl(targetUrl, env) {
    const parsedUrl = parseProxyTargetUrl(targetUrl);
    if (!parsedUrl?.protocol || !parsedUrl.host) {
        return "";
    }
    const protocol = parsedUrl.protocol.split(":", 1)[0];
    const hostname = parsedUrl.host.replace(/:\d*$/, "");
    const port = Number.parseInt(parsedUrl.port, 10) || DEFAULT_PROXY_PORTS[protocol] || 0;
    if (!shouldProxyHostname(hostname, port, env)) {
        return "";
    }
    let proxy = getProxyEnv(`${protocol}_proxy`, env) || getProxyEnv("all_proxy", env);
    if (proxy && !proxy.includes("://")) {
        proxy = `${protocol}://${proxy}`;
    }
    return proxy;
}
export const UNSUPPORTED_PROXY_PROTOCOL_MESSAGE = "Unsupported proxy protocol. SOCKS and PAC proxy URLs are not supported; use an HTTP or HTTPS proxy URL.";
export function resolveHttpProxyUrlForTarget(targetUrl, env) {
    const proxy = getProxyForUrl(targetUrl, env);
    if (!proxy) {
        return undefined;
    }
    let proxyUrl;
    try {
        proxyUrl = new URL(proxy);
    }
    catch (error) {
        throw new Error(`Invalid proxy URL ${JSON.stringify(proxy)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (proxyUrl.protocol !== "http:" && proxyUrl.protocol !== "https:") {
        throw new Error(`${UNSUPPORTED_PROXY_PROTOCOL_MESSAGE} Got ${proxyUrl.protocol}`);
    }
    return proxyUrl;
}
//# sourceMappingURL=node-http-proxy.js.map