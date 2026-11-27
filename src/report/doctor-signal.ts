/**
 * Every doctor run lands in bronze, and a check that keeps failing becomes a
 * shadow signal that PAL may be broken. Nothing acts on the signal yet.
 */

import { appendEvent, eventsSince, logQuietly } from "../bronze/events";

const STREAK = 3;
const STREAK_SPAN_MS = 12 * 60 * 60 * 1000;
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export interface DoctorRun {
  ts: string;
  failing: string[];
}

interface CheckResult {
  id: string;
  severity: string;
}

const idsOf = (findings: CheckResult[], severity: string) =>
  findings.filter((f) => f.severity === severity).map((f) => f.id);

function spansLongEnough(runs: DoctorRun[]): boolean {
  const first = Date.parse(runs[0].ts);
  const last = Date.parse(runs.at(-1)?.ts ?? "");

  return last - first >= STREAK_SPAN_MS;
}

/** Checks that failed on each of the last STREAK runs, reported once: on the run that completes the streak. */
export function persistentFailures(runs: DoctorRun[]): string[] {
  const streak = runs.slice(-STREAK);
  if (streak.length < STREAK || !spansLongEnough(streak)) return [];
  const before = runs.at(-STREAK - 1)?.failing ?? [];
  const latest = streak.at(-1)?.failing ?? [];

  return latest.filter(
    (id) => streak.every((run) => run.failing.includes(id)) && !before.includes(id)
  );
}

function recentRuns(now: Date): DoctorRun[] {
  return eventsSince("doctor_run", new Date(now.getTime() - LOOKBACK_MS)).map((e) => ({
    ts: e.ts,
    failing: Array.isArray(e.failing) ? (e.failing as string[]) : [],
  }));
}

export function recordDoctorRun(findings: CheckResult[], now: Date = new Date()): void {
  logQuietly("doctor_run", () => {
    appendEvent(
      "doctor_run",
      { failing: idsOf(findings, "fail"), warnings: idsOf(findings, "warn") },
      { ts: now.toISOString() }
    );

    for (const surface of persistentFailures(recentRuns(now)))
      appendEvent("pal_bug_signal", { trigger: "doctor-stays-failed", surface });
  });
}
