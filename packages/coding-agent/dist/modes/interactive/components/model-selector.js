import { modelsAreEqual } from "@liyuan/ai";
import { Container, fuzzyFilter, getKeybindings, Input, Spacer, Text, } from "@liyuan/tui";
import { getModelSelectorSearchText } from "../model-search.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";
import { keyHint } from "./keybinding-hints.js";
/**
 * Component that renders a model selector with search
 */
export class ModelSelectorComponent extends Container {
    searchInput;
    // Focusable implementation - propagate to searchInput for IME cursor positioning
    _focused = false;
    get focused() {
        return this._focused;
    }
    set focused(value) {
        this._focused = value;
        this.searchInput.focused = value;
    }
    listContainer;
    allModels = [];
    scopedModelItems = [];
    activeModels = [];
    filteredModels = [];
    selectedIndex = 0;
    currentModel;
    settingsManager;
    modelRegistry;
    onSelectCallback;
    onCancelCallback;
    errorMessage;
    tui;
    scopedModels;
    scope = "all";
    scopeText;
    scopeHintText;
    constructor(tui, currentModel, settingsManager, modelRegistry, scopedModels, onSelect, onCancel, initialSearchInput) {
        super();
        this.tui = tui;
        this.currentModel = currentModel;
        this.settingsManager = settingsManager;
        this.modelRegistry = modelRegistry;
        this.scopedModels = scopedModels;
        this.scope = scopedModels.length > 0 ? "scoped" : "all";
        this.onSelectCallback = onSelect;
        this.onCancelCallback = onCancel;
        // Add top border
        this.addChild(new DynamicBorder());
        this.addChild(new Spacer(1));
        // Add hint about model filtering
        if (scopedModels.length > 0) {
            this.scopeText = new Text(this.getScopeText(), 0, 0);
            this.addChild(this.scopeText);
            this.scopeHintText = new Text(this.getScopeHintText(), 0, 0);
            this.addChild(this.scopeHintText);
        }
        else {
            const hintText = "Only showing models from configured providers. Use /login to add providers.";
            this.addChild(new Text(theme.fg("warning", hintText), 0, 0));
        }
        this.addChild(new Spacer(1));
        // Create search input
        this.searchInput = new Input();
        if (initialSearchInput) {
            this.searchInput.setValue(initialSearchInput);
        }
        this.searchInput.onSubmit = () => {
            // Enter on search input selects the first filtered item
            if (this.filteredModels[this.selectedIndex]) {
                this.handleSelect(this.filteredModels[this.selectedIndex].model);
            }
        };
        this.addChild(this.searchInput);
        this.addChild(new Spacer(1));
        // Create list container
        this.listContainer = new Container();
        this.addChild(this.listContainer);
        this.addChild(new Spacer(1));
        // Add bottom border
        this.addChild(new DynamicBorder());
        // Load models and do initial render
        this.loadModels().then(() => {
            if (initialSearchInput) {
                this.filterModels(initialSearchInput);
            }
            else {
                this.updateList();
            }
            // Request re-render after models are loaded
            this.tui.requestRender();
        });
    }
    async loadModels() {
        let models;
        // Refresh to pick up any changes to models.json
        this.modelRegistry.refresh();
        // Check for models.json errors
        const loadError = this.modelRegistry.getError();
        if (loadError) {
            this.errorMessage = loadError;
        }
        // Load available models (built-in models still work even if models.json failed)
        try {
            const availableModels = await this.modelRegistry.getAvailable();
            models = availableModels.map((model) => ({
                provider: model.provider,
                id: model.id,
                model,
            }));
        }
        catch (error) {
            this.allModels = [];
            this.scopedModelItems = [];
            this.activeModels = [];
            this.filteredModels = [];
            this.errorMessage = error instanceof Error ? error.message : String(error);
            return;
        }
        this.allModels = this.sortModels(models);
        this.scopedModels = this.scopedModels.map((scoped) => {
            const refreshed = this.modelRegistry.find(scoped.model.provider, scoped.model.id);
            return refreshed ? { ...scoped, model: refreshed } : scoped;
        });
        this.scopedModelItems = this.scopedModels.map((scoped) => ({
            provider: scoped.model.provider,
            id: scoped.model.id,
            model: scoped.model,
        }));
        this.activeModels = this.scope === "scoped" ? this.scopedModelItems : this.allModels;
        this.filteredModels = this.activeModels;
        const currentIndex = this.filteredModels.findIndex((item) => modelsAreEqual(this.currentModel, item.model));
        this.selectedIndex =
            currentIndex >= 0 ? currentIndex : Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
    }
    sortModels(models) {
        const sorted = [...models];
        // Sort: current model first, then by provider
        sorted.sort((a, b) => {
            const aIsCurrent = modelsAreEqual(this.currentModel, a.model);
            const bIsCurrent = modelsAreEqual(this.currentModel, b.model);
            if (aIsCurrent && !bIsCurrent)
                return -1;
            if (!aIsCurrent && bIsCurrent)
                return 1;
            return a.provider.localeCompare(b.provider);
        });
        return sorted;
    }
    getScopeText() {
        const allText = this.scope === "all" ? theme.fg("accent", "all") : theme.fg("muted", "all");
        const scopedText = this.scope === "scoped" ? theme.fg("accent", "scoped") : theme.fg("muted", "scoped");
        return `${theme.fg("muted", "Scope: ")}${allText}${theme.fg("muted", " | ")}${scopedText}`;
    }
    getScopeHintText() {
        return keyHint("tui.input.tab", "scope") + theme.fg("muted", " (all/scoped)");
    }
    setScope(scope) {
        if (this.scope === scope)
            return;
        this.scope = scope;
        this.activeModels = this.scope === "scoped" ? this.scopedModelItems : this.allModels;
        const currentIndex = this.activeModels.findIndex((item) => modelsAreEqual(this.currentModel, item.model));
        this.selectedIndex = currentIndex >= 0 ? currentIndex : 0;
        this.filterModels(this.searchInput.getValue());
        if (this.scopeText) {
            this.scopeText.setText(this.getScopeText());
        }
    }
    filterModels(query) {
        this.filteredModels = query
            ? fuzzyFilter(this.activeModels, query, ({ id, provider, model }) => getModelSelectorSearchText({ id, provider, name: model.name }))
            : this.activeModels;
        this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
        this.updateList();
    }
    updateList() {
        this.listContainer.clear();
        const maxVisible = 10;
        const startIndex = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.filteredModels.length - maxVisible));
        const endIndex = Math.min(startIndex + maxVisible, this.filteredModels.length);
        // Show visible slice of filtered models
        for (let i = startIndex; i < endIndex; i++) {
            const item = this.filteredModels[i];
            if (!item)
                continue;
            const isSelected = i === this.selectedIndex;
            const isCurrent = modelsAreEqual(this.currentModel, item.model);
            let line = "";
            if (isSelected) {
                const prefix = theme.fg("accent", "→ ");
                const modelText = `${item.id}`;
                const providerBadge = theme.fg("muted", `[${item.provider}]`);
                const checkmark = isCurrent ? theme.fg("success", " ✓") : "";
                line = `${prefix + theme.fg("accent", modelText)} ${providerBadge}${checkmark}`;
            }
            else {
                const modelText = `  ${item.id}`;
                const providerBadge = theme.fg("muted", `[${item.provider}]`);
                const checkmark = isCurrent ? theme.fg("success", " ✓") : "";
                line = `${modelText} ${providerBadge}${checkmark}`;
            }
            this.listContainer.addChild(new Text(line, 0, 0));
        }
        // Add scroll indicator if needed
        if (startIndex > 0 || endIndex < this.filteredModels.length) {
            const scrollInfo = theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredModels.length})`);
            this.listContainer.addChild(new Text(scrollInfo, 0, 0));
        }
        // Show error message or "no results" if empty
        if (this.errorMessage) {
            // Show error in red
            const errorLines = this.errorMessage.split("\n");
            for (const line of errorLines) {
                this.listContainer.addChild(new Text(theme.fg("error", line), 0, 0));
            }
        }
        else if (this.filteredModels.length === 0) {
            this.listContainer.addChild(new Text(theme.fg("muted", "  No matching models"), 0, 0));
        }
        else {
            const selected = this.filteredModels[this.selectedIndex];
            this.listContainer.addChild(new Spacer(1));
            this.listContainer.addChild(new Text(theme.fg("muted", `  Model Name: ${selected.model.name}`), 0, 0));
        }
    }
    handleInput(keyData) {
        const kb = getKeybindings();
        if (kb.matches(keyData, "tui.input.tab")) {
            if (this.scopedModelItems.length > 0) {
                const nextScope = this.scope === "all" ? "scoped" : "all";
                this.setScope(nextScope);
                if (this.scopeHintText) {
                    this.scopeHintText.setText(this.getScopeHintText());
                }
            }
            return;
        }
        // Up arrow - wrap to bottom when at top
        if (kb.matches(keyData, "tui.select.up")) {
            if (this.filteredModels.length === 0)
                return;
            this.selectedIndex = this.selectedIndex === 0 ? this.filteredModels.length - 1 : this.selectedIndex - 1;
            this.updateList();
        }
        // Down arrow - wrap to top when at bottom
        else if (kb.matches(keyData, "tui.select.down")) {
            if (this.filteredModels.length === 0)
                return;
            this.selectedIndex = this.selectedIndex === this.filteredModels.length - 1 ? 0 : this.selectedIndex + 1;
            this.updateList();
        }
        // Enter
        else if (kb.matches(keyData, "tui.select.confirm")) {
            const selectedModel = this.filteredModels[this.selectedIndex];
            if (selectedModel) {
                this.handleSelect(selectedModel.model);
            }
        }
        // Escape or Ctrl+C
        else if (kb.matches(keyData, "tui.select.cancel")) {
            this.onCancelCallback();
        }
        // Pass everything else to search input
        else {
            this.searchInput.handleInput(keyData);
            this.filterModels(this.searchInput.getValue());
        }
    }
    handleSelect(model) {
        // Save as new default
        this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
        this.onSelectCallback(model);
    }
    getSearchInput() {
        return this.searchInput;
    }
}
//# sourceMappingURL=model-selector.js.map