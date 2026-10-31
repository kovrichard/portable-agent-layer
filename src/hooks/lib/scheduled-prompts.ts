/**
 * Prompts the user scheduled for a time of day, for themselves or for one
 * project. A due schedule is added to the next prompt inside its window; nothing
 * fires while no session is open. Kept in PAL's memory, never in a repository.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, paths } from "./paths";
import { newNodeId, scopeOf } from "./progress-tree";
import { localClock, localDay, localMinuteOfDay } from "./wall-clock";

export type Repeat = "daily" | "every-session" | "every-prompt";

export const USER_SCOPE = "user";
export const MAX_TEXT = 500;
const DAY_MINUTES = 1440;
const DAY_MS = 86_400_000;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export interface Schedule {
  id: string;
  scope: string;
  from: string;
  to: string | null;
  days: number[] | null;
  repeat: Repeat;
  text: string;
}

interface Fired {
  day: string;
  sessions: string[];
}

function schedulesFile(): string {
  return resolve(ensureDir(paths.memory()), "schedules.json");
}

function firedFile(): string {
  return resolve(paths.state(), "scheduled-prompts-fired.json");
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export function readSchedules(): Schedule[] {
  return readJson<Schedule[]>(schedulesFile(), []);
}

function writeSchedules(schedules: Schedule[]): void {
  writeFileSync(schedulesFile(), `${JSON.stringify(schedules, null, 2)}\n`);
}

function minuteOf(clock: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!m) return null;
  const [hour, minute] = [Number(m[1]), Number(m[2])];
  if (hour > 24 || minute > 59 || (hour === 24 && minute > 0)) return null;
  return hour * 60 + minute;
}

function clockOrThrow(clock: string): number {
  const minute = minuteOf(clock);
  if (minute === null) throw new Error(`Not a time of day: "${clock}". Use HH:MM.`);
  return minute;
}

function weekdayIndex(name: string): number {
  const index = WEEKDAYS.indexOf(name.trim().toLowerCase().slice(0, 3));
  if (index < 0) throw new Error(`Not a weekday: "${name}". Use mon, tue, … sun.`);
  return index;
}

function weekdayRange(part: string): number[] {
  const [first, last = first] = part.split("-").map(weekdayIndex);
  const length = ((last - first + 7) % 7) + 1;
  return Array.from({ length }, (_, i) => (first + i) % 7);
}

/** `mon-fri`, `sat,sun` or `mon,wed,fri` as weekday numbers, Sunday being 0. */
export function parseDays(spec: string): number[] {
  const days = new Set(spec.split(",").flatMap(weekdayRange));
  return [...days].sort((a, b) => a - b);
}

export function newSchedule(fields: {
  scope: string;
  from: string;
  to?: string;
  days?: string;
  repeat?: Repeat;
  text: string;
}): Schedule {
  const text = fields.text.trim();
  if (!text) throw new Error("Give the prompt text.");
  if (text.length > MAX_TEXT)
    throw new Error(
      `The prompt is ${text.length} characters; keep it under ${MAX_TEXT}.`
    );
  const from = clockOrThrow(fields.from);
  if (from >= DAY_MINUTES) throw new Error("A window cannot start at 24:00; use 00:00.");
  if (fields.to !== undefined && clockOrThrow(fields.to) === from)
    throw new Error("The window starts and ends at the same time.");
  return {
    id: newNodeId(),
    scope: fields.scope,
    from: fields.from.trim(),
    to: fields.to?.trim() ?? null,
    days: fields.days ? parseDays(fields.days) : null,
    repeat: fields.repeat ?? "daily",
    text,
  };
}

export function addSchedule(schedule: Schedule): void {
  writeSchedules([...readSchedules(), schedule]);
}

export function removeSchedule(id: string): boolean {
  const schedules = readSchedules();
  const kept = schedules.filter((s) => s.id !== id);
  if (kept.length === schedules.length) return false;
  writeSchedules(kept);
  return true;
}

export function appliesHere(schedule: Schedule, cwd: string): boolean {
  return schedule.scope === USER_SCOPE || schedule.scope === scopeOf(cwd);
}

function endMinute(schedule: Schedule): number {
  return schedule.to === null ? DAY_MINUTES : (minuteOf(schedule.to) ?? DAY_MINUTES);
}

/** The local start time of the window `now` falls in: today's, or yesterday's for a window past midnight. */
function windowStart(schedule: Schedule, now: Date): Date | null {
  const from = minuteOf(schedule.from);
  if (from === null) return null;
  const minute = localMinuteOfDay(now);
  const to = endMinute(schedule);
  if (from < to) return minute >= from && minute < to ? now : null;
  if (minute >= from) return now;
  return minute < to ? new Date(now.getTime() - DAY_MS) : null;
}

function onItsDay(schedule: Schedule, start: Date): boolean {
  if (schedule.days === null) return true;
  return schedule.days.includes(
    WEEKDAYS.indexOf(localClock(start).weekday.toLowerCase())
  );
}

/** The local day of the open window, or null when the schedule is not due now. */
export function openWindowDay(schedule: Schedule, now: Date = new Date()): string | null {
  const start = windowStart(schedule, now);
  return start && onItsDay(schedule, start) ? localDay(start) : null;
}

function alreadyFired(
  schedule: Schedule,
  fired: Fired | undefined,
  day: string,
  session: string | undefined
): boolean {
  if (schedule.repeat === "every-prompt" || fired?.day !== day) return false;
  if (schedule.repeat === "every-session" && session)
    return fired.sessions.includes(session);
  return true;
}

function markFired(
  firedById: Record<string, Fired>,
  id: string,
  day: string,
  session: string | undefined
): void {
  const sameDay = firedById[id]?.day === day ? firedById[id].sessions : [];
  firedById[id] = { day, sessions: session ? [...sameDay, session] : sameDay };
}

/** The schedules due on this prompt, marked as fired. */
export function dueSchedules(
  cwd: string,
  session: string | undefined,
  now: Date = new Date()
): Schedule[] {
  const firedById = readJson<Record<string, Fired>>(firedFile(), {});
  const due = readSchedules().filter((schedule) => {
    if (!appliesHere(schedule, cwd)) return false;
    const day = openWindowDay(schedule, now);
    if (!day || alreadyFired(schedule, firedById[schedule.id], day, session))
      return false;
    markFired(firedById, schedule.id, day, session);
    return true;
  });
  if (due.length) writeFileSync(firedFile(), JSON.stringify(firedById));
  return due;
}

export function windowLabel(schedule: Schedule): string {
  return `${schedule.from}–${schedule.to ?? "24:00"}`;
}

function daysLabel(schedule: Schedule): string {
  return schedule.days ? ` ${schedule.days.map((d) => WEEKDAYS[d]).join(",")}` : "";
}

export function scheduleLine(schedule: Schedule): string {
  return `${schedule.id}  ${schedule.scope}  ${windowLabel(schedule)}${daysLabel(schedule)}  ${schedule.repeat}  ${schedule.text}`;
}

/** The prompt-time reminder for the schedules due now, or null. */
export function scheduledPromptsReminder(
  cwd: string,
  session: string | undefined,
  now: Date = new Date()
): string | null {
  const due = dueSchedules(cwd, session, now);
  if (!due.length) return null;
  const lines = due.map((s) => `- (${windowLabel(s)}, ${s.scope}) ${s.text}`);
  return [
    "<system-reminder>",
    "The user scheduled these for this time of day; act on them in this reply:",
    ...lines,
    "</system-reminder>",
  ].join("\n");
}
