import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addDraft,
  addOpinion,
  type DraftInput,
  decideRule,
  isOpinion,
  isTriggerRule,
  type OpinionInput,
  opinionsContext,
  readRules,
  retireRule,
  rulesPath,
} from "../src/hooks/lib/adaptation-rules";
import { CORRECTION_KINDS } from "../src/hooks/lib/correction-kind";
import { freshTestDir } from "./lib/test-home";

let HOME: string;

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
  process.env.PAL_HOME = HOME;
});

const draft: DraftInput = {
  when: "The user proposes a design and asks for an opinion",
  trigger: { side: "prompt", pattern: "what do you think" },
  steering: "Give a verdict; when you disagree, give an alternative.",
  evidence: ["The user had to ask for an alternative twice."],
};

describe("rulesPath", () => {
  test("lives in the adaptation directory of the active home", () => {
    expect(rulesPath()).toBe(resolve(HOME, "memory", "adaptation", "rules.json"));
  });
});

describe("addDraft", () => {
  test("stores a new rule as a draft", () => {
    const rule = addDraft(draft);

    expect(rule.status).toBe("draft");
    expect(readRules()).toEqual([rule]);
  });

  test("gives each draft its own id", () => {
    const a = addDraft(draft);
    const b = addDraft(draft);

    expect(a.id).not.toBe(b.id);
  });
});

describe("readRules", () => {
  test("no file reads as no rules", () => {
    expect(readRules()).toEqual([]);
  });

  test("a corrupt file reads as no rules", () => {
    mkdirSync(resolve(HOME, "memory", "adaptation"), { recursive: true });
    writeFileSync(rulesPath(), "{ not json", "utf-8");

    expect(readRules()).toEqual([]);
  });
});

describe("decideRule", () => {
  test("approving a draft makes it approved and stamps the decision", () => {
    const { id } = addDraft(draft);

    const result = decideRule(id, "approved");

    expect(result.ok).toBe(true);
    const [rule] = readRules();
    expect(rule.status).toBe("approved");
    expect(rule.decidedAt).toBeDefined();
  });

  test("a denied draft stays on record so it is not drafted again", () => {
    const { id } = addDraft(draft);

    decideRule(id, "denied");

    expect(readRules().map((r) => r.status)).toEqual(["denied"]);
  });

  test("only the named draft changes", () => {
    const a = addDraft(draft);
    const b = addDraft(draft);

    decideRule(a.id, "approved");

    expect(readRules().find((r) => r.id === b.id)?.status).toBe("draft");
  });

  test("an unknown id is refused", () => {
    expect(decideRule("nope", "approved")).toEqual({
      ok: false,
      reason: "No rule with id nope",
    });
  });

  test("a rule that was already decided is refused", () => {
    const { id } = addDraft(draft);
    decideRule(id, "denied");

    const result = decideRule(id, "approved");

    expect(result.ok).toBe(false);
    expect(readRules()[0].status).toBe("denied");
  });

  test("approving a widening gives its rule the wider trigger and folds the draft in", () => {
    const rule = addDraft(draft);
    decideRule(rule.id, "approved");
    const proof = { firedCorrections: 1, corrections: 1, firedOrdinary: 0, ordinary: 20 };
    const widening = addDraft({
      ...draft,
      trigger: { side: "prompt", pattern: "what do you think|honest take" },
      evidence: ["no verdict: honest take?"],
      proof,
      widens: rule.id,
    });

    const result = decideRule(widening.id, "approved");

    expect(result.ok).toBe(true);
    expect(readRules()).toEqual([
      expect.objectContaining({
        id: rule.id,
        status: "approved",
        trigger: { side: "prompt", pattern: "what do you think|honest take" },
        evidence: [...draft.evidence, "no verdict: honest take?"],
        proof,
      }),
    ]);
  });

  test("a denied widening stays on record and leaves its rule alone", () => {
    const rule = addDraft(draft);
    decideRule(rule.id, "approved");
    const widening = addDraft({
      ...draft,
      trigger: { side: "prompt", pattern: "x|y" },
      widens: rule.id,
    });

    decideRule(widening.id, "denied");

    expect(readRules().map((r) => [r.status, r.trigger?.pattern])).toEqual([
      ["approved", "what do you think"],
      ["denied", "x|y"],
    ]);
  });

  test("a widening whose rule is no longer approved is refused", () => {
    const rule = addDraft(draft);
    const widening = addDraft({ ...draft, widens: rule.id });

    const result = decideRule(widening.id, "approved");

    expect(result.ok).toBe(false);
    expect(readRules().map((r) => r.status)).toEqual(["draft", "draft"]);
  });

  test("the file stays valid JSON after a decision", () => {
    const { id } = addDraft(draft);
    decideRule(id, "approved");

    expect(() => JSON.parse(readFileSync(rulesPath(), "utf-8"))).not.toThrow();
  });

  test("keeping a draft as an opinion approves it to steer every session", () => {
    const { id } = addDraft({ ...draft, kind: "no-verdict" });

    expect(decideRule(id, "opinion").ok).toBe(true);
    const [rule] = readRules();
    expect(rule).toMatchObject({ status: "approved", delivery: "always" });
    expect(isOpinion(rule)).toBe(true);
    expect(isTriggerRule(rule)).toBe(false);
  });

  test("a widening cannot be kept as an opinion", () => {
    const rule = addDraft(draft);
    decideRule(rule.id, "approved");
    const widening = addDraft({ ...draft, widens: rule.id });

    expect(decideRule(widening.id, "opinion")).toEqual({
      ok: false,
      reason: `Rule ${widening.id} widens a trigger; it cannot be an opinion`,
    });
  });

  test("a draft without a kind cannot be kept as an opinion", () => {
    const { id } = addDraft(draft);

    expect(decideRule(id, "opinion")).toEqual({
      ok: false,
      reason: `Rule ${id} has no correction kind, so its effect could not be measured`,
    });
  });

  test("an opinion-only draft can be kept as an opinion or denied, not approved", () => {
    const opinionOnly = { ...draft, kind: "no-verdict", offer: "opinion-only" as const };
    const { id } = addDraft(opinionOnly);

    expect(decideRule(id, "approved")).toEqual({
      ok: false,
      reason: `Rule ${id}'s trigger did not prove; keep it as an opinion or deny it`,
    });
    expect(decideRule(id, "opinion").ok).toBe(true);
    expect(decideRule(addDraft(opinionOnly).id, "denied").ok).toBe(true);
  });

  test("an opinion past the cap is refused and stays a draft", () => {
    const ofKindDraft = (i: number) => addDraft({ ...draft, kind: CORRECTION_KINDS[i] });
    for (let i = 0; i < 8; i++) decideRule(ofKindDraft(i).id, "opinion");
    const ninth = ofKindDraft(8);

    expect(decideRule(ninth.id, "opinion")).toEqual({
      ok: false,
      reason: "Opinions are capped at 8; retire one first",
    });
    expect(readRules().find((r) => r.id === ninth.id)?.status).toBe("draft");
  });
});

const opinion: OpinionInput = {
  when: "Designing a system",
  steering: "Treat the current setup as a choice, not a constraint.",
  kind: "status-quo-bias",
  evidence: [],
};

function ofKind(index: number, base: OpinionInput = opinion): OpinionInput {
  return { ...base, kind: CORRECTION_KINDS[index] };
}

describe("addOpinion", () => {
  test("stores an approved opinion with its kind", () => {
    const result = addOpinion(opinion);

    expect(result.ok).toBe(true);
    expect(readRules()).toEqual([
      expect.objectContaining({ ...opinion, status: "approved", delivery: "always" }),
    ]);
  });

  test("a second opinion on the same kind is refused, since both would share one rate", () => {
    const first = addOpinion(opinion);

    expect(addOpinion({ ...opinion, when: "Reviewing a design" })).toEqual({
      ok: false,
      reason: `Opinion ${first.ok ? first.rule.id : ""} already targets status-quo-bias, and two would share one rate; retire it first`,
    });
  });

  test("opinions past the character cap are refused", () => {
    const long = { ...opinion, steering: "x".repeat(700) };
    addOpinion(ofKind(0, long));
    addOpinion(ofKind(1, long));

    const result = addOpinion(ofKind(2, long));

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toStartWith(
      "Opinions are capped at 1500 characters"
    );
    expect(readRules()).toHaveLength(2);
  });

  test("a retired opinion frees its place under the cap", () => {
    const ids = Array.from({ length: 8 }, (_, i) => {
      const result = addOpinion(ofKind(i));
      return result.ok ? result.rule.id : "";
    });
    expect(addOpinion(ofKind(8))).toEqual({
      ok: false,
      reason: "Opinions are capped at 8; retire one first",
    });

    retireRule(ids[0]);

    expect(addOpinion(ofKind(8)).ok).toBe(true);
  });
});

describe("retireRule", () => {
  test("ends an approved rule and stamps when", () => {
    const { id } = addDraft(draft);
    decideRule(id, "approved");

    expect(retireRule(id).ok).toBe(true);
    expect(readRules()[0]).toMatchObject({ status: "retired" });
    expect(readRules()[0].retiredAt).toBeDefined();
  });

  test("a draft or an unknown id is refused", () => {
    const { id } = addDraft(draft);

    expect(retireRule(id)).toEqual({
      ok: false,
      reason: `Rule ${id} is draft, not approved`,
    });
    expect(retireRule("nope")).toEqual({ ok: false, reason: "No rule with id nope" });
  });
});

describe("opinionsContext", () => {
  test("lists approved opinions only, situation then steering", () => {
    addOpinion(opinion);
    const retired = addOpinion({ ...opinion, when: "Gone" });
    if (retired.ok) retireRule(retired.rule.id);
    decideRule(addDraft(draft).id, "approved");

    expect(opinionsContext()).toBe(
      [
        "## Opinions",
        "The user approved these from past corrections. Follow them on every turn:",
        "- Designing a system: Treat the current setup as a choice, not a constraint.",
      ].join("\n")
    );
  });

  test("no opinions is no context", () => {
    expect(opinionsContext()).toBe("");
  });
});
