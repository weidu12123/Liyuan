import { type Model } from "@liyuan/ai";
import { Container, type Focusable, Input, type TUI } from "@liyuan/tui";
import type { ModelRegistry } from "../../../core/model-registry.ts";
import type { SettingsManager } from "../../../core/settings-manager.ts";
interface ScopedModelItem {
    model: Model<any>;
    thinkingLevel?: string;
}
/**
 * Component that renders a model selector with search
 */
export declare class ModelSelectorComponent extends Container implements Focusable {
    private searchInput;
    private _focused;
    get focused(): boolean;
    set focused(value: boolean);
    private listContainer;
    private allModels;
    private scopedModelItems;
    private activeModels;
    private filteredModels;
    private selectedIndex;
    private currentModel?;
    private settingsManager;
    private modelRegistry;
    private onSelectCallback;
    private onCancelCallback;
    private errorMessage?;
    private tui;
    private scopedModels;
    private scope;
    private scopeText?;
    private scopeHintText?;
    constructor(tui: TUI, currentModel: Model<any> | undefined, settingsManager: SettingsManager, modelRegistry: ModelRegistry, scopedModels: ReadonlyArray<ScopedModelItem>, onSelect: (model: Model<any>) => void, onCancel: () => void, initialSearchInput?: string);
    private loadModels;
    private sortModels;
    private getScopeText;
    private getScopeHintText;
    private setScope;
    private filterModels;
    private updateList;
    handleInput(keyData: string): void;
    private handleSelect;
    getSearchInput(): Input;
}
export {};
//# sourceMappingURL=model-selector.d.ts.map