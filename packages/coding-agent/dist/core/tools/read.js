import { basename, dirname, isAbsolute, relative, resolve as resolvePath, sep } from "node:path";
import { Text } from "@liyuan/tui";
import { constants } from "fs";
import { access as fsAccess, readFile as fsReadFile } from "fs/promises";
import { Type } from "typebox";
import { getReadmePath } from "../../config.js";
import { keyHint, keyText } from "../../modes/interactive/components/keybinding-hints.js";
import { getLanguageFromPath, highlightCode } from "../../modes/interactive/theme/theme.js";
import { processImage } from "../../utils/image-process.js";
import { detectSupportedImageMimeTypeFromFile } from "../../utils/mime.js";
import { formatPathRelativeToCwdOrAbsolute } from "../../utils/paths.js";
import { resolveReadPathAsync, resolveToCwd } from "./path-utils.js";
import { getTextOutput, renderToolPath, replaceTabs, str } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "./truncate.js";
const readSchema = Type.Object({
    path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
    offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
    limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});
const COMPACT_RESOURCE_FILE_NAMES = new Set(["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]);
const defaultReadOperations = {
    readFile: (path) => fsReadFile(path),
    access: (path) => fsAccess(path, constants.R_OK),
    detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};
function formatReadLineRange(args, theme) {
    if (args?.offset === undefined && args?.limit === undefined)
        return "";
    const startLine = args.offset ?? 1;
    const endLine = args.limit !== undefined ? startLine + args.limit - 1 : "";
    return theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
}
function formatReadCall(args, theme, cwd) {
    const pathDisplay = renderToolPath(str(args?.file_path ?? args?.path), theme, cwd);
    return `${theme.fg("toolTitle", theme.bold("read"))} ${pathDisplay}${formatReadLineRange(args, theme)}`;
}
function trimTrailingEmptyLines(lines) {
    let end = lines.length;
    while (end > 0 && lines[end - 1] === "") {
        end--;
    }
    return lines.slice(0, end);
}
function getNonVisionImageNote(model) {
    if (!model || model.input.includes("image")) {
        return undefined;
    }
    return "[Current model does not support images. The image will be omitted from this request.]";
}
function toPosixPath(filePath) {
    return filePath.split(sep).join("/");
}
function getPiDocsClassification(absolutePath) {
    const packageRoot = dirname(getReadmePath());
    const relativePath = relative(resolvePath(packageRoot), resolvePath(absolutePath));
    if (relativePath === "" ||
        relativePath === ".." ||
        relativePath.startsWith(`..${sep}`) ||
        isAbsolute(relativePath)) {
        return undefined;
    }
    const label = toPosixPath(relativePath);
    if (label === "README.md" || label.startsWith("docs/") || label.startsWith("examples/")) {
        return { kind: "docs", label };
    }
    return undefined;
}
function getCompactReadClassification(args, cwd) {
    const rawPath = str(args?.file_path ?? args?.path);
    if (!rawPath)
        return undefined;
    const absolutePath = resolveToCwd(rawPath, cwd);
    const fileName = basename(absolutePath);
    if (fileName === "SKILL.md") {
        return { kind: "skill", label: basename(dirname(absolutePath)) || fileName };
    }
    const docsClassification = getPiDocsClassification(absolutePath);
    if (docsClassification)
        return docsClassification;
    if (COMPACT_RESOURCE_FILE_NAMES.has(fileName)) {
        return { kind: "resource", label: formatPathRelativeToCwdOrAbsolute(absolutePath, cwd) };
    }
    return undefined;
}
function formatCompactReadCall(classification, args, theme) {
    const expandHint = theme.fg("dim", ` (${keyText("app.tools.expand")} to expand)`);
    if (classification.kind === "skill") {
        return (theme.fg("customMessageLabel", `\x1b[1m[skill]\x1b[22m `) +
            theme.fg("customMessageText", classification.label) +
            formatReadLineRange(args, theme) +
            expandHint);
    }
    return (theme.fg("toolTitle", theme.bold(`read ${classification.kind}`)) +
        " " +
        theme.fg("accent", classification.label) +
        formatReadLineRange(args, theme) +
        expandHint);
}
function formatReadResult(args, result, options, theme, showImages, _cwd, isError) {
    if (!options.expanded && !isError) {
        return "";
    }
    const rawPath = str(args?.file_path ?? args?.path);
    const output = getTextOutput(result, showImages);
    const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
    const renderedLines = lang ? highlightCode(replaceTabs(output), lang) : output.split("\n");
    const lines = trimTrailingEmptyLines(renderedLines);
    const maxLines = options.expanded ? lines.length : 10;
    const displayLines = lines.slice(0, maxLines);
    const remaining = lines.length - maxLines;
    let text = `\n${displayLines.map((line) => (lang ? replaceTabs(line) : theme.fg("toolOutput", replaceTabs(line)))).join("\n")}`;
    if (remaining > 0) {
        text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
    }
    const truncation = result.details?.truncation;
    if (truncation?.truncated) {
        if (truncation.firstLineExceedsLimit) {
            text += `\n${theme.fg("warning", `[First line exceeds ${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit]`)}`;
        }
        else if (truncation.truncatedBy === "lines") {
            text += `\n${theme.fg("warning", `[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${truncation.maxLines ?? DEFAULT_MAX_LINES} line limit)]`)}`;
        }
        else {
            text += `\n${theme.fg("warning", `[Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)]`)}`;
        }
    }
    return text;
}
export function createReadToolDefinition(cwd, options) {
    const autoResizeImages = options?.autoResizeImages ?? true;
    const ops = options?.operations ?? defaultReadOperations;
    return {
        name: "read",
        label: "read",
        description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
        promptSnippet: "Read file contents",
        promptGuidelines: ["Use read to examine files instead of cat or sed."],
        parameters: readSchema,
        async execute(_toolCallId, { path, offset, limit }, signal, _onUpdate, ctx) {
            return new Promise((resolve, reject) => {
                if (signal?.aborted) {
                    reject(new Error("Operation aborted"));
                    return;
                }
                let aborted = false;
                const onAbort = () => {
                    aborted = true;
                    reject(new Error("Operation aborted"));
                };
                signal?.addEventListener("abort", onAbort, { once: true });
                (async () => {
                    try {
                        const absolutePath = await resolveReadPathAsync(path, cwd);
                        if (aborted)
                            return;
                        // Check if file exists and is readable.
                        await ops.access(absolutePath);
                        if (aborted)
                            return;
                        const mimeType = ops.detectImageMimeType ? await ops.detectImageMimeType(absolutePath) : undefined;
                        let content;
                        let details;
                        const nonVisionImageNote = getNonVisionImageNote(ctx?.model);
                        if (mimeType) {
                            // Read image as binary.
                            const buffer = await ops.readFile(absolutePath);
                            const processed = await processImage(buffer, mimeType, { autoResizeImages });
                            if (!processed.ok) {
                                let textNote = `Read image file [${mimeType}]\n${processed.message}`;
                                if (nonVisionImageNote)
                                    textNote += `\n${nonVisionImageNote}`;
                                content = [{ type: "text", text: textNote }];
                            }
                            else {
                                let textNote = `Read image file [${processed.mimeType}]`;
                                if (processed.hints.length > 0)
                                    textNote += `\n${processed.hints.join("\n")}`;
                                if (nonVisionImageNote)
                                    textNote += `\n${nonVisionImageNote}`;
                                content = [
                                    { type: "text", text: textNote },
                                    { type: "image", data: processed.data, mimeType: processed.mimeType },
                                ];
                            }
                        }
                        else {
                            // Read text content.
                            const buffer = await ops.readFile(absolutePath);
                            const textContent = buffer.toString("utf-8");
                            const allLines = textContent.split("\n");
                            const totalFileLines = allLines.length;
                            // Apply offset if specified. Convert from 1-indexed input to 0-indexed array access.
                            const startLine = offset ? Math.max(0, offset - 1) : 0;
                            const startLineDisplay = startLine + 1;
                            // Check if offset is out of bounds.
                            if (startLine >= allLines.length) {
                                throw new Error(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`);
                            }
                            let selectedContent;
                            let userLimitedLines;
                            // If limit is specified by the user, honor it first. Otherwise truncateHead decides.
                            if (limit !== undefined) {
                                const endLine = Math.min(startLine + limit, allLines.length);
                                selectedContent = allLines.slice(startLine, endLine).join("\n");
                                userLimitedLines = endLine - startLine;
                            }
                            else {
                                selectedContent = allLines.slice(startLine).join("\n");
                            }
                            // Apply truncation, respecting both line and byte limits.
                            const truncation = truncateHead(selectedContent);
                            let outputText;
                            if (truncation.firstLineExceedsLimit) {
                                // First line alone exceeds the byte limit. Point the model at a bash fallback.
                                const firstLineSize = formatSize(Buffer.byteLength(allLines[startLine], "utf-8"));
                                outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${path} | head -c ${DEFAULT_MAX_BYTES}]`;
                                details = { truncation };
                            }
                            else if (truncation.truncated) {
                                // Truncation occurred. Build an actionable continuation notice.
                                const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
                                const nextOffset = endLineDisplay + 1;
                                outputText = truncation.content;
                                if (truncation.truncatedBy === "lines") {
                                    outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`;
                                }
                                else {
                                    outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
                                }
                                details = { truncation };
                            }
                            else if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
                                // User-specified limit stopped early, but the file still has more content.
                                const remaining = allLines.length - (startLine + userLimitedLines);
                                const nextOffset = startLine + userLimitedLines + 1;
                                outputText = `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
                            }
                            else {
                                // No truncation and no remaining user-limited content.
                                outputText = truncation.content;
                            }
                            content = [{ type: "text", text: outputText }];
                        }
                        if (aborted)
                            return;
                        signal?.removeEventListener("abort", onAbort);
                        resolve({ content, details });
                    }
                    catch (error) {
                        signal?.removeEventListener("abort", onAbort);
                        if (!aborted)
                            reject(error);
                    }
                })();
            });
        },
        renderCall(args, theme, context) {
            const text = context.lastComponent ?? new Text("", 0, 0);
            const classification = !context.expanded ? getCompactReadClassification(args, context.cwd) : undefined;
            text.setText(classification
                ? formatCompactReadCall(classification, args, theme)
                : formatReadCall(args, theme, context.cwd));
            return text;
        },
        renderResult(result, options, theme, context) {
            const text = context.lastComponent ?? new Text("", 0, 0);
            text.setText(formatReadResult(context.args, result, options, theme, context.showImages, context.cwd, context.isError));
            return text;
        },
    };
}
export function createReadTool(cwd, options) {
    return wrapToolDefinition(createReadToolDefinition(cwd, options));
}
//# sourceMappingURL=read.js.map