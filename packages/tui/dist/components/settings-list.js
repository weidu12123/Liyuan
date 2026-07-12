import { fuzzyFilter } from "../fuzzy.js";
import { getKeybindings } from "../keybindings.js";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "../utils.js";
import { Input } from "./input.js";
export class SettingsList {
    items;
    filteredItems;
    theme;
    selectedIndex = 0;
    maxVisible;
    onChange;
    onCancel;
    searchInput;
    searchEnabled;
    // Submenu state
    submenuComponent = null;
    submenuItemIndex = null;
    constructor(items, maxVisible, theme, onChange, onCancel, options = {}) {
        this.items = items;
        this.filteredItems = items;
        this.maxVisible = maxVisible;
        this.theme = theme;
        this.onChange = onChange;
        this.onCancel = onCancel;
        this.searchEnabled = options.enableSearch ?? false;
        if (this.searchEnabled) {
            this.searchInput = new Input();
        }
    }
    /** Update an item's currentValue */
    updateValue(id, newValue) {
        const item = this.items.find((i) => i.id === id);
        if (item) {
            item.currentValue = newValue;
        }
    }
    invalidate() {
        this.submenuComponent?.invalidate?.();
    }
    render(width) {
        // If submenu is active, render it instead
        if (this.submenuComponent) {
            return this.submenuComponent.render(width);
        }
        return this.renderMainList(width);
    }
    renderMainList(width) {
        const lines = [];
        if (this.searchEnabled && this.searchInput) {
            lines.push(...this.searchInput.render(width));
            lines.push("");
        }
        if (this.items.length === 0) {
            lines.push(this.theme.hint("  No settings available"));
            if (this.searchEnabled) {
                this.addHintLine(lines, width);
            }
            return lines;
        }
        const displayItems = this.searchEnabled ? this.filteredItems : this.items;
        if (displayItems.length === 0) {
            lines.push(truncateToWidth(this.theme.hint("  No matching settings"), width));
            this.addHintLine(lines, width);
            return lines;
        }
        // Calculate visible range with scrolling
        const startIndex = Math.max(0, Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), displayItems.length - this.maxVisible));
        const endIndex = Math.min(startIndex + this.maxVisible, displayItems.length);
        // Calculate max label width for alignment
        const maxLabelWidth = Math.min(30, Math.max(...this.items.map((item) => visibleWidth(item.label))));
        // Render visible items
        for (let i = startIndex; i < endIndex; i++) {
            const item = displayItems[i];
            if (!item)
                continue;
            const isSelected = i === this.selectedIndex;
            const prefix = isSelected ? this.theme.cursor : "  ";
            const prefixWidth = visibleWidth(prefix);
            // Pad label to align values
            const labelPadded = item.label + " ".repeat(Math.max(0, maxLabelWidth - visibleWidth(item.label)));
            const labelText = this.theme.label(labelPadded, isSelected);
            // Calculate space for value
            const separator = "  ";
            const usedWidth = prefixWidth + maxLabelWidth + visibleWidth(separator);
            const valueMaxWidth = width - usedWidth - 2;
            const valueText = this.theme.value(truncateToWidth(item.currentValue, valueMaxWidth, ""), isSelected);
            lines.push(truncateToWidth(prefix + labelText + separator + valueText, width));
        }
        // Add scroll indicator if needed
        if (startIndex > 0 || endIndex < displayItems.length) {
            const scrollText = `  (${this.selectedIndex + 1}/${displayItems.length})`;
            lines.push(this.theme.hint(truncateToWidth(scrollText, width - 2, "")));
        }
        // Add description for selected item
        const selectedItem = displayItems[this.selectedIndex];
        if (selectedItem?.description) {
            lines.push("");
            const wrappedDesc = wrapTextWithAnsi(selectedItem.description, width - 4);
            for (const line of wrappedDesc) {
                lines.push(this.theme.description(`  ${line}`));
            }
        }
        // Add hint
        this.addHintLine(lines, width);
        return lines;
    }
    handleInput(data) {
        // If submenu is active, delegate all input to it
        // The submenu's onCancel (triggered by escape) will call done() which closes it
        if (this.submenuComponent) {
            this.submenuComponent.handleInput?.(data);
            return;
        }
        // Main list input handling
        const kb = getKeybindings();
        const displayItems = this.searchEnabled ? this.filteredItems : this.items;
        if (kb.matches(data, "tui.select.up")) {
            if (displayItems.length === 0)
                return;
            this.selectedIndex = this.selectedIndex === 0 ? displayItems.length - 1 : this.selectedIndex - 1;
        }
        else if (kb.matches(data, "tui.select.down")) {
            if (displayItems.length === 0)
                return;
            this.selectedIndex = this.selectedIndex === displayItems.length - 1 ? 0 : this.selectedIndex + 1;
        }
        else if (kb.matches(data, "tui.select.confirm") || data === " ") {
            this.activateItem();
        }
        else if (kb.matches(data, "tui.select.cancel")) {
            this.onCancel();
        }
        else if (this.searchEnabled && this.searchInput) {
            const sanitized = data.replace(/ /g, "");
            if (!sanitized) {
                return;
            }
            this.searchInput.handleInput(sanitized);
            this.applyFilter(this.searchInput.getValue());
        }
    }
    activateItem() {
        const item = this.searchEnabled ? this.filteredItems[this.selectedIndex] : this.items[this.selectedIndex];
        if (!item)
            return;
        if (item.submenu) {
            // Open submenu, passing current value so it can pre-select correctly
            this.submenuItemIndex = this.selectedIndex;
            this.submenuComponent = item.submenu(item.currentValue, (selectedValue) => {
                if (selectedValue !== undefined) {
                    item.currentValue = selectedValue;
                    this.onChange(item.id, selectedValue);
                }
                this.closeSubmenu();
            });
        }
        else if (item.values && item.values.length > 0) {
            // Cycle through values
            const currentIndex = item.values.indexOf(item.currentValue);
            const nextIndex = (currentIndex + 1) % item.values.length;
            const newValue = item.values[nextIndex];
            item.currentValue = newValue;
            this.onChange(item.id, newValue);
        }
    }
    closeSubmenu() {
        this.submenuComponent = null;
        // Restore selection to the item that opened the submenu
        if (this.submenuItemIndex !== null) {
            this.selectedIndex = this.submenuItemIndex;
            this.submenuItemIndex = null;
        }
    }
    applyFilter(query) {
        this.filteredItems = fuzzyFilter(this.items, query, (item) => item.label);
        this.selectedIndex = 0;
    }
    addHintLine(lines, width) {
        lines.push("");
        lines.push(truncateToWidth(this.theme.hint(this.searchEnabled
            ? "  Type to search · Enter/Space to change · Esc to cancel"
            : "  Enter/Space to change · Esc to cancel"), width));
    }
}
//# sourceMappingURL=settings-list.js.map