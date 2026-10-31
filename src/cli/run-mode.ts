/**
 * pal cli timebox / pal cli unattended — start, inspect and end a run with a
 * deadline for the current project or folder. The hooks enforce it.
 */

import { scopeOf } from "../hooks/lib/progress-tree";
import {
  clearRun,
  DEFAULT_UNATTENDED_RULES,
  deadlineFrom,
  describeRun,
  newRun,
  type Run,
  type RunKind,
  readRun,
  untilLabel,
  writeRun,
} from "../hooks/lib/run-mode";
import { group, leaf, UsageError } from "../tools/lib/command";

const FOR = {
  type: "string",
  value: "<duration>",
  description: "How long, e.g. 15m, 2h or 1h30m",
} as const;
const UNTIL = {
  type: "string",
  value: "<HH:MM>",
  description: "Local time it ends (the next one), or an ISO time",
} as const;
const REPORT = {
  type: "string",
  value: "<path|url>",
  description:
    "Where the report goes; edits to a local path still run after the deadline",
} as const;

function currentScope(): string {
  return scopeOf(process.cwd());
}

function deadline(values: { for?: string; until?: string }): Date {
  try {
    return deadlineFrom(values);
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
}

function runOf(kind: RunKind): Run | null {
  const run = readRun(currentScope());
  return run?.kind === kind ? run : null;
}

function noRun(kind: RunKind): number {
  console.error(`No ${kind} run in ${currentScope()}.`);
  return 1;
}

function refuseIfRunning(): void {
  const run = readRun(currentScope());
  if (run)
    throw new UsageError(
      `A ${run.kind} run until ${untilLabel(run)} is already on here; end it first`
    );
}

function printStatus(kind: RunKind): number {
  const run = runOf(kind);
  if (!run) return noRun(kind);
  console.log(describeRun(run));
  return 0;
}

function endRun(kind: RunKind): number {
  const run = runOf(kind);
  if (!run) return noRun(kind);
  clearRun(run.scope);
  console.log(`Ended the ${kind} run that was due at ${untilLabel(run)}.`);
  return 0;
}

function startTimebox(values: {
  for?: string;
  until?: string;
  task?: string;
  report?: string;
}): number {
  refuseIfRunning();
  const run = newRun({
    kind: "timebox",
    scope: currentScope(),
    until: deadline(values),
    task: values.task,
    report: values.report,
  });
  writeRun(run);
  console.log(
    `Time box set: ends at ${untilLabel(run)}. After that only \`pal cli\` and report edits run.`
  );
  return 0;
}

function startUnattended(values: {
  until?: string;
  for?: string;
  task?: string[];
  fallback?: string[];
  rule?: string[];
  report?: string;
}): number {
  refuseIfRunning();
  if (!values.task?.length) throw new UsageError("give each approved task with --task");
  const run = newRun({
    kind: "unattended",
    scope: currentScope(),
    until: deadline(values),
    report: values.report,
    tasks: values.task,
    fallbacks: values.fallback ?? [],
    rules: [...DEFAULT_UNATTENDED_RULES, ...(values.rule ?? [])],
  });
  writeRun(run);
  console.log(describeRun(run));
  return 0;
}

function logEntry(text: string): number {
  const run = runOf("unattended");
  if (!run) return noRun("unattended");
  writeRun({ ...run, log: [...run.log, { at: new Date().toISOString(), entry: text }] });
  console.log(`Logged (${run.log.length + 1} entries).`);
  return 0;
}

function markDone(): number {
  const run = runOf("unattended");
  if (!run) return noRun("unattended");
  writeRun({ ...run, done: true });
  console.log("Marked done: the agent may stop. The run ends when the user is back.");
  return 0;
}

export const timeboxCommand = group({
  summary: "Stop work at a deadline and report what was found",
  commands: {
    start: leaf({
      summary: "Start a time box for the current project or folder",
      options: {
        for: FOR,
        until: UNTIL,
        task: { type: "string", value: "<text>", description: "What is being done" },
        report: REPORT,
      },
      run: ({ values }) => startTimebox(values),
    }),
    status: leaf({
      summary: "Show the time box and the time left",
      run: () => printStatus("timebox"),
    }),
    end: leaf({ summary: "End the time box", run: () => endRun("timebox") }),
  },
});

export const unattendedCommand = group({
  summary: "Work without the user until a deadline: no questions, approved tasks only",
  commands: {
    start: leaf({
      summary: "Start an unattended run with the approved tasks",
      options: {
        until: UNTIL,
        for: FOR,
        task: {
          type: "string",
          multiple: true,
          value: "<text>",
          description: "An approved task, in order (repeat)",
        },
        fallback: {
          type: "string",
          multiple: true,
          value: "<text>",
          description: "A pre-approved task for when the tasks run out (repeat)",
        },
        rule: {
          type: "string",
          multiple: true,
          value: "<text>",
          description: "A rule on top of the defaults (repeat)",
        },
        report: REPORT,
      },
      run: ({ values }) => startUnattended(values),
    }),
    log: leaf({
      summary: "Append a timestamped entry to the run's log",
      args: "<entry...>",
      run: ({ positionals }) => logEntry(positionals.join(" ")),
    }),
    status: leaf({
      summary: "Show the rules, tasks, log and time left",
      run: () => printStatus("unattended"),
    }),
    done: leaf({
      summary: "Every task and fallback is finished and the report is written",
      run: markDone,
    }),
    end: leaf({
      summary: "End the run (the user is back)",
      run: () => endRun("unattended"),
    }),
  },
});
