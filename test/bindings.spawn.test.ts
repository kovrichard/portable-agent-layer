import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { addProject, checkout, freshBindingsHome, seedLib } from "./lib/bindings-fixture";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

async function lib() {
  return await import("../src/hooks/lib/bindings");
}

let HOME: string;

beforeEach(() => {
  HOME = freshBindingsHome(import.meta.file);
});

describe("seeding happens on the first read", () => {
  test("a project registered later is bound on the next read", async () => {
    await addProject("alpha", checkout("alpha"));
    const { readAllProjects } = await seedLib();
    const { readBindings } = await lib();
    readAllProjects();

    const beta = checkout("beta");
    await addProject("beta", beta);
    readAllProjects();
    expect(readBindings(HOME).beta).toBe(beta);
  });
});

describe("an export carries no filesystem paths", () => {
  test("a project record written today contains no absolute path", async () => {
    const dir = checkout("alpha");
    await addProject("alpha", dir);

    const record = readFileSync(
      resolve(HOME, "memory", "projects", "alpha", "ISA.md"),
      "utf-8"
    );
    expect(record).toContain('name: "alpha"');
    expect(record).not.toContain(dir);
    expect(record).not.toContain("path:");
  });

  test("the path is still recoverable locally, from the binding", async () => {
    const dir = checkout("alpha");
    await addProject("alpha", dir);
    const { readProject } = await seedLib();
    expect(readProject("alpha")?.path).toBe(dir);
  });
});
