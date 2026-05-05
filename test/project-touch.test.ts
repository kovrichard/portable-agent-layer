import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readProject, writeProject } from "../src/hooks/lib/projects";

// Use os.tmpdir() so tests don't interact with the real PAL home or with the
// PAL repo's own .git when resolveProjectFromCwd or process.cwd() are involved.
// realpathSync is required on macOS where /tmp → /private/tmp: process.cwd()
// canonicalizes after chdir, so registered paths must be canonical too or
// resolveProjectFromCwd's startsWith check misses.
const TEST_HOME = realpathSync(mkdtempSync(resolve(tmpdir(), "pal-project-touch-")));
const ORIGINAL_CWD = process.cwd();

beforeAll(() => {
  process.env.PAL_HOME = TEST_HOME;
});

afterAll(() => {
  delete process.env.PAL_HOME;
  process.chdir(ORIGINAL_CWD);
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
});

beforeEach(() => {
  const dir = resolve(TEST_HOME, "memory", "state", "progress");
  if (existsSync(dir)) rmSync(dir, { recursive: true });
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
});

function fixtureRepo(slug: string): string {
  const dir = resolve(TEST_HOME, "fixtures", slug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

async function freshHandler() {
  const t = Date.now();
  const mod = await import(`../src/hooks/handlers/project-touch.ts?t=${t}`);
  return mod.projectTouch as (lastAssistantMessage?: string) => Promise<void>;
}

describe("projectTouch — auto-write contract", () => {
  test("active project + cwd resolves → updated bumped", async () => {
    const repo = fixtureRepo("alpha");
    const before = nowIso(-10 * 86_400_000);
    writeProject({
      name: "alpha",
      path: repo,
      status: "active",
      created: before,
      updated: before,
    });
    process.chdir(repo);

    const projectTouch = await freshHandler();
    await projectTouch();

    const after = readProject("alpha");
    expect(after).not.toBeNull();
    expect(new Date(after?.updated ?? 0).getTime()).toBeGreaterThan(
      new Date(before).getTime()
    );
  });

  test("descendant cwd resolves to project + bumps it", async () => {
    const repo = fixtureRepo("descendant");
    const sub = resolve(repo, "src", "lib");
    mkdirSync(sub, { recursive: true });
    writeProject({
      name: "descendant",
      path: repo,
      status: "active",
      created: nowIso(-86_400_000),
      updated: nowIso(-86_400_000),
    });
    process.chdir(sub);

    const projectTouch = await freshHandler();
    await projectTouch();

    const after = readProject("descendant");
    const ageMs = Date.now() - new Date(after?.updated ?? 0).getTime();
    expect(ageMs).toBeLessThan(5_000);
  });

  test("paused project → no-op (writes preserved but updated NOT bumped)", async () => {
    const repo = fixtureRepo("shelved");
    const before = nowIso(-86_400_000);
    writeProject({
      name: "shelved",
      path: repo,
      status: "paused",
      created: before,
      updated: before,
    });
    process.chdir(repo);

    const projectTouch = await freshHandler();
    await projectTouch();

    const after = readProject("shelved");
    expect(after?.updated).toBe(before);
  });

  test("complete + archived projects → no-op", async () => {
    const repoA = fixtureRepo("done");
    const repoB = fixtureRepo("old");
    const before = nowIso(-86_400_000);
    writeProject({
      name: "done",
      path: repoA,
      status: "complete",
      created: before,
      updated: before,
    });
    writeProject({
      name: "old",
      path: repoB,
      status: "archived",
      created: before,
      updated: before,
    });

    process.chdir(repoA);
    let projectTouch = await freshHandler();
    await projectTouch();
    expect(readProject("done")?.updated).toBe(before);

    process.chdir(repoB);
    projectTouch = await freshHandler();
    await projectTouch();
    expect(readProject("old")?.updated).toBe(before);
  });

  test("parent-dir browse mode → no auto-update on any child", async () => {
    const a = fixtureRepo("multi/a");
    const b = fixtureRepo("multi/b");
    const parent = resolve(TEST_HOME, "fixtures", "multi");
    const before = nowIso(-86_400_000);
    writeProject({
      name: "a",
      path: a,
      status: "active",
      created: before,
      updated: before,
    });
    writeProject({
      name: "b",
      path: b,
      status: "active",
      created: before,
      updated: before,
    });

    process.chdir(parent);
    const projectTouch = await freshHandler();
    await projectTouch();

    expect(readProject("a")?.updated).toBe(before);
    expect(readProject("b")?.updated).toBe(before);
  });

  test("unregistered cwd + no projects on disk → no-op, no error", async () => {
    const elsewhere = fixtureRepo("nowhere");
    process.chdir(elsewhere);
    const projectTouch = await freshHandler();
    await expect(projectTouch()).resolves.toBeUndefined();
  });

  test("handoff captured from lastAssistantMessage, capped at 300 chars", async () => {
    const repo = fixtureRepo("handoff-test");
    writeProject({
      name: "handoff-test",
      path: repo,
      status: "active",
      created: nowIso(),
      updated: nowIso(),
    });
    process.chdir(repo);

    const longMsg = `Next steps: ${"x".repeat(500)}`;
    const projectTouch = await freshHandler();
    await projectTouch(longMsg);

    const after = readProject("handoff-test");
    expect(after?.handoff).toBeDefined();
    expect((after?.handoff ?? "").length).toBeLessThanOrEqual(300);
  });

  test("no lastAssistantMessage → handoff field NOT set on first run", async () => {
    const repo = fixtureRepo("no-handoff");
    writeProject({
      name: "no-handoff",
      path: repo,
      status: "active",
      created: nowIso(),
      updated: nowIso(),
    });
    process.chdir(repo);

    const projectTouch = await freshHandler();
    await projectTouch();

    expect(readProject("no-handoff")?.handoff).toBeUndefined();
  });

  test("rapid-call idempotency: 50× calls leave a stable, parseable JSON", async () => {
    const repo = fixtureRepo("rapid");
    writeProject({
      name: "rapid",
      path: repo,
      status: "active",
      created: nowIso(-86_400_000),
      updated: nowIso(-86_400_000),
    });
    process.chdir(repo);

    const projectTouch = await freshHandler();
    for (let i = 0; i < 50; i++) {
      await projectTouch("Next steps: keep iterating");
    }

    // Each call updates timestamp — that's by design (it's a touch).
    // The contract is: file remains parseable, no duplicate side-effects in any list.
    const after = readProject("rapid");
    expect(after).not.toBeNull();
    expect(after?.handoff).toBe("Next steps: keep iterating");
    expect(after?.objectives ?? []).toEqual([]);
    expect(after?.next_steps ?? []).toEqual([]);
    expect(after?.blockers ?? []).toEqual([]);
    // decisions[] should never be touched by project-touch
    expect(after?.decisions ?? []).toEqual([]);
  });
});
