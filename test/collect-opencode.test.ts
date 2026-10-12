import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reload } from "../src/hooks/lib/settings";
import {
  collectOpencode,
  OPENCODE_ALLOW_LIST,
} from "../src/tools/lib/collectors/opencode";
import { assertNoCredentials, selectAllowed } from "../src/tools/lib/collectors/sqlite";
import { freshTestDir } from "./lib/test-home";

// Schema and message shape from a real opencode.db (column names and keys
// only); the credential tables carry sentinels a leak would surface.

const COLLECTORS_DIR = resolve(
  import.meta.dir,
  "..",
  "src",
  "tools",
  "lib",
  "collectors"
);
const SENTINEL = "never-read-sentinel";
const LATER = new Date("2099-01-01T00:00:00.000Z");
const T0 = Date.parse("2026-10-12T10:00:00.000Z");

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
    "CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)"
  );
  db.run(
    "CREATE TABLE account (id TEXT, email TEXT, access_token TEXT, refresh_token TEXT)"
  );
  db.run("CREATE TABLE control_account (id TEXT, access_token TEXT)");
  db.run("CREATE TABLE credential (id TEXT, value TEXT)");
  db.run("CREATE TABLE session_share (session_id TEXT, secret TEXT)");
  db.run("INSERT INTO account VALUES ('a', ?1, ?1, ?1)", [SENTINEL]);
  db.run("INSERT INTO control_account VALUES ('c', ?1)", [SENTINEL]);
  db.run("INSERT INTO credential VALUES ('k', ?1)", [SENTINEL]);
  db.run("INSERT INTO session_share VALUES ('s', ?1)", [SENTINEL]);
  return db;
}

function assistant(output: number, completed = true, created = T0) {
  return JSON.stringify({
    role: "assistant",
    modelID: "kimi-k3",
    providerID: "fireworks-ai",
    cost: 0.0042,
    mode: "build",
    agent: "build",
    finish: "stop",
    path: { cwd: "/work/repo", root: "/work/repo" },
    time: completed ? { created, completed: created + 1500 } : { created },
    tokens: {
      input: 100,
      output,
      reasoning: 40,
      cache: { read: 900, write: 30 },
    },
  });
}

function insert(db: Database, id: string, created: number, data: string) {
  db.run("INSERT OR REPLACE INTO message VALUES (?1, 'ses_1', ?2, ?2, ?3)", [
    id,
    created,
    data,
  ]);
}

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "claude";
  mkdirSync(resolve(home, "memory"), { recursive: true });
  dbPath = resolve(home, "opencode.db");
  reload();
});

describe("collecting opencode's model calls", () => {
  test("an assistant message is one model_call with opencode's own cost", () => {
    const db = fixtureDb();
    insert(db, "msg_1", T0, JSON.stringify({ role: "user" }));
    insert(db, "msg_2", T0 + 1, assistant(77));
    db.close();
    expect(collectOpencode(dbPath, LATER)).toBe(1);
    expect(streamed()[0]).toMatchObject({
      ts: new Date(T0 + 1).toISOString(),
      session: "ses_1",
      runtime: "opencode",
      cwd: "/work/repo",
      model: "kimi-k3",
      provider: "fireworks-ai",
      inputTokens: 100,
      outputTokens: 117,
      thinkingTokens: 40,
      cacheWrite5m: 30,
      cacheRead: 900,
      costUsd: 0.0042,
      agent: "build",
      mode: "build",
      stopReason: "stop",
      durationMs: 1500,
    });
  });

  test("a second run emits nothing the first one did", () => {
    const db = fixtureDb();
    insert(db, "msg_1", T0, assistant(1));
    insert(db, "msg_2", T0, assistant(2));
    collectOpencode(dbPath, LATER);
    insert(db, "msg_3", T0, assistant(3));
    db.close();
    expect(collectOpencode(dbPath, LATER)).toBe(1);
    expect(streamed().map((e) => e.outputTokens)).toEqual([41, 42, 43]);
  });

  test("a message still streaming stops the read until it completes", () => {
    const now = new Date(T0 + 60_000);
    const db = fixtureDb();
    insert(db, "msg_1", T0, assistant(1));
    insert(db, "msg_2", T0 + 1, assistant(2, false, T0 + 1));
    insert(db, "msg_3", T0 + 2, assistant(3));
    expect(collectOpencode(dbPath, now)).toBe(1);
    insert(db, "msg_2", T0 + 1, assistant(20, true, T0 + 1));
    db.close();
    expect(collectOpencode(dbPath, now)).toBe(2);
    expect(streamed().map((e) => e.outputTokens)).toEqual([41, 60, 43]);
  });

  test("a message left uncompleted for an hour is taken as it stands", () => {
    const db = fixtureDb();
    insert(db, "msg_1", T0, assistant(5, false));
    db.close();
    expect(collectOpencode(dbPath, new Date(T0 + 61 * 60_000))).toBe(1);
  });

  test("no database, nothing collected", () => {
    expect(collectOpencode(resolve(home, "missing.db"), LATER)).toBe(0);
  });
});

describe("a collector never reads a credential", () => {
  test("the shipped allow-lists name no credential table or column", () => {
    expect(() => assertNoCredentials(OPENCODE_ALLOW_LIST)).not.toThrow();
  });

  test.each([
    ["account", ["id"]],
    ["control_account", ["id"]],
    ["credential", ["id"]],
    ["session_share", ["session_id"]],
    ["message", ["access_token"]],
    ["message", ["refresh_token"]],
    ["message", ["secret"]],
    ["message", ["value"]],
  ])("widening an allow-list to %s.%s is refused", (table, columns) => {
    const widened = { ...OPENCODE_ALLOW_LIST, [table]: columns };
    expect(() => assertNoCredentials(widened)).toThrow(/never read/);
    fixtureDb().close();
    expect(() =>
      selectAllowed(dbPath, widened, "message", ["id"], {
        orderColumn: "time_created",
        idColumn: "id",
        order: 0,
        id: "",
      })
    ).toThrow(/never read/);
  });

  test("a table or column off the allow-list is refused", () => {
    fixtureDb().close();
    const after = { orderColumn: "time_created", idColumn: "id", order: 0, id: "" };
    expect(() =>
      selectAllowed(dbPath, OPENCODE_ALLOW_LIST, "todo", ["id"], after)
    ).toThrow(/allow-list/);
    expect(() =>
      selectAllowed(dbPath, OPENCODE_ALLOW_LIST, "message", ["time_updated"], after)
    ).toThrow(/allow-list/);
  });

  test("nothing the collectors emit carries a credential", () => {
    const db = fixtureDb();
    insert(db, "msg_1", T0, assistant(1));
    db.close();
    collectOpencode(dbPath, LATER);
    const written = readdirSync(resolve(home, "memory"), { recursive: true })
      .map((f) => resolve(home, "memory", String(f)))
      .filter((f) => f.endsWith(".json") || f.endsWith(".jsonl"))
      .map((f) => readFileSync(f, "utf-8"))
      .join("\n");
    expect(written).not.toContain(SENTINEL);
  });

  test("only the allow-listed reader opens or queries a database", () => {
    const offenders = readdirSync(COLLECTORS_DIR)
      .filter((f) => f !== "sqlite.ts")
      .filter((f) =>
        /new Database\(|\.query\(|\.prepare\(|\.run\(|\.exec\(/.test(
          readFileSync(resolve(COLLECTORS_DIR, f), "utf-8")
        )
      );
    expect(offenders).toEqual([]);
  });
});
