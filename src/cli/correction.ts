/**
 * pal cli correction — the kinds of mistakes the user corrected, and how often.
 *
 * Subcommands:
 *   kinds [--days N] [--split DATE] [--json]   Corrections per 100 turns, by kind
 *   backfill                                    Label the confirmed corrections logged without a kind
 */

import { readTurns } from "../hooks/lib/adaptation-turns";
import { backfillCorrectionKinds } from "../hooks/lib/correction-backfill";
import { type KindRates, kindRates, splitRates } from "../hooks/lib/correction-rates";
import { group, leaf, UsageError } from "../tools/lib/command";

export const correctionCommand = group({
  summary: "The kinds of mistakes you corrected, and how often",
  commands: {
    kinds: leaf({
      summary: "Corrections per 100 turns, by kind",
      options: {
        days: { type: "string", description: "Window in days (default 30)" },
        split: { type: "string", description: "Compare before and after this date" },
        json: { type: "boolean", description: "Machine-readable output" },
      },
      run: ({ values }) => cmdKinds(values.days, values.split, values.json === true),
    }),
    backfill: leaf({
      summary: "Label the confirmed corrections logged without a kind",
      run: () => cmdBackfill(),
    }),
  },
});

function windowDays(days: string | undefined): number {
  if (days === undefined) return 30;
  const parsed = Number(days);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new UsageError(`--days must be a whole number of days, got "${days}"`);
  return parsed;
}

function splitDate(split: string): Date {
  const at = new Date(split);
  if (Number.isNaN(at.getTime()))
    throw new UsageError(`--split must be a date such as 2026-10-20, got "${split}"`);
  return at;
}

function kindLine(name: string, count: string, rate: string, extra = ""): string {
  return `  ${name.padEnd(22)}${count.padStart(4)}  ${rate.padStart(5)}${extra}`;
}

function formatRates(rates: KindRates, title: string): string {
  const header = `${title}: ${rates.turns} turns, ${rates.corrections} confirmed corrections, ${rates.unlabelled} without a kind`;
  const rows = rates.kinds.map((rate) => {
    const names = rate.suggestions.length
      ? `  (${[...new Set(rate.suggestions)].join(", ")})`
      : "";
    return kindLine(rate.kind, String(rate.count), rate.per100.toFixed(1), names);
  });
  return [header, kindLine("kind", "n", "/100"), ...rows].join("\n");
}

function cmdKinds(days: string | undefined, split: string | undefined, json: boolean) {
  const turns = readTurns(windowDays(days));
  const result = split ? splitRates(turns, splitDate(split)) : kindRates(turns);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  const sections =
    "before" in result
      ? [
          formatRates(result.before, "Before ".concat(split ?? "")),
          formatRates(result.after, "From ".concat(split ?? "")),
        ]
      : [formatRates(result, "Last ".concat(String(windowDays(days)), " days"))];
  console.log(sections.join("\n\n"));
  return 0;
}

async function cmdBackfill() {
  const result = await backfillCorrectionKinds(undefined, (turn, kind) =>
    console.log(`${turn.ts.slice(0, 16)}  ${kind ? kind.kind : "failed"}  ${turn.issue}`)
  );
  console.log(`Labelled ${result.labelled}, failed ${result.failed}.`);
  return result.failed > 0 ? 1 : 0;
}
