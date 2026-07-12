function isTruthyEnvFlag(value) {
    if (!value)
        return false;
    return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}
export function isInstallTelemetryEnabled(settingsManager, telemetryEnv = process.env.PI_TELEMETRY) {
    return telemetryEnv !== undefined ? isTruthyEnvFlag(telemetryEnv) : settingsManager.getEnableInstallTelemetry();
}
//# sourceMappingURL=telemetry.js.map