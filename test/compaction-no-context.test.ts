import { beforeEach, expect, spyOn, test } from "bun:test";
import { runCompaction } from "../src/cli/compaction";
import { appendEvent } from "../src/hooks/lib/events";
import { freshTestDir } from "./lib/test-home";

let printed: string[];
let logSpy: ReturnType<typeof spyOn> | undefined;

beforeEach(() => {
  logSpy?.mockRestore();
  process.env.PAL_HOME = freshTestDir(import.meta.file);
  process.env.PAL_AGENT = "claude";
  delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  printed = [];
  logSpy = spyOn(console, "log").mockImplementation((...a) => printed.push(a.join(" ")));
});

const MIN = 60_000;
const BASE = Date.now() - 3 * 86_400_000;

type Labels = Record<string, number>;

async function labelsFor(
  contextTokens: number | undefined,
  window = "300000",
  withCall = true
) {
  const session = "s";
  if (withCall) {
    appendEvent(
      "model_call",
      { inputTokens: 99_000, cacheRead: 1000, cacheWrite5m: 0, cacheWrite1h: 0 },
      { ts: new Date(BASE).toISOString(), session, runtime: "claude" }
    );
  }
  appendEvent(
    "compaction",
    {
      trigger: "auto",
      withInstructions: false,
      ...(contextTokens === undefined ? {} : { contextTokens }),
    },
    { ts: new Date(BASE + 10 * MIN).toISOString(), session }
  );
  printed = [];
  await runCompaction(["backtest", "--window", window, "--json"]);
  return (JSON.parse(printed[0] ?? "{}") as { labels: Labels }).labels;
}

test("a compaction logged with 0 context tokens is no_context, not unexplained", async () => {
  expect(await labelsFor(0)).toEqual({
    threshold: 0,
    idle: 0,
    unexplained: 0,
    no_context: 1,
  });
});

test("a compaction logged without contextTokens is no_context", async () => {
  expect((await labelsFor(undefined)).no_context).toBe(1);
});

test("a 0-token compaction 54 minutes after the previous call is idle, since idle is checked before no_context", async () => {
  const session = "s";
  appendEvent(
    "model_call",
    { inputTokens: 249_000, cacheRead: 1000, cacheWrite5m: 0, cacheWrite1h: 0 },
    { ts: new Date(BASE).toISOString(), session, runtime: "claude" }
  );
  appendEvent(
    "compaction",
    { trigger: "auto", withInstructions: false, contextTokens: 0 },
    { ts: new Date(BASE + 54 * MIN).toISOString(), session }
  );
  await runCompaction(["backtest", "--window", "300000", "--json"]);
  const { labels } = JSON.parse(printed[0] ?? "{}") as { labels: Labels };
  expect(labels).toEqual({ threshold: 0, idle: 1, unexplained: 0, no_context: 0 });
});

test("a threshold compaction 14 tokens above the point (267 014 at 300k) is threshold", async () => {
  expect(await labelsFor(267_014)).toEqual({
    threshold: 1,
    idle: 0,
    unexplained: 0,
    no_context: 0,
  });
});

test("a threshold compaction 4 803 tokens above the point (271 803 at 300k) is threshold", async () => {
  expect((await labelsFor(271_803)).threshold).toBe(1);
});

test("8 001 tokens above the point is unexplained", async () => {
  expect(await labelsFor(275_001)).toEqual({
    threshold: 0,
    idle: 0,
    unexplained: 1,
    no_context: 0,
  });
});

test("the label counts line names no_context in text output", async () => {
  await labelsFor(0);
  printed = [];
  await runCompaction(["backtest", "--window", "300000"]);
  expect(printed.join("\n")).toContain("no_context");
});
