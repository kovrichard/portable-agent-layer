import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { builtinToolVerbs } from "../src/cli/builtin-tools";

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");
const TOOL_DIR = resolve(import.meta.dir, "../src/tools/agent");

let home: string;

function run(command: string, args: string[]) {
  return spawnSync("bun", [command, ...args], {
    env: { ...process.env, PAL_HOME: home },
    encoding: "utf-8",
    timeout: 20000,
  });
}

/**
 * A read-only invocation per verb. Keyed by verb so the coverage assertion below
 * fails the moment a tool joins the registry without one.
 */
const READ_ONLY_ARGS: Record<string, string[]> = {
  "algorithm-reflect": ["--help"],
  "algorithm-synthesize": [],
  analyze: ["--help"],
  "handoff-note": ["--help"],
  project: ["list"],
  "relationship-note": ["--help"],
  synthesize: ["--help"],
  thread: ["--list"],
  "wisdom-frame": ["--help"],
};

beforeAll(() => {
  home = mkdtempSync(resolve(tmpdir(), "pal-builtin-"));
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("pal cli <tool> — the tilde-free path to a built-in tool", () => {
  test("every registered verb has a coverage case here", () => {
    expect(Object.keys(READ_ONLY_ARGS).sort()).toEqual(builtinToolVerbs);
  });

  for (const verb of Object.keys(READ_ONLY_ARGS)) {
    test(`${verb} matches the direct script invocation`, () => {
      const args = READ_ONLY_ARGS[verb] ?? [];
      const viaCli = run(CLI, ["cli", verb, ...args]);
      const viaPath = run(resolve(TOOL_DIR, `${verb}.ts`), args);
      expect(viaCli.stdout).toBe(viaPath.stdout);
      expect(viaCli.status).toBe(viaPath.status);
    });
  }

  test("an unknown verb still falls through to the usual unknown-command path", () => {
    const result = run(CLI, ["cli", "definitely-not-a-tool"]);
    expect(result.status).not.toBe(0);
  });
});

describe("pal cli skill run — a skill's own tool, by name", () => {
  const SKILL = "demo";

  beforeAll(() => {
    const tools = resolve(home, "skills", SKILL, "tools");
    mkdirSync(tools, { recursive: true });
    writeFileSync(
      resolve(tools, "echo.ts"),
      'console.log(JSON.stringify(Bun.argv.slice(2)));\nif (Bun.argv.includes("--boom")) process.exit(3);\n'
    );
  });

  test("runs the tool and passes arguments through", () => {
    const result = run(CLI, ["cli", "skill", "run", SKILL, "echo", "a", "b"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('["a","b"]');
  });

  test("a -- separator is consumed, not forwarded", () => {
    const result = run(CLI, ["cli", "skill", "run", SKILL, "echo", "--", "--flag"]);
    expect(result.stdout.trim()).toBe('["--flag"]');
  });

  test("the tool's exit code is the CLI's exit code", () => {
    const result = run(CLI, ["cli", "skill", "run", SKILL, "echo", "--boom"]);
    expect(result.status).toBe(3);
  });

  test("the .ts extension is implied but may be given", () => {
    const result = run(CLI, ["cli", "skill", "run", SKILL, "echo.ts"]);
    expect(result.status).toBe(0);
  });

  // Names reach this from SKILL.md text, so a traversing one must never resolve
  // to a file outside ~/.pal/skills/.
  test.each([
    ["skill name climbs out", ["..", "echo"]],
    ["tool name climbs out", [SKILL, "../../../../../../bin/ls"]],
    ["skill name is a nested path", ["demo/tools", "echo"]],
    ["backslash separator", [SKILL, "..\\..\\echo"]],
  ])("rejects a traversing name: %s", (_label, [skill, tool]) => {
    const result = run(CLI, ["cli", "skill", "run", skill as string, tool as string]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("plain names");
  });

  test("a missing tool is reported, not silently skipped", () => {
    const result = run(CLI, ["cli", "skill", "run", SKILL, "absent"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("absent.ts");
  });
});
