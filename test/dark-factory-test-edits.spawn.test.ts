import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as build from "../assets/plugins/dark-factory/scripts/build.mjs";
import { taskDir } from "../assets/plugins/dark-factory/scripts/lib.mjs";
import { FACTORY_MODELS } from "../src/tools/dark-factory/stamp";
import {
  buildWorld,
  DEFAULT_CONFIG,
  eventsNamed,
  type RoleStep,
  SPEC,
  TASK,
  TESTS_COMMAND,
  type World,
} from "./lib/dark-factory-build-fixture";
import { removeOnceReleased } from "./lib/remove-once-released";

const QUESTION = { done: false, summary: "", question: "is the test right?" };
const ASKS: RoleStep = { reply: QUESTION, codes: false };
const ORIGINAL = "original\n";
const EDITED = "edited\n";
const FIXED = "fixed by the test writer\n";
const STRAY = "stray edit\n";
const FIXER = "code-writer#1";
const EVENT = "test_edits_restored";

type Action = (dir: string) => void;
type Setup = {
  committed?: Record<string, string>;
  uncommitted?: Record<string, string>;
  config?: object;
  roles?: Record<string, RoleStep[]>;
  actions?: Record<string, Action>;
  checks?: Record<string, (world: World) => { exitCode: number; output: string }>;
  failWriteTreeFrom?: number;
  ci?: NonNullable<Parameters<typeof buildWorld>[1]>["ci"];
};

type Spawn = { status: number; stdout: string; stderr: string };

function runGit(
  cwd: string,
  args: string[],
  extraEnv: Record<string, string> = {}
): Spawn {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;
  }
  const result = Bun.spawnSync({
    cmd: [
      "git",
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    cwd,
    env: { ...env, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    status: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function put(dir: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

const write =
  (path: string, content: string): Action =>
  (dir) =>
    put(dir, { [path]: content });

const remove =
  (path: string): Action =>
  (dir) =>
    removeOnceReleased(join(dir, path));

const together =
  (...actions: Action[]): Action =>
  (dir) => {
    for (const action of actions) action(dir);
  };

const commitAll: Action = (dir) => {
  runGit(dir, ["add", "-A"]);
  runGit(dir, ["commit", "-m", "work"]);
};

function treeOf(dir: string): string {
  const index = join(dir, ".git", "scratch-index");
  const env = { GIT_INDEX_FILE: index };
  runGit(dir, ["add", "-A"], env);
  const tree = runGit(dir, ["write-tree"], env).stdout.trim();
  removeOnceReleased(index);
  return tree;
}

function initRepo(dir: string, committed: Record<string, string>) {
  runGit(dir, ["init", "-b", "canary"]);
  put(dir, { "README.md": "readme\n", ...committed });
  runGit(dir, ["add", "-A"]);
  runGit(dir, ["commit", "-m", "base"]);
  runGit(dir, ["update-ref", "refs/remotes/origin/canary", "HEAD"]);
}

function realGit(world: World, setup: Setup) {
  let writeTrees = 0;
  const effects = world.effects as Record<string, unknown>;
  effects.spawnTool = (
    command: string,
    args: string[],
    options: { cwd: string; env?: Record<string, string> }
  ) => {
    if (command === "git" && args[0] === "write-tree") {
      writeTrees += 1;
      if (setup.failWriteTreeFrom && writeTrees >= setup.failWriteTreeFrom)
        return { status: 128, stdout: "", stderr: "fatal" };
    }
    if (command !== "git") return { status: 0, stdout: "", stderr: "" };
    const env = Object.fromEntries(
      Object.entries(options.env ?? {}).filter(([key]) => key.startsWith("GIT_"))
    );
    return runGit(options.cwd, args, env);
  };
}

function withActions(world: World, setup: Setup, started: { tree?: string }) {
  const effects = world.effects as Record<string, (...args: never[]) => unknown>;
  const fakeRole = effects.runRoleHeadless as (...args: unknown[]) => unknown;
  effects.runRoleHeadless = ((id: string, role: string, args: unknown) => {
    const before = world.roleCalls.filter((call) => call.role === role).length;
    if (role === "code-writer" && before === 0) started.tree = treeOf(world.worktree);
    const outcome = fakeRole(id, role, args);
    setup.actions?.[`${role}#${before}`]?.(world.worktree);
    return outcome;
  }) as never;
}

function scenario(setup: Setup = {}) {
  const world = buildWorld(import.meta.file, {
    roles: setup.roles,
    config: setup.config ?? DEFAULT_CONFIG,
    checks: setup.checks,
    ci: setup.ci,
  });
  initRepo(world.worktree, setup.committed ?? {});
  put(world.worktree, setup.uncommitted ?? {});
  const started: { tree?: string } = {};
  realGit(world, setup);
  withActions(world, setup, started);
  return { world, started };
}

const run = (world: World) =>
  build.runBuild(TASK, { env: world.env, effects: world.effects });
const restoredEvents = (world: World) => eventsNamed(world, EVENT);
const restoredFiles = (world: World) =>
  restoredEvents(world).flatMap((event) => event.files as string[]);
const codeWriterRuns = (world: World) =>
  world.roleCalls.filter((call) => call.role === "code-writer").length;
const fixerInstructions = (world: World) =>
  world.roleCalls.filter((call) => call.role === "code-writer")[1]?.instructions ?? "";

function editedThenRestored(path: string, committed = ORIGINAL) {
  return scenario({
    committed: { [path]: committed },
    actions: {
      "code-writer#0": write(path, EDITED),
      [FIXER]: together(write(path, committed), commitAll),
    },
  });
}

describe("which files the code step may not edit (default rules)", () => {
  test.each([
    "src/a.test.ts",
    "src/b.spec.js",
    "test/helper.ts",
    "tests/fixtures/data.json",
    "src/__tests__/x.ts",
    "lib/test/y.ts",
  ])("an edit to %s is restored", (path) => {
    const { world } = editedThenRestored(path);
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual([path]);
  });

  test.each([
    "src/app.ts",
    "src/latest.ts",
    "contest/a.ts",
    "src/testing/x.ts",
    "docs/readme.md",
  ])("an edit to the non-test file %s is not", (path) => {
    const { world } = scenario({
      committed: { [path]: ORIGINAL },
      actions: { "code-writer#0": write(path, EDITED) },
    });
    expect(run(world).status).toBe("ready");
    expect(restoredEvents(world)).toHaveLength(0);
    expect(codeWriterRuns(world)).toBe(1);
  });
});

describe("testPaths in .dark-factory.json", () => {
  const config = { ...DEFAULT_CONFIG, testPaths: ["spec/"] };

  test("a file under a testPaths entry is a test file", () => {
    const { world } = scenario({
      config,
      committed: { "spec/a.ts": ORIGINAL },
      actions: {
        "code-writer#0": write("spec/a.ts", EDITED),
        [FIXER]: together(write("spec/a.ts", ORIGINAL), commitAll),
      },
    });
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual(["spec/a.ts"]);
  });

  test("testPaths replaces the defaults, so a .test. file outside it is not protected", () => {
    const { world } = scenario({
      config,
      committed: { "src/a.test.ts": ORIGINAL },
      actions: { "code-writer#0": write("src/a.test.ts", EDITED) },
    });
    expect(run(world).status).toBe("ready");
    expect(restoredEvents(world)).toHaveLength(0);
  });

  test("an entry matches by path prefix, not by substring", () => {
    const { world } = scenario({
      config,
      committed: { "src/spec/a.ts": ORIGINAL },
      actions: { "code-writer#0": write("src/spec/a.ts", EDITED) },
    });
    run(world);
    expect(restoredEvents(world)).toHaveLength(0);
  });
});

describe("what is protected and what is listed", () => {
  const path = "test/a.test.ts";

  test("an uncommitted test file left by the test writer is protected", () => {
    const { world } = scenario({
      uncommitted: { [path]: ORIGINAL },
      actions: {
        "code-writer#0": write(path, EDITED),
        [FIXER]: write(path, ORIGINAL),
      },
    });
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual([path]);
  });

  test("a code writer that commits the uncommitted tests unchanged lists nothing", () => {
    const { world } = scenario({
      uncommitted: { [path]: ORIGINAL },
      actions: { "code-writer#0": commitAll },
    });
    expect(run(world).status).toBe("ready");
    expect(restoredEvents(world)).toHaveLength(0);
    expect(codeWriterRuns(world)).toBe(1);
  });

  test("a test file the code writer adds is not listed", () => {
    const { world } = scenario({
      committed: { [path]: ORIGINAL },
      actions: { "code-writer#0": write("test/new.test.ts", EDITED) },
    });
    expect(run(world).status).toBe("ready");
    expect(restoredEvents(world)).toHaveLength(0);
  });

  test("a deleted test file is listed, and restoring it recreates it", () => {
    const { world } = scenario({
      committed: { [path]: ORIGINAL },
      actions: {
        "code-writer#0": remove(path),
        [FIXER]: write(path, ORIGINAL),
      },
    });
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual([path]);
  });

  test("only the changed files are listed, not every test file", () => {
    const { world } = scenario({
      committed: { "test/a.test.ts": ORIGINAL, "test/b.test.ts": ORIGINAL },
      actions: {
        "code-writer#0": write("test/b.test.ts", EDITED),
        [FIXER]: write("test/b.test.ts", ORIGINAL),
      },
    });
    run(world);
    expect(restoredFiles(world)).toEqual(["test/b.test.ts"]);
  });
});

describe("a file an accepted test fix changed", () => {
  const path = "test/b.test.ts";
  const askAndFix = {
    "code-writer": [ASKS],
    po: [{ reply: { answer: "right", testFix: { files: [path], change: "fix it" } } }],
    "test-writer": [{}],
  };

  test("left alone afterwards, it is not listed", () => {
    const { world } = scenario({
      committed: { [path]: ORIGINAL },
      roles: askAndFix,
      actions: { "test-writer#0": write(path, FIXED) },
    });
    expect(run(world).status).toBe("ready");
    expect(eventsNamed(world, "test_fixed")).toHaveLength(1);
    expect(restoredEvents(world)).toHaveLength(0);
  });

  test("edited again by the code writer after the fix, it is listed", () => {
    const { world } = scenario({
      committed: { [path]: ORIGINAL },
      roles: askAndFix,
      actions: {
        "test-writer#0": write(path, FIXED),
        "code-writer#1": write(path, STRAY),
        "code-writer#2": write(path, FIXED),
      },
    });
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual([path]);
  });

  test("another test file edited by the code writer is listed, the fixed one is not", () => {
    const { world } = scenario({
      committed: { [path]: ORIGINAL, "test/c.test.ts": ORIGINAL },
      roles: askAndFix,
      actions: {
        "test-writer#0": write(path, FIXED),
        "code-writer#1": write("test/c.test.ts", STRAY),
        "code-writer#2": write("test/c.test.ts", ORIGINAL),
      },
    });
    run(world);
    expect(restoredFiles(world)).toEqual(["test/c.test.ts"]);
  });
});

describe("the restore event and the fixer's instructions", () => {
  const path = "test/a.test.ts";

  test("one event with the files, then one fix ladder starting on the fixer rung", () => {
    const { world } = editedThenRestored(path);
    run(world);
    expect(restoredEvents(world)).toEqual([
      expect.objectContaining({ task: TASK, files: [path] }),
    ]);
    expect(world.roleCalls.map((call) => call.role)).toEqual([
      "code-writer",
      "code-writer",
      "reviewer",
    ]);
    expect(world.roleCalls[1]?.model).toBe(FACTORY_MODELS.medium);
  });

  test("the event comes before the fixer runs", () => {
    let eventsWhenFixing = -1;
    const holder: { world?: World } = {};
    const scene = scenario({
      committed: { [path]: ORIGINAL },
      actions: {
        "code-writer#0": write(path, EDITED),
        [FIXER]: together(write(path, ORIGINAL), () => {
          eventsWhenFixing = holder.world ? restoredEvents(holder.world).length : -1;
        }),
      },
    });
    holder.world = scene.world;
    run(scene.world);
    expect(eventsWhenFixing).toBe(1);
  });

  test("the instructions name every listed file", () => {
    const { world } = scenario({
      committed: { "test/a.test.ts": ORIGINAL, "test/b.test.ts": ORIGINAL },
      actions: {
        "code-writer#0": together(
          write("test/a.test.ts", EDITED),
          write("test/b.test.ts", EDITED)
        ),
        [FIXER]: together(
          write("test/a.test.ts", ORIGINAL),
          write("test/b.test.ts", ORIGINAL)
        ),
      },
    });
    run(world);
    expect(fixerInstructions(world)).toContain("test/a.test.ts");
    expect(fixerInstructions(world)).toContain("test/b.test.ts");
  });

  test("the instructions give the fingerprint sha and the five orders", () => {
    const { world, started } = editedThenRestored(path);
    run(world);
    const text = fixerInstructions(world);
    expect(started.tree).toMatch(/^[0-9a-f]{40}/);
    expect(text).toContain(started.tree ?? "missing");
    expect(text).toMatch(/restore/i);
    expect(text).toMatch(/commit/i);
    expect(text).toMatch(/without editing (any|a) test/i);
    expect(text).toMatch(/\bPO\b/);
    expect(text).toMatch(/again/i);
  });
});

describe("after the restore", () => {
  const path = "test/a.test.ts";

  test("a clean restore continues to the next step", () => {
    const { world } = editedThenRestored(path);
    const result = run(world);
    expect(result.status).toBe("ready");
    expect(world.roleCalls.map((call) => call.role)).toContain("reviewer");
  });

  test("a file changed again stops stuck, naming it", () => {
    const { world } = scenario({
      committed: { [path]: ORIGINAL },
      actions: {
        "code-writer#0": write(path, EDITED),
        [FIXER]: write(path, STRAY),
      },
    });
    const result = run(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain(path);
    expect(result.message).toMatch(/again/i);
    expect(world.pushes).toBe(0);
    expect(world.roleCalls.map((call) => call.role)).not.toContain("reviewer");
  });

  test("a fixer that does not restore at all stops stuck too", () => {
    const { world } = scenario({
      committed: { [path]: ORIGINAL },
      actions: { "code-writer#0": write(path, EDITED) },
    });
    const result = run(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain(path);
  });

  test("a second edit stops the build, with no second restore ladder", () => {
    const { world } = scenario({
      committed: { [path]: ORIGINAL },
      actions: {
        "code-writer#0": write(path, EDITED),
        [FIXER]: write(path, STRAY),
      },
    });
    run(world);
    expect(restoredEvents(world)).toHaveLength(1);
    expect(codeWriterRuns(world)).toBe(2);
  });

  test("a deleted file the fixer does not recreate stops stuck", () => {
    const { world } = scenario({
      committed: { [path]: ORIGINAL },
      actions: { "code-writer#0": remove(path) },
    });
    const result = run(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain(path);
  });
});

describe("when the restore ladder does not finish", () => {
  const path = "test/a.test.ts";

  test("a fixer that asks the user ends the run waiting, like any fix ladder", () => {
    const { world } = scenario({
      committed: { [path]: ORIGINAL },
      roles: {
        "code-writer": [{}, ASKS],
        po: [{ reply: { userQuestion: "Which database?" } }],
      },
      actions: { "code-writer#0": write(path, EDITED) },
    });
    const result = run(world);
    expect(result.status).toBe("waiting");
    expect(result.message).toContain("Which database?");
  });

  test("a gate that stays red after the restore ladder ends the run stuck", () => {
    const { world } = scenario({
      committed: { [path]: ORIGINAL },
      checks: {
        [TESTS_COMMAND]: (w) =>
          w.roleCalls.length >= 2
            ? { exitCode: 1, output: " 1 pass\n 2 fail" }
            : { exitCode: 0, output: " 3 pass" },
      },
      actions: {
        "code-writer#0": write(path, EDITED),
        [FIXER]: write(path, ORIGINAL),
      },
    });
    const result = run(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("could not be fixed with the gate green");
    expect(world.roleCalls).toHaveLength(5);
    expect(world.pushes).toBe(0);
  });
});

describe("with no listed files", () => {
  test("no event, no fix ladder, and the run continues", () => {
    const { world } = scenario({ committed: { "test/a.test.ts": ORIGINAL } });
    expect(run(world).status).toBe("ready");
    expect(restoredEvents(world)).toHaveLength(0);
    expect(world.roleCalls.map((call) => call.role)).toEqual(["code-writer", "reviewer"]);
  });
});

describe("running the build twice", () => {
  test("the second run adds no event and runs no fixer", () => {
    const path = "test/a.test.ts";
    const { world } = editedThenRestored(path);
    expect(run(world).status).toBe("ready");
    const events = restoredEvents(world).length;
    const codeRuns = codeWriterRuns(world);
    expect(events).toBe(1);
    run(world);
    expect(restoredEvents(world)).toHaveLength(events);
    expect(codeWriterRuns(world)).toBe(codeRuns);
    expect(readFileSync(join(world.worktree, path), "utf8")).toBe(ORIGINAL);
  });
});

describe("when git cannot fingerprint the worktree", () => {
  test("before the code step the build stops stuck and the code writer never runs", () => {
    const { world } = scenario({ failWriteTreeFrom: 1 });
    const result = run(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("could not fingerprint the worktree");
    expect(codeWriterRuns(world)).toBe(0);
  });

  test("after the code step the build stops stuck", () => {
    const { world } = scenario({ failWriteTreeFrom: 2 });
    const result = run(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("could not fingerprint the worktree");
    expect(world.roleCalls.map((call) => call.role)).not.toContain("reviewer");
  });
});

const SECTION = "## Test files this task changes";
const A = "test/a.test.ts";
const B = "test/b.test.ts";
const BOTH = { [A]: ORIGINAL, [B]: ORIGINAL };

const specListing = (...bullets: string[]) =>
  `${SPEC}\n${SECTION}\n\n${bullets.map((bullet) => `- ${bullet}`).join("\n")}\n`;

const writeTaskDocument =
  (world: World, name: string, text: string): Action =>
  () =>
    writeFileSync(join(taskDir(TASK, world.env), name), text);

function listing(world: World, ...bullets: string[]) {
  writeTaskDocument(world, "spec.md", specListing(...bullets))(world.worktree);
}

const editsBoth = together(write(A, EDITED), write(B, EDITED));
const restoresBoth = together(write(A, ORIGINAL), write(B, ORIGINAL));

function codeStepEditsBoth(...bullets: string[]) {
  const scene = scenario({
    committed: BOTH,
    actions: {
      "code-writer#0": editsBoth,
      [FIXER]: together(write(B, ORIGINAL), commitAll),
    },
  });
  if (bullets.length > 0) listing(scene.world, ...bullets);
  return scene.world;
}

describe("a spec that lists the test files the task changes", () => {
  test("a listed file is not restored, an unlisted one is", () => {
    const world = codeStepEditsBoth(A);
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual([B]);
    expect(readFileSync(join(world.worktree, A), "utf8")).toBe(EDITED);
  });

  test("a task that edits only listed files restores nothing and runs no fixer", () => {
    const { world } = scenario({
      committed: BOTH,
      actions: { "code-writer#0": editsBoth },
    });
    listing(world, A, B);
    expect(run(world).status).toBe("ready");
    expect(restoredEvents(world)).toHaveLength(0);
    expect(codeWriterRuns(world)).toBe(1);
  });

  test("backticks around the path are optional", () => {
    const { world } = scenario({
      committed: BOTH,
      actions: { "code-writer#0": editsBoth },
    });
    listing(world, `\`${A}\``, B);
    expect(run(world).status).toBe("ready");
    expect(restoredEvents(world)).toHaveLength(0);
  });

  test("a listed file deleted by the code writer is allowed", () => {
    const { world } = scenario({
      committed: BOTH,
      actions: { "code-writer#0": remove(A) },
    });
    listing(world, A);
    expect(run(world).status).toBe("ready");
    expect(restoredEvents(world)).toHaveLength(0);
  });

  test("a listed file changed again after a restore does not stop the build", () => {
    const { world } = scenario({
      committed: BOTH,
      actions: {
        "code-writer#0": editsBoth,
        [FIXER]: together(write(B, ORIGINAL), write(A, STRAY)),
      },
    });
    listing(world, A);
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual([B]);
  });

  test("a listed path that is not a test file or does not exist is ignored", () => {
    const { world } = scenario({
      committed: { ...BOTH, "src/app.ts": ORIGINAL },
      actions: {
        "code-writer#0": together(editsBoth, write("src/app.ts", EDITED)),
        [FIXER]: together(write(B, ORIGINAL), write(A, ORIGINAL)),
      },
    });
    listing(world, "src/app.ts", "test/ghost.test.ts");
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world).sort()).toEqual([A, B]);
  });

  test("an empty section exempts nothing", () => {
    const { world } = scenario({
      committed: { [A]: ORIGINAL },
      actions: {
        "code-writer#0": write(A, EDITED),
        [FIXER]: write(A, ORIGINAL),
      },
    });
    writeTaskDocument(world, "spec.md", `${SPEC}\n${SECTION}\n\n`)(world.worktree);
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual([A]);
  });

  test("a heading that is not exact, or a passing mention, exempts nothing", () => {
    const { world } = scenario({
      committed: { [A]: ORIGINAL },
      actions: {
        "code-writer#0": write(A, EDITED),
        [FIXER]: write(A, ORIGINAL),
      },
    });
    writeTaskDocument(
      world,
      "spec.md",
      `${SPEC}\nThis task changes ${A}.\n\n### Test files this task changes\n\n- ${A}\n`
    )(world.worktree);
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual([A]);
  });

  test("the spec is read when the guard runs, so a listing added during the build counts", () => {
    const holder: { world?: World } = {};
    const scene = scenario({
      committed: { [A]: ORIGINAL },
      actions: {
        "code-writer#0": together(write(A, EDITED), () =>
          listing(holder.world as World, A)
        ),
      },
    });
    holder.world = scene.world;
    expect(run(scene.world).status).toBe("ready");
    expect(restoredEvents(scene.world)).toHaveLength(0);
  });

  test("running the build twice adds nothing and changes nothing", () => {
    const world = codeStepEditsBoth(A);
    run(world);
    const events = restoredEvents(world).length;
    const codeRuns = codeWriterRuns(world);
    run(world);
    expect(restoredEvents(world)).toHaveLength(events);
    expect(codeWriterRuns(world)).toBe(codeRuns);
    expect(readFileSync(join(world.worktree, A), "utf8")).toBe(EDITED);
  });
});

describe("only spec.md grants the exemption", () => {
  test.each(["plan.md", "tests.md", "repro.md", "design.md"])(
    "the section in %s alone exempts nothing",
    (name) => {
      const { world } = scenario({
        committed: BOTH,
        actions: { "code-writer#0": editsBoth, [FIXER]: restoresBoth },
      });
      writeTaskDocument(world, name, specListing(A))(world.worktree);
      expect(run(world).status).toBe("ready");
      expect(restoredFiles(world).sort()).toEqual([A, B]);
    }
  );

  test("with the section only in plan.md the listed-looking file is restored", () => {
    const { world } = scenario({
      committed: { [A]: ORIGINAL },
      actions: {
        "code-writer#0": write(A, EDITED),
        [FIXER]: write(A, ORIGINAL),
      },
    });
    writeTaskDocument(world, "plan.md", specListing(A))(world.worktree);
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual([A]);
  });
});

const finding = { file: "a.ts", problem: "bad name", fix: "rename" };
const REVIEW_FINDS = { reviewer: [{ reply: { findings: [finding] } }] };
const REVIEW_FIXER = "code-writer#1";
const REVIEW_RESTORER = "code-writer#2";

function reviewFixEdits(
  extra: Partial<Setup> = {},
  actions: Record<string, Action> = {}
) {
  return scenario({
    committed: BOTH,
    roles: REVIEW_FINDS,
    actions: { [REVIEW_FIXER]: write(B, EDITED), ...actions },
    ...extra,
  }).world;
}

describe("the review-fix ladder is guarded like the code ladder", () => {
  test("a test file edited by a review fix is restored and the event recorded", () => {
    const world = reviewFixEdits({}, { [REVIEW_RESTORER]: write(B, ORIGINAL) });
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual([B]);
    expect(readFileSync(join(world.worktree, B), "utf8")).toBe(ORIGINAL);
    expect(world.roleCalls[3]?.instructions).toContain(B);
  });

  test("a listed file edited by a review fix is not restored", () => {
    const world = reviewFixEdits();
    listing(world, B);
    expect(run(world).status).toBe("ready");
    expect(restoredEvents(world)).toHaveLength(0);
    expect(readFileSync(join(world.worktree, B), "utf8")).toBe(EDITED);
  });

  test("an edit the restore does not undo stops stuck with the again message", () => {
    const world = reviewFixEdits({}, { [REVIEW_RESTORER]: write(B, STRAY) });
    const result = run(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toBe(build.testEditsAgainMessage([B]));
  });

  test("an edit by an earlier rung that failed the gate does not survive a later passing rung", () => {
    const world = reviewFixEdits(
      {
        checks: {
          [TESTS_COMMAND]: (w) =>
            w.roleCalls.length === 3
              ? { exitCode: 1, output: " 1 pass\n 2 fail" }
              : { exitCode: 0, output: " 3 pass" },
        },
      },
      {
        [REVIEW_RESTORER]: write("src/other.ts", EDITED),
        "code-writer#3": write(B, ORIGINAL),
      }
    );
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual([B]);
    expect(readFileSync(join(world.worktree, B), "utf8")).toBe(ORIGINAL);
  });

  test("running the build twice adds no second restore", () => {
    const world = reviewFixEdits({}, { [REVIEW_RESTORER]: write(B, ORIGINAL) });
    run(world);
    const events = restoredEvents(world).length;
    const codeRuns = codeWriterRuns(world);
    expect(events).toBe(1);
    run(world);
    expect(restoredEvents(world)).toHaveLength(events);
    expect(codeWriterRuns(world)).toBe(codeRuns);
  });
});

describe("the tester fix ladder is guarded", () => {
  const unmet = { criterion: "export works", met: false, evidence: "blank" };

  function testerFixEdits(listed: boolean) {
    const { world } = scenario({
      committed: BOTH,
      config: { ...DEFAULT_CONFIG, uiPaths: ["ui/"] },
      roles: {
        "code-writer": [{ codes: true, changes: ["feature.txt", "ui/page.txt"] }],
        tester: [{ reply: { criteria: [unmet] } }],
      },
      actions: {
        "code-writer#1": write(B, EDITED),
        "code-writer#2": write(B, ORIGINAL),
      },
    });
    writeTaskDocument(world, "plan.md", "feature.txt\nui/\n")(world.worktree);
    if (listed) listing(world, B);
    return world;
  }

  test("a test file edited by a tester fix is restored and the event recorded", () => {
    const world = testerFixEdits(false);
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual([B]);
  });

  test("a listed file edited by a tester fix is not restored", () => {
    const world = testerFixEdits(true);
    expect(run(world).status).toBe("ready");
    expect(restoredEvents(world)).toHaveLength(0);
  });
});

describe("the CI fix ladder is guarded", () => {
  const failing = { state: "fail", failed: [{ name: "ci" }] };

  function ciFixEdits(listed: boolean) {
    const { world } = scenario({
      committed: BOTH,
      ci: [failing, { state: "pass", failed: [] }],
      roles: { debugger: [{ commits: true }] },
      actions: {
        "debugger#0": together(write(B, EDITED), commitAll),
        "code-writer#1": together(write(B, ORIGINAL), commitAll),
      },
    });
    if (listed) listing(world, B);
    return world;
  }

  test("a test file edited by a CI fix is restored and the event recorded", () => {
    const world = ciFixEdits(false);
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual([B]);
    expect(readFileSync(join(world.worktree, B), "utf8")).toBe(ORIGINAL);
  });

  test("a listed file edited by a CI fix is not restored", () => {
    const world = ciFixEdits(true);
    expect(run(world).status).toBe("ready");
    expect(restoredEvents(world)).toHaveLength(0);
  });
});
