import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { lintSubagent } from "../src/tools/subagent-doctor";

const ROOT = resolve(import.meta.dir, "../.test-home-subagent-doctor");

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
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
});

afterAll(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
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

  test("no platform block at all warns", () => {
    const bare = `---
name: bare-agent
description: "A minimal subagent. Use when nothing else fits."
---

You do a thing.
`;
    expect(hasWarn(fixture(bare), "platforms")).toBe(true);
  });

  test("the GOOD fixture produces zero non-pass findings we did not expect", () => {
    // Guards against a check silently flipping GOOD to warn/error.
    expect(findings(fixture(GOOD))).toHaveLength(0);
  });
});
