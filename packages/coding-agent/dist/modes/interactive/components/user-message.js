import { Box, Container, Markdown } from "@liyuan/tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";
const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
/**
 * Component that renders a user message
 */
export class UserMessageComponent extends Container {
    text;
    markdownTheme;
    outputPad;
    constructor(text, markdownTheme = getMarkdownTheme(), outputPad = 1) {
        super();
        this.text = text;
        this.markdownTheme = markdownTheme;
        this.outputPad = outputPad;
        this.rebuild();
    }
    setOutputPad(padding) {
        this.outputPad = padding;
        this.rebuild();
    }
    rebuild() {
        this.clear();
        const contentBox = new Box(this.outputPad, 1, (content) => theme.bg("userMessageBg", content));
        contentBox.addChild(new Markdown(this.text, 0, 0, this.markdownTheme, {
            color: (content) => theme.fg("userMessageText", content),
        }, { preserveOrderedListMarkers: true, preserveBackslashEscapes: true }));
        this.addChild(contentBox);
    }
    render(width) {
        const lines = super.render(width);
        if (lines.length === 0) {
            return lines;
        }
        lines[0] = OSC133_ZONE_START + lines[0];
        lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
        return lines;
    }
}
//# sourceMappingURL=user-message.js.map