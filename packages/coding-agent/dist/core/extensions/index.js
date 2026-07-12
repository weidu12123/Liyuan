/**
 * Extension system for lifecycle events and custom tools.
 */
export { createExtensionRuntime, discoverAndLoadExtensions, loadExtensionFromFactory, loadExtensions, } from "./loader.js";
export { ExtensionRunner } from "./runner.js";
// Type guards
export { defineTool, isBashToolResult, isEditToolResult, isFindToolResult, isGrepToolResult, isLsToolResult, isReadToolResult, isToolCallEventType, isWriteToolResult, } from "./types.js";
export { wrapRegisteredTool, wrapRegisteredTools } from "./wrapper.js";
//# sourceMappingURL=index.js.map