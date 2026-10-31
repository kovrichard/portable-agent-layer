/**
 * The one fact that goes stale inside a session: the time.
 *
 * The session-start reminder stamps the clock once, so a conversation picked up
 * the next morning still believes it is yesterday. This line rides along with
 * every prompt instead, in the principal's own timezone, because "is it morning"
 * is the question the agent keeps getting wrong.
 */

import { identity, isEnabled } from "./settings";

const FIELDS = {
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
} as const;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", { ...FIELDS, timeZone });
  formatters.set(timeZone, formatter);
  return formatter;
}

function fieldsIn(now: Date, timeZone: string): Record<string, string> {
  const parts = formatterFor(timeZone).formatToParts(now);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** The IANA name Intl settles on, or null when it does not recognise the input. */
export function canonicalTimeZone(timeZone: string): string | null {
  try {
    return formatterFor(timeZone).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  return canonicalTimeZone(timeZone) !== null;
}

/** A configured timezone is user input, and Intl throws on a bad one. UTC is always true. */
function zoneOrUtc(timeZone: string): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : "UTC";
}

/** @lintignore exercised directly by test/wall-clock.test.ts */
export function wallClockLine(now: Date, configuredZone: string): string {
  const zone = zoneOrUtc(configuredZone);
  const f = fieldsIn(now, zone);
  return `Now: ${f.weekday} ${f.year}-${f.month}-${f.day} ${f.hour}:${f.minute} ${zone}`;
}

/** The calendar date in the principal's timezone, YYYY-MM-DD. */
export function localDay(now: Date = new Date()): string {
  const f = fieldsIn(now, zoneOrUtc(identity().principal.timezone));
  return `${f.year}-${f.month}-${f.day}`;
}

/** Hour (0-23) and short weekday in the principal's timezone. */
export function localClock(now: Date = new Date()): { hour: number; weekday: string } {
  const f = fieldsIn(now, zoneOrUtc(identity().principal.timezone));
  return { hour: Number(f.hour), weekday: f.weekday };
}

/** Minutes since local midnight in the principal's timezone. */
export function localMinuteOfDay(now: Date = new Date()): number {
  const f = fieldsIn(now, zoneOrUtc(identity().principal.timezone));
  return Number(f.hour) * 60 + Number(f.minute);
}

/** HH:MM in the principal's timezone. */
export function localHourMinute(at: Date): string {
  const f = fieldsIn(at, zoneOrUtc(identity().principal.timezone));
  return `${f.hour}:${f.minute}`;
}

export function getWallClockReminder(now: Date = new Date()): string | null {
  if (!isEnabled("wallClock")) return null;
  const line = wallClockLine(now, identity().principal.timezone);
  return `<system-reminder>${line}</system-reminder>`;
}
