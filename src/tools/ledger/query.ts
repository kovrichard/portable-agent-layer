/**
 * The read side of the action ledger — typed queries over what was recorded.
 *
 * The write side stores enough to answer questions, but only in the shape that
 * was cheap to write: one JSON object per line, targets held as project
 * anchors, changes held as line deltas. Reading it back with a grep gets the
 * lines and loses the meaning — a slug is not a path, and a delta is not a
 * diff until something replays it.
 *
 * Every query here spans the archives as well as the active file. Rotation
 * exists so history survives; a reader that opened only the live file would
 * quietly answer "what changed" with "what changed recently".
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveAnchor } from "../../hooks/lib/anchor";
import {
  applyDelta,
  type LedgerDelta,
  type LedgerEntry,
  ledgerPath,
} from "../../hooks/lib/ledger";
import { paths } from "../../hooks/lib/paths";

const ARCHIVE_RE = /^actions-.*\.jsonl$/;

const ANCHOR_SLUG_RE = /^\{proj:([a-z0-9_-]+)\}/;

export interface LedgerFilter {
  project?: string;
  since?: Date;
  until?: Date;
  actor?: string;
  machine?: string;
  runtime?: string;
  outcome?: string;
  tool?: string;
  target?: string;
  limit?: number;
}

/**
 * Archives first, then the active file, so the result reads oldest to newest
 * the way the underlying appends do. Names carry an ISO stamp, which sorts
 * lexicographically into chronological order.
 */
export function ledgerFiles(): string[] {
  const dir = paths.ledger();
  const archives = readdirSync(dir)
    .filter((name) => ARCHIVE_RE.test(name))
    .sort()
    .map((name) => resolve(dir, name));
  const active = ledgerPath();
  return existsSync(active) ? [...archives, active] : archives;
}

function entriesInFile(file: string): LedgerEntry[] {
  if (!existsSync(file)) return [];
  const entries: LedgerEntry[] = [];
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as LedgerEntry);
    } catch {
      /* a partially written line is not evidence; skip it */
    }
  }
  return entries;
}

export function readLedger(): LedgerEntry[] {
  return ledgerFiles().flatMap(entriesInFile);
}

export function anchorSlugOf(target: string): string | null {
  return ANCHOR_SLUG_RE.exec(target)?.[1] ?? null;
}

/**
 * An entry names its project two ways depending on when it was written, and a
 * query has to accept both. An anchored target carries the slug outright. A
 * plain one predates anchoring or fell outside every registered project, and
 * only means this project if it resolves under its root on this machine.
 */
function inProject(entry: LedgerEntry, slug: string): boolean {
  const anchored = anchorSlugOf(entry.target);
  if (anchored) return anchored === slug;

  const root = resolveAnchor(`{proj:${slug}}`);
  if (root.state !== "anchored") return false;
  return resolve(entry.target).startsWith(resolve(root.path));
}

function matchesFilter(entry: LedgerEntry, filter: LedgerFilter): boolean {
  const at = new Date(entry.ts).getTime();
  if (filter.since && at < filter.since.getTime()) return false;
  if (filter.until && at > filter.until.getTime()) return false;
  if (filter.project && !inProject(entry, filter.project)) return false;
  if (filter.actor && entry.actor !== filter.actor) return false;
  if (filter.machine && entry.machine !== filter.machine) return false;
  if (filter.runtime && entry.runtime !== filter.runtime) return false;
  if (filter.outcome && entry.outcome !== filter.outcome) return false;
  if (filter.tool && entry.tool.toLowerCase() !== filter.tool.toLowerCase()) return false;
  if (filter.target && !entry.target.includes(filter.target)) return false;
  return true;
}

/**
 * Matching entries oldest first, capped from the newest end — a limit that
 * dropped the newest would answer "the last N changes" with the first ones.
 */
export function queryLedger(filter: LedgerFilter = {}): LedgerEntry[] {
  const matched = readLedger().filter((entry) => matchesFilter(entry, filter));
  return filter.limit === undefined ? matched : matched.slice(-filter.limit);
}

export function findEntry(id: string): LedgerEntry | null {
  return readLedger().find((entry) => entry.id === id) ?? null;
}

/**
 * Where the entry's target lives on this machine, or the reason it cannot be
 * placed — a project this install has never registered resolves to nothing,
 * and saying so is more useful than printing a slug as if it were a path.
 */
export function locate(entry: LedgerEntry): { path?: string; unresolvable?: string } {
  const resolved = resolveAnchor(entry.target);
  return resolved.state === "unresolvable"
    ? { unresolvable: resolved.slug }
    : { path: resolved.path };
}

export type ChangeShape =
  | { kind: "hunks"; delta: LedgerDelta }
  | { kind: "redacted" }
  | { kind: "truncated" }
  | { kind: "none" };

/**
 * What the entry can say about its own change. The three empty cases are kept
 * apart because they mean different things: contents deliberately withheld, a
 * change too large to keep, and an action that never landed at all.
 */
export function changeShape(entry: LedgerEntry): ChangeShape {
  if (!entry.delta) return { kind: "none" };
  if (entry.delta.redacted) return { kind: "redacted" };
  if (entry.delta.truncated) return { kind: "truncated" };
  return { kind: "hunks", delta: entry.delta };
}

/**
 * Whether the change this entry recorded is still the state of the file.
 *
 * The comparison is against the hashes the entry already carries, not a replay
 * from a stored before-image — the ledger keeps the change, not the prior file,
 * so there is nothing to replay from unless the file happens to be sitting at
 * its before-state again. `reverted` is exactly that case, and there the delta
 * can be run forward for real, which is why it reports whether it did.
 */
/** The change as a reader would want it summarised: a line count, or why there is none. */
export function changedLines(entry: LedgerEntry): string {
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

export type Standing =
  | { state: "in-place" }
  | { state: "reverted"; replays: boolean }
  | { state: "superseded"; hash: string }
  | { state: "missing" }
  | { state: "unknown"; why: string };

function hashOf(content: string): string {
  return new Bun.CryptoHasher("sha256").update(content, "utf-8").digest("hex");
}

function replaysToAfter(entry: LedgerEntry, onDisk: string): boolean {
  if (!entry.delta || !entry.after) return false;
  const rebuilt = applyDelta(onDisk, entry.delta);
  return rebuilt !== null && hashOf(rebuilt) === entry.after.hash;
}

export function standing(entry: LedgerEntry): Standing {
  if (!entry.after) return { state: "unknown", why: "the action never landed" };

  const found = locate(entry);
  if (!found.path)
    return { state: "unknown", why: `unknown project ${found.unresolvable}` };
  if (!existsSync(found.path)) return { state: "missing" };

  const onDisk = readFileSync(found.path, "utf-8");
  const hash = hashOf(onDisk);
  if (hash === entry.after.hash) return { state: "in-place" };
  if (entry.before && hash === entry.before.hash)
    return { state: "reverted", replays: replaysToAfter(entry, onDisk) };
  return { state: "superseded", hash };
}

/**
 * What the record itself says became of a change, as opposed to what the disk
 * says now.
 *
 * `standing` can only describe the present, so any entry that is not the newest
 * for its target reads as superseded — true, and nearly content-free, since it
 * says only that something happened afterwards. The ledger already holds the
 * whole per-target chain, and that answers the question worth asking: whether a
 * later action put the file back the way this one found it, and which action
 * that was. It stays true no matter how many edits come after.
 */
export type ChainVerdict =
  | { state: "latest" }
  | { state: "undone"; by: string; at: string }
  | { state: "followed"; by: string; at: string };

/**
 * Deliberately takes no entry list. A chain computed over a filtered query
 * would report `latest` for an entry the filter merely hid the successor of,
 * so there is no parameter here through which that mistake can be made.
 */
export function chainVerdict(entry: LedgerEntry): ChainVerdict {
  const all = readLedger();
  const position = all.findIndex((candidate) => candidate.id === entry.id);
  const later = all
    .slice(position + 1)
    .filter((candidate) => candidate.target === entry.target);
  if (later.length === 0) return { state: "latest" };

  const undo = undoingEntry(entry, later);
  const next = undo ?? later[0];
  return { state: undo ? "undone" : "followed", by: next.id, at: next.ts };
}

/**
 * The first later action that left the file as this one found it. An action
 * that never landed changed nothing to undo, and one that created the file is
 * undone by a deletion, which this ledger does not record.
 */
function undoingEntry(entry: LedgerEntry, later: LedgerEntry[]): LedgerEntry | undefined {
  if (!entry.before || !entry.after) return undefined;
  return later.find((candidate) => candidate.after?.hash === entry.before?.hash);
}

export interface LedgerStats {
  total: number;
  span: { first: string; last: string } | null;
  byOutcome: Record<string, number>;
  byRuntime: Record<string, number>;
  byActor: Record<string, number>;
  byTool: Record<string, number>;
  topTargets: { target: string; count: number }[];
}

function tally<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

function rank(
  counts: Record<string, number>,
  top: number
): { target: string; count: number }[] {
  return Object.entries(counts)
    .map(([target, count]) => ({ target, count }))
    .sort((a, b) => b.count - a.count || a.target.localeCompare(b.target))
    .slice(0, top);
}

export function summarize(entries: LedgerEntry[], topTargets = 10): LedgerStats {
  const first = entries.at(0);
  const last = entries.at(-1);
  return {
    total: entries.length,
    span: first && last ? { first: first.ts, last: last.ts } : null,
    byOutcome: tally(entries, (e) => e.outcome),
    byRuntime: tally(entries, (e) => e.runtime),
    byActor: tally(entries, (e) => e.actor),
    byTool: tally(entries, (e) => e.tool),
    topTargets: rank(
      tally(entries, (e) => e.target),
      topTargets
    ),
  };
}

/**
 * A window expressed the way someone asks for one: a duration back from now
 * ("7d", "24h") or a calendar date. Nothing else is guessed at — an
 * unparseable spec is reported rather than silently treated as no filter,
 * which would answer a narrow question with the whole ledger.
 */
export function parseSince(spec: string, now: Date = new Date()): Date | null {
  const duration = /^(\d+)([smhdw])$/.exec(spec.trim());
  if (duration) {
    const unit = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }[duration[2]];
    if (!unit) return null;
    return new Date(now.getTime() - Number(duration[1]) * unit);
  }

  const at = new Date(spec);
  return Number.isNaN(at.getTime()) ? null : at;
}
