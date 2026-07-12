/**
 * Options for word navigation functions.
 * When omitted, uses the default Intl.Segmenter word segmentation.
 */
export interface WordNavigationOptions {
    /** Custom segmenter returning word segments for the given text. */
    segment?: (text: string) => Iterable<Intl.SegmentData>;
    /** Predicate identifying atomic segments that should be treated as single units (e.g. paste markers). */
    isAtomicSegment?: (segment: string) => boolean;
}
/**
 * Find the cursor position after moving one word backward from `cursor` in `text`.
 * Skips trailing whitespace, then stops at the next word/punctuation boundary.
 *
 * Pure function - does not mutate any state.
 */
export declare function findWordBackward(text: string, cursor: number, options?: WordNavigationOptions): number;
/**
 * Find the cursor position after moving one word forward from `cursor` in `text`.
 * Skips leading whitespace, then stops at the next word/punctuation boundary.
 *
 * Pure function - does not mutate any state.
 */
export declare function findWordForward(text: string, cursor: number, options?: WordNavigationOptions): number;
//# sourceMappingURL=word-navigation.d.ts.map