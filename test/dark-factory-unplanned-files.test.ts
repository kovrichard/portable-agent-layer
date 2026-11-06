import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as build from "../assets/plugins/dark-factory/scripts/build.mjs";
import { appendEvent, taskDir } from "../assets/plugins/dark-factory/scripts/lib.mjs";
import { schemaFor } from "../assets/plugins/dark-factory/scripts/roles.mjs";
import {
  buildWorld,
  eventsNamed,
  TASK,
  TESTS_COMMAND,
  type World,
} from "./lib/dark-factory-build-fixture";

type Options = Parameters<typeof buildWorld>[1];

type Scenario = {
  changed: string[];
  docs?: Record<string, string>;
  po?: object;
  options?: Options;
  leaveDirty?: string[];
  failGateAfterRevert?: boolean;
};

function scenario(setup: Scenario) {
  const world = buildWorld(import.meta.file, {
    ...setup.options,
    roles: {
      po: [{ reply: setup.po ?? { answer: "keep all" } }],
      ...setup.options?.roles,
    },
    checks: {
      [TESTS_COMMAND]: (w: World) =>
        w.coded && !(setup.failGateAfterRevert && w.roleCalls.length > 2)
          ? { exitCode: 0, output: " 3 pass" }
          : { exitCode: 1, output: " 1 pass\n 2 fail" },
    },
  });
  world.changedFiles.push(...setup.changed);
  for (const [name, text] of Object.entries(setup.docs ?? {}))
    writeFileSync(join(taskDir(TASK, world.env), name), text);
  simulateRevert(world, setup.leaveDirty ?? []);
  return world;
}

function simulateRevert(world: World, leaveDirty: string[]) {
  const effects = world.effects as Record<string, (...args: never[]) => unknown>;
  const fakeRole = effects.runRoleHeadless as (...args: unknown[]) => unknown;
  const fakeSpawn = effects.spawnTool as (...args: unknown[]) => unknown;
  const dirtyNow = () => world.changedFiles.filter((file) => leaveDirty.includes(file));
  effects.runRoleHeadless = ((
    id: string,
    role: string,
    args: { instructions?: string }
  ) => {
    if (role !== "po" && /revert/i.test(args.instructions ?? "")) {
      world.changedFiles = world.changedFiles.filter(
        (file) => !args.instructions?.includes(file) || leaveDirty.includes(file)
      );
    }
    return fakeRole(id, role, args);
  }) as never;
  effects.spawnTool = ((command: string, args: string[], ...rest: unknown[]) => {
    if (command === "git" && args[0] === "diff") {
      const differing = args.filter((arg) => dirtyNow().includes(arg));
      return {
        status: differing.length > 0 ? 1 : 0,
        stdout: differing.join("\n"),
        stderr: "",
      };
    }
    return fakeSpawn(command, args, ...rest);
  }) as never;
}

function run(world: World) {
  return build.runBuild(TASK, { env: world.env, effects: world.effects as never });
}

const poCalls = (world: World) => world.roleCalls.filter((call) => call.role === "po");
const decisions = (world: World) =>
  readFileSync(join(taskDir(TASK, world.env), "spec.md"), "utf8");

describe("which changed files the documents never name", () => {
  test("a file named in no document is listed and one named in plan.md is not", () => {
    const world = scenario({
      changed: ["src/named.ts", "src/stray.ts"],
      docs: { "plan.md": "Edit src/named.ts only.\n" },
    });
    run(world);
    const [question] = poCalls(world);
    expect(question?.instructions).toContain("src/stray.ts");
    expect(question?.instructions).not.toContain("src/named.ts");
  });

  test("a full path in any task document names the file", () => {
    for (const doc of ["spec.md", "plan.md", "design.md", "repro.md", "tests.md"]) {
      const world = scenario({
        changed: ["lib/x.ts"],
        docs: { [doc]: "touches lib/x.ts\n" },
      });
      run(world);
      expect(poCalls(world)).toHaveLength(0);
    }
  });

  test("a parent directory followed by a slash names its files", () => {
    const world = scenario({
      changed: ["test/a.test.ts", "src/deep/b.ts"],
      docs: { "tests.md": "tests live in test/ and src/deep/\n" },
    });
    run(world);
    expect(poCalls(world)).toHaveLength(0);
  });

  test("a different file in a named file's directory is still listed", () => {
    const world = scenario({
      changed: ["test/a.test.ts", "test/other.test.ts"],
      docs: { "plan.md": "Add test/a.test.ts\n" },
    });
    run(world);
    const [question] = poCalls(world);
    expect(question?.instructions).toContain("test/other.test.ts");
    expect(question?.instructions).not.toContain("test/a.test.ts");
  });

  test("matching is case-sensitive", () => {
    const world = scenario({
      changed: ["src/Thing.ts"],
      docs: { "plan.md": "src/thing.ts\n" },
    });
    run(world);
    expect(poCalls(world)[0]?.instructions).toContain("src/Thing.ts");
  });

  test("a deleted file is listed by its old path like any other", () => {
    const world = scenario({ changed: ["old/gone.ts"] });
    run(world);
    expect(poCalls(world)[0]?.instructions).toContain("old/gone.ts");
  });

  test("bun.lock gets no exemption", () => {
    const world = scenario({ changed: ["bun.lock"] });
    run(world);
    expect(poCalls(world)[0]?.instructions).toContain("bun.lock");
  });

  test("the step runs after the code step and before the review", () => {
    const world = scenario({ changed: ["stray.ts"] });
    run(world);
    const names = world.roleCalls.map((call) => call.role);
    expect(names.indexOf("po")).toBeGreaterThan(names.indexOf("code-writer"));
    expect(names.indexOf("po")).toBeLessThan(names.indexOf("reviewer"));
  });
});

describe("the question to the PO", () => {
  test("one po_question names every listed file and asks keep or revert", () => {
    const world = scenario({ changed: ["one.ts", "two.ts", "three.ts"] });
    run(world);
    expect(eventsNamed(world, "po_question")).toHaveLength(1);
    expect(poCalls(world)).toHaveLength(1);
    const text = poCalls(world)[0]?.instructions ?? "";
    for (const file of ["one.ts", "two.ts", "three.ts"]) expect(text).toContain(file);
    expect(text).toMatch(/keep/i);
    expect(text).toMatch(/revert/i);
  });

  test("the PO's answer is appended to the spec's Decisions", () => {
    const world = scenario({
      changed: ["one.ts"],
      po: { answer: "one.ts stays, the criterion needs it" },
    });
    run(world);
    expect(decisions(world)).toMatch(/^- .*one\.ts stays, the criterion needs it.*$/m);
  });

  test("a userQuestion from the PO stops the build waiting with it", () => {
    const world = scenario({
      changed: ["one.ts"],
      po: { userQuestion: "Is one.ts yours?" },
    });
    expect(run(world)).toMatchObject({ status: "waiting", message: "Is one.ts yours?" });
    expect(world.roleCalls.map((call) => call.role)).not.toContain("reviewer");
  });
});

describe("the PO_RESULT schema and the po role", () => {
  test("PO_RESULT has an optional revert array of strings and keeps answer and userQuestion", () => {
    const schema = schemaFor("po") as {
      properties: Record<string, { type: string; items?: { type: string } }>;
      required?: string[];
    };
    expect(schema.properties.revert).toMatchObject({
      type: "array",
      items: { type: "string" },
    });
    expect(schema.properties.answer?.type).toBe("string");
    expect(schema.properties.userQuestion?.type).toBe("string");
    expect(schema.required ?? []).not.toContain("revert");
  });

  test("po.md tells the PO to fill revert for unplanned-files questions", () => {
    const text = readFileSync(
      join(import.meta.dir, "../assets/plugins/dark-factory/agents/po.md"),
      "utf8"
    );
    expect(text).toContain("revert");
    expect(text).toMatch(/unplanned/i);
  });
});

describe("reverting files", () => {
  const changed = ["one.ts", "two.ts"];

  test("the fix ladder runs once and names exactly the files to revert", () => {
    const world = scenario({ changed, po: { answer: "revert one", revert: ["one.ts"] } });
    expect(run(world).status).toBe("ready");
    const names = world.roleCalls.map((call) => call.role);
    expect(names).toEqual(["code-writer", "po", "code-writer", "reviewer"]);
    const fixer = world.roleCalls[2]?.instructions ?? "";
    expect(fixer).toContain("one.ts");
    expect(fixer).not.toContain("two.ts");
    expect(fixer).toContain("origin/canary");
    expect(fixer).toMatch(/commit/i);
  });

  test("a revert entry that is not among the listed files is ignored", () => {
    const world = scenario({
      changed,
      docs: { "plan.md": "two.ts\n" },
      po: { answer: "revert", revert: ["two.ts", "ghost.ts"] },
    });
    run(world);
    expect(world.roleCalls.map((call) => call.role)).toEqual([
      "code-writer",
      "po",
      "reviewer",
    ]);
    for (const call of world.roleCalls)
      expect(call.instructions).not.toContain("ghost.ts");
  });

  test("an empty or missing revert keeps every listed file", () => {
    for (const po of [{ answer: "keep", revert: [] }, { answer: "keep" }]) {
      const world = scenario({ changed, po });
      expect(run(world).status).toBe("ready");
      expect(world.roleCalls.map((call) => call.role)).toEqual([
        "code-writer",
        "po",
        "reviewer",
      ]);
    }
  });

  test("a clean revert continues to the review", () => {
    const world = scenario({ changed, po: { answer: "revert", revert: ["one.ts"] } });
    expect(run(world).status).toBe("ready");
    expect(world.roleCalls.map((call) => call.role)).toContain("reviewer");
  });

  test("a file the fixer left changed stops the build stuck, naming it", () => {
    const world = scenario({
      changed,
      po: { answer: "revert", revert: ["one.ts", "two.ts"] },
      leaveDirty: ["two.ts"],
    });
    const result = run(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("two.ts");
    expect(result.message).not.toContain("one.ts");
    expect(world.roleCalls.map((call) => call.role)).not.toContain("reviewer");
  });

  test("a fix ladder that cannot get the gate green stops as fixStop does", () => {
    const world = scenario({
      changed,
      po: { answer: "revert", revert: ["one.ts"] },
      failGateAfterRevert: true,
    });
    const result = run(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("could not be fixed with the gate green");
    expect(world.roleCalls.map((call) => call.role)).not.toContain("reviewer");
  });
});

describe("the unplanned_files event", () => {
  test("records the listed and the reverted files", () => {
    const world = scenario({
      changed: ["one.ts", "two.ts"],
      po: { answer: "revert one", revert: ["one.ts", "ghost.ts"] },
    });
    run(world);
    expect(eventsNamed(world, "unplanned_files")).toEqual([
      expect.objectContaining({
        task: TASK,
        files: ["one.ts", "two.ts"],
        reverted: ["one.ts"],
      }),
    ]);
  });

  test("no unplanned files: no question, no event, no decision", () => {
    const world = scenario({
      changed: ["src/a.ts"],
      docs: { "plan.md": "src/\n" },
    });
    const before = decisions(world);
    expect(run(world).status).toBe("ready");
    expect(poCalls(world)).toHaveLength(0);
    expect(eventsNamed(world, "unplanned_files")).toHaveLength(0);
    expect(eventsNamed(world, "po_question")).toHaveLength(0);
    expect(decisions(world)).toBe(before);
  });

  test("files in an earlier unplanned_files event are not listed again", () => {
    const world = scenario({ changed: ["old.ts", "new.ts"] });
    appendEvent(
      { event: "unplanned_files", task: TASK, files: ["old.ts"], reverted: [] },
      world.env
    );
    run(world);
    const text = poCalls(world)[0]?.instructions ?? "";
    expect(text).toContain("new.ts");
    expect(text).not.toContain("old.ts");
  });

  test("only earlier-listed files left: no PO question at all", () => {
    const world = scenario({ changed: ["old.ts"] });
    appendEvent(
      { event: "unplanned_files", task: TASK, files: ["old.ts"], reverted: [] },
      world.env
    );
    run(world);
    expect(poCalls(world)).toHaveLength(0);
  });

  test("running the build twice asks once and adds no second decision", () => {
    const world = scenario({
      changed: ["one.ts"],
      po: { answer: "kept for the export" },
      options: { commitsAhead: 1 },
    });
    run(world);
    const afterFirst = decisions(world);
    const eventsAfterFirst = eventsNamed(world, "unplanned_files").length;
    run(world);
    expect(poCalls(world)).toHaveLength(1);
    expect(eventsNamed(world, "po_question")).toHaveLength(1);
    expect(eventsNamed(world, "unplanned_files")).toHaveLength(eventsAfterFirst);
    expect(decisions(world)).toBe(afterFirst);
  });
});
