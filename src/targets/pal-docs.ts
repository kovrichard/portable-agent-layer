import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import { assets, palHome } from "../hooks/lib/paths";
import { log } from "./log";
import { ensureSymlink } from "./symlink";

const palDocsDir = () => resolve(palHome(), "docs");
const palToolsDir = () => resolve(palHome(), "tools");

/**
 * Install PAL system docs into ~/.pal/docs/.
 * Always overwrites — these are engine-managed, not user-editable.
 * Also creates ~/.pal/tools/ → repo agent tools (symlink).
 */
export function copyPalDocs(): number {
  const srcDir = assets.palDocs();
  if (!existsSync(srcDir)) return 0;

  mkdirSync(palDocsDir(), { recursive: true });
  let count = 0;

  for (const file of readdirSync(srcDir).filter((f) => f.endsWith(".md"))) {
    const src = resolve(srcDir, file);
    const dst = resolve(palDocsDir(), file);
    copyFileSync(src, dst);
    count++;
  }

  // ~/.pal/tools/ → repo agent tools
  const linkType = process.platform === "win32" ? "junction" : "dir";
  ensureSymlink(palToolsDir(), assets.agentTools(), linkType);

  return count;
}

/** Remove PAL system docs from ~/.pal/docs/ */
export function removePalDocs(): void {
  // Remove tools symlink
  try {
    unlinkSync(palToolsDir());
  } catch {
    /* gone */
  }

  if (!existsSync(palDocsDir())) return;

  try {
    rmSync(palDocsDir(), { recursive: true });
    log.info("Removed ~/.pal/docs/");
  } catch {
    /* gone */
  }
}
