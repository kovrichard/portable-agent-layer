import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { RawViolation } from "@konvert7/klint/core/types";
import { defineRule } from "@konvert7/klint/core/types";

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

// import.meta.main guard cannot be expressed in arch.forbidden — kept as a custom rule
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

/**
 * A tool that writes to disk must not report the write only through emit.ok().
 *
 * emit.ok() is TTY-gated (see src/tools/lib/emit.ts), so a tool that confirms a
 * write through it says nothing at all when an agent runs it over a pipe. The
 * caller then re-reads the file to learn what happened, which costs far more
 * context than the receipt would have. emit.receipt() and emit.data() are
 * ungated; either satisfies this rule.
 *
 * Scoped to files that use the emit convention at all — a tool printing its own
 * ungated output is already telling the caller what landed.
 */
const noSilentWrite = defineRule({
  check({ files, root }, violations) {
    const toolDirs = [resolve(root, "src/tools"), resolve(root, "assets/skills")];
    const writeCall = /\b(writeFileSync|appendFileSync)\s*\(/;

    const scope = files.filter(
      (f) =>
        toolDirs.some((dir) => f.startsWith(dir)) &&
        f.endsWith(".ts") &&
        !f.endsWith("emit.ts")
    );

    for (const file of scope) {
      const content = readFileSync(file, "utf-8");
      if (!writeCall.test(content)) continue;
      if (!/emit\.ok\s*\(/.test(content)) continue;
      if (/emit\.(receipt|data)\s*\(/.test(content)) continue;

      const lines = content.split("\n");
      violations.push({
        file: relative(root, file),
        line: lines.findIndex((l) => /emit\.ok\s*\(/.test(l)) + 1,
        message:
          "Tool writes to disk but confirms it only via emit.ok(), which is TTY-gated and silent over a pipe — a caller cannot tell what landed or where. Use emit.receipt(path, {...}).",
      });
    }
  },
});

/** @lintignore — loaded via dynamic import by klint/cli.ts */
export default {
  "no-console-in-hook-lib": noConsoleInHookLib,
  "no-raw-anthropic-fetch": noRawAnthropicFetch,
  "no-agent-import-in-core": noAgentImportInCore,
  "no-silent-write": noSilentWrite,
};
