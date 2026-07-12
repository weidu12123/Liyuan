import { type Component, type Focusable } from "../tui.ts";
/**
 * Input component - single-line text input with horizontal scrolling
 */
export declare class Input implements Component, Focusable {
    private value;
    private cursor;
    onSubmit?: (value: string) => void;
    onEscape?: () => void;
    /** Focusable interface - set by TUI when focus changes */
    focused: boolean;
    private pasteBuffer;
    private isInPaste;
    private killRing;
    private lastAction;
    private undoStack;
    getValue(): string;
    setValue(value: string): void;
    handleInput(data: string): void;
    private insertCharacter;
    private handleBackspace;
    private handleForwardDelete;
    private deleteToLineStart;
    private deleteToLineEnd;
    private deleteWordBackwards;
    private deleteWordForward;
    private yank;
    private yankPop;
    private pushUndo;
    private undo;
    private moveWordBackwards;
    private moveWordForwards;
    private handlePaste;
    invalidate(): void;
    render(width: number): string[];
}
//# sourceMappingURL=input.d.ts.map