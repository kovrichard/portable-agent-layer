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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadOpinionContext } from "../lib/opinions";
import { ensureDir, paths, platform } from "../lib/paths";
import { readFramePrinciples } from "../lib/wisdom";

export function writeContextDigests(): void {
  const memory = paths.memory();
  let wisdomContent = "";
  let opinionsContent = "";

  // Wisdom digest
  try {
    const principles = readFramePrinciples();
    if (principles.length > 0) {
      wisdomContent = [
        "## Crystallized Principles",
        ...principles.map((p) => `- ${p}`),
      ].join("\n");
      writeFileSync(
        resolve(ensureDir(resolve(memory, "wisdom")), "context.md"),
        wisdomContent,
        "utf-8"
      );
    }
  } catch {
    /* non-fatal */
  }

  // Opinions digest
  try {
    opinionsContent = loadOpinionContext();
    if (opinionsContent) {
      writeFileSync(
        resolve(ensureDir(resolve(memory, "relationship")), "opinions-context.md"),
        opinionsContent,
        "utf-8"
      );
    }
  } catch {
    /* non-fatal */
  }

  // Cursor rules file — written if ~/.cursor/ exists (Cursor is installed)
  try {
    const cursorDir = platform.cursorDir();
    if (existsSync(cursorDir)) {
      const selfModelPath = resolve(memory, "self-model", "current.md");
      const selfModel = existsSync(selfModelPath)
        ? readFileSync(selfModelPath, "utf-8").trim()
        : "";
      const sections = [selfModel, wisdomContent, opinionsContent].filter(Boolean);
      if (sections.length > 0) {
        const mdc = `---\ndescription: PAL context\nalwaysApply: true\n---\n\n${sections.join("\n\n")}`;
        writeFileSync(
          resolve(ensureDir(resolve(cursorDir, "rules")), "pal-context.mdc"),
          mdc,
          "utf-8"
        );
      }
    }
  } catch {
    /* non-fatal */
  }
}
