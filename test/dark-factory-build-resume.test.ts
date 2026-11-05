import { describe, expect, test } from "bun:test";
import * as build from "../assets/plugins/dark-factory/scripts/build.mjs";
import {
  buildWorld,
  eventsNamed,
  TASK,
  type World,
} from "./lib/dark-factory-build-fixture";

const HEAD = "a".repeat(40);
const MOVED = "b".repeat(40);
const STEP_NAMES = ["code", "review", "tester"];

type GitState = { head: string; dirty: boolean };

function withGit(world: World, git: GitState) {
  const base = world.effects.spawnTool as () => object;
  world.effects.spawnTool = (_command: string, args: string[]) => {
    if (args[0] === "rev-parse") return { status: 0, stdout: `${git.head}\n` };
    if (args[0] === "status") return { status: 0, stdout: git.dirty ? " M a.ts\n" : "" };
    return base();
  };
}

function worldAt(git: GitState, options: Parameters<typeof buildWorld>[1] = {}) {
  const world = buildWorld(import.meta.file, { category: "feature", ...options });
  withGit(world, git);
  return world;
}

function runBuild(world: World) {
  return build.runBuild(TASK, { env: world.env, effects: world.effects });
}

const rolesRun = (world: World, from: number) =>
  world.roleCalls
    .slice(from)
    .map((call) => call.role)
    .filter((role) => role !== "po");

const TESTER_FAILS = { tester: [{ exit: 1 }] };

describe("step_done events", () => {
  test("a ready build records code, review and tester with the HEAD commit", () => {
    const world = worldAt({ head: HEAD, dirty: false });
    expect(runBuild(world).status).toBe("ready");
    const done = eventsNamed(world, "step_done");
    expect(done.map((event) => event.step)).toEqual(STEP_NAMES);
    for (const event of done) expect(event).toMatchObject({ task: TASK, head: HEAD });
  });

  test("a step that stops is not recorded as done", () => {
    const world = worldAt({ head: HEAD, dirty: false }, { roles: TESTER_FAILS });
    expect(runBuild(world).status).toBe("stuck");
    expect(eventsNamed(world, "step_done").map((event) => event.step)).toEqual([
      "code",
      "review",
    ]);
  });
});

describe("resuming at the last finished step", () => {
  test("review done at HEAD: a rerun starts at the tester", () => {
    const world = worldAt({ head: HEAD, dirty: false }, { roles: TESTER_FAILS });
    runBuild(world);
    const from = world.roleCalls.length;
    expect(runBuild(world)).toMatchObject({ status: "ready" });
    expect(rolesRun(world, from)).toEqual(["tester"]);
  });

  test("the rerun still runs prepare", () => {
    const world = worldAt({ head: HEAD, dirty: false }, { roles: TESTER_FAILS });
    runBuild(world);
    runBuild(world);
    expect(eventsNamed(world, "task_started")).toHaveLength(2);
  });

  test("HEAD moved: nothing is skipped and the code writer runs", () => {
    const git = { head: HEAD, dirty: false };
    const world = worldAt(git, { roles: TESTER_FAILS });
    runBuild(world);
    const from = world.roleCalls.length;
    git.head = MOVED;
    runBuild(world);
    expect(rolesRun(world, from)).toEqual(["code-writer", "reviewer", "tester"]);
    expect(eventsNamed(world, "step_skipped")).toHaveLength(0);
  });

  test("a dirty worktree: nothing is skipped", () => {
    const git = { head: HEAD, dirty: false };
    const world = worldAt(git, { roles: TESTER_FAILS });
    runBuild(world);
    const from = world.roleCalls.length;
    git.dirty = true;
    runBuild(world);
    expect(rolesRun(world, from)).toEqual(["code-writer", "reviewer", "tester"]);
  });

  test("each skipped step is logged with its name and the HEAD", () => {
    const world = worldAt({ head: HEAD, dirty: false }, { roles: TESTER_FAILS });
    runBuild(world);
    runBuild(world);
    const skipped = eventsNamed(world, "step_skipped");
    expect(skipped.map((event) => event.step)).toEqual(["code", "review"]);
    for (const event of skipped) expect(event).toMatchObject({ task: TASK, head: HEAD });
  });
});
