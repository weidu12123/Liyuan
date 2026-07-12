import { Box, Container, getCapabilities, Image, Spacer, Text } from "@liyuan/tui";
import { createAllToolDefinitions } from "../../../core/tools/index.js";
import { getTextOutput as getRenderedTextOutput } from "../../../core/tools/render-utils.js";
import { convertToPng } from "../../../utils/image-convert.js";
import { theme } from "../theme/theme.js";
export class ToolExecutionComponent extends Container {
    contentBox;
    contentText;
    selfRenderContainer;
    callRendererComponent;
    resultRendererComponent;
    rendererState = {};
    imageComponents = [];
    imageSpacers = [];
    toolName;
    toolCallId;
    args;
    expanded = false;
    showImages;
    imageWidthCells;
    isPartial = true;
    toolDefinition;
    builtInToolDefinition;
    ui;
    cwd;
    executionStarted = false;
    argsComplete = false;
    result;
    convertedImages = new Map();
    hideComponent = false;
    constructor(toolName, toolCallId, args, options = {}, toolDefinition, ui, cwd) {
        super();
        this.toolName = toolName;
        this.toolCallId = toolCallId;
        this.args = args;
        this.toolDefinition = toolDefinition;
        this.builtInToolDefinition = createAllToolDefinitions(cwd)[toolName];
        this.showImages = options.showImages ?? true;
        this.imageWidthCells = options.imageWidthCells ?? 60;
        this.ui = ui;
        this.cwd = cwd;
        this.addChild(new Spacer(1));
        // Always create all shell variants. contentBox is used for default renderer-based composition.
        // selfRenderContainer is used when the tool renders its own framing.
        // contentText is reserved for generic fallback rendering when no tool definition exists.
        this.contentBox = new Box(1, 1, (text) => theme.bg("toolPendingBg", text));
        this.contentText = new Text("", 1, 1, (text) => theme.bg("toolPendingBg", text));
        this.selfRenderContainer = new Container();
        if (this.hasRendererDefinition()) {
            this.addChild(this.getRenderShell() === "self" ? this.selfRenderContainer : this.contentBox);
        }
        else {
            this.addChild(this.contentText);
        }
        this.updateDisplay();
    }
    getCallRenderer() {
        if (!this.builtInToolDefinition) {
            return this.toolDefinition?.renderCall;
        }
        if (!this.toolDefinition) {
            return this.builtInToolDefinition.renderCall;
        }
        return this.toolDefinition.renderCall ?? this.builtInToolDefinition.renderCall;
    }
    getResultRenderer() {
        if (!this.builtInToolDefinition) {
            return this.toolDefinition?.renderResult;
        }
        if (!this.toolDefinition) {
            return this.builtInToolDefinition.renderResult;
        }
        return this.toolDefinition.renderResult ?? this.builtInToolDefinition.renderResult;
    }
    hasRendererDefinition() {
        return this.builtInToolDefinition !== undefined || this.toolDefinition !== undefined;
    }
    getRenderShell() {
        if (!this.builtInToolDefinition) {
            return this.toolDefinition?.renderShell ?? "default";
        }
        if (!this.toolDefinition) {
            return this.builtInToolDefinition.renderShell ?? "default";
        }
        return this.toolDefinition.renderShell ?? this.builtInToolDefinition.renderShell ?? "default";
    }
    getRenderContext(lastComponent) {
        return {
            args: this.args,
            toolCallId: this.toolCallId,
            invalidate: () => {
                this.invalidate();
                this.ui.requestRender();
            },
            lastComponent,
            state: this.rendererState,
            cwd: this.cwd,
            executionStarted: this.executionStarted,
            argsComplete: this.argsComplete,
            isPartial: this.isPartial,
            expanded: this.expanded,
            showImages: this.showImages,
            isError: this.result?.isError ?? false,
        };
    }
    createCallFallback() {
        return new Text(theme.fg("toolTitle", theme.bold(this.toolName)), 0, 0);
    }
    createResultFallback() {
        const output = this.getTextOutput();
        if (!output) {
            return undefined;
        }
        return new Text(theme.fg("toolOutput", output), 0, 0);
    }
    updateArgs(args) {
        this.args = args;
        this.updateDisplay();
    }
    markExecutionStarted() {
        this.executionStarted = true;
        this.updateDisplay();
        this.ui.requestRender();
    }
    setArgsComplete() {
        this.argsComplete = true;
        this.updateDisplay();
        this.ui.requestRender();
    }
    updateResult(result, isPartial = false) {
        this.result = result;
        this.isPartial = isPartial;
        this.updateDisplay();
        this.maybeConvertImagesForKitty();
    }
    maybeConvertImagesForKitty() {
        const caps = getCapabilities();
        if (caps.images !== "kitty")
            return;
        if (!this.result)
            return;
        const imageBlocks = this.result.content.filter((c) => c.type === "image");
        for (let i = 0; i < imageBlocks.length; i++) {
            const img = imageBlocks[i];
            if (!img.data || !img.mimeType)
                continue;
            if (img.mimeType === "image/png")
                continue;
            if (this.convertedImages.has(i))
                continue;
            const index = i;
            convertToPng(img.data, img.mimeType).then((converted) => {
                if (converted) {
                    this.convertedImages.set(index, converted);
                    this.updateDisplay();
                    this.ui.requestRender();
                }
            });
        }
    }
    setExpanded(expanded) {
        this.expanded = expanded;
        this.updateDisplay();
    }
    setShowImages(show) {
        this.showImages = show;
        this.updateDisplay();
    }
    setImageWidthCells(width) {
        this.imageWidthCells = Math.max(1, Math.floor(width));
        this.updateDisplay();
    }
    invalidate() {
        super.invalidate();
        this.updateDisplay();
    }
    render(width) {
        if (this.hideComponent) {
            return [];
        }
        if (this.hasRendererDefinition() && this.getRenderShell() === "self") {
            const contentLines = this.selfRenderContainer.render(width);
            if (contentLines.length === 0 && this.imageComponents.length === 0) {
                return [];
            }
            const lines = [];
            if (contentLines.length > 0) {
                lines.push("");
                lines.push(...contentLines);
            }
            for (let i = 0; i < this.imageComponents.length; i++) {
                const spacer = this.imageSpacers[i];
                if (spacer) {
                    lines.push(...spacer.render(width));
                }
                const imageComponent = this.imageComponents[i];
                if (imageComponent) {
                    lines.push(...imageComponent.render(width));
                }
            }
            return lines;
        }
        return super.render(width);
    }
    updateDisplay() {
        const bgFn = this.isPartial
            ? (text) => theme.bg("toolPendingBg", text)
            : this.result?.isError
                ? (text) => theme.bg("toolErrorBg", text)
                : (text) => theme.bg("toolSuccessBg", text);
        let hasContent = false;
        this.hideComponent = false;
        if (this.hasRendererDefinition()) {
            const renderContainer = this.getRenderShell() === "self" ? this.selfRenderContainer : this.contentBox;
            if (renderContainer instanceof Box) {
                renderContainer.setBgFn(bgFn);
            }
            renderContainer.clear();
            const callRenderer = this.getCallRenderer();
            if (!callRenderer) {
                renderContainer.addChild(this.createCallFallback());
                hasContent = true;
            }
            else {
                try {
                    const component = callRenderer(this.args, theme, this.getRenderContext(this.callRendererComponent));
                    this.callRendererComponent = component;
                    renderContainer.addChild(component);
                    hasContent = true;
                }
                catch {
                    this.callRendererComponent = undefined;
                    renderContainer.addChild(this.createCallFallback());
                    hasContent = true;
                }
            }
            if (this.result) {
                const resultRenderer = this.getResultRenderer();
                if (!resultRenderer) {
                    const component = this.createResultFallback();
                    if (component) {
                        renderContainer.addChild(component);
                        hasContent = true;
                    }
                }
                else {
                    try {
                        const component = resultRenderer({ content: this.result.content, details: this.result.details }, { expanded: this.expanded, isPartial: this.isPartial }, theme, this.getRenderContext(this.resultRendererComponent));
                        this.resultRendererComponent = component;
                        renderContainer.addChild(component);
                        hasContent = true;
                    }
                    catch {
                        this.resultRendererComponent = undefined;
                        const component = this.createResultFallback();
                        if (component) {
                            renderContainer.addChild(component);
                            hasContent = true;
                        }
                    }
                }
            }
        }
        else {
            this.contentText.setCustomBgFn(bgFn);
            this.contentText.setText(this.formatToolExecution());
            hasContent = true;
        }
        for (const img of this.imageComponents) {
            this.removeChild(img);
        }
        this.imageComponents = [];
        for (const spacer of this.imageSpacers) {
            this.removeChild(spacer);
        }
        this.imageSpacers = [];
        if (this.result) {
            const imageBlocks = this.result.content.filter((c) => c.type === "image");
            const caps = getCapabilities();
            for (let i = 0; i < imageBlocks.length; i++) {
                const img = imageBlocks[i];
                if (caps.images && this.showImages && img.data && img.mimeType) {
                    const converted = this.convertedImages.get(i);
                    const imageData = converted?.data ?? img.data;
                    const imageMimeType = converted?.mimeType ?? img.mimeType;
                    if (caps.images === "kitty" && imageMimeType !== "image/png")
                        continue;
                    const spacer = new Spacer(1);
                    this.addChild(spacer);
                    this.imageSpacers.push(spacer);
                    const imageComponent = new Image(imageData, imageMimeType, { fallbackColor: (s) => theme.fg("toolOutput", s) }, { maxWidthCells: this.imageWidthCells });
                    this.imageComponents.push(imageComponent);
                    this.addChild(imageComponent);
                }
            }
        }
        if (this.hasRendererDefinition() && !hasContent && this.imageComponents.length === 0) {
            this.hideComponent = true;
        }
    }
    getTextOutput() {
        return getRenderedTextOutput(this.result, this.showImages);
    }
    formatToolExecution() {
        let text = theme.fg("toolTitle", theme.bold(this.toolName));
        const content = JSON.stringify(this.args, null, 2);
        if (content) {
            text += `\n\n${content}`;
        }
        const output = this.getTextOutput();
        if (output) {
            text += `\n${output}`;
        }
        return text;
    }
}
//# sourceMappingURL=tool-execution.js.map