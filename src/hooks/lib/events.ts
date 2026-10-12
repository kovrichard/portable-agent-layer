/**
 * The local event log: one append-only metadata stream every pattern, report
 * and dashboard is derived from. Events hold counts, durations, ids and enums;
 * any text goes to the content store, which never leaves the machine.
 */

import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { currentAttribution, type RecordAttribution } from "./actor";
import type { AgentType } from "./agent";
import { logError } from "./log";
import { ensureDir, paths } from "./paths";
import { readAllProjects, resolveProjectFromCwd } from "./projects";
import { eventLogEnabled } from "./settings";

export const EVENT_SCHEMA_VERSION = 1;
const MAX_STRING = 64;
const MAX_ARRAY = 50;

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
  reply: ["words", "listItems", "headings", "asked", "mode", "latencySec"],
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
  hook_timing: ["hook", "totalMs", "handlers"],
  inference_call: [
    "caller",
    "route",
    "model",
    "tier",
    "web",
    "latencyMs",
    "failure",
    "inputTokens",
    "outputTokens",
  ],
  pal_update: ["outcome", "from", "to", "durationSec", "skipReason"],
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
  permission_prompt: ["tool"],
  notification: ["kind"],
  tool_call: [
    "tool",
    "outcome",
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
} as const satisfies Record<string, readonly string[]>;

export type EventType = keyof typeof EVENT_FIELDS;
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
  channel?: string | null;
  cwd?: string;
  content?: Record<string, unknown>;
}

function isEventValue(value: unknown, depth = 0): value is EventValue {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= MAX_STRING;
  if (depth > 1) return false;
  if (Array.isArray(value))
    return value.length <= MAX_ARRAY && value.every((v) => isEventValue(v, depth + 1));
  if (typeof value === "object")
    return Object.values(value).every((v) => isEventValue(v, depth + 1));
  return false;
}

export function admittedFields(
  type: EventType,
  fields: Record<string, unknown>
): Record<string, EventValue> {
  const allowed: readonly string[] = EVENT_FIELDS[type];
  const kept: Record<string, EventValue> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (allowed.includes(name) && isEventValue(value)) kept[name] = value;
  }
  return kept;
}

const projectByCwd = new Map<string, string | null>();

function projectOf(cwd: string): string | null {
  if (!projectByCwd.has(cwd)) {
    projectByCwd.set(cwd, resolveProjectFromCwd(cwd, readAllProjects())?.name ?? null);
  }
  return projectByCwd.get(cwd) ?? null;
}

function monthOf(ts: string): string {
  return ts.slice(0, 7);
}

function eventsDir(): string {
  return ensureDir(resolve(paths.memory(), "events"));
}

function contentDir(): string {
  return ensureDir(resolve(paths.content(), "events"));
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
    channel:
      options.channel !== undefined ? options.channel : process.env.PAL_CHANNEL || null,
    project: cwd ? projectOf(cwd) : null,
    cwd,
  };
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

function parseLines(file: string): LoggedEvent[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as LoggedEvent];
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

export function eventsInMonth(type: EventType, month: Date): LoggedEvent[] {
  const file = resolve(eventsDir(), `${monthOf(month.toISOString())}.jsonl`);
  return parseLines(file).filter((e) => e.type === type);
}

export function eventsSince(type: EventType, since: Date): LoggedEvent[] {
  const dir = eventsDir();
  const sinceTs = since.toISOString();
  const fromMonth = monthOf(sinceTs);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl") && f.slice(0, 7) >= fromMonth)
    .sort()
    .flatMap((f) => parseLines(resolve(dir, f)))
    .filter((e) => e.type === type && e.ts >= sinceTs);
}
