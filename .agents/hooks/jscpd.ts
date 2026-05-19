import { runHook } from "./run-hook";

// First pass: silent (terse on green). On failure, rerun verbose to surface
// which clones caused the threshold breach — saves a manual `jscpd:report`.
const exitCode = runHook(["bun", "run", "jscpd"]);
if (exitCode === 0) process.exit(0);

process.stderr.write("\n--- jscpd: offending clones ---\n");
runHook(["bun", "run", "jscpd:report"]);
process.exit(exitCode);
