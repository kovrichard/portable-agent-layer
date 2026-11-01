/**
 * What a run did, summed from the event log between its start and finish in
 * its scope: tool calls, edits, commits, compactions, model calls and their
 * API-price cost.
 */

import {
  allEventsSince,
  type EventType,
  type LoggedEvent,
  loggedEventIds,
} from "../../hooks/lib/events";
import { scopeOf } from "../../hooks/lib/progress-tree";
import { eventLogEnabled } from "../../hooks/lib/settings";
import { backfillGit } from "./backfill/git";
import { collectEvents } from "./collectors";
import { apiPriceOf } from "./cost-report";

export interface RunWindow {
  scope: string;
  startedAt: string;
  finishedAt: string;
  sessions: string[];
}

export interface RunStats {
  sessions: number;
  turns: number;
  compactions: number;
  toolCalls: number;
  toolCallsFailed: number;
  byTool: Record<string, number>;
  byProgram: Record<string, number>;
  skills: Record<string, number>;
  subagents: number;
  fileEdits: number;
  linesAdded: number;
  linesRemoved: number;
  commits: number;
  commitLinesAdded: number;
  commitLinesDeleted: number;
  modelCalls: number;
  models: string[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
  webFetches: number;
  apiCostUsd: number;
  unpricedModelCalls: number;
}

const numberOf = (value: unknown) => (typeof value === "number" ? value : 0);

function sumOf(events: LoggedEvent[], field: string): number {
  return events.reduce((sum, e) => sum + numberOf(e[field]), 0);
}

function tally(events: LoggedEvent[], field: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of events) {
    const key = e[field];
    if (typeof key === "string") counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function distinct(events: LoggedEvent[], field: string): string[] {
  return [...new Set(Object.keys(tally(events, field)))].sort();
}

function belongsToRun(window: RunWindow, scopeOfCwd: (cwd: string) => string) {
  const inScope = (e: LoggedEvent) => !!e.cwd && scopeOfCwd(e.cwd) === window.scope;
  const knowsSessions = window.sessions.length > 0;
  return (e: LoggedEvent) =>
    e.session && knowsSessions ? window.sessions.includes(e.session) : inScope(e);
}

function inWindow(window: RunWindow, scopeOfCwd: (cwd: string) => string) {
  const belongs = belongsToRun(window, scopeOfCwd);
  return (e: LoggedEvent) =>
    e.ts >= window.startedAt && e.ts <= window.finishedAt && belongs(e);
}

function toolStats(calls: LoggedEvent[]) {
  return {
    toolCalls: calls.length,
    toolCallsFailed: calls.filter((e) => e.outcome !== "ok").length,
    byTool: tally(calls, "tool"),
    byProgram: tally(calls, "program"),
    skills: tally(calls, "skill"),
    subagents: calls.filter((e) => typeof e.subagent === "string").length,
  };
}

function modelStats(calls: LoggedEvent[]) {
  const prices = calls.map(apiPriceOf);
  return {
    modelCalls: calls.length,
    models: distinct(calls, "model"),
    inputTokens: sumOf(calls, "inputTokens"),
    outputTokens: sumOf(calls, "outputTokens"),
    cacheReadTokens: sumOf(calls, "cacheRead"),
    cacheWriteTokens: sumOf(calls, "cacheWrite5m") + sumOf(calls, "cacheWrite1h"),
    webSearches: sumOf(calls, "webSearches"),
    webFetches: sumOf(calls, "webFetches"),
    apiCostUsd: prices.reduce<number>((sum, price) => sum + (price ?? 0), 0),
    unpricedModelCalls: prices.filter((price) => price === null).length,
  };
}

export function runStats(
  events: LoggedEvent[],
  window: RunWindow,
  scopeOfCwd: (cwd: string) => string
): RunStats {
  const inRun = events.filter(inWindow(window, scopeOfCwd));
  const of = (type: EventType) => inRun.filter((e) => e.type === type);
  const edits = of("action");
  const commits = of("commit");
  return {
    sessions: distinct(inRun, "session").length,
    turns: of("turn").length,
    compactions: of("compaction").length,
    ...toolStats(of("tool_call")),
    fileEdits: edits.length,
    linesAdded: sumOf(edits, "linesAdded"),
    linesRemoved: sumOf(edits, "linesRemoved"),
    commits: commits.length,
    commitLinesAdded: sumOf(commits, "added"),
    commitLinesDeleted: sumOf(commits, "deleted"),
    ...modelStats(of("model_call")),
  };
}

function memoized(resolveScope: (cwd: string) => string): (cwd: string) => string {
  const seen = new Map<string, string>();
  return (cwd) => {
    const known = seen.get(cwd);
    if (known !== undefined) return known;
    const scope = resolveScope(cwd);
    seen.set(cwd, scope);
    return scope;
  };
}

function readsRealAgentDirs(): boolean {
  return !process.env.PAL_TEST_SANDBOX;
}

/** Reads the agents' transcripts and the repo's commits into the log; false when another collect held it. */
function catchUpEventLog(repo: string, since: string): boolean {
  if (!readsRealAgentDirs()) return true;
  const collected = collectEvents();
  backfillGit([repo], loggedEventIds(), since);
  return collected !== null;
}

/** Null when the event log is off; `complete` is false when the agents' calls could not be read in first. */
export function gatherRunStats(
  window: RunWindow,
  repo: string
): (RunStats & { complete: boolean }) | null {
  if (!eventLogEnabled()) return null;
  const complete = catchUpEventLog(repo, window.startedAt);
  const events = allEventsSince(new Date(window.startedAt));
  return { ...runStats(events, window, memoized(scopeOf)), complete };
}
