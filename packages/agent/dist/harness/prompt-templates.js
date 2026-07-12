import { parse } from "yaml";
import { toError } from "./types.js";
/**
 * Load prompt templates from one or more paths.
 *
 * Directory inputs load direct `.md` children non-recursively. File inputs load explicit `.md` files. Missing paths and
 * non-markdown files are skipped. Read and parse failures are returned as diagnostics.
 */
export async function loadPromptTemplates(env, paths) {
    const promptTemplates = [];
    const diagnostics = [];
    for (const path of Array.isArray(paths) ? paths : [paths]) {
        const infoResult = await env.fileInfo(path);
        if (!infoResult.ok) {
            if (infoResult.error.code !== "not_found") {
                diagnostics.push({
                    type: "warning",
                    code: "file_info_failed",
                    message: infoResult.error.message,
                    path,
                });
            }
            continue;
        }
        const info = infoResult.value;
        const kind = await resolveKind(env, info, diagnostics);
        if (kind === "directory") {
            const result = await loadTemplatesFromDir(env, info.path);
            promptTemplates.push(...result.promptTemplates);
            diagnostics.push(...result.diagnostics);
        }
        else if (kind === "file" && info.name.endsWith(".md")) {
            const result = await loadTemplateFromFile(env, info.path);
            if (result.promptTemplate)
                promptTemplates.push(result.promptTemplate);
            diagnostics.push(...result.diagnostics);
        }
    }
    return { promptTemplates, diagnostics };
}
/**
 * Load prompt templates from source-tagged paths.
 *
 * Source values are preserved exactly and attached to every loaded prompt template and diagnostic. The agent package does
 * not interpret source values; applications define their own provenance shape.
 */
export async function loadSourcedPromptTemplates(env, inputs, mapPromptTemplate) {
    const promptTemplates = [];
    const diagnostics = [];
    for (const input of inputs) {
        const result = await loadPromptTemplates(env, input.path);
        for (const promptTemplate of result.promptTemplates) {
            promptTemplates.push({
                promptTemplate: mapPromptTemplate
                    ? mapPromptTemplate(promptTemplate, input.source)
                    : promptTemplate,
                source: input.source,
            });
        }
        for (const diagnostic of result.diagnostics)
            diagnostics.push({ ...diagnostic, source: input.source });
    }
    return { promptTemplates, diagnostics };
}
async function loadTemplatesFromDir(env, dir) {
    const promptTemplates = [];
    const diagnostics = [];
    const entriesResult = await env.listDir(dir);
    if (!entriesResult.ok) {
        diagnostics.push({
            type: "warning",
            code: "list_failed",
            message: entriesResult.error.message,
            path: dir,
        });
        return { promptTemplates, diagnostics };
    }
    const entries = entriesResult.value;
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const kind = await resolveKind(env, entry, diagnostics);
        if (kind !== "file" || !entry.name.endsWith(".md"))
            continue;
        const result = await loadTemplateFromFile(env, entry.path);
        if (result.promptTemplate)
            promptTemplates.push(result.promptTemplate);
        diagnostics.push(...result.diagnostics);
    }
    return { promptTemplates, diagnostics };
}
async function loadTemplateFromFile(env, filePath) {
    const diagnostics = [];
    const rawContent = await env.readTextFile(filePath);
    if (!rawContent.ok) {
        diagnostics.push({
            type: "warning",
            code: "read_failed",
            message: rawContent.error.message,
            path: filePath,
        });
        return { promptTemplate: null, diagnostics };
    }
    const parsed = parseFrontmatter(rawContent.value);
    if (!parsed.ok) {
        diagnostics.push({
            type: "warning",
            code: "parse_failed",
            message: parsed.error.message,
            path: filePath,
        });
        return { promptTemplate: null, diagnostics };
    }
    const { frontmatter, body } = parsed.value;
    const firstLine = body.split("\n").find((line) => line.trim());
    let description = typeof frontmatter.description === "string" ? frontmatter.description : "";
    if (!description && firstLine) {
        description = firstLine.slice(0, 60);
        if (firstLine.length > 60)
            description += "...";
    }
    return {
        promptTemplate: {
            name: basenameEnvPath(filePath).replace(/\.md$/i, ""),
            description,
            content: body,
        },
        diagnostics,
    };
}
async function resolveKind(env, info, diagnostics) {
    if (info.kind === "file" || info.kind === "directory")
        return info.kind;
    const canonicalPath = await env.canonicalPath(info.path);
    if (!canonicalPath.ok) {
        if (canonicalPath.error.code !== "not_found") {
            diagnostics.push({
                type: "warning",
                code: "file_info_failed",
                message: canonicalPath.error.message,
                path: info.path,
            });
        }
        return undefined;
    }
    const target = await env.fileInfo(canonicalPath.value);
    if (!target.ok) {
        if (target.error.code !== "not_found") {
            diagnostics.push({
                type: "warning",
                code: "file_info_failed",
                message: target.error.message,
                path: info.path,
            });
        }
        return undefined;
    }
    return target.value.kind === "file" || target.value.kind === "directory" ? target.value.kind : undefined;
}
function parseFrontmatter(content) {
    try {
        const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        if (!normalized.startsWith("---"))
            return { ok: true, value: { frontmatter: {}, body: normalized } };
        const endIndex = normalized.indexOf("\n---", 3);
        if (endIndex === -1)
            return { ok: true, value: { frontmatter: {}, body: normalized } };
        const yamlString = normalized.slice(4, endIndex);
        const body = normalized.slice(endIndex + 4).trim();
        return { ok: true, value: { frontmatter: (parse(yamlString) ?? {}), body } };
    }
    catch (error) {
        return { ok: false, error: toError(error) };
    }
}
function basenameEnvPath(path) {
    const normalized = path.replace(/\/+$/, "");
    const slashIndex = normalized.lastIndexOf("/");
    return slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
}
/** Parse an argument string using simple shell-style single and double quotes. */
export function parseCommandArgs(argsString) {
    const args = [];
    let current = "";
    let inQuote = null;
    for (let i = 0; i < argsString.length; i++) {
        const char = argsString[i];
        if (inQuote) {
            if (char === inQuote)
                inQuote = null;
            else
                current += char;
        }
        else if (char === '"' || char === "'") {
            inQuote = char;
        }
        else if (char === " " || char === "\t") {
            if (current) {
                args.push(current);
                current = "";
            }
        }
        else {
            current += char;
        }
    }
    if (current)
        args.push(current);
    return args;
}
/** Substitute prompt template placeholders (`$1`, `$@`, `$ARGUMENTS`, `${@:N}`, `${@:N:L}`) with command arguments. */
export function substituteArgs(content, args) {
    let result = content;
    result = result.replace(/\$(\d+)/g, (_, num) => args[parseInt(num, 10) - 1] ?? "");
    result = result.replace(/\$\{@:(\d+)(?::(\d+))?\}/g, (_, startStr, lengthStr) => {
        let start = parseInt(startStr, 10) - 1;
        if (start < 0)
            start = 0;
        if (lengthStr)
            return args.slice(start, start + parseInt(lengthStr, 10)).join(" ");
        return args.slice(start).join(" ");
    });
    const allArgs = args.join(" ");
    result = result.replace(/\$ARGUMENTS/g, allArgs);
    result = result.replace(/\$@/g, allArgs);
    return result;
}
/** Format a prompt template invocation with positional arguments. */
export function formatPromptTemplateInvocation(template, args = []) {
    return substituteArgs(template.content, args);
}
//# sourceMappingURL=prompt-templates.js.map