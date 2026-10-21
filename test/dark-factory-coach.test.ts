import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { coachInstructions } from "../assets/plugins/dark-factory/scripts/coach.mjs";
import {
  expectedInputs,
  missingInputs,
} from "../assets/plugins/dark-factory/scripts/coverage.mjs";
import {
  applyCoachResult,
  diffNames,
  generalityViolation,
  readFindings,
  writeFindings,
} from "../assets/plugins/dark-factory/scripts/findings.mjs";
import {
  coachResult,
  env,
  finding,
  NOW,
  PLUGIN_ROOT,
  paths,
  startEachTestInAFreshFactory,
} from "./lib/dark-factory-coach-fixture";

const apply = (store: object[], result: object, names: string[] = []) =>
  applyCoachResult(store, result, { taskId: "t1", names, now: NOW }) as {
    store: Record<string, unknown>[];
    events: Record<string, unknown>[];
    created: string[];
    updated: string[];
  };

startEachTestInAFreshFactory(import.meta.file);

describe("the findings store (criteria 7, 8)", () => {
  test("a new finding is stored pending with the fields and an id", () => {
    const { store, created } = apply([], { findings: [coachResult()], updates: [] });
    expect(created).toEqual(["c1"]);
    expect(store[0]).toMatchObject({
      id: "c1",
      status: "pending",
      class: "spec reports",
      role: "po",
      severity: "high",
      metric: "reviewFindings",
      evidence: [{ task: "t1", ref: "event review" }],
    });
    expect(store[0]?.createdAt).toBe(NOW.toISOString());
  });

  test("the store round-trips through findings.jsonl in the factory home", () => {
    writeFindings([finding()], env());
    expect(existsSync(join(paths.home, "coach", "findings.jsonl"))).toBe(true);
    expect(readFindings(env())).toEqual([finding()]);
  });

  test("a same-class finding adds evidence to the pending one instead of duplicating", () => {
    const added = coachResult({
      class: " Open Repro ",
      role: "debugger",
      evidence: [{ task: "t2", ref: "commit abc" }],
    });
    const { store, updated, created } = apply([finding()], {
      findings: [added],
      updates: [],
    });
    expect(store).toHaveLength(1);
    expect(created).toEqual([]);
    expect(updated).toEqual(["c1"]);
    expect(store[0]?.evidence).toHaveLength(2);
  });

  test("an update by id adds evidence once, and an unknown id is recorded as ignored", () => {
    const evidence = [{ task: "t2", ref: "commit abc" }];
    const first = apply([finding()], {
      findings: [],
      updates: [
        { id: "c1", evidence },
        { id: "c1", evidence },
        { id: "c9", evidence },
      ],
    });
    expect(first.store[0]?.evidence).toHaveLength(2);
    expect(first.events).toEqual([
      { event: "coach_update_ignored", task: "t1", id: "c9" },
    ]);
  });

  test("a class the user rejected is dropped, not proposed again", () => {
    const rejected = finding({ status: "rejected", rejectReason: "too narrow" });
    const { store, events, created } = apply([rejected], {
      findings: [coachResult({ class: "open repro", role: "debugger" })],
      updates: [],
    });
    expect(store).toHaveLength(1);
    expect(created).toEqual([]);
    expect(events[0]).toMatchObject({
      event: "coach_finding_dropped",
      task: "t1",
      reason: "rejected",
      rejectedId: "c1",
    });
  });
});

describe("the generality check (criterion 9)", () => {
  const diff = [
    "--- a/src/lib/widgetRows.mjs",
    "+++ b/src/lib/widgetRows.mjs",
    "+export function fetchWidgetRows(db) {",
    "+  const row_count = 3;",
    "+}",
  ].join("\n");

  test("names come from changed paths, basenames and added identifiers", () => {
    const names = diffNames(diff);
    expect(names).toEqual(
      expect.arrayContaining([
        "src/lib/widgetRows.mjs",
        "widgetRows.mjs",
        "fetchWidgetRows",
      ])
    );
  });

  test("a rule naming a helper from the diff is rejected with the matched name", () => {
    const result = {
      findings: [coachResult({ rule: "Always call fetchWidgetRows before shipping." })],
      updates: [],
    };
    const { store, events, created } = apply([], result, diffNames(diff));
    expect(store).toHaveLength(0);
    expect(created).toEqual([]);
    expect(events).toEqual([
      expect.objectContaining({
        event: "coach_rule_rejected",
        task: "t1",
        matched: "fetchWidgetRows",
      }),
    ]);
  });

  test("a rule naming a changed file path is rejected too", () => {
    expect(
      generalityViolation("Edit src/lib/widgetRows.mjs first.", diffNames(diff))
    ).toBe("src/lib/widgetRows.mjs");
  });

  test("a plain lowercase key or variable from the diff does not block an ordinary word in a rule", () => {
    const keyed = [
      "+++ b/src/run.mjs",
      '+  appendEvent({ event: "x", task: taskId, body });',
      "+  const user = userPart(env);",
      '+  setup({ role: "reviewer" });',
    ].join("\n");
    const names = diffNames(keyed);
    expect(names).toEqual(["src/run.mjs", "run.mjs"]);
    expect(
      generalityViolation(
        "A role must check the task body before telling the user.",
        names
      )
    ).toBeNull();
  });

  test("a rule that names nothing from the diff is stored", () => {
    const result = { findings: [coachResult()], updates: [] };
    const { store, events } = apply([], result, diffNames(diff));
    expect(store).toHaveLength(1);
    expect(events).toEqual([]);
  });
});

describe("running the coach on a task (criteria 1, 4)", () => {
  test("coachInstructions is exported and returns text", () => {
    expect(typeof coachInstructions).toBe("function");
  });
});

describe("coverage of the coach's inputs (criterion 2)", () => {
  const transcripts = [{ path: "/t/a.jsonl" }, { path: "/t/b.jsonl" }];
  const corrections = [{ task: "t1", commits: [{ sha: "aaaa93c" }] }];
  const expected = expectedInputs(transcripts, corrections);
  const clean = (source: string) => ({ source, verdict: "clean", reason: "Checked." });
  const check = (reviewed: object[], knownClasses: string[] = []) =>
    missingInputs({ expected, reviewed, knownClasses });

  test("the inputs are every transcript path and every correction sha", () => {
    expect(expected).toEqual(["/t/a.jsonl", "/t/b.jsonl", "aaaa93c"]);
  });

  test("a complete result misses nothing", () => {
    expect(check(expected.map(clean))).toEqual([]);
  });

  test("a transcript with no verdict is missing", () => {
    const reviewed = [clean("/t/a.jsonl"), clean("aaaa93c")];
    expect(check(reviewed)).toEqual([{ source: "/t/b.jsonl", problem: "no verdict" }]);
  });

  test("a correction with no verdict is missing", () => {
    const reviewed = [clean("/t/a.jsonl"), clean("/t/b.jsonl")];
    expect(check(reviewed)).toEqual([{ source: "aaaa93c", problem: "no verdict" }]);
  });

  test("a finding verdict with an unknown class is missing", () => {
    const reviewed = [
      clean("/t/a.jsonl"),
      clean("/t/b.jsonl"),
      { source: "aaaa93c", verdict: "finding", class: "ghost", reason: "x" },
    ];
    expect(check(reviewed, ["other"])).toEqual([
      { source: "aaaa93c", problem: 'unknown class "ghost"' },
    ]);
  });

  test("a finding verdict naming a pending class, in any case, is accepted", () => {
    const reviewed = [
      clean("/t/a.jsonl"),
      clean("/t/b.jsonl"),
      { source: "aaaa93c", verdict: "finding", class: " Open Repro ", reason: "x" },
    ];
    expect(check(reviewed, ["open repro"])).toEqual([]);
  });
});

describe("agents/coach.md (criteria 3, 5, 13)", () => {
  const prompt = readFileSync(join(PLUGIN_ROOT, "agents/coach.md"), "utf8");

  test("it is an opus agent named coach", () => {
    expect(prompt).toContain("name: coach");
    expect(prompt).toContain("model: claude-opus-5-5");
  });

  test.each([
    "You change no files.",
    "Look for the cost and the mistakes, not only for failures: retries, escalations, denied tools, wasted turns, review and tester rounds, questions, and the user's corrections.",
    "The user's corrections after the factory are the strongest signal.",
    "Judge the PO too: whether the spec caused a mistake, such as a report routed to the PR body, or a criterion read as forbidding something it didn't.",
    "Propose only rules that would have prevented the mistake in a different task too, and name that task in elsewhere.",
    "Never name this task's files, helpers or variables in a rule.",
    "Prefer changing or removing an existing line of a role prompt over adding one, and propose consolidating a role prompt that has grown past 40 lines.",
    "Do not propose a class the user rejected. Add evidence to a pending finding of the same class through updates.",
    "Report nothing when the run was clean. An empty list is a valid result.",
  ])("it tells the coach: %s", (sentence) => {
    expect(prompt).toContain(sentence);
  });

  test.each([
    "Return a verdict in reviewed for every listed transcript and every listed correction, naming it by its path or sha exactly as listed: finding with the finding's class, or clean.",
    "A clean verdict needs a reason naming what you checked and why nothing needs to change.",
  ])("it requires a verdict for every input (criterion 6): %s", (sentence) => {
    expect(prompt).toContain(sentence);
  });
});

describe("the po skill and the readme (criteria 11, 14)", () => {
  const skill = readFileSync(join(PLUGIN_ROOT, "skills/po/SKILL.md"), "utf8");
  const readme = readFileSync(join(PLUGIN_ROOT, "README.md"), "utf8");

  test("the po skill has a Coach findings section with list, approve and the user's go", () => {
    expect(skill).toContain("## Coach findings");
    expect(skill).toContain("coach.mjs list");
    expect(skill).toContain("coach.mjs approve");
    expect(skill).toContain("Never approve or build a coach finding without the user.");
  });

  test("the readme describes the coach, the store, the commands and the approval flow", () => {
    expect(readme).toContain("## Coach");
    for (const part of [
      "findings.jsonl",
      "coach.mjs",
      "list --applied",
      "approve",
      "coach.repo",
      "coach_rule_rejected",
      "reviewed",
      "--resume",
      "coach_incomplete",
      "expected",
    ]) {
      expect(readme).toContain(part);
    }
  });
});
