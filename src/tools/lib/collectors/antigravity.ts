/**
 * Antigravity's conversations, read off its summaries table into the event
 * log. A row is rewritten as the conversation goes on, so each change is a
 * new snapshot and the latest per session is its current state. PAL's own
 * inference spawns are left out: inference_call already records them.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvent } from "../../../hooks/lib/events";
import { readCursor, writeCursor } from "./cursors";
import { type AllowList, selectAllowed } from "./sqlite";

const PAL_INFERENCE_AGENT = "pal-inference";
const SUMMARY_COLUMNS = [
  "conversation_id",
  "step_count",
  "last_modified_time",
  "workspace_uris",
  "status",
  "agent_name",
  "parent_conversation_id",
  "nesting_depth",
  "killed",
] as const;

export const ANTIGRAVITY_ALLOW_LIST = {
  conversation_summaries: SUMMARY_COLUMNS,
} satisfies AllowList;

interface SummaryRow {
  conversation_id: string;
  step_count: number;
  last_modified_time: string;
  workspace_uris: string;
  status: string;
  agent_name: string;
  parent_conversation_id: string;
  nesting_depth: number;
  killed: number;
}

export function antigravityDatabase(antigravityCliDir: string): string {
  return resolve(antigravityCliDir, "conversation_summaries.db");
}

function isoOf(antigravityTime: string): string {
  return new Date(
    antigravityTime.replace(" ", "T").replace(/(\.\d{3})\d*/, "$1")
  ).toISOString();
}

function workspaceOf(row: SummaryRow): string {
  try {
    const [first] = JSON.parse(row.workspace_uris) as string[];
    return first?.startsWith("file://") ? fileURLToPath(first) : "";
  } catch {
    return "";
  }
}

function emitConversation(row: SummaryRow): void {
  appendEvent(
    "conversation",
    {
      steps: row.step_count,
      status: row.status.replace("CASCADE_RUN_STATUS_", "").toLowerCase(),
      depth: row.nesting_depth,
      subagent: row.parent_conversation_id !== "",
      killed: row.killed === 1,
    },
    {
      ts: isoOf(row.last_modified_time),
      session: row.conversation_id,
      runtime: "antigravity",
      cwd: workspaceOf(row),
    }
  );
}

export function collectAntigravity(dbPath: string): number {
  if (!existsSync(dbPath)) return 0;
  const cursor = readCursor("antigravity");
  const rows = selectAllowed<SummaryRow>(
    dbPath,
    ANTIGRAVITY_ALLOW_LIST,
    "conversation_summaries",
    SUMMARY_COLUMNS,
    {
      orderColumn: "last_modified_time",
      idColumn: "conversation_id",
      order: String(cursor.modified ?? ""),
      id: String(cursor.id ?? ""),
    }
  );
  const conversations = rows.filter((row) => row.agent_name !== PAL_INFERENCE_AGENT);
  for (const row of conversations) emitConversation(row);
  const last = rows.at(-1);
  if (last) {
    writeCursor("antigravity", {
      modified: last.last_modified_time,
      id: last.conversation_id,
    });
  }
  return conversations.length;
}
