/**
 * Snoozed criteria — an ISC you have seen and do not want ranked this week.
 *
 * Kept out of the ISA on purpose: the record says what the project is judged
 * against, and "not this week" is a fact about your attention rather than about
 * the project. It expires by date, so nothing has to unsnooze it.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, paths } from "../../hooks/lib/paths";

const DAY_MS = 86_400_000;
export const MAX_SNOOZE_DAYS = 90;

/** project#isc → the day it wakes up. */
export type Snoozes = Record<string, string>;

function snoozeKey(project: string, id: number): string {
  return `${project}#${id}`;
}

function snoozeFile(): string {
  return resolve(ensureDir(paths.state()), "snoozed.json");
}

export function readSnoozes(now: Date = new Date()): Snoozes {
  const file = snoozeFile();
  if (!existsSync(file)) return {};
  let stored: Snoozes;
  try {
    stored = JSON.parse(readFileSync(file, "utf-8")) as Snoozes;
  } catch {
    return {};
  }
  const today = now.toISOString().slice(0, 10);
  return Object.fromEntries(
    Object.entries(stored).filter(
      ([, until]) => typeof until === "string" && until > today
    )
  );
}

export function snoozedUntil(
  project: string,
  id: number,
  snoozes: Snoozes
): string | null {
  return snoozes[snoozeKey(project, id)] ?? null;
}

/** Zero days wakes it now, which is how the page un-snoozes. */
export function setSnooze(
  project: string,
  id: number,
  days: number,
  now: Date = new Date()
): string | null {
  const live = readSnoozes(now);
  const key = snoozeKey(project, id);
  if (days <= 0) delete live[key];
  else live[key] = new Date(now.getTime() + days * DAY_MS).toISOString().slice(0, 10);
  writeFileSync(snoozeFile(), `${JSON.stringify(live, null, 2)}\n`, "utf-8");
  return live[key] ?? null;
}
