import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runRule } from "../src/cli/rule";
import { addDraft, readRules } from "../src/hooks/lib/adaptation-rules";

let HOME: string;
const savedHome = process.env.PAL_HOME;
let printed: string[];
let logSpy: ReturnType<typeof spyOn>;
let errSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-rule-cli-"));
  process.env.PAL_HOME = HOME;
  printed = [];
  logSpy = spyOn(console, "log").mockImplementation((...a) => printed.push(a.join(" ")));
  errSpy = spyOn(console, "error").mockImplementation((...a) =>
    printed.push(a.join(" "))
  );
});

afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  rmSync(HOME, { recursive: true, force: true });
});

function seed(when: string) {
  return addDraft({
    when,
    trigger: { side: "reply", pattern: "done" },
    steering: "Show the evidence.",
    evidence: ["Claimed done without a test run."],
  });
}

describe("pal cli rule list", () => {
  test("shows drafts with their id, situation and steering", async () => {
    const rule = seed("Claiming work is finished");

    expect(await runRule(["list"])).toBe(0);
    const out = printed.join("\n");
    expect(out).toContain(rule.id);
    expect(out).toContain("Claiming work is finished");
    expect(out).toContain("Show the evidence.");
  });

  test("shows the check and where the trigger fired in the turn log", async () => {
    addDraft({
      when: "Claiming tests pass",
      trigger: { side: "reply", pattern: "tests pass" },
      steering: "Show the run.",
      evidence: [],
      check: "The reply quotes a test run.",
      proof: { firedCorrections: 2, corrections: 3, firedOrdinary: 1, ordinary: 43 },
    });

    await runRule(["list"]);
    const out = printed.join("\n");
    expect(out).toContain("check: The reply quotes a test run.");
    expect(out).toContain("proof: fired on 2/3 corrections, 1/43 ordinary turns");
  });

  test("hides decided rules unless --all is given", async () => {
    const rule = seed("Claiming work is finished");
    await runRule(["deny", rule.id]);
    printed = [];

    await runRule(["list"]);
    expect(printed.join("\n")).not.toContain(rule.id);

    await runRule(["list", "--all"]);
    expect(printed.join("\n")).toContain(rule.id);
  });

  test("--json prints the rules as JSON", async () => {
    const rule = seed("Claiming work is finished");

    await runRule(["list", "--json"]);
    expect(JSON.parse(printed.join("\n"))).toEqual([rule]);
  });
});

describe("pal cli rule approve / deny", () => {
  test("approve turns the draft into an approved rule", async () => {
    const rule = seed("Claiming work is finished");

    expect(await runRule(["approve", rule.id])).toBe(0);
    expect(readRules()[0].status).toBe("approved");
  });

  test("a widening names its rule, and approving it says the rule's trigger changed", async () => {
    const rule = seed("Claiming work is finished");
    await runRule(["approve", rule.id]);
    const widening = addDraft({
      ...rule,
      trigger: { side: "reply", pattern: "done|finished" },
      widens: rule.id,
    });

    await runRule(["list"]);
    expect(printed.join("\n")).toContain(`widens: ${rule.id}`);

    expect(await runRule(["approve", widening.id])).toBe(0);
    expect(printed.at(-1)).toBe(
      `Rule ${rule.id} now triggers on: done|finished (widened by ${widening.id})`
    );
  });

  test("deny records the denial", async () => {
    const rule = seed("Claiming work is finished");

    expect(await runRule(["deny", rule.id])).toBe(0);
    expect(readRules()[0].status).toBe("denied");
  });

  test("an unknown id fails with the reason", async () => {
    expect(await runRule(["approve", "nope"])).toBe(1);
    expect(printed.join("\n")).toContain("No rule with id nope");
  });

  test("a missing id fails", async () => {
    expect(await runRule(["approve"])).toBe(1);
  });
});
