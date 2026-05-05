import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-projects");

beforeAll(() => {
  process.env.PAL_HOME = TEST_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(TEST_HOME, { recursive: true });
});

afterAll(() => {
  delete process.env.PAL_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
});

beforeEach(() => {
  const dir = resolve(TEST_HOME, "memory", "state", "progress");
  if (existsSync(dir)) rmSync(dir, { recursive: true });
});

async function freshLib() {
  const t = Date.now();
  const mod = await import(`../src/hooks/lib/projects.ts?t=${t}`);
  return mod as typeof import("../src/hooks/lib/projects");
}

function fakeProject(
  overrides: Partial<import("../src/hooks/lib/projects").ProjectProgress> = {}
): import("../src/hooks/lib/projects").ProjectProgress {
  return {
    name: "demo",
    path: "/tmp/demo",
    status: "active",
    created: "2026-05-04T10:00:00Z",
    updated: "2026-05-04T10:00:00Z",
    ...overrides,
  };
}

describe("defaultSlug — load-bearing slug derivation", () => {
  test("hyphenated basename stays whole — NOT split on '-'", async () => {
    const { defaultSlug } = await freshLib();
    expect(defaultSlug("/repos/portable-agent-layer")).toBe("portable-agent-layer");
  });

  test("camelCase basename is lowercased but not split", async () => {
    const { defaultSlug } = await freshLib();
    expect(defaultSlug("/repos/MyCoolProject")).toBe("mycoolproject");
  });

  test("underscored basename preserved", async () => {
    const { defaultSlug } = await freshLib();
    expect(defaultSlug("/repos/my_cool_project")).toBe("my_cool_project");
  });

  test("trailing slash ignored", async () => {
    const { defaultSlug } = await freshLib();
    expect(defaultSlug("/repos/portable-agent-layer/")).toBe("portable-agent-layer");
  });

  test("strips emoji + non-[a-z0-9_-] chars", async () => {
    const { defaultSlug } = await freshLib();
    expect(defaultSlug("/repos/cool 🚀 project")).toBe("cool-project");
  });
});

describe("looksLikeProjectRoot", () => {
  test("returns true when .git is present", async () => {
    const { looksLikeProjectRoot } = await freshLib();
    const dir = resolve(TEST_HOME, "fake-repo");
    mkdirSync(resolve(dir, ".git"), { recursive: true });
    expect(looksLikeProjectRoot(dir)).toBe(true);
  });

  test("returns true when package.json is present", async () => {
    const { looksLikeProjectRoot } = await freshLib();
    const dir = resolve(TEST_HOME, "fake-node-pkg");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "package.json"), "{}");
    expect(looksLikeProjectRoot(dir)).toBe(true);
  });

  test("returns false for an empty directory", async () => {
    const { looksLikeProjectRoot } = await freshLib();
    const dir = resolve(TEST_HOME, "empty-dir");
    mkdirSync(dir, { recursive: true });
    expect(looksLikeProjectRoot(dir)).toBe(false);
  });

  test("returns false for a notes folder (no markers)", async () => {
    const { looksLikeProjectRoot } = await freshLib();
    const dir = resolve(TEST_HOME, "notes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "ideas.md"), "# Ideas\n");
    expect(looksLikeProjectRoot(dir)).toBe(false);
  });
});

describe("read/write/delete", () => {
  test("write then read round-trips", async () => {
    const lib = await freshLib();
    const p = fakeProject({ name: "alpha", path: "/tmp/alpha" });
    lib.writeProject(p);
    const got = lib.readProject("alpha");
    expect(got).toEqual(p);
  });

  test("readAllProjects returns all written projects", async () => {
    const lib = await freshLib();
    lib.writeProject(fakeProject({ name: "a", path: "/tmp/a" }));
    lib.writeProject(fakeProject({ name: "b", path: "/tmp/b" }));
    const all = lib.readAllProjects();
    expect(all.map((p) => p.name).sort()).toEqual(["a", "b"]);
  });

  test("readProject returns null for unknown", async () => {
    const lib = await freshLib();
    expect(lib.readProject("nope")).toBeNull();
  });

  test("deleteProject removes file, returns true", async () => {
    const lib = await freshLib();
    lib.writeProject(fakeProject({ name: "doomed", path: "/tmp/d" }));
    expect(lib.deleteProject("doomed")).toBe(true);
    expect(lib.readProject("doomed")).toBeNull();
  });

  test("deleteProject returns false when project doesn't exist", async () => {
    const lib = await freshLib();
    expect(lib.deleteProject("ghost")).toBe(false);
  });

  test("malformed JSON in progress dir is skipped, not crashed on", async () => {
    const lib = await freshLib();
    lib.writeProject(fakeProject({ name: "valid", path: "/tmp/v" }));
    const dir = resolve(TEST_HOME, "memory", "state", "progress");
    writeFileSync(resolve(dir, "broken.json"), "not json {{{");
    const all = lib.readAllProjects();
    expect(all.length).toBe(1);
    expect(all[0].name).toBe("valid");
  });
});

describe("resolveProjectFromCwd — the load-bearing case", () => {
  test("parent-dir over multiple projects → null (browse mode)", async () => {
    const lib = await freshLib();
    const projects = [
      fakeProject({ name: "app-a", path: "/repos/app-a" }),
      fakeProject({ name: "app-b", path: "/repos/app-b" }),
    ];
    expect(lib.resolveProjectFromCwd("/repos", projects)).toBeNull();
  });

  test("exact match → that project", async () => {
    const lib = await freshLib();
    const projects = [fakeProject({ name: "app-a", path: "/repos/app-a" })];
    const got = lib.resolveProjectFromCwd("/repos/app-a", projects);
    expect(got?.name).toBe("app-a");
  });

  test("descendant of project → that project", async () => {
    const lib = await freshLib();
    const projects = [fakeProject({ name: "app-a", path: "/repos/app-a" })];
    const got = lib.resolveProjectFromCwd("/repos/app-a/src/hooks", projects);
    expect(got?.name).toBe("app-a");
  });

  test("nested registered projects → longest path wins", async () => {
    const lib = await freshLib();
    const projects = [
      fakeProject({ name: "monorepo", path: "/repos/monorepo" }),
      fakeProject({ name: "pkg-foo", path: "/repos/monorepo/packages/foo" }),
    ];
    const got = lib.resolveProjectFromCwd("/repos/monorepo/packages/foo/src", projects);
    expect(got?.name).toBe("pkg-foo");
  });

  test("unregistered cwd → null", async () => {
    const lib = await freshLib();
    const projects = [fakeProject({ name: "pal", path: "/repos/pal" })];
    expect(lib.resolveProjectFromCwd("/repos/some-other", projects)).toBeNull();
  });

  test("similar prefix without separator → null (no false match)", async () => {
    const lib = await freshLib();
    const projects = [fakeProject({ name: "pal", path: "/repos/pal" })];
    // /repos/palette starts with /repos/pal but is NOT a descendant
    expect(lib.resolveProjectFromCwd("/repos/palette", projects)).toBeNull();
  });
});

describe("isStale", () => {
  test("recent project is not stale", async () => {
    const { isStale } = await freshLib();
    const p = fakeProject({ updated: new Date().toISOString() });
    expect(isStale(p)).toBe(false);
  });

  test("project older than threshold is stale", async () => {
    const { isStale } = await freshLib();
    const p = fakeProject({
      updated: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    });
    expect(isStale(p, 14)).toBe(true);
  });

  test("custom threshold respected", async () => {
    const { isStale } = await freshLib();
    const p = fakeProject({
      updated: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    });
    expect(isStale(p, 14)).toBe(false);
    expect(isStale(p, 3)).toBe(true);
  });
});
