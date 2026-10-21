/**
 * Every PR attached to a node is asked about at session start. A merged or closed PR is
 * settled on that node and never asked again, and the one that settled last writes the
 * node's stopped-at line; an open PR is asked again next time. All the gh calls share one
 * time budget, so a session never waits on them.
 */

import { spawnSync } from "node:child_process";
import {
  appendEvent,
  buildTree,
  readEvents,
  type ScopeTree,
  type WorkEvent,
  type WorkNode,
} from "./progress-tree";

export type GhRunner = (ref: string, cwd: string, timeoutMs: number) => string | null;

const PR_CHECK_BUDGET_MS = 3000;

const PR_VIEW_FIELDS = "state,mergedAt,closedAt";

export function ghPrView(
  ref: string,
  cwd: string,
  timeoutMs: number,
  bin = "gh"
): string | null {
  try {
    const result = spawnSync(bin, ["pr", "view", "--json", PR_VIEW_FIELDS, ref], {
      cwd,
      encoding: "utf-8",
      timeout: timeoutMs,
    });
    return result.status === 0 ? result.stdout : null;
  } catch {
    return null;
  }
}

export interface SettleOptions {
  file?: string;
  gh?: GhRunner;
  clock?: () => number;
  budgetMs?: number;
  now?: Date;
}

interface PrView {
  state: string;
  mergedAt: string | null;
  closedAt: string | null;
}

interface Outcome {
  state: "merged" | "closed";
  at: string;
}

interface Settled {
  number: number;
  outcome: Outcome;
}

interface Candidate {
  node: WorkNode;
  ref: string;
}

function parsePrView(stdout: string): PrView | null {
  try {
    const view = JSON.parse(stdout) as PrView;
    return typeof view.state === "string" ? view : null;
  } catch {
    return null;
  }
}

function unsettledPrRefs(node: WorkNode): string[] {
  const settled = new Set(node.settledPrs.map((pr) => pr.ref));
  const refs = node.artifacts.filter((a) => a.kind === "pr").map((a) => a.ref);
  return [...new Set(refs)].filter((ref) => !settled.has(ref));
}

function settledOutcome(view: PrView): Outcome | null {
  if (view.state === "MERGED" && view.mergedAt)
    return { state: "merged", at: view.mergedAt };
  if (view.state === "CLOSED" && view.closedAt)
    return { state: "closed", at: view.closedAt };
  return null;
}

function refNumber(ref: string): number | null {
  const digits = /(\d+)$/.exec(ref)?.[1];
  return digits ? Number(digits) : null;
}

function settledOf(ref: string, stdout: string | null): Settled | null {
  const view = stdout === null ? null : parsePrView(stdout);
  const outcome = view ? settledOutcome(view) : null;
  const number = refNumber(ref);
  return outcome && number !== null ? { number, outcome } : null;
}

function settledLine({ number, outcome }: Settled): string {
  const day = outcome.at.slice(0, 10);
  return outcome.state === "merged"
    ? `PR #${number} merged ${day}`
    : `PR #${number} closed without merging ${day}`;
}

function setsStoppedAt(event: WorkEvent): boolean {
  if (event.type === "stopped") return true;
  return (
    (event.type === "park" || event.type === "pr-settled") &&
    event.stoppedAt !== undefined
  );
}

function lastLineTs(events: WorkEvent[], scope: string, node: string): string | null {
  const lines = events.filter(
    (event) => event.scope === scope && event.node === node && setsStoppedAt(event)
  );
  return lines.at(-1)?.ts ?? null;
}

function lineIsNewer(lineTs: string | null, at: string): boolean {
  return lineTs !== null && Date.parse(lineTs) > Date.parse(at);
}

function unsettledCandidates(tree: ScopeTree): Candidate[] {
  return [...tree.nodes.values()]
    .filter((node) => node.status !== "done")
    .flatMap((node) => unsettledPrRefs(node).map((ref) => ({ node, ref })));
}

interface Result {
  candidate: Candidate;
  settled: Settled;
}

function settledWithinBudget(
  tree: ScopeTree,
  cwd: string,
  options: SettleOptions
): Result[] {
  const gh = options.gh ?? ghPrView;
  const clock = options.clock ?? Date.now;
  const deadline = clock() + (options.budgetMs ?? PR_CHECK_BUDGET_MS);
  const results: Result[] = [];
  for (const candidate of unsettledCandidates(tree)) {
    const remaining = deadline - clock();
    if (remaining <= 0) break;
    const settled = settledOf(candidate.ref, gh(candidate.ref, cwd, remaining));
    if (settled) results.push({ candidate, settled });
  }
  return results;
}

function newestPerNode(results: Result[]): Set<Result> {
  const newest = new Map<string, Result>();
  for (const result of results) {
    const held = newest.get(result.candidate.node.id);
    const later =
      !held ||
      Date.parse(result.settled.outcome.at) > Date.parse(held.settled.outcome.at);
    if (later) newest.set(result.candidate.node.id, result);
  }
  return new Set(newest.values());
}

function recordSettled(
  scope: string,
  { candidate, settled }: Result,
  writesLine: boolean,
  file: string | undefined,
  now: Date
): void {
  const stoppedAt = writesLine ? { stoppedAt: settledLine(settled) } : {};
  appendEvent(
    scope,
    candidate.node.id,
    "pr-settled",
    { ref: candidate.ref, ...settled.outcome, ...stoppedAt },
    file,
    now
  );
}

function checkCandidates(scope: string, cwd: string, options: SettleOptions): void {
  const events = readEvents(options.file);
  const results = settledWithinBudget(buildTree(scope, events), cwd, options);
  const newest = newestPerNode(results);
  const now = options.now ?? new Date();
  for (const result of results) {
    const lineTs = lastLineTs(events, scope, result.candidate.node.id);
    const writesLine =
      newest.has(result) && !lineIsNewer(lineTs, result.settled.outcome.at);
    recordSettled(scope, result, writesLine, options.file, now);
  }
}

export function settleAttachedPrs(
  scope: string,
  cwd: string,
  options: SettleOptions = {}
): void {
  try {
    checkCandidates(scope, cwd, options);
  } catch {
    return;
  }
}
