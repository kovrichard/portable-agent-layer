/**
 * CLI tool: print a brief session summary after Claude Code exits.
 * Designed to be called from the `pal` wrapper script.
 *
 * Usage: bun run tools/session-summary.ts --session <sessionId>
 *
 * The reading, the arithmetic and the formatting are in lib/session-usage.ts.
 */

import { parseArgs } from "node:util";
import { claudeProjectsDir, sessionSummary } from "./lib/session-usage";

if (import.meta.main) {
  const { values } = parseArgs({
    options: { session: { type: "string" } },
    strict: false,
  });

  const sessionId = typeof values.session === "string" ? values.session : "";
  const summary = sessionSummary(sessionId, claudeProjectsDir());
  if (summary) console.log(summary);
}
