#!/usr/bin/env bun
/**
 * HandoffNote — Write or clear a handoff note for the current project.
 *
 * Called in the ALGORITHM LEARN phase when work is unfinished.
 * Written by Claude in-session — no inference call needed.
 *
 * Usage:
 *   pal cli handoff-note --title "what we were doing" --text "what remains + next steps"
 *   pal cli handoff-note --done   # mark completed, suppress next-session injection
 */

import { writeFileSync } from "node:fs";
import { leaf, runCommand, UsageError } from "../lib/command";
import { emit } from "../lib/emit";
import {
  handoffFile,
  type NoteInput,
  readHandoffs,
  recordNote,
  statusOf,
} from "../lib/handoff-note";
import { scriptArgs } from "../lib/script-args";

const DETAILS = `Required: --title and --text, or --done to close.

Examples:
  pal cli handoff-note --title "what we were doing" --text "what remains"
  pal cli handoff-note --done    # mark session completed

Output: writes to memory/state/last-handoff.json keyed by cwd`;

export const command = leaf({
  summary: "Write a handoff note for the current project",
  options: {
    title: {
      type: "string",
      value: "<text>",
      description: "Brief title of what was being worked on (5-10 words)",
    },
    text: {
      type: "string",
      value: "<text>",
      description: "What remains unfinished — decisions made, next steps, blockers",
    },
    waiting: {
      type: "string",
      value: "<text>",
      description:
        "What this needs from you before it can move (a decision, an answer, access)",
    },
    done: {
      type: "boolean",
      description: `Mark as completed; suppresses "pick up where you left off" injection`,
    },
  },
  details: DETAILS,
  run: ({ values }) => {
    const { title, text, waiting, done } = values;
    if (done) {
      return saveNote({
        cwd: process.cwd(),
        title: title || "session",
        text: text || "",
        done: true,
      });
    }
    if (!title || !text) {
      throw new UsageError("--title and --text are required (or --done to close)");
    }
    return saveNote({ cwd: process.cwd(), title, text, done: false, waitingOn: waiting });
  },
});

export function run(argv: string[] = scriptArgs()): Promise<number> {
  return runCommand(command, argv, ["pal", "cli", "handoff-note"]);
}

function saveNote(note: NoteInput): undefined {
  const file = handoffFile();
  const store = recordNote(readHandoffs(file), note, new Date());
  writeFileSync(file, JSON.stringify(store, null, 2), "utf-8");
  emit.receipt(file, { status: statusOf(note), entries: Object.keys(store).length });
}

if (import.meta.main) process.exit(await run());
