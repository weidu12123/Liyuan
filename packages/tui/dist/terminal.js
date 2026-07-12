import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { setKittyProtocolActive } from "./keys.js";
import { isNativeModifierPressed } from "./native-modifiers.js";
import { StdinBuffer } from "./stdin-buffer.js";
const cjsRequire = createRequire(import.meta.url);
const TERMINAL_PROGRESS_KEEPALIVE_MS = 1000;
const TERMINAL_PROGRESS_ACTIVE_SEQUENCE = "\x1b]9;4;3\x07";
const TERMINAL_PROGRESS_CLEAR_SEQUENCE = "\x1b]9;4;0;\x07";
const APPLE_TERMINAL_SHIFT_ENTER_SEQUENCE = "\x1b[13;2u";
const DESIRED_KITTY_KEYBOARD_PROTOCOL_FLAGS = 7;
const KEYBOARD_PROTOCOL_RESPONSE_FRAGMENT_TIMEOUT_MS = 150;
const KITTY_KEYBOARD_PROTOCOL_QUERY = `\x1b[>${DESIRED_KITTY_KEYBOARD_PROTOCOL_FLAGS}u\x1b[?u\x1b[c`;
export function parseKeyboardProtocolNegotiationSequence(sequence) {
    const kittyFlags = sequence.match(/^\x1b\[\?(\d+)u$/);
    if (kittyFlags) {
        return { type: "kitty-flags", flags: Number.parseInt(kittyFlags[1], 10) };
    }
    if (/^\x1b\[\?[\d;]*c$/.test(sequence)) {
        return { type: "device-attributes" };
    }
    return undefined;
}
function isKeyboardProtocolNegotiationSequencePrefix(sequence) {
    return sequence === "\x1b[" || /^\x1b\[\?[\d;]*$/.test(sequence);
}
export function isAppleTerminalSession() {
    return process.platform === "darwin" && process.env.TERM_PROGRAM === "Apple_Terminal";
}
export function normalizeAppleTerminalInput(data, isAppleTerminal, isShiftPressed) {
    if (isAppleTerminal && data === "\r" && isShiftPressed)
        return APPLE_TERMINAL_SHIFT_ENTER_SEQUENCE;
    return data;
}
/**
 * Real terminal using process.stdin/stdout
 */
export class ProcessTerminal {
    wasRaw = false;
    inputHandler;
    resizeHandler;
    _kittyProtocolActive = false;
    _modifyOtherKeysActive = false;
    keyboardProtocolPushed = false;
    keyboardProtocolNegotiationBuffer = "";
    keyboardProtocolBufferFlushTimer;
    stdinBuffer;
    stdinDataHandler;
    progressInterval;
    writeLogPath = (() => {
        const env = process.env.PI_TUI_WRITE_LOG || "";
        if (!env)
            return "";
        try {
            if (fs.statSync(env).isDirectory()) {
                const now = new Date();
                const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
                return path.join(env, `tui-${ts}-${process.pid}.log`);
            }
        }
        catch {
            // Not an existing directory - use as-is (file path)
        }
        return env;
    })();
    get kittyProtocolActive() {
        return this._kittyProtocolActive;
    }
    get modifyOtherKeysActive() {
        return this._modifyOtherKeysActive;
    }
    start(onInput, onResize) {
        this.inputHandler = onInput;
        this.resizeHandler = onResize;
        // Save previous state and enable raw mode
        this.wasRaw = process.stdin.isRaw || false;
        if (process.stdin.setRawMode) {
            process.stdin.setRawMode(true);
        }
        process.stdin.setEncoding("utf8");
        process.stdin.resume();
        // Enable bracketed paste mode - terminal will wrap pastes in \x1b[200~ ... \x1b[201~
        process.stdout.write("\x1b[?2004h");
        // Set up resize handler immediately
        process.stdout.on("resize", this.resizeHandler);
        // Refresh terminal dimensions - they may be stale after suspend/resume
        // (SIGWINCH is lost while process is stopped). Unix only.
        if (process.platform !== "win32") {
            process.kill(process.pid, "SIGWINCH");
        }
        // On Windows, enable ENABLE_VIRTUAL_TERMINAL_INPUT so the console sends
        // VT escape sequences (e.g. \x1b[Z for Shift+Tab) instead of raw console
        // events that lose modifier information. Must run AFTER setRawMode(true)
        // since that resets console mode flags.
        this.enableWindowsVTInput();
        // Query Kitty keyboard protocol and fall back to modifyOtherKeys when DA confirms no Kitty response.
        // See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
        this.queryAndEnableKittyProtocol();
    }
    /**
     * Set up StdinBuffer to split batched input into individual sequences.
     * This ensures components receive single events, making matchesKey/isKeyRelease work correctly.
     *
     * Also watches for Kitty protocol response and enables it when detected.
     * This is done here (after stdinBuffer parsing) rather than on raw stdin
     * to handle the case where the response arrives split across multiple events.
     */
    setupStdinBuffer() {
        this.stdinBuffer = new StdinBuffer({ timeout: 10 });
        // Forward individual sequences to the input handler
        this.stdinBuffer.on("data", (sequence) => {
            const negotiationSequence = this.readKeyboardProtocolNegotiationSequence(sequence);
            if (negotiationSequence === "pending") {
                this.scheduleKeyboardProtocolNegotiationBufferFlush();
                return; // Wait briefly for the rest of a split Kitty response.
            }
            if (this.handleKeyboardProtocolNegotiationSequence(negotiationSequence)) {
                return;
            }
            this.forwardInputSequence(sequence);
        });
        // Re-wrap paste content with bracketed paste markers for existing editor handling
        this.stdinBuffer.on("paste", (content) => {
            if (this.inputHandler) {
                this.inputHandler(`\x1b[200~${content}\x1b[201~`);
            }
        });
        // Handler that pipes stdin data through the buffer
        this.stdinDataHandler = (data) => {
            this.stdinBuffer.process(data);
        };
    }
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
    queryAndEnableKittyProtocol() {
        this.setupStdinBuffer();
        process.stdin.on("data", this.stdinDataHandler);
        this.keyboardProtocolPushed = true;
        this.clearKeyboardProtocolNegotiationBuffer();
        process.stdout.write(KITTY_KEYBOARD_PROTOCOL_QUERY);
    }
    handleKeyboardProtocolNegotiationSequence(negotiationSequence) {
        if (!negotiationSequence)
            return false;
        this.clearKeyboardProtocolNegotiationBuffer();
        if (negotiationSequence.type === "kitty-flags") {
            if (negotiationSequence.flags !== 0) {
                this.disableModifyOtherKeys();
                if (!this._kittyProtocolActive) {
                    this._kittyProtocolActive = true;
                    setKittyProtocolActive(true);
                }
            }
            else {
                this.enableModifyOtherKeys();
            }
            return true;
        }
        if (!this._kittyProtocolActive) {
            this.enableModifyOtherKeys();
        }
        return true;
    }
    readKeyboardProtocolNegotiationSequence(sequence) {
        if (this.keyboardProtocolNegotiationBuffer) {
            const bufferedSequence = this.keyboardProtocolNegotiationBuffer + sequence;
            const negotiationSequence = parseKeyboardProtocolNegotiationSequence(bufferedSequence);
            if (negotiationSequence) {
                this.clearKeyboardProtocolNegotiationBuffer();
                return negotiationSequence;
            }
            if (isKeyboardProtocolNegotiationSequencePrefix(bufferedSequence)) {
                this.setKeyboardProtocolNegotiationBuffer(bufferedSequence);
                return "pending";
            }
            this.flushKeyboardProtocolNegotiationBufferAsInput();
        }
        const negotiationSequence = parseKeyboardProtocolNegotiationSequence(sequence);
        if (negotiationSequence)
            return negotiationSequence;
        if (isKeyboardProtocolNegotiationSequencePrefix(sequence)) {
            this.setKeyboardProtocolNegotiationBuffer(sequence);
            return "pending";
        }
        return undefined;
    }
    setKeyboardProtocolNegotiationBuffer(sequence) {
        this.clearKeyboardProtocolNegotiationBufferFlushTimer();
        this.keyboardProtocolNegotiationBuffer = sequence;
    }
    clearKeyboardProtocolNegotiationBuffer() {
        this.clearKeyboardProtocolNegotiationBufferFlushTimer();
        this.keyboardProtocolNegotiationBuffer = "";
    }
    flushKeyboardProtocolNegotiationBufferAsInput() {
        if (!this.keyboardProtocolNegotiationBuffer)
            return;
        const sequence = this.keyboardProtocolNegotiationBuffer;
        this.clearKeyboardProtocolNegotiationBuffer();
        this.forwardInputSequence(sequence);
    }
    scheduleKeyboardProtocolNegotiationBufferFlush() {
        if (!this.keyboardProtocolNegotiationBuffer || this.keyboardProtocolBufferFlushTimer)
            return;
        this.keyboardProtocolBufferFlushTimer = setTimeout(() => {
            this.keyboardProtocolBufferFlushTimer = undefined;
            this.flushKeyboardProtocolNegotiationBufferAsInput();
        }, KEYBOARD_PROTOCOL_RESPONSE_FRAGMENT_TIMEOUT_MS);
    }
    clearKeyboardProtocolNegotiationBufferFlushTimer() {
        if (!this.keyboardProtocolBufferFlushTimer)
            return;
        clearTimeout(this.keyboardProtocolBufferFlushTimer);
        this.keyboardProtocolBufferFlushTimer = undefined;
    }
    forwardInputSequence(sequence) {
        if (!this.inputHandler)
            return;
        const isAppleTerminal = sequence === "\r" && isAppleTerminalSession();
        const input = normalizeAppleTerminalInput(sequence, isAppleTerminal, isAppleTerminal && isNativeModifierPressed("shift"));
        this.inputHandler(input);
    }
    enableModifyOtherKeys() {
        if (this._kittyProtocolActive || this._modifyOtherKeysActive)
            return;
        process.stdout.write("\x1b[>4;2m");
        this._modifyOtherKeysActive = true;
    }
    disableModifyOtherKeys() {
        if (!this._modifyOtherKeysActive)
            return;
        process.stdout.write("\x1b[>4;0m");
        this._modifyOtherKeysActive = false;
    }
    /**
     * On Windows, add ENABLE_VIRTUAL_TERMINAL_INPUT (0x0200) to the stdin
     * console handle so the terminal sends VT sequences for modified keys
     * (e.g. \x1b[Z for Shift+Tab). Without this, libuv's ReadConsoleInputW
     * discards modifier state and Shift+Tab arrives as plain \t.
     */
    enableWindowsVTInput() {
        if (process.platform !== "win32")
            return;
        try {
            const arch = process.arch;
            if (arch !== "x64" && arch !== "arm64")
                return;
            // Dynamic require so non-Windows and bundled/browser paths never load the
            // native helper. In the npm package native/ is next to dist/; in compiled
            // binary archives native/ is copied next to the executable.
            const moduleDir = path.dirname(fileURLToPath(import.meta.url));
            const nativePath = path.join("native", "win32", "prebuilds", `win32-${arch}`, "win32-console-mode.node");
            const candidates = [
                path.join(moduleDir, "..", nativePath),
                path.join(moduleDir, nativePath),
                path.join(path.dirname(process.execPath), nativePath),
            ];
            for (const modulePath of candidates) {
                try {
                    const helper = cjsRequire(modulePath);
                    helper.enableVirtualTerminalInput?.();
                    return;
                }
                catch {
                    // Try the next possible packaging location.
                }
            }
        }
        catch {
            // Native helper not available — Shift+Tab won't be distinguishable from Tab.
        }
    }
    async drainInput(maxMs = 1000, idleMs = 50) {
        const shouldDisableKittyProtocol = this.keyboardProtocolPushed || this._kittyProtocolActive;
        this.clearKeyboardProtocolNegotiationBuffer();
        if (shouldDisableKittyProtocol) {
            // Disable Kitty keyboard protocol first so any late key releases
            // do not generate new Kitty escape sequences.
            process.stdout.write("\x1b[<u");
            this.keyboardProtocolPushed = false;
            this._kittyProtocolActive = false;
            setKittyProtocolActive(false);
        }
        this.disableModifyOtherKeys();
        const previousHandler = this.inputHandler;
        this.inputHandler = undefined;
        let lastDataTime = Date.now();
        const onData = () => {
            lastDataTime = Date.now();
        };
        process.stdin.on("data", onData);
        const endTime = Date.now() + maxMs;
        try {
            while (true) {
                const now = Date.now();
                const timeLeft = endTime - now;
                if (timeLeft <= 0)
                    break;
                if (now - lastDataTime >= idleMs)
                    break;
                await new Promise((resolve) => setTimeout(resolve, Math.min(idleMs, timeLeft)));
            }
        }
        finally {
            process.stdin.removeListener("data", onData);
            this.inputHandler = previousHandler;
        }
    }
    stop() {
        if (this.clearProgressInterval()) {
            process.stdout.write(TERMINAL_PROGRESS_CLEAR_SEQUENCE);
        }
        // Disable bracketed paste mode
        process.stdout.write("\x1b[?2004l");
        const shouldDisableKittyProtocol = this.keyboardProtocolPushed || this._kittyProtocolActive;
        this.clearKeyboardProtocolNegotiationBuffer();
        // Disable Kitty keyboard protocol if not already done by drainInput()
        if (shouldDisableKittyProtocol) {
            process.stdout.write("\x1b[<u");
            this.keyboardProtocolPushed = false;
            this._kittyProtocolActive = false;
            setKittyProtocolActive(false);
        }
        this.disableModifyOtherKeys();
        // Clean up StdinBuffer
        if (this.stdinBuffer) {
            this.stdinBuffer.destroy();
            this.stdinBuffer = undefined;
        }
        // Remove event handlers
        if (this.stdinDataHandler) {
            process.stdin.removeListener("data", this.stdinDataHandler);
            this.stdinDataHandler = undefined;
        }
        this.inputHandler = undefined;
        if (this.resizeHandler) {
            process.stdout.removeListener("resize", this.resizeHandler);
            this.resizeHandler = undefined;
        }
        // Pause stdin to prevent any buffered input (e.g., Ctrl+D) from being
        // re-interpreted after raw mode is disabled. This fixes a race condition
        // where Ctrl+D could close the parent shell over SSH.
        process.stdin.pause();
        // Restore raw mode state
        if (process.stdin.setRawMode) {
            process.stdin.setRawMode(this.wasRaw);
        }
    }
    write(data) {
        process.stdout.write(data);
        if (this.writeLogPath) {
            try {
                fs.appendFileSync(this.writeLogPath, data, { encoding: "utf8" });
            }
            catch {
                // Ignore logging errors
            }
        }
    }
    get columns() {
        return process.stdout.columns || Number(process.env.COLUMNS) || 80;
    }
    get rows() {
        return process.stdout.rows || Number(process.env.LINES) || 24;
    }
    moveBy(lines) {
        if (lines > 0) {
            // Move down
            process.stdout.write(`\x1b[${lines}B`);
        }
        else if (lines < 0) {
            // Move up
            process.stdout.write(`\x1b[${-lines}A`);
        }
        // lines === 0: no movement
    }
    hideCursor() {
        process.stdout.write("\x1b[?25l");
    }
    showCursor() {
        process.stdout.write("\x1b[?25h");
    }
    clearLine() {
        process.stdout.write("\x1b[K");
    }
    clearFromCursor() {
        process.stdout.write("\x1b[J");
    }
    clearScreen() {
        process.stdout.write("\x1b[2J\x1b[H"); // Clear screen and move to home (1,1)
    }
    setTitle(title) {
        // OSC 0;title BEL - set terminal window title
        process.stdout.write(`\x1b]0;${title}\x07`);
    }
    setProgress(active) {
        if (active) {
            // OSC 9;4;3 - indeterminate progress
            process.stdout.write(TERMINAL_PROGRESS_ACTIVE_SEQUENCE);
            if (!this.progressInterval) {
                this.progressInterval = setInterval(() => {
                    process.stdout.write(TERMINAL_PROGRESS_ACTIVE_SEQUENCE);
                }, TERMINAL_PROGRESS_KEEPALIVE_MS);
            }
        }
        else {
            this.clearProgressInterval();
            // OSC 9;4;0 - clear progress
            process.stdout.write(TERMINAL_PROGRESS_CLEAR_SEQUENCE);
        }
    }
    clearProgressInterval() {
        if (!this.progressInterval)
            return false;
        clearInterval(this.progressInterval);
        this.progressInterval = undefined;
        return true;
    }
}
//# sourceMappingURL=terminal.js.map