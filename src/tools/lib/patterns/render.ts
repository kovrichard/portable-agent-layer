import { days, row } from "../report-rows";
import type { QuietProject, Sprint } from "./sprint";

function quietLabel(quiet: QuietProject[]): string {
  if (quiet.length === 0) return "none";
  return quiet.map((q) => `${q.project} (quiet ${days(q.quietDays)})`).join(" · ");
}

/** With no activity at all, there is no telling which projects went quiet. */
export function momentumLines(sprint: Sprint | null, quiet: QuietProject[]): string[] {
  if (sprint === null)
    return [
      "\n  Momentum\n",
      row("current sprint", "unknown"),
      row("quiet after a burst", "unknown"),
    ];
  return [
    "\n  Momentum\n",
    row(
      "current sprint",
      `${sprint.project}, ${days(sprint.days)} of work since ${sprint.since}`
    ),
    row("quiet after a burst", quietLabel(quiet)),
  ];
}
