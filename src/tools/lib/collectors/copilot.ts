/**
 * Copilot's model calls, read off its session store into the event log. A row
 * is written once the call has finished, so its id is the cursor. Copilot
 * counts cache reads inside input_tokens and reasoning inside output_tokens.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { appendEvent } from "../../../hooks/lib/events";
import { readCursor, writeCursor } from "./cursors";
import { type AllowList, selectAllowed } from "./sqlite";

const NANO = 1_000_000_000;
const USAGE_COLUMNS = [
  "id",
  "session_id",
  "agent_id",
  "model",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "reasoning_tokens",
  "total_nano_aiu",
  "duration_ms",
  "time_to_first_token_ms",
  "initiator",
  "reasoning_effort",
  "finish_reason",
  "created_at",
] as const;
const SESSION_COLUMNS = ["id", "cwd", "host_type", "created_at"] as const;

export const COPILOT_ALLOW_LIST = {
  assistant_usage_events: USAGE_COLUMNS,
  sessions: SESSION_COLUMNS,
} satisfies AllowList;

type UsageRow = Record<(typeof USAGE_COLUMNS)[number], string | number | null>;

interface SessionRow {
  id: string;
  cwd: string | null;
  host_type: string | null;
}

export function copilotDatabase(copilotDir: string): string {
  return resolve(copilotDir, "session-store.db");
}

function sessionsOf(dbPath: string): Map<string, SessionRow> {
  const rows = selectAllowed<SessionRow>(
    dbPath,
    COPILOT_ALLOW_LIST,
    "sessions",
    SESSION_COLUMNS,
    { orderColumn: "created_at", idColumn: "id", order: "", id: "" }
  );
  return new Map(rows.map((row) => [row.id, row]));
}

const num = (value: unknown) => (typeof value === "number" ? value : 0);

function emitModelCall(row: UsageRow, session: SessionRow | undefined): void {
  const cacheRead = num(row.cache_read_tokens);
  appendEvent(
    "model_call",
    {
      model: row.model,
      inputTokens: num(row.input_tokens) - cacheRead,
      outputTokens: row.output_tokens,
      thinkingTokens: row.reasoning_tokens,
      cacheWrite5m: row.cache_write_tokens,
      cacheRead,
      aiu: num(row.total_nano_aiu) / NANO,
      durationMs: row.duration_ms,
      ttftMs:
        typeof row.time_to_first_token_ms === "number"
          ? Math.round(row.time_to_first_token_ms)
          : undefined,
      initiator: row.initiator,
      effort: row.reasoning_effort,
      stopReason: row.finish_reason,
      sidechain: row.agent_id !== null,
      host: session?.host_type ?? "local",
    },
    {
      ts: String(row.created_at),
      session: String(row.session_id),
      runtime: "copilot",
      cwd: session?.cwd ?? "",
    }
  );
}

export function collectCopilot(dbPath: string): number {
  if (!existsSync(dbPath)) return 0;
  const cursor = readCursor("copilot");
  const lastId = Number(cursor.usageId ?? 0);
  const rows = selectAllowed<UsageRow>(
    dbPath,
    COPILOT_ALLOW_LIST,
    "assistant_usage_events",
    USAGE_COLUMNS,
    { orderColumn: "id", idColumn: "id", order: lastId, id: lastId }
  );
  if (rows.length === 0) return 0;
  const sessions = sessionsOf(dbPath);
  for (const row of rows) emitModelCall(row, sessions.get(String(row.session_id)));
  cursor.usageId = num(rows.at(-1)?.id);
  writeCursor("copilot", cursor);
  return rows.length;
}
