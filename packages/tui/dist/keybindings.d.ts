import { type KeyId } from "./keys.ts";
/**
 * Global keybinding registry.
 * Downstream packages can add keybindings via declaration merging.
 */
export interface Keybindings {
    "tui.editor.cursorUp": true;
    "tui.editor.cursorDown": true;
    "tui.editor.cursorLeft": true;
    "tui.editor.cursorRight": true;
    "tui.editor.cursorWordLeft": true;
    "tui.editor.cursorWordRight": true;
    "tui.editor.cursorLineStart": true;
    "tui.editor.cursorLineEnd": true;
    "tui.editor.jumpForward": true;
    "tui.editor.jumpBackward": true;
    "tui.editor.pageUp": true;
    "tui.editor.pageDown": true;
    "tui.editor.deleteCharBackward": true;
    "tui.editor.deleteCharForward": true;
    "tui.editor.deleteWordBackward": true;
    "tui.editor.deleteWordForward": true;
    "tui.editor.deleteToLineStart": true;
    "tui.editor.deleteToLineEnd": true;
    "tui.editor.yank": true;
    "tui.editor.yankPop": true;
    "tui.editor.undo": true;
    "tui.input.newLine": true;
    "tui.input.submit": true;
    "tui.input.tab": true;
    "tui.input.copy": true;
    "tui.select.up": true;
    "tui.select.down": true;
    "tui.select.pageUp": true;
    "tui.select.pageDown": true;
    "tui.select.confirm": true;
    "tui.select.cancel": true;
}
export type Keybinding = keyof Keybindings;
export interface KeybindingDefinition {
    defaultKeys: KeyId | KeyId[];
    description?: string;
}
export type KeybindingDefinitions = Record<string, KeybindingDefinition>;
export type KeybindingsConfig = Record<string, KeyId | KeyId[] | undefined>;
export declare const TUI_KEYBINDINGS: {
    readonly "tui.editor.cursorUp": {
        readonly defaultKeys: "up";
        readonly description: "Move cursor up";
    };
    readonly "tui.editor.cursorDown": {
        readonly defaultKeys: "down";
        readonly description: "Move cursor down";
    };
    readonly "tui.editor.cursorLeft": {
        readonly defaultKeys: ["left", "ctrl+b"];
        readonly description: "Move cursor left";
    };
    readonly "tui.editor.cursorRight": {
        readonly defaultKeys: ["right", "ctrl+f"];
        readonly description: "Move cursor right";
    };
    readonly "tui.editor.cursorWordLeft": {
        readonly defaultKeys: ["alt+left", "ctrl+left", "alt+b"];
        readonly description: "Move cursor word left";
    };
    readonly "tui.editor.cursorWordRight": {
        readonly defaultKeys: ["alt+right", "ctrl+right", "alt+f"];
        readonly description: "Move cursor word right";
    };
    readonly "tui.editor.cursorLineStart": {
        readonly defaultKeys: ["home", "ctrl+a"];
        readonly description: "Move to line start";
    };
    readonly "tui.editor.cursorLineEnd": {
        readonly defaultKeys: ["end", "ctrl+e"];
        readonly description: "Move to line end";
    };
    readonly "tui.editor.jumpForward": {
        readonly defaultKeys: "ctrl+]";
        readonly description: "Jump forward to character";
    };
    readonly "tui.editor.jumpBackward": {
        readonly defaultKeys: "ctrl+alt+]";
        readonly description: "Jump backward to character";
    };
    readonly "tui.editor.pageUp": {
        readonly defaultKeys: "pageUp";
        readonly description: "Page up";
    };
    readonly "tui.editor.pageDown": {
        readonly defaultKeys: "pageDown";
        readonly description: "Page down";
    };
    readonly "tui.editor.deleteCharBackward": {
        readonly defaultKeys: "backspace";
        readonly description: "Delete character backward";
    };
    readonly "tui.editor.deleteCharForward": {
        readonly defaultKeys: ["delete", "ctrl+d"];
        readonly description: "Delete character forward";
    };
    readonly "tui.editor.deleteWordBackward": {
        readonly defaultKeys: ["ctrl+w", "alt+backspace"];
        readonly description: "Delete word backward";
    };
    readonly "tui.editor.deleteWordForward": {
        readonly defaultKeys: ["alt+d", "alt+delete"];
        readonly description: "Delete word forward";
    };
    readonly "tui.editor.deleteToLineStart": {
        readonly defaultKeys: "ctrl+u";
        readonly description: "Delete to line start";
    };
    readonly "tui.editor.deleteToLineEnd": {
        readonly defaultKeys: "ctrl+k";
        readonly description: "Delete to line end";
    };
    readonly "tui.editor.yank": {
        readonly defaultKeys: "ctrl+y";
        readonly description: "Yank";
    };
    readonly "tui.editor.yankPop": {
        readonly defaultKeys: "alt+y";
        readonly description: "Yank pop";
    };
    readonly "tui.editor.undo": {
        readonly defaultKeys: "ctrl+-";
        readonly description: "Undo";
    };
    readonly "tui.input.newLine": {
        readonly defaultKeys: ["shift+enter", "ctrl+j"];
        readonly description: "Insert newline";
    };
    readonly "tui.input.submit": {
        readonly defaultKeys: "enter";
        readonly description: "Submit input";
    };
    readonly "tui.input.tab": {
        readonly defaultKeys: "tab";
        readonly description: "Tab / autocomplete";
    };
    readonly "tui.input.copy": {
        readonly defaultKeys: "ctrl+c";
        readonly description: "Copy selection";
    };
    readonly "tui.select.up": {
        readonly defaultKeys: "up";
        readonly description: "Move selection up";
    };
    readonly "tui.select.down": {
        readonly defaultKeys: "down";
        readonly description: "Move selection down";
    };
    readonly "tui.select.pageUp": {
        readonly defaultKeys: "pageUp";
        readonly description: "Selection page up";
    };
    readonly "tui.select.pageDown": {
        readonly defaultKeys: "pageDown";
        readonly description: "Selection page down";
    };
    readonly "tui.select.confirm": {
        readonly defaultKeys: "enter";
        readonly description: "Confirm selection";
    };
    readonly "tui.select.cancel": {
        readonly defaultKeys: ["escape", "ctrl+c"];
        readonly description: "Cancel selection";
    };
};
export interface KeybindingConflict {
    key: KeyId;
    keybindings: string[];
}
export declare class KeybindingsManager {
    private definitions;
    private userBindings;
    private keysById;
    private conflicts;
    constructor(definitions: KeybindingDefinitions, userBindings?: KeybindingsConfig);
    private rebuild;
    matches(data: string, keybinding: Keybinding): boolean;
    getKeys(keybinding: Keybinding): KeyId[];
    getDefinition(keybinding: Keybinding): KeybindingDefinition;
    getConflicts(): KeybindingConflict[];
    setUserBindings(userBindings: KeybindingsConfig): void;
    getUserBindings(): KeybindingsConfig;
    getResolvedBindings(): KeybindingsConfig;
}
export declare function setKeybindings(keybindings: KeybindingsManager): void;
export declare function getKeybindings(): KeybindingsManager;
//# sourceMappingURL=keybindings.d.ts.map