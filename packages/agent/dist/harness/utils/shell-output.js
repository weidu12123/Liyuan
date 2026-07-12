import { ExecutionError, err, ok, toError } from "../types.js";
import { DEFAULT_MAX_BYTES, truncateTail } from "./truncate.js";
function toExecutionError(error) {
    if (error instanceof ExecutionError)
        return error;
    const cause = toError(error);
    return new ExecutionError("unknown", cause.message, cause);
}
export function sanitizeBinaryOutput(str) {
    return Array.from(str)
        .filter((char) => {
        const code = char.codePointAt(0);
        if (code === undefined)
            return false;
        if (code === 0x09 || code === 0x0a || code === 0x0d)
            return true;
        if (code <= 0x1f)
            return false;
        if (code >= 0xfff9 && code <= 0xfffb)
            return false;
        return true;
    })
        .join("");
}
export async function executeShellWithCapture(env, command, options) {
    const outputChunks = [];
    let outputBytes = 0;
    const maxOutputBytes = DEFAULT_MAX_BYTES * 2;
    const encoder = new TextEncoder();
    let totalBytes = 0;
    let fullOutputPath;
    let writeChain = Promise.resolve(ok(undefined));
    let captureError;
    const appendFullOutput = (text) => {
        if (!fullOutputPath || captureError)
            return;
        const path = fullOutputPath;
        writeChain = writeChain.then(async (previous) => {
            if (!previous.ok)
                return previous;
            const appendResult = await env.appendFile(path, text, options?.abortSignal);
            return appendResult.ok ? ok(undefined) : err(toExecutionError(appendResult.error));
        });
    };
    const ensureFullOutputFile = (initialContent) => {
        if (fullOutputPath || captureError)
            return;
        writeChain = writeChain.then(async (previous) => {
            if (!previous.ok)
                return previous;
            const tempFile = await env.createTempFile({
                prefix: "bash-",
                suffix: ".log",
                abortSignal: options?.abortSignal,
            });
            if (!tempFile.ok)
                return err(toExecutionError(tempFile.error));
            fullOutputPath = tempFile.value;
            const appendResult = await env.appendFile(tempFile.value, initialContent, options?.abortSignal);
            return appendResult.ok ? ok(undefined) : err(toExecutionError(appendResult.error));
        });
    };
    const onChunk = (chunk) => {
        try {
            totalBytes += encoder.encode(chunk).byteLength;
            const text = sanitizeBinaryOutput(chunk).replace(/\r/g, "");
            if (totalBytes > DEFAULT_MAX_BYTES && !fullOutputPath) {
                ensureFullOutputFile(outputChunks.join("") + text);
            }
            else {
                appendFullOutput(text);
            }
            outputChunks.push(text);
            outputBytes += text.length;
            while (outputBytes > maxOutputBytes && outputChunks.length > 1) {
                const removed = outputChunks.shift();
                outputBytes -= removed.length;
            }
            options?.onChunk?.(text);
        }
        catch (error) {
            captureError = toExecutionError(error);
        }
    };
    try {
        const result = await env.exec(command, {
            ...(options ?? {}),
            onStdout: onChunk,
            onStderr: onChunk,
        });
        const tailOutput = outputChunks.join("");
        const truncationResult = truncateTail(tailOutput);
        if (truncationResult.truncated && !fullOutputPath) {
            ensureFullOutputFile(tailOutput);
        }
        const writeResult = await writeChain;
        if (!writeResult.ok)
            return err(writeResult.error);
        if (captureError)
            return err(captureError);
        if (!result.ok) {
            if (result.error.code === "aborted" || options?.abortSignal?.aborted) {
                return ok({
                    output: truncationResult.truncated ? truncationResult.content : tailOutput,
                    exitCode: undefined,
                    cancelled: true,
                    truncated: truncationResult.truncated,
                    fullOutputPath,
                });
            }
            return err(result.error);
        }
        const cancelled = options?.abortSignal?.aborted ?? false;
        return ok({
            output: truncationResult.truncated ? truncationResult.content : tailOutput,
            exitCode: cancelled ? undefined : result.value.exitCode,
            cancelled,
            truncated: truncationResult.truncated,
            fullOutputPath,
        });
    }
    catch (error) {
        return err(toExecutionError(error));
    }
}
//# sourceMappingURL=shell-output.js.map