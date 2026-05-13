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
  const dir = resolve(TEST_HOME, "memory", "projects");
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
      goal: "ship tier 2",
    });
    const out = lib.loadActiveProjectsContext(cwd);
    expect(out).toContain("## Active Projects");
    expect(out).toContain("**alpha**");
    expect(out).toContain("→ here");
    expect(out).toContain("Objectives: ship tier 2");
    expect(out).not.toContain("💡");
  });

  test("facts surface in the cwd-resolved project block", async () => {
    const lib = await freshLib();
    const cwd = fixtureRepoDir("with-facts");
    lib.writeProject({
      name: "with-facts",
      path: cwd,
      status: "active",
      created: nowIso(),
      updated: nowIso(),
      context: "Upstream lives at /repos/upstream\nTech stack: Bun + TS",
    });
    const out = lib.loadActiveProjectsContext(cwd);
    expect(out).toContain("Facts:");
    expect(out).toContain("Upstream lives at /repos/upstream");
    expect(out).toContain("Tech stack: Bun + TS");
  });

  test("facts do NOT surface in compact one-liner for non-resolved projects", async () => {
    const lib = await freshLib();
    const otherRepo = fixtureRepoDir("other");
    lib.writeProject({
      name: "other",
      path: otherRepo,
      status: "active",
      created: nowIso(),
      updated: nowIso(),
      context: "Some private fact",
    });
    // cwd is a plain dir, not the registered project
    const out = lib.loadActiveProjectsContext(fixturePlainDir("notes"));
    expect(out).toContain("**other**");
    expect(out).not.toContain("Facts:");
    expect(out).not.toContain("Some private fact");
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

  test("non-resolved projects render as one-liners with counts, not full blocks", async () => {
    const lib = await freshLib();
    lib.writeProject({
      name: "verbose",
      path: fixtureRepoDir("verbose"),
      status: "active",
      created: nowIso(),
      updated: nowIso(),
      goal: "should not appear\nneither this",
      next: ["a", "b", "c", "d"],
      blockers: ["x"],
    });
    const out = lib.loadActiveProjectsContext(fixturePlainDir("notes"));
    expect(out).toContain("**verbose**");
    expect(out).toContain("4 next");
    expect(out).toContain("1 blockers");
    expect(out).not.toContain("Objectives:");
    expect(out).not.toContain("Next:");
    expect(out).not.toContain("Blockers:");
    expect(out).not.toContain("should not appear");
  });

  test("resolved project shows full detail; siblings stay one-liner", async () => {
    const lib = await freshLib();
    const here = fixtureRepoDir("focus");
    lib.writeProject({
      name: "focus",
      path: here,
      status: "active",
      created: nowIso(),
      updated: nowIso(),
      goal: "land tier 4",
      next: ["one", "two"],
    });
    lib.writeProject({
      name: "sidekick",
      path: fixtureRepoDir("sidekick"),
      status: "active",
      created: nowIso(),
      updated: nowIso(-60_000),
      goal: "unrelated work",
      next: ["x", "y", "z"],
    });
    const out = lib.loadActiveProjectsContext(here);
    expect(out).toContain("**focus**");
    expect(out).toContain("→ here");
    expect(out).toContain("Objectives: land tier 4");
    expect(out).toContain("Next: one; two");
    expect(out).toContain("**sidekick**");
    expect(out).toContain("3 next");
    expect(out).not.toContain("unrelated work");
  });

  test("constraints surface in the cwd-resolved project block", async () => {
    const lib = await freshLib();
    const cwd = fixtureRepoDir("constrained");
    lib.writeProject({
      name: "constrained",
      path: cwd,
      status: "active",
      created: nowIso(),
      updated: nowIso(),
      constraints:
        "- Bun >= 1.3.0 only\n- No agent-specific imports in core logic\n- PAL_HOME override must work everywhere",
    });
    const out = lib.loadActiveProjectsContext(cwd);
    expect(out).toContain("Constraints:");
    expect(out).toContain("Bun >= 1.3.0 only");
    expect(out).toContain("No agent-specific imports in core logic");
  });

  test("constraints do NOT surface in compact one-liner for non-resolved projects", async () => {
    const lib = await freshLib();
    lib.writeProject({
      name: "other-constrained",
      path: fixtureRepoDir("other-constrained"),
      status: "active",
      created: nowIso(),
      updated: nowIso(),
      constraints: "- Secret constraint",
    });
    const out = lib.loadActiveProjectsContext(fixturePlainDir("notes"));
    expect(out).not.toContain("Constraints:");
    expect(out).not.toContain("Secret constraint");
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
