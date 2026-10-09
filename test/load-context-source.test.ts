import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { contextForSource } from "../src/hooks/lib/session-context";
import { freshTestDir } from "./lib/test-home";

const LOAD_CONTEXT = resolve(import.meta.dir, "../src/hooks/LoadContext.ts");

let sandbox = "";

function runLoadContext(source: string, agent = "claude") {
  return spawnSync("bun", ["run", LOAD_CONTEXT, `--agent=${agent}`], {
    env: {
      ...process.env,
      PAL_HOME: resolve(sandbox, "home"),
      PAL_CLAUDE_DIR: resolve(sandbox, "claude"),
      PAL_COPILOT_DIR: resolve(sandbox, "copilot"),
      PAL_OPENCODE_DIR: resolve(sandbox, "opencode"),
      PAL_CODEX_DIR: resolve(sandbox, "codex"),
      PAL_GEMINI_DIR: resolve(sandbox, "gemini"),
      PAL_CURSOR_DIR: resolve(sandbox, "cursor"),
    },
    input: JSON.stringify({ hook_event_name: "SessionStart", source }),
    encoding: "utf-8",
    timeout: 60000,
  });
}

beforeAll(() => {
  sandbox = freshTestDir(import.meta.file);
  const telos = resolve(sandbox, "home", "telos");
  mkdirSync(telos, { recursive: true });
  writeFileSync(resolve(telos, "GOALS.md"), "# Goals\n\n- ship PAL\n", "utf-8");
});

describe("which session starts get context", () => {
  test.each([
    ["claude", "startup", "full"],
    ["claude", "clear", "full"],
    ["claude", undefined, "full"],
    ["claude", "compact", "without-handoff"],
    ["claude", "resume", "none"],
    ["codex", "resume", "none"],
    ["codex", "compact", "without-handoff"],
    ["codex", "fork", "full"],
    ["copilot", "resume", "full"],
    ["copilot", "new", "full"],
    ["vscode", "resume", "full"],
    ["cursor", undefined, "full"],
  ] as const)("%s, %s gets %s", (agent, source, expected) => {
    expect(contextForSource(agent, source)).toBe(expected);
  });

  test.each([
    "claude",
    "codex",
  ])("a resumed %s session is not handed the context a second time", (agent) => {
    const result = runLoadContext("resume", agent);
    expect({ status: result.status, stdout: result.stdout }).toEqual({
      status: 0,
      stdout: "",
    });
  });

  test("a resumed Copilot session still is, since Copilot may not replay it", () => {
    const result = runLoadContext("resume", "copilot");
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { additionalContext?: string };
    expect(parsed.additionalContext).toContain("<system-reminder>");
  });

  test("a fresh session still is", () => {
    const result = runLoadContext("startup");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("<system-reminder>");
  });
});
