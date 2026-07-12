/**
 * Simple text input component for extensions.
 */
import { Container, getKeybindings, Input, Spacer, Text } from "@liyuan/tui";
import { theme } from "../theme/theme.js";
import { CountdownTimer } from "./countdown-timer.js";
import { DynamicBorder } from "./dynamic-border.js";
import { keyHint } from "./keybinding-hints.js";
export class ExtensionInputComponent extends Container {
    input;
    onSubmitCallback;
    onCancelCallback;
    titleText;
    baseTitle;
    countdown;
    // Focusable implementation - propagate to input for IME cursor positioning
    _focused = false;
    get focused() {
        return this._focused;
    }
    set focused(value) {
        this._focused = value;
        this.input.focused = value;
    }
    constructor(title, _placeholder, onSubmit, onCancel, opts) {
        super();
        this.onSubmitCallback = onSubmit;
        this.onCancelCallback = onCancel;
        this.baseTitle = title;
        this.addChild(new DynamicBorder());
        this.addChild(new Spacer(1));
        this.titleText = new Text(theme.fg("accent", title), 1, 0);
        this.addChild(this.titleText);
        this.addChild(new Spacer(1));
        if (opts?.timeout && opts.timeout > 0 && opts.tui) {
            this.countdown = new CountdownTimer(opts.timeout, opts.tui, (s) => this.titleText.setText(theme.fg("accent", `${this.baseTitle} (${s}s)`)), () => this.onCancelCallback());
        }
        this.input = new Input();
        this.addChild(this.input);
        this.addChild(new Spacer(1));
        this.addChild(new Text(`${keyHint("tui.select.confirm", "submit")}  ${keyHint("tui.select.cancel", "cancel")}`, 1, 0));
        this.addChild(new Spacer(1));
        this.addChild(new DynamicBorder());
    }
    handleInput(keyData) {
        const kb = getKeybindings();
        if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
            this.onSubmitCallback(this.input.getValue());
        }
        else if (kb.matches(keyData, "tui.select.cancel")) {
            this.onCancelCallback();
        }
        else {
            this.input.handleInput(keyData);
        }
    }
    dispose() {
        this.countdown?.dispose();
    }
}
//# sourceMappingURL=extension-input.js.map