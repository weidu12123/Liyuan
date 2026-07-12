import { Editor } from "@liyuan/tui";
/**
 * Custom editor that handles app-level keybindings for coding-agent.
 */
export class CustomEditor extends Editor {
    keybindings;
    actionHandlers = new Map();
    // Special handlers that can be dynamically replaced
    onEscape;
    onCtrlD;
    onPasteImage;
    /** Handler for extension-registered shortcuts. Returns true if handled. */
    onExtensionShortcut;
    constructor(tui, theme, keybindings, options) {
        super(tui, theme, options);
        this.keybindings = keybindings;
    }
    /**
     * Register a handler for an app action.
     */
    onAction(action, handler) {
        this.actionHandlers.set(action, handler);
    }
    handleInput(data) {
        // Check extension-registered shortcuts first
        if (this.onExtensionShortcut?.(data)) {
            return;
        }
        // Check for paste image keybinding
        if (this.keybindings.matches(data, "app.clipboard.pasteImage")) {
            this.onPasteImage?.();
            return;
        }
        // Check app keybindings first
        // Escape/interrupt - only if autocomplete is NOT active
        if (this.keybindings.matches(data, "app.interrupt")) {
            if (!this.isShowingAutocomplete()) {
                // Use dynamic onEscape if set, otherwise registered handler
                const handler = this.onEscape ?? this.actionHandlers.get("app.interrupt");
                if (handler) {
                    handler();
                    return;
                }
            }
            // Let parent handle escape for autocomplete cancellation
            super.handleInput(data);
            return;
        }
        // Exit (Ctrl+D) - only when editor is empty
        if (this.keybindings.matches(data, "app.exit")) {
            if (this.getText().length === 0) {
                const handler = this.onCtrlD ?? this.actionHandlers.get("app.exit");
                if (handler)
                    handler();
                return;
            }
            // Fall through to editor handling for delete-char-forward when not empty
        }
        // Check all other app actions
        for (const [action, handler] of this.actionHandlers) {
            if (action !== "app.interrupt" && action !== "app.exit" && this.keybindings.matches(data, action)) {
                handler();
                return;
            }
        }
        // Pass to parent for editor handling
        super.handleInput(data);
    }
}
//# sourceMappingURL=custom-editor.js.map