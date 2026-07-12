import type { Component } from "../tui.ts";
/**
 * Default text styling for markdown content.
 * Applied to all text unless overridden by markdown formatting.
 */
export interface DefaultTextStyle {
    /** Foreground color function */
    color?: (text: string) => string;
    /** Background color function */
    bgColor?: (text: string) => string;
    /** Bold text */
    bold?: boolean;
    /** Italic text */
    italic?: boolean;
    /** Strikethrough text */
    strikethrough?: boolean;
    /** Underline text */
    underline?: boolean;
}
/**
 * Theme functions for markdown elements.
 * Each function takes text and returns styled text with ANSI codes.
 */
export interface MarkdownTheme {
    heading: (text: string) => string;
    link: (text: string) => string;
    linkUrl: (text: string) => string;
    code: (text: string) => string;
    codeBlock: (text: string) => string;
    codeBlockBorder: (text: string) => string;
    quote: (text: string) => string;
    quoteBorder: (text: string) => string;
    hr: (text: string) => string;
    listBullet: (text: string) => string;
    bold: (text: string) => string;
    italic: (text: string) => string;
    strikethrough: (text: string) => string;
    underline: (text: string) => string;
    highlightCode?: (code: string, lang?: string) => string[];
    /** Prefix applied to each rendered code block line (default: "  ") */
    codeBlockIndent?: string;
}
export interface MarkdownOptions {
    /** Preserve source list markers instead of normalizing them. */
    preserveOrderedListMarkers?: boolean;
    /** Preserve source backslash escapes instead of normalizing escaped punctuation. */
    preserveBackslashEscapes?: boolean;
}
export declare class Markdown implements Component {
    private text;
    private paddingX;
    private paddingY;
    private defaultTextStyle?;
    private theme;
    private options;
    private defaultStylePrefix?;
    private cachedText?;
    private cachedWidth?;
    private cachedLines?;
    constructor(text: string, paddingX: number, paddingY: number, theme: MarkdownTheme, defaultTextStyle?: DefaultTextStyle, options?: MarkdownOptions);
    setText(text: string): void;
    invalidate(): void;
    render(width: number): string[];
    /**
     * Apply default text style to a string.
     * This is the base styling applied to all text content.
     * NOTE: Background color is NOT applied here - it's applied at the padding stage
     * to ensure it extends to the full line width.
     */
    private applyDefaultStyle;
    private getDefaultStylePrefix;
    private getStylePrefix;
    private getDefaultInlineStyleContext;
    private renderToken;
    private renderInlineTokens;
    private getOrderedListMarker;
    private getUnorderedListMarker;
    /**
     * Render a list with proper nesting support
     */
    private renderList;
    /**
     * Get the visible width of the longest word in a string.
     */
    private getLongestWordWidth;
    /**
     * Wrap a table cell to fit into a column.
     *
     * Delegates to wrapTextWithAnsi() so ANSI codes + long tokens are handled
     * consistently with the rest of the renderer.
     */
    private wrapCellText;
    /**
     * Render a table with width-aware cell wrapping.
     * Cells that don't fit are wrapped to multiple lines.
     */
    private renderTable;
}
//# sourceMappingURL=markdown.d.ts.map