import type { LoggedEvent } from "../../../hooks/lib/events";
import { apiPriceOf } from "../cost-report";
import { turnCost, turnSpans, whereAndWhen } from "../wrapped/records";
import { dayOf, ofType, tally } from "../wrapped/year";

export interface Entry {
  label: string;
  cost: number;
  unpriced: number;
}

export interface Leaderboards {
  projects: Entry[];
  sessions: Entry[];
  days: Entry[];
  turns: Entry[];
}

const TOP = 5;

const mostExpensive = (entries: Entry[]) =>
  entries.sort((a, b) => b.cost - a.cost || a.label.localeCompare(b.label)).slice(0, TOP);

function board(calls: LoggedEvent[], labelOf: (call: LoggedEvent) => string): Entry[] {
  const entries = new Map<string, Entry>();
  for (const call of calls) {
    const label = labelOf(call);
    const entry = entries.get(label) ?? { label, cost: 0, unpriced: 0 };
    entries.set(label, entry);
    const price = apiPriceOf(call);
    if (price === null) entry.unpriced++;
    else entry.cost += price;
  }
  return mostExpensive([...entries.values()]);
}

const projectOf = (call: LoggedEvent) => call.project ?? "no project";

function sessionLabel(session: string | null, own: LoggedEvent[]): string {
  const [project] = tally(
    own.filter((call) => call.project !== null),
    projectOf
  );
  const [first] = own.sort((a, b) => a.ts.localeCompare(b.ts));
  const id = session?.slice(0, 8) ?? "no session";
  return `${id} (${project?.name ?? "no project"}, ${dayOf(first)})`;
}

/** A session is named by the project most of its calls ran in, and the day it started. */
function sessionLabels(calls: LoggedEvent[]): Map<string | null, string> {
  const bySession = new Map<string | null, LoggedEvent[]>();
  for (const call of calls) {
    const own = bySession.get(call.session) ?? [];
    bySession.set(call.session, own);
    own.push(call);
  }
  return new Map(
    [...bySession].map(([session, own]) => [session, sessionLabel(session, own)])
  );
}

function turnBoard(events: LoggedEvent[]): Entry[] {
  return mostExpensive(
    turnSpans(events).flatMap((span) => {
      const cost = turnCost(span);
      return cost === null ? [] : [{ label: whereAndWhen(span.turn), cost, unpriced: 0 }];
    })
  );
}

/** Every model call counts, PAL's own spawns included; its inference_call twins never do. */
export function leaderboards(events: LoggedEvent[]): Leaderboards {
  const calls = ofType(events, "model_call");
  const sessions = sessionLabels(calls);
  return {
    projects: board(calls, projectOf),
    sessions: board(calls, (call) => String(sessions.get(call.session))),
    days: board(calls, dayOf),
    turns: turnBoard(events),
  };
}
