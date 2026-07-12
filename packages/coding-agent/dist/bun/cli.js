#!/usr/bin/env node
import { APP_NAME } from "../config.js";
process.title = APP_NAME;
process.emitWarning = (() => { });
import { restoreSandboxEnv } from "./restore-sandbox-env.js";
restoreSandboxEnv();
await import("./register-bedrock.js");
await import("../cli.js");
//# sourceMappingURL=cli.js.map