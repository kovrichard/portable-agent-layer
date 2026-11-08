import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { runCompaction } from "../src/cli/compaction";
import { COMPACTION_NEAR_THRESHOLD } from "../src/hooks/lib/compaction-near";
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
  printed = [];
  logSpy = spyOn(console, "log").mockImplementation((...a) => printed.push(a.join(" ")));
  errSpy = spyOn(console, "error").mockImplementation((...a) =>
    printed.push(a.join(" "))
  );
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
  const code = await runCompaction(["backtest", ...args]);
  return { code, text: printed.join("\n") };
}

describe("pal cli compaction backtest", () => {
  test("scores warned, missed, false alarm and lead at the default threshold", async () => {
    seedHistory();
    const { code } = await backtest("--json");
    expect(code).toBe(0);
    const [row] = JSON.parse(printed[0] ?? "[]");
    expect(row).toMatchObject({
      threshold: COMPACTION_NEAR_THRESHOLD,
      warned: 1,
      missed: 1,
      falseAlarms: 1,
      medianLeadMinutes: 30,
      medianLeadTokens: 40_000,
    });
  });

  test("a list of two thresholds gives one row and one line each", async () => {
    seedHistory();
    const json = await backtest("--at", "120000,400000", "--json");
    expect(json.code).toBe(0);
    const rows = JSON.parse(printed[0] ?? "[]");
    expect(rows.map((r: { threshold: number }) => r.threshold)).toEqual([
      120_000, 400_000,
    ]);
    expect(rows[0]).toMatchObject({ warned: 2, missed: 0, falseAlarms: 1 });
    expect(rows[1]).toMatchObject({
      warned: 0,
      missed: 2,
      falseAlarms: 0,
      medianLeadMinutes: null,
      medianLeadTokens: null,
    });

    printed = [];
    const plain = await backtest("--at", "120000,400000");
    expect(plain.code).toBe(0);
    expect(printed).toHaveLength(2);
    expect(printed[1]).toContain("-");
  });

  test("without --json it prints one line for the default threshold", async () => {
    seedHistory();
    const { code } = await backtest();
    expect(code).toBe(0);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain(String(COMPACTION_NEAR_THRESHOLD));
  });

  test("a compaction with no model calls counts as missed", async () => {
    compaction("bare", 5, "auto", 120_000);
    await backtest("--json");
    expect(JSON.parse(printed[0] ?? "[]")[0]).toMatchObject({
      warned: 0,
      missed: 1,
      falseAlarms: 0,
    });
  });

  test("an empty history and a long window report zeros without error", async () => {
    const { code } = await backtest("--days", "3650", "--json");
    expect(code).toBe(0);
    expect(JSON.parse(printed[0] ?? "[]")[0]).toMatchObject({
      warned: 0,
      missed: 0,
      falseAlarms: 0,
      medianLeadMinutes: null,
    });
  });

  test("--days excludes older history", async () => {
    seedHistory();
    await backtest("--days", "1", "--json");
    expect(JSON.parse(printed[0] ?? "[]")[0]).toMatchObject({ warned: 0, missed: 0 });
  });

  test("a non-numeric --at is a usage error with exit 1", async () => {
    const { code } = await backtest("--at", "lots");
    expect(code).toBe(1);
  });

  test("a bad --days is a usage error with exit 1", async () => {
    expect((await backtest("--days", "0")).code).toBe(1);
    expect((await backtest("--days", "soon")).code).toBe(1);
  });
});
