import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  logCompaction,
  logSessionEnd,
  logSessionStart,
} from "../src/hooks/lib/session-events";
import { reload } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

let home: string;
const T0 = new Date("2026-09-10T10:00:00.000Z");

function at(sec: number): Date {
  return new Date(T0.getTime() + sec * 1000);
}

function streamed(type: string): Record<string, unknown>[] {
  const file = resolve(home, "memory", "events", "2026-09.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === type);
}

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "claude";
  mkdirSync(resolve(home, "memory"), { recursive: true });
  reload();
});

describe("session boundaries", () => {
  test("a start records why it opened, the PAL version and the timezone", () => {
    logSessionStart({ session_id: "s1", source: "resume" }, T0);
    const [start] = streamed("session_start");
    expect(start).toMatchObject({ session: "s1", source: "resume" });
    expect(start?.palVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof start?.tz).toBe("string");
    expect(start?.utcOffsetMin).toBe(0 - T0.getTimezoneOffset());
  });

  test("an end records the reason and how long the session ran", () => {
    logSessionStart({ session_id: "other", source: "startup" }, T0);
    logSessionStart({ session_id: "s1", source: "startup" }, at(60));
    logSessionEnd({ session_id: "s1", reason: "prompt_input_exit" }, at(3660));
    expect(streamed("session_end")).toEqual([
      expect.objectContaining({
        session: "s1",
        reason: "prompt_input_exit",
        durationSec: 3600,
      }),
    ]);
  });

  test("an end without a known start has no duration", () => {
    logSessionEnd({ sessionId: "s2", reason: "other" }, T0);
    expect(streamed("session_end")[0]).toMatchObject({
      session: "s2",
      durationSec: null,
    });
  });

  test("a compaction records its trigger and whether it was steered", () => {
    logCompaction(
      { session_id: "s1", trigger: "manual", custom_instructions: "keep IDs" },
      T0
    );
    logCompaction({ session_id: "s1", trigger: "auto", custom_instructions: " " }, T0);
    expect(streamed("compaction").map((e) => [e.trigger, e.withInstructions])).toEqual([
      ["manual", true],
      ["auto", false],
    ]);
  });

  test("the compaction instructions themselves never reach the stream", () => {
    logCompaction(
      { session_id: "s1", trigger: "manual", custom_instructions: "keep IDs" },
      T0
    );
    expect(JSON.stringify(streamed("compaction"))).not.toContain("keep IDs");
  });
});

describe("a broken event store never fails the hook", () => {
  test("every session logger swallows the failure", () => {
    writeFileSync(resolve(home, "memory", "events"), "not a folder");
    expect(() => {
      logSessionStart({ session_id: "s1", source: "startup" }, T0);
      logSessionEnd({ session_id: "s1", reason: "other" }, T0);
      logCompaction({ session_id: "s1", trigger: "auto" }, T0);
    }).not.toThrow();
  });
});

describe("the PreCompact hook", () => {
  test("logs the compaction when the agent runs it", async () => {
    const proc = Bun.spawn(
      ["bun", resolve(import.meta.dir, "../src/hooks/PreCompactPersist.ts")],
      {
        stdin: new TextEncoder().encode(
          JSON.stringify({ session_id: "s9", trigger: "auto" })
        ),
        env: { ...process.env, PAL_HOME: home },
        stdout: "ignore",
        stderr: "ignore",
      }
    );
    await proc.exited;
    const month = new Date().toISOString().slice(0, 7);
    const lines = readFileSync(
      resolve(home, "memory", "events", `${month}.jsonl`),
      "utf-8"
    );
    expect(lines).toContain('"type":"compaction"');
    expect(lines).toContain('"session":"s9"');
  });
});
