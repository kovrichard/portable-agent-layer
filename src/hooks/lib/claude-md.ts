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
import { assets, ensureDir, paths, platform } from "./paths";
import { buildSetupPrompt, readSetupState } from "./setup";

const TEMPLATE_PATH = assets.agentsMdTemplate();

function getOutputPaths() {
  const opencodeDir = platform.opencodeDir();
  const claudeDir = platform.claudeDir();
  if (!opencodeDir || !claudeDir) {
    throw new Error("PAL_OPENCODE_DIR or PAL_CLAUDE_DIR not set");
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

  // Collect source files: template + setup.json + PAL docs
  const sources: string[] = [TEMPLATE_PATH, resolve(paths.state(), "setup.json")];

  // Track PAL doc sources for rebuild detection
  const palDocsDir = assets.palDocs();
  if (existsSync(palDocsDir)) {
    for (const f of readdirSync(palDocsDir).filter((f) => f.endsWith(".md"))) {
      sources.push(resolve(palDocsDir, f));
    }
  }

  return latestMtime(...sources) > outputMtime;
}

/** Render AGENTS.md from the template using current state */
export function buildClaudeMd(): string {
  const template = existsSync(TEMPLATE_PATH)
    ? readFileSync(TEMPLATE_PATH, "utf-8")
    : "# PAL Context\n\n{{SETUP_PROMPT}}\n";

  const state = readSetupState();
  const setupPrompt = state ? buildSetupPrompt(state) : null;

  return template.replace("{{SETUP_PROMPT}}", setupPrompt ? `${setupPrompt}\n` : "");
}

/** Regenerate AGENTS.md if any source file is newer, and ensure CLAUDE.md symlink exists. Returns true if rebuilt. */
export function regenerateIfNeeded(): boolean {
  const { outputPath } = getOutputPaths();
  ensureSymlink();
  if (!needsRebuild()) return false;
  ensureDir(dirname(outputPath));
  writeFileSync(outputPath, buildClaudeMd(), "utf-8");
  return true;
}
