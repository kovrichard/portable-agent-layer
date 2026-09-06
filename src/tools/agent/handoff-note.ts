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
import { emit } from "../lib/emit";

export interface HandoffEntry {
  timestamp: string;
  title: string;
  status: "in-progress" | "completed";
  handoff: string;
  artifacts: string[];
  source: "deliberate" | "auto";
  /** What the work needs from the human before it can move — the one thing an agent cannot unblock. */
  waitingOn?: string;
}

function handoffPath(): string {
  return resolve(ensureDir(paths.state()), "last-handoff.json");
}

export function readHandoffs(): Record<string, HandoffEntry> {
  const p = handoffPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

/** Returns how many entries survived the trim, which is what the receipt reports. */
function writeHandoffs(handoffs: Record<string, HandoffEntry>): number {
  const entries = Object.entries(handoffs);
  const trimmed = entries.length > 20 ? Object.fromEntries(entries.slice(-20)) : handoffs;
  writeFileSync(handoffPath(), JSON.stringify(trimmed, null, 2), "utf-8");
  return Object.keys(trimmed).length;
}

interface NoteInput {
  cwd: string;
  title: string;
  text: string;
  done: boolean;
  waitingOn?: string;
}

function writeHandoffNote(note: NoteInput): {
  file: string;
  status: HandoffEntry["status"];
  kept: number;
} {
  const handoffs = readHandoffs();
  handoffs[note.cwd] = {
    timestamp: new Date().toISOString(),
    title: note.title,
    status: note.done ? "completed" : "in-progress",
    handoff: note.text,
    artifacts: [],
    source: "deliberate",
    ...(note.waitingOn ? { waitingOn: note.waitingOn } : {}),
  };
  const kept = writeHandoffs(handoffs);
  return { file: handoffPath(), status: handoffs[note.cwd].status, kept };
}

function run() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      title: { type: "string" },
      text: { type: "string" },
      waiting: { type: "string" },
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
  --waiting What this needs from you before it can move (a decision, an answer, access)
  --done    Mark as completed; suppresses "pick up where you left off" injection

Output: writes to memory/state/last-handoff.json keyed by cwd
`);
    process.exit(0);
  }

  if (values.done) {
    const result = writeHandoffNote({
      cwd: process.cwd(),
      title: values.title || "session",
      text: values.text || "",
      done: true,
    });
    emit.receipt(result.file, { status: result.status, entries: result.kept });
    process.exit(0);
  }

  if (!values.title || !values.text) {
    console.error("Required: --title and --text (or --done to close)");
    process.exit(1);
  }

  const result = writeHandoffNote({
    cwd: process.cwd(),
    title: values.title,
    text: values.text,
    done: false,
    waitingOn: values.waiting,
  });
  emit.receipt(result.file, { status: result.status, entries: result.kept });
}

if (import.meta.main) run();
