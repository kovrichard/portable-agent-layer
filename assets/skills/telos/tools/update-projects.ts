#!/usr/bin/env bun
/**
 * UpdateProjects — Upsert a project row in PROJECTS.md by ID.
 *
 * Usage:
 *   bun update-projects.ts <id> "<row>" "<description>"
 *
 * - <id> is the value in the first column (e.g., "my-proj", "side-gig")
 * - <row> is the full table row including the ID column (e.g., "| my-proj | My Project | Done | High | ... |")
 * - If a row with that ID exists, it is replaced
 * - If no row with that ID exists, it is appended
 * - Creates a timestamped backup before modifying
 * - Logs the change to updates.md
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
const PROJECTS_FILE = resolve(TELOS_DIR, "PROJECTS.md");

function timestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function isoDate(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export interface UpsertProjectResult {
  file: string;
  id: string;
  mode: "replaced" | "appended";
  backed_up: boolean;
  logged: boolean;
  description: string;
}

export function upsertProject(
  id: string,
  row: string,
  description: string
): UpsertProjectResult {
  mkdirSync(BACKUPS_DIR, { recursive: true });
  if (existsSync(PROJECTS_FILE)) {
    const backupName = `PROJECTS-${timestamp()}.md`;
    copyFileSync(PROJECTS_FILE, resolve(BACKUPS_DIR, backupName));
  }

  const existing = existsSync(PROJECTS_FILE) ? readFileSync(PROJECTS_FILE, "utf-8") : "";

  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const idPattern = new RegExp(`^\\|\\s*${escapedId}\\s*\\|.*$`, "m");
  let mode: "replaced" | "appended";

  if (idPattern.test(existing)) {
    writeFileSync(PROJECTS_FILE, existing.replace(idPattern, row.trim()), "utf-8");
    mode = "replaced";
  } else {
    const separator = existing.trim() ? "\n" : "";
    writeFileSync(
      PROJECTS_FILE,
      `${existing.trimEnd()}${separator}${row.trim()}\n`,
      "utf-8"
    );
    mode = "appended";
  }

  const logEntry = `- **${isoDate()}** — \`PROJECTS.md\` [${id}]: ${description}`;
  const existingLog = existsSync(UPDATES_LOG)
    ? readFileSync(UPDATES_LOG, "utf-8")
    : "# TELOS Updates\n";
  writeFileSync(UPDATES_LOG, `${existingLog.trimEnd()}\n${logEntry}\n`, "utf-8");

  return { file: "PROJECTS.md", id, mode, backed_up: true, logged: true, description };
}

function run() {
  const args = process.argv.slice(2);
  const id = args[0];
  const row = args[1];
  const description = args[2];

  if (!id || !row || !description) {
    console.error('Usage: bun update-projects.ts <id> "<row>" "<description>"');
    console.error(
      '\nExample: bun update-projects.ts my-proj "| my-proj | My Project | In progress | High | Notes |" "Added My Project"'
    );
    process.exit(1);
  }

  console.log(JSON.stringify(upsertProject(id, row, description), null, 2));
}

if (import.meta.main) run();
