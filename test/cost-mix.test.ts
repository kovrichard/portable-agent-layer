import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { costCommand } from "../src/cli/cost";
import { appendEvent } from "../src/hooks/lib/events";
import { runCommand } from "../src/tools/lib/command";
import { modelMix, palSpend } from "../src/tools/lib/cost/mix";
import { shareLines } from "../src/tools/lib/cost/render";
import { budapestHome, event } from "./lib/wrapped-events";

beforeEach(() => {
  budapestHome(import.meta.file);
});

const call = (model: unknown, costUsd: number | null) =>
  event("model_call", costUsd === null ? { model } : { model, costUsd }, {
    runtime: costUsd === null ? "copilot" : "opencode",
  });

const spawn = (caller: unknown, costUsd: unknown) =>
  event("inference_call", { caller, costUsd, model: "m" }, { runtime: "opencode" });

describe("model mix", () => {
  test("costliest first, then most called, then by name; unpriced calls counted apart", () => {
    expect(
      modelMix([
        call("cheap", 1),
        call("busy", 1),
        call("busy", 0),
        call("dear", 3),
        call("dear", null),
        call("also-cheap", 1),
        call(undefined, null),
        event("inference_call", { model: "spawned", costUsd: 9 }),
      ])
    ).toEqual([
      { label: "dear", calls: 2, cost: 3, unpriced: 1 },
      { label: "busy", calls: 2, cost: 1, unpriced: 0 },
      { label: "also-cheap", calls: 1, cost: 1, unpriced: 0 },
      { label: "cheap", calls: 1, cost: 1, unpriced: 0 },
      { label: "unknown model", calls: 1, cost: 0, unpriced: 1 },
    ]);
  });
});

describe("PAL's own spend", () => {
  test("counts only PAL's spawns, priced by the cost they recorded", () => {
    expect(
      palSpend([
        spawn("rating", 0.5),
        spawn("rating", undefined),
        spawn(undefined, 0.25),
        call("dear", 3),
      ])
    ).toEqual([
      { label: "rating", calls: 2, cost: 0.5, unpriced: 1 },
      { label: "unknown caller", calls: 1, cost: 0.25, unpriced: 0 },
    ]);
  });
});

describe("shares as printed", () => {
  test("an all-unpriced share is unknown, not free", () => {
    expect(
      shareLines("Model mix", [
        { label: "dear", calls: 1200, cost: 3, unpriced: 2 },
        { label: "busy", calls: 1, cost: 1, unpriced: 0 },
        { label: "dark", calls: 2, cost: 0, unpriced: 2 },
      ])
    ).toEqual([
      "\n  Model mix\n",
      "         $3.00  dear  1,200 calls, 2 unpriced",
      "         $1.00  busy  1 call",
      "       unknown  dark  2 calls",
    ]);
    expect(shareLines("Model mix", [])).toEqual(["\n  Model mix\n", "    unknown"]);
  });
});

describe("pal cli cost", () => {
  test("prints the model mix and PAL's own spend", async () => {
    appendEvent("model_call", { model: "dear", costUsd: 2 }, { runtime: "opencode" });
    appendEvent(
      "inference_call",
      { caller: "rating", costUsd: 0.5 },
      { runtime: "claude" }
    );
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await runCommand(costCommand, [], ["pal", "cli", "cost"])).toBe(0);
      const text = log.mock.calls.join("\n");
      expect(text).toContain("Model mix\n\n         $2.00  dear  1 call");
      expect(text).toContain("already in the totals\n\n       $0.5000  rating  1 call");
    } finally {
      log.mockRestore();
    }
  });
});
