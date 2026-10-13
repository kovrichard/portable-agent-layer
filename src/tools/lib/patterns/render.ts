import { count, days, row, tallyLabel } from "../report-rows";
import type { DayShape, Switches } from "./days";
import type { Focus } from "./focus";
import type { ProjectProfile } from "./profiles";
import type { QuietProject, Sprint } from "./sprint";

function shapeLabel({ oneProject, manyProjects }: DayShape): string {
  const total = oneProject + manyProjects;
  if (total === 0) return "unknown";
  return `${days(oneProject)} on one project, ${days(manyProjects)} on several (${Math.round((oneProject / total) * 100)}% focused)`;
}

function switchesLabel(switches: Switches | null): string {
  if (switches === null) return "unknown";
  const { value, label } = switches.mostInADay;
  return `${switches.perDay.toFixed(1)} a day, at most ${count(value)} (${label})`;
}

function hoursAndMinutes(minutes: number): string {
  const whole = Math.round(minutes);
  return `${Math.floor(whole / 60)}h ${String(whole % 60).padStart(2, "0")}m`;
}

function longestLabel(focus: Focus): string {
  const longest = focus.longest;
  return longest === null
    ? "none"
    : `${hoursAndMinutes(longest.value)} (${longest.label})`;
}

export function focusLines(focus: Focus | null): string[] {
  if (focus === null)
    return ["\n  Focus\n", row("focus blocks", "unknown"), row("longest", "unknown")];
  return [
    "\n  Focus\n",
    row(
      "focus blocks",
      `${count(focus.blocks)}, ${hoursAndMinutes(focus.minutes)} in all`
    ),
    row("longest", longestLabel(focus)),
  ];
}

function profileLines(profile: ProjectProfile): string[] {
  return [
    row(
      profile.project,
      `${days(profile.activeDays)}, most at ${profile.hour} on ${profile.weekday}`
    ),
    row("  agents", tallyLabel(profile.agents)),
    row("  channels", tallyLabel(profile.channels)),
  ];
}

export function projectsLines(profiles: ProjectProfile[]): string[] {
  if (profiles.length === 0) return ["\n  Projects\n", row("projects", "unknown")];
  return ["\n  Projects\n", ...profiles.flatMap(profileLines)];
}

export function daysLines(shape: DayShape, switches: Switches | null): string[] {
  return [
    "\n  Days\n",
    row("project days", shapeLabel(shape)),
    row("context switches", switchesLabel(switches)),
  ];
}

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
