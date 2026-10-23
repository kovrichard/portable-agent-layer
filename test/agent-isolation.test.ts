import { describe, expect, test } from "bun:test";
import { isolationRefusal } from "../.agents/scripts/agent-isolation";

const agentCall = (toolInput: Record<string, unknown>) => ({
  tool_name: "Agent",
  tool_input: { description: "d", prompt: "p", ...toolInput },
});

describe("the subagent isolation guard", () => {
  test("refuses an editing agent launched without a worktree, naming the fix", () => {
    expect(isolationRefusal(agentCall({ subagent_type: "general-purpose" }))).toContain(
      'isolation: "worktree"'
    );
  });

  test("refuses an agent with no type, which defaults to general-purpose", () => {
    expect(isolationRefusal(agentCall({}))).not.toBeNull();
  });

  test("refuses a fork without a worktree", () => {
    expect(isolationRefusal(agentCall({ subagent_type: "fork" }))).not.toBeNull();
  });

  test("lets an agent through once it runs in a worktree", () => {
    expect(
      isolationRefusal(
        agentCall({ subagent_type: "general-purpose", isolation: "worktree" })
      )
    ).toBeNull();
  });

  test("lets the read-only agent types share the checkout", () => {
    for (const type of [
      "Explore",
      "Plan",
      "claude-code-guide",
      "web-fetch",
      "perplexity-researcher",
    ])
      expect(isolationRefusal(agentCall({ subagent_type: type }))).toBeNull();
  });

  test("ignores every tool other than Agent", () => {
    expect(isolationRefusal({ tool_name: "Bash", tool_input: {} })).toBeNull();
  });
});
