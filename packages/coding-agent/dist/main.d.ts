/**
 * Main entry point for the coding agent CLI.
 *
 * This file handles CLI argument parsing and translates them into
 * createAgentSession() options. The SDK does the heavy lifting.
 */
import type { ExtensionFactory } from "./core/extensions/types.ts";
export interface MainOptions {
    extensionFactories?: ExtensionFactory[];
}
export declare function main(args: string[], options?: MainOptions): Promise<void>;
//# sourceMappingURL=main.d.ts.map