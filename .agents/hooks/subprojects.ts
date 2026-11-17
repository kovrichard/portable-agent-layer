import { runHook } from "./run-hook";

const exitCode = runHook(["bun", "run", "subprojects", "--changed"]);
process.exit(exitCode);
