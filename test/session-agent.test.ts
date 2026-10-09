import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { findSessionAgent, type SessionAgent } from "../src/cli/session-agent";
import { writeFakeBin } from "./fixtures/fake-bin";
import { removeOnceReleased } from "./lib/remove-once-released";
import { freshTestDir } from "./lib/test-home";

describe("findSessionAgent", () => {
  let dir: string;
  const originalPath = process.env.PATH;

  beforeEach(() => {
    dir = freshTestDir(import.meta.file);
    process.env.PATH = dir;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    removeOnceReleased(dir);
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
