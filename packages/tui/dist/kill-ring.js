/**
 * Ring buffer for Emacs-style kill/yank operations.
 *
 * Tracks killed (deleted) text entries. Consecutive kills can accumulate
 * into a single entry. Supports yank (paste most recent) and yank-pop
 * (cycle through older entries).
 */
export class KillRing {
    ring = [];
    /**
     * Add text to the kill ring.
     *
     * @param text - The killed text to add
     * @param opts - Push options
     * @param opts.prepend - If accumulating, prepend (backward deletion) or append (forward deletion)
     * @param opts.accumulate - Merge with the most recent entry instead of creating a new one
     */
    push(text, opts) {
        if (!text)
            return;
        if (opts.accumulate && this.ring.length > 0) {
            const last = this.ring.pop();
            this.ring.push(opts.prepend ? text + last : last + text);
        }
        else {
            this.ring.push(text);
        }
    }
    /** Get most recent entry without modifying the ring. */
    peek() {
        return this.ring.length > 0 ? this.ring[this.ring.length - 1] : undefined;
    }
    /** Move last entry to front (for yank-pop cycling). */
    rotate() {
        if (this.ring.length > 1) {
            const last = this.ring.pop();
            this.ring.unshift(last);
        }
    }
    get length() {
        return this.ring.length;
    }
}
//# sourceMappingURL=kill-ring.js.map