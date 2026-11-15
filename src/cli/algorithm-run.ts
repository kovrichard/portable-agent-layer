/**
 * The algorithm-run command: the shadow numbers for ALGORITHM runs, read from the event log.
 */

import { allEventsSince } from "../bronze/events";
import {
  type AlgorithmRunReport,
  algorithmRunReport,
  type ReportedEvent,
} from "../hooks/lib/algorithm-run-report";
import { readEvents } from "../hooks/lib/progress-tree";
import { group, leaf, UsageError } from "../tools/lib/command";

function parseSince(raw: string | undefined): Date {
  if (raw === undefined) return new Date(0);
  const since = new Date(raw);
  if (Number.isNaN(since.getTime()))
    throw new UsageError(`--since must be a date such as 2026-11-15, got "${raw}"`);

  return since;
}

function nodeTitles(): Map<string, string> {
  return new Map(
    readEvents().flatMap((e) => (e.type === "open" ? [[e.node, e.title] as const] : []))
  );
}

export function reportSince(since: Date): AlgorithmRunReport {
  const events = allEventsSince(since);
  const replyModes = new Map(
    events
      .filter((e) => e.type === "reply")
      .map((e) => [e.turn as string, (e.mode as string | null) ?? null])
  );
  const titles = nodeTitles();

  return algorithmRunReport({
    events: events.filter(
      (e) => e.type === "algorithm_run"
    ) as unknown as ReportedEvent[],
    replyModes,
    nodeTitle: (node) => titles.get(node) ?? null,
  });
}

function percent(value: number | null): string {
  return value === null ? "-" : `${Math.round(value * 100)}%`;
}

function counts(record: Record<string, number>): string {
  const entries = Object.entries(record);

  return entries.length ? entries.map(([k, n]) => `${k} ${n}`).join(", ") : "none";
}

export function formatReport(report: AlgorithmRunReport): string[] {
  const { runs, overOpenRun } = report;

  return [
    `ALGORITHM turns: ${report.algorithmTurns} (reply.mode tagged ${report.taggedByReplyMode})`,
    `Runs started: ${runs.started} (finished ${runs.finished}, superseded ${runs.superseded}, open ${runs.open})`,
    `Finished runs with all five phases: ${report.finishedWithAllPhases}`,
    `Turns by verdict: ${counts(report.verdicts)} (no-node ${percent(report.noNodeShare)})`,
    `ALGORITHM turns without a reflection, by last phase: ${counts(report.unreflectedByLastPhase)}`,
    `Reflections outside a run: ${report.reflectionsOutsideRun}`,
    `Turns from agents that cannot tie a reflection to a turn: ${report.turnsWithoutSessionTie}`,
    `over-open-run: ${overOpenRun.cases.length} (OBSERVE written ${overOpenRun.withObserve}, not ${overOpenRun.withoutObserve})`,
    ...overOpenRun.cases.map(
      (c) =>
        `  ${c.date} ${c.project ?? "-"} "${c.nodeTitle ?? c.node ?? "-"}" old [${c.oldPhases.join(" ")}] observe ${c.observe ? "yes" : "no"} turns ${c.oldTurn ?? "-"} -> ${c.newTurn ?? "-"}`
    ),
  ];
}

function printReport(report: AlgorithmRunReport, json: boolean | undefined): number {
  const lines = json ? [JSON.stringify(report, null, 2)] : formatReport(report);

  for (const line of lines) console.log(line);

  return 0;
}

export const algorithmRunCommand = group({
  summary: "ALGORITHM runs recorded in shadow mode",
  commands: {
    report: leaf({
      summary:
        "Count ALGORITHM runs, their verdicts and endings, and list the cases to label",
      options: {
        since: {
          type: "string",
          value: "<date>",
          description: "Only events from this date on (default: all)",
        },
        json: { type: "boolean", description: "Machine-readable output" },
      },
      run: ({ values }) =>
        printReport(reportSince(parseSince(values.since)), values.json),
    }),
  },
});
