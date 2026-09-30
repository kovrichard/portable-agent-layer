import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, paths } from "./paths";
import { localDay } from "./wall-clock";

type ShownOn = Record<string, string>;

function shownPath(): string {
  return resolve(ensureDir(paths.state()), "nudges-shown.json");
}

function readShownOn(): ShownOn {
  try {
    return JSON.parse(readFileSync(shownPath(), "utf-8"));
  } catch {
    return {};
  }
}

/**
 * A reminder asks the user for something, so it belongs in the first session
 * of the day, not in every session, resume and compaction after it.
 */
export function oncePerDay(
  key: string,
  reminder: string,
  now: Date = new Date()
): string {
  if (!reminder) return "";
  const today = localDay(now);
  const shownOn = readShownOn();
  if (shownOn[key] === today) return "";
  writeFileSync(shownPath(), JSON.stringify({ ...shownOn, [key]: today }), "utf-8");
  return reminder;
}
