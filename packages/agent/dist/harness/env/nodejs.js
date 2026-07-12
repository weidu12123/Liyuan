import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, appendFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile, } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { ExecutionError, err, FileError, ok, toError, } from "../types.js";
function resolvePath(cwd, path) {
    return isAbsolute(path) ? path : resolve(cwd, path);
}
function fileKindFromStats(stats) {
    if (stats.isFile())
        return "file";
    if (stats.isDirectory())
        return "directory";
    if (stats.isSymbolicLink())
        return "symlink";
    return undefined;
}
function fileInfoFromStats(path, stats) {
    const kind = fileKindFromStats(stats);
    if (!kind)
        return err(new FileError("invalid", "Unsupported file type", path));
    return ok({
        name: path.replace(/\/+$/, "").split("/").pop() ?? path,
        path,
        kind,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
    });
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
function toFileError(error, path) {
    if (error instanceof FileError)
        return error;
    const cause = toError(error);
    if (isNodeError(error)) {
        const message = error.message;
        switch (error.code) {
            case "ABORT_ERR":
                return new FileError("aborted", message, path, cause);
            case "ENOENT":
                return new FileError("not_found", message, path, cause);
            case "EACCES":
            case "EPERM":
                return new FileError("permission_denied", message, path, cause);
            case "ENOTDIR":
                return new FileError("not_directory", message, path, cause);
            case "EISDIR":
                return new FileError("is_directory", message, path, cause);
            case "EINVAL":
                return new FileError("invalid", message, path, cause);
        }
    }
    return new FileError("unknown", cause.message, path, cause);
}
function abortResult(signal, path) {
    return signal?.aborted ? err(new FileError("aborted", "aborted", path)) : undefined;
}
async function pathExists(path) {
    try {
        await access(path, constants.F_OK);
        return true;
    }
    catch {
        return false;
    }
}
async function runCommand(command, args, timeoutMs) {
    return await new Promise((resolve) => {
        let stdout = "";
        let child;
        try {
            child = spawn(command, args, {
                stdio: ["ignore", "pipe", "ignore"],
                windowsHide: true,
            });
        }
        catch {
            resolve({ stdout: "", status: null });
            return;
        }
        const timeout = setTimeout(() => {
            if (child.pid)
                killProcessTree(child.pid);
        }, timeoutMs);
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk) => {
            stdout += chunk;
        });
        child.on("error", () => {
            clearTimeout(timeout);
            resolve({ stdout: "", status: null });
        });
        child.on("close", (status) => {
            clearTimeout(timeout);
            resolve({ stdout, status });
        });
    });
}
async function findBashOnPath() {
    const result = process.platform === "win32"
        ? await runCommand("where", ["bash.exe"], 5000)
        : await runCommand("which", ["bash"], 5000);
    if (result.status !== 0 || !result.stdout)
        return null;
    const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
    return firstMatch && (await pathExists(firstMatch)) ? firstMatch : null;
}
function isLegacyWslBashPath(path) {
    const normalized = path.replace(/\//g, "\\").toLowerCase();
    return /^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/.test(normalized);
}
function getBashShellConfig(shell) {
    return isLegacyWslBashPath(shell) ? { shell, args: ["-s"], commandTransport: "stdin" } : { shell, args: ["-c"] };
}
async function getShellConfig(customShellPath) {
    if (customShellPath) {
        if (await pathExists(customShellPath)) {
            return ok(getBashShellConfig(customShellPath));
        }
        return err(new ExecutionError("shell_unavailable", `Custom shell path not found: ${customShellPath}`));
    }
    if (process.platform === "win32") {
        const candidates = [];
        const programFiles = process.env.ProgramFiles;
        if (programFiles)
            candidates.push(`${programFiles}\\Git\\bin\\bash.exe`);
        const programFilesX86 = process.env["ProgramFiles(x86)"];
        if (programFilesX86)
            candidates.push(`${programFilesX86}\\Git\\bin\\bash.exe`);
        for (const candidate of candidates) {
            if (await pathExists(candidate)) {
                return ok(getBashShellConfig(candidate));
            }
        }
        const bashOnPath = await findBashOnPath();
        if (bashOnPath) {
            return ok(getBashShellConfig(bashOnPath));
        }
        return err(new ExecutionError("shell_unavailable", "No bash shell found"));
    }
    if (await pathExists("/bin/bash")) {
        return ok(getBashShellConfig("/bin/bash"));
    }
    const bashOnPath = await findBashOnPath();
    if (bashOnPath) {
        return ok(getBashShellConfig(bashOnPath));
    }
    return ok({ shell: "sh", args: ["-c"] });
}
function getShellEnv(baseEnv, extraEnv) {
    return {
        ...process.env,
        ...baseEnv,
        ...extraEnv,
    };
}
function killProcessTree(pid) {
    if (process.platform === "win32") {
        try {
            spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
                stdio: "ignore",
                detached: true,
                windowsHide: true,
            });
        }
        catch {
            // Ignore errors.
        }
        return;
    }
    try {
        process.kill(-pid, "SIGKILL");
    }
    catch {
        try {
            process.kill(pid, "SIGKILL");
        }
        catch {
            // Process already dead.
        }
    }
}
export class NodeExecutionEnv {
    cwd;
    shellPath;
    shellEnv;
    constructor(options) {
        this.cwd = options.cwd;
        this.shellPath = options.shellPath;
        this.shellEnv = options.shellEnv;
    }
    async absolutePath(path) {
        return ok(resolvePath(this.cwd, path));
    }
    async joinPath(parts) {
        return ok(join(...parts));
    }
    async exec(command, options) {
        if (options?.abortSignal?.aborted)
            return err(new ExecutionError("aborted", "aborted"));
        const cwd = options?.cwd ? resolvePath(this.cwd, options.cwd) : this.cwd;
        const shellConfig = await getShellConfig(this.shellPath);
        if (!shellConfig.ok)
            return shellConfig;
        return await new Promise((resolvePromise) => {
            let stdout = "";
            let stderr = "";
            let settled = false;
            let timedOut = false;
            let callbackError;
            let child;
            let timeoutId;
            const onAbort = () => {
                if (child?.pid) {
                    killProcessTree(child.pid);
                }
            };
            const settle = (result) => {
                if (timeoutId)
                    clearTimeout(timeoutId);
                if (options?.abortSignal)
                    options.abortSignal.removeEventListener("abort", onAbort);
                if (settled)
                    return;
                settled = true;
                resolvePromise(result);
            };
            try {
                const commandFromStdin = shellConfig.value.commandTransport === "stdin";
                child = spawn(shellConfig.value.shell, commandFromStdin ? shellConfig.value.args : [...shellConfig.value.args, command], {
                    cwd,
                    detached: process.platform !== "win32",
                    env: getShellEnv(this.shellEnv, options?.env),
                    stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
                    windowsHide: true,
                });
                if (commandFromStdin) {
                    child.stdin?.on("error", () => { });
                    child.stdin?.end(command);
                }
            }
            catch (error) {
                const cause = toError(error);
                settle(err(new ExecutionError("spawn_error", cause.message, cause)));
                return;
            }
            timeoutId =
                typeof options?.timeout === "number"
                    ? setTimeout(() => {
                        timedOut = true;
                        if (child?.pid) {
                            killProcessTree(child.pid);
                        }
                    }, options.timeout * 1000)
                    : undefined;
            if (options?.abortSignal) {
                if (options.abortSignal.aborted) {
                    onAbort();
                }
                else {
                    options.abortSignal.addEventListener("abort", onAbort, { once: true });
                }
            }
            child.stdout?.setEncoding("utf8");
            child.stderr?.setEncoding("utf8");
            child.stdout?.on("data", (chunk) => {
                stdout += chunk;
                try {
                    options?.onStdout?.(chunk);
                }
                catch (error) {
                    const cause = toError(error);
                    callbackError = new ExecutionError("callback_error", cause.message, cause);
                    onAbort();
                }
            });
            child.stderr?.on("data", (chunk) => {
                stderr += chunk;
                try {
                    options?.onStderr?.(chunk);
                }
                catch (error) {
                    const cause = toError(error);
                    callbackError = new ExecutionError("callback_error", cause.message, cause);
                    onAbort();
                }
            });
            child.on("error", (error) => {
                settle(err(new ExecutionError("spawn_error", error.message, error)));
            });
            child.on("close", (code) => {
                if (callbackError) {
                    settle(err(callbackError));
                    return;
                }
                if (timedOut) {
                    settle(err(new ExecutionError("timeout", `timeout:${options?.timeout}`)));
                    return;
                }
                if (options?.abortSignal?.aborted) {
                    settle(err(new ExecutionError("aborted", "aborted")));
                    return;
                }
                settle(ok({ stdout, stderr, exitCode: code ?? 0 }));
            });
        });
    }
    async readTextFile(path, abortSignal) {
        const resolved = resolvePath(this.cwd, path);
        const aborted = abortResult(abortSignal, resolved);
        if (aborted)
            return aborted;
        try {
            return ok(await readFile(resolved, { encoding: "utf8", signal: abortSignal }));
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async readTextLines(path, options) {
        const resolved = resolvePath(this.cwd, path);
        const aborted = abortResult(options?.abortSignal, resolved);
        if (aborted)
            return aborted;
        if (options?.maxLines !== undefined && options.maxLines <= 0)
            return ok([]);
        let stream;
        let lineReader;
        try {
            stream = createReadStream(resolved, { encoding: "utf8", signal: options?.abortSignal });
            lineReader = createInterface({ input: stream, crlfDelay: Infinity });
            const lines = [];
            for await (const line of lineReader) {
                const loopAbort = abortResult(options?.abortSignal, resolved);
                if (loopAbort)
                    return loopAbort;
                lines.push(line);
                if (options?.maxLines !== undefined && lines.length >= options.maxLines)
                    break;
            }
            const afterReadAbort = abortResult(options?.abortSignal, resolved);
            if (afterReadAbort)
                return afterReadAbort;
            return ok(lines);
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
        finally {
            lineReader?.close();
            stream?.destroy();
        }
    }
    async readBinaryFile(path, abortSignal) {
        const resolved = resolvePath(this.cwd, path);
        const aborted = abortResult(abortSignal, resolved);
        if (aborted)
            return aborted;
        try {
            return ok(await readFile(resolved, { signal: abortSignal }));
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async writeFile(path, content, abortSignal) {
        const resolved = resolvePath(this.cwd, path);
        const aborted = abortResult(abortSignal, resolved);
        if (aborted)
            return aborted;
        try {
            await mkdir(resolve(resolved, ".."), { recursive: true });
            const afterMkdirAbort = abortResult(abortSignal, resolved);
            if (afterMkdirAbort)
                return afterMkdirAbort;
            await writeFile(resolved, content, { signal: abortSignal });
            return ok(undefined);
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async appendFile(path, content) {
        const resolved = resolvePath(this.cwd, path);
        try {
            await mkdir(resolve(resolved, ".."), { recursive: true });
            await appendFile(resolved, content);
            return ok(undefined);
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async fileInfo(path) {
        const resolved = resolvePath(this.cwd, path);
        try {
            return fileInfoFromStats(resolved, await lstat(resolved));
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async listDir(path, abortSignal) {
        const resolved = resolvePath(this.cwd, path);
        const aborted = abortResult(abortSignal, resolved);
        if (aborted)
            return aborted;
        try {
            const entries = await readdir(resolved, { withFileTypes: true });
            const infos = [];
            for (const entry of entries) {
                const loopAbort = abortResult(abortSignal, resolved);
                if (loopAbort)
                    return loopAbort;
                const entryPath = resolve(resolved, entry.name);
                try {
                    const info = fileInfoFromStats(entryPath, await lstat(entryPath));
                    if (info.ok)
                        infos.push(info.value);
                }
                catch (error) {
                    return err(toFileError(error, entryPath));
                }
            }
            return ok(infos);
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async canonicalPath(path) {
        const resolved = resolvePath(this.cwd, path);
        try {
            return ok(await realpath(resolved));
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async exists(path) {
        const result = await this.fileInfo(path);
        if (result.ok)
            return ok(true);
        if (result.error.code === "not_found")
            return ok(false);
        return err(result.error);
    }
    async createDir(path, options) {
        const resolved = resolvePath(this.cwd, path);
        try {
            await mkdir(resolved, { recursive: options?.recursive ?? true });
            return ok(undefined);
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async remove(path, options) {
        const resolved = resolvePath(this.cwd, path);
        try {
            await rm(resolved, { recursive: options?.recursive ?? false, force: options?.force ?? false });
            return ok(undefined);
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async createTempDir(prefix = "tmp-") {
        try {
            return ok(await mkdtemp(join(tmpdir(), prefix)));
        }
        catch (error) {
            return err(toFileError(error));
        }
    }
    async createTempFile(options) {
        const dir = await this.createTempDir("tmp-");
        if (!dir.ok)
            return dir;
        const filePath = join(dir.value, `${options?.prefix ?? ""}${randomUUID()}${options?.suffix ?? ""}`);
        try {
            await writeFile(filePath, "");
            return ok(filePath);
        }
        catch (error) {
            return err(toFileError(error, filePath));
        }
    }
    async cleanup() {
        // nothing to clean up for the local node implementation
    }
}
//# sourceMappingURL=nodejs.js.map