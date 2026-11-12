import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { renderAgentForPlatform } from "../src/targets/agent-render";
import { removeAgents } from "../src/targets/claude/agents";
import {
  loadCodexRulesTemplate,
  mergeCodexRules,
  unmergeCodexRules,
} from "../src/targets/codex/rules";
import { installPersonalSubagent } from "../src/targets/personal-subagents";
import { freshTestDir } from "./lib/test-home";

const DIR_VARS = {
  PAL_CLAUDE_DIR: "claude",
  PAL_CURSOR_DIR: "cursor",
  PAL_CODEX_DIR: "codex",
  PAL_GEMINI_DIR: "gemini",
  PAL_COPILOT_DIR: "copilot",
  PAL_OPENCODE_DIR: "opencode",
  PAL_AGENTS_DIR: "agents-dir",
} as const;

let ROOT: string;

beforeEach(() => {
  ROOT = freshTestDir(import.meta.file);

  for (const [name, dir] of Object.entries(DIR_VARS)) {
    process.env[name] = resolve(ROOT, dir);
  }
  process.env.PAL_HOME = resolve(ROOT, "home");
});

function write(path: string, content: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);

  return path;
}

const B = "# BEGIN PAL MANAGED CODEX RULES";
const E = "# END PAL MANAGED CODEX RULES";
const T = `${B}\nprefix_rule(pattern=["git","push"], decision="prompt")\n${E}`;

describe("mergeCodexRules", () => {
  test("appends the template block to empty rules", () => {
    expect(mergeCodexRules("", T)).toBe(`${T}\n`);
  });

  test("trims the template and separates it from user rules", () => {
    expect(mergeCodexRules("user_rule()\n", `\n${T}\n\n`)).toBe(`user_rule()\n\n${T}\n`);
  });

  test("replaces a stale PAL block between user rules", () => {
    expect(mergeCodexRules(`a()\n${B}\nold()\n${E}\nb()\n`, T)).toBe(
      `a()\nb()\n\n${T}\n`
    );
  });

  test("collapses runs of blank lines", () => {
    expect(mergeCodexRules("a()\n\n\n\nb()", T)).toBe(`a()\n\nb()\n\n${T}\n`);
  });
});

describe("unmergeCodexRules", () => {
  test("removes a file holding only the PAL block", () => {
    expect(unmergeCodexRules(`${T}\n`)).toBe("");
  });

  test("keeps user rules", () => {
    expect(unmergeCodexRules(`user_rule()\n\n${T}\n`)).toBe("user_rule()\n");
  });

  test("returns empty for empty input", () => {
    expect(unmergeCodexRules("")).toBe("");
  });

  test("removes every PAL block", () => {
    expect(unmergeCodexRules(`a()\n${B}\nx\n${E}\n\n\n\nb()\n${B}\ny\n${E}\n`)).toBe(
      "a()\n\nb()\n"
    );
  });
});

describe("loadCodexRulesTemplate", () => {
  test("returns the trimmed file content", () => {
    const path = write(resolve(ROOT, "rules.rules"), "\n\n  rule()  \n\n");
    expect(loadCodexRulesTemplate(path)).toBe("rule()");
  });
});

describe("removeAgents", () => {
  test("removes shipped agents and keeps the user's own", () => {
    const dir = resolve(ROOT, "claude", "agents");
    mkdirSync(dir, { recursive: true });

    for (const file of ["scout.md", "skill-author.md", "mine.md"]) {
      writeFileSync(resolve(dir, file), "x");
    }
    expect(removeAgents().sort()).toEqual(["scout", "skill-author"]);
    expect(readdirSync(dir)).toEqual(["mine.md"]);
  });

  test("returns nothing for an empty agents dir", () => {
    mkdirSync(resolve(ROOT, "claude", "agents"), { recursive: true });
    expect(removeAgents()).toEqual([]);
  });
});

describe("installPersonalSubagent", () => {
  const content =
    "---\nname: helper\ndescription: Helps with things\n---\nDo the thing.\n";

  function personal(name: string, body = content): string {
    return write(resolve(ROOT, "home", "agents", `${name}.md`), body);
  }

  test("installs into no agent when none has an agents dir", () => {
    personal("helper");
    expect(installPersonalSubagent("helper")).toEqual([]);
  });

  test("renders for every agent that has an agents dir", () => {
    personal("helper");
    mkdirSync(resolve(ROOT, "claude", "agents"), { recursive: true });
    mkdirSync(resolve(ROOT, "codex", "agents"), { recursive: true });
    expect(installPersonalSubagent("helper")).toEqual(["claude", "codex"]);
    expect(readFileSync(resolve(ROOT, "claude", "agents", "helper.md"), "utf-8")).toBe(
      renderAgentForPlatform(content, "claude")
    );
    expect(readFileSync(resolve(ROOT, "codex", "agents", "helper.toml"), "utf-8")).toBe(
      "name = \"helper\"\ndescription = \"Helps with things\"\ndeveloper_instructions = '''\nDo the thing.\n'''\n"
    );
  });

  test("throws when the subagent file is missing", () => {
    expect(() => installPersonalSubagent("ghost")).toThrow(
      `No subagent found at ${resolve(ROOT, "home", "agents", "ghost.md")}`
    );
  });

  test("refuses a shipped subagent name", () => {
    personal("scout");
    expect(() => installPersonalSubagent("scout")).toThrow(
      "'scout' is a shipped PAL subagent — choose another name (a reinstall would overwrite it)."
    );
  });

  test("builds every target before writing any", () => {
    mkdirSync(resolve(ROOT, "claude", "agents"), { recursive: true });
    mkdirSync(resolve(ROOT, "codex", "agents"), { recursive: true });
    personal("plain", "Just text.\n");
    expect(() => installPersonalSubagent("plain")).toThrow(
      "Cannot build the codex subagent: no frontmatter to build a Codex agent from"
    );
    expect(existsSync(resolve(ROOT, "claude", "agents", "plain.md"))).toBe(false);
  });
});
