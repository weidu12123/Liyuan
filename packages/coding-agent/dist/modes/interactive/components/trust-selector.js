import { Container, getKeybindings, Spacer, Text } from "@liyuan/tui";
import { getProjectTrustOptions, } from "../../../core/trust-manager.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";
import { keyHint, rawKeyHint } from "./keybinding-hints.js";
function formatDecision(trustPath, decision) {
    if (decision === null) {
        return "none";
    }
    const label = decision.decision ? "trusted" : "untrusted";
    if (trustPath !== undefined && decision.path !== trustPath) {
        return `${label} (inherited from ${decision.path})`;
    }
    return `${label} (${decision.path})`;
}
export class TrustSelectorComponent extends Container {
    selectedIndex;
    listContainer;
    trustOptions;
    savedDecision;
    onSelectCallback;
    onCancelCallback;
    constructor(options) {
        super();
        this.savedDecision = options.savedDecision;
        this.trustOptions = getProjectTrustOptions(options.cwd);
        this.selectedIndex = Math.max(0, this.trustOptions.findIndex((option) => this.isSavedOption(option)));
        this.onSelectCallback = options.onSelect;
        this.onCancelCallback = options.onCancel;
        this.addChild(new DynamicBorder());
        this.addChild(new Spacer(1));
        this.addChild(new Text(theme.fg("accent", theme.bold("Project trust")), 1, 0));
        this.addChild(new Text(theme.fg("muted", options.cwd), 1, 0));
        this.addChild(new Spacer(1));
        this.addChild(new Text(theme.fg("muted", `Saved decision: ${formatDecision(this.trustOptions[0]?.savedPath, options.savedDecision)}`), 1, 0));
        this.addChild(new Text(theme.fg("muted", `Current session: ${options.projectTrusted ? "trusted" : "untrusted"}`), 1, 0));
        this.addChild(new Spacer(1));
        this.listContainer = new Container();
        this.addChild(this.listContainer);
        this.addChild(new Spacer(1));
        this.addChild(new Text(rawKeyHint("↑↓", "navigate") +
            "  " +
            keyHint("tui.select.confirm", "save") +
            "  " +
            keyHint("tui.select.cancel", "cancel"), 1, 0));
        this.addChild(new Spacer(1));
        this.addChild(new DynamicBorder());
        this.updateList();
    }
    isSavedOption(option) {
        return (option.savedPath !== undefined &&
            this.savedDecision?.decision === option.trusted &&
            this.savedDecision.path === option.savedPath);
    }
    updateList() {
        this.listContainer.clear();
        for (let i = 0; i < this.trustOptions.length; i++) {
            const option = this.trustOptions[i];
            if (!option) {
                continue;
            }
            const isSelected = i === this.selectedIndex;
            const isCurrent = this.isSavedOption(option);
            const checkmark = isCurrent ? theme.fg("success", " ✓") : "";
            const prefix = isSelected ? theme.fg("accent", "→ ") : "  ";
            const label = isSelected ? theme.fg("accent", option.label) : theme.fg("text", option.label);
            this.listContainer.addChild(new Text(`${prefix}${label}${checkmark}`, 1, 0));
        }
    }
    handleInput(keyData) {
        const kb = getKeybindings();
        if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
            this.selectedIndex = Math.max(0, this.selectedIndex - 1);
            this.updateList();
        }
        else if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
            this.selectedIndex = Math.min(this.trustOptions.length - 1, this.selectedIndex + 1);
            this.updateList();
        }
        else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
            const selected = this.trustOptions[this.selectedIndex];
            if (selected) {
                this.onSelectCallback({ trusted: selected.trusted, updates: selected.updates });
            }
        }
        else if (kb.matches(keyData, "tui.select.cancel")) {
            this.onCancelCallback();
        }
    }
}
//# sourceMappingURL=trust-selector.js.map