// Shared normalization for provider HTTP error objects.
//
// Endpoints behind a proxy / gateway may return a non-2xx response whose body
// the provider SDK cannot fold into `error.message`. The SDK error object still
// carries the HTTP status and the raw/parsed body, but under SDK-specific field
// names. Provider catch blocks that read only `error.message` therefore drop
// the body and surface opaque messages like `"403 status code (no body)"` or
// collapse to `"Unknown: UnknownError"`.
//
// `normalizeProviderError` probes the known SDK field shapes (Mistral,
// `openai`, `@google/genai`, AWS Bedrock) and returns a struct each provider
// composes into its display string. The `messageCarriesBody` flag captures the
// Anthropic / `@google/genai` happy path where the SDK already folded the body
// into the message, so providers can preserve it without double-printing.
export const MAX_PROVIDER_ERROR_BODY_CHARS = 4000;
export function normalizeProviderError(error) {
    if (!(error instanceof Error)) {
        return { message: safeJsonStringify(error), messageCarriesBody: false };
    }
    const sdkError = error;
    const status = extractStatus(sdkError);
    const body = extractBody(sdkError);
    const messageCarriesBody = body === undefined || error.message.includes(body);
    return {
        status,
        body,
        message: error.message,
        messageCarriesBody,
    };
}
/**
 * Probe the HTTP status, first numeric hit wins, in SDK-field order:
 * `statusCode` (Mistral) → `status` (`openai`, `@google/genai`) →
 * `$metadata.httpStatusCode` (Bedrock) → `$response.statusCode` (Bedrock).
 */
function extractStatus(error) {
    if (typeof error.statusCode === "number")
        return error.statusCode;
    if (typeof error.status === "number")
        return error.status;
    if (typeof error.$metadata?.httpStatusCode === "number")
        return error.$metadata.httpStatusCode;
    if (typeof error.$response?.statusCode === "number")
        return error.$response.statusCode;
    return undefined;
}
/**
 * Probe the raw body reason, first usable hit wins, in SDK-field order:
 * `body` string (Mistral) → `error` parsed JSON body object (`openai` SDK's
 * `this.error`) → `$response.body` (Bedrock). Empty objects are treated as no
 * body so an empty parsed body does not surface as `"{}"`. The chosen body is
 * truncated to the cap.
 */
function extractBody(error) {
    const bodyText = pickBodyText(error);
    if (bodyText === undefined)
        return undefined;
    const trimmed = bodyText.trim();
    if (trimmed.length === 0)
        return undefined;
    return truncateErrorText(trimmed, MAX_PROVIDER_ERROR_BODY_CHARS);
}
function pickBodyText(error) {
    if (typeof error.body === "string")
        return error.body;
    if (isNonEmptyObject(error.error))
        return safeJsonStringify(error.error);
    const responseBody = error.$response?.body;
    if (typeof responseBody === "string")
        return responseBody;
    if (isNonEmptyObject(responseBody))
        return safeJsonStringify(responseBody);
    return undefined;
}
function isNonEmptyObject(value) {
    return typeof value === "object" && value !== null && Object.keys(value).length > 0;
}
/**
 * Compose a display string from a normalized error. When the message already
 * carries the body (Anthropic / `@google/genai` happy path) or no body/status
 * was extracted, the message is returned unchanged. Otherwise the status and
 * body are surfaced, with an optional provider prefix.
 *
 * - no prefix: `"<status>: <body>"`
 * - prefix:    `"<prefix> (<status>): <body>"`
 */
export function formatProviderError(norm, prefix) {
    if (norm.messageCarriesBody || norm.status === undefined || norm.body === undefined) {
        return prefix !== undefined && norm.status !== undefined
            ? `${prefix} (${norm.status}): ${norm.message}`
            : norm.message;
    }
    return prefix !== undefined ? `${prefix} (${norm.status}): ${norm.body}` : `${norm.status}: ${norm.body}`;
}
export function truncateErrorText(text, maxChars) {
    if (text.length <= maxChars)
        return text;
    return `${text.slice(0, maxChars)}... [truncated ${text.length - maxChars} chars]`;
}
export function safeJsonStringify(value) {
    try {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? String(value) : serialized;
    }
    catch {
        return String(value);
    }
}
//# sourceMappingURL=error-body.js.map