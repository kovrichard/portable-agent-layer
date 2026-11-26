import { runHook } from "./run-hook";

const exitCode = runHook(["bun", "run", "gates"]);
process.exit(exitCode);
