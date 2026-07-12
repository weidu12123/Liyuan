export interface RgbColor {
    r: number;
    g: number;
    b: number;
}
export type TerminalColorScheme = "dark" | "light";
export declare function isOsc11BackgroundColorResponse(data: string): boolean;
export declare function parseOsc11BackgroundColor(data: string): RgbColor | undefined;
export declare function parseTerminalColorSchemeReport(data: string): TerminalColorScheme | undefined;
//# sourceMappingURL=terminal-colors.d.ts.map