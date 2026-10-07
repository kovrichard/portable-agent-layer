/**
 * Handler: write pre-compiled context digest files for @import / instructions[].
 *
 * Runs at session stop so that CLAUDE.md can @import these files natively
 * at the next session start, keeping hook stdout small.
 *
 * Sources are defined in src/hooks/lib/semi-static.ts — add one entry there
 * to extend coverage to all consumers (CLAUDE.md, opencode, Cursor, Copilot, Antigravity).
 */

import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ensureDir, platform } from "../lib/paths";
import {
  antigravityFilename,
  antigravityRule,
  copilotFilename,
  cursorFilename,
  getSemiStaticSources,
} from "../lib/semi-static";

function subdirIfInstalled(agentHome: () => string, subdir: string): string | null {
  try {
    const home = agentHome();
    return existsSync(home) ? ensureDir(resolve(home, subdir)) : null;
  } catch {
    return null;
  }
}

export function writeContextDigests(): void {
  const sources = getSemiStaticSources();
  const rulesDir = subdirIfInstalled(platform.cursorDir, "rules");
  const instructionsDir = subdirIfInstalled(platform.copilotDir, "instructions");
  const antigravityRulesDir = subdirIfInstalled(platform.antigravityPluginDir, "rules");

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

      if (antigravityRulesDir) {
        writeFileSync(
          resolve(antigravityRulesDir, antigravityFilename(src)),
          antigravityRule(src.description, content),
          "utf-8"
        );
      }
    } catch {
      /* non-fatal */
    }
  }
}
