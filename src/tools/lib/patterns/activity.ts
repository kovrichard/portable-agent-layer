import type { LoggedEvent } from "../../../hooks/lib/events";
import { dayOf, isUserActivity } from "../wrapped/year";

export interface Activity {
  ms: number;
  day: string;
  project: string;
  event: LoggedEvent;
}

/** The user's own work that landed in a project, oldest first. */
export function projectActivity(events: LoggedEvent[]): Activity[] {
  return events
    .filter(isUserActivity)
    .flatMap((event) =>
      typeof event.project === "string"
        ? [{ ms: Date.parse(event.ts), day: dayOf(event), project: event.project, event }]
        : []
    )
    .sort((a, b) => a.ms - b.ms);
}

export function projectsByDay(activity: Activity[]): Map<string, Set<string>> {
  const byDay = new Map<string, Set<string>>();
  for (const { day, project } of activity) {
    byDay.set(day, (byDay.get(day) ?? new Set()).add(project));
  }
  return byDay;
}

export function daysByProject(activity: Activity[]): Map<string, string[]> {
  const byProject = new Map<string, Set<string>>();
  for (const { day, project } of activity) {
    byProject.set(project, (byProject.get(project) ?? new Set()).add(day));
  }
  return new Map([...byProject].map(([project, days]) => [project, [...days].sort()]));
}
