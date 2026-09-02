import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-bindings-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

async function lib() {
  return await import("../src/hooks/lib/bindings");
}

async function addProject(name: string, path: string) {
  const { writeProject } = await import("../src/hooks/lib/projects");
  const now = new Date().toISOString();
  writeProject({ name, path, status: "active", created: now, updated: now });
}

/** A path that genuinely exists here — seeding refuses to adopt one that does not. */
function checkout(name: string): string {
  const dir = resolve(HOME, "checkouts", name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function seedLib() {
  return await import("../src/hooks/lib/projects");
}

describe("readBindings", () => {
  test("is empty on a machine that has never bound anything", async () => {
    const { readBindings } = await lib();
    expect(readBindings(HOME)).toEqual({});
  });

  test("degrades to empty on a corrupt file instead of throwing", async () => {
    const { readBindings, bindingsFilePath } = await lib();
    writeFileSync(bindingsFilePath(HOME), "{ not json");
    expect(readBindings(HOME)).toEqual({});
  });

  test("rejects a file whose values are not paths", async () => {
    const { readBindings, bindingsFilePath } = await lib();
    writeFileSync(bindingsFilePath(HOME), JSON.stringify({ app: { nested: true } }));
    expect(readBindings(HOME)).toEqual({});
  });
});

describe("writeBinding", () => {
  test("round-trips a project to an absolute path", async () => {
    const { writeBinding, bindingFor } = await lib();
    writeBinding("letterbox", "/srv/code/letterbox", HOME);
    expect(bindingFor("letterbox", HOME)).toBe("/srv/code/letterbox");
  });

  test("stores a relative path as absolute", async () => {
    const { writeBinding, bindingFor } = await lib();
    writeBinding("letterbox", "./letterbox", HOME);
    expect(bindingFor("letterbox", HOME)).toBe(resolve("./letterbox"));
  });

  test("rebinding replaces the previous path", async () => {
    const { writeBinding, bindingFor } = await lib();
    writeBinding("letterbox", "/old/letterbox", HOME);
    writeBinding("letterbox", "/new/letterbox", HOME);
    expect(bindingFor("letterbox", HOME)).toBe("/new/letterbox");
  });

  test("an unbound project reads as null, not a dead path", async () => {
    const { bindingFor } = await lib();
    expect(bindingFor("never-cloned-here", HOME)).toBeNull();
  });

  test("writes keys sorted so two machines produce comparable files", async () => {
    const { writeBinding, bindingsFilePath } = await lib();
    writeBinding("zeta", "/z", HOME);
    writeBinding("alpha", "/a", HOME);
    const raw = readFileSync(bindingsFilePath(HOME), "utf-8");
    expect(raw.indexOf("alpha")).toBeLessThan(raw.indexOf("zeta"));
  });
});

describe("removeBinding", () => {
  test("drops one project and leaves the rest", async () => {
    const { writeBinding, removeBinding, readBindings } = await lib();
    writeBinding("a", "/a", HOME);
    writeBinding("b", "/b", HOME);
    removeBinding("a", HOME);
    expect(readBindings(HOME)).toEqual({ b: "/b" });
  });

  test("removing an unbound project is a no-op", async () => {
    const { removeBinding, readBindings } = await lib();
    removeBinding("ghost", HOME);
    expect(readBindings(HOME)).toEqual({});
  });
});

describe("seedBindingsFromProjects", () => {
  test("adopts the path already stored on each project record", async () => {
    const alpha = checkout("alpha");
    const beta = checkout("beta");
    await addProject("alpha", alpha);
    await addProject("beta", beta);
    const { seedBindingsFromProjects } = await seedLib();
    const { readBindings } = await lib();

    expect(seedBindingsFromProjects(HOME).sort()).toEqual(["alpha", "beta"]);
    expect(readBindings(HOME)).toEqual({ alpha, beta });
  });

  test("refuses a record whose path does not exist on this machine", async () => {
    await addProject("from-the-mac", "/Users/someone/dev/from-the-mac");
    const { seedBindingsFromProjects } = await seedLib();
    const { bindingFor } = await lib();

    expect(seedBindingsFromProjects(HOME)).toEqual([]);
    expect(bindingFor("from-the-mac", HOME)).toBeNull();
  });

  test("is idempotent — a second run seeds nothing", async () => {
    await addProject("alpha", checkout("alpha"));
    const { seedBindingsFromProjects } = await seedLib();

    seedBindingsFromProjects(HOME);
    expect(seedBindingsFromProjects(HOME)).toEqual([]);
  });

  test("never overwrites a binding this machine already has", async () => {
    await addProject("alpha", checkout("alpha"));
    const { seedBindingsFromProjects } = await seedLib();
    const { writeBinding, bindingFor } = await lib();

    writeBinding("alpha", "/vps/path/alpha", HOME);
    expect(seedBindingsFromProjects(HOME)).toEqual([]);
    expect(bindingFor("alpha", HOME)).toBe("/vps/path/alpha");
  });

  test("writes no file when there are no projects to seed", async () => {
    const { seedBindingsFromProjects } = await seedLib();
    const { bindingsFilePath } = await lib();
    expect(seedBindingsFromProjects(HOME)).toEqual([]);
    expect(existsSync(bindingsFilePath(HOME))).toBe(false);
  });
});

describe("bindings never sync", () => {
  test("the bindings file is excluded from an export", async () => {
    const { writeBinding, bindingsFilePath } = await lib();
    const { collectExportFiles } = await import("../src/hooks/lib/export");

    writeBinding("alpha", "/work/alpha", HOME);
    expect(existsSync(bindingsFilePath(HOME))).toBe(true);

    const exported = collectExportFiles();
    expect(exported.some((f) => f.includes("bindings.json"))).toBe(false);
  });
});
