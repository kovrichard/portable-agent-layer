import type { LoggedEvent } from "../../../hooks/lib/events";
import { apiPriceOf } from "../cost-report";
import { dayOf, daysBetween, isUserActivity, numberOf, ofType } from "./year";

export interface Best {
  value: number;
  label: string;
}

export interface WrappedRecords {
  projectsRegisteredInADay: Best | null;
  commitsInADay: Best | null;
  longestProject: Best | null;
  longestStreak: Best | null;
  longestAgentRun: Best | null;
  mostExpensiveTurn: Best | null;
  biggestToolBurst: Best | null;
}

function best(candidates: Best[]): Best | null {
  return candidates.reduce<Best | null>(
    (top, c) => (top === null || c.value > top.value ? c : top),
    null
  );
}

function countBy(events: LoggedEvent[], keyOf: (e: LoggedEvent) => string): Best[] {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(keyOf(e), (counts.get(keyOf(e)) ?? 0) + 1);
  return [...counts].map(([label, value]) => ({ label, value }));
}

function longestProject(events: LoggedEvent[]): Best | null {
  const daysOf = new Map<string, string[]>();
  for (const e of events) {
    if (e.project === null) continue;
    daysOf.set(e.project, [...(daysOf.get(e.project) ?? []), dayOf(e)]);
  }
  return best(
    [...daysOf].map(([project, days]) => {
      const [first, ...rest] = days.sort();
      return { label: project, value: daysBetween(first, rest.at(-1) ?? first) + 1 };
    })
  );
}

function longestStreak(events: LoggedEvent[]): Best | null {
  const days = [...new Set(events.filter(isUserActivity).map(dayOf))].sort();
  const runs: Best[] = [];
  let start = 0;
  for (let i = 1; i <= days.length; i++) {
    if (i < days.length && daysBetween(days[i - 1], days[i]) === 1) continue;
    runs.push({ value: i - start, label: `${days[start]} → ${days[i - 1]}` });
    start = i;
  }
  return best(runs);
}

function longestAgentRun(events: LoggedEvent[]): Best | null {
  return best(
    ofType(events, "reply").flatMap((e) => {
      const sec = numberOf(e.latencySec);
      return sec === null ? [] : [{ value: sec, label: dayOf(e) }];
    })
  );
}

interface TurnSpan {
  turn: LoggedEvent;
  inside: LoggedEvent[];
}

/** Each user turn and what happened in its session until the next one. */
function turnSpans(events: LoggedEvent[]): TurnSpan[] {
  const open = new Map<string, TurnSpan>();
  const spans: TurnSpan[] = [];
  const inTimeOrder = [...events].sort((a, b) => a.ts.localeCompare(b.ts));
  for (const e of inTimeOrder) {
    if (e.session === null) continue;
    if (e.type === "turn") {
      const span = { turn: e, inside: [] };
      open.set(e.session, span);
      spans.push(span);
    } else open.get(e.session)?.inside.push(e);
  }
  return spans;
}

const whereAndWhen = (turn: LoggedEvent) =>
  turn.project === null ? dayOf(turn) : `${dayOf(turn)}, ${turn.project}`;

/** A turn with any call PAL cannot price is left out rather than undercounted. */
function turnCost({ inside }: TurnSpan): number | null {
  const prices = ofType(inside, "model_call").map(apiPriceOf);
  if (prices.length === 0 || prices.includes(null)) return null;
  return prices.reduce<number>((sum, p) => sum + (p ?? 0), 0);
}

function mostExpensiveTurn(spans: TurnSpan[]): Best | null {
  return best(
    spans.flatMap((span) => {
      const cost = turnCost(span);
      return cost === null ? [] : [{ value: cost, label: whereAndWhen(span.turn) }];
    })
  );
}

function biggestToolBurst(spans: TurnSpan[]): Best | null {
  return best(
    spans
      .map((span) => ({
        value: ofType(span.inside, "tool_call").length,
        label: whereAndWhen(span.turn),
      }))
      .filter((b) => b.value > 0)
  );
}

export function wrappedRecords(events: LoggedEvent[]): WrappedRecords {
  const registered = ofType(events, "project").filter((e) => e.change === "registered");
  const spans = turnSpans(events);
  return {
    projectsRegisteredInADay: best(countBy(registered, dayOf)),
    commitsInADay: best(countBy(ofType(events, "commit"), dayOf)),
    longestProject: longestProject(events),
    longestStreak: longestStreak(events),
    longestAgentRun: longestAgentRun(events),
    mostExpensiveTurn: mostExpensiveTurn(spans),
    biggestToolBurst: biggestToolBurst(spans),
  };
}
