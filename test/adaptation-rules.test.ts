import { beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  type AdaptationRule,
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
} from "../src/opinions/adaptation-rules";
import { CORRECTION_KINDS } from "../src/opinions/correction-kind";
import {
  legacyRulesPath,
  moveLegacyRulesIntoLog,
  ruleLogPath,
  saveRule,
} from "../src/opinions/rule-log";
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

describe("the rule log", () => {
  const lines = () =>
    readFileSync(ruleLogPath(), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

  test("lives in records/rules of the active home", () => {
    expect(ruleLogPath()).toBe(resolve(HOME, "records", "rules", "rules.jsonl"));
  });

  test("a decision appends the rule's new state instead of rewriting the file", () => {
    const { id } = addDraft(draft);
    const before = readFileSync(ruleLogPath(), "utf-8");

    decideRule(id, "approved");

    expect(readFileSync(ruleLogPath(), "utf-8").startsWith(before)).toBe(true);
    expect(lines().map((line) => line.rule.status)).toEqual(["draft", "approved"]);
  });

  test("a change in the same millisecond is still stamped after the last one", () => {
    const rule = addDraft(draft);
    saveRule({ ...rule, status: "approved" }, new Date(0));

    const [first, second] = lines();
    expect(Date.parse(second.at)).toBeGreaterThan(Date.parse(first.at));
    expect(readRules()[0].status).toBe("approved");
  });

  test("the newest line wins whatever order two machines' lines arrive in", () => {
    const rule = addDraft(draft);
    const at = (iso: string, status: string) =>
      `${JSON.stringify({ at: iso, rule: { ...rule, status } })}\n`;
    appendFileSync(ruleLogPath(), at("2030-01-02T00:00:00.000Z", "approved"));
    appendFileSync(ruleLogPath(), at("2030-01-01T00:00:00.000Z", "denied"));

    expect(readRules()[0].status).toBe("approved");
  });

  test("a folded widening stays in the log but not among the rules", () => {
    const rule = addDraft(draft);
    decideRule(rule.id, "approved");
    const widening = addDraft({ ...draft, widens: rule.id });

    decideRule(widening.id, "approved");

    expect(lines().at(-1).rule).toMatchObject({ id: widening.id, status: "merged" });
    expect(readRules().map((r) => r.id)).toEqual([rule.id]);
  });
});

describe("rules from before the log", () => {
  const legacy = (rules: unknown) => {
    mkdirSync(dirname(legacyRulesPath()), { recursive: true });
    writeFileSync(legacyRulesPath(), JSON.stringify(rules));
  };
  const old = {
    ...draft,
    id: "old1",
    status: "approved",
    createdAt: "2026-10-01T00:00:00.000Z",
    decidedAt: "2026-10-02T00:00:00.000Z",
  };

  test("read until they move into the log", () => {
    legacy([old]);

    expect(readRules()).toEqual([old as AdaptationRule]);
  });

  test("a later change in the log wins over rules.json", () => {
    legacy([old]);

    retireRule("old1");
    legacy([old]);

    expect(readRules()[0].status).toBe("retired");
  });

  test("move into the log once, as the same line on every machine", () => {
    legacy([old]);

    expect(moveLegacyRulesIntoLog()).toBe(1);
    expect(moveLegacyRulesIntoLog()).toBe(0);
    expect(readFileSync(ruleLogPath(), "utf-8")).toBe(
      `${JSON.stringify({ at: old.decidedAt, rule: old })}\n`
    );
  });

  test("a corrupt rules.json reads as no rules", () => {
    legacy("ignored");
    writeFileSync(legacyRulesPath(), "{ not json", "utf-8");

    expect(readRules()).toEqual([]);
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

  test("a broken line is skipped", () => {
    const rule = addDraft(draft);
    appendFileSync(ruleLogPath(), "{ not json\n");

    expect(readRules()).toEqual([rule]);
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

  test("a draft without a trigger can be kept as an opinion, not approved", () => {
    const { trigger: _trigger, ...untriggered } = draft;
    const { id } = addDraft({ ...untriggered, kind: "no-verdict" });

    expect(decideRule(id, "approved")).toEqual({
      ok: false,
      reason: `Rule ${id} has no trigger; keep it as an opinion or deny it`,
    });
    expect(decideRule(id, "opinion").ok).toBe(true);
  });

  test("a draft behind a closed gate is refused as an opinion, not as a rule", () => {
    const few = addDraft({
      ...draft,
      kind: "no-verdict",
      opinionGate: { corrections: 3 },
    });
    const dup = addDraft({
      ...draft,
      kind: "no-verdict",
      opinionGate: { duplicates: "o1" },
    });

    expect(decideRule(few.id, "opinion")).toEqual({
      ok: false,
      reason: `Rule ${few.id} cannot be an opinion: its kind has only 3 corrections`,
    });
    expect(decideRule(dup.id, "opinion")).toEqual({
      ok: false,
      reason: `Rule ${dup.id} cannot be an opinion: o1 already targets its kind`,
    });
    expect(decideRule(few.id, "approved").ok).toBe(true);
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
