import { matchesKey } from "./keys.js";
export const TUI_KEYBINDINGS = {
    "tui.editor.cursorUp": { defaultKeys: "up", description: "Move cursor up" },
    "tui.editor.cursorDown": { defaultKeys: "down", description: "Move cursor down" },
    "tui.editor.cursorLeft": {
        defaultKeys: ["left", "ctrl+b"],
        description: "Move cursor left",
    },
    "tui.editor.cursorRight": {
        defaultKeys: ["right", "ctrl+f"],
        description: "Move cursor right",
    },
    "tui.editor.cursorWordLeft": {
        defaultKeys: ["alt+left", "ctrl+left", "alt+b"],
        description: "Move cursor word left",
    },
    "tui.editor.cursorWordRight": {
        defaultKeys: ["alt+right", "ctrl+right", "alt+f"],
        description: "Move cursor word right",
    },
    "tui.editor.cursorLineStart": {
        defaultKeys: ["home", "ctrl+a"],
        description: "Move to line start",
    },
    "tui.editor.cursorLineEnd": {
        defaultKeys: ["end", "ctrl+e"],
        description: "Move to line end",
    },
    "tui.editor.jumpForward": {
        defaultKeys: "ctrl+]",
        description: "Jump forward to character",
    },
    "tui.editor.jumpBackward": {
        defaultKeys: "ctrl+alt+]",
        description: "Jump backward to character",
    },
    "tui.editor.pageUp": { defaultKeys: "pageUp", description: "Page up" },
    "tui.editor.pageDown": { defaultKeys: "pageDown", description: "Page down" },
    "tui.editor.deleteCharBackward": {
        defaultKeys: "backspace",
        description: "Delete character backward",
    },
    "tui.editor.deleteCharForward": {
        defaultKeys: ["delete", "ctrl+d"],
        description: "Delete character forward",
    },
    "tui.editor.deleteWordBackward": {
        defaultKeys: ["ctrl+w", "alt+backspace"],
        description: "Delete word backward",
    },
    "tui.editor.deleteWordForward": {
        defaultKeys: ["alt+d", "alt+delete"],
        description: "Delete word forward",
    },
    "tui.editor.deleteToLineStart": {
        defaultKeys: "ctrl+u",
        description: "Delete to line start",
    },
    "tui.editor.deleteToLineEnd": {
        defaultKeys: "ctrl+k",
        description: "Delete to line end",
    },
    "tui.editor.yank": { defaultKeys: "ctrl+y", description: "Yank" },
    "tui.editor.yankPop": { defaultKeys: "alt+y", description: "Yank pop" },
    "tui.editor.undo": { defaultKeys: "ctrl+-", description: "Undo" },
    "tui.input.newLine": { defaultKeys: ["shift+enter", "ctrl+j"], description: "Insert newline" },
    "tui.input.submit": { defaultKeys: "enter", description: "Submit input" },
    "tui.input.tab": { defaultKeys: "tab", description: "Tab / autocomplete" },
    "tui.input.copy": { defaultKeys: "ctrl+c", description: "Copy selection" },
    "tui.select.up": { defaultKeys: "up", description: "Move selection up" },
    "tui.select.down": { defaultKeys: "down", description: "Move selection down" },
    "tui.select.pageUp": { defaultKeys: "pageUp", description: "Selection page up" },
    "tui.select.pageDown": {
        defaultKeys: "pageDown",
        description: "Selection page down",
    },
    "tui.select.confirm": { defaultKeys: "enter", description: "Confirm selection" },
    "tui.select.cancel": {
        defaultKeys: ["escape", "ctrl+c"],
        description: "Cancel selection",
    },
};
function normalizeKeys(keys) {
    if (keys === undefined)
        return [];
    const keyList = Array.isArray(keys) ? keys : [keys];
    const seen = new Set();
    const result = [];
    for (const key of keyList) {
        if (!seen.has(key)) {
            seen.add(key);
            result.push(key);
        }
    }
    return result;
}
export class KeybindingsManager {
    definitions;
    userBindings;
    keysById = new Map();
    conflicts = [];
    constructor(definitions, userBindings = {}) {
        this.definitions = definitions;
        this.userBindings = userBindings;
        this.rebuild();
    }
    rebuild() {
        this.keysById.clear();
        this.conflicts = [];
        const userClaims = new Map();
        for (const [keybinding, keys] of Object.entries(this.userBindings)) {
            if (!(keybinding in this.definitions))
                continue;
            for (const key of normalizeKeys(keys)) {
                const claimants = userClaims.get(key) ?? new Set();
                claimants.add(keybinding);
                userClaims.set(key, claimants);
            }
        }
        for (const [key, keybindings] of userClaims) {
            if (keybindings.size > 1) {
                this.conflicts.push({ key, keybindings: [...keybindings] });
            }
        }
        for (const [id, definition] of Object.entries(this.definitions)) {
            const userKeys = this.userBindings[id];
            const keys = userKeys === undefined ? normalizeKeys(definition.defaultKeys) : normalizeKeys(userKeys);
            this.keysById.set(id, keys);
        }
    }
    matches(data, keybinding) {
        const keys = this.keysById.get(keybinding) ?? [];
        for (const key of keys) {
            if (matchesKey(data, key))
                return true;
        }
        return false;
    }
    getKeys(keybinding) {
        return [...(this.keysById.get(keybinding) ?? [])];
    }
    getDefinition(keybinding) {
        return this.definitions[keybinding];
    }
    getConflicts() {
        return this.conflicts.map((conflict) => ({ ...conflict, keybindings: [...conflict.keybindings] }));
    }
    setUserBindings(userBindings) {
        this.userBindings = userBindings;
        this.rebuild();
    }
    getUserBindings() {
        return { ...this.userBindings };
    }
    getResolvedBindings() {
        const resolved = {};
        for (const id of Object.keys(this.definitions)) {
            const keys = this.keysById.get(id) ?? [];
            resolved[id] = keys.length === 1 ? keys[0] : [...keys];
        }
        return resolved;
    }
}
let globalKeybindings = null;
export function setKeybindings(keybindings) {
    globalKeybindings = keybindings;
}
export function getKeybindings() {
    if (!globalKeybindings) {
        globalKeybindings = new KeybindingsManager(TUI_KEYBINDINGS);
    }
    return globalKeybindings;
}
//# sourceMappingURL=keybindings.js.map