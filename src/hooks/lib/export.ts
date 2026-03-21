/**
 * Shared export logic — zips all gitignored personal files.
 * Used by tools/export.ts (manual) and handlers/backup.ts (automatic).
 */

import { execSync } from "node:child_process";
import { resolve } from "node:path";
import AdmZip from "adm-zip";
import { palHome } from "./paths";

/** Collect the list of gitignored personal files to export. */
export function collectExportFiles(): string[] {
  const repoRoot = palHome();

  const raw = execSync("git ls-files --others --ignored --exclude-standard", {
    cwd: repoRoot,
    encoding: "utf-8",
  });

  return raw
    .split("\n")
    .map((f) => f.trim())
    .filter(
      (f) =>
        f.length > 0 &&
        !f.startsWith(".") &&
        !f.startsWith("node_modules/") &&
        !f.startsWith("pal-export-") &&
        !f.startsWith("backups/") &&
        !f.startsWith("memory/downloads/")
    );
}

/** Zip the given files and write to outputPath. Returns file count. */
export function exportZip(outputPath: string): number {
  const repoRoot = palHome();
  const files = collectExportFiles();
  if (files.length === 0) return 0;

  const zip = new AdmZip();
  for (const file of files) {
    const fullPath = resolve(repoRoot, file);
    const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
    zip.addLocalFile(fullPath, dir);
  }

  zip.writeZip(outputPath);
  return files.length;
}

/** Generate a timestamped filename prefix. */
export function timestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:T.]/g, "")
    .slice(0, 14);
}
