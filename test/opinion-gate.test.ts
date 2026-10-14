import { describe, expect, test } from "bun:test";
import type { AdaptationRule } from "../src/hooks/lib/adaptation-rules";
import type { Turn } from "../src/hooks/lib/adaptation-turns";
import { CORRECTION_KINDS_VERSION } from "../src/hooks/lib/correction-kind";
import { gateAdvice, opinionGate } from "../src/hooks/lib/opinion-gate";

const KIND = "unverified-claim";
const approvedAt = Date.parse("2026-09-01T00:00:00.000Z");
const now = new Date(approvedAt + 10 * 86_400_000);
const at = (dayOffset: number, i: number) =>
  new Date(approvedAt + dayOffset * 86_400_000 + i * 1000).toISOString();

const turn = (ts: string, extra: Partial<Turn> = {}): Turn => ({
  ts,
  session: "s",
  message: "m",
  replyEnd: "r",
  reaction: "follow-up",
  issue: "",
  ...extra,
});

const correction = (ts: string, kind = KIND, version = CORRECTION_KINDS_VERSION) =>
  turn(ts, {
    reaction: "corrected",
    confirmed: true,
    correctionKind: { kind, suggested: "", description: "", version },
  });

const corrections = (count: number, day = -1, kind = KIND) =>
  Array.from({ length: count }, (_, i) => correction(at(day, i), kind));
const ordinary = (count: number, day: number) =>
  Array.from({ length: count }, (_, i) => turn(at(day, 100 + i)));

const rule = (over: Partial<AdaptationRule>): AdaptationRule => ({
  id: "o1",
  when: "w",
  steering: "s",
  evidence: [],
  status: "approved",
  delivery: "always",
  kind: KIND,
  createdAt: new Date(approvedAt).toISOString(),
  decidedAt: new Date(approvedAt).toISOString(),
  ...over,
});

describe("opinionGate", () => {
  test("opens at five current corrections of the kind", () => {
    expect(opinionGate(KIND, [], corrections(5))).toBeUndefined();
    expect(opinionGate(KIND, [], corrections(4))).toEqual({ corrections: 4 });
  });

  test("counts neither other kinds, stale labels nor unconfirmed turns", () => {
    const turns = [
      ...corrections(4),
      correction(at(-1, 50), "off-instruction"),
      correction(at(-1, 51), KIND, CORRECTION_KINDS_VERSION - 1),
      { ...correction(at(-1, 52)), confirmed: false },
    ];

    expect(opinionGate(KIND, [], turns)).toEqual({ corrections: 4 });
  });

  test("an approved opinion of the kind closes it, whatever the count", () => {
    expect(opinionGate(KIND, [rule({})], corrections(9))).toEqual({ duplicates: "o1" });
  });

  test("an undecided draft offering an opinion of the kind closes it", () => {
    const pending = rule({ id: "d1", status: "draft", delivery: undefined });

    expect(opinionGate(KIND, [pending], corrections(9))).toEqual({ duplicates: "d1" });
  });

  test("ignores rules that offer no opinion of the kind", () => {
    const rules = [
      rule({ id: "t1", delivery: undefined }),
      rule({ id: "o2", kind: "off-instruction" }),
      rule({ id: "r1", status: "retired" }),
      rule({ id: "d1", status: "draft", widens: "t1" }),
      rule({ id: "d2", status: "draft", opinionGate: { corrections: 2 } }),
    ];

    expect(opinionGate(KIND, rules, corrections(5))).toBeUndefined();
  });
});

describe("gateAdvice", () => {
  const draft = (over: Partial<AdaptationRule>) =>
    rule({ id: "d9", status: "draft", delivery: undefined, ...over });

  test("says nothing for an open gate or a decided rule", () => {
    expect(gateAdvice(draft({}), [], [], now)).toBeUndefined();
    const decided = rule({ opinionGate: { corrections: 2 } });
    expect(gateAdvice(decided, [], [], now)).toBeUndefined();
  });

  test("names how many corrections the kind has", () => {
    const gated = draft({ opinionGate: { corrections: 3 } });

    expect(gateAdvice(gated, [], [], now)).toBe(
      "3 corrections of its kind so far; an opinion needs 5"
    );
  });

  const duplicate = draft({ opinionGate: { duplicates: "o1" } });
  const before = [...ordinary(200, -1), ...corrections(5, -1)];

  test("suggests promoting an opinion that lowers its kind", () => {
    const turns = [...before, ...ordinary(200, 1)];

    expect(gateAdvice(duplicate, [rule({})], turns, now)).toStartWith(
      "opinion o1 lowers its kind, so this is a variant; promote o1"
    );
  });

  test("suggests rewording an opinion that does not lower its kind", () => {
    const turns = [...before, ...ordinary(200, 1), ...corrections(10, 1)];

    expect(gateAdvice(duplicate, [rule({})], turns, now)).toStartWith(
      "opinion o1 is not lowering its kind; reword o1"
    );
  });

  test("holds a duplicate while the opinion's effect is not measurable", () => {
    const turns = [...before, ...ordinary(50, 1)];

    expect(gateAdvice(duplicate, [rule({})], turns, now)).toBe(
      "opinion o1's effect is not measurable yet (too-early); held beside it"
    );
  });

  test("holds a duplicate of an opinion that cannot be measured at all", () => {
    const undated = rule({ decidedAt: undefined });

    expect(gateAdvice(duplicate, [undated], before, now)).toBe(
      "opinion o1's effect is not measurable yet (no effect); held beside it"
    );
  });

  test("points at an undecided draft, or a target no longer active", () => {
    const pending = rule({ id: "o1", status: "draft", delivery: undefined });

    expect(gateAdvice(duplicate, [pending], [], now)).toBe(
      "draft o1 already offers an opinion for this kind; decide it first"
    );
    expect(gateAdvice(duplicate, [rule({ status: "retired" })], [], now)).toBe(
      "o1 targeted this kind and is no longer active"
    );
    expect(gateAdvice(duplicate, [], [], now)).toBe(
      "o1 targeted this kind and is no longer active"
    );
  });
});
