import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  watch,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { runStopHandlers } from "../src/hooks/lib/stop";
import { sandboxContextRuleDirs } from "./lib/context-rule-dirs";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const TMP_VARS = ["TMPDIR", "TMP", "TEMP"] as const;
const HOUR_MS = 3_600_000;

let HOME: string;
let OS_TMP: string;

function handoffDir(): string {
  return resolve(HOME, "memory", "state", "transcript-handoff");
}

function longTranscript() {
  return Array.from({ length: 8 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `message ${i} `.repeat(50),
  }));
}

function setMtimeHoursAgo(path: string, hours: number): void {
  const when = new Date(Date.now() - hours * HOUR_MS);
  utimesSync(path, when, when);
}

/** Children delete their file as soon as they finish, so names are caught as they appear. */
function watchNewNames(dir: string): { names: Set<string>; stop: () => void } {
  const names = new Set<string>();
  const watcher = watch(dir, (_event, name) => {
    if (name) names.add(String(name));
  });
  return { names, stop: () => watcher.close() };
}

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
  OS_TMP = freshTestDir(import.meta.file);
  for (const v of TMP_VARS) process.env[v] = OS_TMP;
  process.env.PAL_HOME = HOME;
  process.env.PAL_INFERENCE_DISABLED = "1";
  sandboxContextRuleDirs(resolve(HOME, "agents"));
});

describe("the Stop hook's transcript hand-off", () => {
  test("writes one file per child inside PAL home and nothing to the OS temp dir", async () => {
    mkdirSync(handoffDir(), { recursive: true });
    const seen = watchNewNames(handoffDir());
    try {
      await runStopHandlers(longTranscript(), { sessionId: "handoff-both" });
      await Bun.sleep(300);
    } finally {
      seen.stop();
    }

    const names = [...seen.names];
    expect(names.length).toBeGreaterThanOrEqual(2);
    for (const name of names) expect(existsSync(resolve(handoffDir(), name))).toBe(true);
    expect(readdirSync(OS_TMP).filter((n) => n.startsWith("pal-transcript-"))).toEqual(
      []
    );
    expect(readdirSync(OS_TMP)).toEqual([]);
  });

  test("creates the hand-off folder when it does not exist", async () => {
    expect(existsSync(handoffDir())).toBe(false);
    await runStopHandlers(longTranscript(), { sessionId: "handoff-create" });
    expect(existsSync(handoffDir())).toBe(true);
  });

  test("two Stop hooks at once write differently named files", async () => {
    mkdirSync(handoffDir(), { recursive: true });
    const seen = watchNewNames(handoffDir());
    try {
      await Promise.all([
        runStopHandlers(longTranscript(), { sessionId: "handoff-a" }),
        runStopHandlers(longTranscript(), { sessionId: "handoff-b" }),
      ]);
      await Bun.sleep(300);
    } finally {
      seen.stop();
    }
    const creations = [...seen.names];
    expect(creations.length).toBeGreaterThanOrEqual(4);
  });
});

describe("the 24-hour sweep", () => {
  test("removes a hand-off file older than 24 hours and keeps a younger one", async () => {
    mkdirSync(handoffDir(), { recursive: true });
    const stale = resolve(handoffDir(), "stale.txt");
    const fresh = resolve(handoffDir(), "fresh.txt");
    writeFileSync(stale, "old");
    writeFileSync(fresh, "new");
    setMtimeHoursAgo(stale, 25);
    setMtimeHoursAgo(fresh, 1);

    await runStopHandlers(longTranscript(), { sessionId: "handoff-sweep" });

    expect(existsSync(stale)).toBe(false);
    expect(readFileSync(fresh, "utf-8")).toBe("new");
  });

  test("a second Stop adds and changes nothing beyond what the first left", async () => {
    mkdirSync(handoffDir(), { recursive: true });
    const stale = resolve(handoffDir(), "stale.txt");
    const fresh = resolve(handoffDir(), "fresh.txt");
    writeFileSync(stale, "old");
    writeFileSync(fresh, "new");
    setMtimeHoursAgo(stale, 30);
    setMtimeHoursAgo(fresh, 2);

    await runStopHandlers(longTranscript(), { sessionId: "handoff-twice" });
    await Bun.sleep(1500);
    const afterFirst = readdirSync(handoffDir()).filter((n) => n.endsWith(".txt"));
    await runStopHandlers(longTranscript(), { sessionId: "handoff-twice" });

    expect(existsSync(stale)).toBe(false);
    expect(afterFirst).toContain("fresh.txt");
    expect(readFileSync(resolve(handoffDir(), "fresh.txt"), "utf-8")).toBe("new");
    expect(readFileSync(fresh, "utf-8")).toBe("new");
  });
});

describe("a hand-off folder that cannot be used", () => {
  test("logs the error and still returns when the folder is a regular file", async () => {
    mkdirSync(resolve(HOME, "memory", "state"), { recursive: true });
    writeFileSync(handoffDir(), "not a folder");

    await expect(
      runStopHandlers(longTranscript(), { sessionId: "handoff-broken" })
    ).resolves.toBeUndefined();

    const log = resolve(HOME, "debug", "debug.log");
    expect(existsSync(log)).toBe(true);
    expect(readFileSync(log, "utf-8")).toContain("ERROR");
    expect(readdirSync(OS_TMP)).toEqual([]);
  });
});
