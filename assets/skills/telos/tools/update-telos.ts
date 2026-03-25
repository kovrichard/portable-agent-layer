#!/usr/bin/env bun
/**
 * UpdateTelos — Validate, backup, update, and log changes to TELOS files.
 *
 * Usage:
 *   bun update-telos.ts <file> "<content>" "<description>" [--id <id>]
 *
 * - Validates the filename against the known TELOS files
 * - Creates a timestamped backup before modifying
 * - If --id is given and exists in the file, replaces that entry
 * - If --id is given but not found, appends with an ID marker
 * - If no --id, appends content (preserves existing)
 * - Logs the change to updates.md
 *
 * ID markers use HTML comments: <!-- id:xyz --> at the end of a line.
 * These are invisible in rendered markdown but allow the script to find
 * and replace existing entries instead of duplicating them.
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
  "PROJECTS.md",
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

function parseArgs(argv: string[]): {
  file: string | undefined;
  content: string | undefined;
  description: string | undefined;
  id: string | undefined;
} {
  const positional: string[] = [];
  let id: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--id" && i + 1 < argv.length) {
      id = argv[++i];
    } else {
      positional.push(argv[i]);
    }
  }

  return {
    file: positional[0],
    content: positional[1],
    description: positional[2],
    id,
  };
}

const { file, content, description, id } = parseArgs(process.argv.slice(2));

if (!file || !content || !description) {
  console.error(
    'Usage: bun update-telos.ts <file> "<content>" "<description>" [--id <id>]'
  );
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

const existing = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
let mode: "replaced" | "appended";

if (id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const idPattern = new RegExp(`^\\|\\s*${escapedId}\\s*\\|.*$`, "m");

  if (idPattern.test(existing)) {
    // Replace the existing row that starts with this ID
    const updated = existing.replace(idPattern, content.trim());
    writeFileSync(filePath, updated, "utf-8");
    mode = "replaced";
  } else {
    // Append new row
    const separator = existing.trim() ? "\n" : "";
    writeFileSync(
      filePath,
      `${existing.trimEnd()}${separator}${content.trim()}\n`,
      "utf-8"
    );
    mode = "appended";
  }
} else {
  // No ID — append as before
  const separator = existing.trim() ? "\n\n" : "";
  writeFileSync(
    filePath,
    `${existing.trimEnd()}${separator}${content.trim()}\n`,
    "utf-8"
  );
  mode = "appended";
}

// Log change
const idTag = id ? ` [id:${id}]` : "";
const logEntry = `- **${isoDate()}** — \`${file}\`${idTag}: ${description}`;
const existingLog = existsSync(UPDATES_LOG)
  ? readFileSync(UPDATES_LOG, "utf-8")
  : "# TELOS Updates\n";
writeFileSync(UPDATES_LOG, `${existingLog.trimEnd()}\n${logEntry}\n`, "utf-8");

console.log(
  JSON.stringify(
    {
      file,
      id: id ?? null,
      mode,
      backed_up: true,
      logged: true,
      description,
    },
    null,
    2
  )
);
