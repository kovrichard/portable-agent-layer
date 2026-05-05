import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// Use os.tmpdir() so findProjectRoot's walk-up doesn't hit the PAL repo's
// own .git (which would happen if TEST_HOME lived inside the repo).
const TEST_HOME = mkdtempSync(resolve(tmpdir(), "pal-projects-context-"));

beforeAll(() => {
  process.env.PAL_HOME = TEST_HOME;
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

function fixtureRepoDir(slug: string): string {
  const dir = resolve(TEST_HOME, "fixtures", slug);
  mkdirSync(resolve(dir, ".git"), { recursive: true });
  return dir;
}

function fixturePlainDir(slug: string): string {
  const dir = resolve(TEST_HOME, "fixtures", slug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

describe("loadActiveProjectsContext", () => {
  test("empty corpus + non-project cwd → empty string", async () => {
    const lib = await freshLib();
    const cwd = fixturePlainDir("notes");
    expect(lib.loadActiveProjectsContext(cwd)).toBe("");
  });

  test("empty corpus + project-shaped cwd → only the registration hint", async () => {
    const lib = await freshLib();
    const cwd = fixtureRepoDir("unregistered-app");
    const out = lib.loadActiveProjectsContext(cwd);
    expect(out).toContain("💡");
    expect(out).toContain("looks like a project");
    expect(out).toContain("isn't registered");
    expect(out).toContain(cwd);
    expect(out).not.toContain("## Active Projects");
  });

  test("hint walks up to find ancestor project root from a deeper cwd", async () => {
    const lib = await freshLib();
    const root = fixtureRepoDir("deep-app");
    const deep = resolve(root, "src", "lib");
    mkdirSync(deep, { recursive: true });
    const out = lib.loadActiveProjectsContext(deep);
    expect(out).toContain(root);
  });

  test("registered project + cwd resolves → → here marker, no hint", async () => {
    const lib = await freshLib();
    const cwd = fixtureRepoDir("alpha");
    lib.writeProject({
      name: "alpha",
      path: cwd,
      status: "active",
      created: nowIso(),
      updated: nowIso(),
      objectives: ["ship tier 2"],
    });
    const out = lib.loadActiveProjectsContext(cwd);
    expect(out).toContain("## Active Projects");
    expect(out).toContain("**alpha**");
    expect(out).toContain("→ here");
    expect(out).toContain("Objectives: ship tier 2");
    expect(out).not.toContain("💡");
  });

  test("cwd is parent of registered projects → no → here, no hint (browse mode)", async () => {
    const lib = await freshLib();
    const a = fixtureRepoDir("multi/a");
    const b = fixtureRepoDir("multi/b");
    const parent = resolve(TEST_HOME, "fixtures", "multi");
    lib.writeProject({
      name: "a",
      path: a,
      status: "active",
      created: nowIso(),
      updated: nowIso(),
    });
    lib.writeProject({
      name: "b",
      path: b,
      status: "active",
      created: nowIso(),
      updated: nowIso(),
    });
    const out = lib.loadActiveProjectsContext(parent);
    expect(out).toContain("**a**");
    expect(out).toContain("**b**");
    expect(out).not.toContain("→ here");
    // Parent dir has no .git itself, so no hint either
    expect(out).not.toContain("💡");
  });

  test("archived projects are excluded; complete projects are excluded", async () => {
    const lib = await freshLib();
    lib.writeProject({
      name: "live",
      path: fixtureRepoDir("live"),
      status: "active",
      created: nowIso(),
      updated: nowIso(),
    });
    lib.writeProject({
      name: "shipped",
      path: fixtureRepoDir("shipped"),
      status: "complete",
      created: nowIso(),
      updated: nowIso(),
    });
    lib.writeProject({
      name: "old",
      path: fixtureRepoDir("old"),
      status: "archived",
      created: nowIso(),
      updated: nowIso(),
    });
    const out = lib.loadActiveProjectsContext(fixturePlainDir("notes"));
    expect(out).toContain("**live**");
    expect(out).not.toContain("**shipped**");
    expect(out).not.toContain("**old**");
  });

  test("paused projects are listed with paused prefix", async () => {
    const lib = await freshLib();
    lib.writeProject({
      name: "shelved",
      path: fixtureRepoDir("shelved"),
      status: "paused",
      created: nowIso(),
      updated: nowIso(),
    });
    const out = lib.loadActiveProjectsContext(fixturePlainDir("notes"));
    expect(out).toContain("**shelved** (paused,");
  });

  test("stale projects (>14d) get the ⚠ marker", async () => {
    const lib = await freshLib();
    lib.writeProject({
      name: "rusty",
      path: fixtureRepoDir("rusty"),
      status: "active",
      created: nowIso(-30 * 86_400_000),
      updated: nowIso(-30 * 86_400_000),
    });
    const out = lib.loadActiveProjectsContext(fixturePlainDir("notes"));
    expect(out).toContain("⚠ stale");
  });

  test("hint appears alongside list when cwd is project-shaped but unregistered", async () => {
    const lib = await freshLib();
    lib.writeProject({
      name: "registered-elsewhere",
      path: fixtureRepoDir("registered-elsewhere"),
      status: "active",
      created: nowIso(),
      updated: nowIso(),
    });
    const cwd = fixtureRepoDir("brand-new");
    const out = lib.loadActiveProjectsContext(cwd);
    expect(out).toContain("**registered-elsewhere**");
    expect(out).toContain("💡");
    expect(out).toContain(cwd);
  });

  test("notes folder (no project markers) → no hint even when projects exist elsewhere", async () => {
    const lib = await freshLib();
    lib.writeProject({
      name: "real",
      path: fixtureRepoDir("real"),
      status: "active",
      created: nowIso(),
      updated: nowIso(),
    });
    const cwd = fixturePlainDir("just-notes");
    const out = lib.loadActiveProjectsContext(cwd);
    expect(out).toContain("**real**");
    expect(out).not.toContain("💡");
  });
});
