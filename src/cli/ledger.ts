/**
 * pal cli ledger — query the action ledger.
 *
 * Thin presentation layer over src/tools/ledger/query.ts. Owns formatting and
 * argv parsing only; every question about the records themselves is answered
 * there.
 */

import type { LedgerEntry } from "../hooks/lib/ledger";
import {
  type ChainVerdict,
  chainVerdict,
  changedLines,
  changeShape,
  findEntry,
  type LedgerFilter,
  ledgerFiles,
  locate,
  parseSince,
  queryLedger,
  type Standing,
  standing,
  summarize,
} from "../tools/ledger/query";
import { UsageError } from "../tools/lib/command";

export function ledgerLog(values: Record<string, unknown>): number {
  return cmdLog(buildFilter(values), values.json === true);
}

export function ledgerShow(id: string, json: boolean): number {
  return cmdShow(id, json);
}

export function ledgerStats(values: Record<string, unknown>): number {
  return cmdStats(buildFilter(values), values.json === true);
}

/** A filter that silently ignored an unparseable window would answer the wrong question. */
function buildFilter(values: Record<string, unknown>): LedgerFilter {
  const filter: LedgerFilter = {};
  for (const key of [
    "project",
    "actor",
    "machine",
    "runtime",
    "outcome",
    "tool",
    "target",
  ] as const) {
    const value = values[key];
    if (typeof value === "string") filter[key] = value;
  }

  for (const key of ["since", "until"] as const) {
    const spec = values[key];
    if (typeof spec !== "string") continue;
    const at = parseSince(spec);
    if (!at)
      throw new UsageError(`Unrecognised --${key}: ${spec} (use 7d, 24h, or a date)`);
    filter[key] = at;
  }

  if (typeof values.limit === "string") {
    const limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1)
      throw new UsageError("--limit must be a positive integer");
    filter.limit = limit;
  }
  return filter;
}

function shortId(id: string): string {
  return id.slice(0, 11).padEnd(11);
}

function cmdLog(filter: LedgerFilter, json: boolean): number {
  const entries = queryLedger(filter);
  if (json) {
    console.log(JSON.stringify(entries, null, 2));
    return 0;
  }

  if (entries.length === 0) {
    console.log("No actions match.");
    return 0;
  }

  for (const entry of entries) {
    console.log(
      `${entry.ts}  ${shortId(entry.id)}  ${entry.outcome.padEnd(7)}  ${entry.runtime.padEnd(8)}  ${entry.tool.padEnd(5)}  ${changedLines(entry).padEnd(9)}  ${entry.target}`
    );
  }
  console.log(
    `\n${entries.length} action(s) across ${ledgerFiles().length} ledger file(s).`
  );
  return 0;
}

function describeStanding(verdict: Standing): string {
  switch (verdict.state) {
    case "in-place":
      return "still in place on disk";
    case "reverted":
      return verdict.replays
        ? "reverted since — the stored change replays cleanly onto the file as it stands"
        : "reverted since, but the stored change no longer replays";
    case "superseded":
      return `superseded — the file has changed again since (now ${verdict.hash.slice(0, 12)})`;
    case "missing":
      return "the target no longer exists";
    default:
      return verdict.why;
  }
}

function describeChain(verdict: ChainVerdict): string {
  switch (verdict.state) {
    case "latest":
      return "the newest recorded action on this target";
    case "undone":
      return `undone by ${verdict.by} at ${verdict.at}, which put the file back as this one found it`;
    default:
      return `changed again by ${verdict.by} at ${verdict.at}`;
  }
}

const UNKEPT_CHANGE: Record<string, string> = {
  redacted: "contents withheld — the target is one the ledger never keeps",
  truncated: "the change was too large to keep; its size and hashes remain",
  none: "no change was recorded, which is what a refused action looks like",
};

function printChange(entry: LedgerEntry): void {
  const shape = changeShape(entry);
  if (shape.kind !== "hunks") {
    console.log(`  ${UNKEPT_CHANGE[shape.kind]}`);
    return;
  }
  for (const hunk of shape.delta.hunks) {
    console.log(`  @@ line ${hunk.at + 1}, -${hunk.remove} +${hunk.insert.length}`);
    for (const line of hunk.insert) console.log(`  + ${line}`);
  }
}

function cmdShow(id: string, json: boolean): number {
  const entry = findEntry(id);
  if (!entry) return fail(`No action with id ${id}`);

  if (json) {
    console.log(
      JSON.stringify(
        {
          ...entry,
          resolved: locate(entry),
          standing: standing(entry),
          chain: chainVerdict(entry),
        },
        null,
        2
      )
    );
    return 0;
  }

  console.log(`
  ${entry.id}  ${entry.ts}
  ${entry.tool} → ${outcomeLine(entry)}
  target      ${entry.target}
  on disk     ${diskLine(entry)}
  runtime     ${entry.runtime}, authority ${entry.authority}
  actor       ${entry.actor}
  machine     ${entry.machine}
  size        ${sizeOf(entry.before, "created")} → ${sizeOf(entry.after, "nothing landed")}
  standing    ${describeStanding(standing(entry))}
  in ledger   ${describeChain(chainVerdict(entry))}

  change`);
  printChange(entry);
  return 0;
}

function outcomeLine(entry: LedgerEntry): string {
  return entry.reason ? `${entry.outcome} (${entry.reason})` : entry.outcome;
}

function diskLine(entry: LedgerEntry): string {
  const found = locate(entry);
  if (found.path) return found.path;
  return `unresolvable: project ${found.unresolvable} is not registered here`;
}

function sizeOf(state: LedgerEntry["before"], absent: string): string {
  return state ? `${state.bytes}b` : absent;
}

function printTally(label: string, counts: Record<string, number>): void {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return;
  console.log(`  ${label}`);
  for (const [key, count] of rows)
    console.log(`    ${String(count).padStart(6)}  ${key}`);
}

function cmdStats(filter: LedgerFilter, json: boolean): number {
  const stats = summarize(queryLedger(filter));
  if (json) {
    console.log(JSON.stringify(stats, null, 2));
    return 0;
  }

  console.log(
    `\n  ${stats.total} action(s) across ${ledgerFiles().length} ledger file(s)`
  );
  if (stats.span) console.log(`  ${stats.span.first} → ${stats.span.last}\n`);
  printTally("outcome", stats.byOutcome);
  printTally("runtime", stats.byRuntime);
  printTally("tool", stats.byTool);
  printTally("actor", stats.byActor);
  if (stats.topTargets.length > 0) {
    console.log("  most-changed targets");
    for (const { target, count } of stats.topTargets) {
      console.log(`    ${String(count).padStart(6)}  ${target}`);
    }
  }
  return 0;
}

function fail(message: string): number {
  console.error(message);
  return 1;
}
