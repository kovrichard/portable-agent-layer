import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendTurn, readTurns, type Turn } from "../src/hooks/lib/adaptation-turns";
import {
  backfillCorrectionKinds,
  correctionsToLabel,
} from "../src/hooks/lib/correction-backfill";
import { CORRECTION_KINDS_VERSION } from "../src/hooks/lib/correction-kind";
import { kindRates, opinionEffect, splitRates } from "../src/hooks/lib/correction-rates";
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
    ...(kind && {
      correctionKind: {
        kind,
        suggested,
        description: "",
        version: CORRECTION_KINDS_VERSION,
      },
    }),
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
    expect(kindRates([])).toEqual({
      turns: 0,
      corrections: 0,
      unlabelled: 0,
      stale: 0,
      kinds: [],
    });
  });

  test("a kind from an older labelling counts as stale", () => {
    const stale = turn("2026-10-01T00:00:00.000Z", {
      reaction: "corrected",
      confirmed: true,
      correctionKind: {
        kind: "stopped-short",
        suggested: "",
        description: "",
        version: 1,
      },
    });
    const current = correction("2026-10-02T00:00:00.000Z", "stopped-short");

    expect(kindRates([stale, current]).stale).toBe(1);
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

describe("opinionEffect", () => {
  const HOUR_MS = 3_600_000;
  const approvedAt = new Date("2026-10-10T00:00:00.000Z");
  const at = (hours: number) =>
    new Date(approvedAt.getTime() + hours * HOUR_MS).toISOString();
  const ordinaryTurns = (count: number, fromHour: number) =>
    Array.from({ length: count }, (_, i) => turn(at(fromHour + i / count)));

  test("compares the kind's rate in equal windows before and after approval", () => {
    const turns = [
      turn(at(-30)),
      correction(at(-3), "status-quo-bias"),
      correction(at(-2), "status-quo-bias"),
      correction(at(-1), "unverified-claim"),
      ...ordinaryTurns(7, -1),
      correction(at(1), "status-quo-bias"),
      ...ordinaryTurns(9, 1),
    ];

    const effect = opinionEffect(
      "status-quo-bias",
      approvedAt,
      turns,
      ["status-quo-bias"],
      new Date(at(5))
    );

    expect(effect.before).toEqual({ turns: 10, count: 2, per100: 20 });
    expect(effect.after).toEqual({ turns: 10, count: 1, per100: 10 });
    expect(effect.control.before).toEqual({ turns: 10, count: 1, per100: 10 });
    expect(effect.verdict).toBe("too-early");
  });

  const corrections = (count: number, kind: string, fromHour: number) =>
    Array.from({ length: count }, (_, i) => correction(at(fromHour + i / 10), kind));

  function effectOf(after: Turn[], before: Turn[] = []) {
    const defaultBefore = [
      ...corrections(5, "status-quo-bias", -2),
      ...corrections(5, "unverified-claim", -3),
      ...ordinaryTurns(190, -24),
    ];
    return opinionEffect(
      "status-quo-bias",
      approvedAt,
      [...(before.length ? before : defaultBefore), ...after],
      ["status-quo-bias", "wrong-format"],
      new Date(at(48))
    );
  }

  test("an opinion's kind dropping while the other kinds hold is lower", () => {
    const effect = effectOf([
      ...corrections(2, "status-quo-bias", 1),
      ...corrections(5, "unverified-claim", 2),
      ...ordinaryTurns(193, 3),
    ]);

    expect(effect.verdict).toBe("lower");
  });

  test("every kind dropping together is not credited to the opinion", () => {
    const effect = effectOf([
      ...corrections(2, "status-quo-bias", 1),
      ...corrections(1, "unverified-claim", 2),
      ...ordinaryTurns(197, 3),
    ]);

    expect(effect.control.after.count).toBe(1);
    expect(effect.verdict).toBe("not-lower");
  });

  test("another opinion's kind is left out of the control", () => {
    const effect = effectOf([
      ...corrections(9, "wrong-format", 1),
      ...ordinaryTurns(191, 3),
    ]);

    expect(effect.control.after.count).toBe(0);
  });

  test("before 200 turns, or with under 5 corrections before, there is no verdict", () => {
    expect(effectOf(ordinaryTurns(199, 1)).verdict).toBe("too-early");
    const thin = [...corrections(4, "status-quo-bias", -2), ...ordinaryTurns(196, -24)];
    expect(effectOf(ordinaryTurns(200, 1), thin).verdict).toBe("too-few");
  });

  test("a correction labelled by an older prompt in either window withholds the verdict", () => {
    const old = turn(at(2), {
      reaction: "corrected",
      confirmed: true,
      correctionKind: {
        kind: "wrong-format",
        suggested: "",
        description: "",
        version: 1,
      },
    });
    const effect = effectOf([
      ...corrections(2, "status-quo-bias", 1),
      old,
      ...ordinaryTurns(197, 3),
    ]);

    expect(effect.verdict).toBe("stale-labels");
  });
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
    const result = await backfillCorrectionKinds({
      label: async (t) => {
        seen.push(t.message);
        return { kind: "unverified-claim", suggested: "", description: "" };
      },
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
      version: CORRECTION_KINDS_VERSION,
    });
    expect(correctionsToLabel(readTurns())).toEqual([]);
  });

  test("a relabel labels every confirmed correction again", async () => {
    appendTurn({
      session: "s",
      message: "m",
      replyEnd: "r",
      reaction: "corrected",
      issue: "i",
      confirmed: true,
    });
    const label = (kind: "unverified-claim" | "stopped-short") => async () => ({
      kind,
      suggested: "",
      description: "",
    });
    await backfillCorrectionKinds({ label: label("unverified-claim") });
    expect(await backfillCorrectionKinds({ label: label("stopped-short") })).toEqual({
      labelled: 0,
      failed: 0,
    });
    expect(
      await backfillCorrectionKinds({ label: label("stopped-short"), relabel: true })
    ).toEqual({ labelled: 1, failed: 0 });
    expect(readTurns()[0].correctionKind?.kind).toBe("stopped-short");
  });

  test("a kind from an older labelling is labelled again without --relabel", async () => {
    appendTurn({
      session: "s",
      message: "m",
      replyEnd: "r",
      reaction: "corrected",
      issue: "i",
      confirmed: true,
      correctionKind: {
        kind: "wrong-format",
        suggested: "",
        description: "",
        version: 1,
      },
    });

    const result = await backfillCorrectionKinds({
      label: async () => ({ kind: "stopped-short", suggested: "", description: "" }),
    });

    expect(result).toEqual({ labelled: 1, failed: 0 });
    expect(readTurns()[0].correctionKind).toMatchObject({
      kind: "stopped-short",
      version: CORRECTION_KINDS_VERSION,
    });
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
    const result = await backfillCorrectionKinds({ label: async () => null });
    expect(result).toEqual({ labelled: 0, failed: 1 });
    expect(correctionsToLabel(readTurns())).toHaveLength(1);
  });
});
