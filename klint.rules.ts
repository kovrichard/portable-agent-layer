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
 * context than the receipt would have.
 *
 * Judged per top-level function, not per file. A file-wide check let two real
 * silent writers through, because an ungated emit.data() on some unrelated
 * branch excused every other branch in the same file: `thread.ts --resolve` and
 * the report write in `relationship-reflect.ts` both shipped silent. Within one
 * function, emit.ok() is progress chatter and is fine — but only alongside an
 * emit.receipt() that states what landed.
 *
 * What this does NOT catch: a single function that emits a receipt on one
 * branch and confirms a different write through emit.ok() on another. Proving
 * that needs branch analysis; the function is the finest granularity a
 * text-level rule can honestly claim.
 */
const noSilentWrite = defineRule({
  check({ files, root }, violations) {
    const toolDirs = [resolve(root, "src/tools"), resolve(root, "assets/skills")];
    const writeCall = /\b(writeFileSync|appendFileSync)\s*\(/;
    const okCall = /emit\.ok\s*\(/;
    const receiptCall = /emit\.receipt\s*\(/;

    const scope = files.filter(
      (f) =>
        toolDirs.some((dir) => f.startsWith(dir)) &&
        f.endsWith(".ts") &&
        !f.endsWith("emit.ts")
    );

    for (const file of scope) {
      const content = readFileSync(file, "utf-8");
      if (!writeCall.test(content)) continue;

      for (const fn of topLevelFunctions(content)) {
        if (!okCall.test(fn.body)) continue;
        if (receiptCall.test(fn.body)) continue;

        const offset = fn.body.split("\n").findIndex((l) => okCall.test(l));
        violations.push({
          file: relative(root, file),
          line: fn.startLine + offset,
          message:
            `${fn.name}() confirms a write through emit.ok(), which is TTY-gated ` +
            "and silent over a pipe — a caller cannot tell what landed or where. " +
            "Add emit.receipt(path, {...}) stating what the write produced.",
        });
      }
    }
  },
});

interface FunctionSegment {
  name: string;
  body: string;
  /** 1-indexed line of the function's first line. */
  startLine: number;
}

/**
 * Split a module into its top-level function bodies. Biome keeps top-level
 * declarations at column zero, so the next such line ends the previous body —
 * enough to attribute an emit call to the function containing it without
 * parsing the file.
 */
function topLevelFunctions(content: string): FunctionSegment[] {
  const lines = content.split("\n");
  const starts: { name: string; index: number }[] = [];

  lines.forEach((line, index) => {
    const match = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/.exec(line);
    if (match) starts.push({ name: match[1], index });
  });

  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : lines.length;
    return {
      name: start.name,
      body: lines.slice(start.index, end).join("\n"),
      startLine: start.index + 1,
    };
  });
}

/** @lintignore — loaded via dynamic import by klint/cli.ts */
export default {
  "no-console-in-hook-lib": noConsoleInHookLib,
  "no-raw-anthropic-fetch": noRawAnthropicFetch,
  "no-agent-import-in-core": noAgentImportInCore,
  "no-silent-write": noSilentWrite,
};
