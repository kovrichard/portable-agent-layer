/**
 * pal cli schedule — prompts the user wants added at a time of day, for
 * themselves or for one project. The prompt hook injects the due ones.
 */

import { scopeOf } from "../hooks/lib/progress-tree";
import { readAllProjects } from "../hooks/lib/projects";
import {
  addSchedule,
  appliesHere,
  newSchedule,
  openWindowDay,
  type Repeat,
  readSchedules,
  removeSchedule,
  type Schedule,
  scheduleLine,
  USER_SCOPE,
  windowLabel,
} from "../hooks/lib/scheduled-prompts";
import { group, leaf, UsageError } from "../tools/lib/command";

interface AddValues {
  from?: string;
  to?: string;
  days?: string;
  project?: string;
  user?: boolean;
  "every-session"?: boolean;
  "every-prompt"?: boolean;
}

function scopeFor(values: AddValues): string {
  if (values.user && values.project)
    throw new UsageError("give --user or --project, not both");
  if (values.user) return USER_SCOPE;
  return values.project === undefined
    ? scopeOf(process.cwd())
    : registeredProject(values.project);
}

function registeredProject(name: string): string {
  if (readAllProjects().some((p) => p.name === name)) return name;
  throw new UsageError(`no registered project "${name}"; see \`pal cli project list\``);
}

function repeatFor(values: AddValues): Repeat {
  if (values["every-session"] && values["every-prompt"])
    throw new UsageError("give --every-session or --every-prompt, not both");
  if (values["every-prompt"]) return "every-prompt";
  return values["every-session"] ? "every-session" : "daily";
}

function scopeLabel(schedule: Schedule): string {
  return schedule.scope === USER_SCOPE ? "you, in every project" : schedule.scope;
}

function built(values: AddValues, text: string): Schedule {
  if (!values.from) throw new UsageError("give the start time with --from <HH:MM>");
  try {
    return newSchedule({
      scope: scopeFor(values),
      from: values.from,
      to: values.to,
      days: values.days,
      repeat: repeatFor(values),
      text,
    });
  } catch (err) {
    if (err instanceof UsageError) throw err;
    throw new UsageError((err as Error).message);
  }
}

function add(values: AddValues, text: string): number {
  const schedule = built(values, text);
  addSchedule(schedule);
  console.log(
    `Scheduled ${schedule.id} for ${scopeLabel(schedule)}: ${schedule.repeat}, ${windowLabel(schedule)}. Remove it with \`pal cli schedule remove ${schedule.id}\`.`
  );
  return 0;
}

function status(schedule: Schedule): string {
  return openWindowDay(schedule) ? "open now" : "closed now";
}

function list(here: boolean): number {
  const cwd = process.cwd();
  const shown = readSchedules().filter((s) => !here || appliesHere(s, cwd));
  if (!shown.length) {
    console.log(here ? "No schedule applies here." : "No schedules.");
    return 0;
  }
  for (const schedule of shown)
    console.log(`${scheduleLine(schedule)}  [${status(schedule)}]`);
  return 0;
}

function remove(id: string): number {
  if (!removeSchedule(id)) {
    console.error(`No schedule ${id}.`);
    return 1;
  }
  console.log(`Removed ${id}.`);
  return 0;
}

export const scheduleCommand = group({
  summary: "Prompts added at a time of day, for you or for one project",
  commands: {
    add: leaf({
      summary: "Schedule a prompt (once a day by default)",
      args: "<text...>",
      options: {
        from: {
          type: "string",
          value: "<HH:MM>",
          description: "Local time the window opens",
        },
        to: {
          type: "string",
          value: "<HH:MM>",
          description: "Local time it closes (default midnight; may pass midnight)",
        },
        days: {
          type: "string",
          value: "<days>",
          description: "Weekdays only, e.g. mon-fri or sat,sun",
        },
        project: {
          type: "string",
          value: "<name>",
          description: "Only in this project (default: the current one)",
        },
        user: { type: "boolean", description: "For you, in every project" },
        "every-session": {
          type: "boolean",
          description: "Once in each session inside the window",
        },
        "every-prompt": {
          type: "boolean",
          description: "On every prompt inside the window",
        },
      },
      run: ({ values, positionals }) => add(values, positionals.join(" ")),
    }),
    list: leaf({
      summary: "List the schedules and whether their window is open",
      options: {
        here: { type: "boolean", description: "Only those that apply in this folder" },
      },
      run: ({ values }) => list(values.here === true),
    }),
    remove: leaf({
      summary: "Remove a schedule",
      args: "<id>",
      run: ({ positionals }) => remove(positionals[0]),
    }),
  },
});
