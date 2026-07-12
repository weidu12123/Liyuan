export type ImageProtocol = "kitty" | "iterm2" | null;
export interface TerminalCapabilities {
    images: ImageProtocol;
    trueColor: boolean;
    hyperlinks: boolean;
}
export interface CellDimensions {
    widthPx: number;
    heightPx: number;
}
export interface ImageDimensions {
    widthPx: number;
    heightPx: number;
}
export interface ImageRenderOptions {
    maxWidthCells?: number;
    maxHeightCells?: number;
    preserveAspectRatio?: boolean;
    /** Kitty image ID. If provided, reuses/replaces existing image with this ID. */
    imageId?: number;
    /** Whether Kitty should apply its default cursor movement after placement. */
    moveCursor?: boolean;
}
export declare function getCellDimensions(): CellDimensions;
export declare function setCellDimensions(dims: CellDimensions): void;
export declare function detectCapabilities(tmuxForwardsHyperlink?: () => boolean): TerminalCapabilities;
export declare function getCapabilities(): TerminalCapabilities;
export declare function resetCapabilitiesCache(): void;
/** Override the cached capabilities. Useful in tests to exercise both code paths. */
export declare function setCapabilities(caps: TerminalCapabilities): void;
export declare function isImageLine(line: string): boolean;
/**
 * Generate a random image ID for Kitty graphics protocol.
 * Uses random IDs to avoid collisions between different module instances
 * (e.g., main app vs extensions).
 */
export declare function allocateImageId(): number;
export declare function encodeKitty(base64Data: string, options?: {
    columns?: number;
    rows?: number;
    imageId?: number;
    /** Whether Kitty should apply its default cursor movement after placement. Default: true. */
    moveCursor?: boolean;
}): string;
/**
 * Delete a Kitty graphics image by ID.
 * Uses uppercase 'I' to also free the image data.
 */
export declare function deleteKittyImage(imageId: number): string;
/**
 * Delete all visible Kitty graphics images.
 * Uses uppercase 'A' to also free the image data.
 */
export declare function deleteAllKittyImages(): string;
export declare function encodeITerm2(base64Data: string, options?: {
    width?: number | string;
    height?: number | string;
    name?: string;
    preserveAspectRatio?: boolean;
    inline?: boolean;
}): string;
export interface ImageCellSize {
    columns: number;
    rows: number;
}
export declare function calculateImageCellSize(imageDimensions: ImageDimensions, maxWidthCells: number, maxHeightCells?: number, cellDimensions?: CellDimensions): ImageCellSize;
export declare function calculateImageRows(imageDimensions: ImageDimensions, targetWidthCells: number, cellDimensions?: CellDimensions): number;
export declare function getPngDimensions(base64Data: string): ImageDimensions | null;
export declare function getJpegDimensions(base64Data: string): ImageDimensions | null;
export declare function getGifDimensions(base64Data: string): ImageDimensions | null;
export declare function getWebpDimensions(base64Data: string): ImageDimensions | null;
export declare function getImageDimensions(base64Data: string, mimeType: string): ImageDimensions | null;
export declare function renderImage(base64Data: string, imageDimensions: ImageDimensions, options?: ImageRenderOptions): {
    sequence: string;
    rows: number;
    imageId?: number;
} | null;
/**
 * Wrap text in an OSC 8 hyperlink sequence.
 * The text is rendered as a clickable hyperlink in terminals that support OSC 8
 * (Ghostty, Kitty, WezTerm, iTerm2, VSCode, and others).
 * In terminals that do not support OSC 8, the escape sequences are ignored
 * and only the plain text is displayed.
 *
 * @param text - The visible text to display
 * @param url - The URL to link to
 */
export declare function hyperlink(text: string, url: string): string;
export declare function imageFallback(mimeType: string, dimensions?: ImageDimensions, filename?: string): string;
//# sourceMappingURL=terminal-image.d.ts.map