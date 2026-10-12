import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { reload } from "../src/hooks/lib/settings";
import {
  ANTIGRAVITY_ALLOW_LIST,
  collectAntigravity,
} from "../src/tools/lib/collectors/antigravity";
import { assertNoCredentials } from "../src/tools/lib/collectors/sqlite";
import { freshTestDir } from "./lib/test-home";

// Columns and time format from a real conversation_summaries.db.

let home: string;
let dbPath: string;

function streamed(): Record<string, unknown>[] {
  const dir = resolve(home, "memory", "events");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) => readFileSync(resolve(dir, f), "utf-8").trim().split("\n"))
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === "conversation");
}

function fixtureDb(): Database {
  const db = new Database(dbPath, { create: true });
  db.run(
    "CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT, preview TEXT, step_count INTEGER, last_modified_time TEXT, workspace_uris TEXT, status TEXT, source TEXT, project_id TEXT, agent_name TEXT, parent_conversation_id TEXT, nesting_depth INTEGER, killed INTEGER)"
  );
  return db;
}

function upsert(
  db: Database,
  id: string,
  steps: number,
  modified: string,
  extra: { agent?: string; parent?: string } = {}
) {
  db.run(
    "INSERT OR REPLACE INTO conversation_summaries VALUES (?1, 'a title', 'a preview', ?2, ?3, ?4, 'CASCADE_RUN_STATUS_IDLE', '', 'default-cli-project', ?5, ?6, ?7, 0)",
    [
      id,
      steps,
      modified,
      JSON.stringify([pathToFileURL(resolve(home, "work")).href]),
      extra.agent ?? "",
      extra.parent ?? "",
      extra.parent ? 1 : 0,
    ]
  );
}

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "claude";
  mkdirSync(resolve(home, "memory"), { recursive: true });
  dbPath = resolve(home, "conversation_summaries.db");
  reload();
});

describe("collecting Antigravity's conversations", () => {
  test("a conversation is a snapshot of its steps and state, with no text", () => {
    const db = fixtureDb();
    upsert(db, "conv_1", 5, "2026-10-08 18:03:20.758387904+00:00");
    db.close();
    expect(collectAntigravity(dbPath)).toBe(1);
    const [event] = streamed();
    expect(event).toMatchObject({
      ts: "2026-10-08T18:03:20.758Z",
      session: "conv_1",
      runtime: "antigravity",
      cwd: resolve(home, "work"),
      steps: 5,
      status: "idle",
      depth: 0,
      subagent: false,
      killed: false,
    });
    expect(JSON.stringify(event)).not.toContain("a title");
  });

  test("PAL's own inference spawns are left out", () => {
    const db = fixtureDb();
    upsert(db, "conv_pal", 3, "2026-10-08 18:00:00.000000000+00:00", {
      agent: "pal-inference",
    });
    upsert(db, "conv_sub", 2, "2026-10-08 18:01:00.000000000+00:00", {
      parent: "conv_1",
    });
    db.close();
    expect(collectAntigravity(dbPath)).toBe(1);
    expect(streamed()[0]).toMatchObject({
      session: "conv_sub",
      subagent: true,
      depth: 1,
    });
  });

  test("an unchanged conversation is not emitted again; a changed one is", () => {
    const db = fixtureDb();
    upsert(db, "conv_1", 5, "2026-10-08 18:03:20.000000000+00:00");
    collectAntigravity(dbPath);
    expect(collectAntigravity(dbPath)).toBe(0);
    upsert(db, "conv_1", 9, "2026-10-08 18:09:00.000000000+00:00");
    db.close();
    expect(collectAntigravity(dbPath)).toBe(1);
    expect(streamed().map((e) => e.steps)).toEqual([5, 9]);
  });

  test("the allow-list names no credential, and widening it is refused", () => {
    expect(() => assertNoCredentials(ANTIGRAVITY_ALLOW_LIST)).not.toThrow();
    expect(() =>
      assertNoCredentials({ ...ANTIGRAVITY_ALLOW_LIST, credential: ["id"] })
    ).toThrow(/never read/);
  });

  test("no summaries database, nothing collected", () => {
    expect(collectAntigravity(resolve(home, "missing.db"))).toBe(0);
  });
});
