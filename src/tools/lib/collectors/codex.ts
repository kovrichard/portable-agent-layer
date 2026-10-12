/**
 * Codex's model calls, read off its rollout files into the event log. Codex
 * repeats a token_count without a new call, and its running total only grows,
 * so the total is both the dedupe and the cursor.
 */

import { readFileSync, statSync } from "node:fs";
import { relative, sep } from "node:path";
import { appendEvent } from "../../../hooks/lib/events";
import { codexRollouts } from "../agent-usage";
import { readCursor, writeCursor } from "./cursors";

interface CodexUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface RolloutLine {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    id?: string;
    session_id?: string;
    cwd?: string;
    model?: string;
    effort?: string;
    model_provider?: string;
    info?: { last_token_usage?: CodexUsage; total_token_usage?: CodexUsage } | null;
  };
}

interface RolloutContext {
  session?: string;
  cwd?: string;
  model?: string;
  effort?: string;
  provider?: string;
}

interface CodexCall {
  ts: string;
  total: number;
  usage: CodexUsage;
  context: RolloutContext;
}

function rolloutLines(filepath: string): RolloutLine[] {
  return readFileSync(filepath, "utf-8")
    .split("\n")
    .flatMap((text) => {
      try {
        return [JSON.parse(text) as RolloutLine];
      } catch {
        return [];
      }
    });
}

function withContext(context: RolloutContext, line: RolloutLine): RolloutContext {
  const payload = line.payload ?? {};
  if (line.type === "session_meta")
    return {
      ...context,
      session: payload.session_id ?? payload.id,
      cwd: payload.cwd,
      provider: payload.model_provider,
    };
  if (line.type === "turn_context")
    return { ...context, model: payload.model, effort: payload.effort };
  return context;
}

function callsOf(filepath: string): CodexCall[] {
  const calls: CodexCall[] = [];
  let context: RolloutContext = {};
  let lastTotal = -1;
  for (const line of rolloutLines(filepath)) {
    context = withContext(context, line);
    const info = line.payload?.type === "token_count" ? line.payload.info : null;
    const total = info?.total_token_usage?.total_tokens ?? -1;
    if (!info?.last_token_usage || !line.timestamp || total === lastTotal) continue;
    lastTotal = total;
    calls.push({ ts: line.timestamp, total, usage: info.last_token_usage, context });
  }
  return calls;
}

function emitModelCall({ ts, usage, context }: CodexCall): void {
  const cacheRead = usage.cached_input_tokens ?? 0;
  const cacheWrite = usage.cache_write_input_tokens ?? 0;
  appendEvent(
    "model_call",
    {
      model: context.model,
      provider: context.provider,
      inputTokens: (usage.input_tokens ?? 0) - cacheRead - cacheWrite,
      outputTokens: usage.output_tokens,
      thinkingTokens: usage.reasoning_output_tokens,
      cacheWrite5m: cacheWrite,
      cacheRead,
      effort: context.effort,
    },
    { ts, session: context.session ?? null, runtime: "codex", cwd: context.cwd ?? "" }
  );
}

export function collectCodex(codexDir: string): number {
  const cursor = readCursor("codex");
  let emitted = 0;
  for (const filepath of codexRollouts(codexDir)) {
    const key = relative(codexDir, filepath).split(sep).join("/");
    const size = statSync(filepath).size;
    if (cursor[`${key}@size`] === size) continue;
    const collectedTotal = Number(cursor[key] ?? -1);
    for (const call of callsOf(filepath)) {
      if (call.total <= collectedTotal) continue;
      emitModelCall(call);
      emitted++;
      cursor[key] = call.total;
    }
    cursor[`${key}@size`] = size;
    writeCursor("codex", cursor);
  }
  return emitted;
}
