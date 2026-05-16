import { runHook } from "./run-hook";

const exitCode = runHook(["bun", "klint/cli.ts", "--json"]);
process.exit(exitCode);
