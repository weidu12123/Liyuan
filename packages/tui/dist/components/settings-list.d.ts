import type { Component } from "../tui.ts";
export interface SettingItem {
    /** Unique identifier for this setting */
    id: string;
    /** Display label (left side) */
    label: string;
    /** Optional description shown when selected */
    description?: string;
    /** Current value to display (right side) */
    currentValue: string;
    /** If provided, Enter/Space cycles through these values */
    values?: string[];
    /** If provided, Enter opens this submenu. Receives current value and done callback. */
    submenu?: (currentValue: string, done: (selectedValue?: string) => void) => Component;
}
export interface SettingsListTheme {
    label: (text: string, selected: boolean) => string;
    value: (text: string, selected: boolean) => string;
    description: (text: string) => string;
    cursor: string;
    hint: (text: string) => string;
}
export interface SettingsListOptions {
    enableSearch?: boolean;
}
export declare class SettingsList implements Component {
    private items;
    private filteredItems;
    private theme;
    private selectedIndex;
    private maxVisible;
    private onChange;
    private onCancel;
    private searchInput?;
    private searchEnabled;
    private submenuComponent;
    private submenuItemIndex;
    constructor(items: SettingItem[], maxVisible: number, theme: SettingsListTheme, onChange: (id: string, newValue: string) => void, onCancel: () => void, options?: SettingsListOptions);
    /** Update an item's currentValue */
    updateValue(id: string, newValue: string): void;
    invalidate(): void;
    render(width: number): string[];
    private renderMainList;
    handleInput(data: string): void;
    private activateItem;
    private closeSubmenu;
    private applyFilter;
    private addHintLine;
}
//# sourceMappingURL=settings-list.d.ts.map