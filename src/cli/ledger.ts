/**
 * pal cli ledger — query the action ledger.
 *
 * Thin presentation layer over src/tools/ledger/query.ts. Owns formatting and
 * argv parsing only; every question about the records themselves is answered
 * there.
 *
 * Subcommands:
 *   log [filters]     Matching actions, oldest first
 *   show <id>         One action in full, with its change and current standing
 *   stats [filters]   Counts by outcome, runtime, actor, tool and target
 */

import { parseArgs } from "node:util";
import type { LedgerEntry } from "../hooks/lib/ledger";
import {
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

const FILTER_OPTIONS = {
  project: { type: "string" },
  since: { type: "string" },
  until: { type: "string" },
  actor: { type: "string" },
  machine: { type: "string" },
  runtime: { type: "string" },
  outcome: { type: "string" },
  tool: { type: "string" },
  target: { type: "string" },
  limit: { type: "string" },
  json: { type: "boolean" },
} as const;

export async function runLedger(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "log":
      return cmdLog(rest);
    case "show":
      return cmdShow(rest);
    case "stats":
      return cmdStats(rest);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      showHelp();
      return 0;
    default:
      console.error(`Unknown subcommand: ${sub}\n`);
      showHelp();
      return 1;
  }
}

function showHelp(): void {
  console.log(`
  Usage:
    pal cli ledger <subcommand> [filters]

  Subcommands:
    log [filters]              Matching actions, oldest first
    show <id>                  One action in full: change, target, standing
    stats [filters]            Counts by outcome, runtime, actor, tool, target

  Filters:
    --project <slug>           Actions against a registered project
    --since <7d|2026-09-01>    A duration back from now, or a date
    --until <date>             Upper bound on the timestamp
    --actor <id>               Who caused it
    --machine <id>             Which install wrote it
    --runtime <agent>          claude, cursor, codex, copilot, opencode
    --outcome <applied|failed|denied>
    --tool <Edit|Write>
    --target <substring>       Match anywhere in the recorded path
    --limit <n>                Keep the newest n matches
    --json                     Machine-readable output

  Examples:
    pal cli ledger log --project portable-agent-layer --since 7d
    pal cli ledger log --target memory/ --outcome applied
    pal cli ledger stats --since 24h
`);
}

/** A filter that silently ignored an unparseable window would answer the wrong question. */
function buildFilter(values: Record<string, unknown>): LedgerFilter | string {
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
    if (!at) return `Unrecognised --${key}: ${spec} (use 7d, 24h, or a date)`;
    filter[key] = at;
  }

  if (typeof values.limit === "string") {
    const limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1)
      return `--limit must be a positive integer`;
    filter.limit = limit;
  }
  return filter;
}

function parseFilters(args: string[]): { filter: LedgerFilter; json: boolean } | string {
  try {
    const { values } = parseArgs({
      args,
      options: FILTER_OPTIONS,
      allowPositionals: true,
    });
    const filter = buildFilter(values);
    return typeof filter === "string" ? filter : { filter, json: values.json === true };
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function shortId(id: string): string {
  return id.slice(0, 11).padEnd(11);
}

function changedLines(entry: LedgerEntry): string {
  const shape = changeShape(entry);
  switch (shape.kind) {
    case "redacted":
      return "withheld";
    case "truncated":
      return "too large";
    case "none":
      return "no change";
    default: {
      const added = shape.delta.hunks.reduce((n, h) => n + h.insert.length, 0);
      const removed = shape.delta.hunks.reduce((n, h) => n + h.remove, 0);
      return `+${added} -${removed}`;
    }
  }
}

function cmdLog(args: string[]): number {
  const parsed = parseFilters(args);
  if (typeof parsed === "string") return fail(parsed);

  const entries = queryLedger(parsed.filter);
  if (parsed.json) {
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

function cmdShow(args: string[]): number {
  const [id, ...rest] = args;
  if (!id) return fail("Usage: pal cli ledger show <id>");

  const entry = findEntry(id);
  if (!entry) return fail(`No action with id ${id}`);

  if (rest.includes("--json")) {
    console.log(
      JSON.stringify(
        { ...entry, resolved: locate(entry), standing: standing(entry) },
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

function cmdStats(args: string[]): number {
  const parsed = parseFilters(args);
  if (typeof parsed === "string") return fail(parsed);

  const stats = summarize(queryLedger(parsed.filter));
  if (parsed.json) {
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
