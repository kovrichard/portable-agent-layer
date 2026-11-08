import { type BacktestRow, backtestRows } from "../hooks/lib/compaction-backtest";
import { COMPACTION_NEAR_THRESHOLD } from "../hooks/lib/compaction-near";
import { eventsSince } from "../hooks/lib/events";
import { group, leaf, runCommand, UsageError } from "../tools/lib/command";
import { windowDays } from "./correction";

const DAY_MS = 86_400_000;

function parseThresholds(at: string | undefined): number[] {
  if (at === undefined) return [COMPACTION_NEAR_THRESHOLD];
  const parts = at.split(",").map((part) => part.trim());
  if (!parts.every((part) => /^[1-9]\d*$/.test(part)))
    throw new UsageError(`--at must be token counts such as 150000,200000, got "${at}"`);
  return parts.map(Number);
}

function leadText(value: number | null, digits: number): string {
  return value === null ? "-" : value.toFixed(digits);
}

function formatRow(row: BacktestRow): string {
  return `at ${row.threshold} tokens: ${row.warned} warned, ${row.missed} missed, ${row.falseAlarms} false alarms, median lead ${leadText(row.medianLeadMinutes, 1)} min / ${leadText(row.medianLeadTokens, 0)} tokens`;
}

function cmdBacktest(
  at: string | undefined,
  days: string | undefined,
  json: boolean
): number {
  const thresholds = parseThresholds(at);
  const since = new Date(Date.now() - windowDays(days) * DAY_MS);
  const rows = backtestRows(
    eventsSince("model_call", since),
    eventsSince("compaction", since),
    thresholds
  );
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    for (const row of rows) console.log(formatRow(row));
  }
  return 0;
}

export const compactionCommand = group({
  summary: "The shadow rule that predicts an auto compaction",
  commands: {
    backtest: leaf({
      summary: "Score the rule against the logged compactions and model calls",
      options: {
        at: {
          type: "string",
          description: `Thresholds in tokens, comma-separated (default ${COMPACTION_NEAR_THRESHOLD})`,
        },
        days: { type: "string", description: "Window in days (default 30)" },
        json: { type: "boolean", description: "Machine-readable output" },
      },
      run: ({ values }) => cmdBacktest(values.at, values.days, values.json === true),
    }),
  },
});

export function runCompaction(args: string[]): Promise<number> {
  return runCommand(compactionCommand, args, ["pal", "cli", "compaction"]);
}
