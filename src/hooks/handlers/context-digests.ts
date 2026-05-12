/**
 * Handler: write pre-compiled context digest files for @import / instructions[].
 *
 * Runs at session stop so that CLAUDE.md can @import these files natively
 * at the next session start, keeping hook stdout small.
 *
 * Output files:
 *   ~/.pal/memory/wisdom/context.md         — high-confidence wisdom principles
 *   ~/.pal/memory/relationship/opinions-context.md — high-confidence opinions
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadOpinionContext } from "../lib/opinions";
import { ensureDir, paths } from "../lib/paths";
import { readFramePrinciples } from "../lib/wisdom";

export function writeContextDigests(): void {
  const memory = paths.memory();

  // Wisdom digest
  try {
    const principles = readFramePrinciples();
    if (principles.length > 0) {
      const content = [
        "## Crystallized Principles",
        ...principles.map((p) => `- ${p}`),
      ].join("\n");
      writeFileSync(
        resolve(ensureDir(resolve(memory, "wisdom")), "context.md"),
        content,
        "utf-8"
      );
    }
  } catch {
    /* non-fatal */
  }

  // Opinions digest
  try {
    const content = loadOpinionContext();
    if (content) {
      writeFileSync(
        resolve(ensureDir(resolve(memory, "relationship")), "opinions-context.md"),
        content,
        "utf-8"
      );
    }
  } catch {
    /* non-fatal */
  }
}
