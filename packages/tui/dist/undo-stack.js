/**
 * Generic undo stack with clone-on-push semantics.
 *
 * Stores deep clones of state snapshots. Popped snapshots are returned
 * directly (no re-cloning) since they are already detached.
 */
export class UndoStack {
    stack = [];
    /** Push a deep clone of the given state onto the stack. */
    push(state) {
        this.stack.push(structuredClone(state));
    }
    /** Pop and return the most recent snapshot, or undefined if empty. */
    pop() {
        return this.stack.pop();
    }
    /** Remove all snapshots. */
    clear() {
        this.stack.length = 0;
    }
    get length() {
        return this.stack.length;
    }
}
//# sourceMappingURL=undo-stack.js.map