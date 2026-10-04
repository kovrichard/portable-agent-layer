import { describe, expect, test } from "bun:test";
import {
  checkClaims,
  commandsThisTurn,
  resultClaims,
} from "../src/hooks/lib/claim-check";

function claude(entries: unknown[]): string[] {
  return entries.map((e) => JSON.stringify(e));
}

const prompt = (text: string) => ({ type: "user", message: { content: text } });
const toolUse = (name: string) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", name, input: {} }] },
});
const toolResult = () => ({
  type: "user",
  message: { content: [{ type: "tool_result", content: "ok" }] },
});
const said = (text: string) => ({
  type: "assistant",
  message: { content: [{ type: "text", text }] },
});

describe("finding result claims in a reply", () => {
  test.each([
    "All tests pass.",
    "The suite is green now",
    "CI passed on all three runners.",
    "The build succeeded",
    "Verified: the hook fires once.",
    "The upload works now.",
  ])("a claim: %s", (reply) => {
    expect(resultClaims(reply)).toHaveLength(1);
  });

  test.each([
    "The tests should pass once the fixture is fixed.",
    "CI is not green yet.",
    "Run the tests when you are back.",
    "Two tests failed on Windows.",
    "I renamed the queue worker.",
    'The hook flags a reply that says "tests pass" with nothing run.',
    "It sends back “CI is green” claims it cannot see.",
  ])("not a claim: %s", (reply) => {
    expect(resultClaims(reply)).toEqual([]);
  });

  test("names each claiming sentence, not the whole reply", () => {
    expect(resultClaims("Renamed the worker. All tests pass. Want me to push?")).toEqual([
      "All tests pass",
    ]);
  });
});

describe("counting the commands run this turn", () => {
  test("counts command tools after the user's last prompt only", () => {
    const lines = claude([
      prompt("run the tests"),
      toolUse("Bash"),
      toolResult(),
      said("done"),
      prompt("now push"),
      toolUse("Edit"),
      toolResult(),
      toolUse("Bash"),
      toolResult(),
    ]);

    expect(commandsThisTurn(lines)).toBe(1);
  });

  test("an edit or a read is not a command that shows a result", () => {
    const lines = claude([prompt("fix it"), toolUse("Edit"), toolUse("Read")]);

    expect(commandsThisTurn(lines)).toBe(0);
  });

  test("a notification injected mid-turn does not start a new turn", () => {
    const lines = claude([
      prompt("run the tests"),
      toolUse("Bash"),
      prompt("<task-notification>done</task-notification>"),
    ]);

    expect(commandsThisTurn(lines)).toBe(1);
  });

  test("reads a Codex turn", () => {
    const lines = [
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "run it" }],
        },
      },
      { type: "response_item", payload: { type: "custom_tool_call", name: "exec" } },
      { type: "response_item", payload: { type: "function_call", name: "shell" } },
    ].map((e) => JSON.stringify(e));

    expect(commandsThisTurn(lines)).toBe(2);
  });

  test("a transcript it cannot read gives no count rather than zero", () => {
    expect(commandsThisTurn(["not json", JSON.stringify({ type: "other" })])).toBeNull();
  });
});

describe("judging the reply", () => {
  test("a claim with no command behind it is unbacked", () => {
    expect(checkClaims("All tests pass.", 0)).toEqual({
      verdict: "unbacked",
      claims: ["All tests pass"],
    });
  });

  test("a claim after a command ran is backed", () => {
    expect(checkClaims("All tests pass.", 2).verdict).toBe("backed");
  });

  test("a claim in a turn that could not be read is unknown, never unbacked", () => {
    expect(checkClaims("All tests pass.", null).verdict).toBe("unknown");
  });

  test("a reply that claims nothing is not judged", () => {
    expect(checkClaims("Renamed the worker.", 0)).toEqual({
      verdict: "none",
      claims: [],
    });
  });
});
