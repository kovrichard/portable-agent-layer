import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
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

describe("seeding happens on the first read", () => {
  test("the first readAllProjects binds every locally present project", async () => {
    const alpha = checkout("alpha");
    const beta = checkout("beta");
    await addProject("alpha", alpha);
    await addProject("beta", beta);
    const { readAllProjects } = await seedLib();
    const { readBindings, bindingsFilePath } = await lib();

    expect(existsSync(bindingsFilePath(HOME))).toBe(false);
    readAllProjects();
    expect(readBindings(HOME)).toEqual({ alpha, beta });
  });

  test("a later read binds nothing new", async () => {
    await addProject("alpha", checkout("alpha"));
    const { readAllProjects, seedBindings } = await seedLib();

    readAllProjects();
    expect(seedBindings(readAllProjects(), HOME)).toEqual([]);
  });

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

  test("refuses a record whose path does not exist on this machine", async () => {
    await addProject("from-the-mac", "/Users/someone/dev/from-the-mac");
    const { readAllProjects } = await seedLib();
    const { bindingFor } = await lib();

    readAllProjects();
    expect(bindingFor("from-the-mac", HOME)).toBeNull();
  });

  // Seeded from a hand-built record rather than readAllProjects on purpose: a read
  // already substitutes the bound path, so going through it would compare a value
  // against itself and pass whether or not the guard exists.
  test("never overwrites a binding this machine already has", async () => {
    const { seedBindings } = await seedLib();
    const { writeBinding, bindingFor } = await lib();
    const recorded = checkout("alpha-elsewhere");
    const bound = checkout("alpha-here");

    writeBinding("alpha", bound, HOME);
    seedBindings(
      [
        {
          name: "alpha",
          path: recorded,
          status: "active",
          created: "2026-01-01",
          updated: "2026-01-01",
        },
      ],
      HOME
    );
    expect(bindingFor("alpha", HOME)).toBe(bound);
  });

  test("writes no file when there is nothing to bind", async () => {
    const { readAllProjects } = await seedLib();
    const { bindingsFilePath } = await lib();
    readAllProjects();
    expect(existsSync(bindingsFilePath(HOME))).toBe(false);
  });
});

describe("readProject resolves the path for this machine", () => {
  test("prefers the binding over the path stored in the record", async () => {
    await addProject("alpha", "/mac/path/alpha");
    const { readProject } = await seedLib();
    const { writeBinding } = await lib();

    writeBinding("alpha", "/vps/path/alpha", HOME);
    expect(readProject("alpha")?.path).toBe("/vps/path/alpha");
  });

  test("falls back to the record path while unbound", async () => {
    await addProject("alpha", "/mac/path/alpha");
    const { readProject } = await seedLib();
    expect(readProject("alpha")?.path).toBe("/mac/path/alpha");
  });
});

describe("test-sandbox guard", () => {
  test("refuses to write into the real ~/.pal while the suite is sandboxed", async () => {
    const { writeBindings } = await lib();
    const realHome = resolve(homedir(), ".pal");

    expect(process.env.PAL_TEST_SANDBOX).toBeTruthy();
    expect(() => writeBindings({ alpha: "/x" }, realHome)).toThrow(
      /Refusing to write bindings.json/
    );
    expect(existsSync(resolve(realHome, "bindings.json"))).toBe(false);
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
