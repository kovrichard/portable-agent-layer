/**
 * Dynamic CLAUDE.md generation.
 *
 * CLAUDE.md is regenerated when setup.json or any telos file is newer than
 * the existing CLAUDE.md. The template lives at CLAUDE.md.template.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { paiPath, paths } from "./paths";
import { readSetupState, buildSetupPrompt } from "./setup";
import { loadTelos } from "./context";

const TEMPLATE_PATH = paiPath("CLAUDE.md.template");
const OUTPUT_PATH = paiPath("CLAUDE.md");

function latestMtime(...filePaths: string[]): number {
  let latest = 0;
  for (const p of filePaths) {
    if (!existsSync(p)) continue;
    try {
      const mt = statSync(p).mtimeMs;
      if (mt > latest) latest = mt;
    } catch { /* skip */ }
  }
  return latest;
}

/** Returns true if CLAUDE.md needs to be regenerated */
export function needsRebuild(): boolean {
  if (!existsSync(OUTPUT_PATH)) return true;

  const outputMtime = statSync(OUTPUT_PATH).mtimeMs;

  // Collect source files: template + setup.json + all telos/*.md
  const sources: string[] = [TEMPLATE_PATH, resolve(paths.state(), "setup.json")];

  const telosDir = paths.telos();
  if (existsSync(telosDir)) {
    for (const f of readdirSync(telosDir).filter((f) => f.endsWith(".md"))) {
      sources.push(resolve(telosDir, f));
    }
  }

  return latestMtime(...sources) > outputMtime;
}

function memoryPaths(): string {
  const pai = paiPath("memory");
  return [
    `- Learning log: ${resolve(pai, "signals", "learnings.jsonl")}`,
    `- Ratings log: ${resolve(pai, "signals", "ratings.jsonl")}`,
    `- Session state: ${resolve(pai, "state", "current-work.json")}`,
  ].join("\n");
}

/** Render CLAUDE.md from the template using current state */
export function buildClaudeMd(): string {
  const template = existsSync(TEMPLATE_PATH)
    ? readFileSync(TEMPLATE_PATH, "utf-8")
    : "# PAI Context\n\n{{SETUP_PROMPT}}\n{{TELOS}}\n## Memory\n\n{{MEMORY_PATHS}}\n";

  const state = readSetupState();
  const setupPrompt = state ? buildSetupPrompt(state) : null;
  const telos = loadTelos();

  return template
    .replace("{{SETUP_PROMPT}}", setupPrompt ? setupPrompt + "\n" : "")
    .replace("{{TELOS}}", telos ? telos + "\n" : "")
    .replace("{{MEMORY_PATHS}}", memoryPaths());
}

/** Regenerate CLAUDE.md if any source file is newer. Returns true if rebuilt. */
export function regenerateIfNeeded(): boolean {
  if (!needsRebuild()) return false;
  writeFileSync(OUTPUT_PATH, buildClaudeMd(), "utf-8");
  return true;
}
