import { daysBetween } from "../wrapped/year";
import { type Activity, daysByProject, projectsByDay } from "./activity";

export interface Sprint {
  project: string;
  days: number;
  since: string;
}

export interface QuietProject {
  project: string;
  lastActive: string;
  quietDays: number;
  burstDays: number;
}

const BURST_DAYS = 3;
const BURST_WINDOW_DAYS = 7;
const QUIET_DAYS = 14;

/** Counted in the days the user worked at all, so a weekend off does not end it. */
export function currentSprint(activity: Activity[]): Sprint | null {
  const days = [...projectsByDay(activity)];
  const latest = days.at(-1);
  if (latest === undefined) return null;
  const sprints = [...latest[1]].map((project) => {
    let start = days.length - 1;
    while (start > 0 && days[start - 1][1].has(project)) start--;
    return { project, days: days.length - start, since: days[start][0] };
  });
  return sprints.sort((a, b) => b.days - a.days || a.project.localeCompare(b.project))[0];
}

function busiestWindow(days: string[]): number {
  let most = 0;
  let start = 0;
  for (let end = 0; end < days.length; end++) {
    while (daysBetween(days[start], days[end]) >= BURST_WINDOW_DAYS) start++;
    most = Math.max(most, end - start + 1);
  }
  return most;
}

/** A burst is 3 active days within 7; quiet is 14 days without any. */
export function quietAfterBurst(activity: Activity[], today: string): QuietProject[] {
  return [...daysByProject(activity)]
    .map(([project, days]) => {
      const lastActive = days.at(-1) ?? today;
      return {
        project,
        lastActive,
        quietDays: daysBetween(lastActive, today),
        burstDays: busiestWindow(days),
      };
    })
    .filter((p) => p.burstDays >= BURST_DAYS && p.quietDays >= QUIET_DAYS)
    .sort((a, b) => b.lastActive.localeCompare(a.lastActive));
}
