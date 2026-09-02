import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  copyAgentsForCopilot,
  copyAgentsForCursor,
  copyAgentsForOpencode,
  removeAgentsFromCopilot,
  removeAgentsFromCursor,
  removeAgentsFromOpencode,
} from "../src/targets/lib";

const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "pal-agents-"));
  dirs.push(dir);
  return dir;
}

function agentFile(dir: string, name = "gemini-researcher.md"): string {
  return readFileSync(resolve(dir, name), "utf-8");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  }
});

describe("agent extraction per platform", () => {
  test("installs every shipped agent and reports the count", () => {
    const dir = tmp();

    const count = copyAgentsForOpencode(dir);

    expect(count).toBeGreaterThan(0);
    expect(readdirSync(dir).filter((f) => f.endsWith(".md"))).toHaveLength(count);
  });

  test("keeps the global fields for every platform", () => {
    const oc = tmp();
    const cur = tmp();
    copyAgentsForOpencode(oc);
    copyAgentsForCursor(cur);

    for (const content of [agentFile(oc), agentFile(cur)]) {
      expect(content).toContain("name: gemini-researcher");
      expect(content).toContain("description: Deep research");
    }
  });

  test("un-indents the target platform block into the frontmatter root", () => {
    const dir = tmp();
    copyAgentsForOpencode(dir);

    const content = agentFile(dir);

    expect(content).toContain("\nmode: subagent");
    expect(content).toContain("\npermission:");
    expect(content).toContain("\n  read: allow");
  });

  test("strips every other platform's block", () => {
    const dir = tmp();
    copyAgentsForCursor(dir);

    const content = agentFile(dir);

    expect(content).toContain("model: inherit");
    expect(content).not.toContain("mode: subagent");
    expect(content).not.toContain("tools: Bash, WebSearch");
    expect(content).not.toContain("opencode:");
    expect(content).not.toContain("claude:");
    expect(content).not.toContain("cursor:");
  });

  test("keeps only the global fields when the agent has no block for that platform", () => {
    const dir = tmp();
    copyAgentsForCopilot(dir);

    const content = agentFile(dir);

    expect(content).toContain("name: gemini-researcher");
    expect(content).not.toContain("model: sonnet");
    expect(content).not.toContain("mode: subagent");
    expect(content).not.toContain("model: inherit");
  });

  test("preserves the body after the frontmatter", () => {
    const dir = tmp();
    copyAgentsForOpencode(dir);

    const content = agentFile(dir);
    const frontmatterEnd = content.indexOf("\n---", 3);

    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("You are a research specialist");
    expect(content.indexOf("You are a research specialist")).toBeGreaterThan(
      frontmatterEnd
    );
  });

  // The source bodies carry their own `---` horizontal rules, so the extractor
  // splits into more than three parts and rejoins everything past the frontmatter.
  test("keeps horizontal rules that appear inside the body", () => {
    const dir = tmp();
    copyAgentsForOpencode(dir);

    const source = readFileSync("assets/agents/gemini-researcher.md", "utf-8");
    const sourceRules = source.split(/^---\s*$/m).length - 1;

    expect(agentFile(dir).split(/^---\s*$/m).length - 1).toBe(sourceRules);
  });

  test("overwrites an existing install rather than duplicating", () => {
    const dir = tmp();
    const first = copyAgentsForOpencode(dir);
    const second = copyAgentsForOpencode(dir);

    expect(second).toBe(first);
    expect(readdirSync(dir).filter((f) => f.endsWith(".md"))).toHaveLength(first);
  });
});

describe("agent removal per platform", () => {
  test("removes what it installed and names each one", () => {
    const dir = tmp();
    const count = copyAgentsForOpencode(dir);

    const removed = removeAgentsFromOpencode(dir);

    expect(removed).toHaveLength(count);
    expect(removed).toContain("gemini-researcher");
    expect(removed.some((n) => n.endsWith(".md"))).toBe(false);
    expect(readdirSync(dir).filter((f) => f.endsWith(".md"))).toHaveLength(0);
  });

  test("reports nothing when there is nothing installed", () => {
    expect(removeAgentsFromCursor(tmp())).toEqual([]);
  });

  test("leaves an unrelated file in the directory alone", () => {
    const dir = tmp();
    copyAgentsForCopilot(dir);
    Bun.write(resolve(dir, "mine.md"), "keep me");

    removeAgentsFromCopilot(dir);

    expect(existsSync(resolve(dir, "mine.md"))).toBe(true);
  });
});
