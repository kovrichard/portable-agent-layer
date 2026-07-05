#!/usr/bin/env bun
/**
 * HandoffNote — Write or clear a handoff note for the current project.
 *
 * Called in the ALGORITHM LEARN phase when work is unfinished.
 * Written by Claude in-session — no inference call needed.
 *
 * Usage:
 *   bun ~/.pal/tools/handoff-note.ts --title "what we were doing" --text "what remains + next steps"
 *   bun ~/.pal/tools/handoff-note.ts --done   # mark completed, suppress next-session injection
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ensureDir, paths } from "../../hooks/lib/paths";

interface HandoffEntry {
  timestamp: string;
  title: string;
  status: "in-progress" | "completed";
  handoff: string;
  artifacts: string[];
  source: "deliberate" | "auto";
}

function handoffPath(): string {
  return resolve(ensureDir(paths.state()), "last-handoff.json");
}

function readHandoffs(): Record<string, HandoffEntry> {
  const p = handoffPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function writeHandoffs(handoffs: Record<string, HandoffEntry>): void {
  const entries = Object.entries(handoffs);
  const trimmed = entries.length > 20 ? Object.fromEntries(entries.slice(-20)) : handoffs;
  writeFileSync(handoffPath(), JSON.stringify(trimmed, null, 2), "utf-8");
}

function writeHandoffNote(
  cwd: string,
  title: string,
  text: string,
  done: boolean
): { success: boolean; message: string } {
  const handoffs = readHandoffs();
  handoffs[cwd] = {
    timestamp: new Date().toISOString(),
    title,
    status: done ? "completed" : "in-progress",
    handoff: text,
    artifacts: [],
    source: "deliberate",
  };
  writeHandoffs(handoffs);
  return {
    success: true,
    message: done ? "Handoff cleared (marked completed)" : "Handoff note written",
  };
}

function run() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      title: { type: "string" },
      text: { type: "string" },
      done: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(`
HandoffNote — Write a handoff note for the current project

Usage:
  bun ~/.pal/tools/handoff-note.ts --title "what we were doing" --text "what remains"
  bun ~/.pal/tools/handoff-note.ts --done    # mark session completed

Arguments:
  --title   Brief title of what was being worked on (5-10 words)
  --text    What remains unfinished — decisions made, next steps, blockers
  --done    Mark as completed; suppresses "pick up where you left off" injection

Output: writes to memory/state/last-handoff.json keyed by cwd
`);
    process.exit(0);
  }

  if (values.done) {
    const result = writeHandoffNote(
      process.cwd(),
      values.title || "session",
      values.text || "",
      true
    );
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (!values.title || !values.text) {
    console.error("Required: --title and --text (or --done to close)");
    process.exit(1);
  }

  const result = writeHandoffNote(process.cwd(), values.title, values.text, false);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) run();
