/**
 * opencode's model calls, read off its message table into the event log. A
 * message is written while it streams, so one not yet completed stops the
 * read until it is, or until it is old enough to have been abandoned.
 */

import { existsSync } from "node:fs";
import { appendEvent } from "../../../hooks/lib/events";
import { readCursor, writeCursor } from "./cursors";
import { type AllowList, selectAllowed } from "./sqlite";

const ABANDONED_MS = 60 * 60_000;
const MESSAGE_COLUMNS = ["id", "session_id", "time_created", "data"] as const;

export const OPENCODE_ALLOW_LIST = { message: MESSAGE_COLUMNS } satisfies AllowList;

interface MessageRow {
  id: string;
  session_id: string;
  time_created: number;
  data: string;
}

interface AssistantMessage {
  role?: string;
  modelID?: string;
  providerID?: string;
  cost?: number;
  mode?: string;
  agent?: string;
  finish?: string;
  path?: { cwd?: string };
  time?: { created?: number; completed?: number };
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
}

function assistantMessageOf(row: MessageRow): AssistantMessage | null {
  try {
    const message = JSON.parse(row.data) as AssistantMessage;
    return message.role === "assistant" ? message : null;
  } catch {
    return null;
  }
}

function stillStreaming(message: AssistantMessage, row: MessageRow, now: Date): boolean {
  return !message.time?.completed && now.getTime() - row.time_created < ABANDONED_MS;
}

function durationOf(message: AssistantMessage): number | undefined {
  const { created, completed } = message.time ?? {};
  return created && completed ? completed - created : undefined;
}

function emitModelCall(row: MessageRow, message: AssistantMessage): void {
  const tokens = message.tokens ?? {};
  appendEvent(
    "model_call",
    {
      model: message.modelID,
      provider: message.providerID,
      inputTokens: tokens.input,
      outputTokens: (tokens.output ?? 0) + (tokens.reasoning ?? 0),
      thinkingTokens: tokens.reasoning,
      cacheWrite5m: tokens.cache?.write,
      cacheRead: tokens.cache?.read,
      costUsd: message.cost,
      agent: message.agent,
      mode: message.mode,
      stopReason: message.finish,
      durationMs: durationOf(message),
    },
    {
      ts: new Date(row.time_created).toISOString(),
      session: row.session_id,
      runtime: "opencode",
      cwd: message.path?.cwd ?? "",
    }
  );
}

export function collectOpencode(dbPath: string, now: Date = new Date()): number {
  if (!existsSync(dbPath)) return 0;
  const cursor = readCursor("opencode");
  const rows = selectAllowed<MessageRow>(
    dbPath,
    OPENCODE_ALLOW_LIST,
    "message",
    MESSAGE_COLUMNS,
    {
      orderColumn: "time_created",
      idColumn: "id",
      order: Number(cursor.order ?? 0),
      id: String(cursor.id ?? ""),
    }
  );
  let emitted = 0;
  for (const row of rows) {
    const message = assistantMessageOf(row);
    if (message && stillStreaming(message, row, now)) break;
    if (message) {
      emitModelCall(row, message);
      emitted++;
    }
    cursor.order = row.time_created;
    cursor.id = row.id;
  }
  writeCursor("opencode", cursor);
  return emitted;
}
