import { describe, expect, test } from "bun:test";
import { wrappedAgents } from "../src/tools/lib/wrapped/agents";
import { agentsLines } from "../src/tools/lib/wrapped/render";
import { event } from "./lib/wrapped-events";

const turnOn = (runtime: string) => event("turn", {}, { runtime });
const callOn = (runtime: string, fields: Record<string, unknown> = {}) =>
  event("model_call", fields, { runtime });

describe("agents", () => {
  test("nothing logged shows no agent", () => {
    expect(wrappedAgents([])).toEqual({ messages: [], costs: [] });
  });

  test("shares are the user's messages per agent, most used first", () => {
    const agents = wrappedAgents([
      turnOn("cursor"),
      turnOn("claude"),
      turnOn("codex"),
      turnOn("claude"),
      callOn("copilot"),
      event("commit", {}, { runtime: "git" }),
    ]);
    expect(agents.messages).toEqual([
      { name: "claude", count: 2 },
      { name: "codex", count: 1 },
      { name: "cursor", count: 1 },
    ]);
  });

  test("each agent's cost is priced and paid on its own calls only", () => {
    const agents = wrappedAgents([
      callOn("copilot"),
      callOn("opencode", { costUsd: 1.5, billing: "api" }),
      turnOn("opencode"),
      callOn("opencode", { costUsd: 2, billing: "api" }),
    ]);
    expect(agents.costs).toEqual([
      {
        runtime: "opencode",
        calls: 2,
        cost: { apiEquivalent: 3.5, unpriced: 0, paid: 3.5 },
      },
      {
        runtime: "copilot",
        calls: 1,
        cost: { apiEquivalent: 0, unpriced: 1, paid: null },
      },
    ]);
  });
});

describe("the agents as printed", () => {
  test("agents print by name, and an agent with no priced call has an unknown cost", () => {
    expect(
      agentsLines({
        messages: [
          { name: "claude", count: 1200 },
          { name: "aider", count: 3 },
        ],
        costs: [
          {
            runtime: "claude",
            calls: 10,
            cost: { apiEquivalent: 12.5, unpriced: 2, paid: 100 },
          },
          {
            runtime: "copilot",
            calls: 4,
            cost: { apiEquivalent: 0, unpriced: 4, paid: null },
          },
        ],
      })
    ).toEqual([
      "\n  Agents\n",
      "    messages by agent    Claude Code 1,200 · aider 3",
      "    cost by agent        Claude Code  API-equivalent $12.50 + 2 unpriced calls, paid $100.00",
      "                         Copilot  API-equivalent unknown, paid unknown",
      "    Cursor human vs AI   unknown",
    ]);
  });

  test("with no messages or calls every agent stat is unknown", () => {
    expect(agentsLines({ messages: [], costs: [] }).slice(1)).toEqual([
      "    messages by agent    unknown",
      "    cost by agent        unknown",
      "    Cursor human vs AI   unknown",
    ]);
  });
});
