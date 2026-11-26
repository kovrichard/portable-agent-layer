/**
 * The local event log: one append-only metadata stream every pattern, report
 * and dashboard is derived from. Events hold counts, durations, ids and enums;
 * any text goes to the content store, which never leaves the machine.
 */

import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { currentAttribution, type RecordAttribution } from "../core/actor";
import type { AgentType } from "../core/agent";
import { logError } from "../core/log";
import { boundProjectAt } from "../core/project-bindings";
import { eventLogEnabled } from "../core/settings";
import { storeDir } from "./bronze";
import { currentChannel } from "./channel";

export const EVENT_SCHEMA_VERSION = 1;
const MAX_STRING = 64;
const MAX_ARRAY = 50;

export const USAGE_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheWrite5m",
  "cacheWrite1h",
  "cacheRead",
  "thinkingTokens",
  "costUsd",
] as const;

export const EVENT_FIELDS = {
  turn: [
    "hour",
    "weekday",
    "words",
    "gapSec",
    "afterBreak",
    "skimmed",
    "interrupted",
    "repeated",
    "corrected",
    "reply",
    "reaction",
    "reactionRules",
    "mood",
    "hinted",
    "complied",
    "language",
    "pastedChars",
    "images",
    "command",
    "backAfterSec",
  ],
  reply: ["words", "listItems", "headings", "asked", "mode", "latencySec", "turn"],
  session_start: [
    "source",
    "model",
    "effort",
    "entrypoint",
    "branch",
    "palVersion",
    "tz",
    "utcOffsetMin",
  ],
  session_end: ["reason", "durationSec", "turns", "messages", "status"],
  compaction: ["trigger", "withInstructions", "contextTokens"],
  context_injected: ["instructionsChars", "semiStaticChars", "dynamicChars"],
  hook_timing: ["hook", "totalMs", "handlers"],
  inference_call: [
    "caller",
    "route",
    "model",
    "tier",
    "web",
    "latencyMs",
    "failure",
    ...USAGE_FIELDS,
  ],
  judge_call: [
    "caller",
    "mode",
    "route",
    "provider",
    "model",
    "inputTokens",
    "costUsd",
    "latencyMs",
    "failure",
    "systemOneAnswers",
    "fallbackAnswers",
  ],
  pal_update: ["outcome", "from", "to", "durationSec", "skipReason"],
  memory_move: [
    "migration",
    "outcome",
    "entries",
    "files",
    "bytes",
    "manifest",
    "reason",
    "hashTotal",
    "archive",
    "lines",
    "kept",
    "differ",
  ],
  migration_run: [
    "migration",
    "outcome",
    "migrated",
    "skipped",
    "dryRun",
    "undo",
    "sweep",
  ],
  pal_heartbeat: ["outcome", "payload", "status", "skipReason"],
  commitment: ["iscProject", "isc", "outcome", "surface", "snoozeDays"],
  entity_first_seen: ["domain", "entityType"],
  discord_nag: ["stage", "kind", "responseSec"],
  model_call: [
    "billing",
    "plan",
    "extraUsage",
    "model",
    "requestedModel",
    "provider",
    "inputTokens",
    "outputTokens",
    "cacheWrite5m",
    "cacheWrite1h",
    "cacheRead",
    "thinkingTokens",
    "thinkingMs",
    "webSearches",
    "webFetches",
    "serviceTier",
    "speed",
    "effort",
    "stopReason",
    "entrypoint",
    "sidechain",
    "costUsd",
    "agent",
    "mode",
    "durationMs",
    "ttftMs",
    "aiu",
    "initiator",
    "host",
  ],
  conversation: ["steps", "status", "depth", "subagent", "killed"],
  commit: [
    "hash",
    "committedAt",
    "files",
    "added",
    "deleted",
    "commitType",
    "breaking",
    "revert",
    "merge",
    "tags",
    "coAuthors",
    "aiCoAuthored",
  ],
  rating: ["rating", "source"],
  forgotten: ["target", "undone"],
  project: ["change", "status"],
  decision: ["words"],
  promise: ["change", "dueInSec", "lateSec", "snoozes", "nags"],
  action: [
    "tool",
    "outcome",
    "fileExt",
    "change",
    "linesAdded",
    "linesRemoved",
    "beforeBytes",
    "afterBytes",
  ],
  permission_prompt: ["tool"],
  notification: ["kind"],
  tool_call: [
    "tool",
    "outcome",
    "denial",
    "toolUseId",
    "promptWaitSec",
    "durationMs",
    "inputChars",
    "outputChars",
    "fileExt",
    "program",
    "skill",
    "subagent",
    "subagentTokens",
    "subagentTools",
    "mcpServer",
    "host",
  ],
  slurp_check: [
    "mode",
    "predicted",
    "oom",
    "hitCount",
    "maxBytes",
    "thresholdBytes",
    "idioms",
  ],
  compaction_near: [
    "mode",
    "trigger",
    "contextTokens",
    "windowTokens",
    "windowSource",
    "compactAtTokens",
    "tokensLeft",
    "marginTokens",
    "predicted",
    "idleMinTokens",
  ],
  algorithm_run: [
    "mode",
    "change",
    "run",
    "node",
    "turn",
    "phases",
    "header",
    "headerFirst",
    "startsNew",
    "verdict",
    "source",
    "runType",
    "wouldNudge",
    "exempt",
  ],
  minimum_run: [
    "change",
    "lens",
    "blocks",
    "rounds",
    "floorMin",
    "minutesLeft",
    "bar",
    "early",
  ],
  worktree_pruned: ["branch"],
  worktree_prune_failed: ["branch"],
  git_state_injected: ["trigger", "source", "changed", "committedFiles", "chars"],
  hook_run: ["hook", "event", "part", "durationMs", "exitCode"],
  repo_state: ["head", "branch", "changed", "ahead", "behind"],
} as const satisfies Record<string, readonly string[]>;

export type EventType = keyof typeof EVENT_FIELDS;
// answers keep their probabilities: question → answer → probabilities
const NESTING_DEPTH: Partial<Record<EventType, number>> = { judge_call: 2 };
type EventValue =
  | string
  | number
  | boolean
  | null
  | EventValue[]
  | { [k: string]: EventValue };

interface EventEnvelope {
  v: number;
  id: string;
  ts: string;
  type: EventType;
  session: string | null;
  runtime: string;
  machine: string;
  actor: string;
  authority: string;
  channel: string | null;
  project: string | null;
  cwd: string;
}

export type LoggedEvent = EventEnvelope & Record<string, unknown>;

export interface AppendOptions {
  id?: string;
  ts?: string;
  session?: string | null;
  runtime?: AgentType | "git" | "unknown";
  attribution?: Partial<RecordAttribution>;
  project?: string | null;
  channel?: string | null;
  cwd?: string;
  content?: Record<string, unknown>;
}

function isEventValue(value: unknown, maxDepth: number, depth = 0): value is EventValue {
  if (value === null || typeof value === "boolean") return true;

  if (typeof value === "number") return Number.isFinite(value);

  if (typeof value === "string") return value.length <= MAX_STRING;

  if (depth > maxDepth) return false;

  if (Array.isArray(value))
    return (
      value.length <= MAX_ARRAY &&
      value.every((v) => isEventValue(v, maxDepth, depth + 1))
    );

  if (typeof value === "object")
    return Object.values(value).every((v) => isEventValue(v, maxDepth, depth + 1));

  return false;
}

export function admittedFields(
  type: EventType,
  fields: Record<string, unknown>
): Record<string, EventValue> {
  const allowed: readonly string[] = EVENT_FIELDS[type];
  const maxDepth = NESTING_DEPTH[type] ?? 1;
  const kept: Record<string, EventValue> = {};

  for (const [name, value] of Object.entries(fields)) {
    if (allowed.includes(name) && isEventValue(value, maxDepth)) kept[name] = value;
  }

  return kept;
}

const projectByCwd = new Map<string, string | null>();

function projectOf(cwd: string): string | null {
  if (!projectByCwd.has(cwd)) {
    projectByCwd.set(cwd, boundProjectAt(cwd));
  }

  return projectByCwd.get(cwd) ?? null;
}

function monthOf(ts: string): string {
  return ts.slice(0, 7);
}

const eventsDir = () => storeDir("events");

export function contentDir(): string {
  return storeDir("event-text");
}

function envelope(type: EventType, options: AppendOptions): EventEnvelope {
  const cwd = options.cwd ?? process.cwd();

  return {
    v: EVENT_SCHEMA_VERSION,
    id: options.id ?? crypto.randomUUID(),
    ts: options.ts ?? new Date().toISOString(),
    type,
    session: options.session ?? null,
    ...currentAttribution(),
    ...(options.runtime && { runtime: options.runtime }),
    ...options.attribution,
    channel: options.channel !== undefined ? options.channel : currentChannel(),
    project: projectFor(options, cwd),
    cwd,
  };
}

function projectFor(options: AppendOptions, cwd: string): string | null {
  if (options.project !== undefined) return options.project;

  return cwd ? projectOf(cwd) : null;
}

/** Appends one event and returns its id, or null when the log is off or the write failed. */
export function appendEvent(
  type: EventType,
  fields: Record<string, unknown>,
  options: AppendOptions = {}
): string | null {
  if (!eventLogEnabled()) return null;

  try {
    const head = envelope(type, options);
    const line = { ...head, ...admittedFields(type, fields) };
    appendFileSync(
      resolve(eventsDir(), `${monthOf(head.ts)}.jsonl`),
      `${JSON.stringify(line)}\n`
    );

    if (options.content) {
      const stored = { id: head.id, ts: head.ts, type, ...options.content };
      appendFileSync(
        resolve(contentDir(), `${monthOf(head.ts)}.jsonl`),
        `${JSON.stringify(stored)}\n`
      );
    }

    return head.id;
  } catch (err) {
    logError("events:append", err);

    return null;
  }
}

/** Runs a logging step so that nothing it does can fail the hook around it. */
export function logQuietly(label: string, write: () => void): void {
  try {
    write();
  } catch (err) {
    logError(`events:${label}`, err);
  }
}

export function parseLines<T = LoggedEvent>(file: string): T[] {
  if (!existsSync(file)) return [];

  return readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        return [];
      }
    });
}

/** Every id already in the log, so a source read twice appends nothing new. */
export function loggedEventIds(): Set<string> {
  const dir = eventsDir();

  return new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .flatMap((f) => parseLines(resolve(dir, f)))
      .map((e) => e.id)
  );
}

export function eventMonthFile(month: Date): string {
  return resolve(eventsDir(), `${monthOf(month.toISOString())}.jsonl`);
}

export function eventsInMonth(type: EventType, month: Date): LoggedEvent[] {
  const file = eventMonthFile(month);

  return parseLines(file).filter((e) => e.type === type);
}

export function allEventsSince(since: Date): LoggedEvent[] {
  const dir = eventsDir();
  const sinceTs = since.toISOString();
  const fromMonth = monthOf(sinceTs);

  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl") && f.slice(0, 7) >= fromMonth)
    .sort()
    .flatMap((f) => parseLines(resolve(dir, f)))
    .filter((e) => e.ts >= sinceTs);
}

export function eventsSince(type: EventType, since: Date): LoggedEvent[] {
  return allEventsSince(since).filter((e) => e.type === type);
}
