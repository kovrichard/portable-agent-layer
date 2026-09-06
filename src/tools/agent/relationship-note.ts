#!/usr/bin/env bun
/**
 * RelationshipNote — Write W/O/Session entries to today's relationship log.
 *
 * Called in the ALGORITHM LEARN phase. Writes behavioral observations about
 * the user (O, W) and session diary entries (--b).
 *
 * Usage:
 *   bun ~/.pal/tools/relationship-note.ts --o "User prefers X" --confidence 0.80
 *   bun ~/.pal/tools/relationship-note.ts --w "User is building X in TypeScript"
 *   bun ~/.pal/tools/relationship-note.ts --b "Debugged the cache split logic"
 *
 * Note types:
 *   --o   Opinion/behavioral observation about the user (requires --confidence)
 *   --w   World fact about the user's situation (objective, observable)
 *   --b   Session diary — what the assistant did this session (first-person)
 *
 * Which flags make which notes is in lib/note-flags.ts.
 */

import { parseArgs } from "node:util";
import { appendNotes } from "../../hooks/lib/relationship";
import { emit } from "../lib/emit";
import { notesFromFlags } from "../lib/note-flags";

const HELP = `
RelationshipNote — Append W/O/Session entries to today's relationship log

Usage:
  bun ~/.pal/tools/relationship-note.ts --o "User prefers X" --confidence 0.80
  bun ~/.pal/tools/relationship-note.ts --w "User is building X in TypeScript"
  bun ~/.pal/tools/relationship-note.ts --b "Debugged the cache split logic"

Flags:
  --o TEXT          Opinion/behavioral observation about the user
  --confidence N    Confidence for --o (0.0–1.0, default 0.75)
  --w TEXT          World fact about the user's situation
  --b TEXT          Session diary — what the assistant did (first-person)

Multiple flags may be combined in one call. At least one of --o, --w, --b is required.

Output: appends to memory/relationship/YYYY-MM/YYYY-MM-DD.md
`;

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      o: { type: "string", multiple: true },
      w: { type: "string", multiple: true },
      b: { type: "string" },
      confidence: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const result = notesFromFlags(values);
  if ("error" in result) {
    console.error(result.error);
    process.exit(1);
  }

  const { file, written } = appendNotes(result.notes);
  emit.receipt(file, { written, deduped: result.notes.length - written });
}
