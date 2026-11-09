import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const PLUGIN = "assets/plugins/dark-factory";

describe("run-hook has no factory rules", () => {
  test("nothing under .agents/hooks or in .claude/settings.json names the factory", () => {
    const files = readdirSync(join(ROOT, ".agents/hooks")).map(
      (name) => `.agents/hooks/${name}`
    );
    files.push(".claude/settings.json");
    const hits = files.flatMap((file) =>
      read(file)
        .split("\n")
        .filter((line) =>
          /factory|DARK_FACTORY_ROLE|needs-code|StructuredOutput/.test(line)
        )
        .map((line) => `${file}: ${line.trim()}`)
    );
    expect(hits).toEqual([]);
  });

  test("the PreToolUse gate matcher is the SubagentHandback alone", () => {
    const settings = JSON.parse(read(".claude/settings.json"));
    const matchers = settings.hooks.PreToolUse.map(
      (entry: { matcher: string }) => entry.matcher
    );
    expect(matchers).toContain("SubagentHandback");
    expect(matchers.join("|")).not.toContain("StructuredOutput");
  });
});

describe("the written rule", () => {
  test("the PO skill starts the session with the po command from prepare", () => {
    const skill = read(`${PLUGIN}/skills/build-with-agents/SKILL.md`);
    expect(skill).toContain("`po`");
    expect(skill).not.toContain("cd <worktree> && claude");
  });

  test("the PO skill gates the test writer with gate.mjs for the test-writer role", () => {
    const skill = read(`${PLUGIN}/skills/build-with-agents/SKILL.md`);
    expect(skill).toMatch(/gate\.mjs <worktree> <id> test-writer/);
  });

  test("the README says the gate is .dark-factory.json, roles run without the repo's hooks, and git hooks run", () => {
    const readme = read(`${PLUGIN}/README.md`);
    expect(readme).toContain("--setting-sources local");
    expect(readme).not.toContain("--setting-sources project,local");
    expect(readme).not.toContain("The repo's hooks do run");
    expect(readme).toContain('"roles"');
    expect(readme).toMatch(/git hooks/i);
  });

  test("AGENTS.md no longer describes factory rules in the hook system", () => {
    const agents = read("AGENTS.md");
    expect(agents).not.toContain("DARK_FACTORY_ROLE");
    expect(agents).not.toContain("StructuredOutput");
    expect(agents).not.toContain("--needs-code");
    expect(agents).toContain(".dark-factory.json");
  });
});

describe("this repo's .dark-factory.json", () => {
  const gate = JSON.parse(read(".dark-factory.json")).gate as {
    name: string;
    roles?: string[];
  }[];

  test("lint, lf and secretlint list the test writer, code writer and debugger", () => {
    for (const name of ["lint", "lf", "secretlint"]) {
      const entry = gate.find((candidate) => candidate.name === name);
      expect([...(entry?.roles ?? [])].sort()).toEqual([
        "code-writer",
        "debugger",
        "test-writer",
      ]);
    }
  });

  test("the other entries stay without roles", () => {
    for (const entry of gate.filter(
      (candidate) => !["lint", "lf", "secretlint"].includes(candidate.name)
    )) {
      expect(entry.roles).toBeUndefined();
    }
  });
});
