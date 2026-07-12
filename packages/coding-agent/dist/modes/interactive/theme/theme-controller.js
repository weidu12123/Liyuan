import { detectTerminalBackgroundFromEnv, detectTerminalBackgroundTheme, detectTerminalThemeForAuto, initTheme, parseAutoThemeSetting, resolveThemeSetting, setTheme, setThemeInstance, } from "./theme.js";
export class InteractiveThemeController {
    ui;
    settingsManager;
    showError;
    onChanged;
    terminalTheme = detectTerminalBackgroundFromEnv().theme;
    activeThemeName;
    autoSyncEnabled = false;
    constructor(ui, settingsManager, showError, onChanged) {
        this.ui = ui;
        this.settingsManager = settingsManager;
        this.showError = showError;
        this.onChanged = onChanged;
        this.activeThemeName = resolveThemeSetting(this.settingsManager.getThemeSetting(), this.terminalTheme);
        initTheme(this.activeThemeName, true);
        this.ui.onTerminalColorSchemeChange((terminalTheme) => this.applyTerminalTheme(terminalTheme));
    }
    async applyFromSettings() {
        const themeSetting = this.settingsManager.getThemeSetting();
        const autoTheme = parseAutoThemeSetting(themeSetting);
        if (autoTheme) {
            this.terminalTheme = await detectTerminalThemeForAuto({ ui: this.ui, timeoutMs: 100 });
            this.setAutoSync(true);
            this.applyThemeName(this.terminalTheme === "light" ? autoTheme.lightTheme : autoTheme.darkTheme, true);
            return;
        }
        this.setAutoSync(false);
        if (themeSetting !== undefined) {
            this.applyThemeName(themeSetting, true);
            return;
        }
        const detection = await detectTerminalBackgroundTheme({ ui: this.ui, timeoutMs: 100 });
        this.terminalTheme = detection.theme;
        if (!this.applyThemeName(detection.theme).success)
            return;
        if (detection.confidence === "high") {
            this.settingsManager.setTheme(detection.theme);
            await this.settingsManager.flush();
        }
    }
    setThemeName(themeName, showError = false) {
        this.setAutoSync(false);
        return this.applyThemeName(themeName, showError);
    }
    setThemeInstance(themeInstance) {
        this.setAutoSync(false);
        setThemeInstance(themeInstance);
        this.activeThemeName = "<in-memory>";
        this.notifyChanged();
        return { success: true };
    }
    preview(themeSettingOrName) {
        const themeName = resolveThemeSetting(themeSettingOrName, this.terminalTheme) ?? this.activeThemeName;
        if (!themeName)
            return;
        if (setTheme(themeName, true).success) {
            this.ui.invalidate();
            this.ui.requestRender();
        }
    }
    disableAutoSync() {
        this.setAutoSync(false);
    }
    getTerminalTheme() {
        return this.terminalTheme;
    }
    applyThemeName(themeName, showError = false) {
        const result = setTheme(themeName, true);
        this.activeThemeName = result.success ? themeName : "dark";
        this.notifyChanged();
        if (!result.success && showError) {
            this.showError(`Failed to load theme "${themeName}": ${result.error}\nFell back to dark theme.`);
        }
        return result;
    }
    notifyChanged() {
        this.ui.invalidate();
        this.onChanged();
    }
    setAutoSync(enabled) {
        if (this.autoSyncEnabled === enabled)
            return;
        this.autoSyncEnabled = enabled;
        this.ui.setTerminalColorSchemeNotifications(enabled);
    }
    applyTerminalTheme(terminalTheme) {
        if (!this.autoSyncEnabled)
            return;
        this.terminalTheme = terminalTheme;
        const autoTheme = parseAutoThemeSetting(this.settingsManager.getThemeSetting());
        if (!autoTheme) {
            this.setAutoSync(false);
            return;
        }
        const themeName = terminalTheme === "light" ? autoTheme.lightTheme : autoTheme.darkTheme;
        if (themeName !== this.activeThemeName) {
            this.applyThemeName(themeName);
        }
    }
}
//# sourceMappingURL=theme-controller.js.map