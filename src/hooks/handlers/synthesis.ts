/**
 * Stop handler: Run synthesis if 24h+ since last run.
 * Imports synthesize logic directly — no subprocess needed.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { logDebug } from "../lib/log";
import { paths } from "../lib/paths";

const SYNTHESIS_TTL_MS = 24 * 60 * 60 * 1000;

export async function runSynthesis(): Promise<void> {
  const statePath = resolve(paths.state(), "synthesis.json");

  // Check 24h guard
  if (existsSync(statePath)) {
    try {
      const data = JSON.parse(await readFile(statePath, "utf-8")) as {
        timestamp: string;
      };
      if (Date.now() - new Date(data.timestamp).getTime() < SYNTHESIS_TTL_MS) {
        logDebug("synthesis", "Skipped — last synthesis < 24h ago");
        return;
      }
    } catch {
      // Corrupted state — run anyway
    }
  }

  logDebug("synthesis", "Running synthesis...");

  const { synthesize, writeSynthesis } = await import("../../tools/agent/synthesize");
  const state = synthesize(7);
  writeSynthesis(state);

  logDebug("synthesis", "Synthesis complete");
}
