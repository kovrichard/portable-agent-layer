import { beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runGate } from "../assets/plugins/dark-factory/scripts/gate.mjs";
import { freshTestDir } from "./lib/test-home";

const config = {
  gate: [
    { name: "lint", run: "lint-cmd", roles: ["test-writer", "code-writer", "debugger"] },
    { name: "tw-only", run: "tw-cmd", roles: ["test-writer"] },
    { name: "tests", run: "tests-cmd" },
  ],
};

let env: Record<string, string>;
let ran: string[];

const run = (command: string) => {
  ran.push(command);

  return { exitCode: 0, output: "" };
};

const gateFor = (role: string, options: object = {}) =>
  runGate(
    "/repo",
    { task: "t1", role, attempt: 1, model: "m" },
    { config, env, run, ...options }
  );

beforeEach(() => {
  const root = freshTestDir("dark-factory-gate-roles");
  env = { DARK_FACTORY_HOME: join(root, "factory"), HOME: root };
  ran = [];
});

describe("runGate with roles on entries", () => {
  test("the test writer runs only the entries that list it", () => {
    expect(gateFor("test-writer")).toEqual({ passed: true, failed: [] });
    expect(ran).toEqual(["lint-cmd", "tw-cmd"]);
  });

  test("the code writer runs the unlisted entries plus those listing it", () => {
    gateFor("code-writer");
    expect(ran).toEqual(["lint-cmd", "tests-cmd"]);
  });

  test("the debugger runs the unlisted entries plus those listing it", () => {
    gateFor("debugger");
    expect(ran).toEqual(["lint-cmd", "tests-cmd"]);
  });

  test("an entry without roles does not apply to any other role", () => {
    const result = gateFor("reviewer");
    expect(ran).toEqual([]);
    expect(result).toEqual({ passed: true, failed: [] });
  });

  test("a role listed nowhere runs nothing and passes, even with failing commands", () => {
    const result = gateFor("tester", { run: () => ({ exitCode: 1, output: "boom" }) });
    expect(result).toEqual({ passed: true, failed: [] });
  });

  test("a failing check of the test writer's entries fails its gate by name", () => {
    const result = gateFor("test-writer", {
      run: (command: string) =>
        command === "tw-cmd"
          ? { exitCode: 2, output: "bad tests" }
          : { exitCode: 0, output: "" },
    });
    expect(result.passed).toBe(false);
    expect(result.failed).toEqual([
      { name: "tw-only", exitCode: 2, output: "bad tests" },
    ]);
  });

  test("a config without any roles gates the code writer and debugger exactly as today, nobody else", () => {
    const plain = {
      gate: [
        { name: "types", run: "tsc" },
        { name: "tests", run: "test" },
      ],
    };
    gateFor("code-writer", { config: plain });
    gateFor("debugger", { config: plain });
    expect(ran).toEqual(["tsc", "test", "tsc", "test"]);
  });
});
