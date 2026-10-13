import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { logSessionEnd } from "../src/hooks/lib/session-events";
import { reload } from "../src/hooks/lib/settings";
import { type SessionRecord, writeSession } from "../src/hooks/lib/work-tracking";
import { backfillEvents } from "../src/tools/lib/backfill";
import { freshTestDir } from "./lib/test-home";

let home: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  mkdirSync(resolve(home, "memory", "state"), { recursive: true });
  reload();
});

function session(
  sessionId: string,
  overrides: Partial<SessionRecord> = {}
): SessionRecord {
  return {
    sessionId,
    name: "Private session name",
    ts: "2026-09-10T10:00:00.000Z",
    cwd: home,
    status: "completed",
    summary: "a private summary",
    artifacts: ["src/a.ts"],
    handoff: "",
    messageCount: 12,
    ...overrides,
  };
}

function logLines(dir: string): Record<string, unknown>[] {
  const path = resolve(home, dir, "events");
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .flatMap((f) => readFileSync(resolve(path, f), "utf-8").trim().split("\n"))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const ends = () => logLines("memory").filter((e) => e.type === "session_end");

describe("session records become session_end events", () => {
  test("a recorded session is logged at its last state, its text kept as content", () => {
    writeSession(session("s1"));

    expect(backfillEvents()).toMatchObject({ sessions: 1 });
    expect(ends()).toEqual([
      expect.objectContaining({
        id: "session:s1",
        ts: "2026-09-10T10:00:00.000Z",
        session: "s1",
        runtime: "unknown",
        reason: "backfill",
        messages: 12,
        status: "completed",
      }),
    ]);
    expect(JSON.stringify(logLines("memory"))).not.toContain("private");
    expect(logLines("memory/content")).toEqual([
      expect.objectContaining({
        id: "session:s1",
        name: "Private session name",
        summary: "a private summary",
      }),
    ]);
  });

  test("an archived session resumed later is logged once, at its newest state", () => {
    writeSession(session("s1", { messageCount: 4 }));
    for (let i = 0; i < 50; i++) writeSession(session(`filler-${i}`));
    writeSession(session("s1", { ts: "2026-09-11T10:00:00.000Z", messageCount: 30 }));

    backfillEvents();
    expect(ends().filter((e) => e.session === "s1")).toEqual([
      expect.objectContaining({ ts: "2026-09-11T10:00:00.000Z", messages: 30 }),
    ]);
    expect(ends()).toHaveLength(51);
  });

  test("a session whose end was logged live is not logged again", () => {
    writeSession(session("s1"));
    logSessionEnd({ session_id: "s1", reason: "other" });

    expect(backfillEvents()).toMatchObject({ sessions: 0 });
  });

  test("a second run appends nothing", () => {
    writeSession(session("s1"));
    backfillEvents();
    expect(backfillEvents()).toMatchObject({ sessions: 0 });
    expect(ends()).toHaveLength(1);
  });

  test("--since leaves older sessions out", () => {
    writeSession(session("s1"));
    expect(backfillEvents("2026-09-11")).toMatchObject({ sessions: 0 });
  });
});
