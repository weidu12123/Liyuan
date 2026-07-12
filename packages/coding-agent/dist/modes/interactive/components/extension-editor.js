/**
 * Multi-line editor component for extensions.
 * Supports Ctrl+G for external editor.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Container, Editor, getKeybindings, Spacer, Text, } from "@liyuan/tui";
import { getEditorTheme, theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";
import { keyHint } from "./keybinding-hints.js";
export class ExtensionEditorComponent extends Container {
    editor;
    onSubmitCallback;
    onCancelCallback;
    tui;
    keybindings;
    externalEditorCommand;
    _focused = false;
    get focused() {
        return this._focused;
    }
    set focused(value) {
        this._focused = value;
        this.editor.focused = value;
    }
    constructor(tui, keybindings, title, prefill, onSubmit, onCancel, options, externalEditorCommand) {
        super();
        this.tui = tui;
        this.keybindings = keybindings;
        this.externalEditorCommand = externalEditorCommand;
        this.onSubmitCallback = onSubmit;
        this.onCancelCallback = onCancel;
        // Add top border
        this.addChild(new DynamicBorder());
        this.addChild(new Spacer(1));
        // Add title
        this.addChild(new Text(theme.fg("accent", title), 1, 0));
        this.addChild(new Spacer(1));
        // Create editor
        this.editor = new Editor(tui, getEditorTheme(), options);
        if (prefill) {
            this.editor.setText(prefill);
        }
        // Wire up Enter to submit (Shift+Enter for newlines, like the main editor)
        this.editor.onSubmit = (text) => {
            this.onSubmitCallback(text);
        };
        this.addChild(this.editor);
        this.addChild(new Spacer(1));
        // Add hint
        const hasExternalEditor = !!this.getExternalEditorCommand();
        const hint = keyHint("tui.select.confirm", "submit") +
            "  " +
            keyHint("tui.input.newLine", "newline") +
            "  " +
            keyHint("tui.select.cancel", "cancel") +
            (hasExternalEditor ? `  ${keyHint("app.editor.external", "external editor")}` : "");
        this.addChild(new Text(hint, 1, 0));
        this.addChild(new Spacer(1));
        // Add bottom border
        this.addChild(new DynamicBorder());
    }
    handleInput(keyData) {
        const kb = getKeybindings();
        // Escape or Ctrl+C to cancel
        if (kb.matches(keyData, "tui.select.cancel")) {
            this.onCancelCallback();
            return;
        }
        // External editor (app keybinding)
        if (this.keybindings.matches(keyData, "app.editor.external")) {
            this.openExternalEditor();
            return;
        }
        // Forward to editor
        this.editor.handleInput(keyData);
    }
    getExternalEditorCommand() {
        const editorCmd = this.externalEditorCommand || process.env.VISUAL || process.env.EDITOR;
        if (editorCmd) {
            return editorCmd;
        }
        return process.platform === "win32" ? "notepad" : "nano";
    }
    async openExternalEditor() {
        const editorCmd = this.getExternalEditorCommand();
        if (!editorCmd) {
            return;
        }
        const currentText = this.editor.getText();
        const tmpFile = path.join(os.tmpdir(), `pi-extension-editor-${Date.now()}.md`);
        try {
            fs.writeFileSync(tmpFile, currentText, "utf-8");
            this.tui.stop();
            const [editor, ...editorArgs] = editorCmd.split(" ");
            process.stdout.write(`Launching external editor: ${editorCmd}\nPi will resume when the editor exits.\n`);
            // Do not use spawnSync here. On Windows, synchronous child_process calls can keep
            // Node/libuv's console input read active after tui.stop() pauses stdin, racing
            // vim/nvim for the console input buffer until Ctrl+C cancels the pending read.
            const status = await new Promise((resolve) => {
                const child = spawn(editor, [...editorArgs, tmpFile], {
                    stdio: "inherit",
                    shell: process.platform === "win32",
                });
                child.on("error", () => resolve(null));
                child.on("close", (code) => resolve(code));
            });
            if (status === 0) {
                const newContent = fs.readFileSync(tmpFile, "utf-8").replace(/\n$/, "");
                this.editor.setText(newContent);
            }
        }
        finally {
            try {
                fs.unlinkSync(tmpFile);
            }
            catch {
                // Ignore cleanup errors
            }
            this.tui.start();
            // Force full re-render since external editor uses alternate screen
            this.tui.requestRender(true);
        }
    }
}
//# sourceMappingURL=extension-editor.js.map