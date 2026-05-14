import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { Violation } from "../../flint/core/types";
import { defineConfig, defineRule } from "../../flint/core/types";
import { noSyncInAsync } from "../../flint/rules/no-sync-in-async";

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

// Scope no-sync-in-async to src/hooks/ — CLI and tool scripts are short-lived processes
const noSyncInAsyncHooks = defineRule({
  name: "no-sync-in-async",
  check({ files, root }, violations) {
    const hooksDir = resolve(root, "src/hooks");
    noSyncInAsync.check(
      { files: files.filter((f) => f.startsWith(hooksDir)), root },
      violations
    );
  },
});

export default defineConfig({
  root: resolve(import.meta.dir, "../.."),
  include: ["src"],
  rules: [
    "no-unguarded-json-parse",
    noSyncInAsyncHooks,
    noConsoleInHookLib,
    noRawAnthropicFetch,
    noRawApiKeyAccess,
  ],
});
