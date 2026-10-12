/**
 * Every agent's own records, read into the event log. A collector that fails
 * is logged and skipped; the others still run.
 */

import { resolve } from "node:path";
import { logError } from "../../../hooks/lib/log";
import { platform } from "../../../hooks/lib/paths";
import { eventLogEnabled } from "../../../hooks/lib/settings";
import { opencodeDatabase } from "../agent-usage";
import { collectClaude } from "./claude";
import { collectOpencode } from "./opencode";

const COLLECTORS: Record<string, () => number> = {
  claude: () => collectClaude(resolve(platform.claudeDir(), "projects")),
  opencode: () => collectOpencode(opencodeDatabase()),
};

export function collectEvents(): Record<string, number | "failed"> {
  if (!eventLogEnabled()) return {};
  const emitted: Record<string, number | "failed"> = {};
  for (const [source, collect] of Object.entries(COLLECTORS)) {
    try {
      emitted[source] = collect();
    } catch (err) {
      logError(`collect:${source}`, err);
      emitted[source] = "failed";
    }
  }
  return emitted;
}
