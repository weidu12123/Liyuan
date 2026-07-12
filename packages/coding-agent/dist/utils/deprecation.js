import chalk from "chalk";
const emittedDeprecationWarnings = new Set();
export function warnDeprecation(message) {
    if (emittedDeprecationWarnings.has(message))
        return;
    emittedDeprecationWarnings.add(message);
    console.warn(chalk.yellow(`Deprecation warning: ${message}`));
}
/** Clear deprecation warning state. Exported for tests. */
export function clearDeprecationWarningsForTests() {
    emittedDeprecationWarnings.clear();
}
//# sourceMappingURL=deprecation.js.map