import { describe, expect, test } from "bun:test";
import { workSession } from "../src/hooks/lib/work-session";

describe("work session", () => {
  test("reads the session each agent exports to its shell", () => {
    expect(workSession(undefined, { CLAUDE_CODE_SESSION_ID: "c1" }, "claude")).toBe("c1");
    expect(workSession(undefined, { CODEX_THREAD_ID: "x1" }, "codex")).toBe("x1");
    expect(workSession(undefined, { COPILOT_AGENT_SESSION_ID: "p1" }, "copilot")).toBe(
      "p1"
    );
    expect(
      workSession(undefined, { ANTIGRAVITY_CONVERSATION_ID: "g1" }, "antigravity")
    ).toBe("g1");
    expect(workSession(undefined, { PAL_OPENCODE_SESSION_ID: "o1" }, "opencode")).toBe(
      "o1"
    );
    expect(workSession(undefined, { CURSOR_CONVERSATION_ID: "u1" }, "cursor")).toBe("u1");
  });

  test("an agent reads its own variable, not one inherited from a parent agent", () => {
    const env = { CLAUDE_CODE_SESSION_ID: "parent", CODEX_THREAD_ID: "mine" };
    expect(workSession(undefined, env, "codex")).toBe("mine");
  });

  test("a hook's payload session wins over the environment", () => {
    expect(workSession("hook", { CLAUDE_CODE_SESSION_ID: "env" }, "claude")).toBe("hook");
  });

  test("an agent whose shell cannot name its session shares the one lane", () => {
    expect(workSession("hook", {}, "vscode")).toBeUndefined();
    expect(workSession(undefined, {}, "claude")).toBeUndefined();
  });
});
