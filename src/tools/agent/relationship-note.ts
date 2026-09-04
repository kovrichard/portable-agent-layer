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
 *   --b   Session diary — what Jarvis did this session (first-person, specific)
 */

import { parseArgs } from "node:util";
import { appendNotes } from "../../hooks/lib/relationship";
import { emit } from "../lib/emit";

function run() {
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
    console.log(`
RelationshipNote — Append W/O/Session entries to today's relationship log

Usage:
  bun ~/.pal/tools/relationship-note.ts --o "User prefers X" --confidence 0.80
  bun ~/.pal/tools/relationship-note.ts --w "User is building X in TypeScript"
  bun ~/.pal/tools/relationship-note.ts --b "Debugged the cache split logic"

Flags:
  --o TEXT          Opinion/behavioral observation about the user
  --confidence N    Confidence for --o (0.0–1.0, default 0.75)
  --w TEXT          World fact about the user's situation
  --b TEXT          Session diary — what Jarvis did (first-person, specific)

Multiple flags may be combined in one call. At least one of --o, --w, --b is required.

Output: appends to memory/relationship/YYYY-MM/YYYY-MM-DD.md
`);
    process.exit(0);
  }

  if (!values.o && !values.w && !values.b) {
    console.error("Required: at least one of --o, --w, --b");
    process.exit(1);
  }

  const notes = [];

  if (values.o && values.o.length > 0) {
    const confidence = values.confidence ? Number.parseFloat(values.confidence) : 0.75;
    if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
      console.error("--confidence must be a number between 0.0 and 1.0");
      process.exit(1);
    }
    for (const text of values.o) {
      notes.push({ type: "O" as const, text, confidence });
    }
  }

  if (values.w && values.w.length > 0) {
    for (const text of values.w) {
      notes.push({ type: "W" as const, text });
    }
  }

  if (values.b) {
    notes.push({ type: "Session" as const, text: values.b });
  }

  const { file, written } = appendNotes(notes);
  emit.receipt(file, { written, deduped: notes.length - written });
}

if (import.meta.main) run();
