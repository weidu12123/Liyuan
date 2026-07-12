import type { Component } from "../tui.ts";
export interface SelectItem {
    value: string;
    label: string;
    description?: string;
}
export interface SelectListTheme {
    selectedPrefix: (text: string) => string;
    selectedText: (text: string) => string;
    description: (text: string) => string;
    scrollInfo: (text: string) => string;
    noMatch: (text: string) => string;
}
export interface SelectListTruncatePrimaryContext {
    text: string;
    maxWidth: number;
    columnWidth: number;
    item: SelectItem;
    isSelected: boolean;
}
export interface SelectListLayoutOptions {
    minPrimaryColumnWidth?: number;
    maxPrimaryColumnWidth?: number;
    truncatePrimary?: (context: SelectListTruncatePrimaryContext) => string;
}
export declare class SelectList implements Component {
    private items;
    private filteredItems;
    private selectedIndex;
    private maxVisible;
    private theme;
    private layout;
    onSelect?: (item: SelectItem) => void;
    onCancel?: () => void;
    onSelectionChange?: (item: SelectItem) => void;
    constructor(items: SelectItem[], maxVisible: number, theme: SelectListTheme, layout?: SelectListLayoutOptions);
    setFilter(filter: string): void;
    setSelectedIndex(index: number): void;
    invalidate(): void;
    render(width: number): string[];
    handleInput(keyData: string): void;
    private renderItem;
    private getPrimaryColumnWidth;
    private getPrimaryColumnBounds;
    private truncatePrimary;
    private getDisplayValue;
    private notifySelectionChange;
    getSelectedItem(): SelectItem | null;
}
//# sourceMappingURL=select-list.d.ts.map