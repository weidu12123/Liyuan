import { Loader } from "./loader.ts";
/**
 * Loader that can be cancelled with Escape.
 * Extends Loader with an AbortSignal for cancelling async operations.
 *
 * @example
 * const loader = new CancellableLoader(tui, cyan, dim, "Working...");
 * loader.onAbort = () => done(null);
 * doWork(loader.signal).then(done);
 */
export declare class CancellableLoader extends Loader {
    private abortController;
    /** Called when user presses Escape */
    onAbort?: () => void;
    /** AbortSignal that is aborted when user presses Escape */
    get signal(): AbortSignal;
    /** Whether the loader was aborted */
    get aborted(): boolean;
    handleInput(data: string): void;
    dispose(): void;
}
//# sourceMappingURL=cancellable-loader.d.ts.map