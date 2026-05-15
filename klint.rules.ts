import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { RawViolation } from "./klint/core/types";
import { defineRule } from "./klint/core/types";

function scanPattern(
  files: string[],
  pattern: RegExp,
  message: string,
  root: string,
  violations: RawViolation[]
) {
  for (const file of files) {
    const lines = readFileSync(file, "utf-8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        violations.push({ file: relative(root, file), line: i + 1, message });
      }
    }
  }
}

const noConsoleInHookLib = defineRule({
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
      "Direct fetch to api.anthropic.com bypasses PAL's inference layer — use the inference module instead.",
      root,
      violations
    );
  },
});

const noRawApiKeyAccess = defineRule({
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
      "Direct access to PAL_ANTHROPIC_API_KEY bypasses the inference layer — use the inference module instead.",
      root,
      violations
    );
  },
});

const noAgentImportInCore = defineRule({
  check({ files, root }, violations) {
    const core = [resolve(root, "src/hooks/lib"), resolve(root, "src/tools")];
    const scope = files.filter((f) => core.some((dir) => f.startsWith(dir)));
    scanPattern(
      scope,
      /from\s+["'][^"']*\/targets\//,
      "Core module imports from src/targets/ — agent-specific code must not leak into the shared core library.",
      root,
      violations
    );
  },
});

const noRawExitInLib = defineRule({
  check({ files, root }, violations) {
    const lib = resolve(root, "src/hooks/lib");
    const scope = files.filter((f) => f.startsWith(lib));
    scanPattern(
      scope,
      /process\.exit\(/,
      "process.exit() called inside a library module — library functions should return or throw, not terminate the process.",
      root,
      violations
    );
  },
});

const noHardcodedPalHome = defineRule({
  check({ files, root }, violations) {
    const paths = resolve(root, "src/hooks/lib/paths.ts");
    const scope = files.filter((f) => f.startsWith(resolve(root, "src")) && f !== paths);
    scanPattern(
      scope,
      /process\.env\.PAL_HOME/,
      "PAL home path accessed directly — use the paths module (src/hooks/lib/paths.ts) instead.",
      root,
      violations
    );
  },
});

/** @lintignore — loaded via dynamic import by klint/cli.ts */
export default {
  "no-console-in-hook-lib": noConsoleInHookLib,
  "no-raw-anthropic-fetch": noRawAnthropicFetch,
  "no-raw-api-key-access": noRawApiKeyAccess,
  "no-agent-import-in-core": noAgentImportInCore,
  "no-hardcoded-pal-home": noHardcodedPalHome,
  "no-raw-exit-in-lib": noRawExitInLib,
};
