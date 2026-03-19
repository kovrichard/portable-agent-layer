/**
 * PAI Import — Extracts a PAI export archive into the repo,
 * restoring personal files (memory, telos, state).
 *
 * Usage: bun run tools/import.ts [path-to-zip] [--dry-run]
 * If no path is given, finds the latest pai-export-*.zip and asks for confirmation.
 * Then run: bun run install.ts to re-create symlinks and hooks.
 */

import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import AdmZip from "adm-zip";
import { paiDir } from "../hooks/lib/paths";

const repoRoot = paiDir();
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const pathArg = args.find((a) => a !== "--dry-run");

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      res(answer.trim().toLowerCase() === "y");
    });
  });
}

function findLatestExport(): string | null {
  const files = readdirSync(repoRoot)
    .filter((f) => f.startsWith("pai-export-") && f.endsWith(".zip"))
    .sort()
    .reverse();

  // Also check backups/
  try {
    const backupDir = resolve(repoRoot, "backups");
    const backups = readdirSync(backupDir)
      .filter(
        (f) =>
          (f.startsWith("pai-export-") || f.startsWith("pai-backup-")) &&
          f.endsWith(".zip")
      )
      .map((f) => ({ name: f, path: resolve(backupDir, f) }))
      .sort((a, b) => b.name.localeCompare(a.name));
    if (backups.length > 0) files.push(backups[0].name);
  } catch {
    // No backups dir
  }

  if (files.length === 0) return null;

  // Find the most recent by mtime across both locations
  const candidates = [
    ...readdirSync(repoRoot)
      .filter((f) => f.startsWith("pai-export-") && f.endsWith(".zip"))
      .map((f) => resolve(repoRoot, f)),
  ];
  try {
    const backupDir = resolve(repoRoot, "backups");
    candidates.push(
      ...readdirSync(backupDir)
        .filter(
          (f) =>
            (f.startsWith("pai-export-") || f.startsWith("pai-backup-")) &&
            f.endsWith(".zip")
        )
        .map((f) => resolve(backupDir, f))
    );
  } catch {
    // No backups dir
  }

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

// Resolve zip path
let zipPath: string;

if (pathArg) {
  zipPath = resolve(pathArg);
} else {
  const latest = findLatestExport();
  if (!latest) {
    console.error(
      "No export or backup files found. Provide a path: bun run import <path-to-zip>"
    );
    process.exit(1);
  }
  console.log(`Found: ${latest}`);
  const zip = new AdmZip(latest);
  const entries = zip.getEntries();
  console.log(
    `Contains ${entries.length} files, created ${statSync(latest).mtime.toISOString().slice(0, 16).replace("T", " ")}`
  );

  if (!(await confirm("Import this file?"))) {
    console.log("Cancelled.");
    process.exit(0);
  }
  zipPath = latest;
}

// Import
const zip = new AdmZip(zipPath);
const entries = zip.getEntries();

if (entries.length === 0) {
  console.log("Archive is empty — nothing to import.");
  process.exit(0);
}

if (dryRun) {
  console.log(`Would import ${entries.length} files → ${repoRoot}\n`);
  for (const e of entries) console.log(`  ${e.entryName}`);
} else {
  zip.extractAllTo(repoRoot, true);
  console.log(`Imported ${entries.length} files → ${repoRoot}`);
  console.log("\nRun 'bun run install.ts' to re-create symlinks and hooks.");
}
