import { type ExecutionEnv, type Skill } from "./types.ts";
export type SkillDiagnosticCode = "file_info_failed" | "list_failed" | "read_failed" | "parse_failed" | "invalid_metadata";
/** Warning produced while loading skills. */
export interface SkillDiagnostic {
    /** Diagnostic severity. Currently only warnings are emitted. */
    type: "warning";
    /** Stable diagnostic code. */
    code: SkillDiagnosticCode;
    /** Human-readable diagnostic message. */
    message: string;
    /** Path associated with the diagnostic. */
    path: string;
}
/** Format a skill invocation prompt, optionally appending additional user instructions. */
export declare function formatSkillInvocation(skill: Skill, additionalInstructions?: string): string;
/**
 * Load skills from one or more directories.
 *
 * Traverses directories recursively, loads `SKILL.md` files, loads direct root `.md` files as skills, honors ignore files,
 * and returns diagnostics for invalid skill files. Missing input directories are skipped.
 */
export declare function loadSkills(env: ExecutionEnv, dirs: string | string[]): Promise<{
    skills: Skill[];
    diagnostics: SkillDiagnostic[];
}>;
/**
 * Load skills from source-tagged directories.
 *
 * Source values are preserved exactly and attached to every loaded skill and diagnostic. The agent package does not
 * interpret source values; applications define their own provenance shape.
 */
export declare function loadSourcedSkills<TSource, TSkill extends Skill = Skill>(env: ExecutionEnv, inputs: Array<{
    path: string;
    source: TSource;
}>, mapSkill?: (skill: Skill, source: TSource) => TSkill): Promise<{
    skills: Array<{
        skill: TSkill;
        source: TSource;
    }>;
    diagnostics: Array<SkillDiagnostic & {
        source: TSource;
    }>;
}>;
//# sourceMappingURL=skills.d.ts.map