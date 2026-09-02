/**
 * Shared export logic — zips user state directories.
 * Used by cli/index.ts (pal cli export) and handlers/backup.ts (automatic).
 */

import { existsSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import AdmZip from "adm-zip";
import { ensureRegistered } from "./machine";
import { palHome } from "./paths";

/**
 * Directories within PAL_HOME that contain user state worth exporting.
 * `skills` and `agents` hold user-authored personal skills and subagents.
 * Shipped skills live in `skills/` only as symlinks back to the repo, and
 * walkDir skips symlinks (see below) — so only real, user-owned files travel.
 */
const EXPORT_DIRS = ["telos", "memory", "skills", "agents"];

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

    // Symlinks report neither isDirectory nor isFile, so they are skipped —
    // this is what keeps shipped-skill symlinks (skills/<name> → repo) out of
    // the export. Do not switch to stat()-based following.
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

/** Archive metadata naming the machine that produced it. */
export const MANIFEST_NAME = "export-manifest.json";

export interface ExportManifest {
  machineId: string;
  label: string;
  os: string;
  exportedAt: string;
  fileCount: number;
}

export function buildManifest(
  identity: { id: string; label: string; os: string },
  fileCount: number
): ExportManifest {
  return {
    machineId: identity.id,
    label: identity.label,
    os: identity.os,
    exportedAt: new Date().toISOString(),
    fileCount,
  };
}

/**
 * Zip the given files and write to outputPath. Returns file count.
 *
 * The archive declares its source machine in a manifest. Registry entries under
 * memory/machines/ travel with the corpus, so the manifest exists to say which
 * machine produced THIS archive — after a merge an archive can carry entries
 * for several machines.
 */
export function exportZip(outputPath: string): number {
  const root = palHome();
  const identity = ensureRegistered(root);
  const files = collectExportFiles();
  if (files.length === 0) return 0;

  const zip = new AdmZip();
  for (const file of files) {
    const fullPath = resolve(root, file);
    const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
    zip.addLocalFile(fullPath, dir);
  }
  zip.addFile(
    MANIFEST_NAME,
    Buffer.from(`${JSON.stringify(buildManifest(identity, files.length), null, 2)}\n`)
  );

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
