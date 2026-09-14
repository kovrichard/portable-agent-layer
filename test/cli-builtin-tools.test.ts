import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

/**
 * `--help` proves dispatch, not behaviour. These run each writing tool for real
 * against its own PAL_HOME, both ways, and compare the whole resulting tree —
 * the assertion Phase 2's doc rewrite actually rests on.
 */
const WRITE_CASES: Record<string, string[]> = {
  "relationship-note": [
    "--o",
    "prefers terse output",
    "--confidence",
    "0.9",
    "--w",
    "builds with bun",
    "--b",
    "closed the verb gap",
  ],
  "algorithm-reflect": [
    "--task",
    "close the verb gap",
    "--criteria",
    "5",
    "--passed",
    "5",
    "--failed",
    "0",
    "--sentiment",
    "8",
    "--q1",
    "test write paths, not just --help",
    "--q2",
    "a differential harness per tool",
    "--q3",
    "proved dispatch, not behaviour",
  ],
  "handoff-note": [
    "--title",
    "phase 1 verb surface",
    "--text",
    "phase 2 rewrites the docs",
  ],
  "wisdom-frame": [
    "--domain",
    "workflow",
    "--observation",
    "prove write paths differentially",
    "--type",
    "principle",
  ],
  synthesize: ["--force", "--days", "7"],
  analyze: ["--actionable"],
};

/** Two homes mean two registries, so their generated ids differ by design. */
function normalize(text: string, home: string): string {
  const homes = [home, home.replaceAll("\\", "/"), home.replaceAll("\\", "\\\\")];
  return homes
    .reduce((acc, h) => acc.replaceAll(h, "HOME"), text)
    .replace(
      new RegExp(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g),
      "UUID"
    )
    .replace(new RegExp(/(machine|actor)-[0-9a-f]{4}\b/g), "$1-ID")
    .replace(new RegExp(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g), "TS");
}

function treeOf(root: string): string[] {
  return readdirSync(root, { recursive: true })
    .map((entry) => String(entry).replaceAll("\\", "/"))
    .filter((rel) => statSync(resolve(root, rel)).isFile())
    .sort();
}

describe("pal cli <tool> — the writing path, not just --help", () => {
  test.each(Object.entries(WRITE_CASES))(
    "%s writes the same tree either way",
    (verb, args) => {
      const viaCliHome = mkdtempSync(resolve(tmpdir(), "pal-write-cli-"));
      const viaPathHome = mkdtempSync(resolve(tmpdir(), "pal-write-path-"));
      try {
        const viaCli = spawnSync("bun", [CLI, "cli", verb, ...args], {
          env: { ...process.env, PAL_HOME: viaCliHome },
          encoding: "utf-8",
          timeout: 20000,
        });
        const viaPath = spawnSync("bun", [resolve(TOOL_DIR, `${verb}.ts`), ...args], {
          env: { ...process.env, PAL_HOME: viaPathHome },
          encoding: "utf-8",
          timeout: 20000,
        });

        expect(viaCli.status).toBe(0);
        expect(viaCli.status).toBe(viaPath.status);
        expect(normalize(viaCli.stdout, viaCliHome)).toBe(
          normalize(viaPath.stdout, viaPathHome)
        );

        const tree = treeOf(viaCliHome);
        expect(tree).toEqual(treeOf(viaPathHome));
        expect(tree.length).toBeGreaterThan(0);
        for (const rel of tree) {
          expect(
            normalize(readFileSync(resolve(viaCliHome, rel), "utf-8"), viaCliHome)
          ).toBe(
            normalize(readFileSync(resolve(viaPathHome, rel), "utf-8"), viaPathHome)
          );
        }
      } finally {
        rmSync(viaCliHome, { recursive: true, force: true });
        rmSync(viaPathHome, { recursive: true, force: true });
      }
    },
    30000
  );
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
