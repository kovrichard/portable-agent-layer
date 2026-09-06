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

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { emit } from "../lib/emit";
import {
  handoffFile,
  type NoteInput,
  readHandoffs,
  recordNote,
  statusOf,
} from "../lib/handoff-note";

const HELP = `
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
`;

function saveNote(note: NoteInput): void {
  const file = handoffFile();
  const store = recordNote(readHandoffs(file), note, new Date());
  writeFileSync(file, JSON.stringify(store, null, 2), "utf-8");
  emit.receipt(file, { status: statusOf(note), entries: Object.keys(store).length });
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
    console.log(HELP);
    process.exit(0);
  }

  if (values.done) {
    saveNote({
      cwd: process.cwd(),
      title: values.title || "session",
      text: values.text || "",
      done: true,
    });
    process.exit(0);
  }

  if (!values.title || !values.text) {
    console.error("Required: --title and --text (or --done to close)");
    process.exit(1);
  }

  saveNote({
    cwd: process.cwd(),
    title: values.title,
    text: values.text,
    done: false,
    waitingOn: values.waiting,
  });
}

if (import.meta.main) run();
