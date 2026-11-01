/**
 * What an unattended run was estimated to take next to what it took, one JSON
 * line per run, kept after the run file is gone so later estimates can learn
 * from it.
 */

import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";
import type { Run } from "./run-mode";

const MINUTE_MS = 60_000;

export interface RunEstimateRecord {
  kind: Run["kind"];
  scope: string;
  startedAt: string;
  until: string;
  estimateMinutes: number | null;
  finished: boolean;
  finishedAt: string | null;
  actualMinutes: number | null;
  tasks: string[];
  fallbacks: string[];
  logEntries: number;
  stopBlocks: number;
  stats: object | null;
}

export function runEstimatesFile(): string {
  return resolve(paths.learning(), "run-estimates.jsonl");
}

function minutesBetween(from: string, to: Date): number {
  return Math.round((to.getTime() - Date.parse(from)) / MINUTE_MS);
}

export function runEstimateRecord(
  run: Run,
  finishedAt: Date | null,
  stats: object | null = null
): RunEstimateRecord {
  return {
    kind: run.kind,
    scope: run.scope,
    startedAt: run.startedAt,
    until: run.until,
    estimateMinutes: run.estimateMinutes ?? null,
    finished: finishedAt !== null,
    finishedAt: finishedAt?.toISOString() ?? null,
    actualMinutes: finishedAt ? minutesBetween(run.startedAt, finishedAt) : null,
    tasks: run.tasks,
    fallbacks: run.fallbacks,
    logEntries: run.log.length,
    stopBlocks: run.stopBlocks,
    stats,
  };
}

/** `finishedAt` is null for a run ended before it was marked done. */
export function recordRunEstimate(
  run: Run,
  finishedAt: Date | null,
  stats: object | null = null
): void {
  appendFileSync(
    runEstimatesFile(),
    `${JSON.stringify(runEstimateRecord(run, finishedAt, stats))}\n`
  );
}
