import { type ExecutionEnv, ExecutionError, type Result, type ShellExecOptions } from "../types.ts";
export interface ShellCaptureOptions extends Omit<ShellExecOptions, "onStdout" | "onStderr"> {
    onChunk?: (chunk: string) => void;
}
export interface ShellCaptureResult {
    output: string;
    exitCode: number | undefined;
    cancelled: boolean;
    truncated: boolean;
    fullOutputPath?: string;
}
export declare function sanitizeBinaryOutput(str: string): string;
export declare function executeShellWithCapture(env: ExecutionEnv, command: string, options?: ShellCaptureOptions): Promise<Result<ShellCaptureResult, ExecutionError>>;
//# sourceMappingURL=shell-output.d.ts.map