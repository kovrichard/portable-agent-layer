import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { readProject, writeProject } from "../src/hooks/lib/projects";
import { fakeProject, projectsHome } from "./lib/projects-lib-fixture";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const TEST_HOME = projectsHome(import.meta.file);

/** A directory that actually exists — writeProject binds only real paths. */
function checkoutDir(name: string): string {
  const dir = resolve(TEST_HOME, "checkouts", name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("read/write/delete", () => {
  test("write then read round-trips", () => {
    const p = fakeProject({ name: "alpha", path: checkoutDir("alpha") });
    writeProject(p);
    const got = readProject("alpha");
    expect(got).toEqual(p);
  });

  test("write then read round-trips with ISA body sections", () => {
    const p = fakeProject({
      name: "rich",
      path: checkoutDir("rich"),
      goal: "Ship ISA support",
      criteria: "- All tests pass\n- ISA.md is created on create",
      context: "PAL source repo\nReference: ~/pai",
      next: ["Build it", "Test it"],
      blockers: ["Need design approval"],
    });
    writeProject(p);
    const got = readProject("rich");
    expect(got).toEqual(p);
  });
});
