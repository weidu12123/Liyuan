/**
 * TUI component for managing package resources (enable/disable)
 */
import { type Component, Container, type Focusable } from "@liyuan/tui";
import type { PathMetadata, ResolvedPaths } from "../../../core/package-manager.ts";
import type { SettingsManager } from "../../../core/settings-manager.ts";
type ResourceType = "extensions" | "skills" | "prompts" | "themes";
interface ResourceItem {
    path: string;
    enabled: boolean;
    metadata: PathMetadata;
    resourceType: ResourceType;
    displayName: string;
    groupKey: string;
    subgroupKey: string;
}
interface ResourceSubgroup {
    type: ResourceType;
    label: string;
    items: ResourceItem[];
}
interface ResourceGroup {
    key: string;
    label: string;
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
    source: string;
    subgroups: ResourceSubgroup[];
}
declare class ResourceList implements Component, Focusable {
    private groups;
    private flatItems;
    private filteredItems;
    private selectedIndex;
    private searchInput;
    private maxVisible;
    private settingsManager;
    private cwd;
    private agentDir;
    onCancel?: () => void;
    onExit?: () => void;
    onToggle?: (item: ResourceItem, newEnabled: boolean) => void;
    private _focused;
    get focused(): boolean;
    set focused(value: boolean);
    constructor(groups: ResourceGroup[], settingsManager: SettingsManager, cwd: string, agentDir: string, terminalHeight?: number);
    private buildFlatList;
    private findNextItem;
    private filterItems;
    private selectFirstItem;
    updateItem(item: ResourceItem, enabled: boolean): void;
    invalidate(): void;
    render(width: number): string[];
    handleInput(data: string): void;
    private toggleResource;
    private toggleTopLevelResource;
    private togglePackageResource;
    private getTopLevelBaseDir;
    private getResourcePattern;
    private getPackageResourcePattern;
}
export declare class ConfigSelectorComponent extends Container implements Focusable {
    private resourceList;
    private _focused;
    get focused(): boolean;
    set focused(value: boolean);
    constructor(resolvedPaths: ResolvedPaths, settingsManager: SettingsManager, cwd: string, agentDir: string, onClose: () => void, onExit: () => void, requestRender: () => void, terminalHeight?: number);
    getResourceList(): ResourceList;
}
export {};
//# sourceMappingURL=config-selector.d.ts.map