/**
 * Dynamic AGENTS.md generation.
 *
 * AGENTS.md is regenerated when setup.json or any telos file is newer than
 * the existing AGENTS.md. The template lives at AGENTS.md.template.
 * CLAUDE.md is kept as a symlink pointing to AGENTS.md.
 */

import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { loadTelos } from "./context";
import { paiPath, paths } from "./paths";
import { buildSetupPrompt, readSetupState } from "./setup";

const TEMPLATE_PATH = paiPath("assets", "templates", "AGENTS.md.template");

function getOutputPaths() {
  const opencodeDir = process.env.PAI_OPENCODE_DIR;
  const claudeDir = process.env.PAI_CLAUDE_DIR;
  if (!opencodeDir || !claudeDir) {
    throw new Error("PAI_OPENCODE_DIR or PAI_CLAUDE_DIR not set");
  }
  return {
    outputPath: resolve(opencodeDir, "AGENTS.md"),
    symlinkPath: resolve(claudeDir, "CLAUDE.md"),
  };
}

function latestMtime(...filePaths: string[]): number {
  let latest = 0;
  for (const p of filePaths) {
    if (!existsSync(p)) continue;
    try {
      const mt = statSync(p).mtimeMs;
      if (mt > latest) latest = mt;
    } catch {
      /* skip */
    }
  }
  return latest;
}

/** Ensure CLAUDE.md is a symlink pointing to AGENTS.md */
function ensureSymlink(): void {
  const { outputPath, symlinkPath } = getOutputPaths();
  try {
    const stat = lstatSync(symlinkPath);
    // If it exists but isn't a symlink (e.g. old generated file), remove it
    if (!stat.isSymbolicLink()) unlinkSync(symlinkPath);
    else return; // already a symlink, leave it
  } catch {
    // doesn't exist — create it
  }
  const relTarget = relative(dirname(symlinkPath), outputPath).replaceAll("\\", "/");
  symlinkSync(relTarget, symlinkPath);
}

/** Returns true if AGENTS.md needs to be regenerated */
export function needsRebuild(): boolean {
  const { outputPath } = getOutputPaths();
  if (!existsSync(outputPath)) return true;

  const outputMtime = statSync(outputPath).mtimeMs;

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
  const mem = paiPath("memory");
  return [
    `- **Wisdom frames**: \`${resolve(mem, "wisdom", "frames")}/\` — crystallized principles per domain (loaded every session)`,
    `- **Relationship notes**: \`${resolve(mem, "relationship")}/YYYY-MM/YYYY-MM-DD.md\` — daily interaction observations (loaded every session)`,
    `- **Session learnings**: \`${resolve(mem, "learning", "session")}/YYYY-MM/*.md\` — reusable insights from sessions (loaded every session)`,
    `- **Failure captures**: \`${resolve(mem, "learning", "failures")}/YYYY-MM/{timestamp}_{slug}/capture.md\` — what went wrong and why`,
    `- **Signals**: \`${resolve(mem, "signals")}/ratings.jsonl\` — append-only rating signal log (do not edit directly)`,
  ].join("\n");
}

/** Render AGENTS.md from the template using current state */
export function buildClaudeMd(): string {
  const template = existsSync(TEMPLATE_PATH)
    ? readFileSync(TEMPLATE_PATH, "utf-8")
    : "# PAI Context\n\n{{SETUP_PROMPT}}\n{{TELOS}}\n## Memory\n\n{{MEMORY_PATHS}}\n";

  const state = readSetupState();
  const setupPrompt = state ? buildSetupPrompt(state) : null;
  const telos = loadTelos();

  return template
    .replace("{{SETUP_PROMPT}}", setupPrompt ? `${setupPrompt}\n` : "")
    .replace("{{TELOS}}", telos ? `${telos}\n` : "")
    .replace("{{MEMORY_PATHS}}", memoryPaths());
}

/** Regenerate AGENTS.md if any source file is newer, and ensure CLAUDE.md symlink exists. Returns true if rebuilt. */
export function regenerateIfNeeded(): boolean {
  const { outputPath } = getOutputPaths();
  ensureSymlink();
  if (!needsRebuild()) return false;
  writeFileSync(outputPath, buildClaudeMd(), "utf-8");
  return true;
}
