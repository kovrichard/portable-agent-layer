import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const HOME = resolve(import.meta.dir, "../.test-home-algorithm-reflect-build");
const NOW = new Date("2026-09-06T12:00:00.000Z");

beforeEach(() => {
  process.env.PAL_HOME = HOME;
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
  mkdirSync(HOME, { recursive: true });
});

afterEach(() => {
  delete process.env.PAL_HOME;
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
});

/** Loaded per test: the attribution stamp resolves against PAL_HOME as it is set here. */
async function lib() {
  return await import("../src/tools/lib/algorithm-reflect");
}

const MIN_INPUT = { task: "t", q1: "a", q2: "b", q3: "c" };

function registerProject(slug: string, path: string): void {
  const dir = resolve(HOME, "memory", "projects", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "ISA.md"),
    `---\nname: "${slug}"\npath: "${path}"\nstatus: "active"\ncreated: "2026-01-01"\nupdated: "2026-01-01"\n---\n\n## Goal\n`
  );
}

describe("intOr", () => {
  test("an absent flag reads as its default", async () => {
    const { intOr } = await lib();
    expect(intOr(undefined, 0)).toBe(0);
    expect(intOr(undefined, 5)).toBe(5);
  });

  test("an empty flag reads as its default too", async () => {
    const { intOr } = await lib();
    expect(intOr("", 5)).toBe(5);
  });

  test("reads the number it was given", async () => {
    const { intOr } = await lib();
    expect(intOr("7", 0)).toBe(7);
  });

  // Not zero: a typo should show up in the data as NaN rather than as a real count.
  test("a non-numeric flag reads as NaN, not as the default", async () => {
    const { intOr } = await lib();
    expect(intOr("abc", 0)).toBeNaN();
  });

  test("a zero is a zero, not an absent flag", async () => {
    const { intOr } = await lib();
    expect(intOr("0", 5)).toBe(0);
  });
});

describe("clampSentiment", () => {
  test("defaults to the middle of the scale", async () => {
    const { clampSentiment } = await lib();
    expect(clampSentiment(undefined)).toBe(5);
  });

  test("clamps above and below the scale", async () => {
    const { clampSentiment } = await lib();
    expect(clampSentiment(99)).toBe(10);
    expect(clampSentiment(-5)).toBe(1);
  });

  test("leaves both ends of the scale alone", async () => {
    const { clampSentiment } = await lib();
    expect(clampSentiment(1)).toBe(1);
    expect(clampSentiment(10)).toBe(10);
    expect(clampSentiment(7)).toBe(7);
  });
});

describe("scopeOf", () => {
  test("task-specific opts out of the clustering", async () => {
    const { scopeOf } = await lib();
    expect(scopeOf("task-specific")).toBe("task-specific");
  });

  test("everything else is general", async () => {
    const { scopeOf } = await lib();
    expect(scopeOf(undefined)).toBe("general");
    expect(scopeOf("general")).toBe("general");
    expect(scopeOf("bogus")).toBe("general");
    expect(scopeOf("")).toBe("general");
  });
});

describe("buildReflection", () => {
  test("stamps this machine's id", async () => {
    const { buildReflection } = await lib();
    const r = buildReflection(MIN_INPUT);
    const machineFile = JSON.parse(readFileSync(resolve(HOME, "machine.json"), "utf-8"));
    expect(r.machine).toBe(machineFile.id);
  });

  test("stamps the clock it was handed", async () => {
    const { buildReflection } = await lib();
    expect(buildReflection(MIN_INPUT, NOW).timestamp).toBe("2026-09-06T12:00:00.000Z");
  });

  test("anchors the cwd when it falls inside a registered project", async () => {
    registerProject("test-repo", process.cwd());
    const { buildReflection } = await lib();
    expect(buildReflection(MIN_INPUT).cwd).toBe("{proj:test-repo}");
  });

  test("anchors the directory it was handed, not the one it is running in", async () => {
    registerProject("elsewhere", HOME);
    const { buildReflection } = await lib();
    expect(buildReflection(MIN_INPUT, NOW, HOME).cwd).toBe("{proj:elsewhere}");
  });

  test("passes the cwd through unchanged when no project is registered", async () => {
    const { buildReflection } = await lib();
    expect(buildReflection(MIN_INPUT).cwd).toBe(process.cwd());
  });

  test("clamps sentiment into 1..10", async () => {
    const { buildReflection } = await lib();
    expect(buildReflection({ ...MIN_INPUT, sentiment: 99 }).sentiment).toBe(10);
    expect(buildReflection({ ...MIN_INPUT, sentiment: -5 }).sentiment).toBe(1);
    expect(buildReflection(MIN_INPUT).sentiment).toBe(5);
  });

  test("defaults scope to general unless task-specific is given", async () => {
    const { buildReflection } = await lib();
    expect(buildReflection(MIN_INPUT).scope).toBe("general");
    expect(buildReflection({ ...MIN_INPUT, scope: "task-specific" }).scope).toBe(
      "task-specific"
    );
    expect(buildReflection({ ...MIN_INPUT, scope: "bogus" }).scope).toBe("general");
  });

  test("defaults counts to zero when omitted", async () => {
    const { buildReflection } = await lib();
    const r = buildReflection(MIN_INPUT);
    expect(r.criteria_count).toBe(0);
    expect(r.criteria_passed).toBe(0);
    expect(r.criteria_failed).toBe(0);
  });

  test("carries the counts it was given", async () => {
    const { buildReflection } = await lib();
    const r = buildReflection({
      ...MIN_INPUT,
      criteria_count: 5,
      criteria_passed: 4,
      criteria_failed: 1,
    });
    expect([r.criteria_count, r.criteria_passed, r.criteria_failed]).toEqual([5, 4, 1]);
  });

  test("carries the three answers and the task through untouched", async () => {
    const { buildReflection } = await lib();
    const r = buildReflection({
      task: "the refactor",
      q1: "read first",
      q2: "parallelize",
      q3: "the cross-platform constraint",
    });
    expect([r.task, r.q1, r.q2, r.q3]).toEqual([
      "the refactor",
      "read first",
      "parallelize",
      "the cross-platform constraint",
    ]);
  });
});

describe("reflectionLine", () => {
  test("is one JSON object per line, newline-terminated", async () => {
    const { buildReflection, reflectionLine } = await lib();
    const reflection = buildReflection(MIN_INPUT, NOW);
    const line = reflectionLine(reflection);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd()).not.toContain("\n");
    expect(JSON.parse(line)).toEqual(reflection);
  });
});
