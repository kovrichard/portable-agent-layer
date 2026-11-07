import { describe, expect, test } from "bun:test";
import { factoryHandbackSkip } from "../.agents/hooks/run-hook";

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
