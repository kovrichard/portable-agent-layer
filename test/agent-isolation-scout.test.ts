import { describe, expect, test } from "bun:test";
import { isolationRefusal } from "../.agents/scripts/agent-isolation";

describe("the subagent isolation guard and the scout", () => {
  test("lets the read-only scout share the main checkout", () => {
    expect(
      isolationRefusal({
        tool_name: "Agent",
        tool_input: { description: "d", prompt: "p", subagent_type: "scout" },
      })
    ).toBeNull();
  });
});
