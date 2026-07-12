import { type ExecutionEnv, ExecutionError, FileError, type FileInfo, type Result } from "../types.ts";
export declare class NodeExecutionEnv implements ExecutionEnv {
    cwd: string;
    private shellPath?;
    private shellEnv?;
    constructor(options: {
        cwd: string;
        shellPath?: string;
        shellEnv?: NodeJS.ProcessEnv;
    });
    absolutePath(path: string): Promise<Result<string, FileError>>;
    joinPath(parts: string[]): Promise<Result<string, FileError>>;
    exec(command: string, options?: {
        cwd?: string;
        env?: Record<string, string>;
        timeout?: number;
        abortSignal?: AbortSignal;
        onStdout?: (chunk: string) => void;
        onStderr?: (chunk: string) => void;
    }): Promise<Result<{
        stdout: string;
        stderr: string;
        exitCode: number;
    }, ExecutionError>>;
    readTextFile(path: string, abortSignal?: AbortSignal): Promise<Result<string, FileError>>;
    readTextLines(path: string, options?: {
        maxLines?: number;
        abortSignal?: AbortSignal;
    }): Promise<Result<string[], FileError>>;
    readBinaryFile(path: string, abortSignal?: AbortSignal): Promise<Result<Uint8Array, FileError>>;
    writeFile(path: string, content: string | Uint8Array, abortSignal?: AbortSignal): Promise<Result<void, FileError>>;
    appendFile(path: string, content: string | Uint8Array): Promise<Result<void, FileError>>;
    fileInfo(path: string): Promise<Result<FileInfo, FileError>>;
    listDir(path: string, abortSignal?: AbortSignal): Promise<Result<FileInfo[], FileError>>;
    canonicalPath(path: string): Promise<Result<string, FileError>>;
    exists(path: string): Promise<Result<boolean, FileError>>;
    createDir(path: string, options?: {
        recursive?: boolean;
    }): Promise<Result<void, FileError>>;
    remove(path: string, options?: {
        recursive?: boolean;
        force?: boolean;
    }): Promise<Result<void, FileError>>;
    createTempDir(prefix?: string): Promise<Result<string, FileError>>;
    createTempFile(options?: {
        prefix?: string;
        suffix?: string;
    }): Promise<Result<string, FileError>>;
    cleanup(): Promise<void>;
}
//# sourceMappingURL=nodejs.d.ts.map