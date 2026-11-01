/**
 * A run with a deadline, kept per scope (a registered project, or the folder).
 * A timebox ends work at the deadline; an unattended run also means nobody is
 * there to answer until then. The hooks read this file; `pal cli timebox` and
 * `pal cli unattended` write it.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, paths } from "./paths";
import { localHourMinute, localMinuteOfDay } from "./wall-clock";

export type RunKind = "timebox" | "unattended";

interface RunLogEntry {
  at: string;
  entry: string;
}

export interface Run {
  kind: RunKind;
  scope: string;
  startedAt: string;
  until: string;
  task: string | null;
  report: string | null;
  tasks: string[];
  fallbacks: string[];
  rules: string[];
  log: RunLogEntry[];
  done: boolean;
  stopBlocks: number;
  estimateMinutes?: number | null;
}

const MINUTE_MS = 60_000;
const DAY_MINUTES = 1440;
const FORGOTTEN_AFTER_MS = 12 * 60 * MINUTE_MS;

export const DEFAULT_UNATTENDED_RULES = [
  "Nobody can answer until the deadline: never ask. Decide, log the decision and why with `pal cli unattended log`, and list open questions in the report.",
  "Before listing a question, search the project's notes and earlier sessions for an answer.",
  "Do only the approved tasks, then the fallbacks. Anything else goes in the report as a suggestion.",
  "Never delete, push, deploy or publish anything other than the report.",
  "One heavy process at a time. No subagents or workflows.",
  "Verify each step as you would with the user present, and log it when it lands.",
];

export const GIT_RULE =
  "Work on a branch, one logical step per commit, staging only your own changes. Never push.";

/** The default rules, plus the commit rule when the work happens in a git repository. */
export function unattendedRules(inGitRepo: boolean, extra: string[] = []): string[] {
  return [...DEFAULT_UNATTENDED_RULES, ...(inGitRepo ? [GIT_RULE] : []), ...extra];
}

function runDir(): string {
  return ensureDir(resolve(paths.state(), "run-mode"));
}

function runFile(scope: string): string {
  const key = createHash("sha1").update(scope).digest("hex").slice(0, 16);
  return resolve(runDir(), `${key}.json`);
}

function parseRun(file: string): Run | null {
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as Run;
  } catch {
    return null;
  }
}

function isForgotten(run: Run, now: Date): boolean {
  return now.getTime() - Date.parse(run.until) > FORGOTTEN_AFTER_MS;
}

/** The scope's run, or null when there is none or it ended long enough ago to be forgotten. */
export function readRun(scope: string, now: Date = new Date()): Run | null {
  const file = runFile(scope);
  if (!existsSync(file)) return null;
  const run = parseRun(file);
  return run && !isForgotten(run, now) ? run : null;
}

export function writeRun(run: Run): void {
  writeFileSync(runFile(run.scope), `${JSON.stringify(run, null, 2)}\n`);
}

export function clearRun(scope: string): boolean {
  const file = runFile(scope);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

export function isOver(run: Run, now: Date = new Date()): boolean {
  return now.getTime() >= Date.parse(run.until);
}

function parseDuration(text: string): number | null {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text.trim());
  if (!m) return null;
  const [, h = "0", min = "0", s = "0"] = m;
  const ms = (Number(h) * 3600 + Number(min) * 60 + Number(s)) * 1000;
  return ms > 0 ? ms : null;
}

/** `30m`, `2h` or `1h30m` as whole minutes, at least one. */
export function estimateMinutesFrom(text: string): number {
  const ms = parseDuration(text);
  if (ms === null) throw new Error(`Not a duration: "${text}". Use 15m, 2h or 1h30m.`);
  return Math.max(1, Math.round(ms / MINUTE_MS));
}

function nextLocalTime(text: string, now: Date): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [hour, minute] = [Number(m[1]), Number(m[2])];
  if (hour > 23 || minute > 59) return null;
  const target = hour * 60 + minute;
  const ahead =
    (target - localMinuteOfDay(now) + DAY_MINUTES) % DAY_MINUTES || DAY_MINUTES;
  const minuteStart = now.getTime() - (now.getTime() % MINUTE_MS);
  return new Date(minuteStart + ahead * MINUTE_MS);
}

/** `--for 15m` / `1h30m`, or `--until 18:00` (the next such local time) or an ISO time. */
export function deadlineFrom(
  spec: { for?: string; until?: string },
  now: Date = new Date()
): Date {
  if (spec.for !== undefined) {
    const ms = parseDuration(spec.for);
    if (ms === null)
      throw new Error(`Not a duration: "${spec.for}". Use 15m, 2h or 1h30m.`);
    return new Date(now.getTime() + ms);
  }
  if (spec.until !== undefined) {
    const at = nextLocalTime(spec.until, now) ?? new Date(spec.until);
    if (Number.isNaN(at.getTime()) || at <= now)
      throw new Error(`Not a future time: "${spec.until}". Use HH:MM or an ISO time.`);
    return at;
  }
  throw new Error("Give --for <duration> or --until <HH:MM>.");
}

export function newRun(fields: {
  kind: RunKind;
  scope: string;
  until: Date;
  now?: Date;
  task?: string | null;
  report?: string | null;
  tasks?: string[];
  fallbacks?: string[];
  rules?: string[];
  estimateMinutes?: number | null;
}): Run {
  return {
    ...(fields.estimateMinutes ? { estimateMinutes: fields.estimateMinutes } : {}),
    kind: fields.kind,
    scope: fields.scope,
    startedAt: (fields.now ?? new Date()).toISOString(),
    until: fields.until.toISOString(),
    task: fields.task ?? null,
    report: fields.report ?? null,
    tasks: fields.tasks ?? [],
    fallbacks: fields.fallbacks ?? [],
    rules: fields.rules ?? [],
    log: [],
    done: false,
    stopBlocks: 0,
  };
}

export function untilLabel(run: Run): string {
  return localHourMinute(new Date(run.until));
}

export function minutesLeft(run: Run, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((Date.parse(run.until) - now.getTime()) / MINUTE_MS));
}

function numbered(items: string[]): string[] {
  return items.map((item, i) => `  ${i + 1}. ${item}`);
}

function logLines(run: Run): string[] {
  return run.log.map((l) => `  - ${localHourMinute(new Date(l.at))} ${l.entry}`);
}

function timeLine(run: Run, now: Date): string {
  const name = run.kind === "unattended" ? "Unattended" : "Time box";
  return isOver(run, now)
    ? `${name} ended at ${untilLabel(run)}.`
    : `${name} until ${untilLabel(run)} (${minutesLeft(run, now)} min left).`;
}

/** The whole run as text: what `status` prints and what compaction recovery injects. */
export function describeRun(run: Run, now: Date = new Date()): string {
  const lines = [timeLine(run, now)];
  if (run.task) lines.push(`Task: ${run.task}`);
  if (run.estimateMinutes) lines.push(`Estimated: ${run.estimateMinutes} min`);
  if (run.report) lines.push(`Report: ${run.report}`);
  if (run.rules.length) lines.push("Rules:", ...numbered(run.rules));
  if (run.tasks.length) lines.push("Tasks, in order:", ...numbered(run.tasks));
  if (run.fallbacks.length) lines.push("Fallbacks:", ...numbered(run.fallbacks));
  if (run.log.length) lines.push("Log:", ...logLines(run));
  if (run.done) lines.push("Marked done.");
  return lines.join("\n");
}
