import { beforeEach, describe, expect, test } from "bun:test";
import { utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendEvent } from "../src/bronze/events";
import {
  busyReasons,
  diskShortfall,
  type GuardSeams,
  moveGuardRefusal,
  sizeOf,
} from "../src/cli/migrations/move-guards";
import {
  memoryMoveDetails,
  memoryMoveEvents,
  writeFile,
} from "./lib/memory-move-fixture";
import { freshTestDir } from "./lib/test-home";

let HOME: string;
const at = (...parts: string[]) => resolve(HOME, ...parts);
const NOW = Date.now();
const MINUTE = 60_000;

beforeEach(() => {
  HOME = resolve(freshTestDir(import.meta.file), "home");
  process.env.PAL_HOME = HOME;
});

const idle: GuardSeams = {
  now: () => NOW,
  isAlive: () => false,
  freeBytes: () => Number.MAX_SAFE_INTEGER,
};

function eventAt(
  minutesAgo: number,
  type: "turn" | "memory_move" | "migration_run" = "turn"
) {
  appendEvent(type, {}, { ts: new Date(NOW - minutesAgo * MINUTE).toISOString() });
}

describe("busyReasons", () => {
  test("is empty on an idle home", () => {
    eventAt(6);

    expect(busyReasons(idle)).toEqual([]);
  });

  test("names a bronze event from the last five minutes", () => {
    eventAt(6);
    eventAt(2);

    expect(busyReasons(idle)).toEqual(["a bronze event was written 120s ago"]);
  });

  test("counts an event exactly five minutes old, not one just older", () => {
    eventAt(5);

    expect(busyReasons(idle)).toHaveLength(1);
  });

  test("does not count the move's own events", () => {
    eventAt(1, "memory_move");
    eventAt(1, "migration_run");

    expect(busyReasons(idle)).toEqual([]);
  });

  test("does not read an event file untouched for five minutes", () => {
    eventAt(1);
    const old = (NOW - 10 * MINUTE) / 1000;
    const month = new Date(NOW - MINUTE).toISOString().slice(0, 7);
    utimesSync(at("memory", "events", `${month}.jsonl`), old, old);

    expect(busyReasons(idle)).toEqual([]);
  });

  test("finds the newest event at the end of a large file", () => {
    for (let i = 0; i < 3000; i += 1) eventAt(30);
    eventAt(0);

    expect(busyReasons(idle)).toEqual(["a bronze event was written 0s ago"]);
  });

  test("names a running control room", () => {
    writeFile(at("server.json"), JSON.stringify({ pid: 4242, port: 1, startedAt: "x" }));

    expect(busyReasons({ ...idle, isAlive: (pid) => pid === 4242 })).toEqual([
      "the control room is running (pid 4242)",
    ]);
    expect(busyReasons(idle)).toEqual([]);
  });

  test("asks the real process table by default", () => {
    writeFile(at("server.json"), JSON.stringify({ pid: process.ppid }));

    expect(busyReasons({ now: () => NOW, freeBytes: idle.freeBytes })).toEqual([
      `the control room is running (pid ${process.ppid})`,
    ]);
  });

  test("ignores a server state file it cannot read", () => {
    writeFile(at("server.json"), "{not json");

    expect(busyReasons({ ...idle, isAlive: () => true })).toEqual([]);
  });

  test("names a running bronze collect, but not this process's own", () => {
    writeFile(at("memory", "state", "collect.lock"), "777");

    expect(busyReasons({ ...idle, isAlive: (pid) => pid === 777 })).toEqual([
      "a bronze collect is running (pid 777)",
    ]);
    writeFileSync(at("memory", "state", "collect.lock"), String(process.pid));
    expect(busyReasons({ ...idle, isAlive: () => true })).toEqual([]);
  });
});

describe("diskShortfall", () => {
  test("sizes memory/ by its files", () => {
    writeFile(at("memory", "a.jsonl"), "x".repeat(600));
    writeFile(at("memory", "deep", "b.md"), "x".repeat(400));

    expect(sizeOf(at("memory"))).toBe(1000);
  });

  test("refuses when free space is below twice the size of memory/", () => {
    writeFile(at("memory", "a.jsonl"), "x".repeat(1000));

    expect(diskShortfall({ ...idle, freeBytes: () => 1999 })).toBe(
      "1999 bytes free, the move needs 2000 (twice memory/)"
    );
    expect(diskShortfall({ ...idle, freeBytes: () => 2000 })).toBeNull();
  });

  test("asks the filesystem that holds memory/", () => {
    writeFile(at("memory", "a.jsonl"), "x");
    const asked: string[] = [];

    diskShortfall({
      ...idle,
      freeBytes: (dir) => {
        asked.push(dir);

        return 10;
      },
    });

    expect(asked).toEqual([at("memory")]);
  });

  test("reads the real free space by default", () => {
    writeFile(at("memory", "a.jsonl"), "x");

    expect(diskShortfall({ now: idle.now, isAlive: idle.isAlive })).toBeNull();
  });
});

describe("moveGuardRefusal", () => {
  test("lets an idle home with room through and records nothing", () => {
    writeFile(at("memory", "a.jsonl"), "x");

    expect(moveGuardRefusal("layout", { seams: idle })).toBeNull();
    expect(memoryMoveEvents(HOME)).toEqual([]);
  });

  test("refuses while PAL is busy and records why", () => {
    eventAt(1);

    expect(moveGuardRefusal("layout", { seams: idle })).toBe(
      "PAL is in use: a bronze event was written 60s ago"
    );
    expect(memoryMoveEvents(HOME)).toEqual([
      expect.objectContaining({
        migration: "layout",
        outcome: "refused",
        reason: "busy",
      }),
    ]);
    expect(memoryMoveDetails(HOME)).toEqual([
      expect.objectContaining({ busy: ["a bronze event was written 60s ago"] }),
    ]);
  });

  test("goes ahead while busy when forced", () => {
    eventAt(1);

    expect(moveGuardRefusal("layout", { force: true, seams: idle })).toBeNull();
  });

  test("refuses for low disk space even when forced", () => {
    writeFile(at("memory", "a.jsonl"), "x".repeat(10));

    expect(
      moveGuardRefusal("layout", { force: true, seams: { ...idle, freeBytes: () => 5 } })
    ).toBe("not enough disk: 5 bytes free, the move needs 20 (twice memory/)");
    expect(memoryMoveEvents(HOME).at(-1)).toMatchObject({ reason: "low disk" });
  });
});
