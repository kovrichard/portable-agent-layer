import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { runCorrection } from "../src/cli/correction";
import { appendTurn, readTurns, type TurnInput } from "../src/hooks/lib/adaptation-turns";
import type { KindLabeller } from "../src/hooks/lib/correction-backfill";
import { freshTestDir } from "./lib/test-home";

let printed: string[];
let logSpy: ReturnType<typeof spyOn> | undefined;
let errSpy: ReturnType<typeof spyOn> | undefined;

beforeEach(() => {
  logSpy?.mockRestore();
  errSpy?.mockRestore();
  process.env.PAL_HOME = freshTestDir(import.meta.file);
  printed = [];
  logSpy = spyOn(console, "log").mockImplementation((...a) => printed.push(a.join(" ")));
  errSpy = spyOn(console, "error").mockImplementation((...a) =>
    printed.push(a.join(" "))
  );
});

const DAY_MS = 86_400_000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

function ordinary(): TurnInput {
  return { session: "s", message: "go", replyEnd: "r", reaction: "approved", issue: "" };
}

function corrected(kind?: string, suggested = ""): TurnInput {
  return {
    session: "s",
    message: "wrong",
    replyEnd: "r",
    reaction: "corrected",
    issue: "Said CI was green",
    confirmed: true,
    ...(kind && { correctionKind: { kind, suggested, description: "", version: 1 } }),
  };
}

function output(): string {
  return printed.join("\n");
}

describe("pal cli correction kinds", () => {
  test("prints each kind with its count and rate per 100 turns, and other's names", async () => {
    for (let i = 0; i < 7; i++) appendTurn(ordinary(), daysAgo(3));
    appendTurn(corrected("unverified-claim"), daysAgo(2));
    appendTurn(corrected("other", "destructive-action"), daysAgo(2));
    appendTurn(corrected(), daysAgo(1));

    expect(await runCorrection(["kinds"])).toBe(0);
    expect(output()).toBe(
      [
        "Last 30 days: 10 turns, 3 confirmed corrections, 1 without a kind",
        "  kind                     n   /100",
        "  other                    1   10.0  (destructive-action)",
        "  unverified-claim         1   10.0",
      ].join("\n")
    );
  });

  test("--days narrows the window", async () => {
    appendTurn(corrected("stopped-short"), daysAgo(5));
    appendTurn(ordinary(), daysAgo(0.5));

    expect(await runCorrection(["kinds", "--days", "1"])).toBe(0);
    expect(output().split("\n")[0]).toBe(
      "Last 1 days: 1 turns, 0 confirmed corrections, 0 without a kind"
    );
  });

  test("--split prints the rates before and from the date", async () => {
    appendTurn(corrected("stopped-short"), daysAgo(4));
    appendTurn(ordinary(), daysAgo(1));
    const split = daysAgo(2).toISOString().slice(0, 10);

    expect(await runCorrection(["kinds", "--split", split])).toBe(0);
    const [before, after] = output().split("\n\n");
    expect(before).toStartWith(`Before ${split}: 1 turns, 1 confirmed corrections`);
    expect(before).toContain("stopped-short");
    expect(after).toStartWith(`From ${split}: 1 turns, 0 confirmed corrections`);
  });

  test("--json prints the rates as data", async () => {
    appendTurn(corrected("wrong-format"), daysAgo(1));

    expect(await runCorrection(["kinds", "--json"])).toBe(0);
    expect(JSON.parse(output())).toEqual({
      turns: 1,
      corrections: 1,
      unlabelled: 0,
      kinds: [{ kind: "wrong-format", count: 1, per100: 100, suggestions: [] }],
    });
  });

  test.each([["0"], ["1.5"], ["x"]])("--days %s is refused", async (days) => {
    expect(await runCorrection(["kinds", "--days", days])).toBe(1);
    expect(output()).toContain(`--days must be a whole number of days, got "${days}"`);
  });

  test("an unreadable --split date is refused", async () => {
    expect(await runCorrection(["kinds", "--split", "soon"])).toBe(1);
    expect(output()).toContain(`--split must be a date such as 2026-10-20, got "soon"`);
  });
});

describe("pal cli correction backfill", () => {
  const labelling =
    (kind: "unverified-claim" | "stopped-short"): KindLabeller =>
    async () => ({ kind, suggested: "", description: "" });

  test("labels each unlabelled correction and reports the count", async () => {
    appendTurn(corrected(), daysAgo(1));
    appendTurn(ordinary(), daysAgo(1));

    expect(await runCorrection(["backfill"], labelling("unverified-claim"))).toBe(0);
    expect(printed[0]).toEndWith("  unverified-claim  Said CI was green");
    expect(printed[1]).toBe("Labelled 1, failed 0.");
  });

  test("a failed label is reported and exits 1", async () => {
    appendTurn(corrected(), daysAgo(1));

    expect(await runCorrection(["backfill"], async () => null)).toBe(1);
    expect(printed[0]).toEndWith("  failed  Said CI was green");
    expect(printed[1]).toBe("Labelled 0, failed 1.");
  });

  test("--relabel replaces kinds already stored", async () => {
    appendTurn(corrected("unverified-claim"), daysAgo(1));

    expect(await runCorrection(["backfill"], labelling("stopped-short"))).toBe(0);
    expect(readTurns()[0].correctionKind?.kind).toBe("unverified-claim");
    expect(
      await runCorrection(["backfill", "--relabel"], labelling("stopped-short"))
    ).toBe(0);
    expect(readTurns()[0].correctionKind?.kind).toBe("stopped-short");
  });
});
