#!/usr/bin/env bun
/**
 * RelationshipNote — Write W/O/Session entries to today's relationship log.
 *
 * Called in the ALGORITHM LEARN phase. Writes behavioral observations about
 * the user (O, W) and session diary entries (--b).
 *
 * Usage:
 *   pal cli relationship-note --o "User prefers X" --confidence 0.80
 *   pal cli relationship-note --w "User is building X in TypeScript"
 *   pal cli relationship-note --b "Debugged the cache split logic"
 *
 * Note types:
 *   --o   Opinion/behavioral observation about the user (requires --confidence)
 *   --w   World fact about the user's situation (objective, observable)
 *   --b   Session diary — what the assistant did this session (first-person)
 *
 * Which flags make which notes is in lib/note-flags.ts.
 */

import { appendNotes } from "../../hooks/lib/relationship";
import { leaf, runCommand, UsageError } from "../lib/command";
import { emit } from "../lib/emit";
import { type NoteFlags, notesFromFlags } from "../lib/note-flags";
import { scriptArgs } from "../lib/script-args";

const DETAILS = `Multiple flags may be combined in one call. At least one of --o, --w, --b is required.

Examples:
  pal cli relationship-note --o "User prefers X" --confidence 0.80
  pal cli relationship-note --w "User is building X in TypeScript"
  pal cli relationship-note --b "Debugged the cache split logic"

Output: appends to memory/relationship/YYYY-MM/YYYY-MM-DD.md`;

export const command = leaf({
  summary: "Append W/O/Session entries to today's relationship log",
  options: {
    o: {
      type: "string",
      multiple: true,
      value: "<text>",
      description: "Opinion/behavioral observation about the user (repeatable)",
    },
    confidence: {
      type: "string",
      value: "<n>",
      description: "Confidence for --o (0.0–1.0, default 0.75)",
    },
    w: {
      type: "string",
      multiple: true,
      value: "<text>",
      description: "World fact about the user's situation (repeatable)",
    },
    b: {
      type: "string",
      value: "<text>",
      description: "Session diary — what the assistant did (first-person)",
    },
  },
  details: DETAILS,
  run: ({ values }) => appendFromFlags(values),
});

export function run(argv: string[] = scriptArgs()): Promise<number> {
  return runCommand(command, argv, ["pal", "cli", "relationship-note"]);
}

function appendFromFlags(flags: NoteFlags): undefined {
  const result = notesFromFlags(flags);
  if ("error" in result) throw new UsageError(result.error);
  const { file, written } = appendNotes(result.notes);
  emit.receipt(file, { written, deduped: result.notes.length - written });
}

if (import.meta.main) process.exit(await run());
