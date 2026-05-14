#!/usr/bin/env bun
import { BUILT_IN_RULES } from "./rules/index";

function main() {
  const rules = Object.keys(BUILT_IN_RULES);
  process.stdout.write(
    [
      "flint — type-aware lint rules for TypeScript, written in TypeScript",
      "",
      `Built-in rules (${rules.length}):`,
      ...rules.map((r) => `  ${r}`),
      "",
      "Usage: import { runFlint } from './flint/core/runner' and provide a FlintConfig.",
    ].join("\n") + "\n"
  );
}

if (import.meta.main) main();
