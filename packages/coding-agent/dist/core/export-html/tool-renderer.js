/**
 * Tool HTML renderer for custom tools in HTML export.
 *
 * Renders custom tool calls and results to HTML by invoking their TUI renderers
 * and converting the ANSI output to HTML.
 */
import { ansiLinesToHtml } from "./ansi-to-html.js";
/**
 * Create a tool HTML renderer.
 *
 * The renderer looks up tool definitions and invokes their renderCall/renderResult
 * methods, converting the resulting TUI Component output (ANSI) to HTML.
 */
const ANSI_ESCAPE_REGEX = /\x1b\[[\d;]*m/g;
function isBlankRenderedLine(line) {
    return line.replace(ANSI_ESCAPE_REGEX, "").trim().length === 0;
}
function trimRenderedResultLines(lines) {
    let start = 0;
    let end = lines.length;
    while (start < end && isBlankRenderedLine(lines[start]))
        start++;
    while (end > start && isBlankRenderedLine(lines[end - 1]))
        end--;
    return lines.slice(start, end);
}
export function createToolHtmlRenderer(deps) {
    const { getToolDefinition, theme, cwd, width = 100 } = deps;
    const renderedCallComponents = new Map();
    const renderedResultComponents = new Map();
    const renderedStates = new Map();
    const renderedArgs = new Map();
    const getState = (toolCallId) => {
        let state = renderedStates.get(toolCallId);
        if (!state) {
            state = {};
            renderedStates.set(toolCallId, state);
        }
        return state;
    };
    const createRenderContext = (toolCallId, lastComponent, expanded, isPartial, isError) => {
        return {
            args: renderedArgs.get(toolCallId),
            toolCallId,
            invalidate: () => { },
            lastComponent,
            state: getState(toolCallId),
            cwd,
            executionStarted: true,
            argsComplete: true,
            isPartial,
            expanded,
            showImages: false,
            isError,
        };
    };
    return {
        renderCall(toolCallId, toolName, args) {
            try {
                renderedArgs.set(toolCallId, args);
                const toolDef = getToolDefinition(toolName);
                if (!toolDef?.renderCall) {
                    return undefined;
                }
                const component = toolDef.renderCall(args, theme, createRenderContext(toolCallId, renderedCallComponents.get(toolCallId), false, true, false));
                renderedCallComponents.set(toolCallId, component);
                const lines = component.render(width);
                return ansiLinesToHtml(lines);
            }
            catch {
                // On error, return undefined so HTML export can fall back to structured result rendering
                return undefined;
            }
        },
        renderResult(toolCallId, toolName, result, details, isError) {
            try {
                const toolDef = getToolDefinition(toolName);
                if (!toolDef?.renderResult) {
                    return undefined;
                }
                // Build AgentToolResult from content array
                // Cast content since session storage uses generic object types
                const agentToolResult = {
                    content: result,
                    details,
                    isError,
                };
                // Render collapsed
                const collapsedComponent = toolDef.renderResult(agentToolResult, { expanded: false, isPartial: false }, theme, createRenderContext(toolCallId, renderedResultComponents.get(toolCallId), false, false, isError));
                renderedResultComponents.set(toolCallId, collapsedComponent);
                const collapsed = ansiLinesToHtml(trimRenderedResultLines(collapsedComponent.render(width)));
                // Render expanded
                const expandedComponent = toolDef.renderResult(agentToolResult, { expanded: true, isPartial: false }, theme, createRenderContext(toolCallId, renderedResultComponents.get(toolCallId), true, false, isError));
                renderedResultComponents.set(toolCallId, expandedComponent);
                const expanded = ansiLinesToHtml(trimRenderedResultLines(expandedComponent.render(width)));
                return {
                    ...(collapsed && collapsed !== expanded ? { collapsed } : {}),
                    expanded,
                };
            }
            catch {
                // On error, return undefined so HTML export can fall back to structured result rendering
                return undefined;
            }
        },
    };
}
//# sourceMappingURL=tool-renderer.js.map