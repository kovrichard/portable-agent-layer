import { describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getAntigravityBinary,
  getClaudeBinary,
  getCodexBinary,
  getCopilotBinary,
  getCursorBinary,
  getOpencodeBinary,
  hasAntigravityBinary,
  hasClaudeBinary,
  hasCodexBinary,
  hasCopilotBinary,
  hasCursorBinary,
  hasOpencodeBinary,
} from "../src/hooks/lib/inference-binaries";
import { removeOnceReleased } from "./lib/remove-once-released";
import { freshTestDir } from "./lib/test-home";

const AGENTS = [
  ["claude", getClaudeBinary, hasClaudeBinary],
  ["codex", getCodexBinary, hasCodexBinary],
  ["opencode", getOpencodeBinary, hasOpencodeBinary],
  ["copilot", getCopilotBinary, hasCopilotBinary],
  ["cursor-agent", getCursorBinary, hasCursorBinary],
  ["agy", getAntigravityBinary, hasAntigravityBinary],
] as const;

function onPathHolding<T>(names: string[], body: (dir: string) => T): T {
  const dir = freshTestDir(import.meta.file);

  for (const name of names) {
    writeFileSync(resolve(dir, name), "#!/bin/sh\n");
    chmodSync(resolve(dir, name), 0o755);
  }

  const realPath = process.env.PATH;
  process.env.PATH = dir;

  try {
    return body(dir);
  } finally {
    process.env.PATH = realPath;
  }
}

describe.skipIf(process.platform === "win32")("agent binaries on PATH", () => {
  test.each(AGENTS)("%s resolves to its own file", (name, get, has) => {
    onPathHolding([name], (dir) => {
      expect(get()).toBe(resolve(dir, name));
      expect(has()).toBe(true);
    });
  });

  test.each(AGENTS)(
    "%s is absent from a PATH holding only other agents",
    (name, get, has) => {
      const others = AGENTS.map(([other]) => other).filter((other) => other !== name);

      onPathHolding(others, () => {
        expect(get()).toBeNull();
        expect(has()).toBe(false);
      });
    }
  );

  test("a PATH is searched once, so a binary removed later still resolves", () => {
    onPathHolding(["claude"], (dir) => {
      expect(getClaudeBinary()).toBe(resolve(dir, "claude"));
      removeOnceReleased(resolve(dir, "claude"));

      expect(getClaudeBinary()).toBe(resolve(dir, "claude"));
    });
  });
});
