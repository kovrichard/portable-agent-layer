import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  defaultSlug,
  deleteProject,
  isStale,
  looksLikeProjectRoot,
  type ProjectProgress,
  readAllProjects,
  readProject,
  resolveProjectFromCwd,
  writeProject,
} from "../src/hooks/lib/projects";

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
  const dir = resolve(TEST_HOME, "memory", "projects");
  if (existsSync(dir)) rmSync(dir, { recursive: true });
});

function fakeProject(overrides: Partial<ProjectProgress> = {}): ProjectProgress {
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
  test("hyphenated basename stays whole — NOT split on '-'", () => {
    expect(defaultSlug("/repos/portable-agent-layer")).toBe("portable-agent-layer");
  });

  test("camelCase basename is lowercased but not split", () => {
    expect(defaultSlug("/repos/MyCoolProject")).toBe("mycoolproject");
  });

  test("underscored basename preserved", () => {
    expect(defaultSlug("/repos/my_cool_project")).toBe("my_cool_project");
  });

  test("trailing slash ignored", () => {
    expect(defaultSlug("/repos/portable-agent-layer/")).toBe("portable-agent-layer");
  });

  test("strips emoji + non-[a-z0-9_-] chars", () => {
    expect(defaultSlug("/repos/cool 🚀 project")).toBe("cool-project");
  });
});

describe("looksLikeProjectRoot", () => {
  test("returns true when .git is present", () => {
    const dir = resolve(TEST_HOME, "fake-repo");
    mkdirSync(resolve(dir, ".git"), { recursive: true });
    expect(looksLikeProjectRoot(dir)).toBe(true);
  });

  test("returns true when package.json is present", () => {
    const dir = resolve(TEST_HOME, "fake-node-pkg");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "package.json"), "{}");
    expect(looksLikeProjectRoot(dir)).toBe(true);
  });

  test("returns false for an empty directory", () => {
    const dir = resolve(TEST_HOME, "empty-dir");
    mkdirSync(dir, { recursive: true });
    expect(looksLikeProjectRoot(dir)).toBe(false);
  });

  test("returns false for a notes folder (no markers)", () => {
    const dir = resolve(TEST_HOME, "notes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "ideas.md"), "# Ideas\n");
    expect(looksLikeProjectRoot(dir)).toBe(false);
  });
});

describe("read/write/delete", () => {
  test("write then read round-trips", () => {
    const p = fakeProject({ name: "alpha", path: "/tmp/alpha" });
    writeProject(p);
    const got = readProject("alpha");
    expect(got).toEqual(p);
  });

  test("write then read round-trips with ISA body sections", () => {
    const p = fakeProject({
      name: "rich",
      path: "/tmp/rich",
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

  test("readAllProjects returns all written projects", () => {
    writeProject(fakeProject({ name: "a", path: "/tmp/a" }));
    writeProject(fakeProject({ name: "b", path: "/tmp/b" }));
    const all = readAllProjects();
    expect(all.map((p) => p.name).sort()).toEqual(["a", "b"]);
  });

  test("readProject returns null for unknown", () => {
    expect(readProject("nope")).toBeNull();
  });

  test("deleteProject removes file, returns true", () => {
    writeProject(fakeProject({ name: "doomed", path: "/tmp/d" }));
    expect(deleteProject("doomed")).toBe(true);
    expect(readProject("doomed")).toBeNull();
  });

  test("deleteProject returns false when project doesn't exist", () => {
    expect(deleteProject("ghost")).toBe(false);
  });

  test("malformed ISA.md in projects dir is skipped, not crashed on", () => {
    writeProject(fakeProject({ name: "valid", path: "/tmp/v" }));
    const dir = resolve(TEST_HOME, "memory", "projects", "broken");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "ISA.md"), "not valid frontmatter {{{");
    const all = readAllProjects();
    expect(all.length).toBe(1);
    expect(all[0].name).toBe("valid");
  });
});

describe("resolveProjectFromCwd — the load-bearing case", () => {
  test("parent-dir over multiple projects → null (browse mode)", () => {
    const projects = [
      fakeProject({ name: "app-a", path: "/repos/app-a" }),
      fakeProject({ name: "app-b", path: "/repos/app-b" }),
    ];
    expect(resolveProjectFromCwd("/repos", projects)).toBeNull();
  });

  test("exact match → that project", () => {
    const projects = [fakeProject({ name: "app-a", path: "/repos/app-a" })];
    const got = resolveProjectFromCwd("/repos/app-a", projects);
    expect(got?.name).toBe("app-a");
  });

  test("descendant of project → that project", () => {
    const projects = [fakeProject({ name: "app-a", path: "/repos/app-a" })];
    const got = resolveProjectFromCwd("/repos/app-a/src/hooks", projects);
    expect(got?.name).toBe("app-a");
  });

  test("nested registered projects → longest path wins", () => {
    const projects = [
      fakeProject({ name: "monorepo", path: "/repos/monorepo" }),
      fakeProject({ name: "pkg-foo", path: "/repos/monorepo/packages/foo" }),
    ];
    const got = resolveProjectFromCwd("/repos/monorepo/packages/foo/src", projects);
    expect(got?.name).toBe("pkg-foo");
  });

  test("unregistered cwd → null", () => {
    const projects = [fakeProject({ name: "pal", path: "/repos/pal" })];
    expect(resolveProjectFromCwd("/repos/some-other", projects)).toBeNull();
  });

  test("similar prefix without separator → null (no false match)", () => {
    const projects = [fakeProject({ name: "pal", path: "/repos/pal" })];
    expect(resolveProjectFromCwd("/repos/palette", projects)).toBeNull();
  });
});

describe("isStale", () => {
  test("recent project is not stale", () => {
    const p = fakeProject({ updated: new Date().toISOString() });
    expect(isStale(p)).toBe(false);
  });

  test("project older than threshold is stale", () => {
    const p = fakeProject({
      updated: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    });
    expect(isStale(p, 14)).toBe(true);
  });

  test("custom threshold respected", () => {
    const p = fakeProject({
      updated: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    });
    expect(isStale(p, 14)).toBe(false);
    expect(isStale(p, 3)).toBe(true);
  });
});
