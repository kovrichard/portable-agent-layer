import type { LoggedEvent } from "../../../hooks/lib/events";
import type { SkillIndex } from "../../../hooks/lib/skill-match";
import { dayOf, numberOf, ofType, type Tally, tally } from "./year";

export interface SkillsNeverUsed {
  names: string[];
  installed: number;
  since: string;
}

export interface WrappedPal {
  skillsUsed: Tally[];
  skillsNeverUsed: SkillsNeverUsed | null;
  promisesOnTime: number | null;
  promisesKept: number;
}

const skillOf = (call: LoggedEvent) => String(call.skill);

/** Only as far back as tool calls were logged, and only when the installed skills are known. */
function neverUsed(
  calls: LoggedEvent[],
  used: Tally[],
  index: SkillIndex | null
): SkillsNeverUsed | null {
  const [first] = [...calls].sort((a, b) => a.ts.localeCompare(b.ts));
  if (index === null || first === undefined) return null;
  const installed = Object.keys(index.skills).sort();
  const names = installed.filter((name) => !used.some((u) => u.name === name));
  return { names, installed: installed.length, since: dayOf(first) };
}

/** A promise kept by its due time; one closed any other way never counts. */
function promisesKeptOnTime(events: LoggedEvent[]) {
  const kept = ofType(events, "promise").filter(
    (p) => p.change === "done" && numberOf(p.lateSec) !== null
  );
  const onTime = kept.filter((p) => Number(p.lateSec) <= 0).length;
  return { promisesOnTime: kept.length === 0 ? null : onTime, promisesKept: kept.length };
}

export function wrappedPal(events: LoggedEvent[], index: SkillIndex | null): WrappedPal {
  const calls = ofType(events, "tool_call");
  const used = tally(
    calls.filter((c) => typeof c.skill === "string"),
    skillOf
  );
  return {
    skillsUsed: used,
    skillsNeverUsed: neverUsed(calls, used, index),
    ...promisesKeptOnTime(events),
  };
}
