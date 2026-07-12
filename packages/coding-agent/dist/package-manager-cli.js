import { Markdown } from "@liyuan/tui";
import chalk from "chalk";
import { selectConfig } from "./cli/config-selector.js";
import { createProjectTrustContext } from "./cli/project-trust.js";
import { APP_NAME, CONFIG_DIR_NAME, detectInstallMethod, getAgentDir, getPackageDir, getSelfUpdateCommand, getSelfUpdateUnavailableInstruction, PACKAGE_NAME, VERSION, } from "./config.js";
import { DefaultPackageManager } from "./core/package-manager.js";
import { resolveProjectTrusted } from "./core/project-trust.js";
import { DefaultResourceLoader } from "./core/resource-loader.js";
import { SettingsManager } from "./core/settings-manager.js";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "./core/trust-manager.js";
import { spawnProcess } from "./utils/child-process.js";
import { getLatestPiRelease, isNewerPackageVersion } from "./utils/version-check.js";
import { cleanupWindowsSelfUpdateQuarantine, quarantineWindowsNativeDependencies, } from "./utils/windows-self-update.js";
const SELF_UPDATE_NOTE_MARKDOWN_THEME = {
    heading: (text) => chalk.bold(chalk.yellow(text)),
    link: (text) => chalk.cyan(text),
    linkUrl: (text) => chalk.dim(text),
    code: (text) => chalk.yellow(text),
    codeBlock: (text) => chalk.dim(text),
    codeBlockBorder: (text) => chalk.dim(text),
    quote: (text) => chalk.dim(text),
    quoteBorder: (text) => chalk.dim(text),
    hr: (text) => chalk.dim(text),
    listBullet: (text) => chalk.yellow(text),
    bold: (text) => chalk.bold(text),
    italic: (text) => chalk.italic(text),
    strikethrough: (text) => chalk.strikethrough(text),
    underline: (text) => chalk.underline(text),
};
function reportSettingsErrors(settingsManager, context) {
    const errors = settingsManager.drainErrors();
    for (const { scope, error } of errors) {
        console.error(chalk.yellow(`Warning (${context}, ${scope} settings): ${error.message}`));
        if (error.stack) {
            console.error(chalk.dim(error.stack));
        }
    }
}
function getPackageCommandUsage(command) {
    switch (command) {
        case "install":
            return `${APP_NAME} install <source> [-l] [--approve|--no-approve]`;
        case "remove":
            return `${APP_NAME} remove <source> [-l] [--approve|--no-approve]`;
        case "update":
            return `${APP_NAME} update [source|self|pi] [--self|--extensions|--all] [--extension <source>] [--approve|--no-approve] [--force]`;
        case "list":
            return `${APP_NAME} list [--approve|--no-approve]`;
    }
}
function printPackageCommandHelp(command) {
    switch (command) {
        case "install":
            console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("install")}

Install a package and add it to settings.

Options:
  -l, --local       Install project-locally (${CONFIG_DIR_NAME}/settings.json)
  -a, --approve     Trust project-local files for this command
  -na, --no-approve Ignore project-local files for this command

Examples:
  ${APP_NAME} install npm:@foo/bar
  ${APP_NAME} install git:github.com/user/repo
  ${APP_NAME} install git:git@github.com:user/repo
  ${APP_NAME} install https://github.com/user/repo
  ${APP_NAME} install ssh://git@github.com/user/repo
  ${APP_NAME} install ./local/path
`);
            return;
        case "remove":
            console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("remove")}

Remove a package and its source from settings.
Alias: ${APP_NAME} uninstall <source> [-l]

Options:
  -l, --local       Remove from project settings (${CONFIG_DIR_NAME}/settings.json)
  -a, --approve     Trust project-local files for this command
  -na, --no-approve Ignore project-local files for this command

Examples:
  ${APP_NAME} remove npm:@foo/bar
  ${APP_NAME} uninstall npm:@foo/bar
`);
            return;
        case "update":
            console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("update")}

Update pi and installed packages.

Options:
  --self                  Update pi only (default when no target is given)
  --extensions            Update installed packages only
  --all                   Update pi and installed packages
  --extension <source>    Update one package only
  -a, --approve           Trust project-local files for this command
  -na, --no-approve       Ignore project-local files for this command
  --force                 Reinstall pi even if the current version is latest

Short forms:
  ${APP_NAME} update                Update pi only
  ${APP_NAME} update --all          Update pi and all extensions
  ${APP_NAME} update <source>       Update one package
  ${APP_NAME} update pi             Update pi only (self works as alias to pi)
`);
            return;
        case "list":
            console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("list")}

List installed packages from user and project settings.

Options:
  -a, --approve      Trust project-local files for this command
  -na, --no-approve  Ignore project-local files for this command
`);
            return;
    }
}
function parsePackageCommand(args) {
    const [rawCommand, ...rest] = args;
    let command;
    if (rawCommand === "uninstall") {
        command = "remove";
    }
    else if (rawCommand === "install" || rawCommand === "remove" || rawCommand === "update" || rawCommand === "list") {
        command = rawCommand;
    }
    if (!command) {
        return undefined;
    }
    let local = false;
    let force = false;
    let projectTrustOverride;
    let help = false;
    let invalidOption;
    let invalidArgument;
    let missingOptionValue;
    let conflictingOptions;
    let source;
    let selfFlag = false;
    let extensionsFlag = false;
    let allFlag = false;
    let extensionFlagSource;
    for (let index = 0; index < rest.length; index++) {
        const arg = rest[index];
        if (arg === "-h" || arg === "--help") {
            help = true;
            continue;
        }
        if (arg === "-l" || arg === "--local") {
            if (command === "install" || command === "remove") {
                local = true;
            }
            else {
                invalidOption = invalidOption ?? arg;
            }
            continue;
        }
        if (arg === "--self") {
            if (command === "update") {
                selfFlag = true;
            }
            else {
                invalidOption = invalidOption ?? arg;
            }
            continue;
        }
        if (arg === "--extensions") {
            if (command === "update") {
                extensionsFlag = true;
            }
            else {
                invalidOption = invalidOption ?? arg;
            }
            continue;
        }
        if (arg === "--all") {
            if (command === "update") {
                allFlag = true;
            }
            else {
                invalidOption = invalidOption ?? arg;
            }
            continue;
        }
        if (arg === "--approve" || arg === "-a") {
            projectTrustOverride = true;
            continue;
        }
        if (arg === "--no-approve" || arg === "-na") {
            projectTrustOverride = false;
            continue;
        }
        if (arg === "--force") {
            if (command === "update") {
                force = true;
            }
            else {
                invalidOption = invalidOption ?? arg;
            }
            continue;
        }
        if (arg === "--extension") {
            if (command !== "update") {
                invalidOption = invalidOption ?? arg;
                continue;
            }
            const value = rest[index + 1];
            if (!value || value.startsWith("-")) {
                missingOptionValue = missingOptionValue ?? arg;
            }
            else if (extensionFlagSource) {
                conflictingOptions = conflictingOptions ?? "--extension can only be provided once";
                index++;
            }
            else {
                extensionFlagSource = value;
                index++;
            }
            continue;
        }
        if (arg.startsWith("-")) {
            invalidOption = invalidOption ?? arg;
            continue;
        }
        if (!source) {
            source = arg;
        }
        else {
            invalidArgument = invalidArgument ?? arg;
        }
    }
    let updateTarget;
    let showExtensionsSkippedNote = false;
    if (command === "update") {
        if (allFlag && (selfFlag || extensionsFlag || extensionFlagSource)) {
            conflictingOptions =
                conflictingOptions ?? "--all cannot be combined with --self, --extensions, or --extension";
        }
        if (allFlag && source) {
            conflictingOptions = conflictingOptions ?? "--all cannot be combined with a positional source";
        }
        if (extensionFlagSource) {
            if (selfFlag || extensionsFlag || allFlag) {
                conflictingOptions =
                    conflictingOptions ?? "--extension cannot be combined with --self, --extensions, or --all";
            }
            if (source) {
                conflictingOptions = conflictingOptions ?? "--extension cannot be combined with a positional source";
            }
            updateTarget = { type: "extensions", source: extensionFlagSource };
        }
        else if (source) {
            const sourceIsSelf = source === "self" || source === "pi";
            if (sourceIsSelf) {
                updateTarget = extensionsFlag ? { type: "all" } : { type: "self" };
            }
            else {
                if (extensionsFlag || selfFlag || allFlag) {
                    conflictingOptions =
                        conflictingOptions ??
                            "positional update targets cannot be combined with --self, --extensions, or --all";
                }
                updateTarget = { type: "extensions", source };
            }
        }
        else if (allFlag) {
            updateTarget = { type: "all" };
        }
        else if (selfFlag && extensionsFlag) {
            updateTarget = { type: "all" };
        }
        else if (selfFlag) {
            updateTarget = { type: "self" };
        }
        else if (extensionsFlag) {
            updateTarget = { type: "extensions" };
        }
        else {
            updateTarget = { type: "self" };
            showExtensionsSkippedNote = true;
        }
    }
    return {
        command,
        source,
        updateTarget,
        showExtensionsSkippedNote,
        local,
        force,
        projectTrustOverride,
        help,
        invalidOption,
        invalidArgument,
        missingOptionValue,
        conflictingOptions,
    };
}
function updateTargetIncludesSelf(target) {
    return target.type === "all" || target.type === "self";
}
function updateTargetIncludesExtensions(target) {
    return target.type === "all" || target.type === "extensions";
}
function printSelfUpdateUnavailable(npmCommand, updatePackageTarget = PACKAGE_NAME) {
    console.error(`error: ${APP_NAME} cannot self-update this installation.`);
    console.error(getSelfUpdateUnavailableInstruction(PACKAGE_NAME, npmCommand, updatePackageTarget));
    const entrypoint = process.argv[1];
    if (entrypoint) {
        console.error("");
        console.error(`Location of pi executable: ${entrypoint}`);
    }
}
function printSelfUpdateFallback(command) {
    console.error(chalk.dim(`If this keeps failing, run this command yourself: ${command.display}`));
}
function printSelfUpdateNote(note) {
    const trimmedNote = note.trim();
    if (!trimmedNote) {
        return;
    }
    console.log();
    console.log(chalk.bold(chalk.yellow("Update note")));
    try {
        const width = Math.max(20, process.stdout.columns ?? 80);
        const renderedLines = new Markdown(trimmedNote, 0, 0, SELF_UPDATE_NOTE_MARKDOWN_THEME)
            .render(width)
            .map((line) => line.trimEnd());
        console.log(renderedLines.join("\n"));
    }
    catch {
        console.log(trimmedNote);
    }
    console.log();
}
async function getSelfUpdatePlan(force) {
    let latestRelease;
    try {
        latestRelease = await getLatestPiRelease(VERSION);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not determine latest ${APP_NAME} version: ${message}`);
    }
    if (!latestRelease) {
        throw new Error(`Could not determine latest ${APP_NAME} version.`);
    }
    const packageName = latestRelease.packageName ?? PACKAGE_NAME;
    const installSpec = `${packageName}@${latestRelease.version}`;
    if (force || packageName !== PACKAGE_NAME || isNewerPackageVersion(latestRelease.version, VERSION)) {
        return {
            packageName,
            installSpec,
            version: latestRelease.version,
            ...(latestRelease.note ? { note: latestRelease.note } : {}),
            shouldRun: true,
        };
    }
    console.log(chalk.green(`${APP_NAME} is already up to date (v${VERSION})`));
    return { packageName, installSpec, version: latestRelease.version, shouldRun: false };
}
async function runSelfUpdate(command) {
    console.log(chalk.dim(`Updating ${APP_NAME} with ${command.display}...`));
    for (const step of command.steps ?? [command]) {
        await new Promise((resolve, reject) => {
            const child = spawnProcess(step.command, step.args, {
                stdio: "inherit",
            });
            child.on("error", (error) => {
                reject(error);
            });
            child.on("close", (code, signal) => {
                if (code === 0) {
                    resolve();
                }
                else if (signal) {
                    reject(new Error(`${step.display} terminated by signal ${signal}`));
                }
                else {
                    reject(new Error(`${step.display} exited with code ${code ?? "unknown"}`));
                }
            });
        });
    }
}
function prepareWindowsNpmSelfUpdate() {
    if (process.platform !== "win32") {
        return;
    }
    const packageDir = getPackageDir();
    cleanupWindowsSelfUpdateQuarantine(packageDir);
    quarantineWindowsNativeDependencies(packageDir);
}
function parseProjectTrustOverride(args) {
    let trustOverride;
    for (const arg of args) {
        if (arg === "--approve" || arg === "-a") {
            trustOverride = true;
        }
        else if (arg === "--no-approve" || arg === "-na") {
            trustOverride = false;
        }
    }
    return trustOverride;
}
function getCommandAppMode() {
    return process.stdin.isTTY && process.stdout.isTTY ? "interactive" : "print";
}
function reportProjectTrustWarnings(warnings) {
    for (const warning of warnings) {
        console.error(chalk.yellow(`Warning: ${warning}`));
    }
}
async function createCommandSettingsManager(options) {
    const settingsManager = SettingsManager.create(options.cwd, options.agentDir, { projectTrusted: false });
    const projectTrustWarnings = [];
    const trustStore = new ProjectTrustStore(options.agentDir);
    if (options.useSavedProjectTrustOnly) {
        const savedProjectTrusted = trustStore.get(options.cwd) === true;
        settingsManager.setProjectTrusted(options.projectTrustOverride ?? savedProjectTrusted);
        return { settingsManager, projectTrustWarnings };
    }
    const appMode = getCommandAppMode();
    const extensionsResult = options.projectTrustOverride === undefined && hasTrustRequiringProjectResources(options.cwd)
        ? await new DefaultResourceLoader({
            cwd: options.cwd,
            agentDir: options.agentDir,
            settingsManager,
            extensionFactories: options.extensionFactories,
        }).loadProjectTrustExtensions()
        : undefined;
    for (const error of extensionsResult?.errors ?? []) {
        projectTrustWarnings.push(`Failed to load extension "${error.path}": ${error.error}`);
    }
    const projectTrusted = await resolveProjectTrusted({
        cwd: options.cwd,
        trustStore,
        trustOverride: options.projectTrustOverride,
        defaultProjectTrust: settingsManager.getDefaultProjectTrust(),
        extensionsResult,
        projectTrustContext: createProjectTrustContext({
            cwd: options.cwd,
            mode: appMode,
            settingsManager,
            hasUI: appMode === "interactive",
        }),
        onExtensionError: (message) => projectTrustWarnings.push(message),
    });
    settingsManager.setProjectTrusted(projectTrusted);
    return { settingsManager, projectTrustWarnings };
}
export async function handleConfigCommand(args, runtimeOptions = {}) {
    if (args[0] !== "config") {
        return false;
    }
    const cwd = process.cwd();
    const agentDir = getAgentDir();
    const { settingsManager, projectTrustWarnings } = await createCommandSettingsManager({
        cwd,
        agentDir,
        projectTrustOverride: parseProjectTrustOverride(args),
        extensionFactories: runtimeOptions.extensionFactories,
    });
    reportProjectTrustWarnings(projectTrustWarnings);
    reportSettingsErrors(settingsManager, "config command");
    const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
    const resolvedPaths = await packageManager.resolve();
    await selectConfig({
        resolvedPaths,
        settingsManager,
        cwd,
        agentDir,
    });
    process.exit(0);
}
export async function handlePackageCommand(args, runtimeOptions = {}) {
    const options = parsePackageCommand(args);
    if (!options) {
        return false;
    }
    if (options.help) {
        printPackageCommandHelp(options.command);
        return true;
    }
    if (options.invalidOption) {
        console.error(chalk.red(`Unknown option ${options.invalidOption} for "${options.command}".`));
        console.error(chalk.dim(`Use "${APP_NAME} --help" or "${getPackageCommandUsage(options.command)}".`));
        process.exitCode = 1;
        return true;
    }
    if (options.missingOptionValue) {
        console.error(chalk.red(`Missing value for ${options.missingOptionValue}.`));
        console.error(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
        process.exitCode = 1;
        return true;
    }
    if (options.invalidArgument) {
        console.error(chalk.red(`Unexpected argument ${options.invalidArgument}.`));
        console.error(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
        process.exitCode = 1;
        return true;
    }
    if (options.conflictingOptions) {
        console.error(chalk.red(options.conflictingOptions));
        console.error(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
        process.exitCode = 1;
        return true;
    }
    const source = options.source;
    if ((options.command === "install" || options.command === "remove") && !source) {
        console.error(chalk.red(`Missing ${options.command} source.`));
        console.error(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
        process.exitCode = 1;
        return true;
    }
    const cwd = process.cwd();
    const agentDir = getAgentDir();
    const writesProjectPackageConfig = (options.command === "install" || options.command === "remove") && options.local;
    const { settingsManager, projectTrustWarnings } = await createCommandSettingsManager({
        cwd,
        agentDir,
        projectTrustOverride: options.projectTrustOverride,
        useSavedProjectTrustOnly: options.command === "update",
        extensionFactories: runtimeOptions.extensionFactories,
    });
    reportProjectTrustWarnings(projectTrustWarnings);
    if (!settingsManager.isProjectTrusted() && writesProjectPackageConfig) {
        console.error(chalk.red("Project is not trusted. Use --approve to modify local package config."));
        process.exitCode = 1;
        return true;
    }
    reportSettingsErrors(settingsManager, "package command");
    const selfUpdateNpmCommand = settingsManager.getGlobalSettings().npmCommand;
    const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
    packageManager.setProgressCallback((event) => {
        if (event.type === "start") {
            process.stdout.write(chalk.dim(`${event.message}\n`));
        }
    });
    try {
        switch (options.command) {
            case "install":
                await packageManager.installAndPersist(source, { local: options.local });
                console.log(chalk.green(`Installed ${source}`));
                return true;
            case "remove": {
                const removed = await packageManager.removeAndPersist(source, { local: options.local });
                if (!removed) {
                    console.error(chalk.red(`No matching package found for ${source}`));
                    process.exitCode = 1;
                    return true;
                }
                console.log(chalk.green(`Removed ${source}`));
                return true;
            }
            case "list": {
                const configuredPackages = packageManager.listConfiguredPackages();
                const userPackages = configuredPackages.filter((pkg) => pkg.scope === "user");
                const projectPackages = configuredPackages.filter((pkg) => pkg.scope === "project");
                if (configuredPackages.length === 0) {
                    console.log(chalk.dim("No packages installed."));
                    return true;
                }
                const formatPackage = (pkg) => {
                    const display = pkg.filtered ? `${pkg.source} (filtered)` : pkg.source;
                    console.log(`  ${display}`);
                    if (pkg.installedPath) {
                        console.log(chalk.dim(`    ${pkg.installedPath}`));
                    }
                };
                if (userPackages.length > 0) {
                    console.log(chalk.bold("User packages:"));
                    for (const pkg of userPackages) {
                        formatPackage(pkg);
                    }
                }
                if (projectPackages.length > 0) {
                    if (userPackages.length > 0)
                        console.log();
                    console.log(chalk.bold("Project packages:"));
                    for (const pkg of projectPackages) {
                        formatPackage(pkg);
                    }
                }
                return true;
            }
            case "update": {
                const target = options.updateTarget ?? { type: "self" };
                if (options.showExtensionsSkippedNote) {
                    console.log(chalk.dim(`Extensions are skipped. Run ${APP_NAME} update --extensions to update extensions.`));
                }
                if (updateTargetIncludesExtensions(target)) {
                    const updateSource = target.type === "extensions" ? target.source : undefined;
                    await packageManager.update(updateSource);
                    if (updateSource) {
                        console.log(chalk.green(`Updated ${updateSource}`));
                    }
                    else {
                        console.log(chalk.green("Updated packages"));
                    }
                }
                if (updateTargetIncludesSelf(target)) {
                    const selfUpdatePlan = await getSelfUpdatePlan(options.force);
                    if (!selfUpdatePlan.shouldRun) {
                        return true;
                    }
                    const installMethod = detectInstallMethod();
                    if (process.platform === "win32" && installMethod !== "npm" && installMethod !== "pnpm") {
                        console.error(chalk.red(`${APP_NAME} self-update on Windows is only supported for npm and pnpm installs.`));
                        console.error(chalk.dim(`Detected install method: ${installMethod}. Update ${APP_NAME} manually.`));
                        process.exitCode = 1;
                        return true;
                    }
                    const selfUpdateTarget = {
                        packageName: selfUpdatePlan.packageName,
                        installSpec: selfUpdatePlan.installSpec,
                    };
                    const selfUpdateCommand = getSelfUpdateCommand(PACKAGE_NAME, selfUpdateNpmCommand, selfUpdateTarget);
                    if (!selfUpdateCommand) {
                        printSelfUpdateUnavailable(selfUpdateNpmCommand, selfUpdateTarget);
                        process.exitCode = 1;
                        return true;
                    }
                    if (selfUpdatePlan.note) {
                        printSelfUpdateNote(selfUpdatePlan.note);
                    }
                    try {
                        if (installMethod === "npm") {
                            prepareWindowsNpmSelfUpdate();
                        }
                        await runSelfUpdate(selfUpdateCommand);
                    }
                    catch (error) {
                        const message = error instanceof Error ? error.message : "Unknown package command error";
                        console.error(chalk.red(`Error: ${message}`));
                        printSelfUpdateFallback(selfUpdateCommand);
                        process.exitCode = 1;
                        return true;
                    }
                    console.log(chalk.green(`Updated ${APP_NAME} from ${VERSION} to ${selfUpdatePlan.version}`));
                }
                return true;
            }
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown package command error";
        console.error(chalk.red(`Error: ${message}`));
        process.exitCode = 1;
        return true;
    }
}
//# sourceMappingURL=package-manager-cli.js.map