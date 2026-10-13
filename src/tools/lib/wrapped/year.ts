import {
  allEventsSince,
  type EventType,
  type LoggedEvent,
} from "../../../hooks/lib/events";
import { localDay } from "../../../hooks/lib/wall-clock";

export function dayOf(event: LoggedEvent): string {
  return localDay(new Date(event.ts));
}

export function ofType(events: LoggedEvent[], type: EventType): LoggedEvent[] {
  return events.filter((e) => e.type === type);
}

export const isUserActivity = (e: LoggedEvent) =>
  e.type === "commit" ||
  e.type === "turn" ||
  (e.type === "model_call" && e.entrypoint !== "sdk-cli");

export interface Tally {
  name: string;
  count: number;
}

/** Most frequent first, ties by name. */
export function tally<T>(items: T[], nameOf: (item: T) => string): Tally[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = nameOf(item);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function numberOf(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export function eventsOfYear(year: number): LoggedEvent[] {
  const dayBeforeInUtc = new Date(Date.UTC(year - 1, 11, 31));
  return allEventsSince(dayBeforeInUtc).filter((e) => dayOf(e).startsWith(`${year}-`));
}
