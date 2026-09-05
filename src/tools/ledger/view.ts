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
import { anchorSlugOf, changedLines, type LedgerFilter, queryLedger } from "./query";

export const PAGE_OUTCOMES = ["applied", "failed", "denied", "blocked"] as const;
export type PageOutcome = (typeof PAGE_OUTCOMES)[number];

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
  actor: string;
  authority: string;
  runtime: string;
  tool: string;
  target: string;
  change: string;
  outcome: string;
  reason?: string;
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

function toRow(entry: LedgerEntry, registry: ActorRegistryEntry[]): LedgerViewRow {
  const row: LedgerViewRow = {
    id: entry.id,
    ts: entry.ts,
    actor: actorDisplayName(entry.actor, registry),
    authority: entry.authority,
    runtime: entry.runtime,
    tool: entry.tool,
    target: displayTarget(entry.target),
    change: changedLines(entry),
    outcome: entry.outcome,
  };
  if (entry.reason) row.reason = entry.reason;
  return row;
}

/** The local actor first: on a fresh install the registry may not list them yet. */
function knownActors(): ActorRegistryEntry[] {
  const self = loadActor();
  return [{ id: self.id, label: self.label }, ...readActorRegistry()];
}

export function viewRows(entries: LedgerEntry[]): LedgerViewRow[] {
  const registry = knownActors();
  return entries
    .slice()
    .reverse()
    .map((entry) => toRow(entry, registry));
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
