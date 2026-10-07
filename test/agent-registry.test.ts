import { describe, expect, test } from "bun:test";
import {
  AGENT_NAMES,
  AGENT_REGISTRY,
  INFERENCE_PRIORITY,
  isAgentName,
  LAUNCH_PRIORITY,
} from "../src/hooks/lib/agent-registry";

const sorted = (names: readonly string[]) => [...names].sort();

describe("agent registry", () => {
  test.each([
    ["inference", INFERENCE_PRIORITY],
    ["launch", LAUNCH_PRIORITY],
  ])("the %s priority ranks every registered agent exactly once", (_, priority) => {
    expect(sorted(priority)).toEqual(sorted(AGENT_NAMES));
  });

  test("every agent has a distinct binary", () => {
    const binaries = AGENT_NAMES.map((agent) => AGENT_REGISTRY[agent].binary);
    expect(new Set(binaries).size).toBe(AGENT_NAMES.length);
  });

  test("isAgentName accepts registered agents and rejects the vscode pseudo-agent", () => {
    for (const agent of AGENT_NAMES) expect(isAgentName(agent)).toBe(true);
    expect(isAgentName("vscode")).toBe(false);
    expect(isAgentName("toString")).toBe(false);
  });
});
