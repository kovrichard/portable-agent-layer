/**
 * Handler: write pre-compiled context digest files for @import / instructions[].
 *
 * Runs at session stop so that CLAUDE.md can @import these files natively
 * at the next session start, keeping hook stdout small.
 *
 * Sources are defined in src/hooks/lib/semi-static.ts — add one entry there
 * to extend coverage to all consumers (CLAUDE.md, opencode, Cursor, Copilot).
 */

import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ensureDir, platform } from "../lib/paths";
import {
  copilotFilename,
  cursorFilename,
  getSemiStaticSources,
} from "../lib/semi-static";

export function writeContextDigests(): void {
  const sources = getSemiStaticSources();

  // Resolve Cursor/Copilot destination dirs once (null if agent not installed)
  let rulesDir: string | null = null;
  let instructionsDir: string | null = null;

  try {
    const cursorDir = platform.cursorDir();
    if (existsSync(cursorDir)) {
      rulesDir = ensureDir(resolve(cursorDir, "rules"));
    }
  } catch {
    /* non-fatal */
  }

  try {
    const copilotDir = platform.copilotDir();
    if (existsSync(copilotDir)) {
      instructionsDir = ensureDir(resolve(copilotDir, "instructions"));
    }
  } catch {
    /* non-fatal */
  }

  for (const src of sources) {
    try {
      const content = src.load();
      if (!content) continue;

      if (src.writesDigest) {
        ensureDir(dirname(src.path));
        writeFileSync(src.path, content, "utf-8");
      }

      if (rulesDir) {
        writeFileSync(
          resolve(rulesDir, cursorFilename(src)),
          `---\ndescription: ${src.description}\nalwaysApply: true\n---\n\n${content}`,
          "utf-8"
        );
      }

      if (instructionsDir) {
        writeFileSync(
          resolve(instructionsDir, copilotFilename(src)),
          `---\napplyTo: "**"\n---\n\n${content}`,
          "utf-8"
        );
      }
    } catch {
      /* non-fatal */
    }
  }
}
