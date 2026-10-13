import { runHook } from "./run-hook";

const exitCode = runHook(["bun", "run", "klint:hook"]);
process.exit(exitCode);
