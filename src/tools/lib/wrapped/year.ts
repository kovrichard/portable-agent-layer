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

export function numberOf(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export function eventsOfYear(year: number): LoggedEvent[] {
  const dayBeforeInUtc = new Date(Date.UTC(year - 1, 11, 31));
  return allEventsSince(dayBeforeInUtc).filter((e) => dayOf(e).startsWith(`${year}-`));
}
