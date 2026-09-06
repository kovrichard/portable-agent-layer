/**
 * The knobs behind the grid and the bell.
 *
 * These were constants in the source, which meant "gone quiet after 14 days"
 * was PAL's opinion rather than the user's. They live in pal-settings.json now,
 * with the old constants as the defaults so nothing changes until someone says
 * otherwise.
 */

import { PROJECT_STALE_DAYS_DEFAULT } from "../../hooks/lib/projects";
import {
  raw as rawSettings,
  reload,
  write as writeSettings,
} from "../../hooks/lib/settings";

const ATTENTION_SOURCES = ["refusals", "waiting", "unranked"] as const;
export type AttentionSource = (typeof ATTENTION_SOURCES)[number];

export interface ControlRoomPrefs {
  quietAfterDays: number;
  urgentWithinDays: number;
  rankGoals: boolean;
  attention: Record<AttentionSource, boolean>;
}

const PREF_DEFAULTS: ControlRoomPrefs = {
  quietAfterDays: PROJECT_STALE_DAYS_DEFAULT,
  urgentWithinDays: 14,
  rankGoals: true,
  attention: { refusals: true, waiting: true, unranked: true },
};

const DAY_LIMIT = 365;

function storedPrefs(): Partial<ControlRoomPrefs> {
  const stored = rawSettings().controlRoom;
  return (stored ?? {}) as Partial<ControlRoomPrefs>;
}

function positiveDays(value: unknown, fallback: number): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= DAY_LIMIT
    ? value
    : fallback;
}

export function readPrefs(): ControlRoomPrefs {
  const stored = storedPrefs();
  return {
    quietAfterDays: positiveDays(stored.quietAfterDays, PREF_DEFAULTS.quietAfterDays),
    urgentWithinDays: positiveDays(
      stored.urgentWithinDays,
      PREF_DEFAULTS.urgentWithinDays
    ),
    rankGoals: stored.rankGoals ?? PREF_DEFAULTS.rankGoals,
    attention: { ...PREF_DEFAULTS.attention, ...(stored.attention ?? {}) },
  };
}

export type PrefUpdate = Partial<ControlRoomPrefs>;

export function validatePrefs(update: PrefUpdate): string | null {
  for (const key of ["quietAfterDays", "urgentWithinDays"] as const) {
    const value = update[key];
    if (value === undefined) continue;
    if (positiveDays(value, -1) === -1) {
      return `${key} must be a whole number of days, 1..${DAY_LIMIT}`;
    }
  }
  if (update.rankGoals !== undefined && typeof update.rankGoals !== "boolean") {
    return "rankGoals must be true or false";
  }
  for (const [key, value] of Object.entries(update.attention ?? {})) {
    if (!(ATTENTION_SOURCES as readonly string[]).includes(key)) {
      return `unknown attention source: ${key}`;
    }
    if (typeof value !== "boolean") return `attention.${key} must be true or false`;
  }
  return null;
}

export function writePrefs(update: PrefUpdate): ControlRoomPrefs {
  const data = rawSettings();
  const current = readPrefs();
  const next: ControlRoomPrefs = {
    ...current,
    ...update,
    attention: { ...current.attention, ...(update.attention ?? {}) },
  };
  writeSettings({ ...data, controlRoom: { ...next } });
  reload();
  return next;
}
