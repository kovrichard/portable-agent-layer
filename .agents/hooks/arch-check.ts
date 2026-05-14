/**
 * PAL arch-check — runs Flint with PAL-specific config.
 * Built-in rules live in flint/rules/; PAL custom rules in flint.config.ts.
 */
import { runFlint } from "../../flint/core/runner";
import config from "./flint.config";

function main() {
  const violations = runFlint(config);

  if (violations.length === 0) {
    process.stdout.write(JSON.stringify({ output: "arch-check: 0 violations" }));
    process.exit(0);
  }

  const lines = violations.map((v) => `${v.file}:${v.line}  [${v.rule}]`);
  process.stderr.write(
    `arch-check: ${violations.length} violation(s)\n${lines.join("\n")}\n`
  );
  process.exit(2);
}

if (import.meta.main) main();
