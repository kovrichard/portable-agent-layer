/**
 * The ledger as a page reads it: counts first, rows second, every field
 * already in the words a person would use. Ids become labels, anchors become
 * "project / path", deltas become line counts. Nothing here is computed in
 * the browser, so the numbers on the page are the numbers the tests check.
 */

import {
  type ActorRegistryEntry,
  actorDisplayName,
  loadActor,
  readActorRegistry,
} from "../../hooks/lib/actor";
import type { LedgerEntry } from "../../hooks/lib/ledger";
import {
  loadMachine,
  displayName as machineDisplayName,
  type RegistryEntry,
  readRegistry as readMachineRegistry,
} from "../../hooks/lib/machine";
import { PAGE_OUTCOMES, type PageOutcome } from "./outcomes";
import { anchorSlugOf, changedLines, type LedgerFilter, queryLedger } from "./query";

export { PAGE_OUTCOMES, type PageOutcome };

export interface OutcomeCount {
  total: number;
  byAuthority: Record<string, number>;
  byRuntime: Record<string, number>;
}

export interface LedgerViewStats {
  total: number;
  refusals: number;
  outcomes: Record<PageOutcome, OutcomeCount>;
}

export interface LedgerViewRow {
  id: string;
  ts: string;
  /** Where the record was written. Local-only in the record; the page names it. */
  machine: string;
  actor: string;
  authority: string;
  runtime: string;
  tool: string;
  target: string;
  change: string;
  outcome: string;
  reason?: string;
  /** Present only on a blocked shell action, where the target is a directory. */
  command?: string;
}

export interface LedgerView {
  window: { since: string | null; until: string | null };
  stats: LedgerViewStats;
  rows: LedgerViewRow[];
}

function emptyCount(): OutcomeCount {
  return { total: 0, byAuthority: {}, byRuntime: {} };
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function isPageOutcome(outcome: string): outcome is PageOutcome {
  return (PAGE_OUTCOMES as readonly string[]).includes(outcome);
}

export function viewStats(entries: LedgerEntry[]): LedgerViewStats {
  const outcomes = Object.fromEntries(
    PAGE_OUTCOMES.map((outcome) => [outcome, emptyCount()])
  ) as Record<PageOutcome, OutcomeCount>;

  for (const entry of entries) {
    if (!isPageOutcome(entry.outcome)) continue;
    const count = outcomes[entry.outcome];
    count.total++;
    bump(count.byAuthority, entry.authority);
    bump(count.byRuntime, entry.runtime);
  }

  return {
    total: entries.length,
    refusals: outcomes.denied.total + outcomes.blocked.total,
    outcomes,
  };
}

export function displayTarget(target: string): string {
  const slug = anchorSlugOf(target);
  if (!slug) return target;
  const rest = target.slice(`{proj:${slug}}`.length);
  return rest ? `${slug} ${rest}` : slug;
}

interface Names {
  actors: ActorRegistryEntry[];
  machines: RegistryEntry[];
}

function toRow(entry: LedgerEntry, { actors, machines }: Names): LedgerViewRow {
  const row: LedgerViewRow = {
    id: entry.id,
    ts: entry.ts,
    machine: machineDisplayName(entry.machine, machines),
    actor: actorDisplayName(entry.actor, actors),
    authority: entry.authority,
    runtime: entry.runtime,
    tool: entry.tool,
    target: displayTarget(entry.target),
    change: changedLines(entry),
    outcome: entry.outcome,
  };
  if (entry.reason) row.reason = entry.reason;
  if (entry.command) row.command = entry.command;
  return row;
}

/** This install first: on a fresh machine the registries may not list it yet. */
function knownNames(): Names {
  const actor = loadActor();
  const machine = loadMachine();
  return {
    actors: [{ id: actor.id, label: actor.label }, ...readActorRegistry()],
    machines: [
      { id: machine.id, label: machine.label, os: machine.os },
      ...readMachineRegistry(),
    ],
  };
}

export function viewRows(entries: LedgerEntry[]): LedgerViewRow[] {
  const names = knownNames();
  return entries
    .slice()
    .reverse()
    .map((entry) => toRow(entry, names));
}

export function ledgerView(filter: LedgerFilter = {}): LedgerView {
  const entries = queryLedger(filter);
  return {
    window: {
      since: filter.since?.toISOString() ?? null,
      until: filter.until?.toISOString() ?? null,
    },
    stats: viewStats(entries),
    rows: viewRows(entries),
  };
}
