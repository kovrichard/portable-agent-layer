import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendEvent, eventsSince, type LoggedEvent } from "../src/hooks/lib/events";
import { reload } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

const loadNear = () => import("../src/hooks/lib/compaction-near");
const loadBacktest = () => import("../src/hooks/lib/compaction-backtest");
const loadCli = () => import("../src/cli/compaction");

const WINDOW_ENV = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";
let home: string;
let since: Date;
let printed: string[];
let logSpy: ReturnType<typeof spyOn> | undefined;
let errSpy: ReturnType<typeof spyOn> | undefined;

beforeEach(() => {
  logSpy?.mockRestore();
  errSpy?.mockRestore();
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "claude";
  delete process.env.PAL_SPAWNED_INFERENCE;
  delete process.env[WINDOW_ENV];
  mkdirSync(resolve(home, "memory"), { recursive: true });
  writeFileSync(resolve(home, "memory", "pal-settings.json"), "{}");
  reload();
  since = new Date(Date.now() - 1000);
  printed = [];
  logSpy = spyOn(console, "log").mockImplementation((...a) => printed.push(a.join(" ")));
  errSpy = spyOn(console, "error").mockImplementation((...a) =>
    printed.push(a.join(" "))
  );
});

function transcriptWith(name: string, tokens: number): string {
  const path = resolve(home, name);
  const usage = { input_tokens: 10, cache_read_input_tokens: tokens - 10 };
  writeFileSync(path, `${JSON.stringify({ message: { usage } })}\n`);
  return path;
}

function prompt(transcript_path: string) {
  return { session_id: "sess-1", transcript_path };
}

const written = () => eventsSince("compaction_near", since);

async function windowTokensFor(raw: string | undefined): Promise<unknown> {
  const { recordCompactionNear } = await loadNear();
  if (raw === undefined) delete process.env[WINDOW_ENV];
  else process.env[WINDOW_ENV] = raw;
  recordCompactionNear(prompt(transcriptWith("window.jsonl", 250_000)));
  return written()[0]?.windowTokens;
}

describe("compactionPredicted rows", () => {
  test("200000 against the default threshold is predicted", async () => {
    const { compactionPredicted } = await loadNear();
    expect(compactionPredicted(200_000)).toBe(true);
  });

  test("199999 against the default threshold is not predicted", async () => {
    const { compactionPredicted } = await loadNear();
    expect(compactionPredicted(199_999)).toBe(false);
  });

  test("250000 against the default threshold is predicted", async () => {
    const { compactionPredicted } = await loadNear();
    expect(compactionPredicted(250_000)).toBe(true);
  });

  test("150000 against a 120000 threshold is predicted", async () => {
    const { compactionPredicted } = await loadNear();
    expect(compactionPredicted(150_000, 120_000)).toBe(true);
  });

  test("0 against a 400000 threshold is not predicted", async () => {
    const { compactionPredicted } = await loadNear();
    expect(compactionPredicted(0, 400_000)).toBe(false);
  });
});

describe("windowTokensOf rows", () => {
  test('"500000" gives a window of 500000', async () => {
    expect(await windowTokensFor("500000")).toBe(500_000);
  });

  test("an unset variable gives a window of null", async () => {
    expect(await windowTokensFor(undefined)).toBeNull();
  });

  test('"lots" gives a window of null', async () => {
    expect(await windowTokensFor("lots")).toBeNull();
  });

  test("an empty variable gives a window of null", async () => {
    expect(await windowTokensFor("")).toBeNull();
  });

  test('" 300000 " gives a window of 300000', async () => {
    expect(await windowTokensFor(" 300000 ")).toBe(300_000);
  });
});

const MIN = 60_000;
const BASE = Date.now() - 3 * 86_400_000;

function call(
  session: string,
  minute: number,
  tokens: number,
  extra: Record<string, unknown> = {}
) {
  appendEvent(
    "model_call",
    {
      inputTokens: tokens - 1000,
      cacheRead: 1000,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      ...extra,
    },
    { ts: new Date(BASE + minute * MIN).toISOString(), session, runtime: "claude" }
  );
}

function compaction(session: string, minute: number, trigger: string, tokens: number) {
  appendEvent(
    "compaction",
    { trigger, withInstructions: false, contextTokens: tokens },
    { ts: new Date(BASE + minute * MIN).toISOString(), session }
  );
}

function seedHistory() {
  call("warned", 0, 100_000);
  call("warned", 10, 210_000);
  call("warned", 30, 250_000);
  compaction("warned", 40, "auto", 250_000);

  call("missed", 0, 100_000);
  call("missed", 5, 150_000);
  compaction("missed", 20, "auto", 150_000);

  call("alarm", 0, 100_000);
  call("alarm", 5, 220_000);

  call("quiet", 0, 100_000);
  call("quiet", 5, 300_000, { sidechain: true });
  call("quiet", 6, 300_000, { entrypoint: "sdk-cli" });

  call("manual", 0, 250_000);
  compaction("manual", 10, "manual", 250_000);
}

async function backtest(...args: string[]) {
  const { runCompaction } = await loadCli();
  const code = await runCompaction(["backtest", ...args]);
  return { code, text: printed.join("\n") };
}

const at = (minute: number) => new Date(Date.UTC(2026, 10, 5, 10, minute)).toISOString();

function modelCallRow(minute: number, fields: Record<string, unknown> = {}): LoggedEvent {
  return {
    type: "model_call",
    runtime: "claude",
    session: "s",
    ts: at(minute),
    ...fields,
  } as LoggedEvent;
}

function compactionRow(
  minute: number,
  trigger: string,
  fields: Record<string, unknown> = {}
): LoggedEvent {
  return {
    type: "compaction",
    runtime: "claude",
    session: "s",
    ts: at(minute),
    trigger,
    ...fields,
  } as unknown as LoggedEvent;
}

async function scoreAt(
  calls: LoggedEvent[],
  compactions: LoggedEvent[],
  threshold: number
) {
  const { backtestRows } = await loadBacktest();
  return backtestRows(calls, compactions, [threshold])[0];
}

async function autoScore(fields: Record<string, unknown>, threshold = 1) {
  return scoreAt(
    [modelCallRow(0, { inputTokens: 100_000, ...fields })],
    [compactionRow(40, "auto")],
    threshold
  );
}

function literalSeed() {
  const calls = [
    modelCallRow(0, { session: "warned", inputTokens: 100_000 }),
    modelCallRow(10, { session: "warned", inputTokens: 210_000 }),
    modelCallRow(30, { session: "warned", inputTokens: 250_000 }),
    modelCallRow(0, { session: "missed", inputTokens: 100_000 }),
    modelCallRow(5, { session: "missed", inputTokens: 150_000 }),
    modelCallRow(0, { session: "alarm", inputTokens: 100_000 }),
    modelCallRow(5, { session: "alarm", inputTokens: 220_000 }),
    modelCallRow(0, { session: "quiet", inputTokens: 100_000 }),
    modelCallRow(5, { session: "quiet", inputTokens: 300_000, sidechain: true }),
    modelCallRow(6, { session: "quiet", inputTokens: 300_000, entrypoint: "sdk-cli" }),
    modelCallRow(0, { session: "manual", inputTokens: 250_000 }),
  ];
  const compactions = [
    compactionRow(40, "auto", { session: "warned" }),
    compactionRow(20, "auto", { session: "missed" }),
    compactionRow(10, "manual", { session: "manual" }),
  ];
  return { calls, compactions };
}

describe("numberOr0 rows", () => {
  test("a token count of 1000 counts as 1000", async () => {
    expect(await autoScore({ inputTokens: 1000 }, 1000)).toMatchObject({
      warned: 1,
      missed: 0,
    });
  });

  test("a missing token count counts as 0", async () => {
    expect(await autoScore({ inputTokens: undefined })).toMatchObject({
      warned: 0,
      missed: 1,
    });
  });

  test('a string token count "5" counts as 0', async () => {
    expect(await autoScore({ inputTokens: "5" })).toMatchObject({ warned: 0, missed: 1 });
  });
});

describe("callContextTokens rows", () => {
  test("209000 input plus 1000 cache read is 210000 tokens", async () => {
    const calls = [
      modelCallRow(0, {
        inputTokens: 209_000,
        cacheRead: 1000,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
      }),
    ];
    const compactions = [compactionRow(40, "auto")];
    expect(await scoreAt(calls, compactions, 210_000)).toMatchObject({ warned: 1 });
    expect(await scoreAt(calls, compactions, 210_001)).toMatchObject({ missed: 1 });
  });

  test("10 input, 5 cache read, 3 and 2 cache writes are 20 tokens", async () => {
    const calls = [
      modelCallRow(0, {
        inputTokens: 10,
        cacheRead: 5,
        cacheWrite5m: 3,
        cacheWrite1h: 2,
      }),
    ];
    const compactions = [compactionRow(40, "auto")];
    expect(await scoreAt(calls, compactions, 20)).toMatchObject({ warned: 1 });
    expect(await scoreAt(calls, compactions, 21)).toMatchObject({ missed: 1 });
  });

  test("a call with no token fields is 0 tokens", async () => {
    const calls = [modelCallRow(0, {})];
    const compactions = [compactionRow(40, "auto")];
    expect(await scoreAt(calls, compactions, 1)).toMatchObject({ warned: 0, missed: 1 });
  });
});

describe("isMainThreadCall rows", () => {
  test("a claude call with no sidechain and no entrypoint is a main-thread call", async () => {
    expect(await autoScore({})).toMatchObject({ warned: 1 });
  });

  test("a claude call with sidechain true is not a main-thread call", async () => {
    expect(await autoScore({ sidechain: true })).toMatchObject({ warned: 0, missed: 1 });
  });

  test('a claude call with entrypoint "sdk-cli" is not a main-thread call', async () => {
    expect(await autoScore({ entrypoint: "sdk-cli" })).toMatchObject({
      warned: 0,
      missed: 1,
    });
  });

  test("a codex call is not a main-thread call", async () => {
    expect(await autoScore({ runtime: "codex" })).toMatchObject({ warned: 0, missed: 1 });
  });

  test('a claude call with entrypoint "cli" and sidechain false is a main-thread call', async () => {
    expect(await autoScore({ entrypoint: "cli", sidechain: false })).toMatchObject({
      warned: 1,
    });
  });
});

describe("sessionSegments rows", () => {
  test("three calls then an auto compaction make one warned segment with 3 calls", async () => {
    const calls = [
      modelCallRow(0, { inputTokens: 100_000 }),
      modelCallRow(10, { inputTokens: 210_000 }),
      modelCallRow(30, { inputTokens: 250_000 }),
    ];
    expect(await scoreAt(calls, [compactionRow(40, "auto")], 200_000)).toMatchObject({
      warned: 1,
      missed: 0,
      falseAlarms: 0,
      medianLeadMinutes: 30,
      medianLeadTokens: 40_000,
    });
  });

  test("an auto compaction with no calls is one missed segment with 0 calls", async () => {
    expect(await scoreAt([], [compactionRow(40, "auto")], 200_000)).toMatchObject({
      warned: 0,
      missed: 1,
      falseAlarms: 0,
    });
  });

  test("two calls with no compaction are one open segment with 2 calls", async () => {
    const calls = [
      modelCallRow(0, { inputTokens: 100_000 }),
      modelCallRow(5, { inputTokens: 220_000 }),
    ];
    expect(await scoreAt(calls, [], 200_000)).toMatchObject({
      warned: 0,
      missed: 0,
      falseAlarms: 1,
    });
  });

  test("a call then a manual compaction is one segment with an end that is not auto", async () => {
    const calls = [modelCallRow(0, { inputTokens: 250_000 })];
    expect(await scoreAt(calls, [compactionRow(10, "manual")], 200_000)).toMatchObject({
      warned: 0,
      missed: 0,
      falseAlarms: 0,
    });
  });

  test("a main call with a sidechain and an sdk-cli call leaves only the main call", async () => {
    const calls = [
      modelCallRow(0, { inputTokens: 100_000 }),
      modelCallRow(5, { inputTokens: 300_000, sidechain: true }),
      modelCallRow(6, { inputTokens: 300_000, entrypoint: "sdk-cli" }),
    ];
    expect(await scoreAt(calls, [], 200_000)).toMatchObject({
      warned: 0,
      missed: 0,
      falseAlarms: 0,
    });
  });

  test("no events give no segments and zero counts", async () => {
    const { backtestRows } = await loadBacktest();
    expect(backtestRows([], [], [200_000])).toEqual([
      {
        threshold: 200_000,
        warned: 0,
        missed: 0,
        falseAlarms: 0,
        medianLeadMinutes: null,
        medianLeadTokens: null,
      },
    ]);
  });
});

describe("parsesAsTime rows", () => {
  test('a call with ts "2026-11-05T10:00:00.000Z" is kept', async () => {
    const calls = [
      modelCallRow(0, { inputTokens: 300_000, ts: "2026-11-05T10:00:00.000Z" }),
    ];
    expect(await scoreAt(calls, [compactionRow(40, "auto")], 200_000)).toMatchObject({
      warned: 1,
    });
  });

  test('a call with ts "soon" is dropped', async () => {
    const calls = [modelCallRow(0, { inputTokens: 300_000, ts: "soon" })];
    expect(await scoreAt(calls, [compactionRow(40, "auto")], 200_000)).toMatchObject({
      warned: 0,
      missed: 1,
    });
  });

  test("a call with no ts is dropped", async () => {
    const calls = [modelCallRow(0, { inputTokens: 300_000, ts: undefined })];
    expect(await scoreAt(calls, [compactionRow(40, "auto")], 200_000)).toMatchObject({
      warned: 0,
      missed: 1,
    });
  });

  test('a call with ts "" is dropped', async () => {
    const calls = [modelCallRow(0, { inputTokens: 300_000, ts: "" })];
    expect(await scoreAt(calls, [compactionRow(40, "auto")], 200_000)).toMatchObject({
      warned: 0,
      missed: 1,
    });
  });
});

describe("scoreSegments rows", () => {
  test("the seeded history at 200000 scores 1 warned, 1 missed, 1 false alarm, lead 30 and 40000", async () => {
    const { backtestRows } = await loadBacktest();
    const { calls, compactions } = literalSeed();
    expect(backtestRows(calls, compactions, [200_000])[0]).toEqual({
      threshold: 200_000,
      warned: 1,
      missed: 1,
      falseAlarms: 1,
      medianLeadMinutes: 30,
      medianLeadTokens: 40_000,
    });
  });

  test("the seeded history at 120000 scores 2 warned, 0 missed, 1 false alarm, lead 22.5 and 20000", async () => {
    const { backtestRows } = await loadBacktest();
    const { calls, compactions } = literalSeed();
    expect(backtestRows(calls, compactions, [120_000])[0]).toEqual({
      threshold: 120_000,
      warned: 2,
      missed: 0,
      falseAlarms: 1,
      medianLeadMinutes: 22.5,
      medianLeadTokens: 20_000,
    });
  });

  test("one auto segment with calls 210k and 230k and an end at minute 20 scores lead 20 and 20000", async () => {
    const calls = [
      modelCallRow(0, { inputTokens: 210_000 }),
      modelCallRow(5, { inputTokens: 230_000 }),
    ];
    expect(await scoreAt(calls, [compactionRow(20, "auto")], 200_000)).toEqual({
      threshold: 200_000,
      warned: 1,
      missed: 0,
      falseAlarms: 0,
      medianLeadMinutes: 20,
      medianLeadTokens: 20_000,
    });
  });

  test("the seeded history at 400000 scores 0 warned, 2 missed, and null leads", async () => {
    const { backtestRows } = await loadBacktest();
    const { calls, compactions } = literalSeed();
    expect(backtestRows(calls, compactions, [400_000])[0]).toEqual({
      threshold: 400_000,
      warned: 0,
      missed: 2,
      falseAlarms: 0,
      medianLeadMinutes: null,
      medianLeadTokens: null,
    });
  });

  test("an empty history at 200000 scores zeros and null leads", async () => {
    const { backtestRows } = await loadBacktest();
    expect(backtestRows([], [], [200_000])[0]).toEqual({
      threshold: 200_000,
      warned: 0,
      missed: 0,
      falseAlarms: 0,
      medianLeadMinutes: null,
      medianLeadTokens: null,
    });
  });

  test("one auto segment with 0 calls at 200000 scores 1 missed and null leads", async () => {
    expect(await scoreAt([], [compactionRow(40, "auto")], 200_000)).toEqual({
      threshold: 200_000,
      warned: 0,
      missed: 1,
      falseAlarms: 0,
      medianLeadMinutes: null,
      medianLeadTokens: null,
    });
  });
});

describe("backtestRows rows", () => {
  test("the seeded history at [200000] gives one row with 1, 1, 1, 30 and 40000", async () => {
    const { backtestRows } = await loadBacktest();
    const { calls, compactions } = literalSeed();
    expect(backtestRows(calls, compactions, [200_000])).toEqual([
      {
        threshold: 200_000,
        warned: 1,
        missed: 1,
        falseAlarms: 1,
        medianLeadMinutes: 30,
        medianLeadTokens: 40_000,
      },
    ]);
  });

  test("the seeded history at [120000, 400000] gives two rows in that order", async () => {
    const { backtestRows } = await loadBacktest();
    const { calls, compactions } = literalSeed();
    expect(backtestRows(calls, compactions, [120_000, 400_000])).toEqual([
      {
        threshold: 120_000,
        warned: 2,
        missed: 0,
        falseAlarms: 1,
        medianLeadMinutes: 22.5,
        medianLeadTokens: 20_000,
      },
      {
        threshold: 400_000,
        warned: 0,
        missed: 2,
        falseAlarms: 0,
        medianLeadMinutes: null,
        medianLeadTokens: null,
      },
    ]);
  });

  test("no events at [200000] gives one zero row with null leads", async () => {
    const { backtestRows } = await loadBacktest();
    expect(backtestRows([], [], [200_000])).toEqual([
      {
        threshold: 200_000,
        warned: 0,
        missed: 0,
        falseAlarms: 0,
        medianLeadMinutes: null,
        medianLeadTokens: null,
      },
    ]);
  });
});

function thresholdsOf(): number[] {
  return JSON.parse(printed[0] ?? "[]").map((r: { threshold: number }) => r.threshold);
}

describe("parseThresholds rows", () => {
  test("no --at uses the default threshold 200000", async () => {
    const { code } = await backtest("--json");
    expect(code).toBe(0);
    expect(thresholdsOf()).toEqual([200_000]);
  });

  test('"120000,400000" gives those two thresholds', async () => {
    const { code } = await backtest("--at", "120000,400000", "--json");
    expect(code).toBe(0);
    expect(thresholdsOf()).toEqual([120_000, 400_000]);
  });

  test('"lots" is a usage error with exit 1', async () => {
    expect((await backtest("--at", "lots")).code).toBe(1);
  });

  test('"150000," is a usage error with exit 1', async () => {
    expect((await backtest("--at", "150000,")).code).toBe(1);
  });

  test('"0" is a usage error with exit 1', async () => {
    expect((await backtest("--at", "0")).code).toBe(1);
  });

  test('"1e5" is a usage error with exit 1', async () => {
    expect((await backtest("--at", "1e5")).code).toBe(1);
  });

  test('"0x30D40" is a usage error with exit 1', async () => {
    expect((await backtest("--at", "0x30D40")).code).toBe(1);
  });

  test('"+150000" is a usage error with exit 1', async () => {
    expect((await backtest("--at", "+150000")).code).toBe(1);
  });

  test('" 150000, 200000" gives thresholds 150000 and 200000', async () => {
    const { code } = await backtest("--at", " 150000, 200000", "--json");
    expect(code).toBe(0);
    expect(thresholdsOf()).toEqual([150_000, 200_000]);
  });
});

describe("leadText rows", () => {
  test("a lead of 30 minutes reads 30.0", async () => {
    seedHistory();
    const { text } = await backtest("--at", "200000");
    expect(text).toContain("median lead 30.0 min");
  });

  test("a lead of 40000 tokens reads 40000", async () => {
    seedHistory();
    const { text } = await backtest("--at", "200000");
    expect(text).toContain("/ 40000 tokens");
  });

  test("a missing lead reads a dash", async () => {
    seedHistory();
    const { text } = await backtest("--at", "400000");
    expect(text).toContain("median lead - min / - tokens");
  });
});

describe("formatRow rows", () => {
  test("the 200000 row prints its exact line", async () => {
    seedHistory();
    await backtest("--at", "200000");
    expect(printed).toEqual([
      "at 200000 tokens: 1 warned, 1 missed, 1 false alarms, median lead 30.0 min / 40000 tokens",
    ]);
  });

  test("the 400000 row prints its exact line", async () => {
    seedHistory();
    await backtest("--at", "400000");
    expect(printed).toEqual([
      "at 400000 tokens: 0 warned, 2 missed, 0 false alarms, median lead - min / - tokens",
    ]);
  });

  test("the 120000 row prints its exact line", async () => {
    seedHistory();
    await backtest("--at", "120000");
    expect(printed).toEqual([
      "at 120000 tokens: 2 warned, 0 missed, 1 false alarms, median lead 22.5 min / 20000 tokens",
    ]);
  });
});
