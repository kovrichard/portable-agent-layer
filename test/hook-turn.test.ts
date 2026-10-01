import { describe, expect, test } from "bun:test";
import { hookSessionId } from "../src/hooks/lib/hook-turn";

describe("the session a hook payload belongs to", () => {
  test.each([
    ["claude", { session_id: "c1", hook_event_name: "Stop" }, "c1"],
    ["codex", { session_id: "thr_1", turn_id: "t2" }, "thr_1"],
    ["copilot", { sessionId: "cp1", stopReason: "end_turn" }, "cp1"],
    ["vscode", { session_id: "vs1", stop_hook_active: false }, "vs1"],
    [
      "cursor",
      { conversation_id: "cu1", generation_id: "g2", status: "completed" },
      "cu1",
    ],
  ])("%s stop names the session its prompt did", (_agent, payload, id) => {
    expect(hookSessionId(payload)).toBe(id);
  });

  test("an empty payload names no session", () => {
    expect(hookSessionId(null)).toBeUndefined();
  });
});
