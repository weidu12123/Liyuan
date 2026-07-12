import { type ExecutionEnv, type PromptTemplate } from "./types.ts";
export type PromptTemplateDiagnosticCode = "file_info_failed" | "list_failed" | "read_failed" | "parse_failed";
/** Warning produced while loading prompt templates. */
export interface PromptTemplateDiagnostic {
    /** Diagnostic severity. Currently only warnings are emitted. */
    type: "warning";
    /** Stable diagnostic code. */
    code: PromptTemplateDiagnosticCode;
    /** Human-readable diagnostic message. */
    message: string;
    /** Path associated with the diagnostic. */
    path: string;
}
/**
 * Load prompt templates from one or more paths.
 *
 * Directory inputs load direct `.md` children non-recursively. File inputs load explicit `.md` files. Missing paths and
 * non-markdown files are skipped. Read and parse failures are returned as diagnostics.
 */
export declare function loadPromptTemplates(env: ExecutionEnv, paths: string | string[]): Promise<{
    promptTemplates: PromptTemplate[];
    diagnostics: PromptTemplateDiagnostic[];
}>;
/**
 * Load prompt templates from source-tagged paths.
 *
 * Source values are preserved exactly and attached to every loaded prompt template and diagnostic. The agent package does
 * not interpret source values; applications define their own provenance shape.
 */
export declare function loadSourcedPromptTemplates<TSource, TPromptTemplate extends PromptTemplate = PromptTemplate>(env: ExecutionEnv, inputs: Array<{
    path: string;
    source: TSource;
}>, mapPromptTemplate?: (promptTemplate: PromptTemplate, source: TSource) => TPromptTemplate): Promise<{
    promptTemplates: Array<{
        promptTemplate: TPromptTemplate;
        source: TSource;
    }>;
    diagnostics: Array<PromptTemplateDiagnostic & {
        source: TSource;
    }>;
}>;
/** Parse an argument string using simple shell-style single and double quotes. */
export declare function parseCommandArgs(argsString: string): string[];
/** Substitute prompt template placeholders (`$1`, `$@`, `$ARGUMENTS`, `${@:N}`, `${@:N:L}`) with command arguments. */
export declare function substituteArgs(content: string, args: string[]): string;
/** Format a prompt template invocation with positional arguments. */
export declare function formatPromptTemplateInvocation(template: PromptTemplate, args?: string[]): string;
//# sourceMappingURL=prompt-templates.d.ts.map