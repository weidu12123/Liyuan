/**
 * Minimal TUI implementation with differential rendering
 */
import type { Terminal } from "./terminal.ts";
import { type RgbColor, type TerminalColorScheme } from "./terminal-colors.ts";
import { visibleWidth } from "./utils.ts";
/**
 * Component interface - all components must implement this
 */
export interface Component {
    /**
     * Render the component to lines for the given viewport width
     * @param width - Current viewport width
     * @returns Array of strings, each representing a line
     */
    render(width: number): string[];
    /**
     * Optional handler for keyboard input when component has focus
     */
    handleInput?(data: string): void;
    /**
     * If true, component receives key release events (Kitty protocol).
     * Default is false - release events are filtered out.
     */
    wantsKeyRelease?: boolean;
    /**
     * Invalidate any cached rendering state.
     * Called when theme changes or when component needs to re-render from scratch.
     */
    invalidate(): void;
}
type InputListenerResult = {
    consume?: boolean;
    data?: string;
} | undefined;
type InputListener = (data: string) => InputListenerResult;
/**
 * Interface for components that can receive focus and display a hardware cursor.
 * When focused, the component should emit CURSOR_MARKER at the cursor position
 * in its render output. TUI will find this marker and position the hardware
 * cursor there for proper IME candidate window positioning.
 */
export interface Focusable {
    /** Set by TUI when focus changes. Component should emit CURSOR_MARKER when true. */
    focused: boolean;
}
/** Type guard to check if a component implements Focusable */
export declare function isFocusable(component: Component | null): component is Component & Focusable;
/**
 * Cursor position marker - APC (Application Program Command) sequence.
 * This is a zero-width escape sequence that terminals ignore.
 * Components emit this at the cursor position when focused.
 * TUI finds and strips this marker, then positions the hardware cursor there.
 */
export declare const CURSOR_MARKER = "\u001B_pi:c\u0007";
export { visibleWidth };
/**
 * Anchor position for overlays
 */
export type OverlayAnchor = "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "top-center" | "bottom-center" | "left-center" | "right-center";
/**
 * Margin configuration for overlays
 */
export interface OverlayMargin {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
}
/** Value that can be absolute (number) or percentage (string like "50%") */
export type SizeValue = number | `${number}%`;
/**
 * Options for overlay positioning and sizing.
 * Values can be absolute numbers or percentage strings (e.g., "50%").
 */
export interface OverlayOptions {
    /** Width in columns, or percentage of terminal width (e.g., "50%") */
    width?: SizeValue;
    /** Minimum width in columns */
    minWidth?: number;
    /** Maximum height in rows, or percentage of terminal height (e.g., "50%") */
    maxHeight?: SizeValue;
    /** Anchor point for positioning (default: 'center') */
    anchor?: OverlayAnchor;
    /** Horizontal offset from anchor position (positive = right) */
    offsetX?: number;
    /** Vertical offset from anchor position (positive = down) */
    offsetY?: number;
    /** Row position: absolute number, or percentage (e.g., "25%" = 25% from top) */
    row?: SizeValue;
    /** Column position: absolute number, or percentage (e.g., "50%" = centered horizontally) */
    col?: SizeValue;
    /** Margin from terminal edges. Number applies to all sides. */
    margin?: OverlayMargin | number;
    /**
     * Control overlay visibility based on terminal dimensions.
     * If provided, overlay is only rendered when this returns true.
     * Called each render cycle with current terminal dimensions.
     */
    visible?: (termWidth: number, termHeight: number) => boolean;
    /** If true, don't capture keyboard focus when shown */
    nonCapturing?: boolean;
}
/** Options for {@link OverlayHandle.unfocus}. */
export interface OverlayUnfocusOptions {
    /** Explicit target to focus after releasing this overlay. */
    target: Component | null;
}
/**
 * Handle returned by showOverlay for controlling the overlay
 */
export interface OverlayHandle {
    /** Permanently remove the overlay (cannot be shown again) */
    hide(): void;
    /** Temporarily hide or show the overlay */
    setHidden(hidden: boolean): void;
    /** Check if overlay is temporarily hidden */
    isHidden(): boolean;
    /** Focus this overlay and bring it to the visual front */
    focus(): void;
    /** Release focus to the next visible capturing overlay or previous target, or to an explicit target when provided */
    unfocus(options?: OverlayUnfocusOptions): void;
    /** Check if this overlay currently has focus */
    isFocused(): boolean;
}
/**
 * Container - a component that contains other components
 */
export declare class Container implements Component {
    children: Component[];
    addChild(component: Component): void;
    removeChild(component: Component): void;
    clear(): void;
    invalidate(): void;
    render(width: number): string[];
}
/**
 * TUI - Main class for managing terminal UI with differential rendering
 */
export declare class TUI extends Container {
    terminal: Terminal;
    private previousLines;
    private previousKittyImageIds;
    private previousWidth;
    private previousHeight;
    private focusedComponent;
    private inputListeners;
    /** Global callback for debug key (Shift+Ctrl+D). Called before input is forwarded to focused component. */
    onDebug?: () => void;
    private renderRequested;
    private renderTimer;
    private lastRenderAt;
    private static readonly MIN_RENDER_INTERVAL_MS;
    private cursorRow;
    private hardwareCursorRow;
    private showHardwareCursor;
    private clearOnShrink;
    private maxLinesRendered;
    private previousViewportTop;
    private fullRedrawCount;
    private stopped;
    private pendingOsc11BackgroundReplies;
    private pendingOsc11BackgroundQueries;
    private terminalColorSchemeListeners;
    private terminalColorSchemeNotificationsEnabled;
    private focusOrderCounter;
    private overlayStack;
    private overlayFocusRestore;
    constructor(terminal: Terminal, showHardwareCursor?: boolean);
    get fullRedraws(): number;
    getShowHardwareCursor(): boolean;
    setShowHardwareCursor(enabled: boolean): void;
    getClearOnShrink(): boolean;
    /**
     * Set whether to trigger full re-render when content shrinks.
     * When true (default), empty rows are cleared when content shrinks.
     * When false, empty rows remain (reduces redraws on slower terminals).
     */
    setClearOnShrink(enabled: boolean): void;
    setFocus(component: Component | null): void;
    private setFocusInternal;
    private clearOverlayFocusRestore;
    private clearOverlayFocusRestoreFor;
    private resolveBlockedOverlayFocusResume;
    private getVisibleOverlayFocusRestore;
    private isOverlayFocusAncestor;
    private retargetOverlayPreFocus;
    private isComponentMounted;
    private containsComponent;
    /**
     * Show an overlay component with configurable positioning and sizing.
     * Returns a handle to control the overlay's visibility.
     */
    showOverlay(component: Component, options?: OverlayOptions): OverlayHandle;
    /** Hide the topmost overlay and restore previous focus. */
    hideOverlay(): void;
    /** Check if there are any visible overlays */
    hasOverlay(): boolean;
    /** Check if an overlay entry is currently visible */
    private isOverlayVisible;
    /** Find the visual-frontmost visible capturing overlay, if any */
    private getTopmostVisibleOverlay;
    invalidate(): void;
    start(): void;
    addInputListener(listener: InputListener): () => void;
    removeInputListener(listener: InputListener): void;
    onTerminalColorSchemeChange(listener: (scheme: TerminalColorScheme) => void): () => void;
    setTerminalColorSchemeNotifications(enabled: boolean): void;
    private queryCellSize;
    stop(): void;
    requestRender(force?: boolean): void;
    private scheduleRender;
    private handleInput;
    private consumeOsc11BackgroundResponse;
    private consumeTerminalColorSchemeReport;
    private consumeCellSizeResponse;
    /**
     * Resolve overlay layout from options.
     * Returns { width, row, col, maxHeight } for rendering.
     */
    private resolveOverlayLayout;
    private resolveAnchorRow;
    private resolveAnchorCol;
    /** Composite all overlays into content lines (sorted by focusOrder, higher = on top). */
    private compositeOverlays;
    private static readonly SEGMENT_RESET;
    private applyLineResets;
    private collectKittyImageIds;
    private deleteKittyImages;
    private getKittyImageReservedRows;
    private expandChangedRangeForKittyImages;
    private deleteChangedKittyImages;
    /** Splice overlay content into a base line at a specific column. Single-pass optimized. */
    private compositeLineAt;
    /**
     * Find and extract cursor position from rendered lines.
     * Searches for CURSOR_MARKER, calculates its position, and strips it from the output.
     * Only scans the bottom terminal height lines (visible viewport).
     * @param lines - Rendered lines to search
     * @param height - Terminal height (visible viewport size)
     * @returns Cursor position { row, col } or null if no marker found
     */
    private extractCursorPosition;
    private doRender;
    /**
     * Position the hardware cursor for IME candidate window.
     * @param cursorPos The cursor position extracted from rendered output, or null
     * @param totalLines Total number of rendered lines
     */
    private positionHardwareCursor;
    /**
     * Query the terminal's default background color with OSC 11 (`ESC ] 11 ; ? BEL`).
     * @param timeoutMs Query timeout in milliseconds.
     * @returns Promise containing the parsed RGB color, or undefined if it times out or fails to parse.
     */
    queryTerminalBackgroundColor({ timeoutMs }: {
        timeoutMs: number;
    }): Promise<RgbColor | undefined>;
    /**
     * Query the terminal's color-scheme preference with DSR (`CSI ? 996 n`).
     * Terminals that support the color palette notification protocol reply with
     * `CSI ? 997 ; 1 n` for dark or `CSI ? 997 ; 2 n` for light.
     */
    queryTerminalColorScheme({ timeoutMs }: {
        timeoutMs: number;
    }): Promise<TerminalColorScheme | undefined>;
}
//# sourceMappingURL=tui.d.ts.map