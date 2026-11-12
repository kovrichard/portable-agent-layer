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
  spec?: string;
  ci?: { state: string; failed: string[] }[];
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

  if (setup.spec !== undefined)
    writeFileSync(join(taskDir(TASK, world.env), "spec.md"), setup.spec);
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

const HEADING = "## Test files this task changes";
const specWith = (section: string) => `# Add export\n\n## Goal\n\nExport.\n\n${section}`;
const listing = (...files: string[]) =>
  specWith(`${HEADING}\n\n${files.map((file) => `- \`${file}\``).join("\n")}\n`);
const A = "test/a.test.ts";
const B = "test/b.test.ts";
const BOTH = { [A]: ORIGINAL, [B]: ORIGINAL };
const editBoth = together(write(A, EDITED), write(B, EDITED));
const content = (world: World, path: string) =>
  readFileSync(join(world.worktree, path), "utf8");

describe("the spec's test-file exemption in the code step", () => {
  test("a listed file is kept, an unlisted one restored, and the build is ready", () => {
    const { world } = scenario({
      spec: listing(A),
      committed: BOTH,
      actions: { "code-writer#0": editBoth, [FIXER]: write(B, ORIGINAL) },
    });
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual([B]);
    expect(content(world, A)).toBe(EDITED);
    expect(fixerInstructions(world)).not.toContain(A);
  });

  test("bullets without backticks work", () => {
    const { world } = scenario({
      spec: specWith(`${HEADING}\n\n- ${A}\n`),
      committed: BOTH,
      actions: { "code-writer#0": write(A, EDITED) },
    });
    expect(run(world).status).toBe("ready");
    expect(restoredEvents(world)).toHaveLength(0);
    expect(codeWriterRuns(world)).toBe(1);
  });

  test("when every edited file is listed there is no restore and no fixer", () => {
    const { world } = scenario({
      spec: listing(A, B),
      committed: BOTH,
      actions: { "code-writer#0": editBoth },
    });
    expect(run(world).status).toBe("ready");
    expect(restoredEvents(world)).toHaveLength(0);
    expect(codeWriterRuns(world)).toBe(1);
  });

  test("a listed file changed again during the restore does not stop the build", () => {
    const { world } = scenario({
      spec: listing(A),
      committed: BOTH,
      actions: {
        "code-writer#0": editBoth,
        [FIXER]: together(write(B, ORIGINAL), write(A, STRAY)),
      },
    });
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual([B]);
  });

  test("a listed file the code writer deletes is allowed", () => {
    const { world } = scenario({
      spec: listing(A),
      committed: BOTH,
      actions: { "code-writer#0": remove(A) },
    });
    expect(run(world).status).toBe("ready");
    expect(restoredEvents(world)).toHaveLength(0);
  });

  test("a listed non-test path and a listed missing path are ignored, without error", () => {
    const { world } = scenario({
      spec: listing("src/app.ts", "test/missing.test.ts"),
      committed: { ...BOTH, "src/app.ts": ORIGINAL },
      actions: { "code-writer#0": write(B, EDITED), [FIXER]: write(B, ORIGINAL) },
    });
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual([B]);
  });

  test("an empty section exempts nothing", () => {
    const { world } = scenario({
      spec: specWith(`${HEADING}\n\n`),
      committed: BOTH,
      actions: { "code-writer#0": write(A, EDITED), [FIXER]: write(A, ORIGINAL) },
    });
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual([A]);
  });

  test("a prose mention or another heading exempts nothing", () => {
    const { world } = scenario({
      spec: specWith(
        `This task changes ${A} on purpose.\n\n${HEADING} (draft)\n\n- ${A}\n`
      ),
      committed: BOTH,
      actions: { "code-writer#0": write(A, EDITED), [FIXER]: write(A, ORIGINAL) },
    });
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual([A]);
  });

  test("a spec that gains the section during the build counts", () => {
    const { world } = scenario({
      committed: BOTH,
      actions: {
        "code-writer#0": together(write(A, EDITED), (_dir) =>
          writeFileSync(join(taskDir(TASK, world.env), "spec.md"), listing(A))
        ),
      },
    });
    expect(run(world).status).toBe("ready");
    expect(restoredEvents(world)).toHaveLength(0);
  });

  test.each(["plan.md", "tests.md", "repro.md", "design.md"])(
    "the section in %s alone exempts nothing",
    (name) => {
      const { world } = scenario({
        committed: BOTH,
        actions: {
          "code-writer#0": together(write(A, EDITED), (_dir) =>
            writeFileSync(join(taskDir(TASK, world.env), name), listing(A))
          ),
          [FIXER]: write(A, ORIGINAL),
        },
      });
      expect(run(world).status).toBe("ready");
      expect(restoredFiles(world)).toEqual([A]);
    }
  );

  test("running the build twice adds no event and changes nothing", () => {
    const { world } = scenario({
      spec: listing(A),
      committed: BOTH,
      actions: {
        "code-writer#0": editBoth,
        [FIXER]: together(write(B, ORIGINAL), commitAll),
      },
    });
    expect(run(world).status).toBe("ready");
    const events = restoredEvents(world).length;
    const codeRuns = codeWriterRuns(world);
    run(world);
    expect(restoredEvents(world)).toHaveLength(events);
    expect(codeWriterRuns(world)).toBe(codeRuns);
    expect(content(world, A)).toBe(EDITED);
    expect(content(world, B)).toBe(ORIGINAL);
  });
});

const FINDING = { reply: { findings: [{ file: "x", problem: "p" }] } };
const UNMET = { reply: { criteria: [{ criterion: "c", met: false, evidence: "e" }] } };
const UI_CONFIG = { ...DEFAULT_CONFIG, uiPaths: ["ui/"] };

type Ladder = {
  name: string;
  extra: Partial<Setup>;
  fixer: string;
  restorer: string;
  commits?: boolean;
  reaches: (world: World) => boolean;
};

const ladders: Ladder[] = [
  {
    name: "review-findings",
    extra: { roles: { reviewer: [FINDING] } },
    fixer: "code-writer#1",
    restorer: "code-writer#2",
    reaches: (world) => world.roleCalls.some((call) => call.role === "reviewer"),
  },
  {
    name: "tester",
    extra: {
      config: UI_CONFIG,
      roles: {
        "code-writer": [{ codes: true, changes: ["ui/page.txt"] }],
        tester: [UNMET],
      },
    },
    fixer: "code-writer#1",
    restorer: "code-writer#2",
    reaches: (world) => world.roleCalls.some((call) => call.role === "tester"),
  },
  {
    name: "ci",
    extra: {
      ci: [
        { state: "fail", failed: ["ci"] },
        { state: "pass", failed: [] },
      ],
      roles: { debugger: [{ commits: true }] },
    },
    fixer: "debugger#0",
    commits: true,
    restorer: "code-writer#1",
    reaches: (world) => world.pushes > 0,
  },
];

function ladderScenario(ladder: Ladder, setup: Setup) {
  const holder: { world?: World } = {};
  const namesChangedFiles: Action = () => {
    if (ladder.name !== "tester" || !holder.world) return;
    writeFileSync(
      join(taskDir(TASK, holder.world.env), "plan.md"),
      "ui/page.txt\ntest/a.test.ts\ntest/b.test.ts\n"
    );
  };
  const scene = scenario({
    committed: BOTH,
    ...ladder.extra,
    ...setup,
    actions: {
      "code-writer#0": namesChangedFiles,
      ...(ladder.commits
        ? {
            [ladder.fixer]: together(
              write("src/fix.ts", "fix\n"),
              setup.actions?.[ladder.fixer] ?? (() => undefined),
              commitAll
            ),
          }
        : {}),
      ...Object.fromEntries(
        Object.entries(setup.actions ?? {}).filter(
          ([key]) => !(ladder.commits && key === ladder.fixer)
        )
      ),
    },
  });
  holder.world = scene.world;

  return scene.world;
}

describe.each(ladders)(
  "the $name fix ladder is guarded like the code ladder",
  (ladder) => {
    test("a test file its fix edits is restored, with the event recorded", () => {
      const world = ladderScenario(ladder, {
        actions: {
          [ladder.fixer]: write(B, EDITED),
          [ladder.restorer]: write(B, ORIGINAL),
        },
      });
      expect(run(world).status).toBe("ready");
      expect(restoredEvents(world)).toEqual([
        expect.objectContaining({ task: TASK, files: [B] }),
      ]);
      expect(content(world, B)).toBe(ORIGINAL);
    });

    test("a listed file its fix edits is kept and nothing is recorded", () => {
      const world = ladderScenario(ladder, {
        spec: listing(A),
        actions: { [ladder.fixer]: write(A, EDITED) },
      });
      expect(run(world).status).toBe("ready");
      expect(restoredEvents(world)).toHaveLength(0);
      expect(content(world, A)).toBe(EDITED);
    });

    test("a restore that edits the file again stops the build stuck, naming it", () => {
      const world = ladderScenario(ladder, {
        actions: {
          [ladder.fixer]: write(B, EDITED),
          [ladder.restorer]: write(B, STRAY),
        },
      });
      const result = run(world);
      expect(result.status).toBe("stuck");
      expect(result.message).toContain(B);
      expect(result.message).toMatch(/again/i);
    });

    test("a fix that leaves every test file alone adds no event", () => {
      const world = ladderScenario(ladder, { actions: {} });
      expect(run(world).status).toBe("ready");
      expect(ladder.reaches(world)).toBe(true);
      expect(restoredEvents(world)).toHaveLength(0);
    });
  }
);

describe("the fingerprint is taken per ladder, not per rung", () => {
  test("an edit from a rung that failed the gate is restored after a later rung passes", () => {
    const { world } = scenario({
      committed: BOTH,
      roles: { reviewer: [FINDING] },
      checks: {
        [TESTS_COMMAND]: (w) =>
          w.roleCalls.length === 3
            ? { exitCode: 1, output: " 1 pass\n 2 fail" }
            : { exitCode: 0, output: " 3 pass" },
      },
      actions: {
        "code-writer#1": write(B, EDITED),
        "code-writer#3": write(B, ORIGINAL),
      },
    });
    expect(run(world).status).toBe("ready");
    expect(restoredFiles(world)).toEqual([B]);
  });
});
