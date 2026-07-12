export type KeyboardProtocolNegotiationSequence = {
    type: "kitty-flags";
    flags: number;
} | {
    type: "device-attributes";
};
export declare function parseKeyboardProtocolNegotiationSequence(sequence: string): KeyboardProtocolNegotiationSequence | undefined;
export declare function isAppleTerminalSession(): boolean;
export declare function normalizeAppleTerminalInput(data: string, isAppleTerminal: boolean, isShiftPressed: boolean): string;
/**
 * Minimal terminal interface for TUI
 */
export interface Terminal {
    start(onInput: (data: string) => void, onResize: () => void): void;
    stop(): void;
    /**
     * Drain stdin before exiting to prevent Kitty key release events from
     * leaking to the parent shell over slow SSH connections.
     * @param maxMs - Maximum time to drain (default: 1000ms)
     * @param idleMs - Exit early if no input arrives within this time (default: 50ms)
     */
    drainInput(maxMs?: number, idleMs?: number): Promise<void>;
    write(data: string): void;
    get columns(): number;
    get rows(): number;
    get kittyProtocolActive(): boolean;
    moveBy(lines: number): void;
    hideCursor(): void;
    showCursor(): void;
    clearLine(): void;
    clearFromCursor(): void;
    clearScreen(): void;
    setTitle(title: string): void;
    setProgress(active: boolean): void;
}
/**
 * Real terminal using process.stdin/stdout
 */
export declare class ProcessTerminal implements Terminal {
    private wasRaw;
    private inputHandler?;
    private resizeHandler?;
    private _kittyProtocolActive;
    private _modifyOtherKeysActive;
    private keyboardProtocolPushed;
    private keyboardProtocolNegotiationBuffer;
    private keyboardProtocolBufferFlushTimer?;
    private stdinBuffer?;
    private stdinDataHandler?;
    private progressInterval?;
    private writeLogPath;
    get kittyProtocolActive(): boolean;
    get modifyOtherKeysActive(): boolean;
    start(onInput: (data: string) => void, onResize: () => void): void;
    /**
     * Set up StdinBuffer to split batched input into individual sequences.
     * This ensures components receive single events, making matchesKey/isKeyRelease work correctly.
     *
     * Also watches for Kitty protocol response and enables it when detected.
     * This is done here (after stdinBuffer parsing) rather than on raw stdin
     * to handle the case where the response arrives split across multiple events.
     */
    private setupStdinBuffer;
    /**
     * Query terminal for Kitty keyboard protocol support and enable it if available.
     *
     * Kitty's progressive enhancement detection requires requesting the desired
     * flags before querying them. The trailing DA query is a sentinel supported by
     * terminals that do not know Kitty keyboard protocol; receiving DA before a
     * Kitty response enables modifyOtherKeys fallback without a startup timeout.
     *
     * The requested flags are:
     * - 1 = disambiguate escape codes
     * - 2 = report event types (press/repeat/release)
     * - 4 = report alternate keys (shifted key, base layout key)
     */
    private queryAndEnableKittyProtocol;
    private handleKeyboardProtocolNegotiationSequence;
    private readKeyboardProtocolNegotiationSequence;
    private setKeyboardProtocolNegotiationBuffer;
    private clearKeyboardProtocolNegotiationBuffer;
    private flushKeyboardProtocolNegotiationBufferAsInput;
    private scheduleKeyboardProtocolNegotiationBufferFlush;
    private clearKeyboardProtocolNegotiationBufferFlushTimer;
    private forwardInputSequence;
    private enableModifyOtherKeys;
    private disableModifyOtherKeys;
    /**
     * On Windows, add ENABLE_VIRTUAL_TERMINAL_INPUT (0x0200) to the stdin
     * console handle so the terminal sends VT sequences for modified keys
     * (e.g. \x1b[Z for Shift+Tab). Without this, libuv's ReadConsoleInputW
     * discards modifier state and Shift+Tab arrives as plain \t.
     */
    private enableWindowsVTInput;
    drainInput(maxMs?: number, idleMs?: number): Promise<void>;
    stop(): void;
    write(data: string): void;
    get columns(): number;
    get rows(): number;
    moveBy(lines: number): void;
    hideCursor(): void;
    showCursor(): void;
    clearLine(): void;
    clearFromCursor(): void;
    clearScreen(): void;
    setTitle(title: string): void;
    setProgress(active: boolean): void;
    private clearProgressInterval;
}
//# sourceMappingURL=terminal.d.ts.map