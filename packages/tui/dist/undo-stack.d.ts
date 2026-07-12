/**
 * Generic undo stack with clone-on-push semantics.
 *
 * Stores deep clones of state snapshots. Popped snapshots are returned
 * directly (no re-cloning) since they are already detached.
 */
export declare class UndoStack<S> {
    private stack;
    /** Push a deep clone of the given state onto the stack. */
    push(state: S): void;
    /** Pop and return the most recent snapshot, or undefined if empty. */
    pop(): S | undefined;
    /** Remove all snapshots. */
    clear(): void;
    get length(): number;
}
//# sourceMappingURL=undo-stack.d.ts.map