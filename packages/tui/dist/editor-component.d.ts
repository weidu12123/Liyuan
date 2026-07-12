import type { AutocompleteProvider } from "./autocomplete.ts";
import type { Component } from "./tui.ts";
/**
 * Interface for custom editor components.
 *
 * This allows extensions to provide their own editor implementation
 * (e.g., vim mode, emacs mode, custom keybindings) while maintaining
 * compatibility with the core application.
 */
export interface EditorComponent extends Component {
    /** Get the current text content */
    getText(): string;
    /** Set the text content */
    setText(text: string): void;
    /** Handle raw terminal input (key presses, paste sequences, etc.) */
    handleInput(data: string): void;
    /** Called when user submits (e.g., Enter key) */
    onSubmit?: (text: string) => void;
    /** Called when text changes */
    onChange?: (text: string) => void;
    /** Add text to history for up/down navigation */
    addToHistory?(text: string): void;
    /** Insert text at current cursor position */
    insertTextAtCursor?(text: string): void;
    /**
     * Get text with any markers expanded (e.g., paste markers).
     * Falls back to getText() if not implemented.
     */
    getExpandedText?(): string;
    /** Set the autocomplete provider */
    setAutocompleteProvider?(provider: AutocompleteProvider): void;
    /** Border color function */
    borderColor?: (str: string) => string;
    /** Set horizontal padding */
    setPaddingX?(padding: number): void;
    /** Set max visible items in autocomplete dropdown */
    setAutocompleteMaxVisible?(maxVisible: number): void;
}
//# sourceMappingURL=editor-component.d.ts.map