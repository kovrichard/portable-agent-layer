import { labelOfRuntime } from "../../../hooks/lib/agent-registry";
import { localClock } from "../../../hooks/lib/wall-clock";
import { channelOf } from "../wrapped/habits";
import { type Tally, tally } from "../wrapped/year";
import type { Activity } from "./activity";

export interface ProjectProfile {
  project: string;
  activeDays: number;
  hour: string;
  weekday: string;
  agents: Tally[];
  channels: Tally[];
}

interface Slot {
  hour: string;
  weekday: string;
}

/** One slot per local hour the project saw work, however busy it was. */
function slotsOf(activity: Activity[]): Slot[] {
  const slots = new Map<string, Slot>();
  for (const a of activity) {
    const clock = localClock(new Date(a.ms));
    const hour = `${String(clock.hour).padStart(2, "0")}:00`;
    slots.set(`${a.day} ${hour}`, { hour, weekday: clock.weekday });
  }
  return [...slots.values()];
}

const topOf = (slots: Slot[], labelOf: (slot: Slot) => string) =>
  tally(slots, labelOf)[0].name;

function profileOf(project: string, activity: Activity[]): ProjectProfile {
  const slots = slotsOf(activity);
  const turns = activity.filter((a) => a.event.type === "turn").map((a) => a.event);
  return {
    project,
    activeDays: new Set(activity.map((a) => a.day)).size,
    hour: topOf(slots, (s) => s.hour),
    weekday: topOf(slots, (s) => s.weekday),
    agents: tally(turns, (t) => labelOfRuntime(t.runtime)),
    channels: tally(turns, channelOf),
  };
}

/** Most worked-on first. */
export function projectProfiles(activity: Activity[]): ProjectProfile[] {
  const byProject = new Map<string, Activity[]>();
  for (const a of activity) {
    const own = byProject.get(a.project) ?? [];
    byProject.set(a.project, own);
    own.push(a);
  }
  return [...byProject]
    .map(([project, own]) => profileOf(project, own))
    .sort((a, b) => b.activeDays - a.activeDays || a.project.localeCompare(b.project));
}
