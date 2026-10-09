import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { assets } from "../src/hooks/lib/paths";
import { lintSubagent, resolveSubagentFile } from "../src/tools/subagent-doctor";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const ROOT = testHome(import.meta.file);

let counter = 0;
/**
 * Write a subagent fixture to `<stem>.md` and return its path. The file is named
 * after the frontmatter `name` (so name/file matches by default); pass `stem` to
 * force a mismatch for the name.file check.
 */
function fixture(content: string, stem?: string): string {
  counter += 1;
  const name = stem ?? /^name:\s*"?(.+?)"?\s*$/m.exec(content)?.[1]?.trim() ?? "agent";
  const dir = resolve(ROOT, `case-${counter}`);
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${name}.md`);
  writeFileSync(file, content);
  return file;
}

const findings = (file: string) =>
  lintSubagent(file).findings.filter((f) => f.level !== "pass");
const hasError = (file: string, check: string) =>
  lintSubagent(file).findings.some((f) => f.level === "error" && f.check === check);
const hasWarn = (file: string, check: string) =>
  lintSubagent(file).findings.some((f) => f.level === "warn" && f.check === check);

const GOOD = `---
name: good-agent
description: "Reviews TypeScript for correctness. Use when a diff needs a bug pass."
claude:
  tools: Read, Grep
  model: fable
opencode:
  mode: subagent
  permission:
    read: allow
    edit: deny
cursor:
  model: inherit
  readonly: false
---

You review code for correctness issues and report them succinctly.
`;

beforeAll(() => {
  removeOnceReleased(ROOT);
});

afterAll(() => {
  removeOnceReleased(ROOT);
});

describe("subagent-doctor", () => {
  test("a well-formed subagent passes with no errors", () => {
    const report = lintSubagent(fixture(GOOD));
    expect(report.errors).toBe(0);
  });

  test("missing file is a structure error", () => {
    const report = lintSubagent(resolve(ROOT, "does-not-exist.md"));
    expect(report.errors).toBe(1);
    expect(report.findings[0].check).toBe("structure");
  });

  test("content with no frontmatter is a structure error", () => {
    expect(hasError(fixture("just a body, no frontmatter\n", "bare"), "structure")).toBe(
      true
    );
  });

  test("name that mismatches the file name errors", () => {
    // file is other.md but frontmatter name is good-agent
    expect(hasError(fixture(GOOD, "other"), "name.file")).toBe(true);
  });

  test("uppercase name fails the charset check", () => {
    const bad = GOOD.replace("name: good-agent", "name: GoodAgent");
    expect(hasError(fixture(bad, "GoodAgent"), "name.charset")).toBe(true);
  });

  test("a name containing a reserved word errors", () => {
    const bad = GOOD.replace("name: good-agent", "name: claude-helper");
    expect(hasError(fixture(bad), "name.reserved")).toBe(true);
  });

  test("a name colliding with a shipped subagent errors", () => {
    const bad = GOOD.replace("name: good-agent", "name: skill-author");
    expect(hasError(fixture(bad), "name.collision")).toBe(true);
  });

  test("missing description errors", () => {
    const bad = GOOD.split("\n")
      .filter((l) => !l.startsWith("description:"))
      .join("\n");
    expect(hasError(fixture(bad), "description")).toBe(true);
  });

  test("empty body errors", () => {
    const bad = `${GOOD.split("---")[0]}---\n${GOOD.split("---")[1]}---\n\n`;
    expect(hasError(fixture(bad), "body.present")).toBe(true);
  });

  test("unquoted description warns", () => {
    const bad = GOOD.replace(
      'description: "Reviews TypeScript for correctness. Use when a diff needs a bug pass."',
      "description: Reviews TypeScript for correctness. Use when a diff needs a bug pass."
    );
    expect(hasWarn(fixture(bad), "description.quoted")).toBe(true);
  });

  test("an invalid opencode permission value warns", () => {
    const bad = GOOD.replace("read: allow", "read: maybe");
    expect(hasWarn(fixture(bad), "opencode.permission")).toBe(true);
  });

  test("a skills field in a non-Claude block warns (unsupported there)", () => {
    const bad = GOOD.replace(
      "cursor:\n  model: inherit\n  readonly: false",
      "cursor:\n  model: inherit\n  readonly: false\n  skills:\n    - foo"
    );
    expect(hasWarn(fixture(bad), "cursor.skills")).toBe(true);
  });

  test("a global field beyond name and description errors", () => {
    const bad = GOOD.replace("claude:\n", "model: inherit\nclaude:\n");
    expect(hasError(fixture(bad), "global.fields")).toBe(true);
  });

  test("an unknown codex sandbox_mode warns", () => {
    const bad = GOOD.replace(
      "---\n\nYou review",
      "codex:\n  sandbox_mode: open\n---\n\nYou review"
    );
    expect(hasWarn(fixture(bad), "codex.sandbox_mode")).toBe(true);
  });

  test.each(["tools", "skills"])("a %s list in the codex block warns", (key) => {
    const bad = GOOD.replace(
      "---\n\nYou review",
      `codex:\n  ${key}:\n    - read\n---\n\nYou review`
    );
    expect(hasWarn(fixture(bad), `codex.${key}`)).toBe(true);
  });

  test("a valid codex block adds no findings", () => {
    const good = GOOD.replace(
      "---\n\nYou review",
      "codex:\n  model: gpt-6-sol\n  sandbox_mode: read-only\n---\n\nYou review"
    );
    expect(findings(fixture(good))).toHaveLength(0);
  });

  const withAntigravity = (block: string) =>
    fixture(GOOD.replace("---\n\nYou review", `antigravity:\n${block}---\n\nYou review`));

  const antigravityProblems = (file: string) =>
    findings(file)
      .filter((f) => f.check.startsWith("antigravity."))
      .map((f) => `${f.level} ${f.check}: ${f.message}`);

  test.each([
    [
      "a full block",
      "  model: pro\n  subagent: true\n  mainAgent: false\n  tools:\n    - view_file\n    - run_command\n",
    ],
    ["tools alone", "  tools:\n    - view_file\n"],
  ])("%s for antigravity adds no findings", (_case, block) => {
    expect(findings(withAntigravity(block))).toHaveLength(0);
  });

  test("Claude tool names in the antigravity block error, since they can hang agy", () => {
    const file = withAntigravity("  tools:\n    - view_file\n    - Bash\n    - Grep\n");
    expect(antigravityProblems(file)).toEqual([
      expect.stringContaining("error antigravity.tools: unknown tool(s) Bash, Grep — "),
    ]);
  });

  test.each([
    ["missing", "  model: flash\n"],
    ["blank", "  tools:\n"],
    ["empty", "  tools: []\n"],
  ])("%s antigravity tools warn, since agy then grants none", (_case, block) => {
    expect(antigravityProblems(withAntigravity(block))).toEqual([
      expect.stringContaining("warn antigravity.tools: no `tools` — "),
    ]);
  });

  test.each([
    ["a comma string", "  tools: view_file, run_command\n"],
    ["a list holding a mapping", "  tools:\n    - view_file\n    - name: grep_search\n"],
    ["unparseable YAML", "  tools: [view_file\n"],
  ])("antigravity tools as %s error, since agy needs a list of names", (_case, block) => {
    expect(antigravityProblems(withAntigravity(block))).toEqual([
      "error antigravity.tools: `tools` must be a YAML list of tool names",
    ]);
  });

  test("an antigravity model outside inherit/flash/pro warns", () => {
    const file = withAntigravity("  model: fable\n  tools:\n    - view_file\n");
    expect(antigravityProblems(file)).toEqual([
      'warn antigravity.model: model "fable" — expected one of inherit, flash, pro',
    ]);
  });

  test("every shipped subagent's antigravity block is clean", () => {
    const shipped = readdirSync(assets.agents()).filter((f) => f.endsWith(".md"));
    expect(shipped.length).toBeGreaterThan(0);
    for (const file of shipped) {
      const report = lintSubagent(resolve(assets.agents(), file));
      const antigravity = report.findings.filter((f) =>
        f.check.startsWith("antigravity.")
      );
      expect(antigravity.map((f) => `${file} ${f.level} ${f.check}`)).toEqual([
        `${file} pass antigravity.tools`,
      ]);
    }
  });

  test("no platform block at all warns", () => {
    const bare = `---
name: bare-agent
description: "A minimal subagent. Use when nothing else fits."
---

You do a thing.
`;
    expect(hasWarn(fixture(bare), "platforms")).toBe(true);
    expect(
      lintSubagent(fixture(bare)).findings.find((f) => f.check === "platforms")?.message
    ).toContain("/codex:/antigravity: block");
  });

  test("the GOOD fixture produces zero non-pass findings we did not expect", () => {
    // Guards against a check silently flipping GOOD to warn/error.
    expect(findings(fixture(GOOD))).toHaveLength(0);
  });
});

describe("resolveSubagentFile", () => {
  // The usage string takes a file, and a user types the one they know:
  // `pal cli subagent doctor ~/agents/helper.md`. No Windows shell expands that.
  test("expands a leading tilde in a .md argument", () => {
    expect(resolveSubagentFile("~/agents/helper.md")).toBe(
      resolve(homedir(), "agents", "helper.md")
    );
  });

  // A bare name is looked up in the store, so the tilde form must not be
  // mistaken for one and appended to the agents directory.
  test("a tilde path is not treated as a bare name in the store", () => {
    expect(resolveSubagentFile("~/helper")).toBe(resolve(homedir(), "helper.md"));
  });
});
