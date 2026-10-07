import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  addDraft,
  type DraftInput,
  decideRule,
  readRules,
  rulesPath,
} from "../src/hooks/lib/adaptation-rules";

let HOME: string;
const savedHome = process.env.PAL_HOME;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-adaptation-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  rmSync(HOME, { recursive: true, force: true });
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

    expect(readRules().map((r) => [r.status, r.trigger.pattern])).toEqual([
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
});
