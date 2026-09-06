/**
 * Compiles the control room's Tailwind source to the stylesheet index.html
 * links. The output is committed: Bun bundles the page's TSX at server start,
 * and requiring a Tailwind toolchain at that moment would put a build
 * dependency on every install that never opens the page.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const UI_DIR = resolve(REPO_ROOT, "src", "tools", "control-room", "ui");

export const themeSource = resolve(UI_DIR, "theme.css");
export const themeOutput = resolve(UI_DIR, "tailwind.css");

function tailwindBin(): string {
  return resolve(REPO_ROOT, "node_modules", ".bin", "tailwindcss");
}

export function compileCss(input: string, output: string): string | null {
  const result = spawnSync(tailwindBin(), ["--input", input, "--output", output], {
    encoding: "utf-8",
  });
  return result.status === 0 ? null : result.stderr || "tailwindcss exited non-zero";
}

export function themeDrift(scratchOutput: string): string | null {
  const failure = compileCss(themeSource, scratchOutput);
  if (failure) return failure;
  const fresh = readFileSync(scratchOutput, "utf-8");
  return fresh === readFileSync(themeOutput, "utf-8")
    ? null
    : "tailwind.css is stale — theme.css changed since it was last built. Run: bun run build:ui";
}

if (import.meta.main) {
  const failure = compileCss(themeSource, themeOutput);
  console.log(failure ?? `built ${themeOutput}`);
  process.exit(failure ? 1 : 0);
}
