import { describe, expect, test } from "bun:test";
import { factoryHandbackSkip, factorySubagentSkip } from "../.agents/hooks/run-hook";

const finished = {
  tool_name: "StructuredOutput",
  tool_input: { done: true, summary: "ok" },
};

describe("factoryHandbackSkip", () => {
  test("any tool other than StructuredOutput is never skipped here", () => {
    expect(
      factoryHandbackSkip({ tool_name: "SubagentHandback" }, undefined, true)
    ).toBeNull();
    expect(factoryHandbackSkip({}, "test-writer", true)).toBeNull();
  });

  test("a finished code writer and debugger run every gate", () => {
    for (const role of ["code-writer", "debugger"]) {
      expect(factoryHandbackSkip(finished, role, true)).toBeNull();
      expect(factoryHandbackSkip(finished, role, false)).toBeNull();
    }
  });

  test("a finished test writer runs the gates that need no code", () => {
    expect(factoryHandbackSkip(finished, "test-writer", false)).toBeNull();
  });

  test("a finished test writer skips the gates that need the code", () => {
    expect(factoryHandbackSkip(finished, "test-writer", true)).toBe(
      "skipped: the test writer's tests come before the code this gate checks"
    );
  });

  test("roles that write no files, and sessions outside the factory, are skipped", () => {
    for (const role of ["reviewer", "po", "planner", "tester", "coach", undefined]) {
      expect(factoryHandbackSkip(finished, role, false)).toBe(
        "skipped: not the handback of a factory role that writes files"
      );
    }
  });

  test("a role that is not done is skipped, so the build decides", () => {
    const notDone = { ...finished, tool_input: { done: false, summary: "stuck" } };
    expect(factoryHandbackSkip(notDone, "code-writer", false)).toBe(
      "skipped: the role is not done, so the build decides"
    );
  });

  test("a role asking the PO a question is skipped", () => {
    const asking = { ...finished, tool_input: { done: true, question: "Which file?" } };
    expect(factoryHandbackSkip(asking, "code-writer", false)).toBe(
      "skipped: the role asks the PO a question"
    );
  });

  test("a blank question does not count as a question", () => {
    const blank = { ...finished, tool_input: { done: true, question: "  " } };
    expect(factoryHandbackSkip(blank, "code-writer", false)).toBeNull();
  });
});

const subagentStop = (agentType: string) => ({
  hook_event_name: "SubagentStop",
  agent_type: agentType,
});

describe("factorySubagentSkip", () => {
  test("a test-writer subagent skips the gates that need the code", () => {
    expect(factorySubagentSkip(subagentStop("dark-factory:test-writer"), true)).toBe(
      "skipped: the test writer's tests come before the code this gate checks"
    );
  });

  test("a test-writer subagent runs the gates that need no code", () => {
    expect(
      factorySubagentSkip(subagentStop("dark-factory:test-writer"), false)
    ).toBeNull();
  });

  test("code-writer and debugger subagents run every gate", () => {
    for (const role of ["code-writer", "debugger"]) {
      expect(factorySubagentSkip(subagentStop(`dark-factory:${role}`), true)).toBeNull();
    }
  });

  test("factory subagents that write no files are skipped", () => {
    for (const role of ["reviewer", "planner", "tester", "architect", "po"]) {
      expect(factorySubagentSkip(subagentStop(`dark-factory:${role}`), false)).toBe(
        "skipped: not a factory role that writes files"
      );
    }
  });

  test("a factory subagent's own handback follows the same rules", () => {
    const handback = {
      tool_name: "SubagentHandback",
      agent_type: "dark-factory:test-writer",
    };
    expect(factorySubagentSkip(handback, true)).toBe(
      "skipped: the test writer's tests come before the code this gate checks"
    );
  });

  test("a subagent outside the factory, or no subagent, is never skipped here", () => {
    expect(factorySubagentSkip(subagentStop("general-purpose"), true)).toBeNull();
    expect(factorySubagentSkip(subagentStop("Explore"), false)).toBeNull();
    expect(factorySubagentSkip({ hook_event_name: "SubagentStop" }, true)).toBeNull();
    expect(factorySubagentSkip({}, true)).toBeNull();
  });
});
