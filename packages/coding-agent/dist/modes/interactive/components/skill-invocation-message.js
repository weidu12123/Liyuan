import { Box, Markdown, Text } from "@liyuan/tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";
import { keyText } from "./keybinding-hints.js";
/**
 * Component that renders a skill invocation message with collapsed/expanded state.
 * Uses same background color as custom messages for visual consistency.
 * Only renders the skill block itself - user message is rendered separately.
 */
export class SkillInvocationMessageComponent extends Box {
    expanded = false;
    skillBlock;
    markdownTheme;
    constructor(skillBlock, markdownTheme = getMarkdownTheme()) {
        super(1, 1, (t) => theme.bg("customMessageBg", t));
        this.skillBlock = skillBlock;
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
        if (this.expanded) {
            // Expanded: label + skill name header + full content
            const label = theme.fg("customMessageLabel", `\x1b[1m[skill]\x1b[22m`);
            this.addChild(new Text(label, 0, 0));
            const header = `**${this.skillBlock.name}**\n\n`;
            this.addChild(new Markdown(header + this.skillBlock.content, 0, 0, this.markdownTheme, {
                color: (text) => theme.fg("customMessageText", text),
            }));
        }
        else {
            // Collapsed: single line - [skill] name (hint to expand)
            const line = theme.fg("customMessageLabel", `\x1b[1m[skill]\x1b[22m `) +
                theme.fg("customMessageText", this.skillBlock.name) +
                theme.fg("dim", ` (${keyText("app.tools.expand")} to expand)`);
            this.addChild(new Text(line, 0, 0));
        }
    }
}
//# sourceMappingURL=skill-invocation-message.js.map