import { beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  admittedFields,
  appendEvent,
  EVENT_FIELDS,
  EVENT_SCHEMA_VERSION,
  eventsSince,
} from "../src/hooks/lib/events";
import { reload } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

let home: string;

function setSettings(data: Record<string, unknown>) {
  writeFileSync(resolve(home, "memory", "pal-settings.json"), JSON.stringify(data));
  reload();
}

function streamLines(month: string): Record<string, unknown>[] {
  const file = resolve(home, "memory", "events", `${month}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "claude";
  delete process.env.PAL_CHANNEL;
  mkdirSync(resolve(home, "memory"), { recursive: true });
  setSettings({});
});

describe("the event envelope", () => {
  test("every event carries version, id, time, type and who and where it came from", () => {
    const id = appendEvent(
      "turn",
      { words: 4 },
      { ts: "2026-09-10T10:00:00.000Z", session: "s1", cwd: home }
    );
    const [event] = streamLines("2026-09");
    expect(event).toMatchObject({
      v: EVENT_SCHEMA_VERSION,
      id,
      ts: "2026-09-10T10:00:00.000Z",
      type: "turn",
      session: "s1",
      runtime: "claude",
      channel: null,
      project: null,
      cwd: home,
      words: 4,
    });
    expect(typeof event?.machine).toBe("string");
    expect(typeof event?.actor).toBe("string");
  });

  test("the channel comes from PAL_CHANNEL unless the caller names one", () => {
    process.env.PAL_CHANNEL = "discord-mobile";
    appendEvent("turn", {}, { ts: "2026-09-10T10:00:00.000Z" });
    appendEvent("turn", {}, { ts: "2026-09-10T10:00:01.000Z", channel: null });
    expect(streamLines("2026-09").map((e) => e.channel)).toEqual([
      "discord-mobile",
      null,
    ]);
  });

  test("a backfilled event keeps the id derived from its source", () => {
    appendEvent("turn", {}, { id: "git:abc123", ts: "2026-09-10T10:00:00.000Z" });
    expect(streamLines("2026-09")[0]?.id).toBe("git:abc123");
  });
});

describe("the type registry", () => {
  test("every registered type lists its fields", () => {
    for (const fields of Object.values(EVENT_FIELDS))
      expect(fields.length).toBeGreaterThan(0);
  });

  test("fields a type does not declare are dropped", () => {
    expect(admittedFields("turn", { words: 3, prompt: "x" })).toEqual({ words: 3 });
  });

  test("text longer than an enum is refused, so no message slips into the stream", () => {
    const long = "please rotate the staging credentials before the demo starts today";
    expect(admittedFields("turn", { mood: long, words: 2 })).toEqual({ words: 2 });
  });

  test("one level of nesting is kept, deeper structures and non-finite numbers are not", () => {
    const reply = { words: 10, listItems: 0, headings: 0, asked: false };
    expect(admittedFields("turn", { reply })).toEqual({ reply });
    expect(admittedFields("turn", { reply: { a: { b: { c: 1 } } } })).toEqual({});
    expect(admittedFields("turn", { gapSec: Number.NaN })).toEqual({});
  });
});

describe("the content store", () => {
  test("text goes to memory/content keyed by the event id, never into the stream", () => {
    const id = appendEvent(
      "turn",
      { words: 2 },
      { ts: "2026-09-10T10:00:00.000Z", content: { prompt: "secret plan" } }
    );
    const stream = readFileSync(
      resolve(home, "memory", "events", "2026-09.jsonl"),
      "utf-8"
    );
    const content = readFileSync(
      resolve(home, "memory", "content", "events", "2026-09.jsonl"),
      "utf-8"
    );
    expect(stream).not.toContain("secret plan");
    expect(JSON.parse(content)).toMatchObject({
      id,
      type: "turn",
      prompt: "secret plan",
    });
  });
});

describe("opting out", () => {
  test("with the event log disabled nothing is written, events or content", () => {
    setSettings({ eventLog: { enabled: false } });
    const id = appendEvent(
      "turn",
      { words: 2 },
      { ts: "2026-09-10T10:00:00.000Z", content: { prompt: "x" } }
    );
    expect(id).toBeNull();
    expect(existsSync(resolve(home, "memory", "events"))).toBe(false);
    expect(existsSync(resolve(home, "memory", "content"))).toBe(false);
  });
});

describe("a failed write", () => {
  test.skipIf(process.platform === "win32")("is swallowed and reported as no id", () => {
    const dir = resolve(home, "memory", "events");
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o500);
    try {
      expect(appendEvent("turn", {}, { ts: "2026-09-10T10:00:00.000Z" })).toBeNull();
    } finally {
      chmodSync(dir, 0o700);
    }
  });
});

describe("reading events back", () => {
  test("returns one type since a date, across months, in file order", () => {
    appendEvent("turn", { words: 1 }, { ts: "2026-08-30T10:00:00.000Z" });
    appendEvent("turn", { words: 2 }, { ts: "2026-09-20T10:00:00.000Z" });
    appendEvent("turn", { words: 3 }, { ts: "2026-10-01T10:00:00.000Z" });
    const words = eventsSince("turn", new Date("2026-09-15T00:00:00Z")).map(
      (e) => e.words
    );
    expect(words).toEqual([2, 3]);
  });
});

describe("cost", () => {
  test("an append stays under 5 ms once the process is warm", () => {
    appendEvent("turn", { words: 1 }, { ts: "2026-09-10T10:00:00.000Z" });
    const runs = 50;
    const start = performance.now();
    for (let i = 0; i < runs; i++) appendEvent("turn", { words: i }, {});
    expect((performance.now() - start) / runs).toBeLessThan(5);
  });
});
