import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reload } from "../src/hooks/lib/settings";
import { COPILOT_ALLOW_LIST, collectCopilot } from "../src/tools/lib/collectors/copilot";
import { assertNoCredentials } from "../src/tools/lib/collectors/sqlite";
import { freshTestDir } from "./lib/test-home";

// Columns from a real session-store.db; Copilot counts cache reads inside
// input_tokens and reasoning inside output_tokens (checked against the
// row's own token_details_json).

let home: string;
let dbPath: string;

function streamed(): Record<string, unknown>[] {
  const dir = resolve(home, "memory", "events");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) => readFileSync(resolve(dir, f), "utf-8").trim().split("\n"))
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === "model_call");
}

function fixtureDb(): Database {
  const db = new Database(dbPath, { create: true });
  db.run(
    "CREATE TABLE assistant_usage_events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, turn_index INTEGER, agent_id TEXT, parent_tool_call_id TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER, total_nano_aiu INTEGER, request_multiplier REAL, duration_ms INTEGER, time_to_first_token_ms INTEGER, initiator TEXT, api_endpoint TEXT, reasoning_effort TEXT, finish_reason TEXT, token_details_json TEXT, created_at TEXT)"
  );
  db.run(
    "CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, host_type TEXT, branch TEXT, summary TEXT, created_at TEXT, updated_at TEXT)"
  );
  db.run(
    "INSERT INTO sessions (id, cwd, host_type, summary, created_at) VALUES ('ses_local', '/work/repo', NULL, 'a summary', '2026-10-12T09:00:00.000Z'), ('ses_cloud', '/runner/repo', 'github', NULL, '2026-10-12T09:00:00.000Z')"
  );
  return db;
}

function usage(
  db: Database,
  session: string,
  output: number,
  agentId: string | null = null
) {
  db.run(
    "INSERT INTO assistant_usage_events (session_id, agent_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, total_nano_aiu, duration_ms, time_to_first_token_ms, initiator, reasoning_effort, finish_reason, created_at) VALUES (?1, ?2, 'claude-haiku-4.5', 18017, ?3, 5632, 0, 64, 434100000, 35494, 7776.07, 'user', 'medium', 'stop', '2026-10-12T10:00:00.000Z')",
    [session, agentId, output]
  );
}

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "claude";
  mkdirSync(resolve(home, "memory"), { recursive: true });
  dbPath = resolve(home, "session-store.db");
  reload();
});

describe("collecting Copilot's model calls", () => {
  test("a usage row is one model_call, with its session's directory and host", () => {
    const db = fixtureDb();
    usage(db, "ses_local", 99);
    db.close();
    expect(collectCopilot(dbPath)).toBe(1);
    expect(streamed()[0]).toMatchObject({
      ts: "2026-10-12T10:00:00.000Z",
      session: "ses_local",
      runtime: "copilot",
      cwd: "/work/repo",
      model: "claude-haiku-4.5",
      inputTokens: 12385,
      outputTokens: 99,
      thinkingTokens: 64,
      cacheWrite5m: 0,
      cacheRead: 5632,
      aiu: 0.4341,
      durationMs: 35494,
      ttftMs: 7776,
      initiator: "user",
      effort: "medium",
      stopReason: "stop",
      sidechain: false,
      host: "local",
    });
  });

  test("a cloud session and a subagent call are told apart", () => {
    const db = fixtureDb();
    usage(db, "ses_cloud", 1, "agent-7");
    db.close();
    collectCopilot(dbPath);
    expect(streamed()[0]).toMatchObject({ host: "github", sidechain: true });
  });

  test("a second run emits nothing the first one did", () => {
    const db = fixtureDb();
    usage(db, "ses_local", 1);
    usage(db, "ses_local", 2);
    collectCopilot(dbPath);
    usage(db, "ses_local", 3);
    db.close();
    expect(collectCopilot(dbPath)).toBe(1);
    expect(collectCopilot(dbPath)).toBe(0);
    expect(streamed().map((e) => e.outputTokens)).toEqual([1, 2, 3]);
  });

  test("no session store, nothing collected", () => {
    expect(collectCopilot(resolve(home, "missing.db"))).toBe(0);
  });

  test("the allow-list names no credential, and widening it is refused", () => {
    expect(() => assertNoCredentials(COPILOT_ALLOW_LIST)).not.toThrow();
    expect(() =>
      assertNoCredentials({ ...COPILOT_ALLOW_LIST, sessions: ["id", "access_token"] })
    ).toThrow(/never read/);
  });
});
