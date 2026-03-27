/**
 * Auto-trigger for relationship reflect — runs when conditions are met:
 * - 1+ days since last reflect
 * - 5+ new relationship notes since last reflect
 *
 * Spawns `bun run tool:reflect` as a detached background process.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { logDebug } from "../lib/log";
import { getLastReflectDate } from "../lib/opinions";
import { palPkg, paths } from "../lib/paths";

const MIN_DAYS_BETWEEN = 1;
const MIN_NEW_NOTES = 5;

function countNotesSince(since: string): number {
  const relDir = paths.relationship();
  if (!existsSync(relDir)) return 0;

  let count = 0;
  try {
    for (const monthDir of readdirSync(relDir)) {
      if (!/^\d{4}-\d{2}$/.test(monthDir)) continue;
      const monthPath = resolve(relDir, monthDir);
      try {
        for (const file of readdirSync(monthPath)) {
          if (!file.endsWith(".md")) continue;
          const dateStr = file.replace(".md", "");
          if (dateStr > since) {
            const content = readFileSync(resolve(monthPath, file), "utf-8");
            count += (content.match(/^- [OBW]/gm) || []).length;
          }
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* non-critical */
  }
  return count;
}

export async function checkReflectTrigger(): Promise<void> {
  const lastReflect = getLastReflectDate();
  const now = new Date();

  // Trigger if either condition is met (OR logic)
  let timeThreshold = !lastReflect;
  if (lastReflect) {
    const daysSince =
      (now.getTime() - new Date(lastReflect).getTime()) / (1000 * 60 * 60 * 24);
    timeThreshold = daysSince >= MIN_DAYS_BETWEEN;
  }

  const newNotes = countNotesSince(lastReflect || "2000-01-01");
  const volumeThreshold = newNotes >= MIN_NEW_NOTES;

  if (!timeThreshold && !volumeThreshold) {
    logDebug("reflect-trigger", `Skipping: ${newNotes} notes, time threshold not met`);
    return;
  }

  logDebug(
    "reflect-trigger",
    `Triggering: ${newNotes} new notes, last: ${lastReflect || "never"}`
  );

  try {
    const proc = Bun.spawn(["bun", "run", "tool:reflect"], {
      cwd: palPkg(),
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    proc.unref();
    logDebug("reflect-trigger", "Spawned reflect in background");
  } catch (err) {
    logDebug("reflect-trigger", `Failed to spawn: ${err}`);
  }
}
