import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { runCompaction } from "../src/cli/compaction";
import { appendEvent } from "../src/hooks/lib/events";
import { freshTestDir } from "./lib/test-home";

let printed: string[];
let logSpy: ReturnType<typeof spyOn> | undefined;
let errSpy: ReturnType<typeof spyOn> | undefined;

beforeEach(() => {
  logSpy?.mockRestore();
  errSpy?.mockRestore();
  process.env.PAL_HOME = freshTestDir(import.meta.file);
  process.env.PAL_AGENT = "claude";
  delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  printed = [];
  logSpy = spyOn(console, "log").mockImplementation((...a) => printed.push(a.join(" ")));
  errSpy = spyOn(console, "error").mockImplementation((...a) =>
    printed.push(a.join(" "))
  );
});

const MIN = 60_000;
const BASE = Date.now() - 3 * 86_400_000;
const at = (minute: number) => new Date(BASE + minute * MIN).toISOString();

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
    { ts: at(minute), session, runtime: "claude" }
  );
}

function compaction(session: string, minute: number, trigger: string, tokens: number) {
  appendEvent(
    "compaction",
    { trigger, withInstructions: false, contextTokens: tokens },
    { ts: at(minute), session }
  );
}

/** Window 500k: compaction point 467k, W 480k, margin 96k, reached from 371k. */
function seedHistory() {
  call("warned", 0, 100_000);
  call("warned", 10, 300_000);
  call("warned", 20, 380_000);
  call("warned", 30, 440_000);
  compaction("warned", 40, "auto", 462_000);

  call("missed", 0, 100_000);
  call("missed", 5, 300_000);
  compaction("missed", 20, "auto", 465_000);

  call("alarm", 0, 100_000);
  call("alarm", 5, 400_000);

  call("idle", 0, 250_000);
  compaction("idle", 100, "auto", 250_000);

  call("lost", 0, 100_000);
  call("lost", 10, 150_000);
  compaction("lost", 20, "auto", 150_000);

  call("quiet", 0, 100_000);
  call("quiet", 5, 400_000, { sidechain: true });
  call("quiet", 6, 400_000, { entrypoint: "sdk-cli" });

  call("manual", 0, 250_000);
  compaction("manual", 10, "manual", 465_000);
}

async function backtest(...args: string[]) {
  const code = await runCompaction(["backtest", ...args]);
  return { code, text: printed.join("\n") };
}

function json() {
  return JSON.parse(printed[0] ?? "{}") as {
    labels: { threshold: number; idle: number; unexplained: number };
    rows: Record<string, number | null>[];
  };
}

describe("pal cli compaction backtest", () => {
  test("labels each auto compaction and scores the default margin", async () => {
    seedHistory();
    const { code } = await backtest("--window", "500000", "--json");
    expect(code).toBe(0);
    const result = json();
    expect(result.labels).toEqual({ threshold: 2, idle: 1, unexplained: 1 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      margin: 0.2,
      warned: 1,
      missed: 1,
      falseAlarms: 1,
      medianLeadMinutes: 20,
      medianLeadTokens: 60_000,
    });
  });

  test("two margins give two rows and one line each plus a label line", async () => {
    seedHistory();
    await backtest("--window", "500000", "--margin", "0.2,0.5", "--json");
    const rows = json().rows;
    expect(rows.map((r) => r.margin)).toEqual([0.2, 0.5]);
    expect(rows[1]).toMatchObject({
      warned: 2,
      missed: 0,
      falseAlarms: 1,
      medianLeadMinutes: 22.5,
      medianLeadTokens: 70_000,
    });

    printed = [];
    const plain = await backtest("--window", "500000", "--margin", "0.2,0.5");
    expect(plain.code).toBe(0);
    expect(printed).toHaveLength(3);
  });

  test("without --json the default margin prints one line plus the label counts", async () => {
    seedHistory();
    const { code } = await backtest("--window", "500000");
    expect(code).toBe(0);
    expect(printed).toHaveLength(2);
  });

  test("a margin no call reaches warns nothing and has null leads", async () => {
    call("s", 0, 100_000);
    call("s", 5, 120_000);
    compaction("s", 20, "auto", 465_000);
    await backtest("--window", "500000", "--json");
    expect(json().rows[0]).toMatchObject({
      warned: 0,
      missed: 1,
      falseAlarms: 0,
      medianLeadMinutes: null,
      medianLeadTokens: null,
    });
  });

  test("a threshold compaction with no model calls counts as missed, not idle", async () => {
    compaction("bare", 5, "auto", 465_000);
    await backtest("--window", "500000", "--json");
    expect(json().labels).toEqual({ threshold: 1, idle: 0, unexplained: 0 });
    expect(json().rows[0]).toMatchObject({ warned: 0, missed: 1 });
  });

  test("a compaction with no previous call and no threshold match is unexplained", async () => {
    compaction("bare", 5, "auto", 150_000);
    await backtest("--window", "500000", "--json");
    expect(json().labels).toEqual({ threshold: 0, idle: 0, unexplained: 1 });
  });

  test("the same history scores differently under two window schedules", async () => {
    seedHistory();
    await backtest("--window", "300000", "--json");
    expect(json().labels.threshold).toBe(0);

    printed = [];
    await backtest("--window", "500000", "--json");
    expect(json().labels.threshold).toBe(2);

    printed = [];
    const later = new Date(Date.now() + MIN * 60).toISOString();
    await backtest("--window", `300000@${later}`, "--window", "500000", "--json");
    expect(json().labels.threshold).toBe(0);

    printed = [];
    await backtest("--window", `300000@${at(-24 * 60)}`, "--window", "500000", "--json");
    expect(json().labels.threshold).toBe(2);
  });

  test("a compaction_near event supplies the window for its moment", async () => {
    appendEvent(
      "compaction_near",
      {
        mode: "shadow",
        trigger: "threshold",
        contextTokens: 100_000,
        windowTokens: 300_000,
        windowSource: "env",
        compactAtTokens: 267_000,
        tokensLeft: 167_000,
        marginTokens: 96_000,
        predicted: false,
      },
      { ts: at(1), session: "near" }
    );
    call("near", 0, 100_000);
    compaction("near", 10, "auto", 265_000);
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = "500000";
    await backtest("--json");
    expect(json().labels.threshold).toBe(1);
  });

  test("with no --window the env var window is the current window", async () => {
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = "500000";
    call("s", 0, 100_000);
    compaction("s", 10, "auto", 465_000);
    await backtest("--json");
    expect(json().labels.threshold).toBe(1);
  });

  test("--days excludes older history", async () => {
    seedHistory();
    await backtest("--window", "500000", "--days", "1", "--json");
    expect(json().labels).toEqual({ threshold: 0, idle: 0, unexplained: 0 });
  });

  test("an empty history reports zeros without error", async () => {
    const { code } = await backtest("--window", "500000", "--days", "3650", "--json");
    expect(code).toBe(0);
    expect(json().rows[0]).toMatchObject({ warned: 0, missed: 0, falseAlarms: 0 });
  });

  test("a margin outside (0, 1) is a usage error with exit 1", async () => {
    expect((await backtest("--margin", "1.5")).code).toBe(1);
    expect((await backtest("--margin", "0")).code).toBe(1);
    expect((await backtest("--margin", "0.2,abc")).code).toBe(1);
  });

  test("a malformed --window is a usage error with exit 1", async () => {
    expect((await backtest("--window", "lots")).code).toBe(1);
    expect((await backtest("--window", "500000@never")).code).toBe(1);
  });

  test("a bad --days is a usage error with exit 1", async () => {
    expect((await backtest("--days", "0")).code).toBe(1);
    expect((await backtest("--days", "soon")).code).toBe(1);
  });
});
