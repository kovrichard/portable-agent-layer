import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { storeDir } from "../src/bronze/bronze";
import { readProject, writeProject } from "../src/progress/projects";

const isaFilePath = (slug: string) =>
  resolve(storeDir("project-history"), slug, "ISA.md");

import { removeOnceReleased } from "./lib/remove-once-released";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { outsideRepoHome } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const ORIGINAL_CWD = process.cwd();
let TEST_HOME: string;

// realpathSync is required on macOS where /tmp → /private/tmp: process.cwd()
// canonicalizes after chdir, so registered paths must be canonical too or
// resolveProjectFromCwd's startsWith check misses.
beforeAll(() => {
  const home = outsideRepoHome(import.meta.file);
  removeOnceReleased(home);
  mkdirSync(home, { recursive: true });
  TEST_HOME = realpathSync(home);
  process.env.PAL_HOME = TEST_HOME;
});

beforeEach(() => {
  process.chdir(ORIGINAL_CWD);
  const dir = resolve(TEST_HOME, "memory", "projects");
  removeOnceReleased(dir);
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
  const mod = await import("../src/hooks/handlers/project-touch");

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
      await projectTouch();
    }

    // Each call updates timestamp — that's by design (it's a touch).
    // The contract is: file remains parseable, no duplicate side-effects in any list.
    const after = readProject("rapid");
    expect(after).not.toBeNull();
    expect(after?.next ?? []).toEqual([]);
    expect(after?.blockers ?? []).toEqual([]);
    // decisions body section should never be touched by project-touch
    expect(after?.decisions).toBeUndefined();
  });

  test("a touch leaves the synced ISA.md byte for byte as it was", async () => {
    const repo = fixtureRepo("synced");
    writeProject({
      name: "synced",
      path: repo,
      status: "active",
      created: nowIso(-86_400_000),
      updated: nowIso(-86_400_000),
    });
    const isa = readFileSync(isaFilePath("synced"), "utf-8");
    process.chdir(repo);

    await (await freshHandler())();

    expect(readFileSync(isaFilePath("synced"), "utf-8")).toBe(isa);
    expect(Date.now() - Date.parse(readProject("synced")?.updated ?? "")).toBeLessThan(
      5_000
    );
  });

  test("another machine's newer history day shows as the project's last activity", () => {
    const before = "2026-01-01T00:00:00.000Z";
    writeProject({
      name: "elsewhere",
      status: "active",
      created: before,
      updated: before,
    });
    const history = resolve(storeDir("project-history"), "elsewhere", "history.jsonl");
    mkdirSync(dirname(history), { recursive: true });
    writeFileSync(
      history,
      '{"date":"2026-03-04","title":"t","summary":"","insights":""}\n'
    );

    expect(readProject("elsewhere")?.updated).toBe("2026-03-04T00:00:00.000Z");
  });
});
