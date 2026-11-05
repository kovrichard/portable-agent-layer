import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dir, "..");
const PLANNER = resolve(ROOT, "assets/plugins/dark-factory/agents/planner.md");
const EVAL = resolve(ROOT, "eval/planner-plan");

const bodyOf = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/^---[\s\S]*?---\n/, "")
    .trim();
const planner = () => bodyOf(PLANNER).toLowerCase();

const SECTIONS = `
## Criteria map
1. Literal: any added name. Steps: 2.
## Must not add
- no new events
## Runtime model
Runs once per task; two runs can overlap.
`;

type Verdict = { pass: boolean };
const check = () => require(resolve(EVAL, "check.js"));
const run = (fn: string, output: string, vars: Record<string, unknown>) =>
  check()[fn](output, { vars }) as Verdict | boolean;
const passed = (v: Verdict | boolean) => (typeof v === "boolean" ? v : v.pass);

test("criterion 1: planner.md asks for a criteria map with literal meaning, steps and PO questions", () => {
  const text = planner();
  expect(text).toContain("criteria map");
  expect(text).toContain("literal");
  expect(text).toMatch(/question for the po/);
  expect(text).toMatch(/narrower/);
});

test("criterion 2: planner.md asks for a must-not-add list", () => {
  const text = planner();
  expect(text).toMatch(/must[- ]not[- ]add/);
  for (const word of ["events", "files", "flags", "permissions"]) {
    expect(text).toContain(word);
  }
});

test("criterion 3: planner.md asks for a runtime model", () => {
  const text = planner();
  expect(text).toContain("runtime model");
  expect(text).toMatch(/overlap/);
  expect(text).toMatch(/share/);
  expect(text).toMatch(/once/);
  expect(text).toMatch(/per task/);
  expect(text).toMatch(/history/);
});

test("criterion 4a: planner.md asks to search the repo for an existing helper before adding one", () => {
  const text = planner();
  expect(text).toMatch(/search/);
  expect(text).toMatch(/existing helper/);
  expect(text).toMatch(/nothing fit/);
});

test("criterion 4: planner.md keeps every instruction it has today", () => {
  const text = planner();
  for (const kept of [
    "one numbered step per file change",
    "exact path",
    "signatures",
    "existing code to reuse",
    "by path and name",
    "conventions",
    "test layout",
    "acceptance criterion each step serves",
    "do not write the implementation itself",
    "decide everything here",
  ]) {
    expect(text).toContain(kept);
  }
});

test("criterion 5: prompt.js exports current and baseline built from the agent file and the frozen baseline", () => {
  const prompt = require(resolve(EVAL, "prompt.js"));
  const context = { vars: { spec: "SPEC-MARKER", code: "CODE-MARKER" } };
  const current: string = prompt.current(context);
  const baseline: string = prompt.baseline(context);
  expect(current).toContain(bodyOf(PLANNER));
  expect(baseline).toContain(bodyOf(resolve(EVAL, "baseline-planner.md")));
  for (const text of [current, baseline]) {
    expect(text).toContain("SPEC-MARKER");
    expect(text).toContain("CODE-MARKER");
  }
  expect(baseline).not.toMatch(/criteria map/i);
});

test("criterion 5: baseline-planner.md has no frontmatter and keeps the old instructions", () => {
  const raw = readFileSync(resolve(EVAL, "baseline-planner.md"), "utf8");
  expect(raw.startsWith("---")).toBe(false);
  expect(raw).toContain("You write the plan a small, fast model will follow");
  expect(raw).toContain("Do not write the implementation itself.");
});

const CASES = 10;
const yaml = () => readFileSync(resolve(EVAL, "promptfoo.yaml"), "utf8");

test("criterion 6: promptfoo.yaml has the header with pass bar and kill criteria before any config", () => {
  const text = yaml();
  expect(existsSync(resolve(EVAL, "promptfoo.yaml"))).toBe(true);
  const header = text.slice(0, text.indexOf("\nprompts:"));
  expect(header).toMatch(/Pass/);
  expect(header).toMatch(/Kill/);
  expect(header).toMatch(/7 of 9/);
  expect(header).toMatch(/3 more/);
  expect(header).toContain("bun run eval:planner-plan --repeat 2");
});

test("criterion 6: promptfoo.yaml compares current and baseline with check.js assertions", () => {
  const text = yaml();
  expect(text).toContain("file://prompt.js:current");
  expect(text).toContain("file://prompt.js:baseline");
  expect(text).toContain("file://../lib/claude-cli.js");
  for (const fn of ["hazard", "sections", "control"]) {
    expect(text).toContain(`file://check.js:${fn}`);
  }
});

test("criterion 6: promptfoo.yaml has 9 finding cases plus one control case with specs and code", () => {
  const text = yaml();
  const tests = text.split(/^tests:/m)[1] ?? "";
  expect(tests.match(/^ {2}- /gm)?.length).toBe(CASES);
  expect(tests.match(/spec:/g)?.length).toBeGreaterThanOrEqual(CASES);
  expect(tests.match(/code:/g)?.length).toBeGreaterThanOrEqual(CASES);
  expect(text).toContain("rename-the-work-tree-to-progress-tree");
  expect(text).not.toMatch(/\/home\/|\/Users\/|C:\\Users/);
});

test("criterion 7: hazard passes a plan that names the hazard, in any phrasing and case", () => {
  const vars = { hazard: "file lock|overlap(ping)? (runs|processes)" };
  expect(
    passed(run("hazard", "Two OVERLAPPING processes write; take a File Lock.", vars))
  ).toBe(true);
  expect(
    passed(run("hazard", "Two runs can overlap runs here: overlap runs", vars))
  ).toBe(true);
});

test("criterion 7: hazard fails a plan that does not name the hazard", () => {
  const vars = { hazard: "file lock|overlap(ping)? (runs|processes)" };
  expect(passed(run("hazard", "Step 1: add a function. Step 2: add tests.", vars))).toBe(
    false
  );
});

test("criterion 7: hazard ignores the control case", () => {
  expect(passed(run("hazard", "Step 1: rename.", { hazard: "", control: true }))).toBe(
    true
  );
});

test("criterion 7: sections passes a plan with all three sections", () => {
  expect(passed(run("sections", SECTIONS, {}))).toBe(true);
});

test("criterion 7: sections fails a plan missing any one section", () => {
  for (const missing of [
    /## Criteria map\n.*\n/,
    /## Must not add\n.*\n/,
    /## Runtime model\n.*\n/,
  ]) {
    const plan = SECTIONS.replace(missing, "");
    expect(passed(run("sections", plan, {}))).toBe(false);
  }
});

test("criterion 7: control passes a plan with no invented work", () => {
  const plan = `${SECTIONS}\nNo shared state and no per-call work; the change is a rename.`;
  expect(passed(run("control", plan, { control: true }))).toBe(true);
});

test("criterion 7: control fails a plan that adds locking or once-per-task bookkeeping", () => {
  for (const invented of [
    "Step 4: take a file lock around the rename.",
    "Step 4: record a marker so the rename runs once per task.",
  ]) {
    expect(passed(run("control", `${SECTIONS}\n${invented}`, { control: true }))).toBe(
      false
    );
  }
});

test("criterion 7: control passes any plan for a non-control case", () => {
  expect(passed(run("control", "Step 1: take a lock.", { control: false }))).toBe(true);
});
