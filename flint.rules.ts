import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { Violation } from "./flint/core/types";
import { defineRule } from "./flint/core/types";

function scanPattern(
  files: string[],
  pattern: RegExp,
  rule: string,
  message: string,
  root: string,
  violations: Violation[]
) {
  for (const file of files) {
    const lines = readFileSync(file, "utf-8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        violations.push({ file: relative(root, file), line: i + 1, rule, message });
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
              message:
                "console.log() in hook library code leaks output into the agent's event stream — use the hook output API instead.",
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
    scanPattern(
      scope,
      /api\.anthropic\.com/,
      "no-raw-anthropic-fetch",
      "Direct fetch to api.anthropic.com bypasses PAL's inference layer — use the inference module instead.",
      root,
      violations
    );
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
      "Direct access to PAL_ANTHROPIC_API_KEY bypasses the inference layer — use the inference module instead.",
      root,
      violations
    );
  },
});

const noAgentImportInCore = defineRule({
  name: "no-agent-import-in-core",
  check({ files, root }, violations) {
    const core = [resolve(root, "src/hooks/lib"), resolve(root, "src/tools")];
    const scope = files.filter((f) => core.some((dir) => f.startsWith(dir)));
    scanPattern(
      scope,
      /from\s+["'][^"']*\/targets\//,
      "no-agent-import-in-core",
      "Core module imports from src/targets/ — agent-specific code must not leak into the shared core library.",
      root,
      violations
    );
  },
});

const noHardcodedPalHome = defineRule({
  name: "no-hardcoded-pal-home",
  check({ files, root }, violations) {
    const paths = resolve(root, "src/hooks/lib/paths.ts");
    const scope = files.filter((f) => f.startsWith(resolve(root, "src")) && f !== paths);
    scanPattern(
      scope,
      /process\.env\.PAL_HOME/,
      "no-hardcoded-pal-home",
      "PAL home path accessed directly — use the paths module (src/hooks/lib/paths.ts) instead.",
      root,
      violations
    );
  },
});

/** @lintignore — loaded via dynamic import by flint/cli.ts */
export default [
  noConsoleInHookLib,
  noRawAnthropicFetch,
  noRawApiKeyAccess,
  noAgentImportInCore,
  noHardcodedPalHome,
];
