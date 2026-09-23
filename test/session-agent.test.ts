import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { findSessionAgent, type SessionAgent } from "../src/cli/session-agent";
import { writeFakeBin } from "./fixtures/fake-bin";

describe("findSessionAgent", () => {
  let dir: string;
  const originalPath = process.env.PATH;

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), "pal-session-agent-"));
    process.env.PATH = dir;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns null when no terminal agent is on PATH", () => {
    expect(findSessionAgent()).toBeNull();
  });

  test.each<[SessionAgent, string[]]>([
    ["copilot", ["copilot"]],
    ["codex", ["codex"]],
    ["cursor-agent", ["cursor-agent"]],
    ["opencode", ["opencode"]],
  ])("launches %s when it is the only agent installed", (expected, installed) => {
    for (const binary of installed) writeFakeBin(dir, binary, "");
    expect(findSessionAgent()).toBe(expected);
  });

  test.each<[SessionAgent, string[]]>([
    ["claude", ["opencode", "copilot", "cursor-agent", "codex", "claude"]],
    ["codex", ["opencode", "copilot", "cursor-agent", "codex"]],
    ["cursor-agent", ["opencode", "copilot", "cursor-agent"]],
    ["copilot", ["opencode", "copilot"]],
  ])("prefers %s over every lower-priority agent", (expected, installed) => {
    for (const binary of installed) writeFakeBin(dir, binary, "");
    expect(findSessionAgent()).toBe(expected);
  });
});
