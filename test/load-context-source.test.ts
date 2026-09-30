import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { contextForSource } from "../src/hooks/lib/session-context";

const LOAD_CONTEXT = resolve(import.meta.dir, "../src/hooks/LoadContext.ts");

let sandbox = "";

function runLoadContext(source: string) {
  return spawnSync("bun", ["run", LOAD_CONTEXT, "--agent=claude"], {
    env: {
      ...process.env,
      PAL_HOME: resolve(sandbox, "home"),
      PAL_CLAUDE_DIR: resolve(sandbox, "claude"),
      PAL_COPILOT_DIR: resolve(sandbox, "copilot"),
      PAL_OPENCODE_DIR: resolve(sandbox, "opencode"),
      PAL_CODEX_DIR: resolve(sandbox, "codex"),
      PAL_CURSOR_DIR: resolve(sandbox, "cursor"),
    },
    input: JSON.stringify({ hook_event_name: "SessionStart", source }),
    encoding: "utf-8",
    timeout: 60000,
  });
}

beforeAll(() => {
  sandbox = mkdtempSync(resolve(tmpdir(), "pal-load-context-"));
  const telos = resolve(sandbox, "home", "telos");
  mkdirSync(telos, { recursive: true });
  writeFileSync(resolve(telos, "GOALS.md"), "# Goals\n\n- ship PAL\n", "utf-8");
});

afterAll(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

describe("which session starts get context", () => {
  test.each([
    ["startup", "full"],
    ["clear", "full"],
    [undefined, "full"],
    ["compact", "without-handoff"],
    ["resume", "none"],
  ] as const)("%s gets %s", (source, expected) => {
    expect(contextForSource(source)).toBe(expected);
  });

  test("a resumed session is not handed the context a second time", () => {
    const result = runLoadContext("resume");
    expect({ status: result.status, stdout: result.stdout }).toEqual({
      status: 0,
      stdout: "",
    });
  });

  test("a fresh session still is", () => {
    const result = runLoadContext("startup");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("<system-reminder>");
  });
});
