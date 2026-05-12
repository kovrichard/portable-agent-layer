#!/usr/bin/env bun
/**
 * RelationshipNote — Write a B entry to today's relationship log.
 *
 * Called in the ALGORITHM LEARN phase. Claude writes the B entry directly
 * from full session context — no inference call needed.
 *
 * Usage:
 *   bun ~/.pal/tools/relationship-note.ts --b "what I did this session"
 */

import { parseArgs } from "node:util";
import { appendNotes } from "../../hooks/lib/relationship";

function run() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      b: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(`
RelationshipNote — Append a B entry to today's relationship log

Usage:
  bun ~/.pal/tools/relationship-note.ts --b "description"

Arguments:
  --b   What happened this session (1-2 sentences, first-person, specific)

Output: appends to memory/relationship/YYYY-MM/YYYY-MM-DD.md
`);
    process.exit(0);
  }

  if (!values.b) {
    console.error("Required: --b");
    process.exit(1);
  }

  appendNotes([{ type: "Session", text: values.b }]);

  console.log(
    JSON.stringify({ success: true, message: "Relationship note written" }, null, 2)
  );
}

if (import.meta.main) run();
