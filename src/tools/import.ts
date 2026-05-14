/**
 * PAL Import — Extracts a PAL export archive into the repo,
 * restoring personal files (memory, telos, state).
 *
 * Usage: bun run tool:import [path-to-zip] [--dry-run]
 * If no path is given, finds the latest pal-export-*.zip and asks for confirmation.
 * Then run: bun run install:all to re-create symlinks and hooks.
 */

import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import AdmZip from "adm-zip";
import { palHome } from "../hooks/lib/paths";

export function findLatestExport(root: string): string | null {
  const candidates: string[] = [];

  try {
    candidates.push(
      ...readdirSync(root)
        .filter((f) => f.startsWith("pal-export-") && f.endsWith(".zip"))
        .map((f) => resolve(root, f))
    );
  } catch {
    /* empty */
  }

  try {
    const backupDir = resolve(root, "backups");
    candidates.push(
      ...readdirSync(backupDir)
        .filter(
          (f) =>
            (f.startsWith("pal-export-") || f.startsWith("pal-backup-")) &&
            f.endsWith(".zip")
        )
        .map((f) => resolve(backupDir, f))
    );
  } catch {
    /* empty */
  }

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

export function importZip(zipPath: string, targetDir: string, dryRun: boolean): number {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  if (entries.length === 0) {
    console.log("Archive is empty — nothing to import.");
    return 0;
  }

  if (dryRun) {
    console.log(`Would import ${entries.length} files → ${targetDir}\n`);
    for (const e of entries) console.log(`  ${e.entryName}`);
    return entries.length;
  }

  zip.extractAllTo(targetDir, true);
  console.log(`Imported ${entries.length} files → ${targetDir}`);
  console.log("\nRun 'bun run install:all' to re-create symlinks and hooks.");
  return entries.length;
}

async function run() {
  const repoRoot = palHome();
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const pathArg = args.find((a) => a !== "--dry-run");

  let zipPath: string;

  if (pathArg) {
    zipPath = resolve(pathArg);
  } else {
    const latest = findLatestExport(repoRoot);
    if (!latest) {
      console.error(
        "No export or backup files found. Provide a path: bun run tool:import <path-to-zip>"
      );
      process.exit(1);
    }
    console.log(`Found: ${latest}`);
    const zip = new AdmZip(latest);
    const entries = zip.getEntries();
    console.log(
      `Contains ${entries.length} files, created ${statSync(latest).mtime.toISOString().slice(0, 16).replace("T", " ")}`
    );

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((res) => {
      rl.question("Import this file? [y/N] ", (a) => {
        rl.close();
        res(a);
      });
    });
    if (answer.trim().toLowerCase() !== "y") {
      console.log("Cancelled.");
      process.exit(0);
    }
    zipPath = latest;
  }

  importZip(zipPath, repoRoot, dryRun);
}

if (import.meta.main) await run();
