import { hookFormatFromArgs, runHook } from "./run-hook";

const format = hookFormatFromArgs();

if (format === "codex") {
  const exitCode = runHook(["bun", "run", "jscpd"], format);
  process.exit(exitCode);
}

// First pass: silent (terse on green). On failure, rerun verbose to surface
// which clones caused the threshold breach — saves a manual `jscpd:report`.
const exitCode = runHook(["bun", "run", "jscpd", "--silent"]);
if (exitCode === 0) process.exit(0);

process.stderr.write("\n--- jscpd: offending clones ---\n");
runHook(["bun", "run", "jscpd"]);
process.stderr.write(
  "\n--- ACTION ---\n" +
    "Refactor the duplicated code to eliminate it.\n" +
    "DO NOT raise the threshold in jscpd.json to silence this.\n"
);
process.exit(exitCode);
