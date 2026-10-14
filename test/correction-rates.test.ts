import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendTurn, readTurns, type Turn } from "../src/hooks/lib/adaptation-turns";
import {
  backfillCorrectionKinds,
  unlabelledCorrections,
} from "../src/hooks/lib/correction-backfill";
import { kindRates, splitRates } from "../src/hooks/lib/correction-rates";
import { paths } from "../src/hooks/lib/paths";
import { freshTestDir } from "./lib/test-home";

function turn(ts: string, extra: Partial<Turn> = {}): Turn {
  return {
    ts,
    session: "s",
    message: "m",
    replyEnd: "r",
    reaction: "follow-up",
    issue: "",
    ...extra,
  };
}

function correction(ts: string, kind?: string, suggested = ""): Turn {
  return turn(ts, {
    reaction: "corrected",
    issue: "wrong",
    confirmed: true,
    ...(kind && { correctionKind: { kind, suggested, description: "", version: 1 } }),
  });
}

describe("kindRates", () => {
  test("counts each kind per 100 labelled turns", () => {
    const turns = [
      ...Array.from({ length: 7 }, (_, i) => turn(`2026-10-0${i + 1}T00:00:00.000Z`)),
      correction("2026-10-08T00:00:00.000Z", "unverified-claim"),
      correction("2026-10-09T00:00:00.000Z", "unverified-claim"),
      correction("2026-10-09T01:00:00.000Z", "other", "destructive-action"),
    ];
    const rates = kindRates(turns);
    expect(rates.turns).toBe(10);
    expect(rates.corrections).toBe(3);
    expect(rates.unlabelled).toBe(0);
    expect(rates.kinds).toEqual([
      { kind: "unverified-claim", count: 2, per100: 20, suggestions: [] },
      { kind: "other", count: 1, per100: 10, suggestions: ["destructive-action"] },
    ]);
  });

  test("an unconfirmed correction is no correction, and one without a kind shows as unlabelled", () => {
    const rates = kindRates([
      turn("2026-10-01T00:00:00.000Z", { reaction: "corrected", confirmed: false }),
      correction("2026-10-02T00:00:00.000Z"),
    ]);
    expect(rates.corrections).toBe(1);
    expect(rates.unlabelled).toBe(1);
    expect(rates.kinds).toEqual([]);
  });

  test("no turns is a zero rate, not a division by zero", () => {
    expect(kindRates([])).toEqual({ turns: 0, corrections: 0, unlabelled: 0, kinds: [] });
  });
});

test("splitRates puts a turn at the split date after it", () => {
  const { before, after } = splitRates(
    [
      correction("2026-10-09T23:59:59.000Z", "stopped-short"),
      correction("2026-10-10T00:00:00.000Z", "stopped-short"),
      turn("2026-10-11T00:00:00.000Z"),
    ],
    new Date("2026-10-10T00:00:00.000Z")
  );
  expect(before.turns).toBe(1);
  expect(after.turns).toBe(2);
  expect(after.kinds[0]).toMatchObject({ kind: "stopped-short", count: 1, per100: 50 });
});

describe("backfillCorrectionKinds", () => {
  beforeEach(() => {
    process.env.PAL_HOME = freshTestDir(import.meta.file);
  });

  function logTurns(): string[] {
    const dir = paths.adaptation();
    const file = resolve(dir, `turns-${new Date().toISOString().slice(0, 7)}.jsonl`);
    return existsSync(file) ? readFileSync(file, "utf-8").trim().split("\n") : [];
  }

  test("labels only confirmed corrections without a kind and keeps every other line", async () => {
    const now = new Date();
    const at = (offset: number) => new Date(now.getTime() - offset * 60_000);
    appendTurn(
      { session: "s", message: "go", replyEnd: "r", reaction: "approved", issue: "" },
      at(5)
    );
    appendTurn(
      {
        session: "s",
        message: "ci red",
        replyEnd: "green",
        reaction: "corrected",
        issue: "CI",
        confirmed: true,
      },
      at(4)
    );
    appendTurn(
      {
        session: "s",
        message: "x",
        replyEnd: "r",
        reaction: "corrected",
        issue: "x",
        confirmed: false,
      },
      at(3)
    );
    const before = logTurns();

    const seen: string[] = [];
    const result = await backfillCorrectionKinds(async (t) => {
      seen.push(t.message);
      return { kind: "unverified-claim", suggested: "", description: "" };
    });

    expect(seen).toEqual(["ci red"]);
    expect(result).toEqual({ labelled: 1, failed: 0 });
    const after = logTurns();
    expect(after).toHaveLength(before.length);
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
    expect(readTurns()[1].correctionKind).toEqual({
      kind: "unverified-claim",
      suggested: "",
      description: "",
      version: 1,
    });
    expect(unlabelledCorrections(readTurns())).toEqual([]);
  });

  test("a failed label leaves the turn for the next run", async () => {
    appendTurn({
      session: "s",
      message: "m",
      replyEnd: "r",
      reaction: "repeated",
      issue: "i",
      confirmed: true,
    });
    const result = await backfillCorrectionKinds(async () => null);
    expect(result).toEqual({ labelled: 0, failed: 1 });
    expect(unlabelledCorrections(readTurns())).toHaveLength(1);
  });
});
