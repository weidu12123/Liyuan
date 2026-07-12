/**
 * Get the shared grapheme segmenter instance.
 */
export declare function getGraphemeSegmenter(): Intl.Segmenter;
/**
 * Get the shared word segmenter instance.
 */
export declare function getWordSegmenter(): Intl.Segmenter;
export declare const cjkBreakRegex: RegExp;
/**
 * Calculate the visible width of a string in terminal columns.
 */
export declare function visibleWidth(str: string): number;
export declare function normalizeTerminalOutput(str: string): string;
/**
 * Extract ANSI escape sequences from a string at the given position.
 */
export declare function extractAnsiCode(str: string, pos: number): {
    code: string;
    length: number;
} | null;
/**
 * Wrap text with ANSI codes preserved.
 *
 * ONLY does word wrapping - NO padding, NO background colors.
 * Returns lines where each line is <= width visible chars.
 * Active ANSI codes are preserved across line breaks.
 *
 * @param text - Text to wrap (may contain ANSI codes and newlines)
 * @param width - Maximum visible width per line
 * @returns Array of wrapped lines (NOT padded to width)
 */
export declare function wrapTextWithAnsi(text: string, width: number): string[];
export declare const PUNCTUATION_REGEX: RegExp;
/**
 * Check if a character is whitespace.
 */
export declare function isWhitespaceChar(char: string): boolean;
/**
 * Check if a character is punctuation.
 */
export declare function isPunctuationChar(char: string): boolean;
/**
 * Apply background color to a line, padding to full width.
 *
 * @param line - Line of text (may contain ANSI codes)
 * @param width - Total width to pad to
 * @param bgFn - Background color function
 * @returns Line with background applied and padded to width
 */
export declare function applyBackgroundToLine(line: string, width: number, bgFn: (text: string) => string): string;
/**
 * Truncate text to fit within a maximum visible width, adding ellipsis if needed.
 * Optionally pad with spaces to reach exactly maxWidth.
 * Properly handles ANSI escape codes (they don't count toward width).
 *
 * @param text - Text to truncate (may contain ANSI codes)
 * @param maxWidth - Maximum visible width
 * @param ellipsis - Ellipsis string to append when truncating (default: "...")
 * @param pad - If true, pad result with spaces to exactly maxWidth (default: false)
 * @returns Truncated text, optionally padded to exactly maxWidth
 */
export declare function truncateToWidth(text: string, maxWidth: number, ellipsis?: string, pad?: boolean): string;
/**
 * Extract a range of visible columns from a line. Handles ANSI codes and wide chars.
 * @param strict - If true, exclude wide chars at boundary that would extend past the range
 */
export declare function sliceByColumn(line: string, startCol: number, length: number, strict?: boolean): string;
/** Like sliceByColumn but also returns the actual visible width of the result. */
export declare function sliceWithWidth(line: string, startCol: number, length: number, strict?: boolean): {
    text: string;
    width: number;
};
/**
 * Extract "before" and "after" segments from a line in a single pass.
 * Used for overlay compositing where we need content before and after the overlay region.
 * Preserves styling from before the overlay that should affect content after it.
 */
export declare function extractSegments(line: string, beforeEnd: number, afterStart: number, afterLen: number, strictAfter?: boolean): {
    before: string;
    beforeWidth: number;
    after: string;
    afterWidth: number;
};
//# sourceMappingURL=utils.d.ts.map