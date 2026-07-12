import { Loader } from "@liyuan/tui";
import { theme } from "../theme/theme.js";
import { CountdownTimer } from "./countdown-timer.js";
import { keyText } from "./keybinding-hints.js";
export class StatusIndicator extends Loader {
    kind;
    constructor(kind, ui, spinnerColorFn, messageColorFn, message, indicator) {
        super(ui, spinnerColorFn, messageColorFn, message, indicator);
        this.kind = kind;
    }
    dispose() {
        this.stop();
    }
}
export class WorkingStatusIndicator extends StatusIndicator {
    constructor(ui, message, indicator) {
        super("working", ui, (spinner) => theme.fg("accent", spinner), (text) => theme.fg("muted", text), message, indicator);
    }
}
export class RetryStatusIndicator extends StatusIndicator {
    countdown;
    constructor(ui, attempt, maxAttempts, delayMs) {
        const retryMessage = (seconds) => `Retrying (${attempt}/${maxAttempts}) in ${seconds}s... (${keyText("app.interrupt")} to cancel)`;
        super("retry", ui, (spinner) => theme.fg("warning", spinner), (text) => theme.fg("muted", text), retryMessage(Math.ceil(delayMs / 1000)));
        this.countdown = new CountdownTimer(delayMs, ui, (seconds) => {
            this.setMessage(retryMessage(seconds));
        }, () => {
            this.countdown = undefined;
        });
    }
    dispose() {
        this.countdown?.dispose();
        this.countdown = undefined;
        super.dispose();
    }
}
export class CompactionStatusIndicator extends StatusIndicator {
    constructor(ui, reason) {
        const cancelHint = `(${keyText("app.interrupt")} to cancel)`;
        const label = reason === "manual"
            ? `Compacting context... ${cancelHint}`
            : `${reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting... ${cancelHint}`;
        super("compaction", ui, (spinner) => theme.fg("accent", spinner), (text) => theme.fg("muted", text), label);
    }
}
export class BranchSummaryStatusIndicator extends StatusIndicator {
    constructor(ui) {
        super("branchSummary", ui, (spinner) => theme.fg("accent", spinner), (text) => theme.fg("muted", text), `Summarizing branch... (${keyText("app.interrupt")} to cancel)`);
    }
}
export class IdleStatus {
    invalidate() {
        // No cached state to invalidate.
    }
    render(width) {
        const emptyLine = " ".repeat(width);
        return [emptyLine, emptyLine];
    }
}
//# sourceMappingURL=status-indicator.js.map