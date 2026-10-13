import type { LoggedEvent } from "../../../hooks/lib/events";
import { dayOf, numberOf, ofType } from "../wrapped/year";

type Tier = "instructionsChars" | "semiStaticChars" | "dynamicChars";

export interface Overhead {
  since: string;
  sessions: number;
  perSession: Record<Tier, number>;
}

/** A compacted session is injected again; its injections add up. */
export function contextOverhead(events: LoggedEvent[]): Overhead | null {
  const injections = ofType(events, "context_injected");
  const [first] = [...injections].sort((a, b) => a.ts.localeCompare(b.ts));
  if (first === undefined) return null;
  const sessions = new Set(injections.map((e) => e.session ?? e.id)).size;
  const average = (tier: Tier) =>
    injections.reduce((sum, e) => sum + (numberOf(e[tier]) ?? 0), 0) / sessions;
  return {
    since: dayOf(first),
    sessions,
    perSession: {
      instructionsChars: average("instructionsChars"),
      semiStaticChars: average("semiStaticChars"),
      dynamicChars: average("dynamicChars"),
    },
  };
}
