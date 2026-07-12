import { Box, Markdown, Spacer, Text } from "@liyuan/tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";
import { keyText } from "./keybinding-hints.js";
/**
 * Component that renders a compaction message with collapsed/expanded state.
 * Uses same background color as custom messages for visual consistency.
 */
export class CompactionSummaryMessageComponent extends Box {
    expanded = false;
    message;
    markdownTheme;
    constructor(message, markdownTheme = getMarkdownTheme()) {
        super(1, 1, (t) => theme.bg("customMessageBg", t));
        this.message = message;
        this.markdownTheme = markdownTheme;
        this.updateDisplay();
    }
    setExpanded(expanded) {
        this.expanded = expanded;
        this.updateDisplay();
    }
    invalidate() {
        super.invalidate();
        this.updateDisplay();
    }
    updateDisplay() {
        this.clear();
        const tokenStr = this.message.tokensBefore.toLocaleString();
        const label = theme.fg("customMessageLabel", `\x1b[1m[compaction]\x1b[22m`);
        this.addChild(new Text(label, 0, 0));
        this.addChild(new Spacer(1));
        if (this.expanded) {
            const header = `**Compacted from ${tokenStr} tokens**\n\n`;
            this.addChild(new Markdown(header + this.message.summary, 0, 0, this.markdownTheme, {
                color: (text) => theme.fg("customMessageText", text),
            }));
        }
        else {
            this.addChild(new Text(theme.fg("customMessageText", `Compacted from ${tokenStr} tokens (`) +
                theme.fg("dim", keyText("app.tools.expand")) +
                theme.fg("customMessageText", " to expand)"), 0, 0));
        }
    }
}
//# sourceMappingURL=compaction-summary-message.js.map