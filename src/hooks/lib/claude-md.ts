/**
 * Dynamic AGENTS.md / CLAUDE.md generation.
 *
 * AGENTS.md (opencode, codex, copilot) is regenerated when setup.json or any
 * telos file is newer. CLAUDE.md (Claude Code) is a real file — not a symlink —
 * and prepends an @import for the self-model so that large static context loads
 * natively rather than through the hook's stdout.
 */

import {
  copyFileSync,
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
import { getSemiStaticSources } from "./semi-static";

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

/** Create or verify a symlink pointing to AGENTS.md (falls back to copy on Windows EPERM) */
function ensureOneSymlink(linkPath: string, targetPath: string): void {
  try {
    const stat = lstatSync(linkPath);
    if (!stat.isSymbolicLink()) unlinkSync(linkPath);
    else return; // already a symlink, leave it
  } catch {
    // doesn't exist — create it
  }
  ensureDir(dirname(linkPath));
  try {
    const relTarget = relative(dirname(linkPath), targetPath).replaceAll("\\", "/");
    symlinkSync(relTarget, linkPath);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "EPERM") {
      copyFileSync(targetPath, linkPath);
    } else {
      throw e;
    }
  }
}

/** Ensure codex symlink points to the canonical AGENTS.md.
 *  CLAUDE.md for Claude Code is a real file written by ensureClaudeCodeMd().
 *  Copilot uses ~/.copilot/instructions/*.instructions.md — no symlink needed. */
function ensureSymlinks(): void {
  const { outputPath } = getOutputPaths();
  ensureOneSymlink(resolve(platform.codexDir(), "AGENTS.md"), outputPath);
}

/** Returns true if AGENTS.md needs to be regenerated */
export function needsRebuild(): boolean {
  const { outputPath } = getOutputPaths();
  if (!existsSync(outputPath)) return true;

  const outputMtime = statSync(outputPath).mtimeMs;

  // Collect source files: template + setup.json + identity + PAL docs + @import candidates
  const sources: string[] = [
    TEMPLATE_PATH,
    resolve(paths.state(), "setup.json"),
    resolve(paths.memory(), "pal-settings.json"),
    ...getSemiStaticSources().map((s) => s.path),
  ];

  // Track PAL doc sources for rebuild detection
  const palDocsDir = assets.palDocs();
  if (existsSync(palDocsDir)) {
    for (const f of readdirSync(palDocsDir).filter((f) => f.endsWith(".md"))) {
      sources.push(resolve(palDocsDir, f));
    }
  }

  return latestMtime(...sources) > outputMtime;
}

import { identity } from "./settings";

/** Render AGENTS.md from the template using current state */
export function buildClaudeMd(): string {
  const template = existsSync(TEMPLATE_PATH)
    ? readFileSync(TEMPLATE_PATH, "utf-8")
    : "# PAL Context\n";

  const id = identity();

  return template
    .replaceAll("{{IDENTITY_NAME}}", id.ai.name)
    .replaceAll("{{IDENTITY_DISPLAY}}", id.ai.displayName)
    .replaceAll("{{IDENTITY_CATCHPHRASE}}", id.ai.catchphrase)
    .replaceAll("{{PRINCIPAL_NAME}}", id.principal.name);
}

/** Build @import header lines for CLAUDE.md — one line per semi-static file that exists. */
function buildClaudeCodeImports(): string {
  const claudeDir = platform.claudeDir();

  const lines = getSemiStaticSources()
    .map((s) => s.path)
    .filter((p) => existsSync(p))
    .map((p) => `@${relative(claudeDir, p).replaceAll("\\", "/")}`);

  return lines.length > 0 ? `${lines.join("\n")}\n\n` : "";
}

/** Build CLAUDE.md content for Claude Code — prepends @import for self-model. */
export function buildClaudeCodeMd(): string {
  return buildClaudeCodeImports() + buildClaudeMd();
}

/** Write ~/.claude/CLAUDE.md as a real file (upgrading from symlink if needed).
 *  Also rewrites if the @import header has changed (new digest files appeared). */
function ensureClaudeCodeMd(): void {
  const claudeDir = platform.claudeDir();
  if (!claudeDir) return;
  const claudeMdPath = resolve(claudeDir, "CLAUDE.md");
  const expected = buildClaudeCodeMd();
  try {
    if (existsSync(claudeMdPath) && !lstatSync(claudeMdPath).isSymbolicLink()) {
      const current = readFileSync(claudeMdPath, "utf-8");
      if (current === expected) return; // no change needed
      // @imports changed — rewrite
    } else if (existsSync(claudeMdPath)) {
      unlinkSync(claudeMdPath); // remove symlink
    }
  } catch {
    /* fall through */
  }
  try {
    ensureDir(claudeDir);
    writeFileSync(claudeMdPath, expected, "utf-8");
  } catch {
    /* ignore write errors — non-fatal */
  }
}

/** Regenerate AGENTS.md if any source file is newer, write real CLAUDE.md, ensure other symlinks. Returns true if rebuilt. */
export function regenerateIfNeeded(): boolean {
  const { outputPath } = getOutputPaths();
  if (!needsRebuild()) {
    ensureSymlinks();
    ensureClaudeCodeMd();
    return false;
  }
  ensureDir(dirname(outputPath));
  writeFileSync(outputPath, buildClaudeMd(), "utf-8");
  // Write Claude Code's CLAUDE.md as a real file (removing any existing symlink)
  const claudeDir = platform.claudeDir();
  if (claudeDir) {
    const claudeMdPath = resolve(claudeDir, "CLAUDE.md");
    try {
      if (existsSync(claudeMdPath)) unlinkSync(claudeMdPath);
      ensureDir(claudeDir);
      writeFileSync(claudeMdPath, buildClaudeCodeMd(), "utf-8");
    } catch {
      /* ignore — CLAUDE.md write failure is non-fatal */
    }
  }
  ensureSymlinks();
  return true;
}
