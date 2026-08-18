import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");
const HOME = resolve(import.meta.dir, "../.test-home-subagent-link");

const env = {
  ...process.env,
  PAL_HOME: resolve(HOME, ".pal"),
  PAL_CLAUDE_DIR: resolve(HOME, ".claude"),
  PAL_OPENCODE_DIR: resolve(HOME, ".config/opencode"),
  PAL_CURSOR_DIR: resolve(HOME, ".cursor"),
  PAL_COPILOT_DIR: resolve(HOME, ".copilot"),
  PAL_CODEX_DIR: resolve(HOME, ".codex"),
  PAL_AGENTS_DIR: resolve(HOME, ".agents"),
};

function subagentLink(name: string) {
  return spawnSync("bun", ["run", CLI, "cli", "subagent", "link", name], {
    env,
    encoding: "utf-8",
    timeout: 15000,
  });
}

const claudeFile = resolve(HOME, ".claude/agents/my-helper.md");
const opencodeFile = resolve(HOME, ".config/opencode/agents/my-helper.md");
const copilotFile = resolve(HOME, ".copilot/agents/my-helper.md");
const cursorFile = resolve(HOME, ".cursor/agents/my-helper.md");

const MERGED = `---
name: my-helper
description: "A test helper subagent. Use when testing installation."
claude:
  tools: Read, Grep
  model: fable
opencode:
  mode: subagent
  permission:
    read: allow
copilot:
  model: inherit
  tools: read
---

You are a test helper subagent.
`;

let firstLink: ReturnType<typeof subagentLink>;

beforeAll(() => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
  // A personal subagent already authored under ~/.pal/agents/
  mkdirSync(resolve(HOME, ".pal/agents"), { recursive: true });
  writeFileSync(resolve(HOME, ".pal/agents/my-helper.md"), MERGED);
  // claude, opencode, copilot are "installed" (agents dirs exist); cursor is not.
  mkdirSync(resolve(HOME, ".claude/agents"), { recursive: true });
  mkdirSync(resolve(HOME, ".config/opencode/agents"), { recursive: true });
  mkdirSync(resolve(HOME, ".copilot/agents"), { recursive: true });
  firstLink = subagentLink("my-helper");
});

afterAll(() => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
});

describe("pal cli subagent link", () => {
  test("installs a personal subagent into installed agents only", () => {
    expect(firstLink.status).toBe(0);

    expect(existsSync(claudeFile)).toBe(true);
    expect(existsSync(opencodeFile)).toBe(true);
    expect(existsSync(copilotFile)).toBe(true);
    // cursor's agents dir does not exist → skipped, no stray file
    expect(existsSync(cursorFile)).toBe(false);
  });

  test("splits frontmatter per platform — Claude gets only its block", () => {
    const claude = readFileSync(claudeFile, "utf-8");
    expect(claude).toContain("model: fable");
    expect(claude).toContain("tools: Read, Grep");
    // no leakage from the copilot block
    expect(claude).not.toContain("model: inherit");
    // no other platform's block header survives
    expect(claude).not.toContain("opencode:");
    expect(claude).not.toContain("copilot:");
  });

  test("the copilot block actually parses (regex fix) and lands in the copilot file", () => {
    const copilot = readFileSync(copilotFile, "utf-8");
    // copilot's own fields present…
    expect(copilot).toContain("model: inherit");
    expect(copilot).toContain("tools: read");
    // …and claude's fields did NOT leak in (they would if copilot: were
    // unrecognised and its lines fell through to the global frontmatter)
    expect(copilot).not.toContain("model: fable");
  });

  test("opencode gets mode + permission", () => {
    const oc = readFileSync(opencodeFile, "utf-8");
    expect(oc).toContain("mode: subagent");
    expect(oc).toContain("read: allow");
  });

  test("is idempotent — re-linking succeeds", () => {
    const res = subagentLink("my-helper");
    expect(res.status).toBe(0);
    expect(existsSync(claudeFile)).toBe(true);
  });

  test("rejects a name that collides with a shipped subagent", () => {
    writeFileSync(
      resolve(HOME, ".pal/agents/skill-author.md"),
      MERGED.replace("name: my-helper", "name: skill-author")
    );
    const res = subagentLink("skill-author");
    expect(res.status).toBe(1);
    expect(res.stderr + res.stdout).toContain("shipped PAL subagent");
    // and it must NOT have overwritten anything in the agent dirs
    expect(existsSync(resolve(HOME, ".claude/agents/skill-author.md"))).toBe(false);
  });

  test("fails when the subagent does not exist in ~/.pal/agents/", () => {
    const res = subagentLink("ghost");
    expect(res.status).toBe(1);
  });

  test("errors with usage when no name is given", () => {
    const res = spawnSync("bun", ["run", CLI, "cli", "subagent", "link"], {
      env,
      encoding: "utf-8",
      timeout: 15000,
    });
    expect(res.status).toBe(1);
  });
});
