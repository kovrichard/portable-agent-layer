#!/usr/bin/env bun
/**
 * UpdateTelos — Validate, backup, append, and log changes to TELOS files.
 *
 * Usage:
 *   bun update-telos.ts <file> "<content>" "<description>"
 *
 * - Validates the filename against the known TELOS files
 * - Creates a timestamped backup before modifying
 * - Appends content (preserves existing)
 * - Logs the change to updates.md
 *
 * For PROJECTS.md upserts (add/update by ID), use update-projects.ts instead.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { palHome } from "../../../../src/hooks/lib/paths";

const TELOS_DIR = resolve(palHome(), "telos");
const BACKUPS_DIR = resolve(TELOS_DIR, "backups");
const UPDATES_LOG = resolve(TELOS_DIR, "updates.md");

const VALID_FILES = [
  "BELIEFS.md",
  "CHALLENGES.md",
  "GOALS.md",
  "IDEAS.md",
  "LEARNED.md",
  "MISSION.md",
  "MODELS.md",
  "NARRATIVES.md",
  "STRATEGIES.md",
];

function timestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function isoDate(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

const args = process.argv.slice(2);
const file = args[0];
const content = args[1];
const description = args[2];

if (!file || !content || !description) {
  console.error('Usage: bun update-telos.ts <file> "<content>" "<description>"');
  console.error(`\nValid files: ${VALID_FILES.join(", ")}`);
  process.exit(1);
}

if (!VALID_FILES.includes(file)) {
  console.error(`Error: "${file}" is not a valid TELOS file.`);
  console.error(`Valid files: ${VALID_FILES.join(", ")}`);
  process.exit(1);
}

const filePath = resolve(TELOS_DIR, file);

// Backup
mkdirSync(BACKUPS_DIR, { recursive: true });
if (existsSync(filePath)) {
  const backupName = `${file.replace(".md", "")}-${timestamp()}.md`;
  copyFileSync(filePath, resolve(BACKUPS_DIR, backupName));
}

// Append content
const existing = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
const separator = existing.trim() ? "\n\n" : "";
writeFileSync(filePath, `${existing.trimEnd()}${separator}${content.trim()}\n`, "utf-8");

// Log change
const logEntry = `- **${isoDate()}** — \`${file}\`: ${description}`;
const existingLog = existsSync(UPDATES_LOG)
  ? readFileSync(UPDATES_LOG, "utf-8")
  : "# TELOS Updates\n";
writeFileSync(UPDATES_LOG, `${existingLog.trimEnd()}\n${logEntry}\n`, "utf-8");

console.log(
  JSON.stringify(
    {
      file,
      backed_up: true,
      logged: true,
      description,
    },
    null,
    2
  )
);
