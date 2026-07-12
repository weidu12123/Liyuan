#!/usr/bin/env node
import { APP_NAME } from "./config.js";
import { configureHttpDispatcher } from "./core/http-dispatcher.js";
import { main } from "./main.js";
process.title = `${APP_NAME}-rpc`;
process.env.PI_CODING_AGENT = "true";
process.emitWarning = (() => { });
configureHttpDispatcher();
main(["--mode", "rpc", ...process.argv.slice(2)]);
//# sourceMappingURL=rpc-entry.js.map