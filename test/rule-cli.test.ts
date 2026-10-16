import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { runRule } from "../src/cli/rule";
import {
  addDraft,
  decideRule,
  flagContradiction,
  readRules,
} from "../src/hooks/lib/adaptation-rules";
import { freshTestDir } from "./lib/test-home";

let HOME: string;
let printed: string[];
let logSpy: ReturnType<typeof spyOn> | undefined;
let errSpy: ReturnType<typeof spyOn> | undefined;

beforeEach(() => {
  logSpy?.mockRestore();
  errSpy?.mockRestore();
  HOME = freshTestDir(import.meta.file);
  process.env.PAL_HOME = HOME;
  printed = [];
  logSpy = spyOn(console, "log").mockImplementation((...a) => printed.push(a.join(" ")));
  errSpy = spyOn(console, "error").mockImplementation((...a) =>
    printed.push(a.join(" "))
  );
});

function seed(when: string) {
  return addDraft({
    when,
    trigger: { side: "reply", pattern: "done" },
    steering: "Show the evidence.",
    kind: "unverified-claim",
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

  test("says when a draft can only be kept as an opinion", async () => {
    const offer = "  offer: the trigger did not prove; keep it as an opinion or deny it";
    const proven = seed("Claiming work is finished");
    const opinionOnly = addDraft({
      when: "Claiming tests pass",
      trigger: { side: "reply", pattern: "tests pass" },
      steering: "Show the run.",
      kind: "no-verdict",
      evidence: [],
      offer: "opinion-only",
    });

    expect(await runRule(["list"])).toBe(0);
    const [provenBlock, opinionOnlyBlock] = printed.join("\n").split("\n\n");
    expect(provenBlock.split("\n")).toEqual([
      `${proven.id}  [draft]  Claiming work is finished`,
      "  trigger (reply): done",
      "  steering: Show the evidence.",
      "  kind: unverified-claim",
      "  evidence: Claimed done without a test run.",
    ]);
    expect(opinionOnlyBlock.split("\n")).toContain(offer);

    decideRule(opinionOnly.id, "opinion");
    printed = [];
    expect(await runRule(["list", "--all"])).toBe(0);
    expect(printed.join("\n").split("\n")).not.toContain(offer);
  });

  test("says when a draft has no trigger", async () => {
    addDraft({
      when: "Reporting a result",
      steering: "Quote the evidence.",
      kind: "unverified-claim",
      evidence: [],
      offer: "opinion-only",
    });

    expect(await runRule(["list"])).toBe(0);
    const lines = printed.join("\n").split("\n");
    expect(lines).toContain("  offer: no trigger; keep it as an opinion or deny it");
    expect(lines.some((line) => line.startsWith("  trigger"))).toBe(false);
  });

  test("says why a gated draft is not offered as an opinion", async () => {
    const offer = "  offer: the trigger did not prove; keep it as an opinion or deny it";
    addDraft({
      when: "Claiming tests pass",
      trigger: { side: "reply", pattern: "tests pass" },
      steering: "Show the run.",
      kind: "no-verdict",
      evidence: [],
      offer: "opinion-only",
      opinionGate: { duplicates: "o1" },
    });

    expect(await runRule(["list"])).toBe(0);
    const lines = printed.join("\n").split("\n");
    expect(lines).toContain(
      "  no opinion: o1 targeted this kind and is no longer active"
    );
    expect(lines).not.toContain(offer);
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

describe("pal cli rule opinions", () => {
  const addArgs = [
    "add-opinion",
    "--kind",
    "status-quo-bias",
    "--when",
    "Designing a system",
    "--steering",
    "Treat the current setup as a choice.",
  ];

  test("opinion keeps a draft as an opinion", async () => {
    const rule = seed("Claiming work is finished");

    expect(await runRule(["opinion", rule.id])).toBe(0);
    expect(printed.at(-1)).toBe(
      `Rule ${rule.id} kept as an opinion: Claiming work is finished`
    );
    expect(readRules()[0]).toMatchObject({ status: "approved", delivery: "always" });
  });

  test("add-opinion stores an approved opinion, and list --all shows its effect", async () => {
    expect(
      await runRule([...addArgs, "--evidence", "Kept a dev dependency as a reason"])
    ).toBe(0);
    const [rule] = readRules();
    expect(rule).toMatchObject({
      kind: "status-quo-bias",
      evidence: ["Kept a dev dependency as a reason"],
    });
    expect(printed.at(-1)).toBe(`Rule ${rule.id} kept as an opinion: Designing a system`);

    await runRule(["list", "--all"]);
    const out = printed.join("\n");
    expect(out).toContain(`${rule.id}  [opinion]  Designing a system`);
    expect(out).toContain("  kind: status-quo-bias");
    expect(out).toContain(
      [
        "  effect: 0 in 0 turns before (0.0/100), 0 in 0 after (0.0/100) (too-early)",
        "  other kinds: 0 in 0 turns before (0.0/100), 0 in 0 after (0.0/100)",
      ].join("\n")
    );
    expect(out).not.toContain("trigger");
  });

  test("add-opinion refuses an unknown kind and a missing field", async () => {
    expect(await runRule([...addArgs.slice(0, 2), "vibes", ...addArgs.slice(3)])).toBe(1);
    expect(printed.join("\n")).toContain("--kind must be one of missed-the-question");
    expect(await runRule(addArgs.slice(0, 5))).toBe(1);
    expect(printed.join("\n")).toContain("--steering is required");
    expect(readRules()).toEqual([]);
  });

  test("a refused add-opinion fails with the reason", async () => {
    await runRule(addArgs);
    const [first] = readRules();

    expect(await runRule(addArgs)).toBe(1);
    expect(printed.at(-1)).toBe(
      `Opinion ${first.id} already targets status-quo-bias, and two would share one rate; retire it first`
    );
  });

  test("add-reinforcement keeps a praised behavior, labelled as one", async () => {
    expect(
      await runRule([
        "add-reinforcement",
        "--when",
        "Rico counter-proposes",
        "--steering",
        "Argue again with the reason.",
      ])
    ).toBe(0);
    const [rule] = readRules();
    expect(printed.at(-1)).toBe(
      `Rule ${rule.id} kept as a reinforcement: Rico counter-proposes`
    );

    await runRule(["list", "--all"]);
    expect(printed.join("\n")).toContain(
      `${rule.id}  [reinforcement]  Rico counter-proposes`
    );
  });

  test("a contradicted reinforcement shows the correction beside it", async () => {
    await runRule([
      "add-reinforcement",
      "--when",
      "Pushing back",
      "--steering",
      "Argue.",
    ]);
    const [rule] = readRules();
    flagContradiction(rule.id, "stop arguing");

    await runRule(["list", "--all"]);
    expect(printed.join("\n")).toContain(
      '  contradicted: "stop arguing" — retire it if that still holds'
    );
  });

  test("retire ends an approved rule", async () => {
    const rule = seed("Claiming work is finished");
    await runRule(["approve", rule.id]);

    expect(await runRule(["retire", rule.id])).toBe(0);
    expect(printed.at(-1)).toBe(`Rule ${rule.id} retired: Claiming work is finished`);
    expect(await runRule(["retire", rule.id])).toBe(1);
  });
});
