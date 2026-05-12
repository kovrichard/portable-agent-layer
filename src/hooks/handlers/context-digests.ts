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

  // Copilot instruction files — written if ~/.copilot/ exists (Copilot is installed)
  try {
    const copilotDir = platform.copilotDir();
    if (existsSync(copilotDir)) {
      const instructionsDir = ensureDir(resolve(copilotDir, "instructions"));
      const selfModelPath = resolve(memory, "self-model", "current.md");
      const selfModel = existsSync(selfModelPath)
        ? readFileSync(selfModelPath, "utf-8").trim()
        : "";

      if (selfModel) {
        writeFileSync(
          resolve(instructionsDir, "pal-self-model.instructions.md"),
          `---\napplyTo: "**"\n---\n\n${selfModel}`,
          "utf-8"
        );
      }
      if (wisdomContent) {
        writeFileSync(
          resolve(instructionsDir, "pal-wisdom.instructions.md"),
          `---\napplyTo: "**"\n---\n\n${wisdomContent}`,
          "utf-8"
        );
      }
      if (opinionsContent) {
        writeFileSync(
          resolve(instructionsDir, "pal-opinions.instructions.md"),
          `---\napplyTo: "**"\n---\n\n${opinionsContent}`,
          "utf-8"
        );
      }
    }
  } catch {
    /* non-fatal */
  }

  // Cursor rules files — written if ~/.cursor/ exists (Cursor is installed)
  try {
    const cursorDir = platform.cursorDir();
    if (existsSync(cursorDir)) {
      const rulesDir = ensureDir(resolve(cursorDir, "rules"));

      const selfModelPath = resolve(memory, "self-model", "current.md");
      const selfModel = existsSync(selfModelPath)
        ? readFileSync(selfModelPath, "utf-8").trim()
        : "";
      if (selfModel) {
        writeFileSync(
          resolve(rulesDir, "pal-self-model.mdc"),
          `---\ndescription: PAL self-model\nalwaysApply: true\n---\n\n${selfModel}`,
          "utf-8"
        );
      }

      if (wisdomContent) {
        writeFileSync(
          resolve(rulesDir, "pal-wisdom.mdc"),
          `---\ndescription: PAL wisdom\nalwaysApply: true\n---\n\n${wisdomContent}`,
          "utf-8"
        );
      }

      if (opinionsContent) {
        writeFileSync(
          resolve(rulesDir, "pal-opinions.mdc"),
          `---\ndescription: PAL opinions\nalwaysApply: true\n---\n\n${opinionsContent}`,
          "utf-8"
        );
      }
    }
  } catch {
    /* non-fatal */
  }
}
