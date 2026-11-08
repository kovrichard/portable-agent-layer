/**
 * pal cli compaction — score the shadow "compaction is close" rule against logged history.
 *
 * Subcommands:
 *   backtest [--margin <f>[,...]] [--days N] [--window <tokens>[@<until>]]... [--json]
 */

import {
  type BacktestLabels,
  type BacktestRow,
  backtestCompaction,
  type WindowEntry,
  windowResolver,
} from "../hooks/lib/compaction-backtest";
import {
  COMPACTION_MARGIN_FRACTION,
  currentCompactionWindow,
} from "../hooks/lib/compaction-near";
import { eventsSince } from "../hooks/lib/events";
import { group, leaf, runCommand, UsageError } from "../tools/lib/command";
import { windowDays } from "./correction";

const DAY_MS = 86_400_000;

function parseMargins(raw: string | undefined): number[] {
  if (raw === undefined) return [COMPACTION_MARGIN_FRACTION];
  const parts = raw.split(",").map((part) => part.trim());
  const valid = parts.every((part) => {
    const value = Number(part);
    return part !== "" && Number.isFinite(value) && value > 0 && value < 1;
  });
  if (!valid)
    throw new UsageError(
      `--margin must be fractions between 0 and 1 such as 0.2,0.3, got "${raw}"`
    );
  return parts.map(Number);
}

function windowError(raw: string): UsageError {
  return new UsageError(
    `--window must be <tokens>[@<until ISO time>] such as 300000@2026-11-05T09:16:00+01:00, got "${raw}"`
  );
}

function parseWindowEntry(raw: string): WindowEntry {
  const match = /^([1-9]\d*)(?:@(.+))?$/.exec(raw);
  if (!match) throw windowError(raw);
  const tokens = Number(match[1]);
  if (match[2] === undefined) return { tokens, until: null };
  const until = Date.parse(match[2]);
  if (Number.isNaN(until)) throw windowError(raw);
  return { tokens, until };
}

function untilOrder(a: WindowEntry, b: WindowEntry): number {
  if (a.until === b.until) return 0;
  if (a.until === null) return 1;
  if (b.until === null) return -1;
  return a.until - b.until;
}

function parseWindowSchedule(raw: string[] | undefined): WindowEntry[] {
  const entries = (raw ?? []).map(parseWindowEntry);
  if (entries.filter((entry) => entry.until === null).length > 1)
    throw new UsageError("only one --window may leave out @<until>");
  return entries.sort(untilOrder);
}

function leadText(value: number | null, digits: number): string {
  return value === null ? "-" : value.toFixed(digits);
}

function formatRow(row: BacktestRow): string {
  return `margin ${row.margin}: ${row.warned} warned, ${row.missed} missed, ${row.falseAlarms} false alarms, median lead ${leadText(row.medianLeadMinutes, 1)} min / ${leadText(row.medianLeadTokens, 0)} tokens`;
}

function formatLabels(labels: BacktestLabels): string {
  return `auto compactions: ${labels.threshold} threshold, ${labels.idle} idle, ${labels.unexplained} unexplained`;
}

function cmdBacktest(values: {
  margin?: string;
  days?: string;
  window?: string[];
  json?: boolean;
}): number {
  const margins = parseMargins(values.margin);
  const days = windowDays(values.days);
  const schedule = parseWindowSchedule(values.window);
  const since = new Date(Date.now() - days * DAY_MS);
  const windowAt = windowResolver(
    eventsSince("compaction_near", since),
    schedule,
    (model) => currentCompactionWindow(model, process.cwd())?.tokens ?? null
  );
  const result = backtestCompaction(
    eventsSince("model_call", since),
    eventsSince("compaction", since),
    margins,
    windowAt
  );
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  for (const row of result.rows) console.log(formatRow(row));
  console.log(formatLabels(result.labels));
  return 0;
}

export const compactionCommand = group({
  summary: "The shadow rule that predicts an auto compaction",
  commands: {
    backtest: leaf({
      summary: "Label logged auto compactions and score the rule against them",
      options: {
        margin: {
          type: "string",
          value: "<fraction>[,...]",
          description: "Margins as fractions of the usable window (default 0.2)",
        },
        days: {
          type: "string",
          value: "<n>",
          description: "Days of history (default 30)",
        },
        window: {
          type: "string",
          multiple: true,
          value: "<tokens>[@<until>]",
          description:
            "Window schedule where no compaction_near event gives one; repeatable",
        },
        json: { type: "boolean", description: "Machine-readable output" },
      },
      run: ({ values }) => cmdBacktest(values),
    }),
  },
});

export function runCompaction(args: string[]): Promise<number> {
  return runCommand(compactionCommand, args, ["pal", "cli", "compaction"]);
}
