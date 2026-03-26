/**
 * Shared export logic — zips user state directories.
 * Used by tools/export.ts (manual) and handlers/backup.ts (automatic).
 */

import { existsSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import AdmZip from "adm-zip";
import { palHome } from "./paths";

/** Directories within PAL_HOME that contain user state worth exporting. */
const EXPORT_DIRS = ["telos", "memory"];

/** Subdirectories/files to skip during export. */
const SKIP_PATTERNS = ["memory/downloads"];

function shouldSkip(relPath: string): boolean {
  const normalized = relPath.replaceAll("\\", "/");
  return SKIP_PATTERNS.some((p) => normalized.startsWith(p));
}

/** Recursively collect all files under a directory, returning paths relative to root. */
function walkDir(dir: string, root: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name);
    const relPath = relative(root, fullPath);

    if (shouldSkip(relPath)) continue;

    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath, root));
    } else if (entry.isFile()) {
      files.push(relPath.replaceAll("\\", "/"));
    }
  }
  return files;
}

/** Collect the list of user state files to export. */
export function collectExportFiles(): string[] {
  const root = palHome();
  const files: string[] = [];

  for (const dir of EXPORT_DIRS) {
    files.push(...walkDir(resolve(root, dir), root));
  }

  return files;
}

/** Zip the given files and write to outputPath. Returns file count. */
export function exportZip(outputPath: string): number {
  const root = palHome();
  const files = collectExportFiles();
  if (files.length === 0) return 0;

  const zip = new AdmZip();
  for (const file of files) {
    const fullPath = resolve(root, file);
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
