import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as build from "../assets/plugins/dark-factory/scripts/build.mjs";
import { schemaFor } from "../assets/plugins/dark-factory/scripts/roles.mjs";
import {
  buildWorld,
  eventsNamed,
  type RoleStep,
  TASK,
  type World,
} from "./lib/dark-factory-build-fixture";

const QUESTION = { done: false, summary: "", question: "is the test right?" };
const ASKS: RoleStep = { reply: QUESTION, codes: false };
const NOOP: RoleStep = { codes: false };
const TEST_FILE = "test/a.test.ts";
const CHANGE = "expect 3 instead of 2 in the totals test";
const ANSWER = "the test contradicts the spec criterion 4";
const FIX_REPLY = {
  answer: ANSWER,
  testFix: { files: [TEST_FILE], change: CHANGE },
};
const EDITS: RoleStep = { editsModifiedFile: true };

type Setup = {
  roles: Record<string, RoleStep[]>;
  treeDiff?: string[];
  writeTreeFails?: boolean;
};

function scenario(setup: Setup) {
  const world = buildWorld(import.meta.file, { roles: setup.roles });
  const effects = world.effects as Record<string, (...args: never[]) => unknown>;
  const realSpawn = effects.spawnTool as (c: string, a: string[]) => unknown;
  effects.spawnTool = ((command: string, args: string[]) => {
    if (command === "git" && args[0] === "write-tree" && setup.writeTreeFails)
      return { status: 128, stdout: "", stderr: "fatal" };
    if (
      command === "git" &&
      args[0] === "diff" &&
      args[1] === "--name-only" &&
      args[2]?.startsWith("tree-")
    ) {
      const same = args[2] === args[3];
      return {
        status: 0,
        stdout: same ? "" : `${(setup.treeDiff ?? [TEST_FILE]).join("\n")}\n`,
        stderr: "",
      };
    }
    return realSpawn(command, args);
  }) as never;
  return world;
}

const run = (world: World) =>
  build.runBuild(TASK, { env: world.env, effects: world.effects });
const names = (world: World) => world.roleCalls.map((call) => call.role);

describe("the PO_RESULT schema and the po role", () => {
  test("PO_RESULT has an optional testFix object with files and change", () => {
    const schema = schemaFor("po") as {
      properties: Record<string, Record<string, unknown>>;
      required?: string[];
    };
    const testFix = schema.properties.testFix as {
      type: string;
      properties: Record<string, { type: string; items?: { type: string } }>;
    };
    expect(testFix.type).toBe("object");
    expect(testFix.properties.files).toMatchObject({
      type: "array",
      items: { type: "string" },
    });
    expect(testFix.properties.change?.type).toBe("string");
    expect(schema.required ?? []).not.toContain("testFix");
  });

  test("po.md says when to fill testFix", () => {
    const text = readFileSync(
      join(import.meta.dir, "../assets/plugins/dark-factory/agents/po.md"),
      "utf8"
    );
    expect(text).toContain("testFix");
    expect(text).toMatch(/contradicts the spec/i);
  });
});

describe("a PO answer with testFix", () => {
  test("the test writer runs once before the asking role resumes, told every file, the change and the answer", () => {
    const world = scenario({
      roles: {
        "code-writer": [ASKS],
        po: [{ reply: FIX_REPLY }],
        "test-writer": [EDITS],
      },
    });
    expect(run(world).status).toBe("ready");
    expect(names(world).slice(0, 4)).toEqual([
      "code-writer",
      "po",
      "test-writer",
      "code-writer",
    ]);
    expect(names(world).filter((role) => role === "test-writer")).toHaveLength(1);
    const instructions = world.roleCalls[2]?.instructions ?? "";
    expect(instructions).toContain(TEST_FILE);
    expect(instructions).toContain(CHANGE);
    expect(instructions).toContain(ANSWER);
    expect(instructions).toMatch(/only/i);
    expect(instructions).toMatch(/uncommitted/i);
  });

  test("every named file is in the test writer's instructions", () => {
    const world = scenario({
      roles: {
        "code-writer": [ASKS],
        po: [
          {
            reply: {
              answer: ANSWER,
              testFix: {
                files: ["test/one.test.ts", "test/two.test.ts"],
                change: CHANGE,
              },
            },
          },
        ],
        "test-writer": [EDITS],
      },
      treeDiff: ["test/one.test.ts"],
    });
    run(world);
    const instructions = world.roleCalls[2]?.instructions ?? "";
    expect(instructions).toContain("test/one.test.ts");
    expect(instructions).toContain("test/two.test.ts");
  });

  test("any role's question can lead to a test fix, not only the code writer's", () => {
    const world = scenario({
      roles: {
        reviewer: [{ reply: QUESTION }],
        po: [{ reply: FIX_REPLY }],
        "test-writer": [EDITS],
      },
    });
    run(world);
    const order = names(world);
    expect(order.indexOf("test-writer")).toBeGreaterThan(order.indexOf("po"));
    expect(eventsNamed(world, "test_fixed")).toEqual([
      expect.objectContaining({ askedBy: "reviewer", files: [TEST_FILE] }),
    ]);
  });

  test("the asking role resumes with the answer and the files the test writer changed", () => {
    const world = scenario({
      roles: {
        "code-writer": [ASKS],
        po: [{ reply: FIX_REPLY }],
        "test-writer": [EDITS],
      },
    });
    run(world);
    const resumed = world.roleCalls[3];
    expect(resumed?.role).toBe("code-writer");
    expect(resumed?.resumeSessionId).toBeTruthy();
    expect(resumed?.instructions).toContain(ANSWER);
    expect(resumed?.instructions).toContain(TEST_FILE);
  });

  test("a test_fixed event records the asking role and the changed files", () => {
    const world = scenario({
      roles: {
        "code-writer": [ASKS],
        po: [{ reply: FIX_REPLY }],
        "test-writer": [EDITS],
      },
    });
    run(world);
    expect(eventsNamed(world, "test_fixed")).toEqual([
      expect.objectContaining({ task: TASK, askedBy: "code-writer", files: [TEST_FILE] }),
    ]);
  });

  test("a file the test writer creates counts as named", () => {
    const world = scenario({
      roles: {
        "code-writer": [ASKS],
        po: [
          {
            reply: {
              answer: ANSWER,
              testFix: { files: ["test/new.test.ts"], change: CHANGE },
            },
          },
        ],
        "test-writer": [EDITS],
      },
      treeDiff: ["test/new.test.ts"],
    });
    expect(run(world).status).toBe("ready");
  });

  test("an empty files list is no testFix", () => {
    const world = scenario({
      roles: {
        "code-writer": [ASKS],
        po: [{ reply: { answer: ANSWER, testFix: { files: [], change: CHANGE } } }],
      },
    });
    expect(run(world).status).toBe("ready");
    expect(names(world)).not.toContain("test-writer");
    expect(eventsNamed(world, "test_fixed")).toHaveLength(0);
    expect(eventsNamed(world, "test_fix_skipped")).toHaveLength(0);
  });

  test("an answer without testFix behaves as before", () => {
    const world = scenario({
      roles: { "code-writer": [ASKS], po: [{ reply: { answer: ANSWER } }] },
    });
    expect(run(world).status).toBe("ready");
    expect(names(world).slice(0, 3)).toEqual(["code-writer", "po", "code-writer"]);
    expect(names(world)).not.toContain("test-writer");
  });
});

describe("the scope check after the test writer", () => {
  test("a change to another file too is stuck, naming that file", () => {
    const world = scenario({
      roles: {
        "code-writer": [ASKS],
        po: [{ reply: FIX_REPLY }],
        "test-writer": [EDITS],
      },
      treeDiff: [TEST_FILE, "src/other.ts"],
    });
    const result = run(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("src/other.ts");
    expect(names(world).filter((role) => role === "code-writer")).toHaveLength(1);
    expect(eventsNamed(world, "test_fixed")).toHaveLength(0);
  });

  test("no change to the named files is stuck, saying the test was not changed", () => {
    const world = scenario({
      roles: {
        "code-writer": [ASKS],
        po: [{ reply: FIX_REPLY }],
        "test-writer": [NOOP],
      },
    });
    const result = run(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toMatch(/not changed/i);
    expect(names(world).filter((role) => role === "code-writer")).toHaveLength(1);
  });

  test("an unreadable fingerprint is stuck", () => {
    const world = scenario({
      roles: {
        "code-writer": [ASKS],
        po: [{ reply: FIX_REPLY }],
        "test-writer": [EDITS],
      },
      writeTreeFails: true,
    });
    expect(run(world).status).toBe("stuck");
    expect(names(world).filter((role) => role === "code-writer")).toHaveLength(1);
  });
});

describe("the cap of two test fixes per run", () => {
  test("a third testFix is skipped, the asking role gets the answer alone", () => {
    const world = scenario({
      roles: {
        "code-writer": [ASKS, NOOP, ASKS, NOOP, ASKS, { codes: true }],
        po: [{ reply: FIX_REPLY }, { reply: FIX_REPLY }, { reply: FIX_REPLY }],
        "test-writer": [EDITS, EDITS, EDITS],
      },
    });
    run(world);
    expect(names(world).filter((role) => role === "test-writer")).toHaveLength(2);
    expect(eventsNamed(world, "test_fixed")).toHaveLength(2);
    expect(eventsNamed(world, "test_fix_skipped")).toEqual([
      expect.objectContaining({ task: TASK, files: [TEST_FILE] }),
    ]);
    const resumes = world.roleCalls.filter(
      (call) => call.role === "code-writer" && call.resumeSessionId
    );
    expect(resumes).toHaveLength(3);
    expect(resumes[2]?.instructions).toContain(ANSWER);
    expect(resumes[2]?.instructions).not.toContain(TEST_FILE);
  });
});

describe("the test writer's own question during a fix", () => {
  test("goes to the PO and the build continues", () => {
    const world = scenario({
      roles: {
        "code-writer": [ASKS],
        po: [{ reply: FIX_REPLY }, { reply: { answer: "use 3" } }],
        "test-writer": [{ ...EDITS, reply: QUESTION }],
      },
    });
    expect(run(world).status).toBe("ready");
    expect(names(world).slice(0, 5)).toEqual([
      "code-writer",
      "po",
      "test-writer",
      "po",
      "test-writer",
    ]);
  });

  test("a userQuestion stops the build waiting", () => {
    const world = scenario({
      roles: {
        "code-writer": [ASKS],
        po: [{ reply: FIX_REPLY }, { reply: { userQuestion: "Which total?" } }],
        "test-writer": [{ ...EDITS, reply: QUESTION }],
      },
    });
    expect(run(world)).toMatchObject({ status: "waiting", message: "Which total?" });
  });
});
