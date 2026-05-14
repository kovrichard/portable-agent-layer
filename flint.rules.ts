import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { Violation } from "./flint/core/types";
import { defineRule } from "./flint/core/types";

function scanPattern(
  files: string[],
  pattern: RegExp,
  rule: string,
  root: string,
  violations: Violation[]
) {
  for (const file of files) {
    const lines = readFileSync(file, "utf-8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        violations.push({ file: relative(root, file), line: i + 1, rule });
      }
    }
  }
}

const noConsoleInHookLib = defineRule({
  name: "no-console-in-hook-lib",
  check({ files, root }, violations) {
    const hookLib = resolve(root, "src/hooks/lib");
    for (const file of files.filter((f) => f.startsWith(hookLib))) {
      const content = readFileSync(file, "utf-8");
      if (content.includes("console.log") && !content.includes("import.meta.main")) {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (/console\.log/.test(lines[i])) {
            violations.push({
              file: relative(root, file),
              line: i + 1,
              rule: "no-console-in-hook-lib",
            });
          }
        }
      }
    }
  },
});

const noRawAnthropicFetch = defineRule({
  name: "no-raw-anthropic-fetch",
  check({ files, root }, violations) {
    const inference = resolve(root, "src/hooks/lib/inference.ts");
    const scope = files.filter(
      (f) =>
        (f.startsWith(resolve(root, "src/hooks")) ||
          f.startsWith(resolve(root, "src/tools"))) &&
        f !== inference
    );
    scanPattern(scope, /api\.anthropic\.com/, "no-raw-anthropic-fetch", root, violations);
  },
});

const noRawApiKeyAccess = defineRule({
  name: "no-raw-api-key-access",
  check({ files, root }, violations) {
    const inference = resolve(root, "src/hooks/lib/inference.ts");
    const scope = files.filter(
      (f) =>
        (f.startsWith(resolve(root, "src/hooks")) ||
          f.startsWith(resolve(root, "src/tools"))) &&
        f !== inference
    );
    scanPattern(
      scope,
      /process\.env\.PAL_ANTHROPIC_API_KEY/,
      "no-raw-api-key-access",
      root,
      violations
    );
  },
});

export default [noConsoleInHookLib, noRawAnthropicFetch, noRawApiKeyAccess];
