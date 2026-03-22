/**
 * Stop handler: check if wisdom graduation should run.
 *
 * Triggers every 14 days when 10+ new failures/learnings are available.
 * Runs graduation in the background (does not block the Stop handler).
 */

import { shouldRunGraduation } from "../lib/graduation";
import { logDebug } from "../lib/log";
import { palPkg } from "../lib/paths";

export async function checkGraduationTrigger(): Promise<void> {
  if (!shouldRunGraduation()) {
    logDebug("graduation", "Thresholds not met — skipping");
    return;
  }

  logDebug("graduation", "Thresholds met — spawning graduation tool");

  try {
    const repoDir = palPkg();
    const proc = Bun.spawn(["bun", "run", "tool:graduate"], {
      cwd: repoDir,
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    proc.unref();
  } catch {
    logDebug("graduation", "Failed to spawn graduation tool");
  }
}
