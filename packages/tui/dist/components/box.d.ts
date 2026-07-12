import type { Component } from "../tui.ts";
/**
 * Box component - a container that applies padding and background to all children
 */
export declare class Box implements Component {
    children: Component[];
    private paddingX;
    private paddingY;
    private bgFn?;
    private cache?;
    constructor(paddingX?: number, paddingY?: number, bgFn?: (text: string) => string);
    addChild(component: Component): void;
    removeChild(component: Component): void;
    clear(): void;
    setBgFn(bgFn?: (text: string) => string): void;
    private invalidateCache;
    private matchCache;
    invalidate(): void;
    render(width: number): string[];
    private applyBg;
}
//# sourceMappingURL=box.d.ts.map