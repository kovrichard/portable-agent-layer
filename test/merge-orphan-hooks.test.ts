import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { mergeCodexHooks, mergeCursorHooks, mergeSettings } from "../src/targets/lib";
import { removeOnceReleased } from "./lib/remove-once-released";

let DIR: string;
let USER_SCRIPT: string;

beforeEach(() => {
  DIR = mkdtempSync(resolve(tmpdir(), "pal-orphan-hooks-"));
  USER_SCRIPT = resolve(DIR, "src", "hooks", "Mine.ts");
  mkdirSync(resolve(DIR, "src", "hooks"), { recursive: true });
  writeFileSync(USER_SCRIPT, "");
});

afterEach(() => {
  removeOnceReleased(DIR);
});

const removedHook = () => `bun run ${DIR}/src/hooks/PostToolOrchestrator.ts`;
const userHooks = () => [`bun run ${USER_SCRIPT}`, "my-own-linter"];
const current = () => `bun run ${DIR}/src/hooks/LoadContext.ts`;

describe("reinstalling drops PAL hooks whose script no longer exists", () => {
  test("Claude Code settings", () => {
    const entry = (command: string) => ({ hooks: [{ type: "command", command }] });
    const merged = mergeSettings(
      { hooks: { PostToolUse: [removedHook(), ...userHooks()].map(entry) } },
      { hooks: { SessionStart: [entry(current())] } }
    );

    expect(
      Object.values(merged.hooks ?? {}).flatMap((es) =>
        es.map((e) => e.hooks?.[0]?.command)
      )
    ).toEqual([...userHooks(), current()]);
  });

  test("Cursor hooks", () => {
    const entry = (command: string) => ({ type: "command", command });
    const merged = mergeCursorHooks(
      { version: 1, hooks: { postToolUse: [removedHook(), ...userHooks()].map(entry) } },
      { version: 1, hooks: { sessionStart: [entry(current())] } }
    );

    expect(
      Object.values(merged.hooks ?? {}).flatMap((es) => es.map((e) => e.command))
    ).toEqual([...userHooks(), current()]);
  });

  test("Codex hooks", () => {
    const group = (command: string) => ({ hooks: [{ type: "command", command }] });
    const merged = mergeCodexHooks(
      { hooks: { PostToolUse: [removedHook(), ...userHooks()].map(group) } },
      { hooks: { SessionStart: [group(current())] } }
    );

    expect(
      Object.values(merged.hooks ?? {}).flatMap((gs) =>
        gs.flatMap((g) => g.hooks.map((h) => h.command))
      )
    ).toEqual([...userHooks(), current()]);
  });
});
