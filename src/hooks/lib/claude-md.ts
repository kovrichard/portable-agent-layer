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
import { assets, ensureDir, palHome, paths, platform } from "./paths";
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

  // Collect source files: template + setup.json + identity + PAL docs
  const sources: string[] = [
    TEMPLATE_PATH,
    resolve(paths.state(), "setup.json"),
    palSettingsPath(),
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

interface Identity {
  ai: { name: string; displayName: string; catchphrase: string };
  principal: { name: string };
}

const IDENTITY_DEFAULTS: Identity = {
  ai: { name: "Assistant", displayName: "ASSISTANT", catchphrase: "" },
  principal: { name: "" },
};

function palSettingsPath(): string {
  return resolve(palHome(), "memory", "pal-settings.json");
}

/** Load identity from pal-settings.json */
export function loadIdentity(): Identity {
  const p = palSettingsPath();
  if (!existsSync(p)) return IDENTITY_DEFAULTS;

  try {
    const data = JSON.parse(readFileSync(p, "utf-8"));
    const ai = data.identity?.ai ?? {};
    const principal = data.identity?.principal ?? {};
    const name = ai.name || IDENTITY_DEFAULTS.ai.name;
    const catchphrase = (ai.catchphrase || "").replace("{name}", name);

    return {
      ai: {
        name,
        displayName: ai.displayName || IDENTITY_DEFAULTS.ai.displayName,
        catchphrase,
      },
      principal: {
        name: principal.name || IDENTITY_DEFAULTS.principal.name,
      },
    };
  } catch {
    return IDENTITY_DEFAULTS;
  }
}

/** Render AGENTS.md from the template using current state */
export function buildClaudeMd(): string {
  const template = existsSync(TEMPLATE_PATH)
    ? readFileSync(TEMPLATE_PATH, "utf-8")
    : "# PAL Context\n\n{{SETUP_PROMPT}}\n";

  const state = readSetupState();
  const setupPrompt = state ? buildSetupPrompt(state) : null;
  const identity = loadIdentity();

  return template
    .replace("{{SETUP_PROMPT}}", setupPrompt ? `${setupPrompt}\n` : "")
    .replaceAll("{{IDENTITY_NAME}}", identity.ai.name)
    .replaceAll("{{IDENTITY_DISPLAY}}", identity.ai.displayName)
    .replaceAll("{{IDENTITY_CATCHPHRASE}}", identity.ai.catchphrase)
    .replaceAll("{{PRINCIPAL_NAME}}", identity.principal.name);
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
