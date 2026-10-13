import type { Best } from "../wrapped/records";
import { type Activity, movesAttention, projectsByDay } from "./activity";

export interface DayShape {
  oneProject: number;
  manyProjects: number;
}

export interface Switches {
  perDay: number;
  mostInADay: Best;
}

export function dayShape(activity: Activity[]): DayShape {
  const sizes = [...projectsByDay(activity).values()].map((projects) => projects.size);
  return {
    oneProject: sizes.filter((n) => n === 1).length,
    manyProjects: sizes.filter((n) => n > 1).length,
  };
}

/** Model calls are left out: two sessions running side by side interleave theirs without the user moving. */
export function contextSwitches(activity: Activity[]): Switches | null {
  const moves = activity.filter(movesAttention);
  const perDay = new Map<string, number>();
  moves.forEach((a, i) => {
    const previous = moves[i - 1];
    const switched = previous?.day === a.day && previous.project !== a.project;
    perDay.set(a.day, (perDay.get(a.day) ?? 0) + (switched ? 1 : 0));
  });
  const counts = [...perDay];
  if (counts.length === 0) return null;
  const [day, most] = counts.reduce((top, c) => (c[1] > top[1] ? c : top));
  return {
    perDay: counts.reduce((sum, [, n]) => sum + n, 0) / counts.length,
    mostInADay: { value: most, label: day },
  };
}
