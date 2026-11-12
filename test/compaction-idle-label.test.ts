import { beforeEach, describe, expect, spyOn, test } from "bun:test";
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

async function labelsAfterGap(gapMinutes: number) {
  const session = "s";
  appendEvent(
    "model_call",
    { inputTokens: 249_000, cacheRead: 1000, cacheWrite5m: 0, cacheWrite1h: 0 },
    { ts: new Date(BASE).toISOString(), session, runtime: "claude" }
  );
  appendEvent(
    "compaction",
    { trigger: "auto", withInstructions: false, contextTokens: 250_000 },
    { ts: new Date(BASE + gapMinutes * MIN).toISOString(), session }
  );
  await runCompaction(["backtest", "--window", "500000", "--json"]);

  return (JSON.parse(printed[0] ?? "{}") as { labels: Record<string, number> }).labels;
}

describe("idle label cutoff is 52 minutes", () => {
  test("a compaction 53.9 minutes after the previous call is idle", async () => {
    expect(await labelsAfterGap(53.9)).toEqual({
      threshold: 0,
      idle: 1,
      unexplained: 0,
      no_context: 0,
    });
  });

  test("a compaction exactly 52 minutes after the previous call is idle", async () => {
    expect(await labelsAfterGap(52)).toEqual({
      threshold: 0,
      idle: 1,
      unexplained: 0,
      no_context: 0,
    });
  });

  test("a compaction 51 minutes after the previous call is unexplained", async () => {
    expect(await labelsAfterGap(51)).toEqual({
      threshold: 0,
      idle: 0,
      unexplained: 1,
      no_context: 0,
    });
  });
});
