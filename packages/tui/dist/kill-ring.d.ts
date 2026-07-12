/**
 * Ring buffer for Emacs-style kill/yank operations.
 *
 * Tracks killed (deleted) text entries. Consecutive kills can accumulate
 * into a single entry. Supports yank (paste most recent) and yank-pop
 * (cycle through older entries).
 */
export declare class KillRing {
    private ring;
    /**
     * Add text to the kill ring.
     *
     * @param text - The killed text to add
     * @param opts - Push options
     * @param opts.prepend - If accumulating, prepend (backward deletion) or append (forward deletion)
     * @param opts.accumulate - Merge with the most recent entry instead of creating a new one
     */
    push(text: string, opts: {
        prepend: boolean;
        accumulate?: boolean;
    }): void;
    /** Get most recent entry without modifying the ring. */
    peek(): string | undefined;
    /** Move last entry to front (for yank-pop cycling). */
    rotate(): void;
    get length(): number;
}
//# sourceMappingURL=kill-ring.d.ts.map