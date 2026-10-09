/**
 * Token usage of the agents other than Claude Code, read off what each one
 * keeps on disk. None of them is billed per token at a price PAL knows, except
 * opencode, which records its own cost per message.
 */

import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  type AgentUsage,
  type Tokens,
  type UsageTally,
  usageTally,
} from "./usage-buckets";

function linesOf(filepath: string): string[] {
  try {
    return readFileSync(filepath, "utf-8").split("\n");
  } catch {
    return [];
  }
}

function parsed<T>(line: string): T | null {
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

function filesUnder(dir: string, matches: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf-8" })
    .filter((path) => matches(basename(path)))
    .map((path) => resolve(dir, path));
}

const projectOf = (cwd: string | undefined) => (cwd && basename(cwd)) || "unknown";

interface CodexTokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

interface CodexLine {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    cwd?: string;
    model?: string;
    info?: {
      total_token_usage?: CodexTokenUsage;
      last_token_usage?: CodexTokenUsage;
    } | null;
  };
}

/** Codex counts cached input inside input_tokens, and reasoning inside output_tokens. */
function codexTokens(usage: CodexTokenUsage): Tokens {
  const cached = usage.cached_input_tokens ?? 0;
  return {
    input: (usage.input_tokens ?? 0) - cached,
    output: usage.output_tokens ?? 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: cached,
  };
}

const CODEX_KEYS = ['"session_meta"', '"turn_context"', '"token_count"'];

/** Codex repeats a token_count event without a new call; the running total tells them apart. */
function recordCodexRollout(filepath: string, tally: UsageTally): void {
  let project = "unknown";
  let model = "unknown";
  let lastTotal = -1;
  for (const line of linesOf(filepath)) {
    if (!CODEX_KEYS.some((key) => line.includes(key))) continue;
    const entry = parsed<CodexLine>(line);
    const payload = entry?.payload;
    if (!entry || !payload) continue;
    if (entry.type === "session_meta") project = projectOf(payload.cwd);
    if (entry.type === "turn_context" && payload.model) model = payload.model;
    const info = payload.type === "token_count" ? payload.info : null;
    const last = info?.last_token_usage;
    const total = info?.total_token_usage?.total_tokens ?? -1;
    if (!last || !entry.timestamp || total === lastTotal) continue;
    lastTotal = total;
    tally.record({
      ts: entry.timestamp,
      model,
      project,
      tokens: codexTokens(last),
      cost: null,
    });
  }
}

export function readCodex(
  codexDir: string,
  projectFilter?: string,
  now: Date = new Date()
): AgentUsage {
  const tally = usageTally(projectFilter, now);
  const isRollout = (name: string) =>
    name.startsWith("rollout-") && name.endsWith(".jsonl");
  for (const sub of ["sessions", "archived_sessions"]) {
    for (const filepath of filesUnder(resolve(codexDir, sub), isRollout)) {
      recordCodexRollout(filepath, tally);
    }
  }
  return tally.usage;
}

interface OpencodeMessage {
  role?: string;
  modelID?: string;
  cost?: number;
  path?: { root?: string };
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
}

/** opencode keeps reasoning apart from output, and writes its cache without a TTL. */
function opencodeTokens(message: OpencodeMessage): Tokens {
  const t = message.tokens ?? {};
  return {
    input: t.input ?? 0,
    output: (t.output ?? 0) + (t.reasoning ?? 0),
    cacheWrite5m: t.cache?.write ?? 0,
    cacheWrite1h: 0,
    cacheRead: t.cache?.read ?? 0,
  };
}

const anyTokens = (tokens: Tokens) => Object.values(tokens).some((n) => n > 0);

interface OpencodeRow {
  time_created: number;
  data: string;
}

function opencodeAssistantRows(dbPath: string): OpencodeRow[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .query<OpencodeRow, []>(
        "SELECT time_created, data FROM message WHERE json_extract(data, '$.role') = 'assistant'"
      )
      .all();
  } finally {
    db.close();
  }
}

export function readOpencode(
  dbPath: string,
  projectFilter?: string,
  now: Date = new Date()
): AgentUsage {
  const tally = usageTally(projectFilter, now);
  if (!existsSync(dbPath)) return tally.usage;
  let rows: OpencodeRow[];
  try {
    rows = opencodeAssistantRows(dbPath);
  } catch {
    return tally.usage;
  }
  for (const row of rows) {
    const message = parsed<OpencodeMessage>(row.data);
    if (!message) continue;
    const tokens = opencodeTokens(message);
    if (!anyTokens(tokens)) continue;
    tally.record({
      ts: new Date(row.time_created).toISOString(),
      model: message.modelID ?? "unknown",
      project: projectOf(message.path?.root),
      tokens,
      cost: typeof message.cost === "number" ? message.cost : null,
    });
  }
  return tally.usage;
}

interface CopilotModelMetrics {
  requests?: { count?: number };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

interface CopilotEvent {
  type?: string;
  timestamp?: string;
  data?: {
    context?: { cwd?: string };
    modelMetrics?: Record<string, CopilotModelMetrics>;
  };
}

/** Copilot counts cache reads inside inputTokens. */
function copilotTokens(usage: CopilotModelMetrics["usage"] = {}): Tokens {
  const cacheRead = usage.cacheReadTokens ?? 0;
  return {
    input: (usage.inputTokens ?? 0) - cacheRead,
    output: usage.outputTokens ?? 0,
    cacheWrite5m: usage.cacheWriteTokens ?? 0,
    cacheWrite1h: 0,
    cacheRead,
  };
}

/** Each shutdown carries the totals of its own run, so a resumed session adds, not repeats. */
function recordCopilotSession(filepath: string, tally: UsageTally): void {
  let project = "unknown";
  for (const line of linesOf(filepath)) {
    if (!line.includes('"session.')) continue;
    const event = parsed<CopilotEvent>(line);
    if (!event?.data) continue;
    if (event.data.context?.cwd) project = projectOf(event.data.context.cwd);
    if (event.type !== "session.shutdown" || !event.timestamp) continue;
    for (const [model, metrics] of Object.entries(event.data.modelMetrics ?? {})) {
      tally.record({
        ts: event.timestamp,
        model,
        project,
        tokens: copilotTokens(metrics.usage),
        cost: null,
        calls: metrics.requests?.count ?? 1,
      });
    }
  }
}

export function readCopilot(
  copilotDir: string,
  projectFilter?: string,
  now: Date = new Date()
): AgentUsage {
  const tally = usageTally(projectFilter, now);
  const sessionsDir = resolve(copilotDir, "session-state");
  if (!existsSync(sessionsDir)) return tally.usage;
  for (const session of readdirSync(sessionsDir)) {
    recordCopilotSession(resolve(sessionsDir, session, "events.jsonl"), tally);
  }
  return tally.usage;
}
