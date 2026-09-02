import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const HOME = resolve(import.meta.dir, "../.test-home-algorithm-reflect-build");

beforeEach(() => {
  process.env.PAL_HOME = HOME;
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
  mkdirSync(HOME, { recursive: true });
});

afterEach(() => {
  delete process.env.PAL_HOME;
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
});

async function lib() {
  return await import("../src/tools/agent/algorithm-reflect");
}

const MIN_INPUT = { task: "t", q1: "a", q2: "b", q3: "c" };

describe("buildReflection", () => {
  test("stamps this machine's id", async () => {
    const { buildReflection } = await lib();
    const r = buildReflection(MIN_INPUT);
    const machineFile = JSON.parse(readFileSync(resolve(HOME, "machine.json"), "utf-8"));
    expect(r.m).toBe(machineFile.id);
  });

  test("anchors the cwd when it falls inside a registered project", async () => {
    const slug = "test-repo";
    const dir = resolve(HOME, "memory", "projects", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, "ISA.md"),
      `---\nname: "${slug}"\npath: "${process.cwd()}"\nstatus: "active"\ncreated: "2026-01-01"\nupdated: "2026-01-01"\n---\n\n## Goal\n`
    );
    const { buildReflection } = await lib();
    const r = buildReflection(MIN_INPUT);
    expect(r.cwd).toBe(`{proj:${slug}}`);
  });

  test("passes the cwd through unchanged when no project is registered", async () => {
    const { buildReflection } = await lib();
    const r = buildReflection(MIN_INPUT);
    expect(r.cwd).toBe(process.cwd());
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
});
