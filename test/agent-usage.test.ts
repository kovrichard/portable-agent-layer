import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCodex, readCopilot, readOpencode } from "../src/tools/lib/agent-usage";

const NOW = new Date("2026-09-06T12:00:00.000Z");
const TODAY = "2026-09-06T10:00:00.000Z";
const LAST_YEAR = "2025-09-06T10:00:00.000Z";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pal-agent-usage-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function writeLines(path: string, entries: unknown[]): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, entries.map((entry) => JSON.stringify(entry)).join("\n"));
}

describe("readCodex", () => {
  const tokenCount = (timestamp: string, last: object, totalTokens: number) => ({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { last_token_usage: last, total_token_usage: { total_tokens: totalTokens } },
    },
  });

  function rollout(dir: string, sub: string, entries: unknown[]): void {
    writeLines(join(dir, sub, "2026", "09", "06", "rollout-a.jsonl"), entries);
  }

  const session = [
    { type: "session_meta", payload: { cwd: "/work/portable-agent-layer" } },
    { type: "turn_context", payload: { model: "gpt-5.5" } },
    tokenCount(
      TODAY,
      {
        input_tokens: 1000,
        cached_input_tokens: 600,
        output_tokens: 50,
        total_tokens: 1050,
      },
      1050
    ),
    tokenCount(
      TODAY,
      {
        input_tokens: 1000,
        cached_input_tokens: 600,
        output_tokens: 50,
        total_tokens: 1050,
      },
      1050
    ),
  ];

  test("splits cached input out of input, and counts a repeated event once", () => {
    const dir = tempDir();
    rollout(dir, "sessions", session);
    const usage = readCodex(dir, undefined, NOW);
    expect(usage.buckets.today).toMatchObject({
      input: 400,
      cacheRead: 600,
      output: 50,
      calls: 1,
      unpriced: 1,
      cost: 0,
    });
  });

  test("files the call under its model and the folder it ran in", () => {
    const dir = tempDir();
    rollout(dir, "sessions", session);
    const usage = readCodex(dir, undefined, NOW);
    expect(Object.keys(usage.byModel)).toEqual(["gpt-5.5"]);
    expect(Object.keys(usage.byProject)).toEqual(["portable-agent-layer"]);
  });

  test("reads archived sessions too", () => {
    const dir = tempDir();
    rollout(dir, "archived_sessions", session);
    expect(readCodex(dir, undefined, NOW).buckets.total.calls).toBe(1);
  });

  test("keeps only the sessions of the project asked for", () => {
    const dir = tempDir();
    rollout(dir, "sessions", session);
    expect(readCodex(dir, "letterbox", NOW).buckets.total.calls).toBe(0);
    expect(readCodex(dir, "agent-layer", NOW).buckets.total.calls).toBe(1);
  });

  test("reads nothing from a missing directory", () => {
    expect(readCodex(join(tempDir(), "absent"), undefined, NOW).buckets.total.calls).toBe(
      0
    );
  });
});

describe("readOpencode", () => {
  function database(messages: { created: string; data: object }[]): string {
    const path = join(tempDir(), "opencode.db");
    const db = new Database(path);
    db.run("CREATE TABLE message (id TEXT, time_created INTEGER, data TEXT)");
    const insert = db.prepare("INSERT INTO message VALUES (?, ?, ?)");
    messages.forEach(({ created, data }, i) => {
      insert.run(String(i), new Date(created).getTime(), JSON.stringify(data));
    });
    db.close();
    return path;
  }

  const assistant = (tokens: object, cost?: number) => ({
    role: "assistant",
    modelID: "kimi-k3",
    path: { root: "/work/letterbox" },
    tokens,
    ...(cost === undefined ? {} : { cost }),
  });

  test("folds reasoning into output and takes the cost opencode recorded", () => {
    const path = database([
      {
        created: TODAY,
        data: assistant(
          { input: 100, output: 20, reasoning: 5, cache: { read: 300, write: 40 } },
          0.25
        ),
      },
    ]);
    expect(readOpencode(path, undefined, NOW).buckets.today).toMatchObject({
      input: 100,
      output: 25,
      cacheRead: 300,
      cacheWrite5m: 40,
      cost: 0.25,
      calls: 1,
      unpriced: 0,
    });
  });

  test("counts a message without a recorded cost as unpriced", () => {
    const path = database([{ created: TODAY, data: assistant({ input: 10 }) }]);
    expect(readOpencode(path, undefined, NOW).buckets.today.unpriced).toBe(1);
  });

  test("skips messages that are not the assistant's, and ones that spent nothing", () => {
    const path = database([
      { created: TODAY, data: { role: "user", tokens: { input: 10 } } },
      { created: TODAY, data: assistant({ input: 0, output: 0 }) },
    ]);
    expect(readOpencode(path, undefined, NOW).buckets.total.calls).toBe(0);
  });

  test("places a message by when it was created", () => {
    const path = database([{ created: LAST_YEAR, data: assistant({ input: 10 }) }]);
    const usage = readOpencode(path, undefined, NOW);
    expect(usage.buckets.month.calls).toBe(0);
    expect(usage.buckets.total.calls).toBe(1);
    expect(Object.keys(usage.byProject)).toEqual(["letterbox"]);
  });

  test("reads nothing from a missing database, or one it cannot query", () => {
    const dir = tempDir();
    expect(readOpencode(join(dir, "absent.db"), undefined, NOW).buckets.total.calls).toBe(
      0
    );
    const notADatabase = join(dir, "broken.db");
    writeFileSync(notADatabase, "not sqlite");
    expect(readOpencode(notADatabase, undefined, NOW).buckets.total.calls).toBe(0);
  });
});

describe("readCopilot", () => {
  const shutdown = (timestamp: string, inputTokens: number, count: number) => ({
    type: "session.shutdown",
    timestamp,
    data: {
      modelMetrics: {
        "claude-sonnet-5": {
          requests: { count },
          usage: {
            inputTokens,
            outputTokens: 10,
            cacheReadTokens: 30,
            cacheWriteTokens: 5,
          },
        },
      },
    },
  });

  function session(dir: string, id: string, events: unknown[]): void {
    writeLines(join(dir, "session-state", id, "events.jsonl"), events);
  }

  test("adds up the shutdown of every run of a resumed session", () => {
    const dir = tempDir();
    session(dir, "a", [
      { type: "session.start", data: { context: { cwd: "/work/klint" } } },
      shutdown(TODAY, 100, 3),
      { type: "session.resume", data: {} },
      shutdown(TODAY, 100, 2),
    ]);
    const usage = readCopilot(dir, undefined, NOW);
    expect(usage.buckets.today).toMatchObject({
      input: 140,
      cacheRead: 60,
      output: 20,
      cacheWrite5m: 10,
      calls: 5,
      unpriced: 5,
    });
    expect(Object.keys(usage.byProject)).toEqual(["klint"]);
  });

  test("reads every session, and nothing from a missing directory", () => {
    const dir = tempDir();
    session(dir, "a", [shutdown(TODAY, 100, 1)]);
    session(dir, "b", [shutdown(TODAY, 100, 1)]);
    expect(readCopilot(dir, undefined, NOW).buckets.total.calls).toBe(2);
    expect(readCopilot(join(dir, "absent"), undefined, NOW).buckets.total.calls).toBe(0);
  });
});
